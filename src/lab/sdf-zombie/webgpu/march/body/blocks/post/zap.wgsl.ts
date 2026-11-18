// src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.ts
//
// THE ZAP ON THE FLESH (spec 2026-11-17-tesla-arc-design.md): a body under the tesla arc is a flat
// blue-white glow, brighter at its silhouette, with its skeleton showing in it. Two pieces, because the
// march body is two strings:
//   ZAP_BLOCK        in the post-hit material (trace.wgsl.ts, after BURN_BLOCK): gathers the terms into
//                    the private gZap = (glow, invert, nearBone, 1);
//   ZAP_LIGHT_BLOCK  at the end of the lighting tail (light.wgsl.ts): mixes the lit colour toward the glow.
// The lane is burnCfg.w per view and gInstBurn.w per crowd instance (crowd-records.ts REC_BURN): the
// glow 0..1, NEGATIVE while the bones are inverted (a jolt). Zero on every body the arc is not on, so no
// other pixel pays for either block.
//
// The skeleton of a mesh-skeleton body is drawn by its bone meshes (skeleton-spike/zap-xray.ts): such a
// body packs no bone rows, the probe below is skipped and nearBone stays 0. A body that DOES pack bone
// rows (the procedural skeleton) gets its bones from the probe, the way the burn's show-through does.

/** The look, in linear RGB. Baked into the shader: change a number, rebuild. */
export const ZAP_LOOK = Object.freeze({
  /** The glow's colour at the body's centre. */
  core: [0.62, 0.8, 1.0] as const,
  /** Gain at the centre and the extra at the silhouette. */
  gain: 1.5,
  rim: 1.9,
  /** The skeleton's colour in the glow. */
  bone: [0.015, 0.02, 0.04] as const,
  /** How far under the surface a bone still shows (m): the procedural-skeleton probe. */
  probeDepthM: 0.14,
});

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const v3 = (c: readonly [number, number, number]) => `vec3<f32>(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;

export const ZAP_BLOCK = /* wgsl */ `  // THE ZAP. burnCfg.w is the per-view lane and gInstBurn.w the per-instance one; the larger in size
  // wins, sign and all, so one shader serves single and crowd draws.
  let zapRaw = select(gInstBurn.w, burnCfg.w, abs(burnCfg.w) > abs(gInstBurn.w));
  if (zapRaw != 0.0) {
    var zapBone = 0.0;
    if (gInstCounts2.x > 0.0) {
      let zapProbe = applyBones(1e9, pS, data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
      zapBone = 1.0 - smoothstep(0.0, ${f(ZAP_LOOK.probeDepthM)}, max(zapProbe, 0.0));
    }
    gZap = vec4<f32>(clamp(abs(zapRaw), 0.0, 1.0), select(0.0, 1.0, zapRaw < 0.0), zapBone, 1.0);
    // A body that IS the light carries no face or prim glow of its own under it.
    faceGlow = faceGlow * (1.0 - gZap.x);
    primGlow = primGlow * (1.0 - gZap.x);
  }`;

export const ZAP_LIGHT_BLOCK = /* wgsl */ `  // THE ZAP (zap.wgsl.ts). Unlit and flat: the colour depends on the view angle alone, so wounds, blood
  // and shadow all go under it. gZap.x is 0 on every body the arc is not on.
  if (gZap.x > 0.0) {
    let zapRim = pow(1.0 - max(dot(n, V), 0.0), 2.0);
    let zapGlow = ${v3(ZAP_LOOK.core)} * (${f(ZAP_LOOK.gain)} + ${f(ZAP_LOOK.rim)} * zapRim);
    let zapDark = ${v3(ZAP_LOOK.bone)};
    // Dark bones in bright flesh; on a jolt (gZap.y) the two swap.
    let zapFlesh = mix(zapGlow, zapDark, gZap.y);
    let zapBones = mix(zapDark, zapGlow, gZap.y);
    lit = mix(lit, mix(zapFlesh, zapBones, gZap.z), gZap.x);
  }`;
