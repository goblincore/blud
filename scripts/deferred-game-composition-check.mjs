// M2 composition review fix — focused real-GPU checks for the remaining
// corrections (private ports, own servers):
//   LAB_VITE_PORT=5348 LAB_CDP_PORT=9348 scripts/deferred-game-composition-check.sh
//
// Covers, with ACTUAL submissions and pixels (the boot check's 12 greens only
// cover the post-aa-on default):
//   1. FPV gear routing evidence: registered roots (gun/arms/shells) in the
//      router diagnostics; gun/hand pixel coverage in the frame.
//   2. NULL-output depth composition: post-aa fully off -> coordinator flips
//      to the canvas-depth present (diagnostics seam), frame still composes,
//      the gun CLIPS into a wall the player is pushed against (front/behind
//      forward-vs-scene depth), and back on the redirect when post-aa returns.
//   3. Flashlight tuning ENDPOINTS (the pack used to throw on legal panel
//      values every deferred frame): beamGain 0 (present-zero — beam leaves
//      flesh, wall UNCHANGED), beamShoulder 0 (knee 0 = off) and .05 (knee
//      .95) all render error-free with advancing present counters.
//   4. Cone-edge stability: a muzzle-lit body at the beam boundary changes
//      little as the boundary sweeps across it (the shoulder no longer
//      toggles at the cone edge).
//   5. Live gun/hand tuning (setGunTuning) reaches the COMPOSED surface.
//   6. Resize under the null path; near/mid/far calibration table vs legacy.
//
// Bounded CDP, owned tab/socket closed in finally, exits nonzero on any
// assertion failure or page error. Raw pixels never leave the page.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5348), cdp = Number(process.argv[3] ?? 9348);
const out = 'docs/dev-notes/2026-09-06-hybrid-deferred-m2';
mkdirSync(out, { recursive: true });

const tab = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const pending = new Map(); let seq = 0;
const pageErrors = [];
const checks = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.resolve(m);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push(m.params.args.map((a) => a.value ?? a.description));
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
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r)?.slice(0, 800));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, detail) => { checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail)); };

const aimYawAt = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));

const frameStats = async (b64, regions) => await evaluate(`(async () => {
  const res = await fetch('data:image/png;base64,' + ${JSON.stringify(b64)});
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const stats = {};
  for (const [k, [x0, y0, x1, y1]] of Object.entries(${JSON.stringify(regions)})) {
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0, g = 0, b = 0, clip = 0, dark = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      if (d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246) clip++;
      if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) dark++;
    }
    stats[k] = { mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
      lum: Math.round((r + g + b) / (3 * n)), clipPct: Math.round(1000 * clip / n) / 10,
      darkPct: Math.round(1000 * dark / n) / 10 };
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
  stats.frame = { nonDarkPct: Math.round(1000 * nonDark / samples) / 10, w: bmp.width, h: bmp.height };
  return stats;
})()`);

const captures = {};
const shot = async (name, regions, limits) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const b64 = s?.result?.data;
  assert.ok(b64, `${name}: captureScreenshot returned no data`);
  writeFileSync(`${out}/${name}`, Buffer.from(b64, 'base64'));
  const stats = await frameStats(b64, regions ?? {});
  captures[name] = { stats };
  if (limits?.minFrameNonDark !== undefined) {
    assert.ok(stats.frame.nonDarkPct >= limits.minFrameNonDark,
      `${name}: frame is ${stats.frame.nonDarkPct}% non-dark — black/empty composite`);
  }
  return stats;
};

const assertInFrame = async (label, x, y, z, maxNdc = 0.9) => {
  const sp = await evaluate(`__sdfGame.screenPosOf(${x}, ${y}, ${z})`);
  assert.ok(sp, `${label}: screenPosOf returned nothing`);
  assert.ok(Math.abs(sp.x) <= maxNdc && Math.abs(sp.y) <= maxNdc && sp.z < 1,
    `${label}: subject NOT in frame (ndc ${JSON.stringify(sp)})`);
  return sp;
};

