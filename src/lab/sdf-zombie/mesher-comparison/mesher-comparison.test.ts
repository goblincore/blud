// src/lab/sdf-zombie/mesher-comparison/mesher-comparison.test.ts
//
// Focused gates for the mesher comparison. These are behavioural: they check
// winding, corner convention, QEF degeneracy, topology of a closed control,
// a sharp-feature control, metric sensitivity, fixture preconditions and
// export round trips — never a copied output string.

import { describe, expect, it } from 'vitest';
import src from '../characters/goblin.blob?raw';

import {
  chamferGrooveControl, characterRegionFixture, controlSharpBox, controlSphere,
  tornChunkFixture,
} from './fixtures';
import { marchingCubes, fieldNormal } from './marching-cubes';
import { dualContouring, qefSolve, refineEdge } from './dual-contouring';
import { surfaceNets } from './surface-nets-adapter';
import { gridFor, optionsFor, runRow, type RunId } from './runner';
import { FEATURE_REGIONS, analyzeMesh, buildReferenceMesh, featurePresence } from './analysis';
import {
  bidirectionalDistance, computeMeshStats, pointTriangleDist2, TriBvh, vertexToMeshDistance,
} from './metrics';
import { inspectGlb, meshToGlb, meshToObj, readBackObj } from './export';
import { sharpBoxSensitivity } from './sensitivity';
import { meshBounds, renderMesh, defaultCamera } from './render';
import { meshRankable, type IndexedMesh } from './types';
import type { Vec3 } from '../types';

const ALL: readonly RunId[] = ['surface-nets', 'marching-cubes', 'dual-contouring'];
const CORNERS: readonly [number, number, number][] = [
  [0.15, 0.15, 0.15], [0.15, 0.15, -0.15], [0.15, -0.15, 0.15], [-0.15, 0.15, 0.15],
  [0.15, -0.15, -0.15], [-0.15, 0.15, -0.15], [-0.15, -0.15, 0.15], [-0.15, -0.15, -0.15],
];

function minCornerDistance(mesh: IndexedMesh, corner: Vec3): number {
  let best = Infinity;
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const d = Math.hypot(
      mesh.positions[i * 3]! - corner[0],
      mesh.positions[i * 3 + 1]! - corner[1],
      mesh.positions[i * 3 + 2]! - corner[2],
    );
    if (d < best) best = d;
  }
  return best;
}

function deleteRegion(mesh: IndexedMesh, min: Vec3, max: Vec3): IndexedMesh {
  const keep: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const insideAll = [0, 1, 2].every(k => {
      const v = mesh.indices[t + k]!;
      const p = [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!];
      return p[0]! >= min[0] && p[0]! <= max[0] && p[1]! >= min[1] && p[1]! <= max[1] && p[2]! >= min[2] && p[2]! <= max[2];
    });
    if (!insideAll) keep.push(mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!);
  }
  return { ...mesh, indices: new Uint32Array(keep) };
}

describe('marching cubes — corner convention and winding', () => {
  it('closes the analytic sphere with outward winding (positive signed volume)', () => {
    const field = controlSphere();
    const grid = gridFor(field, 0.04);
    const mesh = marchingCubes(field, { cell: 0.04, grid });
    const stats = computeMeshStats(mesh, { field, grid });
    expect(stats.closed).toBe(true);
    expect(stats.boundaryEdges).toBe(0);
    expect(stats.nonManifoldEdges).toBe(0);
    expect(stats.connectedComponents).toBe(1);
    // Outward winding: signed volume is positive and matches the exact sphere.
    expect(stats.signedVolume).toBeGreaterThan(0);
    const exact = (4 / 3) * Math.PI * 0.2 ** 3;
    expect(Math.abs(stats.signedVolume - exact) / exact).toBeLessThan(0.05);
    // No triangle opposes the field normal.
    expect(stats.orientationFlips).toBe(0);
  });

  it('places every edge vertex near the field zero set', () => {
    const field = controlSphere();
    const grid = gridFor(field, 0.04);
    const mesh = marchingCubes(field, { cell: 0.04, grid });
    const stats = computeMeshStats(mesh, { field, grid });
    // MC vertices are exact linear interpolations on grid edges; on a sphere
    // the chord residual is bounded by the cell.
    expect(stats.fieldResidual.max).toBeLessThan(0.04);
    expect(stats.fieldResidual.median).toBeLessThan(0.004);
  });

  it('marks an all-NaN field invalid instead of emitting garbage', () => {
    const field = { ...controlSphere(), field: () => NaN };
    const mesh = marchingCubes(field, { cell: 0.04, grid: gridFor(field, 0.04) });
    expect(mesh.invalid).toBe(true);
    expect(mesh.indices.length).toBe(0);
  });

  it('refining the grid reduces the field residual', () => {
    const field = controlSphere();
    const coarse = computeMeshStats(marchingCubes(field, { cell: 0.04, grid: gridFor(field, 0.04) }), { field });
    const fine = computeMeshStats(marchingCubes(field, { cell: 0.02, grid: gridFor(field, 0.02) }), { field });
    expect(fine.fieldResidual.p95).toBeLessThan(coarse.fieldResidual.p95);
    expect(fine.verts).toBeGreaterThan(coarse.verts);
  });
});

