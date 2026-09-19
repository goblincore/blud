// src/lab/sdf-zombie/webgpu/march/fields/tissue.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): tissue ramp and char/fire ramp.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { ROW_WOUND, ROW_WOUND_FLAGS, ROW_WOUND_META } from '../layout';

// Tissue colour by depth beneath the ORIGINAL skin — the signal `carved`
// carries in mapBody's .w.
//
// Keyed to the crater WALL rather than to the impact point, which is the
// difference that makes an oblique hit and a pair of overlapping craters read
// correctly: the radial mask rings the entry wound, this follows the surface
// that was actually opened.
//
// The fat band is the load-bearing stop. It is the cue that says "opened"
// rather than "stained", and a single base->deep lerp has no way to express it.
export const TISSUE_RAMP = /* wgsl */ `fn tissueRamp(depth: f32, baseColor: vec3<f32>, fatColor: vec3<f32>, deepColor: vec3<f32>, fatDepth: f32, muscleDepth: f32, cavity: f32, visceraColor: vec3<f32>, visceraDepth: f32) -> vec3<f32> {
  let dermis = mix(baseColor, deepColor, 0.5);
  let clot = deepColor * 0.45;
  let toFat = smoothstep(0.0, fatDepth, depth);
  let toMuscle = smoothstep(fatDepth, muscleDepth, depth);
  let toClot = smoothstep(muscleDepth, muscleDepth * 2.5, depth);
  var c = mix(dermis, fatColor, toFat);
  c = mix(c, deepColor, toMuscle);
  c = mix(c, clot, toClot);
  // Cavity. Gated on 'cavity' (this pixel is inside a wound that opened one),
  // NOT on depth alone — a deep limb wound is still a wall of meat.
  let toViscera = smoothstep(muscleDepth, visceraDepth, depth) * cavity;
  return mix(c, visceraColor, toViscera);
}`;

// FIRE COLOUR RAMP + CHAR MASK. The ramp (dull red through pale yellow-white,
// four stops) matches the NotBlood burning-run palette closely enough to A/B
// against the sprites; it is consumed by the burning-body surface block in
// MARCH_BODY's surface prep.
export const CHAR_MASK = /* wgsl */ `fn fireRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  let a = vec3<f32>(0.30, 0.02, 0.00);
  let b = vec3<f32>(1.00, 0.22, 0.02);
  let c = vec3<f32>(1.00, 0.62, 0.10);
  let d = vec3<f32>(1.00, 0.95, 0.72);
  if (x < 0.34) { return mix(a, b, x / 0.34); }
  if (x < 0.70) { return mix(b, c, (x - 0.34) / 0.36); }
  return mix(c, d, (x - 0.70) / 0.30);
}
// 0 unburned, 1 fully charred.
fn charMask(p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>) -> f32 {
  var m = 0.0;
  let n = i32(gInstWoundCount);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let flags = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS} + gBand), 0);
    if (flags.y > 0.0 && gWoundShadePrim >= 0.0 &&
        (gWoundShadePrim < flags.z || gWoundShadePrim >= flags.w)) { continue; }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META} + gBand), 0);
    if (wMeta.x < 1.5) { continue; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND} + gBand), 0);
    m = max(m, (1.0 - smoothstep(0.0, w.w * 2.2, length(p - w.xyz))) * clamp(wMeta.y, 0.0, 1.0));
  }
  return m;
}`;
