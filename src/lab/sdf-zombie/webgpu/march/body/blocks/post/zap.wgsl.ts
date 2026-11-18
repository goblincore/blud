// src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.ts
//
// THE ZAP ON THE FLESH (spec 2026-11-17-tesla-arc-design.md): a body under the tesla arc is a flat
// blue-white glow, brighter at its silhouette, with its skeleton showing in it. Two pieces, because the
// march body is two strings:
//   ZAP_BLOCK        in the post-hit material (trace.wgsl.ts, after BURN_BLOCK): gathers the terms into
//                    the private gZap = (glow, invert, nearBone, 1);
//   ZAP_LIGHT_BLOCK  at the end of the lighting tail (light.wgsl.ts): mixes the lit colour toward the glow.
// The lane is the body's own record, gInstBurn.w (crowd-records.ts REC_BURN): the glow 0..1, NEGATIVE
// while the bones are inverted (a jolt). Zero on every body the arc is not on, so no other pixel pays
// for either block. The game writes it to the view's burnCfg.w, and writeViewRecord carries that to the
// record of every draw (a body, a chunk, the first-person view: each is a record slot). The shader does
// NOT read burnCfg.w: a crowd type's one burnCfg is copied every frame from its source view (the first
// body of the type in the room), so reading it lit the whole type when the arc was on that one body.
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

/**
 * THE LOOK SPIKE'S VARIANTS (zap-look.ts, 2026-11-18). The record's lane carries the variant's code with the glow
 * (encodeZapLane); code 0 takes the lines above untouched. For b and c the two strobe states are HARD (the mix is
 * full from a glow of 1 / hard up, so the flicker no longer washes the flesh in and out), the negative frame
 * keeps a rim so the body's outline still reads, and thin crackle lines crawl over the flesh.
 */
