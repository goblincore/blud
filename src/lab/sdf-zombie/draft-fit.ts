// draft-fit — measurements that turn a bone's VERTEX CLOUD into numbers a
// .blob draft can carry, plus the two rig-facing exceptions the chain-drift
// amendment added: rigLine (the CHAIN line, from the rig's joint-to-joint
// segment) and cloudOffset (how far the surface sits off it).
//
// THE JOINT TRAP. A Meshy rig's joints sit 9-13 cm off the skin (measured on
// the mouse's shoulder and collar joints). A draft that takes bone axes from
// joint positions is subtly wrong everywhere — worse than hand-authoring,
// because the result is plausible and undebuggable. The rig stays in charge
// of GROUPING vertices (exact by construction — those are the skin weights),
// but never of placing geometry: the axis below is the cloud's own principal
// axis, and every measurement is taken about it.
// Spec: docs/superpowers/specs/2026-09-02-blobforge-draft-and-depth-design.md,
// amended by docs/superpowers/specs/2026-09-02-blob-draft-chain-drift-design.md:
// the CHAIN (at=/len=/dir=) moves to the rig — `.blob`'s skeleton is a rigid
// kinematic chain, so len= places every descendant, and overlapping clouds do
// not compose into one — while the cloud keeps radii, bands, colour, and
// answers for the surface offset. The trap's resolution lives in rigLine's
// and cloudOffset's doc comments below.

import type { Vec3 } from './types';
import { dirVector } from './blob-compile';
import { cross, dot, len, normalize, scale as vscale, sub } from './vec';

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

/**
 * A bone's chain line, taken from the RIG rather than from its vertex cloud.
 *
 * `.blob`'s skeleton is a rigid chain — a bone's head is its parent's TAIL —
 * so `len=` places every descendant rather than describing one bone. Adjacent
 * clouds OVERLAP (thigh and shin both own the knee), so summed cloud extents
 * overshoot and the error accumulates: the first drafted minotaur stood with
 * its soles ~0.3 m off the floor. Rig joint-to-joint distances compose by
 * construction, being the chain that produced the skin. Bonewalker took every
 * len= this way and never printed a BONE LENGTH IS OFF block.
 *
 * Convention matches what the emitter already consumes (headPoint/tailPoint):
 * the line grows FROM the scaled head — `origin`, with `t0` = 0 — to the
 * scaled tail at `origin + dir·t1`. One scale, applied here: per-bone scaling
 * would reintroduce exactly the chain inconsistency this function removes.
 *
 * `points`, when supplied, contribute ONLY the residual — the cloud's RMS
 * spread about the RIG axis, a check on how far the surface sits from its
 * bone, never an input to dir/origin/extent. ONE FRAME: points are in the
 * same frame as the returned line, i.e. already scaled. (Not frame-invariant:
 * scaling moves the axis — the line through scale·head is parallel to the
 * one through head, not the same line — so an unscaled cloud measured about
 * a scaled axis reads a huge phantom offset.) See cloudOffset for where the
 * surface's actual answer goes.
 */
export function rigLine(head: Vec3, tail: Vec3, scale: number, points?: Vec3[]): MedialLine {
  const seg = sub(tail, head);
  const segLen = len(seg);
  // A zero-length rig segment has no direction and needs none: the tail lands
  // at head + dir·0 = head for ANY dir, so the stub 'up' below cannot
  // misplace a descendant. A NaN dir (normalize of zero) OTOH would poison
  // every downstream number silently.
  const dir: Vec3 = segLen > 0 ? vscale(seg, 1 / segLen) : [0, 1, 0];
  const origin = vscale(head, scale);

  let residual = 0;
  if (points && points.length > 0) {
    let sumSq = 0;
    for (const p of points) {
      const q = sub(p, origin);
      const t = dot(q, dir);
      sumSq += Math.max(0, dot(q, q) - t * t);
    }
    residual = Math.sqrt(sumSq / points.length);
  }
  return { dir, origin, t0: 0, t1: segLen * scale, residual };
}

