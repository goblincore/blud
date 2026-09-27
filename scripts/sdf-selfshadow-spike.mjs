// scripts/sdf-selfshadow-spike.mjs — look spike for the SDF self-shadow on the dominant key
// (docs/superpowers/specs/2026-09-26-shared-light-list-design.md §6; plan 1 task 1), on Night Train.
// No-deps CDP, same plumbing as scripts/sdf-game-light-gate.mjs (lines 13-139 copied).
//
//   1. Three scenes (tube lit third class, tube lit dining, a held bolt in third class), each
//      framed on the nearest actor, shot with the self-shadow off then on: body-box mean, std
//      and dark share (the "never black" guard).
//   2. COST: timeDraws medians at third class, off/on/off/on.
//
// Usage: node scripts/sdf-selfshadow-spike.mjs <vitePort> <cdpPort>, with LIGHT_GATE_SHOT=<dir>
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const VITE = Number(process.argv[2] ?? 5299);
const CDP = Number(process.argv[3] ?? 9299);
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

const SHOTS = process.env.LIGHT_GATE_SHOT;
/** Tuning runs: SS_ARGS="strength,reach" is passed to setSelfShadow(true, ...) for every "on". */
const ssCall = (on) => `__sdfGame.setSelfShadow(${on ? (process.env.SS_ARGS ? `true, ${process.env.SS_ARGS}` : 'true') : 'false'})`;
if (!SHOTS) fail('set LIGHT_GATE_SHOT to an output directory');
if (!(await boot('level=night-train&frozen&god'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
await evaluate('__sdfGame.setFlashlight(false)');

/** Frame the actor nearest (x,z) from `back` metres in front of it (toward +z), eye height, looking at it. */
async function frameNearest(x, z, back = 2.4) {
  const actors = await evaluate('__sdfGame.actorDump()');
  const a = actors.filter((q) => q.pos).sort((p, q) => Math.hypot(p.pos[0] - x, p.pos[2] - z) - Math.hypot(q.pos[0] - x, q.pos[2] - z))[0];
  if (!a) fail('no actor');
  const cx = a.pos[0], cz = a.pos[2] + back;
  const yaw = Math.atan2(-(a.pos[0] - cx), -(a.pos[2] - cz));
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${yaw}, -0.12)`);
  return a;
}

/** Luminance over the body box, and the share of near-black pixels (the "no black hole" guard). */
function body(img) {
  const s = stats(img, 0.38, 0.2, 0.62, 0.8);
  return { mean: s.mean, std: s.std, dark: s.v.filter((v) => v < 0.04).length / s.v.length };
}

/** On/off per-pixel luminance difference over the body box: the share that darkened / brightened
 *  by more than 0.03 (the shadow's footprint, separated from frame-to-frame noise by the pinned
 *  clocks below). */
function footprint(a, b) {
  const sa = stats(a, 0.38, 0.2, 0.62, 0.8).v, sb = stats(b, 0.38, 0.2, 0.62, 0.8).v;
  let dk = 0, br = 0;
  for (let i = 0; i < sa.length; i++) { const d = sb[i] - sa[i]; if (d < -0.03) dk++; else if (d > 0.03) br++; }
  return { darkened: dk / sa.length, brightened: br / sa.length };
}

// PINNED CLOCKS: the first run (unpinned) differed off/on across the WHOLE frame (the level too,
// which the self-shadow cannot touch): lamp swing, flicker and VHS row noise. Hold them, stop the
// rAF loop and hand-step with dt 0 so off and on render the same scene state.
await evaluate('__sdfGame.setDemoHold(true)');
await evaluate('__sdfGame.setLightClockFrozen(true)');
await evaluate('__sdfGame.setLightTime(0)');

const scenes = [
  { name: 'tube-third', x: 0, z: -17.8, setup: '__sdfGame.holdWindowLight(0, -1)' },
  { name: 'tube-dining', x: 0, z: -37.0, setup: '__sdfGame.holdWindowLight(0, -1)' },
  { name: 'bolt-third', x: 0, z: -17.8, setup: '__sdfGame.holdWindowLight(32, -1)' },
];
const rows = [];
for (const sc of scenes) {
  await evaluate(sc.setup);
  const a = await frameNearest(sc.x, sc.z);
  await evaluate('__sdfGame.step(30)');
  const res = {}, img = {};
  for (const on of [false, true]) {
    await evaluate(ssCall(on));
    await evaluate('__sdfGame.step(12, 0)');
    await settle(300);
    img[on ? 'on' : 'off'] = await shoot(`ss-${sc.name}-${on ? 'on' : 'off'}`);
    res[on ? 'on' : 'off'] = body(img[on ? 'on' : 'off']);
  }
  const fp = footprint(img.off, img.on);
  rows.push({ scene: sc.name, actor: a.id, dist: a.dist, ...res, footprint: fp });
  console.log(`${sc.name}: off mean ${res.off.mean.toFixed(3)} std ${res.off.std.toFixed(3)} dark ${(res.off.dark * 100).toFixed(1)}% | on mean ${res.on.mean.toFixed(3)} std ${res.on.std.toFixed(3)} dark ${(res.on.dark * 100).toFixed(1)}% | darkened ${(fp.darkened * 100).toFixed(1)}% brightened ${(fp.brightened * 100).toFixed(1)}%`);
}

// COST: the worst carriage (third class), A/B in the same frame state. The rAF loop stays stopped
// (step() stopped it), so timeDraws' drawOnce frames are the only frames. timeDraws returns ONE
// number, the median ms of n fenced frames (CPU + GPU); it is noisy (+-2-3 ms here), so the rounds
// interleave off/on and each round also drains the per-pass GPU timestamps and sums the passes
// labelled *march* per frame (the self-shadow runs inside the march).
await evaluate('__sdfGame.holdWindowLight(0, -1)');
await evaluate('__sdfGame.setPose(0, -12.0, 0, -0.05)');
await evaluate('__sdfGame.setFrameCap(1)');
const cost = { off: [], on: [], marchOff: [], marchOn: [] };
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
for (let round = 0; round < 8; round++) {
  for (const on of [false, true]) {
    await evaluate(ssCall(on));
    await evaluate('__sdfGame.step(3, 0)');
    await evaluate('__sdfGame.timeDraws(3)');
    await evaluate('__sdfGame.passTimings()');
    cost[on ? 'on' : 'off'].push(await evaluate('__sdfGame.timeDraws(9)'));
    const pt = await evaluate('__sdfGame.passTimings()');
    const per = {};
    for (const x of pt?.samples ?? []) if (/march/.test(x.label)) per[x.frame] = (per[x.frame] ?? 0) + x.ms;
    const frames = Object.values(per);
    if (frames.length) cost[on ? 'marchOn' : 'marchOff'].push(med(frames));
  }
}
cost.median = { off: med(cost.off), on: med(cost.on), marchOff: cost.marchOff.length ? med(cost.marchOff) : null, marchOn: cost.marchOn.length ? med(cost.marchOn) : null };
console.log(`COST median frame off ${cost.median.off.toFixed(2)} on ${cost.median.on.toFixed(2)} (delta ${(cost.median.on - cost.median.off).toFixed(2)} ms) | march GPU off ${cost.median.marchOff?.toFixed(2)} on ${cost.median.marchOn?.toFixed(2)}`);
console.log('COST', JSON.stringify(cost));
writeFileSync(`${SHOTS}/selfshadow-spike.json`, JSON.stringify({ rows, cost }, null, 2));
console.log('tuning', JSON.stringify(await evaluate(ssCall(true))));
console.log('DONE sdf-selfshadow-spike');
process.exit(0);
