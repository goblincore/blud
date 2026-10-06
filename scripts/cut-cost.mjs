// scripts/cut-cost.mjs — the cut wound's frame cost, by variant (cut-cost investigation, 2026-10-06;
// docs/dev-notes/2026-10-06-cut-cost/NOTES.md).
//
// The axe gate's cost scenario (scripts/axe-gate.mjs, C: three torso chops H, R, L on one fresh ring zombie, the eye
// 0.9 m from the torso), booted once per VARIANT and repeated for ROUNDS rounds in one session, so every variant is
// measured interleaved with the others under the same machine load. A variant is a `;`-separated list of page query
// strings (the first is conventionally empty: the tree as it is), e.g. the ablation switches of the investigation
// (`cutab=nopinch`), or any seam the page reads at boot.
//
// Per boot it reports, before and after the chops:
//   - timeDraws(120) x REPS (median ms of 120 fenced still frames each): the gate's number, wall clock, load-sensitive;
//   - the march's COST CENSUS (debug modes 13 and 14, counters summed over the float march target): prims folded,
//     wound rows folded and march steps, for the walk alone and for the whole pixel (walk + normals + probes +
//     shadows). Counters do not depend on the machine's load.
//   - after the chops, with a runtime knob flipped (TOGGLES): the per-ray wound list on, the d-aware reach flipped.
// SAVE=<dir> also writes each variant's lit float march target (round 0) as <dir>/<label>.f32 (w, h in the JSON
// line) for texel A/B.
//
// Usage (bash, not zsh; its own servers, never 5273):
//   export LAB_VITE_PORT=5247 LAB_CDP_PORT=9247 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   VARIANTS=';cutab=nopinch' ROUNDS=2 node scripts/cut-cost.mjs 5247 9247
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
const VITE = Number(process.argv[2] ?? 5247);
const CDP = Number(process.argv[3] ?? 9247);
const VARIANTS = (process.env.VARIANTS ?? "").split(";");
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const REPS = Number(process.env.REPS ?? 3);
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const SAVE = process.env.SAVE ?? "";
const CHOPS = (process.env.CHOPS ?? "H,R,L").split(",");
const TARGET = process.env.TARGET ?? "torso";
const DIST = Number(process.env.DIST ?? 0.9);
const TOGGLES = process.env.TOGGLES !== "0";
const EYE_H = 1.62;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const J = (v) => JSON.stringify(v);
const r2 = (x) => +x.toFixed(2);
if (SAVE) mkdirSync(SAVE, { recursive: true });

