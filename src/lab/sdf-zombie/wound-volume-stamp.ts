// src/lab/sdf-zombie/wound-volume-stamp.ts
//
// THE BAKED WOUND VOLUME, pure half (`?woundvol`; docs/superpowers/specs/2026-11-11-baked-wound-volume-design.md,
// "Revision 2"). A body keeps its newest MAX_WOUNDS wounds on the exact list. A crater that leaves the list is
// STAMPED into a small voxel box that rides its primitive, shape and colour, and the march reads that box before
// it walks the list (march/fields/wound-volume.wgsl.ts). No renderer imports: boxes in, bytes out.
//
// WHAT A VOXEL HOLDS (8 bits a value):
//   shape  r  the carve chain WITH the rim bumps, run from deep inside the flesh
//          g  the sum of the rim bumps
//          b  the largest bump amplitude
//          a  the carve chain WITHOUT the bumps
//   colour r  the wound mask (woundMask's `m`: 0 on healthy skin, 1 deep inside)
//          g  its cavity share
//          b  the torn / wet red lip footprint
//          a  the wet-only footprint
// The read is `smax(d - gate * g, mix(a, r, gate))`, gate = 1 - smoothstep(-b * 0.3, b * 0.7, dIn): what the list
// returns, with the bumps' gate (full inside the body, none outside) taken out of the bake.
//
// A stamp is an UPDATE of the old values (a later crater cuts an earlier rim, so it is not a max), and wounds are
// only ever appended: r' = smax(r, carve) - bump, a' = smax(a, carve), g' = g + bump, b' = max(b, amp).
//
// A stamped crater is the round crater of applyWounds (march/fields/wounds.wgsl.ts): its sphere, its depth cap, its
// rim. The ragged and torn edges' noise is left out, and so are cuts, decals and cloth holes (they are never stamped).
import type { Vec3 } from './types';
import { smax } from './validate';

/** Chain values at or below this carve nothing. The fillet only moves the field where the chain is within k (1.5 cm)
 *  of it, and the near flag reads WV_NEAR; every centimetre of floor is a centimetre of reach, and the reach cubed is
 *  what a crater costs in the atlas (it was -0.12: two bodies filled the atlas). */
export const WV_FLOOR = -0.06;
/** The march's near-a-wound flag is raised where the chain without bumps is above this (the list's is r < 2 depth). */
export const WV_NEAR = -0.05;
/** Metres a step of a chain byte, and of a bump byte. */
export const WV_CHAIN_STEP = 0.001;
export const WV_BUMP_STEP = 0.00025;
/** How far past a primitive's capsule its box reaches: outside the skin only a crater's lip matters (a few
 *  centimetres), and its colour. */
export const WV_MARGIN = 0.07;
/** woundMask's footprint, in radii. */
export const WV_MASK_REACH = 1.6;

export interface PrimVolume {
  /** Voxels a side. The outermost layer is never written, so a clamped read past the box finds nothing. */
  dims: [number, number, number];
  /** The box's minimum corner in the primitive's wound frame (metres), and the voxel's edge. */
  min: Vec3;
  voxel: number;
  shape: Uint8Array;
  colour: Uint8Array;
}

export interface StampCrater {
  /** In the volume's frame (the same frame as `PrimVolume.min`). */
  centre: Vec3;
  radius: number;
  /** The carve's depth: the radius, or a burn's shallower dish. */
  depth: number;
  /** The depth cap: inward unit normal in the volume's frame and metres below the anchor. Absent = the plain sphere. */
  capN?: Vec3;
  capDepth?: number;
  /** woundCfg.y, woundCfg.w * the wound's offset scale, woundCfg2.x, and the lip's height (metres). */
  blendK: number;
  rimOffset: number;
  rimWidth: number;
  rimAmp: number;
  cavity?: boolean;
  /** Torn or wet-lip shading (flags bits 3 and 4), and the wet-only case (bit 4 alone). */
  tear?: boolean;
  wetOnly?: boolean;
}

export function createPrimVolume(lo: Vec3, hi: Vec3, voxel: number): PrimVolume {
  const dims: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) dims[c] = Math.max(3, Math.ceil((hi[c]! - lo[c]!) / voxel) + 2);
  const n = dims[0] * dims[1] * dims[2];
  return { dims, min: [lo[0] - voxel, lo[1] - voxel, lo[2] - voxel], voxel, shape: new Uint8Array(n * 4), colour: new Uint8Array(n * 4) };
}

const byte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
export const chainByte = (m: number) => byte((m - WV_FLOOR) / WV_CHAIN_STEP);
export const chainOf = (b: number) => WV_FLOOR + b * WV_CHAIN_STEP;
export const bumpByte = (m: number) => byte(m / WV_BUMP_STEP);
export const bumpOf = (b: number) => b * WV_BUMP_STEP;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How far from its centre a crater can change a voxel. */
export function stampReach(c: StampCrater): number {
  const carve = c.depth - WV_FLOOR;                                   // the chain leaves the floor inside this
  const rim = c.depth * (c.rimOffset + 2.2 * c.rimWidth);             // exp(-4.8) of the lip: under 1 %
  return Math.max(carve, rim, c.radius * WV_MASK_REACH);
}

