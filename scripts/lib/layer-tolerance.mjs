// scripts/lib/layer-tolerance.mjs
//
// Sub-LSB agreement for a frame-hash layer. Pure by design: scripts/sdf-demo-hash.mjs
// runs the whole gate at its top level, so a predicate living there cannot be
// unit-tested. This is the same split as scripts/lib/demo-digest.mjs.
//
// WHY A TOLERANCE EXISTS AT ALL. Measured 2026-09-18, after the gather cadence
// phase was fixed: two identical runs still diverged at frame 0 in `probeDyn`,
// with summary statistics IDENTICAL to six significant figures on both sides
// (nonZero 6388, min -0.540611, max 3.54491, zeroFractionMillionths 1875) and
// only the HASH differing (2143084656 vs 4125444763). `instances` matched
// exactly, so the capsules were packed identically. Identical statistics with a
// different bit pattern is a sub-LSB float difference — which frame-hash.ts
// preserves ON PURPOSE — and the suspect is GPU accumulation order inside the
// gather, which the CPU does not sequence and cannot pin.
//
// THIS IS NOT A SKIP. A blanket "ignore probeDyn" would delete the coverage of
// the one layer whose zeroing shipped the black-silhouette bug the tool was
// built for. A hash may differ ONLY when every statistic still agrees, and the
// FIRST rule is liveness: two empty layers agree on nothing.

/** Layers whose exact bit pattern is not reproducible on this hardware.
 *  `marchTarget` and `instances` stay EXACT and must never be added here. */
export const SUBLSB_TOLERANT = new Set(['probeDyn']);

/** Relative closeness, safe at zero. */
export function near(x, y, rel = 1e-5) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const d = Math.abs(x - y);
  const scale = Math.max(Math.abs(x), Math.abs(y), 1e-6);
  return d / scale <= rel;
}

/**
 * Do two readings of a tolerant layer agree to the precision that matters?
 *
 *   - both LIVE (nonZero > 0) — checked first, and the case that matters most
 *   - no non-finite values on either side
 *   - nonZero, sampled, floats and zeroFractionMillionths equal exactly
 *   - min and max within 1e-5 relative
 *
 * Anything that actually changes the layer moves at least one of those.
 */
export function layerStatsAgree(la, lb) {
  const sa = la?.stats, sb = lb?.stats;
  if (!sa || !sb) return false;
  if ((sa.nonZero ?? 0) === 0 || (sb.nonZero ?? 0) === 0) return false;
  if ((sa.nonFinite ?? 0) !== 0 || (sb.nonFinite ?? 0) !== 0) return false;
  if (sa.nonZero !== sb.nonZero) return false;
  if (sa.sampled !== sb.sampled) return false;
  if (la.floats !== lb.floats) return false;
  if (sa.zeroFractionMillionths !== sb.zeroFractionMillionths) return false;
  return near(sa.min, sb.min) && near(sa.max, sb.max);
}