let S = null;
async function openSession() {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), errors: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") s.errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    if (m.method === "Runtime.exceptionThrown") s.errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  };
  s.send = (method, params = {}) => new Promise((resolve) => { const id = ++s.seq; s.pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
  return s;
}
function closeSession(s) {
  try { s.ws.close(); } catch {}
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${s.tab.id}`], { stdio: "ignore" }); } catch {}
}
process.on("exit", () => { if (S) closeSession(S); });
const send = (m, p) => S.send(m, p);
const evaluate = async (expression, ms = 120000) => {
  const r = await withTimeout(S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

let pool = [], bootWarm = null;
/** The axe gate's boot: the bare ring page, frozen, pinned like march-hash. */
async function boot(query, port = VITE) {
  await openSession();
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${S.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${port}/sdf-game.html?seed=1&frozen=1&vhs=off&loader=0${query ? "&" + query : ""}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") die("warm gate never reached ready");
  await evaluate("__sdfGame.setLoopRunning(false)");
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setBleed(false)");
  await evaluate("__sdfGame.setFreeAim(false)");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  pool = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][1];
  let wb = null;
  for (let i = 0; i < 1500; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" || wb.gib === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  if (wb?.gib !== "ready") die(`the background gib warm is ${J(wb)}`);
  // The crowd pipeline too (CROWD_WAIT=0 skips): while it compiles in the background the frame is not the settled one.
  if (process.env.CROWD_WAIT !== "0") {
    for (let i = 0; i < 1500; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.crowd === "ready" || wb.crowd === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  }
  bootWarm = wb;
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.setFieldStyle("off"); return 1; })()`);
  for (let i = 0; i < 90; i++) await stepOne();
  await evaluate("__sdfGame.installDebugProbe()");
}
async function centreOn(t, iters = 10) {
  for (let i = 0; i < iters; i++) {
    const n = await evaluate(`__sdfGame.flail.toScreen(${t[0]}, ${t[1]}, ${t[2]})`);
    if (!n || (Math.abs(n[0]) < 0.01 && Math.abs(n[1]) < 0.01)) break;
    const pp = await evaluate("__sdfGame.pose()");
    await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw + 0.45 * n[0]}, ${pp.pitch + 0.45 * n[1]}, ${pp.pos[1]})`);
    await stepOne();
  }
}
async function look(target, dist, from) {
  const l = Math.hypot(from[0], from[2]) || 1, fx = from[0] / l, fz = from[2] / l;
  const dy = EYE_H - target[1];
  const hz = Math.sqrt(Math.max(dist * dist - dy * dy, 0.09));
  await evaluate(`__sdfGame.placePlayer({ x: ${target[0] + fx * hz}, z: ${target[2] + fz * hz}, yaw: ${yawOf(-fx, -fz)}, pitch: ${Math.atan2(-dy, hz)} })`);
  await stepOne();
  await centreOn(target);
}
/** REPS x timeDraws(120). `gpu` collects, per rep, the median GPU ms of the march pass over those frames (the pass
 *  timestamps, gpu-pass-timing.ts): the march alone, without the CPU side or the other passes. */
const gpuLog = [];
const timeDraws = async () => {
  const a = [], g = [];
  for (let i = 0; i < REPS; i++) {
    await evaluate("__sdfGame.passTimings()");
    a.push(r2(await evaluate("__sdfGame.timeDraws(120)", 300000)));
    g.push(await evaluate(`__sdfGame.passTimings().then((p) => { const m = p.samples.filter((q) => q.label === "sdf:march").map((q) => q.ms).sort((x, y) => x - y); return m.length ? +m[m.length >> 1].toFixed(2) : null; })`));
  }
  gpuLog.push(g);
  return a;
};
/** The float march target, drawn under the sim lock (two reads: the second is the settled one). */
async function readTarget() {
  await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
  const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
  return { w: r.w, h: r.h, f: new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer) };
}
/** The cost census: mode 13 (the walk) and 14 (the whole pixel). r = prims folded, g = wound rows folded, b = steps
 *  (+1000 on a hit, +2000 more on a hit inside a near-wound zone; mode 14 marks every shaded pixel +1000). */
async function census() {
  const out = {};
  for (const [mode, key] of [[13, "walk"], [14, "all"]]) {
    await evaluate(`__sdfGame.setMarchDebugMode(${mode})`);
    const t = await readTarget();
    let prims = 0, rows = 0, steps = 0, px = 0, hits = 0, near = 0;
    for (let i = 0; i < t.w * t.h; i++) {
      let b = t.f[i * 4 + 2];
      // (The target's clear value is about 0.01 a channel: a marched texel has taken at least one step.)
      if (!(b >= 0.5)) continue;
      px++;
      if (b >= 3000) { near++; hits++; b -= 3000; } else if (b >= 1000) { hits++; b -= 1000; }
      prims += t.f[i * 4]; rows += t.f[i * 4 + 1]; steps += b;
    }
    out[key] = { px, hits, near, prims, rows, steps };
  }
  await evaluate("__sdfGame.setMarchDebugMode(0)");
  return out;
}
const fnv = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  // Alternate the order from round to round, so a drift in load does not always fall on the same variant.
  const order = VARIANTS.map((v, i) => i);
  if (round % 2) order.reverse();
  for (const vi of order) {
    // A variant is `query|stage`: the page query, then the staging (zi = which ring zombie, thaw = frames the ring is
    // thawed first with the player at pool[2]'s head as the gate's K has it, axe = 1 selects slot 7 as its S does, port =
    // another tree's vite, for a base build interleaved in the same session).
    const [query, stageRaw = ""] = VARIANTS[vi].split("|"), label = VARIANTS[vi].replace(/[^a-zA-Z0-9,=_.|-]/g, "_") || "base";
    const stage = Object.fromEntries(stageRaw.split(",").filter(Boolean).map((kv) => kv.split("=")));
    const t0 = Date.now();
    await boot(query, Number(stage.port ?? VITE));
    const bootMs = Date.now() - t0;
    const frontOf = async (id) => { const fr = await evaluate(`__sdfGame.head.frame(${id})`); const f = qRot(fr.quat, [0, 0, 1]); return [f[0], 0, f[2]]; };
    if (Number(stage.thaw ?? 0) > 0) {
      const k = pool[2];
      await look(await evaluate(`__sdfGame.actorLimbCenter(${k.id}, "head")`), 0.7, await frontOf(k.id));
      await evaluate("__sdfGame.freeze(false)"); await stepN(Number(stage.thaw)); await evaluate("__sdfGame.freeze(true)");
    }
    if (stage.axe === "1") { await evaluate(`__sdfGame.selectSlot("axe")`); await stepN(40); }
    const z = pool[Number(stage.zi ?? 0)];
    const t = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, "${TARGET}")`);
    await look(t, DIST, await frontOf(z.id));
    // sync = 1: one thawed step of NO sim time with the camera in place. After a thaw, a body that was outside the
    // player's view keeps the march view of its last drawn pose (frozen ticks do not refresh it), so its flesh is not
    // in the frame until something re-uploads it; a wound does, which is what the axe gate's C measured as the chops'
    // cost.
    if (stage.sync === "1") { await evaluate("__sdfGame.freeze(false)"); await evaluate("__sdfGame.step(1, 0)"); await evaluate("__sdfGame.freeze(true)"); await stepN(2); }
    const shot = async (name) => { if (!SAVE) return; await evaluate("__sdfGame.setRenderLock(true)"); await stepOne(); await stepOne(); const r = await send("Page.captureScreenshot", { format: "png" }); await evaluate("__sdfGame.setRenderLock(false)"); writeFileSync(`${SAVE}/${label}-${name}.png`, Buffer.from(r.result.data, "base64")); };
    if (round === 0) await shot("before");
    if (process.env.DEBUG) console.log(J({ actor: (await evaluate("__sdfGame.actorList()")).find((q) => q.id === z.id), pose: await evaluate("__sdfGame.pose()"), target: t, ndc: await evaluate(`__sdfGame.flail.toScreen(${t[0]}, ${t[1]}, ${t[2]})`), vis: await evaluate("__sdfGame.visibleBodies ? __sdfGame.visibleBodies() : null") }));
    const load0 = r2(loadavg()[0]);
    gpuLog.length = 0;
    const before = await timeDraws();
    const cBefore = await census();
    let n = 0;
    for (const s of CHOPS) n += await evaluate(`__sdfGame.axeChop(${z.id}, "${s}", "${TARGET}")`);
    await stepN(2);
    if (round === 0) await shot("after");
    const after = await timeDraws();
    if (process.env.SERIES) {
      // Frame-to-frame structure: the march pass's GPU ms over consecutive drawn frames, and the whole-pixel census
      // over consecutive single reads.
      await evaluate("__sdfGame.passTimings()");
      const fr = await evaluate(`(async () => { const out = []; for (let i = 0; i < 32; i++) { const t0 = performance.now(); await __sdfGame.timeDraws(1); out.push(+(performance.now() - t0).toFixed(1)); } return out; })()`);
      const ps = await evaluate(`__sdfGame.passTimings().then((p) => p.samples.filter((q) => q.label === "sdf:march").map((q) => +q.ms.toFixed(1)))`);
      console.log(`  series wall: ${J(fr)}`);
      console.log(`  series march gpu (${ps.length}): ${J(ps)}`);
      await evaluate("__sdfGame.setMarchDebugMode(14)");
      const cs = [];
      for (let i = 0; i < 9; i++) {
        const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
        const f = new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer);
        let prims = 0, rows = 0; for (let k = 0; k < r.w * r.h; k++) { if (f[k * 4 + 2] > 0) { prims += f[k * 4]; rows += f[k * 4 + 1]; } }
        cs.push([Math.round(prims), Math.round(rows)]);
      }
      await evaluate("__sdfGame.setMarchDebugMode(0)");
      console.log(`  series census all [prims, rows]: ${J(cs)}`);
    }
    const cAfter = await census();
    // Inside-flesh (organ / packed bone) prim evaluations after the chops: debug mode 5 (r = evaluations, b = 1 on a marched texel).
    await evaluate("__sdfGame.setMarchDebugMode(5)");
    const bt = await readTarget();
    let boneEvals = 0, bonePx = 0; for (let i = 0; i < bt.w * bt.h; i++) { if (bt.f[i * 4 + 2] > 0.5 && bt.f[i * 4 + 2] < 1.5) { boneEvals += bt.f[i * 4]; if (bt.f[i * 4] > 0) bonePx++; } }
    await evaluate("__sdfGame.setMarchDebugMode(0)");
    const cuts = (await evaluate(`__sdfGame.actorWounds(${z.id})`)).filter((w) => w.shape === "cut").length;
    const threats = (await evaluate("__sdfGame.woundThreats()")).find((q) => q.id === z.id) ?? null;
    const row = { round, label, zombie: z.id, threats, warm: [bootWarm, await evaluate("__sdfGame.warmBackground()")], load: [load0, r2(loadavg()[0])], bootMs, chops: n, cuts, before, after, gpuBefore: gpuLog[0], gpuAfter: gpuLog[1], cBefore, cAfter, insideFlesh: { evals: Math.round(boneEvals), texels: bonePx } };
    if (TOGGLES) {
      // The per-ray wound list (counts2.w, a seam that ships off).
      await evaluate("__sdfGame.setWoundList(true)");
      row.list = await timeDraws();
      row.cList = await census();
      await evaluate("__sdfGame.setWoundList(false)");
      // The d-aware reach (counts2.z + 8), as the page booted it, flipped.
      const exact = await evaluate("__sdfGame.woundExact");
      await evaluate(`__sdfGame.setWoundExact(${!exact})`);
      row.exactWas = exact;
      row.exactFlip = await timeDraws();
      row.cExactFlip = await census();
      await evaluate(`__sdfGame.setWoundExact(${exact})`);
      row.after2 = await timeDraws();
    }
    if (process.env.DIAG) {
      const show = async (what) => { const c = await census(); console.log(`  diag ${what}: woundStep ${await evaluate("__sdfGame.woundStep")} walk steps ${Math.round(c.walk.steps)} rows ${Math.round(c.walk.rows)} near ${c.all.near}`); };
      await show("as booted");
      for (const js of process.env.DIAG.split(";")) { await evaluate(js); await show(js); }
    }
    if (process.env.SEL && /cutab=[^&]*\bsel\b/.test(query)) {
      // IN-PAGE ALTERNATION (the `cutab=sel` ablation build: one shader, a selector riding perfCfg.x as 1 + 2 sel). Each
      // block is K fenced frames; baseline and variant blocks alternate (base, v, base, v', base, ...), and a variant
      // is scored against the mean of the baseline blocks either side of it, so a drift in machine load cancels.
      // A selector may also be a named runtime seam (on / off JS).
      const SEAMS = {
        refoldOff: ["__sdfGame.setOwnerRefold(false)", "__sdfGame.setOwnerRefold(true)"],
        // The game ships the near-wound step multiplier at 1.0 (game-main.ts GAME_WOUND_STEP); 0.6 is the compiled constant.
        step06: ["__sdfGame.setWoundStep(0.6)", "__sdfGame.setWoundStep(1)"],
        list: ["__sdfGame.setWoundList(true)", "__sdfGame.setWoundList(false)"],
        exact: ["__sdfGame.setWoundExact(true)", "__sdfGame.setWoundExact(false)"],
      };
      const K = Number(process.env.SEL_K ?? 24), RN = Number(process.env.SEL_ROUNDS ?? 8);
      const sels = process.env.SEL.split(",");
      const block = async (sel) => {
        const on = sel === "0" ? "0" : SEAMS[sel] ? SEAMS[sel][0] : `__sdfGame.setUniformAll("perfCfg", 0, ${1 + 2 * Number(sel)})`;
        const off = SEAMS[sel] ? SEAMS[sel][1] : `__sdfGame.setUniformAll("perfCfg", 0, 1)`;
        return evaluate(`(async () => { ${on}; await __sdfGame.timeDraws(3); await __sdfGame.passTimings(); const ms = await __sdfGame.timeDraws(${K}); const p = await __sdfGame.passTimings(); const m = p.samples.filter((q) => q.label === "sdf:march").map((q) => q.ms).sort((x, y) => x - y); ${off}; return [ms, m.length ? m[m.length >> 1] : null]; })()`, 300000);
      };
      const diffs = Object.fromEntries(sels.map((q) => [q, { wall: [], gpu: [] }])), bases = { wall: [], gpu: [] };
      for (let r = 0; r < RN; r++) {
        const order = [...sels]; if (r % 2) order.reverse();
        let prev = await block("0");
        for (const q of order) {
          const v = await block(q), next = await block("0");
          diffs[q].wall.push(v[0] - (prev[0] + next[0]) / 2); diffs[q].gpu.push(v[1] - (prev[1] + next[1]) / 2);
          bases.wall.push(prev[0]); bases.gpu.push(prev[1]);
          prev = next;
        }
      }
      const med = (a) => { const q = [...a].sort((x, y) => x - y); return q.length % 2 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2; };
      const iqr = (a) => { const q = [...a].sort((x, y) => x - y); return [q[Math.floor(q.length * 0.25)], q[Math.floor(q.length * 0.75)]]; };
      row.sel = { K, rounds: RN, baseWall: r2(med(bases.wall)), baseGpu: r2(med(bases.gpu)), baseWallRange: [r2(Math.min(...bases.wall)), r2(Math.max(...bases.wall))] };
      console.log(`  sel: baseline wall ${row.sel.baseWall} ms (${row.sel.baseWallRange}), march gpu ${row.sel.baseGpu} ms; ${RN} rounds x ${K} frames; load ${r2(loadavg()[0])}`);
      for (const q of sels) {
        row.sel[q] = { wall: r2(med(diffs[q].wall)), wallIqr: iqr(diffs[q].wall).map(r2), gpu: r2(med(diffs[q].gpu)), gpuIqr: iqr(diffs[q].gpu).map(r2) };
        console.log(`  sel ${q}: wall ${row.sel[q].wall} ms (IQR ${row.sel[q].wallIqr}), march gpu ${row.sel[q].gpu} ms (IQR ${row.sel[q].gpuIqr})`);
      }
      // The census under each numeric selector (counters do not depend on load).
      for (const q of sels) {
        if (SEAMS[q]) await evaluate(SEAMS[q][0]); else await evaluate(`__sdfGame.setUniformAll("perfCfg", 0, ${1 + 2 * Number(q)})`);
        const c = await census();
        row.sel[q].census = c;
        // Inside-flesh (organ / bone) prim evaluations, debug mode 5 (r = evaluations, b = 1 on a marched texel).
        await evaluate("__sdfGame.setMarchDebugMode(5)");
        const bt = await readTarget();
        let bones = 0, paying = 0; for (let i = 0; i < bt.w * bt.h; i++) { if (bt.f[i * 4 + 2] > 0.5 && bt.f[i * 4 + 2] < 1.5) { bones += bt.f[i * 4]; if (bt.f[i * 4] > 0) paying++; } }
        await evaluate("__sdfGame.setMarchDebugMode(0)");
        row.sel[q].bones = { evals: Math.round(bones), payingPx: paying };
        console.log(`  sel ${q} inside-flesh evals: ${Math.round(bones)} over ${paying} texels`);
        if (SEAMS[q]) await evaluate(SEAMS[q][1]); else await evaluate(`__sdfGame.setUniformAll("perfCfg", 0, 1)`);
        console.log(`  sel ${q} census: walk steps ${Math.round(c.walk.steps)} rows ${Math.round(c.walk.rows)} prims ${Math.round(c.walk.prims)} | all steps ${Math.round(c.all.steps)} rows ${Math.round(c.all.rows)} prims ${Math.round(c.all.prims)} near ${c.all.near}`);
      }
    }
    const lit = await readTarget();
    row.hash = fnv(lit.f); row.w = lit.w; row.h = lit.h;
    if (SAVE && round === 0) writeFileSync(`${SAVE}/${label}.f32`, Buffer.from(lit.f.buffer));
    row.errors = S.errors.length;
    if (S.errors.length) console.error(`  console errors [${label}]: ${J(S.errors.slice(0, 3))}`);
    rows.push(row);
    console.log(J(row));
    closeSession(S); S = null;
  }
}
// Summary: per variant, the median over rounds of each boot's median.
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log("\nvariant | before ms | after ms | delta | spread(after) | walk steps | walk rows | all prims | all rows | near px | hash");
for (const query of VARIANTS) {
  const label = query.replace(/[^a-zA-Z0-9,=_.|-]/g, "_") || "base";
  const rs = rows.filter((r) => r.label === label);
  const b = med(rs.map((r) => med(r.before))), a = med(rs.map((r) => med(r.after)));
  const all = rs.flatMap((r) => r.after);
  const c = rs[0].cAfter;
  console.log(`${label} | ${b.toFixed(1)} | ${a.toFixed(1)} | ${(a - b).toFixed(1)} | ${Math.min(...all).toFixed(1)}..${Math.max(...all).toFixed(1)} | ${c.walk.steps} | ${c.walk.rows} | ${c.all.prims} | ${c.all.rows} | ${c.all.near} | ${rs[0].hash}`);
}
process.exit(0);
