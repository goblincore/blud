// Hybrid deferred M2 task 4 — assertion-driven WebGPU gate for the explicit
// flashlight shadow maps and receiver-aware sampling (sdf-deferred-shadows.html).
// Start vite + CDP Chrome first (scripts/deferred-shadow-check.sh does), then:
//   node scripts/deferred-shadow-check.mjs 5330 9330
//
// Every check is an ASSERTION against real GPU output or factory counters:
//   boot-clean                  no page/WebGPU errors
//   caster-counters             full vs level-only selection, hull in, shrunk out
//   null-binding-m1-default     unbound output hash == bound-but-not-sampling hash
//   sampling-changes-output     on-hash != off-hash
//   flesh-level-occlusion       pillar-occluded flesh darkens (level-only map)
//   no-hull-self-shadow         unoccluded flesh stays lit (ratio >= 0.9)
//   proxy-shadow-on-stone       darkened floor pixels are proxy-explained,
//                               coherent (largest component), retained coords
//   same-frame-light-motion     one step after a light move: binding matrix +
//                               shadow centroid flip to the new pose
//   map-render-ablation         disabled update -> renderedMaps 0, no stale
//                               shadow on re-enable (hash returns)
// Evidence (masks with coordinates, counters, hashes) lands in
// docs/dev-notes/2026-09-06-hybrid-deferred-m2/.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5330), cdp = Number(process.argv[3] ?? 9330);
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
const assertNoPageErrors = async (stage) => {
  const errs = await evaluate('__deferredShadows.errors');
  assert.deepEqual(errs, [], `${stage}: page must be error-free (got ${JSON.stringify(errs)})`);
};

