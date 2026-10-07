// scripts/organs-mesh-gate.mjs — organs as mesh (2026-10-06): the capture gate.
// Spec: docs/superpowers/specs/2026-10-06-organs-mesh-design.md, section 5.3.
// Notes: docs/dev-notes/2026-10-06-organs-mesh/NOTES.md (numbers, and the breaking change each check was shown to fail under).
//
// The bare ring page, frozen and pinned as march-hash pins it. Three boots:
//   M  the default page (mesh skeleton, mesh organs). The organ mode is flipped IN PAGE (__sdfGame.setOrgans), so
//      'mesh' and 'sdf' are compared on the very same frame:
//        B  boot: the mode is 'mesh', every zombie packs 0 inside-flesh rows;
//        U  unwounded torso at 0.9 m: no organ instance; the float march target is bit-identical in both modes;
//        S  a slug crater in the belly: sdf folds inside-flesh rows (debug mode 5) and shows organ texels (the
//           positive control: the scene exposes organs); mesh folds none, draws the organ instances, and its organ
//           pixels (a shown / hidden pair) sit within tolerance of the sdf organ pixels (an organAmp 1 / 0 pair) in
//           area and mean colour;
//        C  three axe chops on another torso (the cut-cost scene): mesh folds no inside-flesh row where sdf does;
//        H  a head-only wound on a third zombie: no organ instance for it;
//        V  the organ MESH (organs, low-poly, 2026-10-07): the default is the swept tubes, a fraction of the vertices;
//           the 2026-10-06 extraction flipped in on the same frame has the same silhouette and, detail off, the same
//           shade (notes: docs/dev-notes/2026-10-07-organs-lowpoly/NOTES.md);
//        T  the belly crater with the torch off: the mesh organ sits as dark and red in its crater as the sdf organ.
//   Q  ?organs=sdf: the selector. The mode is 'sdf', zombies pack their 8 organ rows, a belly crater draws no organ mesh.
//   P  ?skeleton=procedural: the mode is 'sdf' whatever the query says, and bodies pack bones and organs.
//
// Usage (bash, not zsh; its own servers, never 5273; take /tmp/blud-gpu-timing.lock round the run):
//   export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   OUT=.lab-tmp/organs-mesh-gate node scripts/organs-mesh-gate.mjs 5251 9251
// ONLY=M,Q runs a subset of the boots. OUT defaults to .lab-tmp/organs-mesh-gate (never a tracked folder).
// ONLY=L writes the owner's look sheets instead (no checks): OUT=docs/dev-notes/2026-10-06-organs-mesh/look.
// ONLY=V writes the MESH sheets (organs, low-poly, 2026-10-07; no checks): the same frames, one column a mesh
// (MESH_COLS below), OUT=docs/dev-notes/2026-10-07-organs-lowpoly/look.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { decodePng } from "./lib/demo-presented.mjs";
import { writePng } from "./lib/png-write.mjs";
const VITE = Number(process.argv[2] ?? 5251);
const CDP = Number(process.argv[3] ?? 9251);
const OUT = process.env.OUT ?? ".lab-tmp/organs-mesh-gate";
const ONLY = (process.env.ONLY ?? "M,Q,P").split(",");
const W = 1280, H = 800, EYE_H = 1.62, DIST = 0.9;
// Tolerances of S: the mesh organ against the SDF organ, on screen.
const AREA_LO = 0.6, AREA_HI = 1.5;      // organ pixel count, mesh / sdf
// Distance of the mean organ colours, sRGB 0..1. Loose on purpose: the shipped look is the owner's pick, 'wet', whose
// base is darker than the SDF organ's under the torch (0.19 apart there, 0.05 with the torch off). The check has to
// catch the wrong MATERIAL: an unoccluded organ in a dark room is 0.36 apart.
const COLOUR_MAX = 0.25;
const ROI = { x0: 340, x1: 940, y0: 100, y1: 540 };   // the screen region the pixel checks read (about the wound)
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);