describe('dual contouring — QEF robustness', () => {
  const cellMin: Vec3 = [-1, -1, -1];
  const cellMax: Vec3 = [1, 1, 1];

  it('empty Hermite data falls back to the cell centre and flags it', () => {
    const r = qefSolve({ points: [], normals: [] }, cellMin, cellMax, true);
    expect(r.fellBack).toBe(true);
    expect(r.point).toEqual([0, 0, 0]);
  });

  it('solves three orthogonal planes to their intersection', () => {
    const r = qefSolve({
      points: [[0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1]],
      normals: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    }, cellMin, cellMax, true);
    expect(r.fellBack).toBe(false);
    expect(Math.hypot(r.point[0], r.point[1], r.point[2])).toBeLessThan(0.2);
  });

  it('stays finite for parallel/singular normals and for non-finite input', () => {
    const parallel = qefSolve({
      points: [[0.2, 0, 0], [0.3, 0, 0], [0.4, 0, 0]],
      normals: [[1, 0, 0], [1, 0, 0], [1, 0, 0]],
    }, cellMin, cellMax, true);
    expect(Number.isFinite(parallel.point[0])).toBe(true);
    // Clamped into the cell.
    for (const v of parallel.point) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }

    const nan = qefSolve({
      points: [[NaN, 0, 0], [0, 0, 0]],
      normals: [[1, 0, 0], [0, 1, 0]],
    }, cellMin, cellMax, true);
    for (const v of nan.point) expect(Number.isFinite(v)).toBe(true);
    expect(nan.fellBack).toBe(true);
  });

  it('clamps an out-of-cell solve when clampToCell is on', () => {
    // A single plane pushes the minimiser far along the normal direction; the
    // Tikhonov term keeps it finite and the clamp keeps it in the cell.
    const r = qefSolve({
      points: [[0, 0, 0]], normals: [[0, 1, 0]],
    }, cellMin, cellMax, true);
    for (const v of r.point) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }
  });

  it('refineEdge brackets a sign change', () => {
    const f = (p: Vec3): number => p[0] - 0.3;
    const hit = refineEdge(f, [0, 0, 0], [1, 0, 0], -0.3, 0.7, 6);
    expect(Math.abs(f(hit))).toBeLessThan(1e-4);
    expect(hit[1]).toBe(0);
    expect(hit[2]).toBe(0);
  });

  it('closes the analytic sphere with positive signed volume', () => {
    const field = controlSphere();
    const grid = gridFor(field, 0.04);
    const mesh = dualContouring(field, { cell: 0.04, grid });
    const stats = computeMeshStats(mesh, { field, grid });
    expect(stats.closed).toBe(true);
    expect(stats.boundaryEdges).toBe(0);
    expect(stats.signedVolume).toBeGreaterThan(0);
    expect(stats.orientationFlips).toBe(0);
  });

  it('preserves the sharp box corner far better than cell size', () => {
    const field = controlSharpBox();
    const cell = 0.02;
    const mesh = dualContouring(field, { cell, grid: gridFor(field, cell) });
    for (const c of CORNERS) expect(minCornerDistance(mesh, c)).toBeLessThan(0.15 * cell);
  });
});

