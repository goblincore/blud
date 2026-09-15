// src/lab/sdf-zombie/mesher-comparison/dc-chamfer.test.ts
//
// Focused gates for the 2026-09-15 DC chamfer follow-up. They are behavioural:
// they assert the FIELD ground truth (not a mesher's silhouette), that the
// slice reference is bracketed, that the selected candidate measurably reduces
// the groove-pit error versus the explicit baseline, that the sharp-box win is
// untouched, that the clamp is diagnostic and protective, and that invalid
// inputs are rejected. No output-string copies.

import { beforeAll, describe, expect, it } from 'vitest';

import { chamferGrooveControl, controlSharpBox, prim, bodyOf } from './fixtures';
import { sdBody } from '../validate';
import { marchingCubes } from './marching-cubes';
import { dualContouring } from './dual-contouring';
import { gridFor } from './runner';
import { DC_BASELINE, DC_CANDIDATE, DC_VARIANTS, dcOptionsFor, dcVariantById } from './dc-variants';
import {
  CHAMFER_REGIONS, buildRegionReferences, evaluateVariant, renderSlice, type SliceRegionResult,
} from './dc-chamfer';
import { fieldContour, meshSliceSegments, sliceSymDistance, type SlicePlane } from './field-slice';
import { analyzeMesh } from './analysis';
import type { ScalarField } from './types';
import type { Vec3 } from '../types';

const T = { timesMs: [], medianMs: 0, minMs: 0, maxMs: 0 };

function analyticDisc(p: Vec3): number {
  return Math.hypot(p[0], p[1]) - 0.2;
}

/** A field with an sdGroove-like band discontinuity along a vertical line. */
function discontinuousField(p: Vec3): number {
  // Inside a disc, but outside a 4 mm band around x=0: a hard step at |x|=0.002.
  const disc = Math.hypot(p[0], p[1]) - 0.2;
  if (Math.abs(p[0]) < 0.002) return Math.max(disc, 0.01);
  return disc;
}

const fieldOf = (f: (p: Vec3) => number): ScalarField => ({
  id: 'test-disc', units: 'meters', field: f,
  bounds: { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.3] },
  analyticDistance: false, meta: {},
});

/** Reconstruct the fixture body with and without the groove cutter. */
function grooveBodies(): { withGroove: ReturnType<typeof bodyOf>; without: ReturnType<typeof bodyOf> } {
  const lobeA = prim([-0.04, 0, 0], [-0.04, 0, 0], 0.085, { blendK: 0.02 });
  const lobeB = prim([0.055, 0.01, 0], [0.055, 0.01, 0], 0.075, { blendK: 0.03, blendProfile: 'chamfer', box: { round: 0.08 } });
  const cutter = prim([0, 0.02, -0.14], [0, 0.02, 0.14], 0.018, { op: 'groove', grooveDepth: 0.014, grooveWidth: 0.011 });
  return { withGroove: bodyOf([lobeA, lobeB, cutter]), without: bodyOf([lobeA, lobeB]) };
}

describe('field-slice — bracketed ground truth', () => {
  it('pins an analytic circle crossing to the true zero set', () => {
    const field = fieldOf(analyticDisc);
    const plane: SlicePlane = { fixedAxis: 2, fixedValue: 0, uAxis: 0, vAxis: 1 };
    const c = fieldContour(field, plane, { uMin: -0.3, uMax: 0.3, vMin: -0.3, vMax: 0.3 }, 0.005);
    expect(c.crossings).toBeGreaterThan(20);
    expect(c.jumpCrossings).toBe(0);
    expect(c.maxResidualAtCrossing).toBeLessThan(1e-4);
    // Every crossing lies on |r| = 0.2.
    for (const s of c.segments) {
      for (const p of [s.a, s.b]) expect(Math.abs(Math.hypot(p[0], p[1]) - 0.2)).toBeLessThan(2e-3);
    }
  });

  it('rejects a non-positive resolution', () => {
    const field = fieldOf(analyticDisc);
    expect(() => fieldContour(field, { fixedAxis: 2, fixedValue: 0, uAxis: 0, vAxis: 1 }, { uMin: -1, uMax: 1, vMin: -1, vMax: 1 }, 0)).toThrow(/resolution/);
  });

  it('brackets a field discontinuity and flags it as a jump', () => {
    const field = fieldOf(discontinuousField);
    const plane: SlicePlane = { fixedAxis: 2, fixedValue: 0, uAxis: 0, vAxis: 1 };
    const c = fieldContour(field, plane, { uMin: -0.3, uMax: 0.3, vMin: -0.3, vMax: 0.3 }, 0.004);
    // The rim at |x|=0.002 is a sign change the field never drives to zero.
    expect(c.jumpCrossings).toBeGreaterThan(0);
    expect(c.maxResidualAtCrossing).toBeGreaterThan(1e-3);
  });

  it('slice distance is zero for identical curves and reports a shift', () => {
    const seg = [{ a: [0, 0] as [number, number], b: [1, 0] as [number, number] }];
    const shifted = [{ a: [0, 0.01] as [number, number], b: [1, 0.01] as [number, number] }];
    expect(sliceSymDistance(seg, seg, 0.01).testedToRef.max).toBeCloseTo(0, 12);
    expect(sliceSymDistance(seg, shifted, 0.01).testedToRef.p95).toBeCloseTo(0.01, 6);
  });
});

