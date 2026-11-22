// src/lab/sdf-zombie/body-field.ts
//
// FAST CPU BODY FIELDS for the shot path (shot frame pass, 2026-10-29). Pure: no renderer.
//
// A double-barrel blast is 20 pellets, and every one of them asks the CPU body field (validate.ts sdBody, ~10 µs a
// fold on the zombie) dozens of times: the projectile trace substeps the frame's 2.7 m segment at 5 cm (54 folds and
// a bisection, per pellet per body in reach), and each hit's wound probes (damage.ts rimScaleFor / probeFlesh) fold it
// ~35 more. Measured on the shot frame: 880-1540 trace folds (8-15 ms, more on a sector level, whose first step
// starts at the eye) and ~700 probe folds (7 ms). Two ways to fold less, both behind `?shotfix=0`:
//
//  1. bodyField: THE SAME FOLD, BIT-IDENTICAL, MINUS THE CLUSTERS THAT CANNOT CHANGE IT. A limb's prims all sit
//     inside its bounding sphere, and sdPrimitive under-reports Euclidean distance by at most the prim's scale ratio
//     (pack.ts distortRange), so `(|p - c| - R) / distort` is a lower bound on every prim of the limb. The quadratic
//     smin returns `d` EXACTLY when the new value is at least 4k above it, and the chamfer returns `d` when it is at
//     least |d| + 4k above it, so a limb whose bound clears |d| + 4k_max is skipped with no change to a single bit.
//     No per-cluster slices either (sdBodyClosed allocates one per limb per fold). body-field.test.ts pins
//     identity against sdBody over the cast.
//  2. traceField: THE TRACE ONLY ASKS "AT OR UNDER hitEps?" A sample farther than a margin outside every limb's
//     sphere answers "no" without folding. The margin covers the blend reach and the distortion; the GPU march draws
//     no surface outside the same spheres (map-body.wgsl.ts culls a cluster whose sphere distance clears d * distort),
//     so a hit there would be on flesh nobody can see. body-field.test.ts pins that the traces land identically.

import type { Primitive, Vec3 } from './types';
import { sdGroove, sdPrimitive, sdBody, smax, smin, sminChamfer, type Body } from './validate';
import { splitField } from './head-split';
import { boxReach, shellReach } from './extent';
import { strandReach } from './strand';
import { bendCtrl } from './vec';

let shotFix = true;
/** `?shotfix=0` restores the old full folds (sdBody) on the shot path. */
export function shotFixOn(search: string): boolean {
  return new URLSearchParams(search).get('shotfix') !== '0';
}
export function setShotFix(on: boolean): void { shotFix = on; }
export function shotFixEnabled(): boolean { return shotFix; }

/** One live cluster's bound over its ADDITIVE prims (the union the first fold loop takes). */
interface ClusterBound { x: number; y: number; z: number; r: number; distort: number; k4: number; solid: boolean;
  /** Holds a prim the bound cannot speak for (a shell or a strand, below): the cluster always folds. */
  exact: boolean }
/** Every bound the fold skips by: per cluster (index-aligned with body.clusters, null for a dead one) and per prim
 *  (PRIM_STRIDE floats at 6 * index: centre, radius, 1 / distort, 4k; radius -1 for a prim the union never folds,
 *  -2 for one that always folds). */
export interface FieldBounds { clusters: (ClusterBound | null)[]; prims: Float64Array }
const PRIM_STRIDE = 6;

/** A skip must clear its threshold by this much: the bound is exact arithmetic, the fold is floating point. */
const SKIP_TOL = 1e-6;

/** Prims whose field the sphere bound does not hold for: a SHELL (an onion of its base capsule, clipped by a plane) and a
 *  STRAND (a Lipschitz-scaled hair field) under-report their distance by more than the scale ratio. They always fold,
 *  and so does a cluster that holds one. Found by body-field.test.ts over the cast (goblin, schoolgirl, bride...). */
