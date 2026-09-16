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
import {
  add, cross, dot, len, normalize, qFromAxisAngle, qIdentity, qMul, qNormalize,
  qRotate, scale, sub, type Quat,
} from './vec';

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
  /** Displacement scale for the head region's OWN blast push — the residual
   *  recoil it keeps after `headFollow`. This is no longer the head's whole
   *  motion: the head is attached to the upper torso (owner report 2026-09-16),
   *  so damping it to a third while the chest got a full push plus a 0.3 m peel
   *  let the chest rise INTO the head and read as a swollen head. See
   *  `headFollow`. */
  headDamp: number;
  /**
   * HEAD ATTACHMENT (owner report 2026-09-16). Fraction of the upper torso's
   * (chest) region offset the head RIDES while the neck is still attached,
   * 0..1. At 1 the head is rigidly carried by the upper body's recoil and
   * cranial displacement, so no blast direction can leave it behind under a
   * chest that is peeling toward it; below 1 a little of the head's own damped
   * push survives. The relative head/chest motion is then the neck gap below,
   * NOT an independent damped lag.
   */
  headFollow: number;
  /**
   * NECK SEPARATION, metres. While attached, the head opens this far from the
   * upper torso ALONG THE BODY'S OWN AXIS on the same sharp seam ramp, so the
   * neck visibly parts ahead of the blast push. It is a guaranteed MINIMUM
   * separation at full falloff, not an addition on top of whatever the chest's
   * peel happens to do — the defect this task fixes is exactly the chest
   * out-travelling the head.
   */
  neckGapM: number;
  /**
   * ROOT RECOIL, metres. The blast JOLTS the whole body away from the epicentre
   * over the window: every region takes this uniform displacement along the
   * body's own direction away from the blast. Uniform on purpose — it adds no
   * relative motion, so it is the owner's "clear recoil" without turning the
   * tear back into the inflation the seam ramp exists to prevent. It does not
   * relax back to the pose; the released pieces spawn from where the body was
   * last drawn.
   */
  recoilM: number;
  /**
   * FLESH PEEL: extra metres the ribcage-bearing chest band is lifted along
   * the body's own cranial axis (the plan's `up`), scaled by the region's
   * `peel`. This is what opens a REAL gap over the cage — a rigid translation
   * of the whole chest just slides the flesh, and the overlapping spine blobs
   * keep the surface closed. Along the body axis, not the blast push, so the
   * reveal is the same wherever the bundle landed.
   */
  chestPeelM: number;
  /**
   * PEAK ANGULAR SPEED, rad/s, the blast imparts to a region at the body's
   * surface. The rotation is LINEAR in age (a constant angular velocity, which
   * is what an impulsive torque produces), so the region is already turning at
   * this rate on the last pre-release frame and the live chunk keeps turning at
   * the same rate: orientation AND its derivative are continuous across the
   * hand-off, and there is no second angular kick. Owner correction 2026-09-16:
   * before this the regions only TRANSLATED and every piece stood upright, so
   * the breakup read as an exploded assembly diagram.
   */
  spinRadPerSec: number;
  /** How far a region's spin axis leans from the blast's own radial-plane
   *  tumble axis toward a stable per-region seeded axis, 0..1. 0 is every
   *  region spinning about the same kind of axis (a synchronous blender); 1 is
   *  unrelated axes (noise). ~0.5 reads as one blast acting on distinct pieces. */
  spinCoherence: number;
  /** Spin scale for a released BONE region. Below 1 the skeleton keeps some of
   *  its upright read — the same lag that exposes the ribs — instead of
   *  tumbling like meat. */
  boneSpin: number;
  /** Spin scale for the head region, so the face stays recognizable. */
  headSpin: number;
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
  // 0.3 is the head's own residual recoil ONLY; the head's motion is dominated
  // by `headFollow` below (see the owner report).
  headDamp: 0.3,
  // HEAD ATTACHMENT (2026-09-16 playtest follow-up task 4). 0.85 keeps a trace
  // of the head's own recoil while making it ride the upper torso's travel;
  // `neckGapM` then guarantees the joint opens by at least 7 cm along the body
  // axis, so the chest can never peel up into the head. See the fields' docs.
  headFollow: 0.85,
  neckGapM: 0.07,
  // ROOT RECOIL (2026-09-16 task 4). A bounded whole-body jolt away from the
  // epicentre; uniform, so it is pure recoil and opens no seam of its own.
  recoilM: 0.05,
  // TASK-3 (2026-09-16). The chest band now splits at the costal margin
  // (gib-parts splitTorso), and this peel lifts it clear of the ~0.20 m the
  // neighbouring abdominal mass still occupies, so the smin bridge tears and
  // the ribcage is left standing in the opening. Tuned against the 200 ms
  // captures; see RESULTS.md Task 3.
  chestPeelM: 0.3,
  // TASK-4 (2026-09-16). Owner: "when the zombie begins coming apart all pieces
  // remain upright/parallel, like an exploded assembly diagram. The pieces
  // should already be rotated into different angles and have angular velocity."
  // At 0.2 s a 3.2 rad/s peak gives a ~37 deg final tilt on a surface region
  // (more on a small piece, less on the lagging skeleton and the head), reached
  // linearly so the rate carries into flight unchanged. See ruptureSpins.
  spinRadPerSec: 3.2,
  // Half blast-coherent, half region-seeded: a blast turning every piece about
  // the same axis reads as a machine; fully independent axes read as noise.
  spinCoherence: 0.5,
  boneSpin: 0.5,
  headSpin: 0.3,
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
  /** Stable label ('torso.chest', 'bone.cage', …). The spin axis varies by it,
   *  so two regions of the same limb must not share one. Optional for
   *  hand-built plans. */
  part?: string;
  /** Reach of this region's own geometry from `origin`, metres. Feeds the spin
   *  magnitude: a smaller piece turns faster for the same angular impulse.
   *  Optional (defaults to a mid-body reach) so hand-built plans compile. */
  radius?: number;
  /** The chunk kind the region will become ('limb' | 'bone' | …). Only 'bone'
   *  matters to the rupture (it lags AND spins less); typed as string so a
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
 * by its own phase and lagged on bones. Then each cut adds a symmetric ±n
 * separation to its two sides, which is what actually opens the seam between
 * two neighbours the blast pushes almost equally. Finally the head is RE-ATTACHED
 * to the upper torso (`headFollow` + `neckGapM`) so the chest cannot overtake it,
 * and the whole body takes the uniform root recoil.
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
  const sp = seamProgress(p);
  const up: Vec3 = plan.up && len(plan.up) > 1e-6 ? normalize(plan.up) : [0, 1, 0];
  // ——— ROOT RECOIL ——————————————————————————————————————————————————————————
  // A blast JOLTS the body, it does not merely open seams in place. The owner's
  // "clear recoil" is that jolt: one bounded displacement of every region along
  // the body's own direction away from the epicentre, on the same ease-out as
  // the push and NOT relaxing back at the end (the old window's return to the
  // clean pose was the "it just becomes chunks" bug). Uniform across regions, so
  // it adds no relative motion and cannot reintroduce inflation.
  let recoil: Vec3 = ZERO;
  if (tuning.recoilM > 0) {
    let cx = 0, cy = 0, cz = 0;
    for (const piece of plan.pieces) {
      cx += piece.origin[0]; cy += piece.origin[1]; cz += piece.origin[2];
    }
    const inv = 1 / Math.max(1, plan.pieces.length);
    const centre: Vec3 = [cx * inv, cy * inv, cz * inv];
    const away = sub(centre, tear.at);
    const awayLen = len(away);
    const awayDir: Vec3 = awayLen < 1e-5 ? up : scale(away, 1 / awayLen);
    recoil = scale(awayDir, tuning.recoilM * fall * p);
  }
  const offsets: Vec3[] = new Array(n);
  for (let r = 0; r < n; r++) {
    const region = plan.pieces[r]!;
    const off = sub(region.origin, tear.at);
    const dist = len(off);
    // A region sitting exactly ON the blast point has no outward direction.
    // The body's up is the only axis that means anything there, and it only has
    // to be stable — a division by zero would put a NaN in the prim rows and
    // blank the body rather than move it.
    const dir: Vec3 = dist < 1e-5 ? up : scale(off, 1 / dist);
    // The shudder is never negative enough to reverse the push (jiggleAmp < 1),
    // so the flesh is driven OUT, never sucked in.
    const shudder = 1 + tuning.jiggleAmp * Math.sin(phase0 + r * PHASE_STEP);
    let mag = tuning.amplitudeM * Math.exp(-dist / tuning.falloffM) * fall * p * shudder;
    if (region.kind === 'bone') mag *= tuning.boneLag;
    if (region.limb === 'head') mag *= tuning.headDamp;
    let v = scale(dir, mag);
    // FLESH PEEL. A piece flagged `peel` is lifted ALONG THE BODY'S CRANIAL
    // AXIS on the same sharp ramp as the seams, so the chest opens off the
    // ribcage early in the window. This is not a second push: it is the
    // separation the cut needs to become a hole, and it is deliberately
    // independent of `dir` so an off-centre bundle still peels the chest
    // upward along the spine rather than sideways.
    if (region.peel) {
      v = add(v, scale(up, tuning.chestPeelM * region.peel * fall * sp));
    }
    for (const cut of plan.cuts) {
      if (cut.a !== r && cut.b !== r) continue;
      const cw = Math.exp(-len(sub(cut.at, tear.at)) / tuning.falloffM) * fall;
      const s = tuning.seamM * cw * sp;
      v = cut.a === r ? add(v, scale(cut.n, -s)) : add(v, scale(cut.n, s));
    }
    offsets[r] = add(v, recoil);
  }
  // ——— THE HEAD RIDES THE UPPER TORSO (owner report 2026-09-16) ——————————————
  // THE DEFECT: the chest band gets a full blast push PLUS an independent 0.3 m
  // cranial peel, while the head was damped to 0.3 of its own push and had no
  // peel — so the chest out-travelled the head by ~0.3 m and rose INTO it, which
  // read as a swollen/enveloped head. A damped head is the wrong model: the head
  // is ATTACHED to the upper torso, so it must travel with the upper torso's
  // recoil and cranial displacement while the neck holds, and only then carry
  // its own transform into flight. `headFollow` is that attachment; `neckGapM`
  // then opens the joint along the body's own axis as a guaranteed MINIMUM, so
  // whatever the blast direction and however hard the chest peels, the head is
  // never left underneath it. The residual `headDamp` push keeps the head from
  // being perfectly welded (so it does not read as one rigid slab).
  const headIdx = plan.pieces.findIndex(x => x.limb === 'head');
  if (headIdx >= 0 && n > 1 && (tuning.headFollow > 0 || tuning.neckGapM > 0)) {
    const parentIdx = headAttachParent(plan, headIdx);
    if (parentIdx >= 0) {
      const follow = Math.max(0, Math.min(1, tuning.headFollow));
      const own = offsets[headIdx]!;
      const parent = offsets[parentIdx]!;
      let head = add(scale(parent, follow), scale(own, 1 - follow));
      const want = tuning.neckGapM * fall * sp;
      const relUp = dot(sub(head, parent), up);
      if (relUp < want) head = add(head, scale(up, want - relUp));
      offsets[headIdx] = head;
    }
  }
  return offsets;
}

/**
 * The region the head hangs from: the ribcage-bearing chest band when the plan
 * has one (`gibBlastPlan`/`gibPlan`), otherwise the region whose own origin is
 * nearest the head's. The nearest-origin fallback is what makes the attachment
 * work on the `clusters` tier too, where the torso is one whole piece labelled
 * `torso` rather than split into `torso.chest`.
 */
