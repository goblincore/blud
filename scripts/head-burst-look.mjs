// scripts/head-burst-look.mjs — what the gun does to a zombie's head, photographed and measured, for the before and
// after sheet under docs/dev-notes/2026-10-07-sculpt-skull-2/look/ (scripts/head-burst-sheet.py lays the frames out).
//
// One boot of the bare ring page (/sdf-game.html, `?sculpt=full` unless QUERY says otherwise). The cast is frozen so
// a zombie can be staged, and THAWED FOR A SECOND AFTER EVERY ROUND: a frozen actor takes the hit's shove on its rig
// and never springs back (its head stays knocked centimetres off its neck), and the march's outer hull is built once
// per frozen stretch, so a frozen body that moved is drawn clipped to where it used to be. A second of real play
// lets the body react and rebuilds the hulls; then it is frozen again and photographed. Every round is a REAL one
// (fire(1) is a grapeshot volley, fireSlug() a slug), aimed with the crosshair as a player aims. The scenes, each on
// a fresh zombie:
//   pellets     three volleys with the crosshair on the head's centre, from 2 m in front (stages pellets-1, -2, -3);
//   slug-chin   one slug with the crosshair low enough that its line runs off centre (it lands on the chin);
//   slug-split  one slug with the crosshair 4 cm over the head's centre: the centred slug;
//   slug-pop    slugs at the neck until the head comes off, every frame of the last one kept (stage slug-pop,
//               frames f00..); then the same pop by hand on a zombie whose flesh is out of the frame (pop-bare), so
//               the skull's pieces can be seen leaving.
// After every round the script records the head-shot leaf's verdict, the head leaf's state (the opening's craters
// and deform, when the opening is on), the head's wounds, whether the head is still on, and THE PROFILE: per
// landmark of the skull's face how far forward the bone's front and the flesh's front stand, on the CPU fields
// (profileOf) and on the picture (pixelProfile).
// Every stage is photographed AS THE GAME SHIPS (the default post chain with VHS on, wounds bleeding) from 1.5 m at
// the player's eye height, front and profile, and CLEAN (VHS off, blood drops cleared) from 0.6 m, front and profile.
//
// Output: <out>/<label>__<stage>__<view>.png (the whole 1280 x 800 frame) and <out>/<label>.json (where the head is in
// each frame, and everything recorded).
//
// Usage (own servers): node scripts/head-burst-look.mjs <vite port> <cdp port> <out dir>
//   LABEL=after          the files' prefix (default "look")
//   OLD=1                the behaviour before 2026-10-07, put back with burstTune (the sheet's "before" column)
//   TUNE='{"popSwellS":0.2}'   any other __sdfGame.head.burstTune(...) applied at boot
//   SCENES=pellets,slug-pop    only those scenes          QUERY='&skull=sculpt'   the page query (default &sculpt=full)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const VITE = Number(process.argv[2] ?? 5261), CDP = Number(process.argv[3] ?? 9261);
const OUT = process.argv[4] ?? ".lab-tmp/head-burst-look";
const LABEL = process.env.LABEL ?? "look";
const QUERY = process.env.QUERY ?? "&sculpt=full";
/** The tuning before 2026-10-07: every gun hit on a head made the opening (head-burst.ts BURST_TUNING_DEFAULTS). */
const OLD_TUNE = { opening: true, anyWeapon: true, alwaysSplit: true, slugSplit: false, slugPop: false, popOnSplit: false };
const TUNE = process.env.OLD ? { ...OLD_TUNE, ...(process.env.TUNE ? JSON.parse(process.env.TUNE) : {}) } : process.env.TUNE ? JSON.parse(process.env.TUNE) : null;
const SCENES = new Set((process.env.SCENES ?? "pellets,slug-chin,slug-split,slug-pop").split(","));
const THAW = Number(process.env.THAW ?? 60), STRIP = 30;
const W = 1280, H = 800, EYE_H = 1.62, SETTLE = 24, SHOT_M = 2, SHIPS_M = 1.5, CLEAN_M = 0.6, MASK_M = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
mkdirSync(OUT, { recursive: true });
// The whole run has a deadline: a hung page must not hold the capture lock.
const DEADLINE = setTimeout(() => { console.error("FAIL: the run's deadline passed"); process.exit(2); }, Number(process.env.DEADLINE_MS ?? 25 * 60 * 1000));

