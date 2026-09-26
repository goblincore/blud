// scripts/sdf-game-loop-gate.mjs — headless gate for the game loop
// (docs/superpowers/plans/2026-09-26-game-loop.md), on Night Train.
// No-deps CDP, same plumbing as scripts/sdf-game-train-gate.mjs.
//
//   1. LOADOUT: the level starts without the shotgun; it can't fire.
//   2. PICKUPS: standing on the sawn-off collects it loaded (2 | 4); office shells add 8.
//   3. DAMAGE: seam damage; a live zombie in reach bites.
//   4. DEATH: health 0 shows the overlay.
//   5. COMPLETE: reaching the firebox in the cab ends the level.
//
// Usage: LAB_VITE_PORT=5296 LAB_CDP_PORT=9296 node scripts/sdf-game-loop-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5296);
const CDP = Number(process.argv[3] ?? 9296);
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
const SHOT_OUT = process.env.TRAIN_GATE_SHOT;

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

// 1. LOADOUT
if (!(await boot('level=night-train&frozen&nospawn'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
let inv = await evaluate('__sdfGame.inventory()');
if (!inv || inv.weapons.includes('shotgun')) fail(`started with the shotgun: ${JSON.stringify(inv)}`);
if (await evaluate('__sdfGame.fire()')) fail('fired a shotgun the player has not found');
pass(`loadout: starts with ${JSON.stringify(inv.weapons)}, cannot fire`);

// 2. PICKUPS — the sawn-off on the hold's east trunk stack (x 1.4, z -2.9); office shells (x -1.4, z -12.8).
await evaluate('__sdfGame.setPose(1.3, -2.9, 0, 0)');
await settle();
inv = await evaluate('__sdfGame.inventory()');
if (!inv.weapons.includes('shotgun') || inv.shells !== 2 || inv.shellsReserve !== 4) fail(`sawn-off pickup: ${JSON.stringify(inv)}`);
await evaluate('__sdfGame.setPose(-0.9, -12.8, 0, 0)');
await settle();
inv = await evaluate('__sdfGame.inventory()');
if (inv.shellsReserve !== 12) fail(`office shells: reserve ${inv.shellsReserve}, expected 12`);
pass(`pickups: sawn-off loaded 2 | 4, office shells -> reserve ${inv.shellsReserve}`);

// 3. DAMAGE — the seam; then a real bite from the baggage hold's trunk zombie, AI running.
if ((await evaluate('__sdfGame.damagePlayer(30, "pellet")')).health !== 70) fail('30 damage did not leave 70 health');
if (!(await boot('level=night-train'))) fail('night-train (with spawns) did not boot');
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.freeze(false)');
await evaluate('__sdfGame.setPose(1.05, -3.75, 3.1416, 0)');
let bitten = 100;
for (let i = 0; i < 20 && bitten === 100; i++) { await sleep(250); bitten = (await evaluate('__sdfGame.vitals()')).health; }
if (!(bitten < 100)) fail('standing beside the trunk zombie for 5 s drew no bite');
pass(`damage: seam 30 -> 70; a zombie in reach bites (health ${bitten})`);

// 4. DEATH
await evaluate('__sdfGame.damagePlayer(500, "pellet")');
if (!(await evaluate('__sdfGame.vitals().dead'))) fail('500 damage did not kill');
const shown = await evaluate(`[...document.querySelectorAll('div')].some((d) => d.textContent.startsWith('YOU DIED') && getComputedStyle(d).display === 'grid')`);
if (!shown) fail('death overlay not shown');
pass('death: health 0 shows YOU DIED');

// 5. COMPLETE — reaching the firebox in the cab (the `level.end` trigger, z -126.9 .. -128.9).
if (!(await boot('level=night-train&frozen&nospawn&god'))) fail('night-train (god) did not boot');
await evaluate('__sdfGame.setPose(0, -127.9, 0, 0)');
await settle();
if (!(await evaluate('__sdfGame.levelComplete()'))) fail('reaching the firebox did not complete the level');
pass('complete: reaching the firebox ends the level');

console.log('PASS sdf-game-loop-gate');
process.exit(0);
