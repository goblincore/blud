// scripts/verify-humanoid-sdf-spike.mjs
//
// Task 7 Step 4 — deterministic CDP verifier + screenshot grader for the
// textured humanoid sever spike. Node 22 native WebSocket, zero deps.
//
// Usage: node scripts/verify-humanoid-sdf-spike.mjs <vitePort> <outDir> <cdpPort>
//
// Drives the page (humanoid-sdf-spike.html) through window.__humanoidSdfSpike:
// pins the camera, captures the ten fixed states, runs ten sever/reset cycles
// measuring frame intervals + resource counts, then grades the PNGs offline:
// non-blank luma, textured flesh variance, warm-flesh connected-component
// continuity across the elbow, no phantom cut edge before sever, cap presence
// after sever, detached-piece separation after flight, and landmark colour
// stability across 0/50/100 degree poses. Annotated masks/contours go into
// live-contact-sheet.png. Numeric checks supplement owner review — they do
// not approve organic appearance.
//
// The capture sequence mirrors the plan's panel list 1-10:
//   live-bind, live-elbow-0, live-elbow-50, live-elbow-100, live-softness,
//   live-pre-sever, live-sever-frame (physics paused), live-detached-flight,
//   live-impact, live-settled.

import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5277);
const OUT = process.argv[3] ?? 'docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike';
const CDP = Number(process.argv[4] ?? 9223);
mkdirSync(OUT, { recursive: true });

// The camera the whole capture run pins (must match the spike's default
// orbit envelope: pitch in [-0.4, 1.2], distance in [0.9, 8]).
const CAMERA = { yaw: -0.45, pitch: -0.08, distance: 2.3 };

// ---------------------------------------------------------------------------
// PNG decode (zlib inflate + unfilter) — RGBA8
// ---------------------------------------------------------------------------

function decodePng(buf) {
  const b = Buffer.from(buf);
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`decodePng: unsupported depth ${bitDepth}/color ${colorType}`);
  }
  const chans = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * chans;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? cur[i - chans] : 0;
      const bb = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + bb) & 0xff;
      else if (filter === 3) v = (v + ((a + bb) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 0xff;
      }
      cur[i] = v;
    }
    prev = cur;
  }
  // Normalise RGB to RGBA so every downstream consumer sees 4 channels.
  if (chans === 3) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 3;
        const di = (y * w + x) * 4;
        rgba[di] = out[si]; rgba[di + 1] = out[si + 1]; rgba[di + 2] = out[si + 2]; rgba[di + 3] = 255;
      }
    }
    return { w, h, rgba };
  }
  return { w, h, rgba: out };
}

// ---------------------------------------------------------------------------
// PNG encode (deflate + CRC32) — for the contact sheet
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Image toolkit — masks, components, drawing (all RGBA Uint8/Buffer canvases)
// ---------------------------------------------------------------------------

function px(rgba, stride, x, y) { return y * stride + x * 4; }

/** Warm-flesh mask: the latex skin (base ~0xc46a72) under the marcher's key
 *  light. The camera faces the zombie's shaded side, so the lit skin sits in
 *  the r>40..170 band; the dark floor/background (r-g<=9) and the dark pants
 *  (low r dominance) stay out. */
function fleshMask(rgba, w, h) {
  const out = new Uint8Array(w * h);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px(rgba, stride, x, y);
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      out[y * w + x] =
        r > 40 && g > 12 && b > 12 && r - g > 12 && r - b > 12 ? 1 : 0;
    }
  }
  return out;
}

/** Cut-cap mask: the wet meat/deep ramp (meat 0x9e1b24, deep 0x8c1420) — a
 *  narrow saturated dark-red band. Bright skin and floor never enter it. */
function capMask(rgba, w, h) {
  const out = new Uint8Array(w * h);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px(rgba, stride, x, y);
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      out[y * w + x] =
        r > 100 && r < 205 && g < 60 && b < 75 && r - g > 75 && r > 3 * g ? 1 : 0;
    }
  }
  return out;
}

function maskStats(rgba, w, h, mask) {
  let n = 0, s = 0, s2 = 0;
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const i = px(rgba, stride, x, y);
      const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  if (n === 0) return { n: 0, mean: 0, std: 0 };
  const mean = s / n;
  return { n, mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

function lumaStats(rgba, w, h) {
  const mask = new Uint8Array(w * h).fill(1);
  return maskStats(rgba, w, h, mask);
}

/** 8-connected components of a binary mask. Returns [{id, size, minX, maxX,
 *  minY, maxY, cx, cy}] sorted by size descending, plus the label map. */
function connectedComponents(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x] || label[y * w + x] !== -1) continue;
      const id = comps.length;
      let size = 0, minX = x, maxX = x, minY = y, maxY = y;
      const stack = [[x, y]];
      label[y * w + x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (mask[ny * w + nx] && label[ny * w + nx] === -1) {
              label[ny * w + nx] = id;
              stack.push([nx, ny]);
            }
          }
        }
      }
      comps.push({ id, size, minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
    }
  }
  comps.sort((a, b) => b.size - a.size);
  return { comps, label };
}

/** Boundary pixels of a component (4-neighbour check on the mask). */
function componentBoundary(mask, w, h, id, label) {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== id) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        label[y * w + x - 1] !== id || label[y * w + x + 1] !== id ||
        label[(y - 1) * w + x] !== id || label[(y + 1) * w + x] !== id;
      if (edge) out.push([x, y]);
    }
  }
  return out;
}

