// src/lab/sdf-zombie/ring-fit.ts
//
// Fit existing .blob primitives to a reference surface by reading the SIGNED
// RESIDUAL OF OUR OWN FIELD at reference points.
//
// WHY THE RESIDUAL AND NOT THE RING OUTLINE DIRECTLY. Primitives smooth-union,
// and smin(a, b) < min(a, b), so the union surface is always FATTER than any
// single primitive. Reading a measured ring straight onto a prim's `r`
// systematically over-fattens — which is visible being corrected by hand all
// through mouse.blob's comments. sdBody IS the blended field, so its value at
// a reference point is the error with blending already folded in.
import type { ClusterInfo, Primitive, ResolvedBone, Vec3 } from './types';
import { ringBasis, toLocal, SCALE_AXIS_NAMES, type RingBasis } from './ref-align';
import { sdBody, sdPrimitive } from './validate';
import { add, len, normalize, scale as vscale, sub } from './vec';

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Central-difference gradient of sdBody, normalised. */
function gradient(p: Vec3, body: Body, h = 1e-4): Vec3 {
  const g: Vec3 = [
    sdBody([p[0] + h, p[1], p[2]], body) - sdBody([p[0] - h, p[1], p[2]], body),
    sdBody([p[0], p[1] + h, p[2]], body) - sdBody([p[0], p[1] - h, p[2]], body),
    sdBody([p[0], p[1], p[2] + h], body) - sdBody([p[0], p[1], p[2] - h], body),
  ];
  return len(g) < 1e-12 ? [0, 1, 0] : normalize(g);
}

/**
 * Newton-step a point onto sdBody == 0. Converges from either side; the field
 * is not a true distance for anisotropic prims (it under-reports by minScale),
 * so this iterates rather than taking one step.
 *
 * ON THE ZERO SET, BUT NOT NECESSARILY THE NEAREST POINT. A seed sitting
 * exactly on a prim's medial axis has a SYMMETRIC field around it, so the
 * central difference cancels to exactly zero in all three axes, `gradient`
 * takes its `len(g) < 1e-12` fallback of straight up, and the point walks
 * along the axis until it hits a cap. The result is a genuine surface point
 * (|d| ~ 1e-16) but it can be most of the prim's length away from the seed.
 * `sampleBodySurface` never seeds on-axis so it cannot hit this, but anything
 * projecting AUTHORED points — a bone head, a joint centre, a cluster centre —
 * can, and will get a silently non-nearest answer. Nudge such a seed off-axis
 * first: an offset of 1e-9 is already enough for the h = 1e-4 stencil to
 * recover the true direction.
 *
 * `steps` stays caller-controlled and defaults to 24, which is exact for
 * near-isotropic prims; see `stepsForPrim` for why an anisotropic one needs
 * far more, and never assume the default is enough for one.
 */
export function projectToSurface(p: Vec3, body: Body, steps = 24): Vec3 {
  let q = p;
  for (let i = 0; i < steps; i++) {
    const d = sdBody(q, body);
    if (Math.abs(d) < 1e-9) break;
    q = sub(q, vscale(gradient(q, body), d));
  }
  return q;
}

/**
 * Newton budget for one primitive, from its anisotropy ratio.
 *
 * NOT A CONSTANT, and this is the whole correctness of the instrument.
 * `sdPrimitive` divides by `scale` and then multiplies the result by
 * `minScale`, so for an anisotropic prim the field UNDER-REPORTS true distance
 * by up to `minScale/maxScale`. Each Newton step therefore covers only that
 * fraction of the remaining gap along the major axis: convergence degrades
 * from quadratic to LINEAR with rate `1 - minScale/maxScale`, and the
 * iterations needed grow linearly in the ratio.
 *
 * That failure is nastier than it sounds because it is BIASED, not noisy. The
 * points that run out of budget are exactly the ones at the major-axis
 * extremes, where the gradient is shortest — so the `< 1e-6` filter in
 * `sampleBodySurface` eats the outermost samples first and the surviving set
 * quietly shrinks inward. A fixed budget does not give a rougher measurement;
 * it gives a confidently wrong one.
 *
 * Measured minimum steps for full retention of 400 samples on a lone capsule:
 *
 *   ratio  1.0 → 8     ratio  4.0 → 48    ratio 10.0 → 96
 *   ratio  1.5 → 16    ratio  6.0 → 64    ratio 12.0 → 128
 *   ratio  2.0 → 16    ratio  8.0 → 96    ratio 20.0 → 256
 *
 * The trend is linear with slope ~13, so `24 * ratio` keeps at least a 2x
 * margin over every measured point while staying cheap. The floor of 24 keeps
 * the isotropic case bit-identical to the original fixed budget. The cap of
 * 512 bounds the cost of a pathological prim — it covers a true need up to
 * ratio ~39 — and past it the sampler warns rather than pretending.
 */
