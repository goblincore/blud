// scripts/sdf-game-train-gate.mjs — headless gate for the train carriage kit
// (spec docs/superpowers/specs/2026-09-25-train-carriage-kit-design.md §7).
// No-deps CDP, same plumbing as scripts/sdf-game-art-gate.mjs.
//
//   1. BOOT: night-train with its art, window glass and swaying pieces.
//   2. WINDOWS: a dining-car window shows scenery that moves (two frames differ) and is not flat.
//   3. SWAY: the camera roll varies over 2 s.
//   4. WALK: an autopilot walk visits every room of the approved layout, van to cab.
//   5. COST: art off/on A/B at three poses (draw calls, fenced frame time); BUDGET.
//
// Usage: LAB_VITE_PORT=5295 LAB_CDP_PORT=9295 node scripts/sdf-game-train-gate.mjs
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5295);
const CDP = Number(process.argv[3] ?? 9295);
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

/** Cost of the train's art over its art-less (empty) shell, worst pose. Owner-approved: +175 /
 *  +10 ms (2026-09-25, four carriages); +200 draws (five carriages); raised to +350 draws /
 *  +12 ms for art v2 (2026-09-26; measured +229..+332, +8.7..+11.4 ms at load ~20). Optimise
 *  later: no shadows on small dressing, then one draw per piece (texture atlas). */
const BUDGET = { drawCalls: 350, frameMs: 12 };
const stats = (img, fx0, fy0, fx1, fy1) => {
  const { w, h, ch, data } = img; const v = [];
  for (let y = Math.floor(fy0 * h); y < Math.floor(fy1 * h); y++) for (let x = Math.floor(fx0 * w); x < Math.floor(fx1 * w); x++) {
    const i = (y * w + x) * ch; v.push((data[i] + data[i + 1] + data[i + 2]) / 765);
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { v, mean, std: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) };
};

