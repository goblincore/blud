// scripts/frame-cost.mjs — where a whole frame's time goes, per scene (docs/dev-notes/2026-10-08-frame-cost/NOTES.md).
//
// One boot per scene and repeat, the page as it ships (VHS, upscale, crowd march, no pins), 1280 x 800. Per boot:
//   1. THE BENCH'S PASSES MODE (__sdfGame.bench, game-bench.ts): the scripted walk / fire / gib fight, LIVE (the sim
//      ticks, so the CPU's share is real). Per segment: the fenced frame, every GPU pass by its label charged by
//      completion order (gpu-pass-timing.ts attributePassSamples), and the CPU's tick, draw and telemetry phases.
//   2. COUNTERS that do not depend on the machine's load: draw calls per pass label, draw calls and triangles of one
//      live frame, the scene census (visible meshes by group), bodies in the frustum.
//   3. ABLATIONS BY ALTERNATION on the frame the fight ends on, frozen: a stage switched off and on again in blocks
//      (baseline, variant, baseline, ...), each variant block scored against the mean of the baseline blocks either
//      side of it, so a drift in load cancels. A no-op switch (the A/A control) gives the instrument's floor.
//      "Off" draws a wrong frame on purpose: cost only. A switched-off stage is the CEILING of what optimising it
//      could return, not a forecast.
// Scenes (SCENES=a,b,...; a name may carry extra query after a "+", e.g. train-third+tubes=0, and before it another
// dev server's port after an "@", e.g. train-third@5269,train-third@5267: two trees, interleaved, one browser):
//   train-van | train-third | train-dining | train-sleeper | train-boiler   Night Train, the player armed (walked
//       over the sawn-off pickup, unlimited ammo) and teleported to that carriage.
//   ring-room4 | ring-arena   the bare page's room 4 (4 zombies) and its arena (6 zombies, 2 soldiers).
//   closeup   the bare page, frozen: one zombie at CLOSE_D m with two buckshot volleys, a torso chop and its head
//       split open (two head chops). No fight; the passes are read on still frames.
//   closeup-pellets | closeup-chop   the same body with the volleys only, and with the volleys and the torso chop.
// Env: REPEATS (2), ABLATE=0 skips step 3, ALT_ROUNDS (8), ALT_K (10 frames a block), OUT (.lab-tmp/frame-cost),
//   CLOSE_D (0.8), LOAD_MAX (6: a boot and every ablation leg wait for the 1-minute load average to fall to it),
//   LOAD_BAD (8: a measure that ends above it is taken again, RETRIES (2) times), WARM=0 (no warm boots),
//   LIGHTS=1 (also the light-hiding legs: run them in a pass of their own, last; see LIGHT_ABLATIONS).
// Usage (bash; one GPU job at a time on this machine, so take the shared lock first):
//   until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
//   bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5261 LAB_CDP_PORT=9261; . scripts/lab-servers.sh;
//     trap "lab_servers_down; rm -rf /tmp/blud-gpu-timing.lock" EXIT; lab_servers_up; node scripts/frame-cost.mjs 5261 9261'
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";

