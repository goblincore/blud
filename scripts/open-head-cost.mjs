// scripts/open-head-cost.mjs — where an OPEN split head's frame time goes (docs/dev-notes/2026-10-06-open-head-cost).
// The head-split gate's boot (bare ring page, frozen zombies, its pins), one fresh zombie per scenario, the head
// centred at each distance, and the ablation legs of src/lab/sdf-zombie/webgpu/split-ablate.ts INTERLEAVED: every
// round measures every leg once, in a rotated order, so a drift of the machine lands on all of them.
// The measure is __sdfGame.timeDraws(N): the median ms of N still frames, each drawn then fenced (CPU + GPU).
// Every leg but `closed` and `open` draws a WRONG frame on purpose: cost only.
//
// THE MACHINE'S LOAD. The 1-minute load average is read before and after every measure. A measure waits (up to
// QUIET_WAIT s) for the load to fall to LOAD_GO (6) before it starts, and one that ends above LOAD_MAX (8) is taken
// again, up to RETRIES times; what is still above it is kept in the log, marked, and LEFT OUT of the table. `busy` is
// the share of all cores' time that was not idle during the measure (this page's own draw loop is about one core).
//
// Usage (bash, not zsh; never port 5273):
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   FLAGS='&splitablate' node scripts/open-head-cost.mjs 5241 9241
// Env:
//   FLAGS   extra URL flags. '&splitablate' compiles the runtime switches in (the mask legs need it); '' is the
//           shipped shader (the mask legs are then skipped); '&splitfilm=0' is the build without the wet film.
//   LEGS    comma list (default: every leg the page can run).
//   SCEN    comma list of mid-both, mid-one, face (default mid-both,mid-one).
//   DIST    comma list of metres (default 0.6,2).
//   ROUNDS  rounds per scenario and distance (default 4).   N  draws per measure (default 120).
//   CENSUS=0  skip the census. By default every leg is also COUNTED once per scenario and distance: the march's raw
//           counters (debug modes 13 and 14, read off the float march target) summed over the frame: texels
//           marched, hit, steps, prim evaluations, wound rows; mode 14 adds the post-hit chain's (the normal's
//           taps, the probes). Counters do not depend on the machine's load.
//   BASE_BOUNDS  SPLIT_BOUND bits OR-ed into every leg's bounds switches (48 = the tree before 2026-10-06's two
//           bounds changes, for an attribution of the cost as it stood).
//   PARITY  comma list of leg pairs a:b (e.g. open:tileCullOld). Each pair's frames are read off the float march
//           target and compared texel by texel: for a switch that must change the work and not the picture.
//   TICK=1  also time the CPU side of a split head's re-pose and of the hull build, open against closed.
//   OUT     a JSON file for the raw numbers.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const FLAGS = process.env.FLAGS ?? "&splitablate";
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const N = Number(process.env.N ?? 120);
const DIST = (process.env.DIST ?? "0.6,2").split(",").map(Number);
const SCEN_ALL = { "mid-both": ["middle", 0, 0], "mid-one": ["middle", 1, 0.04], "face": ["face", 1, 0] };
const SCENS = (process.env.SCEN ?? "mid-both,mid-one").split(",");
const LOAD_MAX = Number(process.env.LOAD_MAX ?? 8);
const LOAD_GO = Number(process.env.LOAD_GO ?? 6);
const QUIET_WAIT = Number(process.env.QUIET_WAIT ?? 600);
const RETRIES = Number(process.env.RETRIES ?? 3);
const W = 1280, H = 800, EYE_H = 1.62, BOOT_SETTLE = 90, SETTLE = 24;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`open-head-cost: ${msg}`); process.exit(2); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const load = () => os.loadavg()[0];
const cpuTimes = () => { let idle = 0, all = 0; for (const c of os.cpus()) { idle += c.times.idle; for (const v of Object.values(c.times)) all += v; } return { idle, all }; };
/** Wait for a quiet machine (the load at or under LOAD_GO), at most QUIET_WAIT seconds. */
async function quiet() { const t0 = Date.now(); while (load() > LOAD_GO && Date.now() - t0 < QUIET_WAIT * 1000) await sleep(5000); }

