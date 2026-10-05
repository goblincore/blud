// scripts/head-split-gate.mjs — the head split, part B (plan docs/superpowers/plans/2026-10-04-head-split-part-b.md
// Task B8; spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4-§5). Bare ring page (/sdf-game.html,
// no ?level), frozen zombies, headless WebGPU, seams in place of pointer lock. Contact sheets go to OUT.
// The measures are made on the FLOAT MARCH TARGET (__sdfGameDebug.readMarchTarget: the SDF bodies before the lens and
// the post FX), not on screenshots: two screenshots of one closed head differ in over 150 000 pixels, and the march
// target of one frame read twice is equal to the bit once the camera has settled.
//   S. A CENTRED HEAD CHOP (__sdfGame.axeChop(id, "H", "head")) opens a `middle` split, both sides. THE GAP between
//      the halves (gapRead: the stretch of a line across the old plane that the camera sees through) is read every
//      frame of the spring: it grows, overshoots its rest value and settles, and it is the gap head-split.ts predicts
//      for the spring's angle on every frame. The zombie lives. Frozen actors: the split leaf re-poses them itself, so
//      the spring runs without a thaw (a thaw would let the body sway under the camera).
//   W. CHOP 2 WIDENS: the gap at rest is wider, and the prediction's.
//   K. CHOP 3 KILLS (thawed 3 frames, as axe-gate's K), and 45 frames on the corpse's head is still open: the state,
//      the pose's split, the GPU record, and the gap measured on the fallen head.
//   O. AN OFF-CENTRE CHOP (the eye stands round to the head's right, so the chop's line meets the skin off centre)
//      opens ONE side; the other half's march texels are the closed head's, against the same frame drawn twice.
//   L. LATER HITS on a moved half's outer skin, a rod cut and a pellet: each is stamped where unwarpPoint puts its
//      hit, and its mask is drawn on the half (tissue painted green: the mask's centroid against the wound's place).
//   F. __sdfGame.forceSplit(id, "face", ...) folds the face half forward: the nose point is where warpPoint puts it.
//   M. THE SKULL: cracked, wider, split at the three chops (the bone's angles, three clipped copies and an eye a
//      half), each seated eye on screen against skullWarpPoint, and the closed skull on a closed head.
//   C. cost: draw time, closed against open, at 0.6 m and 2 m (with its spread, not gated); zero console errors and a
//      clean gpuDiagnostics at the end of every boot.
//   R. RANGE (its own boot): beyond the draw distance a split is drawn closed, flesh and skull; it opens again only
//      inside the reopen distance, and holds its state at each stance.
//   H. HEAD DAMAGE AND THE SPLIT DO NOT MIX: a slug and a flail hit on a split head take the plain un-warped paths (no
//      head damage state; the flail's crater credits the head's share of the meter); a head that head damage holds
//      refuses to split and still dies on chop 3.
//   B. BOUNDS (two boots): each preset at full angle, from the front at 0.6 m and from above and behind: the shipped
//      path's hit mask against the per-body path with every march bound off (?crowd=0, the proxy box grown).
//   T. S ON A TURNED ZOMBIE (its own boot): the ring walks until one stands about 90 degrees round.
// ONLY=S,K (env) runs just those scenarios (W and K need S; M's stages need S, W and K). Unset runs them all: the gate.
// Usage (bash, not zsh):
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/head-split-gate.mjs 5241 9241
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-10-04-head-split/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62;
/** The head's distance for the photos and the chops (m, eye to the head centre). */
const HEAD_D = 0.6;
/** A contact sheet's tile: this many screen px square about its centre, halved. */
const SHEET_CROP = 560;
/** Frames stepped after a camera move before a reference read (the shadow maps and temporal passes trail it; from
 *  there two reads of one frame are equal to the bit), and the frames a chop's spring is followed for (1 s). */
const SETTLE = 24, SPRING_FRAMES = 60;
// THE GAP (gapLine / gapRead): the line's height above the head centre (m; the face cuts carve their halves from the
// scalp down to 1.7 cm above it, so the line runs under them, across clean cut faces), its sampling step and half
// length (samples), how far in front of a sample a surface may lie and the sample still count as seen, and the
// eye's place (wedgeEye).
const GAP_LEVER = 0, GAP_STEP = 0.001, GAP_HALF_N = 150, GAP_FRONT = 0.005, GAP_EYE_D = 0.6, GAP_RISE = 0.15;
/** A landmark's depth tolerance along the sight line (m). */
const DEPTH_TOL = 0.012;
// Thresholds. Every one is a measured value with its margin; the measured values are in the notes
// (docs/dev-notes/2026-10-04-head-split/NOTES.md, "B8 part A").
const GAP_UNDER = 0.011, GAP_OVER = 0.006, GAP_STILL = 0.0015;
const S_PEAK_BY = 8, S_OVERSHOOT = 1.15, S_SETTLE_BY = 30;
const W_WIDER = 0.01;
const K_LATER = 45;
const O_BEARING = 0.5, O_CLEAR = 0.01, O_DISC = 0.12, O_COLOUR = 0.01, O_DEPTH = 0.001, O_MIN_TEXELS = 1000, O_STILL_MOVED = 0, O_STILL_LIGHT = 0.1, O_MOVED_MIN = 0.5;
const L_BROW = [0.045, 0.05], L_CUT_HALF = 0.03, L_GREEN = 0.15, L_REACH_TX = 40, L_DENT = 0.003, L_POS_TOL = 0.012, L_MIN_TEXELS = 15, L_CENTROID_TX = 6, L_IN_CRATER = 0.5;
const F_MOVED_MIN = 0.05, F_UP = 0.1, F_EYE_D = 0.9;
const M_CRACK_MAX = 0.06, M_SPLIT_MIN = 0.35, M_THROWN = 1.8, M_SHIFT_PX = 5, M_FAR_PX = 40;
/** The eye seats in the head frame (mesh-eyes.ts, the rest pose). */
const M_SEATS = [[-0.0363, 0.0159, 0.0343], [0.0363, 0.0159, 0.0343]];
const R_STEP = 0.3, R_HOLD = 20, R_MIN_HITS = 20, R_CLOSED_MAX = 6, R_OPEN_MIN = 5;
const H_SLUG_OPEN = 0.25, H_SLUG_D = 2, H_SLUG_OFF = 0.03, H_FRAMES = 20, H_FLAIL_D = 1.0;
const B_MIN_HITS = 500, B_MARGIN = 30, B_DEPTH = 2e-3, B_DEPTH_MARGIN = 150;
const T_SIN_MIN = 0.97, T_MAX_FRAMES = 900;
const C_ROUNDS = 3;
/** The flicker clock's frozen time (s): any value, the same in every run. */
const LIGHT_PHASE = 60;
/** A changed screen pixel: any channel differs by more than this (of 255). */
const TH = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const results = [];
const fail = (msg) => { console.error(`FAIL: ${msg}`); results.push(`FAIL: ${msg}`); failures++; };
const pass = (msg) => { console.log(`PASS: ${msg}`); results.push(`PASS: ${msg}`); };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const note = (msg) => console.log(`  measure: ${msg}`);
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
mkdirSync(OUT, { recursive: true });
/** ONLY=K,T runs just those scenarios (iteration aid); unset runs them all, which is the gate. */
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (k) => !ONLY || ONLY.has(k);