const VITE = Number(process.argv[2] ?? 5261);
const CDP = Number(process.argv[3] ?? 9261);
const OUT = process.env.OUT ?? ".lab-tmp/frame-cost";
const REPEATS = Number(process.env.REPEATS ?? 2);
const ALT_ROUNDS = Number(process.env.ALT_ROUNDS ?? 8);
const ALT_K = Number(process.env.ALT_K ?? 10);
const CLOSE_D = Number(process.env.CLOSE_D ?? 0.8);
const LOAD_MAX = Number(process.env.LOAD_MAX ?? 6);
/** A measure that ENDS with the load above this is taken again (RETRIES times); what is still above it is marked. */
const LOAD_BAD = Number(process.env.LOAD_BAD ?? 8);
const RETRIES = Number(process.env.RETRIES ?? 2);
const W = 1280, H = 800, EYE_H = 1.62;
const SCENE_NAMES = (process.env.SCENES ?? "train-van,train-third,train-boiler,ring-room4,ring-arena,closeup").split(",");
/** Night Train's sawn-off lies on the hold's east trunk stack (the loop gate walks the same spot). */
const SAWN_OFF = { x: 1.3, z: -2.9 };
const SCENES = {
  "train-van": { query: "level=night-train", room: 1, arm: true },
  "train-third": { query: "level=night-train", room: 2, arm: true },
  "train-dining": { query: "level=night-train", room: 3, arm: true },
  "train-sleeper": { query: "level=night-train", room: 4, arm: true },
  "train-boiler": { query: "level=night-train", room: 5, arm: true },
  "ring-room4": { query: "", room: 4 },
  "ring-arena": { query: "", room: 6 },
  closeup: { query: "frozen=1", closeup: true },
  "closeup-pellets": { query: "frozen=1", closeup: true, chops: [] },
  "closeup-chop": { query: "frozen=1", closeup: true, chops: [["R", "torso"]] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const load1 = () => loadavg()[0];
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const quart = (v, q) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "  n/a");

/** Wait (at most 10 minutes) for the 1-minute load average to fall to LOAD_MAX. */
async function quiet() { const t0 = Date.now(); while (load1() > LOAD_MAX && Date.now() - t0 < 600000) await sleep(5000); }

// ---- CDP ------------------------------------------------------------------------------------------------------
let S = null;
async function openSession() {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), console: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") s.console.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    if (m.method === "Runtime.exceptionThrown") s.console.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
  };
  s.send = (method, params = {}) => new Promise((resolve) => { const id = ++s.seq; s.pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
  await s.send("Page.enable"); await s.send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
  await s.send("Page.bringToFront");
  await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return s;
}
function closeSession() {
  if (!S) return;
  try { S.ws.close(); } catch {}
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${S.tab.id}`], { stdio: "ignore" }); } catch {}
  S = null;
}
process.on("exit", closeSession);
// A killed driver must not leave its page behind: an orphaned game page keeps drawing, and every later measure on
// this machine then shares the GPU and a core with it (2026-10-08: two orphans read as CPU tick 16 ms against 6.5).
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { closeSession(); process.exit(130); });
/** Other game pages open on this browser: they draw too. The run refuses to start beside one (STRAYS=close shuts them). */
async function strays() {
  const tabs = (await (await fetch(`http://localhost:${CDP}/json/list`)).json()).filter((t) => t.type === "page" && /sdf-(game|lab)/.test(t.url));
  if (!tabs.length) return;
  if (process.env.STRAYS !== "close") die(`${tabs.length} game page(s) already open on the browser at ${CDP} (${tabs[0].url}): they share the GPU. Close them, or STRAYS=close.`);
  for (const t of tabs) await fetch(`http://localhost:${CDP}/json/close/${t.id}`);
}
const evaluate = async (expression, ms = 600000) => {
  const r = await Promise.race([
    S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${expression.slice(0, 100)}`)), ms)),
  ]);
  if (r.result?.exceptionDetails) throw new Error(`page threw in ${expression.slice(0, 100)}: ${JSON.stringify(r.result.exceptionDetails).slice(0, 500)}`);
  return r.result?.result?.value;
};

/** THE MACHINE'S SPEED, measured: the least of 5 timings of a fixed loop in the page (about 35 ms on a quiet M3). The
 *  load average does not see everything that slows a run (the owner at the keyboard, a camera app, a stray page:
 *  the CPU tick of one scene read 6.5 ms and 11 ms at the same load). A run whose loop reads more than CAL_BAD times
 *  the best this driver has seen is taken again. */
const CAL_BAD = Number(process.env.CAL_BAD ?? 1.2);
let calBest = Infinity;
async function calibrate() {
  const ms = await evaluate("(() => { let best = 1e9; for (let k = 0; k < 5; k++) { const t0 = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x += Math.sqrt(i); best = Math.min(best, performance.now() - t0); if (x < 0) return -1; } return best; })()");
  calBest = Math.min(calBest, ms);
  return ms;
}

// ---- Boot and staging ------------------------------------------------------------------------------------------
async function boot(query, vite = VITE) {
  await quiet();
  await openSession();
  const t0 = Date.now();
  await S.send("Page.navigate", { url: `http://localhost:${vite}/sdf-game.html?seed=1&loader=0${query ? `&${query}` : ""}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  await evaluate("__sdfGame.setLoopRunning(false)");
  // The crowd march and the gib variants compile after the loader gate; until then the cast is drawn per body.
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" && wb.crowd === "ready") break; if (wb.gib === "failed" || wb.crowd === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  if (wb?.gib !== "ready" || wb?.crowd !== "ready") die(`the background warm is ${JSON.stringify(wb)}`);
  return { bootMs: Date.now() - t0, marks: await evaluate("__sdfGame.bootMarks()") };
}
const stepN = (n) => evaluate(`(() => { for (let i = 0; i < ${n}; i++) __sdfGame.step(1, 1 / 60); return 1; })()`);
async function arm() {
  await evaluate(`__sdfGame.setPose(${SAWN_OFF.x}, ${SAWN_OFF.z}, 0, 0)`);
  await stepN(20);
  const inv = await evaluate("__sdfGame.inventory()");
  if (!inv.weapons.includes("shotgun")) die(`the sawn-off was not picked up: ${JSON.stringify(inv)}`);
  await evaluate("__sdfGame.setInfiniteAmmo(true)");
  await evaluate("__sdfGame.selectSlot('shotgun')");
  await stepN(90);
}
/** The close-up: the nearest zombie of room 4 wounded, its head split, the eye CLOSE_D m from its chest. */
async function stageCloseup(blows = [["R", "torso"], ["H", "head"], ["H", "head"]]) {
  await evaluate("__sdfGame.teleport(4)");
  await evaluate("__sdfGame.setInfiniteAmmo(true)");
  await evaluate("__sdfGame.freeze(false)"); await stepN(30); await evaluate("__sdfGame.freeze(true)");
  const pose = await evaluate("__sdfGame.pose()");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie" && a.room === 4);
  const z = zs.sort((a, b) => Math.hypot(a.pos[0] - pose.pos[0], a.pos[2] - pose.pos[2]) - Math.hypot(b.pos[0] - pose.pos[0], b.pos[2] - pose.pos[2]))[0];
  if (!z) die("no zombie in room 4");
  const look = async (d) => {
    const head = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, "head")`), torso = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, "torso")`);
    if (!head || !torso) die(`zombie ${z.id} has no head or torso`);
    const t = [(head[0] + torso[0]) / 2, (head[1] + torso[1]) / 2 + 0.08, (head[2] + torso[2]) / 2];
    // In front of the body: the page's forward is (sin yaw, -cos yaw).
    const fx = Math.sin(z.yaw), fz = -Math.cos(z.yaw);
    const hz = Math.sqrt(Math.max(0.01, d * d - (t[1] - EYE_H) ** 2));
    await evaluate(`__sdfGame.placePlayer({ x: ${t[0] + fx * hz}, z: ${t[2] + fz * hz}, yaw: ${Math.atan2(-fx, fz)}, pitch: ${Math.atan2(t[1] - EYE_H, hz)} })`);
    await evaluate("__sdfGame.step(1, 0)");
  };
  await look(2.0);
  const shots = [];
  for (let i = 0; i < 2; i++) { await evaluate("__sdfGame.aimSurface()"); shots.push(await evaluate("__sdfGame.fire(2)")); await stepN(40); }
  // A frozen body a hit moved is drawn clipped until it relaxes: thaw, then freeze again (relax), after every blow.
  const relax = async () => { await evaluate("__sdfGame.freeze(false)"); await stepN(14); await evaluate("__sdfGame.freeze(true)"); await stepN(70); };
  await relax();
  // THE CHOPS ARE STRUCK FROM THE CLOSE STANCE: from the volleys' 2 m the axe does not reach and axeChop returns 0
  // (the first matrix of 2026-10-08 measured 32 pellet wounds and no cut for that reason).
  const chops = [];
  for (const [side, target] of blows) { await look(CLOSE_D); chops.push(await evaluate(`__sdfGame.axeChop(${z.id}, "${side}", "${target}")`)); await relax(); }
  await look(CLOSE_D);
  await stepN(24);
  const split = await evaluate(`__sdfGame.headSplit(${z.id})`);
  if (blows.some((b) => b[1] === "head") && !split) throw new Error(`the close-up's head did not split: ${JSON.stringify({ chops, split })}`);
  if (chops.some((c) => !c)) throw new Error(`a chop of the close-up did not land: ${JSON.stringify(chops)}`);
  return { zombie: z.id, shots, chops, wounds: (await evaluate(`__sdfGame.actorWounds(${z.id})`))?.length ?? null, split };
}

// ---- The ablations ---------------------------------------------------------------------------------------------
/** [name, variant, restore]. A restore that reads `keep` puts back what the page had (captured before the first leg). */
const ABLATIONS = [
  ["A/A control", "0", "0"],
  ["post: VHS off", "__sdfGame.setVhs(null)", "__sdfGame.setVhs(keep.vhs)"],
  ["post: FXAA off", "__sdfGame.setFxaa(false)", "__sdfGame.setFxaa(true)"],
  ["mesh: bones, eyes, organs hidden", "__sdfGame.meshSkeletonShow({ bones: false, eyes: false, organs: false })", "__sdfGame.meshSkeletonShow(keep.show)"],
  ["mesh: eyes hidden", "__sdfGame.meshSkeletonShow({ eyes: false })", "__sdfGame.meshSkeletonShow(keep.show)"],
  ["level: all level meshes hidden", "__sdfGame.setLevelMeshVisible(false)", "__sdfGame.setLevelMeshVisible(true)"],
  ["level: art hidden", "__sdfGame.setArtVisible(false)", "__sdfGame.setArtVisible(true)"],
  ["viewmodel hidden", "__sdfGame.setViewModelVisible(false)", "__sdfGame.setViewModelVisible(true)"],
  ["viewmodel: meshes hidden, its light kept", "fc.hide('vm', (o) => o.isMesh, __sdfGame.viewModelAnchor)", "fc.show('vm')"],
  ["gib chunks hidden", "__sdfGame.setChunksVisible(false)", "__sdfGame.setChunksVisible(true)"],
  ["goo off", "__sdfGame.setGoo(false)", "__sdfGame.setGoo(keep.goo)"],
  ["bodies: level shadows off", "__sdfGame.setLevelShadow(false)", "__sdfGame.setLevelShadow(true)"],
  ["bodies: light list off", "__sdfGame.setLayer('list', false)", "__sdfGame.setLayer('list', keep.layers.list)"],
  ["march: wound cull off", "__sdfGame.setWoundCull(false)", "__sdfGame.setWoundCull(keep.woundCull)"],
  ["march: miss cull off", "__sdfGame.setMissCull(false)", "__sdfGame.setMissCull(keep.missCull)"],
  ["march: outer shell off", "__sdfGame.setShell(false)", "__sdfGame.setShell(keep.shell)"],
  ["march: occluder off", "__sdfGame.setOccluder(false)", "__sdfGame.setOccluder(keep.occluder)"],
  // Two switches that change how many wound rows a sample folds (the march's census, mode 13): the exact reach (ships
  // ON since 2026-10-08; off is the old fixed 0.25 m slack: 4 times the rows on a 32-wound body; on a tree from before
  // that date this leg measures turning it ON) and the coarse early-out (ships ON; off, every sample folds every row).
  ["march: exact wound reach flipped", "__sdfGame.setWoundExact(!keep.woundExact)", "__sdfGame.setWoundExact(keep.woundExact)"],
  ["march: wound early-out off", "__sdfGame.setWoundEarlyOut(false)", "__sdfGame.setWoundEarlyOut(true)"],
  // The owner re-fold: where a wound raised the field, the march folds the owner cluster's primitives again.
  ["march: owner re-fold off", "__sdfGame.setOwnerRefold(false)", "__sdfGame.setOwnerRefold(keep.ownerRefold)"],
];
/** LIGHTS=1 only, and LAST. Hiding a light takes it out of every lit material's light set: three re-keys those
 *  pipelines and builds each variant (the warm frames of a leg pay for it; an A/A leg straight after them still read
 *  frames of 150 ms). Zero intensity would not do: the shader's loop still runs. */
const LIGHT_ABLATIONS = [
  ["lights: tube and beacon spots hidden", "fc.hide('tube', (o) => o.isLight && /tube-spot|beacon-spot/.test(o.name))", "fc.show('tube')"],
  ["lights: accent point lights hidden", "fc.hide('acc', (o) => o.isPointLight && o.parent && o.parent.name === 'accent-lights')", "fc.show('acc')"],
  ["lights: every three.js light hidden", "fc.hide('all', (o) => o.isLight)", "fc.show('all')"],
  ["A/A control, after the light legs", "0", "0"],
];
const KEEP = `({ vhs: __sdfGame.vhs, show: __sdfGame.meshSkeletonShow(), goo: !!(typeof __sdfGame.goo === "function" ? __sdfGame.goo() : __sdfGame.goo)?.enabled, layers: __sdfGame.layers(), woundCull: __sdfGame.woundCull, missCull: __sdfGame.missCull, woundExact: !!__sdfGame.woundExact, ownerRefold: __sdfGame.ownerRefold !== false, shell: __sdfGame.shell.enabled, occluder: __sdfGame.occluder })`;
async function ablate() {
  await evaluate("__sdfGame.freeze(true)");
  await stepN(4);
  await evaluate(`window.__fcKeep = ${KEEP}`);
  // fc.hide(key, test, under): hide every visible object the test takes (under the scene root by default); fc.show(key)
  // puts exactly those back.
  await evaluate(`(() => { let root = __sdfGame.viewModelAnchor; while (root.parent) root = root.parent; const sets = {};
    window.fc = { root, hide(key, test, under = root) { const v = sets[key] = []; under.traverse((o) => { if (o.visible && test(o)) { o.visible = false; v.push(o); } }); return v.length; },
      show(key) { for (const o of sets[key] || []) o.visible = true; sets[key] = []; } }; return 1; })()`);
  const keep = await evaluate("JSON.parse(JSON.stringify(window.__fcKeep))");
  const rows = [];
  for (const [name, variant, restore] of process.env.LIGHTS === "1" ? [...ABLATIONS, ...LIGHT_ABLATIONS] : ABLATIONS) {
    let r, l0 = 0, l1 = 0;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
    await quiet(); l0 = load1();
    try {
      r = await evaluate(`(async () => { const keep = window.__fcKeep, fc = window.fc; const on = () => { ${variant}; }, off = () => { ${restore}; };
        const t = (n) => __sdfGame.timeDraws(n);
        on(); await t(6); off(); await t(6);                       // a variant's first frames may compile a pipeline
        const B = [], V = [];
        for (let i = 0; i < ${ALT_ROUNDS}; i++) { B.push(await t(${ALT_K})); on(); await t(3); V.push(await t(${ALT_K})); off(); await t(3); }
        B.push(await t(${ALT_K}));
        return { B, V }; })()`);
    } catch (e) { r = { error: String(e).slice(0, 200) }; break; }
    l1 = load1();
    if (l1 <= LOAD_BAD) break;
    }
    if (r.error) { rows.push({ name, error: r.error }); continue; }
    const d = r.V.map((v, i) => v - (r.B[i] + r.B[i + 1]) / 2);
    rows.push({ name, base: median(r.B), baseMin: Math.min(...r.B), baseMax: Math.max(...r.B), delta: median(d), q1: quart(d, 0.25), q3: quart(d, 0.75), n: d.length, load: [l0, l1], noisy: l1 > LOAD_BAD });
  }
  return { keep, rows };
}

