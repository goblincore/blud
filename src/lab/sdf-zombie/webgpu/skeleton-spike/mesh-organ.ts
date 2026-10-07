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

/** The blood wash a look multiplies into the albedo (cfg.w = how much). MEASURED, not chosen: on the gate's belly
 *  crater with the torch on, the SDF organ's pixels average linear (0.506, 0.099, 0.071) and the mesh organ's, on
 *  plain organColor, (0.48, 0.167, 0.12): the march's wound overlays (gore, the wet film) redden an organ pixel by
 *  about (1, 0.59, 0.59). NOTES.md, "Matching the SDF organ". */
export const ORGAN_WASH: Vec3 = [1.0, 0.59, 0.59];
/** The wet glint's exponent (meshOrganShade): tight, against boneShade's broad sheen. */
export const ORGAN_GLINT_POWER = 90;

/** One organ look: the three uniforms the material reads beside organColor / organAmp.
 *  `cfg` = (veins, stain, aoFloor, wash):
 *   veins   0..1  local-space blotches and thin vessels;
 *   stain   0..1  pull toward the deep tissue colour away from a crater's centre (blood pooled at the rim);
 *   aoFloor 0..1  how dark the organ sits where no crater is centred (boneShade's occlusion input: 1 = none);
 *   wash    0..1  the blood wash, ORGAN_WASH.
 *  `gloss` = (spec scale, fresnel scale, gloss floor, wet highlight): the first three scale boneShade's broad sheen;
 *   the fourth is the gain of the torch's TIGHT highlight (meshOrganShade), the hot white glint that makes the
 *   march's organ read as wet (its wetness is 1.8 x the flesh's, under its own per-pixel torch). 0 = none.
 *  `occ` = (r, g, b, beam gain): THE CAVITY'S OCCLUSION. The march shades an organ inside its crater: the room's
 *   lights reach it shadowed and already reddened by the flesh round it, and only a light at the eye (the torch)
 *   shines straight in. A mesh has no field to shadow it, so every light but the beam is multiplied by this colour
 *   (meshOrganShade). (1, 1, 1) = none: the organ glows pale in a dark room. The beam's share is multiplied by the
 *   gain instead: the march lights flesh with its own per-pixel torch on top of the list's beam slot, which is all a
 *   bone mesh gets, so an organ on gain 1 sits dimmer under the torch than the flesh round it. */
export interface OrganLook {
  cfg: readonly [number, number, number, number];
  gloss: readonly [number, number, number, number];
  occ: readonly [number, number, number, number];
}

/** The candidates of the owner's look sheet (docs/dev-notes/2026-10-06-organs-mesh/look/).
 *   match   fitted to the SDF organ: one flat colour, the measured wash and occlusion, a moderate glint;
 *   wet     the SDF organ as it reads in a shadowed crater: a darker base under a hot glint;
 *   veined  match, with blotches and vessels;
 *   pale    lighter and less occluded: an organ that is easier to see than today's. */
export const ORGAN_LOOKS = {
  match: { cfg: [0.0, 0.0, 0.75, 1.0], gloss: [1.0, 0.6, 0.85, 5.0], occ: [0.38, 0.14, 0.10, 1.5] },
  wet: { cfg: [0.0, 0.3, 0.75, 1.0], gloss: [1.0, 0.4, 0.85, 10.0], occ: [0.34, 0.11, 0.08, 1.1] },
  veined: { cfg: [1.0, 0.2, 0.75, 1.0], gloss: [1.0, 0.6, 0.85, 5.0], occ: [0.38, 0.14, 0.10, 1.6] },
  pale: { cfg: [0.25, 0.0, 0.85, 0.3], gloss: [1.0, 0.8, 0.85, 3.0], occ: [0.75, 0.5, 0.45, 1.7] },
} as const satisfies Record<string, OrganLook>;
export type OrganLookName = keyof typeof ORGAN_LOOKS;
/** The owner's pick from the sheet, 2026-10-07: "go with wet" (docs/dev-notes/2026-10-06-organs-mesh/look/). */
export const ORGAN_LOOK_DEFAULT: OrganLookName = 'wet';

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** CPU mirror of the surface's first lines: the albedo before veins and stain. organAmp 1 and wash 0 is organColor
 *  exactly; wash 1 multiplies ORGAN_WASH in. */
