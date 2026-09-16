// src/lab/sdf-zombie/gib-tear.ts
//
// THE RUPTURE WINDOW — the body coming apart BEFORE it becomes chunks.
//
// This replaces the earlier "pre-tear" window, and the difference is the whole
// point of the owner's report. The old window bent the flesh outward from the
// blast and then RELAXED BACK TO THE CLEAN POSE at the end of its 100 ms, so the
// last frame before release was the intact body again and the body "instantly
// became separate chunks" on the next. Increasing that timer would only hold an
// intact body longer. The owner asked for the opposite: *"the SDF flesh ...
// distort the flesh from the shockwave and jiggle and then rip away"* — the
// regions that separate must be the regions that fly, continuously, with no
// return to the pose.
//
// WHAT IS NORMALISED. `ruptureProgress` runs 0..1 over `sec` (default 0.2 s),
// monotonic, reaching exactly 1 at release — never back to 0. At progress 0 the
// body is bit-identical to the posed body, so the onset silhouette is exact; at
// progress 1 the regions are at the offsets the chunks are spawned with, so the
// displayed frame and the first chunk frame agree.
//
// REGION RIGID, NOT PER-PRIM SMOOTH. Each piece of the gib plan (gib-parts.ts)
// moves as ONE region: every prim it owns — flesh, bone and the cut caps that
// have no source index — is translated by the same offset. That is what makes
// the hand-off exact (the drawn region IS the spawned region, same prims, same
// transform) and what opens real seams between neighbours. A per-prim field
// would smear the cut planes apart and put the caps somewhere else.
//
// BONES LAG THE FLESH. A bone region follows `boneLag` of the flesh push and has
// no seam of its own, so the flesh pulls away from the skeleton and the ribs
// become the surface in the gap instead of riding out with the meat.
//
// VIEW-ONLY, LIKE THE OLD WINDOW: `posed()` stays clean. The actor's own body is
// what the resolver, the wound ring and the piece plan read; only the march
// draws the rupture. When the window closes the caller spawns the SAME plan at
// the SAME offsets (see game-main's spawnScheduledGibs), so there is no second
// partition and no second pose to drift.
//
// PURE. No Date.now, no Math.random: the capture rigs compare runs.
import type { BuildResult } from './build-body';
import type { Primitive, Vec3 } from './types';
import { refitClusters } from './rig-bind';
import { add, len, scale, sub } from './vec';

/**
 * The window's shape. ALL of it is in one place so a look pass has one place to
 * look, and every value is a `number` rather than a literal: the page retunes
 * this per actor (`ZombieActor.setTearTuning`).
 */
export interface TearTuning {
  /** Seconds the regions take to separate before they become pieces.
   *  Contract range 0.15–0.25; 0.2 is the agreed start. */
  sec: number;
  /** Peak displacement, metres, of the flesh at the surface facing the blast. */
  amplitudeM: number;
  /** Distance over which the displacement decays, metres: e^{-d/falloff}. */
  falloffM: number;
  /** Shudder rate. The window is ~0.2 s, so a few cycles read as a shudder;
   *  much more than that reads as a buzz. */
  jiggleHz: number;
  /** Shudder depth as a fraction of the displacement. Under 1 so the push is
   *  never inward: the flesh is driven OUT from the blast and wobbles on the
   *  way, it does not pump. */
  jiggleAmp: number;
  /**
   * Extra separation of two neighbours along their own cut, metres. This is
   * what makes a SEAM rather than a translation: two pieces at nearly the same
   * distance from the blast would otherwise move almost identically and stay
   * welded. Reference scale: the cut overhang is a blend radius, a few mm.
   */
  seamM: number;
  /**
   * Fraction of the flesh push a BONE region follows, 0..1. Below 1 the
   * skeleton lags the meat and is exposed in the opening gaps — that lag, not
   * a separate reveal timer, is the rib exposure.
   */
  boneLag: number;
  /** Displacement scale for the head region, so the face stays recognizable
   *  rather than being thrown with the chest. */
  headDamp: number;
}

export const TEAR_TUNING: TearTuning = {
  sec: 0.2,
  amplitudeM: 0.055,
  falloffM: 0.8,
  jiggleHz: 22,
  jiggleAmp: 0.35,
  seamM: 0.05,
  boneLag: 0.3,
  headDamp: 0.3,
};

const TAU = Math.PI * 2;
/** Golden angle, in radians — spreads consecutive regions' shudder phases as
 *  evenly as any constant can, with no RNG (this path must stay deterministic:
 *  the capture rigs compare runs). */
const PHASE_STEP = 2.399963229728653;

/**
 * The window's progress, 0..1. Monotonic, and it reaches exactly 1 at `sec` and
 * STAYS there — the old envelope's return to 0 was the "there is no tear, the
 * body just becomes chunks" bug. The shape is ease-out: a blast arrives as an
 * impulse, so most of the separation is present early (0.31 by 35 ms on a
 * 200 ms window) and the rest is spent opening seams and finishing the pull.
 *
 * `t` is seconds since the rupture began; anything at or outside the window is
 * clamped, so a caller that keeps calling past the end is inert, not wrong.
 */
export function ruptureProgress(t: number, sec: number = TEAR_TUNING.sec): number {
  if (!(sec > 0) || !(t > 0)) return 0;
  if (t >= sec) return 1;
  const u = t / sec;
  return 1 - (1 - u) * (1 - u);
}

/** A live rupture: where the blast was, how hard it hit, how long it has run. */
export interface TearState {
  at: Vec3;
  /** The resolver's falloff at this body, 0..1 — a grazing blast barely moves. */
  falloff: number;
  age: number;
}