let checks = 0, failed = 0;
const check = (name, ok, detail = "") => { checks++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

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
}
function closeSession() {
  if (!S) return;
  try { S.ws.close(); } catch {}
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${S.tab.id}`], { stdio: "ignore" }); } catch {}
  S = null;
}
process.on("exit", closeSession);
const evaluate = async (expression, ms = 120000) => {
  const r = await withTimeout(S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

let pool = [];
/** The axe gate's boot: the bare ring page, frozen, pinned like march-hash. */
async function boot(query) {
  await openSession();
  await S.send("Page.enable"); await S.send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${S.tab.id}`);
  await S.send("Page.bringToFront");
  await S.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await S.send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&vhs=off&loader=0${query ? "&" + query : ""}` });
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
  if (pool.length < 3) die(`the ring has ${pool.length} zombies in its fullest room; the gate needs 3`);
  let wb = null;
  for (let i = 0; i < 1500; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if ((wb.gib === "ready" || wb.gib === "failed") && (wb.crowd === "ready" || wb.crowd === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.setFieldStyle("off"); return 1; })()`);
  await stepN(90);
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
/** Stand `dist` from `target` on the side `from` points to, looking at it. Returns the eye position. */
async function look(target, dist, from) {
  const l = Math.hypot(from[0], from[2]) || 1, fx = from[0] / l, fz = from[2] / l;
  const dy = EYE_H - target[1];
  const hz = Math.sqrt(Math.max(dist * dist - dy * dy, 0.09));
  await evaluate(`__sdfGame.placePlayer({ x: ${target[0] + fx * hz}, z: ${target[2] + fz * hz}, yaw: ${Math.atan2(-fx, fz)}, pitch: ${Math.atan2(-dy, hz)} })`);
  await stepOne();
  await centreOn(target);
  return (await evaluate("__sdfGame.pose()")).pos;
}
/** Where a level shot at `target` from `dist` in front starts (the muzzle of a gun held at the target's height). */
const levelEye = (target, dist, from) => {
  const l = Math.hypot(from[0], from[2]) || 1;
  return [target[0] + (from[0] / l) * dist, target[1], target[2] + (from[2] / l) * dist];
};
const frontOf = async (id) => { const fr = await evaluate(`__sdfGame.head.frame(${id})`); const f = qRot(fr.quat, [0, 0, 1]); return [f[0], 0, f[2]]; };
/** The float march target, drawn under the sim lock (two reads: the second is the settled one). */
async function readTarget() {
  await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
  const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
  return { w: r.w, h: r.h, f: new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer) };
}
const fnv = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
/** Inside-flesh prim evaluations of the frame: debug mode 5 (r = evaluations, b = 1 on a marched texel). */
async function insideFlesh() {
  await evaluate("__sdfGame.setMarchDebugMode(5)");
  const t = await readTarget();
  await evaluate("__sdfGame.setMarchDebugMode(0)");
  let evals = 0, texels = 0, marched = 0;
  for (let i = 0; i < t.w * t.h; i++) { const b = t.f[i * 4 + 2]; if (b > 0.5 && b < 1.5) { marched++; evals += t.f[i * 4]; if (t.f[i * 4] > 0) texels++; } }
  return { evals: Math.round(evals), texels, marched };
}
/** A screenshot as RGBA bytes (and, with a name, the PNG in OUT). */
async function shot(name) {
  await evaluate("__sdfGame.setRenderLock(true)");
  await stepOne(); await stepOne();
  const r = await S.send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const png = Buffer.from(r.result.data, "base64");
  if (name) writeFileSync(`${OUT}/${name}.png`, png);
  if (process.env.EYE) console.log(`  shot ${name ?? ""}: eye ${J(await evaluate("__sdfGame.pose()"))}`);
  const d = decodePng(png);
  if (d.ch === 4) return new Uint8Array(d.data);
  const out = new Uint8Array(d.w * d.h * 4);
  for (let i = 0, j = 0; i < d.data.length; i += 3, j += 4) { out[j] = d.data[i]; out[j + 1] = d.data[i + 1]; out[j + 2] = d.data[i + 2]; out[j + 3] = 255; }
  return out;
}
/** The pixels that differ between two screenshots (any channel by more than `thr` of 255): count, and the mean colour of
 *  those pixels in `a` (sRGB 0..1). */
function diffPixels(a, b, thr = 10) {
  let n = 0, r = 0, g = 0, bl = 0;
  // Inside ROI only: the HUD's frame-time readout changes from shot to shot, and the viewmodel sits below.
  for (let y = ROI.y0; y < ROI.y1; y++) for (let x = ROI.x0; x < ROI.x1; x++) {
    const i = (y * W + x) * 4;
    if (Math.abs(a[i] - b[i]) > thr || Math.abs(a[i + 1] - b[i + 1]) > thr || Math.abs(a[i + 2] - b[i + 2]) > thr) { n++; r += a[i]; g += a[i + 1]; bl += a[i + 2]; }
  }
  return { n, mean: n ? [r / n / 255, g / n / 255, bl / n / 255] : [0, 0, 0] };
}
/** THE COST OF SDF ORGANS ON THIS FRAME (COST=1; reported, not checked): blocks of K fenced still frames, the mesh
 *  default and 'sdf' alternating in page (mesh, sdf, mesh, sdf, ..., mesh), each sdf block scored against the mean of
 *  the mesh blocks either side, so a drift in machine load cancels (the cut-cost investigation's selector method).
 *  Wall ms a frame, and the march pass's GPU ms (gpu-pass-timing). Positive = SDF organs cost that much more. */