// ---- A CDP session (a tab), one at a time ---------------------------------------------
let S = null;
const consoleEvents = [];
async function openSession(label) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), label, rect: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      consoleEvents.push({ label, type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
    }
    if (m.method === "Runtime.exceptionThrown") consoleEvents.push({ label, type: "exception", text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// ---- PNG decode / encode ----------------------------------------------------------------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
const px = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function encodePng(w, h, rgb) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** A w x h RGB crop of `img` centred on (cx, cy) (out-of-frame pixels black). */
function cropRgb(img, cx, cy, w, h) {
  const out = Buffer.alloc(w * h * 3); const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
    const c = px(img, sx, sy); const o = (y * w + x) * 3; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  }
  return out;
}

const ndcPx = (n) => [S.rect.x + (n[0] + 1) * 0.5 * S.rect.w, S.rect.y + (1 - n[1]) * 0.5 * S.rect.h];
/** Screenshots lag hand-stepped frames by one: lock the sim, re-render twice, then shoot. The lock keeps the sim
 *  still (renderLock), so a capture never advances a frame. */
async function capture() {
  await evaluate("__sdfGame.setRenderLock(true)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const buf = Buffer.from(s.result.data, "base64");
  return Object.assign(decodePng(buf), { buf });
}
// ---- Boot the bare ring page, frozen zombies -----------------------------------------------------------
let centre = [0, 0, 0], pool = [], usedZ = new Set();
async function boot(label, extra = "") {
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0${extra}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`[${label}] backend ${backend}, expected webgpu`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") !== "ready") die(`[${label}] warm gate never reached ready`);
  await evaluate("__sdfGame.setLoopRunning(false)");
  // The dev panels (head-damage-gate's list) would sit over the photos.
  await evaluate(`(() => { for (const e of document.body.children) { if (/TUNING|DYNAMITE \\/ GIB|BLOOD \\+ GIB BLUR|Record \\[F8\\]/.test(e.innerText || "")) e.style.display = "none"; } return 1; })()`);
  s.rect = await evaluate(`(() => { const r = document.querySelector("#app canvas, canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await evaluate("__sdfGame.freeze(true)");
  // Pixel measures: the practical-fire flicker pinned at a GIVEN phase (frozen at the wall clock's now, lit values
  // differ from one run to the next), no blood over the wounds (the photos judge the split and its shading), and
  // free aim OFF so the DOM reticle is not drawn over the head.
  await evaluate(`__sdfGame.setLightClockFrozen(true, ${LIGHT_PHASE})`);
  await evaluate("__sdfGame.setBleed(false)");
  await evaluate("__sdfGame.setFreeAim(false)");
  for (let i = 0; i < 90; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  // The background gib / crowd compiles would confound the draw timings: wait for the gib warm, as the head-burst gate does.
  let wb = null;
  for (let i = 0; i < 400; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" || wb.gib === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 1 / 60)"); }
  if (wb?.gib !== "ready") die(`[${label}] the background gib warm is ${JSON.stringify(wb)}`);
  // The shipped path draws the cast through the crowd material: wait for it (a ?crowd=0 boot has none).
  if (!/crowd=0/.test(extra)) { for (let i = 0; i < 600; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.crowd === "ready" || wb.crowd === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 1 / 60)"); }
    if (wb.crowd !== "ready") die(`[${label}] the crowd warm is ${JSON.stringify(wb)}`); }
  await evaluate("__sdfGame.installDebugProbe()");
  usedZ = new Set();
  console.log(`[${label}] ready; room ${ROOM} (${pool.length} zombies); warm ${JSON.stringify(wb)}`);
  console.log(`[${label}] pool yaws (deg): ${pool.map((z) => `${z.id}:${(z.yaw * 180 / Math.PI).toFixed(1)}`).join(" ")}`);
}
const stepOne = () => evaluate("__sdfGame.step(1, 1 / 60)");
async function stepN(n) { for (let i = 0; i < n; i++) await stepOne(); }
const yawOf = (dx, dz) => Math.atan2(dx, -dz);
function fresh() { const z = pool.find((q) => !usedZ.has(q.id)); if (!z) die("ran out of fresh zombies"); usedZ.add(z.id); return z; }
const J = (v) => JSON.stringify(v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
/** The body's FRONT (horizontal unit): its head frame's forward (head-damage-gate's fwdOf). Frozen zombies stand square. */
const frontOf = async (id) => { const fr = await evaluate(`__sdfGame.head.frame(${id})`); const f = qRot(fr.quat, [0, 0, 1]); return unit([f[0], 0, f[2]]); };
const headOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "head")`);
const woundsOf = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
const eye = async () => { const p = await evaluate("__sdfGame.pose()"); return [p.pos[0], p.pos[1] + EYE_H, p.pos[2]]; };
const toPx = async (p) => { const n = await evaluate(`__sdfGame.flail.toScreen(${p[0]}, ${p[1]}, ${p[2]})`); return n ? ndcPx(n) : null; };
/** The body's surface along a ray (sphere-traced on the CPU body field, the one shots and cuts trace). */
const surfHit = (id, o, d, maxT = 4) => evaluate(`(() => { const o = ${J(o)}, d = ${J(d)}; let t = 0;
  for (let i = 0; i < 600 && t < ${maxT}; i++) { const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const s = __sdfGame.head.surfaceAt(${id}, p[0], p[1], p[2]); if (s < 2e-4) return p; t += Math.max(s * 0.8, 3e-4); } return null; })()`);
/** Nudge the view until world point `t` sits at the screen centre (head-damage-gate's centreOn). */
async function centreOn(t, iters = 10) {
  let n = null;
  for (let i = 0; i < iters; i++) {
    n = await evaluate(`__sdfGame.flail.toScreen(${t[0]}, ${t[1]}, ${t[2]})`);
    if (!n || (Math.abs(n[0]) < 0.01 && Math.abs(n[1]) < 0.01)) break;
    const pp = await evaluate("__sdfGame.pose()");
    await evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw + 0.45 * n[0]}, ${pp.pitch + 0.45 * n[1]}, ${pp.pos[1]})`);
    await stepOne();
  }
  return n;
}
/** The view stance: horizontally along `from` (default: toward the room centre) from `target`, the eye `dist` m from it
 *  (3D), looking at it (the eye stays at standing height, so a torso is seen from above).
 *  Returns the view basis: `right` (horizontal) and `up` (world). */
async function look(target, dist, from = null) {
  const ax = from ? from[0] : centre[0] - target[0], az = from ? from[2] : centre[2] - target[2], l = Math.hypot(ax, az) || 1;
  const fx = ax / l, fz = az / l;
  const dy = EYE_H - target[1];
  const hz = Math.sqrt(Math.max(dist * dist - dy * dy, 0.09));
  await evaluate(`__sdfGame.placePlayer({ x: ${target[0] + fx * hz}, z: ${target[2] + fz * hz}, yaw: ${yawOf(-fx, -fz)}, pitch: ${Math.atan2(-dy, hz)} })`);
  await stepOne();
  await centreOn(target);
  const pp = await evaluate("__sdfGame.pose()");
  return { right: [Math.cos(pp.yaw), 0, Math.sin(pp.yaw)], up: [0, 1, 0], back: [fx, 0, fz], pose: pp };
}
/** A CONTACT SHEET for the notes: one tile per `tiles` entry ({ img, c: [x, y] px }), each a SHEET_CROP px square
 *  about c, halved (2 x 2 box), side by side in OUT/<name>.png. */
function sheet(name, tiles) {
  const S2 = SHEET_CROP >> 1, w = S2 * tiles.length, rgb = Buffer.alloc(w * S2 * 3);
  tiles.forEach((t, k) => {
    const crop = cropRgb(t.img, t.c[0], t.c[1], SHEET_CROP, SHEET_CROP);
    for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++) for (let ch = 0; ch < 3; ch++) {
      const i = (y * 2 * SHEET_CROP + x * 2) * 3 + ch;
      rgb[(y * w + k * S2 + x) * 3 + ch] = (crop[i] + crop[i + 3] + crop[i + SHEET_CROP * 3] + crop[i + SHEET_CROP * 3 + 3]) >> 2;
    }
  });
  writeFileSync(`${OUT}/${name}.png`, encodePng(w, S2, rgb)); console.log(`  sheet ${OUT}/${name}.png (${tiles.length} tiles)`);
}
const diffPx = (a, b, x, y) => { const p = px(a, x, y), q = px(b, x, y); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])); };
/** Pixels of screenshot `a` that differ from `b` by more than TH, inside the disc (c, R): a mask over the frame. */
function diffMask(a, b, c, R) {
  const m = new Uint8Array(a.w * a.h);
  for (let y = Math.max(0, Math.floor(c[1] - R)); y <= Math.min(a.h - 1, Math.ceil(c[1] + R)); y++) for (let x = Math.max(0, Math.floor(c[0] - R)); x <= Math.min(a.w - 1, Math.ceil(c[0] + R)); x++)
    if ((x - c[0]) ** 2 + (y - c[1]) ** 2 <= R * R && diffPx(a, b, x, y) > TH) m[y * a.w + x] = 1;
  return { m, w: a.w, h: a.h };
}
/** The mask's connected blobs (4-neighbour) of at least `minN` pixels: [{ n, cx, cy }], largest first. */
function blobs(mask, minN = 12) {
  const m = Uint8Array.from(mask.m), res = [];
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== 1) continue;
    let n = 0, sx = 0, sy = 0; const st = [i]; m[i] = 2;
    while (st.length) { const k = st.pop(), x = k % mask.w, y = (k / mask.w) | 0; n++; sx += x + 0.5; sy += y + 0.5;
      for (const j of [k - 1, k + 1, k - mask.w, k + mask.w]) { if (j < 0 || j >= m.length || m[j] !== 1 || Math.abs((j % mask.w) - x) > 1) continue; m[j] = 2; st.push(j); } }
    if (n >= minN) res.push({ n, cx: sx / n, cy: sy / n });
  }
  return res.sort((a, b) => b.n - a.n);
}
const timeDraws = () => evaluate("__sdfGame.timeDraws(120)", 300000);

const out = {};const actorPhase = async (id) => (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id)?.phase;
const meterOf = async (id) => (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id)?.meter;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mm = (v) => (1000 * v).toFixed(1);
const HS = `await import("/src/lab/sdf-zombie/head-split.ts")`, VA = `await import("/src/lab/sdf-zombie/validate.ts")`;
const setCam = (pp) => evaluate(`__sdfGame.setPose(${pp.pos[0]}, ${pp.pos[2]}, ${pp.yaw}, ${pp.pitch}, ${pp.pos[1]})`);
/** Re-render `n` times without stepping the sim (the shadow maps and the temporal passes trail a camera move). */
const settle = async (n = SETTLE) => { await evaluate("__sdfGame.setRenderLock(true)"); for (let i = 0; i < n; i++) await stepOne(); await evaluate("__sdfGame.setRenderLock(false)"); };
/** The player's eye at world point `e`, looking at `t`. The camera takes the pose at the next step (syncCam, or a
 *  frame of the sim). An eye above standing height falls with the sim, so it is set again before every frame; one
 *  below it is not possible (the player is held on the floor). */
async function camAt(e, t) {
  if (e[1] < EYE_H - 2e-3) die(`camAt: an eye at height ${e[1].toFixed(3)} m is under the standing eye (${EYE_H} m)`);
  const d = sub(t, e);
  await evaluate(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${yawOf(d[0], d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, ${Math.max(0, e[1] - EYE_H)})`);
}
/** The camera onto the player's pose without advancing anything: a step of no time. */
const syncCam = () => evaluate("__sdfGame.step(1, 0)");
/** THE FLOAT MARCH TARGET (400 x 300 here; the SDF bodies only, before the lens and the post FX): rgb = the lit
 *  colour, a = clip depth. `miss` is the clear value's depth (the top-left corner is never a body in these views). */
const readF = async () => { const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000); const f = new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer); return { w: r.w, h: r.h, f, miss: f[3] }; };
const hitAt = (t, i) => t.f[i * 4 + 3] !== t.miss;
/** A world point on the march target: [texel x, texel y, clip depth] (screenPosOf is the camera's own projection;
 *  flail.toScreen is lens-mapped, right for screenshots only), null behind the camera. */
const txOf = async (p, t) => { const n = await evaluate(`__sdfGame.screenPosOf(${p[0]}, ${p[1]}, ${p[2]})`); return n && n.z <= 1 ? [(n.x + 1) / 2 * t.w, (1 - n.y) / 2 * t.h, n.z] : null; };
const stateOf = (id) => evaluate(`__sdfGame.headSplit(${id})`);
/** The split on the pose (world; every strike and trace reads it), and the split the view DRAWS (null when closed for range). */
const splitOf = (id) => evaluate(`(() => { const s = __sdfGame.zombie(${id}).posed().split; return s ? JSON.parse(JSON.stringify(s)) : null; })()`);
const drawnOf = (id) => evaluate(`(() => { const s = __sdfGame.zombie(${id}).view.splitDrawn; return s ? { thetaP: s.thetaP, thetaM: s.thetaM } : null; })()`);
/** Any slot of the actor's GPU record with an open split (a unit plane normal in lane 17 of 21 vec4s). */
const recordOpen = (id) => evaluate(`(() => { const r = __sdfGame.zombie(${id}).view.records.floats; for (let q = 0; q * 84 < r.length; q++) { if (Math.hypot(r[q * 84 + 68], r[q * 84 + 69], r[q * 84 + 70]) > 0.5) return true; } return false; })()`);
/** The skull: the bone angles head-split.ts gives the drawn split, and the actor's split copies among the bone draws. */
const skullOf = (id) => evaluate(`(async () => { const H = ${HS}; const s = H.skullSplitOf(__sdfGame.zombie(${id}).view.splitDrawn, __sdfGame.skullSplit()?.follow ?? null);
  const d = __sdfGame.skullDrawn(${id}); return { angleP: s ? s.angleP : 0, angleM: s ? s.angleM : 0, bones: d ? d.copies.filter((c) => !c.eye).length : null, eyes: d ? d.copies.filter((c) => c.eye).length : null, draws: d ? d.draws : null }; })()`);
