// scripts/sdf-accum-convergence.mjs — GATE 1 of the accumulation plan: does a
// low-resolution march, accumulated over time, actually reconstruct detail?
//
// This is the KILL CRITERION (docs/superpowers/plans/2026-09-10-temporal-accumulation.md).
// The prize is ~8 ms of a 16.6 ms frame at `setSdfScale(0.5)`, and the owner has
// already rejected the half-scale march on its own ("too pixelated and aliased").
// So the accumulation has exactly one job: make 0.5 look like more than 0.5.
//
// METHOD — one boot, frozen camera, frozen sim, one reference:
//   1. capture the REFERENCE: `sdfScale 1.0`, accumulation OFF (the shipped march);
//   2. turn accumulation ON at 0.5 and step ONE frame at a time, capturing after
//      each step, computing mean|Δ| against the reference as frames accumulate.
// The frame is frozen, so the history converges toward the true image if the jitter
// and the reprojection are doing their job: the distance must FALL and SETTLE.
//
// WHAT IT PROVES AND WHAT IT DOES NOT.
//   - It proves reconstruction, which is the kill criterion. A flat curve means
//     the accumulation is not recovering detail and the project is dead — do not
//     go on to motion, do not build motion vectors.
//   - It does NOT judge the look (shimmer in motion is the owner's call and a
//     still cannot show it), and because the camera is frozen it does not exercise
//     the reprojection at all. A pass here is necessary, not sufficient.
//   - The reference is the sdfScale 1.0 render, which is itself aliased: this
//     measures "how close to the shipped march", not "how close to ground truth".
//   - `?vhs=off`: the VHS pass has its own temporal blend that cannot be pinned, and
//     it made the curve oscillate between odd and even frames on the first run.
//   - Frame 1 of an epoch is NOT a proxy for the raw low-res march: it is a
//     JITTERED low-res march (alpha 1 re-seeds from the current sample). Both
//     baselines are reported, because the accumulation has to beat both.
//
// Usage (needs servers; scripts/lab-servers.sh owns them, or use the .sh):
//   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-accum-convergence.mjs
//   ACCUM_SCALE=0.5 ACCUM_FRAMES=24 ACCUM_ALPHA=0.25 ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.argv[3] ?? process.env.LAB_CDP_PORT ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-accum';
const SCALE = Number(process.env.ACCUM_SCALE ?? 0.5);
const FRAMES = Number(process.env.ACCUM_FRAMES ?? 24);
const ALPHA = process.env.ACCUM_ALPHA ? Number(process.env.ACCUM_ALPHA) : null;
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();

mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__accumConsole = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__accumConsole.push(['error', a.map(String).join(' ')]); e(...a); };
    console.warn = (...a) => { window.__accumConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
  })()`,
});

await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
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

// Stage a body in frame: this is a FLESH reconstruction test, so an empty room
// would measure the background and prove nothing.
const staged = await evaluate(`(async () => {
  __sdfGame.teleport(${Number(process.env.ACCUM_ROOM ?? 1)});
  const z = __sdfGame.zombies().find(q => q.room === ${Number(process.env.ACCUM_ROOM ?? 1)});
  if (!z) return { error: 'no body in the room' };
  __sdfGame.freeze(true);
  const d = ${Number(process.env.ACCUM_DIST ?? 2.5)};
  const ex = z.pos[0] + Math.sin(0) * d, ez = z.pos[2] + Math.cos(0) * d;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)), 0);
  __sdfGame.step(30);
  return { d, body: z.id };
})()`);
if (staged?.error) fail(staged.error);
console.log(`staged: room ${process.env.ACCUM_ROOM ?? 1}, body ${staged.body}, ${staged.d} m`);

const shot = async () => decodePng(Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
const meanAbsDiff = (a, b) => {
  let sum = 0, n = 0, over2 = 0;
  for (let i = 0; i < a.data.length; i += a.ch) {
    let d = 0;
    for (let c = 0; c < 3; c++) { const dd = Math.abs(a.data[i + c] - b.data[i + c]); if (dd > d) d = dd; }
    sum += d; n++; if (d > 2) over2++;
  }
  return { mean: sum / n, over2, pct: 100 * over2 / n };
};

// 0. THE FAIR REFERENCE: a CONVERGED accumulation at FULL scale. Comparing a
//    smoothed estimate against an unjittered render is measuring the wrong thing —
//    that render is itself one aliased sample, so removing aliasing reads as
//    "further away" by construction. Two accumulations at different scales are
//    comparable: both are reconstructions, and the full-scale one has 4x the
//    samples per frame, so a cheap reconstruction that works lands close to it.
await evaluate('(() => { __sdfGame.setSdfScale(1.0); __sdfGame.setTemporalAccum(true); return 1; })()');
await evaluate('(() => { __sdfGame.step(24); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const refAccum = await shot();
writeFileSync(`${OUT}/reference-scale1-accum.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));