async function costOfSdf(label) {
  if (process.env.COST !== "1") return;
  const K = Number(process.env.COST_K ?? 24), RN = Number(process.env.COST_ROUNDS ?? 8);
  const block = (mode) => evaluate(`(async () => { __sdfGame.setOrgans("${mode}"); await __sdfGame.timeDraws(3); await __sdfGame.passTimings(); const ms = await __sdfGame.timeDraws(${K}); const p = await __sdfGame.passTimings(); const m = p.samples.filter((q) => q.label === "sdf:march").map((q) => q.ms).sort((x, y) => x - y); return [ms, m.length ? m[m.length >> 1] : null]; })()`, 300000);
  const wall = [], gpu = [], base = [], baseGpu = [];
  let prev = await block("mesh");
  for (let r = 0; r < RN; r++) {
    const v = await block("sdf"), next = await block("mesh");
    wall.push(v[0] - (prev[0] + next[0]) / 2); gpu.push(v[1] - (prev[1] + next[1]) / 2);
    base.push(prev[0]); baseGpu.push(prev[1]);
    prev = next;
  }
  const med = (a) => { const q = [...a].sort((x, y) => x - y); return q.length % 2 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2; };
  const iqr = (a) => { const q = [...a].sort((x, y) => x - y); return [q[Math.floor(q.length * 0.25)], q[Math.floor(q.length * 0.75)]].map((x) => +x.toFixed(2)); };
  // WHERE THE FRAME GOES, per mode: under the render lock a step is a pure re-render, so the step's own time is the
  // CPU side (pose, uploads, encoding the draws) and the wait on the fence after it is the GPU's whole frame. Both are
  // wall clock: a loaded machine inflates the CPU side most. (The pass timestamps do not split the GPU side here: on
  // this GPU every pass of a frame reads about the whole frame's time.)
  await evaluate("__sdfGame.setRenderLock(true)");
  for (const mode of ["mesh", "sdf"]) {
    const r = await evaluate(`(async () => { __sdfGame.setOrgans("${mode}"); await __sdfGame.timeDraws(4); const N = 60, cpu = [], gpu = []; for (let i = 0; i < N; i++) { const t0 = performance.now(); __sdfGame.step(1, 0); const t1 = performance.now(); await __sdfGame.resolveGpu(); cpu.push(t1 - t0); gpu.push(performance.now() - t1); } const m = (a) => a.sort((x, y) => x - y)[a.length >> 1]; return { cpu: m(cpu), wait: m(gpu) }; })()`, 300000);
    console.log(`  frame ${label} [${mode}]: CPU ${r.cpu.toFixed(2)} ms, then ${r.wait.toFixed(2)} ms waiting on the GPU`);
  }
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await evaluate("__sdfGame.setRenderLock(false)");
  console.log(`  cost ${label}: mesh baseline ${med(base).toFixed(2)} ms wall, march ${med(baseGpu).toFixed(2)} ms gpu; sdf organs cost +${med(wall).toFixed(2)} ms wall (IQR ${J(iqr(wall))}), +${med(gpu).toFixed(2)} ms march gpu (IQR ${J(iqr(gpu))}); ${RN} rounds x ${K} frames`);
  await stepN(4);
}
/** THE COST OF THE 2026-10-06 EXTRACTION AGAINST THE SWEPT TUBES ON THIS FRAME (COST=1; reported, not checked): the
 *  same load-cancelling alternation as costOfSdf, the organ MESH flipped in page (tubes, nets-5mm, tubes, ...), the
 *  detail left as shipped in both. Positive = the 4,038-vertex extraction costs that much more than the tubes. */
async function costOfMesh(label) {
  if (process.env.COST !== "1") return;
  const K = Number(process.env.COST_K ?? 24), RN = Number(process.env.COST_ROUNDS ?? 8);
  const block = (mesh) => evaluate(`(async () => { __sdfGame.setOrganMesh("${mesh}"); await __sdfGame.timeDraws(3); return await __sdfGame.timeDraws(${K}); })()`, 300000);
  const wall = [], base = [];
  let prev = await block("tubes");
  for (let r = 0; r < RN; r++) {
    const v = await block("nets-5mm"), next = await block("tubes");
    wall.push(v - (prev + next) / 2); base.push(prev);
    prev = next;
  }
  const med = (a) => { const q = [...a].sort((x, y) => x - y); return q.length % 2 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2; };
  const iqr = (a) => { const q = [...a].sort((x, y) => x - y); return [q[Math.floor(q.length * 0.25)], q[Math.floor(q.length * 0.75)]].map((x) => +x.toFixed(2)); };
  console.log(`  mesh cost ${label}: tubes baseline ${med(base).toFixed(2)} ms wall; nets-5mm costs ${med(wall) >= 0 ? "+" : ""}${med(wall).toFixed(2)} ms wall (IQR ${J(iqr(wall))}); ${RN} rounds x ${K} frames`);
  await stepN(4);
}
const rowsOf = async (id) => (await evaluate("__sdfGame.organs()")).packed.find((p) => p.id === id)?.rows;
const r3 = (v) => v.map((x) => +x.toFixed(3));

/** A level slug at `t` on zombie `id`, fired from `dist` in front of it: the crater faces forward, as a hit from a gun
 *  at the hip does, whatever height the eye is at. */
async function levelSlug(id, t, dist) {
  const eye = levelEye(t, dist, await frontOf(id));
  const d = [t[0] - eye[0], 0, t[2] - eye[2]], l = Math.hypot(...d);
  return evaluate(`__sdfGame.stampWoundAt(${eye[0]}, ${eye[1]}, ${eye[2]}, ${d[0] / l}, 0, ${d[2] / l}, "slug", ${id})`);
}
/** A slug crater in zombie `id`'s belly, at its largest organ segment (the gut coil on the pelvis frame), seen from the
 *  player's standing eye `dist` away (the feet are held on the floor: a belly wound is always seen from above). Returns
 *  the segment bound, with the first frames' times. */
async function bellySlug(id, dist = 0.7) {
  const segs = await evaluate(`__sdfGame.organSegments(${id})`);
  if (!segs.length) die(`zombie ${id} has no organ segment`);
  const seg = segs.sort((a, b) => b.radius - a.radius)[0];
  await look(seg.centre, dist, await frontOf(id));
  if (!(await levelSlug(id, seg.centre, dist))) die(`the slug missed zombie ${id}`);
  // The first frames with the wound: wall ms of the sim step and of a fenced draw, then a settled draw. On a fresh
  // boot the first one builds the pipelines the wound brings in (bone mesh; organ mesh in 'mesh' mode).
  seg.firstFrames = (await evaluate(`(async () => { const t = performance.now(); __sdfGame.step(1, 1 / 60); const a = performance.now() - t; const b = await __sdfGame.timeDraws(1); const c = await __sdfGame.timeDraws(1); const d = await __sdfGame.timeDraws(8); return [a, b, c, d]; })()`)).map((x) => +x.toFixed(1));
  await stepN(2);
  return seg;
}

