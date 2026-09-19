// src/lab/sdf-zombie/webgpu/march/body/blocks/post/melt.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `melt`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, soldierFaceDamageShadow } from '../../../../march.wgsl';

describe('melt wet-red ramp (zombie melt task 6)', () => {
  // c52b05b declared meltCfg and never READ it: green tests, zero pixels.
  // These assert the uniform is declared, bound and CONSUMED in the flesh
  // shading branch — and that the consumption is gated flesh-vs-bone, since
  // pale matte bone against wet red flesh is the whole look.
  it('reads melt state from the per-instance record', () => {
    // crowd stage a: meltCfg left the signature and rides the record.
    expect(MARCH_BODY).not.toContain('meltCfg: vec4<f32>,');
    expect(MARCH_BODY).toContain('gInstMelt');
  });
  it('READS meltCfg in the flesh shading branch — colour leads the sag', () => {
    // smoothstep(clamp(meltCfg.x * 2)) — the ramp completes by half progress,
    // so the body is clearly red while still standing, before it shortens.
    expect(MARCH_BODY).toContain(
      'let meltU = smoothstep(0.0, 1.0, clamp(gInstMelt.x * 2.0, 0.0, 1.0));');
    // Flesh reddens; bone goes PALE instead — the contrast is the effect.
    // `bonePaleU` is max(bareBoneU, meltU): a rupture's exposed skeleton goes
    // pale with NO melt ramp (see the body-to-gib rupture branch below).
    expect(MARCH_BODY).toContain('albedo = mix(albedo, boneColor, bonePaleU * 0.9)');
    // Flesh mixes toward the deep red — but through the PER-PATCH `local`,
    // not meltU directly. Skin sloughs in pieces (owner review 2026-09-03):
    // each point crosses at its own progress off the rest-space anchor, and
    // patches scaled past 1.0 by MELT_SKIN_KEEP never cross at all, so pink
    // survives on the finished puddle. Pinning the intent — reddening driven
    // by a patch threshold that reads meltU — rather than the exact spelling,
    // which is a tuning surface.
    expect(MARCH_BODY).toContain('albedo = mix(albedo, deepColor * 0.8, local * 0.8)');
    expect(MARCH_BODY).toContain('let thresh = skinPatch * ');
    expect(MARCH_BODY).toMatch(/let local = smoothstep\(thresh - [\d.]+, thresh \+ [\d.]+, meltU\)/);
    // `patch` is a RESERVED WORD in WGSL: naming it that compiles in TS and
    // fails the shader at runtime, rendering the body invisible. Guard it.
    expect(MARCH_BODY).not.toMatch(/\blet patch\b/);
    // Wetness ramps on flesh ONLY — bone stays matte. `bonePaleU` is
    // max(bareBoneU, meltU), so a rupturing body's exposed bones go matte too.
    expect(MARCH_BODY).toContain('wet = mix(wet, select(1.6, 0.45, isBone), bonePaleU)');
  });
  it('identifies an exposed bone row — the wound gate alone cannot see one', () => {
    // The melt's skeleton emerges with NO wound (bareBones bypass) and so does
    // a rupturing body's, so the primScale.w material read must also run when
    // meltCfg.x > 0 OR bareBones is set.
    expect(MARCH_BODY).toContain('if ((wm > 0.0 || gInstMelt.x > 0.0 || gInstCounts2.y > 0.5) && hitBest >= 0)');
    expect(MARCH_BODY).toContain('let isBone = hitMat > 3.5 && hitMat < 4.5;');
  });

  it('lets Soldier wounds override the pale Replace decal and stains torso wounds', () => {
    expect(MARCH_BODY).toContain('faceGlowRedOnly * smoothstep(0.02, 0.25, wm)');
    expect(MARCH_BODY).toContain('(1.0 - faceGlow) * woundDecalFade');
    expect(MARCH_BODY).toContain('let soldierWound = faceGlowRedOnly * smoothstep(0.02, 0.62, wm)');
    expect(MARCH_BODY).toContain('soldierWound * 0.72');
    expect(MARCH_BODY).toContain('let woundWetBoost = mix(1.6, 2.15, faceGlowRedOnly)');
    expect(MARCH_BODY).toContain('detailAmp * mix(1.0, 1.45, soldierPit)');
  });

  it('keeps only dark face detail over Soldier wounds',()=>{
    expect(soldierFaceDamageShadow(.1,.5,1,1)).toBeGreaterThan(.6);
    expect(soldierFaceDamageShadow(.5,.5,1,1)).toBe(0);
    expect(soldierFaceDamageShadow(.1,.5,1,0)).toBe(0);
    expect(soldierFaceDamageShadow(.1,.5,0,1)).toBe(0);
    expect(MARCH_BODY).toContain('albedo = albedo * (1.0 - faceShadow * damagedFace * 0.78)');
  });
});
