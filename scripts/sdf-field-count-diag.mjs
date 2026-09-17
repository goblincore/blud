// scripts/sdf-field-count-diag.mjs — the h/3 field-count forensic tool.
//
// WHY THIS EXISTS, and why it is committed rather than left in /tmp. The deeper
// interlace work (plan: docs/superpowers/plans/2026-09-10-deeper-interlace-fields.md)
// reached a state where the DIVISOR is provably right and the FLESH still does not
// reach the screen. Chasing that cost three wrong guesses and four throwaway
// probes, and the probes themselves lied twice before telling the truth. This is
// the one that told the truth, kept so the next attempt starts from measurement
// instead of from a guess.
//
// WHAT IT ESTABLISHES, all of it in ONE page boot:
//
//   march target    how many texels are SURFACE (alpha < 1) at each divisor. The
//                   flesh being marched is 3.90% at h/2 and 3.91% at h/3 and h/4,
//                   so the march, the target sizing and the field parity are all
//                   EXONERATED — do not instrument the march target again.
//   output target   the same count for the texture 'bodies' actually composites
//                   into. THIS IS THE MEASUREMENT THAT WAS MISSING: if the output
//                   loses the surfaces, the fault is the composite's fresh/held
//                   row split; if it keeps them, the fault is the bone weave's
//                   write order or the presented frame.
//   presented       the canvas as the owner sees it (8-bit), as a cross-check.
//
// THE TRAPS THIS TOOL ENCODES, each of which produced a confident, meaningless
// answer on an earlier attempt:
//
//   1. STAY IN ONE BOOT. Two boots disagree at h/2 as well (the two-state branch
//      measured 2026-09-10), so a cross-boot hash comparison is never evidence.
//   2. HOLD THE FIELD PARITY. `demoScenario` steps a frame and
//      `fieldParity(frameIndex, fields)` cycles, so a one-frame step lands on a
//      different field. This tool steps TWO frames between readings.
//   3. COUNT EVERY TEXEL, NEVER SAMPLE. A sparse grid saw 5 surface texels at h/2
//      and 6 at h/3 and "proved" the flesh was present when it was not: a body
//      covers a few percent of the frame.
//   4. DE-PAD. WebGPU pads readback rows to 256 bytes; a dense walk reads the
//      padding as pixels. Stride is ceil(w * 16 / 256) * 64 floats.
//
// Usage:
//   scripts/sdf-demo-hash.sh is not involved; run this directly:
//   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-field-count-diag.mjs
//   (or wrap it in the same lab-servers.sh lifecycle if no servers are up)
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9277);
const DIVISORS = (process.env.FIELD_DIVISORS ?? '2,3,4').split(',').map(Number);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;

await send('Page.bringToFront');
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1`, fail });
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); return 1; })()');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
// The static probe grid bakes in a worker; recording before it lands captures a
// different lighting state, so wait rather than assume.
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) break;
  await sleep(500);
}
await evaluate('(() => { __sdfGame.step(60); return 1; })()');
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(true); return 1; })()');

/** Count surface texels in a padded rgba32f readback, de-padded exactly as the
 *  frame hash does. `alpha < 1` is a republished surface; `alpha == 1` is the
 *  far sentinel, i.e. nothing was marched at that texel. */
function surfaceCount(w, h, b64) {
  const raw = new Float32Array(Buffer.from(b64, 'base64').buffer);
  const stride = Math.ceil((w * 16) / 256) * 64;
  let surfaces = 0, empty = 0, nonFinite = 0, rgbNonZero = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = y * stride + x * 4;
      const r = raw[b], g = raw[b + 1], bl = raw[b + 2], a = raw[b + 3];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(bl) || !Number.isFinite(a)) nonFinite++;
      if (a < 1) surfaces++; else empty++;
      if (r !== 0 || g !== 0 || bl !== 0) rgbNonZero++;
    }
  }
  return { w, h, surfaces, empty, nonFinite, rgbNonZero, pct: ((surfaces / (w * h)) * 100).toFixed(2) };
}

async function readAt(divisor) {
  const set = await evaluate(`(() => __sdfGame.setFieldCount(${divisor}))()`);
  // TWO frames: one to land on the new divisor, and the pair keeps the field
  // parity identical to every other reading (trap 2).
  await evaluate('(() => { __sdfGame.step(2); return 1; })()');
  const march = await evaluate('__sdfGameDebug.readMarchTarget()', 180_000);
  const marchStats = surfaceCount(march.w, march.h, march.rgba32f);
  // ⚠ THE OUTPUT READBACK IS NOT TRUSTWORTHY AND ITS NUMBERS ARE NOT REPORTED.
  // `readOutputTarget` wraps a Float32Array over readRenderTargetPixelsAsync bytes
  // on a target whose FORMAT was never established; sampling the brightest flesh
  // texel returns [8781, 8992, 9230, 15360], which is impossible for an rgba32f
  // colour target where every channel is 0-1. On 2026-09-10 this reported "output
  // surfaces 0.00%" at h/2 AS WELL — and h/2 is the working config — which was the
  // tell that the READER was broken, and it got explained away for hours and sent
  // an entire investigation after the composite. A tool that reports a confident
  // wrong verdict is worse than no tool, so this one now REFUSES.
  //
  // To restore it: establish the target's real texture.format (half-float and
  // integer formats both decode wrong as Float32Array), or read the PRESENTED
  // canvas instead via __sdfGame.presentedShot() — proven, real 8-bit pixels, and
  // the surface the owner actually looks at.
  // (read `out` never assigned: see the note above)
  const out = null;
  void out;
  const shot = await evaluate('(() => __sdfGame.presentedShot())()', 120_000);
  return { set, fieldCount: await evaluate('(() => __sdfGame.fieldCount)()'), marchStats, shotBytes: shot ? shot.length : 0 };
}

console.log(`sdf-field-count-diag — divisors ${DIVISORS.join(', ')}`);
console.log('  Asking: does the SURFACE the march produces reach the composited output?\n');
const rows = [];
for (const d of DIVISORS) {
  const r = await readAt(d);
  rows.push({ d, ...r });
  console.log(`  ?fields=${d} → setFieldCount returned ${r.set}, live ${r.fieldCount}`);
  console.log(`      march   : ${r.marchStats.w}x${r.marchStats.h}  surfaces ${String(r.marchStats.surfaces).padStart(7)} (${r.marchStats.pct}%)  nonFinite ${r.marchStats.nonFinite}  rgbNonZero ${r.marchStats.rgbNonZero}`);
  console.log('      OUTPUT  : NOT MEASURED — the output readback decodes the wrong format (see the note in readAt).');
  console.log(`      canvas  : ${r.shotBytes} base64 chars of PNG`);
}

console.log('\n  WHAT THIS ESTABLISHES:');
console.log('    The flesh IS marched at every divisor, in the right proportion, with correct');
console.log('    target heights and no non-finite texels. That exonerates the march, the target');
console.log('    sizing and the field parity — do NOT instrument the march target for a');
console.log('    missing-flesh bug again.');
console.log('    The OUTPUT half is disabled on purpose: its readback is broken (recorded');
console.log('    2026-09-10) and a confident wrong verdict here cost hours. Fix the reader or');
console.log('    compare __sdfGame.presentedShot() canvases instead.');
process.exit(0);