async function bootM() {
  console.log("\n== M: the default page (mesh skeleton, mesh organs) ==");
  await boot("");
  const o0 = await evaluate("__sdfGame.organs()");
  console.log(`  mesh cache after boot: ${J(await evaluate("(() => { const m = __sdfGame.skeletonMesh(); return m ? { entries: m.cacheEntries, totals: m.cacheTotals, stats: m.cacheStats } : null; })()"))}`);
  check("B1 the organ mode is mesh by default", o0.mode === "mesh", `mode ${o0.mode}`);
  const zRows = pool.map((z) => o0.packed.find((p) => p.id === z.id)?.rows);
  check("B2 every zombie packs 0 inside-flesh rows (counts2.x)", zRows.every((r) => r === 0), `rows ${J(zRows)}`);

  // ——— U: unwounded ———
  const [zu, zc, zh] = pool;
  await look(await evaluate(`__sdfGame.actorLimbCenter(${zu.id}, "torso")`), DIST, await frontOf(zu.id));
  await stepN(2);
  const uMesh = await readTarget();
  const oU = await evaluate("__sdfGame.organs()");
  check("U1 an unwounded ring draws no organ instance", oU.drawn === 0, `drawn ${oU.drawn}`);
  await evaluate(`__sdfGame.setOrgans("sdf")`);
  await stepN(2);
  const uRows = await rowsOf(zu.id);
  check("U2 setOrgans('sdf') re-packs the organ rows on a frozen frame (the flip is real)", uRows === 8, `rows ${uRows}`);
  const uSdf = await readTarget();
  check("U3 the unwounded march target is bit-identical with organs sdf and mesh", fnv(uMesh.f) === fnv(uSdf.f), `mesh ${fnv(uMesh.f)} sdf ${fnv(uSdf.f)} (${uMesh.w}x${uMesh.h})`);
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await stepN(2);
  check("U4 setOrgans('mesh') drops them again", (await rowsOf(zu.id)) === 0, `rows ${await rowsOf(zu.id)}`);

  // ——— S: a slug crater in the belly ———
  // Shots first, counters after: a debug-mode read leaves its picture in the frame for a few steps.
  const seg = await bellySlug(zu.id);
  const sMesh = await evaluate("__sdfGame.organs()");
  const meshOwners = sMesh.drawnBy.filter((id) => id === zu.id).length;
  check("S1 mesh: the belly crater draws the wounded zombie's organ instances, and only its", meshOwners >= 1 && sMesh.drawnBy.every((id) => id === zu.id), `drawnBy ${J(sMesh.drawnBy)}`);
  // Organ pixels on screen, mesh: shown against hidden.
  const meshOn = await shot("S-mesh");
  await evaluate("__sdfGame.meshSkeletonShow({ organs: false })");
  const meshOff = await shot("S-mesh-organs-hidden");
  await evaluate("__sdfGame.meshSkeletonShow({ organs: true })");
  const pxMesh = diffPixels(meshOn, meshOff);
  const tMesh = await readTarget();
  const fMesh = await insideFlesh();
  await stepN(4);
  check("S2 mesh: the march folds no inside-flesh row (debug mode 5)", fMesh.evals === 0 && fMesh.marched > 1000, `evals ${fMesh.evals} over ${fMesh.texels} texels; ${fMesh.marched} marched`);
  // The same frame with SDF organs.
  await evaluate(`__sdfGame.setOrgans("sdf")`);
  await stepN(4);
  const sSdf = await evaluate("__sdfGame.organs()");
  check("S3 sdf: no organ mesh is drawn", sSdf.drawn === 0, `drawn ${sSdf.drawn}`);
  // Organ pixels on screen, sdf: organAmp 1 against 0 (the organ branch is mix(albedo, organColor, organAmp)).
  const sdfOn = await shot("S-sdf");
  await evaluate("__sdfGame.setWoundTuning({ organAmp: 0 })");
  await stepN(2);
  const sdfOff = await shot("S-sdf-organAmp0");
  await evaluate("__sdfGame.setWoundTuning({ organAmp: 1 })");
  await stepN(2);
  const pxSdf = diffPixels(sdfOn, sdfOff);
  const tSdf = await readTarget();
  const fSdf = await insideFlesh();
  await stepN(4);
  check("S4 sdf (positive control): the march folds inside-flesh rows in the crater", fSdf.evals > 10000, `evals ${fSdf.evals} over ${fSdf.texels} texels`);
  check("S5 the march target differs between the modes here (sdf organs are in the field, mesh organs are not)", fnv(tMesh.f) !== fnv(tSdf.f), `mesh ${fnv(tMesh.f)} sdf ${fnv(tSdf.f)}`);
  check("S6 sdf (positive control): organ pixels are on screen", pxSdf.n > 300, `${pxSdf.n} px, mean ${J(r3(pxSdf.mean))}`);
  check("S7 mesh: organ pixels are on screen", pxMesh.n > 300, `${pxMesh.n} px, mean ${J(r3(pxMesh.mean))}`);
  const ratio = pxMesh.n / Math.max(pxSdf.n, 1);
  check(`S8 the mesh organ area is within ${AREA_LO}..${AREA_HI} of the sdf organ area`, ratio >= AREA_LO && ratio <= AREA_HI, `ratio ${ratio.toFixed(2)}`);
  const cd = Math.hypot(pxMesh.mean[0] - pxSdf.mean[0], pxMesh.mean[1] - pxSdf.mean[1], pxMesh.mean[2] - pxSdf.mean[2]);
  check(`S9 the mesh organ's mean colour is within ${COLOUR_MAX} of the sdf organ's`, cd <= COLOUR_MAX, `distance ${cd.toFixed(3)}`);
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await stepN(4);
  // ——— V: the organ mesh itself (organs, low-poly, 2026-10-07) ———
  // The default is the swept tubes; the extraction of 2026-10-06 ('nets-5mm') is flipped in on the same frame, with
  // the surface detail off in both, so the two shown / hidden pairs differ by the SILHOUETTE alone.
  const plain = J({ detail: [0, 0, 0, sMesh.look.detail[3]] });
  const organPx = async () => { const on = await shot(); await evaluate("__sdfGame.meshSkeletonShow({ organs: false })"); const off = await shot(); await evaluate("__sdfGame.meshSkeletonShow({ organs: true })"); return diffPixels(on, off); };
  check("V1 the organ mesh is the swept tubes by default, a fraction of the 2026-10-06 extraction's 4,038 vertices", sMesh.mesh === "tubes" && sMesh.drawnVerts > 0 && sMesh.drawnVerts <= 600, `mesh ${sMesh.mesh}, drawn ${sMesh.drawnVerts} vertices / ${sMesh.drawnTris} triangles in ${sMesh.drawn} instance(s)`);
  await evaluate(`__sdfGame.setOrganLook(${plain})`); await stepN(3);
  const pxTubes = await organPx();
  await evaluate(`__sdfGame.setOrganMesh("nets-5mm")`); await stepN(3);
  const oNets = await evaluate("__sdfGame.organs()");
  const netsSegs = await evaluate(`__sdfGame.organSegments(${zu.id})`).then((a) => a.map((q) => ({ segment: q.segment, mesh: q.mesh })));
  const pxNets = await organPx();
  check("V2 setOrganMesh('nets-5mm') draws the extraction on the same frame (the flip is real)", oNets.mesh === "nets-5mm" && oNets.drawn === sMesh.drawn && oNets.drawnVerts > 4 * sMesh.drawnVerts, `mesh ${oNets.mesh}, drawn ${oNets.drawnVerts} vertices / ${oNets.drawnTris} triangles`);
  const vr = pxTubes.n / Math.max(pxNets.n, 1);
  check("V3 the tubes' silhouette is the extraction's: organ pixel area within 0.9..1.05 of it, detail off in both", vr >= 0.9 && vr <= 1.05, `tubes ${pxTubes.n} px, nets-5mm ${pxNets.n} px, ratio ${vr.toFixed(3)}`);
  const vc = Math.hypot(pxTubes.mean[0] - pxNets.mean[0], pxTubes.mean[1] - pxNets.mean[1], pxTubes.mean[2] - pxNets.mean[2]);
  // Measured 0.042: the tubes are a little brighter (their normals are the field's own, where the extraction's are
  // averaged over faces and smeared across each crease). What this has to catch is a mesh shaded WRONG: with its
  // normals turned inside out the tubes sit 0.163 from the extraction (NOTES, "Each new check was shown to fail").
  check("V4 with the detail off the tubes shade as the extraction does (mean colour within 0.08)", vc <= 0.08, `distance ${vc.toFixed(3)}; tubes ${J(r3(pxTubes.mean))}, nets-5mm ${J(r3(pxNets.mean))}`);
  await evaluate(`__sdfGame.setOrganMesh("tubes")`);
  await evaluate(`__sdfGame.setOrganLook(${J(sMesh.look)})`); await stepN(3);
  const oBack = await evaluate("__sdfGame.organs()");
  check("V5 and back: the tubes again, the shipped look", oBack.mesh === "tubes" && oBack.drawnVerts === sMesh.drawnVerts && J(oBack.look) === J(sMesh.look), `mesh ${oBack.mesh}, ${oBack.drawnVerts} vertices`);
  console.log(J({ scenario: "V", tubes: { segments: await evaluate(`__sdfGame.organSegments(${zu.id})`).then((a) => a.map((q) => ({ segment: q.segment, mesh: q.mesh }))), px: pxTubes.n, mean: r3(pxTubes.mean) }, nets5: { segments: netsSegs, px: pxNets.n, mean: r3(pxNets.mean) } }));
  await costOfMesh("S, the belly crater at 0.7 m");
  await costOfSdf("S, the belly crater at 0.7 m");
  console.log(`  first frames after the first belly slug (step, draw, draw, 8 draws; ms): ${J(seg.firstFrames)}`);
  console.log(J({ scenario: "S", seg: { segment: seg.segment, centre: r3(seg.centre), radius: +seg.radius.toFixed(3) }, mesh: { px: pxMesh.n, mean: r3(pxMesh.mean), inside: fMesh }, sdf: { px: pxSdf.n, mean: r3(pxSdf.mean), inside: fSdf } }));

  // ——— C: three chops on another torso (the cut-cost scene) ———
  await look(await evaluate(`__sdfGame.actorLimbCenter(${zc.id}, "torso")`), DIST, await frontOf(zc.id));
  let cuts = 0;
  for (const s of ["H", "R", "L"]) cuts += await evaluate(`__sdfGame.axeChop(${zc.id}, "${s}", "torso")`);
  await stepN(2);
  check("C1 the three chops landed", cuts >= 3, `${cuts} cuts`);
  await shot("C-mesh");
  const cMesh = await insideFlesh();
  await stepN(4);
  check("C2 mesh: three torso chops fold no inside-flesh row", cMesh.evals === 0, `evals ${cMesh.evals}`);
  await evaluate(`__sdfGame.setOrgans("sdf")`);
  await stepN(4);
  await shot("C-sdf");
  const cSdf = await insideFlesh();
  await stepN(4);
  check("C3 sdf (positive control): the same frame folds inside-flesh rows", cSdf.evals > 10000, `evals ${cSdf.evals} over ${cSdf.texels} texels`);
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await stepN(2);
  await costOfSdf("C, three torso chops at 0.9 m");
  console.log(J({ scenario: "C", mesh: cMesh, sdf: cSdf }));

  // ——— H: a head-only wound ———
  const head = await evaluate(`__sdfGame.actorLimbCenter(${zh.id}, "head")`);
  const eye = await look(head, DIST, await frontOf(zh.id));
  const d = [head[0] - eye[0], head[1] - eye[1], head[2] - eye[2]], l = Math.hypot(...d);
  const hit = await evaluate(`__sdfGame.stampWoundAt(${eye[0]}, ${eye[1]}, ${eye[2]}, ${d[0] / l}, ${d[1] / l}, ${d[2] / l}, "pellet", ${zh.id})`);
  await stepN(2);
  const oH = await evaluate("__sdfGame.organs()");
  const wounds = (await evaluate(`__sdfGame.actorWounds(${zh.id})`)).length;
  check("H1 a head-only wound draws no organ instance for that zombie", !!hit && wounds >= 1 && !oH.drawnBy.includes(zh.id), `hit ${!!hit}, wounds ${wounds}, drawnBy ${J(oH.drawnBy)}`);

  // ——— T: the belly crater again, torch off (the cavity's occlusion: the room's lights alone) ———
  await look(seg.centre, 0.7, await frontOf(zu.id));
  await torch(false);
  const tOn = await shot("T-mesh-torch-off");
  await evaluate("__sdfGame.meshSkeletonShow({ organs: false })");
  const tOff = await shot();
  await evaluate("__sdfGame.meshSkeletonShow({ organs: true })");
  const pxMeshT = diffPixels(tOn, tOff);
  await evaluate(`__sdfGame.setOrgans("sdf")`);
  await stepN(4);
  const tSdfOn = await shot("T-sdf-torch-off");
  await evaluate("__sdfGame.setWoundTuning({ organAmp: 0 })");
  await stepN(2);
  const pxSdfT = diffPixels(tSdfOn, await shot());
  await evaluate("__sdfGame.setWoundTuning({ organAmp: 1 })");
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await stepN(4);
  const cdT = Math.hypot(pxMeshT.mean[0] - pxSdfT.mean[0], pxMeshT.mean[1] - pxSdfT.mean[1], pxMeshT.mean[2] - pxSdfT.mean[2]);
  check("T1 torch off: both organs are on screen", pxMeshT.n > 300 && pxSdfT.n > 300, `mesh ${pxMeshT.n} px ${J(r3(pxMeshT.mean))}, sdf ${pxSdfT.n} px ${J(r3(pxSdfT.mean))}`);
  check(`T2 torch off: the mesh organ's mean colour is within ${COLOUR_MAX} of the sdf organ's`, cdT <= COLOUR_MAX, `distance ${cdT.toFixed(3)}`);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  check("T3 the mesh organ is darker by the room's lights than under the torch, as the sdf organ is", lum(pxMeshT.mean) < 0.75 * lum(pxMesh.mean) && lum(pxSdfT.mean) < 0.75 * lum(pxSdf.mean), `mesh ${lum(pxMeshT.mean).toFixed(3)} / ${lum(pxMesh.mean).toFixed(3)}, sdf ${lum(pxSdfT.mean).toFixed(3)} / ${lum(pxSdf.mean).toFixed(3)}`);
  check("M  no console error", S.errors.length === 0, J(S.errors.slice(0, 3)));
  closeSession();
}

