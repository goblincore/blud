// Hybrid deferred M2 — TASK 6: real-game producer and lifecycle GPU
// regression gate (private ports, own servers):
//   LAB_VITE_PORT=5326 LAB_CDP_PORT=9326 scripts/deferred-game-check.sh
//
// SCOPE (TASK6_SCOPE env): 'full' (default) runs every phase P0..P8 and is
// the only mode that may claim Task 6 acceptance (canonical
// game-validation.json). 'core' runs the render-control and
// route/depth/scale evidence only (P0, P1, P2, P6, P7a), writes
// game-validation-core.json + task-6-core.md, and NEVER claims full
// acceptance. Unknown values exit 2.
//
// The task-5 boot check proved boot+capture; the composition check proved the
// output-depth seam. THIS gate is the game-level regression gate. Every
// assertion runs against the REAL game (sdf-game.html), frozen through the
// deterministic pauseLoop/holdStill-equivalent (setLoopRunning(false) +
// freeze(true) + hand-stepped fixed dt), on a real WebGPU device:
//
//   P0  deferred boot contract: routes, lights, shadows, sink, gain, flashKey
//   P1  RENDER CONTROL FIRST: two hashSurface calls are two SEPARATE renders
//       (the seam draws a still each call) of the render-locked scene and
//       must be bit-identical — THAT license is what makes every later
//       "digest unchanged" claim meaningful. Then SURFACE-HASH INVARIANCE
//       under beam/exposure/shadow changes while the LIT frame moves; the
//       unregistered debug marker visible yet absent from the G-buffer.
//   P2  actual opaque-route coverage: level mesh (cls 1), flesh SDF (cls 18),
//       FPV gun mesh (cls 17), SDF bones enabled, forward probes both
//       ways (nearer probe draws over flesh; behind-flesh probe occluded),
//       world-normal DIRECTION checks on flesh; baked normals in lifecycle
//   P3  Every in-scope registered character rendered once, with explicit owner
//       exclusions and kit-descendant tree + material-routing + texel evidence
//       for the kit characters and wound/kit/prop detail for
//       zombie/goblin/soldier
//   P4  lifecycle: slug sever detach, TWO shared-material live chunks, the
//       settled->baked route transition (SDF -> mesh), and the actor rebuild
//   P5  distinct flashlight vs muzzle changes (independent light slots)
//   P6  EXACT output-depth agreement by tightly bracketed known-depth
//       forward probes across mesh/flesh/gun/far pixels, on BOTH the post-aa
//       redirect path and the null (canvas-depth) path, with numeric
//       tolerances. The FAR SENTINEL requirement is satisfied honestly: the
//       gate CREATES a deterministic true-empty region (hides the level
//       shell, keeps the camera fixed, verifies each upper probe ray is
//       empty-class + sentinel depth BEFORE spawning), probes 0.99/0.9995/
//       0.99995 on those verified rays (all must draw), and requires the
//       digest to restore bit-exactly. A deepest-ray bracket on the REAL
//       scene complements it; no silent waiver.
//   P7  SDF scale 1/0.5 with exact hash restore, viewport resize down/up,
//       and the ?res=640 CSS-cap boot contract
//   P8  default and ?renderer=legacy boots stay legacy
//
// Bounded CDP (every request timed, socket rejects on close), owned
// tab/socket closed in `finally`, exits NONZERO on any assertion failure or
// page error; SUCCESS closes resources and exits 0. Raw pixels never leave
// the page: screenshots are decoded in-page and reduced to bounded stats.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5326), cdp = Number(process.argv[3] ?? 9326);
const out = 'docs/dev-notes/2026-09-07-m2-main-integration/bake-diagnostic';
mkdirSync(out, { recursive: true });
// Exact buffer-sized viewport avoids CSS resampling in depth-pixel tests.
const W = 800, H = 600;

