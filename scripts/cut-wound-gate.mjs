// scripts/cut-wound-gate.mjs — cut wounds M1 (plan docs/superpowers/plans/2026-10-03-cut-wounds-m1.md Task 8).
// Bare ring page (/sdf-game.html, no ?level), frozen zombies, headless WebGPU. Photos go to OUT for the look loop.
//   W. WOUND CAPACITY: 40 pellet rays at a grid on one torso: 30 hits keep >= 28 visible wounds (32 slots; merging, not
//      dropping); 40 keep exactly 32, and none of the first 10 hit points is left uncovered (merge, not evict).
//   G. WOUNDS 17-32 RENDER ON THE GPU: on a fresh body stamp 16 wounds on the torso's FAR side, photo the near side, stamp 8
//      at distinct near-side spots (wounds 17-24), photo, 8 more (25-32), photo: every one of those 16 spots changes (mean
//      per-pixel |dLuma| in a 0.6-crater-radius disc against the previous photo, >= G_SPOT_MIN; two locked renders of one
//      state are the noise floor). Frame cost: timeDraws at 0 vs 32 wounds, with the two baselines' spread (not gated).
//   K. SEAM CUT on a torso (__sdfGame.cut, view = the eye's direction to the cut): one wound, shape cut; across the cut line
//      in a 0.6 m photo the luma profile dips (interior) between two brighter shoulders (lips), and no bone colour appears
//      beside the slot.
//   H. HEAD CUT: a diagonal slash on the face shows (within H_BAND_CM of it), and the face outside that band is unchanged.
//   R. REAL ROD: slot 6, rodPress, the crosshair swept across a torso over 20 frames (setAimPoint + step), rodRelease:
//      >= 1 cut stamped. The canvas mousedown needs pointer lock, which headless Chrome cannot take: that path is NOT
//      exercised here (rodPress / rodRelease call the harness's onMouseDown / onMouseUp).
//   C. cost: draw time before / after 3 cuts (with its spread, not gated); zero console errors.
//   T. K ON A TURNED BODY (its own boot): the ring walks until a zombie stands ~90 degrees round, then freezes; K's cut and
//      bone checks on that body, plus the exposure the bone meshes received (meshExposure) covers the slot's midpoint. Every
//      ring zombie boots at yaw 0, where the wound body frame equals the world frame, so K alone cannot see a yaw mismatch.
// ONLY=K,T (env) runs just those scenarios.
// Usage (bash, not zsh):
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/cut-wound-gate.mjs 5241 9241
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-10-03-cut-wounds/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62, PHOTO_D = 0.6, ROD_D = 1.1;
/** W's 5 x 8 pellet grid step (m: across, up), centred on the torso: inside one torso prim (see the prim check). */
const W_STEP = [0.04, 0.035];
/** The crosshair sweep (aim-point x, from -> to) across the torso in R. */
const R_SWEEP = [-0.15, 0.15];
// Thresholds, set from the first read photos (NOTES.md, Task 8). The renders are deterministic: two locked renders of one
// state differ by <= 0.3 mean |dLuma| in any measured disc.
//   G: the 16 new spots measured 11.6-38.5 (noise <= 0.29).
const G_SPOT_MIN = 5;
//   K: the dimmest view (the chest's shadowed side) dipped 15.7 below its darker shoulder.
const K_DIP_MIN = 8;
//   H: 7.4 within 5 cm of the cut; 0.81 outside it (1.8% of the pixels over 6), against 0.06 between two renders.
//   T: the turned body for K's checks on a non-zero yaw (about 90 degrees round), staged within this many walking frames.
const T_SIN_MIN = 0.97, T_MAX_FRAMES = 900;
const H_PIX = 6, H_BAND_CM = 5, H_IN_MIN = 4, H_OUT_MAX = 1.0, H_OUT_SHARE_MAX = 0.03;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const results = [];
const fail = (msg) => { console.error(`FAIL: ${msg}`); results.push(`FAIL: ${msg}`); failures++; };
const pass = (msg) => { console.log(`PASS: ${msg}`); results.push(`PASS: ${msg}`); };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const note = (msg) => console.log(`  measure: ${msg}`);
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const f2 = (v) => v.map((c) => c.toFixed(3)).join(", ");
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
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
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
async function capture(name) {
  await evaluate("__sdfGame.setRenderLock(true)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await evaluate("__sdfGame.setRenderLock(false)");
  const buf = Buffer.from(s.result.data, "base64");
  if (name) { writeFileSync(`${OUT}/${name}.png`, buf); console.log(`  shot ${OUT}/${name}.png`); }
  return Object.assign(decodePng(buf), { buf });
}
// ---- Boot the bare ring page, frozen zombies -----------------------------------------------------------
let centre = [0, 0, 0], pool = [], usedZ = new Set();
async function boot(label) {
  const s = await openSession(label);
  await send("Page.enable"); await send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${s.tab.id}`);
  await send("Page.bringToFront");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off&loader=0` });
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
  // Pixel measures: the practical-fire flicker pinned (two locked renders compare), no blood over the wound (the photos
  // judge the carve and its shading; the rod's own bleed is exercised in R, where it is switched back on), and free aim
  // OFF so the DOM reticle is not drawn over the cut (R turns it on for its setAimPoint sweep).
  await evaluate("__sdfGame.setLightClockFrozen(true)");
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
const torsoOf = (id) => evaluate(`__sdfGame.actorLimbCenter(${id}, "torso")`);
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
/** Mean luma in a px disc. */
function discLuma(img, c, r) {
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(c[1] - r)); y <= Math.min(img.h - 1, Math.ceil(c[1] + r)); y++)
    for (let x = Math.max(0, Math.floor(c[0] - r)); x <= Math.min(img.w - 1, Math.ceil(c[0] + r)); x++)
      if ((x - c[0]) ** 2 + (y - c[1]) ** 2 <= r * r) { s += luma(px(img, x, y)); n++; }
  return n ? s / n : 0;
}
/** Mean per-pixel |delta luma| between two images in a px disc. */
function discDelta(a, b, c, r) {
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(c[1] - r)); y <= Math.min(a.h - 1, Math.ceil(c[1] + r)); y++)
    for (let x = Math.max(0, Math.floor(c[0] - r)); x <= Math.min(a.w - 1, Math.ceil(c[0] + r)); x++)
      if ((x - c[0]) ** 2 + (y - c[1]) ** 2 <= r * r) { s += Math.abs(luma(px(a, x, y)) - luma(px(b, x, y))); n++; }
  return n ? s / n : 0;
}
/** px distance from point p to segment ab (all px). */
function segDist(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t);
}
/** Luma profile ACROSS a cut: from c along unit px direction u, t in [-half, half], each sample averaged over +-avg px
 *  along unit px direction v (the cut line). */
