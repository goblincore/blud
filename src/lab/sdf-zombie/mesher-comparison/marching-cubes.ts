// src/lab/sdf-zombie/mesher-comparison/marching-cubes.ts
//
// Table-based marching cubes (Lorensen & Cline 1987), the classic 256-entry
// triangulation table. This is a genuine MC implementation:
//   * every cube edge that changes sign gets ONE interpolated vertex,
//   * vertices are cached by a CANONICAL GLOBAL EDGE ID, so the up-to-four
//     cells sharing an edge reference the exact same vertex (no duplicate
//     copies, no float-key welding needed),
//   * winding is chosen so outward normals point away from the interior,
//     pinned by a signed-volume test on an analytic sphere,
//   * per-vertex normals are central differences of the SAME field closure.
//
// It is NOT marching tetrahedra and NOT surface nets. Marching tetrahedra
// would have been a cheap way to a watertight mesh; it is not what the task's
// MC row means.
//
// AMBIGUITY LIMITATION, stated honestly: the classic Lorensen/Bourke table
// resolves each ambiguous face/corner by a FIXED case choice. On some
// sign configurations this produces topologically inconsistent neighbours
// (non-manifold edges, or tiny holes). This is a property of the table, not
// of this transcription. The sphere/box controls are smooth and do not hit
// it; production fields can, and the metrics row reports non-manifold and
// boundary edge counts rather than claiming a general watertight guarantee.
//
// TABLE PROVENANCE: `marching-cubes-tables.ts`, transcribed from ALICE-SDF
// (MIT OR Apache-2.0) at pinned revision 1e85ab3591600bd316e3ceaa33df8dbd06cb3219,
// `src/mesh/sdf_to_mesh.rs`. Corner/edge convention below.

import {
  countedField, fitGrid, gridCornerCount, gridPoint, type GridSpec,
  type IndexedMesh, type MethodOptions, type ScalarField,
} from './types';
import { EDGE_TABLE, TRI_TABLE } from './marching-cubes-tables';
import type { Vec3 } from '../types';

/**
 * Cube corner positions, in the numbering of the pinned table.
 * 0..3 walk the y = 0 face (x, then z); 4..7 the y = 1 face. This is the
 * layout ALICE-SDF pairs with the table; empirically the table comes out
 * OUTWARD-wound under this layout (signed volume of the sphere control is
 * positive), so `NEGATE_WINDING` is false. Pinned by
 * `winding: signed volume of the closed MC sphere is positive`.
 */
const CORNER_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
  [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];

/** Which two corners each of the 12 local edges joins. */
const EDGE_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export const MC_NEGATE_WINDING = false;

/** Hard cap so a mis-sized fixture fails loudly instead of exhausting RAM. */
export const MC_MAX_VERTS = 4_000_000;

const cornerIndex = (grid: GridSpec, i: number, j: number, k: number): number =>
  (k * (grid.dims[1] + 1) + j) * (grid.dims[0] + 1) + i;

/**
 * Run marching cubes over `field.bounds` at `opts.cell`.
 *
 * The whole grid is sampled once up front and kept, so (a) every cube reads
 * shared corners from memory and (b) a per-vertex normal uses the SAME field
 * closure (not a grid finite difference).
 */
