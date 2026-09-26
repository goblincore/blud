// scripts/sdf-game-light-gate.mjs — headless gate for the Night Train dynamic light and the
// flashlight (docs/superpowers/plans/2026-09-26-night-train-dynamic-light.md), on Night Train.
// No-deps CDP, same plumbing as scripts/sdf-game-loop-gate.mjs.
//
//   1. DARK START: the flashlight is off (spot intensity 0); the van lamp is dying.
//   2. THE TORCH: taking it switches the flashlight on and kills the van lamp (the cue).
//   3. LIGHTNING: a forced bolt spikes the window light and renders its shadow, only while lit.
//   4. THE STORM IN THE GLASS: the dining window is much brighter during a bolt.
//   5. BLACKOUT: the sleeper corridor trigger cuts the sleeper lamps, then they come back.
//   6. LOOK: screenshots (hold dark and lit, dining mid-flash, a sweep, the party strobe).
//
// Usage: LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 node scripts/sdf-game-light-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
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
const SHOT_OUT = process.env.LIGHT_GATE_SHOT;

/** Mean rgb (0..1) over a box given in fractions of the frame. */
function meanRgb(img, fx0, fy0, fx1, fy1) {
  const { w, h, ch, data } = img;
  const x0 = Math.floor(fx0 * w), x1 = Math.floor(fx1 * w), y0 = Math.floor(fy0 * h), y1 = Math.floor(fy1 * h);
  const acc = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; acc[0] += data[i]; acc[1] += data[i + 1]; acc[2] += data[i + 2]; n++; }
  return acc.map((v) => v / n / 255);
}

const f3 = (v) => v.map((x) => x.toFixed(3)).join(',');
const shoot = async (name) => {
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  if (SHOT_OUT) writeFileSync(`${SHOT_OUT}/${name}.png`, png);
  return decodePng(png);
};

const stats = (img, fx0, fy0, fx1, fy1) => {
  const { w, h, ch, data } = img; const v = [];
  for (let y = Math.floor(fy0 * h); y < Math.floor(fy1 * h); y++) for (let x = Math.floor(fx0 * w); x < Math.floor(fx1 * w); x++) {
    const i = (y * w + x) * ch; v.push((data[i] + data[i + 1] + data[i + 2]) / 765);
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { v, mean, std: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) };
};

const settle = (ms = 700) => sleep(ms);

const lights = () => evaluate('__sdfGame.lights()');
const roomLamps = (l, room) => l.lamps.filter((x) => x.room === room && x.mood !== 'fire');