const frameOf = (id) => evaluate(`__sdfGame.head.frame(${id})`);
const warpOf = (id, q) => evaluate(`(async () => { const H = ${HS}; const r = H.warpPoint(__sdfGame.zombie(${id}).posed().split, ${J(q)}); return { p: r.p, piece: r.piece }; })()`);
const unwarpOf = (id, p) => evaluate(`(async () => { const H = ${HS}, V = ${VA}; const posed = __sdfGame.zombie(${id}).posed(); const r = H.unwarpPoint(posed.split, ${J(p)}, (q) => V.sdBodyClosed(q, posed)); return { q: r.q, piece: r.piece }; })()`);
const force = async (id, preset, sides, offset, frac) => { const ok = await evaluate(`__sdfGame.forceSplit(${id}, "${preset}", ${sides}, ${offset}, ${frac})`); await stepN(3); return ok; };
const chop = (id, side) => evaluate(`__sdfGame.axeChop(${id}, "${side}", "head")`);
/** A frozen actor never steps, and the kill (forceCollapse) is consumed in its step: thaw `n` frames, then freeze. */
const thaw = async (n) => { await evaluate("__sdfGame.freeze(false)"); await stepN(n); await evaluate("__sdfGame.freeze(true)"); };
const diag = async (label) => { out.diag[label] = await evaluate("__sdfGame.gpuDiagnostics()"); };

/** THE GAP LINE of a head with a centred `middle` split: a segment across the old plane, through the head centre's
 *  height plus GAP_LEVER: G0 on the plane, n across it, u up from the hinge, fwd out of the face. `lever` is G0's
 *  height above the hinge plane, so on a head opened by thetaP / thetaM the cut faces cross the segment at
 *  +lever x tan(thetaP) and -lever x tan(|thetaM|): the gap the CPU's split predicts there.
 *  From the pose's split when the head is open (the plane and hinge every strike reads, whatever the body is doing),
 *  from the head's own frame while it is closed; S checks that the two agree. */
async function gapLine(id) {
  const hinge = HEAD_SPLIT.presets.middle.hingeBoth, w = await splitOf(id);
  let n, u, G0;
  if (w) { n = w.n; u = cross(w.n, w.a); G0 = add(w.h, add(mul(u, GAP_LEVER - hinge[1]), mul(cross(n, u), -hinge[2]))); }
  else { const fr = await frameOf(id); n = qRot(fr.quat, [1, 0, 0]); u = qRot(fr.quat, [0, 1, 0]); G0 = add(fr.centre, mul(u, GAP_LEVER)); }
  return { G0, n, u, fwd: cross(n, u), lever: GAP_LEVER - hinge[1], open: !!w };
}
/** An eye IN THE WEDGE of the line's split, however the head lies: on the old plane, GAP_EYE_D out from the gap line
 *  level along the plane (to the face's side: the player cannot stand inside the body) and up the plane's steepest
 *  line by GAP_RISE, or by what it takes to reach the player's standing eye height. It must be above the hinge plane. */
function wedgeEye(line) {
  const k = line.n[1], e1 = unit([-k * line.n[0], 1 - k * line.n[1], -k * line.n[2]]);
  let e2 = unit(cross(line.n, e1)); if (dot(e2, line.fwd) < 0) e2 = mul(e2, -1);
  const rise = Math.max(GAP_RISE, (EYE_H + 0.01 - line.G0[1]) / Math.max(e1[1], 1e-6));
  const eyeAt = add(line.G0, add(mul(e2, GAP_EYE_D), mul(e1, rise)));
  if (e1[1] < 0.2 || rise > 3 || dot(line.u, sub(eyeAt, line.G0)) + line.lever <= 0) die(`wedgeEye: no eye in the wedge above the floor (the plane's rise ${e1[1].toFixed(2)}, ${rise.toFixed(2)} m up it)`);
  return eyeAt;
}
const gapPredicted = (line, thetaP, thetaM) => line.lever * (Math.tan(thetaP) + Math.tan(Math.abs(thetaM)));
/** THE GAP on the march target `t` (metres): the run of points of the gap line, about its middle, that the camera
 *  SEES: the texel under the point is a miss, or its surface is not more than GAP_FRONT in front of the point. A
 *  point inside a half has the half's skin in front of it. The eye must stand in the wedge (wedgeEye), where every
 *  sight line to the segment stays between the two cut faces. 0 on a closed head. */
async function gapRead(line, t) {
  const pts = await evaluate(`(() => { const G = ${J(line.G0)}, n = ${J(line.n)}, c = __sdfGame.cameraWorld(), out = [];
    for (let k = -${GAP_HALF_N}; k <= ${GAP_HALF_N}; k++) { const s = k * ${GAP_STEP}, p = [G[0] + n[0] * s, G[1] + n[1] * s, G[2] + n[2] * s];
      const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(v[0], v[1], v[2]) / ${GAP_FRONT};
      const a = __sdfGame.screenPosOf(p[0], p[1], p[2]), b = __sdfGame.screenPosOf(p[0] - v[0] / l, p[1] - v[1] / l, p[2] - v[2] / l); out.push([a.x, a.y, a.z, b.z]); }
    return out; })()`);
  const seen = pts.map(([x, y, za, zb]) => {
    const tx = Math.floor((x + 1) / 2 * t.w), ty = Math.floor((1 - y) / 2 * t.h);
    if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return false;
    const a = t.f[(ty * t.w + tx) * 4 + 3];
    // zb is the depth GAP_FRONT nearer the eye than the point: seen unless the surface is nearer still.
    return a === t.miss || (a - zb) * Math.sign(za - zb) >= 0;
  });
  // The run about the middle: from the seen sample nearest the plane (within 1 cm of it), out both ways.
  let mid = -1;
  for (let k = 0; k <= 10 && mid < 0; k++) { if (seen[GAP_HALF_N + k]) mid = GAP_HALF_N + k; else if (seen[GAP_HALF_N - k]) mid = GAP_HALF_N - k; }
  if (mid < 0) return 0;
  let lo = mid, hi = mid;
  while (lo > 0 && seen[lo - 1]) lo--;
  while (hi < seen.length - 1 && seen[hi + 1]) hi++;
  return (hi - lo + 1) * GAP_STEP;
}
/** The march target's clip depth as a distance along the view axis (m), for the camera as it stands: the projection
 *  is depth = A - B / distance, read off two points down the axis. */
async function depthToDistance() {
  const [z1, z2] = await evaluate(`(() => { const a = __sdfGame.screenRayToWorld(0, 0, 0.5), b = __sdfGame.screenRayToWorld(0, 0, 2); return [__sdfGame.screenPosOf(a[0], a[1], a[2]).z, __sdfGame.screenPosOf(b[0], b[1], b[2]).z]; })()`);
  const B = (z2 - z1) / (1 / 0.5 - 1 / 2), A = z1 + B / 0.5;
  return (z) => B / (A - z);
}
/** THE MARCH'S SURFACE AT A WORLD POINT: the texel under `p` holds a surface within `tol` m of p along the sight line
 *  (its clip depth between those of p - tol and p + tol). */
async function surfaceAtPoint(p, t, tol) {
  const r = await evaluate(`(() => { const p = ${J(p)}, c = __sdfGame.cameraWorld(); const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(v[0], v[1], v[2]) / ${tol};
    const P = (k) => __sdfGame.screenPosOf(p[0] + k * v[0] / l, p[1] + k * v[1] / l, p[2] + k * v[2] / l); const a = P(0); return [a.x, a.y, P(-1).z, P(1).z]; })()`);
  const tx = Math.floor((r[0] + 1) / 2 * t.w), ty = Math.floor((1 - r[1]) / 2 * t.h);
  if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return false;
  const a = t.f[(ty * t.w + tx) * 4 + 3];
  return a !== t.miss && (a - r[2]) * (a - r[3]) <= 0;
}
/** One head chop through the axeChop seam with its spring followed to rest: SPRING_FRAMES frames (1 s: play's
 *  strikes are at least 0.6 s apart, axe-swing.ts), the gap read each frame from `eyeW` (in the wedge; set again before
 *  every frame: above standing height the player falls with the sim). Frames in `photoAt` are photographed from
 *  the standing pose `photoCam`. */
