// scripts/sdf-game-art-gate.mjs — headless gate for the level mesh key
// (spec docs/superpowers/specs/2026-09-24-level-mesh-key-design.md §7).
// No-deps CDP, same plumbing as scripts/sdf-game-void-gate.mjs.
//
//   1. FIXTURE: fixtures/art-shell boots; its green art shell draws where the generated
//      walls would be; the three linked seats are one instanced draw (orange shows).
//   2. WAKE COST: the Wake's art toggled off/on in one page at three poses: draw calls of
//      one still frame, and the paired median fenced frame time (__sdfGame.timeDraws);
//      the difference must stay inside BUDGET.
//
// Usage: LAB_VITE_PORT=5294 LAB_CDP_PORT=9294 node scripts/sdf-game-art-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5294);
const CDP = Number(process.argv[3] ?? 9294);
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
const SHOT_OUT = process.env.ART_GATE_SHOT;

/** Mean rgb (0..1) over a box given in fractions of the frame. */
function meanRgb(img, fx0, fy0, fx1, fy1) {
  const { w, h, ch, data } = img;
  const x0 = Math.floor(fx0 * w), x1 = Math.floor(fx1 * w), y0 = Math.floor(fy0 * h), y1 = Math.floor(fy1 * h);
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
  return acc.map((v) => v / n / 255);
}

/** Cost of the Wake's art over the art-less Wake (worst pose). Owner-approved 2026-09-24;
 *  measured +49..+62 draws, +2.1..+3.9 ms paired, on a loaded machine (load ~20). */
const BUDGET = { drawCalls: 75, frameMs: 5 };
const f3 = (v) => v.map((x) => x.toFixed(3)).join(',');
const shoot = async (name) => {
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  if (SHOT_OUT) writeFileSync(`${SHOT_OUT}/${name}.png`, png);
  return decodePng(png);
};

// 1. FIXTURE
if (!(await boot('level=fixtures/art-shell&frozen'))) { console.error(consoleEvents.slice(-8)); fail('art-shell did not boot'); }
const info = await evaluate('__sdfGame.artInfo()');
if (!info || info.file !== 'art-shell.art.glb' || info.instanced !== 1 || info.instances !== 3) fail(`artInfo ${JSON.stringify(info)}`);
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.setPose(0, -1, 0, -0.15)');
await sleep(1200);
const fx = await shoot('art-shell');
/** Share of pixels in a box (fractions of the frame) that pass `test(r, g, b)` (0..1). */
function share(img, fx0, fy0, fx1, fy1, test) {
  const { w, h, ch, data } = img; let hit = 0, n = 0;
  for (let y = Math.floor(fy0 * h); y < Math.floor(fy1 * h); y++) for (let x = Math.floor(fx0 * w); x < Math.floor(fx1 * w); x++) {
    const i = (y * w + x) * ch; n++; if (test(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)) hit++;
  }
  return hit / n;
}
const wall = meanRgb(fx, 0.80, 0.35, 0.95, 0.55);
const orange = share(fx, 0.05, 0.35, 0.50, 0.85, (r, g, b) => r > 0.35 && g < 0.75 * r && b < 0.4 * r);
if (!(wall[1] > 1.5 * wall[0] && wall[1] > 1.5 * wall[2])) fail(`east wall is not the green art shell: ${f3(wall)}`);
if (!(orange > 0.02)) fail(`no orange seats at left (${(orange * 100).toFixed(1)} % of the box)`);
pass(`fixture: art shell green ${f3(wall)}, seats ${(orange * 100).toFixed(1)} % orange, 3 seats in 1 instanced mesh`);

// 2. WAKE COST — one boot, art toggled on and off at each pose (same page, so machine
// load hits both sides). The game loop is capped at 1 fps while measuring so its own
// frames do not land between a drawStats reset and the read.
const POSES = { start: [-11.5, -1.5, 0, 0], graveyard: [-11.5, -27.5, 0.67, 0.1], manor: [0, -50, 0, 0.1] };
if (!(await boot('level=the-wake&frozen'))) { console.error(consoleEvents.slice(-8)); fail('the-wake did not boot'); }
const wakeArt = await evaluate('__sdfGame.artInfo()');
if (!wakeArt || wakeArt.meshes < 1) fail(`the Wake placed no art: ${JSON.stringify(wakeArt)}`);
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.setFrameCap(1)');
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
async function sample(on) {
  await evaluate(`__sdfGame.setArtVisible(${on})`);
  await evaluate('__sdfGame.timeDraws(2)');
  await evaluate('__sdfGame.drawStats(true)');
  await evaluate('__sdfGame.timeDraws(1)');
  const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
  return { drawCalls, frameMs: await evaluate('__sdfGame.timeDraws(9)') };
}
console.log('pose        draw calls (no art -> art)   frame ms (no art -> art, median of 5 A/B rounds)');
const over = [];
for (const [name, p] of Object.entries(POSES)) {
  await evaluate(`__sdfGame.setPose(${p.join(',')})`);
  await sleep(800);
  const offs = [], ons = [];
  for (let k = 0; k < 5; k++) { offs.push(await sample(false)); ons.push(await sample(true)); }
  const b = { drawCalls: med(offs.map((x) => x.drawCalls)), frameMs: med(offs.map((x) => x.frameMs)) };
  const a = { drawCalls: med(ons.map((x) => x.drawCalls)), frameMs: med(ons.map((x) => x.frameMs)) };
  const dMs = med(ons.map((x, i) => x.frameMs - offs[i].frameMs));
  console.log(`${name.padEnd(11)} ${String(b.drawCalls).padStart(5)} -> ${String(a.drawCalls).padEnd(20)} ${b.frameMs.toFixed(2).padStart(6)} -> ${a.frameMs.toFixed(2)}  (paired +${dMs.toFixed(2)})`);
  if (a.drawCalls - b.drawCalls > BUDGET.drawCalls) over.push(`${name}: draw calls +${a.drawCalls - b.drawCalls} > +${BUDGET.drawCalls}`);
  if (dMs > BUDGET.frameMs) over.push(`${name}: frame +${dMs.toFixed(2)} ms > +${BUDGET.frameMs} ms`);
  if (name === 'manor') await shoot('wake-art-manor');
}
await evaluate('__sdfGame.setFrameCap(30)');
if (over.length) fail(`over budget: ${over.join('; ')}`);
pass(`wake cost: ${wakeArt.meshes} art meshes, inside budget (+${BUDGET.drawCalls} draws, +${BUDGET.frameMs} ms)`);

console.log('PASS sdf-game-art-gate');
process.exit(0);
