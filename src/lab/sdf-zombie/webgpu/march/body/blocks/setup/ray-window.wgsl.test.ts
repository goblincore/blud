// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/ray-window.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `ray-window`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../../../march.wgsl';

describe('ported features reach the entry point', () => {

  it('discards on the accumulated-depth gate before marching and bounds tMax by it', () => {
    expect(MARCH_BODY).toContain('prevT: f32');
    expect(MARCH_BODY.indexOf('perfCfg: vec4<f32>')).toBeLessThan(MARCH_BODY.indexOf('prevT: f32'));
    // The per-body conservative entry rides LAST (positional): centre from the
    // mesh's model matrix, half extents from the bodyHalf uniform. Task 5
    // added the crowd proxy-box overrides: instCfg.y 0 selects the record's
    // gInstCentre/gInstHalf bit-identically, y 1 selects the attributes.
    expect(MARCH_BODY).toContain('let boxCentre = select(gInstCentre, instCentre, instCfg.y > 0.5);');
    expect(MARCH_BODY).toContain('let boxHalf = select(gInstHalf, instHalf, instCfg.y > 0.5);');
    expect(MARCH_BODY).toContain('let bLo = (boxCentre - boxHalf - camPos) * invRd;');
    expect(MARCH_BODY.indexOf('prevT: f32')).toBeLessThan(MARCH_BODY.indexOf('inst: ptr<storage, array<vec4<f32>>, read>'));
    // max(shellIn, bodyEntry): BOTH are lower bounds on the first point at
    // which THIS body could be hit (shellIn the shared hull entry, weaker;
    // bodyEntry the per-body proxy-box entry) — the larger lower bound is
    // still a lower bound, so the discard stays exact while actually biting
    // wherever the fragment lies behind an already-accumulated hit. min()
    // was inert: min <= shellIn <= prevT almost everywhere (task 5 finding).
    expect(MARCH_BODY).toContain('if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
    // Stage a-2 renamed the raw ray-box entry to boxEntry so the quad mode can
    // select against gTileEntryT; the box algebra itself is unchanged.
    expect(MARCH_BODY).toContain('let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));');
    expect(MARCH_BODY).toContain('let tMax = min(tMaxSel, prevT);');
    // The 5 cm graze slack from 48f00de2 was REMOVED (adversarial review: a
    // behaviour change riding a debug commit, superseded by the graze
    // accept in 426118e8). The removal is pinned so it cannot creep back.
    expect(MARCH_BODY).not.toContain('+ select(0.0, 0.05, temporalCfg.x > 0.5)');
  });
});
