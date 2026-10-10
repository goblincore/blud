// scripts/sdf-strobe-burst-capture.mjs — the Boiler Room's cold flash bursts after the opening strobe (lamp-moods.ts afterglow).
// Frames: pure red before the first burst, then flashes and the gaps between them. BURST_SHEET=<png> (required).
// Usage: scripts/sdf-strobe-burst-capture.sh, or node scripts/sdf-strobe-burst-capture.mjs <vite> <cdp>.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';

const T0 = Date.now();
const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
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
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}${process.env.LIGHT_LAYERS ? `&layers=${process.env.LIGHT_LAYERS}` : ''}` });
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

const SHEET = process.env.BURST_SHEET;
if (!SHEET) fail('set BURST_SHEET=<png>');
const shotDir = join(process.env.LAB_TMP ?? '/tmp', 'strobe-burst-shots');
mkdirSync(shotDir, { recursive: true });
const shots = [];
const shoot = async (name, label) => {
  await evaluate('__sdfGame.timeDraws(2)');
  const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64');
  const file = join(shotDir, `${name}.png`);
  writeFileSync(file, png);
  shots.push({ file, label });
};
const stepN = (n, dt) => evaluate(`__sdfGame.step(${n}${dt === undefined ? '' : `, ${dt}`})`, 300000);
const lights = () => evaluate('__sdfGame.lights()');
const roomLamps = (l, room) => l.lamps.filter((x) => x.room === room && x.mood !== 'fire' && !x.beacon);
const lampsAt = async (t) => { await evaluate(`__sdfGame.setLightTime(${t})`); await stepN(1, 0); return roomLamps(await lights(), 5).map((x) => x.level); };

if (!(await boot(process.env.BURST_QUERY ?? 'level=night-train&frozen&nospawn&god'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
for (const c of ['setFlashlight(false)', 'setDemoHold(true)', 'setTrainSpeed(0)', 'holdWindowLight(0, -1)', 'setLightClockFrozen(true)', 'setLightTime(0)']) await evaluate(`__sdfGame.${c}`);
await evaluate('__sdfGame.setPose(0.9, -95.1, -0.12, 0.12)');
await sleep(3000); await stepN(6);
await evaluate('__sdfGame.setPose(0, -96.0, 0, 0)');   // inside the trigger (z -95.5..-96.5): the strobe arms
await stepN(4);
await evaluate('__sdfGame.setPose(0.9, -97.0, -0.12, 0.12)');
const at = roomLamps(await lights(), 5)[0].scriptAt;
const strobeEnd = at + 0.5 + 3;
// Before the first burst: pure red.
const quiet = await lampsAt(strobeEnd + 2.0);
if (quiet.some((v) => v !== 0)) fail(`lamps lit before the burst delay: ${quiet}`);
await shoot('red-only', 'before the first burst: beacons only');
// Scan for the first flash (20 ms steps) and its bounds.
let t = strobeEnd + 3.5, first = null;
for (; t < strobeEnd + 14; t += 0.01) {
  const lv = await lampsAt(t);
  if (lv.some((v) => v > 0)) { first = t; break; }
}
if (first === null) fail('no burst in 10 s after the delay');
await shoot('flash-1', `burst flash 1 (t+${(first - strobeEnd).toFixed(2)} s after the strobe)`);
await lampsAt(first + 0.07 + 0.03);
await shoot('gap', 'between flashes: beacons only');
await lampsAt(first + 0.13 + 0.03);
await shoot('flash-2', 'burst flash 2');
const levels = await lampsAt(first + 0.13 + 0.03);
console.log(`first burst at t+${(first - strobeEnd).toFixed(2)} s after the strobe; lamp levels at flash 2: ${levels.map((v) => v.toFixed(2))}`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors: ${JSON.stringify(errs.slice(0, 4))}`);
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
console.log(`PASS sdf-strobe-burst-capture (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
process.exit(0);