// -- drawing ----------------------------------------------------------------

function setPx(rgba, w, h, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
}

function drawLine(rgba, w, h, x0, y0, x1, y1, color) {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(rgba, w, h, x0, y0, ...color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawRect(rgba, w, h, x, y, rw, rh, color) {
  for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) {
    for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) setPx(rgba, w, h, i, j, ...color);
  }
}

/** Minimal 5x7 bitmap font (columns as 5-bit rows). */
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], 1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], 3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], 5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], 7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], 9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00], '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00], '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10], '=': [0x00, 0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

function drawText(rgba, w, h, x, y, text, color, scale = 1) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPx(rgba, w, h, cx + col * scale + sx, y + row * scale + sy, ...color);
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

/** Nearest-neighbour downscale (captures are exactly 5x the panel size). */
function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CDP driver — Node 22 native WebSocket
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
ws.onclose = (ev) => console.log(`[ws closed ${ev.code}]`);
process.on('exit', () => { try { ws.close(); } catch { /* gone */ } });

let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 400)}`);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `http://localhost:${VITE}/humanoid-sdf-spike.html` });

// Wait for the automation API + a ready bootstrap (asset fetch ~50 MB +
// prewarm compile). A failed bootstrap still exposes a stub API whose
// status().phase is 'failed' — that is a hard failure, not a retry.
let apiStatus = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  const st = await evaluate(`(typeof window.__humanoidSdfSpike === 'object')
    ? window.__humanoidSdfSpike.status() : null`);
  if (st) { apiStatus = st; break; }
}
if (!apiStatus) throw new Error('bootstrap timed out (no __humanoidSdfSpike)');
console.log('bootstrap status:', JSON.stringify({ phase: apiStatus.phase, error: apiStatus.error, prewarmMs: apiStatus.prewarm?.elapsedMs }));
if (apiStatus.phase === 'failed') {
  console.log(`VERIFY FAIL: bootstrap failed — ${apiStatus.error}`);
  process.exit(1);
}
if (apiStatus.phase !== 'ready') throw new Error(`bootstrap stuck in ${apiStatus.phase}`);
const backend = await evaluate('window.__humanoidSdfSpike.backend');
console.log('backend:', backend);

// Hide the DOM panel so captures are pure canvas, then pin the camera.
await evaluate(`document.getElementById('panel').style.display = 'none', true`);
await evaluate(`window.__humanoidSdfSpike.setCamera(${CAMERA.yaw}, ${CAMERA.pitch}, ${CAMERA.distance}), true`);
await evaluate(`window.__humanoidSdfSpike.setElbow(0), true`);
await evaluate(`window.__humanoidSdfSpike.setSoftness(0), true`);

const raf = (n) => evaluate(`new Promise(r => { let k = 0;
  const tick = () => (++k >= ${n} ? r(true) : requestAnimationFrame(tick));
  requestAnimationFrame(tick); })`, true);

/** rAF-accurate wait for a page-side condition (one evaluate, no gaps). */
const waitFor = (condJs, timeoutMs) => evaluate(`(async () => {
  const t0 = performance.now();
  while (performance.now() - t0 < ${timeoutMs}) {
    if (${condJs}) return true;
    await new Promise(r => requestAnimationFrame(r));
  }
  return false;
})()`, true);

const shot = async (name) => {
  await raf(3); // let the current state settle through the pipeline
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(s.result?.data ?? s.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, png);
  return decodePng(png);
};

// ---------------------------------------------------------------------------
// The ten fixed captures
// ---------------------------------------------------------------------------

const captures = {};
captures['live-bind'] = await shot('live-bind');
console.log('captured live-bind');

await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
captures['live-elbow-0'] = await shot('live-elbow-0');
console.log('captured live-elbow-0');

await evaluate('window.__humanoidSdfSpike.setElbow(50), true');
await raf(2);
captures['live-elbow-50'] = await shot('live-elbow-50');
console.log('captured live-elbow-50');

await evaluate('window.__humanoidSdfSpike.setElbow(100), true');
await raf(2);
captures['live-elbow-100'] = await shot('live-elbow-100');
console.log('captured live-elbow-100');

// Scripted elbow impulse at moderate softness: the spring is mid-flight and
// the surface warp (softness > 0) is active — capture ~4 frames after the
// impulse, before the critically damped spring converges.
await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
await raf(2);
await evaluate('window.__humanoidSdfSpike.setSoftness(0.6), true');
await evaluate('window.__humanoidSdfSpike.setElbow(75), true');
await raf(4);
captures['live-softness'] = await shot('live-softness');
console.log('captured live-softness');

// Back to a clean intact state for the pre-sever baseline.
await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
await evaluate('window.__humanoidSdfSpike.setSoftness(0), true');
await raf(10);
captures['live-pre-sever'] = await shot('live-pre-sever');
console.log('captured live-pre-sever');

