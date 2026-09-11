// scripts/sdf-fields-motion-probe.mjs — IS THE DEEPER-FIELD ARTIFACT CAMERA
// MOTION, OR IS IT THE BODIES?
//
// WHY THIS EXISTS, before any reprojection code. The held-row reprojection
// experiment (docs/dev-notes/2026-09-10-temporal-reprojection-NEXT-SESSION.md,
// the SCOPED section) can only fix the CAMERA component of a held row's
// staleness — it reprojects a stale sample into the current camera, and knows
// nothing about a body that moved. The owner's worry is exactly right: "might be
// hard to test since the enemies are moving". So before building anything, split
// the artifact into its two terms and measure which one dominates.
//
// HOW. `__sdfGame.setFieldCount(n)` is live (the shipped 'bodies' field style
// accepts it; only 'frame' refuses), so h/2 and h/3 can be A/B'd IN ONE BOOT at a
// MATCHED POSE. Three cases, all with the SAME subject (a body filling the frame,
// staged by stageCloseUp) and the same everything else:
//
//   still      the camera is reposed and stepped so every row is refilled at ONE
//              camera position. h/2 vs h/3 here is pure RECONSTRUCTION (how much
//              the extra held rows cost when nothing has moved).
//   strafe     the camera moves laterally between the frames that fill the
//              fields, so held rows carry samples from an older camera. The
//              difference vs `still` is the CAMERA-MOTION term — the part
//              reprojection can remove.
//   (bodies)   `?frozen=1` freezes the wanderers for both cases above, so the
//              subject does not move at all. That is deliberate: it ISOLATES the
//              camera term. If the camera term is small, the reprojection
//              experiment has no target and the remaining artifact is body
//              motion, which needs motion vectors instead.
//
// METRICS, both needed:
//   meanAbsDiff   |h/2 - h/3| over the frame, in 8-bit levels.
//   rowPhase      the mean |row y - row y+1| vertical gradient, split by y % nf.
//                 A comb is PHASE-DEPENDENT: held rows carry different content
//                 from fresh ones, so the gradient across a fresh/held boundary
//                 is larger than across two fresh rows. This is the signature
//                 that says "this is the field weave", not "the image changed".
//
// HONEST LIMITS.
//  1. One body, one room, one framing (the staged close-up). A wide shot with the
//     level and several bodies could weight the terms differently.
//  2. `?frozen=1` + `setPose` + `step()` is deterministic enough to compare
//     captures, but the field RING's contents differ between the h/2 and h/3
//     passes by construction — that difference is what is being measured, and it
//     is why the still case is reported alongside.
//  3. The strafe is one lateral step of a fixed size, not a continuous sweep, and
//     it is not the owner's real play speed. It is a DISCRIMINATOR (does camera
//     motion make it worse?), not a look verdict. The look verdict is the owner's,
//     in motion, and cannot come from a still.
//
// Usage (needs servers; scripts/lab-servers.sh owns them, or use the .sh):
//   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-fields-motion-probe.mjs
//   FIELDS_PROBE_ROOM=2 FIELDS_PROBE_STRAFE=0.25 FIELDS_PROBE_FIELDS=2,3,4 ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp, sleep } from './lib/sdf-closeup-stage.mjs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.argv[3] ?? process.env.LAB_CDP_PORT ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-fields-motion';
const ROOM = Number(process.env.FIELDS_PROBE_ROOM ?? 1);
// Metres of lateral camera offset for the moving case. 0.25 m over ~2 frames is
// a brisk strafe (~7 m/s at 60 Hz) — deliberately beyond walking pace so the
// camera term is given every chance to show up.
const STRAFE = Number(process.env.FIELDS_PROBE_STRAFE ?? 0.25);
const FIELDS = (process.env.FIELDS_PROBE_FIELDS ?? '2,3').split(',').map(Number);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();

mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__fpConsole = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__fpConsole.push(['error', a.map(String).join(' ')]); e(...a); };
    console.warn = (...a) => { window.__fpConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
  })()`,
});

await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); return 1; })()');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

const fieldStyle = await evaluate('(() => __sdfGame.fieldStyle ?? __sdfGame.sdfLayer?.fieldStyle ?? null)()').catch(() => null);
const staged = await stageCloseUp(evaluate, { room: ROOM }, fail);
console.log(`staged: room ${ROOM}, body ${staged.body}, distance ${staged.d} m, coverage ${(100 * staged.cov).toFixed(1)}%`);
console.log(`field style: ${fieldStyle}`);

/** The staged pose, re-applied absolutely before every capture so h/2 and h/3
 *  are compared at the SAME camera. `strafeM` shifts the eye laterally. */
async function repose(strafeM) {
  return evaluate(`(() => {
    const p = __sdfGame.pose();
    // tryPose() in the staging lib derives yaw = atan2(dx, -dz), so forward is
    // (sin yaw, -cos yaw) and the perpendicular is (cos yaw, sin yaw).
    const right = [Math.cos(p.yaw), Math.sin(p.yaw)];
    __sdfGame.setPose(p.pos[0] + right[0] * ${strafeM}, p.pos[2] + right[1] * ${strafeM}, p.yaw, p.pitch, 0);
    return 1;
  })()`);
}

async function capture(fieldCount, mode) {
  // setFieldCount resizes the targets (so it forces a fresh frame); the flush
  // after it refills the ring at the pose we want to measure at.
  await evaluate(`(() => __sdfGame.setFieldCount(${fieldCount}))()`);
  await repose(0);
  await evaluate('(() => { __sdfGame.step(8); return 1; })()');   // refill every held row at THIS camera
  if (mode === 'strafe') {
    // Move, then take exactly one more frame so the fresh rows carry the new
    // camera while the held rows still carry the old one — the artifact's setup.
    await repose(STRAFE);
    await evaluate('(() => { __sdfGame.step(1); return 1; })()');
  } else {
    await evaluate('(() => { __sdfGame.step(1); return 1; })()');
  }
  await evaluate('__sdfGame.resolveGpu()');
  const shot = await evaluate('__sdfGame.presentedShot()');
  const name = `f${fieldCount}-${mode}`;
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot, 'base64'));
  return { name, img: decodePng(Buffer.from(shot, 'base64')), fieldCount, mode };
}

function meanAbsDiff(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let sum = 0, n = 0, changed = 0;
  for (let i = 0; i < a.data.length; i += a.ch) {
    let d = 0;
    for (let c = 0; c < 3; c++) { const dd = Math.abs(a.data[i + c] - b.data[i + c]); if (dd > d) d = dd; }
    sum += d; n++;
    if (d > 2) changed++;
  }
  return { mean: sum / n, changed, pixels: n };
}

/** Vertical gradient split by row phase: mean |row y - row y+1| for each
 *  y % nf. A comb makes these phases differ; a uniform change does not. */
function rowPhaseGradient(img, nf) {
  const sums = new Array(nf).fill(0), counts = new Array(nf).fill(0);
  for (let y = 0; y + 1 < img.h; y++) {
    let rowSum = 0;
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.ch, j = ((y + 1) * img.w + x) * img.ch;
      rowSum += Math.abs(img.data[i] - img.data[j]);   // red channel: cheapest, and the comb is luminance
    }
    const phase = y % nf;
    sums[phase] += rowSum / img.w; counts[phase]++;
  }
  return sums.map((s, k) => (counts[k] ? s / counts[k] : 0));
}

const shots = {};
for (const mode of ['still', 'strafe']) {
  for (const fc of FIELDS) shots[`${mode}-${fc}`] = await capture(fc, mode);
}

console.log('\n=== h/2 vs h/3 (and any other divisor), at a MATCHED pose ===');
console.log('case     mean|Δ| (8-bit levels)   pixels >2 levels');
for (const mode of ['still', 'strafe']) {
  const base = shots[`${mode}-${FIELDS[0]}`];
  for (const fc of FIELDS.slice(1)) {
    const d = meanAbsDiff(base.img, shots[`${mode}-${fc}`].img);
    console.log(`${mode.padEnd(8)} f${FIELDS[0]} vs f${fc}:  ${d.mean.toFixed(2).padStart(8)}   `
      + `${String(d.changed).padStart(8)} / ${d.pixels} (${(100 * d.changed / d.pixels).toFixed(1)}%)`);
  }
}

console.log('\n=== COMB SIGNATURE: mean vertical gradient by row phase (same image, no A/B) ===');
for (const mode of ['still', 'strafe']) {
  for (const fc of FIELDS) {
    const s = shots[`${mode}-${fc}`];
    const g = rowPhaseGradient(s.img, fc);
    const lo = Math.min(...g), hi = Math.max(...g);
    console.log(`${s.name.padEnd(12)} phases [${g.map(v => v.toFixed(2)).join(', ')}]  `
      + `spread ${(hi - lo).toFixed(3)}  (${lo > 0 ? ((hi - lo) / lo * 100).toFixed(1) : 'n/a'}% of the lowest)`);
  }
}

console.log('\n=== READING IT ===');
console.log('The camera-motion term is (strafe mean|Δ|) − (still mean|Δ|) for the same pair of divisors.');
console.log('If the strafe term is much larger, the held rows are displaced by an OLD CAMERA — exactly what a');
console.log('reprojected held row removes, so the experiment is promising. If it is comparable to the still');
console.log('term, the artifact is reconstruction plus BODY motion, and motion vectors are the real work.');
console.log(`\nPNGs in ${OUT}`);

const logged = await evaluate('(() => window.__fpConsole ?? [])()').catch(() => []);
const bad = (logged ?? []).filter(([k, t]) => k === 'error' || /TSL|WGSL|Tint|pipeline/i.test(String(t)));
console.log(`console errors: ${bad.length}`);
for (const [k, t] of bad.slice(0, 6)) console.log(`  [${k}] ${String(t).slice(0, 200)}`);
process.exit(bad.length ? 2 : 0);
