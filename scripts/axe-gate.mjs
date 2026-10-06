// scripts/axe-gate.mjs — the axe, part A (plan docs/superpowers/plans/2026-10-04-axe-part-a.md Task 7; spec
// docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §6). Bare ring page (/sdf-game.html, no ?level), frozen
// zombies, headless WebGPU, seams in place of pointer lock. Photos go to OUT for the look loop.
//   A. AN OVERHEAD BODY CHOP (__sdfGame.axeChop(id, "H", "torso")): one cut, running vertically in world (|dir.y| > 0.8);
//      across it at its midpoint the luma profile dips (the slot) between two brighter shoulders (the lips), as
//      cut-wound-gate's K measures it.
//   D. A DIAGONAL CHOP ("R"): its cut runs diagonally (|dir.y| in 0.4..0.9).
//   K. HEAD CHOPS TO THE KILL: chops 1 and 2 count and the zombie stays standing; chop 3 kills (its phase leaves
//      'standing'). Chop 1 opens the head split (game-head-split.ts), so what the corpse keeps is the split's: it is
//      still open on it, and its two cut faces are in the wound ring as head-kept wounds. A chop that lands in the gap
//      of an open head stamps no cut of its own (axe-head.ts headChopCut), so the corpse's cuts are not counted;
//      scripts/head-split-gate.mjs measures the split itself. The gate's zombies are frozen and a forced collapse is
//      only consumed in the actor's step(), so after each chop the ring is thawed for 3 frames, the phase read, and
//      frozen again (head-burst-gate's A does the same); then the split's spring is left to settle, as in play, where
//      strikes are at least 0.6 s apart (axe-swing.ts).
//   S. THE REAL SWING: slot 7 selected and settled, a click (the axeSwing seam: the canvas mousedown needs pointer lock,
//      which headless Chrome cannot take, so that path is NOT exercised here), the chop lands on the zombie in front.
//      Photos at rest, at the strike frame and after; the drawn axe's haft / head / grip clipping (share of pixels with
//      a channel >= 250) and mean luma at rest and at the strike frame (the flail's blow-out measure).
//   C. cost: draw time before / after 3 chops on one body (with its spread, not gated); THE DEPTH GUARD at every
//      screenshot of the run (each body texel of the float march target, placed in the world by its depth, lies in
//      front of the camera and inside some actor's proxy box: scripts/lib/march-depth-guard.mjs); zero console errors.
//   T. A TURNED BODY (its own boot): the ring walks until a zombie stands ~90 degrees round, then freezes; a torso chop's
//      cut lands within 5 cm of the strike's hit point (__sdfGame.axe().last.points).
//   F. (opt-in, ONLY=F) the H -> R -> L combo as film strips (OUT/F-<side>-strip.png), for the look loop; not gated.
// ONLY=A,K (env) runs just those scenarios.
// Usage (bash, not zsh):
//   export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
//   node scripts/axe-gate.mjs 5241 9241
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { DEPTH_GUARD_PROBE, depthGuardLine, depthGuardTexels } from "./lib/march-depth-guard.mjs";
const VITE = Number(process.argv[2] ?? 5241);
const CDP = Number(process.argv[3] ?? 9241);
const OUT = process.env.OUT ?? "docs/dev-notes/2026-10-04-axe/gate";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
const EYE_H = 1.62;
/** The photo distances (m, eye to target): a torso chop, a head chop, the real swing. */
const CHOP_D = 0.9, HEAD_D = 0.7, SWING_D = 1.1;
// Thresholds. A: cut-wound-gate's K dip (the dimmest view dipped 15.7 below its darker shoulder there).
const A_DIP_MIN = 8;
// K: frames between head chops (0.67 s: the split's spring at rest).
const K_SETTLE = 40;
// T: the turned body (about 90 degrees round), staged within this many walking frames; the cut on the hit point.
const T_SIN_MIN = 0.97, T_MAX_FRAMES = 900, T_LAND_MAX = 0.05;
/** A clipped pixel: any channel at or over this. */
const CLIP = 250;
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
/** THE DEPTH GUARD, at every screenshot (scripts/lib/march-depth-guard.mjs has the rule, and the fault it was built
 *  on): each body texel of the float march target, placed in the world by its depth, lies in front of the camera and
 *  inside some actor's proxy box. Two reads, as the head-split gate's captures are: readMarchTarget draws a frame of
 *  its own, and a pair keeps the render-side clocks on the phase the photos were shot on. A miss is alpha exactly 1
 *  (the clear value). NOT S's screenshots: the first-person axe and hands are marched into the same target, and they
 *  are bodies with no actor's box. */
