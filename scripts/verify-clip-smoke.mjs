// CDP smoke for X1.27 task C: load the lab, switch to the X1.26 static baked
// hand, and prove the march pipeline still compiles and renders after the
// adjacent-slab sampler rework. Node 22 native WebSocket, no deps.
//
// Usage: node scripts/verify-clip-smoke.mjs <vitePort> <outPng>
import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5277);
const OUT = process.argv[3] ?? '/tmp/task-c-smoke.png';
const CDP = Number(process.argv[4] ?? 9223);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

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
    consoleEvents.push(`exception: ${JSON.stringify(m.params.exceptionDetails)}`);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });

// Wait for the lab boot (scene + pipelines compile).
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.fpv')) break;
}
const backend = await evaluate(`(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return a ? 'webgpu-ok' : 'NO-ADAPTER';
})()`, true);
console.log('backend:', backend);

// FPV + static baked mode (the X1.26 path every view shares after C2).
await evaluate('window.__sdfLab.enterFpv()');
await sleep(800);
// Wait until the static volume has ACTUALLY settled before requesting the
// switch — requestHandField refuses 'baked' while the load is pending.
for (let i = 0; i < 40; i++) {
  const st = await evaluate('window.__sdfLab.fpv');
  if (st.handVolume === 'ready') break;
  await sleep(500);
}
await evaluate(`window.__sdfLab.setHandField('baked'), true`);
let fpv = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  fpv = await evaluate('window.__sdfLab.fpv');
  if (fpv.handField === 'baked' && fpv.handVolume === 'ready') break;
}
console.log('fpv:', JSON.stringify(fpv));

// Let the static baked hand settle through several rAFs.
await evaluate(`new Promise(r => { let n = 0;
  const tick = () => (++n >= 20 ? r(true) : requestAnimationFrame(tick));
  requestAnimationFrame(tick); })`, true);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const png = Buffer.from(shot.result?.data ?? shot.data, 'base64');
writeFileSync(OUT, png);
console.log('screenshot ->', OUT, png.length, 'bytes');

// Numeric blank-canvas check: decode the PNG (IHDR+IDAT, zlib inflate,
// unfilter) and demand real pixel variance — a blank/frozen surface has none.
function pngStats(buf) {
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
    return { w, h, unsupported: `depth${bitDepth}/color${colorType}` };
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
  // Luma variance over a subsample.
  let n = 0, s = 0, s2 = 0;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 256));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i = y * stride + x * chans;
      const l = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n;
  return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(s2 / n - mean * mean).toFixed(2) };
}
const stats = pngStats(png);
console.log('canvas stats:', JSON.stringify(stats));

const badConsole = consoleEvents.filter(e =>
  /GPUValidationError|GPUInternalError|GPUOutOfMemoryError|compil|shader|WebGPU|error/i.test(e));
console.log('console events (filtered):', badConsole.length);
for (const e of badConsole.slice(0, 12)) console.log('  |', e.slice(0, 300));

const pass = backend === 'webgpu-ok'
  && fpv?.handField === 'baked' && fpv?.handVolume === 'ready'
  && stats.std > 8            // a rendered scene, not a flat surface
  && badConsole.every(e => !/GPUValidationError|compil|shader/i.test(e));
console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(pass ? 0 : 1);
