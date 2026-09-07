// Hybrid deferred M2 — TASK 6: real-game producer and lifecycle GPU
// regression gate (private ports, own servers):
//   LAB_VITE_PORT=5326 LAB_CDP_PORT=9326 scripts/deferred-game-check.sh
//
// The task-5 boot check proved boot+capture; the composition check proved the
// output-depth seam. THIS gate is the game-level regression gate. Every
// assertion runs against the REAL game (sdf-game.html), frozen through the
// deterministic pauseLoop/holdStill-equivalent (setLoopRunning(false) +
// freeze(true) + hand-stepped fixed dt), on a real WebGPU device:
//
//   P0  deferred boot contract: routes, lights, shadows, sink, gain, flashKey
//   P1  SURFACE-HASH INVARIANCE: whole-G-buffer FNV digests are bit-stable
//       under a frozen scene, and stay bit-identical under beam/exposure/
//       shadow-generation/shadow-sampling changes while the LIT frame moves;
//       the unregistered debug marker is visible on screen yet absent from
//       the G-buffer (the "moving marker geometry hidden" clause)
//   P2  actual opaque-route coverage: level mesh (cls 1), flesh SDF (cls 18),
//       FPV gun mesh (cls 17), bone tubes (hash delta), forward probe pixels
//   P3  ALL registered characters rendered once (16/16, the zombie-only blind
//       spot), with kit-descendant tree + material-routing + texel evidence
//       for the kit characters and wound/kit/prop detail for
//       zombie/goblin/soldier
//   P4  lifecycle: slug sever detach, TWO shared-material live chunks, the
//       settled->baked route transition (SDF -> mesh), and the actor rebuild
//   P5  distinct flashlight vs muzzle changes (independent light slots)
//   P6  EXACT output-depth agreement by tightly bracketed known-depth
//       forward probes across mesh/flesh/gun/far pixels, on BOTH the post-aa
//       redirect path and the null (canvas-depth) path, with numeric
//       tolerances; far region = the deepest ray, since this enclosed
//       dungeon has no true sentinel pixel (camera.far=200, deepest
//       geometry ~19.6 m -> depth ~0.995; documented, not waived)
//   P7  SDF scale 1/0.5 with exact hash restore, viewport resize down/up,
//       and the ?res=640 CSS-cap boot contract
//   P8  default and ?renderer=legacy boots stay legacy
//
// Bounded CDP (every request timed, socket rejects on close), owned
// tab/socket closed in `finally`, exits NONZERO on any assertion failure or
// page error; SUCCESS closes resources and exits 0. Raw pixels never leave
// the page: screenshots are decoded in-page and reduced to bounded stats.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5326), cdp = Number(process.argv[3] ?? 9326);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
mkdirSync(out, { recursive: true });
const W = 1280, H = 800;

const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
const pageErrors = [];
const checks = [];
const captures = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.resolve(m);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const finish = (fn, value) => { clearTimeout(timer); pending.delete(id); fn(value); };
  const timer = setTimeout(() => finish(reject, new Error(`CDP timeout: ${method}`)), 120000);
  pending.set(id, { resolve: (m) => finish(resolve, m), reject: (e) => finish(reject, e) });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onclose = () => {
  for (const request of pending.values()) request.reject(new Error('CDP connection closed'));
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 90000 });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r)?.slice(0, 900));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, detail) => { checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail)?.slice(0, 400)); };

/** Known preexisting asset gap (character-registry.ts documents it): the
 *  minotaur's declared face PNG does not exist under public/assets/lab/
 *  faces/. The registry registers it AS DECLARED on purpose. The gate
 *  allows EXACTLY this loader failure during the minotaur leg and records
 *  it as reproduced evidence with ownership — nothing else is excused. */
const MINOTAUR_FACE = 'minotaur-face.png';
let allowMinotaurFace404 = false;
const isAllowedError = (s) =>
  allowMinotaurFace404 && typeof s === 'string' && s.includes('minotaur');

let errMark = 0;
const noNewErrors = (stage) => {
  const fresh = pageErrors.slice(errMark);
  errMark = pageErrors.length;
  const unexpected = fresh.filter((s) => !isAllowedError(s));
  const allowed = fresh.filter(isAllowedError);
  assert.deepEqual(unexpected, [],
    `${stage}: page must be error-free (got ${JSON.stringify(unexpected)?.slice(0, 700)}; `
    + `allowed-by-allowlist: ${JSON.stringify(allowed).slice(0, 200)})`);
  if (allowed.length) console.log(`  (allowlisted ${allowed.length} preexisting ${MINOTAUR_FACE} loader errors)`);
};

/** The letterboxed canvas rect in window px — every screenshot-pixel
 *  mapping MUST go through this (the 800x600 buffer is CSS-centred in the
 *  1280x800 window; the naive (ndc+1)/2*W mapping is ~30px off at the
 *  edges and the composition check only got away with it near centre). */
const canvasRect = async () => evaluate(`(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
})()`);
const RECT = { left: 0, top: 0, width: W, height: H };
const syncRect = async () => Object.assign(RECT, await canvasRect());
const ndcPx = (sp) => [
  Math.round(RECT.left + (sp.x + 1) / 2 * RECT.width),
  Math.round(RECT.top + (1 - sp.y) / 2 * RECT.height),
];
/** Regions are given in NDC [x0,y0,x1,y1] and converted through RECT. */
const regionPx = (r) => {
  const [x0, y0] = ndcPx({ x: r[0], y: r[1] });
  const [x1, y1] = ndcPx({ x: r[2], y: r[3] });
  return [Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)),
    Math.min(W, Math.max(x0, x1)), Math.min(H, Math.max(y0, y1))];
};

/** Decode ONE fresh screenshot in page; return 7x7 means at NDC points and
 *  NDC-region stats, plus the raw base64 so `shot` can save THE SAME frame
 *  it measured (two captures can straddle a flicker beat). */
const probeFrame = async (points, regions = {}) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const b64 = s?.result?.data;
  assert.ok(b64, 'captureScreenshot returned no data');
  const stats = await evaluate(`(async () => {
    const res = await fetch('data:image/png;base64,' + ${JSON.stringify(b64)});
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const rect = ${JSON.stringify(RECT)};
    const mean7 = (px, py) => {
      const d = ctx.getImageData(px - 3, py - 3, 7, 7).data;
      let r = 0, g = 0, b = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    };
    const points = {};
    for (const [k, px, py] of ${JSON.stringify(Object.entries(points).map(([k, sp]) => [k, ...ndcPx(sp)]))}) {
      points[k] = mean7(px, py);
    }
    const regions = {};
    for (const [k, [x0, y0, x1, y1]] of Object.entries(${JSON.stringify(
      Object.fromEntries(Object.entries(regions).map(([k, r]) => [k, regionPx(r)])))})) {
      const d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let r = 0, g = 0, b = 0, clip = 0, dark = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        if (d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246) clip++;
        if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) dark++;
      }
      regions[k] = { mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
        lum: Math.round((r + g + b) / (3 * n)),
        clipPct: Math.round(1000 * clip / n) / 10, darkPct: Math.round(1000 * dark / n) / 10 };
    }
    const fd = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let nonDark = 0, samples = 0;
    for (let y = 0; y < bmp.height; y += 8) {
      for (let x = 0; x < bmp.width; x += 8) {
        const i = (y * bmp.width + x) * 4;
        samples++;
        if (fd[i] > 10 || fd[i + 1] > 10 || fd[i + 2] > 10) nonDark++;
      }
    }
    return { points, regions,
      frame: { nonDarkPct: Math.round(1000 * nonDark / samples) / 10, w: bmp.width, h: bmp.height } };
  })()`);
  if (!stats || !stats.regions) throw new Error(`probeFrame decode failed: ${JSON.stringify(stats)?.slice(0, 120)}`);
  return { ...stats, b64 };
};

