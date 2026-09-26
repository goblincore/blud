// scripts/sdf-game-void-gate.mjs — headless gate for the Void (spec 2026-09-24-void-portal-design.md §9).
// No-deps CDP, same plumbing as scripts/sdf-game-wake-gate.mjs.
//
//   1. BOOT: the-void active, no console errors, one portal to night-train.
//   2. LOOK: from the start, the screen centre (the portal) is red; the edges are black.
//   3. ENTER: standing in the portal reloads the page into the target level.
//
// Usage: LAB_VITE_PORT=5293 LAB_CDP_PORT=9293 node scripts/sdf-game-void-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5293);
const CDP = Number(process.argv[3] ?? 9293);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {} });

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
let consoleEvents = [];
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
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
async function boot(query) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}` });
  for (let i = 0; i < 360; i++) {
    await sleep(500);
    const phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null);
    if (phase === 'ready') return true;
    const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
    if (errs.length) return false;
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });

/** PNG decode (8-bit RGB/RGBA), copied from scripts/dungeon-shadowab.mjs. */
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
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

import { writeFileSync } from 'node:fs';
const SHOT_OUT = process.env.VOID_GATE_SHOT;

/** Mean rgb (0..1) over a box given in fractions of the frame. */
function meanRgb(img, fx0, fy0, fx1, fy1) {
  const { w, h, ch, data } = img;
  const x0 = Math.floor(fx0 * w), x1 = Math.floor(fx1 * w), y0 = Math.floor(fy0 * h), y1 = Math.floor(fy1 * h);
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
  return acc.map((v) => v / n / 255);
}

// 1. BOOT
if (!(await boot('level=the-void'))) { console.error(consoleEvents.slice(-8)); fail('the-void did not boot to ready'); }
const vs = await evaluate('__sdfGame.voidState()');
if (!vs || vs.portals.length !== 1 || vs.portals[0].target !== 'night-train') fail(`voidState ${JSON.stringify(vs)}`);
pass('boot: the-void active, one portal to night-train');

// 2. LOOK — standing at the start, facing the portal. The loader hides on first lock,
// which headless never does; hide it by hand for the capture.
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await sleep(1500);
const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
if (SHOT_OUT) writeFileSync(SHOT_OUT, png);
const shot = decodePng(png);
const c = meanRgb(shot, 0.47, 0.40, 0.53, 0.52), l = meanRgb(shot, 0.02, 0.45, 0.10, 0.55), r = meanRgb(shot, 0.90, 0.45, 0.98, 0.55);
const f3 = (v) => v.map((x) => x.toFixed(3)).join(',');
if (!(c[0] > 0.08 && c[0] > 1.5 * c[1])) fail(`portal centre not red: ${f3(c)}`);
if (!(Math.max(...l, ...r) < 0.06)) fail(`void edges not black: ${f3(l)} / ${f3(r)}`);
pass(`look: portal centre ${f3(c)}, edges ${f3(l)} / ${f3(r)}`);

// 3. ENTER — stand in the portal; the page reloads into the target.
await evaluate('__sdfGame.setPose(0, -18, 0, 0)');
await sleep(1500);
const href = await evaluate('location.href').catch(() => '');
if (!/level=night-train/.test(href)) fail(`did not enter the portal: ${href}`);
pass('enter: the portal loads night-train');

console.log('PASS sdf-game-void-gate');
process.exit(0);