describe('surface nets baseline adapter', () => {
  it('samples exactly the shared grid the other methods use', () => {
    const field = controlSphere();
    const cell = 0.04;
    const row = runRow(field, cell);
    const grid = gridFor(field, cell);
    for (const id of ALL) {
      expect(row.meshes[id]!.grid!.cell).toBe(grid.cell);
      expect(row.meshes[id]!.grid!.dims).toEqual(grid.dims);
      expect(row.meshes[id]!.grid!.min).toEqual(grid.min);
    }
  });

  it('welds the repeated cell vertices to exactly one per surface cell', () => {
    const field = controlSphere();
    const cell = 0.04;
    const grid = gridFor(field, cell);
    const mesh = surfaceNets(field, optionsFor('surface-nets', cell, grid));
    expect(mesh.positions.length / 3).toBe(mesh.surfaceNets.cellVerts);
    expect(mesh.surfaceNets.droppedQuads).toBe(0);
    expect(mesh.overflow).toBe(false);
  });

  it('closes the analytic sphere with positive signed volume', () => {
    const field = controlSphere();
    const grid = gridFor(field, 0.04);
    const mesh = surfaceNets(field, optionsFor('surface-nets', 0.04, grid));
    const stats = computeMeshStats(mesh, { field, grid });
    expect(stats.closed).toBe(true);
    expect(stats.signedVolume).toBeGreaterThan(0);
  });

  it('rounds the sharp box corner, unlike dual contouring', () => {
    // Measured behaviour, not an assumption: SN has no sharp-feature term, so
    // at a 20 mm cell its nearest vertex to a true corner is a fraction of a
    // cell away while DC's QEF reaches the corner.
    const field = controlSharpBox();
    const cell = 0.02;
    const sn = surfaceNets(field, optionsFor('surface-nets', cell, gridFor(field, cell)));
    const dc = dualContouring(field, { cell, grid: gridFor(field, cell) });
    const snD = minCornerDistance(sn, CORNERS[0]!);
    const dcD = minCornerDistance(dc, CORNERS[0]!);
    expect(snD).toBeGreaterThan(0.4 * cell);
    expect(dcD).toBeLessThan(snD);
  });
});

describe('metrics — correctness and sensitivity', () => {
  it('pointTriangleDist2 handles interior, edge and vertex regions', () => {
    const a: Vec3 = [0, 0, 0], b: Vec3 = [1, 0, 0], c: Vec3 = [0, 1, 0];
    expect(pointTriangleDist2([0.25, 0.25, 0], a, b, c)).toBeCloseTo(0, 12);
    expect(pointTriangleDist2([0, 0, 2], a, b, c)).toBeCloseTo(4, 12);
    expect(pointTriangleDist2([1, 1, 0], a, b, c)).toBeCloseTo(0.5, 12);
    expect(pointTriangleDist2([-1, 0, 0], a, b, c)).toBeCloseTo(1, 12);
  });

  it('BVH nearest matches brute force', () => {
    const field = controlSphere();
    const mesh = marchingCubes(field, { cell: 0.04, grid: gridFor(field, 0.04) });
    const bvh = new TriBvh(mesh);
    const probes: Vec3[] = [[0.3, 0.1, 0], [0, 0, 0], [0.19, 0.05, 0.02], [-0.4, 0, 0]];
    for (const p of probes) {
      let best = Infinity;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const ia = mesh.indices[t]!, ib = mesh.indices[t + 1]!, ic = mesh.indices[t + 2]!;
        best = Math.min(best, pointTriangleDist2(p,
          [mesh.positions[ia * 3]!, mesh.positions[ia * 3 + 1]!, mesh.positions[ia * 3 + 2]!],
          [mesh.positions[ib * 3]!, mesh.positions[ib * 3 + 1]!, mesh.positions[ib * 3 + 2]!],
          [mesh.positions[ic * 3]!, mesh.positions[ic * 3 + 1]!, mesh.positions[ic * 3 + 2]!]));
      }
      expect(Math.sqrt(bvh.nearestDist2(p))).toBeCloseTo(Math.sqrt(best), 9);
    }
  });

  it('detects a radial inflation as the inflation magnitude', () => {
    const field = controlSphere();
    const cell = 0.02;
    const mesh = marchingCubes(field, { cell, grid: gridFor(field, cell) });
    // Inflate about the sphere centre by one cell, so every point moves along
    // its own normal by ~cell (a pure translation is NOT a good probe: two
    // parallel surfaces have nearest neighbours closer than the shift).
    const factor = 1 + cell / 0.2;
    const shifted: IndexedMesh = {
      ...mesh,
      positions: Float32Array.from(mesh.positions, v => v * factor),
    };
    expect(bidirectionalDistance(mesh, mesh, 500, cell).aToB.max).toBeCloseTo(0, 9);
    const r = bidirectionalDistance(mesh, shifted, 1500, cell);
    expect(r.aToB.median).toBeGreaterThan(0.5 * cell);
    expect(r.aToB.median).toBeLessThan(1.3 * cell);
  });

  it('detects a deleted thin feature via reference coverage', () => {
    const field = characterRegionFixture(src);
    const cell = 0.02;
    const grid = gridFor(field, cell);
    const mesh = marchingCubes(field, { cell, grid });
    const ref = buildReferenceMesh(field, cell);
    expect(ref).not.toBeNull();
    const ear = FEATURE_REGIONS['character-head']!.find(r => r.name === 'ear-l')!;
    const intact = featurePresence('character-head', mesh, ref!.mesh, cell, {})[0]!;
    const damaged = deleteRegion(mesh, ear.min, ear.max);
    const damagedPresence = featurePresence('character-head', damaged, ref!.mesh, cell, {})[0]!;
    expect(intact.coverage).toBeGreaterThan(0.5);
    expect(damagedPresence.coverage).toBeLessThan(intact.coverage - 0.3);
  });

  it('flags degenerate and non-manifold geometry', () => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
    // Two triangles sharing edge 0-1 (used once each) + a third on the same
    // edge makes it non-manifold; one triangle repeats a vertex.
    const indices = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 1, 2, 0, 2, 2]);
    const mesh: IndexedMesh = {
      method: 'marching-cubes', positions, indices, fieldEvals: 0, grid: null,
      invalid: false, overflow: false, dropped: 0,
    };
    const stats = computeMeshStats(mesh);
    expect(stats.nonManifoldEdges).toBeGreaterThan(0);
    expect(stats.degenerateTris).toBeGreaterThan(0);
    expect(stats.duplicateFaces).toBeGreaterThan(0);
  });

  it('renders a non-empty panel with a stable camera', () => {
    const field = controlSphere();
    const mesh = marchingCubes(field, { cell: 0.04, grid: gridFor(field, 0.04) });
    const b = meshBounds(mesh);
    const img = renderMesh(mesh, defaultCamera(b.centre, b.radius, 96, 96));
    let lit = 0;
    for (let i = 0; i < 96 * 96; i++) {
      if (img.rgba[i * 4]! > 40 || img.rgba[i * 4 + 1]! > 40 || img.rgba[i * 4 + 2]! > 40) lit++;
    }
    expect(lit).toBeGreaterThan(2000);
  });
});