const screenshot = async (name) => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}`, Buffer.from(shot.data, 'base64'));
};

const results = { checks, errors, pass: false };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ---- boot -----------------------------------------------------------------
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-deferred-shadows.html` });
  let booted = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (errors.length) throw new Error(`page errors during boot: ${JSON.stringify(errors)}`);
    if (await evaluate('!!(window.__deferredShadows && __deferredShadows.ready)')) { booted = true; break; }
  }
  assert.ok(booted, 'boot timeout — __deferredShadows.ready never flipped');
  const pageErrors = await evaluate('__deferredShadows.errors');
  assert.deepEqual(pageErrors, [], 'page must boot without recorded errors');
  check('boot-clean', { ok: true });

  // ---- caster counters --------------------------------------------------------
  const diag = await evaluate('__deferredShadows.diagnostics()');
  assert.equal(diag.shadows.renderedMaps, 2, 'both maps must render when enabled');
  assert.ok(diag.shadows.fullCasters >= 5, `full map expects room+pillar+cutout+hull, got ${JSON.stringify(diag.shadows)}`);
  assert.ok(diag.shadows.levelCasters >= 4, `level map expects room+pillar+cutout (no hull), got ${JSON.stringify(diag.shadows)}`);
  assert.equal(diag.shadows.fullCasters - diag.shadows.levelCasters, 1, 'exactly the inflated hull must be full-only');
  assert.equal(diag.shadows.unsupported.filter((u) => !u.includes('cutout')).length, 0, 'no unsupported casters expected');
  assert.equal(diag.layer.bound, false, 'binding not yet stored at boot');
  check('caster-counters', diag.shadows);

  // ---- M1 default: null binding vs bound-but-not-sampling ---------------------
  const nullHash = await evaluate('__deferredShadows.litHash()');
  await evaluate('__deferredShadows.setSampling(false)');
  const boundOffHash = await evaluate('__deferredShadows.litHash()');
  assert.equal(boundOffHash, nullHash, 'a stored sampling-disabled binding must not change the M1 output');
  const diagAfterBind = await evaluate('__deferredShadows.diagnostics()');
  assert.equal(diagAfterBind.layer.bound, true);
  assert.equal(diagAfterBind.layer.sampling, false);
  check('null-binding-m1-default', { nullHash, boundOffHash });

  // ---- sampling on: maps census + masks ----------------------------------------
  const maps = await evaluate('__deferredShadows.readMaps()');
  assert.ok(maps.full.far < maps.full.total * 0.95, `FULL map looks empty (far ${maps.full.far}/${maps.full.total})`);
  assert.ok(maps.level.far < maps.level.total * 0.95, `LEVEL map looks empty (far ${maps.level.far}/${maps.level.total})`);
  check('map-content', maps);
  await assertNoPageErrors('after map census');

  const pair = await evaluate('__deferredShadows.capturePair()');
  await assertNoPageErrors('after sampling-on capture');
  assert.notEqual(pair.onHash, pair.offHash, 'shadow sampling must change the lit output');
  check('sampling-changes-output', { onHash: pair.onHash, offHash: pair.offHash });

  const m = pair.masks;
  // Level occlusion of FLESH (the level-only map must contain the pillar).
  const foRatio = m.fleshOccluded.meanOn / Math.max(m.fleshOccluded.meanOff, 1e-6);
  assert.ok(m.fleshOccluded.count > 200, `pillar-occluded flesh coverage too small: ${JSON.stringify({ flesh: m.fleshOccluded, lightPos: m.lightPos })}`);
  assert.ok(foRatio < 0.7, `pillar-occluded flesh expected to darken (ratio ${foRatio.toFixed(3)})`);
  check('flesh-level-occlusion', { ...m.fleshOccluded, ratio: foRatio });

  // No inflated-hull self-shadowing: flesh the pillar does not block stays lit.
  const fcRatio = m.fleshClear.meanOn / Math.max(m.fleshClear.meanOff, 1e-6);
  assert.ok(m.fleshClear.count > 500, `clear flesh coverage too small: ${m.fleshClear.count}`);
  assert.ok(fcRatio > 0.9, `clear flesh must not self-shadow (ratio ${fcRatio.toFixed(3)})`);
  check('no-hull-self-shadow', { ...m.fleshClear, ratio: fcRatio });

  // Coherent proxy shadow on stone.
  assert.ok(m.floor.proxyDarkenedFraction > 0.6,
    `darkened floor must be proxy-explained (fraction ${m.floor.proxyDarkenedFraction.toFixed(3)}, dark=${m.floor.darkenedProxy}, other=${m.floor.darkenedOther})`);
  assert.ok(m.floor.darkenedProxy > 300, `proxy shadow too small: ${m.floor.darkenedProxy} px`);
  assert.ok(m.floor.largestComponent > 150, `proxy shadow not coherent: largest component ${m.floor.largestComponent}`);
  check('proxy-shadow-on-stone', m.floor);

  await screenshot('task4-shadow-on.png');

  // ---- same-frame light motion --------------------------------------------------
  const before = {
    matrix: await evaluate('__deferredShadows.bindingMatrixSnapshot()'),
    masks: pair.masks,
  };
  await evaluate('__deferredShadows.moveLight()');
  // ONE step: the shadow update + layer render of the SAME frame must use the
  // new pose — no one-frame delay.
  const movedMatrix = await evaluate('(function(){ __deferredShadows.step(1); return __deferredShadows.bindingMatrixSnapshot(); })()');
  assert.notDeepStrictEqual(movedMatrix, before.matrix, 'binding viewProjection must update in the same frame as the light move');
  const pair2 = await evaluate('__deferredShadows.capturePair()');
  const wx1 = before.masks.floor.proxyShadowMeanWorldX, wx2 = pair2.masks.floor.proxyShadowMeanWorldX;
  assert.ok(wx1 !== null && wx2 !== null, 'both poses must produce a proxy-explained floor shadow');
  // Light flips sides (+x -> -x): the WORLD shadow region flips to the other
  // side of the body at origin. The screen centroid is retained as evidence.
  assert.ok(wx1 < -0.05 && wx2 > 0.05, `proxy shadow must flip sides of the body in WORLD space: ${JSON.stringify([wx1, wx2])}`);
  const c1 = before.masks.floor.centroid, c2 = pair2.masks.floor.centroid;
  const movedPx = c1 && c2 ? Math.hypot(c1[0] - c2[0], c1[1] - c2[1]) : -1;
  assert.ok(movedPx > 40, `screen shadow centroid must move with the light: ${JSON.stringify([c1, c2])}`);
  check('same-frame-light-motion', { meanWorldXBefore: wx1, meanWorldXAfter: wx2, centroidBefore: c1, centroidAfter: c2, matrixChanged: true });

  await screenshot('task4-shadow-on-moved.png');

  // ---- map-render ablation (?spotshadow=0 semantics) -----------------------------
  await evaluate('__deferredShadows.setSampling(false)');
  await evaluate('__deferredShadows.setMaps(false)');
  const abl = await evaluate('__deferredShadows.diagnostics()');
  assert.equal(abl.shadows.renderedMaps, 0, 'disabled update must render ZERO maps');
  assert.equal(abl.shadows.enabled, false);
  const offHashAbl = await evaluate('__deferredShadows.litHash()');
  assert.equal(offHashAbl, nullHash, 'no stale shadow may remain while disabled');
  // Re-enable: maps render again, sampling reproduces the shadow.
  await evaluate('__deferredShadows.setMaps(true)');
  const reDiag = await evaluate('__deferredShadows.diagnostics()');
  assert.equal(reDiag.shadows.renderedMaps, 2, 're-enabled update must render both maps again');
  const reHash = await evaluate('__deferredShadows.litHash()');
  await evaluate('__deferredShadows.setSampling(true)');
  const reOnHash = await evaluate('__deferredShadows.litHash()');
  assert.notEqual(reOnHash, reHash, 're-enabled sampling must darken again (no lockout)');
  check('map-render-ablation', { renderedMapsDisabled: 0, renderedMapsReenabled: reDiag.shadows.renderedMaps, offHashAbl, reOnHash });

  // ---- shadow-off screenshot + evidence ------------------------------------------
  await evaluate('__deferredShadows.setSampling(false)');
  await evaluate('__deferredShadows.step(2)');
  await screenshot('task4-shadow-off.png');

  writeFileSync(`${out}/task4-shadow-check.json`, JSON.stringify({
    ...results,
    bootDiag: diag,
    firstPair: { onHash: pair.onHash, offHash: pair.offHash, masks: pair.masks },
    movedPair: { onHash: pair2.onHash, offHash: pair2.offHash, masks: pair2.masks },
  }, null, 2));
  results.pass = true;
  console.log('ALL CHECKS PASS');
} finally {
  // Close the owned tab + socket on SUCCESS as well as failure. The full
  // evidence file is written above on success; the finally block must not
  // clobber it — it only preserves the failure record.
  try { await send('Page.close'); } catch { /* tab may already be gone */ }
  try { ws.close(); } catch { /* already closed */ }
  if (!results.pass) {
    writeFileSync(`${out}/task4-shadow-check.json`, JSON.stringify(results, null, 2));
  }
}