/**
 * How far a bone's cloud centroid sits OFF its rig axis, perpendicular only.
 *
 * This is the honest answer to rig joints sitting 9-13 cm from the skin: the
 * surface is not where the joint is, so offset the PRIMS. Relocating the bone
 * instead is what breaks the chain — see rigLine.
 *
 * The along-axis component is deliberately dropped: sliding a prim along its
 * own bone is `at=`'s job, and a segment-centred cloud's centroid sits at the
 * segment MIDPOINT — half a length of along-axis displacement that must not
 * leak into an offset. ONE FRAME, as in rigLine: `points` and `line` in the
 * same frame, the result in that frame's units.
 */
export function cloudOffset(points: Vec3[], line: MedialLine): Vec3 {
  let sx = 0, sy = 0, sz = 0;
  for (const p of points) { sx += p[0]; sy += p[1]; sz += p[2]; }
  const n = points.length || 1;
  const q = sub([sx / n, sy / n, sz / n], line.origin);
  const along = dot(q, line.dir);
  return sub(q, vscale(line.dir, along));
}

/**
 * One radial band of a bone's cloud: the stretch of t where the median radius
 * stays a straight line within tolerance. A band becomes ONE prim in the
 * draft — splitting at radial inflections is what keeps a torso from drafting
 * as a smooth tube, which is the exact featureless-blob defect that got the
 * minotaur rejected. One prim per bone would GENERATE that bug (spec: "the
 * first draft of this spec emitted one bar per bone. That is wrong").
 */
export interface Band {
  /**
   * Band extent along the medial line, in the same convention as
   * {@link MedialLine.t0} — relative to the line's origin, along its dir.
   * Taken from the MEMBER POINTS' extremes, not station centres, so bands
   * tile the cloud exactly (first band's t0 is the cloud's own t0).
   */
  t0: number;
  t1: number;
  /**
   * MEDIAN radial distance of the band's points, not a mean. The extremes are
   * where blades and spurs live; a mean lets one spike move the ring (spec).
   * The mirror image of MedialLine.residual's RMS-over-max choice: there one
   * stray vertex must not scream "bend", here one must not fatten a prim.
   */
  r: number;
  /**
   * Cross-section shape resolved onto the BONE's own basis axes, as ratios of
   * `r` (r·wide / r·deep are the semi-axes; 1,1 when circular). Deliberately
   * NOT the ellipse's own principal frame: `.blob` scales a prim's own axes
   * and carries no cross-section rotation, so a principal-frame answer would
   * be confidently inexpressible. What is lost to that constraint surfaces in
   * `rotated` instead, for the author to fix by hand.
   */
  wide: number;
  deep: number;
  /**
   * |b| / |a| of the d(θ) ≈ d0 + a·cos2θ + b·sin2θ fit. Near 0 = the
   * cross-section is aligned to the bone axes; large = genuinely rotated,
   * which the format cannot say — the draft emits the axis-aligned
   * approximation and flags the hand pass owed (spec: "emit and comment, don't
   * rotate"). Denominator floored so a circular band (a ≈ b ≈ 0 to float
   * precision) reads as "not rotated" rather than noise dividing noise.
   */
  rotated: number;
  /** Points in this band. A band with few is not evidence. */
  samples: number;
}

export interface BandOpts {
  /**
   * How far the median-radius profile may stray from a band's straight r(t),
   * as a fraction of the cloud's overall median radius. This IS the
   * inflection definition: a band ends exactly where keeping one slope would
   * cost more than this. Smaller = more, shorter bands. 0.08 resolves a
   * chest/waist contrast (tens of percent of radius) many times over while
   * ignoring lattice-level noise.
   */
  tolerance?: number;
  /** Profile stations along the axis. Default scales with the cloud.
   */
  stations?: number;
}

/**
 * Split a bone's vertex cloud into radial bands at its profile's inflections.
 *
 * `line` must be the {@link medialLine} fit of the SAME cloud — the bands are
 * measured about it, so a stale line bands the wrong thing.
 */
