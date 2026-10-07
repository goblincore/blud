// scripts/sculpt-skull-cast-look.mjs — every humanoid's bare head bone under the skull a page query draws, for the
// cast sheet under docs/dev-notes/2026-10-07-sculpt-skull-2/look/ (scripts/sculpt-skull-default-sheet.py lays the
// frames out).
//
// The second sculpt carves the zombie's and the soldier's heads only. Every other character's head is its plain
// authored bone, and a paint is drawn on it in the head's normalized coordinates: the sheet shows whether a paint's
// face (sockets, nose, teeth) sits on each bone.
//
// Each column is one page query and one boot of the bare ring page (/sdf-game.html, frozen cast). The characters are
// spawned one by one in the player's own room (__sdfGame.spawnDebugCharacter: the boot's spawn path), in a row, each
// given one torso wound (an unwounded actor draws no bones) and its flesh taken out of the frame. Each is shot CLEAN
// (VHS off) from 0.6 m, from the front and from three-quarter, and once as the game ships (VHS on) from 1 m. The eye
// is level with the head when the head is at or above the player's standing eye height (1.62 m); the game holds the
// player on the floor, so a lower head is seen from 1.62 m, looking down (the pitch is recorded).
//
// Output: <out>/<column>__<character>__<view>.png (the whole 1280 x 800 frame) and <out>/cast.json: where the head is
// in each frame, and what each boot drew (the skull, the recipe, the paint each character's head is drawn with).
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
/** Metres between two characters in the row, at most and at least; the row is fitted to the room. */
const SPACING_MAX = 1.5, SPACING_MIN = 0.9;
/** The row keeps this far from the room's walls (m). */
const WALL = 0.8;
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
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h] : null; };

async function boot(col) {
  const s = await openSession(col.name);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&loader=0${col.query}`;
  const t0 = Date.now();
  await send("Page.navigate", { url });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") throw new Error(`[${col.name}] backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") throw new Error(`[${col.name}] warm gate never reached ready`);
  await evaluate("__sdfGame.setLoopRunning(false)");
  // Everything on the page that is not the canvas: the HUD, the reticle, the dev panels.
  await evaluate(`(() => { for (const e of document.body.querySelectorAll("*")) { if (e.tagName !== "CANVAS" && !e.querySelector("canvas") && !e.closest("canvas")) e.style.visibility = "hidden"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setViewModelVisible(false)");
  await evaluate("__sdfGame.setBleed(false)");
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (["gib", "crowd"].every((k) => wb[k] === "ready") || ["gib", "crowd"].some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  // The same moment in every column: the dynamic lights' clock held at 0.
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); return 1; })()`);
  await stepN(60);
  const diag = await evaluate("__sdfGame.skeletonDiagnostics()");
  manifest.boots[col.name] = { url, wallS: +((Date.now() - t0) / 1000).toFixed(1), skull: diag.skull, sculpt: diag.sculpt, sculptVariant: diag.sculptVariant ?? null, heads: {} };
  save();
  console.log(`[${col.name}] ready in ${manifest.boots[col.name].wallS} s; skull ${diag.skull}, recipe ${J(diag.sculpt)} (${diag.sculptVariant})`);
}

/** The player's eye at world point `e`, looking at `t`. An eye above standing height is held by setting the pose
 *  again before every frame; the camera takes it at syncCam. */
