// M2 task 7 — shadow/effect visual gate: matched legacy/deferred material
// captures, the shadow scenarios, and the scene captures, over the task-6
// CDP conventions (private ports, owned lifecycle, in-page screenshot
// decode, bounded evals). FUNCTIONAL + CAPTURE phase only: timing lives in
// scripts/deferred-game-timing-check.mjs so a slow timing run can never
// conceal completed functional evidence. Evidence saves after EVERY phase.
//
// Scope note (owner, 2026-09-07): gameplay roster is zombie/soldier/goblin
// only. Material appearance is the open task-6 defect; the captures here
// are the evidence the review reads — functional PASS records are anchor
// math, not aesthetic approval.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5356), cdp = Number(process.argv[3] ?? 9356);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
mkdirSync(out, { recursive: true });
const W = 800, H = 600;
const ROSTER = ['zombie', 'soldier', 'goblin'];

const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
const pageErrors = [];
let pageErrorsDropped = 0;
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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 90000 });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r)?.slice(0, 900));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, detail) => {
  checks.push({ name, detail }); saveEvidence(); console.log('PASS', name, JSON.stringify(detail)?.slice(0, 300));
};
const fail = (name, detail) => {
  checks.push({ name: `${name}:FAIL`, detail }); saveEvidence(); console.log('FAIL', name, JSON.stringify(detail)?.slice(0, 400));
};
const results = { phase: 'setup', checks, pageErrors, pass: false, scope: 'task7-material-shadow', fullAcceptance: false };
Object.defineProperty(results, 'pageErrorsDropped', { get: () => pageErrorsDropped, enumerable: true });
const records = { captures, stages: {} };
const EV_PATH = `${out}/shadow-validation.json`;
const saveEvidence = () => writeFileSync(EV_PATH, JSON.stringify({
  ...results, records,
  ports: { vite, cdp }, viewport: { width: W, height: H },
  generatedAt: new Date().toISOString(),
}, null, 1));

const isAllowedError = (s) => typeof s === 'string' && s.includes('minotaur-face.png')
  && (s.includes('404') || s.includes('Failed to load') || s.includes('Not Found') || s.includes('load failed') || s.includes('ERR_'));
let errMark = 0;
const noNewErrors = (stage) => {
  const fresh = pageErrors.slice(errMark);
  errMark = pageErrors.length;
  const unexpected = fresh.filter((s) => !isAllowedError(s));
  assert.deepEqual(unexpected, [], `${stage}: page must be error-free (got ${JSON.stringify(unexpected)?.slice(0, 700)})`);
};

const RECT = { left: 0, top: 0, width: W, height: H };
const syncRect = async () => {
  const r = await evaluate(`(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; })()`);
  Object.assign(RECT, r);
};
const ndcPx = (sp) => [
  Math.round(RECT.left + (sp.x + 1) / 2 * RECT.width),
  Math.round(RECT.top + (1 - sp.y) / 2 * RECT.height),
];
const regionPx = (r) => {
  const [x0, y0] = ndcPx({ x: r[0], y: r[1] });
  const [x1, y1] = ndcPx({ x: r[2], y: r[3] });
  return [Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)),
    Math.min(RECT.width - 1, Math.max(x0, x1)), Math.min(RECT.height - 1, Math.max(y0, y1))];
};

/** One fresh screenshot decoded in page: 7x7 means at NDC points, region
 *  stats (mean/lum/clip/dark + brightPct — the specular-proxy fraction),
 *  and full-frame nonDark. Saves THE frame it measured. */
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
      let r = 0, g = 0, b = 0, clip = 0, dark = 0, bright = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] + d[i + 1] + d[i + 2];
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        if (d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246) clip++;
        if (lum < 24) dark++;
        if (lum > 600) bright++;
      }
      regions[k] = { mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
        lum: Math.round((r + g + b) / (3 * n)),
        clipPct: Math.round(1000 * clip / n) / 10, darkPct: Math.round(1000 * dark / n) / 10,
        brightPct: Math.round(1000 * bright / n) / 10 };
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
  saveEvidence();
  return stats;
};

