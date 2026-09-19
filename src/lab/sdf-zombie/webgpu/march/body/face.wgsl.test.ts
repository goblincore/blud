// src/lab/sdf-zombie/webgpu/march/body/face.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `face`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, FACE_MELT_SAG, FACE_MELT_STRETCH, FACE_MELT_FADE_LO } from '../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('projects the face, with relief and an emissive glow', () => {
    expect(MARCH_BODY).toContain('faceTex');
    expect(MARCH_BODY).toContain('texel');    // relief taps + the albedo tap
    expect(MARCH_BODY).toContain('flicker');  // the eye glow's guttering
    expect(MARCH_BODY).toContain('faceGlowColor');
  });

  it('uses atan2 for the spherical projection, not GLSL two-arg atan', () => {
    // WGSL keeps one-argument atan(), so the mis-port compiles fine and simply
    // returns the wrong longitude — a silent failure, hence the assertion.
    expect(MARCH_BODY).toContain('atan2(');
    expect(/[^2]\batan\s*\([^)]*,/.test(MARCH_BODY)).toBe(false);
  });

  it('does not carry the GLSL depth remap', () => {
    // WebGPU clip z is already [0,1] where OpenGL's is [-1,1]. The GLSL wrote
    // (clip.z / clip.w) * 0.5 + 0.5; carrying that over composites everything
    // at the wrong depth. Guard the clip.w DIVISION specifically, not the bare
    // `0.5 + 0.5` substring: the gore mask legitimately remaps fbm's [-1,1]
    // onto [0,1] with `* 0.5 + 0.5`, and so may any future mask.
    expect(MARCH_BODY).not.toMatch(/clip\.w/);
  });
});

describe('melt face drip (zombie melt task 8)', () => {
  // Same failure this whole plan guards against: a uniform that is declared
  // and never READ. Task 6 pinned the flesh branch; this pins the FACE block
  // — a whole-file check would pass with meltCfg read only in the torso.
  const FACE = MARCH_BODY.slice(
    MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'),
    MARCH_BODY.indexOf('// PER-PRIMITIVE COLOUR'),
  );
  it('found the face block inside MARCH_BODY', () => {
    expect(FACE.length).toBeGreaterThan(500);
  });
  it('READS meltCfg in the face block — the face drips off the skull', () => {
    expect(FACE).toContain('let meltSag = gInstMelt.x;');
    // Sag + paired stretch on the V coordinate: the offset alone slides a
    // rigid face like a sticker; the stretch is the elongation.
    expect(FACE).toContain(
      `uv.y = uv0.y + meltSag * ${FACE_MELT_SAG} - (uv0.y - faceProj.w) * meltSag * ${FACE_MELT_STRETCH};`);
  });
  it('widens the facing fade as the head flattens', () => {
    expect(FACE).toContain(
      `var facing = smoothstep(mix(0.28, ${FACE_MELT_FADE_LO}, gInstMelt.x), 0.66, dot(n, hfr));`);
  });
});
