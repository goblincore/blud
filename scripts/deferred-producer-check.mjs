// Hybrid deferred M2 task 2 — assertion-driven WebGPU gate for the surface
// producers (sdf-deferred-producers.html). Start vite + CDP Chrome first
// (scripts/deferred-producer-check.sh does), then:
//   node scripts/deferred-producer-check.mjs 5324 9324
//
// Every check is an ASSERTION against real GPU output: per-producer coverage
// and packed class (receiver bits on device), depth, finite unit normals,
// light-invariant surface buffers, and the one-trace shader structure.
// Evidence lands in docs/dev-notes/2026-09-06-hybrid-deferred-m2/.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5324), cdp = Number(process.argv[3] ?? 9324);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
mkdirSync(out, { recursive: true });

const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
const errors = [], checks = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.resolve(m); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const finish = (fn, value) => { clearTimeout(timer); pending.delete(id); fn(value); };
  const timer = setTimeout(() => finish(reject, new Error(`CDP timeout: ${method}`)), 190000);
  pending.set(id, { resolve: (m) => finish(resolve, m), reject: (e) => finish(reject, e) });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onclose = () => {
  for (const request of pending.values()) request.reject(new Error('CDP connection closed'));
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 180000 });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, detail) => { checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail)); };

const results = { checks, errors, pass: false };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ---- boot -----------------------------------------------------------------
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-deferred-producers.html` });
  let booted = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (errors.length) throw new Error(`page errors during boot: ${JSON.stringify(errors)}`);
    if (await evaluate('!!(window.__deferredProducers && __deferredProducers.ready)')) { booted = true; break; }
  }
  assert.ok(booted, 'boot timeout — __deferredProducers.ready never flipped');
  const pageErrors = await evaluate('__deferredProducers.errors');
  assert.deepEqual(pageErrors, [], 'page must boot without recorded errors');
  const kinds = await evaluate('__deferredProducers.surfaceKind');
  assert.equal(kinds.body, 18, 'body surface material must pack flesh+level-only');
  assert.equal(kinds.bones, 17, 'bone instancer must pack mesh+level-only');
  // Chunks march the SAME flesh field as the body — flesh class 2, not mesh.
  assert.equal(kinds.chunks, 18, 'shared chunk material must pack flesh+level-only');
  assert.equal(kinds.chunkA, true, 'both chunk views must share the ONE surface material');
  assert.equal(kinds.baked, 1, 'baked chunk must pack mesh+full');
  check('boot-clean-and-surface-kinds', kinds);

  // ---- coverage, classes, depth, normals ------------------------------------
  let s = await evaluate('__deferredProducers.readSurfaces()');
  writeFileSync(`${out}/task2-producers.json`, JSON.stringify({ anchors: s.anchors, classCounts: s.classCounts, hashes: s.hashes }, null, 2));
  assert.ok((s.classCounts['18'] ?? 0) > 1000, `SDF body+chunk coverage expected >1000 px of class 18, got ${s.classCounts['18']}`);
  assert.ok((s.classCounts['17'] ?? 0) > 300, `bone+chunk coverage expected >300 px of class 17, got ${s.classCounts['17']}`);
  assert.ok((s.classCounts['1'] ?? 0) > 200, `baked chunk coverage expected >200 px of class 1, got ${s.classCounts['1']}`);
  const covered = Object.entries(s.classCounts).filter(([k]) => k !== '0').reduce((a, [, n]) => a + n, 0);
  assert.equal(s.classCounts['0'], s.width * s.height - covered, 'all other pixels stay the empty class 0');
  check('producer-coverage-classes', s.classCounts);

  const byName = Object.fromEntries(s.anchors.map((a) => [a.name, a]));
  for (const name of ['body', 'bones', 'chunkA', 'chunkB', 'baked']) {
    const a = byName[name];
    assert.ok(a.hit, `${name}: no ${a.want}-class pixel near its projected anchor ${JSON.stringify(a.pixel)}`);
    assert.ok(a.hit.depth > 0 && a.hit.depth < 1, `${name}: surfaceDepth must be a real hit, got ${a.hit.depth}`);
    // The probe pixel can sit a few px off the anchor ray, so this pins the
    // producer is IN FRONT of the camera at the anchor's range — not the
    // M1 gate's 1.26 px world-reconstruction exactness.
    assert.ok(Math.abs(a.hit.depth - a.clipDepth) < 0.15, `${name}: G-buffer depth ${a.hit.depth} must be near the projected clip depth ${a.clipDepth}`);
    assert.ok(Number.isFinite(a.hit.normalLen) && Math.abs(a.hit.normalLen - 1) < 0.02, `${name}: world normal must be finite unit length, got ${a.hit.normalLen}`);
  }
  // The receiver metadata is ON DEVICE now, per producer, in one frame.
  assert.equal(byName.body.hit.cls, 18);
  assert.equal(byName.bones.hit.cls, 17);
  assert.equal(byName.chunkA.hit.cls, 18, 'marched chunks are flesh class');
  assert.equal(byName.chunkB.hit.cls, 18, 'marched chunks are flesh class');
  assert.equal(byName.baked.hit.cls, 1);
  check('per-producer-depth-normal-class', Object.fromEntries(['body', 'bones', 'chunkA', 'chunkB', 'baked'].map((k) => [k, {
    cls: byName[k].hit.cls, depth: byName[k].hit.depth, clip: byName[k].clipDepth, normalLen: byName[k].hit.normalLen, pixel: byName[k].hit.pixel,
  }])));

  // ---- light invariance -------------------------------------------------------
  const before = s.hashes;
  await evaluate(`__deferredProducers.setLights('b'); __deferredProducers.step(2)`);
  const after = await evaluate('__deferredProducers.readSurfaces()');
  for (const k of Object.keys(before)) {
    assert.equal(after.hashes[k], before[k], `surface attachment ${k} changed when only lights moved`);
  }
  assert.equal(after.lightWhich, 'b');
  check('light-invariant-surface-buffers', { states: ['a', 'b'], hashes: before });

  // ---- one SDF trace in the generated surface WGSL ---------------------------
  const wgsl = await evaluate('__deferredProducers.surfaceShader()');
  writeFileSync(`${out}/task2-surface-shader.wgsl`, wgsl);
  const marchOcc = (wgsl.match(/marchSurface\s*\(/g) || []).length;
  const callAt = wgsl.search(/=\s*marchSurface\s*\(/);
  assert.equal(marchOcc, 2, `expected the fn definition + exactly ONE marchSurface call, got ${marchOcc} occurrences`);
  assert.ok(callAt > 0, 'marchSurface call must assign the cached trace');
  for (const fn of ['sdfSurfaceReadAlbedo', 'sdfSurfaceReadNormal', 'sdfSurfaceReadEmission']) {
    const occ = (wgsl.match(new RegExp(fn + '\\s*\\(', 'g')) || []).length;
    const fnCallAt = wgsl.search(new RegExp('=\\s*' + fn + '\\s*\\('));
    assert.equal(occ, 2, `${fn} must appear exactly as declaration + call, got ${occ}`);
    assert.ok(fnCallAt > callAt, `${fn} must be called AFTER the cached trace (dep ordering)`);
  }
  check('one-trace-per-fragment-shader', { marchOcc, callAt });

  // ---- capture ---------------------------------------------------------------
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/task2-producers.png`, Buffer.from(shot.result.data, 'base64'));
  check('capture-written', { file: `${out}/task2-producers.png` });

  results.pass = true;
} finally {
  writeFileSync(`${out}/task2-producer-check.json`, JSON.stringify(results, null, 2));
  // Close the OWNED tab and socket — bounded CDP lifecycle, every exit path.
  try { await send('Page.close'); } catch { /* socket may already be gone */ }
  try { ws.close(); } catch { /* idem */ }
  await new Promise((r) => setTimeout(r, 150));
}
if (!results.pass || errors.length) {
  console.error('FAIL', JSON.stringify({ errors, checks }, null, 2));
  process.exit(1);
}
console.log('ALL PASS', checks.length, 'checks');
