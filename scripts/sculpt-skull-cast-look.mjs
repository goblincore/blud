// scripts/sculpt-skull-cast-look.mjs — every humanoid's bare head bone under the skull a page query draws, for the
// cast sheet under docs/dev-notes/2026-10-07-sculpt-skull-2/look/ (scripts/sculpt-skull-default-sheet.py lays the
// frames out).
//
// The second sculpt carves the zombie's and the soldier's heads only. Every other character's head is its plain
// authored bone, and a paint is drawn on it in the head's normalized coordinates: the sheet shows whether a paint's
// face (sockets, nose, teeth) sits on each bone.
//
// Each column is one page query. Each character is one boot of the bare ring page with every zombie slot that
// character (/sdf-game.html?spawn=<character>, frozen cast). One of them is given a torso wound (an unwounded actor
// draws no bones) and its flesh is taken out of the frame. It is shot CLEAN (VHS off) from 0.6 m, from the front and
// from three-quarter, and once as the game ships (VHS on) from 1 m.
//
// THE EYE IS LEVEL WITH THE HEAD in every frame. The game holds the player on the floor with the eye 1.62 m up, so a
// shorter character's head (the clown's is 0.77 m up) is only ever seen from above in play. For these photographs
// the page's own eye height (game-player.ts PLAYER.eye) is set to the head's for a head under 1.62 m; nothing in the
// game does that. The head's height is recorded with each frame.
//
// Output: <out>/<column>__<character>__<view>.png (the whole 1280 x 800 frame) and <out>/cast.json: where the head is
// in each frame, and what each boot drew (the skull, the recipe, the paint the character's head is drawn with).
//
// Usage (own servers): node scripts/sculpt-skull-cast-look.mjs <vite port> <cdp port> <out dir>
//   COLS=classic,default      the columns (classic, default, every-head, or name=query for any other page query)
//   CAST=zombie,cultist       only those characters
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const VITE = Number(process.argv[2] ?? 5261), CDP = Number(process.argv[3] ?? 9261);
const OUT = process.argv[4] ?? ".lab-tmp/sculpt-skull/cast";
const W = 1280, H = 800, EYE_H = 1.62, SETTLE = 24;
/** The thirteen humanoids (anatomical-skull.ts HUMANOID_SKULLS), the two the second sculpt carves first. */
const HUMANOIDS = ["zombie", "soldier", "cultist", "cultist-cowled", "bride", "female", "schoolgirl", "schoolgirl-alt", "schoolgirl-described", "clown", "clown-alt", "juggernaut", "bonewalker"];
const CAST = (process.env.CAST ?? HUMANOIDS.join(",")).split(",");
/** `classic`: the first look. `default`: the page with no skull parameter. `every-head`: the default's recipe with
 *  the second paint on every head, whatever the per-character rule says. */
const COLUMNS = { classic: "&sculpt=classic", default: "", "every-head": "&sculpt=full&sculptheads=all" };
const COLS = (process.env.COLS ?? "classic,default").split(",").map((c) => (c.includes("=") && !(c in COLUMNS) ? { name: c.slice(0, c.indexOf("=")), query: c.slice(c.indexOf("=") + 1) } : { name: c, query: COLUMNS[c] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
mkdirSync(OUT, { recursive: true });
// The whole run has a deadline: a hung page must not hold the capture lock.
const DEADLINE = setTimeout(() => { console.error("FAIL: the run's deadline passed"); process.exit(2); }, Number(process.env.DEADLINE_MS ?? 30 * 60 * 1000));

const manifestPath = `${OUT}/cast.json`;
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
  if (r.result?.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails)).slice(0, 500));
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
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h] : null; };

