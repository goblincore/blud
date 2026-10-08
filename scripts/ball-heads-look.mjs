// scripts/ball-heads-look.mjs — the eight humanoids whose head bone is a few balls, before and after they were given
// a fitted anatomical skull: the frames of docs/dev-notes/2026-10-07-sculpt-skull-2/look/ball-heads-anatomical.jpg
// (scripts/ball-heads-sheet.py lays them out).
//
// Each column is one page query: `before` is `&skull=sculpt` (every character's sculpted bone: the balls), `after`
// the page with no skull parameter (the eight draw the anatomical skull, each under its own fit: skeleton-spike/
// skull-cast.ts). Each character is one boot of the bare ring page with every zombie slot that character
// (/sdf-game.html?spawn=<character>, frozen cast). Per boot:
//   flesh-front      one actor, a torso wound stamped (an unwounded actor draws no bones), its head intact, CLEAN
//                    (VHS off) from the front at 0.6 m, the eye level with the head;
//   bone-front       the same frame with that actor's flesh taken out of it: the sheet blends the two, which is the
//   bone-quarter     flesh half see-through over the bone; and the bone from three-quarter;
//   shot-front       ANOTHER actor, its face shot away with real rounds: pellet volleys (`fire(1)`) from 2 m, the
//   shot-quarter     crosshair AIM_UP over the head's centre (a volley lands about 10 cm under the crosshair), until
//                    the head has WANT wounds or VOLLEYS are spent or the head is off; the cast thawed a quarter of
//                    a second after each (a frozen body that a shot has moved is drawn clipped); then AS THE GAME
//                    SHIPS (VHS on), from 1.5 m at the player's own eye height, from the front and from
//                    three-quarter.
// THE EYE IS LEVEL WITH THE HEAD in the clean frames (the page's own eye height, game-player.ts PLAYER.eye, is set
// to the head's for a head under 1.62 m; nothing in the game does that). The shipped frames are taken from the
// player's real eye height, so a short character is seen from above, as in play.
//
// Output: <out>/<column>__<character>__<view>.png (the whole 1280 x 800 frame) and <out>/ball-heads.json: where the
// head is in each frame, what each boot drew, the fit and its numbers (__sdfGame.skullFit), the wounds the volleys
// left, and what the kit's fits cost.
//
// Usage (own servers): node scripts/ball-heads-look.mjs <vite port> <cdp port> <out dir>
//   COLS=before,after         the columns (before, after, or name=query for any other page query)
//   CAST=cultist,female       only those characters
//   VOLLEYS=2 WANT=5          at most that many pellet volleys at the face, until the head has that many wounds
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const VITE = Number(process.argv[2] ?? 5261), CDP = Number(process.argv[3] ?? 9261);
const OUT = process.argv[4] ?? ".lab-tmp/sculpt-skull/ball-heads";
const W = 1280, H = 800, EYE_H = 1.62, SETTLE = 24, VOLLEYS = Number(process.env.VOLLEYS ?? 2), WANT = Number(process.env.WANT ?? 5), THAW = 14, AIM_UP = 0.08;
/** The eight (skeleton-spike/skull-cast.ts BALL_HEADS). schoolgirl-alt cannot be spawned as a game actor. */
const BALL_HEADS = ["cultist", "cultist-cowled", "bride", "female", "schoolgirl", "schoolgirl-described", "bonewalker"];
const CAST = (process.env.CAST ?? BALL_HEADS.join(",")).split(",");
const COLUMNS = { before: "&skull=sculpt", after: "" };
const COLS = (process.env.COLS ?? "before,after").split(",").map((c) => (c.includes("=") && !(c in COLUMNS) ? { name: c.slice(0, c.indexOf("=")), query: c.slice(c.indexOf("=") + 1) } : { name: c, query: COLUMNS[c] }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
mkdirSync(OUT, { recursive: true });
// The whole run has a deadline: a hung page must not hold the capture lock.
const DEADLINE = setTimeout(() => { console.error("FAIL: the run's deadline passed"); process.exit(2); }, Number(process.env.DEADLINE_MS ?? 40 * 60 * 1000));

const manifestPath = `${OUT}/ball-heads.json`;
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
  manifest.boots[label] = { url, wallS: +((Date.now() - t0) / 1000).toFixed(1), skull: diag.skull, sculpt: diag.sculpt, sculptVariant: diag.sculptVariant ?? null, anatomical: diag.anatomical ?? null, skullFits: diag.skullFits ?? null };
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
/** Photograph actor `id`'s head from `dist` m, the camera turned `yawDeg` about the head from straight in front.
 *  `level`: the eye level with the head; else at the player's own eye height. `at`: the head frame to aim at (the
 *  one recorded before a shot moved or removed the head). */
async function shot(col, character, view, id, dist, yawDeg, level = true, at = null) {
  const fr = at ?? await frameOf(id), f = at ? unit([qRot(at.quat, [0, 0, 1])[0], 0, qRot(at.quat, [0, 0, 1])[2]]) : await frontOf(id);
  const dir = turnY(f, yawDeg * Math.PI / 180);
  const eye = add(fr.centre, mul(dir, dist));
  eye[1] = level ? fr.centre[1] : EYE_H;
  await camAt(eye, fr.centre); await syncCam();
  const cam = await evaluate("__sdfGame.cameraWorld()");
  if (Math.abs(cam[1] - eye[1]) > 0.01) throw new Error(`the camera is at ${cam[1].toFixed(3)} m, not at ${eye[1].toFixed(3)} m`);
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
/** A torso wound on actor `id` (an actor with nothing exposed draws only its eyes). */
async function torsoWound(id) {
  const fr = await frameOf(id), f = await frontOf(id);
  let hit = false;
  for (const drop of [0.45, 0.35, 0.55, 0.25, 0.7]) {
    const o = add(add(fr.centre, mul(f, 1.5)), [0, -drop, 0]), d = unit(sub(add(fr.centre, [0, -drop, 0]), o));
    hit = await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${id})`);
    if (hit) break;
  }
  if (!hit) throw new Error(`no torso wound landed on actor ${id}`);
  await stepN(2);
}
/** Take actor `id`'s flesh out of the frame (its proxy box shrunk to nothing); the bone meshes stay. */
async function bare(id) {
  await evaluate(`(() => { const v = __sdfGame.zombie(${id}).view; v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); v.syncRecord(); return 1; })()`);
  await stepN(2);
}

/** The gun, ready: full shells and the last shot's kick played out. */
async function ready() {
  const frames = Math.ceil((await evaluate("__sdfGame.reloadTotalSec")) * 60) + 12;
  await evaluate("__sdfGame.refillShells()"); await stepN(frames); await evaluate("__sdfGame.refillShells()");
}
/** Pellet volleys at actor `id`'s face from 2 m in front, the crosshair AIM_UP over the head's centre, from the
 *  player's real eye height, until the head has WANT wounds, VOLLEYS are spent or the head is off; the cast thawed
 *  THAW frames after each. Returns the volleys fired and the wounds they left on the head. */
async function shootFace(id) {
  await evaluate(`import("/src/lab/sdf-zombie/webgpu/game-player.ts").then((m) => { m.PLAYER.eye = ${EYE_H}; return 1; })`);
  await evaluate("__sdfGame.setViewModelVisible(true)");
  const headWounds = async () => (await evaluate(`__sdfGame.actorWounds(${id})`)).filter((w) => w.limb === "head").length;
  let volleys = 0;
  for (; volleys < VOLLEYS; volleys++) {
    const fr = await frameOf(id);
    if (!fr || (await headWounds()) >= WANT || !((await evaluate(`__sdfGame.flail.limbAlive(${id}, "head")`)) > 0)) break;
    const f = unit([qRot(fr.quat, [0, 0, 1])[0], 0, qRot(fr.quat, [0, 0, 1])[2]]);
    const eye = add(fr.centre, mul(f, 2)), d = sub(add(fr.centre, [0, AIM_UP, 0]), [eye[0], EYE_H, eye[2]]);
    await ready();
    await evaluate(`__sdfGame.placePlayer({ x: ${eye[0]}, z: ${eye[2]}, yaw: ${yawOf(d[0], d[2])}, pitch: ${Math.atan2(d[1], Math.hypot(d[0], d[2]))} })`);
    await stepOne(); await evaluate("__sdfGame.setAimPoint(0, 0)");
    let fired = false;
    for (let i = 0; i < 6 && !fired; i++) { await evaluate("__sdfGame.refillShells()"); fired = await evaluate("__sdfGame.fire(1)"); if (!fired) await stepN(90); }
    if (!fired) throw new Error("fire(1) never fired");
    await stepN(20);
    await evaluate("__sdfGame.freeze(false)"); await stepN(THAW); await evaluate("__sdfGame.freeze(true)"); await stepN(2);
  }
  await evaluate("__sdfGame.setViewModelVisible(false)");
  return { volleys, headWounds: await headWounds() };
}

let failed = 0;
for (const col of COLS) {
  if (col.query === undefined) { console.error(`unknown column ${col.name}`); failed++; continue; }
  for (const character of CAST) {
    try {
      const record = await boot(col, character);
      const a = pool[0], b = pool[1] ?? null;
      const fr = await frameOf(a.id);
      if (!fr) throw new Error("no head frame");
      Object.assign(record, { actor: a.id, headY: +fr.centre[1].toFixed(3) });
      await evaluate("__sdfGame.setVhs(null)"); await settle();
      // The fit of this character's skull, and where the game draws its eyes (before anything is shot).
      record.fit = await evaluate(`__sdfGame.skullFit(${a.id})`);
      record.headFrame = fr;
      await torsoWound(a.id);
      await shot(col.name, character, "flesh-front", a.id, 0.6, 0);
      await shot(col.name, character, "flesh-quarter", a.id, 0.6, 35);
      await bare(a.id);
      await shot(col.name, character, "bone-front", a.id, 0.6, 0);
      await shot(col.name, character, "bone-quarter", a.id, 0.6, 35);
      record.eyes = await evaluate(`__sdfGame.meshEyes(${a.id})`);
      const drawn = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${a.id}); return d ? d.whole.filter((q) => !q.eye).map((q) => ({ material: q.material, paint: q.paint, head: q.head })) : null; })()`);
      const headDraw = drawn?.find((q) => q.head) ?? null;
      Object.assign(record, { bones: drawn?.length ?? 0, paint: headDraw?.paint ?? null, material: headDraw?.material ?? null });
      if (b) {
        const before = await frameOf(b.id);
        await evaluate("__sdfGame.setBleed(true)");
        record.shot = { actor: b.id, ...(await shootFace(b.id)), headOn: (await evaluate(`__sdfGame.flail.limbAlive(${b.id}, "head")`)) > 0, phase: (await evaluate("__sdfGame.actorList()")).find((q) => q.id === b.id)?.phase };
        const now = (await frameOf(b.id)) ?? before;
        await evaluate("__sdfGame.setVhs('blud')"); await settle();
        await shot(col.name, character, "shot-front", b.id, 1.5, 0, false, now);
        await shot(col.name, character, "shot-quarter", b.id, 1.5, 35, false, now);
        await evaluate("__sdfGame.setVhs(null)");
      }
      record.skullFits = (await evaluate("__sdfGame.skeletonDiagnostics()")).skullFits ?? null;
      if (manifest.failed) delete manifest.failed[`${col.name}/${character}`];
      save();
      console.log(`  ${col.name}/${character}: fit ${J(record.fit && { name: record.fit.name, min: record.fit.min, max: record.fit.max })}; head material ${record.material}; shot ${J(record.shot)}`);
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