export function bandCloud(points: Vec3[], line: MedialLine, opts: BandOpts = {}): Band[] {
  const n = points.length;
  if (n === 0) return [];
  const tolFrac = opts.tolerance ?? 0.08;
  // ~one station per two 12-angle rings: enough resolution to catch a waist,
  // not so much that a per-station MEDIAN is asked to be meaningful off a
  // handful of points.
  const nSt = opts.stations ?? Math.min(40, Math.max(8, Math.round(n / 24)));

  // Project every point into the line's frame ONCE: t bands the cloud, and
  // (d, θ) are the radial polar coordinates the 2θ fit regresses. θ is taken
  // against the bone's own (u,v) basis — that choice is what "aligned" means
  // for wide/deep. It is also invariant under the line direction's canonical
  // sign flip (θ → π−θ only flips the sin-2θ term's sign, which `rotated`
  // reads through |b|), so the fit does not churn with the eigenvector's sign.
  const { u, v } = bandBasis(line.dir);
  const ts = new Float64Array(n);
  const ds = new Float64Array(n);
  const c2 = new Float64Array(n);
  const s2 = new Float64Array(n);
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const q = sub(points[i]!, line.origin);
    const t = dot(q, line.dir);
    const rad = sub(q, vscale(line.dir, t));
    const d = len(rad);
    ts[i] = t;
    ds[i] = d;
    // A point ON the axis has no angle; θ = 0 feeds only the fit's d0 term.
    const th = d > 0 ? Math.atan2(dot(rad, v), dot(rad, u)) : 0;
    c2[i] = Math.cos(2 * th);
    s2[i] = Math.sin(2 * th);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }

  // The yardstick every tolerance below is relative to — one number for the
  // whole cloud, so a thin band is judged against the LIMB's radius, not its
  // own (which would let a waist's bands creep ever thinner).
  const tol = tolFrac * median(Array.from(ds));

  // The radial PROFILE: per-station median of d over t. Median again, same
  // reason as Band.r — a spur on one angle must not bend the profile any
  // more than it may move a band's radius.
  const width = tMax > tMin ? (tMax - tMin) / nSt : 1;
  const station: number[][] = Array.from({ length: nSt }, () => []);
  for (let i = 0; i < n; i++) {
    const s = Math.min(nSt - 1, Math.floor((ts[i]! - tMin) / width));
    station[s]!.push(i);
  }
  // Compact to occupied stations — an empty station has no points to hand to
  // any band, so it must not become segmentation real estate.
  const stOf: number[] = [];
  const stMed: number[] = [];
  for (let s = 0; s < nSt; s++) {
    if (station[s]!.length === 0) continue;
    stOf.push(s);
    stMed.push(median(station[s]!.map(i => ds[i]!)));
  }
  const centre = (k: number) => tMin + (stOf[k]! + 0.5) * width;

  // Walk left to right, extending the current segment while the profile stays
  // straight within tol. Greedy first-fit, not global best-split: the bands
  // only have to land on MATERIAL inflections, and first-fit is deterministic
  // and cheap — a global optimum buys nothing the tolerance doesn't already
  // decide.
  const segs: Array<[number, number]> = [];
  let k = 0;
  while (k < stMed.length) {
    let j = k;
    while (j + 1 < stMed.length) {
      // Two stations always fit a line EXACTLY (two points define one), which
      // would let a straight DISCONTINUITY merge for free. A first extension
      // pays the step instead: a smooth ramp passes, a jump cannot hide.
      const cost = j === k
        ? Math.abs(stMed[j + 1]! - stMed[k]!)
        : profileMaxErr(centre, stMed, k, j + 1);
      if (cost > tol) break;
      j++;
    }
    segs.push([k, j]);
    k = j + 1;
  }

  const bands: Band[] = [];
  for (const [k0, k1] of segs) {
    const members: number[] = [];
    for (let s = stOf[k0]!; s <= stOf[k1]!; s++) {
      for (const i of station[s]!) members.push(i);
    }
    let t0 = Infinity, t1 = -Infinity;
    let sd = 0, sc = 0, ss = 0, scc = 0, sss = 0, scs = 0, sdc = 0, sds = 0;
    for (const i of members) {
      const d = ds[i]!, c = c2[i]!, s = s2[i]!;
      if (ts[i]! < t0) t0 = ts[i]!;
      if (ts[i]! > t1) t1 = ts[i]!;
      sd += d; sc += c; ss += s;
      scc += c * c; sss += s * s; scs += c * s;
      sdc += d * c; sds += d * s;
    }

    // 2θ least squares d ≈ d0 + a·cos2θ + b·sin2θ by normal equations. The
    // [1, cos2θ, sin2θ] columns are orthogonal only on a full uniform θ
    // sweep, which a real cloud is not guaranteed to give — solve the 3x3
    // rather than assuming the coefficients decouple.
    const [d0, a, b] = solve3(
      [members.length, sc, ss, sc, scc, scs, ss, scs, sss],
      [sd, sdc, sds],
      sd / members.length,
    );

    const d0abs = Math.abs(d0);
    bands.push({
      t0,
      t1,
      r: median(members.map(i => ds[i]!)),
      wide: d0abs > 1e-12 ? (d0 + a) / d0 : 1,
      deep: d0abs > 1e-12 ? (d0 - a) / d0 : 1,
      rotated: Math.abs(b) / Math.max(Math.abs(a), 1e-9 * (d0abs || 1)),
      samples: members.length,
    });
  }
  return bands;
}

