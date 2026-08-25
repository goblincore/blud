// Probe: boot the lab page, flip tiles on, report console errors.
const VITE = process.argv[2] ?? '5297';
const CDP = process.argv[3] ?? '9297';
const CHARACTER = process.argv[4] ?? 'schoolgirl';
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 500));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html?character=${encodeURIComponent(CHARACTER)}` });

let lab = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  lab = await evaluate('typeof window.__sdfLab === "object"');
  if (lab) break;
}
if (!lab) { console.error('console tail:', consoleEvents.slice(-10)); console.error('FAIL: no __sdfLab'); process.exit(1); }
console.log('boot ok:', await evaluate('window.__sdfLab.backend'));
await sleep(1500);

// Flip tiles ON and let it render.
console.log(await evaluate(`(() => { const L = window.__sdfLab; L.setTiles(true); return L.tilesEnabled; })()`));
await sleep(2500);
const errs = consoleEvents.filter((e) => /error|Error|EXCEPTION|warn/i.test(e));
console.log('errors/warnings after tiles-on:', errs.length);
for (const e of errs.slice(0, 12)) console.log('  ', e.slice(0, 300));

// Screenshot for eyeballing.
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/tiles-compute-probe.png', Buffer.from(shot.result.data, 'base64'));
console.log('shot written /tmp/tiles-compute-probe.png');
// Close tab
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`);
process.exit(0);
