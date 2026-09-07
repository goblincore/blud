// One-off probe: light-gain sweep for the deferred game adapter. Fixed pose;
// measures region means per gain so the exposure choice is numeric.
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=deferred` });
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (pageErrors.length) throw new Error('page errors');
  if (await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)')) break;
}
await evaluate('__sdfGame.setPose(-4.2, -1.2, Math.PI, -0.05); __sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(6);');
await sleep(200);
const out = {};
for (const gain of [1.0, 0.7, 0.5, 0.4, 0.3, 0.2]) {
  await evaluate(`__sdfGame.setDeferredLightGain(${gain}); __sdfGame.step(2);`);
  await sleep(120);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const means = await evaluate(`(async () => {
    const res = await fetch('data:image/png;base64,' + ${JSON.stringify(s.result.data)});
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const regions = { body: [620, 360, 260, 150], litWall: [640, 200, 200, 80], darkWall: [200, 320, 180, 140] };
    const out = {};
    for (const [k, [x, y, w, h]] of Object.entries(regions)) {
      const d = ctx.getImageData(x, y, w, h).data;
      let r = 0, g = 0, b = 0, clip = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        if (d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246) clip++;
      }
      out[k] = [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(100 * clip / n)];
    }
    return out;
  })()`);
  out[`gain${gain}`] = means;
  console.error(`gain ${gain}: body ${means.body} litWall ${means.litWall} darkWall ${means.darkWall}`);
}
console.log(JSON.stringify(out, null, 1));
try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch {}
ws.close();
process.exit(0);
