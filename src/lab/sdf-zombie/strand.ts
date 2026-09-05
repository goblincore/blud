// src/lab/sdf-zombie/strand.ts
//
// The `strand=` modifier (hairlock, 2026-09-05): ONE two-ended primitive
// becomes a bundle of wavy strands — a fringe, or the pointed face-framing
// locks in front of the ears. This is Selfie-Girl technique item 4 as
// described IN OUR OWN WORDS in Claude Notes/Blud/2026-08-24-selfie-girl-
// techniques.md (that shader forbids reuse of the Work; the legitimate
// references are iq's own articles: /distfunctions, /articles/sdfrepetition,
// /smin). The construction here was derived from the note's description, not
// ported from anywhere.
//
// THE CONSTRUCTION. The parent primitive's segment/quadratic-Bezier is the
// bundle's path. For a query point q (in the prim's scale-divided frame):
//
//   1. t* = closest point parameter on the base curve (EXACT: the cubic
//      roots plus the ends for a bend, the clamped projection for a
//      straight bar). One curve evaluation — the whole point.
//   2. In the cross-section plane at t* (basis u,v ⟂ tangent), fold q's
//      plane coordinates onto the strand grid: cell = 2·r(t*)/count, id =
//      round(pl/cell), clamped to the bundle (iq's limited repetition).
//      The nearest STRAND centre can sit one cell over once wobble and
//      jitter displace it, so the 3×3 neighbourhood is evaluated and the
//      min taken — exact for the union while wave stays under
//      STRAND_WAVE_MAX (the coverage bound, below).
//   3. Each strand centre wobbles along the curve with a per-id phase:
//      wave·cell·(sin 2π(cycles·t + h₁), sin 2π(cycles·t + h₂+¼)), plus a
//      static per-id jitter of 0.4·wave·cell. The hashes use SMALL
//      COEFFICIENTS ONLY (no sin-of-large-number hash): f32 and f64 agree
//      on them to ~1e-6, which is what keeps the CPU field (click-to-shoot,
//      render-check's mask) and the GPU field seeing the same strands.
//   4. The strand at t* is evaluated as a WINDOWED TANGENT CAPSULE — the
//      strand's local linearisation: direction C'(t*) + dwobble/dt*,
//      clamped to ±W (2 cells) and to the curve's own ends. Sampling the
//      strand as isolated points instead would BEAD wherever the wobble
//      moves a strand more than its diameter between samples (cycles ≥ 4
//      beads at quarter sampling); the tangent model is smooth along t.
//
// WHY THE FIELD IS DIVIDED BY L. The fold (min of 9 tangent capsules) is
// fine; the t*-dependence is not. The strand centres move as t* moves with
// q, at rates set by the wobble slope, the taper (cell' follows r(t)), the
// frame spin on a bent curve, and the closest-point sensitivity dt*/dq.
// The naive field's gradient therefore exceeds 1 and a sphere tracer
// oversteps — the exact failure nearWound flags in march.wgsl.ts. Rather
// than a plain-step flag, the field is DIVIDED by a conservatively computed
// Lipschitz bound (strandLipschitz below, the same formula in both fields),
// restoring |∇d| ≤ 1 as an UNDERestimate — the safe direction, paid for in
// march steps. The relax-1.4 render gate on characters/strand-fixture.blob
// is what proves the bound suffices; the cyclops's crater bands are the
// reference artefact for what failure looks like.
//
// KNOWN APPROXIMATION, inherited from coneBend's design honesty: t* is the
// closest point on the BASE curve, and on the curve's medial axis the
// closest point jumps — so the field can jump there. For a lock or fringe
// the medial axis sits far outside the bundle (the curl radius is
// centimetres, the bundle millimetres), typically inside the skull the
// strand is blended into. If a tight curl ever shows a medial-axis seam,
// the fix is coneBend's own: evaluate the fold at every cubic candidate and
// take the min, not just at the winner.

import type { StrandParams, Vec3 } from './types';
import { len, sub } from './vec';