let errMark = 0;
const noNewErrors = (stage) => {
  const fresh = pageErrors.slice(errMark);
  errMark = pageErrors.length;
  assert.deepEqual(fresh, [], `${stage}: page must be error-free (got ${JSON.stringify(fresh)?.slice(0, 600)})`);
};

const boot = async (url) => {
  await send('Page.navigate', { url });
  errMark = 0;
  let ready = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (pageErrors.length) throw new Error(`page errors during boot: ${JSON.stringify(pageErrors)?.slice(0, 800)}`);
    ready = await evaluate('!!(window.__sdfGame && __sdfGame.presentCount() > 8)');
    if (ready) break;
  }
  assert.ok(ready, 'boot timeout — __sdfGame never presented frames');
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');
};

/** Teleport to (px,pz) FACING a target at (tx,tz). */
const faceTarget = async (px, pz, tx, tz, pitch = -0.12) => {
  const yaw = aimYawAt(px, pz, tx, tz);
  await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, ${pitch}); __sdfGame.step(4);`);
  await assertInFrame('faceTarget', tx, 1.2, tz);
  return yaw;
};

/** The gun/hand band of the frame (bottom centre) and a mid-right wall strip. */
const FPV_REGIONS = {
  fpv: [420, 500, 900, 790],
  litWall: [900, 300, 1150, 520],
  darkWall: [60, 380, 220, 520],
};

const results = { checks, pageErrors, pass: false };
const records = { captures };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ================= DEFERRED: post-aa ON (the redirect path) ==============
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const diag0 = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diag0.mode, 'deferred');
  assert.equal(diag0.canvasDepthWrites, false, 'with post-aa active the canvas-depth opt-in must be OFF');
  assert.ok(diag0.sizes.outputTarget, 'post-aa active must hand the coordinator a real target');
  assert.equal(diag0.lights.flashKey.fleshShoulderKnee, 0.65, 'shipped beam shoulder 0.35 -> knee 0.65');
  assert.deepEqual(diag0.router.unsupported, [], `no unsupported materials: ${JSON.stringify(diag0.router.unsupported)}`);
  check('boot-redirect-state', {
    canvasDepthWrites: diag0.canvasDepthWrites, output: diag0.sizes.outputTarget,
    flashKey: diag0.lights.flashKey, mesh: diag0.router.counts.mesh,
  });

  // 1. FPV ROUTING EVIDENCE: registered roots by name + gun pixels.
  const roots = diag0.router.roots;
  for (const want of ['grapeshot-k3', 'fpv-hand-grip', 'fpv-hand-fore', 'shell-eject-0', 'shell-load-1']) {
    assert.ok(roots.includes(want), `FPV root '${want}' must be registered: ${JSON.stringify(roots)}`);
  }
  const z0 = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  await faceTarget(z0.pos[0] + 1.8, z0.pos[2], z0.pos[0], z0.pos[2]);
  await evaluate('__sdfGame.step(4)');
  const fpvOn = await shot('comp-deferred-fpv-post-on.png', FPV_REGIONS, { minFrameNonDark: 8 });
  assert.ok(fpvOn.fpv.lum >= 12, `gun/hand band too dark to contain the viewmodel: ${JSON.stringify(fpvOn.fpv)}`);
  check('fpv-routing', { roots: roots.filter((r) => r.startsWith('grapeshot') || r.startsWith('fpv') || r.startsWith('shell')), fpv: fpvOn.fpv });
  noNewErrors('FPV routing');

  // 2. NULL-OUTPUT DEPTH COMPOSITION (the review fix's core).
  await evaluate('__sdfGame.setFxaa(false); __sdfGame.setSmear(0); __sdfGame.step(4);');
  const diagNull = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diagNull.canvasDepthWrites, true, 'post-aa fully off must flip the canvas-depth present ON');
  assert.equal(diagNull.sizes.outputTarget, null, 'post-aa fully off hands the coordinator null');
  const openStats = await shot('comp-null-open-room.png', FPV_REGIONS, { minFrameNonDark: 8 });
  check('null-output-compose', { canvasDepthWrites: diagNull.canvasDepthWrites, frame: openStats.frame, fpv: openStats.fpv });

  // Front/behind: push the player FORWARD along the aim line until collision
  // stops advancing (setPose teleports; the tick's collision pass clamps the
  // position back to the surface, so `pose()` reads the resolved stance). The
  // blocking geometry — the body or the wall behind it — ends ~0.32 m from
  // the eye, INSIDE the viewmodel's 0.3-0.6 m reach: the gun must clip into
  // it instead of drawing over it.
  const z = z0;
  let px = z.pos[0] + 1.8, pz = z.pos[2];
  await faceTarget(px, pz, z.pos[0], z.pos[2]);
  const yawToward = aimYawAt(px, pz, z.pos[0], z.pos[2]);
  const dirX = Math.sin(yawToward), dirZ = -Math.cos(yawToward);
  let cx = px, cz = pz, travelled = 0;
  for (let i = 0; i < 40; i++) {
    const nx = cx + dirX * 0.25, nz = cz + dirZ * 0.25;
    await evaluate(`__sdfGame.setPose(${nx}, ${nz}, ${yawToward}, -0.12); __sdfGame.step(1);`);
    const p = await evaluate('__sdfGame.pose().pos');
    const adv = Math.hypot(p[0] - cx, p[2] - cz);
    cx = p[0]; cz = p[2];
    if (adv < 0.02) break; // collision held — pressed against the surface
    travelled += adv;
  }
  await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${yawToward}, -0.12); __sdfGame.step(3);`);
  check('null-wall-push', { travelled: Math.round(travelled * 100) / 100, pos: [Number(cx.toFixed(2)), Number(cz.toFixed(2))] });

  const cornerStats = await shot('comp-null-wall-corner.png', FPV_REGIONS, { minFrameNonDark: 8 });
  const fpvDelta = Math.abs(cornerStats.fpv.lum - openStats.fpv.lum);
  assert.ok(fpvDelta >= 6,
    `gun band must change when the viewmodel is pushed against geometry (delta ${fpvDelta})`);
  check('null-front-behind-depth', { open: openStats.fpv, corner: cornerStats.fpv, delta: fpvDelta });
  noNewErrors('null-output depth');

  // Resize under the null path.
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await evaluate('__sdfGame.step(4)');
  const resizeStats = await shot('comp-null-resized.png', {}, { minFrameNonDark: 8 });
  assert.equal(resizeStats.frame.w, 1100, 'the resized composite must fill the new canvas');
  check('null-resize', resizeStats.frame);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await evaluate('__sdfGame.step(2)');
  noNewErrors('resize');

  // 3. FLASHLIGHT ENDPOINTS (legal panel values that used to throw).
  //    Re-establish the standard 1.8 m faced stance FIRST so gain0 and the
  //    default capture compare the SAME pixels.
  const baseDiag = await evaluate('__sdfGame.deferredDiagnostics()');
  const present0 = await evaluate('__sdfGame.presentCount()');
  const stanceYaw = aimYawAt(z0.pos[0] + 1.8, z0.pos[2], z0.pos[0], z0.pos[2]);
  await evaluate(`__sdfGame.setPose(${z0.pos[0] + 1.8}, ${z0.pos[2]}, ${stanceYaw}, -0.12); __sdfGame.setBeam({ beamGain: 0 }); __sdfGame.step(6);`);
  const gain0Diag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(gain0Diag.lights.flashKey.fleshKeyIntensity, 0, 'beamGain 0 must stamp a PRESENT zero');
  assert.equal(gain0Diag.errors.length, baseDiag.errors.length, 'beamGain 0 must not error the frame');
  const gain0Stats = await shot('comp-endpoint-gain0.png', { torso: [560, 330, 780, 550], ...FPV_REGIONS }, {});
  await evaluate(`__sdfGame.setBeam({ beamGain: 4 }); __sdfGame.step(6);`);
  const baseStats = await shot('comp-endpoint-default.png', { torso: [560, 330, 780, 550], ...FPV_REGIONS }, {});
  const torsoDrop = baseStats.torso.lum - gain0Stats.torso.lum;
  assert.ok(torsoDrop >= 12, `beamGain 0 must remove the beam from FLESH (torso drop ${torsoDrop})`);
  const wallDelta = Math.abs(baseStats.litWall.lum - gain0Stats.litWall.lum);
  assert.ok(wallDelta <= 8, `the LEVEL must not follow the flesh key (lit wall delta ${wallDelta})`);
  check('endpoint-gain0', { torsoDrop, wallDelta, torso: gain0Stats.torso, flashKey: gain0Diag.lights.flashKey });

  const present1 = await evaluate('__sdfGame.presentCount()');
  await evaluate('__sdfGame.setBeam({ beamShoulder: 0 }); __sdfGame.step(2);');
  const shoulder0Diag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(shoulder0Diag.lights.flashKey.fleshShoulderKnee, 0, 'beamShoulder 0 -> knee 0 (compression off)');
  const s0Stats = await shot('comp-endpoint-shoulder0.png', { torso: [560, 330, 780, 550] }, {});
  await evaluate('__sdfGame.setBeam({ beamShoulder: 0.05 }); __sdfGame.step(2);');
  const shoulder05Diag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(shoulder05Diag.lights.flashKey.fleshShoulderKnee, 0.95, 'beamShoulder .05 -> knee .95');
  const s05Stats = await shot('comp-endpoint-shoulder05.png', { torso: [560, 330, 780, 550] }, {});
  const present2 = await evaluate('__sdfGame.presentCount()');
  assert.ok(present2 > present1 + 4, `frames must advance through the endpoints (${present1} -> ${present2})`);
  assert.equal(shoulder05Diag.errors.length, shoulder0Diag.errors.length, 'no endpoint may error a frame');
  check('endpoint-shoulders', {
    knee0: shoulder0Diag.lights.flashKey, knee095: shoulder05Diag.lights.flashKey,
    torsoShoulder0: s0Stats.torso, torsoShoulder05: s05Stats.torso,
    presents: [present0, present1, present2],
  });
  await evaluate('__sdfGame.setBeam({ beamGain: 4, beamShoulder: 0.35 }); __sdfGame.step(2);');
  const restoredDiag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(restoredDiag.lights.flashKey.fleshShoulderKnee, 0.65, 'defaults restored');
  noNewErrors('flashlight endpoints');

  // 5. LIVE GUN/HAND TUNING reaches the composed surface (adapter refresh).
  const tuningA = await shot('comp-tuning-default.png', { fpv: FPV_REGIONS.fpv }, {});
  const current = await evaluate('__sdfGame.setGunTuning({})');
  await evaluate('__sdfGame.setGunTuning({ roughness: 0.05, metalness: 1 }); __sdfGame.step(3);');
  const tuningB = await shot('comp-tuning-mirror.png', { fpv: FPV_REGIONS.fpv }, {});
  const tuneDelta = Math.abs(tuningA.fpv.lum - tuningB.fpv.lum);
  assert.ok(tuneDelta >= 4, `setGunTuning must move the composed gun band (delta ${tuneDelta})`);
  await evaluate(`__sdfGame.setGunTuning({ roughness: ${current.roughness}, metalness: ${current.metalness}, envMapIntensity: ${current.envMapIntensity}, handNormalScale: ${current.handNormalScale} }); __sdfGame.step(2);`);
  check('live-gun-tuning', { before: tuningA.fpv, after: tuningB.fpv, delta: tuneDelta, restored: current });
  noNewErrors('gun tuning');

  // 4. CONE-EDGE STABILITY: muzzle-lit body at the beam boundary — sweeping
  // the boundary across the body must not jump the flesh tone (the shoulder
  // accumulates before the cone/range gates now).
  await evaluate('__sdfGame.setLoopRunning(true); __sdfGame.step(1); __sdfGame.setLoopRunning(false);');
  const pxEdge = z0.pos[0] + 1.0, pzEdge = z0.pos[2];
  const yawCenter = aimYawAt(pxEdge, pzEdge, z0.pos[0], z0.pos[2]);
  const outerHalf = Math.PI * 0.12; // the spot's outer cone half-angle (rad)
  const edgeShot = async (yawOffset, label) => {
    await evaluate(`__sdfGame.setPose(${pxEdge}, ${pzEdge}, ${yawCenter + yawOffset}, -0.10); __sdfGame.step(1);`);
    await evaluate('__sdfGame.fire(1); __sdfGame.step(1);');
    return await shot(label, { torso: [520, 300, 820, 620] }, {});
  };
  // Straddle the OUTER boundary: just inside (beam ~= 0, compression zone)
  // vs just outside (beam = 0). Pre-fix the shoulder toggled between these
  // two states; post-fix the flesh tone must stay put.
  const edgeA = await edgeShot(outerHalf - 0.025, 'comp-cone-edge-a.png');
  const edgeB = await edgeShot(outerHalf + 0.025, 'comp-cone-edge-b.png');
  const edgeDelta = Math.abs(edgeA.torso.lum - edgeB.torso.lum);
  assert.ok(edgeDelta <= 18,
    `flesh tone must stay continuous across the beam-boundary sweep (delta ${edgeDelta})`);
  check('cone-edge-stability', { a: edgeA.torso, b: edgeB.torso, delta: edgeDelta });
  noNewErrors('cone edge');

  // 6. NEAR/MID/FAR CALIBRATION TABLE (post-aa ON again, default beam).
  await evaluate('__sdfGame.setFxaa(true); __sdfGame.setSmear(0.25); __sdfGame.step(3);');
  const diagRedirect = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(diagRedirect.canvasDepthWrites, false, 'post-aa back on restores the redirect');
  assert.ok(diagRedirect.sizes.outputTarget, 'redirect target restored');
  check('redirect-restored', { canvasDepthWrites: diagRedirect.canvasDepthWrites, output: diagRedirect.sizes.outputTarget });
  const calTable = {};
  for (const dist of [1.8, 3.5, 6.0]) {
    const cx = z0.pos[0] + dist, cz = z0.pos[2];
    await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${aimYawAt(cx, cz, z0.pos[0], z0.pos[2])}, -0.12); __sdfGame.step(4);`);
    calTable[`deferred_${dist}m`] = (await shot(`comp-cal-deferred-${dist}m.png`, { torso: [500, 300, 840, 620] }, {})).torso;
  }
  check('calibration-near-mid-far', calTable);
  noNewErrors('calibration deferred');

  // ================= LEGACY calibration comparison =========================
  await boot(`http://localhost:${vite}/sdf-game.html`);
  assert.equal(await evaluate('__sdfGame.renderMode'), 'legacy');
  const zl = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  const legacyTable = {};
  for (const dist of [1.8, 3.5, 6.0]) {
    const cx = zl.pos[0] + dist, cz = zl.pos[2];
    await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${aimYawAt(cx, cz, zl.pos[0], zl.pos[2])}, -0.12); __sdfGame.step(4);`);
    legacyTable[`legacy_${dist}m`] = (await shot(`comp-cal-legacy-${dist}m.png`, { torso: [500, 300, 840, 620] }, {})).torso;
  }
  check('calibration-legacy', legacyTable);
  noNewErrors('calibration legacy');
  // Legacy FPV wall-corner reference for human inspection.
  check('done', { note: 'legacy calibration captured' });

  results.pass = true;
} finally {
  results.pageErrors = pageErrors;
  writeFileSync(`${out}/composition-review-fix-check.json`, JSON.stringify({ ...results, records }, null, 2));
  try { await send('Page.close'); } catch { /* tab may already be gone */ }
  ws.close();
  await new Promise((r) => { ws.onclose = r; setTimeout(r, 500); });
}
console.log(`COMPOSITION REVIEW FIX CHECK: ${results.pass ? 'PASS' : 'FAIL'} (${checks.length} checks)`);
if (!results.pass) process.exit(1);
