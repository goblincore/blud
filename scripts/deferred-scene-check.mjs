// Hybrid deferred M2 task 3 — assertion-driven WebGPU gate for the game
// scene router and the shared light list (sdf-deferred-scene.html). Start
// vite + CDP Chrome first (scripts/deferred-scene-check.sh does), then:
//   node scripts/deferred-scene-check.mjs 5326 9326
//
// Every check is an ASSERTION against real GPU output: router-adapted room
// coverage, on-device alphaTest survival through the G-buffer pass, scoped
// exclusion of forward/unsupported/unregistered renderables, late kit-child
// discovery with adapter receiver bits, and the deterministic shared light
// list (flashlight slot 0, inactive muzzle omitted, 16-slot cap, muzzle
// invariance of the flashlight entry). Evidence lands in
// docs/dev-notes/2026-09-06-hybrid-deferred-m2/.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5326), cdp = Number(process.argv[3] ?? 9326);
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
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-deferred-scene.html` });
  let booted = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (errors.length) throw new Error(`page errors during boot: ${JSON.stringify(errors)}`);
    if (await evaluate('!!(window.__deferredScene && __deferredScene.ready)')) { booted = true; break; }
  }
  assert.ok(booted, 'boot timeout — __deferredScene.ready never flipped');
  const pageErrors = await evaluate('__deferredScene.errors');
  assert.deepEqual(pageErrors, [], 'page must boot without recorded errors');
  check('boot-clean', { ok: true });

  // ---- router diagnostics ----------------------------------------------------
  const diag = await evaluate('__deferredScene.diagnostics()');
  assert.ok(diag.mesh.counts.mesh > 6, `room+cutout+kit+unsupported expected under mesh, got ${JSON.stringify(diag.mesh.counts)}`);
  assert.equal(diag.mesh.counts.forward, 1, 'the forward sphere must be catalogued forward');
  assert.equal(diag.mesh.counts.sdf, 0, 'the mesh router holds no sdf members');
  assert.equal(diag.sdf.counts.sdf, 1, 'the sdf router holds the surface view');
  assert.ok(
    diag.mesh.unsupported.some((u) => u.includes('unsupported-mesh')),
    `unsupported list must name the custom node-material mesh, got ${JSON.stringify(diag.mesh.unsupported)}`,
  );
  check('router-diagnostics', { counts: diag.mesh.counts, sdf: diag.sdf.counts, unsupported: diag.mesh.unsupported });

  // ---- coverage, classes, scoped exclusion (one frame) -----------------------
  let s = await evaluate('__deferredScene.readSurfaces()');
  writeFileSync(`${out}/task3-scene.json`, JSON.stringify({
    classCounts: s.classCounts,
    anchors: s.anchors.map((a) => ({ name: a.name, want: a.want, hit: a.hit })),
  }, null, 2));
  const byName = Object.fromEntries(s.anchors.map((a) => [a.name, a]));
  for (const name of ['body', 'floor', 'sideWall', 'cutoutSolid']) {
    const a = byName[name];
    assert.ok(a.hit, `${name}: no class-${a.want} pixel near its anchor ${JSON.stringify(a.pixel)}`);
  }
  assert.equal(byName.body.hit.cls, 18, 'the SDF body must read flesh+level-only (18)');
  assert.ok(byName.body.hit.depth > 0 && byName.body.hit.depth < 1, 'body surfaceDepth must be a real hit');
  assert.ok((s.classCounts['1'] ?? 0) > 2000, `router-adapted room coverage expected >2000 px of class 1, got ${s.classCounts['1']}`);
  assert.ok((s.classCounts['18'] ?? 0) > 1000, `SDF body coverage expected >1000 px of class 18, got ${s.classCounts['18']}`);
  const covered = Object.entries(s.classCounts).filter(([k]) => k !== '0').reduce((a, [, n]) => a + n, 0);
  assert.equal(s.classCounts['0'], s.width * s.height - covered, 'all other pixels stay the empty class 0');
  check('producer-coverage-classes', s.classCounts);

  // ---- alphaTest survives the adapter (on device) ----------------------------
  const solid = byName.cutoutSolid, hole = byName.cutoutHole;
  assert.ok(hole.hit, `the cutout HOLE must show the empty sentinel (class 0) at ${JSON.stringify(hole.pixel)}`);
  assert.ok(hole.hit.depth > 0.999, `the hole must be EMPTY background (depth 1), got ${hole.hit.depth}`);
  assert.ok(solid.hit.depth < 1, `the solid cell must be a real hit, got ${solid.hit.depth}`);
  assert.ok(
    solid.hit.clipDepth !== undefined && Math.abs(solid.hit.depth - solid.clipDepth) < 0.05,
    `solid cell depth ${solid.hit.depth} must be near the plane's clip depth ${solid.clipDepth} — alphaTest must not eat it`,
  );
  check('alpha-cutout-survives-adapter', { solid: solid.hit, hole: hole.hit });

  // ---- scoped exclusion: forward / unsupported / unregistered ----------------
  for (const name of ['forwardSphere', 'unsupportedMesh', 'helperSphere']) {
    const a = byName[name];
    assert.ok(a.hit, `${name} must be OUT of the producer pass (empty sentinel expected at ${JSON.stringify(a.pixel)})`);
    assert.ok(a.hit.depth > 0.999, `${name} must not write depth, got ${a.hit.depth}`);
  }
  check('scoped-exclusion-forward-unsupported-unregistered', {
    forwardSphere: byName.forwardSphere.hit?.depth, unsupportedMesh: byName.unsupportedMesh.hit?.depth, helperSphere: byName.helperSphere.hit?.depth,
  });

  // ---- the shared light list ---------------------------------------------------
  let lights = await evaluate('__deferredScene.lights()');
  assert.equal(lights.ids[0], 'flashlight', 'the flashlight takes slot 0');
  assert.equal(lights.flashlightIndex, 0, 'flashlightIndex must be 0');
  assert.ok(lights.count <= 16, `at most 16 lights, got ${lights.count}`);
  assert.ok(!lights.ids.includes('muzzle'), 'an inactive muzzle must be omitted from the set');
  assert.ok(lights.dropped.includes('muzzle'), 'the inactive muzzle must be reported in dropped');
  assert.ok(lights.ids.length <= 16, `ids must respect the cap, got ${lights.ids.length}`);
  assert.ok(lights.dropped.length >= 4, `far practicals must be dropped (20 practicals + muzzle > 16), got ${JSON.stringify(lights.dropped)}`);
  // fire-00 sits farthest from the camera on this layout and must lose its slot.
  assert.ok(!lights.ids.includes('fire-00'), 'the farthest practical must be dropped, not the nearest');
  assert.equal(lights.ids.filter((id) => id.startsWith('fire')).length, 15, '15 practical slots after the flashlight');
  // Frame-to-frame repeatability of the per-frame rebuild.
  await evaluate('__deferredScene.step(1)');
  const lightsA = await evaluate('__deferredScene.lights()');
  await evaluate('__deferredScene.step(1)');
  const lightsB = await evaluate('__deferredScene.lights()');
  assert.deepEqual(lightsB.ids, lightsA.ids, 'the rebuilt list must be frame-to-frame repeatable');
  check('light-list-selection', { ids: lights.ids, dropped: lights.dropped, flashlightIndex: lights.flashlightIndex, count: lights.count });

  // Fire the muzzle: it becomes its own second slot.
  await evaluate('__deferredScene.fire(true)');
  lights = await evaluate('__deferredScene.lights()');
  assert.equal(lights.ids[1], 'muzzle', 'an active muzzle takes the slot after the flashlight');
  assert.ok(!lights.dropped.includes('muzzle'), 'an active muzzle is not dropped');
  // Moving only the muzzle never moves the flashlight entry.
  const invariant = await evaluate('__deferredScene.muzzleInvariance()');
  assert.equal(invariant, true, 'moving only the muzzle must not change the flashlight entry');
  await evaluate('__deferredScene.fire(false)');
  check('light-list-muzzle-priority-invariance', { activeIds: lights.ids.slice(0, 3), muzzleInvariance: invariant });

  // ---- late kit child: async discovery + adapter receiver bits on device -----
  let before = await evaluate('__deferredScene.readSurfaces()');
  const kitBefore = before.anchors.find((a) => a.name === 'kitChild');
  assert.ok(kitBefore.hit, 'before the kit lands its anchor must be the empty sentinel');
  assert.ok(kitBefore.hit.depth > 0.999, 'before the kit lands its anchor must be empty background');
  const route = await evaluate('__deferredScene.addKitChild()');
  assert.equal(route, 'mesh', 'sync() must discover the late kit child under the registered parent');
  await evaluate('__deferredScene.step(2)');
  const after = await evaluate('__deferredScene.readSurfaces()');
  writeFileSync(`${out}/task3-scene-late-kit.json`, JSON.stringify({
    classCounts: after.classCounts,
    kitChild: after.anchors.find((a) => a.name === 'kitChild'),
  }, null, 2));
  const kitAfter = after.anchors.find((a) => a.name === 'kitChild');
  assert.ok(kitAfter.hit, `the late kit child must render after discovery (wanted class 17 at ${JSON.stringify(kitAfter.pixel)})`);
  assert.equal(kitAfter.hit.cls, 17, `the kit child adapter must carry level-only receiver bits (17), got ${kitAfter.hit.cls}`);
  assert.ok(kitAfter.hit.depth < 1, 'the kit child must write real depth');
  check('late-kit-child-discovery-receiver', { pixel: kitAfter.hit.pixel, cls: 17, depth: kitAfter.hit.depth });

  // ---- capture -----------------------------------------------------------------
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/task3-scene.png`, Buffer.from(shot.result.data, 'base64'));
  check('capture-written', { file: `${out}/task3-scene.png` });

  results.pass = true;
} finally {
  writeFileSync(`${out}/task3-scene-check.json`, JSON.stringify(results, null, 2));
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