// ---- One scene, one boot ---------------------------------------------------------------------------------------
async function runScene(spec, rep, lastTry, warmOnly = false) {
  const [nameAt, extra] = spec.split("+");
  const [name, port] = nameAt.split("@");
  const sc = SCENES[name]; if (!sc) die(`unknown scene ${name}`);
  const query = [sc.query, extra].filter(Boolean).join("&");
  const out = { scene: spec, rep, query, load0: load1() };
  out.boot = await boot(query, port ? Number(port) : VITE);
  if (sc.arm) await arm();
  let benchOpts;
  if (sc.closeup) { out.stage = await stageCloseup(sc.chops); benchOpts = "{ kind: 'closeup', closeupFrames: 240, mode: 'passes', chunkFrames: 4, warmup: 20 }"; }
  else {
    benchOpts = `{ room: ${sc.room}, mode: 'passes', chunkFrames: 4, warmup: 30 }`;
    // THE ROOM IS ENTERED ONCE BEFORE THE FIGHT, the cast frozen and no sim time passing: three builds a material's
    // pipeline at its first draw, mid-frame, so the first frames in a carriage are the compiler's (32 pipelines on
    // entering third class). That hitch is reported on its own line (entry); the fight is then the steady state.
    out.entry = await evaluate(`(async () => { const g = __sdfGame; const p0 = g.pipelineLog().totalPipelines; g.freeze(true); g.teleport(${sc.room});
      const ms = []; for (let i = 0; i < 40; i++) { const t0 = performance.now(); g.step(1, 0); await g.resolveGpu(); ms.push(performance.now() - t0); }
      return { pipelines: g.pipelineLog().totalPipelines - p0, first: ms.slice(0, 6).map((v) => +v.toFixed(1)), worst: +Math.max(...ms).toFixed(1), settled: +ms.slice(20).sort((a, b) => a - b)[10].toFixed(1) }; })()`);
  }
  const cal0 = await calibrate();
  const pipes0 = await evaluate("__sdfGame.pipelineLog().totalPipelines");
  const b = await evaluate(`__sdfGame.bench(${benchOpts})`, 900000);
  // A pipeline created inside the fight is a compile inside the timed frames (a cold shader cache, a material seen
  // for the first time): the run then times the compiler. Counted, printed, and the reason for the warm boot below.
  out.pipelinesInFight = (await evaluate("__sdfGame.pipelineLog().totalPipelines")) - pipes0;
  if (warmOnly) { closeSession(); return out; }
  if (!b.valid || b.hiddenSteps) die(`${spec}: an invalid bench run (hidden steps ${b.hiddenSteps})`);
  out.bench = { segments: b.segments, passes: b.passes };
  out.loadBench = load1();
  out.cal = Math.max(cal0, await calibrate());
  out.disturbed = out.loadBench > LOAD_BAD || out.cal > calBest * CAL_BAD;
  if (out.disturbed && !lastTry) { closeSession(); return out; }
  out.counters = {
    drawsByLabel: await evaluate("__sdfGame.drawsByLabel(6)"),
    liveFrame: await evaluate(`(() => { __sdfGame.drawStats(true); __sdfGame.step(1, ${sc.closeup ? 0 : "1 / 60"}); return __sdfGame.drawStats(true); })()`),
    bodies: await evaluate("__sdfGame.bodiesOnScreen()"),
    census: await evaluate("__sdfGame.sceneCensus()"),
    wounds: await evaluate("__sdfGame.actorList().map((a) => (__sdfGame.actorWounds(a.id) || []).length).reduce((x, y) => x + y, 0)"),
  };
  if (process.env.ABLATE !== "0") out.ablate = await ablate();
  out.load1 = load1();
  out.errors = S.console.slice(0, 8);
  out.gpu = await evaluate("__sdfGame.gpuDiagnostics()");
  closeSession();
  return out;
}

