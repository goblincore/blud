// TEMP diagnostic probe — gun/hand tuning vs raw G-buffer (delete after use).
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
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=deferred` });
  let ready = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (pageErrors.length) throw new Error(`boot errors: ${JSON.stringify(pageErrors).slice(0, 600)}`);
    ready = await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)');
    if (ready) break;
  }
  if (!ready) throw new Error('boot timeout');
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');

  // Faced-zombie stance, all post off (null path like the check's tuning stage? NO —
  // the check runs tuning with post ON; replicate BOTH later. First: post ON default state).
  const z0 = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  const stanceYaw = Math.atan2(z0.pos[0] - (z0.pos[0] + 1.8), -(z0.pos[2] - z0.pos[2]));
  await evaluate(`__sdfGame.setPose(${z0.pos[0] + 1.8}, ${z0.pos[2]}, ${stanceYaw}, -0.12); __sdfGame.step(4);`);

  // Named gun/hand world points -> NDC.
  const breech = await evaluate('__sdfGame.breechWorld()[0]');
  const spGun = await evaluate(`__sdfGame.screenPosOf(${breech[0]}, ${breech[1]}, ${breech[2]})`);
  console.log('gun world point ndc:', JSON.stringify(spGun));

  const cur = await evaluate('__sdfGame.setGunTuning({})');
  console.log('authored tuning:', JSON.stringify(cur));

  const before = await evaluate(`__sdfGame.readSurfaceAt(${spGun.x}, ${spGun.y})`);
  console.log('BEFORE  raw:', JSON.stringify(before));
  await evaluate('__sdfGame.setGunTuning({ roughness: 0.05, metalness: 1 }); __sdfGame.step(3);');
  const after = await evaluate(`__sdfGame.readSurfaceAt(${spGun.x}, ${spGun.y})`);
  console.log('AFTER   raw:', JSON.stringify(after));
  await evaluate('__sdfGame.setGunTuning({ roughness: 0.5, metalness: 0.2 }); __sdfGame.step(2);');
  const forced = await evaluate(`__sdfGame.readSurfaceAt(${spGun.x}, ${spGun.y})`);
  console.log('FORCED  raw (.5/.2):', JSON.stringify(forced));

  // A few neighbours to see where the gun really is in the G-buffer.
  const diag = await evaluate('__sdfGame.deferredDiagnostics()');
  console.log('sizes:', JSON.stringify(diag.sizes), 'canvasDepthWrites:', diag.canvasDepthWrites);
  const grid = [];
  for (const dx of [-0.1, -0.05, 0, 0.05, 0.1]) {
    for (const dy of [-0.08, -0.04, 0, 0.04]) {
      const s = await evaluate(`__sdfGame.readSurfaceAt(${(spGun.x + dx).toFixed(3)}, ${(spGun.y + dy).toFixed(3)})`);
      const nz = (v) => v == null ? null : +v.toFixed(3);
      grid.push({ dx, dy, r: nz(s.roughness), m: nz(s.metalness), d: nz(s.depth), cls: +s.cls.toFixed(1), lum: s.albedo[0] == null ? null : +(0.3 * s.albedo[0] + 0.5 * s.albedo[1] + 0.2 * s.albedo[2]).toFixed(3) });
    }
  }
  for (const g of grid) console.log('grid', JSON.stringify(g));
} finally {
  try { ws.close(); } catch { /* ignore */ }
  try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch { /* ignore */ }
}