describe('fixtures — preconditions', () => {
  it('torn chunk: the torn end carves an open crater', () => {
    const t = tornChunkFixture();
    expect(t.tornCount).toBeGreaterThan(0);
    expect(t.field.field(t.craterCentre)).toBeGreaterThan(0);
    expect(t.preWound(t.craterCentre)).toBeLessThan(0);
    const cell = 0.02;
    const mesh = surfaceNets(t.field, optionsFor('surface-nets', cell, gridFor(t.field, cell)));
    expect(mesh.invalid).toBe(false);
    let craterVerts = 0;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      if (mesh.positions[i * 3]! > 0.05) craterVerts++;
    }
    expect(craterVerts).toBeGreaterThan(2);
  });

  it('character head: thin ears exist in every method and the neck cut is reported', () => {
    const field = characterRegionFixture(src);
    expect(field.field([0, 1.2, 0.05])).toBeLessThan(0);
    expect(field.field([0.24, 1.46, 0.22])).toBeGreaterThan(0);
    const cell = 0.02;
    const grid = gridFor(field, cell);
    const ear = FEATURE_REGIONS['character-head']!.find(r => r.name === 'ear-l')!;
    for (const id of ALL) {
      const mesh = id === 'surface-nets'
        ? surfaceNets(field, optionsFor(id, cell, grid))
        : id === 'marching-cubes' ? marchingCubes(field, { cell, grid }) : dualContouring(field, { cell, grid });
      expect(mesh.invalid).toBe(false);
      const inEar = featurePresence('character-head', mesh, null, cell, {})[0]!;
      expect(inEar.meshVerts).toBeGreaterThan(0);
      const stats = computeMeshStats(mesh, { field, grid });
      // Domain cut at the neck: an open boundary is EXPECTED, and reported.
      expect(stats.boundaryEdges).toBeGreaterThan(0);
      expect(stats.boundaryCrossings).toBeGreaterThan(0);
      void ear;
    }
  });

  it('chamfer-groove control is a closed Blud solid with a crease and a groove', () => {
    const field = chamferGrooveControl();
    expect(field.field([-0.04, 0, 0])).toBeLessThan(0);
    expect(field.field([0.055, 0.01, 0])).toBeLessThan(0);
    expect(field.field([0.2, 0.19, 0.2])).toBeGreaterThan(0);
    const cell = 0.02;
    const mesh = marchingCubes(field, { cell, grid: gridFor(field, cell) });
    const stats = computeMeshStats(mesh, { field });
    expect(stats.closed).toBe(true);
    expect(stats.signedVolume).toBeGreaterThan(0);
    const feats = featurePresence('chamfer-groove', mesh, null, cell, {});
    expect(feats.every(f => f.meshVerts > 0)).toBe(true);
  });
});