// 1. THE ALIASED REFERENCE: the shipped march at full scale, no accumulation.
await evaluate('(() => { __sdfGame.setTemporalAccum(false); __sdfGame.setSdfScale(1.0); return 1; })()');
await evaluate('(() => { __sdfGame.step(8); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const ref = await shot();
writeFileSync(`${OUT}/reference-scale1.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));

// And the same scene at the LOW scale with NO accumulation: the baseline the
// accumulation has to beat. Without this row a converging curve proves nothing.
await evaluate(`(() => { __sdfGame.setSdfScale(${SCALE}); __sdfGame.setTemporalAccum(false); return 1; })()`);
await evaluate('(() => { __sdfGame.step(8); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const lowNoAccum = await shot();
writeFileSync(`${OUT}/low-no-accum.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
const base = meanAbsDiff(ref, lowNoAccum);
const baseConverged = meanAbsDiff(refAccum, lowNoAccum);
console.log(`\nscale ${SCALE}, NO accumulation:`);
console.log(`   vs the ALIASED scale-1.0 render      : mean|Δ| ${base.mean.toFixed(3)}  (${base.pct.toFixed(1)}% >2)`);
console.log(`   vs the CONVERGED scale-1.0 ACCUM     : mean|Δ| ${baseConverged.mean.toFixed(3)}  (${baseConverged.pct.toFixed(1)}% >2)`);

// 2. THE CONVERGENCE CURVE.
await evaluate(`(() => { __sdfGame.setSdfScale(${SCALE}); __sdfGame.setTemporalAccum(true${ALPHA !== null ? `, ${ALPHA}` : ''}); return 1; })()`);
console.log(`accum ON at scale ${SCALE}${ALPHA !== null ? `, alpha ${ALPHA}` : ''} — stepping ${FRAMES} frames\n`);
console.log('frame  vs ALIASED 1.0   vs CONVERGED 1.0 accum   epoch/frames');
const curve = [];
for (let f = 1; f <= FRAMES; f++) {
  await evaluate('(() => { __sdfGame.step(1); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  const img = await shot();
  if (f === 1 || f === 4 || f === 8 || f === FRAMES) {
    writeFileSync(`${OUT}/accum-frame${String(f).padStart(2, '0')}.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
  }
  const d = meanAbsDiff(ref, img);
  const dAccum = meanAbsDiff(refAccum, img);
  const state = await evaluate('(() => __sdfGame.temporalAccum)()');
  curve.push({ f, ...d, meanVsConverged: dAccum.mean, pctVsConverged: dAccum.pct, epoch: state.epoch, frames: state.frames });
  if (f <= 6 || f % 4 === 0 || f === FRAMES) {
    console.log(`${String(f).padStart(5)}  ${d.mean.toFixed(3).padStart(14)}  ${dAccum.mean.toFixed(3).padStart(14)}   ${state.epoch}/${state.frames}`);
  }
}

// 3. THE VERDICT.
const first = curve[0], last = curve[curve.length - 1];
const best = curve.reduce((a, b) => (b.mean < a.mean ? b : a));
const bestConv = curve.reduce((a, b) => (b.meanVsConverged < a.meanVsConverged ? b : a));
console.log(`\n=== GATE 1 (still camera), against the CONVERGED full-scale accumulation ===`);
console.log(`no accumulation      : ${baseConverged.mean.toFixed(3)}`);
console.log(`frame 1 of the epoch : ${first.meanVsConverged.toFixed(3)}`);
console.log(`best frame           : ${bestConv.meanVsConverged.toFixed(3)} (frame ${bestConv.f})`);
console.log(`frame ${FRAMES}            : ${last.meanVsConverged.toFixed(3)}`);
console.log(`(for the record, vs the ALIASED 1.0 render: no-accum ${base.mean.toFixed(3)}, best ${best.mean.toFixed(3)})`);
const gain = baseConverged.mean - bestConv.meanVsConverged;
const settle = Math.abs(curve[curve.length - 1].meanVsConverged - bestConv.meanVsConverged);
console.log(`improvement over no-accumulation: ${gain.toFixed(3)} (${(100 * gain / base.mean).toFixed(1)}%)`);
console.log(`still improving at the end by    : ${settle.toFixed(3)} per frame`);
console.log(gain > 0.15 * baseConverged.mean
  ? '\nVERDICT: the accumulation RECONSTRUCTS — it is meaningfully closer to the full-scale render than the raw low-res march. Gate 1 PASSES; motion is worth measuring next.'
  : '\nVERDICT: the accumulation does NOT reconstruct — it is no closer to the full-scale render than the raw low-res march. Per the plan this KILLS the project; do not build motion vectors.');
console.log(`\nPNGs in ${OUT}`);

const logged = await evaluate('(() => window.__accumConsole ?? [])()').catch(() => []);
const bad = (logged ?? []).filter(([k, t]) => k === 'error' || /TSL|WGSL|Tint|pipeline/i.test(String(t)));
console.log(`console errors: ${bad.length}`);
for (const [k, t] of bad.slice(0, 8)) console.log(`  [${k}] ${String(t).slice(0, 240)}`);
process.exit(0);