const boundable = (p: Primitive): boolean => p.shell === undefined && p.strand === undefined;

const isAdditive = (p: Primitive): boolean =>
  !(p.op === 'sub' || p.op === 'groove' || p.op === 'bone' || p.op === 'organ' || p.dead);

/** One prim's reach past its control points, its scale ratio and its blend support. A bent prim's curve stays inside
 *  the triangle a, control, b (a Bezier's hull), and a sphere holding the three points holds the triangle. */
function primReach(m: Primitive): { ends: Vec3[]; reach: number; distort: number; k4: number } {
  const mx = Math.max(m.scale[0], m.scale[1], m.scale[2]);
  const mn = Math.min(m.scale[0], m.scale[1], m.scale[2]);
  return {
    ends: m.bend === undefined ? [m.a, m.b] : [m.a, m.b, bendCtrl(m.a, m.b, m.bend)],
    reach: Math.max(m.radius, m.radiusB ?? m.radius) * boxReach(m.box) * strandReach(m.strand) * mx + shellReach(m),
    distort: Math.max(1, mx / Math.max(mn, 1e-4)),
    k4: 4 * Math.max(0, m.blendK),
  };
}

/** The bounds of a body's additive prims, fitted from the prims themselves (not ClusterInfo, which the head pop's
 *  swell does not refit): spheres, the worst scale ratio and the widest blend (4k, the quadratic smin's support). */
export function fieldBounds(body: Body): FieldBounds {
  const clusters: (ClusterBound | null)[] = [];
  const prims = new Float64Array(body.prims.length * PRIM_STRIDE);
  for (let i = 0; i < body.prims.length; i++) {
    const m = body.prims[i]!, o = i * PRIM_STRIDE;
    if (!isAdditive(m)) { prims[o + 3] = -1; continue; }
    if (!boundable(m)) { prims[o + 3] = -2; continue; }
    const { ends, reach, distort, k4 } = primReach(m);
    let x = 0, y = 0, z = 0;
    for (const e of ends) { x += e[0] / ends.length; y += e[1] / ends.length; z += e[2] / ends.length; }
    let r = 0;
    for (const e of ends) r = Math.max(r, Math.hypot(e[0] - x, e[1] - y, e[2] - z) + reach);
    prims[o] = x; prims[o + 1] = y; prims[o + 2] = z; prims[o + 3] = r; prims[o + 4] = 1 / distort; prims[o + 5] = k4;
  }
  for (const c of body.clusters) {
    if (!c.alive) { clusters.push(null); continue; }
    const end = Math.min(body.prims.length, c.start + c.count);
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = c.start; i < end; i++) {
      const m = body.prims[i]!;
      if (!isAdditive(m)) continue;
      sx += m.a[0] + m.b[0]; sy += m.a[1] + m.b[1]; sz += m.a[2] + m.b[2]; n += 2;
    }
    if (n === 0) { clusters.push({ x: 0, y: 0, z: 0, r: 0, distort: 1, k4: 0, solid: false, exact: false }); continue; }
    const x = sx / n, y = sy / n, z = sz / n;
    let r = 0, distort = 1, k4 = 0, exact = false;
    for (let i = c.start; i < end; i++) {
      const m = body.prims[i]!;
      if (!isAdditive(m)) continue;
      if (!boundable(m)) exact = true;
      const pr = primReach(m);
      distort = Math.max(distort, pr.distort);
      k4 = Math.max(k4, pr.k4);
      for (const e of pr.ends) r = Math.max(r, Math.hypot(e[0] - x, e[1] - y, e[2] - z) + pr.reach);
    }
    clusters.push({ x, y, z, r, distort, k4, solid: true, exact });
  }
  return { clusters, prims };
}