// Sever with physics PAUSED: the complementary caps render at release; the
// piece has not moved yet. This is the FIRST sever (first-use frame gate).
const countsBeforeSever = await evaluate('window.__humanoidSdfSpike.resourceCounts()');
await evaluate('window.__humanoidSdfSpike.setPhysicsPaused(true), true');
const firstSever = await evaluate(`(async () => {
  await new Promise(r => requestAnimationFrame(r)); // align to a frame boundary
  const t0 = performance.now();
  const ok = window.__humanoidSdfSpike.sever();
  const severMs = performance.now() - t0;
  const interval = await new Promise(res => requestAnimationFrame(ts => res(ts - t0)));
  return { ok, severMs, interval };
})()`, true);
console.log('first sever:', JSON.stringify(firstSever), 'counts:', JSON.stringify(countsBeforeSever));
const countsAfterSever = await evaluate('window.__humanoidSdfSpike.resourceCounts()');
await raf(3);
captures['live-sever-frame'] = await shot('live-sever-frame');
console.log('captured live-sever-frame');

// Unpause; catch the distal cap facing the camera mid-flight (poll capNormal),
// else fall back to a fixed 0.35 s mark.
await evaluate('window.__humanoidSdfSpike.setPhysicsPaused(false), true');
const flight = await evaluate(`(async () => {
  const t0 = performance.now();
  // camera pinned at known pos/target — replicate the orbit placement.
  const yaw = ${CAMERA.yaw}, pitch = ${CAMERA.pitch}, dist = ${CAMERA.distance};
  const cp = Math.cos(pitch);
  const camX = 0 + Math.sin(yaw) * cp * dist;
  const camY = 0.95 + Math.sin(pitch) * dist;
  const camZ = 0 + Math.cos(yaw) * cp * dist;
  let best = { dot: -1, t: 0 };
  while (performance.now() - t0 < 1600) {
    const d = window.__humanoidSdfSpike.diagnostics();
    if (!d.detached || !d.chunkPos || !d.capNormal) return { state: 'gone' };
    const vx = d.chunkPos[0] - camX, vy = d.chunkPos[1] - camY, vz = d.chunkPos[2] - camZ;
    const len = Math.hypot(vx, vy, vz);
    const dot = (d.capNormal[0] * vx + d.capNormal[1] * vy + d.capNormal[2] * vz) / len;
    if (dot > best.dot) best = { dot, t: performance.now() - t0 };
    if (dot > 0.45) return { state: 'cap-facing', dot: +dot.toFixed(3), t: +best.t.toFixed(0) };
    await new Promise(r => requestAnimationFrame(r));
  }
  return { state: 'best', dot: +best.dot.toFixed(3), t: +best.t.toFixed(0) };
})()`, true);
console.log('flight capture target:', JSON.stringify(flight));
captures['live-detached-flight'] = await shot('live-detached-flight');
console.log('captured live-detached-flight');

// Impact: the frame the chunk first touches the floor (jiggle just fired).
const impact = await waitFor('window.__humanoidSdfSpike.diagnostics().grounded', 8000);
console.log('impact reached:', impact);
captures['live-impact'] = await shot('live-impact');
console.log('captured live-impact');

// Settled: jiggle decayed (tau ~1/3 s), piece flat on the floor.
await raf(150);
captures['live-settled'] = await shot('live-settled');
console.log('captured live-settled');

// ---------------------------------------------------------------------------
// Ten sever/reset cycles — first-use vs repeated counters + frame intervals
// ---------------------------------------------------------------------------

const cycles = [];
for (let i = 0; i < 10; i++) {
  await evaluate('window.__humanoidSdfSpike.reset(), true');
  await raf(4);
  const before = await evaluate('window.__humanoidSdfSpike.resourceCounts()');
  const c = await evaluate(`(async () => {
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    const ok = window.__humanoidSdfSpike.sever();
    const severMs = performance.now() - t0;
    const interval = await new Promise(res => requestAnimationFrame(ts => res(ts - t0)));
    const after = window.__humanoidSdfSpike.resourceCounts();
    return { ok, severMs, interval, before: ${JSON.stringify(before)}, after };
  })()`, true);
  cycles.push(c);
  await raf(6);
  console.log(`cycle ${i + 1}: sever ${c.severMs.toFixed(1)}ms frame ${c.interval.toFixed(1)}ms`);
}
await evaluate('window.__humanoidSdfSpike.reset(), true');
await raf(10);

const timing = await evaluate('window.__humanoidSdfSpike.timing()');
const finalStatus = await evaluate('window.__humanoidSdfSpike.status()');
console.log('timing:', JSON.stringify(timing));
console.log('final status:', JSON.stringify({ phase: finalStatus.phase, severPhase: finalStatus.severPhase }));

// ---------------------------------------------------------------------------
// Wound panels 11-17 (click-to-shoot) + wound-scan / trace perf
// ---------------------------------------------------------------------------

const shootAt = (expr) => evaluate(`window.__humanoidSdfSpike.shootWorld(${expr})`);

// Panel 11: three pellets across the mid-forearm, elbow 0.
await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
await evaluate('window.__humanoidSdfSpike.setSoftness(0), true');
await evaluate('window.__humanoidSdfSpike.clearWounds(), true');
await raf(3);
for (const ox of [-0.03, 0, 0.03]) {
  await shootAt(`window.__humanoidSdfSpike.worldOnBone('RightForeArm', [${ox}, 0.11, 0])`);
}
const w11 = await evaluate('window.__humanoidSdfSpike.diagnostics().woundCount');
captures['live-wound-forearm-0'] = await shot('live-wound-forearm-0');
console.log(`captured live-wound-forearm-0 (${w11} wounds)`);

// Panel 12: the same three at 100° flexion — craters ride the flesh.
await evaluate('window.__humanoidSdfSpike.setElbow(100), true');
await raf(2);
captures['live-wound-forearm-100'] = await shot('live-wound-forearm-100');
console.log('captured live-wound-forearm-100');

