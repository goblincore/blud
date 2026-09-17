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
 * `null` when nothing is visible (the caller hides the mesh).
 *
 * NEAR-PLANE CLIP (2026-09-14). This used to return the full screen the moment
 * any inflated corner was behind the eye plane. On the owner's room-1
 * recording that was the whole cleared-room cost: one body 1.3 m from the
 * camera and OUTSIDE the view (the cull keeps its 1.1 m sphere) put the quad
 * over all 1280x800 pixels — 18 ms of march for nothing, where the per-body
 * proxy box rasterised off-screen for 0.1 ms. The projection of a box that
 * crosses the near plane is unbounded only for the part behind it; the part
 * in front is the convex polygon the near plane cuts, and its projection IS
 * bounded. So: corners in front project as before; every box edge that
 * crosses the plane contributes its intersection point; a box entirely
 * behind the plane contributes nothing. Still conservative — the clipped
 * polygon's projected AABB contains every visible pixel of the box — and the
 * parity gate proves it pixel-for-pixel.
 *
 * `reach` inflates each box on every axis (the type's `maxBlendK * 4` plus the
 * kernel's `RAY_CULL_SLACK` and `QUAD_ENTRY_SLACK`). `marginNdc` is one tile in
 * NDC on each axis.
 */
export function crowdScreenRect(
  list: readonly RectInput[], viewProj: THREE.Matrix4, reach: number,
  marginNdc: [number, number], zeroToOneDepth = false,
): [number, number, number, number] | null {
  if (list.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const e = viewProj.elements;
  const cx = new Float64Array(8), cy = new Float64Array(8), cw = new Float64Array(8);
  /** Signed clip-space distance in front of the near plane: GL depth puts the
   *  near plane at cz = -cw, WebGPU ([0,1]) at cz = 0. */
  const fz = new Float64Array(8);
  const front = new Uint8Array(8);
  const add = (nx: number, ny: number) => {
    if (nx < x0) x0 = nx;
    if (nx > x1) x1 = nx;
    if (ny < y0) y0 = ny;
    if (ny > y1) y1 = ny;
  };
  for (const it of list) {
    const c = it.centre, h = it.half;
    let nFront = 0;
    for (let k = 0; k < 8; k++) {
      const x = c[0]! + ((k & 1) ? 1 : -1) * (h[0]! + reach);
      const y = c[1]! + ((k & 2) ? 1 : -1) * (h[1]! + reach);
      const z = c[2]! + ((k & 4) ? 1 : -1) * (h[2]! + reach);
      cx[k] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      cy[k] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      const cz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      cw[k] = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
      fz[k] = zeroToOneDepth ? cz : cz + cw[k]!;
      front[k] = (fz[k]! > 1e-9 && cw[k]! > 1e-9) ? 1 : 0;
      if (front[k]) { nFront++; add(cx[k]! / cw[k]!, cy[k]! / cw[k]!); }
    }
    if (nFront === 0 || nFront === 8) continue; // nothing to clip
    // The 12 box edges join corners differing in exactly one bit; each edge
    // with one end in front and one behind meets the near plane once, and the
    // clip-space rows are affine along it.
    for (let a = 0; a < 8; a++) {
      for (const bit of [1, 2, 4]) {
        const b = a | bit;
        if (b === a || front[a] === front[b]) continue;
        const t = fz[a]! / (fz[a]! - fz[b]!);
        const iw = cw[a]! + (cw[b]! - cw[a]!) * t;
        if (iw <= 1e-9) continue;
        add((cx[a]! + (cx[b]! - cx[a]!) * t) / iw, (cy[a]! + (cy[b]! - cy[a]!) * t) / iw);
      }
    }
  }
  if (x0 === Infinity) return null; // every box behind the camera
  x0 = Math.max(-1, x0 - marginNdc[0]);
  y0 = Math.max(-1, y0 - marginNdc[1]);
  x1 = Math.min(1, x1 + marginNdc[0]);
  y1 = Math.min(1, y1 + marginNdc[1]);
  if (x1 <= x0 || y1 <= y0) return null; // entirely off-screen
  return [x0, y0, x1, y1];
}