// 1. DARK START
if (!(await boot('level=night-train&frozen&nospawn&god'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
let L = await lights();
if (!L) fail('no lights() seam');
if (L.flashlight !== 0 || L.spotIntensity !== 0) fail(`flashlight not dark at start: ${JSON.stringify({ f: L.flashlight, spot: L.spotIntensity })}`);
const van = roomLamps(L, 1);
if (van[0]?.mood !== 'dying') fail(`van lamp mood ${van[0]?.mood}`);
if (L.windowLights.length < 3) fail(`window lights: ${JSON.stringify(L.windowLights)}`);
pass(`dark start: flashlight 0, van lamp ${van.map((x) => x.mood).join('/')}, window lights in rooms ${L.windowLights.join(',')}`);
await evaluate('__sdfGame.setPose(0.2, -2.2, 3.1416, 0.05)');
await settle(1200);
const holdDark = stats(await shoot('light-hold-dark'), 0.1, 0.1, 0.9, 0.9).mean;

// 2. THE TORCH — on the hold's west wall (x -1.45, z -4.6).
await evaluate('__sdfGame.setPose(-0.8, -4.6, 3.1416, 0)');
await settle(1600);
L = await lights();
if (!(L.flashlight === 1 && L.spotIntensity > 0)) fail(`flashlight not on after the pickup: ${JSON.stringify({ f: L.flashlight, spot: L.spotIntensity })}`);
if (!roomLamps(L, 1).every((x) => x.script === 'die' && x.level === 0)) fail(`van lamps not dead: ${JSON.stringify(roomLamps(L, 1))}`);
if ((await evaluate('__sdfGame.inventory()')).flashlight !== true) fail('inventory has no flashlight');
await evaluate('__sdfGame.setPose(0.2, -2.2, 3.1416, 0.05)');
await settle(800);
const holdLit = stats(await shoot('light-hold-lit'), 0.1, 0.1, 0.9, 0.9).mean;
pass(`the torch: flashlight on (spot ${L.spotIntensity.toFixed(0)}), van lamps dead; hold mean ${holdDark.toFixed(3)} -> ${holdLit.toFixed(3)}`);

// 3. LIGHTNING — in the dining car, looking at the west window.
await evaluate(`__sdfGame.setPose(-0.4, -18.6, ${-Math.PI / 2}, -0.05)`);
await settle(1000);
// Wait out any bolt in progress, then measure the idle shadow count.
for (let i = 0; i < 20 && (await lights()).windowIntensity > 0; i++) await sleep(150);
const idle0 = (await lights()).shadowFrames;
await sleep(400);
const idle1 = (await lights()).shadowFrames;
const noBolt = stats(await shoot('light-dining-idle'), 0.42, 0.30, 0.58, 0.45).mean;
await evaluate('__sdfGame.forceBolt(-1, 0)');
let peak = 0, frames0 = (await lights()).shadowFrames, shadowRoom = null;
for (let i = 0; i < 6; i++) { await sleep(30); const l = await lights(); if (l.windowIntensity > peak) { peak = l.windowIntensity; shadowRoom = l.shadowRoom ?? shadowRoom; } }
const litFrames = (await lights()).shadowFrames - frames0;
await sleep(900);
const after0 = (await lights()).shadowFrames; await sleep(400); const after1 = (await lights()).shadowFrames;
if (!(peak > 3)) fail(`forced bolt: window light peaked at ${peak.toFixed(2)}`);
if (!(litFrames > 0)) fail('the window light rendered no shadow while lit');
if ((await lights()).windowIntensity === 0 && after1 !== after0) fail(`shadow kept rendering after the flash (${after0} -> ${after1})`);
pass(`lightning: window light peak ${peak.toFixed(2)}, ${litFrames} shadow frames lit (room ${shadowRoom}); idle ${idle1 - idle0}, after ${after1 - after0}`);

// 4. THE STORM IN THE GLASS
// The bolt flickers (spike, dip, restrike): take the brightest of a few captures across it.
await evaluate('__sdfGame.forceBolt(-1, -18)');
let withBolt = 0;
for (let i = 0; i < 4; i++) {
  const m = stats(await shoot(`light-dining-bolt-${i}`), 0.42, 0.30, 0.58, 0.45).mean;
  withBolt = Math.max(withBolt, m);
}
if (!(withBolt > noBolt * 2)) fail(`the glass did not flash: ${noBolt.toFixed(4)} -> ${withBolt.toFixed(4)}`);
pass(`storm glass: mean ${noBolt.toFixed(4)} idle -> ${withBolt.toFixed(4)} with a bolt`);
await evaluate('__sdfGame.setPose(0, -24, 0, 0)');
await sleep(1000);
await evaluate('__sdfGame.forceSweep(1)');
await sleep(500);
await shoot('light-dining-sweep');

// 5. BLACKOUT — the sleeper corridor at C3 (x -1.3, z -45.4).
await evaluate('__sdfGame.setPose(-1.3, -44.0, 0, 0)');
await settle(600);
if (!roomLamps(await lights(), 4).every((x) => x.script === null)) fail('sleeper lamps scripted before the trigger');
await evaluate('__sdfGame.setPose(-1.3, -45.4, 0, 0)');
await sleep(3000);
L = await lights();
if (!roomLamps(L, 4).every((x) => x.script === 'blackout' && x.level === 0)) fail(`sleeper not blacked out: ${JSON.stringify(roomLamps(L, 4))}`);
await shoot('light-sleeper-blackout');
await sleep(6500);
L = await lights();
if (!roomLamps(L, 4).some((x) => x.level > 0)) fail(`sleeper lamps did not come back: ${JSON.stringify(roomLamps(L, 4))}`);
pass('blackout: the sleeper corridor trigger cuts the lamps, and they come back');

// 6. THE PARTY STROBE (a look, not a check beyond the script)
await evaluate('__sdfGame.setPose(0, -61.6, 0, 0)');
await sleep(900);
await shoot('light-party-strobe');
L = await lights();
if (!roomLamps(L, 5).every((x) => x.script === 'strobe')) fail(`party lamps not strobing: ${JSON.stringify(roomLamps(L, 5))}`);
pass('strobe: the party threshold starts the strobe');

console.log('PASS sdf-game-light-gate');
process.exit(0);