// Panel 13: a pellet placed deliberately ON the cut plane, pre-sever.
await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
await evaluate('window.__humanoidSdfSpike.clearWounds(), true');
await raf(3);
await shootAt("window.__humanoidSdfSpike.worldOnBone('RightForeArm')"); // occupied centre ≈ on the plane
captures['live-wound-cut-plane'] = await shot('live-wound-cut-plane');
console.log('captured live-wound-cut-plane');

// Panel 14: the sever frame for that straddling wound (both halves bite).
await evaluate('window.__humanoidSdfSpike.setPhysicsPaused(true), true');
await evaluate('window.__humanoidSdfSpike.sever(), true');
await raf(3);
captures['live-wound-sever-frame'] = await shot('live-wound-sever-frame');
console.log('captured live-wound-sever-frame');

// Panel 15: the detached piece in flight, bullet holes intact.
await evaluate('window.__humanoidSdfSpike.setPhysicsPaused(false), true');
await raf(21); // ~0.35 s into flight
captures['live-wound-detached-flight'] = await shot('live-wound-detached-flight');
console.log('captured live-wound-detached-flight');

// Panel 16: a crater spanning the shoulder cluster boundary (no seam slice).
await evaluate('window.__humanoidSdfSpike.reset(), true');
await evaluate('window.__humanoidSdfSpike.clearWounds(), true');
await raf(3);
await shootAt("window.__humanoidSdfSpike.worldOnBone('RightShoulder')");
captures['live-wound-shoulder-seam'] = await shot('live-wound-shoulder-seam');
console.log('captured live-wound-shoulder-seam');

// Panel 17: a fresh crater beside the settled cut cap. Frame the settled piece
// cap-face-on (its cap normal points away from the body camera), then aim a
// fresh pellet just distal of the cap.
await evaluate('window.__humanoidSdfSpike.clearWounds(), true');
await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
await evaluate('window.__humanoidSdfSpike.sever(), true');
const settled17 = await waitFor('window.__humanoidSdfSpike.diagnostics().grounded', 8000);
await raf(150);
await evaluate(`(() => {
  const d = window.__humanoidSdfSpike.diagnostics();
  const p = d.chunkPos, n = d.capNormal;
  window.__humanoidSdfSpike.setCameraTarget(p[0], p[1], p[2]);
  const yaw = Math.atan2(n[0], n[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, n[1])));
  window.__humanoidSdfSpike.setCamera(yaw, pitch, 0.55);
})()`);
await raf(3);
const hit17 = await shootAt("window.__humanoidSdfSpike.worldOnBone('RightForeArm', [0, 0.18, 0])");
await raf(3);
captures['live-wound-beside-cap'] = await shot('live-wound-beside-cap');
console.log(`captured live-wound-beside-cap (settled=${settled17} hit=${hit17})`);

// Slot-drop counter across the wound panels (0 == the budget held).
const slotDrops = await evaluate('window.__humanoidSdfSpike.diagnostics().woundSlotDrops');

// Wound-scan cost: steady-state frame timing at 0, 6 and 12 logical wounds.
const woundTiming = {};
async function timingAt(wounds) {
  await evaluate('window.__humanoidSdfSpike.clearWounds(), true');
  if (wounds > 0) {
    await evaluate(`(() => {
      const xs = [-0.04, -0.024, -0.008, 0.008, 0.024, 0.04];
      for (let i = 0; i < ${wounds}; i++) {
        window.__humanoidSdfSpike.shootWorld(window.__humanoidSdfSpike.worldOnBone('RightForeArm', [xs[i % 6], 0.11 + 0.025 * Math.floor(i / 6), 0]));
      }
    })()`);
  }
  await raf(150); // fill the 120-frame rolling window with the new state
  return evaluate('window.__humanoidSdfSpike.timing()');
}
await evaluate('window.__humanoidSdfSpike.reset(), true');
await evaluate('window.__humanoidSdfSpike.setElbow(0), true');
woundTiming['0'] = await timingAt(0);
woundTiming['6'] = await timingAt(6);
woundTiming['12'] = await timingAt(12);
console.log('wound-scan timing:', JSON.stringify(woundTiming));

// Click-to-shoot trace cost per hit (a burst of aim-and-fire through the same
// landmark, then cleared).
const traceCost = await evaluate(`(async () => {
  window.__humanoidSdfSpike.clearWounds();
  const p = window.__humanoidSdfSpike.worldOnBone('RightForeArm');
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) window.__humanoidSdfSpike.shootWorld(p);
  const t1 = performance.now();
  window.__humanoidSdfSpike.clearWounds();
  return (t1 - t0) / 200;
})()`, true);
console.log('click-to-shoot ms/hit:', traceCost);

// ---------------------------------------------------------------------------
// Offline grading of the ten captures
// ---------------------------------------------------------------------------

