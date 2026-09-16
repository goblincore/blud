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
  /**
   * FLESH PEEL: extra metres the ribcage-bearing chest band is lifted along
   * the body's own cranial axis (the plan's `up`), scaled by the region's
   * `peel`. This is what opens a REAL gap over the cage — a rigid translation
   * of the whole chest just slides the flesh, and the overlapping spine blobs
   * keep the surface closed. Along the body axis, not the blast push, so the
   * reveal is the same wherever the bundle landed.
   */
  chestPeelM: number;
}

export const TEAR_TUNING: TearTuning = {
  sec: 0.2,
  amplitudeM: 0.06,
  falloffM: 0.8,
  jiggleHz: 22,
  jiggleAmp: 0.35,
  // TASK-2 TUNING (2026-09-16). At 0.05 m the seam was dominated by the blast's
  // radial push, so the whole body read as INFLATING and the chest never
  // visibly left the pelvis. 0.09 m plus the sharper seam ramp below makes the
  // chest/abdomen gap readable by ~67 ms (see RESULTS.md, 150/200/250 ms
  // candidates). The lagging cage sits in that gap; at gameplay distance the
  // pale skeleton is still not readable — that remains an open item, recorded
  // honestly in RESULTS.md §7.
  seamM: 0.09,
  // 0.15, down from 0.3: the cage must stay near the body's own pose while the
  // meat leaves, or it rides out with the chest.
  boneLag: 0.15,
  headDamp: 0.3,
  // TASK-3 (2026-09-16). The chest band now splits at the costal margin
  // (gib-parts splitTorso), and this peel lifts it clear of the ~0.20 m the
  // neighbouring abdominal mass still occupies, so the smin bridge tears and
  // the ribcage is left standing in the opening. Tuned against the 200 ms
  // captures; see RESULTS.md Task 3.
  chestPeelM: 0.3,
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

/**
 * THE MATERIAL RAMP (body-to-gib task 3). A spawned flesh chunk renders with
 * `lodCfg.w` (goreStrength) 1; a standing body renders with 0, and that single
 * value was the whole "smooth flesh → mottled chunks" pop at the release
 * frame (see march.wgsl.ts's gore block). This is the doomed body's value over
 * the window: EXACTLY 0 through the recoil phase so the intact silhouette is
 * untouched, then rising to EXACTLY 1 at release, so the frame before the
 * pieces spawn already wears the surface they spawn with. View-wide by
 * necessity — the channel is a per-view scalar — which is why it is gated on
 * progress rather than switched on.
 */
export function ruptureGore(p: number): number {
  const u = Math.max(0, Math.min(1, (p - 0.1) / 0.75));
  return u * u * (3 - 2 * u);
}

/** A live rupture: where the blast was, how hard it hit, how long it has run. */
export interface TearState {
  at: Vec3;
  /** The resolver's falloff at this body, 0..1 — a grazing blast barely moves. */
  falloff: number;
  age: number;
}

/**
 * The SEAM's own ramp, deliberately sharper than the global push. The push
 * opens on an ease-out (an impulse that settles), which is right for the body's
 * travel but reads as inflation if the CUTS open at the same rate: the two sides
 * of a cut separate by almost the same amount late in the window. sqrt(p) is
 * 0.5 at p=0.25 and 0.71 at p=0.5, so the gap between chest and abdomen is
 * already legible around 67 ms while the overall silhouette stays coherent.
 */
function seamProgress(p: number): number {
  return Math.sqrt(Math.max(0, Math.min(1, p)));
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
  /** FLESH-PEEL scale, applied along the plan's own cranial axis at
   *  `TearTuning.chestPeelM * peel` (see `TearTuning.chestPeelM`). */
  peel?: number;
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
  /** The body's own cranial axis — the direction `peel` is applied along. */
  up?: Vec3;
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
    const sp = seamProgress(p);
    // FLESH PEEL. A piece flagged `peel` is lifted ALONG THE BODY'S CRANIAL
    // AXIS on the same sharp ramp as the seams, so the chest opens off the
    // ribcage early in the window. This is not a second push: it is the
    // separation the cut needs to become a hole, and it is deliberately
    // independent of `dir` so an off-centre bundle still peels the chest
    // upward along the spine rather than sideways.
    if (region.peel) {
      const up = plan.up;
      if (up) v = add(v, scale(up, tuning.chestPeelM * region.peel * fall * sp));
    }
    for (const cut of plan.cuts) {
      if (cut.a !== r && cut.b !== r) continue;
      const cw = Math.exp(-len(sub(cut.at, tear.at)) / tuning.falloffM) * fall;
      const s = tuning.seamM * cw * sp;
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
  // NOTE ON THE CUT CAPS (task 3). The obvious companion — append each piece's
  // `sub` caps here so the moving cut is a real hole — does NOT work in a
  // single SDF union, and the failure is geometric, not a bug to fix: a cap is
  // a huge sphere tangent to the cut plane that removes everything on the far
  // side, which is correct PER PIECE (a chunk is its own marched field) but
  // deletes the NEIGHBOUR when both pieces share one field. The rib reveal is
  // therefore a real PEEL (`TearTuning.chestPeelM`) that lifts the chest band
  // far enough to tear the smin bridge and clear the cage, and the residual
  // between the drawn (rounded) cut and the spawned (capped, flat) face is the
  // sub-centimetre overhang the piece set already documented — measured in
  // RESULTS.md Task 3 rather than asserted.
  return {
    body: { ...posed, prims, bonePrims, clusters: refitClusters(prims, posed.clusters) },
    offsets,
  };
}