function profile(img, c, u, v, half, avg) {
  const out = [];
  for (let t = -half; t <= half; t++) {
    let s = 0, n = 0;
    for (let k = -avg; k <= avg; k++) {
      const x = Math.round(c[0] + u[0] * t + v[0] * k), y = Math.round(c[1] + u[1] * t + v[1] * k);
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      s += luma(px(img, x, y)); n++;
    }
    out.push({ t, l: n ? s / n : 0 });
  }
  return out;
}
/** The exposed bone MESH's colour here (skeleton=mesh; e.g. 185/110/112 under the red-tinted flashlight): a light, far less
 *  saturated pixel than the flesh, but still pink (r >= 1.4 g), unlike the grey view model. head-damage-gate's isBone (tuned on the lit skull: g/r >= 0.62, b/g <= 0.85) misses
 *  it. The pale patch in the K slot was proved to be the bone by an A/B boot with ?skeleton=procedural (NOTES.md). */
const isPale = (c) => { const [r, g, b] = c; return r >= 120 && g >= 0.5 * r && b >= 0.5 * r && r >= 1.4 * g; };
/** Pale (bone) share of pixels within `band` px of segment ab (the slot), and in the ring 2..4 band beside it (clear of the
 *  slot's jagged walls and its smax fillet). */
function boneAlong(img, a, b, band) {
  let nIn = 0, bIn = 0, nOut = 0, bOut = 0;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - 4 * band)), x1 = Math.min(img.w - 1, Math.ceil(Math.max(a[0], b[0]) + 4 * band));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - 4 * band)), y1 = Math.min(img.h - 1, Math.ceil(Math.max(a[1], b[1]) + 4 * band));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = segDist([x, y], a, b);
    if (d <= band) { nIn++; if (isPale(px(img, x, y))) bIn++; } else if (d >= 2 * band && d <= 4 * band) { nOut++; if (isPale(px(img, x, y))) bOut++; }
  }
  return { inSlot: nIn ? bIn / nIn : 0, beside: nOut ? bOut / nOut : 0 };
}
/** Write a crop of the image (centred, w x h) for the notes. */
function cropOut(img, c, w, h, name) { writeFileSync(`${OUT}/${name}.png`, encodePng(w, h, cropRgb(img, c[0], c[1], w, h))); console.log(`  crop ${OUT}/${name}.png`); }
const timeDraws = () => evaluate("__sdfGame.timeDraws(120)", 300000);