export interface DirFit {
  /** The .blob base whose zero-angle direction is closest to the measured one. */
  dir: 'up' | 'down' | 'side' | 'fwd';
  /** Absent when `derivable` is false. */
  pitchDeg?: number;
  tiltDeg?: number;
  /**
   * False for `side`/`fwd` bases: dirVector's pitch is a NO-OP there (side's
   * y0 = 0, so sign(y0) = 0) and its tilt only swings a side bone toward +y,
   * so a measured direction with any component off the bare base is simply
   * not expressible as base+angles. Refusing is the honest output — the only
   * thing worse than no angles is angles that compile fine and point the
   * bone somewhere else. `errDeg` carries what the bare base misses by.
   */
  derivable: boolean;
  /**
   * Angle between the measured direction and what the emitted
   * dir/pitch/tilt actually reproduce — always present, so an author can
   * judge the line's fidelity even where the inversion is refused. ~0 when
   * the fit is faithful; the refusal's debt otherwise.
   */
  errDeg: number;
}

/**
 * Invert `dirVector` on a measured direction (the medial line's, in the
 * draft) into the `dir=`/`pitch=`/`tilt=` a .blob line must carry to point
 * the same way.
 *
 * The inversion reproduces dirVector's ACTUAL composition, not an idealised
 * rotation: pitch is applied first, then tilt, and tilt shrinks |y| by
 * cos(tilt) without touching z — so x/|y| = tan(tilt) exactly, but
 * z/|y| = tan(pitch)/cos(tilt). Deriving pitch as atan(z/|y|) ignores the
 * coupling and leaves a real residual on any bone with both angles set (the
 * lesson scripts/derive_blob_angles.mjs already paid for).
 *
 * The input's magnitude is irrelevant (resolveBones normalises `dir`), and
 * the eigenvector-sign canonicalisation of {@link medialLine} needs no
 * undone: whichever way the sign resolved, the closest-base pick below sees
 * the same geometry — a mostly-down cloud lands on `down` regardless.
 */
export function inferDir(v: Vec3): DirFit {
  const DEG = 180 / Math.PI;
  const u = normalize(v);

  // Closest base by dot with each base's zero-angle vector, asked of
  // dirVector itself rather than a re-typed dictionary — if the grammar's
  // bases ever move, this moves with them. Fixed iteration order with a
  // strict `>` makes an exact tie (a direction equidistant from two bases,
  // e.g. 45° between up and side) deterministic; either winner is a real
  // fit and `errDeg` says so.
  const bases = ['up', 'down', 'side', 'fwd'] as const;
  let best: (typeof bases)[number] = 'up';
  let bestDot = -Infinity;
  for (const b of bases) {
    const d = dot(u, dirVector(b, 0, 0));
    if (d > bestDot) { bestDot = d; best = b; }
  }

  const angleTo = (w: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(u, w)))) * DEG;

  if (best === 'side' || best === 'fwd') {
    return { dir: best, derivable: false, errDeg: angleTo(dirVector(best, 0, 0)) };
  }

  // The analytic inverse of the composition (see the interface note): tilt
  // from the exact x/|y| ratio, then pitch through the cos(tilt) coupling.
  // atan2 rather than atan on x/ay keeps a perfectly vertical direction at
  // tilt 0 instead of dividing zero by zero toward NaN.
  const [x, , z] = u;
  const ay = Math.abs(u[1]!);
  const tiltDeg = Math.atan2(x, ay) * DEG;
  const pitchDeg = Math.atan((z / ay) * Math.cos(tiltDeg / DEG)) * DEG;
  const reproduced = dirVector(best, pitchDeg, tiltDeg);
  return {
    dir: best,
    pitchDeg,
    tiltDeg,
    derivable: true,
    errDeg: angleTo(reproduced),
  };
}