/** The slice of a gib piece the rupture needs: an identity, a centre and the
 *  source indices of the prims/bones it owns. `GibPiece` satisfies it. */
export interface RuptureRegion {
  origin: Vec3;
  limb: string;
  /** The chunk kind the region will become ('limb' | 'bone' | …). Only 'bone'
   *  matters to the rupture (it lags the flesh); typed as string so a
   *  `GibPiece`'s `ChunkKind` is assignable without a wider coupling. */
  kind: string;
  srcPrims?: number[];
  srcBones?: number[];
}

/** A cut between two regions, `a` keeping the `-n` side, indexed by region. */
export interface RuptureCut {
  a: number;
  b: number;
  at: Vec3;
  n: Vec3;
}

/** The reusable region plan: the pieces plus the cuts between them. A
 *  `gib-parts.ts` `GibPlan` satisfies this structurally. */
export interface RupturePlan {
  pieces: readonly RuptureRegion[];
  cuts: readonly RuptureCut[];
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * The rigid offset of every region at the current age. Pure and deterministic:
 * the same (plan, tear, tuning) always gives the same offsets, and progress 0
 * gives the zero vector for every region (so the body is its own pose).
 *
 * Every region is pushed away from the blast with the falloff weight, shuddered
 * by its own phase, damped on the head and lagged on bones. Then each cut adds
 * a symmetric ±n separation to its two sides, which is what actually opens the
 * seam between two neighbours the blast pushes almost equally.
 */
export function ruptureOffsets(
  plan: RupturePlan,
  tear: TearState,
  tuning: TearTuning = TEAR_TUNING,
): Vec3[] {
  const p = ruptureProgress(tear.age, tuning.sec);
  const fall = Math.max(0, Math.min(1, tear.falloff));
  const n = plan.pieces.length;
  if (p <= 0) return new Array(n).fill(ZERO);
  const phase0 = TAU * tuning.jiggleHz * tear.age;
  const offsets: Vec3[] = new Array(n);
  for (let r = 0; r < n; r++) {
    const region = plan.pieces[r]!;
    const off = sub(region.origin, tear.at);
    const dist = len(off);
    // A region sitting exactly ON the blast point has no outward direction.
    // The body's up is the only axis that means anything there, and it only has
    // to be stable — a division by zero would put a NaN in the prim rows and
    // blank the body rather than move it.
    const dir: Vec3 = dist < 1e-5 ? [0, 1, 0] : scale(off, 1 / dist);
    // The shudder is never negative enough to reverse the push (jiggleAmp < 1),
    // so the flesh is driven OUT, never sucked in.
    const shudder = 1 + tuning.jiggleAmp * Math.sin(phase0 + r * PHASE_STEP);
    let mag = tuning.amplitudeM * Math.exp(-dist / tuning.falloffM) * fall * p * shudder;
    if (region.kind === 'bone') mag *= tuning.boneLag;
    if (region.limb === 'head') mag *= tuning.headDamp;
    let v = scale(dir, mag);
    for (const cut of plan.cuts) {
      if (cut.a !== r && cut.b !== r) continue;
      const cw = Math.exp(-len(sub(cut.at, tear.at)) / tuning.falloffM) * fall;
      const s = tuning.seamM * cw * p;
      v = cut.a === r ? add(v, scale(cut.n, -s)) : add(v, scale(cut.n, s));
    }
    offsets[r] = v;
  }
  return offsets;
}

/** The body the march should draw this frame, plus the region offsets it was
 *  built with — the exact pair the chunk spawn reuses. */
export interface RuptureFrame {
  body: BuildResult;
  offsets: Vec3[];
}

/**
 * Bend a POSED body away from the blast by moving every planned region as a
 * rigid unit. Pure: `posed` is not mutated. Returns the posed body itself (and
 * zero offsets) when the window has not started, so progress 0 is bit-identical
 * to the pre-blast frame — the exact onset silhouette the contract requires.
 *
 * Every upload goes through here, so the cull bounds have to cover the moved
 * prims or the march CULLS them (an under-covering bound does not draw a wrong
 * shape, it deletes geometry — see refitClusters).
 */
export function rupturePosed(
  posed: BuildResult,
  plan: RupturePlan,
  tear: TearState,
  tuning: TearTuning = TEAR_TUNING,
): RuptureFrame {
  const offsets = ruptureOffsets(plan, tear, tuning);
  let moved = false;
  for (const o of offsets) if (o[0] !== 0 || o[1] !== 0 || o[2] !== 0) { moved = true; break; }
  if (!moved) return { body: posed, offsets };

  const primRegion = new Int32Array(posed.prims.length).fill(-1);
  const boneRegion = new Int32Array((posed.bonePrims ?? []).length).fill(-1);
  for (let r = 0; r < plan.pieces.length; r++) {
    const region = plan.pieces[r]!;
    for (const i of region.srcPrims ?? []) if (i >= 0 && i < primRegion.length) primRegion[i] = r;
    for (const i of region.srcBones ?? []) if (i >= 0 && i < boneRegion.length) boneRegion[i] = r;
  }
  const shift = (q: Primitive, o: Vec3): Primitive => ({ ...q, a: add(q.a, o), b: add(q.b, o) });
  const prims = posed.prims.map((q, i) => {
    const r = primRegion[i]!;
    return r >= 0 ? shift(q, offsets[r]!) : q;
  });
  const bonePrims = (posed.bonePrims ?? []).map((q, i) => {
    const r = boneRegion[i]!;
    return r >= 0 ? shift(q, offsets[r]!) : q;
  });
  return {
    body: { ...posed, prims, bonePrims, clusters: refitClusters(prims, posed.clusters) },
    offsets,
  };
}
