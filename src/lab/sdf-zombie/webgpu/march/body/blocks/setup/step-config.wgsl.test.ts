// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/step-config.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `step-config`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, MAP_BODY, FOLD_GROUP } from '../../../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('tracks the dominant group distortion in a private global and divides the footprint epsilon by it', () => {
    // Perf round 2, task 6. The footprint AA epsilon (t * aaK) assumed the
    // field reports true Euclid distance; sdPrimitive under-reports it by the
    // group's distortion factor (up to 22x — schoolgirl sole plate), so the
    // epsilon could fire many times too early and stop a ray short. The fold
    // already carries the factor per group (grp.z); it rides a PRIVATE GLOBAL
    // beside the argmin because mapBody's .w return slot is owned by the
    // wound-pass-r2 chain — never repurpose that slot for this.
    expect(FOLD_GROUP).toContain('var<private> gFoldBestDistort: f32 = 1.0;');
    expect(FOLD_GROUP).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }');
    expect(MAP_BODY).toContain('gFoldBestDistort = 1.0;');
    expect(MAP_BODY).not.toContain('nearWound, gFoldBestDistort');
    expect(MARCH_BODY).toContain('let distort = max(gFoldBestDistort, 1.0);');
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaKt / distort);');
  });
});