let pool = [];
async function boot(col, character) {
  const label = `${col.name}/${character}`;
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&loader=0&spawn=${character}${col.query}`;
  const t0 = Date.now();
  await send("Page.navigate", { url });
  let backend = null;
  for (let i = 0; i < 120 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") throw new Error(`backend ${backend}, expected webgpu (the page did not boot)`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") throw new Error("the warm gate never reached ready");
  await evaluate("__sdfGame.setLoopRunning(false)");
  // Everything on the page that is not the canvas: the HUD, the reticle, the dev panels.
  await evaluate(`(() => { for (const e of document.body.querySelectorAll("*")) { if (e.tagName !== "CANVAS" && !e.querySelector("canvas") && !e.closest("canvas")) e.style.visibility = "hidden"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setViewModelVisible(false)");
  await evaluate("__sdfGame.setBleed(false)");
  // The cast by its character (the name its skeleton was built under): the room with the most of the one this boot
  // photographs.
  const all = await evaluate(`__sdfGame.actorList().filter((z) => __sdfGame.skullDrawn(z.id)?.character === ${J(character)})`);
  if (!all.length) throw new Error(`no ${character} in the cast: ${J(await evaluate("[...new Set(__sdfGame.actorList().map((z) => __sdfGame.skullDrawn(z.id)?.character))]"))}`);
  const byRoom = new Map();
  for (const z of all) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  pool = [...byRoom.values()].sort((a, b) => b.length - a.length)[0];
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (["gib", "crowd"].every((k) => wb[k] === "ready") || ["gib", "crowd"].some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  // The same moment in every boot: the dynamic lights' clock held at 0.
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); return 1; })()`);
  await stepN(60);
  const diag = await evaluate("__sdfGame.skeletonDiagnostics()");
  manifest.boots[label] = { url, wallS: +((Date.now() - t0) / 1000).toFixed(1), skull: diag.skull, sculpt: diag.sculpt, sculptVariant: diag.sculptVariant ?? null };
  save();
  console.log(`[${label}] ready in ${manifest.boots[label].wallS} s; ${pool.length} x ${character}; skull ${diag.skull}, recipe ${J(diag.sculpt)} (${diag.sculptVariant})`);
  return manifest.boots[label];
}

/** The player's eye at world point `e`, looking at `t`. An eye above standing height is held by setting the pose
 *  again before every frame; an eye under it by the page's own eye height (the header's note). The camera takes it
 *  at syncCam. */
async function camAt(e, t) {
  const d = sub(t, e);
  await evaluate(`import("/src/lab/sdf-zombie/webgpu/game-player.ts").then((m) => { m.PLAYER.eye = ${Math.min(EYE_H, e[1])}; return 1; })`);
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, ${Math.max(0, e[1] - EYE_H)})`);
}
/** Photograph actor `id`'s head from `dist` m, the camera turned `yawDeg` about the head from straight in front. */
async function shot(col, character, view, id, dist, yawDeg) {
  const fr = await frameOf(id), f = await frontOf(id);
  const dir = turnY(f, yawDeg * Math.PI / 180);
  const eye = add(fr.centre, mul(dir, dist));
  eye[1] = fr.centre[1];
  await camAt(eye, fr.centre); await syncCam();
  const cam = await evaluate("__sdfGame.cameraWorld()");
  if (Math.abs(cam[1] - eye[1]) > 0.01) throw new Error(`the camera is at ${cam[1].toFixed(3)} m, not level with the head at ${eye[1].toFixed(3)} m`);
  await settle();
  await evaluate("__sdfGame.setRenderLock(true)");
  await stepOne(); await stepOne();
  await evaluate("__sdfGame.resolveGpu()");
  const png = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const name = `${col}__${character}__${view}`;
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.result.data, "base64"));
  const up = qRot(fr.quat, [0, 1, 0]);
  const c = await toPx(fr.centre), top = await toPx(add(fr.centre, mul(up, 0.1)));
  manifest.shots[name] = { col, character, view, actor: id, dist, yawDeg, headY: +fr.centre[1].toFixed(3), eyeY: +cam[1].toFixed(3), centre: c, pxPerM: c && top ? Math.hypot(top[0] - c[0], top[1] - c[1]) / 0.1 : null };
  save();
  console.log(`  shot ${name} (head and eye at ${fr.centre[1].toFixed(2)} m; ${manifest.shots[name].pxPerM?.toFixed(0)} px/m)`);
}
/** Take actor `id`'s flesh out of the frame (its proxy box shrunk to nothing); the bone meshes stay. A torso wound
 *  first: an actor with nothing exposed draws only its eyes. */
async function bare(id) {
  const fr = await frameOf(id), f = await frontOf(id);
  let hit = false;
  for (const drop of [0.45, 0.35, 0.55, 0.25, 0.7]) {
    const o = add(add(fr.centre, mul(f, 1.5)), [0, -drop, 0]), d = unit(sub(add(fr.centre, [0, -drop, 0]), o));
    hit = await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${id})`);
    if (hit) break;
  }
  if (!hit) throw new Error(`bare: no torso wound landed on actor ${id}`);
  await stepN(2);
  await evaluate(`(() => { const v = __sdfGame.zombie(${id}).view; v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); v.syncRecord(); return 1; })()`);
  await stepN(2);
}

let failed = 0;
for (const col of COLS) {
  if (col.query === undefined) { console.error(`unknown column ${col.name}`); failed++; continue; }
  for (const character of CAST) {
    try {
      const record = await boot(col, character);
      const a = pool[0];
      const fr = await frameOf(a.id);
      if (!fr) throw new Error("no head frame");
      await bare(a.id);
      Object.assign(record, { actor: a.id, headY: +fr.centre[1].toFixed(3) });
      await evaluate("__sdfGame.setVhs('blud')"); await settle();
      await shot(col.name, character, "ships-1p0-front", a.id, 1.0, 0);
      await evaluate("__sdfGame.setVhs(null)"); await settle();
      await shot(col.name, character, "clean-0p6-front", a.id, 0.6, 0);
      await shot(col.name, character, "clean-0p6-quarter", a.id, 0.6, 35);
      // What the head's bone is drawn with (read last: the bones are drawn once the wound's exposure has reached
      // them): the material's name and the paint it draws.
      const drawn = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${a.id}); return d ? d.whole.filter((q) => !q.eye).map((q) => ({ material: q.material, paint: q.paint, head: q.head })) : null; })()`);
      const headDraw = drawn?.find((q) => q.head) ?? null;
      if (!headDraw) throw new Error(`the head is not among actor ${a.id}'s ${drawn?.length ?? 0} bone draws`);
      Object.assign(record, { bones: drawn.length, paint: headDraw.paint, material: headDraw.material });
      const mesh = await evaluate("__sdfGame.skeletonMesh()");
      record.cache = mesh ? { entries: mesh.cacheEntries, totals: mesh.cacheTotals, stats: mesh.cacheStats } : null;
      record.gpu = await evaluate("__sdfGame.gpuDiagnostics()");
      if (manifest.failed) delete manifest.failed[`${col.name}/${character}`];
      save();
    } catch (e) {
      failed++;
      (manifest.failed ??= {})[`${col.name}/${character}`] = String(e.message ?? e).slice(0, 300);
      save();
      console.error(`FAIL [${col.name}/${character}]: ${e.stack ?? e}`);
    } finally { if (S) { closeSession(S); S = null; } }
  }
}
if (consoleErrors.length) { failed++; console.error(`FAIL: ${consoleErrors.length} console errors: ${J(consoleErrors.slice(0, 6))}`); }
manifest.errors = consoleErrors; save();
clearTimeout(DEADLINE);
console.log(`${Object.keys(manifest.shots).length} shots in ${OUT}; ${failed} failures`);
process.exit(failed ? 1 : 0);