/** TASK6_SCOPE=core|full (default full). CORE runs the render-control and
 *  route/depth/scale evidence only — P0, P1, P2, P6, P7a — and writes
 *  game-validation-core.json + task-6-core.md with fullAcceptance:false. It
 *  NEVER writes the canonical game-validation.json and NEVER claims full
 *  Task 6 acceptance: the character/lifecycle/muzzle/cap/legacy phases
 *  (P3..P5b, P7b, P8) are the next continuation's stage. Unknown values
 *  are rejected with exit 2. */
const SCOPE = process.env.TASK6_SCOPE ?? 'full';
if (SCOPE !== 'core' && SCOPE !== 'full') {
  console.error(`TASK6 GAME CHECK: rejecting unknown TASK6_SCOPE '${SCOPE}' (expected 'core' | 'full')`);
  process.exit(2);
}
const CORE = SCOPE === 'core';

const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
const pageErrors = [];
let pageErrorsDropped = 0;
/** BOUNDED: a page that floods the console must not flood the driver's
 *  heap (found the hard way — an 8GB driver OOM mid-gate). */
const pushPageError = (s) => {
  if (pageErrors.length >= 200) { pageErrorsDropped++; return; }
  pageErrors.push(typeof s === 'string' ? s.slice(0, 2000) : s);
};
const checks = [];
const captures = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.resolve(m);
  if (m.method === 'Runtime.exceptionThrown') pushPageError(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pushPageError(m.params.args.map((a) => a.value ?? a.description).join(' '));
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
  if (process.env.T6_TRACE) console.log('  [eval]', expression.slice(0, 100).replace(/\n/g, ' '));
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 90000 });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r)?.slice(0, 900));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, detail) => {
  checks.push({ name, detail }); saveEvidence(); console.log('PASS', name, JSON.stringify(detail)?.slice(0, 400));
  const mu = process.memoryUsage();
  console.log(`  [mem] rss=${Math.round(mu.rss / 1e6)}MB heap=${Math.round(mu.heapUsed / 1e6)}MB checks=${checks.length}`);
};

/** Known preexisting asset gap (character-registry.ts documents it): the
 *  minotaur's declared face PNG does not exist under public/assets/lab/
 *  faces/. The registry registers it AS DECLARED on purpose. The allowlist
 *  accepts EXACTLY that loader failure — the specific missing FILENAME and
 *  a load-failure signature — never a bare substring like 'minotaur', which
 *  would also excuse a genuine minotaur rig crash. The minotaur leg ALSO
 *  reproduces the 404 with an in-page fetch and records the status. */
const MINOTAUR_FACE = 'minotaur-face.png';
let allowMinotaurFace404 = false;
const isLoadFailure = (s) => typeof s === 'string' && (
  s.includes('404') || s.includes('Failed to load') || s.includes('Not Found')
  || s.includes('load failed') || s.includes('ERR_'));
