// src/lab/sdf-zombie/webgpu/door-leaf-geometry.ts
//
// THE DOOR LEAVES' MESH DATA (game-doors.ts draws them): a split door (sector-doors.ts) has two leaves,
// slabs that fill the doorway between its faces (inset LEAF_INSET_M from each face plane, so they
// never fight the room walls the faces continue) from the sector floor to just under the lintel. Shut
// they meet on the centre; open each has slid width / 2 into its jamb. The shader moves them: every
// vertex carries `slide`, its leaf's full travel (metres, along a -> b), scaled by the door's open
// fraction.
//
// A door is drawn as TWO meshes, one per side, so each is lit by its own zone's light list: side k
// holds the big leaf faces that look into zones[k] (beyond faces[k]); side 0 also holds the leading
// edges (seen through a part-open door). The jamb ends, tops and bottoms are never seen and are not
// made. UVs lay the leaf texture (panel-textures.ts slideDoor) once per leaf face, u from the jamb (0)
// to the leading edge (1), v floor (0) to top (1); the leading edge's narrow face takes the texture's
// hazard strip. `mottleUv` is the world-projected grime coordinate (metres / 4, as the walls).
//
// Pure: no three.js, no DOM.

import type { SectorDoorDef } from './sector-def';
import { doorLocal } from './sector-doors';

/** How far each leaf face sits inside its face plane (metres). */
export const LEAF_INSET_M = 0.02;
/** How far the leaves' top stays under the doorway's ceiling (metres). */
export const LEAF_TOP_GAP_M = 0.004;
/** Where the hazard strip starts in the leaf texture's u (its last 44 of 512 px). */
export const LEAF_STRIP_U = 1 - 44 / 512;
const MOTTLE_TILE_M = 4;

export interface LeafMeshData {
  position: number[];
  normal: number[];
  uv: number[];
  mottleUv: number[];
  slide: number[];
  /** Vertices (position.length / 3). */
  count: number;
}

type V3 = [number, number, number];

/** Side `side`'s mesh data for door `def` standing on `floor`. */
export function doorLeafMesh(def: SectorDoorDef, side: 0 | 1, floor: number, faceSigns: readonly [number, number]): LeafMeshData {
  const W = def.width;
  const tx = (def.b[0] - def.a[0]) / W, tz = (def.b[1] - def.a[1]) / W;
  const nx = -tz, nz = tx;                                   // left of a -> b
  const halfD = Math.max(0.01, def.depth / 2 - LEAF_INSET_M);
  const y0 = floor, y1 = floor + def.height - LEAF_TOP_GAP_M;
  const out: LeafMeshData = { position: [], normal: [], uv: [], mottleUv: [], slide: [], count: 0 };
  const at = (u: number, w: number, y: number): V3 => [def.a[0] + tx * u * W + nx * w, y, def.a[1] + tz * u * W + nz * w];
  /** One quad: corners in any order round it, flipped to face `n`. */
  const quad = (p: V3[], uv: [number, number][], muv: [number, number][], n: V3, slide: V3) => {
    const [a, b, c] = p as [V3, V3, V3];
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const tris = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of tris) {
      out.position.push(...p[i]!); out.normal.push(...n); out.uv.push(...uv[i]!); out.mottleUv.push(...muv[i]!); out.slide.push(...slide);
      out.count++;
    }
  };
  for (const leaf of [0, 1] as const) {
    // Leaf 0 covers u 0..0.5 and slides toward a; leaf 1 covers 0.5..1 and slides toward b.
    const uJamb = leaf === 0 ? 0 : 1, uLead = 0.5;
    const sgn = leaf === 0 ? -1 : 1;
    const slide: V3 = [tx * sgn * W / 2, 0, tz * sgn * W / 2];
    const s = faceSigns[side];                               // this side's faces look along s · n
    const w = s * halfD;
    const n: V3 = [nx * s, 0, nz * s];
    const m = (u: number, y: number): [number, number] => [(u * W) / MOTTLE_TILE_M, y / MOTTLE_TILE_M];
    quad([at(uJamb, w, y0), at(uLead, w, y0), at(uLead, w, y1), at(uJamb, w, y1)],
      [[0, 0], [1, 0], [1, 1], [0, 1]], [m(uJamb, y0), m(uLead, y0), m(uLead, y1), m(uJamb, y1)], n, slide);
    if (side === 0) {
      // The leading edge faces the other leaf (toward u 0.5 from this leaf's side).
      const e: V3 = [-tx * sgn, 0, -tz * sgn];
      quad([at(uLead, -halfD, y0), at(uLead, halfD, y0), at(uLead, halfD, y1), at(uLead, -halfD, y1)],
        [[LEAF_STRIP_U, 0], [1, 0], [1, 1], [LEAF_STRIP_U, 1]],
        [m(uLead, y0), [(uLead * W + 2 * halfD) / MOTTLE_TILE_M, y0 / MOTTLE_TILE_M], [(uLead * W + 2 * halfD) / MOTTLE_TILE_M, y1 / MOTTLE_TILE_M], m(uLead, y1)], e, slide);
    }
  }
  return out;
}

/** The sign of each face's side of a -> b (+1 left, -1 right): side k's leaf faces look that way. */
export function doorFaceSigns(def: SectorDoorDef, faceMids: readonly [[number, number], [number, number]]): [number, number] {
  const s = faceMids.map(([x, z]) => (doorLocal(def, x, z)[1] >= 0 ? 1 : -1)) as [number, number];
  // Degenerate (both on one side, a file error the parser already refuses): keep them opposite.
  if (s[0] === s[1]) s[1] = -s[0];
  return s;
}
