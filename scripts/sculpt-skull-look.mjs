// scripts/sculpt-skull-look.mjs — photographs of the sculpted skull's variants (`?sculpt=`, sculpt-variant.ts), staged
// the same way in every column, for the look sheets under docs/dev-notes/2026-10-07-sculpt-skull-2/look/.
//
// Each column is one page query. Each column boots twice on the bare ring page (/sdf-game.html, frozen cast): once
// with every slot a soldier (?spawn=soldier), once with zombies. The scenes:
//   soldier-face   a soldier's face shot away by REAL pellet volleys (fire(1), aimed at the face from 2 m);
//   soldier-bare   a soldier with the flesh out of the frame: the bare skull, front, three-quarter, and the jaw and
//                  teeth close;
//   zombie-burst   a zombie's head after two real slugs (the head burst);
//   zombie-chop1, zombie-chop2   a zombie's head after the axe's first and second head chop (the head split);
//   zombie-bare    as soldier-bare.
// Every scene is shot three times: AS THE GAME SHIPS (the default post chain with VHS on, the default internal
// resolution and field style, wounds bleeding) from 2.5 m and from 1 m at the player's eye height, and CLEAN (VHS off,
// the blood drops cleared) from 0.6 m.
// Nothing about the picture is changed for the shipped shots but the HUD, the dev panels and the player's own gun,
// which are hidden; the cast is frozen and the light clock held so every column is the same moment.
//
// Output: <out>/<column>__<scene>__<view>.png (the whole 1280 x 800 frame) and <out>/shots.json, which says where the
// head is in each frame (its centre in pixels and the pixels a metre covers there) and what each boot measured
// (the skeleton's recipe, the bone cache's extraction times and sizes, the wounds each scene made).
// scripts/sculpt-skull-sheet.py lays the frames out.
//
// Usage (own servers): node scripts/sculpt-skull-look.mjs <vite port> <cdp port> <out dir>
//   COLS=old,full   only those columns        SCENES=soldier-face,zombie-bare   only those scenes
//   TIMING=1        also time still frames of the bare soldier skull (TIMING_ONLY=1: that and no photographs)
//   VOLLEYS=3       pellet volleys at the soldier's face      FACE_SHOT_M=2   from how far
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const VITE = Number(process.argv[2] ?? 5261), CDP = Number(process.argv[3] ?? 9261);
const OUT = process.argv[4] ?? ".lab-tmp/sculpt-skull/look";
const W = 1280, H = 800, EYE_H = 1.62, SETTLE = 24;
const VOLLEYS = Number(process.env.VOLLEYS ?? 3);
const FACE_SHOT_M = Number(process.env.FACE_SHOT_M ?? 2);
const COLUMNS = {
  old: "&skull=sculpt", shape: "&sculpt=shape", "shape-fine": "&sculpt=shape-fine", paint: "&sculpt=paint", full: "&sculpt=full",
  anatomical: "",
};
const COLS = (process.env.COLS ?? "old,shape,shape-fine,paint,full").split(",");
const SCENES = new Set((process.env.SCENES ?? "soldier-face,soldier-bare,zombie-burst,zombie-chop1,zombie-chop2,zombie-bare").split(","));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
mkdirSync(OUT, { recursive: true });
// The whole run has a deadline: a hung page must not hold the capture lock.
const DEADLINE = setTimeout(() => { console.error("FAIL: the run's deadline passed"); process.exit(2); }, Number(process.env.DEADLINE_MS ?? 40 * 60 * 1000));

const manifestPath = `${OUT}/shots.json`;
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { shots: {}, boots: {} };
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");

// ---- One CDP tab at a time ---------------------------------------------------------------------------------------
let S = null;
const consoleErrors = [];
async function openSession(label) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), label, rect: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push({ label, text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 600) });
    if (m.method === "Runtime.exceptionThrown") consoleErrors.push({ label, text: JSON.stringify(m.params.exceptionDetails).slice(0, 600) });
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
const evaluate = async (expression, ms = 90000) => {
  const r = await withTimeout(S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};
const J = (v) => JSON.stringify(v);

// ---- Vectors ---------------------------------------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
const turnY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];

