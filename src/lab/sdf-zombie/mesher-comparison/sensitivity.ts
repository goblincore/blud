// src/lab/sdf-zombie/mesher-comparison/sensitivity.ts
//
// Cheap, focused sensitivity checks for the sharp-crease conclusion. The main
// ladder reports one grid alignment per fixture/cell; a single alignment can
// flatter (or penalise) a mesher whose vertices sit at fixed sub-cell offsets.
// This module re-runs the analytic sharp box with the grid shifted by a
// fraction of a cell on one axis, plus a rotated sampling frame, and reports
// the nearest TRIANGLE SURFACE distance to the true corner.
//
// The point is NOT to prove dual contouring is universally 100x better: it is
// to show the direction is phase-robust while the ABSOLUTE error is
// fixture/alignment specific (so the headline numbers below must never be
// quoted as a universal guarantee).

import { controlSharpBox } from './fixtures';
import { dualContouring } from './dual-contouring';
import { marchingCubes } from './marching-cubes';
import { surfaceNets } from './surface-nets-adapter';
import { TriBvh } from './metrics';
import { gridFor } from './runner';
import type { GridSpec, IndexedMesh, MethodOptions, ScalarField } from './types';
import type { Vec3 } from '../types';

export interface SensitivityRow {
  /** Grid origin shift in cells, per axis. */
  readonly phaseCells: readonly [number, number, number];
  /** Rotation of the sampling frame about (1,1,0), degrees (0 = axis-aligned). */
  readonly rotationDeg: number;
  /** Corner of the (possibly rotated) box used as the probe point. */
  readonly corner: Vec3;
  readonly snSurfaceMm: number;
  readonly mcSurfaceMm: number;
  readonly dcSurfaceMm: number;
  readonly snVertexMm: number;
  readonly mcVertexMm: number;
  readonly dcVertexMm: number;
}

/** Rotate `p` about the (1,1,0) axis by `deg` (right-handed). */
function rotateAbout110(p: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const l = Math.sqrt(2);
  const ux = 1 / l, uy = 1 / l, uz = 0;
  const dot = ux * p[0] + uy * p[1] + uz * p[2];
  const cx = uy * p[2] - uz * p[1];
  const cy = uz * p[0] - ux * p[2];
  const cz = ux * p[1] - uy * p[0];
  return [
    p[0] * c + cx * s + ux * dot * (1 - c),
    p[1] * c + cy * s + uy * dot * (1 - c),
    p[2] * c + cz * s + uz * dot * (1 - c),
  ];
}

/** Analytic sharp box in a frame rotated about (1,1,0); bounds padded for it. */
function rotatedSharpBox(deg: number): ScalarField {
  const base = controlSharpBox();
  const axis = (p: Vec3): Vec3 => rotateAbout110(p, -deg); // inverse rotation
  const field = (p: Vec3): number => base.field(axis(p));
  return {
    id: `control-sharp-box-rot${deg}`,
    units: 'meters',
    field,
    bounds: { min: [-0.35, -0.35, -0.35], max: [0.35, 0.35, 0.35] },
    analyticDistance: true,
    meta: { shape: `analytic sharp box rotated ${deg} deg about (1,1,0)`, exactDistance: true },
  };
}

/** A phase-shifted, still block-aligned grid covering the padded bounds. */
function phasedGrid(base: GridSpec, phase: readonly [number, number, number]): GridSpec {
  const min: Vec3 = [
    base.min[0] + phase[0] * base.cell,
    base.min[1] + phase[1] * base.cell,
    base.min[2] + phase[2] * base.cell,
  ];
  const dims: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const n = base.dims[i]! + 1;
    dims[i] = Math.ceil(n / 4) * 4;
  }
  return { min, cell: base.cell, dims };
}

function run(method: 'sn' | 'mc' | 'dc', field: ScalarField, cell: number, grid: GridSpec): IndexedMesh {
  const opts: MethodOptions = { cell, grid };
  switch (method) {
    case 'sn': return surfaceNets(field, { ...opts, band: 0, distort: 1 });
    case 'mc': return marchingCubes(field, opts);
    case 'dc': return dualContouring(field, { ...opts, bisectionIterations: 6, clampToCell: true });
  }
}

function cornerDistances(field: ScalarField, cell: number, grid: GridSpec, corner: Vec3): SensitivityRow {
  const meshes = { sn: run('sn', field, cell, grid), mc: run('mc', field, cell, grid), dc: run('dc', field, cell, grid) };
  const surface: Record<string, number> = {};
  const vertex: Record<string, number> = {};
  for (const k of ['sn', 'mc', 'dc'] as const) {
    const m = meshes[k];
    const bvh = new TriBvh(m);
    surface[k] = Math.sqrt(bvh.nearestDist2(corner));
    let best = Infinity;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const d = Math.hypot(m.positions[i * 3]! - corner[0], m.positions[i * 3 + 1]! - corner[1], m.positions[i * 3 + 2]! - corner[2]);
      if (d < best) best = d;
    }
    vertex[k] = best;
  }
  return {
    phaseCells: [0, 0, 0],
    rotationDeg: 0,
    corner,
    snSurfaceMm: surface.sn! * 1000, mcSurfaceMm: surface.mc! * 1000, dcSurfaceMm: surface.dc! * 1000,
    snVertexMm: vertex.sn! * 1000, mcVertexMm: vertex.mc! * 1000, dcVertexMm: vertex.dc! * 1000,
  };
}

const CORNER: Vec3 = [0.15, 0.15, 0.15];
const PHASES: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0.23, 0, 0], [0, 0.23, 0], [0, 0, 0.23], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25],
];

/**
 * Sharp-corner surface/vertex error across grid phases and one rotated frame.
 * `cell` is in metres.
 */
export function sharpBoxSensitivity(cell: number): SensitivityRow[] {
  const field = controlSharpBox();
  const base = gridFor(field, cell);
  const rows: SensitivityRow[] = PHASES.map(phase => {
    const g = phasedGrid(base, phase);
    const r = cornerDistances(field, cell, g, CORNER);
    return { ...r, phaseCells: phase, rotationDeg: 0 };
  });

  const deg = 20;
  const rot = rotatedSharpBox(deg);
  const rotCorner = rotateAbout110(CORNER, deg);
  const rotBase = gridFor(rot, cell);
  const rotRow = cornerDistances(rot, cell, rotBase, rotCorner);
  rows.push({ ...rotRow, phaseCells: [0, 0, 0], rotationDeg: deg, corner: rotCorner });
  return rows;
}
