// scripts/gallery-look.mjs — quick look driver: one pose, one shot.
// Usage: node scripts/gallery-look.mjs [vitePort] [cdpPort] [outName]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5297);
const CDP = Number(process.argv[3] ?? 9297);
const OUT = process.env.LOOK_OUT ?? '/tmp/gallery-look';
const NAME = process.argv[4] ?? 'look';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object"')) break;
}
if (!(await evaluate('typeof window.__sdfGame === "object"'))) { console.error('never booted', errors.slice(-5)); process.exit(1); }
console.log('resolution:', JSON.stringify(await evaluate('window.__sdfGame.resolution')));
console.log('sdf target:', JSON.stringify(await evaluate('window.__sdfGame.sdfTarget')));

// The pose to look at comes from the URL hash or defaults to room3 zombies.
await evaluate('window.__sdfGame.freeze(true)');
await evaluate('window.__sdfGame.setLoopRunning(false)');
await evaluate(`window.__sdfGame.setPose(4.8, 4.8, Math.PI, 0)`);
await evaluate('window.__sdfGame.step(20, 1/60)');
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/${NAME}.png`, Buffer.from(s.result.data, 'base64'));
console.log(`shot ${OUT}/${NAME}.png`);
if (errors.length) console.log('console errors:', errors.length, errors.slice(-3));
ws.close();
process.exit(0);