/** Strand count ceiling. 16 strands across a diameter is already fur. */
export const STRAND_COUNT_MAX = 16;
/**
 * Wobble-amplitude ceiling, as a fraction of the cell. The fold evaluates
 * the 3×3 neighbourhood of round(q/cell); a strand centre displaced further
 * than this can leave that neighbourhood while still being the nearest
 * strand, and the repetition stops being exact. The budget is 0.39 (from
 * (1.5 − √0.5)/2, the distance argument in iq's sdfrepetition article) and
 * the static jitter spends 0.4·wave of it: 1.4·wave ≤ 0.39.
 */
export const STRAND_WAVE_MAX = 0.27;
/** Static per-strand centre jitter, as a fraction of the wobble amplitude. */
export const STRAND_JITTER = 0.4;
/** Wobble cycles along the curve. Below 0.25 there is no wave to author;
 *  above 12 the wobble outruns what the tangent model and the Lipschitz
 *  bound can carry, and the look is a knot, not hair. */
export const STRAND_CYCLES_MIN = 0.25;
export const STRAND_CYCLES_MAX = 12;
/** Strand diameter as a fraction of the cell: below 0.05 the strands are
 *  sub-millimetre at character scale and below the march epsilon; 1 is
 *  strands touching with no gap. */
export const STRAND_FAT_MIN = 0.05;
export const STRAND_FAT_MAX = 1;

export const STRAND_DEFAULT_WAVE = 0.15;
export const STRAND_DEFAULT_CYCLES = 3;
export const STRAND_DEFAULT_FAT = 0.7;

/** Half-width of the strand grid, in cells: ids run −m..m. */
export function strandHalfCells(count: number): number {
  return Math.ceil(count / 2);
}

/**
 * How far a strand bundle reaches from its curve, in units of the parent's
 * LARGER radius — the strand sibling of boxReach: multiplied in at every
 * outer-bound site (extent.ts's header enumerates them) so the shader's
 * culls never under-cover the wobble. Strand centres sit at up to
 * m·cell = ceil(n/2)·2r/n from the axis (14% proud of the parent radius at
 * n = 7), plus wobble, jitter and the strand's own radius.
 */
export function strandReach(strand: StrandParams | undefined): number {
  if (strand === undefined) return 1;
  const n = strand.count;
  return strandHalfCells(n) * 2 / n + (strand.wave * (1 + STRAND_JITTER) + strand.fat / 2) * 2 / n;
}

/**
 * The conservative Lipschitz bound for a strand bundle's scaled-frame field:
 * the value BOTH field implementations divide by. Everything is computed in
 * the prim's scale-divided frame (`a`, `b`, `ctrl` divided by scale; radii
 * raw — the same mixed frame sdPrimitive/coneBend evaluate in), so the
 * packed world-space caller divides endpoints by scale first, exactly as
 * sdPrimitive does.
 *
 * `ctrl` is the resolved Bezier control point (or undefined when straight);
 * `r2 < 0` means untapered, matching the packed sentinel.
 */
