// src/lab/sdf-zombie/webgpu/march/body/blocks/post/gore.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `gore`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, INSTANCE_STATE, HEAD_EXTERIOR_GORE_KEEP } from '../../../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('shades chunks through the gore mask (gobs-and-goo §2)', () => {
    // lodCfg.w is goreStrength: 0 on the body, 1 on chunk views. The body's
    // clean-latex read must stay reachable, and the gore block's own fbm is
    // what makes a chunk read as mottled torn meat rather than a red ball.
    // Anchored to the noise shift (motion-polish) so the mottle rides the
    // chunk's own translation, not the world.
    expect(MARCH_BODY).toContain('goreStrength');
    expect(MARCH_BODY).toContain('fbm(anchor * 6.0)');
    // TASK 3: the gate is per-instance OR per-view, so a doomed body in a
    // crowd can ramp its own gore without repainting the shared-material type.
    // TASK 2 (2026-09-16 follow-ups): the mask is attenuated by face coverage,
    // and the pass now runs AFTER the face layer, so a detached head keeps its
    // painted face instead of being mottled into a meat blob.
    expect(MARCH_BODY).toContain('let goreStrength = max(lodCfg.w, gInstGore) * (1.0 - faceCover);');
    expect(MARCH_BODY).toContain('faceCover = faceCover * tex.a;');
    // The head's non-face exterior keeps a bounded share of the gore, so the
    // head is not a meat blob from the back either, while the neck cut still
    // tears. The constant is shared with the CPU bake.
    expect(MARCH_BODY).toContain(`faceRegion * ${HEAD_EXTERIOR_GORE_KEEP}`);
    expect(MARCH_BODY).toContain('let faceRegion = 1.0 - smoothstep(1.30 * reach, 1.70 * reach, length(hs));');
    expect(MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'))
      .toBeLessThan(MARCH_BODY.indexOf('let goreStrength = max(lodCfg.w, gInstGore) * (1.0 - faceCover);'));
    expect(INSTANCE_STATE).toContain('gInstGore = (*inst)[base + ');
  });
});