export function organBaseAlbedo(organColor: Vec3, organAmp: number, wash = 0): Vec3 {
  const a = lerp3(ORGAN_TISSUE_BASE, organColor, Math.min(Math.max(organAmp, 0), 1));
  return lerp3(a, [a[0] * ORGAN_WASH[0], a[1] * ORGAN_WASH[1], a[2] * ORGAN_WASH[2]], Math.min(Math.max(wash, 0), 1));
}

/** CPU mirror of meshOrganShade's last line: what multiplies the lit colour when the beam carries `share` (0..1) of
 *  the light on the point. No beam: the occlusion colour; all beam: the beam gain. */
export function organOcclusion(occ: Vec3, share: number, beamGain = 1): Vec3 {
  const s = Math.min(Math.max(share, 0), 1);
  return [occ[0] * (1 - s) + beamGain * s, occ[1] * (1 - s) + beamGain * s, occ[2] * (1 - s) + beamGain * s];
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
  albedo = mix(albedo, albedo * ${v3(ORGAN_WASH)}, clamp(cfg.w, 0.0, 1.0));
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

/** THE ORGAN'S LIGHT COMPOSE: the bone mesh's (boneShade), then the cavity's occlusion on every light but the beam.
 *  `share` is the beam's part of the light on the point: with the shared light list, bodyLights' own wrap-weighted
 *  luminances (lumBeam of lumAll, plus the ambient); on the old single key, the torch cone's part of the key. The
 *  whole colour is scaled by mix(occ.rgb, occ.w, share): in a dark room the organ sits dark and red in its crater, and
 *  under the torch it is lit as the flesh round it is.
 *  bodyLights is called under the same per-draw condition boneShade calls it under (body-lights.wgsl.ts, "WHERE IT
 *  MAY BE CALLED"). Needs BODY_LIGHTS and BONE_SHADE_WGSL as includes. */
export const MESH_ORGAN_SHADE_WGSL = /* wgsl */ `fn meshOrganShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, deepColor: vec3<f32>, ambient: vec3<f32>, look: vec4<f32>, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>, spotPos: vec3<f32>, spotAxis: vec3<f32>, spotCfg: vec4<f32>, spotCfg2: vec4<f32>, spotColor: vec3<f32>, surfaceIn: vec4<f32>, picks: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>, listOn: f32, fill: f32, occ: vec4<f32>, gloss: vec4<f32>) -> vec3<f32> {
  let lit = boneShade(p, n, camPos, deepColor, ambient, look, lightDir, keyColor, lightCfg, spotPos, spotAxis, spotCfg, spotCfg2, spotColor, surfaceIn, picks, lights, listOn, fill);
  let lumW = vec3<f32>(0.2126, 0.7152, 0.0722);
  var share = 0.0;
  var glint = vec3<f32>(0.0);
  if (listOn > 0.5 && picks.x > -1.5) {
    let V = normalize(camPos - p);
    let bl = bodyLights(p, n, V, picks, lights, false, false);
    share = bl.lumBeam / max(bl.lumAll + dot(ambient * fill, lumW), 1e-5);
    // THE WET GLINT: the torch's tight highlight. The beam is at the eye, so its half vector is the view vector and
    // the glint runs along whatever faces the camera; its strength is the beam's own luminance on the point.
    glint = vec3<f32>(bl.lumBeam * pow(max(dot(n, V), 0.0), ${ORGAN_GLINT_POWER.toFixed(1)}) * gloss.w);
  } else if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let cone = dot(-toLamp / max(dist, 1e-4), normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beamI = coneFall * coneFall * distFall * distFall * spotCfg.x * spotCfg2.x;
    share = beamI / max(beamI + lightCfg.x * spotCfg2.z + dot(ambient, lumW), 1e-5);
    glint = spotColor * (beamI * pow(max(dot(n, normalize(camPos - p)), 0.0), ${ORGAN_GLINT_POWER.toFixed(1)}) * gloss.w);
  }
  let s = clamp(share, 0.0, 1.0);
  return lit * mix(occ.xyz, vec3<f32>(occ.w), s) + glint;
}`;