// ---- The page ----------------------------------------------------------------------------------------------------------
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
/** The camera onto the player's pose without advancing anything. */
const syncCam = () => evaluate("__sdfGame.step(1, 0)");
/** Re-render without stepping the sim: the post chain mixes each frame with the ones before it. */
const settle = async (n = SETTLE) => { await evaluate("__sdfGame.setRenderLock(true)"); for (let i = 0; i < n; i++) await stepOne(); await evaluate("__sdfGame.setRenderLock(false)"); };
const frameOf = (id) => evaluate(`__sdfGame.head.frame(${id})`);
const frontOf = async (id) => { const fr = await frameOf(id); const f = qRot(fr.quat, [0, 0, 1]); return unit([f[0], 0, f[2]]); };
let pool = [], used = new Set();
function fresh() { const z = pool.find((q) => !used.has(q.id)); if (!z) throw new Error("ran out of fresh actors"); used.add(z.id); return z; }

async function boot(label, query, cast) {
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&loader=0${query}`;
  const t0 = Date.now();
  await send("Page.navigate", { url });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") throw new Error(`[${label}] backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") throw new Error(`[${label}] warm gate never reached ready`);
  await evaluate("__sdfGame.setLoopRunning(false)");
  // Everything on the page that is not the canvas: the HUD, the reticle, the dev panels.
  await evaluate(`(() => { for (const e of document.body.querySelectorAll("*")) { if (e.tagName !== "CANVAS" && !e.querySelector("canvas") && !e.closest("canvas")) e.style.visibility = "hidden"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setFreeAim(true)"); await evaluate("__sdfGame.setAimPoint(0, 0)");
  await evaluate("__sdfGame.setViewModelVisible(false)");
  // The cast by its character's name (a soldier slot's kind is 'soldier' for a juggernaut too): the room with the most
  // of the one this boot photographs.
  const named = await evaluate("__sdfGame.brains().map((b) => ({ id: b.id, name: b.name }))");
  const all = (await evaluate("__sdfGame.actorList()")).filter((z) => named.find((b) => b.id === z.id)?.name === cast);
  if (!all.length) throw new Error(`[${label}] no ${cast} in the cast`);
  const byRoom = new Map();
  for (const z of all) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM); used = new Set();
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (["gib", "crowd"].every((k) => wb[k] === "ready") || ["gib", "crowd"].some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  // The same moment in every column: the dynamic lights' clock held at 0.
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); return 1; })()`);
  await stepN(90);
  const diag = await evaluate("__sdfGame.skeletonDiagnostics()");
  const mesh = await evaluate("__sdfGame.skeletonMesh()");
  manifest.boots[label] = { url, wallS: +((Date.now() - t0) / 1000).toFixed(1), skull: diag.skull, sculpt: diag.sculpt, cast, pool: pool.length, cache: mesh ? { entries: mesh.cacheEntries, totals: mesh.cacheTotals, stats: mesh.cacheStats } : null, warm: wb };
  save();
  console.log(`[${label}] ready in ${manifest.boots[label].wallS} s; room ${ROOM}, ${pool.length} x ${cast}; skull ${diag.skull}, recipe ${J(diag.sculpt)}`);
}

/** The player's eye at world point `e`, looking at `t` (an eye above standing height is held by setting the pose again
 *  before every frame; the camera takes it at syncCam). */
