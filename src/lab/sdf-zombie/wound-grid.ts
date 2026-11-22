// src/lab/sdf-zombie/wound-grid.ts
//
// THE CRATER GRID, pure half (`?woundgrid`; docs/superpowers/specs/2026-11-11-wound-crater-grid-design.md, stages
// 1 and 2). applyWounds reads every wound row of a body at every march step to find the few the sample is near.
// This is an index over them: a box round the body's wounds cut into near-cubic cells, each holding the indices of
// the wounds whose reach touches it, so a step loads its cell and walks those (march/fields/wound-grid.wgsl.ts).
// The wounds and their formula are untouched. With the index a body carries WG_MAX_WOUNDS wounds, not 32: a cell
// lists at most WG_CELL_MAX of them (the loops' bound), the body as many as its rows hold.
//
// In WORLD space, rebuilt whenever the wounds are uploaded (their posed positions are computed for that anyway). No
// renderer imports: positions in, texels out.
//
// WHERE IT LIVES: WG_ROWS rows added to the body's band under the switch (march/layout.ts DATA_ROWS), the first
// at band row WG_ROW0, 128 texels a row whatever the stride. Texels t = 0..:
//   t = 0     header: the box's minimum corner (world), w = nx + 16 ny + 256 nz (cells along each axis)
//   t = 1     header: cells a metre along x, y, z; w = 1 when the grid is live (0: walk the list's first rows)
//   t = 2..   the cells, x fastest: (offset into the index run, count)
//   then      the indices, WG_PER_TEXEL a texel (three 7-bit indices a channel: a float holds 24 bits exactly),
//             each cell's run in rising wound order (the carve chain is ordered)
import type { Vec3 } from './types';

/** Wounds a body carries under the switch (the wound rows' columns 0..127: every stride is at least 128). */
export const WG_MAX_WOUNDS = 128;
/** Wounds a cell lists: the shader loops' bound under the switch. Past it a cell keeps its NEWEST (a crater can
 *  then end at a cell's wall; it takes more than 64 wounds within reach of one 10 cm cell). */
export const WG_CELL_MAX = 64;
/** The band row the grid starts at (the band's row count without the switch) and the rows it takes. */
export const WG_ROW0 = 26;
export const WG_ROWS = 6;
export const WG_COLS = 128;
export const WG_TEXELS = WG_ROWS * WG_COLS;
/** Cells the table holds, and the most along one axis (4 bits in the header). */
export const WG_CELLS = 216;
export const WG_MAX_AXIS = 15;
/** Bits an index takes, indices a channel and a texel. */
export const WG_INDEX_BITS = 7;
export const WG_PER_CHANNEL = 3;
export const WG_PER_TEXEL = 12;
export const WG_CELL0 = 2;
export const WG_INDEX0 = WG_CELL0 + WG_CELLS;
/** Indices the grid can hold; when the cells need more, every cell's limit drops until they fit. */
export const WG_MAX_INDICES = (WG_TEXELS - WG_INDEX0) * WG_PER_TEXEL;

/** The texture row the grid starts at (absolute) and the texture's stride. */
export interface WoundGridLayout { gridRow: number; stride: number }

/** Float offset of grid texel `t` in the texel array. */
export function woundGridTexel(L: WoundGridLayout, t: number): number {
  return ((L.gridRow + Math.floor(t / WG_COLS)) * L.stride + (t % WG_COLS)) * 4;
}

/** How far from its centre a wound is listed, as a sample at or above the surface needs it, plus `slack`:
 *    the crater and its near flag ... 2 radii
 *    the rim ........................ its offset (scaled by the wound's own `offsetScale`) and two widths: past
 *                                     that the lip is under 2 % of its height
 *    the fillet ..................... the radius and 4 k (the smooth max is the plain max beyond that, at d = 0)
 *  The list itself allows 3 widths and 0.25 m more for samples deep in flesh; that is what makes this loose. */
export function woundGridReach(radius: number, blendK: number, rimOffset: number, rimWidth: number, slack: number, offsetScale = 1): number {
  return Math.max(2 * radius, radius * (rimOffset * offsetScale + 2 * rimWidth), radius + 4 * blendK) + slack;
}

export interface WoundGridStats { live: boolean; indices: number; maxCell: number; meanCell: number; clipped: number }

