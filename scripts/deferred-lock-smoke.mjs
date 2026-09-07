// TASK-6 seam smoke (bounded): render lock + fresh-render hash control +
// level-hide true-empty sentinel proof, on the real game, one boot.
//   node scripts/deferred-lock-smoke.mjs <vitePort> <cdpPort>
import assert from 'node:assert/strict';

const vite = Number(process.argv[2] ?? 5326), cdp = Number(process.argv[3] ?? 9326);
const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.resolve(m);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
  pending.set(id, { resolve: (m) => { clearTimeout(timer); pending.delete(id); resolve(m); }, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onclose = () => { for (const r of pending.values()) r.reject(new Error('CDP closed')); };
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
  return res.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=deferred` });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    await sleep(500);
    ready = await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)');
  }
  assert.ok(ready, 'boot timeout');
  for (let i = 0; i < 60; i++) { if (await evaluate('__sdfGame.gunReady')) break; await sleep(500); }
  assert.ok(await evaluate('__sdfGame.gunReady'), 'gun ready');

  // Freeze, settle transients (teleport excites bob), then LOCK.
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true);');
  await evaluate('__sdfGame.teleport(2); __sdfGame.step(90);');
  await evaluate('__sdfGame.setRenderLock(true); __sdfGame.step(2);');

  // CONTROL: two hashSurface calls = two SEPARATE renders, bit-identical.
  const h0a = await evaluate('__sdfGame.hashSurface()');
  const camA = await evaluate('__sdfGame.pose()');
  const h0b = await evaluate('__sdfGame.hashSurface()');
  const camB = await evaluate('__sdfGame.pose()');
  assert.deepEqual(camA, camB, 'pose drifted under lock');
  assert.deepEqual(h0a.hashes, h0b.hashes, `fresh-render control FAILED (two separate renders differ):
    ${JSON.stringify(h0a.hashes)} vs ${JSON.stringify(h0b.hashes)}`);
  assert.deepEqual(h0a.classCounts, h0b.classCounts, 'class histogram differs across renders');
  console.log('CONTROL OK: two separate renders bit-identical', JSON.stringify(h0a.classCounts),
    'sentinel', h0a.sentinelPixels, 'deepOccupied', h0a.deepOccupied);

  // TRUE-EMPTY PROOF: aim up, hide the level, verify rays are empty+sentinel.
  const p = await evaluate('__sdfGame.pose()');
  await evaluate(`__sdfGame.setPose(${p.pos[0]}, ${p.pos[2]}, 0, 1.35); __sdfGame.step(90);`);
  await evaluate('__sdfGame.setLevelMeshVisible(false); __sdfGame.step(3);');
  const hEmpty = await evaluate('__sdfGame.hashSurface()');
  console.log('EMPTY CENSUS: nonEmpty', hEmpty.nonEmpty, 'sentinel', hEmpty.sentinelPixels,
    'deepOccupied', hEmpty.deepOccupied, 'maxDepth', hEmpty.maxDepth);
  for (const ndc of [[0, 0.6], [-0.5, 0.5], [0.5, 0.5]]) {
    const s = await evaluate(`__sdfGame.readSurfaceAt(${ndc[0]}, ${ndc[1]})`);
    assert.ok(s.cls <= 0.5 && s.depth >= 0.9999, `ray ${JSON.stringify(ndc)} not empty: ${JSON.stringify(s)}`);
  }
  console.log('EMPTY RAYS OK: three verified empty+sentinel rays');
  await evaluate('__sdfGame.setLevelMeshVisible(true); __sdfGame.step(3);');
  const hRestored = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hRestored.hashes, h0a.hashes, 'level restore must reproduce the digest exactly');
  console.log('RESTORE OK: digest bit-identical after level restore');
  console.log('SMOKE PASS');
} finally {
  try { await send('Page.close'); } catch { /* gone */ }
  ws.close();
  await new Promise((r) => { ws.onclose = r; setTimeout(r, 300); });
}