describe('invalid-output contract', () => {
  const cell = 0.04;

  it('marks all three methods invalid on a partial-NaN field even when geometry is finite', () => {
    const base = controlSphere();
    const broken = { ...base, field: (p: Vec3) => (p[0] > 0.05 ? NaN : base.field(p)) };
    const grid = gridFor(broken, cell);
    const sn = surfaceNets(broken, optionsFor('surface-nets', cell, grid));
    const mc = marchingCubes(broken, { cell, grid });
    const dc = dualContouring(broken, { cell, grid });
    for (const m of [sn, mc, dc]) {
      expect(meshRankable(m)).toBe(false);
      expect(m.invalidReason).toMatch(/non-finite/);
    }
    // Surface nets still emitted finite geometry; that is exactly why the
    // non-finite counter, not a finite geometry check, must decide validity.
    expect(sn.positions.length).toBeGreaterThan(0);
    // DC's finite QEF fallbacks are diagnostics, not dropped geometry.
    expect(dc.dropped).toBe(0);
    expect(dc.fallbacks!).toBeGreaterThan(0);
  });

  it('marks all three methods invalid on an Infinite field', () => {
    const base = controlSphere();
    const broken = { ...base, field: (p: Vec3) => (p[0] > 0.05 ? Number.POSITIVE_INFINITY : base.field(p)) };
    const grid = gridFor(broken, cell);
    for (const m of [
      surfaceNets(broken, optionsFor('surface-nets', cell, grid)),
      marchingCubes(broken, { cell, grid }),
      dualContouring(broken, { cell, grid }),
    ]) {
      expect(meshRankable(m)).toBe(false);
      expect(m.invalidReason).toMatch(/non-finite/);
    }
  });

  it('keeps legitimate finite QEF fallbacks valid (diagnostics, not failure)', () => {
    const r = qefSolve({ points: [], normals: [] }, [-1, -1, -1], [1, 1, 1], true);
    expect(r.fellBack).toBe(true);
    expect(r.point.every(Number.isFinite)).toBe(true);

    const field = controlSphere();
    const dc = dualContouring(field, { cell, grid: gridFor(field, cell) });
    // Simulate a run whose only anomaly is benign fallbacks: it must stay
    // rankable and report the count.
    const withFallbacks = { ...dc, fallbacks: 7 };
    const a = analyzeMesh('dual-contouring', withFallbacks, field, 'control-sphere',
      { timesMs: [1], medianMs: 1, minMs: 1, maxMs: 1 }, null);
    expect(a.rankable).toBe(true);
    expect(a.fallbacks).toBe(7);
  });

  it('never references, probes, ranks or exports an invalid mesh', () => {
    const base = controlSphere();
    const broken = { ...base, field: (p: Vec3) => (p[0] > 0.05 ? NaN : base.field(p)) };
    const grid = gridFor(broken, cell);
    const dc = dualContouring(broken, { cell, grid });
    const ref = buildReferenceMesh(base, cell); // a genuine reference for the valid field
    expect(ref).not.toBeNull();
    const a = analyzeMesh('dual-contouring', dc, broken, 'control-sphere',
      { timesMs: [1], medianMs: 1, minMs: 1, maxMs: 1 }, ref);
    expect(a.rankable).toBe(false);
    expect(a.reference).toBeNull();
    expect(a.features).toEqual([]);
    expect(a.sharpProbes).toEqual([]);
    expect(meshRankable(dc)).toBe(false);
  });

  it('measures sharp-corner error on the triangle surface, not just vertices', () => {
    const field = controlSharpBox();
    const dc = dualContouring(field, { cell, grid: gridFor(field, cell) });
    const a = analyzeMesh('dual-contouring', dc, field, 'control-sharp-box',
      { timesMs: [1], medianMs: 1, minMs: 1, maxMs: 1 }, null);
    expect(a.sharpProbes.length).toBeGreaterThan(0);
    for (const p of a.sharpProbes) {
      // The triangle surface is a superset of the vertices, so surface
      // distance can never exceed vertex distance.
      expect(p.minSurfaceDistance).toBeLessThanOrEqual(p.minVertexDistance + 1e-9);
    }
  });

  it('sharp-box DC advantage is phase-robust but the absolute error is alignment-specific', () => {
    const rows = sharpBoxSensitivity(0.02);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.dcSurfaceMm).toBeLessThan(r.snSurfaceMm);
      expect(r.dcSurfaceMm).toBeLessThan(r.mcSurfaceMm);
    }
    // SN/MC error swings by several mm just from a sub-cell grid shift, so the
    // 20 mm headline must not be quoted as a universal constant.
    const axisAligned = rows.filter(r => r.rotationDeg === 0).map(r => r.snSurfaceMm);
    expect(Math.max(...axisAligned) - Math.min(...axisAligned)).toBeGreaterThan(5);
  });
});

