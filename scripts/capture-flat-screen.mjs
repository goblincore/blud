// scripts/capture-flat-screen.mjs — saves a 4:3 Night Train frame to assets-source/levels/flat-textures/screen-source.png (the Flat's screen).
// Usage: bash scripts/capture-flat-screen.sh
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5565);
const CDP = Number(process.argv[3] ?? 9565);
const OUT = 'assets-source/levels/flat-textures/screen-source.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=night-train&frozen&nospawn` });
let ready = false;
for (let i = 0; i < 480 && !ready; i++) {
  await sleep(500);
  ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
  if (errors.length) break;
}
if (!ready) fail(`night-train did not boot: ${errors.join(' | ')}`);
await evaluate(`(() => {
  let n = document.querySelector('canvas');
  while (n && n !== document.body) { for (const sib of n.parentElement.children) if (sib !== n) sib.style.display = 'none'; n = n.parentElement; }
  __sdfGame.freeze(true);
  return 1;
})()`);
await sleep(1500);
writeFileSync(OUT, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
console.log(`wrote ${OUT}`);
process.exit(0);