/** Labels grouped into the stages the notes report. Anything unmatched is listed by its own label. */
const STAGES = [
  ["march (bodies)", /^sdf:(march|march-chunks|march-far|cone|depth-pre|occluder|accum|detail|prev-blit|last-blit)$/],
  ["outer shell hull", /^sdf:shell-hull$/],
  ["level polygons, bones, shadows", /^sdf:polys$/],
  ["upscale", /^sdf:upscale/],
  ["composite + late fx", /^sdf:(composite|late-fx)$/],
  ["goo, blood, gib blur", /^(goo|gib|shutter):/],
  ["post (fxaa, vhs, blit)", /^post:/],
  ["compute (tile bin, probes)", /^compute:/],
  ["GPU idle (waiting on CPU)", /^gpu:idle$/],
];
function summarise(run) {
  const lines = [];
  for (const seg of run.bench.segments) {
    const ps = run.bench.passes.segments.find((s) => s.name === seg.name);
    const lab = ps ? ps.labels : {};
    const mean = (k) => lab[k]?.mean ?? 0;
    const perFrame = (k) => (lab[k] ? lab[k].mean * lab[k].n / ps.frames : 0);
    const staged = STAGES.map(([nm, re]) => [nm, Object.keys(lab).filter((k) => re.test(k)).reduce((a, k) => a + perFrame(k), 0)]);
    const other = Object.keys(lab).filter((k) => !k.startsWith("cpu:") && !STAGES.some(([, re]) => re.test(k))).map((k) => [k, perFrame(k)]).filter(([, v]) => v > 0.05);
    const c = seg.census?.last;
    lines.push(`  ${seg.name.padEnd(8)} frame p50 ${f2(seg.p50)} p95 ${f2(seg.p95)} max ${f2(seg.max)} | GPU span ${f2(ps?.span?.mean)} | CPU tick ${f2(mean("cpu:tick"))} draw ${f2(mean("cpu:draw"))} | bodies ${c?.bodies} wounds ${c?.wounds} chunks ${c?.chunks} droplets ${c?.droplets}`);
    lines.push(`           ${staged.filter(([, v]) => v > 0.02).map(([nm, v]) => `${nm} ${f2(v)}`).join(" · ")}${other.length ? ` · other: ${other.map(([k, v]) => `${k} ${f2(v)}`).join(", ")}` : ""}`);
  }
  const d = run.counters;
  if (run.entry) lines.push(`  entering the room (warm shader cache): ${run.entry.pipelines} pipelines built, first frames ${run.entry.first.join(", ")} ms, worst ${run.entry.worst}, then ${run.entry.settled}`);
  if (run.pipelinesInFight) lines.push(`  NOTE: ${run.pipelinesInFight} pipelines were created inside the fight (compile time is in its frames)`);
  lines.push(`  draws/frame ${d.liveFrame.drawCalls}, triangles ${d.liveFrame.triangles}; polys pass ${d.drawsByLabel["sdf:polys"]}, late fx ${d.drawsByLabel["sdf:late-fx"] ?? 0}; bodies in frustum ${d.bodies}; wounds ${d.wounds}`);
  if (run.ablate) for (const r of run.ablate.rows) lines.push(r.error ? `  ablate ${r.name}: ${r.error}` : `  ablate ${r.name.padEnd(42)} ${r.delta >= 0 ? "+" : ""}${f2(r.delta)} ms (IQR ${f2(r.q1)} to ${f2(r.q3)}; base ${f2(r.base)} [${f2(r.baseMin)}..${f2(r.baseMax)}], load ${r.load[1].toFixed(1)}${r.noisy ? " NOISY" : ""})`);
  return lines.join("\n");
}