describe('analysis + export round trips', () => {
  it('analyzeMesh records timings, reference and feature data', () => {
    const field = controlSharpBox();
    const cell = 0.02;
    const grid = gridFor(field, cell);
    const mesh = dualContouring(field, { cell, grid });
    const ref = buildReferenceMesh(field, cell);
    const a = analyzeMesh('dual-contouring', mesh, field, 'control-sharp-box',
      { timesMs: [1, 2, 3], medianMs: 2, minMs: 1, maxMs: 3 }, ref);
    expect(a.run).toBe('dual-contouring');
    expect(a.exactDistance).toBe(true);
    expect(a.reference).not.toBeNull();
    expect(a.features.length).toBeGreaterThan(0);
    expect(a.features[0]!.meshVerts).toBeGreaterThan(0);
  });

  it('OBJ survives a read-back with all triangles and normals', () => {
    const field = controlSphere();
    const mesh = marchingCubes(field, { cell: 0.04, grid: gridFor(field, 0.04) });
    const obj = meshToObj(mesh);
    const back = readBackObj(obj);
    expect(back.vertices).toBe(mesh.positions.length / 3);
    expect(back.faces).toBe(mesh.indices.length / 3);
    expect(back.normals).toBe(mesh.positions.length / 3);
    expect(back.nonTriangles).toBe(0);
    expect(back.degenerate).toBe(0);
  });

  it('GLB container and accessor counts are valid', () => {
    const field = controlSphere();
    const mesh = marchingCubes(field, { cell: 0.04, grid: gridFor(field, 0.04) });
    const glb = meshToGlb(mesh);
    const info = inspectGlb(glb);
    expect(info.magicOk).toBe(true);
    expect(info.version).toBe(2);
    const accessors = (info.json as { accessors: { count: number }[] }).accessors;
    expect(accessors[0]!.count).toBe(mesh.positions.length / 3);
    expect(accessors[2]!.count).toBe(mesh.indices.length);
    expect(info.binLength).toBeGreaterThan(0);
  });

  it('vertex-to-mesh distance distinguishes identical from inflated meshes', () => {
    const field = controlSphere();
    const cell = 0.02;
    const mesh = surfaceNets(field, optionsFor('surface-nets', cell, gridFor(field, cell)));
    expect(vertexToMeshDistance(mesh, mesh).max).toBeCloseTo(0, 9);
    const factor = 1 + (3 * cell) / 0.2;
    const shifted: IndexedMesh = { ...mesh, positions: Float32Array.from(mesh.positions, v => v * factor) };
    // Every vertex moved ~3 cells along its own normal.
    expect(vertexToMeshDistance(mesh, shifted).median).toBeGreaterThan(2 * cell);
    expect(vertexToMeshDistance(mesh, shifted).median).toBeLessThan(4 * cell);
  });

  it('normal consistency: field normal is unit and outward on the sphere', () => {
    const p: Vec3 = [0.2, 0, 0];
    const n = fieldNormal((q) => Math.hypot(q[0], q[1], q[2]) - 0.2, p, 0.005);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
    expect(n[0]).toBeCloseTo(1, 3);
  });
});
