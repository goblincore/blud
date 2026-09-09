// scripts/dungeon-shadowab.mjs — capture shadow-ON vs shadow-OFF at the same
// pose and pixel-diff them. The diff regions ARE the cast shadows.
// Usage: node scripts/dungeon-shadowab.mjs [vitePort] [cdpPort]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5288);
const CDP = Number(process.argv[3] ?? 9288);
const OUT = '/tmp/dungeon-look';
const POSE = (process.env.LOOK_POSE ?? '-2.2,-4.8,1.5707963,0.15').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal PNG decode (truecolor/grayscale, 8-bit, non-interlaced) --------
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

function diffPngs(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0, bigChanged = 0, sum = 0, maxD = 0;
  // coarse map: 32px cells, count big-diff pixels per cell
  const cells = new Map();
  for (let i = 0; i < a.w * a.h; i++) {
    const ia = i * a.ch, ib = i * b.ch;
    const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
    if (d > 30) {
      changed++;
      if (d > 150) bigChanged++;
      const cx = Math.floor((i % a.w) / 32), cy = Math.floor(Math.floor(i / a.w) / 32);
      cells.set(`${cx},${cy}`, (cells.get(`${cx},${cy}`) ?? 0) + 1);
    }
    sum += d; if (d > maxD) maxD = d;
  }
  const hot = [...cells.entries()].filter(([, n]) => n > 200).map(([c]) => c);
  return { changed, bigChanged, meanD: +(sum / (a.w * a.h)).toFixed(2), maxD, hotCells: hot };
}

// --- CDP driver --------------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const SETTLE_MS = Number(process.env.LOOK_SETTLE_MS ?? 350);
const shot = async (name) => {
  // Headless capture race: captureScreenshot can grab the LAST PRESENTED frame
  // before the just-submitted GPU work reaches the compositor, pairing two
  // identical PNGs (seen 2026-09-01: a shadow A/B read as a byte-identical
  // zero diff). Settle before grabbing.
  await sleep(SETTLE_MS);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('shot', name);
};

mkdirSync(OUT, { recursive: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
for (let i = 0; i < 240; i++) { await sleep(500); if (await evaluate('typeof window.__sdfGame === "object"')) break; }
if (!(await evaluate('typeof window.__sdfGame === "object"'))) { console.error('never booted', errors.slice(-5)); process.exit(1); }

await evaluate('typeof window.__sdfGame.gooPanel === "function" && window.__sdfGame.gooPanel(false)');
await evaluate('typeof window.__sdfGame.vhsPanel === "function" && window.__sdfGame.vhsPanel(false)');
await evaluate('window.__sdfGame.freeze(true)');
await evaluate('window.__sdfGame.setLoopRunning(false)');
await evaluate(`window.__sdfGame.setPose(${POSE[0]}, ${POSE[1]}, ${POSE[2]}, ${POSE[3]})`);
await evaluate('window.__sdfGame.step(20, 1/60)');

await shot('shadow-on');
// NOTE: do NOT toggle spot.castShadow at runtime — three r185 WebGPU crashes
// (ShadowNode.updateShadow dereferences the disposed map's depthTexture).
// shadow.intensity is a live uniform in the node (ShadowNode.js:507), so 0 =
// shadow sampled away, no pipeline rebuild.
//
// PRIMER: the first intensity write must happen BEFORE the "on" capture and
// be followed by steps — without it the A/B pairs byte-identical frames (both
// shadowless; seen twice 2026-09-01). With the primer the same page, pose and
// chain differ by ~5000 px. Harness quirk, not a product bug — the product
// evidence for shadows-at-boot is boottoggle's primed boot-plain pair.
await evaluate('window.__dungeon.spot.shadow.intensity = 1');
await evaluate('window.__sdfGame.step(3, 1/60)');
await shot('shadow-on');
await evaluate('window.__dungeon.spot.shadow.intensity = 0');
await evaluate('window.__sdfGame.step(3, 1/60)');
await shot('shadow-off');
await evaluate('window.__dungeon.spot.shadow.intensity = 1');
await evaluate('window.__sdfGame.step(3, 1/60)');

const A = decodePng(readFileSync(`${OUT}/shadow-on.png`));
const B = decodePng(readFileSync(`${OUT}/shadow-off.png`));
console.log('diff(on-off):', JSON.stringify(diffPngs(A, B)));
if (errors.length) console.log('console errors:', errors.length, errors.slice(-3));
ws.close();
process.exit(0);