async function camAt(e, t) {
  const d = sub(t, e);
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, ${e[1] - EYE_H})`);
}
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h] : null; };

/** Photograph actor `id`'s head from `dist` m, the camera turned `yawDeg` about the head from straight in front, at
 *  the player's standing eye height, as in play (the game holds the player on the floor: the eye cannot go lower, and
 *  the camera is the player's). `aim` is added to the head's centre for where the camera looks. */
async function shot(col, scene, view, id, { dist, yawDeg = 0, aim = [0, 0, 0] }) {
  const fr = await frameOf(id), f = await frontOf(id);
  const dir = turnY(f, yawDeg * Math.PI / 180);
  const target = add(fr.centre, aim);
  const eye = add(target, mul(dir, dist));
  eye[1] = EYE_H;
  await camAt(eye, target); await syncCam();
  const cam = await evaluate("__sdfGame.cameraWorld()");
  await settle();
  await evaluate("__sdfGame.setRenderLock(true)");
  await stepOne(); await stepOne();
  const png = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const name = `${col}__${scene}__${view}`;
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.result.data, "base64"));
  const up = qRot(fr.quat, [0, 1, 0]);
  const c = await toPx(target), top = await toPx(add(target, mul(up, 0.1)));
  manifest.shots[name] = { col, scene, view, actor: id, dist, yawDeg, eye: cam, target, centre: c, pxPerM: c && top ? Math.hypot(top[0] - c[0], top[1] - c[1]) / 0.1 : null };
  save();
  console.log(`  shot ${name} (eye ${cam.map((v) => v.toFixed(2)).join(", ")}; ${manifest.shots[name].pxPerM?.toFixed(0)} px/m)`);
}

const vhsOff = async () => { await evaluate("__sdfGame.setVhs(null)"); await settle(); };
const vhsOn = async () => { await evaluate("__sdfGame.setVhs('blud')"); await settle(); };
/** The three shots of a scene with flesh: shipped from 2.5 m and 1 m, clean from 0.6 m. */
async function shootScene(col, scene, id) {
  await shot(col, scene, "ships-2p5", id, { dist: 2.5 });
  await shot(col, scene, "ships-1p0", id, { dist: 1.0 });
  // The clean shot is for looking at the bone: the blood in the air and on the floor is cleared for it (a bleeding
  // wound throws drops across the face), and bleeding is put back after.
  await vhsOff();
  await evaluate("__sdfGame.setBleed(false)"); await stepN(2);
  await shot(col, scene, "clean-0p6", id, { dist: 0.6 });
  await evaluate("__sdfGame.setBleed(true)");
  await vhsOn();
}
/** A bare skull's shots: front and three-quarter, shipped and clean, and the jaw and teeth close, three-quarter. The
 *  eye is at the standing height: under the soldier's jaw (his head's centre is at 1.80 m), level with the zombie's
 *  (1.62 m). */
async function shootBare(col, scene, id) {
  const jaw = { aim: [0, -0.07, 0], yawDeg: 35 };
  await shot(col, scene, "ships-2p5-front", id, { dist: 2.5 });
  await shot(col, scene, "ships-1p0-front", id, { dist: 1.0 });
  await shot(col, scene, "ships-2p5-quarter", id, { dist: 2.5, yawDeg: 35 });
  await shot(col, scene, "ships-1p0-quarter", id, { dist: 1.0, yawDeg: 35 });
  await shot(col, scene, "ships-0p8-jaw", id, { dist: 0.8, ...jaw });
  await vhsOff();
  await shot(col, scene, "clean-0p6-front", id, { dist: 0.6 });
  await shot(col, scene, "clean-0p6-quarter", id, { dist: 0.6, yawDeg: 35 });
  await shot(col, scene, "clean-0p45-jaw", id, { dist: 0.45, ...jaw });
  await vhsOn();
}
/** Take actor `id`'s flesh out of the frame (its proxy box shrunk to nothing); the bone meshes stay. A torso wound
 *  first: an actor with nothing exposed draws only its eyes. */
async function bare(id) {
  const fr = await frameOf(id), f = await frontOf(id);
  const o = add(add(fr.centre, mul(f, 1.5)), [0, -0.45, 0]), d = unit(sub(add(fr.centre, [0, -0.45, 0]), o));
  const hit = await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${id})`);
  if (!hit) throw new Error(`bare: the torso wound missed actor ${id}`);
  await stepN(2);
  await evaluate(`(() => { const v = __sdfGame.zombie(${id}).view; v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); v.syncRecord(); return 1; })()`);
  await stepN(2);
}
/** Stand `dist` m in front of actor `id`'s head with the crosshair on the point `aim` from the head's centre. */
async function aimAt(id, dist, aim = [0, 0, 0]) {
  const fr = await frameOf(id), f = await frontOf(id);
  const target = add(fr.centre, aim), eye = add(target, mul(f, dist));
  eye[1] = EYE_H;
  const d = sub(target, eye);
  await evaluate(`__sdfGame.placePlayer({ x: ${eye[0]}, z: ${eye[2]}, yaw: ${yawOf(d[0], d[2])}, pitch: ${Math.atan2(d[1], Math.hypot(d[0], d[2]))} })`);
  await stepOne();
  await evaluate("__sdfGame.setAimPoint(0, 0)");
}
async function fire(what, tries = 6) {
  for (let i = 0; i < tries; i++) {
    await evaluate("__sdfGame.refillShells()");
    if (await evaluate(what)) return true;
    await stepN(90);
  }
  throw new Error(`${what} never fired`);
}
const woundsOf = async (id) => (await evaluate(`__sdfGame.actorWounds(${id})`)).map((w) => ({ limb: w.limb, type: w.type, shape: w.shape, r: +w.radius.toFixed(4), pos: w.pos.map((v) => +v.toFixed(3)) }));