const SETTLE_STEPS = 90;
const enterSimPhase = async (label) => {
  results.phase = label;
  await evaluate('__sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setLightClockFrozen(false);');
};
const settleAndLock = async () => {
  await evaluate(`__sdfGame.freeze(true); __sdfGame.step(${SETTLE_STEPS});`);
  await evaluate('__sdfGame.setRenderLock(true); __sdfGame.setLightClockFrozen(true); __sdfGame.step(2);');
  await sleep(300);
};
const aimYawAt = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));
const assertInFrame = async (label, x, y, z, maxNdc = 0.9) => {
  const sp = await evaluate(`__sdfGame.screenPosOf(${x}, ${y}, ${z})`);
  assert.ok(sp && Math.abs(sp.x) <= maxNdc && Math.abs(sp.y) <= maxNdc && sp.z < 1,
    `${label}: subject NOT in frame (ndc ${JSON.stringify(sp)})`);
  return sp;
};
/** Face a world point from dist metres along +x of the target (two
 *  read-backs converge the pitch), then settle+lock. Returns the locked
 *  camera world position. */
const facePointFrom = async (x, y, z, dist = 1.8, pitchBias = 0) => {
  await enterSimPhase('face');
  const standX = x + dist, standZ = z;
  const yaw2 = aimYawAt(standX, standZ, x, z);
  const cam0 = await evaluate('__sdfGame.cameraWorld()');
  let pitch = Math.atan2(y - cam0[1], dist) + pitchBias;
  await evaluate(`__sdfGame.setPose(${standX}, ${standZ}, ${yaw2}, ${pitch}); __sdfGame.step(2);`);
  const cam1 = await evaluate('__sdfGame.cameraWorld()');
  pitch = Math.atan2(y - cam1[1], Math.hypot(x - cam1[0], z - cam1[2])) + pitchBias;
  await evaluate(`__sdfGame.setPose(${standX}, ${standZ}, ${yaw2}, ${pitch}); __sdfGame.step(4);`);
  await settleAndLock();
  return { cam: await evaluate('__sdfGame.cameraWorld()'), standX, standZ, yaw: yaw2, pitch };
};
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
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');
  await sleep(1200);
  await enterSimPhase('boot-settle');
  await settleAndLock();
  await evaluate('__sdfGame.setFisheye(90); __sdfGame.step(2);');
  await syncRect();
};

/** Spawn one roster character through the real gameplay path, face it from
 *  dist metres, return { id, anchor } with its torso world anchor. */
const pose = { pos: [0, 0, 0], yaw: 0, pitch: 0 };
const spawnAndFace = async (name, dist = 1.8) => {
  const spawned = await evaluate(`__sdfGame.spawnDebugCharacter(${JSON.stringify(name)})`);
  assert.ok(spawned && spawned.id > 0, `${name}: spawn failed ${JSON.stringify(spawned)}`);
  await evaluate(`__sdfGame.step(20)`);
  const z = await evaluate(`__sdfGame.zombies().find(q => q.id === ${spawned.id})`);
  assert.ok(z, `${name}: spawned actor missing from the roster`);
  const anchor = [z.pos[0], z.pos[1] === undefined ? 1.05 : z.pos[1] + 1.05, z.pos[2]];
  const { cam } = await facePointFrom(anchor[0], anchor[1], anchor[2], dist);
  await assertInFrame(`${name} torso`, anchor[0], anchor[1], anchor[2], 0.8);
  return { id: spawned.id, anchor, cam, actor: z };
};
/** NDC box around an anchor's HEAD-TO-HIP core (excludes the legs where the
 *  FPV viewmodel overlaps at 1.8 m, and only a small pad — the 2026-09-06
 *  material captures showed a wide box drags background/viewmodel into the
 *  subject stats). */
const subjectBox = async (anchor, pad = 0.1) => {
  const head = await evaluate(`__sdfGame.screenPosOf(${anchor[0]}, ${anchor[1] + 0.45}, ${anchor[2]})`);
  const hip = await evaluate(`__sdfGame.screenPosOf(${anchor[0]}, ${anchor[1] - 0.35}, ${anchor[2]})`);
  return [Math.min(head.x, hip.x) - pad, Math.min(head.y, hip.y) - pad,
    Math.max(head.x, hip.x) + pad, Math.max(head.y, hip.y) + pad];
};

