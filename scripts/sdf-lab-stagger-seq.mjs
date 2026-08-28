// scripts/sdf-lab-stagger-seq.mjs — LAB reference captures for the stagger task.
//
// One hero, wander off (shambles in place at spawn), god-cam pinned at
// first-person-ish range, one Shift-click (the lab's blast reaction: wound +
// pendingShot + 0.16 impulseAt — the full click path), screenshots across the
// reaction. This is the comparison reel for the game page's slug stagger.
//
// Usage: node scripts/sdf-lab-stagger-seq.mjs <vitePort> <cdpPort> <outDir> <tag>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5397);
const CDP = Number(process.argv[3] ?? 9395);
const OUT = process.argv[4] ?? '/tmp/stagger-lab';
const TAG = process.argv[5] ?? 'lab';
const W = 1100, H = 800;

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
let shotN = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${TAG}-${String(shotN++).padStart(2, '0')}-${name}.png`, buf);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('window.__sdfLab ? window.__sdfLab.backend : null');
  if (backend) break;
}
if (backend !== 'webgpu') fail(`lab never booted on webgpu (got ${backend})`);
console.log('lab booted: webgpu');

// Deterministic reset (motion back to spawn), then keep the hero IN PLACE:
// wander off means it idles/shambles at the spawn point for the whole reel.
await evaluate('__sdfLab.holdStill(1)');
await evaluate('__sdfLab.setWander(false)');
// Pin the god-cam at fighting range: 2.6 m out, looking at chest height.
await evaluate('__sdfLab.setCam(0, 0.1, 2.6, 1.0)');
await evaluate('__sdfLab.pauseLoop(false)');
await sleep(700); // let the idle settle on screen

await shot('pre');
// Shift-click the hero: press + release at the screen centre, Shift = blast.
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type, x: W / 2, y: H / 2, button: 'left', clickCount: 1, modifiers: 8,
  });
}
console.log('blast fired — capturing ~1.4 s of reaction');
// Real-time reel: a shot every ~40 ms across the ~1 s reaction.
for (let i = 0; i < 35; i++) {
  await shot(`f${String(i * 2).padStart(3, '0')}`);
  await sleep(33);
}
console.log(`done — ${shotN} shots in ${OUT}`);
process.exit(0);