function headAttachParent(plan: RupturePlan, headIdx: number): number {
  const chest = plan.pieces.findIndex((x, i) => i !== headIdx && x.part === 'torso.chest');
  if (chest >= 0) return chest;
  const headOrigin = plan.pieces[headIdx]!.origin;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < plan.pieces.length; i++) {
    if (i === headIdx) continue;
    if (plan.pieces[i]!.limb === 'head') continue;
    const d = len(sub(plan.pieces[i]!.origin, headOrigin));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * One region's spin schedule: a unit world axis and a signed angular speed.
 * The displayed rotation is `qFromAxisAngle(axis, rate * age)` — LINEAR in age,
 * i.e. a constant angular velocity, which is the torque-free motion an
 * impulsive blast torque produces. That linearity is what makes the hand-off
 * exact: the sample at the release age is a valid state of the very rotation
 * the live chunk continues at the same rate.
 */
export interface RegionSpin {
  axis: Vec3;
  rate: number;
}

/** FNV-1a-style deterministic hash → a stable 0..1 value for a string salt.
 *  The spin variation must be PURE and repeatable (capture rigs compare runs),
 *  so per-region asymmetry is seeded from the region's name and index rather
 *  than Math.random. */
function hash01(key: string, salt: number): number {
  let h = (2166136261 ^ Math.imul(salt >>> 0, 2654435761)) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/**
 * THE BLAST TORQUE, per region. Pure and deterministic — the same
 * (plan, tear, tuning) always gives the same spins, and progress 0 (or a zero
 * falloff) gives zero rate for every region, so the onset pose is untouched.
 *
 * The axis is a blend of two things, which is what keeps it COHERENT rather
 * than either synchronous or noisy:
 *
 *   blast-coherent  — the radial-plane tumble `radial x up` a body blown apart
 *                     by a blast actually shows: the piece cartwheels away
 *                     from the epicentre, not about it;
 *   seeded           — a stable per-region direction from the region's own name
 *                     and index, so no two pieces share an axis.
 *
 * The magnitude is the peak rate scaled by the blast falloff, by the region's
 * geometry (a smaller reach spins faster for the same angular impulse —
 * `sqrt(refReach / reach)`), and by a seeded 0.6..1.5 variation. Bones and the
 * head damp it further: the skeleton should still read as a ribcage in the gap
 * and the face should stay recognizable.
 */
export function ruptureSpins(
  plan: RupturePlan,
  tear: TearState,
  tuning: TearTuning = TEAR_TUNING,
): RegionSpin[] {
  const p = ruptureProgress(tear.age, tuning.sec);
  const fall = Math.max(0, Math.min(1, tear.falloff));
  const n = plan.pieces.length;
  if (p <= 0 || fall <= 0) return new Array(n).fill({ axis: [0, 1, 0] as Vec3, rate: 0 });
  const up = plan.up && len(plan.up) > 1e-6 ? normalize(plan.up) : ([0, 1, 0] as Vec3);
  const coherence = Math.max(0, Math.min(1, tuning.spinCoherence));
  const out: RegionSpin[] = new Array(n);
  for (let r = 0; r < n; r++) {
    const region = plan.pieces[r]!;
    const off = sub(region.origin, tear.at);
    const dist = len(off);
    // A region exactly ON the blast point has no radial direction; the body's
    // up is the only stable substitute (same fallback as `ruptureOffsets`).
    const radial = dist < 1e-5 ? up : scale(off, 1 / dist);
    // radial x up — the cartwheel axis of a radial blast. Degenerates when the
    // radial is parallel to the body axis, where any perpendicular is as good.
    let coh = cross(radial, up);
    if (len(coh) < 1e-4) {
      const seedAxis: Vec3 = Math.abs(radial[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      coh = cross(radial, seedAxis);
    }
    coh = normalize(coh);
    const key = `${region.part ?? region.limb}#${r}`;
    let seeded = normalize([
      hash01(key, 1) * 2 - 1,
      hash01(key, 2) * 2 - 1,
      hash01(key, 3) * 2 - 1,
    ]);
    if (len(seeded) < 1e-6) seeded = coh;
    let axis = normalize(add(scale(coh, coherence), scale(seeded, 1 - coherence)));
    if (len(axis) < 1e-6) axis = coh;
    const reach = Math.max(0.03, region.radius ?? 0.15);
    const geom = Math.max(0.55, Math.min(1.8, Math.sqrt(0.16 / reach)));
    const vary = 0.6 + hash01(key, 7) * 0.9;
    let rate = tuning.spinRadPerSec * fall * geom * vary;
    if (region.kind === 'bone') rate *= tuning.boneSpin;
    if (region.limb === 'head') rate *= tuning.headSpin;
    out[r] = { axis, rate };
  }
  return out;
}

/**
 * RIGIDLY ROTATE ONE PRIM about `pivot` by `q` (the region transform, minus the
 * translation). Everything the region can carry rotates:
 *
 *   a/b            the endpoints, about the pivot;
 *   orient         composed `q * orient`, so a non-spherical prim's scale
 *                  basis and the rigged head frame turn with the region;
 *   bend           the Bezier control DISPLACEMENT (mid-relative, world axes)
 *                  rotates as a vector — no pivot;
 *   shell.clip     the world-space clip normal rotates as a vector.
 *
 * `orient` is only written when the prim is actually orientation-sensitive
 * (non-uniform scale, box, shell, or already oriented). A capsule or sphere is
 * fully described by its endpoints, so leaving `orient` identity there keeps
 * the shader on its cheap `sdPrim` path.
 */
export function rotatePrimAbout(p: Primitive, q: Quat, pivot: Vec3): Primitive {
  const rot = (v: Vec3): Vec3 => add(pivot, qRotate(q, sub(v, pivot)));
  const out: Primitive = { ...p, a: rot(p.a), b: rot(p.b) };
  if (p.bend !== undefined) out.bend = qRotate(q, p.bend);
  const sensitive = p.orient !== undefined
    || p.scale[0] !== p.scale[1] || p.scale[1] !== p.scale[2]
    || p.box !== undefined || p.shell !== undefined;
  if (sensitive) out.orient = qNormalize(p.orient ? qMul(q, p.orient) : q);
  if (p.shell) out.shell = { ...p.shell, clipNormal: qRotate(q, p.shell.clipNormal) };
  return out;
}

const IDENTITY_Q: Quat = [0, 0, 0, 1];
const isIdentityQ = (q: Quat): boolean =>
  q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;

/** The body the march should draw this frame, plus the per-region transforms
 *  it was built with — the exact tuple the chunk spawn reuses. */
export interface RuptureFrame {
  body: BuildResult;
  offsets: Vec3[];
  /** Per-region orientation at the displayed age (identity at onset). */
  quats: Quat[];
  /** Per-region angular velocity, rad/s (zero at onset) — the derivative the
   *  live chunk continues with. */
  angVels: Vec3[];
}

/**
 * Bend a POSED body away from the blast by moving every planned region as a
 * rigid unit — rotation about the region's own origin PLUS its translation.
 * Pure: `posed` is not mutated. Returns the posed body itself (and identity
 * regions) when the window has not started, so progress 0 is bit-identical to
 * the pre-blast frame — the exact onset silhouette the contract requires.
 *
 * THE PIVOT IS `region.origin`, the same centre `spawnChunkPiece` makes the
 * chunk's position (gib-parts.ts) and the same frame `chunkPoint` rotates
 * about. That shared pivot is what makes the drawn region and the spawned chunk
 * one continuous transform rather than two approximations of each other.
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
  const spins = ruptureSpins(plan, tear, tuning);
  const spinAge = Math.max(0, Math.min(tear.age, tuning.sec));
  const quats: Quat[] = new Array(spins.length);
  const angVels: Vec3[] = new Array(spins.length);
  let moved = false;
  for (let r = 0; r < spins.length; r++) {
    const s = spins[r]!;
    const angle = s.rate * spinAge;
    quats[r] = angle === 0 ? IDENTITY_Q : qFromAxisAngle(s.axis, angle);
    angVels[r] = s.rate === 0 ? ZERO : scale(s.axis, s.rate);
    const o = offsets[r]!;
    if (o[0] !== 0 || o[1] !== 0 || o[2] !== 0 || angle !== 0) moved = true;
  }
  if (!moved) return { body: posed, offsets, quats, angVels };

  const primRegion = new Int32Array(posed.prims.length).fill(-1);
  const boneRegion = new Int32Array((posed.bonePrims ?? []).length).fill(-1);
  for (let r = 0; r < plan.pieces.length; r++) {
    const region = plan.pieces[r]!;
    for (const i of region.srcPrims ?? []) if (i >= 0 && i < primRegion.length) primRegion[i] = r;
    for (const i of region.srcBones ?? []) if (i >= 0 && i < boneRegion.length) boneRegion[i] = r;
  }
  const shift = (q: Primitive, o: Vec3): Primitive => ({ ...q, a: add(q.a, o), b: add(q.b, o) });
  const place = (q: Primitive, r: number): Primitive => {
    const rot = quats[r]!;
    const moved2 = isIdentityQ(rot)
      ? q
      : rotatePrimAbout(q, rot, plan.pieces[r]!.origin);
    return shift(moved2, offsets[r]!);
  };
  const prims = posed.prims.map((q, i) => {
    const r = primRegion[i]!;
    return r >= 0 ? place(q, r) : q;
  });
  const bonePrims = (posed.bonePrims ?? []).map((q, i) => {
    const r = boneRegion[i]!;
    return r >= 0 ? place(q, r) : q;
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
    quats,
    angVels,
  };
}
