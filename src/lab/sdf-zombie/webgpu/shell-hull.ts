// src/lab/sdf-zombie/webgpu/shell-hull.ts
//
// CPU iso-surface extraction for the shell-march spike. Takes a scalar field
// (the signed distance `sdBody` minus the inflation iso) and emits a CLOSED,
// watertight triangle mesh of the inflated hull, ready to render into the
// entry/exit depth textures — closed because the front/back-face depth passes
// rely on the mesh having a consistent outside.
//
// WHY MARCHING TETRAHEDRA, NOT FULL MARCHING CUBES. The 256-case cube
// triangulation needs two ~256-entry lookup tables transcribed by hand, and a
// single wrong index silently tears a hole in the hull. Tetrahedra reduce a
// cube to six tets, each with only 16 cases that are trivial to enumerate, and
// the only real decision left — triangle winding — is made here by orientation
// against the field gradient, so the mesh is outward-facing without trusting a
// table. For a one-time, build-at-load hull the extra ~2x triangle count of
// tet decomposition costs nothing.
//
// WATERTIGHTNESS. The one trap in tet marching is pushing three NEW vertices
// per triangle, which yields an isolated-triangle soup (every edge appears
// once, so the mesh has a boundary everywhere). Crossing vertices are memoized
// per lattice EDGE, so every triangle that crosses the same edge reuses the
// same vertex index — that is what makes the surface watertight and the front
// faces / back faces partition correctly.
//
// The field convention: `field(p) < 0` is INSIDE. We extract the iso-surface
// `field(p) == 0`, so for the inflated hull the caller passes
// `p => sdBody(p, body) - iso` with iso = +0.03. The gradient points OUTWARD
// (toward increasing field), which winding is checked against.
//
// Since the field is the CPU twin of the GPU march and both come from the one
// `sdBody` (validate.ts), the hull cannot drift from the rendered surface.

export interface HullMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Number of vertices (floats / 3). */
  vertCount: number;
  /** Number of triangles. */
  triCount: number;
}

/** A single cube split into 6 tetrahedra along the 0-6 main diagonal, an
 *  orientation-preserving decomposition that tiles the cube and (crucially)
 *  triangulates every cube face consistently with its neighbour, so the
 *  surface closes. */
const CUBE_TETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

/** Field gradient by central differences — needs only the scalar field. */
function grad(field: (p: [number, number, number]) => number, p: [number, number, number]): [number, number, number] {
  const e = 0.01;
  const gx = field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]);
  const gy = field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]);
  const gz = field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]);
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (l < 1e-12) return [0, 1, 0];
  return [gx / l, gy / l, gz / l];
}

interface MutableStats {
  verts: number[];
  norms: number[];
  idx: number[];
}

/**
 * Extracts the iso-surface `field(p) == 0` over the AABB [min, max].
 *
 * `res` is the cell count along the LARGEST axis; the other two scale to keep
 * cells roughly cubic. Returns a flat Float32 position/normal array plus a
 * Uint32 index list. The mesh is closed and outward-oriented.
 */
