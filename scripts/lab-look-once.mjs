// One-off lab-page look capture (dungeon relighting task 7 parity check):
// same CDP flow as gallery-look.mjs but pointed at sdf-lab-webgpu.html, which
// has no pose seam — it frames its zombie itself. Usage:
//   node scripts/lab-look-once.mjs [vitePort] [cdpPort]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5288);
const CDP = Number(process.argv[3] ?? 9333);
const OUT = '/tmp/dungeon-look';
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
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
let booted = false;
for (let i = 0; i < 240 && !booted; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__sdfLab === "object"');
}
if (!booted) { console.error('lab never booted', errors.slice(-5)); process.exit(1); }
// Give it a few rendered frames, then freeze so the shot is deterministic.
await evaluate('window.__sdfLab.freeze?.(true) ?? false');
await sleep(1000);
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/lab.png`, Buffer.from(s.result.data, 'base64'));
console.log(`shot ${OUT}/lab.png`);
if (errors.length) console.log('console errors:', errors.length, errors.slice(-3));
ws.close();
process.exit(0);