function stepsForPrim(prim: Primitive): number {
  const lo = Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
  const hi = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
  // A zero or negative scale is degenerate; ratio goes non-finite and we just
  // spend the cap on it rather than silently taking the floor.
  const ratio = lo > 0 ? hi / lo : Infinity;
  return Math.min(512, Math.max(24, Math.ceil(24 * ratio)));
}

/**
 * Fraction of a prim's requested samples that may fail to land before the
 * sampler complains. Some loss is a fact about a hard body (a point seeded
 * inside a neighbouring prim's bulge can converge somewhere unhelpful); a lot
 * of loss is the instrument running out of budget, which is ours to report.
 */
const MIN_RETENTION = 0.98;

/**
 * Synthesise a reference-shaped point set FROM a body: sample each primitive's
 * own surface, then project onto the blended body. Test instrument, and the
 * only way to check the fitter against ground truth without a GLB.
 *
 * NO SILENT CAPS. Points that fail to land on the zero set are dropped, and a
 * dropped point is invisible in the returned array — a biased sample set would
 * otherwise be indistinguishable from a complete one. So the budget is derived
 * per prim (see `stepsForPrim`), and any loss past `MIN_RETENTION` is warned
 * about, naming the prim. It warns rather than throwing: a later task sampling
 * a real body should degrade with a complaint, not die.
 */
export function sampleBodySurface(body: Body, perPrim = 200): Map<string, Vec3[]> {
  const out = new Map<string, Vec3[]>();
  for (const prim of body.prims) {
    if (prim.dead || prim.op === 'sub' || prim.op === 'groove') continue;
    const bone = prim.bone ?? 'unknown';
    let list = out.get(bone);
    if (list === undefined) { list = []; out.set(bone, list); }
    const axis = sub(prim.b, prim.a);
    const axisLen = len(axis);
    const steps = stepsForPrim(prim);
    let kept = 0;
    for (let i = 0; i < perPrim; i++) {
      // Deterministic spiral over the prim's own surface: no Math.random, so
      // a failing test reproduces exactly.
      const t = perPrim === 1 ? 0.5 : i / (perPrim - 1);
      const theta = i * 2.399963229728653; // golden angle, in radians
      const along = add(prim.a, vscale(axis, axisLen === 0 ? 0 : t));
      const r = prim.radius + ((prim.radiusB ?? prim.radius) - prim.radius) * t;
      // Push out along a world-axis ring, scaled by the prim's own anisotropy.
      const seed: Vec3 = [Math.cos(theta) * prim.scale[0], 0, Math.sin(theta) * prim.scale[2]];
      const p = add(along, vscale(seed, r * 1.4));
      const q = projectToSurface(p, body, steps);
      if (Math.abs(sdBody(q, body)) < 1e-6) { list.push(q); kept++; }
    }
    if (kept < perPrim * MIN_RETENTION) {
      const lo = Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
      const hi = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
      const ratio = lo > 0 ? (hi / lo).toFixed(1) : 'degenerate';
      const where = prim.src === undefined ? bone : `${bone} (line ${prim.src})`;
      console.warn(
        `sampleBodySurface: ${where} kept only ${kept}/${perPrim} samples at ` +
        `${steps} Newton steps (anisotropy ratio ${ratio}). The lost points are ` +
        `the major-axis extremes, so this prim's sample set is biased INWARD — ` +
        `do not read an extent off it.`,
      );
    }
  }
  return out;
}

/** Nearest and second-nearest add-primitive indices, mirroring nearestPrim's skips. */
export function twoNearestPrims(p: Vec3, body: Body): { first: number; firstD: number; secondD: number } {
  let first = -1, firstD = Infinity, secondD = Infinity;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = c.start; i < c.start + c.count; i++) {
      const prim = body.prims[i]!;
      if (prim.op === 'sub' || prim.op === 'groove' || prim.dead) continue;
      const d = sdPrimitive(p, prim);
      if (d < firstD) { secondD = firstD; firstD = d; first = i; }
      else if (d < secondD) { secondD = d; }
    }
  }
  return { first, firstD, secondD };
}