async function chopAndFollow(id, side, line, eyeW, photoCam = null, photoAt = []) {
  const n = await chop(id, side);
  const frames = [], photos = [];
  for (let i = 1; i <= SPRING_FRAMES; i++) {
    await camAt(eyeW, line.G0); await stepOne();
    const st = await stateOf(id);
    frames.push({ i, angle: st ? st.angle : 0, gap: await gapRead(line, await readF()) });
    if (photoCam && photoAt.includes(i)) { await setCam(photoCam); await syncCam(); photos.push(await capture()); }
  }
  return { n, frames, photos, state: await stateOf(id) };
}
/** Stand the eye at `eye` looking at `at`, let the frame settle without stepping the sim, and read the march target. */
async function readFrom(eye, at) { await camAt(eye, at); await syncCam(); await settle(); return readF(); }
/** A photo from the player pose `cam` (or from the eye `cam[0]` looking at `cam[1]`), nothing stepped. */
async function photo(cam) { if (Array.isArray(cam)) await camAt(cam[0], cam[1]); else await setCam(cam); await syncCam(); await settle(); return capture(); }
const headPx = async (id) => toPx(add((await frameOf(id)).centre, [0, 0.03, 0]));
out.diag = {};
let HEAD_SPLIT = null, AXE_HEAD = null;
/** The live constants (the look pass retunes them: every prediction below is made from these, not from copies). */
const loadRules = async () => {
  HEAD_SPLIT = await evaluate(`(async () => JSON.parse(JSON.stringify((${HS}).HEAD_SPLIT)))()`);
  AXE_HEAD = await evaluate(`(async () => JSON.parse(JSON.stringify((await import("/src/lab/sdf-zombie/webgpu/axe-head.ts")).AXE_HEAD)))()`);
};
const SCEN = { "mid-both": ["middle", 0, 0], "mid-one": ["middle", 1, 0.04], "face": ["face", 1, 0] };
/** From above and behind the head (b5's camera): 0.75 m behind, raised 0.45 m, pitched down. Shot under settle(). */
async function topCam(hc, f) {
  const v = await look(add(hc, [0, 0.05, 0]), 0.75, mul(f, -1));
  await evaluate(`__sdfGame.setPose(${v.pose.pos[0]}, ${v.pose.pos[2]}, ${v.pose.yaw}, ${v.pose.pitch - 0.55}, ${v.pose.pos[1] + 0.45})`);
  await stepOne(); await centreOn(add(hc, [0, 0.05, 0]));
  return evaluate("__sdfGame.pose()");
}
/** The region's disc on the march target: the hinge's texel and the region radius there. */
async function regionDisc(w, t) { const H = await txOf(w.h, t), R = await txOf(add(w.h, [0, w.r, 0]), t); return { c: H, R: d2(H, R) }; }
try {
  // ======== BOOT 1 (the shipped path): the three chops (S, W, K, the skull's stages of M), one side (O), later hits
  // (L), the face preset (F), the skull landmark (M), cost (C).
  if (run("S") || run("W") || run("K") || run("O") || run("L") || run("F") || run("M") || run("C")) {
    await boot("chops"); await loadRules();
    // -------- O. an off-centre chop opens ONE side; the other half does not change.
    if (run("O")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const right = qRot(fr.quat, [1, 0, 0]);
      const camF = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE); await settle();
      // The untouched head, then the chop from O_BEARING round to the head's right: the eye-to-centre line meets the
      // skin off centre on that side.
      const tA = await readF(), shot0 = await capture(), px0 = await headPx(z.id);
      await look(hc, HEAD_D, unit(add(mul(f, Math.cos(O_BEARING)), mul(right, Math.sin(O_BEARING)))));
      const n = await chop(z.id, "H");
      const hit = (await evaluate("__sdfGame.axe()")).last.points[0];
      const hitX = dot(sub(hit, fr.centre), right);
      await stepN(SPRING_FRAMES);
      const st = await stateOf(z.id), w = await splitOf(z.id);
      const maxOff = HEAD_SPLIT.maxOffsetFrac * fr.axes[0], side = Math.sign(hitX);
      out.o = { state: st, hitLocalX: +hitX.toFixed(4) };
      check(n === 1 && st?.preset === "middle" && st.sides === side && side !== 0 && Math.abs(st.offset - side * Math.min(maxOff, Math.abs(hitX))) < 1e-9 && st.angle === AXE_HEAD.openAngles[0] * HEAD_SPLIT.presets.middle.maxOne,
        `O: a chop ${mm(Math.abs(hitX))} mm off centre opens ONE side, the struck one (sides ${st?.sides}, plane offset ${st ? mm(st.offset) : null} mm of at most ${mm(maxOff)}; settled at ${st?.angle.toFixed(4)} rad)`);
      check(!!w && (side > 0 ? w.thetaP > 0 && w.thetaM === 0 : w.thetaM < 0 && w.thetaP === 0), `O: the pose's split turns that half only (${w ? `${w.thetaP.toFixed(4)} / ${w.thetaM.toFixed(4)}` : null})`);
      await setCam(camF); await stepN(SETTLE); await settle();
      const tO = await readF(), shot1 = await capture();
      // The reference is the SAME head closed again (the seam drops the split; its cut face stays in the wound ring):
      // the face cut is a wound of the closed head and carves and lips BOTH sides of the plane, split or not. Read
      // twice: the same frame drawn again is the instrument's own floor.
      await force(z.id, "middle", st.sides, st.offset, 0);
      await setCam(camF); await stepN(SETTLE); await settle();
      const tR = await readF(), tR2 = await readF();
      // The STILL half on the target: texels beyond the old plane by O_CLEAR on the still side, within O_DISC of the
      // head centre. The MOVED half: beyond the plane by 1 cm the other way.
      const C = await txOf(fr.centre, tO), Rd = d2(C, await txOf(add(fr.centre, [0, O_DISC, 0]), tO));
      const lineAt = async (s) => [await txOf(add(add(fr.centre, mul(right, s)), [0, 0.2, 0]), tO), await txOf(add(add(fr.centre, mul(right, s)), [0, -0.2, 0]), tO)];
      const sideOf = ([a, b], x, y) => Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
      const stillLine = await lineAt(st.offset - side * O_CLEAR), movedLine = await lineAt(st.offset + side * 0.01);
      const stillRef = await txOf(add(fr.centre, mul(right, -side * 0.3)), tO), movedRef = await txOf(add(fr.centre, mul(right, side * 0.3)), tO);
      // Per half: texels either frame hits; those whose hit differs (`mask`), whose surface moved along the view by
      // more than O_DEPTH (`depth`: an open slot's walk lands its samples a hair off the closed one's, under a tenth
      // of that), and whose colour differs by more than O_COLOUR with the surface in place (`colour`: its light).
      const dist = await depthToDistance();
      const count = (a, b, line, ref) => { let n = 0, mask = 0, depth = 0, colour = 0, max = 0, maxDepth = 0; const want = sideOf(line, ref[0], ref[1]);
        for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { if (d2([x + 0.5, y + 0.5], C) > Rd || sideOf(line, x + 0.5, y + 0.5) !== want) continue;
          const i = y * a.w + x, ha = hitAt(a, i), hb = hitAt(b, i); if (!ha && !hb) continue; n++;
          if (ha !== hb) { mask++; continue; }
          const dd = Math.abs(dist(a.f[i * 4 + 3]) - dist(b.f[i * 4 + 3])); if (dd > maxDepth) maxDepth = dd; if (dd > O_DEPTH) { depth++; continue; }
          let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.f[i * 4 + c] - b.f[i * 4 + c])); if (d > max) max = d; if (d > O_COLOUR) colour++; }
        return { n, mask, depth, colour, max: +max.toExponential(2), maxDepthMm: +mm(maxDepth) }; };
      const floor = count(tR, tR2, stillLine, stillRef), still = count(tR, tO, stillLine, stillRef), moved = count(tR, tO, movedLine, movedRef);
      const cutAlone = count(tA, tR, stillLine, stillRef);
      out.o.still = still; out.o.floor = floor; out.o.moved = moved; out.o.faceCutAlone = cutAlone;
      note(`O: still half ${J(still)}; the same frame twice ${J(floor)}; moved half ${J(moved)}`);
      note(`O: (ungated) the face cut alone, closed head with it against the untouched head, same still-half texels: ${J(cutAlone)}`);
      check(floor.mask + floor.depth + floor.colour === 0, `O: the instrument's floor: the closed head drawn twice differs in ${floor.mask + floor.depth + floor.colour} of ${floor.n} still-half texels (largest colour step ${floor.max})`);
      check(still.n >= O_MIN_TEXELS && still.mask + still.depth <= floor.mask + floor.depth + O_STILL_MOVED,
        `O: the other half does not move: against the same head closed, ${still.mask} hit texels of ${still.n} differ and ${still.depth} moved more than ${mm(O_DEPTH)} mm in depth (${mm(O_CLEAR)} mm and more beyond the plane; the floor ${floor.mask + floor.depth} + ${O_STILL_MOVED} allowed)`);
      check(still.colour / still.n <= O_STILL_LIGHT, `O: its light changes on few texels: ${still.colour} of ${still.n} by more than ${O_COLOUR} (${(still.colour / still.n).toFixed(3)} <= ${O_STILL_LIGHT}: the open gap's shadow and occlusion; largest step ${still.max})`);
      check((moved.mask + moved.depth) / moved.n >= O_MOVED_MIN, `O: the struck half did move: ${moved.mask + moved.depth} of ${moved.n} texels differ in hit or depth (${((moved.mask + moved.depth) / moved.n).toFixed(2)} >= ${O_MOVED_MIN})`);
      sheet("O-one-side", [{ img: shot0, c: px0 }, { img: shot1, c: px0 }]);
    }
    // -------- L. later hits on a moved half's OUTER skin: stamped where unwarpPoint says, shown on the half.
    if (run("L")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const right = qRot(fr.quat, [1, 0, 0]), up = qRot(fr.quat, [0, 1, 0]);
      const cam = (await look(hc, HEAD_D, f)).pose;
      // A brow point on each half of the CLOSED head, then the split (chop 2's angle), then where the CPU puts them.
      const brow = [];
      for (const sx of [1, -1]) brow.push(await surfHit(z.id, add(add(add(fr.centre, mul(right, sx * L_BROW[0])), mul(up, L_BROW[1])), mul(f, 0.5)), mul(f, -1)));
      const ok = await force(z.id, "middle", 0, 0, AXE_HEAD.openAngles[1]);
      const open = []; for (const q of brow) open.push((await warpOf(z.id, q)).p);
      const allViews = `__sdfGame.actorList().map((a) => __sdfGame.zombie(a.id)).filter((q) => q && q.view)`;
      const saved = await evaluate(`(() => { const u = ${allViews}[0].view.uniforms; return { deep: u.deepColor.value.toArray(), fat: u.fatColor.value.toArray() }; })()`);
      const tissue = (deep, fat) => evaluate(`(() => { for (const q of ${allViews}) { const u = q.view.uniforms; u.deepColor.value.setRGB(${deep[0]}, ${deep[1]}, ${deep[2]}); u.fatColor.value.setRGB(${fat[0]}, ${fat[1]}, ${fat[2]}); } return 1; })()`);
      await setCam(cam); await stepN(SETTLE); await settle();
      const shot0 = await capture(), px0 = await headPx(z.id);
      // The wound mask is the tissue colours' reach (albedo = mix(base, tissue, mask)): paint them green and it is the
      // rise in green against the same open head before the hits.
      await tissue([0, 1, 0], [0, 1, 0]); await settle();
      const t0 = await readF();
      // A rod cut down the + half's brow, then a pellet on the - half's: both aimed from the front at the OPEN head.
      // Each is read against the frame before it, so its mask is its own.
      const green = (t, i) => { const r = t.f[i * 4], g = t.f[i * 4 + 1], b = t.f[i * 4 + 2]; return g / Math.max(r + g + b, 1e-6); };
      out.l = [];
      let prev = t0, landed = ok;
      for (const name of ["rod cut", "pellet"]) {
        const w0 = (await woundsOf(z.id)).length, o = add(open[1], mul(f, 0.5));
        const aim = name === "rod cut"
          ? ((await evaluate(`__sdfGame.cut(${z.id}, ${J(add(open[0], mul(up, -L_CUT_HALF)))}, ${J(add(open[0], mul(up, L_CUT_HALF)))}, ${J(mul(f, -1))})`)) >= 1 ? open[0] : null)
          : await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${-f[0]}, ${-f[1]}, ${-f[2]}, "pellet", ${z.id})`);
        await stepN(3);
        const wd = (await woundsOf(z.id)).slice(w0)[0];
        if (!aim || !wd) { landed = false; fail(`L: the ${name} did not land on the open head (aim ${J(aim)}, wound ${J(wd)})`); continue; }
        await setCam(cam); await stepN(SETTLE); await settle();
        const t1 = await readF();
        const pred = await unwarpOf(z.id, aim), shown = await warpOf(z.id, wd.pos);
        const tx = await txOf(shown.p, t1), closedTx = await txOf(wd.pos, t1);
        // The mask: texels both frames hit whose green share rose by L_GREEN. The crater: texels whose surface went in
        // by more than L_DENT. Both within L_REACH_TX of the wound's place on the open head.
        const dist = await depthToDistance();
        let n = 0, sx = 0, sy = 0, cn = 0, cx = 0, cy = 0, both = 0;
        for (let y = 0; y < t1.h; y++) for (let x = 0; x < t1.w; x++) { const i = y * t1.w + x; if (!hitAt(prev, i) || !hitAt(t1, i) || d2([x + 0.5, y + 0.5], tx) > L_REACH_TX) continue;
          const m = green(t1, i) - green(prev, i) >= L_GREEN, c = dist(t1.f[i * 4 + 3]) - dist(prev.f[i * 4 + 3]) > L_DENT;
          if (m) { n++; sx += x + 0.5; sy += y + 0.5; } if (c) { cn++; cx += x + 0.5; cy += y + 0.5; } if (m && c) both++; }
        const posErr = len(sub(wd.pos, pred.q)), mask = n ? [sx / n, sy / n] : null, crater = cn ? [cx / cn, cy / cn] : null;
        const err = mask && crater ? d2(mask, crater) : Infinity, toOpen = mask ? d2(mask, tx) : Infinity, toClosed = mask ? d2(mask, closedTx) : 0;
        out.l.push({ wound: name, shape: wd.shape, piece: pred.piece, posErrMm: +mm(posErr), maskTexels: n, craterTexels: cn, maskInCrater: n ? +(both / n).toFixed(2) : 0, maskToCraterTx: +err.toFixed(2), maskToOpenPlaceTx: +toOpen.toFixed(1), maskToClosedPlaceTx: +toClosed.toFixed(1) });
        check(pred.piece !== 0 && shown.piece === pred.piece && posErr <= L_POS_TOL, `L: the ${name} is stamped where unwarpPoint puts its hit, on the closed head (piece ${pred.piece}; ${mm(posErr)} mm off <= ${mm(L_POS_TOL)} mm)`);
        check(n >= L_MIN_TEXELS && cn >= L_MIN_TEXELS && err <= L_CENTROID_TX && both / n >= L_IN_CRATER && toClosed >= 2 * toOpen,
          `L: its mask is drawn on its crater, on the moved half: ${n} mask texels, ${(both / n).toFixed(2)} of them in the crater's ${cn} (>= ${L_IN_CRATER}), centroids ${err.toFixed(2)} texels apart (<= ${L_CENTROID_TX}); the mask is ${toOpen.toFixed(1)} texels from the wound's place on the open head, ${toClosed.toFixed(1)} from its closed one`);
        prev = t1;
      }
      note(`L: ${J(out.l)}`);
      await tissue(saved.deep, saved.fat); await settle();
      const shot1 = await capture();
      void landed;
      sheet("L-later-hits", [{ img: shot0, c: px0 }, { img: shot1, c: px0 }]);
    }
    // -------- F. the face preset folds the face half forward.
    if (run("F")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const cam = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
      const shot0 = await capture(), px0 = await headPx(z.id);
      const nose = await surfHit(z.id, add(fr.centre, mul(f, 0.5)), mul(f, -1));
      const ok = await force(z.id, "face", 1, 0, 1), st = await stateOf(z.id), w = await splitOf(z.id);
      const P = HEAD_SPLIT.presets.face;
      check(ok && st?.preset === "face" && st.sides === 1 && st.angle === P.maxOne && !!w && w.thetaP === P.maxOne && w.thetaM === 0 && !!(await drawnOf(z.id)),
        `F: forceSplit(face) holds the face half open at its full angle (${st?.angle} rad; the pose's split ${w ? `${w.thetaP} / ${w.thetaM}` : null})`);
      // Two points of the closed head and where the CPU's forward warp puts them: the nose, and a point of the old
      // plane F_UP above the head centre, which is on the face half's cut face once it folds.
      const up = cross(w.n, w.a), inner = add(add(fr.centre, mul(w.n, w.d0 - dot(w.n, fr.centre))), mul(up, F_UP));
      const folded = await warpOf(z.id, nose), cutAt = await warpOf(z.id, inner);
      const faceOut = await evaluate(`(async () => (${HS}).warpDir(__sdfGame.zombie(${z.id}).posed().split, 1, ${J(mul(w.n, -1))}))()`);
      const moved = len(sub(folded.p, nose));
      await setCam(cam); await stepN(SETTLE); await settle();
      const tF = await readF(), shot1 = await capture();
      const gone = !(await surfaceAtPoint(nose, tF, DEPTH_TOL)), empty = !(await surfaceAtPoint(cutAt.p, tF, DEPTH_TOL));
      // The folded cut face looks up and back: seen from above, behind and to one side (clear of the body, and of the
      // half that stands), the march has a surface at that point.
      const eyeF = add(cutAt.p, mul(unit(add(faceOut, qRot(fr.quat, [1, 0, 0]))), F_EYE_D));
      const tN = await readFrom(eyeF, cutAt.p), there = await surfaceAtPoint(cutAt.p, tN, DEPTH_TOL), shot2 = await capture(), px2 = await toPx(cutAt.p);
      await force(z.id, "face", 1, 0, 0);
      const tZ = await readFrom(eyeF, cutAt.p), closedThere = await surfaceAtPoint(cutAt.p, tZ, DEPTH_TOL);
      await force(z.id, "face", 1, 0, 1);
      out.f = { noseMovedMm: +mm(moved), dropMm: +mm(nose[1] - folded.p[1]), forwardMm: +mm(dot(sub(folded.p, nose), f)), cutFaceMovedMm: +mm(len(sub(cutAt.p, inner))), pieces: [folded.piece, cutAt.piece] };
      check(folded.piece === 1 && cutAt.piece === 1 && moved >= F_MOVED_MIN && dot(sub(folded.p, nose), f) > 0 && folded.p[1] < nose[1] && faceOut[1] > 0,
        `F: the CPU folds the face half forward and down (the nose ${mm(moved)} mm: ${out.f.forwardMm} mm forward, ${out.f.dropMm} mm down; >= ${mm(F_MOVED_MIN)} mm), its cut face turned to look up`);
      check(there && !closedThere && gone, `F: the march draws it there: a surface within ${mm(DEPTH_TOL)} mm of the cut face's point on the open head (${there}; on the closed head ${closedThere}), none left at the closed nose (${gone})`);
      void empty;
      sheet("F-face", [{ img: shot0, c: px0 }, { img: shot1, c: px0 }, { img: shot2, c: px2 ?? px0 }]);
    }
    // -------- M (landmark). The split skull on screen is head-split.ts's: each seated eye against skullWarpPoint, at
    // the three stages' bone angles. The flesh is thrown open past its full angle so no flesh half covers an eye.
    if (run("M")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
      const cam = (await look(hc, HEAD_D, f)).pose;
      const seats = M_SEATS.map((l) => add(fr.centre, qRot(fr.quat, l)));
      const ok = await force(z.id, "middle", 0, 0, M_THROWN), w = await splitOf(z.id);
      const MIDm = HEAD_SPLIT.presets.middle, fo = HEAD_SPLIT.skull.follow;
      const stages = [0, ...[0, 1].map((i) => AXE_HEAD.openAngles[i] * MIDm.maxBoth * fo[i][1]), MIDm.maxBoth * fo[2][1]];
      const show = (set) => evaluate(`__sdfGame.meshSkeletonShow(${J(set)})`);
      const ph = await toPx(w.h), pr = await toPx(add(w.h, [0, w.r, 0])), R = d2(ph, pr);
      const rows = [], tiles = [];
      for (const bone of stages) {
        await evaluate(`__sdfGame.skullSplit({ follow: ${bone / w.thetaP} })`); await setCam(cam); await stepN(SETTLE); await settle();
        // The eyes' pixels: the frame with the eyes drawn against the same frame without them.
        const a = await capture(); await show({ eyes: false }); const b = await capture(); await show({ eyes: true });
        const eyes = blobs(diffMask(a, b, ph, R)).slice(0, 2).sort((p, q) => p.cx - q.cx);
        const pred = [];
        for (const q of seats) pred.push(await toPx((await evaluate(`(async () => { const H = ${HS}; const s = H.skullSplitOf(__sdfGame.zombie(${z.id}).view.splitDrawn, ${bone / w.thetaP}); return s ? H.skullWarpPoint(s, ${J(q)}).p : ${J(q)}; })()`))));
        pred.sort((p, q) => p[0] - q[0]);
        rows.push({ bone, eyes: eyes.map((e) => [e.cx, e.cy]), pred, n: eyes.map((e) => e.n), skull: await skullOf(z.id) });
        tiles.push({ img: a, c: ph });
      }
      await evaluate("__sdfGame.skullSplit({ follow: null })"); await stepN(2);
      out.mLandmark = [];
      const base = rows[0];
      let worst = 0, far = 0, found = ok && rows.every((r) => r.eyes.length === 2);
      if (found) for (const r of rows.slice(1)) for (let k = 0; k < 2; k++) {
        const movedPx = d2(r.eyes[k], base.eyes[k]), predPx = d2(r.pred[k], base.pred[k]);
        const shiftErr = Math.hypot((r.eyes[k][0] - base.eyes[k][0]) - (r.pred[k][0] - base.pred[k][0]), (r.eyes[k][1] - base.eyes[k][1]) - (r.pred[k][1] - base.pred[k][1]));
        out.mLandmark.push({ boneRad: +r.bone.toFixed(4), eye: k, movedPx: +movedPx.toFixed(1), predictedPx: +predPx.toFixed(1), shiftErrPx: +shiftErr.toFixed(2) });
        worst = Math.max(worst, shiftErr); far = Math.max(far, movedPx);
      }
      note(`M: ${J(out.mLandmark)}`);
      check(found && base.skull.bones === 0 && rows.slice(1).every((r) => r.skull.bones === 3), `M: both seated eyes found at every stage; the whole skull at follow 0 (${base.skull.bones} split copies), three copies when the bone turns (${rows.slice(1).map((r) => r.skull.bones).join(", ")})`);
      check(found && worst <= M_SHIFT_PX && far >= M_FAR_PX, `M: each eye moves on screen as skullWarpPoint says: worst ${worst.toFixed(2)} px off its predicted shift (<= ${M_SHIFT_PX} px), the largest shift ${far.toFixed(1)} px (>= ${M_FAR_PX} px)`);
      sheet("M-skull", tiles);
    }
    // -------- C. cost: closed against open, interleaved, 0.6 m and 2 m (reported with its spread, not gated).
    if (run("C")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
      out.c = {};
      for (const d of [0.6, 2]) {
        await look(hc, d, f);
        const openMs = [], closedMs = [];
        for (let k = 0; k < C_ROUNDS; k++) {
          await force(z.id, "middle", 0, 0, 1); openMs.push(+(await timeDraws()).toFixed(2));
          await force(z.id, "middle", 0, 0, 0); closedMs.push(+(await timeDraws()).toFixed(2));
        }
        const spread = (a) => (Math.max(...a) - Math.min(...a)).toFixed(2);
        out.c[d] = { openMs, closedMs, delta: +(median(openMs) - median(closedMs)).toFixed(2) };
        note(`C @${d} m: draw ms (UNGATED) open ${J(openMs)} (spread ${spread(openMs)}), closed ${J(closedMs)} (spread ${spread(closedMs)}); open - closed ${out.c[d].delta} ms`);
      }
    }
    // -------- S, W, K: one zombie, three chops, the spring at rest before each. LAST in this boot: the thaws below
    // let the whole ring step, and every scenario above wants its zombie in the frozen rest pose.
    if (run("S") || run("W") || run("K")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
      const front = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
      const shot0 = await capture(), px0 = await headPx(z.id);
      // The instrument: the march's depth is the projection's (the gap and landmark measures compare the two).
      let line = await gapLine(z.id), eyeW = wedgeEye(line);
      const nose = await surfHit(z.id, add(line.G0, mul(line.fwd, 0.5)), mul(line.fwd, -1)), tN = await readF();
      check(!!nose && await surfaceAtPoint(nose, tN, DEPTH_TOL) && !(await surfaceAtPoint(add(nose, mul(line.fwd, 0.05)), tN, DEPTH_TOL)),
        `S: the instrument: the march target has the closed head's surface at the CPU's nose point (within ${mm(DEPTH_TOL)} mm along the sight line) and none 5 cm in front of it`);
      const closedGap = await gapRead(line, await readFrom(eyeW, line.G0)), closedSkull = await skullOf(z.id);
      check(closedGap === 0, `S: a closed head has no gap (${mm(closedGap)} mm seen across the plane at the head centre's height)`);
      const phase0 = await actorPhase(z.id);
      // ---- S. chop 1 opens a centred `middle` split; the gap grows, overshoots and settles.
      const MID = HEAD_SPLIT.presets.middle, full = MID.maxBoth, t1 = AXE_HEAD.openAngles[0] * full, t2 = AXE_HEAD.openAngles[1] * full;
      // The chop comes from the eye in the wedge: on the head's own mid-plane, so it lands centred.
      await camAt(eyeW, line.G0); await syncCam();
      const s = await chopAndFollow(z.id, "H", line, eyeW, front, [4, 8, 30]);
      const st1 = s.state, lineW = await gapLine(z.id);
      out.s = { state: st1, closedGapMm: +mm(closedGap), frames: s.frames.map((q) => [q.i, +q.angle.toFixed(4), +mm(q.gap)]) };
      check(s.n === 1 && phase0 === "standing" && st1?.preset === "middle" && st1.sides === 0 && st1.offset === 0 && Math.abs(st1.target - t1) < 1e-12,
        `S: a centred head chop opens a middle split, both sides (${s.n} hit; ${J(st1 && { preset: st1.preset, sides: st1.sides, offset: st1.offset, target: +st1.target.toFixed(4) })}; expected target ${t1.toFixed(4)} rad)`);
      check(lineW.open && len(sub(lineW.G0, line.G0)) < 1e-9 && dot(lineW.n, line.n) > 1 - 1e-12, `S: the pose's split lies on the head's own frame (the gap line from the split and from the frame: ${len(sub(lineW.G0, line.G0)).toExponential(1)} m apart)`);
      const gaps = s.frames.map((q) => q.gap), peakI = gaps.indexOf(Math.max(...gaps)), peak = gaps[peakI], rest = gaps.at(-1);
      const predRest = gapPredicted(line, t1, -t1);
      let rising = true; for (let i = 1; i <= peakI; i++) if (gaps[i] < gaps[i - 1]) rising = false;
      note(`S: gap per frame (mm), measured:predicted: ${s.frames.map((q) => `${q.i}:${mm(q.gap)}:${mm(gapPredicted(line, q.angle, -q.angle))}`).join(" ")}`);
      check(rising && gaps[0] > 0 && peakI + 1 <= S_PEAK_BY, `S: the gap grows frame by frame to its peak (${mm(gaps[0])} mm on frame 1, peak ${mm(peak)} mm on frame ${peakI + 1} <= ${S_PEAK_BY})`);
      check(peak >= S_OVERSHOOT * rest, `S: it overshoots its rest value (peak ${mm(peak)} mm = ${(peak / rest).toFixed(3)} x rest ${mm(rest)} mm; >= ${S_OVERSHOOT} x)`);
      const settledBy = s.frames.findLast((q) => Math.abs(q.gap - rest) > GAP_STILL)?.i ?? 0;
      check(settledBy < S_SETTLE_BY && st1.angle === st1.target && st1.vel === 0, `S: it settles: within ${mm(GAP_STILL)} mm of rest from frame ${settledBy + 1} on (< ${S_SETTLE_BY}), the spring exactly on its target at frame ${SPRING_FRAMES} (angle ${st1.angle.toFixed(4)}, rate ${st1.vel})`);
      const off = s.frames.map((q) => q.gap - gapPredicted(line, q.angle, -q.angle));
      check(Math.min(...off) >= -GAP_UNDER && Math.max(...off) <= GAP_OVER, `S: the gap is the CPU split's on every frame: rest ${mm(rest)} mm against ${mm(predRest)} mm predicted; over the ${SPRING_FRAMES} frames ${mm(Math.min(...off))} to ${mm(Math.max(...off))} mm off (allowed -${mm(GAP_UNDER)} to +${mm(GAP_OVER)})`);
      const sk1 = await skullOf(z.id), shot1 = await photo(front);
      await thaw(3);
      const ph1 = await actorPhase(z.id);
      check(ph1 === "standing", `S: the zombie lives (thawed 3 frames: phase ${ph1})`);
      sheet("S-open", [{ img: shot0, c: px0 }, ...s.photos.map((img) => ({ img, c: px0 })), { img: shot1, c: px0 }]);
      // ---- W. chop 2 widens. The thaw let the body move (it flinches): the line and the eye are taken again.
      let sk2 = null; const wk = [];
      if (run("W") || run("K")) {
        line = await gapLine(z.id); eyeW = wedgeEye(line);
        const before = await gapRead(line, await readFrom(eyeW, line.G0));
        const w = await chopAndFollow(z.id, "R", line, eyeW);
        const rest2 = w.frames.at(-1).gap, pred2 = gapPredicted(line, t2, -t2), heads = (await evaluate("__sdfGame.axe()")).heads[z.id];
        out.w = { state: w.state, beforeMm: +mm(before), restMm: +mm(rest2), predictedMm: +mm(pred2) };
        check(w.n === 1 && heads === 2 && w.state?.preset === "middle" && w.state.sides === 0 && Math.abs(w.state.target - t2) < 1e-12 && w.state.angle === w.state.target,
          `W: chop 2 is counted and springs the same split on to its second angle (count ${heads}, target ${w.state?.target.toFixed(4)} rad, expected ${t2.toFixed(4)}; settled ${w.state?.angle === w.state?.target})`);
        check(rest2 - before >= W_WIDER && rest2 - pred2 >= -GAP_UNDER && rest2 - pred2 <= GAP_OVER, `W: the gap is wider than after chop 1: ${mm(before)} -> ${mm(rest2)} mm (+${mm(rest2 - before)} >= ${mm(W_WIDER)} mm), ${mm(pred2)} mm predicted (${mm(rest2 - pred2)} mm off; allowed -${mm(GAP_UNDER)} to +${mm(GAP_OVER)})`);
        sk2 = await skullOf(z.id);
        wk.push({ img: await photo([eyeW, line.G0]), c: await toPx(line.G0) });
        await thaw(3);
        const ph2 = await actorPhase(z.id);
        check(ph2 === "standing", `W: alive after chop 2 (thawed 3 frames: phase ${ph2})`);
      }
      // ---- K. chop 3 kills; the split is open on the corpse 45 frames on.
      let sk3 = null;
      if (run("K")) {
        line = await gapLine(z.id); eyeW = wedgeEye(line); await camAt(eyeW, line.G0); await syncCam();
        const n3 = await chop(z.id, "L"), heads = (await evaluate("__sdfGame.axe()")).heads[z.id];
        await thaw(3);
        const ph3 = await actorPhase(z.id), st3 = await stateOf(z.id);
        check(n3 === 1 && heads === 3 && ph3 !== "standing", `K: chop 3 kills (count ${heads}; thawed 3 frames: phase ${ph3})`);
        check(st3?.preset === "middle" && Math.abs(st3.target - full) < 1e-12, `K: the kill throws the split to its full angle (target ${st3?.target.toFixed(4)} rad, the preset's ${full})`);
        await thaw(K_LATER);
        const stL = await stateOf(z.id), wL = await splitOf(z.id), dL = await drawnOf(z.id), phL = await actorPhase(z.id);
        check(stL?.preset === "middle" && stL.angle === full && !!wL && Math.abs(wL.thetaP - full) < 1e-12 && Math.abs(wL.thetaM + full) < 1e-12 && !!dL && await recordOpen(z.id),
          `K: ${K_LATER} frames on (phase ${phL}) the corpse's head is still split open: state angle ${stL?.angle.toFixed(4)} rad, the pose's split ${wL ? `${wL.thetaP.toFixed(4)} / ${wL.thetaM.toFixed(4)}` : null}, drawn ${J(dL && [+dL.thetaP.toFixed(4), +dL.thetaM.toFixed(4)])}, the GPU record open`);
        // The gap on the corpse, wherever it lies.
        const lineK = await gapLine(z.id), eyeK = wedgeEye(lineK);
        const gapK = await gapRead(lineK, await readFrom(eyeK, lineK.G0)), predK = gapPredicted(lineK, full, -full);
        const shotK = await photo([eyeK, lineK.G0]), pxK = await toPx(lineK.G0);
        sk3 = await skullOf(z.id);
        out.k = { phase: ph3, later: phL, gapMm: +mm(gapK), predictedMm: +mm(predK), eye: eyeK.map((v) => +v.toFixed(3)), G0: lineK.G0.map((v) => +v.toFixed(3)) };
        check(gapK - predK >= -GAP_UNDER && gapK - predK <= GAP_OVER, `K: the gap measured on the corpse is the full split's: ${mm(gapK)} mm against ${mm(predK)} mm predicted (${mm(gapK - predK)} mm off; allowed -${mm(GAP_UNDER)} to +${mm(GAP_OVER)}; the eye at height ${eyeK[1].toFixed(2)} m)`);
        const faces = (await woundsOf(z.id)).filter((w) => w.headRegion === "split+" || w.headRegion === "split-");
        check(faces.length === 2 && faces.every((w) => w.shape === "cut"), `K: the corpse keeps the two cut faces (${J(faces.map((w) => w.headRegion))})`);
        wk.push({ img: shotK, c: pxK ?? px0 });
      }
      if (wk.length) sheet("WK-widen-kill", wk);
      // ---- M (stages). The skull at the three chops: a crack, a wider crack, split; a closed head draws the closed skull.
      if (run("M") && sk2 && sk3) {
        const fo = HEAD_SPLIT.skull.follow, bone = [t1 * fo[0][1], t2 * fo[1][1], full * fo[2][1]], got = [sk1, sk2, sk3];
        out.mStages = { closed: closedSkull, stages: got };
        check(closedSkull.bones === 0 && closedSkull.eyes === 0 && closedSkull.draws > 0 && closedSkull.angleP === 0,
          `M: a closed head draws the closed skull (${closedSkull.draws} bone draws for the actor, ${closedSkull.bones} split copies)`);
        check(got.every((g, i) => Math.abs(g.angleP - bone[i]) < 1e-9 && Math.abs(g.angleM + bone[i]) < 1e-9) && bone[0] < M_CRACK_MAX && bone[1] > 2 * bone[0] && bone[2] > M_SPLIT_MIN,
          `M: the bone opens in stages behind the flesh: ${got.map((g) => (g.angleP * 180 / Math.PI).toFixed(2)).join(" / ")} degrees a half at chops 1 / 2 / 3 (the table's ${bone.map((b) => (b * 180 / Math.PI).toFixed(2)).join(" / ")}; a crack under ${(M_CRACK_MAX * 180 / Math.PI).toFixed(1)}, split over ${(M_SPLIT_MIN * 180 / Math.PI).toFixed(1)})`);
        check(got.every((g) => g.bones === 3 && g.eyes === 2), `M: each stage draws the skull as three clipped copies and an eye a half (${got.map((g) => `${g.bones}+${g.eyes}`).join(", ")})`);
      }
    }
    await diag("chops"); closeSession(S); S = null;
  }
  // ======== BOOT 2 (the shipped path): range (R), head damage against the split (H).
  if (run("R") || run("H")) {
    await boot("range"); await loadRules();
    // -------- R. past the cut-off a split is drawn closed, flesh and skull; it opens again only inside the reopen
    // distance, and does not flip between the two.
    if (run("R")) {
      const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
      const accept = await evaluate(`(() => { const u = __sdfGame.zombie(${z.id}).view.uniforms; return { coneK: u.aaCfg.value.x, strength: u.aaCfg.value.y, secant: u.perfCfg.value.w }; })()`);
      // The eye-to-hinge distances: just inside the cut-off, past it, back in the hysteresis band, inside the reopen
      // distance. The hinge is not the head centre, so the stance is solved for each.
      const cams = {}, closed = {};
      const standAt = async (D, hinge) => { let d = D; for (let i = 0; i < 4; i++) { await look(hc, d, f); const e = await evaluate("__sdfGame.cameraWorld()"); d += D - len(sub(hinge, e)); } return evaluate("__sdfGame.pose()"); };
      const okF = await force(z.id, "middle", 0, 0, 1), w = await splitOf(z.id);
      const far = await evaluate(`(async () => (${HS}).splitDrawDistance(__sdfGame.zombie(${z.id}).posed().split, ${J(accept)}))()`), near = far * (await evaluate(`(async () => (${HS}).SPLIT_REOPEN_FRAC)()`));
      const DS = { inside: far - R_STEP, beyond: far + R_STEP, band: (far + near) / 2, reopened: near - R_STEP };
      for (const [k, D] of Object.entries(DS)) cams[k] = await standAt(D, w.h);
      await force(z.id, "middle", 0, 0, 0);
      for (const k of Object.keys(DS)) { await setCam(cams[k]); await stepN(SETTLE); await settle(); closed[k] = await readF(); }
      await setCam(cams.inside); await stepN(2);
      await force(z.id, "middle", 0, 0, 1);
      out.r = { drawDistance: +far.toFixed(3), reopen: +near.toFixed(3), visits: [] };
      const visit = async (k, wantOpen) => {
        await setCam(cams[k]); await stepN(2);
        // No toggle: the drawn state over R_HOLD frames at one stance.
        const seen = new Set(); for (let i = 0; i < R_HOLD; i++) { await stepOne(); seen.add(!!(await drawnOf(z.id))); }
        await stepN(SETTLE); await settle();
        const t = await readF(), sk = await skullOf(z.id), rec = await recordOpen(z.id), disc = await regionDisc(w, t);
        let differ = 0, hits = 0;
        for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) { if (d2([x + 0.5, y + 0.5], disc.c) > disc.R + 2) continue; const i = y * t.w + x; if (hitAt(t, i)) hits++; if (hitAt(t, i) !== hitAt(closed[k], i)) differ++; }
        const row = { stance: k, hingeM: +DS[k].toFixed(2), drawn: [...seen], record: rec, skullCopies: sk.bones + sk.eyes, skullDraws: sk.draws, discHits: hits, differFromClosed: differ };
        out.r.visits.push(row); note(`R: ${J(row)}`);
        const steady = seen.size === 1 && seen.has(wantOpen);
        if (wantOpen) check(steady && rec && sk.bones === 3 && sk.eyes === 2 && hits >= R_MIN_HITS && differ >= R_OPEN_MIN,
          `R: ${k} (${DS[k].toFixed(2)} m): drawn OPEN for ${R_HOLD} frames, flesh and skull (record ${rec}, ${sk.bones}+${sk.eyes} skull copies; ${differ} of ${hits} region texels differ from the closed head, >= ${R_OPEN_MIN})`);
        else check(steady && !rec && sk.bones === 0 && sk.eyes === 0 && sk.draws > 0 && hits >= R_MIN_HITS && differ <= R_CLOSED_MAX,
          `R: ${k} (${DS[k].toFixed(2)} m): drawn CLOSED for ${R_HOLD} frames, flesh and skull (record ${rec}, ${sk.bones + sk.eyes} skull copies of ${sk.draws} bone draws; ${differ} of ${hits} region texels differ from the closed head, <= ${R_CLOSED_MAX})`);
      };
      check(okF && Number.isFinite(far) && far > 4 && near < far, `R: the draw distance from the live uniforms: ${far.toFixed(2)} m, reopening inside ${near.toFixed(2)} m (accept ${J(accept)})`);
      await visit("inside", true); await visit("beyond", false); await visit("band", false); await visit("reopened", true);
      const pose = await splitOf(z.id);
      check(!!pose && pose.thetaP === w.thetaP, `R: the pose keeps the split at every range (${pose ? pose.thetaP : null} rad): only the drawing closes`);
    }
    // -------- H. head damage and the split do not mix.
    if (run("H")) {
      const hstate = (id) => evaluate(`__sdfGame.head.state(${id})`);
      // (1) a slug at a split head takes the ordinary un-warped crater: no burst state. The head is only a little open
      // (H_SLUG_OPEN), so the slug meets a half near where the closed head's prims are, as the burst's own test needs.
      {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
        const ok = await force(z.id, "middle", 0, 0, H_SLUG_OPEN);
        await look(hc, H_SLUG_D, f); await evaluate("__sdfGame.setAimPoint(0, 0)");
        const fr = await frameOf(z.id), right = qRot(fr.quat, [1, 0, 0]);
        await centreOn(add(fr.centre, mul(right, H_SLUG_OFF)));
        const pr = await evaluate("__sdfGame.predictSlugHit()");
        const w0 = (await woundsOf(z.id)).length;
        let fired = false; for (let i = 0; i < 4 && !fired; i++) { fired = await evaluate("__sdfGame.fireSlug()"); if (!fired) await stepN(90); }
        await stepN(H_FRAMES);
        const hs = await hstate(z.id), ws = (await woundsOf(z.id)).slice(w0), st = await stateOf(z.id);
        out.hSlug = { predicted: pr?.actorId, fired, newWounds: ws.map((q) => ({ shape: q.shape, limb: q.limb, r: +q.radius.toFixed(3) })), headState: hs, split: st && st.preset };
        check(ok && fired && pr?.actorId === z.id && ws.some((q) => q.limb === "head") && hs === null,
          `H: a slug into a split head leaves an ordinary wound and no burst state (aimed at actor ${pr?.actorId}; ${ws.length} new wound(s) ${J(ws.map((q) => q.limb))}; head damage state ${J(hs)})`);
      }
      // (2) a flail hit on a split head: the plain face crater, as a head hit (the head's share of the meter).
      {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
        const ok = await force(z.id, "middle", 0, 0, AXE_HEAD.openAngles[0]);
        const sel = await evaluate(`__sdfGame.selectSlot("flail")`); await stepN(40);
        await evaluate("__sdfGame.flail.setHitStop(false); __sdfGame.flail.setImpactFx(false); 1");
        await look(hc, H_FLAIL_D, f); await stepN(2);
        // The meter the seam reports is the actor's last step's: a one-frame thaw either side of the hit.
        await thaw(1);
        const m0 = await meterOf(z.id), w0 = (await woundsOf(z.id)).length, pre = await evaluate("__sdfGame.flail.state()");
        await evaluate("__sdfGame.flail.click()");
        let post = pre; for (let i = 0; i < 90 && post.strikes === pre.strikes; i++) { await stepOne(); post = await evaluate("__sdfGame.flail.state()"); }
        await thaw(1);
        const m1 = await meterOf(z.id), ws = (await woundsOf(z.id)).slice(w0), hs = await hstate(z.id), ls = post.lastStrike;
        const feel = await evaluate(`(async () => { const F = await import("/src/lab/sdf-zombie/webgpu/game-flail.ts"), K = await import("/src/lab/sdf-zombie/webgpu/flail-strike.ts"); return { credit: F.FLAIL_FEEL.swing[${J(ls?.side ?? "R")}].meterCredit, scale: K.FLAIL_HEAD.meterScale, r: K.FLAIL_HEAD.faceCraterR }; })()`);
        out.hFlail = { side: ls?.side, hits: ls?.hits, headHits: ls?.headHits, meter: [m0, m1], newWounds: ws.map((q) => ({ limb: q.limb, r: +q.radius.toFixed(3) })), headState: hs };
        check(ok && sel?.ok && post.strikes === pre.strikes + 1 && ls?.hits?.includes(z.id) && (ls.headHits?.[z.id] ?? 0) >= 1 && hs === null && ws.length === 1 && Math.abs(ws[0].radius - feel.r) < 1e-9,
          `H: a flail head hit on a split head stamps the plain face crater and no head damage state (strike ${ls?.side}, head hit ${ls?.headHits?.[z.id]}; ${J(out.hFlail.newWounds)}; state ${J(hs)})`);
        check(Math.abs((m1 - m0) - feel.credit * feel.scale) < 1e-9, `H: it credits the head's share of the collapse meter: ${(m1 - m0).toFixed(5)} (${feel.credit} x ${feel.scale} = ${(feel.credit * feel.scale).toFixed(5)}; the full swing would be ${feel.credit})`);
      }
      // (3) a head the head damage leaf already holds refuses to split, and still dies on chop 3.
      {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id), fr = await frameOf(z.id);
        const p = await surfHit(z.id, add(fr.centre, mul(f, 0.5)), mul(f, -1));
        const hit = await evaluate(`__sdfGame.head.hit(${z.id}, ${p[0]}, ${p[1]}, ${p[2]}, ${-f[0]}, ${-f[1]}, ${-f[2]}, "R")`);
        await stepN(3);
        const hs0 = await hstate(z.id);
        const splits = [], phases = [];
        for (const side of ["H", "R", "L"]) {
          await look(await headOf(z.id), HEAD_D, f);
          await chop(z.id, side); await stepN(SPRING_FRAMES >> 1); splits.push(await stateOf(z.id));
          await thaw(3); phases.push(await actorPhase(z.id));
        }
        out.hHeld = { hit, hits: hs0?.hits, splits, phases, chops: (await evaluate("__sdfGame.axe()")).heads[z.id] };
        check(hit === true && !!hs0 && splits.every((s) => s === null), `H: a head that head damage holds (${hs0?.hits} hit) refuses to split on all three chops (${J(splits)})`);
        check(phases[0] === "standing" && phases[1] === "standing" && phases[2] !== "standing" && out.hHeld.chops === 3, `H: it still dies on chop 3 (phases ${J(phases)}, ${out.hHeld.chops} chops counted)`);
      }
    }
    await diag("range"); closeSession(S); S = null;
  }
  // ======== BOOTS 3 and 4. B: bounds. Each preset at full angle, from the front at 0.6 m and from above and behind:
  // the shipped path's hit mask against the per-body path with every march bound off and the proxy box grown (the
  // field alone), the same zombies and cameras. The closed head's own count is the instrument's floor.
  if (run("B")) {
    const shots = {}, tiles = [];
    for (const mode of ["ship", "free"]) {
      await boot(`bounds-${mode}`, mode === "free" ? "&crowd=0" : ""); await loadRules();
      if (mode === "free") await evaluate("__sdfGame.setShell(false); __sdfGame.setOccluder(false); __sdfGame.setCone(false); __sdfGame.setTemporalStart(false); __sdfGame.setDepthPrepass(false); 1");
      /** The proxy box grown 1.8 x about its centre (mesh, bodyHalf and record), so the box clips nothing. */
      const freeBox = (id) => evaluate(`(() => { const v = __sdfGame.zombie(${id}).view; v.object.scale.multiplyScalar(1.8); v.uniforms.bodyHalf.value.multiplyScalar(1.8); v.syncRecord(); return 1; })()`);
      for (const [name, [preset, sides, offset]] of Object.entries(SCEN)) {
        const z = fresh(); const hc = await headOf(z.id), f = await frontOf(z.id);
        const rec = (shots[name] ??= { cams: {}, ship: {}, free: {}, headAt: {} });
        rec.headAt[mode] = hc;
        if (mode === "ship") { rec.cams.front = (await look(hc, 0.6, f)).pose; rec.cams.top = await topCam(hc, f); }
        for (const state of ["closed", "open"]) {
          if (state === "open") { const ok = await force(z.id, preset, sides, offset, 1); if (!ok) fail(`B: forceSplit ${name} (${mode})`); rec.w = await splitOf(z.id); }
          if (mode === "free" && state === "open") { await freeBox(z.id); await stepOne(); }
          for (const cn of ["front", "top"]) {
            await setCam(rec.cams[cn]); await syncCam(); await settle(SETTLE);
            const t = await readF();
            rec[mode][`${state}-${cn}`] = t;
            if (state === "open") rec[`disc-${cn}-${mode}`] = await regionDisc(rec.w, t);
            if (mode === "ship" && state === "open") { const img = await capture(); tiles.push({ img, c: await toPx(add(rec.w.h, [0, 0.12, 0])) }); }
          }
        }
      }
      await diag(`bounds-${mode}`); closeSession(S); S = null;
    }
    out.b = [];
    // The sheet: per view, the two hit masks about the region (grey both, red the field alone only: clipped on the
    // shipped path; blue the shipped path only; yellow both, at depths over B_DEPTH apart), 2 x 2 px a texel.
    const BW = 150, sheetRgb = Buffer.alloc(6 * BW * 2 * BW * 2 * 3); let col = 0;
    for (const [name, rec] of Object.entries(shots)) for (const cn of ["front", "top"]) {
      const disc = rec[`disc-${cn}-ship`], row = { preset: name, cam: cn };
      for (const state of ["closed", "open"]) {
        const a = rec.ship[`${state}-${cn}`], b = rec.free[`${state}-${cn}`];
        let clipped = 0, shipOnly = 0, hits = 0, depthOff = 0;
        for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { if (d2([x + 0.5, y + 0.5], disc.c) > disc.R + 4) continue; const i = y * a.w + x, ha = hitAt(a, i), hb = hitAt(b, i);
          if (hb) hits++; if (hb && !ha) clipped++; if (ha && !hb) shipOnly++;
          if (ha && hb && Math.abs(a.f[i * 4 + 3] - b.f[i * 4 + 3]) > B_DEPTH * Math.max(Math.abs(b.f[i * 4 + 3]), 1e-6)) depthOff++; }
        row[state] = { clipped, shipOnly, depthOff, hits };
        if (state === "open") for (let y = 0; y < BW * 2; y++) for (let x = 0; x < BW * 2; x++) {
          const sx = Math.round(disc.c[0] - BW / 2) + (x >> 1), sy = Math.round(disc.c[1] - BW / 2) + (y >> 1), o = ((y * 6 * BW * 2) + col * BW * 2 + x) * 3;
          if (sx < 0 || sy < 0 || sx >= a.w || sy >= a.h) continue;
          const i = sy * a.w + sx, ha = hitAt(a, i), hb = hitAt(b, i);
          const off = ha && hb && Math.abs(a.f[i * 4 + 3] - b.f[i * 4 + 3]) > B_DEPTH * Math.max(Math.abs(b.f[i * 4 + 3]), 1e-6);
          const c = off ? [230, 200, 0] : ha && hb ? [90, 90, 90] : hb ? [255, 0, 0] : ha ? [0, 110, 255] : [0, 0, 0];
          sheetRgb[o] = c[0]; sheetRgb[o + 1] = c[1]; sheetRgb[o + 2] = c[2];
        }
      }
      col++;
      row.drift = +len(sub(rec.headAt.ship, rec.headAt.free)).toExponential(1);
      out.b.push(row); note(`B: ${J(row)}`);
      const o = row.open, c = row.closed;
      // A bound that is too tight CLIPS (the field alone hits, the shipped path does not) or lands the hit on a surface
      // behind (both hit, depths apart); the extra texels are the two paths' different ray starts on a rim, reported.
      check(row.drift < 1e-6 && o.hits >= B_MIN_HITS && o.clipped <= c.clipped + B_MARGIN && o.depthOff <= c.depthOff + B_DEPTH_MARGIN,
        `B: ${name}, ${cn}: the shipped path clips nothing off the open head: ${o.clipped} of the field's ${o.hits} hit texels missing (the closed head's floor ${c.clipped}, + ${B_MARGIN} allowed), ${o.depthOff} at another depth (floor ${c.depthOff}, + ${B_DEPTH_MARGIN}); ${o.shipOnly} extra (closed ${c.shipOnly})`);
    }
    writeFileSync(`${OUT}/B-bounds-masks.png`, encodePng(6 * BW * 2, BW * 2, sheetRgb)); console.log(`  sheet ${OUT}/B-bounds-masks.png (6 views)`);
    sheet("B-bounds", tiles);
  }
  // ======== BOOT 5. T: S on a turned zombie (the ring walks until one stands about 90 degrees round, then freezes).
  if (run("T")) {
    await boot("turned"); await loadRules();
    await evaluate("__sdfGame.freeze(false)");
    let pick = null, frames = 0;
    for (; frames < T_MAX_FRAMES && !pick; frames += 10) {
      await stepN(10);
      const zs = (await evaluate("__sdfGame.actorList()")).filter((q) => q.kind === "zombie" && pool.some((p) => p.id === q.id));
      pick = zs.filter((q) => Math.abs(Math.sin(q.yaw)) >= T_SIN_MIN && q.phase === "standing").sort((a, b) => Math.abs(Math.sin(b.yaw)) - Math.abs(Math.sin(a.yaw)))[0] ?? null;
    }
    await evaluate("__sdfGame.freeze(true)");
    if (!pick) die(`T: no ring zombie turned to |sin yaw| >= ${T_SIN_MIN} in ${T_MAX_FRAMES} frames`);
    await stepN(30);
    const yawNow = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === pick.id).yaw;
    const hc = await headOf(pick.id), f = await frontOf(pick.id);
    const front = (await look(hc, HEAD_D, f)).pose; await stepN(SETTLE);
    const shot0 = await capture(), px0 = await headPx(pick.id);
    const line = await gapLine(pick.id), eyeW = wedgeEye(line);
    const closedGap = await gapRead(line, await readFrom(eyeW, line.G0));
    await camAt(eyeW, line.G0); await syncCam();
    const s = await chopAndFollow(pick.id, "H", line, eyeW, front, [SPRING_FRAMES]);
    const t1 = AXE_HEAD.openAngles[0] * HEAD_SPLIT.presets.middle.maxBoth, rest = s.frames.at(-1).gap, pred = gapPredicted(line, t1, -t1);
    const w = await splitOf(pick.id), lineW = await gapLine(pick.id);
    out.t = { yawDeg: +(yawNow * 180 / Math.PI).toFixed(1), frames, state: s.state, restMm: +mm(rest), predictedMm: +mm(pred), planeDotFrame: w ? +dot(w.n, line.n).toFixed(9) : null };
    check(Math.abs(Math.sin(yawNow)) >= T_SIN_MIN, `T: the body is turned (yaw ${out.t.yawDeg} deg, |sin| ${Math.abs(Math.sin(yawNow)).toFixed(2)} >= ${T_SIN_MIN}; ${frames} walking frames)`);
    check(s.n === 1 && s.state?.preset === "middle" && s.state.sides === 0 && s.state.angle === t1 && !!w && dot(w.n, line.n) > 1 - 1e-9 && len(sub(lineW.G0, line.G0)) < 1e-9,
      `T: a chop from its front opens a centred middle split on the turned head's own plane (${J(s.state && { preset: s.state.preset, sides: s.state.sides })}; plane normal . head right ${out.t.planeDotFrame}; the gap lines ${len(sub(lineW.G0, line.G0)).toExponential(1)} m apart)`);
    check(closedGap === 0 && rest - pred >= -GAP_UNDER && rest - pred <= GAP_OVER, `T: the gap on the turned head is the CPU split's: ${mm(rest)} mm against ${mm(pred)} mm predicted (${mm(rest - pred)} mm off; allowed -${mm(GAP_UNDER)} to +${mm(GAP_OVER)}; closed ${mm(closedGap)} mm)`);
    sheet("T-turned", [{ img: shot0, c: px0 }, { img: s.photos[0], c: px0 }]);
    await diag("turned"); closeSession(S); S = null;
  }
} finally { if (S) closeSession(S); }
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `C: zero console errors or exceptions across the run (${errs.length}${errs.length ? ": " + J(errs.slice(0, 3)) : ""})`);
const dirty = Object.entries(out.diag).filter(([, d]) => !d || d.lost || d.uncapturedCount !== 0);
check(Object.keys(out.diag).length > 0 && dirty.length === 0, `C: gpuDiagnostics clean at the end of every boot (${Object.keys(out.diag).join(", ")}: no device loss, uncapturedCount 0${dirty.length ? "; DIRTY " + J(dirty) : ""})`);
console.log(`\nsummary: ${J(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