/** sdBodyClosed with the exact cluster and prim skips (header, 1). `bounds` from fieldBounds of the same body. */
export function sdBodyClosedBounded(p: Vec3, body: Body, bounds: FieldBounds): number {
  const prims = body.prims, pb = bounds.prims;
  const px = p[0], py = p[1], pz = p[2];
  let d = 1e9;
  for (let ci = 0; ci < body.clusters.length; ci++) {
    const c = body.clusters[ci]!;
    if (!c.alive) continue;
    const b = bounds.clusters[ci];
    if (b) {
      if (!b.solid) continue;   // no additive prims: the union loop folds nothing here
      const dx = px - b.x, dy = py - b.y, dz = pz - b.z;
      if (!b.exact && (Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r) / b.distort >= Math.abs(d) + b.k4 + SKIP_TOL) continue;
    }
    const end = Math.min(prims.length, c.start + c.count);
    for (let i = c.start; i < end; i++) {
      const o = i * PRIM_STRIDE, r = pb[o + 3]!;
      if (r === -1) continue;   // not in the union (a carve, a groove, bone, organ, dead)
      if (r >= 0) {
        const dx = px - pb[o]!, dy = py - pb[o + 1]!, dz = pz - pb[o + 2]!;
        if ((Math.sqrt(dx * dx + dy * dy + dz * dz) - r) * pb[o + 4]! >= Math.abs(d) + pb[o + 5]! + SKIP_TOL) continue;
      }
      const prim = prims[i]!;
      d = prim.blendProfile === 'chamfer'
        ? sminChamfer(d, sdPrimitive(p, prim), prim.blendK)
        : smin(d, sdPrimitive(p, prim), prim.blendK);
    }
  }
  for (const c of body.clusters) {
    if (!c.alive) continue;
    const end = Math.min(prims.length, c.start + c.count);
    for (let i = c.start; i < end; i++) {
      const prim = prims[i]!;
      if (prim.dead) continue;
      if (prim.op === 'sub') d = smax(d, -sdPrimitive(p, prim), prim.blendK);
      else if (prim.op === 'groove') d = sdGroove(d, sdPrimitive(p, prim), prim.grooveDepth ?? 0, prim.grooveWidth ?? 0);
    }
  }
  return d;
}

/** sdBody as a closure, bit-identical (header, 1). Bounds are fitted ONCE, so the body must not change under it:
 *  make one per hit / trace, never keep it across a re-pose. `?shotfix=0`: plain sdBody. */
export function bodyField(body: Body): (p: Vec3) => number {
  if (!shotFix) return p => sdBody(p, body);
  return boundedField(body, fieldBounds(body));
}
function boundedField(body: Body, bounds: FieldBounds): (p: Vec3) => number {
  const closed = (q: Vec3) => sdBodyClosedBounded(q, body, bounds);
  return body.split ? p => splitField(body.split!, closed, p) : closed;
}

/** The pellet trace's field (header, 2): bodyField, answering `eps * 2` without a fold wherever the sample is out
 *  of every limb's sphere by more than the margin. A split head keeps the full field (its halves are warped out of
 *  the prims' spheres). `?shotfix=0`: plain sdBody. */
export function traceField(body: Body, eps: number, slack = 0.05): (p: Vec3) => number {
  if (!shotFix) return p => sdBody(p, body);
  const bounds = fieldBounds(body);
  const field = boundedField(body, bounds);
  if (body.split) return field;
  const spheres: number[] = [];
  for (const b of bounds.clusters) {
    if (!b || !b.solid) continue;
    const r = b.r + (eps + b.k4) * b.distort + slack;
    spheres.push(b.x, b.y, b.z, r * r);
  }
  return p => {
    for (let i = 0; i < spheres.length; i += 4) {
      const dx = p[0] - spheres[i]!, dy = p[1] - spheres[i + 1]!, dz = p[2] - spheres[i + 2]!;
      if (dx * dx + dy * dy + dz * dz <= spheres[i + 3]!) return field(p);
    }
    return eps * 2;
  };
}
