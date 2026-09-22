// src/lab/sdf-zombie/webgpu/march/fields/carves.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `carves`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, ROW_WOUND_CAP } from '../../march.wgsl';
import type { Vec3 } from '../../../types';
import { declaredName } from '../../march-test-support';

describe('ported features reach the entry point', () => {

  it('caps the carve with a depth slab that vanishes when no cap is uploaded', () => {
    // The pale-wound fix (2026-08-27): the sphere stays ON the anchor (the
    // lab's deep-bowl look, whose cavity reads red) and a plane through the
    // anchor clips its REACH — depth without the far-side punch-through.
    const applyWounds = HELPERS.find(h => declaredName(h) === 'applyWounds')!;
    // The carve region is {inside sphere} ∩ {shallower than the cap}; its
    // inside-positive SDF is min(depth - r, capEff - dot). The hull-holes
    // regression (2026-08-27, same day) shipped `max(-(r - depth), dot -
    // capEff)`: the dot term is positive BEYOND the cap, so the max() carved
    // the entire half-space behind the cap plane — mixed-direction wounds
    // hollowed whole bodies (the owner's invisible-zombie report). Do not
    // revert to that form.
    expect(applyWounds).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP} + band), 0)`);
    expect(applyWounds).toContain('min(-(rN - depth) * carveK, capEff - dot(p - w.xyz, wCap.xyz))');
    // Uncapped wounds (w <= 0) must take a capEff no real distance can
    // cross, so the slab term loses the min EXACTLY and the field is
    // bit-identical to the pre-slab sphere — that is what keeps the lab
    // (which uploads no caps) pixel-stable across this change.
    expect(applyWounds).toContain('select(1.0e5, wCap.w, wCap.w > 0.0)');
  });

  // Line-for-line TS transcription of the fixed carve term (the inside-positive
  // SDF of {inside sphere} ∩ {shallower than cap}), so the semantics of the
  // pinned string are proven, not just its spelling. The REGRESSION this
  // guards: any form that stays positive beyond the cap plane hollows the
  // whole body behind every wound — one wound looks perfect from the front,
  // mixed-direction wounds make the body invisible (exactly the 2026-08-27
  // hull-holes report; a string pin alone passed on the broken shader).
  function carveTerm(p: Vec3, anchor: Vec3, inward: Vec3, radius: number, cap: number): number {
    const r = Math.hypot(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]);
    const dotSlab = (p[0] - anchor[0]) * inward[0] + (p[1] - anchor[1]) * inward[1] + (p[2] - anchor[2]) * inward[2];
    const capEff = cap > 0 ? cap : 1.0e5;
    return Math.min(radius - r, capEff - dotSlab);
  }
  const ORIGIN: Vec3 = [0, 0, 0];
  const INWARD_X: Vec3 = [1, 0, 0];

  it('carve slab: bounded bowl, not a half-space (the invisible-zombie regression)', () => {
    const R = 0.16, CAP = 0.45 * 0.3; // a slug on ~30 cm of flesh
    // 1. Inside the sphere, shallower than the cap: carve (positive).
    expect(carveTerm([0.05, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeGreaterThan(0);
    // 2. Inside the sphere BUT deeper than the cap: FLESH REMAINS (negative).
    //    The broken max(..., dot - capEff) form returned a positive value
    //    here — and kept it positive clear across the body.
    expect(carveTerm([R - 0.01, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
    // 3. Deep inside the body, far past the sphere: still flesh. The broken
    //    form carved this entire half-space out to infinity.
    expect(carveTerm([0.9, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
    // 4. Outside the sphere on the air side (r > sphere): no carve.
    expect(carveTerm([-0.2, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
    // 5. The bowl's FLOOR is the slab, not the sphere's far wall: a point
    //    just inside the cap carves, just past it does not (both still
    //    inside the sphere).
    expect(carveTerm([CAP - 0.01, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeGreaterThan(0);
    expect(carveTerm([CAP + 0.02, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
  });

  it('carve slab: uncapped wounds reduce to the plain sphere bit-exactly', () => {
    // The lab uploads no caps; capEff must lose the min EXACTLY so the lab's
    // field is bit-identical to the pre-slab reference (pixel-parity gate).
    for (const p of [[0.05, 0, 0], [0.3, 0.1, -0.2], [-0.5, 2, 7]] as Vec3[]) {
      const r = Math.hypot(p[0], p[1], p[2]);
      expect(carveTerm(p as Vec3, ORIGIN, INWARD_X, 0.16, 0)).toBe(0.16 - r);
    }
  });

  it('skips dead prims (w=2) in the carve pass too, not just the fold', () => {
    // primScale.w: 0 add, 1 carve, 2 dead (severed mid-limb), 3 groove. The
    // additive fold skips anything above 0.5; a dead prim must ALSO stop
    // carving, or a severed hand keeps biting the field it left behind.
    //
    // The bound used to be a single `S.w > 1.5`, which was enough while dead
    // was the largest value. Adding groove at 3 put a LIVE op on the far side
    // of dead, so the pass now selects the two subtractive values explicitly
    // rather than taking everything past a threshold — 2 sits between them and
    // must fall through both.
    const applyCarves = HELPERS.find(h => declaredName(h) === 'applyCarves')!;
    expect(applyCarves).toContain('let isCarve = S.w > 0.5 && S.w < 1.5;');
    expect(applyCarves).toContain('let isGroove = S.w > 2.5 && S.w < 3.5;');
    expect(applyCarves).toContain('if (!isCarve && !isGroove) { continue; }');
  });
});
