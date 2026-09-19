// src/lab/sdf-zombie/webgpu/march/body/blocks/post/organ.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `organ`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, ROW_PRIM_SCALE } from '../../../../march.wgsl';

describe('bone material (wound pass r2)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  const SHADE_BODY = MARCH_BODY;

  it('has no torn-fibre pass at all', () => {
    // Cut on the owner's playtest verdict (2026-09-02): swept to the slider's
    // ceiling it was "not really noticeable". Asserted as ABSENCE rather than
    // removed as a test, so nobody quietly reintroduces a per-pixel fbm that
    // was already judged invisible — if it comes back it needs a new verdict.
    expect(SHADE_BODY).not.toContain('woundFibre');
  });

  it('no longer stains bone toward deepColor — the branch is GONE (bone tubes)', () => {
    // Bone tubes (2026-09-02 plan task 3): op 'bone' prims leave the marched
    // field for instanced analytic tubes, so the bone albedo branch was
    // deleted, not orphaned. Asserted as ABSENCE so it cannot quietly return.
    expect(SHADE_BODY).not.toContain('boneStain');
  });

  it('identifies bone by material code for the melt ramp AND a rupture', () => {
    // Bone tubes deleted the old always-on bone albedo branch, and it stays
    // deleted: bone is identified again, but its only consumers are the melt's
    // pale-vs-wet-red split (zombie melt task 6) and the body-to-gib rupture's
    // exposed skeleton. Both need the material read because the bone wins the
    // fold with no wound to key on.
    expect(SHADE_BODY).toContain('let isBone = hitMat > 3.5 && hitMat < 4.5;');
    expect(SHADE_BODY).toContain('if ((wm > 0.0 || gInstMelt.x > 0.0 || gInstCounts2.y > 0.5) && hitBest >= 0)');
    // Bone paleness is gated on bonePaleU = max(bareBoneU, meltU); the FLESH
    // reddening stays meltU-only, so a bare-bone rupture never stains skin and
    // never sags a face — the melt geometry is a separate ramp.
    expect(SHADE_BODY).toContain('let bonePaleU = max(bareBoneU, meltU);');
    expect(SHADE_BODY).toContain('if (isBone && bonePaleU > 0.0) {');
    expect(SHADE_BODY).toContain('} else if (meltU > 0.0) {');
    // The flesh branch must sit BELOW the bone branch, so nothing can redden
    // exposed bone.
    const pale = SHADE_BODY.indexOf('if (isBone && bonePaleU > 0.0) {');
    const flesh = SHADE_BODY.indexOf('} else if (meltU > 0.0) {');
    expect(pale).toBeGreaterThan(-1);
    expect(flesh).toBeGreaterThan(pale);
  });
});

describe('organ shading (organs r3)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  const SHADE_BODY = MARCH_BODY;

  it('reads the organ code from the SAME hitMat load as bone', () => {
    // One HITMAT texel load serves both; a second load would undo refinement
    // 5. Pinned against the hitMat row itself (ROW_PRIM_SCALE), not against
    // "any hitBest read ending in .w": glow= legitimately reads ROW_PRIM_CLIP.w
    // at the same pixel (hard-surface task 3), which is a different row and a
    // different lane, not a duplicated hitMat.
    expect((SHADE_BODY.match(new RegExp(`textureLoad\\(data, vec2<i32>\\(hitBest, ${ROW_PRIM_SCALE} \\+ gBand\\), 0\\)\\.w`, 'g')) ?? []))
      .toHaveLength(1);
    expect(SHADE_BODY).toContain('isOrgan');
  });
  it('is amplitude-guarded by organAmp', () => {
    expect(SHADE_BODY).toContain('organAmp');
  });

  it('at organAmp 0 the organ branch is a bit-exact identity (task 6 gate 1)', () => {
    // organAmp must be the mix WEIGHT itself, not folded into a comparison —
    // WGSL mix(x, y, 0) returns x exactly, so amp 0 shades organ prims as
    // plain bone bit-for-bit and the off-state is one knob. A branch on
    // organAmp, or amp scaled into the colour instead of the weight, would
    // break that. The one-albedo-load rule above makes the identity exact:
    // same albedo, same lighting, only the weight differs.
    expect(SHADE_BODY).toMatch(/albedo\s*=\s*mix\(albedo,\s*organColor,\s*organAmp\)/);
  });
});