export function buildHullMesh(
  field: (p: [number, number, number]) => number,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  res: number,
): HullMesh {
  const extent: [number, number, number] = [
    Math.max(1e-6, max[0] - min[0]),
    Math.max(1e-6, max[1] - min[1]),
    Math.max(1e-6, max[2] - min[2]),
  ];
  const largest = Math.max(extent[0], extent[1], extent[2]);
  const nx = Math.max(3, Math.round(res * (extent[0] / largest)));
  const ny = Math.max(3, Math.round(res * (extent[1] / largest)));
  const nz = Math.max(3, Math.round(res * (extent[2] / largest)));

  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const cornerCount = sx * sy * sz;
  const values = new Float32Array(cornerCount);
  const positions = new Float32Array(cornerCount * 3);
  for (let k = 0; k < sz; k++) {
    const z = min[2] + (extent[2] * k) / nz;
    for (let j = 0; j < sy; j++) {
      const y = min[1] + (extent[1] * j) / ny;
      for (let i = 0; i < sx; i++) {
        const x = min[0] + (extent[0] * i) / nx;
        const id = (k * sy + j) * sx + i;
        values[id] = field([x, y, z]);
        positions[id * 3] = x;
        positions[id * 3 + 1] = y;
        positions[id * 3 + 2] = z;
      }
    }
  }

  const stats: MutableStats = { verts: [], norms: [], idx: [] };
  const idx = (i: number, j: number, k: number) => (k * sy + j) * sx + i;

  // Memoised crossing vertex per lattice EDGE. Keyed by the two unordered
  // corner ids, so any two tets crossing the same edge share one vertex —
  // the property that makes the surface watertight.
  const vertCache = new Map<number, number>();
  function vertFor(a: number, b: number): number {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo * cornerCount + hi;
    const cached = vertCache.get(key);
    if (cached !== undefined) return cached;
    const av = values[lo]!, bv = values[hi]!;
    const t = (0 - av) / (bv - av); // linear interpolation to iso 0
    const ax = positions[lo * 3]!, ay = positions[lo * 3 + 1]!, az = positions[lo * 3 + 2]!;
    const bx = positions[hi * 3]!, by = positions[hi * 3 + 1]!, bz = positions[hi * 3 + 2]!;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    const pz = az + (bz - az) * t;
    const vid = stats.verts.length / 3;
    stats.verts.push(px, py, pz);
    const g = grad(field, [px, py, pz]);
    stats.norms.push(g[0], g[1], g[2]);
    vertCache.set(key, vid);
    return vid;
  }

  // Emit a triangle from three crossing vertex ids, orienting it outward via
  // the field gradient at the centroid (shared verts make winding consistent).
  function pushTri(v0: number, v1: number, v2: number) {
    const p0: [number, number, number] = [stats.verts[v0 * 3]!, stats.verts[v0 * 3 + 1]!, stats.verts[v0 * 3 + 2]!];
    const p1: [number, number, number] = [stats.verts[v1 * 3]!, stats.verts[v1 * 3 + 1]!, stats.verts[v1 * 3 + 2]!];
    const p2: [number, number, number] = [stats.verts[v2 * 3]!, stats.verts[v2 * 3 + 1]!, stats.verts[v2 * 3 + 2]!];
    const ab = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const ac = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n: [number, number, number] = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ];
    const cx = (p0[0] + p1[0] + p2[0]) / 3;
    const cy = (p0[1] + p1[1] + p2[1]) / 3;
    const cz = (p0[2] + p1[2] + p2[2]) / 3;
    const g = grad(field, [cx, cy, cz]);
    const flip = n[0]! * g[0]! + n[1]! * g[1]! + n[2]! * g[2]! < 0;
    if (flip) stats.idx.push(v0, v2, v1);
    else stats.idx.push(v0, v1, v2);
  }

  function emitTet(c: [number, number, number, number]) {
    const v: [number, number, number, number] = [values[c[0]!]!, values[c[1]!]!, values[c[2]!]!, values[c[3]!]!];
    const inside = [v[0] < 0, v[1] < 0, v[2] < 0, v[3] < 0];
    const count = inside.filter(Boolean).length;
    if (count === 0 || count === 4) return;

    if (count === 1 || count === 3) {
      const odd = inside.indexOf(count === 1);
      const others = [0, 1, 2, 3].filter((i) => i !== odd);
      const a = vertFor(c[odd]!, c[others[0]!]!);
      const b = vertFor(c[odd]!, c[others[1]!]!);
      const d = vertFor(c[odd]!, c[others[2]!]!);
      pushTri(a, b, d);
      return;
    }

    // count === 2: a quadrilateral on the four crossing edges. Shared verts
    // between the two triangles keep the diagonal crack-free.
    const ins = [0, 1, 2, 3].filter((i) => inside[i]);
    const outs = [0, 1, 2, 3].filter((i) => !inside[i]);
    const a = vertFor(c[ins[0]!]!, c[outs[0]!]!);
    const b = vertFor(c[ins[1]!]!, c[outs[0]!]!);
    const d = vertFor(c[ins[1]!]!, c[outs[1]!]!);
    const e = vertFor(c[ins[0]!]!, c[outs[1]!]!);
    pushTri(a, b, d);
    pushTri(a, d, e);
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const corner = [
          idx(i, j, k),
          idx(i + 1, j, k),
          idx(i + 1, j + 1, k),
          idx(i, j + 1, k),
          idx(i, j, k + 1),
          idx(i + 1, j, k + 1),
          idx(i + 1, j + 1, k + 1),
          idx(i, j + 1, k + 1),
        ];
        for (const tet of CUBE_TETS) {
          emitTet([corner[tet[0]!]!, corner[tet[1]!]!, corner[tet[2]!]!, corner[tet[3]!]!]);
        }
      }
    }
  }

  return {
    positions: new Float32Array(stats.verts),
    normals: new Float32Array(stats.norms),
    indices: new Uint32Array(stats.idx),
    vertCount: stats.verts.length / 3,
    triCount: stats.idx.length / 3,
  };
}
