// src/lab/sdf-zombie/melt-wounds.ts
//
// CRATERS THROUGH A MELT (2026-11-22). A melting body used to drop every crater on its first frame: a carve
// sphere left where the standing body was would bite the pool (game-actor beginMelt). So the wounds blinked out
// the moment the melter hit. Now the craters the body showed are kept for the drawing only and go down with it:
//
//   WHERE   each crater rides its own prim: a point of the unmelted prim is carried onto the melted one at the same
//           place along it, its offset from the axis scaled with the prim's section (meltWoundPoint). The upload's
//           point transform (character-view WoundPointTransform) applies it.
//   CLOSES  a crater shrinks as its own prim melts and is gone by MELT_WOUND_CLOSE of that prim's melt
//           (meltWoundRows), so none is left when its flesh reaches the pool: the old reason for the clear holds.
//
// Render only: the gameplay ring is still emptied at the melt's start (what reads it, the bleeds and the bone
// exposure, sees no wounds on goo, as before). Pure: no renderer imports.
import type { Wound } from './damage';
import { MELT_TUNING_BODY, clamp01, primEndProgress, smoothstep, type MeltBodyTuning, type MeltState } from './melt';
import type { Primitive, Vec3 } from './types';

/** A crater is closed when its prim is this far through its own melt (0..1). The prim's cross-section is then
 *  well into its crush, and the crater is gone before the flesh lies in the pool. */
export const MELT_WOUND_CLOSE = 0.6;
/** Below this share of its radius a closing crater is dropped (a speck of a crater reads as noise). */
const MIN_SHARE = 0.05;

/** The craters to draw on a body this far through its melt: each one's radius and lip shrunk by its prim's melt,
 *  the closed ones dropped. A crater whose prim has not started melting is returned as it is. */
export function meltWoundRows(wounds: readonly Wound[], s: MeltState, body: MeltBodyTuning = MELT_TUNING_BODY): Wound[] {
  const out: Wound[] = [];
  for (const w of wounds) {
    const [ua, ub] = primEndProgress(s, w.primIdx, body);
    const k = 1 - smoothstep(clamp01((ua + ub) / 2 / MELT_WOUND_CLOSE));
    if (k >= 1) { out.push(w); continue; }
    if (k < MIN_SHARE) continue;
    out.push({ ...w, radius: w.radius * k, rimScale: (w.rimScale ?? 1) * k });
  }
  return out;
}

/** The cross-section of a prim across its axis (x, z) and along world y, in metres. */
const section = (p: Primitive): [number, number] =>
  [p.radius * Math.max(p.scale[0], p.scale[2]), p.radius * p.scale[1]];

/** Carry the world point `v`, on or in prim `from`, onto `to` (the same prim melted): the same fraction along its
 *  axis, the offset from the axis scaled by how the section changed (across in x and z, crushed in y). */
export function meltWoundPoint(v: Vec3, from: Primitive, to: Primitive): Vec3 {
  const ab: Vec3 = [from.b[0] - from.a[0], from.b[1] - from.a[1], from.b[2] - from.a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l2 > 1e-12
    ? clamp01(((v[0] - from.a[0]) * ab[0] + (v[1] - from.a[1]) * ab[1] + (v[2] - from.a[2]) * ab[2]) / l2)
    : 0;
  const c: Vec3 = [from.a[0] + ab[0] * t, from.a[1] + ab[1] * t, from.a[2] + ab[2] * t];
  const [fx, fy] = section(from), [tx, ty] = section(to);
  const kx = fx > 1e-9 ? tx / fx : 1, ky = fy > 1e-9 ? ty / fy : 1;
  const c2: Vec3 = [to.a[0] + (to.b[0] - to.a[0]) * t, to.a[1] + (to.b[1] - to.a[1]) * t, to.a[2] + (to.b[2] - to.a[2]) * t];
  return [c2[0] + (v[0] - c[0]) * kx, c2[1] + (v[1] - c[1]) * ky, c2[2] + (v[2] - c[2]) * kx];
}