export function strandLipschitz(
  a: Vec3, b: Vec3, ctrl: Vec3 | undefined, r1: number, r2: number, s: StrandParams,
): number {
  const rb = r2 < 0 ? r1 : r2;
  const straight = ctrl === undefined;
  // C(t) = a + e1·t + bb·t², C' = e1 + 2·bb·t, C'' = 2·bb.
  const e1: Vec3 = straight
    ? sub(b, a)
    : [2 * (ctrl[0] - a[0]), 2 * (ctrl[1] - a[1]), 2 * (ctrl[2] - a[2])];
  const bb: Vec3 = straight
    ? [0, 0, 0]
    : [a[0] - 2 * ctrl[0] + b[0], a[1] - 2 * ctrl[1] + b[1], a[2] - 2 * ctrl[2] + b[2]];
  const bbLen = len(bb);

  // Slowest the curve ever moves per unit t — the min of |e1 + 2·bb·t| over
  // [0,1], exact because the velocity is affine: project −e1 onto bb.
  let spdMin: number;
  if (bbLen < 1e-9) {
    spdMin = len(e1);
  } else {
    const d: Vec3 = [2 * bb[0], 2 * bb[1], 2 * bb[2]];
    const tMin = Math.max(0, Math.min(1,
      -(e1[0] * d[0] + e1[1] * d[1] + e1[2] * d[2]) / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2])));
    spdMin = len([e1[0] + d[0] * tMin, e1[1] + d[1] * tMin, e1[2] + d[2] * tMin]);
  }
  // A degenerate (zero-length) strand has no curve to wave along; 1 keeps
  // the field a plain point distance.
  if (spdMin < 1e-9) return 1;

  const n = s.count;
  const m = strandHalfCells(n);
  const rMax = Math.max(r1, rb);
  const cellMax = 2 * rMax / n;
  const cellRate = 2 * Math.abs(rb - r1) / n;             // |d(cell)/dt|
  const centreMax = m * cellMax + s.wave * (1 + STRAND_JITTER) * cellMax;
  const rhoMax = centreMax + s.fat * cellMax / 2;         // farthest strand surface from the axis
  // Curvature bound and the closest-point sensitivity: dt*/dq grows as the
  // query point approaches the medial axis (1 − ρκ → 0). Floored at 4× —
  // past that the bundle is curled into itself and the field is wrong in
  // ways a step divisor cannot fix anyway.
  const kappa = 2 * bbLen / (spdMin * spdMin);
  const rate = 1 / (spdMin * Math.max(1 - rhoMax * kappa, 0.25));

  // Strand-centre speed per unit t, beyond the curve's own motion:
  // the id·cell term follows the taper, the wobble oscillates, the jitter
  // rides the taper too.
  const dCentre = m * cellRate
    + s.wave * (1 + STRAND_JITTER) * cellRate
    + s.wave * 2 * Math.PI * s.cycles * cellMax;
  // Frame spin on a bent curve drags every strand centre by |dframe/dt|·|ctr|.
  const spin = 2 * bbLen / spdMin;
  // The strand direction (dC + dwobble) tilts as t* moves; the capsule
  // distance's sensitivity to its direction is bounded by the window W.
  const dSdir = spin + s.wave * 2 * Math.PI * s.cycles * (cellRate + 2 * Math.PI * s.cycles * cellMax) / spdMin;
  const window = 2 * cellMax;
  // The strand radius tapers with the cell.
  const dRad = s.fat * cellRate / 2;

  return 1 + rate * (dCentre + spin * centreMax + window * dSdir + dRad);
}

/** Per-strand hash, 0..1. SMALL COEFFICIENTS ONLY — see the header: f32 and
 *  f64 evaluate these identically to ~1e-6, so the CPU and GPU fields wobble
 *  the same strands the same way. A sin-of-large-number hash would decorrelate
 *  the two fields entirely. */
function strandHash(ix: number, iy: number, k: number): number {
  const seeds = [
    0.371 * ix + 0.733 * iy,
    0.531 * ix + 0.297 * iy + 0.41,
    0.617 * ix + 0.173 * iy + 0.73,
    0.229 * ix + 0.859 * iy + 0.19,
  ];
  const v = seeds[k]!;
  return v - Math.floor(v);
}

/**
 * The strand-bundle field in the prim's scale-divided frame — the CPU
 * mirror of CONE_STRAND in march.wgsl.ts. Edit both in the same commit; this
 * field backs click-to-shoot and the render-check mask.
 *
 * Returns the SCALED distance, NOT yet multiplied by minScale or divided by
 * the Lipschitz bound — the caller (sdPrimitive) applies both, exactly where
 * the GPU does, so all four field branches stay symmetrical.
 *
 * `ctrl` is the resolved world-frame control point, or undefined for a
 * straight prim; `r2 < 0` is the untapered sentinel.
 */