const DEPTH = { captures: 0, texels: 0, behind: 0, outside: 0, origin: 0, worst: null };
async function depthGuard(name) {
  if (name?.startsWith("S-")) return;
  await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
  const r = await evaluate("__sdfGameDebug.readMarchTarget()", 120000);
  const f = new Float32Array(Uint8Array.from(Buffer.from(r.rgba32f, "base64")).buffer);
  const bad = depthGuardTexels({ w: r.w, h: r.h, f, miss: 1 }, await evaluate(DEPTH_GUARD_PROBE));
  if (bad.worst) DEPTH.worst ??= { capture: name ?? DEPTH.captures + 1, ...bad.worst };
  DEPTH.captures++; DEPTH.texels += bad.texels; DEPTH.behind += bad.behind; DEPTH.outside += bad.outside; DEPTH.origin += bad.origin;
}
/** Screenshots lag hand-stepped frames by one: lock the sim, re-render twice, then shoot. The lock keeps the sim
 *  still (renderLock), so a capture never advances a frame. */
async function capture(name) {
  await evaluate("__sdfGame.setRenderLock(true)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.step(1, 1 / 60)");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await depthGuard(name);
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
  await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&frozen=1&vhs=off&loader=0` });
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
  // No blood over the wound (the photos judge the carve and its shading; the rod's own bleed is exercised in R, where
  // it is switched back on), and free aim OFF so the DOM reticle is not drawn over the cut (R turns it on for its
  // setAimPoint sweep).
  await evaluate("__sdfGame.setBleed(false)");
  await evaluate("__sdfGame.setFreeAim(false)");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie");
  const byRoom = new Map();
  for (const z of zs) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
  const ROOM = [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  pool = byRoom.get(ROOM);
  const room = (await evaluate("__sdfGame.rooms")).find((r) => r.id === ROOM);
  centre = [(room.bounds.minX + room.bounds.maxX) / 2, 0, (room.bounds.minZ + room.bounds.maxZ) / 2];
  // The background gib / crowd compiles would confound the draw timings: wait for the gib warm, as the head-burst gate
  // does. The wait is as long as the wall clock makes it, so the frames it draws are steps of NO sim time.
  let wb = null;
  for (let i = 0; i < 400; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" || wb.gib === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  if (wb?.gib !== "ready") die(`[${label}] the background gib warm is ${JSON.stringify(wb)}`);
  // THE PINS, after everything whose length the wall clock sets (scripts/march-hash.mjs has the measurements behind
  // each; scripts/head-split-gate.mjs pins the same): the dynamic-light clock frozen and set to 0 (every sim step
  // advances it, and the lamps, the room fill and the body key read it), the room probes' afterglow a per-frame
  // estimate, the field interlace off, the render-side subsampling clocks held. Without them the lit frame of one
  // scene differs from boot to boot.
  await evaluate(`(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.setFieldStyle("off"); return 1; })()`);
  for (let i = 0; i < 90; i++) await evaluate("__sdfGame.step(1, 1 / 60)");
  await evaluate("__sdfGame.installDebugProbe()");
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
/** Write a crop of the image (centred, w x h) for the notes. */
function cropOut(img, c, w, h, name) { writeFileSync(`${OUT}/${name}.png`, encodePng(w, h, cropRgb(img, c[0], c[1], w, h))); console.log(`  crop ${OUT}/${name}.png`); }
const timeDraws = () => evaluate("__sdfGame.timeDraws(120)", 300000);

const out = {};
const actorPhase = async (id) => (await evaluate("__sdfGame.actorList()")).find((q) => q.id === id)?.phase;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (xs) => xs.reduce((m, q) => m + q.l, 0) / xs.length;
/** The luma profile across cut `w` at its midpoint, before vs after (cut-wound-gate K's measure): px kerf, the darkest
 *  interior, the shoulders (max over 1-4 kerf each side), the uncut skin there before. */
async function cutProfile(w, before, after) {
  const e = await eye();
  const view = unit(sub(w.pos, e));
  const across = unit(cross(w.dirWorld, view));
  const c = await toPx(w.pos), cr = await toPx(add(w.pos, mul(across, w.kerf))), cu = await toPx(add(w.pos, mul(w.dirWorld, 0.02)));
  const kerfPx = Math.hypot(cr[0] - c[0], cr[1] - c[1]);
  const u = [(cr[0] - c[0]) / kerfPx, (cr[1] - c[1]) / kerfPx];
  const vl = Math.hypot(cu[0] - c[0], cu[1] - c[1]), vv = [(cu[0] - c[0]) / vl, (cu[1] - c[1]) / vl];
  const half = Math.round(6 * kerfPx), avg = Math.round(vl);
  const pA = profile(after, c, u, vv, half, avg), pB = profile(before, c, u, vv, half, avg);
  const inner = pA.filter((q) => Math.abs(q.t) <= kerfPx);
  const lipL = pA.filter((q) => q.t <= -kerfPx && q.t >= -4 * kerfPx), lipR = pA.filter((q) => q.t >= kerfPx && q.t <= 4 * kerfPx);
  const r = {
    px: c.map((q) => Math.round(q)), kerfPx: +kerfPx.toFixed(1), avgPx: avg,
    interiorMin: +Math.min(...inner.map((q) => q.l)).toFixed(1), interiorMean: +mean(inner).toFixed(1),
    interiorWalls: +mean([...inner].sort((x, y) => x.l - y.l).slice(0, Math.max(1, Math.floor(inner.length / 2)))).toFixed(1),
    lipLMax: +Math.max(...lipL.map((q) => q.l)).toFixed(1), lipRMax: +Math.max(...lipR.map((q) => q.l)).toFixed(1),
    beforeCentre: +mean(pB.filter((q) => Math.abs(q.t) <= kerfPx)).toFixed(1),
  };
  r.dip = +(Math.min(r.lipLMax, r.lipRMax) - r.interiorMin).toFixed(1);
  r.after = pA.filter((q) => q.t % 2 === 0).map((q) => `${q.t}:${q.l.toFixed(0)}`).join(" ");
  r.before = pB.filter((q) => q.t % 2 === 0).map((q) => `${q.t}:${q.l.toFixed(0)}`).join(" ");
  return r;
}
/** The drawn axe's clipping and mean luma (the flail gate's haftStats / ballStats, CLIP per channel): the haft from the
 *  grip to its top (the brightest pixel within +-4 px across the line at each of 56 steps), the steel head's disc and the
 *  fist's disc about the grip (0.04 m projected). */
async function axeLight(img) {
  const rig = (await evaluate("__sdfGame.axe()")).rig;
  const g = await toPx(rig.grip), t = await toPx(rig.top), hd = await toPx(rig.head);
  const r = { visible: rig.visible, handLoaded: !!rig.hand };
  if (!g || !t) return { ...r, offscreen: true };
  const dx = t[0] - g[0], dy = t[1] - g[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  let n = 0, clip = 0, lum = 0;
  for (let i = 2; i < 58; i++) {
    const cx = g[0] + dx * i / 60, cy = g[1] + dy * i / 60;
    let best = null;
    for (let k = -4; k <= 4; k++) {
      const x = Math.round(cx + nx * k), y = Math.round(cy + ny * k);
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const c = px(img, x, y); if (!best || luma(c) > luma(best)) best = c;
    }
    if (!best) continue;
    n++; lum += luma(best); if (Math.max(...best) >= CLIP) clip++;
  }
  r.haft = { n, clipped: n ? +(clip / n).toFixed(3) : null, meanLuma: n ? +(lum / n).toFixed(1) : null, px: [g, t].map((p) => p.map(Math.round)) };
  const disc = async (cw, rw) => {
    const c = await toPx(cw); if (!c) return null;
    const e = await eye(); const side = unit(cross(sub(cw, e), [0, 1, 0]));
    const c2 = await toPx(add(cw, mul(side, rw))); const rp = Math.hypot(c2[0] - c[0], c2[1] - c[1]);
    let m = 0, cl = 0, lu = 0;
    for (let y = Math.floor(c[1] - rp); y <= Math.ceil(c[1] + rp); y++) for (let x = Math.floor(c[0] - rp); x <= Math.ceil(c[0] + rp); x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h || Math.hypot(x - c[0], y - c[1]) > rp) continue;
      const q = px(img, x, y); m++; if (Math.max(...q) >= CLIP) cl++; lu += luma(q);
    }
    return { n: m, rPx: +rp.toFixed(1), clipped: m ? +(cl / m).toFixed(3) : null, meanLuma: m ? +(lu / m).toFixed(1) : null, px: c.map(Math.round) };
  };
  r.head = hd ? await disc(rig.head, 0.04) : null;
  r.grip = await disc(rig.grip, 0.04);
  // The whole frame's clipped share, for scale (walls, the torch pool).
  let fc = 0; for (let i = 0; i < img.w * img.h; i++) { const o = i * img.ch; if (Math.max(img.data[o], img.data[o + 1], img.data[o + 2]) >= CLIP) fc++; }
  r.frameClipped = +(fc / (img.w * img.h)).toFixed(4);
  return r;
}
try {
  await boot("axe");
  out.renderMode = await evaluate("__sdfGame.renderMode");
  out.torch = await evaluate(`__sdfGame.findObjects("flash|torch", 6)`);
  note(`render mode ${out.renderMode}; torch-ish objects ${J(out.torch)}`);
  // -------- A. an overhead body chop: one cut, vertical in world, a dark slot between lit shoulders.
  if (run("A")) {
    const z = fresh(); const t = await torsoOf(z.id), f = await frontOf(z.id);
    await look(t, CHOP_D, f);
    const before = await capture("A-before");
    // No hand step between the photos (cut-wound-gate K): the cut uploads on the capture's own locked renders.
    const n = await evaluate(`__sdfGame.axeChop(${z.id}, "H", "torso")`);
    const ws = (await woundsOf(z.id)).filter((w) => w.shape === "cut");
    check(n === 1 && ws.length === 1, `A: an overhead chop stamps one cut (${n} hits, ${ws.length} cuts)`);
    const dy = Math.abs(ws[0]?.dirWorld?.[1] ?? 0);
    check(dy > 0.8, `A: the overhead's cut runs vertically (|dir.y| ${dy.toFixed(2)} > 0.8)`);
    const after = await capture("A-after");
    const last = (await evaluate("__sdfGame.axe()")).last;
    const w = ws[0];
    out.a = await cutProfile(w, before, after);
    out.a.halfLen = +w.radius.toFixed(3); out.a.kerf = w.kerf; out.a.dirWorld = w.dirWorld.map((q) => +q.toFixed(3));
    out.a.offHit = +len(sub(w.pos, last.points[0])).toFixed(4);
    // Where the cut sits on screen: its midpoint's px distance from the crosshair (the canvas centre).
    out.a.offCrosshairPx = +Math.hypot(out.a.px[0] - (S.rect.x + S.rect.w / 2), out.a.px[1] - (S.rect.y + S.rect.h / 2)).toFixed(1);
    note(`A: profile across the cut at px (${out.a.px.join(", ")}), kerf ${out.a.kerfPx} px, averaged +-${out.a.avgPx} px along: after ${out.a.after}`);
    note(`A: before ${out.a.before}`);
    const { after: _a, before: _b, ...aNums } = out.a; out.a = aNums;
    note(`A: ${J(out.a)}`);
    check(out.a.dip >= A_DIP_MIN, `A: the luma profile dips across the slot between two brighter shoulders: darkest interior ${out.a.interiorMin} vs shoulders ${out.a.lipLMax} / ${out.a.lipRMax} (dip ${out.a.dip} >= ${A_DIP_MIN})`);
    check(out.a.beforeCentre - out.a.interiorWalls >= A_DIP_MIN, `A: the slot's walls are darker than the skin they replaced (${out.a.beforeCentre} -> darker half ${out.a.interiorWalls}; full mean ${out.a.interiorMean})`);
    cropOut(before, out.a.px, 260, 320, "A-before-crop"); cropOut(after, out.a.px, 260, 320, "A-after-crop");
  }
  // -------- D. a diagonal chop leaves a diagonal cut.
  if (run("D")) {
    const z = fresh(); const t = await torsoOf(z.id), f = await frontOf(z.id);
    await look(t, CHOP_D, f);
    await evaluate(`__sdfGame.axeChop(${z.id}, "R", "torso")`);
    const w = (await woundsOf(z.id)).find((q) => q.shape === "cut");
    const dy = Math.abs(w?.dirWorld?.[1] ?? 0);
    out.d = { dirWorld: w?.dirWorld?.map((q) => +q.toFixed(3)), halfLen: w ? +w.radius.toFixed(3) : null };
    check(dy > 0.4 && dy < 0.9, `D: the diagonal chop's cut is diagonal (|dir.y| ${dy.toFixed(2)} in 0.4..0.9)`);
    const img = await capture("D-after");
    const c = await toPx(w.pos);
    if (c) cropOut(img, c, 320, 320, "D-after-crop");
  }
  // -------- K. head chops: 1 opens the head and 2 widens it, the zombie lives; 3 kills; the split and its cut faces stay.
  if (run("K")) {
    const z = fresh(); const f = await frontOf(z.id);
    await look(await headOf(z.id), HEAD_D, f);
    await capture("K-0");
    const phase0 = await actorPhase(z.id);
    check(phase0 === "standing", `K: the fresh zombie is standing (${phase0})`);
    out.k = [];
    for (let i = 1; i <= 3; i++) {
      const side = i === 1 ? "H" : i === 2 ? "R" : "L";
      // Re-framed every chop: the thaw below lets the body sway.
      await look(await headOf(z.id), HEAD_D, f);
      const n = await evaluate(`__sdfGame.axeChop(${z.id}, "${side}", "head")`);
      const dbg = await evaluate("__sdfGame.axe()");
      const heads = dbg.heads[z.id];
      check(n === 1 && dbg.last.heads.includes(z.id) && heads === i, `K: head chop ${i} (${side}) lands as a head chop and is counted (${n} hits, heads ${J(dbg.last.heads)}, count ${heads})`);
      await capture(`K-${i}`);
      // A frozen actor never steps, and the kill (forceCollapse) is consumed in its step: thaw 3 frames, read, refreeze.
      await evaluate("__sdfGame.freeze(false)"); await stepN(3);
      const ph = await actorPhase(z.id);
      await evaluate("__sdfGame.freeze(true)");
      out.k.push({ chop: i, side, phase: ph });
      if (i < 3) check(ph === "standing", `K: alive after head chop ${i} (thawed 3 frames: phase ${ph})`);
      else check(ph !== "standing", `K: head chop 3 kills (thawed 3 frames: phase ${phase0} -> ${ph})`);
      await stepN(K_SETTLE);
    }
    // The split's cut faces: one cut per opened half, head-kept; and the split's own state.
    const facesOf = async () => (await woundsOf(z.id)).filter((w) => w.shape === "cut" && (w.headRegion === "split+" || w.headRegion === "split-"));
    const faces = await facesOf(), split = await evaluate(`__sdfGame.headSplit(${z.id})`);
    out.kFaces = faces.map((w) => ({ region: w.headRegion, slot: w.headSlot, limb: w.limb, half: +w.radius.toFixed(3) }));
    out.kSplit = split && { preset: split.preset, sides: split.sides, angle: +split.angle.toFixed(4), target: +split.target.toFixed(4) };
    check(!!split && split.preset !== null && split.angle > 0 && split.angle === split.target, `K: the head is split open on the corpse, thrown to the kill's angle (${J(out.kSplit)})`);
    check(faces.length === (split?.sides === 0 ? 2 : 1) && new Set(faces.map((w) => w.headRegion)).size === faces.length && faces.every((w) => w.headSlot === "keep"),
      `K: the corpse keeps the split's cut faces, one per opened half, head-kept (${J(out.kFaces)})`);
    // The corpse a few frames on (thawed): it falls, the split and its faces stay.
    await evaluate("__sdfGame.freeze(false)"); await stepN(45); await evaluate("__sdfGame.freeze(true)");
    out.kPhaseLater = await actorPhase(z.id);
    const later = await facesOf(), splitLater = await evaluate(`__sdfGame.headSplit(${z.id})`);
    check(later.length === faces.length && later.every((w) => w.headSlot === "keep") && !!splitLater && splitLater.angle === split?.target,
      `K: 45 frames on (phase ${out.kPhaseLater}) the corpse's head is still open (${splitLater ? splitLater.angle.toFixed(4) : null} rad) with its ${later.length} cut face(s)`);
  }
  // -------- S. the real swing: slot 7 selected, armed, a click (seam), the chop lands on a zombie in front.
  if (run("S")) {
    const z = fresh(); const t = await torsoOf(z.id), f = await frontOf(z.id);
    const sel = await evaluate(`__sdfGame.selectSlot("axe")`);
    check(sel?.ok, `S: slot 7 selectable (${J(sel)})`);
    await stepN(40);
    await look(t, SWING_D, f);
    await stepN(2);
    const rest = await capture("S-rest");
    out.sLightRest = await axeLight(rest);
    note(`S: the axe at rest: ${J(out.sLightRest)}`);
    check(out.sLightRest.visible && !out.sLightRest.offscreen, `S: the axe is drawn and on screen at rest (${J({ visible: out.sLightRest.visible, haftPx: out.sLightRest.haft?.px })})`);
    const s0 = (await evaluate("__sdfGame.axe()")).strikes;
    await evaluate("__sdfGame.axeSwing()");
    let frames = 0, dbg = null;
    for (; frames < 60; frames++) { await stepOne(); dbg = await evaluate("__sdfGame.axe()"); if (dbg.strikes > s0) break; }
    out.sStrikeFrame = frames + 1;
    const strikeImg = await capture("S-strike");
    out.sLightStrike = await axeLight(strikeImg);
    note(`S: the axe at the strike frame (${out.sStrikeFrame} frames after the click): ${J(out.sLightStrike)}`);
    await stepN(60 - frames - 1);
    dbg = await evaluate("__sdfGame.axe()");
    check(dbg.strikes >= 1 && dbg.last?.hits?.includes(z.id), `S: a click swings and the strike lands on the zombie in front (${J(dbg.last)})`);
    const ws = (await woundsOf(z.id)).filter((w) => w.shape === "cut");
    check(ws.length >= 1, `S: the swing's chop cuts the zombie (${ws.length} cuts)`);
    const after = await capture("S-after");
    if (ws[0]) {
      const c = await toPx(ws[0].pos);
      out.sCutOffCrosshairPx = c ? +Math.hypot(c[0] - (S.rect.x + S.rect.w / 2), c[1] - (S.rect.y + S.rect.h / 2)).toFixed(1) : null;
      note(`S: the cut's midpoint is ${out.sCutOffCrosshairPx} px from the crosshair (dir ${J(ws[0].dirWorld?.map((q) => +q.toFixed(2)))})`);
    }
    out.sLightAfter = await axeLight(after);
  }
  // -------- F. (opt-in: ONLY=F) the swing as a film strip, for the look loop: the H -> R -> L combo on a fresh zombie at
  // SWING_D, a frame every F_EVERY steps, tiled per chop at 1/F_DOWN scale into OUT/F-<side>-strip.png. Not gated.
  if (ONLY?.has("F")) {
    const z = fresh(); const t = await torsoOf(z.id), f = await frontOf(z.id);
    await evaluate(`__sdfGame.selectSlot("axe")`);
    await stepN(40);
    await look(t, SWING_D, f);
    await stepN(2);
    const F_EVERY = Number(process.env.F_EVERY ?? 3), F_DOWN = 4, COLS = 5;
    for (const side of ["H", "R", "L"]) {
      const s0 = await evaluate("__sdfGame.axe()");
      await evaluate("__sdfGame.axeSwing()");
      const frames = [];
      for (let i = 0; i < 45; i++) {
        await stepOne();
        const d = await evaluate("__sdfGame.axe()");
        if (i % F_EVERY === 0 || d.strikes > (frames.at(-1)?.strikes ?? s0.strikes)) frames.push({ i: i + 1, img: await capture(null), strikes: d.strikes, side: d.side, phase: d.phase });
        if (d.phase === "idle") break;
      }
      const w = Math.floor(W / F_DOWN), h = Math.floor(H / F_DOWN), rows = Math.ceil(frames.length / COLS);
      const rgb = Buffer.alloc(w * COLS * h * rows * 3);
      frames.forEach((fr, k) => {
        const ox = (k % COLS) * w, oy = Math.floor(k / COLS) * h;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0;
          for (let dy = 0; dy < F_DOWN; dy++) for (let dx = 0; dx < F_DOWN; dx++) { const c = px(fr.img, x * F_DOWN + dx, y * F_DOWN + dy); r += c[0]; g += c[1]; b += c[2]; }
          const o = ((oy + y) * w * COLS + ox + x) * 3, n = F_DOWN * F_DOWN;
          // A red bar along the top of the strike frame.
          const strikeBar = y < 3 && fr.strikes > s0.strikes && (k === 0 || frames[k - 1].strikes === s0.strikes);
          rgb[o] = strikeBar ? 255 : r / n; rgb[o + 1] = strikeBar ? 0 : g / n; rgb[o + 2] = strikeBar ? 0 : b / n;
        }
      });
      writeFileSync(`${OUT}/F-${side}-strip.png`, encodePng(w * COLS, h * rows, rgb));
      note(`F: ${side}: ${frames.length} frames (${frames.map((q) => `${q.i}${q.strikes > s0.strikes ? "*" : ""}`).join(" ")}; * = struck) -> ${OUT}/F-${side}-strip.png`);
      // Continue the combo: the next click comes inside the combo window.
      await stepN(2);
    }
  }
  // -------- C. cost: draw time before / after 3 chops on one body (reported with its spread, not gated).
  if (run("C")) {
    const z = fresh(); const t = await torsoOf(z.id), f = await frontOf(z.id);
    await look(t, CHOP_D, f);
    const b0 = [await timeDraws(), await timeDraws()];
    let n = 0;
    for (const s of ["H", "R", "L"]) n += await evaluate(`__sdfGame.axeChop(${z.id}, "${s}", "torso")`);
    await stepN(2);
    check(n === 3, `C: 3 chops stamped (${n})`);
    const b1 = [await timeDraws(), await timeDraws()];
    await capture("C-3chops");
    out.c = { before: b0.map((x) => +x.toFixed(2)), after: b1.map((x) => +x.toFixed(2)) };
    note(`C: draw ms (UNGATED) before ${J(out.c.before)} (spread ${Math.abs(b0[0] - b0[1]).toFixed(2)}), after 3 chops ${J(out.c.after)} (spread ${Math.abs(b1[0] - b1[1]).toFixed(2)}); delta ${((b1[0] + b1[1] - b0[0] - b0[1]) / 2).toFixed(2)} ms`);
  }
  // -------- T. a turned zombie: the chop's cut lands on the struck point (within 5 cm). Its own boot (cut-wound-gate's T).
  if (run("T")) {
    if (usedZ.size) { closeSession(S); usedZ = new Set(); await boot("turned"); }
    await evaluate("__sdfGame.freeze(false)");
    let pick = null, frames = 0;
    for (; frames < T_MAX_FRAMES && !pick; frames += 10) {
      await stepN(10);
      const zs = (await evaluate("__sdfGame.actorList()")).filter((q) => q.kind === "zombie" && pool.some((p) => p.id === q.id) && !usedZ.has(q.id));
      pick = zs.filter((q) => Math.abs(Math.sin(q.yaw)) >= T_SIN_MIN && q.phase === "standing").sort((a, b) => Math.abs(Math.sin(b.yaw)) - Math.abs(Math.sin(a.yaw)))[0] ?? null;
    }
    await evaluate("__sdfGame.freeze(true)");
    if (!pick) die(`T: no unused ring zombie turned to |sin yaw| >= ${T_SIN_MIN} in ${T_MAX_FRAMES} frames`);
    usedZ.add(pick.id);
    await stepN(30);
    const yawNow = (await evaluate("__sdfGame.actorList()")).find((q) => q.id === pick.id).yaw;
    out.tYawDeg = +(yawNow * 180 / Math.PI).toFixed(1);
    note(`T: zombie ${pick.id} frozen after ${frames} walking frames at yaw ${out.tYawDeg} deg`);
    check(Math.abs(Math.sin(yawNow)) >= T_SIN_MIN, `T: the body is turned (yaw ${out.tYawDeg} deg, |sin| ${Math.abs(Math.sin(yawNow)).toFixed(2)} >= ${T_SIN_MIN})`);
    const t = await torsoOf(pick.id), f = await frontOf(pick.id);
    await look(t, CHOP_D, f);
    await capture("T-before");
    const n = await evaluate(`__sdfGame.axeChop(${pick.id}, "H", "torso")`);
    const ws = (await woundsOf(pick.id)).filter((w) => w.shape === "cut");
    check(n === 1 && ws.length === 1, `T: one cut on the turned body (${n} hits, ${ws.length} cuts)`);
    const last = (await evaluate("__sdfGame.axe()")).last;
    const img = await capture("T-after");
    const d = ws[0] && last?.points?.[0] ? len(sub(ws[0].pos, last.points[0])) : Infinity;
    out.t = { offHit: +d.toFixed(4), dirWorld: ws[0]?.dirWorld?.map((q) => +q.toFixed(3)) };
    check(d <= T_LAND_MAX, `T: the cut lands on the struck point (midpoint ${(100 * d).toFixed(2)} cm from the hit <= ${100 * T_LAND_MAX} cm)`);
    const dy = Math.abs(ws[0]?.dirWorld?.[1] ?? 0);
    check(dy > 0.8, `T: the overhead's cut runs vertically on the turned body too (|dir.y| ${dy.toFixed(2)} > 0.8)`);
    const c = ws[0] ? await toPx(ws[0].pos) : null;
    if (c) cropOut(img, c, 260, 320, "T-after-crop");
  }
} finally { closeSession(S); }
check(DEPTH.captures > 0 && DEPTH.behind === 0 && DEPTH.outside === 0, depthGuardLine(DEPTH));
const errs = consoleEvents.filter((e) => e.type === "error" || e.type === "exception");
check(errs.length === 0, `zero console errors or exceptions (${errs.length}${errs.length ? ": " + J(errs.slice(0, 3)) : ""})`);
console.log(`\nsummary: ${J(out)}`);
console.log(`\n${results.length} checks, ${failures} failed`);
for (const r of results) console.log(r);
process.exit(failures ? 1 : 0);
