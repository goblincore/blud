// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-fragments.ts
//
// The sculpted skull in pieces: a head mesh's triangles sorted into ten named fragments by where they sit in the head's normalized box, for the head pop.

import { meshAppearanceCoord, type LocalBounds } from './mesh-appearance';
import type { Vec3 } from '../../types';

// THE SCULPTED SKULL HAS NO PLATES (the anatomical one is modelled in fourteen: anatomical-skull.ts). When a head pops
// (game-actor.ts popHead) its skull must still come apart, so the mesh that was being drawn is cut here into pieces
// that read as parts of a skull. The cut is by REGION of the head's own normalized box (-1..1 on each axis, +z the
// face, +y up: mesh-appearance.ts meshAppearanceCoord, the frame both sculpts and both paints use), one triangle at a
// time by its centroid, so every triangle belongs to exactly one fragment and the edges between fragments are the
// mesh's own triangle edges: ragged, like a break. Nothing here knows which sculpt or which cell the mesh came from.
//
// Pure (no three): the renderer builds a geometry from fragmentVertexData and throws it (mesh-renderer.ts
// explodeSkull). Only the pop uses it: a shot does not break a sculpted skull.

/** The fragments, in the order partitionSculptMesh returns them. `-r` is the head's own right (x < 0: the face sheet's
 *  image-left eye is the zombie's right eye, head-eye.ts), `-l` its left. */
export const SCULPT_FRAGMENT_IDS = [
  'frontal', 'parietal-l', 'parietal-r', 'temporal-l', 'temporal-r', 'occipital', 'face-l', 'face-r', 'maxilla', 'mandible',
] as const;
export type SculptFragmentId = (typeof SCULPT_FRAGMENT_IDS)[number];

/** Where the cuts run, in the head's normalized coordinates. The bite line and the tooth rows are the sculpts' own
 *  (mesh-skull-2.ts SKULL2_FACE.teeth: the upper tips at y -0.345, the lower at -0.415). */
export const SCULPT_FRAGMENT_CUTS = {
  /** The parting of the jaws: under it is the lower jaw. */
  bite: -0.38,
  /** Under the bite line, behind this depth, the bone is the skull's base, not the jaw. */
  jawBack: -0.35,
  /** In front of this the bone is the face; behind `back` it is the back of the head; between them, the vault. */
  face: 0.3, back: -0.5,
  /** The face above this height is the brow and the forehead. */
  brow: 0.4,
  /** The upper jaw: the face under this height, within this half-width of the middle. */
  maxillaTop: -0.1, maxillaHalfW: 0.55,
  /** The vault above this height is the top of the cranium (the parietals), under it the temples. */
  temple: 0.25,
} as const;

/** The fragment that owns the head's point `q` (normalized coordinates). */
export function sculptFragmentAt(q: Vec3): SculptFragmentId {
  const C = SCULPT_FRAGMENT_CUTS, [x, y, z] = q;
  const side = x < 0 ? 'r' : 'l';
  if (y < C.bite) return z > C.jawBack ? 'mandible' : 'occipital';
  if (z < C.back) return 'occipital';
  if (z > C.face) {
    if (y >= C.brow) return 'frontal';
    return y < C.maxillaTop && Math.abs(x) < C.maxillaHalfW ? 'maxilla' : `face-${side}`;
  }
  return y >= C.temple ? `parietal-${side}` : `temporal-${side}`;
}

export interface SculptFragment {
  id: SculptFragmentId;
  /** The fragment's triangles: vertex indices into the mesh it was cut from, three a triangle. */
  indices: Uint32Array;
  /** Its centre, the mean of its triangles' centroids weighted by their areas (the mesh's own frame, metres): what it
   *  is thrown from and turns about. */
  pivot: Vec3;
  /** Its box (the mesh's own frame, metres). */
  min: Vec3;
  max: Vec3;
  /** Its surface, m². */
  area: number;
}

/** Cut a head mesh into its fragments: `positions` (three floats a vertex) and `indices` (three a triangle) are the
 *  mesh's, `bounds` the head segment's box, which normalizes the coordinates. Every triangle goes to the fragment
 *  that owns its centroid. All ten fragments come back, in SCULPT_FRAGMENT_IDS order; one with no triangle has an
 *  empty index list and its pivot at the box's centre. */
export function partitionSculptMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, bounds: LocalBounds): SculptFragment[] {
  const lists = new Map<SculptFragmentId, number[]>(SCULPT_FRAGMENT_IDS.map(id => [id, []]));
  type Triple = [number, number, number];
  const sums = new Map<SculptFragmentId, { c: Triple; area: number; min: Triple; max: Triple }>(SCULPT_FRAGMENT_IDS.map(id => [
    id, { c: [0, 0, 0], area: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
  ]));
  const vertex = (i: number): Vec3 => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t]!, ib = indices[t + 1]!, ic = indices[t + 2]!;
    const a = vertex(ia), b = vertex(ib), c = vertex(ic);
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const id = sculptFragmentAt(meshAppearanceCoord(bounds, centroid));
    lists.get(id)!.push(ia, ib, ic);
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    const s = sums.get(id)!;
    s.area += area;
    for (let k = 0; k < 3; k++) {
      s.c[k]! += centroid[k]! * area;
      s.min[k] = Math.min(s.min[k]!, a[k]!, b[k]!, c[k]!);
      s.max[k] = Math.max(s.max[k]!, a[k]!, b[k]!, c[k]!);
    }
  }
  const mid: Vec3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  return SCULPT_FRAGMENT_IDS.map((id) => {
    const s = sums.get(id)!, list = lists.get(id)!;
    const some = list.length > 0 && s.area > 0;
    return {
      id, indices: Uint32Array.from(list), area: s.area,
      pivot: some ? [s.c[0] / s.area, s.c[1] / s.area, s.c[2] / s.area] : mid,
      min: some ? s.min : mid, max: some ? s.max : mid,
    };
  });
}

/** A fragment's own vertex data, for a geometry of its own: the vertices its triangles use, renumbered in the order
 *  they are first met, with each of the mesh's per-vertex `attributes` (its array and how many floats a vertex)
 *  carried over. The positions are NOT moved: the paint reads them in the head's own frame. */
export function fragmentVertexData(
  fragment: Pick<SculptFragment, 'indices'>, attributes: Readonly<Record<string, { array: ArrayLike<number>; itemSize: number }>>,
): { index: Uint32Array; attributes: Record<string, Float32Array>; count: number } {
  const remap = new Map<number, number>(), order: number[] = [];
  const index = new Uint32Array(fragment.indices.length);
  for (let i = 0; i < fragment.indices.length; i++) {
    const v = fragment.indices[i]!;
    let n = remap.get(v);
    if (n === undefined) { n = order.length; remap.set(v, n); order.push(v); }
    index[i] = n;
  }
  const out: Record<string, Float32Array> = {};
  for (const [name, { array, itemSize }] of Object.entries(attributes)) {
    const data = new Float32Array(order.length * itemSize);
    order.forEach((v, n) => { for (let k = 0; k < itemSize; k++) data[n * itemSize + k] = array[v * itemSize + k]!; });
    out[name] = data;
  }
  return { index, attributes: out, count: order.length };
}