describe('chamfer-groove ground truth (from the field, not a mesher)', () => {
  const field = chamferGrooveControl();
  const { withGroove, without } = grooveBodies();

  it('the chamfer fold inflates the solid far beyond the lobes', () => {
    // The lobes reach y ~ 0.085; the sminChamfer bevel lifts the surface to y > 0.13.
    expect(field.field([0, 0.12, 0])).toBeLessThan(0);
    expect(field.field([0, 0.15, 0])).toBeGreaterThan(0);
    expect(field.field([0, 0.14, 0])).toBeLessThan(0.01);
  });

  it('the groove cutter does not change the SURFACE across the channel mid-span', () => {
    // Outside the 11 mm band the value is untouched; inside the band it is
    // lifted by the groove depth but stays negative (deep inside), so no
    // crossing moves. This is why the mid-span pit does not exist.
    for (const p of [[0, 0.02, 0], [0, 0.06, 0]] as Vec3[]) {
      expect(field.field(p)).toBe(sdBody(p, without));
    }
    const inBand: Vec3 = [0.02, 0.02, 0];
    expect(field.field(inBand)).toBeGreaterThan(sdBody(inBand, without));
    expect(field.field(inBand)).toBeLessThan(0);
    expect(sdBody(inBand, without)).toBeLessThan(0);
  });

  it('the groove cutter DOES act near its +z cap (the annular pit)', () => {
    // A band point near the cap: field is lifted by the groove relative to no-groove.
    const p: Vec3 = [0.02, 0.02, 0.128];
    expect(field.field(p)).toBeGreaterThan(sdBody(p, without) + 1e-3);
  });

  it('classifies the seam as smooth and the pits as discontinuous', () => {
    const refs = buildRegionReferences(field, 0.001);
    const seam = refs.find(r => r.region.id === 'seam')!;
    const pit = refs.find(r => r.region.id === 'notch-plus-z')!;
    expect(seam.reference.jumpCrossings).toBe(0);
    expect(pit.reference.jumpCrossings).toBeGreaterThan(10);
    expect(pit.reference.maxResidualAtCrossing).toBeGreaterThan(0.005);
  });
});

