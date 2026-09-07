// Hybrid deferred M1 — assertion-driven WebGPU gate for sdf-deferred.html.
// Start vite + CDP Chrome first (scripts/deferred-check.sh does), then:
//   node scripts/deferred-check.mjs 5306 9306
//
// Every check below is an ASSERTION against real GPU output (readbacks,
// screenshots, generated WGSL). A shader/GPU validation error fails the run —
// nothing is waived by a timeout or merely logged. Evidence (validation.json,
// PNGs) lands in docs/dev-notes/2026-09-06-hybrid-deferred-m1/; the M2 task-1
// section (T1) additionally writes its evidence into
// docs/dev-notes/2026-09-06-hybrid-deferred-m2/.
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
const shot = async (name, dir = out) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('SHOT', name);
};

async function boot(query, paused = true) {
  // vite binds `localhost` (IPv6 on this machine) — 127.0.0.1 gets connection
  // refused even though the CDP endpoint answers on it.
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-deferred.html?${paused ? 'paused=1&' : ''}${query}` });
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
  await boot('', false);
  const initialTime = (await diag()).lightTime;
  await sleep(500);
  assert.ok((await diag()).lightTime > initialTime, 'default page must animate without clicking Run');
  await evaluate('__deferredLab.setLoopRunning(false)');
  check('default-loop-animates', {});
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

  // ---- H. orb markers: position/color correspondence + cross-producer depth test
  await evaluate('__deferredLab.setCameraPose("overview"); __deferredLab.setOrbsVisible(true)');
  await evaluate('__deferredLab.setLightCount(3); __deferredLab.setLightTime(0.7)');
  await step();
  const orbState = await evaluate('__deferredLab.orbState()');
  const onScreen = orbState.orbs.filter((o) => o.onScreen);
  assert.ok(onScreen.length > 0, 'no orb markers on screen at overview');
  const orbProbes = await surfaces({ probes: onScreen.map((o) => [Math.round(o.pixel[0]), Math.round(o.pixel[1])]) });
  let markersSeen = 0;
  const markerDetail = [];
  for (let i = 0; i < onScreen.length; i++) {
    const o = onScreen[i], p = orbProbes.probes[i];
    const em = p.emission;
    const emLum = 0.2126 * em[0] + 0.7152 * em[1] + 0.0722 * em[2];
    if (emLum > 0.5) {
      const emLen = Math.hypot(em[0], em[1], em[2]);
      const cLen = Math.hypot(...o.color);
      const cos = (em[0] * o.color[0] + em[1] * o.color[1] + em[2] * o.color[2]) / (emLen * cLen);
      assert.ok(cos > 0.95, `orb ${o.index} emission hue mismatch (cos ${cos})`);
      markersSeen++;
      markerDetail.push({ index: o.index, seen: true, hueCos: Math.round(cos * 1000) / 1000 });
    } else {
      // Not the marker at its own projected pixel: only valid if NEARER
      // geometry won the depth test there.
      assert.ok(p.depth < o.clipDepth - 1e-4,
        `orb ${o.index} marker missing without occlusion (probe depth ${p.depth}, orb clip ${o.clipDepth})`);
      markerDetail.push({ index: o.index, seen: false, occludedBy: p.depth, orbDepth: o.clipDepth });
    }
  }
  assert.ok(markersSeen > 0, 'no emissive orb markers found');
  check('orb-marker-correspondence', { markersSeen, onScreen: onScreen.length, markerDetail });

  // Explicit marker occlusion across producers: at t=3.7 orb 0 sits at
  // (-0.20, 1.68, -1.03), behind the zombie's shoulder from the wound camera
  // — flesh (SDF producer) must depth-win over the orb (mesh producer).
  // (t=pi/0.9 puts the orb at x=0 where the ray threads just past the head —
  // verified by a t-scan: 3.2/3.7/3.9 occluded, 2.6-3.0/3.49/4.1+ visible.)
  await evaluate('__deferredLab.setCameraPose("wound"); __deferredLab.setLightTime(3.7)');
  await step();
  const occState = await evaluate('__deferredLab.orbState()');
  const orb0 = occState.orbs.find((o) => o.index === 0);
  assert.ok(orb0.onScreen, `orb 0 off-screen at the occlusion time: ${JSON.stringify(orb0)}`);
  const occProbe = await surfaces({ probes: [[Math.round(orb0.pixel[0]), Math.round(orb0.pixel[1])]] });
  const op = occProbe.probes[0];
  const opEmLum = 0.2126 * op.emission[0] + 0.7152 * op.emission[1] + 0.0722 * op.emission[2];
  assert.ok(opEmLum < 0.5, `occluded orb still emissive (lum ${opEmLum})`);
  assert.equal(op.cls, 2, `the occluding surface must be FLESH, got class ${op.cls}`);
  assert.ok(op.depth < orb0.clipDepth - 1e-4, `flesh did not depth-win over the orb (${op.depth} vs ${orb0.clipDepth})`);
  check('orb-occluded-by-flesh', { cls: op.cls, depth: op.depth, orbClip: orb0.clipDepth });

  // ---- I. pause/resume without a jump, count changes update lights+markers --
  await evaluate('__deferredLab.setCameraPose("overview"); __deferredLab.setLightTime(3.3)');
  let d2 = await diag();
  assert.equal(d2.lightsAnimated, false);
  assert.equal(d2.lightTime, 3.3);
  await step(3);
  d2 = await diag();
  assert.equal(d2.lightTime, 3.3, 'frozen light time must not advance while paused');
  await evaluate('__deferredLab.setLightsAnimated(true)');
  await step(2);
  d2 = await diag();
  assert.ok(d2.lightTime > 3.3 && d2.lightTime < 3.4, `resume must continue from frozen t, got ${d2.lightTime}`);
  check('pause-resume-no-jump', { resumedAt: d2.lightTime });

  await evaluate('__deferredLab.setOrbsVisible(false); __deferredLab.setLightTime(0.7)');
  const litByCount = {};
  for (const n of [1, 8, 16, 3]) {
    await evaluate(`__deferredLab.setLightCount(${n})`);
    await step(1);
    const st = await evaluate('__deferredLab.orbState()');
    assert.equal(st.orbs.length, n, `marker set must track light count ${n}`);
    const dd = await diag();
    assert.equal(dd.layer.lightCount, n, `shared light buffer must track count ${n}`);
    const s = await surfaces();
    litByCount[n] = s.litMean.mesh;
  }
  assert.ok(litByCount[16] > litByCount[1], `16 lights must add energy over 1 (${JSON.stringify(litByCount)})`);
  check('light-count-updates', { litMeanMeshByCount: litByCount });

  // ---- J. light COLOR reaches the lit surface (hue swing on flesh) ----------
  await evaluate('__deferredLab.setCameraPose("wound")');
  const grid = [];
  for (let y = 20; y < 600; y += 30) for (let x = 20; x < 800; x += 30) grid.push([x, y]);
  const hueRatio = async (color) => {
    await evaluate(`__deferredLab.setCustomLights([{kind:'point', position:[0.2,1.5,0.9], direction:[0,-1,0], color:${JSON.stringify(color)}, intensity:20, range:6, cosInner:0.9, cosOuter:0.7}])`);
    await step();
    const s = await surfaces({ probes: grid });
    let r = 0, g = 0, b = 0, n = 0;
    for (const p of s.probes) if (p.cls === 2) { r += p.lit[0]; g += p.lit[1]; b += p.lit[2]; n++; }
    assert.ok(n > 50, `too few flesh probes for hue check (${n})`);
    return { rOverB: (r / n) / Math.max(b / n, 1e-6), fleshProbes: n };
  };
  const redHue = await hueRatio([1, 0.05, 0.05]);
  const cyanHue = await hueRatio([0.05, 1, 1]);
  assert.ok(redHue.rOverB > 1.5, `red light must push flesh red (r/b ${redHue.rOverB})`);
  assert.ok(cyanHue.rOverB < 0.7, `cyan light must push flesh blue-green (r/b ${cyanHue.rOverB})`);
  check('light-color-correspondence', { red: redHue, cyan: cyanHue });

  // ---- K. world reconstruction: isolated tight spot centroid (review fix 1) -
  await evaluate('__deferredLab.setCameraPose("overview"); __deferredLab.setOrbsVisible(false)');
  // Tight cone: a wide pool has a legitimate perspective weighting bias
  // (nearer floor texels cover more pixels, pulling the centroid toward the
  // camera — measured 4.05px at a 8-11deg cone); shrinking the cone removes
  // the bias while a reconstruction error (e.g. a doubled half-pixel) would
  // persist. This coarse check detects large reconstruction errors; the
  // layer regression test specifically covers the half-pixel convention.
  await evaluate(`__deferredLab.setCustomLights([{kind:'spot', position:[0.9,2.6,-0.9], direction:[0,-1,0], color:[1,1,1], intensity:120, range:8, cosInner:0.9995, cosOuter:0.998}])`);
  await step();
  const proj = await evaluate('__deferredLab.projectWorld([0.9, 0, -0.9])');
  assert.ok(proj.onScreen, `spot target off-screen: ${JSON.stringify(proj)}`);
  const cent = await evaluate(`__deferredLab.litCentroid(${proj.pixel[0]}, ${proj.pixel[1]}, 40)`);
  assert.ok(cent.centroid, 'no lit pool found for the isolated spot');
  assert.ok(cent.count > 20, `pool too small to centroid (${cent.count}px)`);
  const distPx = Math.hypot(cent.centroid[0] - proj.pixel[0], cent.centroid[1] - proj.pixel[1]);
  assert.ok(distPx <= 2, `world reconstruction off by ${distPx}px`);
  check('world-reconstruction-centroid', { projected: proj.pixel.map((v) => Math.round(v * 100) / 100), centroid: cent.centroid.map((v) => Math.round(v * 100) / 100), distPx: Math.round(distPx * 1000) / 1000, poolPx: cent.count });
  await evaluate('__deferredLab.setCustomLights(null); __deferredLab.setLightTime(0)');

  // ---- L. generated shader: ONE marchSurface call before the readbacks ------
  const wgsl = await evaluate('__deferredLab.surfaceShader()');
  writeFileSync(`${out}/task3-surface-shader.wgsl`, wgsl);
  const marchOcc = (wgsl.match(/marchSurface\s*\(/g) || []).length;
  assert.equal(marchOcc, 2, `expected the fn definition + exactly ONE marchSurface call, got ${marchOcc} occurrences`);
  const callAt = wgsl.search(/=\s*marchSurface\s*\(/);
  assert.ok(callAt > 0, 'marchSurface call must assign the cached trace');
  for (const fn of ['sdfSurfaceReadAlbedo', 'sdfSurfaceReadNormal', 'sdfSurfaceReadEmission']) {
    const occ = (wgsl.match(new RegExp(fn + '\\s*\\(', 'g')) || []).length;
    assert.equal(occ, 2, `${fn}: expected fn def + ONE call, got ${occ}`);
    const fnCallAt = wgsl.search(new RegExp('=\\s*' + fn + '\\s*\\('));
    assert.ok(fnCallAt > callAt, `${fn} must be called AFTER the single march`);
  }
  check('one-trace-per-fragment-shader', { marchOcc, callAt });

  // ---- M. inspectable captures and deterministic moving-light sequence -----
  await evaluate('__deferredLab.setOrbsVisible(true); __deferredLab.setLightCount(3); __deferredLab.setWounded(true)');
  for (const scale of [1, 0.5]) {
    await evaluate(`__deferredLab.setSdfScale(${scale}); __deferredLab.setCameraPose("overview"); __deferredLab.setLightTime(0.7)`);
    for (const mode of ['legacy', 'deferred']) {
      await evaluate(`__deferredLab.setMode("${mode}")`); await step();
      await shot(`overview-${mode}-scale${scale}`);
    }
    for (const view of ['albedo', 'normal', 'depth', 'material']) {
      await evaluate(`__deferredLab.setDebugView("${view}")`); await step();
      await shot(`${view}-scale${scale}`);
    }
    await evaluate('__deferredLab.setDebugView("lit")');
    for (const pose of ['wound', 'mesh-front', 'sdf-front']) {
      await evaluate(`__deferredLab.setCameraPose("${pose}")`); await step();
      await shot(`${pose}-scale${scale}`);
    }
  }
  await evaluate('__deferredLab.setSdfScale(1); __deferredLab.setCameraPose("overview")');
  for (const t of [0, 0.7, 1.4, 2.1]) {
    await evaluate(`__deferredLab.setLightTime(${t})`); await step();
    await shot(`orbs-t${t}`);
  }
  check('captures-written', { scales: [1, 0.5], orbTimes: [0, 0.7, 1.4, 2.1] });

  // ---- T1. M2 task 1: owned output target, forward composition, environment
  // Evidence lands in docs/dev-notes/2026-09-06-hybrid-deferred-m2/.
  const m2 = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
  await evaluate('__deferredLab.setMode("deferred"); __deferredLab.setCameraPose("wound")');
  await evaluate('__deferredLab.setOrbsVisible(false); __deferredLab.setLightTime(0.7); __deferredLab.setDebugView("lit")');
  await step();

  // Owned-target present + forward composition: a known white quad in FRONT
  // of the chest must win against the presented depth; one BEHIND it (on a
  // separate pixel) must be occluded by the body; with the mesh scene EMPTY a
  // quad in a truly-empty region must be visible (empty pixels wrote far
  // depth). Canvas presentation is restored at the end.
  const compRep = await evaluate('__deferredLab.presentComposition()');
  writeFileSync(`${m2}/task1-composition.json`, JSON.stringify(compRep, null, 2));
  assert.ok(compRep.outputRestored, 'canvas presentation must be restored after the owned-target render');
  assert.equal(compRep.chest.cls, 2, `chest probe pixel must resolve as flesh (${JSON.stringify(compRep.chest)})`);
  assert.ok(compRep.front.beforeLum > 0, `chest pixel must show lit content (${JSON.stringify(compRep.front)})`);
  assert.ok(compRep.front.afterLum - compRep.front.beforeLum > 1.0,
    `front quad must WIN against the presented depth (${JSON.stringify(compRep.front)})`);
  assert.equal(compRep.behind.cls, 2, 'behind pixel must resolve as flesh');
  assert.ok(compRep.behind.depth < 1, 'behind pixel must carry a real body depth');
  assert.ok(Math.abs(compRep.behind.afterLum - compRep.behind.beforeLum) < 0.25,
    `behind quad must be OCCLUDED by the presented body depth (${JSON.stringify(compRep.behind)})`);
  assert.equal(compRep.empty.cls, 0, 'frame-B probe pixel must be empty');
  assert.equal(compRep.empty.depth, 1, 'empty pixels must present far depth');
  assert.ok(compRep.empty.beforeLum < 0.05, `empty pixel must present black before the forward draw (${compRep.empty.beforeLum})`);
  assert.ok(compRep.empty.afterLum - compRep.empty.beforeLum > 1.0,
    `forward quad in an empty region must be VISIBLE — empty depth must be far (${JSON.stringify(compRep.empty)})`);
  check('owned-target-forward-composition', compRep);
  await shot('task1-canvas-restored', m2);

  // Environment: defaults are the M1 constants with fog OFF; setting the same
  // defaults explicitly is lit-identical; enabling fog changes the LIT stage
  // only (surface hashes untouched) and darkens distant flesh toward fogColor;
  // restoring returns the exact baseline hash.
  const envState = await surfaces();
  const litBase = envState.hashes.lit;
  const surfaceHashes = (({ albedo, normal, emission, depth }) => ({ albedo, normal, emission, depth }))(envState.hashes);
  const dEnv = (await diag()).layer.environment;
  assert.deepEqual(dEnv.ambient, [0.05, 0.05, 0.055], `M1 ambient default (${JSON.stringify(dEnv)})`);
  assert.equal(dEnv.fogEnabled, false, 'fog must default OFF (M1 behaviour)');
  await evaluate('__deferredLab.setLayerEnvironment(null)');
  await step();
  assert.equal((await surfaces()).hashes.lit, litBase, 'explicit default environment must be lit-identical');
  await evaluate('__deferredLab.setLayerEnvironment({ ambient: [0.05, 0.05, 0.055], fogColor: [0, 0, 0], fogNear: 0.5, fogFar: 2.5, fogEnabled: true })');
  await step();
  const fogged = await surfaces();
  assert.notEqual(fogged.hashes.lit, litBase, 'fog must change the lit stage');
  for (const k of Object.keys(surfaceHashes)) {
    assert.equal(fogged.hashes[k], surfaceHashes[k], `fog must NOT touch the ${k} surface output`);
  }
  assert.ok(fogged.litMean.flesh < envState.litMean.flesh,
    `fog must darken flesh toward fogColor (${fogged.litMean.flesh} vs ${envState.litMean.flesh})`);
  assert.equal((await surfaces({ probes: [[400, 300]] })).probes[0].cls, 2, 'flesh probes must still decode as flesh under fog');
  await evaluate('__deferredLab.setLayerEnvironment(null)');
  await step();
  assert.equal((await surfaces()).hashes.lit, litBase, 'environment restore must return the exact M1 baseline');
  check('environment-defaults-and-fog', { litBase, fogFlesh: fogged.litMean.flesh, baseFlesh: envState.litMean.flesh });

  // Flashlight shadow binding RESERVATION: stored + reported, changes no
  // output until task 4 implements sampling.
  assert.equal((await diag()).layer.flashlightShadowBound, false, 'no shadow binding by default');
  await evaluate('__deferredLab.setSpotShadowBinding({ lightIndex: 0, bias: 0.001, mapSize: [1024, 1024], enabled: true })');
  await step();
  const boundState = await surfaces();
  assert.equal((await diag()).layer.flashlightShadowBound, true, 'binding must be reported as stored');
  for (const k of ['lit', ...Object.keys(surfaceHashes)]) {
    assert.equal(boundState.hashes[k], k === 'lit' ? litBase : surfaceHashes[k],
      `a RESERVED binding must not change ${k} output`);
  }
  await evaluate('__deferredLab.setSpotShadowBinding(null)');
  await step();
  assert.equal((await diag()).layer.flashlightShadowBound, false, 'null resets the binding');
  check('flashlight-shadow-reservation', { bound: true, outputUnchanged: true });

  // ---- N. repeated alternating completed-frame wall timing -----------------
  // Geometry/camera/resolution match. Shading does NOT: legacy flesh sees only
  // orb 0 plus its static key, while deferred flesh receives every light.
  const timings = [];
  if (!SKIP_TIMING) {
    for (const scale of [1, 0.5]) for (const count of [1, 8, 16]) {
      await evaluate(`__deferredLab.setSdfScale(${scale}); __deferredLab.setLightCount(${count}); __deferredLab.setLightTime(0.7)`);
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const mode of (repeat % 2 ? ['deferred', 'legacy'] : ['legacy', 'deferred'])) {
          await evaluate(`__deferredLab.setMode("${mode}")`);
          await evaluate('__deferredLab.sampleTiming(8)');
          const result = await evaluate('__deferredLab.sampleTiming(32)');
          timings.push({ scale, count, repeat, mode, ...result });
          console.log('TIMING', JSON.stringify({ scale, count, repeat, mode, p50: result.p50, p95: result.p95 }));
        }
      }
    }
  }
  await sleep(300);
  const finalDiagnostics = await diag();
  assert.deepEqual(errors, [], 'console/JS errors during GPU checks');
  assert.deepEqual(finalDiagnostics.errors, [], 'WebGPU validation errors');
  check('no-gpu-or-page-errors', {});
  writeFileSync(`${out}/validation.json`, JSON.stringify({
    checks, errors, diagnostics: finalDiagnostics, timings,
    timingCaveat: 'Completed-frame wall time, not GPU timestamps or game FPS. Legacy SDF receives one moving light plus static key; meshes use Three falloff. Fixed 800x600, same geometry/camera, paused lights, 8 warm + 32 measured frames, three alternating repeats.',
  }, null, 2));
  console.log('COMPLETE —', checks.length, 'checks;', timings.length, 'timing samples');
} catch (e) {
  console.error('FAIL', e);
  writeFileSync(`${out}/validation-failure.json`, JSON.stringify({ checks, errors, failure: String(e) }, null, 2));
  process.exitCode = 1;
} finally {
  await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
  ws.close();
}
