// One-off probe: quantify deferred-vs-legacy lighting on flesh and walls at a
// fixed pose. Reads pixel means over three regions per state via in-page
// OffscreenCanvas decode of the frame buffer screenshot. Private ports.
const vite = Number(process.argv[2] ?? 5340), cdp = Number(process.argv[3] ?? 9340);
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

/** Region means over the CURRENT frame. Regions are in screenshot space. */
const regionMeans = `async (regions) => {
  const shot = await new Promise((res) => { const c = window.__capSha; res(c); });
  return null;
}`;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const grab = async () => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  return s.result.data;
};
const meansOf = async (b64) => await evaluate(`(async () => {
  const b64 = ${JSON.stringify('data:image/png;base64,')};
  const res = await fetch('data:image/png;base64,' + ${JSON.stringify(b64)});
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const regions = {
    body:   [620, 360, 260, 150],
    litWall:[640, 200, 200, 80],
    darkWall:[200, 320, 180, 140],
    floor:  [640, 560, 200, 60],
  };
  const out = {};
  for (const [k, [x, y, w, h]] of Object.entries(regions)) {
    const d = ctx.getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    out[k] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
  return out;
})()`);

// ---- deferred ----
await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=deferred` });
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (pageErrors.length) throw new Error('page errors: ' + JSON.stringify(pageErrors).slice(0, 400));
  if (await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)')) break;
}
await evaluate('__sdfGame.setPose(-4.2, -1.2, Math.PI, -0.05); __sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(6);');
await sleep(200);
await evaluate('__sdfGame.step(2)');
const deferredOn = await meansOf(await grab());
await evaluate('__sdfGame.setSpotShadowSampling(false); __sdfGame.step(2);');
const deferredOff = await meansOf(await grab());
const deferredDiag = await evaluate('__sdfGame.deferredDiagnostics()');

// ---- legacy, same pose ----
await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html` });
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (pageErrors.length) throw new Error('page errors: ' + JSON.stringify(pageErrors).slice(0, 400));
  if (await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)')) break;
}
await evaluate('__sdfGame.setPose(-4.2, -1.2, Math.PI, -0.05); __sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(6);');
await sleep(200);
await evaluate('__sdfGame.step(2)');
const legacy = await meansOf(await grab());

console.log(JSON.stringify({ deferredSamplingOn: deferredOn, deferredSamplingOff: deferredOff, legacy, shadow: deferredDiag.shadow }, null, 1));
try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch {}
ws.close();
process.exit(0);