describe('DC candidate vs explicit baseline', () => {
  const field = chamferGrooveControl();
  let refs: SliceRegionResult[];
  beforeAll(() => { refs = buildRegionReferences(field, 0.0005); });

  it('exposes the port default and the selected candidate distinctly', () => {
    expect(dcOptionsFor(DC_BASELINE, 0.01, gridFor(field, 0.01)).normalEpsilon).toBeUndefined();
    expect(dcOptionsFor(DC_CANDIDATE, 0.01, gridFor(field, 0.01)).normalEpsilon).toBeCloseTo(0.001, 12);
    expect(dcOptionsFor(DC_BASELINE, 0.01, gridFor(field, 0.01)).clampToCell).toBe(true);
  });

  it('rejects an unknown variant instead of guessing', () => {
    expect(() => dcVariantById('nope')).toThrow(/unknown DC variant/);
  });

  it('candidate reduces the pit coverage error at the focus 10 mm cell', () => {
    const base = evaluateVariant(field, 'chamfer-groove', 0.01, DC_BASELINE, refs);
    const cand = evaluateVariant(field, 'chamfer-groove', 0.01, DC_CANDIDATE, refs);
    const b = base.regions.find(r => r.region.id === 'notch-plus-z')!;
    const c = cand.regions.find(r => r.region.id === 'notch-plus-z')!;
    expect(c.refToTested.p95).toBeLessThan(0.6 * b.refToTested.p95);
    expect(c.testedToRef.p95).toBeLessThan(0.6 * b.testedToRef.p95);
    expect(c.testedToRef.max).toBeLessThan(b.testedToRef.max);
    // Seam unchanged: the fix is local to the pit, not a global smoothing.
    const bs = base.regions.find(r => r.region.id === 'seam')!;
    const cs = cand.regions.find(r => r.region.id === 'seam')!;
    expect(cs.testedToRef.p95).toBeCloseTo(bs.testedToRef.p95, 6);
  });

  it('candidate removes most QEF clamps inside the pit while staying finite', () => {
    const base = evaluateVariant(field, 'chamfer-groove', 0.01, DC_BASELINE, refs);
    const cand = evaluateVariant(field, 'chamfer-groove', 0.01, DC_CANDIDATE, refs);
    expect(base.clampedInRegion['notch-plus-z']!).toBeGreaterThan(cand.clampedInRegion['notch-plus-z']!);
    expect(base.qefFallbacks).toBe(0);
    expect(cand.qefFallbacks).toBe(0);
    expect(cand.mesh.invalid).toBe(false);
  });

  it('disabling the clamp is worse, not better (clamp is protective)', () => {
    const noclamp = dcVariantById('dc-baseline-noclamp');
    const base = evaluateVariant(field, 'chamfer-groove', 0.01, DC_BASELINE, refs);
    const nc = evaluateVariant(field, 'chamfer-groove', 0.01, noclamp, refs);
    const b = base.regions.find(r => r.region.id === 'notch-plus-z')!;
    const n = nc.regions.find(r => r.region.id === 'notch-plus-z')!;
    expect(nc.qefClamped).toBe(0);
    expect(n.refToTested.p95).toBeGreaterThan(b.refToTested.p95);
  });

  it('produces closed, manifold, valid meshes on the pit fixture', () => {
    const cand = evaluateVariant(field, 'chamfer-groove', 0.01, DC_CANDIDATE, refs);
    expect(cand.mesh.invalid).toBe(false);
    expect(cand.topology.closed).toBe(true);
    expect(cand.topology.boundaryEdges).toBe(0);
    expect(cand.topology.nonManifoldEdges).toBe(0);
    expect(cand.topology.orientationFlips).toBe(0);
    expect(cand.topology.signedVolume).toBeGreaterThan(0);
  });

  it('keeps the sharp-box corner win exactly', () => {
    const box = controlSharpBox();
    const cell = 0.01;
    const grid = gridFor(box, cell);
    const base = analyzeMesh('dual-contouring', dualContouring(box, dcOptionsFor(DC_BASELINE, cell, grid)), box, 'control-sharp-box', T, null);
    const cand = analyzeMesh('dual-contouring', dualContouring(box, dcOptionsFor(DC_CANDIDATE, cell, grid)), box, 'control-sharp-box', T, null);
    const mc = analyzeMesh('marching-cubes', marchingCubes(box, { cell, grid }), box, 'control-sharp-box', T, null);
    const worst = (a: typeof base): number => Math.max(...a.sharpProbes.map(p => p.minSurfaceDistance));
    expect(worst(cand)).toBeCloseTo(worst(base), 9);
    expect(worst(cand)).toBeLessThan(0.15 * cell);
    expect(worst(mc)).toBeGreaterThan(0.4 * cell);
  });

  it('every sweep variant is a registered, resolvable option', () => {
    for (const v of DC_VARIANTS) {
      const opts = dcOptionsFor(v, 0.01, gridFor(field, 0.01));
      expect(opts.cell).toBe(0.01);
      expect(opts.clampToCell).toBe(v.clampToCell);
      if (v.normalEpsilon(0.01) !== null) expect(opts.normalEpsilon).toBeCloseTo(v.normalEpsilon(0.01)!, 12);
      expect(dcVariantById(v.id).id).toBe(v.id);
    }
  });
});

describe('slice rendering', () => {
  it('renders the reference and a mesh layer with distinct colours', () => {
    const field = chamferGrooveControl();
    const refs = buildRegionReferences(field, 0.001);
    const region = CHAMFER_REGIONS[1]!;
    const mesh = dualContouring(field, dcOptionsFor(DC_CANDIDATE, 0.02, gridFor(field, 0.02)));
    const segs = meshSliceSegments(mesh, region.plane, region.window);
    expect(segs.length).toBeGreaterThan(0);
    const img = renderSlice(region, [{ segments: segs, color: [90, 200, 235] }], 200, 160, refs[1]!.reference.segments);
    expect(img.width).toBe(200);
    const seen = new Set<number>();
    for (let i = 0; i < img.rgba.length; i += 4) seen.add((img.rgba[i]! << 16) | (img.rgba[i + 1]! << 8) | img.rgba[i + 2]!);
    expect(seen.has((90 << 16) | (200 << 8) | 235)).toBe(true);
    expect(seen.has((225 << 16) | (225 << 8) | 232)).toBe(true);
  });
});
