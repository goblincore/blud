// src/lab/sdf-zombie/webgpu/march/body/light.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `light`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../march.wgsl';

describe('ported features reach the entry point', () => {

  // wmRim is the WIDE wound mask (full to 1.3x, gone by 2x): the fade must
  // cover the everted lip AND the whole cavity wall, not just the coloured
  // 1.25x core. Two regressions pin the shape: the lip clipped to a white
  // band the day the colouring mask was pulled in to 1.25x, and a 0..1.6x
  // ramp from the CENTRE left ~40% fresnel at the cavity wall, which clipped
  // to flat white slabs sweeping with the camera (both 2026-08-23).
  it('fades fresnel out inside wounds instead of wet-boosting it (X1.17)', () => {
    // Fresnel is environment rim-light; inside a cavity the "environment" is
    // the wound itself. Left at full strength it hits its ceiling on the
    // grazing-heavy rim geometry, gets the 1.6x wound-wetness boost on top,
    // and clips whole patches to white that sweep with the camera.
    expect(MARCH_BODY).toMatch(/let fres = [^;]*\* \(1\.0 - wmRim\);/);
  });
});