async function bootQ() {
  console.log("\n== Q: ?organs=sdf ==");
  await boot("organs=sdf");
  const o = await evaluate("__sdfGame.organs()");
  check("Q1 ?organs=sdf boots the sdf mode", o.mode === "sdf", `mode ${o.mode}`);
  const segQ = await bellySlug(pool[0].id);
  // After its first upload: a frozen boot's first pack predates setPackBones(false), which takes effect at the next
  // upload (true on main too; an unwounded body never folds the rows, so it costs nothing).
  const qRows = await rowsOf(pool[0].id);
  check("Q2 the wounded zombie packs its 8 organ rows and no bone row", qRows === 8, `rows ${qRows}`);
  console.log(`  first frames after the first belly slug (step, draw, draw, 8 draws; ms): ${J(segQ.firstFrames)}`);
  const o2 = await evaluate("__sdfGame.organs()");
  check("Q3 a belly crater draws no organ mesh", o2.drawn === 0, `drawn ${o2.drawn}`);
  const f = await insideFlesh();
  check("Q4 the march folds the organ rows in the crater", f.evals > 10000, `evals ${f.evals}`);
  check("Q  no console error", S.errors.length === 0, J(S.errors.slice(0, 3)));
  closeSession();
}

async function bootP() {
  console.log("\n== P: ?skeleton=procedural ==");
  await boot("skeleton=procedural&organs=mesh");
  const o = await evaluate("__sdfGame.organs()");
  check("P1 the procedural skeleton keeps sdf organs whatever ?organs says", o.mode === "sdf", `mode ${o.mode}`);
  const zRows = pool.map((z) => o.packed.find((p) => p.id === z.id)?.rows);
  check("P2 every zombie packs bones and organs", zRows.every((r) => r > 8), `rows ${J(zRows)}`);
  check("P3 setOrgans('mesh') is refused", (await evaluate(`__sdfGame.setOrgans("mesh")`)) === "sdf");
  check("P  no console error", S.errors.length === 0, J(S.errors.slice(0, 3)));
  closeSession();
}