async function soldierBoot(col) {
  await boot(`${col}/soldier`, `${COLUMNS[col]}&spawn=soldier`, "soldier");
  const record = manifest.boots[`${col}/soldier`];
  if (SCENES.has("soldier-face")) {
    const a = fresh();
    // The same volleys in every column: the crosshair on the face, a little under the eye line.
    for (let v = 0; v < VOLLEYS; v++) { await aimAt(a.id, FACE_SHOT_M, [0, -0.02, 0]); await fire("__sdfGame.fire(1)"); await stepN(30); }
    await stepN(30);
    record.face = { actor: a.id, volleys: VOLLEYS, wounds: await woundsOf(a.id), head: await evaluate(`__sdfGame.head.state(${a.id})`).then((h) => h ? { dead: h.dead, burst: h.burst ?? null } : null), phase: (await evaluate("__sdfGame.actorList()")).find((q) => q.id === a.id)?.phase };
    console.log(`  soldier-face: ${record.face.wounds.length} wounds (${record.face.wounds.filter((w) => w.limb === "head").length} on the head), head ${J(record.face.head)}, phase ${record.face.phase}`);
    await shootScene(col, "soldier-face", a.id);
  }
  if (SCENES.has("soldier-bare")) {
    const b = fresh(); await bare(b.id);
    if (!process.env.TIMING_ONLY) await shootBare(col, "soldier-bare", b.id);
    // TIMING=1: the median time of a still frame with the bare skull filling the view from 0.35 m (a draw and a
    // fence each, no vsync), three times. Reported, not gated: identical runs spread by tenths of a millisecond.
    if (process.env.TIMING || process.env.TIMING_ONLY) {
      const fr = await frameOf(b.id), f = await frontOf(b.id), eye = add(fr.centre, mul(f, 0.35));
      eye[1] = EYE_H;
      await camAt(eye, fr.centre); await syncCam(); await settle();
      record.drawMs = [];
      for (let k = 0; k < 3; k++) record.drawMs.push(+(await evaluate("__sdfGame.timeDraws(120)", 300000)).toFixed(3));
      console.log(`  draw time at 0.35 m, bare skull: ${record.drawMs.join(" / ")} ms`);
    }
  }
  save();
}

async function zombieBoot(col) {
  await boot(`${col}/zombie`, COLUMNS[col], "zombie");
  const record = manifest.boots[`${col}/zombie`];
  if (SCENES.has("zombie-burst")) {
    const a = fresh();
    for (let k = 0; k < 2; k++) { await aimAt(a.id, 2.0); await fire("__sdfGame.fireSlug()"); await stepN(12); }
    await stepN(120);
    record.burst = { actor: a.id, wounds: (await woundsOf(a.id)).length, head: await evaluate(`__sdfGame.head.state(${a.id})`).then((h) => h ? { dead: h.dead, burst: h.burst ?? null } : null) };
    console.log(`  zombie-burst: ${J(record.burst)}`);
    await shootScene(col, "zombie-burst", a.id);
  }
  if (SCENES.has("zombie-chop1") || SCENES.has("zombie-chop2")) {
    const c = fresh();
    record.chops = [];
    for (const n of [1, 2]) {
      // The axe strikes from the player's eye: stand in front, at arm's length.
      await aimAt(c.id, 0.9);
      const r = await evaluate(`__sdfGame.axeChop(${c.id}, "H", "head")`);
      await stepN(60);
      record.chops.push({ n, returned: r, split: await evaluate(`(() => { const s = __sdfGame.headSplit(${c.id}); return s ? { angle: s.angle, phase: s.phase ?? null } : null; })()`) });
      console.log(`  zombie-chop${n}: ${J(record.chops.at(-1))}`);
      if (SCENES.has(`zombie-chop${n}`)) await shootScene(col, `zombie-chop${n}`, c.id);
    }
  }
  if (SCENES.has("zombie-bare")) { const b = fresh(); await bare(b.id); await shootBare(col, "zombie-bare", b.id); }
  save();
}

let failed = 0;
for (const col of COLS) {
  if (!(col in COLUMNS)) { console.error(`unknown column ${col}`); failed++; continue; }
  for (const [kind, run] of [["soldier", soldierBoot], ["zombie", zombieBoot]]) {
    if (![...SCENES].some((s) => s.startsWith(kind))) continue;
    try { await run(col); }
    catch (e) { failed++; console.error(`FAIL [${col}/${kind}]: ${e.stack ?? e}`); }
    finally { if (S) { closeSession(S); S = null; } }
  }
}
if (consoleErrors.length) { failed++; console.error(`FAIL: ${consoleErrors.length} console errors: ${J(consoleErrors.slice(0, 6))}`); }
manifest.errors = consoleErrors; save();
clearTimeout(DEADLINE);
console.log(`${Object.keys(manifest.shots).length} shots in ${OUT}; ${failed} failures`);
process.exit(failed ? 1 : 0);