export interface PrimSample {
  /** Position along the primitive's own axis, 0 at `a` and 1 at `b`. */
  t: number;
  /** Angle in the ring basis: 0 along e1, +pi/2 along e2. */
  theta: number;
  /** sdBody at the reference point. Negative == our surface is PROUD of it. */
  d: number;
}

export interface PrimBin {
  prim: number;
  basis: RingBasis;
  samples: PrimSample[];
  /** Share of samples with a second primitive within blendK. Their numbers are soft. */
  blendDominated: number;
  /** Reference points that landed on a prim belonging to a DIFFERENT bone. */
  crossBone: number;
}

/**
 * Attribute every reference point to a primitive and record its residual in
 * that primitive's ring frame.
 *
 * A point whose nearest primitive rides a different bone than the one that
 * claimed it is counted in `crossBone` and DROPPED. That happens legitimately
 * where a torso prim's flesh covers the shoulder, and silently averaging it
 * into the shoulder's radius is exactly the mis-attribution this tool exists
 * to remove. `crossBone` is reported per bin rather than swallowed precisely
 * because the rule is lossy: a bin whose crossBone rivals its sample count is
 * measuring a seam, not a limb, and whatever is fitted from it should be
 * treated as such.
 */
export function binResiduals(
  pointsByBone: Map<string, Vec3[]>,
  body: Body,
  bones: Map<string, ResolvedBone>,
): Map<number, PrimBin> {
  const bins = new Map<number, PrimBin>();
  const basisOf = new Map<number, RingBasis>();

  for (const [boneName, points] of pointsByBone) {
    const bone = bones.get(boneName);
    if (!bone) continue;
    for (const p of points) {
      const { first, firstD, secondD } = twoNearestPrims(p, body);
      if (first < 0) continue;
      const prim = body.prims[first]!;

      let bin = bins.get(first);
      if (bin === undefined) {
        // The ring frame follows the PRIMITIVE's own axis where it has one, so
        // a prim offset off its bone still measures around itself. A point
        // prim (a == b) falls back to the bone's direction.
        let basis = basisOf.get(first);
        if (basis === undefined) {
          const axisLen = len(sub(prim.b, prim.a));
          basis = axisLen > 1e-9
            ? ringBasis(prim.a, prim.b)
            : ringBasis(prim.a, add(prim.a, sub(bone.tail, bone.head)));
          basisOf.set(first, basis);
        }
        bin = { prim: first, basis, samples: [], blendDominated: 0, crossBone: 0 };
        bins.set(first, bin);
      }

      if (prim.bone !== undefined && prim.bone !== boneName) { bin.crossBone++; continue; }

      const l = toLocal(p, bin.basis);
      const t = bin.basis.length > 1e-9
        ? Math.max(0, Math.min(1, l.along / bin.basis.length))
        : 0.5;
      bin.samples.push({ t, theta: Math.atan2(l.x2, l.x1), d: sdBody(p, body) });
      if (secondD - firstD < prim.blendK) bin.blendDominated++;
    }
  }

  for (const bin of bins.values()) {
    const n = bin.samples.length + bin.crossBone;
    bin.blendDominated = n === 0 ? 0 : bin.blendDominated / n;
  }
  return bins;
}

/** Below this many samples a primitive's numbers are noise; it is reported, not fitted. */
export const MIN_SAMPLES = 40;
/** A scale column carrying less than this share of the largest column is unreadable. */
const MIN_COLUMN_SHARE = 0.05;
/**
 * The instrument's own resolution, in metres.
 *
 * `sampleBodySurface` accepts a point once `|sdBody| < 1e-6`, so a residual of
 * that size is the projector stopping, not the body being wrong. Without an
 * ABSOLUTE floor the relative one below (`stdev/4`) has nothing to bite on when
 * a body already matches its reference: the residuals are all ~1e-10, their
 * spread is ~1e-10 too, and a quarter of nearly-nothing still lets nanometre
 * "corrections" through. A suggestion finer than the measurement is not a
 * measurement.
 */
const RESOLUTION = 1e-6;

export interface Change<T> { from: T; to: T; why: string }

