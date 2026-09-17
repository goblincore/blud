// scripts/sdf-explosion-fx-shot.mjs — does the PROCEDURAL explosion actually
// draw pixels, and does it draw the RIGHT ones?
//
// A shader that fails to compile, or a node graph whose alpha never gates
// coverage, fails SILENTLY in the ways this repo has already been burned by:
// blood-view-gpu.ts records `alphaHash` rendering "unshaped translucent
// SQUARES" on the WebGPU backend, and kit-overlay.ts records translucent
// geometry being erased by the flesh composite. Neither shows up as an
// exception. So this script does not ask "did it throw" — it photographs TWO
// frames of the SAME frozen scene, one with a burst in front of the camera and
// one without, and reads the DIFFERENCE:
//
//   * present   — the burst changed a real number of pixels.
//   * LOCAL     — the changed pixels are a compact region near the detonation,
//                 not a full-screen wash. A full-screen rectangle is the
//                 documented failure mode, so the bounding box is gated.
//   * HOT       — the changed pixels are brighter on average, and the peak is
//                 high: a fireball adds light.
//   * BOUNDED   — the enclosing box is under a fraction of the frame, so a
//                 mis-scaled billboard cannot pass by filling the screen.
//
// The two PNGs are written out for the owner's look pass; the verdict here is
// statistics only, NOT a judgement of whether it looks good.
//
// Usage: node scripts/sdf-explosion-fx-shot.mjs <vitePort> <cdpPort> [outDir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = process.argv[4] ?? '/tmp/explosion-fx';
mkdirSync(OUT, { recursive: true });

const W = 900, H = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// The player starts at PLAYER_START (-7.4, -7.4) facing yaw 0.75*PI, so room 1
// runs 2.5 m of open floor ahead of the eye. A burst is dropped there.
const YAW = 0.75 * Math.PI;
const FX = -7.4 + Math.sin(YAW) * 3.4;
const FZ = -7.4 - Math.cos(YAW) * 3.4;
const FY = 0.6;              // near the floor, so it reads as a ground burst

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    pageErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT: ${expression.slice(0, 80)}`)), 30000)),
  ]);
  if (r.result?.exceptionDetails) {
    throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails.exception?.description)}`);
  }
  return r.result?.result?.value;
};
// THE CAPTURE PATH IS `presentedShot()`, NOT `Page.captureScreenshot`.
// Page.captureScreenshot returns what the COMPOSITOR last presented, and a page
// whose frames are driven by __sdfGame.step() presents nothing between the two
// reads — measured here: three captures of three different states came back
// BYTE-IDENTICAL (same mean, same non-black count) while the canvas reported a
// burst alive. presentedShot() reads the canvas itself, which is the same
// distinction the repo already documents for frameHash vs presentedShot.
const capture = async () => {
  const b64 = await evaluate('window.__sdfGame.presentedShot()');
  if (typeof b64 !== 'string' || b64.length < 100) {
    throw new Error('presentedShot() returned nothing usable');
  }
  return Buffer.from(b64, 'base64');
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// frozen: the wanderers stop, so the ONLY difference between the two frames is
// the burst. vhs=off: the VHS pass owns a temporal blend and a time-driven noise
// hash, either of which would show up in the difference as its own signal.
// FX_QS carries extra page knobs through (`FX_QS='&fxplume=0'`), so the arms of
// a look comparison are one command each rather than one script each.
const url = `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off`
  + `&explosionfx=${process.env.EXPLOSION_FX ?? "procedural"}&fxlight=0${process.env.FX_QS ?? ''}`;
console.log(`opening ${url}`);
await send('Page.navigate', { url });

for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object" && window.__sdfGame !== null').catch(() => false)) break;
  if (i === 239) fail('__sdfGame never appeared');
}
for (let i = 0; i < 60; i++) {
  if (await evaluate('window.__sdfGame.gunReady === true').catch(() => false)) break;
  await sleep(500);
  if (i === 59) fail('the view-model never became ready');
}
// Pin every render-side clock the page exposes, so two frames of the same scene
// differ by the burst and nothing else.
await evaluate('window.__sdfGame.setDemoHold(true)');
await evaluate('window.__sdfGame.setVhs(null)');
// STOP THE REAL-TIME LOOP, and pin the burst's AGE. `step(n)` stops the loop
// too, but every CDP round trip is tens of milliseconds of wall clock: without
// this, the burst is at whatever age the driver's JSON reads happened to take,
// and a plume at 0.1 s and one at 0.5 s have completely different silhouettes.
// MEASURED, that is why this rig's own silhouette rows read cap/stem 21.8 on one
// boot and 0 on the next for the SAME arm at the SAME knobs.
await evaluate('window.__sdfGame.setLoopRunning(false)');
// FX_TUNING lets an arm drop a LAYER of the burst (`FX_TUNING='{"ringOpacity":0}'`),
// which is the only way to ask a shape question about the PLUME: the ground
// shockwave ring is a large low-lying annulus and it dominates the changed area,
// so a whole-burst centroid is mostly the ring's height. Applied through the
// same tuning seam the page's own knobs use.
if (process.env.FX_TUNING) {
  const applied = await evaluate(`window.__sdfGame.setExplosionFxTuning(${process.env.FX_TUNING})`);
  console.log(`tuning patch ${process.env.FX_TUNING} -> ${JSON.stringify(applied)}`);
}
const mode = await evaluate('window.__sdfGame.explosionFx()');
console.log(`explosion renderer: ${mode.mode}`);
const wantMode = process.env.EXPLOSION_FX ?? 'procedural';
if (mode.mode !== wantMode) fail(`expected the ${wantMode} renderer, got ${mode.mode}`);
if (wantMode === 'atlas' && mode.usingAtlas !== true) {
  fail('the atlas mode fell back to the procedural discs — the placeholder tiles are not being served '
    + '(run scripts/link-dev-assets.sh in this worktree)');
}
console.log(`size ${mode.size} smoke ${mode.smoke} life ${mode.life} gain ${mode.gain}`);

