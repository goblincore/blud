// draft-fit — measurements that turn a bone's VERTEX CLOUD into numbers a
// .blob draft can carry. Everything here reads the cloud and only the cloud.
//
// THE JOINT TRAP. A Meshy rig's joints sit 9-13 cm off the skin (measured on
// the mouse's shoulder and collar joints). A draft that takes bone axes from
// joint positions is subtly wrong everywhere — worse than hand-authoring,
// because the result is plausible and undebuggable. The rig stays in charge
// of GROUPING vertices (exact by construction — those are the skin weights),
// but never of placing geometry: the axis below is the cloud's own principal
// axis, and every measurement is taken about it.
// Spec: docs/superpowers/specs/2026-09-02-blobforge-draft-and-depth-design.md.

import type { Vec3 } from './types';
import { dot, normalize, scale as vscale, sub } from './vec';

export interface MedialLine {
  /**
   * Unit direction of the cloud's principal axis. The eigenvector's sign is
   * arbitrary, so it is canonicalised (largest-magnitude component positive) —
   * a fit whose direction flips between runs would churn every downstream
   * number: Task 6's bands, Task 9's emitted `dir=`.
   */
  dir: Vec3;
  /** Point on the line — the cloud's centroid. */
  origin: Vec3;
  /** Extent along `dir`, min and max, relative to origin. */
  t0: number;
  t1: number;
  /**
   * RMS perpendicular distance of the cloud from the line. Large = the bone
   * is CURVED and wants a `bend=` the format's draft cannot emit (the draft
   * flags it instead). RMS rather than max: the extremes are where spurs and
   * armour plates live, and one stray vertex must not scream "bend".
   */
  residual: number;
}

/**
 * The straight line that best fits a vertex cloud, by its covariance's
 * dominant eigenvector (power iteration — sufficient for these clouds, which
 * are long relative to their girth, and avoids pulling in a matrix library).
 */
export function medialLine(points: Vec3[]): MedialLine {
  const n = points.length;

  // Centroid first: the line passes through the CLOUD's centre, which is the
  // whole point — a cloud offset from the rig joint line gets its own line.
  let sx = 0, sy = 0, sz = 0;
  for (const p of points) { sx += p[0]; sy += p[1]; sz += p[2]; }
  const origin: Vec3 = [sx / n, sy / n, sz / n];

  // Covariance of the centred points. Symmetric, so six entries suffice, and
  // unnormalised (no /n) — the eigenvector is indifferent to the scale.
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (const p of points) {
    const x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2];
    xx += x * x; yy += y * y; zz += z * z;
    xy += x * y; xz += x * z; yz += y * z;
  }
  const apply = (v: Vec3): Vec3 => [
    xx * v[0] + xy * v[1] + xz * v[2],
    xy * v[0] + yy * v[1] + yz * v[2],
    xz * v[0] + yz * v[1] + zz * v[2],
  ];

  // All-nonzero start: a start vector orthogonal to the dominant eigenvector
  // would stall the iteration on the second axis, and zeros make that
  // coincidence possible for axis-aligned clouds.
  let v = normalize([1, 0.37, 0.21]);
  for (let i = 0; i < 200; i++) {
    const next = normalize(apply(v));
    const moved = 1 - Math.abs(dot(next, v));
    v = next;
    if (moved < 1e-12) break;
  }

  // Canonical sign: whichever component is largest in magnitude goes positive.
  let big = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(v[k]!) > Math.abs(v[big]!)) big = k;
  const dir = v[big]! < 0 ? vscale(v, -1) : v;

  // Extent along the axis, and the RMS of the perpendicular remainder
  // |q|² - t² (clamped at 0: floating point can go a hair negative on
  // near-collinear points).
  let t0 = Infinity, t1 = -Infinity, sumSq = 0;
  for (const p of points) {
    const q = sub(p, origin);
    const t = dot(q, dir);
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    sumSq += Math.max(0, dot(q, q) - t * t);
  }
  return { dir, origin, t0, t1, residual: Math.sqrt(sumSq / n) };
}