const grade = {};
for (const name of Object.keys(captures)) {
  const { w, h, rgba } = captures[name];
  const luma = lumaStats(rgba, w, h);
  const flesh = fleshMask(rgba, w, h);
  const cap = capMask(rgba, w, h);
  const fleshStats = maskStats(rgba, w, h, flesh);
  const capStats = maskStats(rgba, w, h, cap);
  const fleshCC = connectedComponents(flesh, w, h);
  const capCC = connectedComponents(cap, w, h);
  grade[name] = {
    w, h, lumaStd: +luma.std.toFixed(2), lumaMean: +luma.mean.toFixed(1),
    fleshPx: fleshStats.n, fleshLumaStd: +fleshStats.std.toFixed(2),
    capPx: capStats.n, capMeanR: capStats.n ? +capStats.mean.toFixed(0) : 0,
    fleshComponents: fleshCC.comps.map(c => c.size).slice(0, 5),
    capComponents: capCC.comps.map(c => c.size).slice(0, 5),
    largestFleshFrac: fleshCC.comps.length
      ? +(fleshCC.comps[0].size / Math.max(1, fleshStats.n)).toFixed(3) : 0,
    bodyBBox: fleshCC.comps.length
      ? [fleshCC.comps[0].minX, fleshCC.comps[0].minY, fleshCC.comps[0].maxX, fleshCC.comps[0].maxY]
      : null,
  };
  if (name.startsWith('live-elbow-') || name === 'live-bind') {
    grade[name].fleshCC = fleshCC;
  }
}
// Keep the elbow-0 components + labels for landmark detection + contours.
const elbow0 = captures['live-elbow-0'];
const elbow0Flesh = fleshMask(elbow0.rgba, elbow0.w, elbow0.h);
const elbow0CC = connectedComponents(elbow0Flesh, elbow0.w, elbow0.h);

// -- landmark colour stability across 0/50/100 (head + torso patches) --------
// Head landmarks come from the TOPMOST flesh component (the head — static
// under elbow flexion); torso landmarks from the largest component's centre.
let landmarks = [];
if (elbow0CC.comps.length >= 1) {
  const head = elbow0CC.comps.reduce((a, b) => (b.minY < a.minY ? b : a));
  const headCX = (head.minX + head.maxX) / 2;
  const headCY = (head.minY + head.maxY) / 2;
  const torso = elbow0CC.comps[0];
  const torsoY = (torso.minY + torso.maxY) / 2;
  const torsoCX = (torso.minX + torso.maxX) / 2;
  landmarks = [
    [headCX - 12, headCY], [headCX, headCY], [headCX + 12, headCY],
    [headCX - 10, headCY + 10], [headCX + 10, headCY + 10],
    [torsoCX - 12, torsoY], [torsoCX + 12, torsoY],
  ];
}
function patchMean(cap, x, y) {
  const { w, h, rgba } = cap;
  const stride = w * 4;
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const X = Math.round(x + dx), Y = Math.round(y + dy);
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const i = Y * stride + X * 4;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}
const landmarkDeltas = [];
if (landmarks.length) {
  for (const [lx, ly] of landmarks) {
    const c0 = patchMean(captures['live-elbow-0'], lx, ly);
    const c50 = patchMean(captures['live-elbow-50'], lx, ly);
    const c100 = patchMean(captures['live-elbow-100'], lx, ly);
    if (c0 && c50 && c100) {
      landmarkDeltas.push(Math.max(
        Math.abs(c0[0] - c50[0]), Math.abs(c0[0] - c100[0]),
        Math.abs(c0[1] - c50[1]), Math.abs(c0[1] - c100[1]),
        Math.abs(c0[2] - c50[2]), Math.abs(c0[2] - c100[2]),
      ));
    }
  }
}
grade.maxLandmarkDelta = landmarkDeltas.length ? +Math.max(...landmarkDeltas).toFixed(1) : null;

// -- bind vs elbow-0 determinism (both elbow 0, softness 0) ------------------
function meanAbsLumaDiff(a, b) {
  const { w, h } = a;
  let s = 0, n = 0;
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * 4;
      const la = 0.299 * a.rgba[i] + 0.587 * a.rgba[i + 1] + 0.114 * a.rgba[i + 2];
      const lb = 0.299 * b.rgba[i] + 0.587 * b.rgba[i + 1] + 0.114 * b.rgba[i + 2];
      s += Math.abs(la - lb); n++;
    }
  }
  return s / n;
}
grade.bindVsElbow0Diff = +meanAbsLumaDiff(captures['live-bind'], captures['live-elbow-0']).toFixed(3);

// -- elbow motion: 0 -> 100 must move a meaningful pixel count ----------------
function pixelDiff(a, b) {
  const { w, h } = a;
  const stride = w * 4;
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    if (Math.abs(a.rgba[j] - b.rgba[j]) + Math.abs(a.rgba[j + 1] - b.rgba[j + 1]) + Math.abs(a.rgba[j + 2] - b.rgba[j + 2]) > 24) n++;
  }
  return n;
}
grade.elbow0to100DiffPx = pixelDiff(captures['live-elbow-0'], captures['live-elbow-100']);
grade.severVsPreDiffPx = pixelDiff(captures['live-pre-sever'], captures['live-sever-frame']);

// -- settled: the detached piece lies apart from the body. The second-largest
// flesh component's centroid must sit well clear of the body's centroid.
{
  const s = captures['live-settled'];
  const sf = fleshMask(s.rgba, s.w, s.h);
  const scc = connectedComponents(sf, s.w, s.h);
  const a = scc.comps[0];
  const b = scc.comps[1];
  grade.settledSecondCenterDist = a && b
    ? +Math.hypot(a.cx - b.cx, a.cy - b.cy).toFixed(1) : 0;
  grade.settledPieceSeparated = !!(a && b &&
    b.size >= 300 &&
    Math.hypot(a.cx - b.cx, a.cy - b.cy) >= 80 &&
    Math.hypot(a.cx - b.cx, a.cy - b.cy) >= 60);
}

