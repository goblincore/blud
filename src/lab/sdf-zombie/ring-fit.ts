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
import { ringBasis, toLocal, type RingBasis } from './ref-align';
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
