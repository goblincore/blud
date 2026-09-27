// scripts/sdf-disco-check.mjs — headless check for the Boiler Room disco ball
// (docs/superpowers/specs/2026-09-27-disco-ball-design.md §5), on Night Train. Its own script and
// port pair so it never collides with the light gate. No-deps CDP, the light gate's plumbing.
//
//   1. PARTY: before the threshold, the ball wears the mirror tiles (`train.disco-tiles`), its
//      DISCO.count stars are drawn (late scene, visible) and every one lands on a face of room 5's
//      box; the light on the ball is party white.
//   2. STROBE: through the strobe the stars follow the lamps (a flash at 1.3, dark in the gaps).
//   3. AFTER: once the strobe has killed the lamps the light is the beacons' red, and its intensity
//      varies over a turn of the beams (a pulse as each beam passes the ball).
//   4. AWAY: in another carriage the star mesh is hidden.
//   5. COST: Boiler Room frame median with the stars on vs off (setDiscoStars, measurement only),
//      interleaved rounds, report-only (WARN over +1.0 ms), with the 1-min load average.
//
// DISCO_SHEET=<png> writes the owner contact sheet (party, then two beacon angles after the strobe);
// DISCO_SHOTS=<dir> keeps the single frames. DISCO_SKIP_COST=1 skips section 5.
// Usage: scripts/sdf-disco-check.sh (own servers on 5367/9367), or node scripts/sdf-disco-check.mjs <vite> <cdp>.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';

const T0 = Date.now();
const VITE = Number(process.argv[2] ?? 5367);
const CDP = Number(process.argv[3] ?? 9367);
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
const evaluate = async (expression, ms = 30000) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms,
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

const SHOTS = process.env.DISCO_SHOTS;
const SHEET = process.env.DISCO_SHEET;
const shotDir = SHOTS ?? (SHEET ? join(process.env.LAB_TMP ?? '/tmp', 'disco-shots') : null);
if (shotDir) mkdirSync(shotDir, { recursive: true });
const shots = [];
const shoot = async (name, label) => {
  if (!shotDir) return;
  await evaluate('__sdfGame.timeDraws(2)');
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  const file = join(shotDir, `${name}.png`);
  writeFileSync(file, png);
  shots.push({ file, label });
};
const stepN = (n, dt) => evaluate(`__sdfGame.step(${n}${dt === undefined ? '' : `, ${dt}`})`, 300000);
const disco = () => evaluate('__sdfGame.disco()');
const lights = () => evaluate('__sdfGame.lights()');
const roomLamps = (l, room) => l.lamps.filter((x) => x.room === room && x.mood !== 'fire' && !x.beacon);
const f3 = (v) => v.map((x) => x.toFixed(3)).join(',');
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };

// The Boiler Room (room 5: x -2.1..2.1, z -90..-110, h 3.4); the threshold trigger is z -95.5..-96.5,
// the ball hangs at z -100. The view: from near the vestibule door, looking down the room past the
// ball (yaw 0 faces -z), tipped up a little so the ceiling and both walls are in frame.
const VIEW_BEFORE = '0.9, -95.1, -0.12, 0.12';   // just short of the threshold
const VIEW_AFTER = '0.9, -97.0, -0.12, 0.12';

