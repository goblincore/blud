// src/lab/sdf-zombie/webgpu/march/body/blocks/post/burn.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `burn`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, INSTANCE_STATE, MARCH_BODY_PARAMS } from '../../../../march.wgsl';
import { MARCH_TREE_SRC } from '../../../../march-test-support';

describe('ported features reach the entry point', () => {

  it('loads the per-instance burn ramp and declares the emissive carrier', () => {
    // Mirrors the gInstGore contract: the record's ramp is combined with the
    // per-view uniform by max(), so single-body draws (burnCfg) and crowd draws
    // (REC_BURN) both work with one shader. The two private vars are asserted
    // against the MODULE SOURCE, because which exported chunk holds a
    // declaration is an implementation detail -- that it exists exactly once is
    // not.
    expect(INSTANCE_STATE).toContain('gInstBurn = (*inst)[base + ');
    const moduleSrc = MARCH_TREE_SRC;
    expect(moduleSrc.split('var<private> gInstBurn: vec4<f32>').length).toBe(2);
    expect(moduleSrc.split('var<private> gBurnEmit: vec3<f32>').length).toBe(2);
    const params = MARCH_BODY_PARAMS.replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(params).toContain('burnCfg: vec4<f32>,');
    expect(params).toMatch(/burnFireGain: f32, burnFireCoverage: f32, burnSkeleton: f32, burnSkeletonDepth: f32\s*\)/);
  });

  it('paints fire and char on a burning body from the rest-space anchor', () => {
    // Rest space, not world space: the fire must ride the body, or it swims
    // through the skin as the body walks (the same reason the gore mottle uses
    // `anchor`). The char mix must come AFTER the wound char mix so a burnt
    // body reads burnt, and the fire must be emissive, not albedo.
    expect(MARCH_TREE_SRC)
      .toContain('fn fireRamp(t: f32) -> vec3<f32> {');
    expect(MARCH_BODY).toContain('let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);');
    expect(MARCH_BODY).toContain('fbm(anchor * burnNoiseScale');
    expect(MARCH_BODY.indexOf('albedo = mix(albedo, charColor, cm);'))
      .toBeLessThan(MARCH_BODY.indexOf('let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);'));
    expect(MARCH_BODY).toContain('gBurnEmit = fireRamp(fire)');
    // The soot mix sits INSIDE the gate, but the gate opens on char too
    // (fix pass): char is monotonic, so a body put out mid-burn stays charred
    // (a burnt corpse, not a clean body). The mix is an exact identity at
    // sootMask 0, so non-burning bodies are unchanged; only fire, the glow
    // kills and the emissive fold gate on live flame.
    {
      const gate = MARCH_BODY.indexOf('if (burnAmt > 0.0 || charAmt > 0.0)');
      const burnCharMix = MARCH_BODY.indexOf('albedo = mix(albedo, charColor, sootMask);');
      expect(gate).toBeGreaterThan(-1);
      expect(burnCharMix).toBeGreaterThan(-1);
      expect(burnCharMix).toBeGreaterThan(gate);
    }
    // The emissive fold: burning fire adds light, and a burning face is fire.
    expect(MARCH_BODY).toContain('+ glow + gBurnEmit');
    expect(MARCH_BODY).toContain('faceGlow = faceGlow * (1.0 - burnAmt);');
  });

  it('drives char from the same noise as the fire, not from time alone', () => {
    // The reference sprites show dark char BETWEEN the flames from the first
    // frame. Char that only comes from charAmt makes a freshly lit body a
    // uniformly glowing statue, which is what the first captures showed.
    expect(MARCH_BODY).toContain('let fireN = fbm(');
    expect(MARCH_BODY).toContain('let coverBias = mix(0.85, -0.15, burnFireCoverage);');
    expect(MARCH_BODY).toContain('let fire = clamp(fireN - coverBias, 0.0, 1.0)');
    // Dark where the noise is LOW, deepened by time-based char.
    expect(MARCH_BODY).toContain('let sootMask = clamp((1.0 - fire) * burnCharPatch + charAmt, 0.0, 1.0);');
    expect(MARCH_BODY).toContain('albedo = mix(albedo, charColor, sootMask);');
    // A charred body must stop looking like wet latex.
    expect(MARCH_BODY).toContain('gloss = gloss * (1.0 - sootMask');
  });

  it('shows bone through charring flesh, gated on burn', () => {
    // Bones sit >= 4 mm inside the flesh and are hidden by flesh depth alone
    // (validate.ts's checkBoneContainment enforces that), so the only way to
    // see them is to probe the bone field at the shading point. Gated, so a
    // body that is not burning pays nothing.
    expect(MARCH_BODY).toContain('let boneProbe = applyBones(1e9');
    expect(MARCH_BODY).toContain('burnSkeleton');
    // Builds with char, per the owner's decision: opaque when freshly lit.
    expect(MARCH_BODY).toContain('charAmt * burnSkeleton');
  });

  it('shades the bone probe as bone, not as a pale tint of flesh', () => {
    // The probe already finds bone; the look failed because the result was
    // mixed into albedo as a flat colour, so it read as pale skin rather than
    // as a hard, shaped surface under the flesh.
    expect(MARCH_BODY).toContain('boneProbe');
    expect(MARCH_BODY).toContain('boneShade');
    expect(MARCH_BODY).toContain('gloss = mix(gloss');
  });

  it('shades revealed bone as ivory with soot streaks, gated to burnt-through patches', () => {
    // The bone-fix pass made revealed bone dark/scorched so a fully charred
    // body stayed black -- which also killed the skeleton read. The reveal is
    // now gated to char > 0.55 and soot-high patches, so an ivory bone can
    // read again without paling a whole limb.
    expect(MARCH_BODY).toContain('let charGate = smoothstep(0.55, 0.62, charAmt);');
    expect(MARCH_BODY).toContain('let sootGate = smoothstep(0.35, 0.8, sootMask);');
    expect(MARCH_BODY).toContain('let revealGate = charGate * sootGate;');
    // Ivory, soot streaks from the same fbm that drives the char pattern, and
    // a cavity term that darkens toward the gap between bone and flesh.
    expect(MARCH_BODY).toContain('let boneIvory = vec3<f32>(0.72, 0.66, 0.55);');
    expect(MARCH_BODY).toContain('let sootNoise = clamp(0.5 - 0.5 * fireN, 0.0, 1.0);');
    expect(MARCH_BODY).toContain('let sootStreak = mix(1.0, 0.25, sootNoise);');
    expect(MARCH_BODY).toContain('let cavity = mix(0.12, 1.0, nearBone);');
    expect(MARCH_BODY).toContain('let boneShade = boneIvory * sootStreak * cavity;');
    // CAP THE REVEAL at skelK (charAmt * skeletonShow), now also trimmed by
    // revealGate, so no fragment can ever become fully bone.
    expect(MARCH_BODY).toContain('boneMat = clamp(nearBone * 2.2, 0.0, 1.0) * skelK * revealGate;');
    // Low non-zero gloss, no metal: enough for the rounded tube to read.
    expect(MARCH_BODY).toContain('gloss = mix(gloss, 0.25, boneMat);');
    expect(MARCH_BODY).toContain('metal = mix(metal, 0.0, boneMat);');
    // Nothing emissive: revealed bone must not pick up the fire emission, or
    // the cold death corpse reads as glowing bone.
    expect(MARCH_BODY).toContain('gBurnEmit = fireRamp(fire) * fire * burnFireGain * (1.0 - boneMat);');
  });
});