// 1. BOOT
if (!(await boot('level=night-train&frozen'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
const art = await evaluate('__sdfGame.artInfo()'), train = await evaluate('__sdfGame.train()');
if (!art || art.meshes < 1) fail(`no art: ${JSON.stringify(art)}`);
if (!train || train.windows < 1 || train.swaying < 1) fail(`train runtime: ${JSON.stringify(train)}`);
pass(`boot: ${art.meshes} art meshes (${art.instanced} instanced, ${art.instances} instances), ${train.windows} window meshes, ${train.swaying} swaying`);
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.freeze(true)');

// 2. WINDOWS — the first dining-car bay's west window (wall x -2.1; z -38.35 .. -37.25, y 1.05 .. 1.85).
await evaluate(`__sdfGame.setPose(-0.4, -37.8, ${-Math.PI / 2}, -0.05)`);
await sleep(1000);
const a = await shoot('train-window-a'); await sleep(500); const b = await shoot('train-window-b');
const sa = stats(a, 0.42, 0.30, 0.58, 0.45), sb = stats(b, 0.42, 0.30, 0.58, 0.45);
const diff = sa.v.reduce((acc, x, i) => acc + Math.abs(x - sb.v[i]), 0) / sa.v.length;
if (!(diff > 0.004)) fail(`window scenery does not move (mean abs diff ${diff.toFixed(4)})`);
if (!(Math.max(sa.std, sb.std) > 0.01)) fail(`window scenery is flat (std ${sa.std.toFixed(4)})`);
pass(`windows: scenery moves (diff ${diff.toFixed(4)}) and has structure (std ${sa.std.toFixed(4)})`);

// 3. SWAY
const rolls = [];
for (let i = 0; i < 10; i++) { rolls.push((await evaluate('__sdfGame.train()')).roll); await sleep(200); }
const span = Math.max(...rolls) - Math.min(...rolls);
if (!(span > 0.002)) fail(`camera roll does not vary (${span.toFixed(4)} rad)`);
pass(`sway: roll spans ${span.toFixed(4)} rad over 2 s`);

// 4. WALK — room by room through the approved layout (docs/game/levels/01-night-train/layout.md),
// Its own boot with ?nospawn: bodies block the player, and this checks the layout, not the fights.
const ROUTE = [
  ['baggage hold', -0.2, -2.5], ['hold door (west)', -1.0, -5.55], ['mail cage', -0.3, -8.0],
  ['cage door (east)', 1.0, -10.55], ['guard\'s office', 0.0, -12.5], ['vestibule 1', 0, -16.6],
  ['third class, south', 0, -20.0], ['third class, middle', 0, -26.0], ['third class, north', 0, -33.0], ['vestibule 2', 0, -35.8],
  ['dining saloon', 0, -41.2], ['lounge, west lane', -1.35, -48.9], ['galley door', -1.3, -51.85],
  ['galley', -1.0, -52.6], ['vestibule 3', 0, -55.0],
  ['coats, south', 1.2, -57.6], ['coats, past rack 1', 1.2, -59.6], ['coats, rack 2 gap', -1.2, -61.1], ['coats, west lane', -1.2, -62.4],
  ['coats, rack 3 gap', 1.2, -63.8], ['coats, before the counter', 1.2, -65.5], ['coats, past the counter', 1.2, -66.8], ['the counter\'s back', 0, -68.5],
  ['vestibule 4', 0, -70.2], ['sleeper south lobby', 0, -71.7], ['sleeper corridor', -1.3, -74.4], ['corridor at C3', -1.3, -79.86],
  ['inside C3', 0.4, -79.86], ['back in the corridor', -1.3, -79.86], ['sleeper north lobby', -0.2, -88.0], ['vestibule 5', 0, -89.4],
  ['boiler room, south', 0, -91.9], ['boiler room, west of the pillars', -1.7, -96.4], ['boiler room, by the pistons', -0.9, -104.9],
  ['boiler room, north', 0, -109.2], ['vestibule 6', 0, -110.6], ['tender, south', 0.9, -113.5], ['tender, north', 0.9, -119.5],
  ['vestibule 7', 0, -121.8], ['cab', 0, -126.0],
];
if (!(await boot('level=night-train&frozen&nospawn'))) { console.error(consoleEvents.slice(-8)); fail('night-train (nospawn) did not boot'); }
await evaluate('__sdfGame.setPose(0, -1, 0, 0)');
for (const [name, x, z] of ROUTE) {
  await evaluate(`__sdfGame.walkTo(${x}, ${z})`);
  let d = Infinity;
  for (let i = 0; i < 40 && d > 0.8; i++) {
    await sleep(250);
    const p = (await evaluate('__sdfGame.pose()')).pos;
    d = Math.hypot(p[0] - x, p[2] - z);
  }
  await evaluate('__sdfGame.walkCancel()');
  if (d > 0.8) fail(`walk: stuck before ${name} (${d.toFixed(2)} m short) at ${JSON.stringify((await evaluate('__sdfGame.pose()')).pos.map((v) => +v.toFixed(2)))}`);
}
if ((await evaluate('__sdfGame.room()')) !== 'cab') fail('walk ended outside the cab');
pass(`walk: ${ROUTE.length} waypoints, every room from the baggage hold to the cab`);

// 5. COST
const POSES = { office: [0, -11, 0, 0], third: [0, -18, 0, 0], dining: [0, -37.2, 0, 0], coats: [1.2, -57, 0, 0], sleeper: [-1.3, -72.4, 0, 0], boiler: [0, -90.9, 0, 0] };
if (!(await boot('level=night-train&frozen'))) fail('night-train did not re-boot for the cost');
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.setFrameCap(1)');
const med = (x) => [...x].sort((p, q) => p - q)[x.length >> 1];
async function sample(on) {
  await evaluate(`__sdfGame.setArtVisible(${on})`);
  await evaluate('__sdfGame.timeDraws(2)');
  await evaluate('__sdfGame.drawStats(true)');
  await evaluate('__sdfGame.timeDraws(1)');
  const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
  return { drawCalls, frameMs: await evaluate('__sdfGame.timeDraws(9)') };
}
console.log('pose     draw calls (no art -> art)   frame ms (no art -> art, median of 5 A/B rounds)');
const over = [];
for (const [name, p] of Object.entries(POSES)) {
  await evaluate(`__sdfGame.setPose(${p.join(',')})`);
  await sleep(800);
  const offs = [], ons = [];
  for (let k = 0; k < 5; k++) { offs.push(await sample(false)); ons.push(await sample(true)); }
  const bOff = { drawCalls: med(offs.map((x) => x.drawCalls)), frameMs: med(offs.map((x) => x.frameMs)) };
  const aOn = { drawCalls: med(ons.map((x) => x.drawCalls)), frameMs: med(ons.map((x) => x.frameMs)) };
  const dMs = med(ons.map((x, i) => x.frameMs - offs[i].frameMs));
  console.log(`${name.padEnd(8)} ${String(bOff.drawCalls).padStart(5)} -> ${String(aOn.drawCalls).padEnd(20)} ${bOff.frameMs.toFixed(2).padStart(6)} -> ${aOn.frameMs.toFixed(2)}  (paired +${dMs.toFixed(2)})`);
  if (aOn.drawCalls - bOff.drawCalls > BUDGET.drawCalls) over.push(`${name}: draw calls +${aOn.drawCalls - bOff.drawCalls} > +${BUDGET.drawCalls}`);
  if (dMs > BUDGET.frameMs) over.push(`${name}: frame +${dMs.toFixed(2)} ms > +${BUDGET.frameMs} ms`);
  await shoot(`train-${name}`);
}
await evaluate('__sdfGame.setFrameCap(30)');
if (over.length) fail(`over budget: ${over.join('; ')}`);
pass(`cost: inside budget (+${BUDGET.drawCalls} draws, +${BUDGET.frameMs} ms)`);

console.log('PASS sdf-game-train-gate');
process.exit(0);
