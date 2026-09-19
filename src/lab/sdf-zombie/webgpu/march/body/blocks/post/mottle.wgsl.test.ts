// src/lab/sdf-zombie/webgpu/march/body/blocks/post/mottle.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `mottle`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('mottles ALBEDO from the rest-space anchor, guarded by its amplitude', () => {
    // surfaceNoiseAmp perturbs the NORMAL, which reads as texture and never as
    // colour, so before this every body was one flat tone under the lab's
    // single broad key. The albedo twin has three properties worth pinning:
    //
    // 1. It samples `anchor`, not `p` — a world-space mottle looks right on a
    //    statue and swims across the surface the moment anything walks. Same
    //    rule the micro-detail and gore mottle already follow.
    expect(MARCH_BODY).toContain('fbm(anchor * surfCfg2.w)');
    expect(MARCH_BODY).not.toContain('fbm(p * surfCfg2.w)');
    // 2. smoothstep, not a linear remap of the nominal -1..1. Two octaves of
    //    value noise concentrate near zero, so `0.5 + 0.5*fbm` lands nearly
    //    every pixel at 0.5 — a uniform half-strength tint rather than
    //    mottling, which is exactly what the first version did on screen.
    expect(MARCH_BODY).toContain('smoothstep(-0.35, 0.35, fbm(anchor * surfCfg2.w))');
    // 3. Amplitude-guarded like every other quality lever here, so the stock
    //    presets (all mottleAmp 0) skip the fbm entirely and shade exactly as
    //    they did before this existed.
    expect(MARCH_BODY).toContain('if (surfCfg2.z > 0.0) {');
    // Before the FACE pass (mottle is the flesh's own colour, so the face
    // paints over it) and therefore before the gore pass, which task 2 moved
    // AFTER the face layer so it can be attenuated by the face's own coverage.
    const mottleIdx = MARCH_BODY.indexOf('mix(albedo, mottleColor');
    const faceIdx = MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {');
    const goreIdx = MARCH_BODY.indexOf('let goreStrength = max(lodCfg.w, gInstGore)');
    expect(mottleIdx).toBeGreaterThanOrEqual(0);
    expect(mottleIdx).toBeLessThan(faceIdx);
    expect(faceIdx).toBeLessThan(goreIdx);
  });
});