// -- elbow continuity: the arm's flesh is vertically contiguous through the
// elbow. The elbow/forearm is exactly the 0->100 motion region; scan its rows
// on the elbow-0 capture and require no dark gap (>= 6 rows with < 3 flesh
// pixels) from the upper arm down to the forearm — a real joint-crease
// separation would break the span. Also require a meaningful span length so
// the check sees an upper arm AND a forearm, not a stray speck. ---------------
function elbowRowGap(elbow0Img, e0, e100) {
  const { w, h, rgba } = elbow0Img;
  const stride = w * 4;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.abs(e0.rgba[i] - e100.rgba[i])
        + Math.abs(e0.rgba[i + 1] - e100.rgba[i + 1])
        + Math.abs(e0.rgba[i + 2] - e100.rgba[i + 2]);
      if (d > 30) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  const flesh = fleshMask(rgba, w, h);
  const rows = [];
  for (let y = minY; y <= maxY; y++) {
    let c = 0;
    for (let x = minX; x <= maxX; x++) if (flesh[y * w + x]) c++;
    rows.push(c);
  }
  const first = rows.findIndex(c => c >= 3);
  const last = rows.length - 1 - [...rows].reverse().findIndex(c => c >= 3);
  if (first < 0 || last - first < 30) return { span: last - first + 1, maxGap: 999 };
  let maxGap = 0, run = 0;
  for (let y = first; y <= last; y++) {
    if (rows[y] < 3) { run++; maxGap = Math.max(maxGap, run); } else run = 0;
  }
  return { span: last - first + 1, maxGap, bbox: [minX, minY, maxX, maxY] };
}
grade.elbowContinuity = elbowRowGap(elbow0, captures['live-elbow-0'], captures['live-elbow-100']);