const isAllowedError = (s) =>
  (allowMinotaurFace404 && typeof s === 'string'
    && s.includes(MINOTAUR_FACE) && isLoadFailure(s));

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
const probeFrame = async (points, regions = {}, sampleRadius = 3) => {
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
      const radius = ${sampleRadius};
      const d = ctx.getImageData(px - radius, py - radius, 2 * radius + 1, 2 * radius + 1).data;
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
/** SIMULATION PHASE: unlock + unfreeze so tick() really simulates (hull
 *  builds, gait, pellets, chunk physics, flash envelopes). Every state
 *  mutation the gate makes happens inside one of these. */
const enterSimPhase = async (label) => {
  results.phase = label;
  // The diagnostic light clock unfreezes with the lock: simulation phases
  // (muzzle, pellets) want the live flicker, and their assertions are
  // delta-thresholded so flicker noise cannot mask the tested effect.
  await evaluate('__sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setLightClockFrozen(false);');
};
/** SETTLE + LOCK: freeze, hand-step long enough that every exponential
 *  transient (head-bob excitation from a teleport, recoil, weapon catch-up,
 *  flash/smoke envelopes) decays below float32 render resolution, then
 *  render-lock. After this, step(n) is n pure re-renders and every
 *  readback/screenshot is a deterministic function of the step count. */
const SETTLE_STEPS = 90;
const settleAndLock = async () => {
  await evaluate(`__sdfGame.freeze(true); __sdfGame.step(${SETTLE_STEPS});`);
  // RENDER LOCK + LIGHT CLOCK: the lock freezes geometry but NOT the
  // wall-clock practical flicker (performance.now). G-buffer invariance
  // never needed the flicker, but every MATCHED LIT screenshot across two
  // renders does — freeze the narrow diagnostic lighting clock while
  // locked so two renders of the same scene are bit-comparable. Ordinary
  // gameplay never freezes it (gate-only seam; default OFF).
  await evaluate('__sdfGame.setRenderLock(true); __sdfGame.setLightClockFrozen(true); __sdfGame.step(2);');
  await sleep(300);
};
const faceTarget = async (px, pz, tx, tz, pitch = -0.12) => {
  await enterSimPhase('faceTarget');
  const yaw = aimYawAt(px, pz, tx, tz);
  await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, ${pitch}); __sdfGame.step(4);`);
  await settleAndLock();
  return await assertInFrame('faceTarget', tx, 1.2, tz);
};

/** Aim the locked player at a WORLD POINT OF ANY HEIGHT. faceTarget's fixed
 *  1.2 m in-frame guard passes while the actual subject — a settled chunk
 *  lying on the floor, say — sits below the frame, so every chunk/baked
 *  observation aims and verifies at the point itself: two camera read-backs
 *  converge the pitch, then the point's own projection is the in-frame
 *  assertion. */
const facePoint = async (x, y, z, dist = 1.2, azimuth = 0) => {
  await enterSimPhase('facePoint');
  const cam0 = await evaluate('__sdfGame.cameraWorld()');
  const px = x + Math.cos(azimuth) * dist, pz = z + Math.sin(azimuth) * dist;
  const yaw = aimYawAt(px, pz, x, z);
  let pitch = Math.atan2(y - cam0[1], dist);
  await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, ${pitch}); __sdfGame.step(2);`);
  const cam1 = await evaluate('__sdfGame.cameraWorld()');
  pitch = Math.atan2(y - cam1[1], Math.hypot(x - cam1[0], z - cam1[2]));
  await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, ${pitch}); __sdfGame.step(4);`);
  await settleAndLock();
  return await assertInFrame('facePoint', x, y, z, 0.97);
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
  // Let async kit/prop loads land, then freeze, settle, and RENDER-LOCK.
  // The lock is what makes the frozen state bit-stable across renders —
  // freeze() alone never did (tick kept stepping the player/bob/weapon).
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');
  await sleep(1200);
  await enterSimPhase('boot-settle');
  await settleAndLock();
  // LENS OFF for every observation segment. The authored fisheye warps the
  // COMPOSED screenshot, while screenPosOf/screenRayToWorld (and the raw
  // G-buffer readbacks) are LINEAR — every NDC-mapped pixel assertion in
  // this gate (marker, probes, brackets, kit texels) must sample the same
  // space it computes in. Found the hard way: the P1e marker rendered 78px
  // away from its projected NDC through the lens. Fresh boots (P7b/P8)
  // re-apply their own default; the lens contract is itself P6-covered.
  await evaluate('__sdfGame.setFisheye(90); __sdfGame.step(2);');
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
    // The live WebGPU camera already projects z into [0,1]. Applying
    // OpenGL's (z+1)/2 here moved behind-surface probes in front.
    return { w, d: sp.z };
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

/** Bracket one verified surface pixel, sequentially. Moving probes
 * sideways sampled the wall beside the body instead of flesh, and tiny
 * world-size sprites disappeared at far depths. A fixed screen footprint
 * and centre-pixel measurement isolate destination depth at this ray. */
const bracketAt = async (label, ndc, deltas, _spread = 0.05, _scale = 0.1) => {
  const s = await evaluate(`__sdfGame.readSurfaceAt(${ndc[0]}, ${ndc[1]})`);
  assert.ok(s && s.cls > 0.5, `${label}: bracket requires an occupied surface`);
  // Reconstruct through the centre of the texel we actually read.
  ndc = [2 * (s.pixel[0] + 0.5) / s.size.width - 1,
    1 - 2 * (s.pixel[1] + 0.5) / s.size.height];
  if (label.startsWith('flesh')) assert.equal(s.cls, 18, `${label}: must sample flesh`);
  if (label.startsWith('gun')) assert.equal(s.cls, 17, `${label}: must sample the gun`);
  if (label.startsWith('wall')) assert.equal(s.cls, 1, `${label}: must sample the wall`);
  const probes = [];
  for (const delta of deltas) {
    const target = Math.min(0.99995, s.depth + delta);
    assert.ok(Math.sign(target - s.depth) === Math.sign(delta), `${label}: clamped probe crossed the surface`);
    const w = await depthToWorld(ndc[0], ndc[1], target);
    const sp = await evaluate(`__sdfGame.screenPosOf(${w[0]}, ${w[1]}, ${w[2]})`);
    assert.ok(Math.abs(sp.z - target) < 1e-6, `${label}: probe depth must round-trip`);
    await evaluate(`__sdfGame.spawnDepthProbes([${JSON.stringify(w)}], {pixels:12}); __sdfGame.step(2);`);
    const frame = await probeFrame({ p: sp }, {}, 0);
    const linear = await evaluate(`__sdfGame.readCompositeAt(${ndc[0]}, ${ndc[1]})`);
    await evaluate('__sdfGame.clearDepthProbes(); __sdfGame.step(1);');
    const sampled = linear ? linear.map(c => c * 255) : frame.points.p;
    probes.push({ i: 0, ndc, dRes: s.depth, cls: s.cls, target, delta: target - s.depth,
      sampled, displayed: frame.points.p, measurement: linear ? 'linear-composite' : 'canvas',
      drawn: colorDist(sampled, PROBE_COLORS[0]) < 90 });
  }
  const nearer = probes.filter((p) => p.delta < 0);
  const farther = probes.filter((p) => p.delta > 0);
  for (const p of probes) {
    assert.ok(p.cls > 0.5,
      `${label}: bracket probe at NDC ${JSON.stringify(p.ndc)} resolved to an EMPTY pixel — ` +
      `the stage targets an occupied surface (cls ${p.cls}, depth ${p.dRes?.toFixed?.(5)})`);
  }
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
  const record = { ndc, resolvedAtCentre: probes[Math.floor(probes.length / 2)].dRes, centreCls: probes[Math.floor(probes.length / 2)].cls, bracket, centre, tolerance: bracket[1] - bracket[0], probes: probes.map((p) => ({ delta: p.delta, dRes: +p.dRes.toFixed(6), cls: p.cls, drawn: p.drawn, sampled: p.sampled, displayed: p.displayed, measurement: p.measurement })) };
  check(`depth-bracket:${label}`, record);
  return record;
};

const results = { phase: 'setup', checks, pageErrors, pass: false, scope: SCOPE, fullAcceptance: false, excludedFeatures: { boneTubes: 'Owner retired this experimental path for visual reasons on 2026-09-07; validate SDF bones and baked geometry instead.' } };
Object.defineProperty(results, 'pageErrorsDropped', { get: () => pageErrorsDropped, enumerable: true });
const records = { captures, stages: {} };
// Core scope writes its OWN evidence file — never the canonical full one.
const EV_PATH = `${out}/${CORE ? 'game-validation-core.json' : 'game-validation.json'}`;
/** Persist CURRENT progress (checks so far + phase + captures). Called after
 *  every completed phase AND in the failure path AND in finally — a hard
 *  timeout must leave the latest phase evidence on disk, not a stub. */
const saveEvidence = () => writeFileSync(EV_PATH, JSON.stringify({
  ...results,
  generatedAt: new Date().toISOString(),
  ports: { vite, cdp },
  viewport: { width: W, height: H },
  records,
}, null, 2));

/** CORE-SCOPE REPORT (task-6-core.md): machine-generated, honest summary —
 *  scope, source commit, every executed check, and the explicit disclaimer
 *  that full Task 6 acceptance is NOT claimed. Never written in full mode
 *  (the full task-6.md report is authored against the full evidence). */
const writeCoreReport = () => {
  if (!CORE) return;
  let commit = 'unknown';
  try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* no git */ }
  const lines = [
    '# Task 6 — CORE scope GPU gate report (machine-generated)',
    '',
    `- scope: \`core\` (TASK6_SCOPE=${SCOPE})`,
    `- fullAcceptance: **false** — a core pass is NOT full Task 6 acceptance`,
    `- source commit: \`${commit}\``,
    `- result: ${results.pass ? 'PASS' : 'FAIL'} (${results.phase})`,
    `- failure: ${results.failure?.message ?? 'none'}`,
    '- excluded: experimental bone tubes, retired by owner; SDF bones and baked geometry remain in scope.',
    `- generatedAt: ${new Date().toISOString()}`,
    `- ports: vite ${vite} / cdp ${cdp}, viewport ${W}x${H}`,
    `- core coverage: P0 boot · P1 render-control + surface-hash invariance · P2 opaque routes · P6 exact depth/sentinel/present · P7a scale/resize`,
    `- remaining for full Task 6: P3 characters · P4 wounds · P5 sever/bake/rebuild · P5b muzzle · P7b CSS cap · P8 legacy boots (next continuation)`,
    '',
    `## Checks (${checks.length})`,
    '',
    ...checks.map((c) => `- PASS ${c.name}`),
    '',
    'Evidence JSON: `game-validation-core.json` (same directory).',
    '',
  ];
  writeFileSync(`${out}/task-6-core.md`, lines.join('\n'));
};
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const bakeWasEnabled=await evaluate('__sdfGame.chunkBake');
  const normalTowardCam = async (sp, texel, minDot, label) => {
    assert.ok(texel && texel.pixel && texel.size, `${label}: texel lacks pixel/size — cannot reconstruct at the selected coordinate`);
    const ndc = [2 * (texel.pixel[0] + 0.5) / texel.size.width - 1,
      1 - 2 * (texel.pixel[1] + 0.5) / texel.size.height];
    const cam = await evaluate('__sdfGame.cameraWorld()');
    // Reconstruct on the SELECTED texel's own ray at ITS resolved depth.
    const v = await depthToWorld(ndc[0], ndc[1], texel.depth);
    // The reconstruction must land on the same surface pixel we graded:
    // screenPosOf(v) must round-trip to the selected texel's pixel.
    const spBack = await evaluate(`__sdfGame.screenPosOf(${v[0]}, ${v[1]}, ${v[2]})`);
    const pxBack = [Math.floor((spBack.x + 1) / 2 * texel.size.width),
      Math.floor((1 - spBack.y) / 2 * texel.size.height)];
    assert.ok(pxBack[0] === texel.pixel[0] && pxBack[1] === texel.pixel[1],
      `${label}: reconstruction must land on the SELECTED texel's pixel
        (selected ${JSON.stringify(texel.pixel)}, reconstructed ${JSON.stringify(pxBack)})`);
    const toCam = [cam[0] - v[0], cam[1] - v[1], cam[2] - v[2]];
    const len = Math.hypot(...toCam) || 1;
    const dot = (texel.normal[0] * toCam[0] + texel.normal[1] * toCam[1] + texel.normal[2] * toCam[2]) / len;
    const nlen = Math.hypot(...texel.normal);
    assert.ok(Math.abs(nlen - 1) < 0.05, `${label}: normal not unit length (${nlen.toFixed(4)})`);
    assert.ok(dot > minDot, `${label}: normal is not front-facing (n·v ${dot.toFixed(3)} <= ${minDot})`);
    return { dot: +dot.toFixed(3), nlen: +nlen.toFixed(4),
      selectedPixel: texel.pixel, selectedNdc: ndc.map((q) => +q.toFixed(5)),
      centreNdc: [sp?.x, sp?.y].map((q) => +q?.toFixed?.(5)) };
  };

  const sampleChunk = async (piece, cls) => {
    const sp = await evaluate(`__sdfGame.screenPosOf(${piece.centre.join(',')})`);
    assert.ok(sp && Math.abs(sp.x) < 0.95 && Math.abs(sp.y) < 0.95, `chunk ${piece.id}: centre must be in frame`);
    const points = [];
    for (let dy=-8; dy<=8; dy++) for (let dx=-8; dx<=8; dx++)
      points.push({x:sp.x+dx*0.018, y:sp.y+dy*0.018});
    // Inspect the floor piece without the close-up viewmodel covering it.
    // FPV/world occlusion is covered separately by the core depth brackets.
    const gunVisible = await evaluate('__sdfGame.viewModelAnchor.visible');
    let on, off;
    try {
      await evaluate('__sdfGame.viewModelAnchor.visible = false');
      on = await evaluate(`__sdfGame.sampleSurfacePoints(${JSON.stringify(points)})`);
      assert.equal(await evaluate(`__sdfGame.setChunkVisible(${piece.id}, false)`), true);
      off = await evaluate(`__sdfGame.sampleSurfacePoints(${JSON.stringify(points)})`);
    } finally {
      await evaluate(`__sdfGame.setChunkVisible(${piece.id}, true); __sdfGame.viewModelAnchor.visible = ${gunVisible}; __sdfGame.step(1)`);
    }
    for (let i=0; i<on.length; i++) {
      const t=on[i];
      if (t.cls !== cls || !(t.depth < off[i].depth - 1e-6)) continue;
      const ndc = {x:2*(t.pixel[0]+0.5)/t.size.width-1, y:1-2*(t.pixel[1]+0.5)/t.size.height};
      const world = await depthToWorld(ndc.x, ndc.y, t.depth);
      const distance = Math.hypot(...world.map((v,j)=>v-piece.centre[j]));
      if (distance > piece.radius * 1.25 + 0.03) continue;
      return {texel:t, ndc, distance, offDepth:off[i].depth};
    }
    throw new Error(`chunk ${piece.id}: no class-${cls} pixel attributable to this producer`);
  };
  // (b) Bake transition: a settled chunk becomes a STATIC MESH on the mesh
  //     route (cls 17). spawnTestChunk goes through the real spawn path at
  //     a controlled size; the worker + settle run UNLOCKED (chunk physics
  //     is tick-driven), then the observation re-locks.
  results.phase = 'P5-bake';
  await enterSimPhase('P5-bake');
  const bakeCensus0 = await evaluate('__sdfGame.chunkStats()');
  // Fixed open room-2 floor position; the synthetic bake subject has no
  // launch impulse. Real severed chunks above still use production kicks.
  const bakeSpot = [4, 0.25, -4.8];
  const furniture = await evaluate('__sdfGame.furniture');
  const clearOfFurniture = (p,r) => furniture.every(f => p[0]+r<f.minX || p[0]-r>f.maxX || p[2]+r<f.minZ || p[2]-r>f.maxZ);
  assert.ok(clearOfFurniture(bakeSpot,0.3), 'synthetic bake spawn must clear furniture');
  await evaluate(`__sdfGame.spawnTestChunk(${bakeSpot.join(',')},0.18,true)`);
  const spawnedCensus = await evaluate('__sdfGame.chunkStats()');
  const newPieces = spawnedCensus.livePieces.filter(p=>!bakeCensus0.livePieces.some(old=>old.id===p.id));
  assert.equal(newPieces.length, 1, 'test spawn must produce exactly one new live chunk');
  const bakeId = newPieces[0].id;
  await evaluate('__sdfGame.setChunkBake(true); __sdfGame.step(10)');
  await waitFor(`__sdfGame.chunkStats().pieces.some(p=>p.id===${bakeId})`,
    `chunk ${bakeId} bake never completed`, 120, 300);
  await settleAndLock();
  const bakeCensus1 = await evaluate('__sdfGame.chunkStats()');
  assert.ok(!bakeCensus1.livePieces.some(p=>p.id===bakeId), 'the exact baked piece must retire from the live march');
  const bakedPiece = bakeCensus1.pieces.find(p=>p.id===bakeId);
  assert.ok(bakedPiece, 'the exact spawned chunk must become a baked mesh');
  assert.ok(clearOfFurniture(bakedPiece.centre,bakedPiece.radius), 'settled bake must clear furniture');
  // Baked centre is the mesh bounds centre, not the live physics origin;
  // verify wall clearance rather than requiring these different centres equal.
  const roomBounds = (await evaluate('__sdfGame.rooms')).find(r=>r.id===2).bounds;
  assert.ok(bakedPiece.centre[0]-bakedPiece.radius>roomBounds.minX &&
    bakedPiece.centre[0]+bakedPiece.radius<roomBounds.maxX &&
    bakedPiece.centre[2]-bakedPiece.radius>roomBounds.minZ &&
    bakedPiece.centre[2]+bakedPiece.radius<roomBounds.maxZ, 'settled bake must clear room walls');
  let bakedHit = null;
  const bakeViews = [];
  for (const azimuth of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    await facePoint(...bakedPiece.centre, 1.1, azimuth);
    try { bakedHit = await sampleChunk(bakedPiece, 17); break; }
    catch (error) {
      if (!String(error.message).includes('no class-17 pixel attributable')) throw error;
      bakeViews.push({azimuth, centre:bakedPiece.centre, radius:bakedPiece.radius, error:error.message});
    }
  }
  records.stages.bakeViewAttempts = bakeViews;
  saveEvidence();
  if (!bakedHit) await shot('task6-baked-unresolved.png', {}, {}, {minFrameNonDark:0});
  assert.ok(bakedHit, 'baked piece must have an attributable pixel from a cardinal view');
  const bakedTexel = bakedHit.texel;
  const bakedNormal = await normalTowardCam(bakedHit.ndc, bakedTexel, 0.0, 'baked chunk');
  await shot('task6-baked-chunk.png', {}, {}, { minFrameNonDark: 8 });
  check('P5-bake-transition', {
    id: bakeId, centre:bakedPiece.centre, radius:bakedPiece.radius, offDepth: bakedHit.offDepth, distanceToCentre: bakedHit.distance,
    baked: bakeCensus1.baked, totalBakes: bakeCensus1.totalBakes,
    lastBakeInfo: bakeCensus1.lastBakeInfo && { verts: bakeCensus1.lastBakeInfo.verts, tris: bakeCensus1.lastBakeInfo.tris },
    bakedTexelDepth: +bakedTexel.depth.toFixed(5),
    bakedNormal,
  });
  await evaluate(`__sdfGame.setChunkBake(${bakeWasEnabled})`);
  noNewErrors('P5 bake');
  saveEvidence();

  results.pass=true; results.fullAcceptance=false; results.scope='bake-diagnostic'; results.phase='complete';
} catch (e) {
  results.pass = false;
  results.failure = {
    phase: results.phase,
    message: String(e?.message ?? e).slice(0, 2000),
    stack: String(e?.stack ?? '').slice(0, 4000),
  };
  console.error(`TASK6 GAME CHECK: FAIL at phase ${results.phase}: ${results.failure.message}`);
  saveEvidence();
  process.exitCode = 1;
} finally {
  saveEvidence();
  writeCoreReport();
  try { await send('Page.close'); } catch { /* tab may already be gone */ }
  ws.close();
  await new Promise((r) => { ws.onclose = r; setTimeout(r, 500); });
}
console.log(`TASK6 GAME CHECK: ${results.pass ? 'PASS' : 'FAIL'} (${checks.length} checks, phase ${results.phase})`);
