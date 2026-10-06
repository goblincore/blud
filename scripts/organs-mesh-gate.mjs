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
//        H  a head-only wound on a third zombie: no organ instance for it.
//   Q  ?organs=sdf: the selector. The mode is 'sdf', zombies pack their 8 organ rows, a belly crater draws no organ mesh.
//   P  ?skeleton=procedural: the mode is 'sdf' whatever the query says, and bodies pack bones and organs.
//
// Usage (bash, not zsh; its own servers, never 5273; take /tmp/blud-gpu-timing.lock round the run):
//   export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   OUT=.lab-tmp/organs-mesh-gate node scripts/organs-mesh-gate.mjs 5251 9251
// ONLY=M,Q runs a subset of the boots. OUT defaults to .lab-tmp/organs-mesh-gate (never a tracked folder).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const VITE = Number(process.argv[2] ?? 5251);
const CDP = Number(process.argv[3] ?? 9251);
const OUT = process.env.OUT ?? ".lab-tmp/organs-mesh-gate";
const ONLY = (process.env.ONLY ?? "M,Q,P").split(",");
const W = 1280, H = 800, EYE_H = 1.62, DIST = 0.9;
// Tolerances of S: the mesh organ against the SDF organ, on screen.
const AREA_LO = 0.4, AREA_HI = 2.5;      // organ pixel count, mesh / sdf
const COLOUR_MAX = 0.22;                 // distance of the mean organ colours, sRGB 0..1
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
/** A screenshot as RGBA bytes (decoded in the page: no PNG decoder here), and the PNG itself. */
async function shot(name) {
  await evaluate("__sdfGame.setRenderLock(true)");
  await stepOne(); await stepOne();
  const r = await S.send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const png = r.result.data;
  if (name) writeFileSync(`${OUT}/${name}.png`, Buffer.from(png, "base64"));
  const b64 = await evaluate(`(async () => { const img = new Image(); img.src = "data:image/png;base64,${png}"; await img.decode(); const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, img.width, img.height).data; let s = ""; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768)); return btoa(s); })()`);
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
/** The pixels that differ between two screenshots (any channel by more than `thr` of 255): count, and the mean colour of
 *  those pixels in `a` (sRGB 0..1). */
function diffPixels(a, b, thr = 10) {
  let n = 0, r = 0, g = 0, bl = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > thr || Math.abs(a[i + 1] - b[i + 1]) > thr || Math.abs(a[i + 2] - b[i + 2]) > thr) { n++; r += a[i]; g += a[i + 1]; bl += a[i + 2]; }
  }
  return { n, mean: n ? [r / n / 255, g / n / 255, bl / n / 255] : [0, 0, 0] };
}
const rowsOf = async (id) => (await evaluate("__sdfGame.organs()")).packed.find((p) => p.id === id)?.rows;
const r3 = (v) => v.map((x) => +x.toFixed(3));

/** A slug crater in zombie `id`'s belly, fired from the eye at its first organ segment. Returns the segment bound. */
async function bellySlug(id) {
  const segs = await evaluate(`__sdfGame.organSegments(${id})`);
  if (!segs.length) die(`zombie ${id} has no organ segment`);
  // The largest segment (the gut coil on the pelvis frame).
  const seg = segs.sort((a, b) => b.radius - a.radius)[0];
  const eye = await look(seg.centre, DIST, await frontOf(id));
  const d = [seg.centre[0] - eye[0], seg.centre[1] - eye[1], seg.centre[2] - eye[2]], l = Math.hypot(...d);
  const hit = await evaluate(`__sdfGame.stampWoundAt(${eye[0]}, ${eye[1]}, ${eye[2]}, ${d[0] / l}, ${d[1] / l}, ${d[2] / l}, "slug", ${id})`);
  if (!hit) die(`the slug missed zombie ${id}`);
  await stepN(2);
  return seg;
}

