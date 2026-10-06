// UPPER-BOUND CULL (cultist perf pass, 2026-09-24). The group/cluster culls
// used to compare against the running fold d, which is 1e9 while the FIRST
// cluster (the head) folds, so the head never culled: the cultist's face cost
// half his prim evaluations. The march loop now passes an upper bound on the
// fold (previous sample's fold + 3x the distance moved). Measured on the bench
// (scene C 3 cultists / CZ 3 zombies, prims heatmap): 576 -> 396 and 134 -> 88
// prim evaluations per body pixel; shaded stills of scenes A, B, C, CZ match
// the old shader (no pixel off by more than 11/255).
// These pins guard the three things that keep it correct.
import { describe, expect, it } from 'vitest';
import { FOLD_GROUP } from './fields/groups.wgsl';
import { MAP_BODY } from './map-body.wgsl';
import { MARCH_TRACE_LOOP } from './body/trace.wgsl';

describe('upper-bound cull', () => {
  it('group and cluster culls use min(d, gCullRef)', () => {
    expect(FOLD_GROUP).toContain('(min(d, gCullRef) + ');
    expect(MAP_BODY).toMatch(/length\(p - cbounds\.xyz\) - cbounds\.w > \(min\(d, gCullRef\) \+ /);
  });
  it('mapBody applies the bound only to the measured slot and split piece, never with limb accumulators, and clears it before the owner re-fold', () => {
    // A split slot's pieces are evaluated at different un-warped points (head-split.ts): the last sample's fold bounds
    // this sample's only for the SAME piece (a rigid motion keeps distances). A closed slot is piece 0 at both.
    expect(MAP_BODY).toContain('gCullRef = select(1e9, gCullUB, base + s == gCullSlot && i32(piece.z) == gCullPiece && !limbMode);');
    expect(MAP_BODY).toContain('gLastFoldPiece = pieceU;');
    const clear = MAP_BODY.indexOf('gCullRef = 1e9;');
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(MAP_BODY.indexOf('let carved = applyCarves(d, p, data, counts, band);'));
    expect(clear).toBeLessThan(MAP_BODY.indexOf('limb = foldGroup(limb'));
  });
  it('the march sets the bound for its own call only, from the last fold and the distance moved', () => {
    expect(MARCH_TRACE_LOOP).toContain('gCullUB = select(1e9, cullFold + 3.0 * abs(t - cullT) + 0.002, i > 0 && cullFold < 1e8);');
    const set = MARCH_TRACE_LOOP.indexOf('gCullUB = select(');
    const call = MARCH_TRACE_LOOP.indexOf('let dres = mapBody(');
    const reset = MARCH_TRACE_LOOP.indexOf('gCullUB = 1e9;');
    expect(set).toBeLessThan(call);
    expect(reset).toBeGreaterThan(call);
    // The winning piece rides with the slot, both ways.
    expect(MARCH_TRACE_LOOP).toContain('var cullPiece = 0;');
    const setPiece = MARCH_TRACE_LOOP.indexOf('gCullPiece = cullPiece;');
    const getPiece = MARCH_TRACE_LOOP.indexOf('cullPiece = gLastFoldPiece;');
    expect(setPiece).toBeGreaterThan(-1);
    expect(setPiece).toBeLessThan(call);
    expect(getPiece).toBeGreaterThan(call);
  });
});
