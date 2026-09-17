// scripts/shutter-lab-capture.mjs
//
// Task-1 evidence capture for the shutter lab on /sdf-blood-compare.html.
//
// Owns its own vite + headless Chrome, on an UNUSED port pair, with its own
// profile under the worktree, and LAUNCHES CHROME WITHOUT any unsafe flag
// (no --enable-unsafe-webgpu, no --no-sandbox): Chrome 152 stable has WebGPU
// on by default. Refuses to reuse a port it did not start — a foreign server
// answering is not proof it is this lab.
//
// Usage:
//   node scripts/shutter-lab-capture.mjs [vitePort] [cdpPort] [outDir]
//
// It captures: zero-exposure sampled (parity), sharp, sampled at 1/120, 1/60,
// 1/30 for the burst fixture, plus the crossing fixture and the obstacle
// fixture. It writes state() JSON beside each PNG and prints a summary.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VITE = Number(process.argv[2] ?? 5433);
const CDP = Number(process.argv[3] ?? 9433);
const OUT = resolve(process.argv[4] ?? 'docs/dev-notes/2026-09-16-shutter-blur/evidence');
const LAB_TMP = resolve('.lab-tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function shutdown(code) {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch {} }
  }
  setTimeout(() => process.exit(code), 400);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch {} } });

async function waitFor(url, what, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error(`${what} never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(`${LAB_TMP}/tmp-${CDP}`, { recursive: true });

// Fail loudly if the port is already taken: we must not drive someone else's server.
for (const [port, what] of [[VITE, 'vite'], [CDP, 'chrome']]) {
  try {
    const r = await fetch(`http://localhost:${port}/`);
    if (r.status >= 0) { console.error(`port ${port} (${what}) is already answering — choose another`); process.exit(2); }
  } catch { /* connection refused = free */ }
}

console.log(`starting vite on ${VITE}`);
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE), '--strictPort'], {
  stdio: 'ignore', detached: true,
});
children.push(vite);
await waitFor(`http://localhost:${VITE}/`, 'vite');

console.log(`starting headless chrome (WebGPU defaults, no unsafe flags) on ${CDP}`);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${LAB_TMP}/chrome-${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-crash-reporter', `--crash-dumps-dir=${LAB_TMP}/crashpad-${CDP}`,
  '--window-size=820,620',
  'about:blank',
], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: `${LAB_TMP}/tmp-${CDP}` } });
children.push(chrome);
await waitFor(`http://localhost:${CDP}/json/version`, 'chrome debug port');

// ---- CDP plumbing --------------------------------------------------------
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-blood-compare.html` });

// WebGPU adapter probe before we trust anything.
const gpu = await evaluate(`(async () => {
  if (!navigator.gpu) return 'no navigator.gpu';
  const a = await navigator.gpu.requestAdapter();
  return a ? 'ok' : 'no adapter';
})()`);
console.log('WebGPU probe:', gpu);
if (gpu !== 'ok') { console.error('WebGPU unavailable in this headless Chrome'); shutdown(3); }

let booted = false;
for (let i = 0; i < 240 && !booted; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__bloodCompare === "object"');
  const err = await evaluate('document.getElementById("errors")?.textContent ?? ""');
  if (err) { console.error('page error:', err); shutdown(4); }
}
if (!booted) { console.error('blood-compare never booted', errors.slice(-5)); shutdown(5); }
console.log('page booted; backend =', await evaluate('__bloodCompare.state().backend'));

// Hide the control panel so captures are the canvas alone.
await evaluate('document.getElementById("ui").style.display="none"; document.getElementById("paused").style.display="none"; document.getElementById("status").style.display="none"; true');
await sleep(300);

const results = {};
async function shot(name, setupExpr) {
  await evaluate(setupExpr);
  await sleep(700);
  const state = await evaluate('__bloodCompare.state()');
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  writeFileSync(`${OUT}/${name}.state.json`, JSON.stringify(state, null, 2));
  results[name] = state.shutter;
  const L = state.shutter.last;
  console.log(`shot ${file}  exposureMs=${state.shutter.exposureMs.toFixed(2)} ref=${state.shutter.reference} samples=${state.shutter.samples}`,
    `livePos=${JSON.stringify(L.livePos)} samplePos=${JSON.stringify(L.samplePos)} sampleT=[${L.firstSampleT.toFixed(4)},${L.lastSampleT.toFixed(4)}]`);
}

// Zero-exposure parity: sampled selection with exposure OFF must render sharp.
await shot('00-zero-exposure-sampled',
  `__bloodCompare.setShape('current'); __bloodCompare.setScenario('burst'); __bloodCompare.setMode('shutter'); __bloodCompare.setShutter({reference:'sampled', preset:'off'}); true`);
await shot('01-zero-exposure-sharp',
  `__bloodCompare.setShutter({reference:'sharp', preset:'off'}); true`);
await shot('02-sharp-1-30',
  `__bloodCompare.setShutter({reference:'sharp', preset:'1-30'}); true`);
await shot('03-sampled-1-120',
  `__bloodCompare.setShutter({reference:'sampled', preset:'1-120', samples:8}); true`);
await shot('04-sampled-1-60',
  `__bloodCompare.setShutter({reference:'sampled', preset:'1-60', samples:8}); true`);
await shot('05-sampled-1-30',
  `__bloodCompare.setShutter({reference:'sampled', preset:'1-30', samples:8}); true`);
await shot('06-crossing-1-30',
  `__bloodCompare.setScenario('crossing'); __bloodCompare.setShutter({reference:'sampled', preset:'1-30', samples:8}); true`);
await shot('07-crossing-1-30-samples24',
  `__bloodCompare.setShutter({reference:'sampled', preset:'1-30', samples:24}); true`);
await shot('08-bleed-1-60',
  `__bloodCompare.setScenario('bleed'); __bloodCompare.setShutter({reference:'sampled', preset:'1-60', samples:8}); true`);
await shot('09-trail-1-60',
  `__bloodCompare.setScenario('trail'); __bloodCompare.setShutter({reference:'sampled', preset:'1-60', samples:8}); true`);
// Angle path: 180 deg at an EXPLICIT 60 fps reference must equal 1/120 s.
await shot('10-angle-180-at-60fps',
  `__bloodCompare.setScenario('burst'); __bloodCompare.setShutter({reference:'sampled', exposureMode:'angle', angleDeg:180, referenceFps:60, samples:8}); true`);
// Near-zero angle: the sampled path runs (samples > 0) but with negligible
// displacement, so the blood must sit in the SAME place as the sharp frame.
// Any offset here is an orientation/reconstruction bug, not motion.
await shot('11-sampled-near-zero-angle',
  `__bloodCompare.setShutter({reference:'sampled', exposureMode:'angle', angleDeg:0.1, referenceFps:60, samples:8}); true`);
await shot('12-wipe-sharp-sampled-1-30',
  `__bloodCompare.setShutter({reference:'sampled', exposureMode:'seconds', preset:'1-30', samples:8}); __bloodCompare.setWipe(true, 'smooth', 'smooth', 0.5); true`);

// Zero-exposure parity: the sampled selection at exposure off is routed to the
// fused sharp render, so the two PNGs must be byte-identical.
const zeroA = readFileSync(`${OUT}/00-zero-exposure-sampled.png`);
const zeroB = readFileSync(`${OUT}/01-zero-exposure-sharp.png`);
console.log('zero-exposure parity byte-identical:', zeroA.equals(zeroB), `(${zeroA.length} bytes)`);

if (errors.length) console.log('console errors:', errors.length, errors.slice(-4));
console.log('DONE');
try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
ws.close();
shutdown(0);
