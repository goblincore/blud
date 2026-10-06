// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-organ.ts
//
// ORGANS AS MESH (2026-10-06): the organ mesh's material terms.
// Spec: docs/superpowers/specs/2026-10-06-organs-mesh-design.md, section 3.4.
//
// What it replaces: the march's organ branch (march/body/blocks/post/organ.wgsl.ts and blocks/surface/wet.wgsl.ts),
// which paints a pixel whose dominant prim is an organ `mix(albedo, organColor, organAmp)` and multiplies its wetness
// by 1.8. Here the same two numbers arrive as uniforms (organColor and organAmp are copied from a body view each
// frame, so the wound panel's "organ tint" keeps working), the wetness is a gloss that is high all over, and the
// light compose is the bone mesh's (bone-instancer.ts BONE_SHADE_WGSL), so key, torch, light list and room fill are
// the skeleton's.
//
// World position is used ONLY for the crater exposure (the wound list is in world space); every other variation is
// in segment-local space, so it rides the pose.
//
// One fn per string: wgslFn reads a second fn's parameters as inputs (bone-instancer.ts).
import type { Vec3 } from '../../types';

/** The organ's base albedo at organAmp 0: the mesh bone's raw tissue colour (mesh-appearance.ts meshBoneSurface),
 *  standing for the march's "at amp 0 organ prims shade as plain bone". */
export const ORGAN_TISSUE_BASE: Vec3 = [0.30, 0.085, 0.075];
/** The darker blotch a `veins` look multiplies in, and the vessel colour it draws. */
export const ORGAN_BLOTCH_TINT: Vec3 = [0.62, 0.42, 0.45];
export const ORGAN_VESSEL_COLOR: Vec3 = [0.42, 0.03, 0.05];

/** One organ look: `cfg` = (veins, stain, aoFloor, spare) and `gloss` = (spec scale, fresnel scale, gloss floor,
 *  spare), the two uniforms the material reads beside organColor / organAmp.
 *   veins   0..1  local-space blotches and thin vessels;
 *   stain   0..1  pull toward the deep tissue colour away from a crater's centre (blood pooled at the rim);
 *   aoFloor 0..1  how dark the organ sits where no crater is centred (the faked cavity occlusion: 1 = none). */
export interface OrganLook {
  cfg: readonly [number, number, number, number];
  gloss: readonly [number, number, number, number];
}

/** The candidates of the owner's look sheet. `match` is the nearest to the SDF organs: one flat colour, wet all over. */
export const ORGAN_LOOKS = {
  match: { cfg: [0.0, 0.0, 0.75, 0], gloss: [1.0, 1.0, 0.85, 0] },
  veined: { cfg: [0.6, 0.2, 0.65, 0], gloss: [1.1, 1.0, 0.8, 0] },
  bloody: { cfg: [0.85, 0.55, 0.5, 0], gloss: [1.3, 1.2, 0.8, 0] },
} as const satisfies Record<string, OrganLook>;
export type OrganLookName = keyof typeof ORGAN_LOOKS;
/** Until the owner picks from the sheet (docs/dev-notes/2026-10-06-organs-mesh/look/). */
export const ORGAN_LOOK_DEFAULT: OrganLookName = 'match';

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** CPU mirror of the surface's FIRST line: the albedo before veins and stain. organAmp 1 is organColor exactly. */
export function organBaseAlbedo(organColor: Vec3, organAmp: number): Vec3 {
  return lerp3(ORGAN_TISSUE_BASE, organColor, Math.min(Math.max(organAmp, 0), 1));
}

/** CPU mirror of the stain: the albedo pulled toward deepColor * 0.6 by stain * (1 - expo). */
export function organStained(albedo: Vec3, deepColor: Vec3, stain: number, expo: number): Vec3 {
  const e = Math.min(Math.max(expo, 0), 1);
  return lerp3(albedo, [deepColor[0] * 0.6, deepColor[1] * 0.6, deepColor[2] * 0.6], stain * (1 - e));
}

const v3 = (v: Vec3) => `vec3<f32>(${v.map(x => x.toFixed(3)).join(', ')})`;

/** vec4(albedo, expo). `tint` = (organColor, organAmp); `cfg` as OrganLook.cfg. expo is the bone mesh's crater
 *  exposure (1 under a crater's centre, 0 away from every crater), remapped by aoFloor before it reaches boneShade,
 *  whose occlusion is mix(0.45, 1, expo): the organ never sits darker than the look's floor. */
export const MESH_ORGAN_SURFACE_WGSL = /* wgsl */ `fn meshOrganSurface(pWorld: vec3<f32>, pLocal: vec3<f32>, tint: vec4<f32>, deepColor: vec3<f32>, cfg: vec4<f32>, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32> {
  var expo = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    if (f32(i) >= woundCount) { break; }
    let w = textureLoad(woundTex, vec2<i32>(i, 0), 0);
    let dist = length(pWorld - w.xyz);
    expo = max(expo, clamp(1.0 - dist / max(w.w * 1.15, 1e-3), 0.0, 1.0));
  }
  expo = smoothstep(0.0, 1.0, expo);
  var albedo = mix(${v3(ORGAN_TISSUE_BASE)}, tint.xyz, clamp(tint.w, 0.0, 1.0));
  // VEINS, segment-local: broad darker blotches, and thin vessels where a ridged noise peaks inside a patch field.
  let blotch = boneNoise(pLocal * 38.0 + vec3<f32>(4.2, 17.7, 2.9));
  let ridge = pow(1.0 - abs(boneNoise(pLocal * 90.0 + vec3<f32>(5.3, 13.1, 8.7)) * 2.0 - 1.0), 6.0);
  let patches = smoothstep(0.35, 0.60, boneNoise(pLocal * 22.0 + vec3<f32>(9.4, 3.6, 27.2)));
  albedo = mix(albedo, albedo * ${v3(ORGAN_BLOTCH_TINT)}, smoothstep(0.45, 0.70, blotch) * cfg.x);
  albedo = mix(albedo, ${v3(ORGAN_VESSEL_COLOR)}, ridge * patches * cfg.x);
  // STAIN: blood pooled away from the crater's centre.
  albedo = mix(albedo, deepColor * 0.6, cfg.y * (1.0 - expo));
  return vec4<f32>(albedo, mix(cfg.z, 1.0, expo));
}`;

/** The gloss multiplier on the shared specular and fresnel gains: wet all over (the march's organ wetness is 1.8 x
 *  the flesh's), with a small local variation above the look's floor. */
export const MESH_ORGAN_WET_WGSL = /* wgsl */ `fn meshOrganWet(pLocal: vec3<f32>, lo: f32) -> f32 {
  let w = boneNoise(pLocal * 31.0 + vec3<f32>(3.7, 11.2, 5.9));
  return mix(lo, 1.0, smoothstep(0.25, 0.75, w));
}`;
