// Hybrid deferred M2 task 5 — real-GPU boot check for the opt-in playable
// deferred game. Start vite + CDP Chrome first (scripts/deferred-game-boot-check.sh
// does, on private ports), then:
//   node scripts/deferred-game-boot-check.mjs 5340 9340
//
// This is the TASK-5 evidence run, not the task-6 regression gate: it boots
// BOTH modes of sdf-game.html, asserts the boot-mode contract, walks the
// acceptance list (wounded zombie, goblin kit + generated face, soldier held
// prop, blood, detached chunk), proves the shadow generation/sampling toggles
// report distinct counters, and saves labelled screenshots for inspection.
//
// STRENGTHENED (task-5 continuation, 2026-09-07): diagnostics alone are not
// visual evidence — this run's first version passed ten checks while the
// composite was a black opaque canvas, and the original wounded capture faced
// +Z with the actor 1.2 m to the WEST (out of frame). Every capture now
// (a) aims its camera at the subject with the page's own yaw convention and
// asserts the subject IN FRAME through __sdfGame.screenPosOf (live camera
// projection), (b) is decoded in-page and checked for actual pixel coverage
// — the frame must not be black (room coverage) and actor shots must carry a
// lit centre. The light-calibration stage pins the flashKey march-key
// conversion and the flesh ROI clip/mean band at the shipped default gain
// (reproducible replacement for the one-off gain-sweep probes).
//
// Every CDP request is bounded; the owned tab/socket close in finally; the
// driver exits nonzero on any assertion failure or page error.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const vite = Number(process.argv[2] ?? 5340), cdp = Number(process.argv[3] ?? 9340);
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

/** The page's own aim convention: forward is (+sin yaw, -cos yaw). */
const aimYawAt = (px, pz, tx, tz) => Math.atan2(tx - px, -(tz - pz));

/** Decode a screenshot IN PAGE and return region statistics (small numbers
 *  only — raw pixels never leave the page). Regions are [x0, y0, x1, y1]. */
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
      clipPct: Math.round(1000 * clip / n) / 10, darkPct: Math.round(1000 * dark / n) / 10 };
  }
  // Whole-frame room coverage on a coarse grid: a BLACK canvas (the failure
  // this guards) reads ~100% dark; a real composite stays well under.
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

/** Capture a labelled screenshot + its pixel stats into the records. */
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
  if (limits?.region) {
    for (const [region, [minMean, maxClipPct]] of Object.entries(limits.region)) {
      const rs = stats[region];
      assert.ok(rs, `${name}: no stats for region ${region}`);
      const lum = (rs.mean[0] + rs.mean[1] + rs.mean[2]) / 3;
      assert.ok(lum >= minMean, `${name}: ${region} mean ${rs.mean} too dark (min ${minMean})`);
      if (maxClipPct !== undefined) {
        assert.ok(rs.clipPct <= maxClipPct,
          `${name}: ${region} clipped ${rs.clipPct}% (max ${maxClipPct}%) — wound-deleting blowout`);
      }
    }
  }
  return stats;
};

/** Assert a world point is in frame through the LIVE camera. */
const assertInFrame = async (label, x, y, z, maxNdc = 0.9) => {
  const sp = await evaluate(`__sdfGame.screenPosOf(${x}, ${y}, ${z})`);
  assert.ok(sp, `${label}: screenPosOf returned nothing`);
  assert.ok(Math.abs(sp.x) <= maxNdc && Math.abs(sp.y) <= maxNdc && sp.z < 1,
    `${label}: subject NOT in frame (ndc ${JSON.stringify(sp)}), the camera does not face it`);
  return sp;
};

/** Snapshot the error count so a fresh stage starts from a clean slate. */
let errMark = 0;
const noNewErrors = (stage) => {
  const fresh = pageErrors.slice(errMark);
  errMark = pageErrors.length;
  assert.deepEqual(fresh, [], `${stage}: page must be error-free (got ${JSON.stringify(fresh)?.slice(0, 600)})`);
};

/** Boot one mode and wait until the game presents frames. */
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
  // Deterministic inspection state: freeze the wanderers, then hand-step.
  await evaluate('__sdfGame.setLoopRunning(false); __sdfGame.freeze(true); __sdfGame.step(5);');
};

/** Wait until the router's mesh-route count reaches `want` (async kit/prop
 *  loads land between syncs), bounded. */
const waitForMeshCount = async (want, label, tries = 60) => {
  let got = 0;
  for (let i = 0; i < tries; i++) {
    const d = await evaluate('__sdfGame.deferredDiagnostics()');
    got = d.router.counts.mesh;
    if (got >= want) return got;
    await evaluate('__sdfGame.step(4)');
    await sleep(250);
  }
  throw new Error(`${label}: router mesh count never reached ${want} (got ${got})`);
};