mkdirSync(OUT, { recursive: true });
await strays();
const all = [];
// THE WARM BOOT: every scene once, the fight only, thrown away, so that the browser's shader cache holds the fight's
// pipelines whatever ran on this profile before. A measured boot still BUILDS them (three does, per page load): the
// room's at the entry step, the rest inside the fight, counted on the NOTE line. WARM=0 skips it.
if (process.env.WARM !== "0") for (const spec of SCENE_NAMES) {
  try { const w = await runScene(spec, -1, true, true); console.log(`warm boot ${spec}: ${w.pipelinesInFight} pipelines created in the fight (discarded)`); }
  catch (e) { console.log(`warm boot ${spec} FAILED: ${String(e).slice(0, 300)}`); closeSession(); }
}
for (let rep = 0; rep < REPEATS; rep++) {
  // Rotated, so no scene always follows the same one.
  const order = SCENE_NAMES.map((_, i) => SCENE_NAMES[(i + rep) % SCENE_NAMES.length]);
  for (const spec of order) {
    console.log(`\n=== ${spec} (repeat ${rep + 1}/${REPEATS}), load ${load1().toFixed(2)}`);
    let run;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try { run = await runScene(spec, rep, attempt === RETRIES); } catch (e) { console.log(`  FAILED: ${String(e).slice(0, 400)}`); closeSession(); run = null; break; }
      if (!run.disturbed) break;
      console.log(`  disturbed (load ${run.loadBench.toFixed(1)}, speed loop ${run.cal.toFixed(1)} ms against the best ${calBest.toFixed(1)}): ${attempt < RETRIES ? "taken again" : "kept, marked noisy"}`);
      if (attempt < RETRIES) await sleep(20000);
    }
    if (!run) continue;
    all.push(run);
    writeFileSync(`${OUT}/${spec.replace(/[^a-z0-9-]/gi, "_")}-${rep}.json`, JSON.stringify(run));
    console.log(summarise(run));
    console.log(`  speed loop ${run.cal.toFixed(1)} ms (best ${calBest.toFixed(1)})${run.disturbed ? " DISTURBED" : ""}; load ${run.load0.toFixed(2)} -> ${(run.load1 ?? run.loadBench).toFixed(2)}; boot ${run.boot.bootMs} ms; errors ${run.errors.length}${run.errors.length ? `: ${run.errors[0]}` : ""}`);
  }
}
writeFileSync(`${OUT}/all.json`, JSON.stringify(all));
console.log(`\nwrote ${all.length} runs to ${OUT}`);
process.exit(0);