/** Stamp one crater. Returns the voxel box it touched ([lo, hi] inclusive), or null when it missed the volume. */
export function stampCrater(v: PrimVolume, c: StampCrater): { lo: [number, number, number]; hi: [number, number, number] } | null {
  const reach = stampReach(c);
  const lo: [number, number, number] = [0, 0, 0], hi: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    // The outermost layer stays empty.
    lo[k] = Math.max(1, Math.floor((c.centre[k]! - reach - v.min[k]!) / v.voxel - 0.5));
    hi[k] = Math.min(v.dims[k]! - 2, Math.ceil((c.centre[k]! + reach - v.min[k]!) / v.voxel - 0.5));
    if (hi[k]! < lo[k]!) return null;
  }
  const kW = c.blendK * Math.min(1, Math.max(0.1, c.radius / 0.05));
  const capped = !!c.capN && (c.capDepth ?? 0) > 0;
  const rimW = Math.max(c.depth * c.rimWidth, 1e-4);
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
    const px = v.min[0] + (x + 0.5) * v.voxel - c.centre[0], py = v.min[1] + (y + 0.5) * v.voxel - c.centre[1], pz = v.min[2] + (z + 0.5) * v.voxel - c.centre[2];
    const r = Math.hypot(px, py, pz);
    if (r > reach) continue;
    const o = ((z * v.dims[1] + y) * v.dims[0] + x) * 4;
    let carve = c.depth - r;
    if (capped) carve = Math.min(carve, c.capDepth! - (px * c.capN![0] + py * c.capN![1] + pz * c.capN![2]));
    const rx = (r - c.depth * c.rimOffset) / rimW;
    const bump = Math.exp(-rx * rx) * c.rimAmp;
    v.shape[o] = chainByte(smax(chainOf(v.shape[o]!), carve, kW) - bump);
    v.shape[o + 3] = chainByte(smax(chainOf(v.shape[o + 3]!), carve, kW));
    v.shape[o + 1] = bumpByte(bumpOf(v.shape[o + 1]!) + bump);
    if (bump > WV_BUMP_STEP * 0.5) v.shape[o + 2] = Math.max(v.shape[o + 2]!, bumpByte(c.rimAmp));
    const m = byte(255 * (1 - smoothstep(0, c.radius * WV_MASK_REACH, r)));
    if (m > v.colour[o]!) v.colour[o] = m;
    if (c.cavity && m > v.colour[o + 1]!) v.colour[o + 1] = m;
    if (c.tear && m > v.colour[o + 2]!) v.colour[o + 2] = m;
    if (c.wetOnly && m > v.colour[o + 3]!) v.colour[o + 3] = m;
  }
  return { lo, hi };
}

/** CPU twin of the shader's read (wvRead in march/fields/wound-volume.wgsl.ts): tetrahedral over four of the eight
 *  texels round `local` (the corners walked along t's largest, middle and smallest axes), decoded. Null outside the
 *  box. */
export function sampleVolume(v: PrimVolume, local: Vec3, which: 'shape' | 'colour' = 'shape'): [number, number, number, number] | null {
  const g: number[] = [0, 0, 0], i0: number[] = [0, 0, 0], f: number[] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    g[k] = (local[k]! - v.min[k]!) / v.voxel - 0.5;
    if (g[k]! < 0 || g[k]! > v.dims[k]! - 1) return null;
    i0[k] = Math.min(v.dims[k]! - 2, Math.floor(g[k]!));
    f[k] = g[k]! - i0[k]!;
  }
  const src = which === 'shape' ? v.shape : v.colour;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  // Axes by falling t (ties as the shader breaks them: x before y before z).
  const order = [0, 1, 2].sort((p, q) => f[q]! - f[p]! || p - q);
  const at = [0, 0, 0];
  const weights = [1 - f[order[0]!]!, f[order[0]!]! - f[order[1]!]!, f[order[1]!]! - f[order[2]!]!, f[order[2]!]!];
  for (let n = 0; n < 4; n++) {
    if (n > 0) at[order[n - 1]!] = 1;
    const o = (((i0[2]! + at[2]!) * v.dims[1] + i0[1]! + at[1]!) * v.dims[0] + i0[0]! + at[0]!) * 4;
    for (let c = 0; c < 4; c++) out[c] = out[c]! + weights[n]! * src[o + c]!;
  }
  if (which === 'colour') return [out[0] / 255, out[1] / 255, out[2] / 255, out[3] / 255];
  return [chainOf(out[0]), bumpOf(out[1]), bumpOf(out[2]), chainOf(out[3])];
}

/** CPU twin of the shader's use of a shape sample: the field after this volume's craters. */
export function applyVolumeSample(d: number, dIn: number, s: [number, number, number, number], blendK: number): number {
  if (s[3] < WV_FLOOR + 0.002 && s[1] < 1e-5) return d;
  // No lip here: the gate has nothing to scale, and equal smoothstep edges are undefined.
  const amp = Math.max(s[2], 1e-6);
  const gate = 1 - smoothstep(-amp * 0.3, amp * 0.7, dIn);
  const chain = s[3] + (s[0] - s[3]) * gate;
  const bumped = d - s[1] * gate;
  return chain > WV_FLOOR + 0.002 ? smax(bumped, chain, blendK) : bumped;
}