export interface Suggestion {
  prim: number;
  /** 1-based .blob line, carried through from PrimDef.src. */
  src?: number;
  bone?: string;
  n: number;
  /** Mean |residual| in metres — the sort key. */
  meanAbs: number;
  blendDominated: number;
  crossBone: number;
  r?: Change<number>;
  r2?: Change<number>;
  /** Only components the data could actually see. */
  scales?: Array<{ axis: (typeof SCALE_AXIS_NAMES)[number] } & Change<number>>;
  offset?: { delta: Vec3; why: string };
  /** Set when the primitive was deliberately not fitted. Nothing else is populated. */
  skipped?: string;
  mirrorDisagreement?: number;
}

function mm(v: number): string { return `${(v * 1000).toFixed(1)}mm`; }

/**
 * Why a primitive cannot be fitted, or undefined when it can.
 *
 * bend/shell/orient all move or reshape the surface in ways this fit does not
 * model. Reporting them as skipped is honest; fitting them anyway would give a
 * confident wrong number, which is worse than no number at all.
 */
function skipReason(prim: Primitive): string | undefined {
  if (prim.dead) return 'dead (severed)';
  if (prim.op === 'sub') return 'carve — subtractive, no outer surface of its own';
  if (prim.op === 'groove') return 'groove — cuts a channel, not mass';
  if (prim.shell) return 'shell — a clipped sheet, not a ring';
  if (prim.bend) return 'bend — the medial curve is not the chord';
  if (prim.orient && Math.abs(1 - prim.orient[3]) > 1e-6) return 'orient — scale frame is rotated';
  if (Math.min(prim.scale[0], prim.scale[1], prim.scale[2]) <= 0) {
    return 'degenerate scale — a zero or negative component has no surface to measure';
  }
  return undefined;
}