export function sdStrand(
  q: Vec3, a: Vec3, b: Vec3, ctrl: Vec3 | undefined, r1: number, r2: number, s: StrandParams,
): number {
  const rb = r2 < 0 ? r1 : r2;
  const straight = ctrl === undefined;
  const e1: Vec3 = straight
    ? sub(b, a)
    : [2 * (ctrl[0] - a[0]), 2 * (ctrl[1] - a[1]), 2 * (ctrl[2] - a[2])];
  const bb: Vec3 = straight
    ? [0, 0, 0]
    : [a[0] - 2 * ctrl[0] + b[0], a[1] - 2 * ctrl[1] + b[1], a[2] - 2 * ctrl[2] + b[2]];
  const at = (t: number): Vec3 => [
    a[0] + e1[0] * t + bb[0] * t * t,
    a[1] + e1[1] * t + bb[1] * t * t,
    a[2] + e1[2] * t + bb[2] * t * t,
  ];
  const dAt = (t: number): Vec3 => [
    e1[0] + 2 * bb[0] * t, e1[1] + 2 * bb[1] * t, e1[2] + 2 * bb[2] * t,
  ];

  // t* — the EXACT closest point on the base curve. Straight: the clamped
  // projection. Bent: the cubic roots (all interior distance extrema) and
  // the ends. Degenerate (coincident ends): t* = 0.
  let tStar = 0;
  {
    const abLen2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2;
    if (abLen2 < 1e-12) {
      tStar = 0;
    } else if (straight || (bb[0] * bb[0] + bb[1] * bb[1] + bb[2] * bb[2]) < 1e-12) {
      tStar = Math.max(0, Math.min(1,
        ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1]) + (q[2] - a[2]) * (b[2] - a[2])) / abLen2));
    } else {
      let best = Infinity;
      for (const t of [...sdBezierRoots(q, a, ctrl!, b), 0, 1]) {
        const p = at(t);
        const v = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
        if (v < best) { best = v; tStar = t; }
      }
    }
  }

  const pt = at(tStar);
  const dC = dAt(tStar);
  const spd = Math.max(len(dC), 1e-9);
  const tan: Vec3 = [dC[0] / spd, dC[1] / spd, dC[2] / spd];
  // Cross-section basis from the axis LEAST aligned with the tangent (no
  // near-degenerate cross product). Any orthonormal pair works; the hashes
  // keep the strands consistent between the two fields, not the basis.
  const seedAxis: Vec3 = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u: Vec3 = [
    tan[1] * seedAxis[2] - tan[2] * seedAxis[1],
    tan[2] * seedAxis[0] - tan[0] * seedAxis[2],
    tan[0] * seedAxis[1] - tan[1] * seedAxis[0],
  ];
  const ul = Math.max(len(u), 1e-9);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: Vec3 = [
    tan[1] * u[2] - tan[2] * u[1],
    tan[2] * u[0] - tan[0] * u[2],
    tan[0] * u[1] - tan[1] * u[0],
  ];

  const rT = r1 + (rb - r1) * tStar;
  const cell = Math.max(2 * rT / s.count, 1e-6);
  const rS = s.fat * cell * 0.5;
  const m = strandHalfCells(s.count);
  const window = 2 * cell;

  const rel = sub(q, pt);
  const pl: [number, number] = [rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2],
    rel[0] * v[0] + rel[1] * v[1] + rel[2] * v[2]];
  const id0x = Math.round(pl[0] / cell);
  const id0y = Math.round(pl[1] / cell);

  const TAU = Math.PI * 2;
  let best = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const ix = Math.max(-m, Math.min(m, id0x + di));
      const iy = Math.max(-m, Math.min(m, id0y + dj));
      const h1 = strandHash(ix, iy, 0);
      const h2 = strandHash(ix, iy, 1);
      const h3 = strandHash(ix, iy, 2);
      const h4 = strandHash(ix, iy, 3);
      const phx = TAU * (s.cycles * tStar + h1);
      const phy = TAU * (s.cycles * tStar + h2 + 0.25);
      const wob = s.wave * cell;
      const ctrX = ix * cell + wob * Math.sin(phx) + STRAND_JITTER * wob * (2 * h3 - 1);
      const ctrY = iy * cell + wob * Math.sin(phy) + STRAND_JITTER * wob * (2 * h4 - 1);
      // The strand's local direction: the curve's plus the wobble's own
      // slope, so the windowed capsule lies ALONG the wavy strand instead of
      // beading at every station.
      const dwX = wob * TAU * s.cycles * Math.cos(phx);
      const dwY = wob * TAU * s.cycles * Math.cos(phy);
      let sd: Vec3 = [dC[0] + dwX * u[0] + dwY * v[0], dC[1] + dwX * u[1] + dwY * v[1], dC[2] + dwX * u[2] + dwY * v[2]];
      const sl = Math.max(len(sd), 1e-9);
      sd = [sd[0] / sl, sd[1] / sl, sd[2] / sl];
      const mx = pt[0] + ctrX * u[0] + ctrY * v[0];
      const my = pt[1] + ctrX * u[1] + ctrY * v[1];
      const mz = pt[2] + ctrX * u[2] + ctrY * v[2];
      const w3: Vec3 = [q[0] - mx, q[1] - my, q[2] - mz];
      const dl = w3[0] * sd[0] + w3[1] * sd[1] + w3[2] * sd[2];
      // Window: the tangent model is local (it kills the ghost ridge a
      // curve-length tangent line would leave), and never runs past the
      // curve's own ends, so a pointed lock ENDS at t = 1.
      const dlc = Math.max(Math.max(-window, -tStar * spd), Math.min(Math.min(window, (1 - tStar) * spd), dl));
      const dx = w3[0] - dlc * sd[0], dy = w3[1] - dlc * sd[1], dz = w3[2] - dlc * sd[2];
      const dI = Math.hypot(dx, dy, dz) - rS;
      if (dI < best) best = dI;
    }
  }
  return best;
}