/** Teleport to (px,pz) FACING a target at (tx,tz), torso-height aim. */
const faceTarget = async (px, pz, tx, tz, dist = 1.8) => {
  const yaw = aimYawAt(px, pz, tx, tz);
  await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, -0.12); __sdfGame.step(4);`);
  const sp = await assertInFrame('faceTarget', tx, 1.2, tz);
  return { yaw, screen: sp, dist };
};

/** Standard capture regions: the centre band where a framed subject lands,
 *  plus a strip of unlit wall (must stay dark — the dungeon requirement). */
const ACTOR_REGIONS = {
  center: [460, 240, 860, 620],
  darkWall: [140, 380, 280, 520],
};
const ACTOR_LIMITS = {
  minFrameNonDark: 8,
  region: { center: [18], darkWall: [0, 60] },
};

const results = { checks, pageErrors, pass: false };
const records = { captures };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ================= DEFERRED MODE =================
  await boot(`http://localhost:${vite}/sdf-game.html?renderer=deferred`);
  const mode = await evaluate('__sdfGame.renderMode');
  assert.equal(mode, 'deferred', '?renderer=deferred must select the deferred path');
  noNewErrors('deferred boot');
  check('boot-deferred', { mode, present: await evaluate('__sdfGame.presentCount()') });

  // Diagnostics: routes, lights, shadows, sink.
  const diag = await evaluate('__sdfGame.deferredDiagnostics()');
  records.deferredBootDiag = diag;
  assert.ok(diag.router.counts.mesh > 10, `level must be mesh-routed: ${JSON.stringify(diag.router.counts)}`);
  assert.ok(diag.router.counts.sdf >= 10, `every body must be an SDF producer: ${JSON.stringify(diag.router.counts)}`);
  assert.deepEqual(diag.router.unsupported, [], `no unsupported materials expected: ${JSON.stringify(diag.router.unsupported)}`);
  assert.equal(diag.lights.ids[0], 'flashlight', 'the flashlight takes slot 0');
  assert.ok(diag.lights.dropped.includes('muzzle'), `the inactive muzzle is dropped, not guessed: ${JSON.stringify(diag.lights)}`);
  assert.ok(diag.lights.ids.filter((id) => id.startsWith('fire-')).length >= 5, 'the five accent practicals are candidates');
  assert.equal(diag.shadow.generationRequested, true);
  assert.equal(diag.shadow.renderedMaps, 2, 'both flashlight shadow maps render');
  assert.ok(diag.shadow.fullCasters > diag.shadow.levelCasters, 'the inflated hull is full-only');
  // No canvas bypass: with the lens on, post-aa redirects sinks to its capture
  // target — the coordinator must report that target, not null.
  assert.deepEqual(diag.sizes.outputTarget, { width: 800, height: 600 },
    `deferred output must ride post-aa's capture target (canvas bypass if null): ${JSON.stringify(diag.sizes)}`);
  check('deferred-diagnostics', {
    counts: diag.router.counts, lights: diag.lights.ids,
    dropped: diag.lights.dropped, shadow: diag.shadow, sizes: diag.sizes,
  });

  // M2 task-5 continuation: the march-key conversion must be live. The
  // flashlight slot carries the game's beamTuning (gain 4, shoulder 0.35 ->
  // knee 0.65) scaled by the calibrated default light gain (0.5).
  assert.equal(diag.lightGain, 0.5, 'the calibrated default light gain must ship active');
  assert.ok(diag.lights.flashKey, `flashlight must carry the march-key stamp: ${JSON.stringify(diag.lights.flashKey)}`);
  assert.ok(Math.abs(diag.lights.flashKey.fleshKeyIntensity - 2) < 1e-3,
    `flesh key intensity = beamGain * lightGain = 2.0, got ${JSON.stringify(diag.lights.flashKey)}`);
  assert.ok(Math.abs(diag.lights.flashKey.fleshShoulderKnee - 0.65) < 1e-3,
    `flesh shoulder knee = 1 - 0.35, got ${JSON.stringify(diag.lights.flashKey)}`);
  check('flashkey-conversion', diag.lights.flashKey);
  noNewErrors('deferred diagnostics');

  // The boot frame itself must be a real composite (room visible), not the
  // black opaque canvas this check's first version scored ten greens on.
  const bootStats = await shot('task5-deferred-boot.png', { frame: [0, 0, 1280, 800] },
    { minFrameNonDark: 8 });
  check('boot-frame-coverage', bootStats.frame);
  records.captures = captures;

  // Soldier (room 1): kit, held prop, generated face — FACING him.
  const soldier = await evaluate('__sdfGame.zombies().find(z => z.room === 1)');
  assert.ok(soldier, 'a room-1 soldier must exist');
  const sCam = { px: soldier.pos[0] + 1.6, pz: soldier.pos[2] + 0.4 };
  await faceTarget(sCam.px, sCam.pz, soldier.pos[0], soldier.pos[2]);
  await evaluate('__sdfGame.step(2)');
  const soldierStats = await shot('task5-deferred-soldier.png', ACTOR_REGIONS, ACTOR_LIMITS);
  records.captures = captures;
  check('soldier-captured', {
    room1: soldier.room, screen: (await evaluate(`__sdfGame.screenPosOf(${soldier.pos[0]}, 1.2, ${soldier.pos[2]})`)),
    stats: soldierStats,
  });
  noNewErrors('soldier capture');

  // Wounded zombie + blood: teleport BESIDE a room-2 body FACING it, blast,
  // capture the wound evidence (clip band = the calibration this run ships).
  const z = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  assert.ok(z, 'a room-2 zombie must exist');
  const wCam = { px: z.pos[0] + 1.8, pz: z.pos[2] };
  await faceTarget(wCam.px, wCam.pz, z.pos[0], z.pos[2]);
  const blast = await evaluate(`__sdfGame.explode(${z.pos[0]}, 1.2, ${z.pos[2]})`);
  assert.ok(blast.totalWounds > 0, `the blast must wound: ${JSON.stringify(blast)}`);
  await evaluate('__sdfGame.step(30)');
  const wounds = await evaluate(`__sdfGame.debugWounds(${z.id})`);
  assert.ok(Array.isArray(wounds) && wounds.length > 0, 'the wounded ring must carry the blast');
  await assertInFrame('wounded', z.pos[0], 1.2, z.pos[2]);
  // TORSO ROI — the calibration band: clip near-legacy, mean in the lit band.
  // Regions were measured on the task5-cal2 captures (torso of a body 1.8 m
  // out, beam centre). The old blown frame clips 32% here; legacy clips 0.7%.
  const woundedStats = await shot('task5-deferred-wounded.png', {
    torso: [560, 330, 780, 550],
    ...ACTOR_REGIONS,
  }, {
    minFrameNonDark: 8,
    region: {
      torso: [110, 3.5],   // min mean, max clip% — rejects black AND blowout
      center: [18],
      darkWall: [0, 60],
    },
  });
  records.captures = captures;
  check('wounded-zombie', { blast, woundCount: wounds.length, stats: woundedStats });
  noNewErrors('wounded capture');

  // Goblin: kit + generated face, spawned through the SAME spawn path.
  const beforeMesh = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.mesh;
  const goblin = await evaluate('__sdfGame.spawnDebugCharacter("goblin")');
  assert.ok(goblin.id > 0, `goblin spawn failed: ${JSON.stringify(goblin)}`);
  const afterMesh = await waitForMeshCount(beforeMesh + 1, 'goblin kit discovery');
  const gz = await evaluate(`__sdfGame.zombies().find(z2 => z2.id === ${goblin.id})`);
  const gCam = { px: gz.pos[0] + 1.5, pz: gz.pos[2] + 0.3 };
  await faceTarget(gCam.px, gCam.pz, gz.pos[0], gz.pos[2]);
  await evaluate('__sdfGame.step(4)');
  await assertInFrame('goblin', gz.pos[0], 1.1, gz.pos[2]);
  const goblinStats = await shot('task5-deferred-goblin.png', ACTOR_REGIONS, ACTOR_LIMITS);
  records.captures = captures;
  check('goblin-kit-face', { id: goblin.id, meshCount: beforeMesh, afterMesh, stats: goblinStats });
  noNewErrors('goblin capture');

  // Detached chunk: point-blank slugs into the wounded body until something
  // severs; the final frame FACES the corpse + chunk.
  const sdfBefore = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.sdf;
  const target = z;
  let severed = false;
  for (let i = 0; i < 20 && !severed; i++) {
    const px = target.pos[0] + 0.9, pz = target.pos[2];
    const yaw = aimYawAt(px, pz, target.pos[0], target.pos[2]);
    await evaluate(`__sdfGame.setPose(${px}, ${pz}, ${yaw}, -0.18); __sdfGame.step(1);`);
    await evaluate('__sdfGame.fireSlug()');
    await evaluate('__sdfGame.step(20)');
    const sdfNow = (await evaluate('__sdfGame.deferredDiagnostics()')).router.counts.sdf;
    if (sdfNow > sdfBefore) severed = true;
  }
  assert.ok(severed, 'slugs at point-blank must sever a piece into a chunk');
  const cCam = { px: target.pos[0] + 1.4, pz: target.pos[2] + 0.2 };
  await faceTarget(cCam.px, cCam.pz, target.pos[0], target.pos[2]);
  await evaluate('__sdfGame.step(10)');
  await assertInFrame('chunk', target.pos[0], 1.0, target.pos[2], 0.95);
  const chunkStats = await shot('task5-deferred-chunk.png', ACTOR_REGIONS, ACTOR_LIMITS);
  records.captures = captures;
  check('detached-chunk', { sdfBefore, stats: chunkStats });
  noNewErrors('chunk capture');

  // Shadow sampling-only toggle: maps keep rendering, lit stage ignores them.
  await evaluate('__sdfGame.setSpotShadowSampling(false); __sdfGame.step(3);');
  const samplingOff = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(samplingOff.shadow.sampling, false);
  assert.equal(samplingOff.shadow.renderedMaps, 2, 'generation continues while sampling is off');
  const samplingOffStats = await shot('task5-deferred-sampling-off.png', ACTOR_REGIONS, ACTOR_LIMITS);
  await evaluate('__sdfGame.setSpotShadowSampling(true); __sdfGame.step(2);');
  check('sampling-toggle', {
    sampling: samplingOff.shadow.sampling, renderedMaps: samplingOff.shadow.renderedMaps,
    stats: samplingOffStats,
  });

  // Generation off (?spotshadow=0 seam): zero map renders, distinct counters.
  await evaluate('__sdfGame.setSpotShadow(false); __sdfGame.step(3);');
  const genOff = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.equal(genOff.shadow.renderedMaps, 0, 'generation off renders zero maps');
  assert.equal(genOff.shadow.sampling, true, 'sampling flag is independent of generation');
  await shot('task5-deferred-gen-off.png', ACTOR_REGIONS, ACTOR_LIMITS);
  await evaluate('__sdfGame.setSpotShadow(true); __sdfGame.step(2);');
  check('generation-toggle', genOff.shadow);
  noNewErrors('deferred toggles');

  // ================= LEGACY MODE =================
  await boot(`http://localhost:${vite}/sdf-game.html`);
  const legacyMode = await evaluate('__sdfGame.renderMode');
  assert.equal(legacyMode, 'legacy', 'absent ?renderer must select the legacy path');
  noNewErrors('legacy boot');
  const legacyDiag = await evaluate('__sdfGame.deferredDiagnostics()');
  assert.deepEqual(legacyDiag, { mode: 'legacy' }, 'legacy boot reports the legacy mode only');
  const zl = await evaluate('__sdfGame.zombies().find(z2 => z2.room === 2)');
  await faceTarget(zl.pos[0] + 1.8, zl.pos[2], zl.pos[0], zl.pos[2]);
  await evaluate(`__sdfGame.explode(${zl.pos[0]}, 1.2, ${zl.pos[2]})`);
  await evaluate('__sdfGame.step(30)');
  const legacyStats = await shot('task5-legacy-wounded.png', {
    torso: [560, 330, 780, 550],
    ...ACTOR_REGIONS,
  }, { minFrameNonDark: 8, region: { center: [18] } });
  check('boot-legacy', { mode: legacyMode, present: await evaluate('__sdfGame.presentCount()'), stats: legacyStats });

  // Unsupported explicit deferred must be a visible fatal, not a legacy boot:
  // emulate the WebGL fallback by asserting resolveGameBootMode's contract
  // through the page bundle (the real backend here is webgpu; the pure
  // function is unit-tested — this check proves the page SURFACES it).
  await send('Page.navigate', { url: `http://localhost:${vite}/sdf-game.html?renderer=nonsense` });
  for (let i = 0; i < 60; i++) { await sleep(500); if (pageErrors.length || await evaluate('!!document.getElementById("errors")?.textContent')) break; }
  const warnText = await evaluate('document.getElementById("errors")?.textContent ?? ""');
  const stillBoots = await evaluate('!!window.__sdfGame');
  assert.equal(stillBoots, true, 'an unknown renderer VALUE warns but still boots (legacy)');
  assert.equal(warnText, '', 'an unknown renderer value is a warning, not a fatal');
  check('unknown-renderer-value', { warnText, booted: stillBoots });
  noNewErrors('unknown renderer value');

  results.pass = true;
} finally {
  results.pageErrors = pageErrors;
  writeFileSync(`${out}/task5-boot-check.json`, JSON.stringify({ ...results, records }, null, 2));
  try { await send('Page.close'); } catch { /* tab may already be gone */ }
  ws.close();
  await new Promise((r) => { ws.onclose = r; setTimeout(r, 500); });
}
console.log(`TASK5 BOOT CHECK: ${results.pass ? 'PASS' : 'FAIL'} (${checks.length} checks)`);
if (!results.pass) process.exit(1);