/** THE OWNER'S LOOK SHEET (ONLY=L; not part of the gate's checks). Per scene one sheet: columns = SDF organs (today),
 *  then the mesh in each ORGAN_LOOKS candidate (match, wet, veined, pale); rows = torch off, torch on. Every tile is the
 *  same frame, the mode and look flipped in page. CROP screen px square about the screen centre (the wound). */
const CROP = Number(process.env.CROP ?? 360);
const LOOKS = (process.env.LOOKS ?? "match,wet,veined,pale").split(",");
/** LOOK_SET='{"name":{"cfg":[..],"gloss":[..]}}' tries looks that are not in ORGAN_LOOKS yet (tuning). */
const LOOK_SET = Object.fromEntries(Object.entries(JSON.parse(process.env.LOOK_SET ?? "{}")).map(([k, v]) => [k, J(v)]));
function sheet(name, rows, labels = ["sdf", ...LOOKS]) {
  const cols = rows[0].length, w = cols * CROP, h = rows.length * CROP, out = new Uint8Array(w * h * 4);
  const x0 = (W - CROP) >> 1, y0 = (H - CROP) >> 1;
  rows.forEach((row, ry) => row.forEach((img, cx) => {
    for (let y = 0; y < CROP; y++) {
      const src = ((y0 + y) * W + x0) * 4, dst = ((ry * CROP + y) * w + cx * CROP) * 4;
      out.set(img.subarray(src, src + CROP * 4), dst);
    }
    // A 2 px dark seam on the tile's left and top edges.
    for (let y = 0; y < CROP; y++) for (let k = 0; k < 2; k++) { const d = ((ry * CROP + y) * w + cx * CROP + k) * 4; out[d] = out[d + 1] = out[d + 2] = 0; out[d + 3] = 255; }
    for (let x = 0; x < CROP; x++) for (let k = 0; k < 2; k++) { const d = ((ry * CROP + k) * w + cx * CROP + x) * 4; out[d] = out[d + 1] = out[d + 2] = 0; out[d + 3] = 255; }
  }));
  writeFileSync(`${OUT}/${name}.png`, writePng(w, h, out));
  console.log(`  sheet ${OUT}/${name}.png (${cols} x ${rows.length}: ${labels.join(" | ")}; torch off / on)`);
}
/** The torch. Off is at once; on ramps with the light clock, which the boot froze: thaw it until the torch is up. */
async function torch(on) {
  // Off: the level drops at once, but what follows it (the spot's own light, its shadow) settles over some frames.
  if (!on) { await evaluate("__sdfGame.setFlashlight(false)"); await stepN(40); return; }
  await evaluate("__sdfGame.setLightClockFrozen(false)");
  await evaluate("__sdfGame.setFlashlight(true)");
  for (let i = 0; i < 240 && !((await evaluate("__sdfGame.lights()")).flashlight > 0.99); i++) await stepOne();
  await evaluate("__sdfGame.setLightClockFrozen(true)");
  await stepN(4);
  const level = (await evaluate("__sdfGame.lights()")).flashlight;
  if (!(level > 0.99)) die(`the torch did not come on: level ${level}`);
}
/** One sheet of the wound at `target` on zombie `id`, from the standing eye `dist` away. */
async function lookTiles(name, id, target, dist) {
  await look(target, dist, await frontOf(id));
  const shipped = (await evaluate("__sdfGame.organs()")).look;
  const rows = [];
  for (const lit of [false, true]) {
    await torch(lit);
    await evaluate(`__sdfGame.setOrgans("sdf")`);
    await stepN(3);
    const row = [await shot()];
    // The SDF organ's pixels (organAmp 1 against 0) and each mesh look's (shown against hidden): count and mean colour.
    await evaluate("__sdfGame.setWoundTuning({ organAmp: 0 })"); await stepN(2);
    const px = { sdf: diffPixels(row[0], await shot()) };
    await evaluate("__sdfGame.setWoundTuning({ organAmp: 1 })"); await stepN(2);
    await evaluate(`__sdfGame.setOrgans("mesh")`);
    await evaluate("__sdfGame.meshSkeletonShow({ organs: false })"); await stepN(3);
    const hidden = await shot();
    await evaluate("__sdfGame.meshSkeletonShow({ organs: true })");
    for (const l of LOOKS) { await evaluate(`__sdfGame.setOrganLook(${LOOK_SET[l] ?? J(l)})`); await stepN(3); row.push(await shot()); px[l] = diffPixels(row[row.length - 1], hidden); }
    console.log(`  ${name} torch ${lit ? "on" : "off"}: ` + Object.entries(px).map(([k, v]) => `${k} ${v.n} px ${J(r3(v.mean))}`).join("; "));
    rows.push(row);
  }
  await evaluate(`__sdfGame.setOrganLook(${J(shipped)})`);
  await stepN(3);
  sheet(name, rows);
  const bl = await evaluate(`__sdfGame.boneLights(${id})`);
  console.log(J({ sheet: name, organs: await evaluate("__sdfGame.organs()").then((o) => ({ drawnBy: o.drawnBy, tint: o.tint })), lightList: bl ? { on: bl.listOn, picks: bl.body } : null }));
}
/** THE MESH SHEET (ONLY=V; organs, low-poly, 2026-10-07; not part of the gate's checks). Per scene one sheet: a column
 *  a mesh, on the shipped look; rows = torch off, torch on. Every tile is the same frame, the mesh flipped in page.
 *  MESH_COLS='[{"label":..,"mesh":..,"set":..,"look":{..}}]' overrides the columns (no mesh = SDF organs). */
