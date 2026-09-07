// Hybrid deferred M1 — assertion-driven WebGPU gate for sdf-deferred.html.
// Start vite + CDP Chrome first (scripts/deferred-check.sh does), then:
//   node scripts/deferred-check.mjs 5306 9306
//
// Every check below is an ASSERTION against real GPU output (readbacks,
// screenshots, generated WGSL). A shader/GPU validation error fails the run —
// nothing is waived by a timeout or merely logged. Evidence (validation.json,
// PNGs) lands in docs/dev-notes/2026-09-06-hybrid-deferred-m1/.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5306), cdp = Number(process.argv[3] ?? 9306);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m1';
const SKIP_TIMING = process.env.DEFERRED_SKIP_TIMING === '1';
mkdirSync(out, { recursive: true });

const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
const errors = [], checks = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description));
  }
};
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 180000 });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, detail) => { checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail)); };
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/task3-${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('SHOT', name);
};

async function boot(query) {
  errors.length = 0;
  // vite binds `localhost` (IPv6 on this machine) — 127.0.0.1 gets connection
  // refused even though the CDP endpoint answers on it.
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-deferred.html${query ? `?${query}` : ''}` });
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (errors.length) throw new Error(`page errors during boot: ${JSON.stringify(errors)}`);
    if (await evaluate('!!(window.__deferredLab && __deferredLab.ready)')) return;
  }
  throw new Error('boot timeout — __deferredLab.ready never flipped');
}
const diag = () => evaluate('__deferredLab.diagnostics()');
const surfaces = (opts = {}) => evaluate(`__deferredLab.readSurfaces(${JSON.stringify(opts)})`);
const step = (n = 2) => evaluate(`__deferredLab.step(${n})`);
/** DOM control state for the visible-controls-match-mode assertion. */
const controlState = () => evaluate(`(() => {
  const rows = [...document.querySelectorAll('#panel label')];
  const row = (prefix) => rows.find((l) => l.textContent.trim().startsWith(prefix));
  return {
    mode: row('mode')?.querySelector('select')?.value,
    scale: row('sdf scale')?.querySelector('select')?.value,
    debug: row('debug view')?.querySelector('select')?.value,
    playPause: [...document.querySelectorAll('#panel button')].map((b) => b.textContent),
  };
})()`);

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ---- A. startup mode: default + both explicit query modes ----------------
  await boot('');
  let d = await diag();
  assert.equal(d.mode, 'deferred', 'default launch must be deferred');
  assert.equal(d.backend, 'webgpu');
  assert.deepEqual([d.canvas.width, d.canvas.height], [800, 600]);
  assert.equal(d.layer.limits.supported, true);
  assert.equal(d.layer.limits.ok, true);
  let ctl = await controlState();
  assert.equal(ctl.mode, 'deferred', 'mode select must match actual mode');
  assert.ok(ctl.playPause.includes('pause lights'), 'lights animated by default');
  check('startup-default-deferred', { backend: d.backend, canvas: d.canvas, limits: d.layer.limits.checks });

  await boot('mode=legacy');
  d = await diag();
  assert.equal(d.mode, 'legacy', '?mode=legacy must launch in legacy');
  ctl = await controlState();
  assert.equal(ctl.mode, 'legacy');
  check('startup-query-legacy', {});

  await boot('mode=deferred');
  d = await diag();
  assert.equal(d.mode, 'deferred', '?mode=deferred must launch in deferred');
  check('startup-query-deferred', {});

  // ---- B. coverage, resolve, light invariance (fixed geometry) -------------
  await evaluate('__deferredLab.setMode("deferred"); __deferredLab.setCameraPose("overview")');
  await evaluate('__deferredLab.setOrbsVisible(false); __deferredLab.setLightTime(0)');
  await step();
  const A = await surfaces({ resolveCheck: true, probes: [[4, 4], [795, 4], [4, 595], [795, 595]] });
  assert.ok(A.coverage.mesh > 1000, `real mesh coverage, got ${A.coverage.mesh}`);
  assert.ok(A.coverage.flesh > 1000, `real flesh coverage, got ${A.coverage.flesh}`);
  // The room is an enclosed box — legitimately ZERO empty pixels here (the
  // task-1/2 smokes validated the depth-1/class-0 sentinels on open scenes).
  // The background-suppression (fix 3) evidence on THIS fixture: flesh wins
  // where the zombie is in front of stone, no pixel lands in an undefined
  // class, and the CPU re-resolve of the producer buffers matches exactly.
  assert.equal(A.coverage.other, 0, `undefined material classes: ${JSON.stringify(A.coverage)}`);
  assert.equal(A.resolveCheck.mismatches, 0, `CPU re-resolve must match GPU resolve: ${JSON.stringify(A.resolveCheck.examples)}`);
  assert.ok(A.litMean.mesh > 0 && A.litMean.flesh > 0, 'lit means must be non-black');
  for (const p of A.probes) {
    assert.ok(p.cls === 1 && p.depth < 1, `corner probe (${p.x},${p.y}) must be room mesh, got cls ${p.cls} depth ${p.depth}`);
  }
  check('coverage-and-resolve', {
    coverage: A.coverage, litMean: A.litMean,
    overlap: { meshWins: A.resolveCheck.overlapMeshWins, sdfWins: A.resolveCheck.overlapSdfWins },
  });

  await evaluate('__deferredLab.setLightTime(1.25)');
  await step();
  const B = await surfaces();
  for (const k of ['albedo', 'normal', 'emission', 'depth']) {
    assert.equal(B.hashes[k], A.hashes[k], `${k} must be bit-invariant under a light change (fixed geometry, orbs hidden)`);
  }
  assert.notEqual(B.hashes.lit, A.hashes.lit, 'lit output must change when lights move');
  const relMesh = Math.abs(B.litMean.mesh - A.litMean.mesh) / A.litMean.mesh;
  const relFlesh = Math.abs(B.litMean.flesh - A.litMean.flesh) / A.litMean.flesh;
  assert.ok(relMesh > 0.005, `mesh litMean must move with the lights (${relMesh})`);
  assert.ok(relFlesh > 0.005, `flesh litMean must move with the lights (${relFlesh})`);
  check('light-invariance', { litHashChanged: true, relMesh, relFlesh });
  await evaluate('__deferredLab.setLightTime(0)');
  await step(1);

  // ---- C. occlusion both directions at SDF scales 1 and 0.5 -----------------
  const occ = {};
  for (const scale of [1, 0.5]) {
    await evaluate(`__deferredLab.setSdfScale(${scale})`);
    const layer = (await diag()).layer;
    assert.deepEqual(layer.sdfTargetSize, { width: 800 * scale, height: 600 * scale });
    await evaluate('__deferredLab.setCameraPose("mesh-front")');
    await step();
    const mf = await surfaces({ resolveCheck: true });
    assert.equal(mf.resolveCheck.mismatches, 0, `mesh-front @${scale}: ${JSON.stringify(mf.resolveCheck.examples)}`);
    assert.ok(mf.resolveCheck.overlapMeshWins > 0, 'mesh-front must have pixels where the mesh occludes flesh');
    assert.ok(mf.coverage.mesh > 500 && mf.coverage.flesh > 500);
    await evaluate('__deferredLab.setCameraPose("sdf-front")');
    await step();
    const sf = await surfaces({ resolveCheck: true });
    assert.equal(sf.resolveCheck.mismatches, 0, `sdf-front @${scale}: ${JSON.stringify(sf.resolveCheck.examples)}`);
    assert.ok(sf.resolveCheck.overlapSdfWins > 0, 'sdf-front must have pixels where flesh occludes the mesh');
    assert.ok(sf.coverage.mesh > 500 && sf.coverage.flesh > 500);
    occ[`scale${scale}`] = {
      meshFrontWins: mf.resolveCheck.overlapMeshWins,
      sdfFrontWins: sf.resolveCheck.overlapSdfWins,
    };
  }
  check('occlusion-both-directions-both-scales', occ);
  await evaluate('__deferredLab.setSdfScale(1); __deferredLab.setCameraPose("overview")');

  // ---- D. wounds change depth + tissue, deterministically -------------------
  await evaluate('__deferredLab.setCameraPose("wound")');
  await step();
  const wOn = await surfaces();
  assert.ok(wOn.coverage.flesh > 5000, 'wound close-up must be flesh-dominated');
  await evaluate('__deferredLab.setWounded(false)');
  await step();
  const wOff = await surfaces();
  assert.notEqual(wOff.hashes.depth, wOn.hashes.depth, 'wounds must change the traced depth');
  assert.notEqual(wOff.hashes.albedo, wOn.hashes.albedo, 'wounds must change tissue albedo');
  assert.ok(wOff.coverage.flesh > 5000);
  await evaluate('__deferredLab.setWounded(true)');
  await step();
  const wOn2 = await surfaces();
  for (const k of ['albedo', 'normal', 'emission', 'depth']) {
    assert.equal(wOn2.hashes[k], wOn.hashes[k], `wound re-apply must be deterministic (${k})`);
  }
  check('wound-depth-tissue-deterministic', { fleshPx: wOn.coverage.flesh });

  // ---- E. same-wound-state legacy/SDF depth comparison (scale 1) ------------
  await evaluate('__deferredLab.setMode("legacy")');
  await step();
  const leg = await evaluate('__deferredLab.readLegacySdf()');
  assert.ok(leg.hits > 5000, `legacy march must hit flesh, got ${leg.hits}`);
  await evaluate('__deferredLab.setMode("deferred")');
  await step();
  const coords = leg.samples.filter(([, , dd]) => dd < 1).slice(0, 400).map(([x, y]) => [x, y]);
  const comp = await surfaces({ probes: coords });
  let compared = 0, maxDiff = 0;
  for (let i = 0; i < coords.length; i++) {
    const p = comp.probes[i];
    if (p.cls !== 2) continue; // mesh won this pixel in the resolve — not an SDF sample
    const dd = Math.abs(p.depth - leg.samples[i][2]);
    compared++;
    if (dd > maxDiff) maxDiff = dd;
  }
  assert.ok(compared > 20, `need real legacy/deferred depth comparisons, got ${compared}`);
  assert.ok(maxDiff < 1e-4, `legacy vs deferred SDF hit depth max diff ${maxDiff}`);
  check('legacy-sdf-depth-parity', { legacyHits: leg.hits, compared, maxDiff });

  // ---- F. resize: explicit reallocation + CSS-only window resize ------------
  await evaluate('__deferredLab.setCameraPose("overview"); __deferredLab.setLightTime(0)');
  await step();
  const beforeResize = await surfaces();
  await evaluate('__deferredLab.setResolution(640, 480)');
  await step();
  d = await diag();
  assert.deepEqual([d.canvas.width, d.canvas.height], [640, 480]);
  const small = await surfaces({ resolveCheck: true });
  assert.deepEqual([small.width, small.height], [640, 480]);
  assert.ok(small.coverage.mesh > 500 && small.coverage.flesh > 500, 'coverage must survive reallocation');
  assert.equal(small.resolveCheck.mismatches, 0);
  await evaluate('__deferredLab.setResolution(800, 600)');
  await step();
  const restored = await surfaces();
  for (const k of ['albedo', 'normal', 'emission', 'depth']) {
    assert.equal(restored.hashes[k], beforeResize.hashes[k], `no stale data after 800->640->800 reallocation (${k})`);
  }
  check('explicit-reallocation', { small: [small.width, small.height], restoredIdentical: true });

  const cssBefore = await surfaces();
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  await step(1);
  d = await diag();
  assert.deepEqual([d.canvas.width, d.canvas.height], [800, 600], 'window resize must be presentation-only');
  const cssAfter = await surfaces();
  for (const k of ['albedo', 'normal', 'emission', 'depth']) {
    assert.equal(cssAfter.hashes[k], cssBefore.hashes[k], `fixed 800x600 must be invariant under CSS resize (${k})`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check('css-resize-invariance', { canvas: d.canvas });

  // ---- G. repeated mode switches keep both pipelines healthy -----------------
  for (let i = 0; i < 3; i++) {
    await evaluate('__deferredLab.setMode("legacy")');
    await step(1);
    const l = await evaluate('__deferredLab.readLegacySdf()');
    assert.ok(l.hits > 1000, `legacy render dead after switch ${i}`);
    await evaluate('__deferredLab.setMode("deferred")');
    await step(1);
    const s = await surfaces();
    assert.equal(s.hashes.depth, cssBefore.hashes.depth, `deferred depth changed across mode switch ${i}`);
    assert.ok(s.coverage.mesh > 1000 && s.coverage.flesh > 1000);
  }
  check('repeated-mode-switches', { cycles: 3 });

  writeFileSync(`${out}/validation-partial.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log('PART 1 COMPLETE —', checks.length, 'checks');
} catch (e) {
  console.error('FAIL', e);
  writeFileSync(`${out}/validation-partial.json`, JSON.stringify({ checks, errors, failure: String(e) }, null, 2));
  await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); ws.close();
  process.exit(1);
}