/** Build the grid for `count` wounds into `texels`. Returns what it wrote (live false: no wounds, no room in the
 *  texture; the header says so). `clipped` counts the entries cells past their limit lost. */
export function writeWoundGrid(
  texels: Float32Array, L: WoundGridLayout,
  positions: readonly Vec3[], radii: readonly number[], count: number,
  blendK: number, rimOffset: number, rimWidth: number, slack: number,
  offsetScales?: readonly number[],
): WoundGridStats {
  const off = (t: number) => woundGridTexel(L, t);
  const dead = (): WoundGridStats => { texels.fill(0, off(1), off(1) + 4); return { live: false, indices: 0, maxCell: 0, meanCell: 0, clipped: 0 }; };
  const n = Math.min(count, positions.length, radii.length, WG_MAX_WOUNDS);
  if (n <= 0 || L.stride < WG_COLS) return dead();
  const reach = new Float64Array(n);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    reach[i] = woundGridReach(radii[i]!, blendK, rimOffset, rimWidth, slack, offsetScales?.[i] ?? 1);
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c]!, positions[i]![c]! - reach[i]!); hi[c] = Math.max(hi[c]!, positions[i]![c]! + reach[i]!); }
  }
  // Near-cubic cells: the edge that would cut the box into WG_CELLS cubes, each axis rounded down to whole cells.
  const ext = [0, 0, 0], dims = [1, 1, 1], inv = [0, 0, 0];
  for (let c = 0; c < 3; c++) ext[c] = Math.max(hi[c]! - lo[c]!, 1e-3);
  const edge = Math.cbrt((ext[0]! * ext[1]! * ext[2]!) / WG_CELLS);
  for (let c = 0; c < 3; c++) { dims[c] = Math.max(1, Math.min(WG_MAX_AXIS, Math.floor(ext[c]! / edge))); inv[c] = dims[c]! / ext[c]!; }
  if (dims[0]! * dims[1]! * dims[2]! > WG_CELLS) return dead();
  // Each cell's wounds, in rising wound order. A wound is listed in every cell its reach SPHERE touches.
  const nCells = dims[0]! * dims[1]! * dims[2]!;
  const cells: number[][] = Array.from({ length: nCells }, () => []);
  for (let i = 0; i < n; i++) {
    const p = positions[i]!, r = reach[i]!;
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      a[c] = Math.max(0, Math.min(dims[c]! - 1, Math.floor((p[c]! - r - lo[c]!) * inv[c]!)));
      b[c] = Math.max(0, Math.min(dims[c]! - 1, Math.floor((p[c]! + r - lo[c]!) * inv[c]!)));
    }
    for (let z = a[2]!; z <= b[2]!; z++) for (let y = a[1]!; y <= b[1]!; y++) for (let x = a[0]!; x <= b[0]!; x++) {
      // The nearest point of the cell to the wound.
      let d2 = 0;
      const cell = [x, y, z];
      for (let c = 0; c < 3; c++) {
        const c0 = lo[c]! + cell[c]! / inv[c]!, c1 = lo[c]! + (cell[c]! + 1) / inv[c]!;
        const q = Math.max(c0, Math.min(c1, p[c]!)) - p[c]!;
        d2 += q * q;
      }
      if (d2 > r * r) continue;
      cells[x + dims[0]! * (y + dims[1]! * z)]!.push(i);
    }
  }
  // A cell lists WG_CELL_MAX at most: its newest (the highest indices; the ring is oldest first). When the runs
  // would not fit the index rows, the limit drops to what fits for every cell alike (never below 30: the rows
  // hold that for a full table).
  let total = 0, clipped = 0;
  const clip = (limit: number) => {
    total = 0;
    for (let ci = 0; ci < nCells; ci++) {
      const list = cells[ci]!;
      if (list.length > limit) { clipped += list.length - limit; cells[ci] = list.slice(list.length - limit); }
      total += cells[ci]!.length;
    }
  };
  clip(WG_CELL_MAX);
  if (total > WG_MAX_INDICES) clip(Math.floor(WG_MAX_INDICES / nCells));
  texels.set([lo[0]!, lo[1]!, lo[2]!, dims[0]! + 16 * dims[1]! + 256 * dims[2]!], off(0));
  texels.set([inv[0]!, inv[1]!, inv[2]!, 1], off(1));
  // The index texels this build uses start clean (a channel is built up by adding).
  for (let t = 0; t <= Math.floor(total / WG_PER_TEXEL); t++) if (WG_INDEX0 + t < WG_TEXELS) texels.fill(0, off(WG_INDEX0 + t), off(WG_INDEX0 + t) + 4);
  let at = 0, maxCell = 0;
  for (let ci = 0; ci < nCells; ci++) {
    const list = cells[ci]!;
    texels.set([at, list.length, 0, 0], off(WG_CELL0 + ci));
    for (let k = 0; k < list.length; k++) {
      const q = at + k, inTexel = q % WG_PER_TEXEL;
      texels[off(WG_INDEX0 + Math.floor(q / WG_PER_TEXEL)) + Math.floor(inTexel / WG_PER_CHANNEL)]! += list[k]! * 2 ** (WG_INDEX_BITS * (inTexel % WG_PER_CHANNEL));
    }
    at += list.length;
    if (list.length > maxCell) maxCell = list.length;
  }
  return { live: true, indices: total, maxCell, meanCell: total / nCells, clipped };
}