/** Capture to disk + bounded stats, with a minimum-composite guard. */
const shot = async (name, points, regions, limits = {}) => {
  const stats = await probeFrame(points, regions);
  if (limits.save !== false) {
    writeFileSync(`${out}/${name}`, Buffer.from(stats.b64, 'base64'));
    const { b64, ...rest } = stats;
    captures[name] = rest;
  }
  if (limits.minFrameNonDark !== undefined) {
    assert.ok(stats.frame.nonDarkPct >= limits.minFrameNonDark,
      `${name}: frame is ${stats.frame.nonDarkPct}% non-dark — black/empty composite`);
  }
  return stats;
};

/** Assert a world point is in frame through the LIVE camera. */
const assertInFrame = async (label, x, y, z, maxNdc = 0.9) => {
  const sp = await evaluate(`__sdfGame.screenPosOf(${x}, ${y}, ${z})`);
  assert.ok(sp, `${label}: screenPosOf returned nothing`);
  assert.ok(Math.abs(sp.x) <= maxNdc && Math.abs(sp.y) <= maxNdc && sp.z < 1,
    `${label}: subject NOT in frame (ndc ${JSON.stringify(sp)})`);
  return sp;
};
const aimYawAt = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));
const faceTarget = async (px, pz, tx, tz, pitch = -0.12) => {
  const yaw = aimYawAt(px, pz, tx, tz);
  await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, ${pitch}); __sdfGame.step(4);`);
  return await assertInFrame('faceTarget', tx, 1.2, tz);
};

/** Deterministic inspection state, the capture twin of the crowd gate's
 *  freeze recipe: loop off + wanderers frozen + hand-stepped fixed dt.
 *  setMotionEnabled-style gait pausing is NOT used — game-main's freeze()
 *  pins pose, rig and shader clock, and step() makes time a pure function
 *  of the step count. */
const boot = async (url) => {
  await send('Page.navigate', { url });
  errMark = pageErrors.length;
  let ready = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (pageErrors.filter((s) => !isAllowedError(s)).length) {
      throw new Error(`page errors during boot: ${JSON.stringify(pageErrors)?.slice(0, 800)}`);
    }
    ready = await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)');
    if (ready) break;
  }
  assert.ok(ready, 'boot timeout — __sdfGame never presented frames');
  for (let i = 0; i < 60; i++) { if (await evaluate('__sdfGame.gunReady')) break; await sleep(500); }
  assert.ok(await evaluate('__sdfGame.gunReady'), 'gun never became ready');
  // Let async kit/prop loads land, then freeze.
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');
  await sleep(1200);
  await evaluate('__sdfGame.step(10)');
  await syncRect();
};

const waitFor = async (expr, label, tries = 60, waitMs = 500) => {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expr)) return true;
    await evaluate('__sdfGame.step(4)');
    await sleep(waitMs);
  }
  throw new Error(`waitFor never became true: ${label}`);
};

/** World point whose VIEW-SPACE depth maps to `targetDepth` (WebGPU [0,1])
 *  on the ray through (ndcX, ndcY). The NDC-z of a fixed pixel's ray is
 *  exactly A - B'/t in t (ray distance): two samples identify A and B',
 *  the third lands on target. Exact for any pixel, not just centre. */
const depthToWorld = async (ndcX, ndcY, targetDepth) => {
  const at = async (t) => {
    const w = await evaluate(`__sdfGame.screenRayToWorld(${ndcX}, ${ndcY}, ${t})`);
    const sp = await evaluate(`__sdfGame.screenPosOf(${w[0]}, ${w[1]}, ${w[2]})`);
    return { w, d: (sp.z + 1) / 2 };
  };
  const a = await at(3.0), b = await at(6.0);
  const Bp = (b.d - a.d) / (1 / 3.0 - 1 / 6.0);
  const A = a.d + Bp / 3.0;
  let t = Bp / (A - targetDepth);
  for (let i = 0; i < 2; i++) {
    const c = await at(t);
    if (Math.abs(c.d - targetDepth) < 2e-4) return c.w;
    // one secant correction against the true curve
    const d2 = await at(t * 1.05 + 0.05);
    const Bp2 = (d2.d - c.d) / (1 / t - 1 / (t * 1.05 + 0.05));
    const A2 = c.d + Bp2 / t;
    t = Bp2 / (A2 - targetDepth);
  }
  return (await at(t)).w;
};

/** Probe palette (spawnDepthProbes order). */
const PROBE_COLORS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 128, 0], [128, 64, 255]];
const colorDist = (c, e) => Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]);

/**
 * BRACKETED DEPTH AGREEMENT at one NDC pixel. Places |deltas| probes side
 * by side (spread NDC apart, each at its OWN pixel's resolved depth plus
 * its delta), screenshots once, and classifies each probe drawn/occluded
 * by its palette colour. Destination depth at that pixel is then known to
 * sit inside [D+max(nearer deltas), D+min(farther deltas)] — the reported
 * numeric tolerance. Returns the bracket record.
 */
const bracketAt = async (label, ndc, deltas, spread = 0.05, scale = 0.1) => {
  // Per-probe NDC + resolved depth at ITS OWN pixel (curved surfaces need
  // the per-pixel depth; a flat wall agrees across the spread).
  const probes = [];
  const clampN = (v) => Math.max(-0.92, Math.min(0.92, v));
  for (let i = 0; i < deltas.length; i++) {
    const nx = clampN(ndc[0] + (i - (deltas.length - 1) / 2) * spread);
    const ny = clampN(ndc[1]);
    const s = await evaluate(`__sdfGame.readSurfaceAt(${nx.toFixed(4)}, ${ny.toFixed(4)})`);
    assert.ok(s, `${label}: readSurfaceAt failed`);
    const w = await depthToWorld(nx, ny, Math.min(0.9995, s.depth + deltas[i]));
    const sp = await evaluate(`__sdfGame.screenPosOf(${w[0]}, ${w[1]}, ${w[2]})`);
    probes.push({ i, ndc: [nx, ny], dRes: s.depth, target: s.depth + deltas[i], w, sp, delta: deltas[i] });
  }
  await evaluate(`__sdfGame.spawnDepthProbes(${JSON.stringify(probes.map((p) => p.w))}, ${scale}); __sdfGame.step(2);`);
  await sleep(220);
  const points = {};
  for (const p of probes) points[`p${p.i}`] = { x: p.sp.x, y: p.sp.y };
  const { points: colors } = await probeFrame(points);
  await evaluate('__sdfGame.clearDepthProbes(); __sdfGame.step(1);');
  for (const p of probes) {
    const c = colors[`p${p.i}`];
    p.sampled = c;
    p.drawn = colorDist(c, PROBE_COLORS[p.i]) < 90;
    p.sceneDepth = p.dRes;
  }
  const nearer = probes.filter((p) => p.delta < 0);
  const farther = probes.filter((p) => p.delta > 0);
  for (const p of nearer) {
    assert.ok(p.drawn, `${label}: probe at depth D${p.delta >= 0 ? '+' : ''}${p.delta} `
      + `(resolved ${p.dRes.toFixed(5)}) must DRAW — it is nearer than the surface. `
      + `Got ${JSON.stringify(p.sampled)} vs expected ${JSON.stringify(PROBE_COLORS[p.i])}`);
  }
  for (const p of farther) {
    assert.ok(!p.drawn, `${label}: probe at depth D+${p.delta} `
      + `(resolved ${p.dRes.toFixed(5)}) must be OCCLUDED — it is farther than the surface. `
      + `Got ${JSON.stringify(p.sampled)} vs expected ${JSON.stringify(PROBE_COLORS[p.i])}`);
  }
  const bracket = [
    Math.max(...nearer.map((p) => p.delta)),
    Math.min(...farther.map((p) => p.delta)),
  ];
  const centre = Math.abs(bracket[1] - bracket[0]) < 1e-6 ? 0 : (bracket[0] + bracket[1]) / 2;
  const record = { ndc, resolvedAtCentre: probes[Math.floor(probes.length / 2)].dRes, bracket, centre, tolerance: bracket[1] - bracket[0], probes: probes.map((p) => ({ delta: p.delta, dRes: +p.dRes.toFixed(6), drawn: p.drawn })) };
  check(`depth-bracket:${label}`, record);
  return record;
};

const results = { checks, pageErrors, pass: false };
const records = { captures, stages: {} };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  // ===================================================================
  // P0 — DEFERRED BOOT CONTRACT
  // ===================================================================
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  assert.equal(await evaluate('__sdfGame.renderMode'), 'deferred');
  const diag0 = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diag0.mode, 'deferred');
  assert.ok(diag0.router.counts.mesh > 10, `level must be mesh-routed: ${JSON.stringify(diag0.router.counts)}`);
  assert.ok(diag0.router.counts.sdf >= 10, `bodies must be SDF producers: ${JSON.stringify(diag0.router.counts)}`);
  assert.deepEqual(diag0.router.unsupported, [], `no unsupported materials: ${JSON.stringify(diag0.router.unsupported)}`);
  assert.equal(diag0.lights.ids[0], 'flashlight', 'flashlight takes slot 0');
  assert.ok(diag0.lights.dropped.includes('muzzle'), 'inactive muzzle dropped, not guessed');
  assert.equal(diag0.shadow.generationRequested, true);
  assert.equal(diag0.shadow.renderedMaps, 2, 'both flashlight shadow maps render');
  assert.ok(diag0.shadow.fullCasters > diag0.shadow.levelCasters, 'inflated hull is full-only');
  assert.equal(diag0.lightGain, 0.5, 'calibrated light gain ships active');
  assert.ok(diag0.lights.flashKey && Math.abs(diag0.lights.flashKey.fleshKeyIntensity - 2) < 1e-3
    && Math.abs(diag0.lights.flashKey.fleshShoulderKnee - 0.65) < 1e-3,
    `flashKey march-key stamp: ${JSON.stringify(diag0.lights.flashKey)}`);
  assert.deepEqual(diag0.sizes.outputTarget, { width: 800, height: 600 },
    `deferred output rides post-aa's capture target: ${JSON.stringify(diag0.sizes)}`);
  assert.equal(diag0.canvasDepthWrites, false, 'post-aa active -> no canvas depth writes');
  check('P0-boot-deferred', { counts: diag0.router.counts, shadow: diag0.shadow, sizes: diag0.sizes });
  records.stages.bootDiag = diag0;
  noNewErrors('P0 boot');

  // Standard faced stance in room 2, reused by the framing-sensitive stages.
  const z0 = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  assert.ok(z0, 'a room-2 zombie must exist');
  await faceTarget(z0.pos[0] + 1.8, z0.pos[2], z0.pos[0], z0.pos[2]);

  // ===================================================================
  // P1 — SURFACE-HASH INVARIANCE (the light/sampling cannot-touch contract)
  // ===================================================================
  const h0a = await evaluate('__sdfGame.hashSurface()');
  const h0b = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(h0a, h0b, 'the G-buffer digest must be bit-stable on a frozen scene');
  assert.ok(h0a.nonEmpty > 20000, `frozen frame must be mostly occupied: ${h0a.nonEmpty}`);
  assert.ok(h0a.classCounts['1'] > 5000, `level mesh class must dominate: ${JSON.stringify(h0a.classCounts)}`);
  assert.ok(h0a.classCounts['18'] > 500, `flesh SDF class must be present: ${JSON.stringify(h0a.classCounts)}`);
  assert.ok(h0a.classCounts['17'] > 50, `FPV gear mesh class must be present: ${JSON.stringify(h0a.classCounts)}`);
  check('P1-hash-baseline', { nonEmpty: h0a.nonEmpty, classCounts: h0a.classCounts, maxDepth: +h0a.maxDepth.toFixed(6) });
  records.stages.hashBaseline = h0a;

  const litCenter = async () => (await shot('task6-p1-lit.png', {}, { center: [-0.35, -0.4, 0.35, 0.4] }, { save: false })).regions.center.lum;
  const lit0 = await litCenter();

  // (a) shadow SAMPLING off: maps keep rendering, lit stage ignores them.
  await evaluate('__sdfGame.setSpotShadowSampling(false); __sdfGame.step(3);');
  const hSampling = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hSampling, h0a, 'sampling toggle must leave EVERY surface digest identical');
  const litSampling = await litCenter();
  await evaluate('__sdfGame.setSpotShadowSampling(true); __sdfGame.step(2);');
  check('P1-sampling-invariance', { litDelta: lit0 - litSampling, lit0, litSampling });

  // (b) exposure (lightGain): the lit stage must move, the surface must not.
  await evaluate('__sdfGame.setDeferredLightGain(0.13); __sdfGame.step(3);');
  const hGain = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hGain, h0a, 'lightGain must leave every surface digest identical');
  const litGain = await litCenter();
  assert.ok(lit0 - litGain >= 8, `exposure change must visibly darken the lit frame (${lit0} -> ${litGain})`);
  await evaluate('__sdfGame.setDeferredLightGain(0.5); __sdfGame.step(2);');
  check('P1-gain-invariance', { litDelta: lit0 - litGain });

  // (c) beam gain: the flashlight slot's own knob.
  await evaluate('__dungeon.setBeam({ beamGain: 0.5 }); __sdfGame.step(3);');
  const hBeam = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hBeam, h0a, 'beam gain must leave every surface digest identical');
  const litBeam = await litCenter();
  assert.ok(Math.abs(lit0 - litBeam) >= 4, `beam change must move the lit frame (${lit0} -> ${litBeam})`);
  await evaluate('__dungeon.setBeam({ beamGain: 4 }); __sdfGame.step(2);');
  const diagBeam = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.ok(Math.abs(diagBeam.lights.flashKey.fleshKeyIntensity - 2) < 1e-3, 'beam restored');
  check('P1-beam-invariance', { litDelta: lit0 - litBeam });

  // (d) shadow GENERATION off: zero maps, surface untouched, lit moves.
  await evaluate('__sdfGame.setSpotShadow(false); __sdfGame.step(3);');
  const hGen = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hGen, h0a, 'generation toggle must leave every surface digest identical');
  const genDiag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(genDiag.shadow.renderedMaps, 0, 'generation off renders zero maps');
  const litGen = await litCenter();
  await evaluate('__sdfGame.setSpotShadow(true); __sdfGame.step(2);');
  check('P1-generation-invariance', { litDelta: lit0 - litGen, renderedMaps: genDiag.shadow.renderedMaps });

  // (e) THE DEBUG MARKER: visible in the forward frame, absent from the
  //     G-buffer (unregistered renderables never enter a producer pass).
  const markerW = await evaluate(`__sdfGame.screenRayToWorld(0.25, 0.2, 1.0)`);
  await evaluate(`__sdfGame.placeMarker(${markerW[0]}, ${markerW[1]}, ${markerW[2]}, 0xff00ff); __sdfGame.step(2);`);
  const hMarker = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hMarker, h0a, 'the debug marker must not touch the G-buffer');
  const markerSeen = await probeFrame({ m: { x: 0.25, y: 0.2 } });
  const magenta = markerSeen.points.m;
  assert.ok(magenta[0] > 140 && magenta[2] > 140 && magenta[1] < 120,
    `marker must be VISIBLE in the composed frame at its NDC (got ${JSON.stringify(magenta)})`);
  await evaluate('__sdfGame.placeMarker(null); __sdfGame.step(1);');
  check('P1-marker-hidden-from-gbuffer', { marker: magenta });
  noNewErrors('P1 invariance');

  // ===================================================================
  // P2 — ACTUAL OPAQUE-ROUTE COVERAGE (pixels, not counters)
  // ===================================================================
  // Level mesh: scan for a cls-1 texel (the room shell surrounds every pose).
  let levelTexel = null;
  outer: for (let ny = -0.5; ny <= 0.5; ny += 0.25) {
    for (let nx = -0.85; nx <= -0.3; nx += 0.11) {
      const s = await evaluate(`__sdfGame.readSurfaceAt(${nx.toFixed(3)}, ${ny.toFixed(3)})`);
      if (s.cls > 0.5 && s.cls < 1.5 && s.depth < 1) { levelTexel = { nx, ny, s }; break outer; }
    }
  }
  assert.ok(levelTexel, 'no level-mesh (cls 1) texel found on the left flank');
  check('P2-route-level-mesh', { cls: levelTexel.s.cls, depth: +levelTexel.s.depth.toFixed(5), ndc: [levelTexel.nx, levelTexel.ny] });

  // Flesh SDF: centre of the faced body.
  const fleshSp = await assertInFrame('flesh', z0.pos[0], 1.1, z0.pos[2]);
  const fleshTexel = await evaluate(`__sdfGame.readSurfaceAt(${fleshSp.x.toFixed(4)}, ${fleshSp.y.toFixed(4)})`);
  assert.ok(fleshTexel.cls > 17.5 && fleshTexel.cls < 18.5,
    `faced torso must be flesh (cls 18), got ${fleshTexel.cls}`);
  assert.ok(fleshTexel.depth > 0 && fleshTexel.depth < 0.99, `flesh depth must be real: ${fleshTexel.depth}`);
  check('P2-route-flesh-sdf', { cls: fleshTexel.cls, depth: +fleshTexel.depth.toFixed(5) });

  // FPV gun: the breech landmark is the level-only mesh route (cls 17).
  const breech = await evaluate('__sdfGame.breechWorld()[0]');
  const gunSp = await evaluate(`__sdfGame.screenPosOf(${breech[0]}, ${breech[1]}, ${breech[2]})`);
  assert.ok(gunSp && Math.abs(gunSp.x) <= 0.9 && Math.abs(gunSp.y) <= 0.9, `gun landmark in frame: ${JSON.stringify(gunSp)}`);
  const gunTexel = await evaluate(`__sdfGame.readSurfaceAt(${gunSp.x.toFixed(4)}, ${gunSp.y.toFixed(4)})`);
  assert.ok(gunTexel.cls > 16.5 && gunTexel.cls < 17.5,
    `breech texel must be level-only mesh (cls 17), got ${gunTexel.cls}`);
  check('P2-route-fpv-gun', { cls: gunTexel.cls, depth: +gunTexel.depth.toFixed(5) });

  // Bone tubes: turning the instancer ON must change the G-buffer (tubes
  // are level-only mesh producers), and turning it OFF must restore the
  // digest EXACTLY (the march is pinned).
  await evaluate('__sdfGame.setBoneMesh(true); __sdfGame.step(3);');
  const hTubes = await evaluate('__sdfGame.hashSurface()');
  const tubes = await evaluate('__sdfGame.boneTubes()');
  assert.ok(tubes.count > 0, 'bone instancer must have instances');
  assert.notDeepEqual(hTubes, h0a, 'bone tubes must enter the G-buffer when enabled');
  await evaluate('__sdfGame.setBoneMesh(false); __sdfGame.step(3);');
  const hTubesOff = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hTubesOff, h0a, 'tubes off must restore the surface digest exactly');
  check('P2-route-bone-tubes', { instances: tubes.count, hashesDiffer: hTubes.hashes.emissionClass !== h0a.hashes.emissionClass });

  // Forward route: a depth-tested probe composites over the body pixel.
  const frontW = await depthToWorld(fleshSp.x, fleshSp.y, Math.min(0.99, fleshTexel.depth - 0.02));
  await evaluate(`__sdfGame.spawnDepthProbes([${JSON.stringify(frontW)}], 0.1); __sdfGame.step(2);`);
  const probePix = await probeFrame({ f: { x: fleshSp.x, y: fleshSp.y } });
  await evaluate('__sdfGame.clearDepthProbes(); __sdfGame.step(1);');
  assert.ok(colorDist(probePix.points.f, [255, 0, 0]) < 90,
    `forward probe must composite over the flesh pixel (got ${JSON.stringify(probePix.points.f)})`);
  check('P2-route-forward-probe', { pixel: probePix.points.f });
  noNewErrors('P2 routes');


  /** FAR-REGION PROBE. Two honest cases, decided by the hash census:
   *  - sentinel: >=200 pixels sit at depth >= 0.9999 — probes at depths
   *    approaching the sentinel must ALL draw (nothing is there), which
   *    brackets the destination depth into (0.99995, 1].
   *  - deepest-ray: the enclosed dungeon has no empty-far region (documented
   *    limit); bracket the DEEPEST ray instead — a probe just nearer than
   *    the deep surface draws, probes beyond it are occluded. */
  const farStage = async (label) => {
    const h = await evaluate('__sdfGame.hashSurface()');
    if (h.sentinelPixels >= 200) {
      const cx = ((h.sentinelCentroid[0] + 0.5) / h.width) * 2 - 1;
      const cy = 1 - ((h.sentinelCentroid[1] + 0.5) / h.height) * 2;
      const depths = [0.99, 0.9995, 0.99995];
      const spots = [];
      for (let i = 0; i < depths.length; i++) {
        const nx = Math.max(-0.9, Math.min(0.9, cx + (i - 1) * 0.05));
        const w = await depthToWorld(nx, cy, depths[i]);
        spots.push({ i, nx, w });
      }
      await evaluate(`__sdfGame.spawnDepthProbes(${JSON.stringify(spots.map((q) => q.w))}, 0.12); __sdfGame.step(2);`);
      const points = {};
      for (const q of spots) {
        const sp = await evaluate(`__sdfGame.screenPosOf(${q.w[0]}, ${q.w[1]}, ${q.w[2]})`);
        q.sp = sp; points[`p${q.i}`] = { x: sp.x, y: sp.y };
      }
      const { points: colors } = await probeFrame(points);
      await evaluate('__sdfGame.clearDepthProbes(); __sdfGame.step(1);');
      for (const q of spots) {
        q.drawn = colorDist(colors[`p${q.i}`], PROBE_COLORS[q.i]) < 90;
        q.sampled = colors[`p${q.i}`];
        assert.ok(q.drawn, `${label}: far-sentinel probe at depth ${depths[q.i]} must DRAW `
          + `(got ${JSON.stringify(q.sampled)}) — destination depth there is the sentinel`);
      }
      check(`far-sentinel:${label}`, { sentinelPixels: h.sentinelPixels, centroid: h.sentinelCentroid, depths });
      return { case: 'sentinel', sentinelPixels: h.sentinelPixels };
    }
    const farNdcX = ((h.deepestPixel[0] + 0.5) / h.width) * 2 - 1;
    const farNdcY = 1 - ((h.deepestPixel[1] + 0.5) / h.height) * 2;
    const farSample = await evaluate(`__sdfGame.readSurfaceAt(${farNdcX.toFixed(4)}, ${farNdcY.toFixed(4)})`);
    assert.ok(farSample.depth > 0.9, `deepest pixel should be far background: ${farSample.depth}`);
    const bracket = await bracketAt(`far-${label}`, [farNdcX, farNdcY], [-0.003, 0.01, 0.05], 0.05, 0.12);
    return {
      case: 'deepest-ray', depth: farSample.depth, deepestPixel: h.deepestPixel,
      ndc: [farNdcX, farNdcY], bracket: bracket.bracket, sentinelPixels: h.sentinelPixels,
      note: 'enclosed dungeon: no empty-far region in frame (sentinel census '
        + String(h.sentinelPixels) + ' px); far leg brackets the DEEPEST ray',
    };
  };

  // ===================================================================
  // P6 — EXACT OUTPUT-DEPTH AGREEMENT (bracketed, both present paths)
  // ===================================================================
  // NOTE: the post-aa sceneTarget's hardware depth attachment is not CPU-
  // readable through three's readRenderTargetPixelsAsync (colour attachments
  // only), and this enclosed dungeon has NO empty-far pixel (camera.far=200,
  // deepest sightline ~19.6 m -> depth ~0.995). The coordinator's accepted
  // alternative is tightly bracketed known-depth probes across multiple
  // mesh/flesh/gun/far pixels with explicit numeric tolerance — below, on
  // BOTH the redirect path and the null (canvas-depth) path, plus the far
  // region against the deepest ray.
  const savedPost = await evaluate('({ fxaa: __sdfGame.fxaa, smear: __sdfGame.smear, fisheye: __sdfGame.fisheye.centerFovDeg })');
  // Probes need UNWARPED screenshot coordinates: fisheye 90 = lens off.
  await evaluate('__sdfGame.setFisheye(90); __sdfGame.step(2);');
  await syncRect();

  // Wall bracket: flat surface, tight ladder, at the VERIFIED cls-1 texel
  // from P2. One extra-tight stage proves the destination depth tracks the
  // resolved depth to 5e-4 there.
  const wallTexel = await evaluate(`__sdfGame.readSurfaceAt(${levelTexel.nx.toFixed(4)}, ${levelTexel.ny.toFixed(4)})`);
  assert.ok(wallTexel.cls > 0.5 && wallTexel.cls < 1.5 && wallTexel.depth < 0.99,
    `wall bracket pixel must be level mesh at real depth (got cls ${wallTexel.cls} depth ${wallTexel.depth})`);
  const wallTight = await bracketAt('wall-tight', [levelTexel.nx, levelTexel.ny], [-0.0005, -0.00025, 0.00025, 0.0005], 0.05, 0.1);
  assert.ok(wallTight.tolerance <= 0.001,
    `wall bracket must close to <=1e-3 depth (got ${wallTight.tolerance})`);

  // Flesh bracket: curved surface, per-pixel resolved depths, wider ladder.
  const fleshBracket = await bracketAt('flesh', [fleshSp.x, fleshSp.y], [-0.004, -0.002, 0.002, 0.004], 0.06, 0.08);
  // Gun bracket: viewmodel mesh, near the eye.
  const gunBracket = await bracketAt('gun', [gunSp.x, gunSp.y], [-0.004, -0.002, 0.002, 0.004], 0.08, 0.02);

  // FAR region: sentinel census first — a genuine empty-far region probes
  // all-draw against the sentinel; otherwise the deepest ray is bracketed
  // and the geometric ceiling is recorded, not silently waived.
  const farRecord = await farStage('redirect');

  // The same wall bracket on the NULL path (post-aa fully off): the canvas
  // present writes the resolved depth (canvasDepthWrites) and the forward
  // pass must composite against it identically.
  await evaluate('__sdfGame.setFxaa(false); __sdfGame.setSmear(0); __sdfGame.step(3);');
  const diagNull = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diagNull.canvasDepthWrites, true, 'post-aa fully off must flip canvas-depth present ON');
  assert.equal(diagNull.sizes.outputTarget, null, 'null path hands the coordinator null');
  const nullWall = await bracketAt('wall-null-path', [levelTexel.nx, levelTexel.ny], [-0.0005, -0.00025, 0.00025, 0.0005], 0.05, 0.1);
  const nullFlesh = await bracketAt('flesh-null-path', [fleshSp.x, fleshSp.y], [-0.004, -0.002, 0.002, 0.004], 0.06, 0.08);
  const nullFar = await farStage('null-path');
  records.stages.nullDepth = { wall: nullWall.tolerance, flesh: nullFlesh.tolerance, far: nullFar };
  noNewErrors('P6 null path');

  // Restore post-aa (redirect path), keep lens off for one probe, then
  // restore the authored lens at the very end of P6.
  await evaluate(`__sdfGame.setFxaa(${savedPost.fxaa}); __sdfGame.setSmear(${savedPost.smear}); __sdfGame.step(3);`);
  const diagRedirect = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diagRedirect.canvasDepthWrites, false, 'post-aa restored -> redirect path');
  const redirectFar = await farStage('redirect-2');
  check('P6-depth-summary', {
    redirect: { wall: wallTight.tolerance, flesh: fleshBracket.tolerance, gun: gunBracket.tolerance },
    far: { redirect: farRecord, null: nullFar, redirect2: redirectFar },
  });
  await evaluate(`__sdfGame.setFisheye(${savedPost.fisheye}); __sdfGame.step(2);`);
  await syncRect();
  noNewErrors('P6 depth agreement');

  // ===================================================================
  // P7a — SDF SCALE 1/0.5 WITH EXACT RESTORE + VIEWPORT RESIZE
  // ===================================================================
  await evaluate('__sdfGame.setSdfScale(0.5); __sdfGame.step(4);');
  const diagHalf = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diagHalf.sizes.sdfScale, 0.5);
  assert.ok(diagHalf.sizes.sdfTargetSize.width === 400 && diagHalf.sizes.sdfTargetSize.height === 300,
    `SDF target must halve: ${JSON.stringify(diagHalf.sizes.sdfTargetSize)}`);
  const halfFrame = await shot('task6-scale05.png', {}, {}, { minFrameNonDark: 8, save: false });
  assert.ok(halfFrame.frame.nonDarkPct >= 8, 'half-scale frame must still compose');
  // Occlusion survives the scale change: a front probe still draws.
  const halfFlesh = await evaluate(`__sdfGame.readSurfaceAt(${fleshSp.x.toFixed(4)}, ${fleshSp.y.toFixed(4)})`);
  assert.ok(halfFlesh.cls > 17.5 && halfFlesh.cls < 18.5, 'flesh texel survives rescale');
  const frontHalf = await depthToWorld(fleshSp.x, fleshSp.y, Math.min(0.99, halfFlesh.depth - 0.02));
  await evaluate(`__sdfGame.spawnDepthProbes([${JSON.stringify(frontHalf)}], 0.1); __sdfGame.step(2);`);
  const probeHalf = await probeFrame({ f: { x: fleshSp.x, y: fleshSp.y } });
  await evaluate('__sdfGame.clearDepthProbes(); __sdfGame.step(1);');
  assert.ok(colorDist(probeHalf.points.f, [255, 0, 0]) < 90,
    `front probe must still composite at half scale (got ${JSON.stringify(probeHalf.points.f)})`);
  await evaluate('__sdfGame.setSdfScale(1); __sdfGame.step(4);');
  const hScaleBack = await evaluate('__sdfGame.hashSurface()');
  assert.deepEqual(hScaleBack, h0a, 'restoring scale 1 must reproduce the digest EXACTLY');
  check('P7a-scale', { half: diagHalf.sizes.sdfTargetSize, restored: 'hash==h0' });

  // Resize down/up under the fixed cap: the 800x600 buffer must NOT follow
  // the window (the CSS cap), and the composite must survive both moves.
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await evaluate('__sdfGame.step(4)');
  await syncRect();
  let d = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(d.sizes.width, 800, `fixed cap must hold across resize: ${JSON.stringify(d.sizes)}`);
  const downFrame = await shot('task6-resize-down.png', {}, {}, { minFrameNonDark: 8 });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await evaluate('__sdfGame.step(3)');
  await syncRect();
  const upFrame = await shot('task6-resize-up.png', {}, {}, { minFrameNonDark: 8 });
  check('P7a-resize', { down: downFrame.frame, up: upFrame.frame });
  noNewErrors('P7a scale/resize');

  // ===================================================================
  // P3/P4 — EVERY REGISTERED CHARACTER RENDERED ONCE + DETAIL EVIDENCE
  // ===================================================================
  // The registry is the source of truth (16 entries incl. the two
  // fixtures). Each character spawns through spawnDebugCharacter — the
  // SAME spawnEnemy path boot uses — then is faced, asserted IN FRAME,
  // proven at the texel level (a cls-18 flesh texel in a 3x3 NDC lattice
  // around the projected torso), and captured. The zombie-only blind spot
  // that let a goblin regression pass everything green ends here.
  const REGISTRY = ['zombie', 'goblin', 'clown', 'clown-alt', 'mouse', 'cyclops',
    'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described', 'strand-fixture',
    'bonewalker', 'dragon', 'box-fixture', 'minotaur', 'soldier', 'female'];
  assert.equal(REGISTRY.length, 16, 'registry roster pinned at 16 — update with character-registry.ts');
  const rendered = {};
  const baseMeshCount = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.mesh;
  for (const name of REGISTRY) {
    // Spread spawns across rooms (4 per room) so bodies do not stack.
    const roomIdx = REGISTRY.indexOf(name) % 4;
    await evaluate(`__sdfGame.teleport(${roomIdx + 1}); __sdfGame.step(2);`);
    const before = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.mesh;
    allowMinotaurFace404 = name === 'minotaur';
    const spawned = await evaluate(`__sdfGame.spawnDebugCharacter(${JSON.stringify(name)})`);
    allowMinotaurFace404 = false;
    assert.ok(spawned && spawned.id > 0, `${name}: spawn failed ${JSON.stringify(spawned)}`);
    // Kit characters load glTF async — wait for the router to discover
    // the descendants. A kit that never lands FAILS here with evidence
    // (the F-kit-load-race carry-forward: reproduced, not waived).
    const kitChar = ['goblin', 'clown', 'clown-alt', 'soldier'].includes(name);
    if (kitChar) {
      await waitFor(`__sdfGame.deferredDiagnostics().router.counts.mesh >= ${before + 1}`,
        `${name}: kit descendants never reached the mesh route`, 40, 400);
      await evaluate('__sdfGame.step(6)');
    } else {
      await evaluate('__sdfGame.step(4)');
      await sleep(250);
    }
    const zc = (await evaluate('__sdfGame.zombies()')).find((q) => q.id === spawned.id);
    assert.ok(zc, `${name}: spawned actor ${spawned.id} missing from the roster`);
    await faceTarget(zc.pos[0] + 1.5, zc.pos[2] + 0.1, zc.pos[0], zc.pos[2]);
    const torsoSp = await assertInFrame(`${name} in frame`, zc.pos[0], 1.1, zc.pos[2]);
    // Texel evidence: cls-18 flesh within a 3x3 lattice around the torso.
    let fleshHit = null;
    outer2: for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const s = await evaluate(`__sdfGame.readSurfaceAt(${(torsoSp.x + dx * 0.06).toFixed(4)}, ${(torsoSp.y + dy * 0.06).toFixed(4)})`);
        if (s.cls > 17.5 && s.cls < 18.5 && s.depth < 0.99) { fleshHit = s; break outer2; }
      }
    }
    assert.ok(fleshHit, `${name}: no flesh (cls 18) texel found around the projected torso`);
    // Kit evidence: named descendants, routed, with material names.
    let kitTree = null;
    if (kitChar) {
      kitTree = await evaluate(`__sdfGame.debugRegisteredTree('rig-${name}', 48)`);
      assert.ok(kitTree.found, `${name}: deferred rig group not found`);
      const meshNodes = kitTree.nodes.filter((n) => n.isMesh);
      assert.ok(meshNodes.length >= 2,
        `${name}: kit must contribute >=2 mesh descendants (got ${meshNodes.length}: ${JSON.stringify(kitTree.nodes.map((n) => n.name))})`);
      assert.ok(meshNodes.every((n) => n.route === 'mesh'),
        `${name}: kit meshes must route 'mesh': ${JSON.stringify(meshNodes.map((n) => [n.name, n.route]))}`);
      assert.ok(meshNodes.some((n) => (n.materials ?? []).length > 0),
        `${name}: kit meshes must carry named materials`);
      // Visible kit pixels: a cls-17 texel at the first kit mesh's projection.
      const km = meshNodes.find((n) => Math.abs(n.pos[0]) + Math.abs(n.pos[2]) > 0.001) ?? meshNodes[0];
      const ksp = await evaluate(`__sdfGame.screenPosOf(${km.pos[0]}, ${km.pos[1]}, ${km.pos[2]})`);
      let kitTexel = null;
      if (ksp && Math.abs(ksp.x) <= 0.95 && Math.abs(ksp.y) <= 0.95 && ksp.z < 1) {
        for (let dy = -1; dy <= 1 && !kitTexel; dy++) {
          for (let dx = -1; dx <= 1 && !kitTexel; dx++) {
            const s = await evaluate(`__sdfGame.readSurfaceAt(${(ksp.x + dx * 0.04).toFixed(4)}, ${(ksp.y + dy * 0.04).toFixed(4)})`);
            if (s.cls > 16.5 && s.cls < 17.5 && s.depth < 0.995) kitTexel = s;
          }
        }
      }
      rendered[name] = {
        id: spawned.id, fleshDepth: +fleshHit.depth.toFixed(5),
        kitMeshes: meshNodes.length, kitTexel: kitTexel ? +kitTexel.depth.toFixed(5) : null,
        kitMaterials: meshNodes.flatMap((n) => n.materials).slice(0, 8),
      };
      assert.ok(kitTexel, `${name}: kit pixels missing from the G-buffer at the projected kit node`);
    } else {
      rendered[name] = { id: spawned.id, fleshDepth: +fleshHit.depth.toFixed(5) };
    }
    await shot(`task6-char-${name}.png`, {}, {}, { minFrameNonDark: 8 });
    console.log(`  rendered ${name} (id ${spawned.id})`);
  }
  const afterMeshCount = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.mesh;
  check('P3-all-characters-rendered', { count: REGISTRY.length, rendered, meshGrowth: afterMeshCount - baseMeshCount });
  records.stages.characters = rendered;

  // Zombie wound detail: blast the FIRST zombie we can face, then prove the
  // crater reaches the G-buffer (albedo at the wound anchor drops vs the
  // neighbouring skin) — wound data, not just wound counters.
  {
    const zw = (await evaluate('__sdfGame.zombies()')).find((q) => q.id === rendered.zombie.id) ?? z0;
    await faceTarget(zw.pos[0] + 1.6, zw.pos[2], zw.pos[0], zw.pos[2]);
    const blast = await evaluate(`__sdfGame.explode(${zw.pos[0]}, 1.2, ${zw.pos[2]})`);
    assert.ok(blast.totalWounds > 0, `blast must wound: ${JSON.stringify(blast)}`);
    await evaluate('__sdfGame.step(6)');
    const wounds = await evaluate(`__sdfGame.debugWounds(${zw.id})`);
    assert.ok(wounds.length > 0, 'debugWounds must list the blast craters');
    let woundAlbedo = null, skinAlbedo = null;
    for (const w of wounds.slice(0, 4)) {
      const sp = await evaluate(`__sdfGame.screenPosOf(${w.surface[0]}, ${w.surface[1]}, ${w.surface[2]})`);
      if (!sp || Math.abs(sp.x) > 0.9 || Math.abs(sp.y) > 0.9 || sp.z >= 1) continue;
      const s = await evaluate(`__sdfGame.readSurfaceAt(${sp.x.toFixed(4)}, ${sp.y.toFixed(4)})`);
      if (s.cls > 17.5 && s.cls < 18.5) {
        const n = await evaluate(`__sdfGame.readSurfaceAt(${(sp.x + 0.05).toFixed(4)}, ${(sp.y + 0.05).toFixed(4)})`);
        if (n.cls > 17.5 && n.cls < 18.5) {
          woundAlbedo = s.albedo; skinAlbedo = n.albedo;
          break;
        }
      }
    }
    assert.ok(woundAlbedo, 'no wound anchor projected to a flesh texel in frame');
    const wL = woundAlbedo[0] + woundAlbedo[1] + woundAlbedo[2];
    const sL = skinAlbedo[0] + skinAlbedo[1] + skinAlbedo[2];
    assert.ok(wL < sL * 0.92,
      `wound albedo must be darker than neighbouring skin (wound ${wL.toFixed(3)} vs skin ${sL.toFixed(3)})`);
    await shot('task6-zombie-wounded.png', {}, {}, { minFrameNonDark: 8 });
    check('P4-zombie-wounds', { woundAlbedo, skinAlbedo, woundCount: wounds.length });
    records.stages.zombieWounds = { woundAlbedo, skinAlbedo, woundCount: wounds.length };
  }
  noNewErrors('P3/P4 characters');

  // ===================================================================
  // P5 — LIFECYCLE: sever detach, two shared chunks, bake, actor rebuild
  // ===================================================================
  // (a) Slug severs: two pieces detached into live chunks. Both chunks use
  //     the ONE shared chunk material (createSharedChunkGpuMaterial) — code
  //     fact; the gate proves BOTH RENDER as SDF producers.
  const target = (await evaluate('__sdfGame.zombies()')).find((q) => q.id === (rendered.zombie?.id ?? z0.id)) ?? z0;
  await faceTarget(target.pos[0] + 0.9, target.pos[2], target.pos[0], target.pos[2], -0.18);
  const sdfBefore = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.sdf;
  let severed = 0;
  for (let i = 0; i < 40 && severed < 2; i++) {
    const ok = await evaluate('__sdfGame.fireSlug()');
    if (!ok) { await evaluate('__sdfGame.step(40)'); continue; } // cooldown/reload
    await evaluate('__sdfGame.step(24)');

    const sdfNow = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.sdf;
    if (sdfNow > sdfBefore + severed) severed = sdfNow - sdfBefore;
  }
  assert.ok(severed >= 2, `slugs at point-blank must detach two pieces (got ${severed})`);
  // BOTH live chunks render as SDF producers (shared chunk material).
  const census = await evaluate('__sdfGame.chunkStats()');
  assert.ok(census.live >= 2, `two live chunks expected: ${JSON.stringify({ live: census.live, baked: census.baked })}`);
  const chunkTexels = [];
  for (const piece of census.livePieces.slice(0, 2)) {
    await faceTarget(piece.centre[0] + 1.2, piece.centre[2] + 0.1, piece.centre[0], piece.centre[2], 0);
    const csp = await evaluate(`__sdfGame.screenPosOf(${piece.centre[0]}, ${piece.centre[1]}, ${piece.centre[2]})`);
    let texel = null;
    if (csp && Math.abs(csp.x) <= 0.95 && Math.abs(csp.y) <= 0.95 && csp.z < 1) {
      for (let dy = -1; dy <= 1 && !texel; dy++) {
        for (let dx = -1; dx <= 1 && !texel; dx++) {
          const s = await evaluate(`__sdfGame.readSurfaceAt(${(csp.x + dx * 0.07).toFixed(4)}, ${(csp.y + dy * 0.07).toFixed(4)})`);
          if (s.cls > 17.5 && s.cls < 18.5 && s.depth < 0.995) texel = s;
        }
      }
    }
    chunkTexels.push({ id: piece.id, centre: piece.centre, texelDepth: texel ? +texel.depth.toFixed(5) : null, cls: texel?.cls ?? null });
    assert.ok(texel, `live chunk ${piece.id} must render as flesh SDF (cls 18) at its projected centre`);
  }
  await shot('task6-two-chunks.png', {}, {}, { minFrameNonDark: 8 });
  check('P5-two-shared-chunks', { severed, chunks: chunkTexels, sharedMaterial: 'createSharedChunkGpuMaterial (single instance)' });
  records.stages.twoChunks = chunkTexels;
  noNewErrors('P5 sever');

  // (b) Bake transition: a settled chunk becomes a STATIC MESH on the mesh
  //     route (cls 17). spawnTestChunk goes through the real spawn path at
  //     a controlled size; the worker + settle run under hand-stepping.
  const bakeCensus0 = await evaluate('__sdfGame.chunkStats()');
  const bakeSpot = await evaluate(`__sdfGame.screenRayToWorld(0.3, -0.2, 1.6)`);
  await evaluate(`__sdfGame.spawnTestChunk(${bakeSpot[0]}, 0.25, ${bakeSpot[2]}, 0.12); __sdfGame.step(10);`);
  await waitFor('__sdfGame.chunkStats().totalBakes > ' + bakeCensus0.totalBakes,
    'chunk bake never completed', 60, 400);
  const bakeCensus1 = await evaluate('__sdfGame.chunkStats()');
  assert.ok(bakeCensus1.baked >= 1, `baked pieces must exist: ${JSON.stringify({ baked: bakeCensus1.baked })}`);
  assert.ok(bakeCensus1.live <= bakeCensus0.live, `the baked piece must retire from the live march: ${bakeCensus1.live} vs ${bakeCensus0.live}`);
  const meshAfterBake = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.mesh;
  assert.ok(meshAfterBake >= afterMeshCount + 1, `bake must add the mesh to the mesh route: ${meshAfterBake}`);
  // Baked pixels: cls 17 at the baked piece centre.
  const bakedPiece = bakeCensus1.pieces[bakeCensus1.pieces.length - 1];
  await faceTarget(bakedPiece.centre[0] + 1.1, bakedPiece.centre[2] + 0.1, bakedPiece.centre[0], bakedPiece.centre[2], 0);
  const bsp = await evaluate(`__sdfGame.screenPosOf(${bakedPiece.centre[0]}, ${bakedPiece.centre[1]}, ${bakedPiece.centre[2]})`);
  let bakedTexel = null;
  if (bsp && Math.abs(bsp.x) <= 0.95 && Math.abs(bsp.y) <= 0.95 && bsp.z < 1) {
    for (let dy = -1; dy <= 1 && !bakedTexel; dy++) {
      for (let dx = -1; dx <= 1 && !bakedTexel; dx++) {
        const s = await evaluate(`__sdfGame.readSurfaceAt(${(bsp.x + dx * 0.04).toFixed(4)}, ${(bsp.y + dy * 0.04).toFixed(4)})`);
        if (s.cls > 16.5 && s.cls < 17.5 && s.depth < 0.995) bakedTexel = s;
      }
    }
  }
  assert.ok(bakedTexel, 'the baked chunk must render on the MESH route (cls 17) at its centre');
  await shot('task6-baked-chunk.png', {}, {}, { minFrameNonDark: 8 });
  check('P5-bake-transition', {
    baked: bakeCensus1.baked, totalBakes: bakeCensus1.totalBakes,
    lastBakeInfo: bakeCensus1.lastBakeInfo && { verts: bakeCensus1.lastBakeInfo.verts, tris: bakeCensus1.lastBakeInfo.tris },
    bakedTexelDepth: +bakedTexel.depth.toFixed(5),
  });
  noNewErrors('P5 bake');

  // (c) Actor rebuild: the wound panel's boneRatio lever rebuilds the cast
  //     through spawnAll — every view disposed, every id fresh, the router
  //     must drop the old roots and catalogue the new ones.
  const idsBefore = (await evaluate('__sdfGame.zombies()')).map((q) => q.id);
  const tuningBefore = await evaluate('__sdfGame.setWoundTuning({})');
  const boneRatio = (tuningBefore && tuningBefore.boneRatio !== undefined) ? tuningBefore.boneRatio : 0.5;
  await evaluate(`__sdfGame.setWoundTuning({ boneRatio: ${boneRatio + 0.05} }); __sdfGame.step(8);`);
  const idsAfter = (await evaluate('__sdfGame.zombies()')).map((q) => q.id);
  assert.ok(idsAfter.length >= 10, `rebuilt roster must respawn: ${idsAfter.length}`);
  assert.ok(idsAfter.every((id) => !idsBefore.includes(id)), 'rebuilt actor ids must ALL be fresh');
  const diagRebuilt = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.deepEqual(diagRebuilt.router.unsupported, [], 'rebuilt cast must not strand unsupported materials');
  // The rebuilt bodies must actually render: face a rebuilt body, flesh texel.
  const rz = (await evaluate('__sdfGame.zombies()')).find((q) => q.room === 2) ?? (await evaluate('__sdfGame.zombies()'))[0];
  await faceTarget(rz.pos[0] + 1.6, rz.pos[2], rz.pos[0], rz.pos[2]);
  const rsp = await assertInFrame('rebuilt body', rz.pos[0], 1.1, rz.pos[2]);
  let rebuiltTexel = null;
  for (let dy = -1; dy <= 1 && !rebuiltTexel; dy++) {
    for (let dx = -1; dx <= 1 && !rebuiltTexel; dx++) {
      const s = await evaluate(`__sdfGame.readSurfaceAt(${(rsp.x + dx * 0.06).toFixed(4)}, ${(rsp.y + dy * 0.06).toFixed(4)})`);
      if (s.cls > 17.5 && s.cls < 18.5 && s.depth < 0.99) rebuiltTexel = s;
    }
  }
  assert.ok(rebuiltTexel, 'a rebuilt body must render flesh (cls 18) after the rebuild');
  await evaluate(`__sdfGame.setWoundTuning({ boneRatio: ${boneRatio} }); __sdfGame.step(4);`);
  check('P5-actor-rebuild', { idsBefore: idsBefore.length, idsAfter: idsAfter.length, freshIds: true, fleshDepth: +rebuiltTexel.depth.toFixed(5) });
  noNewErrors('P5 rebuild');

  // ===================================================================
  // P5b — DISTINCT FLASHLIGHT vs MUZZLE CHANGES (independent slots)
  // ===================================================================
  // Face an empty stretch of wall so pellets stamp no wounds and light
  // changes are the only variable. Room 2's south band wall.
  await evaluate(`__sdfGame.teleport(2); __sdfGame.step(2);`);
  const pose2 = await evaluate('__sdfGame.pose()');
  await evaluate(`__sdfGame.setPose(${pose2.pos[0]}, ${pose2.pos[2] + 2.4}, ${Math.PI}, -0.05); __sdfGame.step(3);`);
  const wallStats = async (label, save = false) => (await shot(`task6-muzzle-${label}.png`, {}, { wall: [-0.4, 0.0, 0.4, 0.5] }, { save })).regions.wall.lum;
  await evaluate('__sdfGame.step(2)');
  const mA = await wallStats('beam-on', true);
  // Fire ONE slug downrange: the muzzle PointLight fires its own shared slot.
  // The magazine may be mid-reload after the sever stage — wait it out.
  const fireWhenReady = async () => {
    for (let i = 0; i < 8; i++) {
      if (await evaluate('__sdfGame.fireSlug()')) return true;
      await evaluate('__sdfGame.step(40)');
    }
    return false;
  };
  const fired = await fireWhenReady();
  assert.ok(fired, 'the muzzle stage needs one live round');
  await evaluate('__sdfGame.step(1)');
  const diagFlash = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.ok(diagFlash.lights.ids.includes('muzzle'), `muzzle must appear in the shared light list: ${JSON.stringify(diagFlash.lights.ids)}`);
  assert.equal(diagFlash.lights.ids[0], 'flashlight', 'flashlight keeps slot 0 while the muzzle fires');
  assert.equal(diagFlash.lights.flashlightIndex, 0, 'muzzle must not displace the flashlight slot');
  const mB = await wallStats('muzzle-flash', true);
  assert.ok(mB - mA >= 6, `the muzzle flash must light the wall (${mA} -> ${mB})`);
  await evaluate('__sdfGame.step(30)'); // flash envelope expires
  const mC = await wallStats('flash-expired');
  assert.ok(Math.abs(mC - mA) <= 8, `wall must return after the flash (${mA} -> ${mC})`);
  // Beam off: the wall drops by the beam contribution...
  await evaluate('__dungeon.setBeam({ beamGain: 0 }); __sdfGame.step(3);');
  const mD = await wallStats('beam-off');
  assert.ok(mD < mC - 3, `beam-off must darken the lit wall (${mC} -> ${mD})`);
  // ...and the muzzle STILL lights it: independent slots, no replay.
  const fired2 = await fireWhenReady();
  assert.ok(fired2, 'the no-beam muzzle shot needs a live round');
  await evaluate('__sdfGame.step(1)');
  const diagFlash2 = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.ok(diagFlash2.lights.ids.includes('muzzle'), 'muzzle slot active with the beam off');
  const mE = await wallStats('muzzle-no-beam');
  assert.ok(mE >= mD + 6, `muzzle must light WITHOUT the beam (${mD} -> ${mE})`);
  await evaluate('__dungeon.setBeam({ beamGain: 4 }); __sdfGame.step(2);');
  check('P5b-muzzle-vs-flashlight', {
    beamOn: mA, muzzle: mB, expired: mC, beamOff: mD, muzzleNoBeam: mE,
    slots: { flashlightIndex: diagFlash.lights.flashlightIndex, idsWithMuzzle: diagFlash.lights.ids.length },
  });
  noNewErrors('P5b muzzle');

  // ===================================================================
  // P7b — CSS CAP BOOT CONTRACT (?res=640)
  // ===================================================================
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred&res=640`);
  const res640 = await evaluate('__sdfGame.resolution');
  assert.equal(res640.rung, '640');
  assert.deepEqual(res640.content, { width: 640, height: 480 }, `content must be the capped buffer: ${JSON.stringify(res640.content)}`);
  assert.equal(res640.letterboxed, true);
  const d640 = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(d640.sizes.width, 640);
  assert.equal(d640.sizes.height, 480);
  const frame640 = await shot('task6-res640.png', {}, {}, { minFrameNonDark: 8 });
  const breech640 = await evaluate('__sdfGame.breechWorld()[0]');
  const gun640 = await evaluate(`__sdfGame.screenPosOf(${breech640[0]}, ${breech640[1]}, ${breech640[2]})`);
  const gunTexel640 = await evaluate(`__sdfGame.readSurfaceAt(${gun640.x.toFixed(4)}, ${gun640.y.toFixed(4)})`);
  assert.ok(gunTexel640.cls > 16.5 && gunTexel640.cls < 17.5, `routes must survive the 640 boot: ${gunTexel640.cls}`);
  check('P7b-css-cap-640', { resolution: res640, frame: frame640.frame, gunCls: gunTexel640.cls });
  noNewErrors('P7b 640 boot');

  // ===================================================================
  // P8 — DEFAULT AND LEGACY BOOTS STAY LEGACY
  // ===================================================================
  await boot(`http://localhost:${vite}/sdf-game.html`);
  assert.equal(await evaluate('__sdfGame.renderMode'), 'legacy', 'default boot must be legacy');
  const legacyDiag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.deepEqual(legacyDiag, { mode: 'legacy' }, 'legacy boot reports the legacy mode only');
  assert.equal(await evaluate('typeof __sdfGame.hashSurface === "function"'), true);
  assert.equal(await evaluate('await __sdfGame.hashSurface()'), null, 'hashSurface is null-safe on legacy');
  const zl = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  await faceTarget(zl.pos[0] + 1.8, zl.pos[2], zl.pos[0], zl.pos[2]);
  const legacyFrame = await shot('task6-legacy-default.png', {}, {}, { minFrameNonDark: 8 });
  check('P8-default-legacy', { mode: 'legacy', frame: legacyFrame.frame });
  noNewErrors('P8 default boot');

  await boot(`http://localhost:${vite}/sdf-game.html?renderer=legacy`);
  assert.equal(await evaluate('__sdfGame.renderMode'), 'legacy', 'explicit legacy must be legacy');
  check('P8-explicit-legacy', { mode: 'legacy', present: await evaluate('__sdfGame.presentCount()') });
  noNewErrors('P8 explicit legacy boot');

  results.pass = true;
} finally {
  results.pageErrors = pageErrors;
  writeFileSync(`${out}/game-validation.json`, JSON.stringify({
    ...results,
    generatedAt: new Date().toISOString(),
    ports: { vite, cdp },
    viewport: { width: W, height: H },
    records,
  }, null, 2));
  try { await send('Page.close'); } catch { /* tab may already be gone */ }
  ws.close();
  await new Promise((r) => { ws.onclose = r; setTimeout(r, 500); });
}
console.log(`TASK6 GAME CHECK: ${results.pass ? 'PASS' : 'FAIL'} (${checks.length} checks)`);
if (!results.pass) process.exit(1);
process.exit(0);
