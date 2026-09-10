/**
 * `bounceSpotIrradiance` — the analytic disc light the flashlight patch casts.
 *
 * THE TWIN. This is the GPU copy of `bounceSpotIrradiance` in
 * `../flashlight-bounce.ts`. Nothing here compiles WGSL in tests, so the CPU
 * mirror is property-tested over there and this string is pinned by
 * `flashlight-bounce.wgsl.test.ts` (source text and the real wgslFn parser).
 * Change one, change both.
 *
 * THE SEAM. `computeBounceSpot` runs on the CPU once per frame and its result
 * is packed into the march's four trailing spot uniforms: `spotPosW`,
 * `spotNormalW`, `spotRadiance` and `spotCfg = (gain, radius, 0, 0)`. The gain
 * gate lives INSIDE this function so `bounceSpotCfg.x === 0` is bit-identical
 * to the pre-bounce march.
 *
 * ZERO FIELD EVALUATIONS: the patch is resolved on the CPU, so this is a
 * normalise, two dots and a divide — the same hard constraint the analytic
 * flashlight itself obeys.
 *
 * ORDER. `bounceSpotIrradiance` is declared first and the string starts with
 * it, as the wgslFn parse contract requires.
 */

export const FLASHLIGHT_BOUNCE_WGSL = /* wgsl */ `fn bounceSpotIrradiance(
  p: vec3<f32>,
  n: vec3<f32>,
  spotPosW: vec3<f32>,
  spotNormalW: vec3<f32>,
  spotRadiance: vec3<f32>,
  spotCfg: vec4<f32>
) -> vec3<f32> {
  // spotCfg.x is the runtime gain (0 disables — lab parity); spotCfg.y the
  // disc radius. Gate first so a disabled spot costs one compare.
  if (spotCfg.x <= 0.0) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }

  let toSpot = spotPosW - p;
  let d = length(toSpot);
  if (d < 1e-9) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let l = toSpot / d;

  let r = spotCfg.y;
  let ndl = max(dot(n, l), 0.0);
  let snl = max(dot(spotNormalW, -l), 0.0);
  let denom = d * d + r * r;
  let k = 3.141592653589793 * r * r * ndl * snl / denom;
  return spotRadiance * k * spotCfg.x;
}`;