const manifest = { label: LABEL, query: QUERY, tune: TUNE, shots: {}, stages: {}, rounds: {} };
const save = () => writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(manifest, null, 1) + "\n");

// THE SKULL'S FACE IN PROFILE: landmarks of the zombie's head in the flesh head frame's own coordinates (metres from
// the frame's centre: x right, y up, z forward), read off the rest body (the head bone segment's box is 100.7 x 130.8
// x 104.2 mm half-extents about a centre 12.8 mm under and 6.6 mm in front of the flesh frame's).
const LANDMARKS = [
  ["brow ridge", 0.0526], ["nasion", 0.0159], ["nose bridge", 0.0029], ["upper teeth", -0.0482], ["lower teeth", -0.0783], ["chin", -0.1110],
];

// ---- One CDP tab -----------------------------------------------------------------------------------------------------
let S = null;
const consoleErrors = [], burstLog = [];
async function openSession(label) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), label, rect: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 600);
      if (m.params.type === "error") consoleErrors.push({ label, text });
      if (text.startsWith("[head-burst]") || text.startsWith("[head-shot]")) burstLog.push(text);
    }
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

// ---- Vectors, PNG ------------------------------------------------------------------------------------------------------
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
function decodePng(buf) {
  let off = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++], row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null, cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
/** The pixels of `a` that differ from `b` by more than `t` in some channel. */
const differs = (a, b, x, y, t = 14) => { const i = (y * a.w + x) * a.ch; return Math.abs(a.data[i] - b.data[i]) > t || Math.abs(a.data[i + 1] - b.data[i + 1]) > t || Math.abs(a.data[i + 2] - b.data[i + 2]) > t; };

// ---- The page ----------------------------------------------------------------------------------------------------------
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const syncCam = () => evaluate("__sdfGame.step(1, 0)");
/** Re-render without stepping the sim: the post chain mixes each frame with the ones before it. */
const settle = async (n = SETTLE) => { await evaluate("__sdfGame.setRenderLock(true)"); for (let i = 0; i < n; i++) await stepOne(); await evaluate("__sdfGame.setRenderLock(false)"); };
/** Actor `id`'s head frame; the last one it had once the head is gone (the frames of a headless body are aimed at
 *  where its head was). */
const lastFrame = new Map();
const frameOf = async (id) => { const fr = await evaluate(`__sdfGame.head.frame(${id})`); if (fr) lastFrame.set(id, fr); return fr ?? lastFrame.get(id) ?? null; };
const frontOf = async (id) => { const fr = await frameOf(id); const f = qRot(fr.quat, [0, 0, 1]); return unit([f[0], 0, f[2]]); };
let pool = [], used = new Set();
function fresh() { const z = pool.find((q) => !used.has(q.id)); if (!z) throw new Error("ran out of fresh zombies"); used.add(z.id); return z; }

