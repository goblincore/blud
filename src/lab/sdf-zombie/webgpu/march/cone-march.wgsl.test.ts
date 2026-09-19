// src/lab/sdf-zombie/webgpu/march/cone-march.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `cone-march`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { CONE_MARCH } from '../march.wgsl';

describe('ported features reach the entry point', () => {

  it('stops the cone one shell amp early (X1.21.2 pale tile wedges)', () => {
    // The cone certifies emptiness against the SMOOTH field; a displaced
    // BUMP stands up to ~0.9 amp proud of it and can sit inside the distance
    // the tile proved empty. A march started there skips the crest and shades
    // at the wrong depth — the hard-edged pale patches, per 8x8 tile. The
    // stop threshold must carry the amp; at amp 0 it is the old bound again.
    expect(CONE_MARCH).toContain('if (d < r + 0.0012 + woundCfg2.z) { return t; }');
  });
});