const q = 'level=night-train&frozen&nospawn&god';
if (!(await boot(q))) { console.error(consoleEvents.slice(-8)); fail(`night-train did not boot (${q})`); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
for (const c of ['setFlashlight(false)', 'setDemoHold(true)', 'holdWindowLight(0, -1)', 'setLightClockFrozen(true)', 'setLightTime(0)']) await evaluate(`__sdfGame.${c}`);

// 1. PARTY.
await evaluate(`__sdfGame.setPose(${VIEW_BEFORE})`);
await sleep(3000);   // the first step at a new pose compiles
// Again: a cold first boot once read the stars hidden here (the free-running loop had the player
// elsewhere when the steps began); setting the pose right before the hand steps pins it.
await evaluate(`__sdfGame.setPose(${VIEW_BEFORE})`);
await stepN(6);
let D = await disco();
if (!D) fail('no disco() seam / no ball on night-train');
if (D.room !== 5) fail(`ball in room ${D.room}, not the Boiler Room`);
if (D.material !== 'train.disco-tiles') fail(`ball material ${D.material}, not the mirror tiles`);
if (!D.inLateScene) fail('the star mesh is not in the late scene');
if (!D.visible || D.count !== 96) fail(`party: stars not drawn: ${JSON.stringify(D)} pose ${JSON.stringify(await evaluate("__sdfGame.pose()"))} key ${await evaluate("__sdfGame.room()")}`);
if (D.onBox !== D.count) fail(`party: ${D.count - D.onBox} stars off room 5's box: ${JSON.stringify(D)}`);
if (!(D.intensity > 0.5 && D.rgb[0] > 0.9 && D.rgb[1] > 0.85 && D.rgb[2] > 0.75)) fail(`party: not white: rgb ${f3(D.rgb)} intensity ${D.intensity}`);
pass(`party: ball ${D.material} at ${D.centre}; ${D.count} stars, all ${D.onBox} on room 5's faces, late scene; light rgb ${f3(D.rgb)} x ${D.intensity.toFixed(2)}`);
await shoot('1-party', 'party (before the strobe): white');

// 2. STROBE: cross the threshold.
await evaluate('__sdfGame.setPose(0, -96.0, 0, 0)');
await stepN(4);
let L = await lights();
const lamps5 = roomLamps(L, 5);
if (!lamps5.every((x) => x.script === 'strobe')) fail(`strobe not started: ${JSON.stringify(lamps5)}`);
const at = lamps5[0].scriptAt;
const probe = async (t) => { await evaluate(`__sdfGame.setLightTime(${t})`); await stepN(1, 0); return disco(); };
const flash = await probe(at + 0.5 + 0.01);    // strobe slot 0: lamps at 1.3
const gap = await probe(at + 0.5 + 0.07);      // slot 1: dark
if (!(flash.intensity > 1.2 && flash.rgb[1] > 0.85)) fail(`strobe: no white flash (${f3(flash.rgb)} x ${flash.intensity})`);
if (!(gap.intensity < 0.05)) fail(`strobe: stars lit in the strobe gap (${gap.intensity})`);
pass(`strobe: flash ${flash.intensity.toFixed(2)} (rgb ${f3(flash.rgb)}), gap ${gap.intensity.toFixed(3)}`);

// 3. AFTER: sweep a full turn of the beams (0.7 rev/s) in 48ths.
await evaluate(`__sdfGame.setPose(${VIEW_AFTER})`);
await sleep(1500);
const T1 = at + 5.0, TURN = 1 / 0.7;
const sweep = [];
for (let k = 0; k < 48; k++) {
  const d = await probe(T1 + (k / 48) * TURN);
  sweep.push({ t: T1 + (k / 48) * TURN, i: d.intensity, rgb: d.rgb, visible: d.visible, count: d.count });
}
const lit = sweep.filter((s) => s.i > 0.1);
if (!lit.length) fail(`after: the stars never lit over a turn: ${sweep.map((s) => s.i.toFixed(2)).join(' ')}`);
if (!lit.every((s) => s.rgb[0] > 0.9 && s.rgb[1] < 0.2 && s.rgb[2] < 0.2)) fail(`after: not red: ${JSON.stringify(lit.slice(0, 3))}`);
const hi = sweep.reduce((a, b) => (b.i > a.i ? b : a)), lo = sweep.reduce((a, b) => (b.i < a.i ? b : a));
if (!(hi.i - lo.i > 0.5)) fail(`after: intensity does not pulse over the sweep (${lo.i.toFixed(2)}..${hi.i.toFixed(2)})`);
L = await lights();
if (!roomLamps(L, 5).every((x) => x.level === 0)) fail('after: the Boiler Room lamps are still lit');
pass(`after: red (rgb ${f3(hi.rgb)}), intensity ${lo.i.toFixed(2)}..${hi.i.toFixed(2)} over a turn, lit in ${lit.length}/48 samples: ${sweep.map((s) => s.i.toFixed(1)).join(' ')}`);
// The sheet: the beam on the ball, and between passes (the pulse's trough).
const mid = lo;
await probe(hi.t);
await shoot('2-after-hit', `after the strobe: a beam on the ball (x ${hi.i.toFixed(2)})`);
await probe(mid.t);
await shoot('3-after-between', `after the strobe: between passes (x ${mid.i.toFixed(2)})`);

// 4. AWAY: third class (room 2) hides the stars.
await evaluate('__sdfGame.setPose(0, -26.0, 0, 0)');
await stepN(2, 0);
D = await disco();
if (D.visible) fail('away: the stars draw from third class');
pass('away: hidden from third class');

// 5. COST.
if (!process.env.DISCO_SKIP_COST) {
  const ROUNDS = Number(process.env.DISCO_COST_ROUNDS ?? 8), FRAMES = 9;
  await evaluate(`__sdfGame.setPose(${VIEW_AFTER})`);
  await probe(hi.t);
  await sleep(1000);
  const load = loadavg()[0];
  const s = { on: [], off: [] };
  const frames = () => evaluate(`(async () => { const out = []; for (let i = 0; i < ${FRAMES}; i++) { const t0 = performance.now(); __sdfGame.step(1, 0); await __sdfGame.resolveGpu(); out.push(performance.now() - t0); } return out; })()`, 120000);
  for (let round = 0; round < ROUNDS; round++) {
    for (const on of round % 2 ? [true, false] : [false, true]) {
      await evaluate(`__sdfGame.setDiscoStars(${on})`);
      await stepN(2, 0);
      const fr = await frames();
      s[on ? 'on' : 'off'].push(median(fr));
    }
  }
  await evaluate('__sdfGame.setDiscoStars(true)');
  const on = median(s.on), off = median(s.off);
  const deltas = s.on.map((v, i) => v - s.off[i]);
  const msg = `cost (report-only, load ${load.toFixed(2)}): Boiler Room after the strobe, stars off ${off.toFixed(2)} -> on ${on.toFixed(2)} ms = ${(on - off >= 0 ? '+' : '')}${(on - off).toFixed(2)} ms (rounds ${Math.min(...deltas).toFixed(2)}..${Math.max(...deltas).toFixed(2)})`;
  if (on - off > 1.0) console.log(`WARN ${msg}`); else pass(msg);
}

const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors: ${JSON.stringify(errs.slice(0, 4))}`);

if (SHEET && shots.length) {
  mkdirSync(dirname(SHEET), { recursive: true });
  const py = `
import sys
from PIL import Image, ImageDraw
files = sys.argv[2::2]; labels = sys.argv[3::2]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size; bar = 28
sheet = Image.new('RGB', (w * len(ims), h + bar), (16, 16, 16))
d = ImageDraw.Draw(sheet)
for i, (im, lab) in enumerate(zip(ims, labels)):
    sheet.paste(im, (i * w, bar))
    d.text((i * w + 8, 8), lab, fill=(235, 235, 235))
sheet.save(sys.argv[1])
`;
  execFileSync('python3', ['-c', py, SHEET, ...shots.flatMap((x) => [x.file, x.label])], { stdio: 'inherit' });
  console.log(`sheet: ${SHEET}`);
}
console.log(`PASS sdf-disco-check (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
process.exit(0);