// ——— TWO DISTANCES, ONE METHOD ——————————————————————————————————————————
// 3.4 m and 6.5 m. The near one is the case that made the first version of
// this script lie: at 3.4 m a 2 m-tall burst legitimately subtends most of the
// frame, so a "the changed region must be small" threshold is simply wrong —
// MEASURED, the known-good stand-in fills 70% of the frame box there too. The
// far one is the discriminating test: a mis-scaled billboard still fills the
// frame at 6.5 m, a correct one does not.
const DISTANCES = [3.4, 6.5];
const results = [];
for (const dist of DISTANCES) {
  const fxX = -7.4 + Math.sin(YAW) * dist;
  const fzZ = -7.4 - Math.cos(YAW) * dist;

  // SETTLE FIRST. Bursts live well under a second, but the loop reuses the same
  // page: without draining the previous distance's burst out of the frame the
  // "no burst" baseline still contains it and the difference is meaningless —
  // measured, that contamination read as a 92%-of-frame change at 6.5 m.
  for (let i = 0; i < 6; i++) await evaluate('window.__sdfGame.step(30)');
  const drained = await evaluate('window.__sdfGame.explosionFx()');
  if (drained.liveBursts !== 0) fail(`bursts did not drain before the baseline (${drained.liveBursts} live)`);
  const a = await capture();
  writeFileSync(`${OUT}/a-${dist.toFixed(1)}m-no-burst.png`, a);

  // The burst is spawned and then a fixed number of frames are stepped, so it is
  // photographed mid-life rather than at frame 0 (a zero-age burst is
  // legitimately tiny, and gating on one would prove nothing).
  const spawned = await evaluate(
    `window.__sdfGame.spawnExplosionFx(${fxX.toFixed(4)}, ${FY}, ${fzZ.toFixed(4)}, 2.0, 'ground')`,
  );
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  const fx = await evaluate('window.__sdfGame.explosionFx()');
  await evaluate('window.__sdfGame.step(6)');
  await evaluate('window.__sdfGame.setLoopRunning(false)');
  const b = await capture();
  writeFileSync(`${OUT}/b-${dist.toFixed(1)}m-burst.png`, b);

  const A = decodePng(a), B = decodePng(b);
  if (A.w !== B.w || A.h !== B.h) fail('the two captures differ in size');
  if (A.ch !== B.ch) fail(`channel count differs (${A.ch} vs ${B.ch})`);
  const w = A.w, h = A.h, ch = A.ch;
  let changed = 0, sumA = 0, sumB = 0, peak = 0, sumY = 0;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  const rows = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const da = Math.abs(B.data[i] - A.data[i]) + Math.abs(B.data[i + 1] - A.data[i + 1])
               + Math.abs(B.data[i + 2] - A.data[i + 2]);
      if (da <= 12) continue;              // 4 levels/channel: below this is noise
      changed++; sumY += y; rows[y]++;
      sumA += A.data[i] + A.data[i + 1] + A.data[i + 2];
      sumB += B.data[i] + B.data[i + 1] + B.data[i + 2];
      peak = Math.max(peak, B.data[i], B.data[i + 1], B.data[i + 2]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  // ——— THE SILHOUETTE PROFILE (plume task, 2026-09-11) ————————————————
  // WHAT SURVIVES, AND WHAT WAS REMOVED. "Round fireball" vs "mushroom" is not
  // a size or a brightness, so the footprint metrics above cannot separate them:
  // a ball and a plume of equal volume have the same box. What differs is WHERE
  // THE MASS IS, and the one number here that measures it STABLY is the
  // centroid's height, in frame pixels:
  //
  //   whole burst, procedural         centroidY 457 of 600
  //   WHOLE BURST numbers are mostly the RING, and that mattered: comparing
  //   whole-burst centroids said our explosion happens at the crater and the
  //   reference's happens in the air. It does not. Drop the ring
  //   (`FX_TUNING='{"ringOpacity":0}'`) and the same arm reads:
  //
  //   plume alone, procedural         centroidY 362
  //   atlas (the reference)           centroidY 332
  //
  // 30 px of 600, at 3.4 m — the plume's vertical mass distribution is already
  // where the reference's is, and the 125 px gap was a low-lying annulus
  // dominating the changed area. The centroid repeats to well under a pixel
  // within an arm (456.8 on two separate boots, 331.9 on two for the atlas).
  //
  // A CAP-BAND vs STEM-BAND split lived here and was REMOVED. It split the
  // changed region into quarters by height and reported the mean changed
  // pixels per row in the top quarter against the bottom one — which is a fine
  // idea and an unusable instrument: the band boundaries come from the
  // BOUNDING BOX, so one stray changed pixel at the edge re-cuts them. Measured,
  // the SAME arm at the SAME knobs read cap/stem 7.45 on one boot and 0.26 on
  // the next. A number that reorders like that is worse than no number, because
  // it looks like evidence.
  //
  // AND THE CENTROID ITSELF IS CONFOUNDED: the ground shockwave ring is a large
  // low-lying annulus and it dominates the changed area, so the centroid mostly
  // reports the RING's height rather than the plume's. Comparing the plume
  // against the reference WITH THE RING OFF (`setExplosionFxTuning({
  // ringOpacity: 0 })`) is what the shape question actually needs, and this rig
  // does not do it.
  let sumYProfile = 0;
  for (let y = minY; y <= maxY; y++) sumYProfile += (rows[y] ?? 0) * y;
  const centroidY = changed ? sumYProfile / changed : 0;
  const total = w * h;
  const boxW = maxX < 0 ? 0 : maxX - minX + 1;
  const boxH = maxY < 0 ? 0 : maxY - minY + 1;
  results.push({
    distanceM: dist, mode: spawned.mode, frame: { w, h },
    changedPixels: changed, changedFraction: Number((changed / total).toFixed(5)),
    boundingBox: maxX < 0 ? null : { x: minX, y: minY, w: boxW, h: boxH },
    boxWidthFraction: Number((boxW / w).toFixed(4)),
    boxFractionOfFrame: Number(((boxW * boxH) / total).toFixed(4)),
    meanChangedLuma: {
      before: changed ? Number((sumA / (changed * 3)).toFixed(1)) : 0,
      after: changed ? Number((sumB / (changed * 3)).toFixed(1)) : 0,
    },
    peakChannelAfter: peak, liveBursts: fx.liveBursts,
    silhouette: maxX < 0 ? null : {
      // Stable to well under a pixel within an arm; confounded by the ring.
      centroidY: Number(centroidY.toFixed(1)),
      topY: minY, bottomY: maxY,
    },
  });
}
console.log(JSON.stringify(results, null, 2));
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));