/** CPU twin of the shader's lookup: the wound indices a sample at `p` walks, or null when the grid is not live
 *  (walk the list). An empty array: outside the box, or a cell no wound reaches. */
export function woundGridLookup(texels: Float32Array, L: WoundGridLayout, p: Vec3): number[] | null {
  const off = (t: number) => woundGridTexel(L, t);
  if (!(texels[off(1) + 3]! > 0.5)) return null;
  const packed = Math.round(texels[off(0) + 3]!), dims = [packed & 15, (packed >> 4) & 15, (packed >> 8) & 15];
  const c = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const v = (p[k]! - texels[off(0) + k]!) * texels[off(1) + k]!;
    if (v < 0 || v >= dims[k]!) return [];
    c[k] = Math.floor(v);
  }
  const e = off(WG_CELL0 + c[0]! + dims[0]! * (c[1]! + dims[1]! * c[2]!));
  const at = Math.round(texels[e]!), cnt = Math.round(texels[e + 1]!);
  const out: number[] = [];
  for (let k = 0; k < cnt; k++) {
    const q = at + k, inTexel = q % WG_PER_TEXEL;
    const v = Math.round(texels[off(WG_INDEX0 + Math.floor(q / WG_PER_TEXEL)) + Math.floor(inTexel / WG_PER_CHANNEL)]!);
    out.push((v >> (WG_INDEX_BITS * (inTexel % WG_PER_CHANNEL))) & 127);
  }
  return out;
}

/** What a grid was built from: `count`, then (x, y, z, radius) a wound. */
export type WoundGridKey = Float64Array;

/** The grid built from `key` still serves these wounds: the same count and radii, and no wound further than `tol`
 *  from where it was. The listed reach carries a slack, so a grid built for wounds that have since moved less than
 *  the slack still lists every wound a sample can feel; the caller passes a fraction of the slack (a third: the
 *  rest stays as slack). A body that stands, or lies dead, then keeps its grid for many frames. */
export function woundGridFresh(key: WoundGridKey | null, positions: readonly Vec3[], radii: readonly number[], count: number, tol: number): boolean {
  const n = Math.min(count, positions.length, radii.length, WG_MAX_WOUNDS);
  if (!key || key[0] !== n) return false;
  const t2 = tol * tol;
  for (let i = 0; i < n; i++) {
    const o = 1 + i * 4, p = positions[i]!;
    if (key[o + 3] !== radii[i]) return false;
    const dx = p[0] - key[o]!, dy = p[1] - key[o + 1]!, dz = p[2] - key[o + 2]!;
    if (dx * dx + dy * dy + dz * dz > t2) return false;
  }
  return true;
}

/** The key of a build from these wounds (into `into` when it is given: no allocation a frame). */
export function woundGridKey(positions: readonly Vec3[], radii: readonly number[], count: number, into?: WoundGridKey | null): WoundGridKey {
  const n = Math.min(count, positions.length, radii.length, WG_MAX_WOUNDS);
  const key = into ?? new Float64Array(1 + WG_MAX_WOUNDS * 4);
  key[0] = n;
  for (let i = 0; i < n; i++) key.set([positions[i]![0], positions[i]![1], positions[i]![2], radii[i]!], 1 + i * 4);
  return key;
}

