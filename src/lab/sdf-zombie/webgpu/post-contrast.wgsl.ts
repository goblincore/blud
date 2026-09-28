// src/lab/sdf-zombie/webgpu/post-contrast.wgsl.ts
//
// THE FINAL S-CURVE (owner 2026-09-27: "the overall scene lacks a little contrast - everything a
// bit medium grey"; softened after a replay: "still curious about a gentle S-curve, not a relight").
// Hand-written WGSL, applied at the final blit after the lightning grade. The blit's output is
// LINEAR (post-aa.ts COLOUR CHAIN: the canvas encodes it), so the curve runs in display space:
// encode with gamma 2.2, apply a two-sided power S about a PIVOT (below it: pivot x (d/pivot)^(1+k)
// sinks; above: the mirror lifts; black, white and the pivot fixed, C1-continuous only at k 0), decode.
// k 0 returns c untouched. The darkest tones sink but stay monotonic above 0 (never clamped flat:
// the "never flat black for zombies" rule).
// Only drawn when the post chain runs (VHS on, the game default), like the lightning grade.

export const CONTRAST_WGSL = /* wgsl */ `fn sCurve(c: vec3<f32>, k: f32, pivot: f32) -> vec3<f32> {
  if (k <= 0.0) { return c; }
  let d = clamp(pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2)), vec3<f32>(0.0), vec3<f32>(1.0));
  let e = 1.0 + k;
  let lo = pivot * pow(d / pivot, vec3<f32>(e));
  let hi = vec3<f32>(1.0) - (1.0 - pivot) * pow((vec3<f32>(1.0) - d) / (1.0 - pivot), vec3<f32>(e));
  return pow(select(hi, lo, d < vec3<f32>(pivot)), vec3<f32>(2.2));
}`;

/** CPU twin of sCurve (tests). */
export function sCurve(c: number, k: number, pivot: number): number {
  if (k <= 0) return c;
  const d = Math.min(1, Math.max(0, Math.pow(Math.max(c, 0), 1 / 2.2)));
  const e = 1 + k;
  const y = d < pivot ? pivot * Math.pow(d / pivot, e) : 1 - (1 - pivot) * Math.pow((1 - d) / (1 - pivot), e);
  return Math.pow(y, 2.2);
}

/** Shipped strength: off until the owner picks from the side-by-sides. */
export const CONTRAST_DEFAULT = 0;
/** The pivot in DISPLAY space: tones below sink, tones above lift. Night Train frames sit low
 *  (median display ~0.08, p95 ~0.3 lit), so a mid-grey 0.5 pivot only darkened the frame. */
export const CONTRAST_PIVOT_DEFAULT = 0.18;
