// scripts/shell-turntable.mjs
//
// Faithful copy of scripts/blob-turntable.mjs, retargeted at the shell-march
// spike page instead of the lab. Same CDP pattern, same PNG luma-variance
// blank-frame guard, same index.html contact sheet. It drives the spike's
// `__shellSpike.setCam(yaw, pitch, dist)` deterministically and freezes motion
// (the spike is a static pose, so no freeze is needed, but the camera framing
// and the blank-frame guard matter).
//
// Usage: node scripts/shell-turntable.mjs <vitePort> <outDir> [frames] [cdpPort]
//   LAB_API=setCam (default) — the spike page.
//
// The reference (existing lab) is shot with scripts/blob-turntable.mjs using
// the SAME framing via BLOB_PITCH / BLOB_DIST / BLOB_TARGET_Y, so the two
// turntables line up yaw-for-yaw.
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5325);
const OUT = process.argv[3] ?? '/tmp/shell-turntable';
const FRAMES = Number(process.argv[4] ?? 8);
const CDP = Number(process.argv[5] ?? 9223);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
// ---------------------------------------------------------------------------
// TAB CLEANUP. `/json/new` above spawns a renderer process (~250 MB) that
// OUTLIVES this script unless it is closed again. Nothing here used to close
// it, so every invocation leaked one — and these scripts are run in loops. A
// 2026-08-25 session accumulated ~35 stale tabs across sweeps and benches,
// drove host load to 27, and silently corrupted every timing number taken in
// that window: the runs still "succeeded", they were just measuring a machine
// fighting itself. That is the dangerous failure mode — not a crash, a quiet
// bias.
//
// `process.on('exit')` fires on EVERY exit path (success, fail(), an uncaught
// throw), which is why the cleanup lives here rather than at the end of the
// happy path. Exit handlers must be synchronous, so this shells out to curl
// instead of using fetch — a dev-only script may be inelegant; it may not
// leak. Failure is ignored: if the browser is already gone there is nothing
// to close.
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' });
  } catch { /* browser already gone, or curl missing — nothing to clean */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1380, height: 820, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-shell-spike.html`;
console.log(`shooting ${url}`);
await send('Page.navigate', { url });

let booted = false;
for (let i = 0; i < 160; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__shellSpike === "object"');
  if (booted) break;
}
if (!booted) fail('spike never booted (__shellSpike absent)');
const backend = await evaluate('window.__shellSpike.backend');
console.log('backend:', backend);
const hull = await evaluate('JSON.stringify(window.__shellSpike.hull)');
console.log('hull:', hull);
await sleep(2000);

// Hide the on-screen overlays so they do not occlude the body.
await evaluate(`(() => {
  for (const id of ['status', 'stats', 'controls']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  return true;
})()`);

function pngStats(png) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(sig)) return { unsupported: 'not a PNG' };
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return { w, h, unsupported: `depth${bitDepth}/color${colorType}` };
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
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) for (let x = 0; x < w; x += stepX) {
    const i = y * stride + x * chans;
    const l = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
    n++; s += l; s2 += l * l;
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
}

const PITCH = Number(process.env.BLOB_PITCH ?? 0.12);
const DIST = Number(process.env.BLOB_DIST ?? 2.4);
const TARGET_Y = Number(process.env.BLOB_TARGET_Y ?? 0.95);
const MIN_STD = 5;
const frameStats = [];
for (let i = 0; i < FRAMES; i++) {
  const yaw = (i / FRAMES) * Math.PI * 2;
  await evaluate(`window.__shellSpike.setCam(${yaw}, ${PITCH}, ${DIST}, ${TARGET_Y})`);
  await sleep(450);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  const file = `${OUT}/frame-${String(i).padStart(2, '0')}.png`;
  writeFileSync(file, buf);
  const stats = pngStats(buf);
  frameStats.push({ i, yaw, file, bytes: buf.length, stats });
  console.log(`wrote ${file}  yaw=${((yaw * 180) / Math.PI).toFixed(0)}deg  std=${stats.std ?? 'n/a'}`);
}

const blank = frameStats.filter((f) => (f.stats.std ?? 0) < MIN_STD);
if (blank.length > 0) fail(`${blank.length}/${FRAMES} frame(s) look blank: ${blank.map((f) => `frame-${String(f.i).padStart(2, '0')} std=${f.stats.std}`).join(', ')}`);
const bad = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (bad.length > 0) fail(`${bad.length} console error/exception event(s)`);

const html = `<!doctype html>
<meta charset="utf-8"><title>shell turntable — ${new Date().toISOString()}</title>
<style>body{background:#111;color:#ccc;font:13px monospace;margin:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}figure{margin:0;background:#1a1a1a;border:1px solid #333;padding:4px}img{width:100%;display:block;image-rendering:pixelated}figcaption{padding:4px 2px 0}</style>
<h1>shell turntable — ${FRAMES} frames</h1><p>backend=${backend} hull=${hull} pitch=${PITCH} dist=${DIST}</p>
<div class="grid">
${frameStats.map((f) => `  <figure><img src="frame-${String(f.i).padStart(2, '0')}.png" alt="frame ${f.i}"><figcaption>yaw ${((f.yaw * 180) / Math.PI).toFixed(0)}&deg; · std ${f.stats.std}</figcaption></figure>`).join('\n')}
</div>`;
writeFileSync(`${OUT}/index.html`, html);
console.log(`\n${FRAMES} frames in ${OUT} (open ${OUT}/index.html to review)`);
ws.close();
process.exit(0);