async function boot() {
  const s = await openSession(LABEL);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&loader=0${QUERY}`;
  await send("Page.navigate", { url });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") throw new Error(`backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") throw new Error("warm gate never reached ready");
  await evaluate("__sdfGame.setLoopRunning(false)");
  // Everything on the page that is not the canvas: the HUD, the reticle, the dev panels.
  await evaluate(`(() => { for (const e of document.body.querySelectorAll("*")) { if (e.tagName !== "CANVAS" && !e.querySelector("canvas") && !e.closest("canvas")) e.style.visibility = "hidden"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  await evaluate("__sdfGame.setFreeAim(true)"); await evaluate("__sdfGame.setAimPoint(0, 0)");
  await evaluate("__sdfGame.setViewModelVisible(false)");
  const named = await evaluate("__sdfGame.brains().map((b) => ({ id: b.id, name: b.name }))");
  const all = (await evaluate("__sdfGame.actorList()")).filter((z) => named.find((b) => b.id === z.id)?.name === "zombie");
  const byRoom = new Map();
  for (const z of all) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM); used = new Set();
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (["gib", "crowd"].every((k) => wb[k] === "ready") || ["gib", "crowd"].some((k) => wb[k] === "failed")) break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); return 1; })()`);
  if (TUNE) await evaluate(`__sdfGame.head.burstTune(${J(TUNE)})`);
  await stepN(90);
  manifest.url = url;
  manifest.tuning = await evaluate("__sdfGame.head.burstTuning()");
  manifest.skeleton = await evaluate("(() => { const d = __sdfGame.skeletonDiagnostics(); return { skull: d.skull, sculpt: d.sculpt }; })()");
  save();
  console.log(`[${LABEL}] ready; room ${ROOM}, ${pool.length} zombies; skull ${J(manifest.skeleton)}; tuning ${J(manifest.tuning)}`);
}