async function bootM() {
  console.log("\n== M: the default page (mesh skeleton, mesh organs) ==");
  await boot("");
  const o0 = await evaluate("__sdfGame.organs()");
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
  const seg = await bellySlug(zu.id);
  const sMesh = await evaluate("__sdfGame.organs()");
  const meshOwners = sMesh.drawnBy.filter((id) => id === zu.id).length;
  check("S1 mesh: the belly crater draws the wounded zombie's organ instances, and only its", meshOwners >= 1 && sMesh.drawnBy.every((id) => id === zu.id), `drawnBy ${J(sMesh.drawnBy)}`);
  const fMesh = await insideFlesh();
  check("S2 mesh: the march folds no inside-flesh row (debug mode 5)", fMesh.evals === 0 && fMesh.marched > 1000, `evals ${fMesh.evals} over ${fMesh.texels} texels; ${fMesh.marched} marched`);
  const tMesh = await readTarget();
  // Organ pixels on screen, mesh: shown against hidden.
  const meshOn = await shot("S-mesh");
  await evaluate("__sdfGame.meshSkeletonShow({ organs: false })");
  const meshOff = await shot("S-mesh-organs-hidden");
  await evaluate("__sdfGame.meshSkeletonShow({ organs: true })");
  const pxMesh = diffPixels(meshOn, meshOff);
  // The same frame with SDF organs.
  await evaluate(`__sdfGame.setOrgans("sdf")`);
  await stepN(2);
  const sSdf = await evaluate("__sdfGame.organs()");
  check("S3 sdf: no organ mesh is drawn", sSdf.drawn === 0, `drawn ${sSdf.drawn}`);
  const fSdf = await insideFlesh();
  check("S4 sdf (positive control): the march folds inside-flesh rows in the crater", fSdf.evals > 10000, `evals ${fSdf.evals} over ${fSdf.texels} texels`);
  const tSdf = await readTarget();
  check("S5 the march target differs between the modes here (sdf organs are in the field, mesh organs are not)", fnv(tMesh.f) !== fnv(tSdf.f), `mesh ${fnv(tMesh.f)} sdf ${fnv(tSdf.f)}`);
  // Organ pixels on screen, sdf: organAmp 1 against 0 (the organ branch is mix(albedo, organColor, organAmp)).
  const sdfOn = await shot("S-sdf");
  await evaluate("__sdfGame.setWoundTuning({ organAmp: 0 })");
  await stepN(2);
  const sdfOff = await shot("S-sdf-organAmp0");
  await evaluate("__sdfGame.setWoundTuning({ organAmp: 1 })");
  await stepN(2);
  const pxSdf = diffPixels(sdfOn, sdfOff);
  check("S6 sdf (positive control): organ pixels are on screen", pxSdf.n > 300, `${pxSdf.n} px, mean ${J(r3(pxSdf.mean))}`);
  check("S7 mesh: organ pixels are on screen", pxMesh.n > 300, `${pxMesh.n} px, mean ${J(r3(pxMesh.mean))}`);
  const ratio = pxMesh.n / Math.max(pxSdf.n, 1);
  check(`S8 the mesh organ area is within ${AREA_LO}..${AREA_HI} of the sdf organ area`, ratio >= AREA_LO && ratio <= AREA_HI, `ratio ${ratio.toFixed(2)}`);
  const cd = Math.hypot(pxMesh.mean[0] - pxSdf.mean[0], pxMesh.mean[1] - pxSdf.mean[1], pxMesh.mean[2] - pxSdf.mean[2]);
  check(`S9 the mesh organ's mean colour is within ${COLOUR_MAX} of the sdf organ's`, cd <= COLOUR_MAX, `distance ${cd.toFixed(3)}`);
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await stepN(2);
  console.log(J({ scenario: "S", seg: { segment: seg.segment, centre: r3(seg.centre), radius: +seg.radius.toFixed(3) }, mesh: { px: pxMesh.n, mean: r3(pxMesh.mean), inside: fMesh }, sdf: { px: pxSdf.n, mean: r3(pxSdf.mean), inside: fSdf } }));

  // ——— C: three chops on another torso (the cut-cost scene) ———
  await look(await evaluate(`__sdfGame.actorLimbCenter(${zc.id}, "torso")`), DIST, await frontOf(zc.id));
  let cuts = 0;
  for (const s of ["H", "R", "L"]) cuts += await evaluate(`__sdfGame.axeChop(${zc.id}, "${s}", "torso")`);
  await stepN(2);
  check("C1 the three chops landed", cuts >= 3, `${cuts} cuts`);
  const cMesh = await insideFlesh();
  check("C2 mesh: three torso chops fold no inside-flesh row", cMesh.evals === 0, `evals ${cMesh.evals}`);
  await shot("C-mesh");
  await evaluate(`__sdfGame.setOrgans("sdf")`);
  await stepN(2);
  const cSdf = await insideFlesh();
  check("C3 sdf (positive control): the same frame folds inside-flesh rows", cSdf.evals > 10000, `evals ${cSdf.evals} over ${cSdf.texels} texels`);
  await shot("C-sdf");
  await evaluate(`__sdfGame.setOrgans("mesh")`);
  await stepN(2);
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
  check("M  no console error", S.errors.length === 0, J(S.errors.slice(0, 3)));
  closeSession();
}

async function bootQ() {
  console.log("\n== Q: ?organs=sdf ==");
  await boot("organs=sdf");
  const o = await evaluate("__sdfGame.organs()");
  check("Q1 ?organs=sdf boots the sdf mode", o.mode === "sdf", `mode ${o.mode}`);
  const zRows = pool.map((z) => o.packed.find((p) => p.id === z.id)?.rows);
  check("Q2 every zombie packs its 8 organ rows and no bone row", zRows.every((r) => r === 8), `rows ${J(zRows)}`);
  await bellySlug(pool[0].id);
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

if (ONLY.includes("M")) await bootM();
if (ONLY.includes("Q")) await bootQ();
if (ONLY.includes("P")) await bootP();
console.log(`\n${checks} checks, ${failed} failed. Sheets in ${OUT}`);
process.exit(failed ? 1 : 0);