const MESH_COLS = JSON.parse(process.env.MESH_COLS ?? "null") ?? [
  { label: "sdf" },
  { label: "nets-5mm, plain (2026-10-06: 4,038 v)", mesh: "nets-5mm", set: "plain" },
  { label: "tubes, plain (528 v)", mesh: "tubes", set: "plain" },
  { label: "tubes, detail subtle", mesh: "tubes", set: "subtle" },
  { label: "tubes, detail as shipped", mesh: "tubes", set: "ships" },
  { label: "tubes, detail strong", mesh: "tubes", set: "strong" },
];
async function meshTiles(name, id, target, dist) {
  await look(target, dist, await frontOf(id));
  // A column's `set` names one of the page's own detail strengths (mesh-organ.ts ORGAN_DETAIL_SETS); `look` is numbers.
  const { look: shipped, detailSets } = await evaluate("__sdfGame.organs()");
  const rows = [];
  for (const lit of [false, true]) {
    await torch(lit);
    await evaluate(`__sdfGame.setOrgans("mesh")`);
    await evaluate("__sdfGame.meshSkeletonShow({ organs: false })"); await stepN(3);
    const hidden = await shot();
    await evaluate("__sdfGame.meshSkeletonShow({ organs: true })");
    const row = [], report = [];
    for (const col of MESH_COLS) {
      if (!col.mesh) {
        await evaluate(`__sdfGame.setOrgans("sdf")`); await stepN(3);
        row.push(await shot());
        await evaluate("__sdfGame.setWoundTuning({ organAmp: 0 })"); await stepN(2);
        const px = diffPixels(row[row.length - 1], await shot());
        await evaluate("__sdfGame.setWoundTuning({ organAmp: 1 })"); await stepN(2);
        await evaluate(`__sdfGame.setOrgans("mesh")`); await stepN(3);
        report.push(`${col.label}: ${px.n} px ${J(r3(px.mean))}`);
        continue;
      }
      await evaluate(`__sdfGame.setOrganMesh(${J(col.mesh)})`);
      if (col.set && !detailSets[col.set]) die(`no detail set ${col.set}`);
      await evaluate(`__sdfGame.setOrganLook(${J({ ...shipped, ...(col.set ? detailSets[col.set] : {}), ...(col.look ?? {}) })})`); await stepN(3);
      row.push(await shot());
      const o = await evaluate("__sdfGame.organs()"), px = diffPixels(row[row.length - 1], hidden);
      report.push(`${col.label}: ${o.drawnVerts} v / ${o.drawnTris} t, ${px.n} px ${J(r3(px.mean))}`);
    }
    console.log(`  ${name} torch ${lit ? "on" : "off"}:\n    ` + report.join("\n    "));
    rows.push(row);
  }
  await evaluate(`__sdfGame.setOrganMesh("tubes")`);
  await evaluate(`__sdfGame.setOrganLook(${J(shipped)})`);
  await stepN(3);
  sheet(name, rows, MESH_COLS.map((c) => c.label));
}
async function bootV() {
  console.log("\n== V: the mesh sheets ==");
  await boot("");
  const [za, zb] = pool;
  const want = (n) => !process.env.SCENES || process.env.SCENES.split(",").includes(String(n));
  if (want(1)) {
    const segA = await bellySlug(za.id);
    await meshTiles("01-belly-slug-0.7m", za.id, segA.centre, 0.7);
    console.log(J({ segments: await evaluate(`__sdfGame.organSegments(${za.id})`).then((a) => a.map((q) => ({ segment: q.segment, mesh: q.mesh }))) }));
  }
  if (want(2)) {
    const segB = await bellySlug(zb.id);
    await levelSlug(zb.id, [segB.centre[0], segB.centre[1] + 0.10, segB.centre[2]], 0.7);
    await stepN(2);
    await meshTiles("02-gutted-two-slugs-0.6m", zb.id, [segB.centre[0], segB.centre[1] + 0.05, segB.centre[2]], 0.6);
  }
  console.log(`  mesh cache: ${J(await evaluate("(() => { const m = __sdfGame.skeletonMesh(); return m ? { entries: m.cacheEntries, totals: m.cacheTotals } : null; })()"))}`);
  console.log(`  console errors: ${J(S.errors.slice(0, 3))}`);
  closeSession();
}
async function bootL() {
  console.log("\n== L: the look sheets ==");
  await boot("");
  const [za, zb, zc] = pool;
  const want = (n) => !process.env.SCENES || process.env.SCENES.split(",").includes(String(n));
  // 1. One slug in the belly.
  if (want(1)) {
    const segA = await bellySlug(za.id);
    await lookTiles("01-belly-slug-0.7m", za.id, segA.centre, 0.7);
  }
  // 2. Gutted: two slugs, the gut coil and the loop above it.
  if (want(2)) {
    const segB = await bellySlug(zb.id);
    await levelSlug(zb.id, [segB.centre[0], segB.centre[1] + 0.10, segB.centre[2]], 0.7);
    await stepN(2);
    await lookTiles("02-gutted-two-slugs-0.6m", zb.id, [segB.centre[0], segB.centre[1] + 0.05, segB.centre[2]], 0.6);
  }
  // 3. The cut-cost scene: three torso chops. They open the chest, above the organs: no organ shows in either mode.
  if (want(3)) {
    const tc = await evaluate(`__sdfGame.actorLimbCenter(${zc.id}, "torso")`);
    await look(tc, DIST, await frontOf(zc.id));
    for (const s of ["H", "R", "L"]) await evaluate(`__sdfGame.axeChop(${zc.id}, "${s}", "torso")`);
    await stepN(2);
    await lookTiles("03-three-chops-0.9m", zc.id, tc, DIST);
  }
  console.log(`  console errors: ${J(S.errors.slice(0, 3))}`);
  closeSession();
}

if (ONLY.includes("M")) await bootM();
if (ONLY.includes("Q")) await bootQ();
if (ONLY.includes("P")) await bootP();
if (ONLY.includes("L")) await bootL();
if (ONLY.includes("V")) await bootV();
console.log(`\n${checks} checks, ${failed} failed. Sheets in ${OUT}`);
process.exit(failed ? 1 : 0);