const out = {};
try {
  await boot("cut");
  // -------- W. capacity: 40 pellet rays at a 5 x 8 grid on one torso's near side.
  if (run("W")) {
    const z = fresh();
    const t = await torsoOf(z.id), f = await frontOf(z.id);
    const v = await look(t, 1.6, f);
    const e = await eye();
    const hits = [], prims = [];
    for (let i = 0; i < 40; i++) {
      const aim = add(add(t, mul(v.right, ((i % 5) - 2) * W_STEP[0])), mul(v.up, (Math.floor(i / 5) - 3.5) * W_STEP[1]));
      const d = unit(sub(aim, e));
      hits.push(await evaluate(`__sdfGame.stampWoundAt(${e[0]}, ${e[1]}, ${e[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${z.id})`));
      const now = await woundsOf(z.id);
      prims.push(`${now.at(-1)?.limb}#${now.at(-1)?.prim}`);   // the new wound is always last (a merge folds the OLDEST)
      if (i === 29) out.after30 = now.length;
    }
    const ws = await woundsOf(z.id);
    out.after40 = ws.length;
    const primSet = [...new Set(prims)];
    note(`W: the 40 hits landed on ${J(Object.fromEntries(primSet.map((k) => [k, prims.filter((q) => q === k).length])))}`);
    check(hits.every((h) => !!h), `W: all 40 rays hit the torso (${hits.filter(Boolean).length})`);
    // A merge joins wounds on ONE prim (MERGE): a lone wound on a prim of its own is evicted by design, so the coverage
    // check below is only meaningful when every hit has same-prim neighbours (the torso is several prims).
    const minPerPrim = Math.min(...primSet.map((k) => prims.filter((q) => q === k).length));
    check(minPerPrim >= 5, `W: every prim hit carries >= 5 of the 40 hits, so the oldest always has a merge partner (min ${minPerPrim})`);
    check(out.after30 >= 28, `W: 30 hits keep ${out.after30} wounds visible (>= 28 of 32 slots)`);
    check(out.after40 === 32, `W: 40 hits keep exactly 32 wounds (${out.after40}): merged, never more`);
    const uncovered = hits.slice(0, 10).map((h, i) => ({ i, h, gap: Math.min(...ws.map((w) => len(sub(w.pos, h)) - w.radius)) })).filter((q) => q.gap > 1e-3);
    note(`W: first-10 coverage gaps (m, <= 0 = covered): ${hits.slice(0, 10).map((h) => Math.min(...ws.map((w) => len(sub(w.pos, h)) - w.radius)).toFixed(3)).join(", ")}`);
    check(uncovered.length === 0, `W: every one of the first 10 hit points is still inside a wound (merge, not evict): ${uncovered.length} uncovered`);
    await look(t, PHOTO_D, f); await capture("W-40");
  }

  // -------- G. wounds 17-32 render on the GPU; frame cost at 0 vs 32 wounds.
  if (run("G")) {
    const z = fresh();
    const t = await torsoOf(z.id), f = await frontOf(z.id);
    // The cost at a play distance too (2 m), where the wounds cover far fewer pixels than in the 0.6 m close-up.
    await look(t, 2.0, f);
    out.g0a2 = await timeDraws(); out.g0b2 = await timeDraws();
    const v = await look(t, PHOTO_D, f);
    const e = await eye();
    const nearC = await surfHit(z.id, e, unit(sub(t, e)));
    out.g0a = await timeDraws(); out.g0b = await timeDraws();
    const img0 = await capture("G-00");
    // 16 on the FAR side (rays from 1 m behind the torso), not visible from this stance.
    const grid = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) grid.push({ c, r, dx: (c - 1.5) * 0.075, dy: (r - 1.5) * 0.09 });
    let farHits = 0;
    for (const g of grid) {
      const o = add(add(add(t, mul(v.back, -1.0)), mul(v.right, g.dx)), mul(v.up, g.dy));
      const d = v.back;
      if (await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${z.id})`)) farHits++;
    }
    const n16 = (await woundsOf(z.id)).length;
    check(farHits === 16 && n16 === 16, `G: 16 far-side wounds stamped (${farHits} hits, ${n16} wounds)`);
    const img16 = await capture("G-16");
    const img16b = await capture(null);   // the noise twin: a second locked render of the same state
    out.g16 = await timeDraws();
    // Then the near side, in two checkerboard batches of 8: wounds 17-24, then 25-32.
    const batches = [grid.filter((g) => (g.c + g.r) % 2 === 0), grid.filter((g) => (g.c + g.r) % 2 === 1)];
    const imgs = [img16];
    const spots = [];
    for (let b = 0; b < 2; b++) {
      const bs = [];
      for (const g of batches[b]) {
        const aim = add(add(nearC, mul(v.right, g.dx)), mul(v.up, g.dy));
        const d = unit(sub(aim, e));
        const h = await evaluate(`__sdfGame.stampWoundAt(${e[0]}, ${e[1]}, ${e[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${z.id})`);
        if (h) bs.push(h);
      }
      const ws = await woundsOf(z.id);
      const rWorld = ws[ws.length - 1].radius;
      const shot = await capture(b === 0 ? "G-24" : "G-32");
      imgs.push(shot);
      if (b === 0) out.g24 = await timeDraws();
      for (const h of bs) {
        const c = await toPx(h), c2 = await toPx(add(h, mul(v.right, rWorld)));
        const rPx = c && c2 ? Math.hypot(c2[0] - c[0], c2[1] - c[1]) : 0;
        spots.push({ batch: b, c, r: rPx * 0.6, delta: c ? discDelta(imgs[b], shot, c, rPx * 0.6) : 0, noise: c ? discDelta(img16, img16b, c, rPx * 0.6) : 0, far: c ? discDelta(img0, img16, c, rPx * 0.6) : 0 });
      }
      check(bs.length === 8 && ws.length === 16 + 8 * (b + 1), `G: batch ${b + 1}: 8 near-side wounds stamped as wounds ${17 + 8 * b}-${24 + 8 * b} (${bs.length} hits, ${ws.length} wounds)`);
    }
    out.g32 = await timeDraws();
    await look(t, 2.0, f);
    out.g32_2 = await timeDraws();
    const noiseMax = Math.max(...spots.map((s) => s.noise));
    out.gSpots = spots.map((s) => ({ b: s.batch + 1, px: s.c?.map((q) => Math.round(q)), r: +s.r.toFixed(1), delta: +s.delta.toFixed(2), noise: +s.noise.toFixed(2), far: +s.far.toFixed(2) }));
    note(`G: per-spot mean |dLuma| in a 0.6-crater-radius disc (batch 1 = wounds 17-24: G-16 -> G-24; batch 2 = 25-32: G-24 -> G-32), the same disc between two locked renders of G-16 (noise), and G-00 -> G-16 (the far-side stamps): ${JSON.stringify(out.gSpots)}`);
    for (let b = 0; b < 2; b++) {
      const sb = spots.filter((s) => s.batch === b);
      const minD = Math.min(...sb.map((s) => s.delta));
      check(sb.length === 8 && minD >= G_SPOT_MIN, `G: every one of wounds ${17 + 8 * b}-${24 + 8 * b} changes its spot: min mean |dLuma| ${minD.toFixed(2)} >= ${G_SPOT_MIN} (noise max ${noiseMax.toFixed(2)})`);
    }
    check(noiseMax < G_SPOT_MIN / 4, `G: two locked renders agree in every spot disc (noise max ${noiseMax.toFixed(2)} < ${(G_SPOT_MIN / 4).toFixed(2)})`);
    note(`G: frame cost at 0.6 m (UNGATED): 0 wounds ${out.g0a.toFixed(2)} / ${out.g0b.toFixed(2)} ms (spread ${Math.abs(out.g0a - out.g0b).toFixed(2)}), 16 (far side) ${out.g16.toFixed(2)}, 24 ${out.g24.toFixed(2)}, 32 wounds ${out.g32.toFixed(2)} ms; delta 0 -> 32 ${(out.g32 - (out.g0a + out.g0b) / 2).toFixed(2)} ms`);
    note(`G: frame cost at 2 m (UNGATED): 0 wounds ${out.g0a2.toFixed(2)} / ${out.g0b2.toFixed(2)} ms (spread ${Math.abs(out.g0a2 - out.g0b2).toFixed(2)}), 32 wounds ${out.g32_2.toFixed(2)} ms; delta ${(out.g32_2 - (out.g0a2 + out.g0b2) / 2).toFixed(2)} ms`);
  }

  // -------- K. a seam cut on a torso: a vertical slot through the near-side centre.
  if (run("K")) {
    const z = fresh();
    const t = await torsoOf(z.id), f = await frontOf(z.id);
    let v = await look(t, PHOTO_D, f);
    const e = await eye();
    const P = await surfHit(z.id, e, unit(sub(t, e)));
    // Centred 6 cm above the cut's midpoint: the screen-centre dot then sits on the cut line, clear of the profile's band.
    v = await look(add(P, mul(v.up, 0.06)), PHOTO_D, f);
    const before = await capture("K-before");
    const view = unit(sub(P, await eye()));
    const a = add(P, mul(v.up, -0.1)), b = add(P, mul(v.up, 0.1));
    // No hand step between the photos: the cut uploads on the capture's own locked renders, and two stepped frames sway
    // the view model and its light (measured ~0.4-0.7 mean |dLuma| over a head with nothing else changed).
    const n = await evaluate(`__sdfGame.cut(${z.id}, ${J(a)}, ${J(b)}, ${J(view)})`);
    const ws = await woundsOf(z.id);
    check(n === 1 && ws.length === 1 && ws[0].shape === "cut", `K: one cut wound stamped (${n}; shapes ${J(ws.map((w) => w.shape))})`);
    const after = await capture("K-after");
    const w = ws[0];
    const c = await toPx(w.pos), cr = await toPx(add(w.pos, mul(v.right, w.kerf))), cu = await toPx(add(w.pos, mul(v.up, 0.02)));
    const kerfPx = Math.hypot(cr[0] - c[0], cr[1] - c[1]);
    const u = [(cr[0] - c[0]) / kerfPx, (cr[1] - c[1]) / kerfPx];
    const vl = Math.hypot(cu[0] - c[0], cu[1] - c[1]), vv = [(cu[0] - c[0]) / vl, (cu[1] - c[1]) / vl];
    const half = Math.round(6 * kerfPx), avg = Math.round(vl);
    const pA = profile(after, c, u, vv, half, avg), pB = profile(before, c, u, vv, half, avg);
    const inner = pA.filter((q) => Math.abs(q.t) <= kerfPx);
    const lipL = pA.filter((q) => q.t <= -kerfPx && q.t >= -4 * kerfPx), lipR = pA.filter((q) => q.t >= kerfPx && q.t <= 4 * kerfPx);
    const at = (p, t) => p.reduce((m, q) => (Math.abs(q.t - t) < Math.abs(m.t - t) ? q : m)).l;
    const mean = (xs) => xs.reduce((m, q) => m + q.l, 0) / xs.length;
    out.k = {
      kerfPx: +kerfPx.toFixed(1), interiorMin: +Math.min(...inner.map((q) => q.l)).toFixed(1), interiorMean: +mean(inner).toFixed(1),
      lipLMax: +Math.max(...lipL.map((q) => q.l)).toFixed(1), lipRMax: +Math.max(...lipR.map((q) => q.l)).toFixed(1),
      beforeCentre: +mean(pB.filter((q) => Math.abs(q.t) <= kerfPx)).toFixed(1),
      beforeLipL: +Math.max(...pB.filter((q) => q.t <= -kerfPx && q.t >= -4 * kerfPx).map((q) => q.l)).toFixed(1),
      beforeLipR: +Math.max(...pB.filter((q) => q.t >= kerfPx && q.t <= 4 * kerfPx).map((q) => q.l)).toFixed(1),
      // The lip ridges sit at 1.5 kerf (CUT_SHADE.lipOffset): after vs before there.
      lipAtL: [+at(pB, -1.5 * kerfPx).toFixed(1), +at(pA, -1.5 * kerfPx).toFixed(1)], lipAtR: [+at(pB, 1.5 * kerfPx).toFixed(1), +at(pA, 1.5 * kerfPx).toFixed(1)],
    };
    note(`K: profile across the cut at its midpoint px (${c.map((q) => q.toFixed(0)).join(", ")}), kerf ${kerfPx.toFixed(1)} px, averaged over +-${avg} px along the cut: after ${pA.filter((q) => q.t % 2 === 0).map((q) => `${q.t}:${q.l.toFixed(0)}`).join(" ")}`);
    note(`K: before ${pB.filter((q) => q.t % 2 === 0).map((q) => `${q.t}:${q.l.toFixed(0)}`).join(" ")}`);
    note(`K: ${J(out.k)}`);
    const shoulder = Math.min(out.k.lipLMax, out.k.lipRMax);
    check(shoulder - out.k.interiorMin >= K_DIP_MIN, `K: the luma profile dips across the slot between two brighter shoulders: darkest interior ${out.k.interiorMin} vs shoulders (max over 1-4 kerf) ${out.k.lipLMax} / ${out.k.lipRMax} (dip ${(shoulder - out.k.interiorMin).toFixed(1)} >= ${K_DIP_MIN})`);
    check(out.k.beforeCentre - out.k.interiorMean >= K_DIP_MIN, `K: the slot is darker than the skin it replaced (mean over |t| <= kerf ${out.k.beforeCentre} -> ${out.k.interiorMean})`);
    note(`K: at the lip ridges (1.5 kerf) luma before -> after: left ${out.k.lipAtL.join(" -> ")}, right ${out.k.lipAtR.join(" -> ")} (UNGATED: whether the lips read LIT)`);
    // The slot's UPPER half only: the view model's barrels (grey, pale) cover its lower end in this framing.
    const pa = await toPx(w.pos), pb = await toPx(add(w.pos, mul(v.up, 0.9 * w.radius)));
    out.kBone = boneAlong(after, pa, pb, kerfPx);
    out.kBoneBefore = boneAlong(before, pa, pb, kerfPx);
    note(`K: pale (bone-mesh) share in the slot ${out.kBone.inSlot.toFixed(3)} (before ${out.kBoneBefore.inSlot.toFixed(3)}), 2-4 kerf beside it ${out.kBone.beside.toFixed(3)} (before ${out.kBoneBefore.beside.toFixed(3)})`);
    check(out.kBone.inSlot >= out.kBoneBefore.inSlot + 0.02, `K: the slot reaches the sternum: bone shows inside it (pale share ${out.kBoneBefore.inSlot.toFixed(3)} -> ${out.kBone.inSlot.toFixed(3)})`);
    check(out.kBone.beside <= out.kBoneBefore.beside + 0.02, `K: and only inside it: no bone colour appears beside the slot (${out.kBoneBefore.beside.toFixed(3)} -> ${out.kBone.beside.toFixed(3)})`);
    cropOut(before, c, 240, 300, "K-before-crop"); cropOut(after, c, 240, 300, "K-after-crop");
  }

  // -------- H. a seam cut on a head: a diagonal slash on the face's near side.
  if (run("H")) {
    const z = fresh();
    const h = await headOf(z.id), f = await frontOf(z.id);
    let v = await look(h, PHOTO_D, f);
    const e = await eye();
    const P = await surfHit(z.id, e, unit(sub(h, e)));
    v = await look(add(h, mul(v.up, 0.08)), PHOTO_D, f);
    const before = await capture("H-before");
    const view = unit(sub(P, await eye()));
    const a = add(add(P, mul(v.right, -0.05)), mul(v.up, 0.04)), b = add(add(P, mul(v.right, 0.05)), mul(v.up, -0.02));
    const n = await evaluate(`__sdfGame.cut(${z.id}, ${J(a)}, ${J(b)}, ${J(view)})`);
    const ws = await woundsOf(z.id);
    check(n === 1 && ws.some((w) => w.shape === "cut"), `H: a head cut stamped (${n}; shapes ${J(ws.map((w) => w.shape))})`);
    const after = await capture("H-after");
    const w = ws.find((q) => q.shape === "cut");
    const hc = await toPx(h), hr = await toPx(add(h, mul(v.right, 0.11)));
    const headR = Math.hypot(hr[0] - hc[0], hr[1] - hc[1]);
    const pa = await toPx(a), pb = await toPx(b);
    const k0 = await toPx(w.pos), k1 = await toPx(add(w.pos, mul(v.right, 0.01)));
    const cmPx = Math.hypot(k1[0] - k0[0], k1[1] - k0[1]);   // px per cm at the cut
    const band = H_BAND_CM * cmPx;
    let nIn = 0, sIn = 0, nOut = 0, sOut = 0, nOutN = 0, sOutN = 0, nOutBig = 0;
    const twin = await capture(null);   // a second locked render of the after state: the noise floor outside the band
    // The diff map for the notes: |dLuma| x 8 in red, outside-band pixels over H_PIX in yellow, the band's edge in blue.
    const dmap = Buffer.alloc(W * H * 3);
    for (let y = Math.max(0, Math.floor(hc[1] - headR)); y <= Math.min(H - 1, Math.ceil(hc[1] + headR)); y++)
      for (let x = Math.max(0, Math.floor(hc[0] - headR)); x <= Math.min(W - 1, Math.ceil(hc[0] + headR)); x++) {
        if ((x - hc[0]) ** 2 + (y - hc[1]) ** 2 > headR * headR) continue;
        const dl = Math.abs(luma(px(after, x, y)) - luma(px(before, x, y)));
        const sd = segDist([x, y], pa, pb), o = (y * W + x) * 3;
        dmap[o] = Math.min(255, dl * 8);
        if (Math.abs(sd - band) < 1) dmap[o + 2] = 255;
        if (sd <= band) { nIn++; sIn += dl; } else { nOut++; sOut += dl; nOutN++; sOutN += Math.abs(luma(px(after, x, y)) - luma(px(twin, x, y))); if (dl > H_PIX) { nOutBig++; dmap[o + 1] = 255; dmap[o] = 255; } }
      }
    writeFileSync(`${OUT}/H-diff.png`, encodePng(W, H, dmap));
    out.h = { headRpx: +headR.toFixed(0), bandPx: +band.toFixed(1), inBand: +(sIn / nIn).toFixed(2), outside: +(sOut / nOut).toFixed(2), outsideNoise: +(sOutN / nOutN).toFixed(2), outsideOverPix: +(nOutBig / nOut).toFixed(4), nIn, nOut };
    note(`H: mean |dLuma| before -> after in the head disc: within ${H_BAND_CM} cm of the cut ${out.h.inBand}, outside it ${out.h.outside} (two locked renders: ${out.h.outsideNoise}); ${J(out.h)}`);
    check(out.h.inBand >= H_IN_MIN, `H: the cut shows (mean |dLuma| ${out.h.inBand} >= ${H_IN_MIN} within ${H_BAND_CM} cm of it)`);
    check(out.h.outside <= H_OUT_MAX && out.h.outsideOverPix <= H_OUT_SHARE_MAX, `H: the face outside the cut's band is unchanged (mean |dLuma| ${out.h.outside} <= ${H_OUT_MAX}; ${(100 * out.h.outsideOverPix).toFixed(1)}% of its pixels over ${H_PIX} <= ${100 * H_OUT_SHARE_MAX}%)`);
    cropOut(before, hc, 300, 300, "H-before-crop"); cropOut(after, hc, 300, 300, "H-after-crop");
  }

  // -------- R. the real rod: slot 6, held, the crosshair swept across a torso, released. (The canvas mousedown needs pointer
  // lock, which a headless page cannot take: rodPress / rodRelease call the harness's onMouseDown / onMouseUp directly.)
  if (run("R")) {
    await evaluate("__sdfGame.setBleed(true)");
    const z = fresh();
    const t = await torsoOf(z.id), f = await frontOf(z.id);
    const sel = await evaluate(`__sdfGame.selectSlot("rod")`);
    check(sel?.ok, `R: slot 6 selectable (${J(sel)})`);
    await stepN(40);
    const v = await look(t, ROD_D, f);
    await evaluate("__sdfGame.setFreeAim(true)");
    await evaluate("__sdfGame.setAimPoint(0, 0)");
    await stepN(2);
    const e = await eye();
    note(`R: eye to torso centre ${len(sub(t, e)).toFixed(2)} m (reach 2.2)`);
    await evaluate("__sdfGame.setFreeAim(false)");
    await stepN(2);
    await capture("R-before");
    await evaluate("__sdfGame.setFreeAim(true)");
    await evaluate(`__sdfGame.setAimPoint(${R_SWEEP[0]}, 0)`);
    await stepOne();
    const held = await evaluate("__sdfGame.rodPress()");
    check(held === true, `R: the rod is armed and holds on press (${held})`);
    for (let i = 0; i < 20; i++) { await evaluate(`__sdfGame.setAimPoint(${R_SWEEP[0] + (i * (R_SWEEP[1] - R_SWEEP[0])) / 19}, 0)`); await stepOne(); }
    const mid = await evaluate("__sdfGame.rod()");
    await evaluate("__sdfGame.rodRelease()");
    await stepN(3);
    const rod = await evaluate("__sdfGame.rod()");
    const ws = await woundsOf(z.id);
    note(`R: before release ${J(mid)}; after ${J(rod)}; wounds ${J(ws.map((w) => ({ shape: w.shape, half: +w.radius.toFixed(3) })))}`);
    check((rod?.lastCuts ?? 0) >= 1 && ws.some((w) => w.shape === "cut"), `R: a held sweep across a body cuts it (${J(rod)}; ${ws.filter((w) => w.shape === "cut").length} cut wounds)`);
    out.r = { samples: mid?.samples, lastCuts: rod?.lastCuts, halfLens: ws.filter((w) => w.shape === "cut").map((w) => +w.radius.toFixed(3)) };
    await evaluate("__sdfGame.setFreeAim(false)");
    await stepN(30);
    const cw = ws.find((w) => w.shape === "cut");
    await look(cw ? cw.pos : t, PHOTO_D, f);
    await capture("R-after");
    await evaluate("__sdfGame.setBleed(false)");
    await evaluate(`__sdfGame.selectSlot("shotgun")`);
    await stepN(40);
  }

  // -------- C. cost: draw time before / after 3 cuts on one torso (reported with its spread, not gated).
  if (run("C")) {
    const z = fresh();
    const t = await torsoOf(z.id), f = await frontOf(z.id);
    const v = await look(t, PHOTO_D, f);
    const e = await eye();
    const P = await surfHit(z.id, e, unit(sub(t, e)));
    out.c0a = await timeDraws(); out.c0b = await timeDraws();
    await capture("C-before");
    const view = unit(sub(P, e));
    const cuts = [[mul(v.up, -0.1), mul(v.up, 0.1)], [add(mul(v.right, -0.08), mul(v.up, 0.08)), add(mul(v.right, 0.08), mul(v.up, -0.06))], [add(mul(v.right, -0.08), mul(v.up, -0.12)), add(mul(v.right, 0.08), mul(v.up, -0.12))]];
    let n = 0;
    for (const [da, db] of cuts) n += await evaluate(`__sdfGame.cut(${z.id}, ${J(add(P, da))}, ${J(add(P, db))}, ${J(view)})`);
    await stepN(2);
    check(n === 3, `C: 3 cuts stamped (${n})`);
    out.c3 = await timeDraws();
    await capture("C-3cuts");
    note(`C: frame cost (UNGATED): no cuts ${out.c0a.toFixed(2)} / ${out.c0b.toFixed(2)} ms (spread ${Math.abs(out.c0a - out.c0b).toFixed(2)}), 3 cuts ${out.c3.toFixed(2)} ms; delta ${(out.c3 - (out.c0a + out.c0b) / 2).toFixed(2)} ms`);
  }

  // -------- X. A RING FULL OF CUTS: cost (final review item 2). Its own boot, two fresh bodies, the same framing on each
  // (front, torso centre): 32 craters at 32 spots spread over the torso and limbs' near side on one, 32 rod cuts (the cut
  // seam, ROD_CALIBRE, alternating across / along / diagonal, 2 x X_HALF long) at the same spots on the other. timeDraws at 0.6 m
  // and 2 m, each twice (the spread), on the bare body first. Not gated: it reports.
  if (run("X")) {
    if (usedZ.size) { closeSession(S); usedZ = new Set(); await boot("cost"); }
    const spotsOf = async (id) => {
      const t = await torsoOf(id), f = await frontOf(id), right = unit([-f[2], 0, f[0]]), up = [0, 1, 0];
      const targets = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) targets.push(add(add(t, mul(right, (c - 1.5) * 0.06)), mul(up, (r - 1.5) * 0.08)));
      for (const limb of ["armL", "armR", "legL", "legR"]) {
        const lc = await evaluate(`__sdfGame.actorLimbCentre(${id}, ${J(limb)})`);
        for (let k = 0; k < 4; k++) targets.push(add(lc, mul(up, (k - 1.5) * 0.1)));
      }
      const spots = [];
      for (const q of targets) { const P = await surfHit(id, add(q, mul(f, 0.8)), mul(f, -1)); if (P) spots.push(P); }
      return { t, f, right, up, spots };
    };
    const measure = async (t, f, tag) => {
      await look(t, PHOTO_D, f); await stepN(2);
      const n06 = [await timeDraws(), await timeDraws()];
      await look(t, 2.0, f); await stepN(2);
      const n2 = [await timeDraws(), await timeDraws()];
      await look(t, PHOTO_D, f); await stepN(2);
      if (tag) await capture(tag);
      return { n06, n2 };
    };
    const fmt = (m) => `0.6 m ${m.n06.map((x) => x.toFixed(1)).join(" / ")}, 2 m ${m.n2.map((x) => x.toFixed(1)).join(" / ")}`;
    // Craters. X_SWAP=1 stamps the cuts on the first fresh body and the craters on the second (the bodies stand in different
    // spots and light, so the bare baselines differ: swapping separates the body from the wound shape).
    const swap = process.env.X_SWAP === "1";
    // The cuts' half-length (m): 0.06 by default; X_HALF=0.11 is the rod's measured R slash (reach ~0.45 m).
    const X_HALF = Number(process.env.X_HALF ?? 0.06);
    const za = fresh(), zb = fresh();
    const zc = swap ? zb : za;
    const C = await spotsOf(zc.id);
    const c0 = await measure(C.t, C.f, null);
    let nc = 0;
    for (const P of C.spots) { const d = unit(sub(P, add(P, mul(C.f, 0.8)))); const o = add(P, mul(C.f, 0.8)); if (await evaluate(`__sdfGame.stampWoundAt(${o[0]}, ${o[1]}, ${o[2]}, ${d[0]}, ${d[1]}, ${d[2]}, "pellet", ${zc.id})`)) nc++; }
    const wc = await woundsOf(zc.id);
    const c32 = await measure(C.t, C.f, "X-32craters");
    // Cuts.
    const zk = swap ? za : zb;
    const K = await spotsOf(zk.id);
    const k0 = await measure(K.t, K.f, null);
    let nk = 0;
    const view = mul(K.f, -1);
    for (let i = 0; i < K.spots.length; i++) {
      const P = K.spots[i], dir = i % 3 === 0 ? K.right : i % 3 === 1 ? K.up : unit(add(K.right, K.up));
      nk += await evaluate(`__sdfGame.cut(${zk.id}, ${J(add(P, mul(dir, -X_HALF)))}, ${J(add(P, mul(dir, X_HALF)))}, ${J(view)})`);
    }
    const wk = await woundsOf(zk.id);
    const k32 = await measure(K.t, K.f, "X-32cuts");
    out.x = { swap, half: X_HALF, halfLens: [Math.min(...wk.map((w) => w.radius)), Math.max(...wk.map((w) => w.radius))].map((v) => +v.toFixed(3)), craterBody: zc.id, cutBody: zk.id, craters: { spots: C.spots.length, stamped: nc, wounds: wc.length, base: c0, full: c32 }, cuts: { spots: K.spots.length, stamped: nk, wounds: wk.length, shapes: [...new Set(wk.map((w) => w.shape))], base: k0, full: k32 } };
    note(`X: craters: ${nc} stamped, ${wc.length} wounds; bare ${fmt(c0)}; 32 craters ${fmt(c32)} ms`);
    note(`X: cuts: ${nk} stamped, ${wk.length} wounds (${J(out.x.cuts.shapes)}); bare ${fmt(k0)}; 32 cuts ${fmt(k32)} ms`);
    const dm = (a, b) => (a.reduce((m, x) => m + x, 0) / a.length - b.reduce((m, x) => m + x, 0) / b.length).toFixed(1);
    note(`X: delta over bare (mean of two): craters +${dm(c32.n06, c0.n06)} (0.6 m) / +${dm(c32.n2, c0.n2)} (2 m); cuts +${dm(k32.n06, k0.n06)} (0.6 m) / +${dm(k32.n2, k0.n2)} (2 m) ms`);
    check(wc.length === 32 && wk.length === 32 && out.x.cuts.shapes.length === 1 && out.x.cuts.shapes[0] === "cut", `X: 32 craters and 32 cuts staged (${wc.length}, ${wk.length})`);
  }

  // -------- T. K ON A TURNED BODY (final review item 1). Every ring zombie boots at yaw 0 (it never stepped), where the wound
  // body frame and the world frame coincide: that is why K could not see bone exposure resolved at yaw 0 (game-main's old
  // call) while the carve and its upload use the live yaw. Stage a turned body under its own motion: unfreeze, let the ring
  // walk, freeze as soon as an unused zombie stands about 90 degrees round (|sin yaw| >= T_SIN_MIN), standing, not
  // collapsed. Then K's cut and K's bone checks, on that body's front.
  if (run("T")) {
    // Its own boot: the scenarios above used the ring's zombies, and walking them would move the bodies they staged.
    if (usedZ.size) { closeSession(S); usedZ = new Set(); await boot("turned"); }
    await evaluate("__sdfGame.freeze(false)");
    let pick = null, frames = 0;
    for (; frames < T_MAX_FRAMES && !pick; frames += 10) {
      await stepN(10);
      const zs = (await evaluate("__sdfGame.actorList()")).filter((q) => q.kind === "zombie" && pool.some((p) => p.id === q.id) && !usedZ.has(q.id));
      pick = zs.filter((q) => Math.abs(Math.sin(q.yaw)) >= T_SIN_MIN && !/collapse|dead|fall/i.test(String(q.phase))).sort((a, b) => Math.abs(Math.sin(b.yaw)) - Math.abs(Math.sin(a.yaw)))[0] ?? null;
    }
    await evaluate("__sdfGame.freeze(true)");
    if (!pick) die(`T: no unused ring zombie turned to |sin yaw| >= ${T_SIN_MIN} in ${T_MAX_FRAMES} frames`);
    usedZ.add(pick.id);
    await stepN(30);
    const yawNow = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === pick.id).yaw;
    out.tYawDeg = +(yawNow * 180 / Math.PI).toFixed(1);
    note(`T: zombie ${pick.id} frozen after ${frames} walking frames at yaw ${out.tYawDeg} deg (phase ${pick.phase})`);
    check(Math.abs(Math.sin(yawNow)) >= T_SIN_MIN, `T: the body is turned (yaw ${out.tYawDeg} deg, |sin| ${Math.abs(Math.sin(yawNow)).toFixed(2)} >= ${T_SIN_MIN})`);
    const z = pick;
    const t = await torsoOf(z.id), f = await frontOf(z.id);
    let v = await look(t, PHOTO_D, f);
    const e = await eye();
    const P = await surfHit(z.id, e, unit(sub(t, e)));
    v = await look(add(P, mul(v.up, 0.06)), PHOTO_D, f);
    const before = await capture("T-before");
    const view = unit(sub(P, await eye()));
    const a = add(P, mul(v.up, -0.1)), b = add(P, mul(v.up, 0.1));
    const n = await evaluate(`__sdfGame.cut(${z.id}, ${J(a)}, ${J(b)}, ${J(view)})`);
    const ws = await woundsOf(z.id);
    check(n === 1 && ws.length === 1 && ws[0].shape === "cut", `T: one cut wound stamped on the turned body (${n}; shapes ${J(ws.map((w) => w.shape))})`);
    const after = await capture("T-after");
    const w = ws[0];
    // The exposure the bone meshes actually received this frame (skeleton=mesh): its stain / wet terms must sit on the slot.
    // The cut's slot midpoint (actorWounds' pos: the upload's own transform at the live yaw) must lie inside an exposure
    // sphere. At yaw 0 (the pre-fix call) the chain resolved in the world basis and missed the slot on a turned body.
    const rows = await evaluate("__sdfGame.meshExposure()");
    if (!rows) die("T: no mesh skeleton exposure (skeleton mode is not mesh)");
    const near = rows.map((r) => ({ d: len(sub([r[0], r[1], r[2]], w.pos)), r: r[3] })).sort((a, b) => a.d - b.d)[0] ?? { d: Infinity, r: 0 };
    out.tExposure = { nearest: +near.d.toFixed(4), radius: +near.r.toFixed(4), rows: rows.length };
    note(`T: the exposure sphere nearest the cut's slot midpoint: centre ${near.d.toFixed(4)} m away, radius ${near.r.toFixed(4)} m (${rows.length} rows fed)`);
    check(near.d <= near.r, `T: the bone exposure sits on the turned body's slot: its midpoint is inside an exposure sphere (${near.d.toFixed(4)} <= ${near.r.toFixed(4)} m)`);
    const c = await toPx(w.pos), cr = await toPx(add(w.pos, mul(v.right, w.kerf)));
    const kerfPx = Math.hypot(cr[0] - c[0], cr[1] - c[1]);
    note(`T: the cut sits ${len(sub(w.pos, P)).toFixed(4)} m from the aimed surface point; kerf ${kerfPx.toFixed(1)} px`);
    // As K: the slot's upper half (the view model covers its lower end).
    const pa = await toPx(w.pos), pb = await toPx(add(w.pos, mul(v.up, 0.9 * w.radius)));
    out.tBone = boneAlong(after, pa, pb, kerfPx);
    out.tBoneBefore = boneAlong(before, pa, pb, kerfPx);
    note(`T: pale (bone-mesh) share in the slot ${out.tBone.inSlot.toFixed(3)} (before ${out.tBoneBefore.inSlot.toFixed(3)}), 2-4 kerf beside it ${out.tBone.beside.toFixed(3)} (before ${out.tBoneBefore.beside.toFixed(3)})`);
    check(out.tBone.inSlot >= out.tBoneBefore.inSlot + 0.02, `T: on the turned body the slot reaches the sternum: bone shows inside it (pale share ${out.tBoneBefore.inSlot.toFixed(3)} -> ${out.tBone.inSlot.toFixed(3)})`);
    check(out.tBone.beside <= out.tBoneBefore.beside + 0.02, `T: and only inside it: no bone colour appears beside the slot (${out.tBoneBefore.beside.toFixed(3)} -> ${out.tBone.beside.toFixed(3)})`);
    cropOut(before, c, 240, 300, "T-before-crop"); cropOut(after, c, 240, 300, "T-after-crop");
  }
} finally { closeSession(S); }
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `zero console errors or exceptions (${errs.length}${errs.length ? ": " + JSON.stringify(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${JSON.stringify(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
