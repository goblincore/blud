// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/start-bounds.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `start-bounds`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, DEPTH_PREPASS_MARCH, DEPTH_PRE_FETCH, WOUND_STEP_MUL } from '../../../../march.wgsl';
import { declaredName } from '../../../../march-test-support';

describe('ported features reach the entry point', () => {

  it('quarter-res depth prepass — proof-shaped coarse march, inert when off', () => {
    // The coarse march's cone radius is the BLOCK footprint (blockK), not a
    // texel half-width — that is the whole correctness proof. Any full-res
    // ray in the block lies within blockK * t of the coarse ray, so the first
    // touch is a lower bound on every block ray's own first surface.
    expect(DEPTH_PREPASS_MARCH).toContain('let r = t * depthPreCfg.y;');
    // The step keeps the WHOLE cone outside the surface (d - r, cone rule).
    expect(DEPTH_PREPASS_MARCH).toContain('t = t + max(d - r, 0.0005) * stepMul;');
    // The touch test carries the same slack CONE_MARCH's does — the 1.2 mm
    // eps floor and the shell displacement amp — so a bump standing proud of
    // the smooth field can never sit nearer the camera than what the coarse
    // pass certified as empty.
    expect(DEPTH_PREPASS_MARCH).toContain('if (d < r + 0.0012 + woundCfg2.z) { return t; }');
    // A miss contributes NOTHING: -1, which the consumer reads as <= 0 → no
    // start. coneMarch's tMax convention would hand the full march a fake
    // "start at the proxy box's far side".
    expect(DEPTH_PREPASS_MARCH).toContain('return -1.0;');
    // The coarse walk marches the FULL cluster field (no tile binning) —
    // conservative relative to any tile-listed sub-field the full march
    // might run, because culling a prim from a min-fold can only raise it.
    expect(DEPTH_PREPASS_MARCH).toContain('let dres = mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2,');
    // Same near-wound multiplier as the full march (WOUND_STEP_MUL via the
    // perfCfg.z override) — the coarse walk shares the field's unsoundness
    // near craters and must not step looser than the walk it feeds. The
    // exported string is INTERPOLATED, so pin the constant's value in it.
    expect(DEPTH_PREPASS_MARCH).toContain(`let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);`);
    expect(DEPTH_PREPASS_MARCH).toContain('let stepMul = select(marchCfg.y, woundMul, nearWound);');
    // The fetch: disabled or non-positive → 0 (the identity in the max()).
    expect(DEPTH_PRE_FETCH).toContain('if (cfg.x < 0.5) { return 0.0; }');
    expect(DEPTH_PRE_FETCH).toContain('if (v <= 0.0) { return 0.0; }');
    // Grid from textureDimensions — never a captured value (the adaptive
    // controller resizes the layer under this fetch at runtime).
    expect(DEPTH_PRE_FETCH).toContain('textureDimensions(tex, 0)');
    // The fetch helper is wired into the HELPERS chain (buildMarchFn emits
    // the whole chain ahead of the MARCH_BODY entry, so membership is the
    // ordering guarantee).
    const names = HELPERS.map(declaredName);
    expect(names).toContain('depthPreFetch');
    expect(names.indexOf('depthPreFetch')).toBe(names.length - 1);
  });
});
