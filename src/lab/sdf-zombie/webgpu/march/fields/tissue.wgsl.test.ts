// src/lab/sdf-zombie/webgpu/march/fields/tissue.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `tissue`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, WOUND_MASK, ROW_WOUND_FLAGS, TISSUE_RAMP } from '../../march.wgsl';

describe('tissue ramp (wound pass r2)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  it('composes INSIDE the radial mask so it cannot edge on healthy skin', () => {
    // The whole halo-safety argument: at wm = 0 the ramp must be unable to
    // change the albedo. That means exactly one mix against wm, with the ramp
    // supplying its second argument — never a separate mask of its own.
    expect(MARCH_BODY).toContain('mix(baseColor, tissue, wm)');
  });

  it('does not introduce a second wound mask', () => {
    const masks = MARCH_BODY.match(/woundMask\(/g) ?? [];
    expect(masks).toHaveLength(1);
  });

  it('is amplitude-guarded so 0 shades as before', () => {
    expect(MARCH_BODY).toMatch(/woundDepthAmp/);
    expect(MARCH_BODY).toMatch(/surfCfg3\.x > 0\.0/);
  });
});

describe('viscera ramp (entrails)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  const SHADE_BODY = MARCH_BODY;

  it('woundMask reports cavity-ness as a third channel', () => {
    expect(WOUND_MASK).toContain('vec3<f32>');
    expect(WOUND_MASK).toContain(`${ROW_WOUND_FLAGS}`);
  });

  it('the viscera stop is gated on cavity-ness, not on depth alone', () => {
    expect(TISSUE_RAMP).toContain('cavity');
  });

  it('is amplitude-guarded', () => {
    expect(SHADE_BODY).toContain('visceraAmp');
  });

  it('does not pay for the viscera fbm outside a cavity wound', () => {
    // Guarding the RESULT is not guarding the COST.
    expect(SHADE_BODY).toMatch(/surfCfg3\.w > 0\.0 && wmCav > 0\.0[\s\S]{0,120}fbm\(anchor/);
  });

  it('still composes inside the single radial mask', () => {
    // The 2026-08-23 halo came from splitting one mask into three. Viscera
    // must ride the SAME mask — one woundMask call, one mix against wm.
    expect(SHADE_BODY).toContain('mix(baseColor, tissue, wm)');
    expect((SHADE_BODY.match(/woundMask\(/g) ?? []).length).toBe(1);
  });
});
