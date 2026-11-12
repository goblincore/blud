// src/lab/sdf-zombie/wound-grid.ts
//
// THE CRATER GRID, pure half (`?woundgrid`; docs/superpowers/specs/2026-11-11-wound-crater-grid-design.md, stage 1:
// a spike over the list's own wounds). applyWounds reads every wound row of a body at every march step to find the
// one or two the sample is near. This is an index over them: a box round the body's wounds cut into
// WG_N x WG_N x WG_N cells, each holding the indices of the wounds whose reach touches it, so a step loads its cell
// and walks those (march/fields/wound-grid.wgsl.ts). The wounds and their formula are untouched.
//
// In WORLD space, rebuilt whenever the wounds are uploaded (their posed positions are computed for that anyway). No
// renderer imports: positions in, texels out.
//
// WHERE IT LIVES: the free columns of the body's own wound rows (the rows hold MAX_WOUNDS wounds in columns 0..31
// and the baked wound volume's table in 32..55 of four of them; the stride is at least 128). WG_TEXELS texels,
// numbered t = 0..:
//   t < 288   the wound, meta, cap and flags rows, columns 56..127 (72 a row, in that row order)
//   t >= 288  the cut row, columns 32..127
//   t = 0     header: the box's minimum corner (world), w = nx + 16 ny + 256 nz (cells along each axis: the box is
//             cut so the cells come out near cubes, WG_CELLS of them at most)
//   t = 1     header: cells a metre along x, y, z; w = 1 when the grid is live (0: walk the whole list)
//   t = 2..   the cells, x fastest: (offset into the index run, count)
//   then      the indices, WG_PER_TEXEL a texel (four 5-bit indices a channel: a float holds 24 bits exactly), each
//             cell's run in rising wound order (the carve chain is ordered)
import type { Vec3 } from './types';

/** Cells the table holds, and the most along one axis (4 bits in the header). */
export const WG_CELLS = 216;
export const WG_MAX_AXIS = 15;
/** Bits an index takes (MAX_WOUNDS is 32), and indices a texel. */
export const WG_INDEX_BITS = 5;
export const WG_PER_TEXEL = 16;
export const WG_A_COL = 56;
export const WG_A_COLS = 72;
export const WG_A_TEXELS = 4 * WG_A_COLS;
export const WG_B_COL = 32;
export const WG_B_COLS = 96;
export const WG_TEXELS = WG_A_TEXELS + WG_B_COLS;
export const WG_CELL0 = 2;
export const WG_INDEX0 = WG_CELL0 + WG_CELLS;
/** Indices the grid can hold; a body whose cells need more keeps no grid that frame (the whole list is walked). */
export const WG_MAX_INDICES = (WG_TEXELS - WG_INDEX0) * WG_PER_TEXEL;

/** The rows the grid's texels sit in (absolute rows of the texture) and the texture's stride. */
export interface WoundGridLayout { woundRow: number; metaRow: number; capRow: number; flagsRow: number; cutRow: number; stride: number }

/** Float offset of grid texel `t` in the texel array. */
export function woundGridTexel(L: WoundGridLayout, t: number): number {
  if (t < WG_A_TEXELS) {
    const row = [L.woundRow, L.metaRow, L.capRow, L.flagsRow][Math.floor(t / WG_A_COLS)]!;
    return (row * L.stride + WG_A_COL + (t % WG_A_COLS)) * 4;
  }
  return (L.cutRow * L.stride + WG_B_COL + (t - WG_A_TEXELS)) * 4;
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

export interface WoundGridStats { live: boolean; indices: number; maxCell: number; meanCell: number }

/** Build the grid for `count` wounds into `texels`. Returns what it wrote (live false: too many indices, or no
 *  room in the texture, and the header says so). */
export function writeWoundGrid(
  texels: Float32Array, L: WoundGridLayout,
  positions: readonly Vec3[], radii: readonly number[], count: number,
  blendK: number, rimOffset: number, rimWidth: number, slack: number,
  offsetScales?: readonly number[],
): WoundGridStats {
  const off = (t: number) => woundGridTexel(L, t);
  const dead = (): WoundGridStats => { texels.fill(0, off(1), off(1) + 4); return { live: false, indices: 0, maxCell: 0, meanCell: 0 }; };
  const n = Math.min(count, positions.length, radii.length);
  if (n <= 0 || L.stride < WG_A_COL + WG_A_COLS) return dead();
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
  let total = 0;
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
      total++;
    }
  }
  if (total > WG_MAX_INDICES) return dead();
  texels.set([lo[0]!, lo[1]!, lo[2]!, dims[0]! + 16 * dims[1]! + 256 * dims[2]!], off(0));
  // The index texels this build uses start clean (a channel is built up by adding).
  for (let t = 0; t <= (total >> 4); t++) if (WG_INDEX0 + t < WG_TEXELS) texels.fill(0, off(WG_INDEX0 + t), off(WG_INDEX0 + t) + 4);
  texels.set([inv[0]!, inv[1]!, inv[2]!, 1], off(1));
  let at = 0, maxCell = 0;
  for (let ci = 0; ci < nCells; ci++) {
    const list = cells[ci]!;
    texels.set([at, list.length, 0, 0], off(WG_CELL0 + ci));
    for (let k = 0; k < list.length; k++) {
      const q = at + k;
      texels[off(WG_INDEX0 + (q >> 4)) + ((q >> 2) & 3)]! += list[k]! * 2 ** (WG_INDEX_BITS * (q & 3));
    }
    at += list.length;
    if (list.length > maxCell) maxCell = list.length;
  }
  return { live: true, indices: total, maxCell, meanCell: total / nCells };
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
    const q = at + k;
    out.push((Math.round(texels[off(WG_INDEX0 + (q >> 4)) + ((q >> 2) & 3)]!) >> (WG_INDEX_BITS * (q & 3))) & 31);
  }
  return out;
}
