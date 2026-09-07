// One-off calibration captures, round 2: camera FACING the wounded zombie
// (yaw from the aim convention atan2(dx, -dz)), same framing in every mode.
// Saves labelled PNGs + prints one center-ROI mean per capture (numbers only).
const vite = Number(process.argv[2] ?? 5346), cdp = Number(process.argv[3] ?? 9346);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(out, { recursive: true });

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const grab = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}`, Buffer.from(s.result.data, 'base64'));
};
const roiMean = `async () => {
  const s = ${JSON.stringify('')};
  return null;
}`;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const boot = async (url) => {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (pageErrors.length) throw new Error('page errors');
    if (await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)')) break;
  }
};
// Deferred: face a room-2 zombie from 1.8 m east, blast it, sweep gains.
await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
const z = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
const px = z.pos[0] + 1.8, pz = z.pos[2];
const yaw = Math.atan2(z.pos[0] - px, -(z.pos[2] - pz)); // faces the zombie
await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, -0.12); __sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(6);`);
await evaluate(`__sdfGame.explode(${z.pos[0]}, 1.2, ${z.pos[2]}); __sdfGame.step(30);`);
for (const gain of [1.0, 0.7, 0.5]) {
  await evaluate(`__sdfGame.setDeferredLightGain(${gain}); __sdfGame.step(3);`);
  await sleep(150);
  await grab(`task5-cal2-gain${gain}-faced-wounded.png`);
  console.error(`captured deferred gain ${gain}`);
}

// Legacy, identical pose + blast.
await boot(`http://localhost:${vite}/sdf-game.html`);
await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, -0.12); __sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(6);`);
await evaluate(`__sdfGame.explode(${z.pos[0]}, 1.2, ${z.pos[2]}); __sdfGame.step(30);`);
await grab('task5-cal2-legacy-faced-wounded.png');
console.error('captured legacy');
try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch {}
ws.close();
process.exit(0);