try {
  // ===================================================================
  // P0 — deferred boot contract for THIS gate (fleshDisplay + shadows)
  // ===================================================================
  results.phase = 'P0-boot';
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const diag0 = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diag0.mode, 'deferred', 'deferred boot required');
  assert.equal(diag0.fleshDisplay, true, 'authored flesh response must be ON for the game path');
  assert.ok(diag0.shadow.generationRequested && diag0.shadow.sampling, 'shadows must boot on');
  assert.ok(diag0.shadow.renderedMaps >= 2, `shadow maps must render (${JSON.stringify(diag0.shadow)})`);
  check('P0-boot-deferred-task7', {
    fleshDisplay: diag0.fleshDisplay,
    shadow: diag0.shadow,
    sizes: diag0.sizes,
  });

  // ===================================================================
  // P1 — MATCHED material captures: deferred vs legacy per roster actor
  // ===================================================================
  results.phase = 'P1-materials';
  const matStats = {};
  for (const renderer of ['deferred', 'legacy']) {
    for (const name of ROSTER) {
      const url = `http://localhost:${vite}/sdf-game.html?renderer=${renderer}`;
      await boot(url);
      const { anchor } = await spawnAndFace(name, 1.8);
      const box = await subjectBox(anchor);
      const cap = await shot(`task7-mat-${renderer}-${name}.png`, {}, { subject: box }, { minFrameNonDark: 10 });
      matStats[`${renderer}-${name}`] = {
        actor: name, renderer, anchor,
        subject: cap.regions.subject,
        frame: cap.frame,
      };
      console.log(`  mat ${renderer}/${name}: lum=${cap.regions.subject.lum} brightPct=${cap.regions.subject.brightPct} clipPct=${cap.regions.subject.clipPct}`);
    }
  }
  // Paired reading (evidence for the review — NOT an aesthetic verdict):
  // the deferred subject should no longer be flatter than legacy by the
  // 2026-09-06 gap (deferred brightPct ~0 vs legacy double digits).
  for (const name of ROSTER) {
    const d = matStats[`deferred-${name}`], l = matStats[`legacy-${name}`];
    check(`P1-material-capture-${name}`, {
      deferred: { lum: d.subject.lum, brightPct: d.subject.brightPct, clipPct: d.subject.clipPct },
      legacy: { lum: l.subject.lum, brightPct: l.subject.brightPct, clipPct: l.subject.clipPct },
      note: 'aesthetic judgment lives in review.md; these numbers are the matched-view evidence',
    });
  }
  records.stages.materials = matStats;
  saveEvidence();

  // ===================================================================
  // P2 — shadow scenarios (one deferred boot; in-boot toggles are the
  // documented seams: setSpotShadow=GENERATION, setSpotShadowSampling=SAMPLING)
  // ===================================================================
  results.phase = 'P2-shadows';
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const subject = await spawnAndFace('zombie', 1.8);

  const regionSample = async (label, box, points = {}) => (await probeFrame(points, { r: box })).regions.r;

  // S1 SAMPLING toggle: the ONE variable is whether the lit stage reads the
  // maps. The proxy cast shadow lands WHERE THE GEOMETRY PUTS IT — not where
  // a ray-to-floor guess assumes (the first staging measured a lit region:
  // 206 vs 206). Sample a GRID over the floor around/below the silhouette in
  // BOTH states and report the full delta field; the assertion is that SOME
  // floor candidate darkens by >8% — cast-shadow evidence on actual pixels,
  // not an assumed anchor.
  await evaluate('__sdfGame.step(2)');
  const gridDeltas = [];
  const gridPts = [];
  for (let iy = 0; iy < 5; iy++) {
    for (let ix = 0; ix < 7; ix++) {
      const gx = -0.45 + ix * 0.15, gy = -0.72 + iy * 0.13;
      gridPts.push({ id: `g${ix}_${iy}`, x: gx, y: gy });
    }
  }
  const samplePts = async () => {
    const pts = Object.fromEntries(gridPts.map((p) => [p.id, { x: p.x, y: p.y }]));
    return (await probeFrame(pts, {})).points;
  };
  await shot('task7-shadow-on.png', {}, {});
  const onPts = await samplePts();
  await evaluate('__sdfGame.setSpotShadowSampling(false); __sdfGame.step(3);');
  await shot('task7-shadow-sampling-off.png', {}, {});
  const offPts = await samplePts();
  await evaluate('__sdfGame.setSpotShadowSampling(true); __sdfGame.step(2);');
  for (const p of gridPts) {
    const on = onPts[p.id], off = offPts[p.id];
    const lumOn = on[0] + on[1] + on[2], lumOff = off[0] + off[1] + off[2];
    gridDeltas.push({ pt: [p.x, p.y], lumOn: Math.round(lumOn / 3), lumOff: Math.round(lumOff / 3),
      drop: Math.round(1000 * (lumOff - lumOn) / Math.max(lumOff, 1)) / 1000 });
  }
  const maxDrop = Math.max(...gridDeltas.map((g) => g.drop));
  assert.ok(maxDrop > 0.08,
    `S1: no floor candidate darkens >8% with sampling on (max drop ${(maxDrop * 100).toFixed(1)}%) — cast shadows missing`);
  check('S1-proxy-cast-shadow-grid', { maxDrop, grid: gridDeltas });
  const litOn = { lum: Math.round(gridDeltas.reduce((s, g) => s + g.lumOn, 0) / gridDeltas.length) };
  const litOff = { lum: Math.round(gridDeltas.reduce((s, g) => s + g.lumOff, 0) / gridDeltas.length) };

  // S2 receiver near its own proxy: flesh must NOT be swallowed by the
  // character's own hull (level-only map). Flesh anchor, shadow on vs off.
  const fleshSp = await assertInFrame('flesh anchor', subject.anchor[0], subject.anchor[1], subject.anchor[2], 0.8);
  const fleshBox = [fleshSp.x - 0.05, fleshSp.y - 0.05, fleshSp.x + 0.05, fleshSp.y + 0.05];
  const fleshOn = await regionSample('flesh-on', fleshBox);
  await evaluate('__sdfGame.setSpotShadowSampling(false); __sdfGame.step(3);');
  const fleshOff = await regionSample('flesh-off', fleshBox);
  await evaluate('__sdfGame.setSpotShadowSampling(true); __sdfGame.step(2);');
  const swallow = (fleshOff.lum - fleshOn.lum) / Math.max(fleshOff.lum, 1);
  assert.ok(swallow < 0.5,
    `S2: own proxy must not swallow its flesh (on ${fleshOn.lum} vs off ${fleshOff.lum})`);
  check('S2-receiver-near-own-proxy', { fleshOn, fleshOff, relativeSwallow: Math.round(swallow * 1000) / 1000 });

  // S3 light/caster moves one step: rotate the camera (the flashlight rides
  // it) a fixed yaw step; re-run the SAME grid — the cast-shadow pattern
  // must MOVE with the light (same-frame map updates).
  await evaluate('__sdfGame.setRenderLock(false); __sdfGame.step(1);');
  const pose0 = await evaluate('__sdfGame.pose()');
  await evaluate(`__sdfGame.setPose(${subject.anchor[0] + 1.8}, ${subject.anchor[2]}, ${pose0.yaw + 0.12}, ${pose0.pitch}); __sdfGame.step(6);`);
  await settleAndLock();
  const movedPts = await samplePts();
  const movedDeltas = gridDeltas.map((g) => {
    const m = movedPts[g.pt ? gridPts.find((p) => p.x === g.pt[0] && p.y === g.pt[1]).id : 'g0_0'];
    const lumM = m[0] + m[1] + m[2];
    return { pt: g.pt, lumMoved: Math.round(lumM / 3), shift: Math.round(1000 * (lumM / 3 - g.lumOn) / Math.max(g.lumOn, 1)) / 1000 };
  });
  const maxShift = Math.max(...movedDeltas.map((g) => Math.abs(g.shift)));
  assert.ok(maxShift > 0.02,
    `S3: shadow pattern must move with the light (max grid shift ${(maxShift * 100).toFixed(1)}%)`);
  check('S3-light-move-one-step', { maxShift, grid: movedDeltas });
  await shot('task7-shadow-on-moved.png', {}, {});

  // S4 wall between beam and flesh: scan the roster cast for an occluded
  // actor (projected torso classifies non-flesh) — that wall IS the caster.
  const others = await evaluate(`__sdfGame.zombies().filter(q => q.id !== ${subject.id})`);
  let wallCase = null;
  for (const o of others.slice(0, 6)) {
    const a = [o.pos[0], (o.pos[1] ?? 0) + 1.05, o.pos[2]];
    try {
      const sp = await evaluate(`__sdfGame.screenPosOf(${a[0]}, ${a[1]}, ${a[2]})`);
      if (!sp || Math.abs(sp.x) > 0.75 || Math.abs(sp.y) > 0.75 || sp.z >= 1) continue;
      const s = await evaluate(`__sdfGame.sampleSurfacePoints([{x: ${sp.x}, y: ${sp.y}}])`);
      const cls = s?.[0]?.cls ?? 0;
      if (cls !== 2) { wallCase = { actor: o.id, ndc: sp, occluderClass: cls, anchor: a }; break; }
    } catch { /* one unreadable actor must not kill the phase */ }
  }
  if (wallCase) {
    await shot('task7-shadow-wall-between.png', { occludedAnchor: wallCase.ndc }, {});
    check('S4-wall-between-beam-and-flesh', { ...wallCase, note: 'projected torso occluded by level caster (class != flesh)' });
  } else {
    fail('S4-wall-between-beam-and-flesh', { note: 'no occluded roster actor found from the locked pose — recorded honestly, scenario not staged' });
  }
  const genDiag = await evaluate('__sdfGame.deferredDiagnostics()');
  check('P2-generation-vs-sampling-counters', { shadow: genDiag.shadow });

  // S5 generation disabled AT BOOT (?spotshadow=0): maps never render, the
  // beam still lights flesh (ablation, not a blackout).
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred&spotshadow=0`);
  const genOffSubject = await spawnAndFace('zombie', 1.8);
  const genDiagOff = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(genDiagOff.shadow.generationRequested, false, 'boot ablation must seed generationRequested=false');
  assert.equal(genDiagOff.shadow.renderedMaps, 0, 'generation off must render zero maps');
  const gAnchor = genOffSubject.anchor;
  const gSp = await assertInFrame('gen-off flesh', gAnchor[0], gAnchor[1], gAnchor[2], 0.8);
  const genCap = await shot('task7-shadow-gen-off.png', { flesh: gSp }, {},
    { minFrameNonDark: 10 });
  assert.ok(genCap.points.flesh[0] + genCap.points.flesh[1] + genCap.points.flesh[2] > 30,
    `S5: flesh must stay beam-lit with maps disabled (got ${JSON.stringify(genCap.points.flesh)})`);
  check('S5-generation-off-boot', { shadow: genDiagOff.shadow, flesh: genCap.points.flesh });

  // ===================================================================
  // P3 — scene/effect captures (deferred + matched legacy where named)
  // ===================================================================
  results.phase = 'P3-scenes';
  // Beam/wounds (deferred): slug crater under the flashlight.
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const w = await spawnAndFace('zombie', 1.8);
  const camW = w.cam;
  const dir = [w.anchor[0] - camW[0], w.anchor[1] - camW[1], w.anchor[2] - camW[2]];
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  await evaluate(`__sdfGame.stampWoundAt(${camW[0]}, ${camW[1]}, ${camW[2]}, ${dir[0] / dl}, ${dir[1] / dl}, ${dir[2] / dl}, 'slug', ${w.id}); __sdfGame.step(30);`);
  await settleAndLock();
  const woundBox = await subjectBox(w.anchor, 0.34);
  const woundDef = await shot('task7-deferred-wounded.png', {}, { subject: woundBox }, { minFrameNonDark: 10 });
  check('P3-deferred-wounded', { subject: woundDef.regions.subject });

  // Beam/wounds (legacy, matched framing).
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=legacy`);
  const wl = await spawnAndFace('zombie', 1.8);
  const camL = wl.cam;
  const dirL = [wl.anchor[0] - camL[0], wl.anchor[1] - camL[1], wl.anchor[2] - camL[2]];
  const dlL = Math.hypot(dirL[0], dirL[1], dirL[2]);
  await evaluate(`__sdfGame.stampWoundAt(${camL[0]}, ${camL[1]}, ${camL[2]}, ${dirL[0] / dlL}, ${dirL[1] / dlL}, ${dirL[2] / dlL}, 'slug', ${wl.id}); __sdfGame.step(30);`);
  await settleAndLock();
  const woundBoxL = await subjectBox(wl.anchor, 0.34);
  const woundLeg = await shot('task7-legacy-wounded.png', {}, { subject: woundBoxL }, { minFrameNonDark: 10 });
  check('P3-legacy-wounded', { subject: woundLeg.regions.subject });

  // Goblin kit close-up (deferred) — the kit's iron under the authored look.
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const g = await spawnAndFace('goblin', 1.1);
  const gBox = await subjectBox(g.anchor, 0.36);
  const gob = await shot('task7-deferred-goblin-kit.png', {}, { subject: gBox }, { minFrameNonDark: 10 });
  check('P3-deferred-goblin-kit', { subject: gob.regions.subject });

  // Soldier held prop + pose (deferred).
  const s = await spawnAndFace('soldier', 1.6);
  const sBox = await subjectBox(s.anchor, 0.4);
  const sol = await shot('task7-deferred-soldier-prop.png', {}, { subject: sBox }, { minFrameNonDark: 10 });
  check('P3-deferred-soldier-prop', { subject: sol.regions.subject });

  // Dark dungeon: default rig, corridor view (deferred).
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const dark = await shot('task7-deferred-dark-dungeon.png', {}, {}, { minFrameNonDark: 3 });
  check('P3-deferred-dark-dungeon', { frame: dark.frame });

  // Detached-to-baked chunk transition (deferred): synthetic live chunk,
  // then bake it, same framing.
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const zc = await evaluate('__sdfGame.zombies()');
  const zb = zc?.[0];
  assert.ok(zb, 'boot cast must contain a zombie for the chunk scene');
  await facePointFrom(zb.pos[0] + 1.2, 0.35, zb.pos[2] + 0.4, 1.2);
  const chunk = await evaluate(`__sdfGame.spawnTestChunk(${zb.pos[0] + 0.5}, 0.4, ${zb.pos[2]}, 0.12, true)`);
  assert.ok(chunk, 'spawnTestChunk failed');
  await evaluate('__sdfGame.step(30)');
  await settleAndLock();
  const liveSp = await evaluate(`__sdfGame.screenPosOf(${zb.pos[0] + 0.5}, 0.4, ${zb.pos[2]})`);
  if (liveSp && Math.abs(liveSp.x) < 0.85 && Math.abs(liveSp.y) < 0.85) {
    const liveBox = [liveSp.x - 0.12, liveSp.y - 0.12, liveSp.x + 0.12, liveSp.y + 0.12];
    const liveCap = await shot('task7-deferred-chunk-live.png', {}, { chunk: liveBox }, { minFrameNonDark: 3 });
    const bakeWas = await evaluate('__sdfGame.setChunkBake(true); __sdfGame.step(240); true');
    await settleAndLock();
    const bakedCap = await shot('task7-deferred-chunk-baked.png', {}, { chunk: liveBox }, { minFrameNonDark: 3 });
    check('P3-detached-to-baked-chunks', {
      live: liveCap.regions.chunk, baked: bakedCap.regions.chunk, bakeWas,
      note: 'same framing; the baked mesh keeps the bounded mesh response by design (documented in review.md)',
    });
    await evaluate('__sdfGame.setChunkBake(false)');
  } else {
    fail('P3-detached-to-baked-chunks', { note: 'chunk not in frame after spawn — recorded honestly' });
  }

  // Blood crossing body/level: multi-wound torso + floor blood, deferred.
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const b = await spawnAndFace('zombie', 1.8);
  const camB = b.cam;
  for (const dy of [-0.25, 0, 0.2]) {
    const dB = [b.anchor[0] - camB[0], b.anchor[1] + dy - camB[1], b.anchor[2] - camB[2]];
    const dlB = Math.hypot(dB[0], dB[1], dB[2]);
    await evaluate(`__sdfGame.stampWoundAt(${camB[0]}, ${camB[1]}, ${camB[2]}, ${dB[0] / dlB}, ${dB[1] / dlB}, ${dB[2] / dlB}, 'pellet', ${b.id}); __sdfGame.step(12);`);
  }
  await settleAndLock();
  const bloodBox = await subjectBox(b.anchor, 0.4);
  const blood = await shot('task7-deferred-blood.png', {}, { subject: bloodBox }, { minFrameNonDark: 10 });
  check('P3-blood-crossing', { subject: blood.regions.subject });

  noNewErrors('P3-scenes');
  saveEvidence();

  results.pass = checks.every((c) => !String(c.name).endsWith(':FAIL'));
  results.phase = 'complete';
  saveEvidence();
  console.log(`\nTASK7 material/shadow gate: ${checks.length} checks, pass=${results.pass}`);
} catch (e) {
  results.error = String(e?.stack ?? e).slice(0, 2000);
  results.phase = `${results.phase}:error`;
  saveEvidence();
  console.error('TASK7 gate error:', e?.message ?? e);
  console.error(results.error);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { /* owned socket only */ }
  try { await fetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch { /* owned tab only */ }
}