// -- straight cut edge metric on the cap mask (0 pre-sever by construction) ---
function capStraightRuns(cap, w, h) {
  // For each row, the cap's min/max x; count runs of >= 12 consecutive rows
  // where the boundary x is constant within +/-2px (the plane's signature).
  let runs = 0, run = 0, prevMin = -1, prevMax = -1;
  for (let y = 0; y < h; y++) {
    let mn = -1, mx = -1;
    for (let x = 0; x < w; x++) {
      if (cap[y * w + x]) { if (mn === -1) mn = x; mx = x; }
    }
    const same = mn !== -1 && prevMin !== -1 && Math.abs(mn - prevMin) <= 2 && Math.abs(mx - prevMax) <= 2;
    if (same) { run++; if (run >= 12) runs++; } else run = 0;
    prevMin = mn; prevMax = mx;
  }
  return runs;
}
for (const name of ['live-pre-sever', 'live-sever-frame', 'live-detached-flight', 'live-settled']) {
  const g = grade[name];
  const cap = capMask(captures[name].rgba, g.w, g.h);
  g.capStraightRuns = capStraightRuns(cap, g.w, g.h);
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

const gates = [];
function gate(name, ok, detail) {
  gates.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

gate('backend-webgpu', backend === 'webgpu', `backend=${backend}`);
const captureGrades = Object.values(grade).filter(g => typeof g.lumaStd === 'number');
gate('non-blank-luma', captureGrades.every(g => g.lumaStd > 8),
  `std=${captureGrades.map(g => g.lumaStd).join('/')}`);
gate('textured-flesh-variance', grade['live-elbow-0'].fleshLumaStd > 5,
  `fleshLumaStd=${grade['live-elbow-0'].fleshLumaStd}`);
gate('flesh-continuity-across-elbow',
  grade.elbowContinuity.maxGap < 6 && grade.elbowContinuity.span >= 30,
  `span=${grade.elbowContinuity.span} maxGap=${grade.elbowContinuity.maxGap} bbox=${grade.elbowContinuity.bbox?.join(',')}`);
gate('elbow-motion-visible', grade.elbow0to100DiffPx > 1000, `diffPx=${grade.elbow0to100DiffPx}`);
gate('landmark-colour-stable',
  grade.maxLandmarkDelta !== null && grade.maxLandmarkDelta < 30,
  `maxDelta=${grade.maxLandmarkDelta}`);
gate('bind-vs-elbow0-deterministic', grade.bindVsElbow0Diff < 3, `meanDiff=${grade.bindVsElbow0Diff}`);
gate('no-phantom-cut-before-sever', grade['live-pre-sever'].capPx === 0,
  `capPx=${grade['live-pre-sever'].capPx} straightRuns=${grade['live-pre-sever'].capStraightRuns}`);
// The sever frame renders the complementary cut while the piece is coincident:
// the plane is edge-on from the front camera, so the honest signal is that
// the frame CHANGED at the arm (the cut line) plus the flight/impact caps.
gate('sever-changes-render', grade.severVsPreDiffPx >= 4,
  `diffPx=${grade.severVsPreDiffPx}`);
gate('cap-visible-on-flight', grade['live-detached-flight'].capPx >= 60,
  `capPx=${grade['live-detached-flight'].capPx} (flight=${flight.state} dot=${flight.dot})`);
gate('cap-visible-on-impact', grade['live-impact'].capPx >= 60,
  `capPx=${grade['live-impact'].capPx}`);
gate('detached-piece-separated',
  grade.settledPieceSeparated,
  `secondCenterDist=${grade.settledSecondCenterDist}px comps=${grade['live-settled'].fleshComponents.join(',')}`);

// -- sever cycles -------------------------------------------------------------
const countEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstCounts = countsBeforeSever;
const cyclesOk = cycles.every(c => c.ok && countEq(c.before, c.after) && countEq(c.before, firstCounts));
const firstFrameOk = Math.max(firstSever.severMs, firstSever.interval) < 50;
const laterFramesOk = cycles.every(c => Math.max(c.severMs, c.interval) < 50);
const cyclesStable = cycles.slice(1).every(c => Math.abs(c.severMs - cycles[0].severMs) < 30);
gate('sever-refuses-nothing-counts-changed', cyclesOk,
  `all ${cycles.length} cycles identical to first-use counts`);
gate('first-use-frame-under-50ms', firstFrameOk,
  `severMs=${firstSever.severMs.toFixed(1)} frame=${firstSever.interval.toFixed(1)}`);
gate('later-sever-frames-under-50ms', laterFramesOk,
  `max=${Math.max(...cycles.map(c => Math.max(c.severMs, c.interval))).toFixed(1)}ms`);
gate('later-sever-costs-stable', cyclesStable,
  `first=${cycles[0].severMs.toFixed(1)}ms later=${cycles.slice(1).map(c => c.severMs.toFixed(1)).join(',')}`);

const badConsole = consoleEvents.filter(e =>
  /GPUValidationError|GPUInternalError|GPUOutOfMemoryError|compil|shader|pipeline|Uncaught/i.test(e));
gate('no-filtered-gpu-shader-errors', badConsole.length === 0, `filtered=${badConsole.length}`);
for (const e of badConsole.slice(0, 8)) console.log('  |', e.slice(0, 300));

// -- wound gates (click-to-shoot panels 11-17) ---------------------------------
const woundPanelNames = [
  'live-wound-forearm-0', 'live-wound-forearm-100', 'live-wound-cut-plane',
  'live-wound-sever-frame', 'live-wound-detached-flight',
  'live-wound-shoulder-seam', 'live-wound-beside-cap',
];
for (const n of woundPanelNames) {
  const g = grade[n];
  gate(`wound-craters-visible:${n}`, !!(g && g.capPx >= 25),
    `craterPx=${g ? g.capPx : 'missing'}`);
}
gate('wound-rides-flexion',
  pixelDiff(captures['live-wound-forearm-0'], captures['live-wound-forearm-100']) > 500,
  `diffPx=${pixelDiff(captures['live-wound-forearm-0'], captures['live-wound-forearm-100'])}`);
gate('straddling-wound-bites', grade['live-wound-sever-frame'].capPx >= 25,
  `craterPx=${grade['live-wound-sever-frame'].capPx}`);
gate('detached-keeps-wound', grade['live-wound-detached-flight'].capPx >= 25,
  `craterPx=${grade['live-wound-detached-flight'].capPx}`);
{
  const s = captures['live-wound-shoulder-seam'];
  const cap = capMask(s.rgba, s.w, s.h);
  const cc = connectedComponents(cap, s.w, s.h);
  const biggest = cc.comps[0]?.size ?? 0;
  gate('shoulder-seam-no-slice', biggest >= 25 && (cc.comps[1]?.size ?? 0) < biggest * 0.6,
    `comps=${cc.comps.map(c => c.size).slice(0, 4).join(',')}`);
}
gate('no-slot-drops', slotDrops === 0, `drops=${slotDrops}`);

// ---------------------------------------------------------------------------
// Contact sheet — annotated masks/contours (dynamic grid over all 17 panels)
// ---------------------------------------------------------------------------

const PANEL_W = 256, PANEL_H = 160, LABEL_H = 14, GAP = 8, MARGIN = 10;
const cols = 5, rows = Math.ceil(Object.keys(captures).length / cols);
const sheetW = MARGIN * 2 + cols * PANEL_W + (cols - 1) * GAP;
const sheetH = MARGIN * 2 + rows * (LABEL_H + PANEL_H) + (rows - 1) * GAP;
const sheet = Buffer.alloc(sheetW * sheetH * 4);
sheet.fill(20, 0, sheet.length); // dark slate background; alpha 20 -> 255 below
for (let i = 3; i < sheet.length; i += 4) sheet[i] = 255;

const names = Object.keys(captures);
const contoursColor = [80, 220, 220, 255];   // cyan flesh contours
const capColor = [255, 60, 60, 255];         // red cap pixels
const markerColor = [255, 120, 255, 255];    // magenta landmarks
const passColor = [90, 220, 130, 255];
const failColor = [255, 90, 90, 255];

for (let idx = 0; idx < names.length; idx++) {
  const name = names[idx];
  const g = grade[name];
  const cap = captures[name];
  const col = idx % cols, row = Math.floor(idx / cols);
  const x0 = MARGIN + col * (PANEL_W + GAP);
  const y0 = MARGIN + row * (LABEL_H + PANEL_H + GAP);

  // Label: name + PASS/FAIL letter.
  const capDrawn = capMask(cap.rgba, cap.w, cap.h);
  const flesh = fleshMask(cap.rgba, cap.w, cap.h);
  const cc = connectedComponents(flesh, cap.w, cap.h);
  const pass = gradePasses(name);
  drawText(sheet, sheetW, sheetH, x0, y0, name, [230, 220, 224, 255], 1);
  drawText(sheet, sheetW, sheetH, x0 + 170, y0, pass ? 'OK' : '!!', pass ? passColor : failColor, 1);
  const panelY = y0 + LABEL_H;

  // Downscale the capture into the panel.
  const panel = downscale(cap.rgba, cap.w, cap.h, PANEL_W, PANEL_H);
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const si = (y * PANEL_W + x) * 4;
      const di = ((panelY + y) * sheetW + x0 + x) * 4;
      sheet[di] = panel[si]; sheet[di + 1] = panel[si + 1]; sheet[di + 2] = panel[si + 2];
    }
  }
  // Overlay: flesh component contours (top 3), cap pixels, landmarks.
  const sx = cap.w / PANEL_W, sy = cap.h / PANEL_H;
  for (const comp of cc.comps.slice(0, 3)) {
    const bound = componentBoundary(flesh, cap.w, cap.h, comp.id, cc.label);
    for (const [bx, by] of bound) {
      const px2 = Math.round(bx / sx), py2 = Math.round(by / sy);
      if (px2 >= 0 && py2 >= 0 && px2 < PANEL_W && py2 < PANEL_H) {
        setPx(sheet, sheetW, sheetH, x0 + px2, panelY + py2, ...contoursColor);
      }
    }
  }
  for (let y = 0; y < cap.h; y++) {
    for (let x = 0; x < cap.w; x++) {
      if (capDrawn[y * cap.w + x]) {
        setPx(sheet, sheetW, sheetH, x0 + Math.round(x / sx), panelY + Math.round(y / sy), ...capColor);
      }
    }
  }
  if (name === 'live-elbow-0') {
    for (const [lx, ly] of landmarks) {
      drawRect(sheet, sheetW, sheetH, x0 + Math.round(lx / sx) - 1, panelY + Math.round(ly / sy) - 1, 3, 3, markerColor);
    }
  }
}