async function camAt(e, t) {
  const d = sub(t, e);
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, ${Math.max(0, e[1] - EYE_H)})`);
}
/** Photograph actor `id`'s head from `dist` m, the camera turned `yawDeg` about the head from straight in front. */
async function shot(col, character, view, id, dist, yawDeg) {
  const fr = await frameOf(id), f = await frontOf(id);
  const dir = turnY(f, yawDeg * Math.PI / 180);
  const eye = add(fr.centre, mul(dir, dist));
  eye[1] = Math.max(EYE_H, fr.centre[1]);
  await camAt(eye, fr.centre); await syncCam();
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
  const pitchDeg = Math.atan2(fr.centre[1] - eye[1], dist) * 180 / Math.PI;
  manifest.shots[name] = { col, character, view, actor: id, dist, yawDeg, headY: +fr.centre[1].toFixed(3), eyeY: +eye[1].toFixed(3), pitchDeg: +pitchDeg.toFixed(1), centre: c, pxPerM: c && top ? Math.hypot(top[0] - c[0], top[1] - c[1]) / 0.1 : null };
  save();
  console.log(`  shot ${name} (head at ${fr.centre[1].toFixed(2)} m, pitch ${pitchDeg.toFixed(1)} deg; ${manifest.shots[name].pxPerM?.toFixed(0)} px/m)`);
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
  try {
    await boot(col);
    const record = manifest.boots[col.name];
    // The row: through the player's spawn, across the way the first character faces, so no character stands behind
    // another's head in a frame.
    const start = await evaluate("__sdfGame.pose()");
    const roomKey = await evaluate("__sdfGame.room()");
    const box = await evaluate(`(() => { const b = __sdfGame.enclosureBoxAt(${start.pos[0]}, ${start.pos[2]}), v = (p) => (Array.isArray(p) ? [...p] : [p.x, p.y, p.z]); return b ? { min: v(b.min), max: v(b.max) } : null; })()`);
    if (!box) throw new Error(`the player's spawn (${roomKey}) is in no enclosure`);
    // The first character takes the row's middle place; the others fill it from one end to the other.
    const middle = Math.floor((CAST.length - 1) / 2), placeOf = (i) => (i === 0 ? middle : i <= middle ? i - 1 : i);
    const mid = [(box.min[0] + box.max[0]) / 2, 0, (box.min[2] + box.max[2]) / 2];
    let across = null, spacing = SPACING_MAX;
    for (let i = 0; i < CAST.length; i++) {
      const character = CAST[i];
      try {
        const at = across ? add(mid, mul(across, (placeOf(i) - middle) * spacing)) : mid;
        const made = await evaluate(`__sdfGame.spawnDebugCharacter(${J(character)}, ${J(at)})`);
        if (made.errors.length) throw new Error(`spawn errors: ${made.errors.join(" | ")}`);
        await stepN(3);
        const fr = await frameOf(made.id);
        if (!fr) throw new Error("no head frame");
        if (!across) {
          // The first character stands at the room's middle and says which way the cast faces; the row runs across
          // that, along the room's nearer axis.
          const f = await frontOf(made.id);
          across = Math.abs(f[0]) > Math.abs(f[2]) ? [0, 0, 1] : [1, 0, 0];
          const k = across[0] ? 0 : 2, room = box.max[k] - box.min[k] - 2 * WALL;
          spacing = Math.min(SPACING_MAX, room / Math.max(1, CAST.length));
          record.row = { room: roomKey, box, across, spacing: +spacing.toFixed(2), front: f };
          console.log(`  the row: room ${roomKey} ${J(box)}, across ${J(across)}, ${spacing.toFixed(2)} m apart; the cast faces ${J(f.map((v) => +v.toFixed(2)))}`);
          if (spacing < SPACING_MIN) throw new Error(`the room fits the cast only ${spacing.toFixed(2)} m apart (< ${SPACING_MIN} m)`);
        }
        await bare(made.id);
        // What the head's bone batch is drawn with: the material's name, and the paint when the renderer says.
        const drawn = await evaluate(`(() => { const d = __sdfGame.skullDrawn(${made.id}); return d ? d.whole.filter((q) => !q.eye).map((q) => ({ material: q.material, paint: q.paint ?? null, head: q.head ?? null })) : null; })()`);
        const headDraw = drawn?.find((q) => q.head) ?? null;
        record.heads[character] = { actor: made.id, at, headY: +fr.centre[1].toFixed(3), bones: drawn?.length ?? 0, paint: headDraw?.paint ?? null, material: headDraw?.material ?? null };
        await evaluate("__sdfGame.setVhs('blud')"); await settle();
        await shot(col.name, character, "ships-1p0-front", made.id, 1.0, 0);
        await evaluate("__sdfGame.setVhs(null)"); await settle();
        await shot(col.name, character, "clean-0p6-front", made.id, 0.6, 0);
        await shot(col.name, character, "clean-0p6-quarter", made.id, 0.6, 35);
        save();
      } catch (e) { failed++; console.error(`FAIL [${col.name}/${character}]: ${e.stack ?? e}`); }
    }
    const mesh = await evaluate("__sdfGame.skeletonMesh()");
    record.cache = mesh ? { entries: mesh.cacheEntries, totals: mesh.cacheTotals, stats: mesh.cacheStats } : null;
    record.gpu = await evaluate("__sdfGame.gpuDiagnostics()");
    save();
  } catch (e) { failed++; console.error(`FAIL [${col.name}]: ${e.stack ?? e}`); }
  finally { if (S) { closeSession(S); S = null; } }
}
if (consoleErrors.length) { failed++; console.error(`FAIL: ${consoleErrors.length} console errors: ${J(consoleErrors.slice(0, 6))}`); }
manifest.errors = consoleErrors; save();
clearTimeout(DEADLINE);
console.log(`${Object.keys(manifest.shots).length} shots in ${OUT}; ${failed} failures`);
process.exit(failed ? 1 : 0);
