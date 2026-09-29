// scripts/sdf-armor-light-capture.mjs — how the soldier's polygon armour reads in the Boiler Room after the strobe (red beacons
// only, torch off), at several kit-environment scales (__sdfGame.setKitEnv). The armour is lit by a fixed studio environment
// map, so this shows what that map is doing to it. ARMOR_SHEET=<png> (required); ARMOR_ENV=1,0.3,0 the scales;
// ARMOR_TORCH=1 also shoots with the torch lit. Usage: scripts/sdf-armor-light-capture.sh, or node ... <vite> <cdp>.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';

const T0 = Date.now();
const VITE = Number(process.argv[2] ?? 5381);
const CDP = Number(process.argv[3] ?? 9381);
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

const SHEET = process.env.ARMOR_SHEET;
if (!SHEET) fail('set ARMOR_SHEET=<png>');
const VALUES = (process.env.ARMOR_ENV ?? '1,0.3,0').split(',').map(Number);
const shotDir = join(process.env.LAB_TMP ?? '/tmp', 'armor-light-shots');
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

const DANCER = [0.9, -100.6];   // 3.6 m past the z -97 beacon (the light gate's BEACON_DANCER)
if (!(await boot('level=night-train&frozen&god'))) { console.error(consoleEvents.slice(-8)); fail('night-train did not boot'); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
for (const c of ['setFlashlight(false)', 'setDemoHold(true)', 'setTrainSpeed(0)', 'holdWindowLight(0, -1)', 'setLightClockFrozen(true)', 'setLightTime(0)']) await evaluate(`__sdfGame.${c}`);
await evaluate('__sdfGame.setPose(0, -92.0, 0, 0)');
await sleep(3000); await stepN(6);
await evaluate('__sdfGame.setPose(0, -96.0, 0, 0)');   // the strobe arms the beacons
await stepN(4);
const at = roomLamps(await lights(), 5)[0].scriptAt;
const kit = await evaluate('__sdfGame.kitActors()');
const sol = kit.find((k) => k.name === 'soldier' && k.kit);
if (!sol) fail(`no loaded soldier kit: ${JSON.stringify(kit)}`);
const dancerId = sol.id;
const zs0 = await evaluate('__sdfGame.zombies()');
const me = zs0.find((z) => z.id === dancerId);
await evaluate(`__sdfGame.zombieNudge(${dancerId}, ${DANCER[0] - me.pos[0]}, ${DANCER[1] - me.pos[2]})`);
async function frame() {
  const a = (await evaluate('__sdfGame.zombies()')).find((z) => z.id === dancerId);
  const cx = a.pos[0], cz = a.pos[2] + 2.4;
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${Math.atan2(-(a.pos[0] - cx), -(a.pos[2] - cz))}, -0.12)`);
}
/** Sweep the pinned clock forward from `t0` a sixteenth of a turn at a time until the dancer picks a beacon. */
async function faceBeam(t0) {
  for (let k = 0; k < 16; k++) {
    const t = t0 + k / 16 / 0.7;
    await evaluate(`__sdfGame.setLightTime(${t})`);
    await frame(); await stepN(2, 0);
    const [LL, pk] = [await evaluate('__sdfGame.lightList()'), await evaluate('__sdfGame.bodyPicks()')];
    const p = pk.find((q) => q.id === dancerId);
    if (p?.picks.some((q) => q.index >= 0 && LL[q.index]?.profile === 'beacon')) return t;
  }
  fail('the dancer never picked a beacon');
}
await evaluate(`__sdfGame.setLightTime(${at + 4.0})`); await stepN(12, 0);
let t = await faceBeam(at + 4.0);
await evaluate('__sdfGame.setViewModelVisible(false)');
const shootEnvs = async (tag) => {
  for (const v of VALUES) {
    await evaluate(`__sdfGame.setKitEnv(${v})`);
    await stepN(2, 0);
    await shoot(`${tag}-env-${v}`, `${tag}, kit env x${v}`);
  }
};
await shootEnvs('torch off');
if (process.env.ARMOR_TORCH) {
  await evaluate('__sdfGame.setLightClockFrozen(false)');
  await evaluate('__sdfGame.setFlashlight(true)');
  await stepN(30);
  await evaluate('__sdfGame.setLightClockFrozen(true)'); await stepN(2);
  t = await faceBeam((await lights()).time);
  await shootEnvs('torch on');
}
await evaluate('__sdfGame.setKitEnv(1)');
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
console.log(`PASS sdf-beacon-torch-capture (wall ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
process.exit(0);