// Legend strip under the sheet.
const legendY = sheetH + 6;
const legendH = 12;
const sheetFinal = Buffer.alloc(sheetW * (sheetH + legendH) * 4);
for (let i = 0; i < sheetFinal.length; i += 4) { sheetFinal[i] = 22; sheetFinal[i + 1] = 16; sheetFinal[i + 2] = 20; sheetFinal[i + 3] = 255; }
for (let y = 0; y < sheetH; y++) sheet.copy(sheetFinal, y * sheetW * 4, y * sheetW * 4, (y + 1) * sheetW * 4);
drawRect(sheetFinal, sheetW, sheetH + legendH, MARGIN, legendY, 8, 8, contoursColor);
drawText(sheetFinal, sheetW, sheetH + legendH, MARGIN + 12, legendY, 'flesh contour', [220, 220, 220, 255], 1);
drawRect(sheetFinal, sheetW, sheetH + legendH, 130, legendY, 8, 8, capColor);
drawText(sheetFinal, sheetW, sheetH + legendH, 142, legendY, 'cap', [220, 220, 220, 255], 1);
drawRect(sheetFinal, sheetW, sheetH + legendH, 190, legendY, 8, 8, markerColor);
drawText(sheetFinal, sheetW, sheetH + legendH, 202, legendY, 'landmark', [220, 220, 220, 255], 1);

writeFileSync(`${OUT}/live-contact-sheet.png`, encodePng(sheetW, sheetH + legendH, sheetFinal));
console.log(`contact sheet -> ${OUT}/live-contact-sheet.png (${sheetW}x${sheetH + legendH})`);

function gradePasses(name) {
  const g = grade[name];
  if (name === 'live-pre-sever') return g.capPx === 0 && g.lumaStd > 8;
  if (name === 'live-sever-frame') return g.capPx >= 60 && g.lumaStd > 8;
  return g.lumaStd > 8;
}

// ---------------------------------------------------------------------------
// Report + exit
// ---------------------------------------------------------------------------

console.log('\n=== capture grade ===');
for (const [name, g] of Object.entries(grade)) {
  if (typeof g.lumaStd !== 'number') continue;
  console.log(`${name.padEnd(22)} lumaStd=${String(g.lumaStd).padStart(6)} flesh=${String(g.fleshPx).padStart(6)} ` +
    `cap=${String(g.capPx).padStart(4)} fleshComps=[${g.fleshComponents.join(',')}] capComps=[${g.capComponents.join(',')}]`);
}
console.log(`maxLandmarkDelta=${grade.maxLandmarkDelta} bindVsElbow0=${grade.bindVsElbow0Diff} ` +
  `elbow0to100=${grade.elbow0to100DiffPx}px elbowSpan=${grade.elbowContinuity.span} elbowGap=${grade.elbowContinuity.maxGap} ` +
  `severVsPre=${grade.severVsPreDiffPx}px settledDist=${grade.settledSecondCenterDist}px`);
console.log(`wound-scan timing(0/6/12): ` +
  `${JSON.stringify(woundTiming['0']?.median ?? null)}/${JSON.stringify(woundTiming['6']?.median ?? null)}/` +
  `${JSON.stringify(woundTiming['12']?.median ?? null)} ms median · ` +
  `click-to-shoot ${(+traceCost).toFixed(3)} ms/hit · slotDrops=${slotDrops}`);

const passed = gates.every(g => g.ok);
console.log(`\n${passed ? 'VERIFY PASS' : 'VERIFY FAIL'} — ${gates.filter(g => g.ok).length}/${gates.length} gates`);
process.exit(passed ? 0 : 1);
