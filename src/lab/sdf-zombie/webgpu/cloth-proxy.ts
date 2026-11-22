// src/lab/sdf-zombie/webgpu/cloth-proxy.ts
//
// THE RASTERISED CLOTH PROXY (SDF-cloth cost spike, option 1, 2026-10-26; docs/dev-notes/2026-10-26-sdf-cloth-cost/).
//
// The spike measured a robe's march cost as STEPS, not prims: rays that the outer hull's sphere chain marches around
// the robe's silhouette and that then miss (46% of the robe's extra walk), and robe hits that start far out. Spheres
// cannot hug a 0.6 m wide cone. This file gives each shell prim a closed triangle mesh fitted to its own round cone,
// drawn into the outer hull's entry/exit targets (shell-hull-outer.ts) IN PLACE of that shell's sphere chain, so a ray
// starts a few centimetres from the cloth and a pixel the cloth does not cover is never marched.
//
// CONTAINMENT, the one property that matters (an outer hull with a gap is a hole in the render):
//   * The solid. A shell's sheet lies inside its closed base prim grown by the shell's reach (thickness + warp
//     amplitude), and the fold's blend, the silhouette noise and the margin push the surface out by at most `pad` —
//     the same `reach` terms the sphere chain uses. The base prim is bounded the way that chain bounds it: a round
//     cone on the posed a-b axis with radii ra*maxScale and rb*maxScale. So the solid is inside the round cone with
//     radii R = r*maxScale + pad, which is the union of the balls B(c(t), R(t)) with linearly interpolated centre and
//     radius (the convex hull of the two end balls).
//   * The mesh. It is the round cone grown by a factor k and tessellated with its vertices ON the grown surface:
//     an inscribed polyhedron whose every face is within angle rho (the largest facet's angular circumradius) of the
//     grown surface, so the faces stand at least k*R*cos(rho) from the axis/centre. k = 1/cos(rho) puts every face
//     outside the true round cone. rho is computed from the actual band and segment angles of each prim.
// Both are pinned by cloth-proxy.test.ts (points of the true round cone against every face plane of the convex mesh).

import type { Vec3 } from '../types';

/** Segments around the axis. */
export const PROXY_SEGMENTS = 24;
/** Latitude bands per end cap (the side is the one band between the caps' tangent rings). */
export const PROXY_CAP_BANDS = 8;
/** Rings per proxy: each cap runs from its pole ring to its tangent ring, BANDS + 1 rings. */
export const PROXY_RINGS = 2 * (PROXY_CAP_BANDS + 1);
export const PROXY_VERTS = PROXY_RINGS * PROXY_SEGMENTS;
/** Triangles per proxy: two per quad between consecutive rings (the pole rings' quads degenerate harmlessly). */
export const PROXY_TRIS = (PROXY_RINGS - 1) * PROXY_SEGMENTS * 2;

/** One shell's proxy: the round cone a-b, radius ra at a and rb at b, already grown by the reach pad. */
export interface ProxyCone { a: Vec3; b: Vec3; ra: number; rb: number }

/**
 * The triangle list shared by every proxy (vertex indices relative to the proxy's first vertex). Winding is
 * counter-clockwise seen from OUTSIDE, so FrontSide is the entry and BackSide the exit, as for the hull spheres.
 */
export function proxyIndices(): number[] {
  const out: number[] = [];
  for (let j = 0; j + 1 < PROXY_RINGS; j++) {
    for (let i = 0; i < PROXY_SEGMENTS; i++) {
      const i1 = (i + 1) % PROXY_SEGMENTS;
      const p00 = j * PROXY_SEGMENTS + i, p01 = j * PROXY_SEGMENTS + i1;
      const p10 = (j + 1) * PROXY_SEGMENTS + i, p11 = (j + 1) * PROXY_SEGMENTS + i1;
      out.push(p00, p11, p10, p00, p01, p11);
    }
  }
  return out;
}

/**
 * Writes one proxy's PROXY_VERTS positions into `out` at float offset `o`. Rings run from the pole of the a-cap
 * (the end away from b) to the pole of the b-cap. Returns the growth factor k it used (for tests).
 */
export function writeProxyCone(c: ProxyCone, out: Float32Array, o: number): number {
  let ux = c.b[0] - c.a[0], uy = c.b[1] - c.a[1], uz = c.b[2] - c.a[2];
  let L = Math.hypot(ux, uy, uz);
  let { ra, rb } = c;
  let a = c.a;
  // A degenerate axis, or one end ball swallowing the other: the proxy is the bigger ball.
  if (L < 1e-6 || Math.abs(ra - rb) >= L) {
    if (L >= 1e-6 && rb > ra) a = c.b;
    ra = rb = Math.max(ra, rb);
    ux = 0; uy = 1; uz = 0; L = 0;
  } else { ux /= L; uy /= L; uz /= L; }
  // A basis (v, w) perpendicular to u.
  const hx = Math.abs(ux) < 0.9 ? 1 : 0, hy = hx ? 0 : 1;
  let vx = uy * 0 - uz * hy, vy = uz * hx - ux * 0, vz = ux * hy - uy * hx;
  const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
  const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
  // The side's normal leans toward b by psi: sin(psi) = (Ra - Rb) / L on the GROWN cone (0 for a ball). The bands'
  // angles depend on psi and the growth k on the bands, so the pair is iterated to agreement (k only grows).
  const dTh = (2 * Math.PI) / PROXY_SEGMENTS;
  let k = 1, psiK = 0;
  for (let it = 0; it < 4; it++) {
    psiK = L > 0 ? Math.asin(Math.max(-1, Math.min(1, (ra - rb) * k / L))) : 0;
    const dLat = Math.max(psiK + Math.PI / 2, Math.PI / 2 - psiK) / PROXY_CAP_BANDS;
    // The largest facet's angular circumradius: half the diagonal of the biggest cell. The side band's facets are
    // inset by at most cos(dTh / 2), which this covers.
    k = Math.max(k, 1 / Math.cos(0.5 * Math.hypot(dLat, dTh)));
  }
  psiK = L > 0 ? Math.asin(Math.max(-1, Math.min(1, (ra - rb) * k / L))) : 0;
  const Ra = ra * k, Rb = rb * k;
  let n = o;
  for (let j = 0; j < PROXY_RINGS; j++) {
    const capA = j <= PROXY_CAP_BANDS;
    const lat = capA
      ? -Math.PI / 2 + (j * (psiK + Math.PI / 2)) / PROXY_CAP_BANDS
      : psiK + ((j - PROXY_CAP_BANDS - 1) * (Math.PI / 2 - psiK)) / PROXY_CAP_BANDS;
    const R = capA ? Ra : Rb;
    const cx = capA ? a[0] : a[0] + ux * L, cy = capA ? a[1] : a[1] + uy * L, cz = capA ? a[2] : a[2] + uz * L;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < PROXY_SEGMENTS; i++) {
      const th = i * dTh, ct = Math.cos(th), st = Math.sin(th);
      const rx = vx * ct + wx * st, ry = vy * ct + wy * st, rz = vz * ct + wz * st;
      out[n++] = cx + R * (cl * rx + sl * ux);
      out[n++] = cy + R * (cl * ry + sl * uy);
      out[n++] = cz + R * (cl * rz + sl * uz);
    }
  }
  return k;
}
