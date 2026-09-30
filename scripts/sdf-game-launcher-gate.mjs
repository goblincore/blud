// Opt-in launcher FPV cycle/visual gate. Own tab, bounded CDP, warm-ready required.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { waitForLoader } from './lib/wait-loader.mjs';

const VITE = Number(process.argv[2] ?? 5294);
const CDP = Number(process.argv[3] ?? 9294);
const OUT = process.env.GAME_OUT ?? 'docs/dev-notes/2026-09-29-grenade-launcher/runtime';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const sendRaw = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const send = (method, params = {}) => withTimeout(sendRaw(method, params), 30000, method);
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}

mkdirSync(OUT, { recursive: true });
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  shotCount++;
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?launcher=1&god&seed=20260929${process.env.LAUNCHER_CLEAN === '1' ? '&vhs=off' : ''}`;
console.log(`game ${url}`);
await send('Page.navigate', { url });
await waitForLoader(evaluate, { timeoutSec: 300, settleMs: 500 });
const warm = await evaluate('window.__warmGate');
if (warm?.phase !== 'ready') fail(`warm gate ${JSON.stringify(warm)}`);
for (const panel of ['woundPanel','gooPanel','vhsPanel','lightLayersPanel','dynamitePanel','shutterPanel']) await evaluate(`__sdfGame.${panel}?.(false)`);
await evaluate('__sdfGame.setLoopRunning(false)');
// Freeze AI/light clocks and use accepted camera, lens and default FPV rendering.
await evaluate('__sdfGame.freeze(true); __sdfGame.setLightClockFrozen?.(true)');
await evaluate('__sdfGame.step(2, 1/60)');
if (!(await evaluate('__sdfGame.launcher()?.ready'))) fail('launcher not loaded/ready');
const timing = await evaluate('__sdfGame.launcher().timing');
const report = { width: W, height: H, timing, warm, warmDone: await evaluate('__sdfGame.warmDone()'), errors: [], samples: [] };
async function sample(name) {
  const d = await evaluate('__sdfGame.launcher()');
  report.samples.push({ name, ...d });
  await shot(name);
  return d;
}
await sample('fpv-idle');
if (!(await evaluate('__sdfGame.fireLauncher()'))) fail('first fire refused');
if (await evaluate('__sdfGame.fireLauncher()')) fail('second fire accepted before cycling');
await evaluate('__sdfGame.step(3, .015)');
const kick = await sample('fpv-fire-045');
if (!kick.flash || kick.loaded || kick.shots !== 1) fail('fire envelope/magazine wrong');
let elapsed = .045;
for (const [name,reloadAge] of [['unlock',.15],['open',.49],['extract',.57],['eject',.68],['carry',1.07],['stage',1.22],['seat',1.43],['snap',1.65],['settled',1.89]]) {
  const target = timing.fireLeadSec + reloadAge;
  const dt = target - elapsed;
  const n = Math.ceil(dt / (1/60));
  await evaluate(`__sdfGame.step(${n},${dt/n})`);
  elapsed = target;
  const d = await sample(`fpv-${name}`);
  if (reloadAge <= timing.ejectSec && !(d.forestockDistanceM < 1e-6)) fail('support hand left the forestock during opening/extraction');
  if (name === 'open' && d.hingeRad < .94) fail('action did not open 55 degrees');
  if (name === 'eject' && !d.ejectedCase) fail('spent case absent');
  if (name === 'carry' && !d.carriedRound) fail('fresh round absent');
  if (name === 'settled' && (!d.ready || d.hingeRad !== 0)) fail('did not return shut/loaded');
}
if (!(await evaluate('__sdfGame.reloadLauncher()'))) fail('manual reload refused');
await evaluate(`__sdfGame.step(${Math.ceil((timing.reloadSec + .15)*60)}, 1/60)`);
if (!(await evaluate('__sdfGame.launcher().ready'))) fail('manual reload failed');
if (!(await evaluate('__sdfGame.selectSlot("shotgun").ok'))) fail('shotgun switch refused');
await evaluate('__sdfGame.step(30, 1/60)');
if (await evaluate('__sdfGame.fireLauncher()')) fail('holstered launcher fired');
if (await evaluate('__sdfGame.launcher().visible')) fail('launcher still visible when holstered');
await shot('fpv-shotgun-reference');
await evaluate('__sdfGame.selectSlot("launcher"); __sdfGame.step(30,1/60)');
if (!(await evaluate('__sdfGame.launcher().visible'))) fail('launcher failed to raise');
report.errors = consoleEvents.filter(e => e.type === 'error' || e.type === 'exception');
report.gpu = await evaluate('__sdfGame.gpuDiagnostics()');
if (report.errors.length) fail(`console errors: ${JSON.stringify(report.errors.slice(-3))}`);
if (report.gpu?.lost) fail('GPU device lost');
// Optional review clip: same camera/FOV, VHS disabled only for the asset inspection.
if (process.env.LAUNCHER_CLIP === '1') {
  await evaluate('__sdfGame.setVhs(null); __sdfGame.step(2,1/60)');
  await shot('fpv-clean-idle');
  const frames = `${OUT}/clip-frames`; mkdirSync(frames, { recursive: true });
  for (let i = 0; i < 87; i++) {
    if (i === 9 && !(await evaluate('__sdfGame.fireLauncher()'))) fail('clip fire refused');
    await evaluate('__sdfGame.step(2,1/60)');
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${frames}/${String(i).padStart(3,'0')}.png`, Buffer.from(r.result.data,'base64'));
  }
  execFileSync('ffmpeg', ['-y','-framerate','30','-i',`${frames}/%03d.png`,'-vf','scale=900:-2','-c:v','libx264','-pix_fmt','yuv420p',`${OUT}/launcher-cycle.mp4`], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-y','-i',`${OUT}/launcher-cycle.mp4`,'-vf','fps=20,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',`${OUT}/launcher-cycle.gif`], { stdio: 'ignore' });
  rmSync(frames, { recursive: true, force: true });
  console.log('review clip: launcher-cycle.mp4 / .gif (VHS off, gameplay camera)');
}
report.errors = consoleEvents.filter(e => e.type === 'error' || e.type === 'exception');
if (report.errors.length) fail(`clip console errors: ${JSON.stringify(report.errors.slice(-3))}`);
writeFileSync(`${OUT}/gate.json`,JSON.stringify(report,null,2)+'\n');
console.log(`PASS: ${shotCount} images; shot/reload/manual/switch gates green; drawOnce ${report.warmDone?.phases?.drawOnce?.toFixed(1)} ms`);
ws.close(); process.exit(0);