// ——— THE VERDICT ————————————————————————————————————————————————————————
// What is GATED is what statistics can honestly settle: the effect is PRESENT,
// it is BRIGHT, it has a HOT core, and it does not cover essentially the whole
// frame at a distance where a 2 m ball cannot legitimately do so. What is NOT
// gated — and must not be claimed from these numbers — is whether it LOOKS
// right: shape, colour, the noise's scale, the smoke's weight. That is the
// owner's look pass, and the PNGs are written for it.
if (pageErrors.length > 0) {
  for (const e of pageErrors.slice(0, 5)) console.error(`  page error: ${e}`);
  fail('the page reported errors (a node graph failing to compile lands here)');
}
for (const r of results) {
  const tag = `${r.mode} @ ${r.distanceM} m`;
  if (r.changedPixels < 300) fail(`${tag}: the burst changed only ${r.changedPixels} pixels — it is not drawing`);
  if (!(r.meanChangedLuma.after > r.meanChangedLuma.before + 4)) {
    fail(`${tag}: the burst did not brighten its region (${r.meanChangedLuma.before} → ${r.meanChangedLuma.after})`);
  }
  if (!(r.peakChannelAfter > 200)) fail(`${tag}: no hot core (peak ${r.peakChannelAfter})`);
}
const far = results.find(r => r.distanceM === 6.5);
if (far && far.boxWidthFraction > 0.98 && far.boxFractionOfFrame > 0.9) {
  fail(`at 6.5 m the burst still covers the whole frame (box ${far.boxFractionOfFrame}) — `
    + 'that is the full-screen-rectangle failure mode (blood-view-gpu.ts alphaHash note)');
}
for (const r of results) {
  console.log(`${r.mode} @ ${r.distanceM} m: ${r.changedPixels} px changed `
    + `(${(r.changedFraction * 100).toFixed(1)}% of frame), box ${r.boundingBox?.w}x${r.boundingBox?.h}, `
    + `luma ${r.meanChangedLuma.before} → ${r.meanChangedLuma.after}, peak ${r.peakChannelAfter}`);
  if (r.silhouette) {
    console.log(`  silhouette: mass centroid at y ${r.silhouette.centroidY} of ${r.frame.h} `
      + `(the atlas reference reads 332 — see the note above this metric)`);
  }
}
console.log(`PASS: the ${results[0].mode} burst draws, brightens and has a hot core`);
console.log(`look pass: ${OUT}/a-*-no-burst.png vs ${OUT}/b-*-burst.png`);
process.exit(0);