/** Solve `M x = y` for a small dense system by Gauss-Jordan with partial pivoting. */
function solve(M: number[][], y: number[]): number[] | undefined {
  const n = y.length;
  const a = M.map((row, i) => [...row, y[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    if (Math.abs(a[piv]![c]!) < 1e-18) return undefined;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k <= n; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/**
 * Turn binned residuals into per-primitive parameter suggestions.
 *
 * NO AXIS IS CHOSEN. The predecessor attributed the residual's cos-2-theta term
 * to ONE world axis picked from the bone direction. On mouse.blob that had
 * `upperarm` and `forearm` — two bones in a single chain, both sitting ~42
 * degrees off any world axis — pick DIFFERENT axes, with upperarm's margin only
 * 0.074, so a 3-degree authoring change flipped the answer. Here every sample
 * contributes its own world direction `w` and the fit distributes the residual
 * across whatever columns that direction actually touches; a diagonal bone
 * lands in several at once, which is the honest description of it.
 *
 * THE ROWS PREDICT THE FIELD, NOT THE SURFACE DISPLACEMENT. `sdPrimitive`
 * measures in the prim's SCALED space and rescales by `minScale`, so for
 * `w` at perpendicular radius `rho` it reads
 *
 *     d = minScale * (rho * sqrt(Q) - r),   Q = sum_k (w_k / s_k)^2
 *
 * Differentiating THAT (rather than the surface radius `rho = r / sqrt(Q)`)
 * gives the step that drives `d` to zero:
 *
 *     -dd/dr    = minScale
 *     -dd/ds_k  = minScale * rho * w_k^2 / (s_k^3 * sqrt(Q))
 *
 * and `rho` comes from the measurement itself, `(d/minScale + r)/sqrt(Q)`,
 * rather than being assumed equal to our own surface. Differentiating `rho`
 * instead — as an earlier draft did — under-reports every anisotropic
 * correction by the varying factor `minScale * sqrt(Q)`: a deep=1.25 capsule
 * measured against an isotropic reference came back at deep=1.08 instead of
 * 1.00, which reads as a real but smaller error rather than as a wrong answer.
 *
 * TWO KINDS OF BLINDNESS ARE HANDLED, AND THEY ARE NOT THE SAME.
 *
 * 1. A component the samples never touch. The axis running ALONG the bone has
 *    `w_k ~ 0` in every sample, so its column is near-zero, the ridge term
 *    absorbs it, and it is left unsuggested. Not a rule — the data cannot see
 *    it.
 * 2. A component the samples touch but cannot SEPARATE. The ring only ever
 *    determines the world semi-axes `A_k = r * s_k`, so `(r, s)` and
 *    `(c*r, s/c)` describe the identical surface and the system is EXACTLY
 *    rank-deficient in that direction. Minimum-norm smears one real error
 *    across `r`, `wide` and `deep` alike. `regauge` below picks a
 *    representative instead of pretending the smear is a measurement.
 */
export function fitPrims(bins: Map<number, PrimBin>, body: Body): Suggestion[] {
  const out: Suggestion[] = [];

  // Iterate the BODY, not the bins. A primitive that is never the nearest one
  // anywhere on the surface gets no bin at all — measured on mouse.blob, 9 of
  // 67 — and iterating bins would drop it from the report silently. An
  // unmeasurable primitive must SAY it is unmeasurable.
  for (let index = 0; index < body.prims.length; index++) {
    const prim = body.prims[index]!;
    const bin = bins.get(index);
    const base = {
      prim: index, src: prim.src, bone: prim.bone,
      n: bin?.samples.length ?? 0,
      blendDominated: bin?.blendDominated ?? 0,
      crossBone: bin?.crossBone ?? 0,
    };

    const skipped = skipReason(prim);
    if (skipped !== undefined) { out.push({ ...base, meanAbs: 0, skipped }); continue; }
    if (bin === undefined) {
      out.push({ ...base, meanAbs: 0,
        skipped: 'no samples — never the nearest primitive anywhere on the surface (fully buried under the blend)' });
      continue;
    }
    if (bin.samples.length < MIN_SAMPLES) {
      const why = bin.crossBone > 0
        ? `only ${bin.samples.length} samples (need ${MIN_SAMPLES}); ${bin.crossBone} more went to another bone`
        : `only ${bin.samples.length} samples (need ${MIN_SAMPLES})`;
      out.push({ ...base, meanAbs: 0, skipped: why });
      continue;
    }

    const n = bin.samples.length;
    const d = bin.samples.map((s) => s.d);
    const a0 = d.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - a0) ** 2, 0) / n);
    // Relative to the spread so it scales with the character, but never finer
    // than the instrument can resolve. The 1/4 is a GUESS — re-derive it from
    // the observed spread after the first real pass (see the spec).
    const floor = Math.max(sd / 4, RESOLUTION);
    // The field is measured in scaled space and rescaled by minScale, so a
    // residual in FIELD units becomes metres of radius by dividing by it.
    const minScale = Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);

    let a1 = 0, b1 = 0, tbar = 0;
    for (const s of bin.samples) {
      a1 += s.d * Math.cos(s.theta); b1 += s.d * Math.sin(s.theta); tbar += s.t;
    }
    a1 = 2 * a1 / n; b1 = 2 * b1 / n; tbar /= n;

    let sxy = 0, sxx = 0;
    for (const s of bin.samples) { const dt = s.t - tbar; sxy += dt * s.d; sxx += dt * dt; }
    const m = sxx < 1e-12 ? 0 : sxy / sxx;

    const sug: Suggestion = { ...base, meanAbs: d.reduce((s, x) => s + Math.abs(x), 0) / n };

    // ---- Least squares over (dr, dwide, dtall, ddeep). See the header: the
    // rows differentiate the FIELD, and `w` is each sample's own world
    // direction so no axis has to be picked.
    const A: number[][] = [];
    // Targets are collected ALONGSIDE the rows, not indexed back into `d`: a
    // degenerate sample is skipped below, and reading `d[i]` afterwards would
    // silently pair every later row with the wrong residual.
    const rhs: number[] = [];
    for (const s of bin.samples) {
      const ct = Math.cos(s.theta), st = Math.sin(s.theta);
      const w: Vec3 = [
        bin.basis.e1[0] * ct + bin.basis.e2[0] * st,
        bin.basis.e1[1] * ct + bin.basis.e2[1] * st,
        bin.basis.e1[2] * ct + bin.basis.e2[2] * st,
      ];
      let q = 0;
      for (let k = 0; k < 3; k++) q += (w[k]! / prim.scale[k]!) ** 2;
      if (q < 1e-18) continue;
      const sq = Math.sqrt(q);
      // The REFERENCE point's own perpendicular radius, read back out of the
      // residual rather than assumed to be our surface's.
      const rho = (s.d / minScale + prim.radius) / sq;
      const g = minScale * rho / sq;
      A.push([
        minScale,
        (g * w[0]! ** 2) / prim.scale[0] ** 3,
        (g * w[1]! ** 2) / prim.scale[1] ** 3,
        (g * w[2]! ** 2) / prim.scale[2] ** 3,
      ]);
      rhs.push(s.d);
    }

    const colNorm = [0, 0, 0, 0];
    const AtA = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const Atb = [0, 0, 0, 0];
    A.forEach((row, i) => {
      for (let p = 0; p < 4; p++) {
        colNorm[p]! += row[p]! ** 2;
        Atb[p]! += row[p]! * rhs[i]!;
        for (let q2 = 0; q2 < 4; q2++) AtA[p]![q2]! += row[p]! * row[q2]!;
      }
    });
    // Ridge, sized off the system itself: enough to keep the rank-deficient
    // columns from exploding, small enough not to bias the rest. It selects the
    // minimum-norm representative of the null space, which `regauge` then
    // replaces with a more actionable one.
    const lambda = 1e-4 * Math.max(AtA[0]![0]!, AtA[1]![1]!, AtA[2]![2]!, AtA[3]![3]!);
    for (let p = 0; p < 4; p++) AtA[p]![p]! += lambda;
    const x = solve(AtA, Atb);

    // ---- Re-gauge. `r` and a uniform scale are the SAME edit, so the solver's
    // split between them is arbitrary; only the world semi-axes `A_k = r*s_k`
    // are measured. Work in gauge-invariant relative terms, `rel_k = dA_k/A_k`,
    // then split `rel_k = gamma + sigma_k` (gamma = dr/r, sigma_k = ds_k/s_k)
    // by the choice that touches the FEWEST authored numbers: the minimiser of
    // |gamma| + sum |sigma_k| is the median of {0} together with the rel_k.
    // Reporting the minimum-norm split instead spreads one wrong `deep=` across
    // `r=`, `wide=` and `deep=` — three edits with the same net effect as one,
    // and no way for a reader to tell which was actually wrong.
    const biggest = Math.max(colNorm[1]!, colNorm[2]!, colNorm[3]!);
    const visible = x === undefined ? [] : ([0, 1, 2] as const)
      .filter((k) => colNorm[k + 1]! >= MIN_COLUMN_SHARE * biggest);
    const rel = new Map<number, number>();
    let gamma = 0;
    if (x !== undefined) {
      const gamma0 = x[0]! / prim.radius;
      for (const k of visible) rel.set(k, gamma0 + x[k + 1]! / prim.scale[k]!);
      gamma = visible.length === 0 ? gamma0 : median([0, ...rel.values()]);
    }
    const dr = prim.radius * gamma;

    const tapered = Math.abs(m) > floor && bin.basis.length > 1e-9;
    if (tapered) {
      const r2Now = prim.radiusB ?? prim.radius;
      sug.r = { from: prim.radius, to: prim.radius + (a0 + m * (0 - tbar)) / minScale,
                why: 'taper, see r2' };
      sug.r2 = { from: r2Now, to: r2Now + (a0 + m * (1 - tbar)) / minScale,
                 why: `taper: ${mm(m / minScale)} of residual across the primitive` };
    } else if (x !== undefined && Math.abs(dr) * minScale > floor) {
      sug.r = { from: prim.radius, to: prim.radius + dr,
                why: `least squares, ${mm(dr)}` };
    }

    if (x !== undefined) {
      const scales: NonNullable<Suggestion['scales']> = [];
      for (const k of visible) {
        const sigma = rel.get(k)! - gamma;
        // Gate on the metres of surface this moves, not on the bare ratio: a
        // 1% change to a 5mm feature is not a measurement.
        if (Math.abs(sigma) * prim.radius * prim.scale[k]! * minScale <= floor) continue;
        scales.push({
          axis: SCALE_AXIS_NAMES[k]!,
          from: prim.scale[k]!, to: prim.scale[k]! * (1 + sigma),
          why: `least squares over the field, column share ${(100 * colNorm[k + 1]! / biggest).toFixed(0)}%`,
        });
      }
      if (scales.length) sug.scales = scales;
    }

    if (Math.hypot(a1, b1) > floor) {
      sug.offset = {
        delta: add(vscale(bin.basis.e1, a1 / minScale), vscale(bin.basis.e2, b1 / minScale)),
        why: `cos1θ ${mm(Math.hypot(a1, b1) / minScale)} off-centre`,
      };
    }

    out.push(sug);
  }

  return out.sort((x2, y2) => y2.meanAbs - x2.meanAbs);
}