async function camAt(e, t) {
  const d = sub(t, e);
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, ${e[1] - EYE_H})`);
}
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h] : null; };
/** The camera `dist` m from actor `id`'s head, turned `yawDeg` about it from straight in front, at the player's eye
 *  height. Returns the head frame and the look target. */
async function view(id, dist, yawDeg) {
  const fr = await frameOf(id), f = await frontOf(id);
  const eye = add(fr.centre, mul(turnY(f, yawDeg * Math.PI / 180), dist));
  eye[1] = EYE_H;
  await camAt(eye, fr.centre); await syncCam();
  return { fr, f };
}
async function grab() {
  await settle();
  await evaluate("__sdfGame.setRenderLock(true)");
  await stepOne(); await stepOne();
  const png = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  return Buffer.from(png.result.data, "base64");
}
async function shot(stage, name, id, dist, yawDeg) {
  const { fr } = await view(id, dist, yawDeg);
  const buf = await grab();
  const file = `${LABEL}__${stage}__${name}`;
  writeFileSync(`${OUT}/${file}.png`, buf);
  const up = qRot(fr.quat, [0, 1, 0]);
  const c = await toPx(fr.centre), top = await toPx(add(fr.centre, mul(up, 0.1)));
  manifest.shots[file] = { stage, view: name, actor: id, dist, yawDeg, centre: c, pxPerM: c && top ? Math.hypot(top[0] - c[0], top[1] - c[1]) / 0.1 : null };
  save();
  return buf;
}
/** Take actor `id`'s flesh out of the frame (its proxy box shrunk to nothing; the bone meshes stay), or put it back. */
const fleshShown = (id, on) => evaluate(`(() => {
  const v = __sdfGame.zombie(${id}).view, k = (window.__lookHidden ??= new Map());
  if (${on}) { const s = k.get(${id}); if (s) { v.uniforms.bodyHalf.value.copy(s.half); v.object.scale.copy(s.scale); k.delete(${id}); } }
  else if (!k.has(${id})) { k.set(${id}, { half: v.uniforms.bodyHalf.value.clone(), scale: v.object.scale.clone() }); v.uniforms.bodyHalf.value.multiplyScalar(1e-4); v.object.scale.multiplyScalar(1e-4); }
  v.syncRecord(); return 1; })()`);

/** THE PROFILE ON THE CPU FIELDS. For each landmark height (head frame y, taken through the head's deform), over
 *  columns across the head (x, every 6 mm), the forward-most point (head frame z, mm from the frame's centre) of:
 *    bone   the head's bone field (the authored skull; the second sculpt's brow, nasion, nose bridge and teeth are
 *           the authored bone's own front: see NOTES);
 *    flesh  the posed flesh with every head wound's carve taken out (the round carve, a sphere clipped by its depth
 *           slab: the torn edge's ragged growth and the everted lip are not modelled).
 *  `mid` is the column on the head's middle line, `sil` the most forward column: what a pure profile shows. */
const profileOf = (id) => evaluate(`(() => {
  const G = __sdfGame, fr = G.head.frame(${id}), st = G.head.state(${id});
  if (!fr) return null;
  const q = fr.quat, c = fr.centre;
  const rot = (v) => { const [x, y, z, w] = q; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; };
  const world = (l) => { const r = rot(l); return [c[0] + r[0], c[1] + r[1], c[2] + r[2]]; };
  const m = st?.deform ?? { mul: [1, 1, 1], shift: [0, 0, 0] };
  const wounds = G.actorWounds(${id}).filter((w) => w.limb === "head" && w.shape === "crater");
  const carved = (p) => wounds.some((w) => {
    const d = [p[0] - w.pos[0], p[1] - w.pos[1], p[2] - w.pos[2]];
    if (Math.hypot(d[0], d[1], d[2]) >= w.radius) return false;
    return !w.inward || w.carveDepth === null || d[0] * w.inward[0] + d[1] * w.inward[1] + d[2] * w.inward[2] < w.carveDepth;
  });
  const front = (x, y, solid) => { for (let z = 0.26; z >= -0.26; z -= 0.001) { if (solid(world([x, y, z]))) return z; } return null; };
  const rows = [];
  for (const [name, y0] of ${J(LANDMARKS)}) {
    const y = y0 * m.mul[1] + m.shift[1];
    let bone = { mid: null, sil: null }, flesh = { mid: null, sil: null };
    for (let i = -20; i <= 20; i++) {
      const x = i * 0.006;
      const b = front(x, y, (p) => G.head.boneAt(${id}, p[0], p[1], p[2]) <= 0);
      const f = front(x, y, (p) => G.head.surfaceAt(${id}, p[0], p[1], p[2]) <= 0 && !carved(p));
      if (i === 0) { bone.mid = b; flesh.mid = f; }
      if (b !== null && (bone.sil === null || b > bone.sil)) bone.sil = b;
      if (f !== null && (flesh.sil === null || f > flesh.sil)) flesh.sil = f;
    }
    const mm = (v) => (v === null ? null : Math.round(v * 10000) / 10);
    rows.push({ name, y: Math.round(y * 10000) / 10, boneMid: mm(bone.mid), fleshMid: mm(flesh.mid), boneSil: mm(bone.sil), fleshSil: mm(flesh.sil),
      proudMid: bone.mid === null || flesh.mid === null ? null : mm(bone.mid - flesh.mid), proudSil: bone.sil === null || flesh.sil === null ? null : mm(bone.sil - flesh.sil) });
  }
  // The head's extents along its own axes at the frame's centre: the flesh with the carves out, and uncarved.
  const span = (axis, solid) => { let lo = null, hi = null; for (let t = -0.3; t <= 0.3; t += 0.001) { const l = [0, 0, 0]; l[axis] = t; if (solid(world(l))) { lo ??= t; hi = t; } } return lo === null ? null : [Math.round(lo * 10000) / 10, Math.round(hi * 10000) / 10]; };
  const fleshIn = (p) => G.head.surfaceAt(${id}, p[0], p[1], p[2]) <= 0, left = (p) => fleshIn(p) && !carved(p);
  return { rows, extents: { skin: [0, 1, 2].map((k) => span(k, fleshIn)), carved: [0, 1, 2].map((k) => span(k, left)) }, wounds: wounds.length };
})()`, 240000);

/** THE SAME ON THE PICTURE: a clean profile from MASK_M with the flesh alone, the bone alone and neither; per landmark
 *  row, the forward-most flesh pixel and the forward-most bone pixel, in mm in front of the head frame's centre. A
 *  perspective picture: a rim of flesh on the camera's side of the head reads about 6% further forward than it is. */
async function pixelProfile(stage, id) {
  const { fr, f } = await view(id, MASK_M, 90);
  await evaluate("__sdfGame.meshSkeletonShow({ bones: false, eyes: false })");
  const flesh = decodePng(await grab());
  await fleshShown(id, false);
  const none = decodePng(await grab());
  await evaluate("__sdfGame.meshSkeletonShow({ bones: true })");
  const bone = decodePng(await grab());
  await evaluate("__sdfGame.meshSkeletonShow({ bones: true, eyes: true })");
  await fleshShown(id, true);
  await settle();
  const st = await evaluate(`__sdfGame.head.state(${id})`);
  const m = st?.deform ?? { mul: [1, 1, 1], shift: [0, 0, 0] };
  const c = await toPx(fr.centre), fpx = await toPx(add(fr.centre, mul(f, 0.1)));
  if (!c || !fpx) return null;
  const pxPerM = (fpx[0] - c[0]) / 0.1;   // signed: which way the face points on the picture
  const dir = Math.sign(pxPerM), rows = [];
  for (const [name, y0] of LANDMARKS) {
    const p = await toPx(add(fr.centre, qRot(fr.quat, [0, y0 * m.mul[1] + m.shift[1], 0])));
    if (!p) continue;
    const edge = (img) => {
      let best = null;
      for (let y = Math.round(p[1]) - 1; y <= Math.round(p[1]) + 1; y++) {
        for (let x = Math.round(c[0] + dir * 0.2 * Math.abs(pxPerM)); x !== Math.round(c[0] - dir * 0.2 * Math.abs(pxPerM)); x -= dir) {
          if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
          if (differs(img, none, x, y)) { const z = (x - c[0]) / pxPerM; if (best === null || z > best) best = z; break; }
        }
      }
      return best === null ? null : Math.round(best * 10000) / 10;
    };
    const b = edge(bone), fl = edge(flesh);
    rows.push({ name, bone: b, flesh: fl, proud: b === null || fl === null ? null : Math.round((b - fl) * 10) / 10 });
  }
  return { mmPerPx: +(1000 / Math.abs(pxPerM)).toFixed(2), rows };
}

async function aimAt(id, dist, yawDeg = 0, aim = [0, -0.02, 0]) {
  const fr = await frameOf(id), f = await frontOf(id);
  const target = add(fr.centre, aim), eye = add(target, mul(turnY(f, yawDeg * Math.PI / 180), dist));
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
const r4 = (v) => (typeof v === "number" ? +v.toFixed(4) : Array.isArray(v) ? v.map(r4) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)])) : v);

/** Let the cast play for THAW frames (the header), then hold it again. */
async function thaw() {
  if (THAW > 0) { await evaluate("__sdfGame.freeze(false)"); await stepN(THAW); await evaluate("__sdfGame.freeze(true)"); }
  await stepN(2);
}
const headOn = async (id) => (await evaluate(`__sdfGame.flail.limbAlive(${id}, "head")`)) > 0;
/** Where a slug fired now would go: how far its line passes from actor `id`'s head centre (head radii, the drop
 *  included), and what it would hit. */
async function slugLine(id) {
  const fr = await frameOf(id), pr = await evaluate("__sdfGame.predictSlugHit()");
  const R = Math.cbrt(fr.axes[0] * fr.axes[1] * fr.axes[2]);
  const t = (fr.centre[0] - pr.origin[0]) * pr.dir[0] + (fr.centre[1] - pr.origin[1]) * pr.dir[1] + (fr.centre[2] - pr.origin[2]) * pr.dir[2];
  const drop = 0.5 * 6 * (Math.max(0, t) / 30) ** 2;
  const cp = [pr.origin[0] + pr.dir[0] * t, pr.origin[1] + pr.dir[1] * t - drop, pr.origin[2] + pr.dir[2] * t];
  return { offset: Math.hypot(cp[0] - fr.centre[0], cp[1] - fr.centre[1], cp[2] - fr.centre[2]) / R, actor: pr.actorId };
}
/** What a round did to actor `id`, recorded as `key`. */
async function record(key, id, what, aim, extra = {}) {
  const st = await evaluate(`__sdfGame.head.state(${id})`);
  const wounds = await evaluate(`__sdfGame.actorWounds(${id})`);
  const on = await headOn(id);
  const rec = {
    round: what, aim, ...extra,
    headOn: on, phase: (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id)?.phase,
    shot: await evaluate(`__sdfGame.head.shot(${id})`), split: r4(await evaluate(`__sdfGame.headSplit(${id})`)),
    wounds: wounds.length,
    headWounds: wounds.filter((w) => w.limb === "head").map((w) => r4({ region: w.headRegion, radius: w.radius, carveDepth: w.carveDepth, type: w.type, shape: w.shape })),
    burst: st?.burst ?? null, craters: r4(st?.craters ?? null), bu: r4(st?.bu ?? null), flat: r4(st?.flat ?? null), deform: r4(st?.deform ?? null),
    profile: on ? await profileOf(id) : null,
  };
  manifest.rounds[key] = rec; save();
  console.log(`  ${key}: ${rec.log?.join(" | ") || "(no head rule fired)"}; verdict ${J(rec.shot)}; head ${on ? "on" : "OFF"}, ${rec.phase}; ${rec.wounds} wounds, ${rec.headWounds.length} on the head (${rec.headWounds.map((w) => `${w.shape === "cut" ? "cut" : "r"}${w.radius}`).join(" ")})${rec.split ? `; split ${rec.split.preset} angle ${rec.split.angle} of target ${rec.split.target}` : ""}${rec.craters ? `; opening craters ${J(Object.fromEntries(Object.entries(rec.craters).map(([k, c]) => [k, `r ${c.radius} depth ${c.carveDepth}`])))}; deform ${J(rec.deform)}` : ""}`);
  if (rec.profile) for (const r of rec.profile.rows) console.log(`      ${r.name.padEnd(12)} bone ${String(r.boneMid).padStart(6)} flesh ${String(r.fleshMid).padStart(6)} on the middle line (bone proud ${r.proudMid}); in silhouette bone ${r.boneSil} flesh ${r.fleshSil} (proud ${r.proudSil})`);
  return rec;
}
/** One real round at actor `id` with the crosshair `aim` from its head's centre, from `yawDeg` round it; then the
 *  thaw. Recorded as `key`. */
async function round(key, id, what, aim = [0, 0, 0], yawDeg = 0) {
  const log0 = burstLog.length;
  await aimAt(id, SHOT_M, yawDeg, aim);
  const line = what.includes("Slug") ? await slugLine(id) : null;
  await fire(what);
  await stepN(12);
  await thaw();
  return record(key, id, what, aim, { fromYawDeg: yawDeg, log: burstLog.slice(log0), line: line ? { offset: +line.offset.toFixed(3), wouldHit: line.actor } : null });
}

const vhsOff = async () => { await evaluate("__sdfGame.setVhs(null)"); await settle(); };
const vhsOn = async () => { await evaluate("__sdfGame.setVhs('blud')"); await settle(); };
/** A stage's photographs (see the header) and its picture profile. */
async function photograph(stage, id) {
  const on = await headOn(id);
  if (!on) {
    // A headless body: the camera is aimed over its shoulders, where the head would be.
    const t = await evaluate(`__sdfGame.actorLimbCenter(${id}, "torso")`), fr = lastFrame.get(id);
    if (!t || !fr) { console.log(`  ${stage}: the body is gone; nothing photographed`); return; }
    lastFrame.set(id, { ...fr, centre: [t[0], t[1] + 0.4, t[2]] });
  }
  await shot(stage, "ships-front", id, SHIPS_M, 0);
  await shot(stage, "ships-profile", id, SHIPS_M, 90);
  await vhsOff();
  await evaluate("__sdfGame.setBleed(false)"); await stepN(2);
  await shot(stage, "clean-front", id, CLEAN_M, 0);
  await shot(stage, "clean-profile", id, CLEAN_M, 90);
  const px = on ? await pixelProfile(stage, id) : null;
  manifest.stages[stage] = { actor: id, headOn: on, picture: px }; save();
  if (px) console.log(`  ${stage} picture profile (${px.mmPerPx} mm per pixel): ${px.rows.map((r) => `${r.name} bone ${r.bone} flesh ${r.flesh} proud ${r.proud}`).join("; ")}`);
  await evaluate("__sdfGame.setBleed(true)");
  await vhsOn();
}
/** What is drawn within 0.3 m of `c`, in short. */
const census = async (c) => {
  const n = await evaluate(`__sdfGame.head.drawnNear(${c[0]}, ${c[1]}, ${c[2]}, 0.3)`);
  return { bones: n.bones.filter((b) => !b.eye).length, eyes: n.bones.filter((b) => b.eye).length, attached: n.attached.length,
    chunks: n.chunks.map((q) => [q.tag ?? q.kind, q.speed]), meshGibs: n.meshGibs.map((g) => [g.tag, g.speed]), flesh: n.flesh.length };
};
/** THE STRIP: every frame from now for STRIP frames, as the game draws it (no settling: the post chain's smear is in
 *  the picture, as in play), from 1.5 m, three-quarter. Each frame's file and what the head was doing in it. */
async function strip(stage, id, centre, forward, each) {
  const eye = add(centre, mul(turnY(forward, 35 * Math.PI / 180), SHIPS_M)); eye[1] = EYE_H;
  await camAt(eye, centre); await syncCam();
  const c = await toPx(centre), top = await toPx(add(centre, [0, 0.1, 0]));
  const frames = [];
  for (let k = 0; k < STRIP; k++) {
    await stepOne();
    await evaluate("__sdfGame.setRenderLock(true)"); await stepOne();
    const png = await send("Page.captureScreenshot", { format: "png" });
    await evaluate("__sdfGame.setRenderLock(false)");
    const file = `${LABEL}__${stage}__f${String(k).padStart(2, "0")}`;
    writeFileSync(`${OUT}/${file}.png`, Buffer.from(png.result.data, "base64"));
    manifest.shots[file] = { stage, view: `f${String(k).padStart(2, "0")}`, actor: id, centre: c, pxPerM: c && top ? Math.hypot(top[0] - c[0], top[1] - c[1]) / 0.1 : null };
    frames.push({ k, popping: await evaluate(`__sdfGame.head.popping(${id})`), headOn: await headOn(id), fragments: (await evaluate("__sdfGame.skullFragments()")).length, ...(each ? await each(k) : {}) });
  }
  save();
  return frames;
}

let failed = 0;
try {
  await boot();
  if (SCENES.has("pellets")) {
    const a = fresh();
    manifest.rounds["pellets-0"] = { profile: await profileOf(a.id) }; save();
    console.log(`  intact head: ${manifest.rounds["pellets-0"].profile.rows.map((r) => `${r.name} bone ${r.boneMid} flesh ${r.fleshMid}`).join("; ")}`);
    for (let n = 1; n <= 3; n++) { await round(`pellets-${n}`, a.id, "__sdfGame.fire(1)"); await photograph(`pellets-${n}`, a.id); }
  }
  if (SCENES.has("slug-chin")) {
    // The crosshair is lowered a centimetre at a time until the slug's line runs off centre and still meets this zombie.
    const a = fresh();
    let aim = [0, -0.02, 0], line = null;
    for (let k = 0; k < 10; k++) {
      aim = [0, -0.02 - k * 0.01, 0];
      await aimAt(a.id, SHOT_M, 0, aim);
      line = await slugLine(a.id);
      if (line.offset > manifest.tuning.splitFrac + 0.03) break;
    }
    console.log(`  slug-chin: crosshair ${(-aim[1] * 100).toFixed(0)} cm under the head's centre; the slug's line passes ${line.offset.toFixed(2)} head radii from it, and would hit actor ${line.actor} (the target is ${a.id})`);
    await round("slug-chin", a.id, "__sdfGame.fireSlug()", aim); await photograph("slug-chin", a.id);
  }
  if (SCENES.has("slug-split")) {
    const a = fresh();
    await round("slug-split", a.id, "__sdfGame.fireSlug()", [0, 0.04, 0]); await photograph("slug-split", a.id);
  }
  if (SCENES.has("slug-pop")) {
    // Slugs at the neck (the crosshair 6 cm under the head's centre lands them under the chin), from 40 degrees to
    // one side, until the head leaves. The cast plays for the half second each slug's strip is shot in, and is held
    // between slugs.
    const a = fresh();
    let done = false;
    for (let n = 1; n <= 10 && !done; n++) {
      const log0 = burstLog.length;
      if (!(await evaluate(`__sdfGame.head.frame(${a.id})`))) break;
      const fr = await frameOf(a.id), f = await frontOf(a.id);
      await aimAt(a.id, SHOT_M, 40, [0, -0.06, 0]);
      const line = await slugLine(a.id);
      await fire("__sdfGame.fireSlug()");
      await evaluate("__sdfGame.freeze(false)");
      const frames = await strip("slug-pop", a.id, fr.centre, f);
      await evaluate("__sdfGame.freeze(true)"); await stepN(2);
      const off = frames.find((q) => !q.headOn), swell = frames.filter((q) => q.popping).length;
      const rec = await record(`slug-pop-${n}`, a.id, "__sdfGame.fireSlug()", [0, -0.06, 0], { log: burstLog.slice(log0), line: { offset: +line.offset.toFixed(3), wouldHit: line.actor } });
      if (off) {
        done = true;
        rec.pop = { slug: n, firstSwellFrame: frames.find((q) => q.popping)?.k ?? null, swellFrames: swell, headOffFrame: off.k, fragmentsAtBurst: off.fragments,
          fragmentCuts: await evaluate("__sdfGame.skullFragmentCuts()"), near: await census(fr.centre) };
        await evaluate("__sdfGame.freeze(false)"); await stepN(150); await evaluate("__sdfGame.freeze(true)"); await stepN(2);
        const t = await evaluate(`__sdfGame.actorLimbCenter(${a.id}, "torso")`);
        rec.pop.overStumpLater = t ? await census([t[0], t[1] + 0.4, t[2]]) : null;
        manifest.rounds[`slug-pop-${n}`] = rec; manifest.stages["slug-pop"] = { actor: a.id, frames }; save();
        console.log(`  slug-pop: slug ${n} took the head off; the swell showed on ${swell} frames from frame ${rec.pop.firstSwellFrame}, the head left on frame ${off.k} with ${off.fragments} skull fragments in the air; the fragment cut ${J(rec.pop.fragmentCuts)}; within 0.3 m of the old head half a second on: ${J(rec.pop.near)}; over the stump 2.5 s later: ${J(rec.pop.overStumpLater)}`);
        await photograph("slug-pop-after", a.id);
      }
    }
    if (!done) { failed++; console.error("FAIL: slug-pop: ten slugs at the neck did not take the head off (the zombie died first, or the neck held)"); }
    // The same pop with the flesh out of the frame: a stamped torso wound (an unwounded body draws no bones), the
    // proxy box shrunk to nothing, and the head popped by hand along the same direction.
    const b = fresh();
    const fr = await frameOf(b.id), f = await frontOf(b.id);
    const o = add(add(fr.centre, mul(f, 1.5)), [0, -0.45, 0]), d = unit(sub(add(fr.centre, [0, -0.45, 0]), o));
    await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${b.id})`);
    await stepN(2);
    await fleshShown(b.id, false);
    await stepN(2);
    await evaluate(`__sdfGame.head.pop(${b.id}, ${-f[0]}, 0, ${-f[2]})`);
    const frames = await strip("pop-bare", b.id, fr.centre, f, async () => { await fleshShown(b.id, false); return {}; });
    manifest.stages["pop-bare"] = { actor: b.id, frames }; save();
    console.log(`  pop-bare: the head left on frame ${frames.find((q) => !q.headOn)?.k}; skull fragments in the air per frame: ${frames.map((q) => q.fragments).join(" ")}`);
  }
} catch (e) { failed++; console.error(`FAIL: ${e.stack ?? e}`); }
finally { if (S) { closeSession(S); S = null; } }
if (consoleErrors.length) { failed++; console.error(`FAIL: ${consoleErrors.length} console errors: ${J(consoleErrors.slice(0, 6))}`); }
manifest.errors = consoleErrors; save();
clearTimeout(DEADLINE);
console.log(`${Object.keys(manifest.shots).length} shots in ${OUT}; ${failed} failures`);
process.exit(failed ? 1 : 0);
