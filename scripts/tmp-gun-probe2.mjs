// TEMP probe 2: composed tight-box response + hand normal response.
const vite = Number(process.argv[2] ?? 5350), cdp = Number(process.argv[3] ?? 9350);
const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0; const pageErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.resolve(m);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 90000);
  pending.set(id, { resolve: (m) => { clearTimeout(timer); pending.delete(id); resolve(m); }, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onclose = () => { for (const r of pending.values()) r.reject(new Error('closed')); };
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r)?.slice(0, 500));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async () => (await send('Page.captureScreenshot', { format: 'png' }))?.result?.data;
const boxStats = async (b64, box) => await evaluate(`(async () => {
  const res = await fetch('data:image/png;base64,' + ${JSON.stringify(b64)});
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  const [x0, y0, x1, y1] = ${JSON.stringify(box)};
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let r = 0, g = 0, b = 0, mx = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; mx = Math.max(mx, d[i], d[i+1], d[i+2]); }
  return { mean: [Math.round(r/n), Math.round(g/n), Math.round(b/n)], lum: Math.round((r+g+b)/(3*n)), maxCh: mx };
})()`);
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=deferred` });
  let ready = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (pageErrors.length) throw new Error(`boot errors: ${JSON.stringify(pageErrors).slice(0, 400)}`);
    ready = await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)');
    if (ready) break;
  }
  if (!ready) throw new Error('boot timeout');
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');
  const z0 = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  const stanceYaw = Math.atan2(z0.pos[0] - (z0.pos[0] + 1.8), -(z0.pos[2] - z0.pos[2]));
  await evaluate(`__sdfGame.setPose(${z0.pos[0] + 1.8}, ${z0.pos[2]}, ${stanceYaw}, -0.12); __sdfGame.step(4);`);
  const breech = await evaluate('__sdfGame.breechWorld()[0]');
  const spGun = await evaluate(`__sdfGame.screenPosOf(${breech[0]}, ${breech[1]}, ${breech[2]})`);
  // canvas px of the gun (1280x800): 
  const gx = Math.round((spGun.x + 1) / 2 * 1280), gy = Math.round((1 - spGun.y) / 2 * 800);
  const box = [gx - 40, gy - 40, gx + 40, gy + 40];
  console.log('gun canvas px', gx, gy);
  await evaluate('__sdfGame.setGunTuning({ roughness: 0.5, metalness: 0.2 }); __sdfGame.step(3);');
  const matte = await boxStats(await shot(), box);
  await evaluate('__sdfGame.setGunTuning({ roughness: 0.05, metalness: 1 }); __sdfGame.step(3);');
  const mirror = await boxStats(await shot(), box);
  await evaluate('__sdfGame.setGunTuning({ roughness: 0.95, metalness: 1 }); __sdfGame.step(3);');
  const roughMirror = await boxStats(await shot(), box);
  console.log('tight-box matte(.5/.2):', JSON.stringify(matte));
  console.log('tight-box mirror(.05/1):', JSON.stringify(mirror));
  console.log('tight-box roughMirror(.95/1):', JSON.stringify(roughMirror));
  // Hand finder: scan lower-left for a cls-17 green pixel (goblin skin).
  let hand = null;
  outer: for (let nx = -0.4; nx <= -0.05; nx += 0.035) {
    for (let ny = -0.9; ny <= -0.5; ny += 0.04) {
      const s = await evaluate(`__sdfGame.readSurfaceAt(${nx.toFixed(3)}, ${ny.toFixed(3)})`);
      if (s.cls > 16.5 && s.cls < 17.5 && s.albedo[1] > 0.08 && s.albedo[1] > s.albedo[0] * 1.25) {
        hand = { nx, ny, s: { albedo: s.albedo.map(v => +v.toFixed(3)), normal: s.normal.map(v => +v.toFixed(3)), rough: +s.roughness.toFixed(3), cls: s.cls, depth: +s.depth.toFixed(4) } };
        break outer;
      }
    }
  }
  console.log('hand pixel:', JSON.stringify(hand));
  if (hand) {
    const nBefore = hand.s.normal;
    await evaluate('__sdfGame.setGunTuning({ handNormalScale: 6 }); __sdfGame.step(3);');
    const after = await evaluate(`__sdfGame.readSurfaceAt(${hand.nx.toFixed(3)}, ${hand.ny.toFixed(3)})`);
    console.log('hand normal before:', JSON.stringify(nBefore), 'after scale6:', JSON.stringify(after.normal.map(v => +v.toFixed(3))));
    await evaluate('__sdfGame.setGunTuning({ handNormalScale: 2 }); __sdfGame.step(2);');
  }
} finally {
  try { ws.close(); } catch { /* ignore */ }
  try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch { /* ignore */ }
}