export function marchingCubes(fieldIn: ScalarField, opts: MethodOptions): IndexedMesh {
  const { field, count } = countedField(fieldIn);
  const cell = opts.cell;
  const grid = opts.grid ?? fitGrid(field, cell);
  const [nx, ny, nz] = grid.dims;
  const cxm = nx + 1, cym = ny + 1, czm = nz + 1;

  // ---- 1. sample every grid corner once --------------------------------
  const values = new Float32Array(cxm * cym * czm).fill(NaN);
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const p = gridPoint(grid, i, j, k);
        values[(k * cym + j) * cxm + i] = field.field(p);
      }
    }
  }

  // ---- 2. interpolate + cache edge vertices ----------------------------
  // Canonical global edge id: base corner index * 3 + axis. The edge along
  // axis a starts at corner (i,j,k) and ends one cell along +a, so a cell that
  // shares the edge addresses the same id regardless of its local numbering.
  const edgeVertex = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const maxVerts = MC_MAX_VERTS;

  const cornerValue = (i: number, j: number, k: number): number =>
    values[cornerIndex(grid, i, j, k)]!;

  const vertexAt = (i: number, j: number, k: number, axis: 0 | 1 | 2): number => {
    const id = cornerIndex(grid, i, j, k) * 3 + axis;
    const cached = edgeVertex.get(id);
    if (cached !== undefined) return cached;
    const di = axis === 0 ? 1 : 0, dj = axis === 1 ? 1 : 0, dk = axis === 2 ? 1 : 0;
    const pa = gridPoint(grid, i, j, k);
    const pb = gridPoint(grid, i + di, j + dj, k + dk);
    const va = cornerValue(i, j, k);
    const vb = cornerValue(i + di, j + dj, k + dk);
    // Branchless-safe: |denom| floored so a zero-length crossing cannot NaN.
    const denom = va - vb;
    const t = denom === 0 ? 0.5 : Math.min(1, Math.max(0, va / denom));
    const p: Vec3 = [
      pa[0] + (pb[0] - pa[0]) * t,
      pa[1] + (pb[1] - pa[1]) * t,
      pa[2] + (pb[2] - pa[2]) * t,
    ];
    const idx = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    const n = fieldNormal(field.field, p, cell * 0.5);
    normals.push(n[0], n[1], n[2]);
    edgeVertex.set(id, idx);
    return idx;
  };

  // ---- 3. walk cells, emit table triangles -----------------------------
  const indices: number[] = [];
  let dropped = 0;
  let invalid = false;
  let invalidReason: string | undefined;
  const cubeIndex = new Uint8Array(8);
  // Local edge id -> canonical (base corner + axis of the GLOBAL edge).
  // Each entry is the CANONICAL base corner of the global edge (the endpoint
  // with the smaller coordinate along `axis`) plus the axis, so all cells
  // sharing an edge agree on the id. Base corner coordinates are relative to
  // the cell's (i,j,k).
  const localEdge: [number, number, number, 0 | 1 | 2][] = [
    // 0..3: the y = 0 face cycle 0-1-2-3
    [0, 0, 0, 0], // 0-1  +x
    [1, 0, 0, 2], // 1-2  +z
    [0, 0, 1, 0], // 2-3  +x (canonical base (0,0,1))
    [0, 0, 0, 2], // 3-0  +z
    // 4..7: the y = 1 face cycle 4-5-6-7
    [0, 1, 0, 0], // 4-5  +x
    [1, 1, 0, 2], // 5-6  +z
    [0, 1, 1, 0], // 6-7  +x (canonical base (0,1,1))
    [0, 1, 0, 2], // 7-4  +z
    // 8..11: the vertical (+y) edges
    [0, 0, 0, 1], // 0-4  +y
    [1, 0, 0, 1], // 1-5  +y
    [1, 0, 1, 1], // 2-6  +y
    [0, 0, 1, 1], // 3-7  +y
  ];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let ci = 0;
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const off = CORNER_OFFSETS[c]!;
          const v = cornerValue(i + off[0], j + off[1], k + off[2]);
          cubeIndex[c] = v;
          if (v < 0) neg |= 1 << c;
        }
        if (neg === 0 || neg === 0xff) continue;
        const edges = EDGE_TABLE[neg]!;
        if (edges === 0) continue; // table says no triangle for this pattern
        const row = TRI_TABLE[neg]!;
        for (let t = 0; t < 15 && row[t]! !== -1; t += 3) {
          const e0 = row[t]!, e1 = row[t + 1]!, e2 = row[t + 2]!;
          const l0 = localEdge[e0]!, l1 = localEdge[e1]!, l2 = localEdge[e2]!;
          const v0 = vertexAt(i + l0[0], j + l0[1], k + l0[2], l0[3]);
          const v1 = vertexAt(i + l1[0], j + l1[1], k + l1[2], l1[3]);
          const v2 = vertexAt(i + l2[0], j + l2[1], k + l2[2], l2[3]);
          if (MC_NEGATE_WINDING) indices.push(v0, v2, v1);
          else indices.push(v0, v1, v2);
          if (positions.length / 3 > maxVerts) {
            invalid = true;
            invalidReason = `vertex cap ${maxVerts} exceeded`;
            break;
          }
        }
        if (invalid) break;
      }
      if (invalid) break;
    }
    if (invalid) break;
  }

  const vertCount = positions.length / 3;
  if (vertCount === 0) {
    invalid = true;
    invalidReason = invalidReason ?? 'empty mesh (no sign changes in domain)';
  } else if (indices.length === 0) {
    invalid = true;
    invalidReason = invalidReason ?? 'no triangles emitted';
  } else {
    for (let i = 0; i < positions.length; i++) {
      if (!Number.isFinite(positions[i]!)) { invalid = true; invalidReason = 'non-finite position'; break; }
    }
    if (!invalid) for (let i = 0; i < normals.length; i++) {
      if (!Number.isFinite(normals[i]!)) { invalid = true; invalidReason = 'non-finite normal'; break; }
    }
  }

  return {
    method: 'marching-cubes',
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    fieldEvals: count(),
    grid,
    invalid,
    invalidReason,
    overflow: false,
    dropped,
  };
}

/**
 * Central-difference unit normal of the same field. Falls back to +Y for a
 * zero gradient so a normal is always finite and unit length.
 */
export function fieldNormal(f: (p: Vec3) => number, p: Vec3, h: number): Vec3 {
  const gx = f([p[0] + h, p[1], p[2]]) - f([p[0] - h, p[1], p[2]]);
  const gy = f([p[0], p[1] + h, p[2]]) - f([p[0], p[1] - h, p[2]]);
  const gz = f([p[0], p[1], p[2] + h]) - f([p[0], p[1], p[2] - h]);
  const l = Math.hypot(gx, gy, gz);
  if (!(l > 1e-12)) return [0, 1, 0];
  return [gx / l, gy / l, gz / l];
}

export { gridCornerCount };