// ---- A CDP session (the gate's) ---------------------------------------------------------
let S = null;
const consoleEvents = [];
async function openSession() {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map() };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error")) consoleEvents.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    if (m.method === "Runtime.exceptionThrown") consoleEvents.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  };
  s.send = (method, params = {}) => new Promise((resolve) => { const id = ++s.seq; s.pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
}
function closeSession() {
  if (!S) return;
  try { S.ws.close(); } catch {}
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${S.tab.id}`], { stdio: "ignore" }); } catch {}
  S = null;
}
process.on("exit", closeSession);
const send = (m, p) => S.send(m, p);
const evaluate = async (expression, ms = 90000) => {
  const r = await withTimeout(S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// ---- The gate's boot: the bare ring page, frozen zombies, its pins -------------------------
let centre = [0, 0, 0], pool = [], used = new Set();
async function boot() {
  await openSession();
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${S.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const t0 = Date.now();
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&vhs=off&loader=0${FLAGS}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") die("warm gate never reached ready");
  const warmS = (Date.now() - t0) / 1000;
  await evaluate("__sdfGame.setLoopRunning(false)");
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setBleed(false)");
  await evaluate("__sdfGame.setFreeAim(false)");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (["gib", "crowd"].every((k) => wb[k] === "ready") || ["gib", "crowd"].some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  if (!["gib", "crowd"].every((k) => wb?.[k] === "ready")) die(`the background warm is ${JSON.stringify(wb)}`);
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.setFieldStyle("off"); return 1; })()`);
  for (let i = 0; i < BOOT_SETTLE; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.installDebugProbe()");
  // A shader that did not compile draws nothing, and every number after it would be of an empty frame.
  const d0 = await evaluate("__sdfGame.gpuDiagnostics()");
  if (d0.lost || d0.uncapturedCount !== 0) die(`the page has GPU errors after the boot: ${JSON.stringify(d0).slice(0, 600)}`);
  console.log(`ready: flags '${FLAGS}', warm ${warmS.toFixed(1)} s, room ${ROOM} (${pool.length} zombies), load ${load().toFixed(1)}`);
  return warmS;
}
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
const fresh = () => { const z = pool.find((q) => !used.has(q.id)); if (!z) die("ran out of fresh zombies"); used.add(z.id); return z; };
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const frontOf = async (id) => { const fr = await evaluate(`__sdfGame.head.frame(${id})`); const f = qRot(fr.quat, [0, 0, 1]); const l = Math.hypot(f[0], f[2]) || 1; return [f[0] / l, 0, f[2] / l]; };
const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "head")`);
async function centreOn(t, iters = 10) {
  for (let i = 0; i < iters; i++) {
    const n = await evaluate(`__sdfGame.flail.toScreen(${t[0]}, ${t[1]}, ${t[2]})`);
    if (!n || (Math.abs(n[0]) < 0.01 && Math.abs(n[1]) < 0.01)) break;
    const pp = await evaluate("__sdfGame.pose()");
    await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw + 0.45 * n[0]}, ${pp.pitch + 0.45 * n[1]}, ${pp.pos[1]})`);
    await stepOne();
  }
}
/** The gate's stance: the eye `dist` m from `target` along `from`, looking at it. */
async function look(target, dist, from) {
  const l = Math.hypot(from[0], from[2]) || 1, fx = from[0] / l, fz = from[2] / l;
  const dy = EYE_H - target[1], hz = Math.sqrt(Math.max(dist * dist - dy * dy, 0.09));
  await evaluate(`__sdfGame.placePlayer({ x: ${target[0] + fx * hz}, z: ${target[2] + fz * hz}, yaw: ${yawOf(-fx, -fz)}, pitch: ${Math.atan2(-dy, hz)} })`);
  await stepOne();
  await centreOn(target);
  return evaluate("__sdfGame.pose()");
}
const setCam = (pp) => evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw}, ${pp.pitch}, ${pp.pos[1]})`);
const force = async (id, [preset, sides, offset], frac) => { const ok = await evaluate(`__sdfGame.forceSplit(${id}, "${preset}", ${sides}, ${offset}, ${frac})`); if (!ok) die(`forceSplit(${id}, ${preset}, ${sides}, ${offset}, ${frac}) refused`); };
const BASE_BOUNDS = Number(process.env.BASE_BOUNDS ?? 0);
const ablate = (mask, boundsOff) => evaluate(`(() => { __sdfGame.splitAblate({ mask: ${mask}, boundsOff: ${boundsOff | BASE_BOUNDS} }); return 1; })()`);
const timeDraws = () => evaluate(`__sdfGame.timeDraws(${N})`, 600000);
/** THE CENSUS of the frame as it stands (debug-counters.wgsl.ts mode 13: the walk, returned before the miss discard;
 *  display-debug.wgsl.ts mode 14: the same counters after the post-hit chain, hit texels only). Summed in the page.
 *  Mode 13's texel is (prims, wound rows, steps + 1000 hit + 2000 near-wound hit); a texel no fragment wrote holds the
 *  clear colour (about 0.01 a channel), so a marched texel is one with at least one step. */
const census = () => evaluate(`(async () => {
  const sum = async (mode) => {
    __sdfGame.setMarchDebugMode(mode);
    await __sdfGameDebug.readMarchTarget();
    const r = await __sdfGameDebug.readMarchTarget();
    const f = new Float32Array(Uint8Array.from(atob(r.rgba32f), (c) => c.charCodeAt(0)).buffer);
    let prims = 0, rows = 0, steps = 0, hits = 0, marched = 0, hitPrims = 0, hitRows = 0;
    for (let i = 0; i < f.length; i += 4) {
      const b = f[i + 2];
      if (!(b >= 0.5)) continue;   // the target's clear value is a small non-zero colour: not a marched texel
      marched++; prims += f[i]; rows += f[i + 1];
      const st = b % 1000; steps += st; if (b >= 1000) { hits++; hitPrims += f[i]; hitRows += f[i + 1]; }
    }
    return { marched, hits, steps, prims, rows, hitPrims, hitRows };
  };
  const walk = await sum(13), all = await sum(14);
  __sdfGame.setMarchDebugMode(0);
  await __sdfGameDebug.readMarchTarget();
  return { walk, post: { hits: all.hits, prims: all.prims - walk.hitPrims, rows: all.rows - walk.hitRows } };
})()`, 300000);

// ---- The legs ------------------------------------------------------------------------------
// frac: the split's angle (0 = closed again: the head keeps its face cuts, so open - closed is the split alone).
// mask / boundsOff: split-ablate.ts SPLIT_ABL / SPLIT_BOUND. skull0: __sdfGame.skullSplit({ follow: 0 }).
const LEGS_ALL = {
  closed:       { frac: 0, what: "(a) closed again (it keeps its face cuts)" },
  open:         { frac: 1, what: "(b) open, as shipped" },
  oneEval:      { frac: 1, mask: 1, what: "(c) open, one field evaluation per sample" },
  closedField:  { frac: 1, mask: 8, what: "(c') open, mapBody folds the slot closed (no set-up, caps or shell)" },
  boundsOff:    { frac: 1, boundsOff: 15, what: "(d) open, every bound the closed head's" },
  tilesOff:     { frac: 1, boundsOff: 2, what: "(d') open, the tile groups and cluster row closed" },
  hullsOff:     { frac: 1, boundsOff: 12, what: "(d'') open, both hulls closed" },
  hullOutOff:   { frac: 1, boundsOff: 4, what: "(d3) open, the outer hull closed (no turned copies)" },
  hullInOff:    { frac: 1, boundsOff: 8, what: "(d4) open, the occluder hull closed (it keeps its spheres in turning flesh)" },
  tileCullOld:  { frac: 1, boundsOff: 16, what: "(d6) open, the grown tile groups culled per step with their grown spheres (before 2026-10-06)" },
  hullOld:      { frac: 1, boundsOff: 32, what: "(d7) open, the outer hull's first rule: every sphere kept, whole turned copies (before 2026-10-06)" },
  before:       { frac: 1, boundsOff: 48, what: "(b0) open, as before 2026-10-06: grown-sphere tile culls and the outer hull's first rule" },
  hullNoLip:    { frac: 1, boundsOff: 64, what: "(d8) open, the outer hull's tight copies without the face cut's lip in their pad" },
  boxOff:       { frac: 1, boundsOff: 1, what: "(d5) open, the proxy box closed" },
  analyticN:    { frac: 1, mask: 2, what: "(e) open, analytic normals in the region" },
  noFilm:       { frac: 1, mask: 4, what: "(f) open, the film's block skipped at run time" },
  skull0:       { frac: 1, skull0: true, what: "(g) open, skull follow 0 (the whole closed skull)" },
  noPost:       { frac: 1, mask: 16, what: "(h) open, post-hit split state off" },
  fieldOnly:    { frac: 1, mask: 2 | 4 | 16, boundsOff: 15, skull0: true, what: "(i) open, the field alone: closed bounds, analytic normals, no film, no post-hit, skull 0" },
  closedNoW:    { frac: 0, mask: 32, what: "(j) closed again, no wound folded into the field" },
  openNoW:      { frac: 1, mask: 32, what: "(k) open, no wound folded into the field" },
};

const out = { flags: FLAGS, n: N, rounds: ROUNDS, baseBounds: BASE_BOUNDS, scen: {} };
const warmS = await boot();
out.warmS = warmS;
const ab = await evaluate("__sdfGame.splitAblate()");
const legs = (process.env.LEGS ? process.env.LEGS.split(",") : Object.keys(LEGS_ALL)).filter((k) => {
  if (!LEGS_ALL[k]) die(`no leg '${k}'`);
  return ab.compiled || !LEGS_ALL[k].mask;
});
console.log(`ablation: compiled ${ab.compiled}, film off ${ab.filmOff}; legs ${legs.join(", ")}`);

async function setLeg(id, scen, leg) {
  await force(id, scen, leg.frac);
  await ablate(leg.mask ?? 0, leg.boundsOff ?? 0);
  await evaluate(`(() => { __sdfGame.skullSplit({ follow: ${leg.skull0 ? 0 : "null"} }); return 1; })()`);
  // A closed head holds no split state, so the seam's refresh passes it by: write its record (the mask's lane) here.
  await evaluate(`(() => { __sdfGame.zombie(${id}).view.syncRecord(); return 1; })()`);
  await stepN(3);
}

for (const sn of SCENS) {
  const scen = SCEN_ALL[sn] ?? die(`no scenario '${sn}'`);
  const z = fresh(), hc = await headOf(z.id), f = await frontOf(z.id);
  const res = (out.scen[sn] = {});
  for (const d of DIST) {
    const cam = await look(hc, d, f);
    await setCam(cam); await stepN(2);
    const untouched = d === DIST[0] && !(await evaluate(`__sdfGame.headSplit(${z.id})`)) ? await timeDraws() : null;
    const rows = Object.fromEntries(legs.map((k) => [k, []]));
    // A first, unmeasured pass over the legs: the first split frame of a session draws slow (spec 10.9).
    for (const k of legs) { await setLeg(z.id, scen, LEGS_ALL[k]); await evaluate("__sdfGame.timeDraws(8)"); }
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < legs.length; i++) {
        const k = legs[(i + r) % legs.length];
        await setLeg(z.id, scen, LEGS_ALL[k]);
        let m = null;
        for (let tries = 0; tries <= RETRIES; tries++) {
          await quiet();
          const l0 = load(), c0 = cpuTimes(), ms = await timeDraws(), l1 = load(), c1 = cpuTimes();
          m = { ms: +ms.toFixed(2), load: +Math.max(l0, l1).toFixed(1), busy: +(1 - (c1.idle - c0.idle) / Math.max(c1.all - c0.all, 1)).toFixed(2), tries };
          if (m.load <= LOAD_MAX) break;
        }
        rows[k].push(m);
      }
      console.log(`  ${sn} @${d} m round ${r + 1}/${ROUNDS}: ${legs.map((k) => `${k} ${rows[k][r].ms}${rows[k][r].load > LOAD_MAX ? "!" : ""}`).join("  ")}   (load ${load().toFixed(1)})`);
    }
    const counts = {};
    if (process.env.CENSUS !== "0") for (const k of legs) { await setLeg(z.id, scen, LEGS_ALL[k]); counts[k] = await census(); }
    const parity = {};
    for (const pair of (process.env.PARITY ?? "").split(",").filter(Boolean)) {
      const [a, b] = pair.split(":"), t = {};
      for (const k of [a, b]) {
        await setLeg(z.id, scen, LEGS_ALL[k] ?? die(`no leg '${k}'`)); await stepN(SETTLE);
        await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
        const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
        t[k] = new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer);
      }
      // A bound that moves where a ray STARTS moves its samples, so the two frames are not equal to the bit: what is
      // compared is the hit mask (texels one frame hits and the other does not), and on texels both hit how far the
      // clip depth moved (over 0.2%, the head-split gate's B measure) and the colour (over 0.05).
      let texels = 0, colour = 0, depth = 0, hitsA = 0, hitsB = 0, onlyA = 0, onlyB = 0, deep = 0, tint = 0; const miss = t[a][3];
      for (let i = 0; i < t[a].length; i += 4) {
        const c = Math.max(Math.abs(t[a][i] - t[b][i]), Math.abs(t[a][i + 1] - t[b][i + 1]), Math.abs(t[a][i + 2] - t[b][i + 2])), dz = Math.abs(t[a][i + 3] - t[b][i + 3]);
        const ha = t[a][i + 3] !== miss, hb = t[b][i + 3] !== miss;
        if (ha) hitsA++; if (hb) hitsB++;
        if (ha && !hb) onlyA++; if (hb && !ha) onlyB++;
        if (ha && hb) { if (dz > 0.002 * Math.abs(t[a][i + 3])) deep++; if (c > 0.05) tint++; }
        if (c > 0 || dz > 0) texels++; colour = Math.max(colour, c); depth = Math.max(depth, dz);
      }
      parity[pair] = { texels, colour, depth, hitsA, hitsB, onlyA, onlyB, deep, tint };
      console.log(`  parity ${sn} @${d} m, ${a} against ${b}: hit texels ${hitsA} / ${hitsB}, ${onlyA} only in ${a}, ${onlyB} only in ${b}; of those both hit, ${deep} moved over 0.2% in clip depth and ${tint} over 0.05 in colour; ${texels} differ at all (largest colour step ${colour.toExponential(2)}, clip depth ${depth.toExponential(2)})`);
    }
    await setLeg(z.id, scen, LEGS_ALL.closed);
    res[d] = { untouched, rows, counts, parity };
  }
}

// ---- TICK=1: the CPU side of a split head's re-pose, open against closed -----------------------------
// A walking split head's wobble moves its angles every tick, so its view re-makes the bounds and the record every
// tick. So does any walking body's: the pose changes every tick, split or not. What the split ADDS is measured here
// on one frozen zombie: the mean ms of STEPS calls of the actor's own re-pose (reposeHead: the pose, view.update with
// its bounds and tile groups, the record, the wounds), with the head open and with it closed again, interleaved; and
// the frozen cast's hull build (both hulls, every body: what live play runs every tick), timed as a step that is
// asked to build them against one that is not.
if (process.env.TICK === "1") {
  const STEPS = Number(process.env.STEPS ?? 400);
  const z = fresh(), scen = SCEN_ALL["mid-both"];
  const repose = () => evaluate(`(() => { const a = __sdfGame.zombie(${z.id}); const t0 = performance.now(); for (let i = 0; i < ${STEPS}; i++) a.reposeHead(); return (performance.now() - t0) / ${STEPS}; })()`, 600000);
  const hulls = () => evaluate(`(() => { const ms = [[], []]; for (let i = 0; i < 60; i++) for (const stale of [0, 1]) { if (stale) __sdfGame.splitAblate({}); const t0 = performance.now(); __sdfGame.step(1, 0); ms[stale].push(performance.now() - t0); } const med = (a) => a.sort((x, y) => x - y)[a.length >> 1]; return { kept: med(ms[0]), rebuilt: med(ms[1]) }; })()`, 600000);
  const rows = { open: [], closed: [] }, hull = { open: [], closed: [] };
  for (let r = 0; r < ROUNDS; r++) {
    for (const k of r % 2 ? ["closed", "open"] : ["open", "closed"]) {
      await force(z.id, scen, k === "open" ? 1 : 0); await stepN(3);
      await quiet();
      const l0 = load(), ms = await repose(), h = await hulls();
      rows[k].push({ ms, load: +Math.max(l0, load()).toFixed(1) });
      hull[k].push({ ...h, load: +Math.max(l0, load()).toFixed(1) });
    }
    console.log(`  re-pose round ${r + 1}/${ROUNDS}: open ${rows.open[r].ms.toFixed(4)} ms, closed ${rows.closed[r].ms.toFixed(4)} ms a call; a zero-time step with the hulls kept / rebuilt: open ${hull.open[r].kept.toFixed(3)} / ${hull.open[r].rebuilt.toFixed(3)}, closed ${hull.closed[r].kept.toFixed(3)} / ${hull.closed[r].rebuilt.toFixed(3)} ms  (load ${load().toFixed(1)})`);
  }
  out.tick = { steps: STEPS, rows, hull };
}

// ---- The table --------------------------------------------------------------------------------
const fmt = (v) => (v === null || Number.isNaN(v) ? "   -  " : v.toFixed(2).padStart(6));
console.log(`\n=== open-head cost, flags '${FLAGS}', timeDraws(${N}) median ms, ${ROUNDS} rounds interleaved; measures above load ${LOAD_MAX} left out ===`);
for (const [sn, res] of Object.entries(out.scen)) for (const [d, { untouched, rows, counts }] of Object.entries(res)) {
  const quiet = (k) => rows[k].filter((m) => m.load <= LOAD_MAX).map((m) => m.ms);
  const base = quiet("open"), closed = quiet("closed");
  console.log(`\n${sn} @ ${d} m${untouched !== null ? `   (untouched head, one measure: ${untouched.toFixed(2)})` : ""}`);
  console.log("  leg           median    min    max  spread   n  vs open  vs closed   loads");
  for (const k of legs) {
    const q = quiet(k);
    if (!q.length) { console.log(`  ${k.padEnd(12)}  (no measure under load ${LOAD_MAX}: ${rows[k].map((m) => `${m.ms}@${m.load}`).join(" ")})`); continue; }
    const md = median(q);
    console.log(`  ${k.padEnd(12)} ${fmt(md)} ${fmt(Math.min(...q))} ${fmt(Math.max(...q))} ${fmt(Math.max(...q) - Math.min(...q))}  ${String(q.length).padStart(2)}  ${fmt(base.length ? md - median(base) : NaN)}   ${fmt(closed.length ? md - median(closed) : NaN)}   ${rows[k].map((m) => m.load).join(" ")}`);
  }
}
console.log(`\n=== the census (load-independent): the frame's march counters per leg. walk = the ray walk (every marched texel); +post = what the post-hit chain adds on hit texels ===`);
for (const [sn, res] of Object.entries(out.scen)) for (const [d, { counts }] of Object.entries(res)) {
  if (!counts || !Object.keys(counts).length) continue;
  console.log(`\n${sn} @ ${d} m`);
  console.log("  leg           marched    hits    steps  steps/px   walk prims  walk rows   +post prims  +post rows");
  for (const k of legs) {
    const c = counts[k]; if (!c) continue;
    const n = (v, w) => String(Math.round(v)).padStart(w);
    console.log(`  ${k.padEnd(12)} ${n(c.walk.marched, 8)} ${n(c.walk.hits, 7)} ${n(c.walk.steps, 8)}  ${(c.walk.steps / Math.max(c.walk.marched, 1)).toFixed(2).padStart(8)} ${n(c.walk.prims, 12)} ${n(c.walk.rows, 10)} ${n(c.post.prims, 13)} ${n(c.post.rows, 11)}`);
  }
}
if (out.tick) {
  const q = (o, k, f) => out.tick[o][k].filter((m) => m.load <= LOAD_MAX).map((m) => m[f]);
  console.log(`\nre-pose (CPU, mean of ${out.tick.steps} calls, median of the rounds): open ${median(q("rows", "open", "ms")).toFixed(4)} ms, closed ${median(q("rows", "closed", "ms")).toFixed(4)} ms`);
  console.log(`a zero-time step, hulls kept / rebuilt (median ms): open ${median(q("hull", "open", "kept")).toFixed(3)} / ${median(q("hull", "open", "rebuilt")).toFixed(3)}, closed ${median(q("hull", "closed", "kept")).toFixed(3)} / ${median(q("hull", "closed", "rebuilt")).toFixed(3)}`);
}
const diag = await evaluate("__sdfGame.gpuDiagnostics()");
console.log(`\ngpuDiagnostics: ${JSON.stringify(diag)}; console errors ${consoleEvents.length}${consoleEvents.length ? ": " + JSON.stringify(consoleEvents.slice(0, 3)) : ""}`);
out.diag = diag; out.errors = consoleEvents; out.loadEnd = load();
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
closeSession();
process.exit(diag.lost || diag.uncapturedCount !== 0 || consoleEvents.length ? 1 : 0);
