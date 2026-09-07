// One-off probe: deferred game — is the shadow visibility multiplication
// killing the flesh? Captures lit frames with sampling on/off and generation
// off, plus the depth debug view. Private ports via argv.
import { writeFileSync } from 'node:fs';
const vite = Number(process.argv[2] ?? 5340), cdp = Number(process.argv[3] ?? 9340);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.(m);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails);
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}`, Buffer.from(s?.result?.data ?? '', 'base64'));
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=deferred` });
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (pageErrors.length) throw new Error('page errors: ' + JSON.stringify(pageErrors).slice(0, 500));
  if (await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)')) break;
}
await evaluate('__sdfGame.setPose(-4.2, -1.2, Math.PI, -0.05); __sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(6);');
await sleep(200);
const cap = async (name) => {
  await evaluate('__sdfGame.step(2)');
  await sleep(150);
  await shot(name);
};
// 1. sampling ON (default state)
await cap('task5-probe-sampling-on.png');
// 2. sampling OFF — generation keeps running, lit stage ignores the maps
await evaluate('__sdfGame.setSpotShadowSampling(false)');
await cap('task5-probe-sampling-off.png');
// 3. generation OFF entirely (binding null = M1 unshadowed path)
await evaluate('__sdfGame.setSpotShadow(false)');
await cap('task5-probe-gen-off.png');
// 4. back on
await evaluate('__sdfGame.setSpotShadow(true); __sdfGame.setSpotShadowSampling(true)');
await cap('task5-probe-back-on.png');
const diag = await evaluate('__sdfGame.deferredDiagnostics()');
console.log(JSON.stringify({ shadow: diag.shadow, layerDebug: 'see screenshots', errors: diag.errors }));
try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch {}
ws.close();
process.exit(0);