/**
 * Closest-point parameters of a quadratic Bezier to p — all clamped cubic
 * roots. This is validate.ts's sdBezierTs EXTRACTED (that function is
 * private to validate.ts and sdStrand lives here so strand.ts can be unit
 * tested without the whole field); keep the formula in lockstep with both
 * sdBezierTs (validate.ts) and sdBezierT (march.wgsl.ts).
 */
function sdBezierRoots(p: Vec3, A: Vec3, B: Vec3, C: Vec3): number[] {
  const a = sub(B, A);
  const b: Vec3 = [A[0] - 2 * B[0] + C[0], A[1] - 2 * B[1] + C[1], A[2] - 2 * B[2] + C[2]];
  const dv = sub(A, p);
  const dot3 = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];

  const kk = 1 / dot3(b, b);
  const kx = kk * dot3(a, b);
  const ky = kk * (2 * dot3(a, a) + dot3(dv, b)) / 3;
  const kz = kk * dot3(dv, a);

  const pp = ky - kx * kx;
  const qq = kx * (2 * kx * kx - 3 * ky) + kz;
  const h = qq * qq + 4 * pp ** 3;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

  if (h >= 0) {
    const h2 = Math.sqrt(h);
    let x1 = (h2 - qq) / 2;
    let x2 = (-h2 - qq) / 2;
    if (Math.abs(pp) < 1e-4 && qq !== 0) {
      const k = pp ** 3 / qq;
      x1 = k;
      x2 = -k - qq;
    }
    const u1 = Math.sign(x1) * Math.abs(x1) ** (1 / 3);
    const u2 = Math.sign(x2) * Math.abs(x2) ** (1 / 3);
    return [clamp01(u1 + u2 - kx)];
  }
  const z = Math.sqrt(-pp);
  const vn = Math.acos(Math.max(-1, Math.min(1, qq / (pp * z * 2)))) / 3;
  const mCos = Math.cos(vn);
  const nSin = Math.sin(vn) * 1.7320508075688772;
  return [clamp01((mCos + nSin) * z - kx), clamp01(-(mCos + nSin) * z - kx), clamp01((nSin - mCos) * z - kx)];
}
