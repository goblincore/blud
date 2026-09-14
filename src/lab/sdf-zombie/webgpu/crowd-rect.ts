// src/lab/sdf-zombie/webgpu/crowd-rect.ts
//
// Stage a-2 (3): the conservative screen rectangle one crowd type's quad must
// rasterise. The quad material is exact — every pixel inside it runs the same
// tile preload, sphere entry and discard the full-screen version did — but a
// full-screen quad pays the material's per-pixel INPUT setup (cone/occ/shell/
// prev fetches, record load, tile header read, MRT export) for 1280x800 pixels
// while a type with two visible bodies only needs their footprint. This
// computes that footprint on the CPU, in the same sync() that bins them.
//
// CONSERVATIVE, NOT EXACT: the rectangle is a rasterisation bound only. It is
// built from the same inflated spheres the tile binner projects — each body's
// box inflated by the type's blend reach plus both kernel slacks — with a
// one-tile NDC margin for the binner's clamp-outward-to-whole-tiles rule. Any
// pixel inside it is unchanged; any pixel outside it cannot contain a visible
// instance if the bound is sound, and the parity gate proves it pixel-for-pixel.

import * as THREE from 'three/webgpu';

export interface RectInput {
  centre: ArrayLike<number>;
  half: ArrayLike<number>;
}

/**
 * NDC rect `[x0, y0, x1, y1]` covering every inflated body box in `list`;
 * `null` when nothing is visible (the caller hides the mesh). Returns the full
 * screen `[-1, -1, 1, 1]` when any inflated box corner is behind the eye plane:
 * its projection is unbounded, so conservative means everything.
 *
 * `reach` inflates each box on every axis (the type's `maxBlendK * 4` plus the
 * kernel's `RAY_CULL_SLACK` and `QUAD_ENTRY_SLACK`). `marginNdc` is one tile in
 * NDC on each axis.
 */
export function crowdScreenRect(
  list: readonly RectInput[], viewProj: THREE.Matrix4, reach: number,
  marginNdc: [number, number],
): [number, number, number, number] | null {
  if (list.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const e = viewProj.elements;
  for (const it of list) {
    const c = it.centre, h = it.half;
    for (let k = 0; k < 8; k++) {
      const x = c[0]! + ((k & 1) ? 1 : -1) * (h[0]! + reach);
      const y = c[1]! + ((k & 2) ? 1 : -1) * (h[1]! + reach);
      const z = c[2]! + ((k & 4) ? 1 : -1) * (h[2]! + reach);
      const cw = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
      // Behind the eye plane (or on it): the projection is unbounded.
      if (cw <= 1e-6) return [-1, -1, 1, 1];
      const cx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / cw;
      const cy = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / cw;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
    }
  }
  x0 = Math.max(-1, x0 - marginNdc[0]);
  y0 = Math.max(-1, y0 - marginNdc[1]);
  x1 = Math.min(1, x1 + marginNdc[0]);
  y1 = Math.min(1, y1 + marginNdc[1]);
  if (x1 <= x0 || y1 <= y0) return null; // entirely off-screen
  return [x0, y0, x1, y1];
}