export const ZAP_LOOK_VARIANTS = Object.freeze({
  /** The flesh's mix is glow x this, capped at 1. */
  hard: 3,
  /** b: the positive frame's gain at the centre (under the baseline's 1.5, so white crackle shows on it), and the
   *  negative frame's rim. */
  bGain: 1.05,
  bNegRim: 1.6,
  /** c: a hotter, whiter positive frame, a fainter rim on the negative. */
  cGain: 1.3,
  cLift: 0.2,
  cNegRim: 0.6,
  /**
   * No channel of the variants' flesh goes over this. Found by the spike on the teratoma: a positive frame of
   * (1.3, 1.61, 1.95) came out of the SDF layer as speckle over what looked like unlit flesh, and (0.65, 0.84,
   * 1.05) came out clean; the baseline's centre (0.93, 1.2, 1.5) is clean and its rim (up to 3.4) is the dotted
   * silhouette of every zapped body. Where in the layer that happens was not traced.
   */
  cap: 1.5,
  /** The crackle: its colour, how many times a second it re-rolls, its scale (lines per metre, roughly), the
   *  line's half width in noise units and the kink put on it. */
  crackle: [2.6, 2.8, 3.4] as const,
  crackleHz: 16,
  crackleScale: 7,
  crackleWidth: 0.06,
  crackleKink: 0.45,
});

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const v3 = (c: readonly [number, number, number]) => `vec3<f32>(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;

export const ZAP_BLOCK = /* wgsl */ `  // THE ZAP. The body's own record alone (signed). Not burnCfg.w, which in a crowd draw is the type's
  // source view's.
  let zapRaw = gInstBurn.w;
  if (zapRaw != 0.0) {
    // The lane (zap-look.ts encodeZapLane): 2 x the look's code + the glow. Code 0 is the glow alone.
    let zapCode = floor(abs(zapRaw) * 0.5);
    let zapAmt = abs(zapRaw) - 2.0 * zapCode;
    var zapBone = 0.0;
    if (gInstCounts2.x > 0.0) {
      let zapProbe = applyBones(1e9, pS, data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
      zapBone = 1.0 - smoothstep(0.0, ${f(ZAP_LOOK.probeDepthM)}, max(zapProbe, 0.0));
    }
    gZap = vec4<f32>(clamp(zapAmt, 0.0, 1.0), select(0.0, 1.0, zapRaw < 0.0), zapBone, 1.0);
    if (zapCode > 0.5) {
      // THE CRACKLE (look variants b and c): the zero lines of a kinked noise, in patches, re-rolled in steps.
      let zapTick = floor(faceCfg3.y * ${f(ZAP_LOOK_VARIANTS.crackleHz)});
      let zapT = zapTick - 64.0 * floor(zapTick / 64.0);
      let zapKink = vec3<f32>(noise3(pS * 31.0 + vec3<f32>(zapT)), noise3(pS * 29.0 - vec3<f32>(zapT)), noise3(pS * 33.0 + vec3<f32>(7.0)));
      let zapQ = pS * ${f(ZAP_LOOK_VARIANTS.crackleScale)} + vec3<f32>(zapT * 3.17, zapT * 1.31, zapT * 2.63) + ${f(ZAP_LOOK_VARIANTS.crackleKink)} * zapKink;
      let zapLine = 1.0 - smoothstep(0.0, ${f(ZAP_LOOK_VARIANTS.crackleWidth)}, abs(noise3(zapQ)));
      let zapPatch = smoothstep(0.05, 0.35, noise3(pS * 2.3 + vec3<f32>(zapT * 0.71)));
      gZapLook = vec4<f32>(zapCode, zapLine * zapPatch, 0.0, 0.0);
    }
    // A body that IS the light carries no face or prim glow of its own under it.
    faceGlow = faceGlow * (1.0 - gZap.x);
    primGlow = primGlow * (1.0 - gZap.x);
  }`;

export const ZAP_LIGHT_BLOCK = /* wgsl */ `  // THE ZAP (zap.wgsl.ts). Unlit and flat: the colour depends on the view angle alone, so wounds, blood
  // and shadow all go under it. gZap.x is 0 on every body the arc is not on.
  if (gZap.x > 0.0) {
    let zapRim = pow(1.0 - max(dot(n, V), 0.0), 2.0);
    let zapDark = ${v3(ZAP_LOOK.bone)};
    if (gZapLook.x < 0.5) {
      let zapGlow = ${v3(ZAP_LOOK.core)} * (${f(ZAP_LOOK.gain)} + ${f(ZAP_LOOK.rim)} * zapRim);
      // Dark bones in bright flesh; on a jolt (gZap.y) the two swap.
      let zapFlesh = mix(zapGlow, zapDark, gZap.y);
      let zapBones = mix(zapDark, zapGlow, gZap.y);
      lit = mix(lit, mix(zapFlesh, zapBones, gZap.z), gZap.x);
    } else {
      // THE LOOK VARIANTS (ZAP_LOOK_VARIANTS). b (code 1) and c (code 2): two hard states and the crackle.
      let zapC = gZapLook.x > 1.5;
      let zapPos = ${v3(ZAP_LOOK.core)} * (select(${f(ZAP_LOOK_VARIANTS.bGain)}, ${f(ZAP_LOOK_VARIANTS.cGain)}, zapC) + ${f(ZAP_LOOK.rim)} * zapRim)
        + vec3<f32>(select(0.0, ${f(ZAP_LOOK_VARIANTS.cLift)}, zapC));
      let zapNeg = zapDark + ${v3(ZAP_LOOK.core)} * select(${f(ZAP_LOOK_VARIANTS.bNegRim)}, ${f(ZAP_LOOK_VARIANTS.cNegRim)}, zapC) * zapRim * sqrt(zapRim);
      let zapFlesh = mix(zapPos, zapNeg, gZap.y) + ${v3(ZAP_LOOK_VARIANTS.crackle)} * gZapLook.y;
      let zapBones = mix(zapDark, zapPos, gZap.y);
      lit = mix(lit, min(mix(zapFlesh, zapBones, gZap.z), vec3<f32>(${f(ZAP_LOOK_VARIANTS.cap)})), min(1.0, gZap.x * ${f(ZAP_LOOK_VARIANTS.hard)}));
    }
  }`;