/**
 * Orthonormal cross-section frame for a fitted medial line: `u`/`v` span the
 * plane the 2θ fit's angle lives in.
 *
 * The construction is `basisFromAxis`'s — cross the least-aligned world axis
 * with the direction — but the seed comparison is tie-SAFE, and that is the
 * whole reason this is not just that function: the power iteration wobbles
 * `line.dir` by ~1e-7 between refits, and `basisFromAxis`'s exact `<=` sits
 * ON its tie for symmetric directions. Measured on normalize([1,1,2]): the
 * wobble crossed the tie, the seed flipped, and `u` swung 101.5° — which
 * turns an ALIGNED cross-section into a false `rotated` of 0.42, louder than
 * the aligned bar. The 1e-6 tie band is ~10x the iteration's wobble, so a
 * refit of the same cloud cannot straddle it; a genuinely off-tie direction
 * decides exactly as before.
 *
 * Draft-local on purpose: vec.ts's basisFromAxis is shared with wound-frame
 * consumers that don't need (and shouldn't silently inherit) this guarantee,
 * and this file's numbers do. Task 9's emitter must use THIS function if it
 * ever needs to know which world direction a band's fat axis points along.
 */
function bandBasis(dir: Vec3): { u: Vec3; v: Vec3 } {
  const w = normalize(dir);
  const ax = Math.abs(w[0]!), ay = Math.abs(w[1]!), az = Math.abs(w[2]!);
  const eps = 1e-6;
  const seed: Vec3 = ax <= ay + eps && ax <= az + eps ? [1, 0, 0]
    : ay <= az + eps ? [0, 1, 0]
    : [0, 0, 1];
  const u = normalize(cross(seed, w));
  return { u, v: cross(w, u) };
}

/**
 * Max deviation of the station medians in [k0..k1] from their least-squares
 * straight line — the cost a band extension pays against the tolerance.
 */
function profileMaxErr(
  x: (k: number) => number,
  y: number[],
  k0: number,
  k1: number,
): number {
  const m = k1 - k0 + 1;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = k0; k <= k1; k++) {
    sx += x(k);
    sy += y[k]!;
    sxx += x(k) * x(k);
    sxy += x(k) * y[k]!;
  }
  const varx = m * sxx - sx * sx;
  // varx 0 (all centres equal — unreachable with distinct stations, but the
  // guard is cheaper than trusting that): fall back to deviation from the
  // mean, i.e. a horizontal line.
  const slope = varx > 1e-12 ? (m * sxy - sx * sy) / varx : 0;
  const icept = (sy - slope * sx) / m;
  let err = 0;
  for (let k = k0; k <= k1; k++) {
    err = Math.max(err, Math.abs(y[k]! - (slope * x(k) + icept)));
  }
  return err;
}

/**
 * Solve a 3x3 system by Gaussian elimination with partial pivoting. Returns
 * `[fallback, 0, 0]` when the matrix is singular — the caller's honest answer
 * for degenerate geometry (see bandCloud: no θ coverage means NO evidence of
 * eccentricity, not a fit to trust).
 */
function solve3(
  m: number[],
  rhs: number[],
  fallback: number,
): [number, number, number] {
  const a = [
    [m[0]!, m[1]!, m[2]!, rhs[0]!],
    [m[3]!, m[4]!, m[5]!, rhs[1]!],
    [m[6]!, m[7]!, m[8]!, rhs[2]!],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    }
    if (Math.abs(a[piv]![col]!) < 1e-12) return [fallback, 0, 0];
    const tmp = a[col]!;
    a[col] = a[piv]!;
    a[piv] = tmp;
    for (let r = col + 1; r < 3; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < 4; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  const x = [0, 0, 0];
  for (let col = 2; col >= 0; col--) {
    let s = a[col]![3]!;
    for (let c = col + 1; c < 3; c++) s -= a[col]![c]! * x[c]!;
    x[col] = s / a[col]![col]!;
  }
  return [x[0]!, x[1]!, x[2]!];
}

/** Even-count median averages the two central values. */
function median(xs: number[]): number {
  const sorted = [...xs].sort((p, q) => p - q);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
