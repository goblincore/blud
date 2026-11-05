// src/lab/sdf-zombie/collapse.ts
//
// Collapse state machine — when a body goes DOWN, per spec §5. Pure: no
// Date.now, no Math.random; identical (state, signal, dt) produce identical
// output (determinism is load-bearing; the fall feeds the same solver every
// frame). This module owns ONLY the state machine and the data the wiring
// needs to make the fall physical — the rig dynamics stay in task 4's hands.
//
// DAMAGE METER: a monotonic 0..1 accumulator. Every wound adds its profile
// radius × meterRadiusWeight (blast 0.13 weighs the most per hit, pellet
// 0.055 the least, burn 0.08 in between); a full limb sever adds
// severedLimbWeight (severed limbs weigh heavily). The meter never decays —
// under sustained fire it only climbs, which is exactly the "sustained fire
// kills" scenario.
//
// TRIGGER MATRIX (from 'standing'):
//   - BOTH legs severed  → collapse instantly, regardless of meter. (The
//     signal's missing flags come from the cluster alive flags — full severs
//     only; a mid-limb distal cut leaves the cluster alive and does NOT
//     count as a missing leg.)
//   - meter ≥ meterThreshold → collapse.
//   - forced (the K key hook) → collapse.
//   One leg severed ⇒ hop-limp (the output's hop flag / the gait's missing
//   skew), NOT collapse — but it only blocks the LEG trigger. The meter and
//   forced triggers fire regardless of how many legs remain.
//
// THE FALL: the output's restPull ramps 1 → 0 over fallReleaseTime — the
// wiring multiplies stepRig's restStiffness by it, so the rest-pose pull
// releases smoothly and gravity takes the rig particles. The output's ropes
// are ONE-SIDED joint-limit constraints for task 4 to relax after stepRig
// each frame via relaxRopeConstraints — see the JOINT-LIMIT note below. The
// corpse phase is terminal ('standing' → 'falling' → 'settled'); there is no
// despawn semantics here, just state — a settled corpse keeps its wounds and
// stays fully shootable/severable/gibable.
//
// JOINT-LIMIT NOTE (from a prior attempt's analysis): `RigConstraint` is an
// EQUALITY constraint — a hip↔foot constraint at full leg length forbids the
// knee from bending at all, so the crumple could never fold. Joint limits
// need a ONE-SIDED max-distance ("rope") constraint: correct only when
// dist > max, never pull apart (a bent limb is free; an over-straightened
// one is pulled back). stepRig doesn't support that, so the limits are our
// own typed list (RopeLimit {a, b, max}[]) built by collapseRopes from the
// rig's joint names + rest pose, and relaxed by relaxRopeConstraints.
//
// WHY ROPES AT ALL: bindRig constrains each bone (hip→knee, knee→foot, …)
// but the LEG CHAINS ARE NOT ANCHORED TO THE TORSO — hipL's only constraint
// is hipL↔kneeL, so while standing the legs hang on rest-pull alone. The
// moment collapse releases rest-pull, the legs fall off the body. The rope
// set therefore anchors hipL/hipR to the pelvis (hip↔hips) first, then adds
// the knee/elbow bend keepers (slack < 1 — a corpse keeps a slack bend
// instead of rigid plank limbs) and splay keepers (the body folds but does
// not starfish). The wiring also notes: bindRig pins the LOWEST point
// (footL) — release the pin when the fall starts, or the corpse crumples
// around the pinned foot.
//
// GROUND FEEL: the chunk stepper's restitution/friction (gib-chunks.ts) are
// module-private, so COLLAPSE_TUNING mirrors their values (0.55 / 0.72) with
// provenance — task 4 uses them for the falling body's floor contact so the
// corpse bounces and skids exactly like the gibs. If gib-chunks.ts ever
// exports them, swap the mirrors for imports.
import type { LimbId, Vec3 } from './types';
import type { Wound } from './damage';
import { WOUND_PROFILES } from './damage';
import type { GaitJointName } from './gait';
import type { RigPoint } from './rig';
import { cross, len, scale, sub } from './vec';

/** Standing → falling → settled. The last two are terminal. */
export type CollapsePhase = 'standing' | 'falling' | 'settled';

/** All collapse knobs in one place. */
export const COLLAPSE_TUNING = {
  /** The damage meter crosses this → collapse (0..1). */
  meterThreshold: 0.8,
  /** Meter gain per metre of wound profile radius (blast 0.13 ⇒ 0.13/hit). */
  meterRadiusWeight: 1.0,
  /** Meter jump when a limb is severed outright. */
  severedLimbWeight: 0.15,
  /** Seconds for the rest-pose pull to ramp 1 → 0 once the fall starts. */
  fallReleaseTime: 0.35,
  /** Seconds from fall start until the corpse counts as settled. */
  fallSettleTime: 2.5,
  /** Ground feel — mirrored from gib-chunks.ts RESTITUTION (chunks skip
   *  off floors). */
  groundRestitution: 0.55,
  /** Ground feel — mirrored from gib-chunks.ts FLOOR_FRICTION (horizontal
   *  velocity bleed in floor contact). */
  groundFriction: 0.72,
  /** Rope: how far a hip may wander from the pelvis (× rest distance). */
  anchorSlack: 1.2,
  /** Rope: knee stays bent — max hip↔foot is this fraction of full extension. 0.94 (a forced ~40° bend) dated from
   *  knees with no hinge, which went plank-straight; with the live knee hinge (rig.ts RigBendConstraint.axis) it
   *  fought gravity on a face-down corpse, whose bend lifts the foot: the shins jittered, then stood up in the air.
   *  0.99 leaves a ~17° bend. */
  legSlack: 0.99,
  /** Rope: elbow stays bent — max shoulder↔hand fraction of full extension. */
  armSlack: 0.9,
  /** Rope: max hip↔hip / shoulder↔shoulder spread (× rest distance). */
  splay: 1.6,
} as const;

/** PER-CHARACTER TOUGHNESS (owner 2026-10-27, on the teratoma: "too easy to kill — they should be beefier and take
 *  more hits"). A DIVISOR on what each kind of hit adds to the meter: 2 means twice the hits to reach the threshold.
 *  `pellet` is a shotgun pellet's wound, `blast` a slug's wound (it stamps the blast profile) and every direct meter
 *  credit (an explosion that does not gib, a melee head hit), `burn` a burn, `sever` a limb shot off. Absent (or a
 *  kind absent) = 1, the shared rule exactly. The meter, the threshold and the gib rule (explosion-aoe.ts, damage vs
 *  GIB_THRESHOLD, which never reads the meter) are untouched, so a tough body still gibs to a close blast. */
export type CollapseToughness = Partial<Record<Wound['type'] | 'sever', number>>;

/** The divisor for one kind of hit: the profile's, else 1. A non-positive or non-finite value is ignored (1). */
export function toughnessFor(t: CollapseToughness | null | undefined, kind: keyof CollapseToughness): number {
  const k = t?.[kind];
  return k !== undefined && Number.isFinite(k) && k > 0 ? k : 1;
}

/** A wound's own meter weight (Wound.meterScale: a far pellet's range falloff, pellet-falloff.ts): unset, negative or
 *  non-finite = 1. */
export function woundMeterScale(w: Pick<Wound, 'meterScale'>): number {
  const k = w.meterScale;
  return k !== undefined && Number.isFinite(k) && k >= 0 ? k : 1;
}

/** Currently missing limbs — from the body's cluster alive flags. */
export interface MissingLimbs {
  legL: boolean;
  legR: boolean;
  armL: boolean;
  armR: boolean;
}

/** A one-sided max-distance joint limit (a rope), in rig-point indices. */
export interface RopeLimit {
  a: number;
  b: number;
  /** Max allowed distance (m). Only dist > max is corrected; never pulled apart. */
  max: number;
}

/** The collapse clock: phase, the monotonic meter, and the fall's age. */
export interface CollapseState {
  phase: CollapsePhase;
  /** Accumulated damage meter, clamped 0..1. */
  meter: number;
  /** Seconds since the fall started (only meaningful while not standing). */
  fallAge: number;
}

/** A fresh standing state with an empty meter. */
export function makeCollapseState(): CollapseState {
  return { phase: 'standing', meter: 0, fallAge: 0 };
}

/** Per-frame input from the damage/sever/keyboard wiring. */
export interface CollapseSignal {
  /** Wounds ADDED this frame (the new pushWound results). */
  wounds: readonly Wound[];
  /** Limbs whose cluster went DEAD this frame (severLimb results). */
  severed: readonly LimbId[];
  /** Currently missing limbs — the wiring's cluster-alive mapping. */
  missing: MissingLimbs;
  /** Forced collapse — the K key hook. */
  forced: boolean;
  /** The body's rope set (collapseRopes output), echoed in the step while
   *  collapsed so the wiring can feed it to stepRig/relaxRopeConstraints. */
  ropes: readonly RopeLimit[];
  /** The body's toughness (MotionProfile.toughness): divides each wound's and sever's meter gain. Absent = 1. */
  toughness?: CollapseToughness;
}

/** One collapse step — the mode + data the wiring turns into a physical fall. */
export interface CollapseStep {
  state: CollapseState;
  phase: CollapsePhase;
  /** True when exactly one leg is missing — hop-limp gait, NOT collapse.
   *  Meaningful while standing; the gait already derives hop from its own
   *  missing skew, so this is the explicit contract for the wiring. While
   *  collapsed (any phase) hop is false — a horizontal corpse has no gait. */
  hop: boolean;
  /** Rest-pose pull multiplier (0..1): multiply stepRig's restStiffness by
   *  this. 1 while standing; ramps to 0 over fallReleaseTime; 0 after. */
  restPull: number;
  /** The added one-sided joint-limit constraints to relax after stepRig each
   *  frame (relaxRopeConstraints). Empty while standing. */
  ropes: RopeLimit[];
  /** True once the corpse has been down fallSettleTime — a state flag only;
   *  the corpse stays interactive. */
  settled: boolean;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * One collapse step: accumulates the meter from fresh wounds/severs, checks
 * the trigger matrix, and advances the fall. Pure and deterministic — same
 * (state, signal, dt) always yields the same step.
 */
export function stepCollapse(state: CollapseState, sig: CollapseSignal, dt: number): CollapseStep {
  const T = COLLAPSE_TUNING;

  let meter = clamp01(state.meter);
  const tough = sig.toughness;
  for (const w of sig.wounds) meter = clamp01(meter + WOUND_PROFILES[w.type].radius * T.meterRadiusWeight * woundMeterScale(w) / toughnessFor(tough, w.type));
  for (const limb of sig.severed) meter = clamp01(meter + T.severedLimbWeight / toughnessFor(tough, 'sever'));

  let { phase, fallAge } = state;

  if (phase === 'standing') {
    const bothLegsGone = sig.missing.legL && sig.missing.legR;
    if (bothLegsGone || meter >= T.meterThreshold || sig.forced) {
      phase = 'falling';
      fallAge = 0;
    }
  }

  if (phase !== 'standing') {
    fallAge += Math.max(dt, 0);
    if (phase === 'falling' && fallAge >= T.fallSettleTime) phase = 'settled';
  }

  const collapsed = phase !== 'standing';
  const restPull = collapsed ? Math.max(0, 1 - fallAge / T.fallReleaseTime) : 1;

  return {
    state: { phase, meter, fallAge },
    phase,
    hop: phase === 'standing' && (sig.missing.legL !== sig.missing.legR),
    restPull,
    ropes: collapsed ? sig.ropes.map(r => ({ a: r.a, b: r.b, max: r.max })) : [],
    settled: phase === 'settled',
  };
}

/**
 * One pass of one-sided max-distance relaxation over the rig points: for
 * each rope, when dist(a, b) > max the endpoints are pulled together to
 * max the endpoints are pulled together, splitting the correction
 * half/half between FREE endpoints — the exact split stepRig's constraint
 * pass uses, pins included (a rope against a pinned end half-corrects per
 * pass, just like stepRig's equality constraints). Never pushes apart; a
 * bent limb (dist ≤ max) is untouched. The input is not mutated. Single
 * pass by design — task 4 runs it once AFTER stepRig each frame; repeated
 * passes would fight stepRig's equality constraints.
 */
export function relaxRopeConstraints(
  points: readonly RigPoint[],
  limits: readonly RopeLimit[],
): RigPoint[] {
  const out: RigPoint[] = points.map(p => ({
    pos: [p.pos[0], p.pos[1], p.pos[2]] as Vec3,
    prev: [p.prev[0], p.prev[1], p.prev[2]] as Vec3,
    pinned: p.pinned,
  }));

  for (const lim of limits) {
    const pa = out[lim.a];
    const pb = out[lim.b];
    if (!pa || !pb || lim.max <= 0) continue;
    const dx = pb.pos[0] - pa.pos[0];
    const dy = pb.pos[1] - pa.pos[1];
    const dz = pb.pos[2] - pa.pos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= lim.max || dist === 0) continue;
    const corr = ((dist - lim.max) / dist) * 0.5;
    if (!pa.pinned) pa.pos = [pa.pos[0] + dx * corr, pa.pos[1] + dy * corr, pa.pos[2] + dz * corr] as Vec3;
    if (!pb.pinned) pb.pos = [pb.pos[0] - dx * corr, pb.pos[1] - dy * corr, pb.pos[2] - dz * corr] as Vec3;
  }
  return out;
}

// The rope set as joint-name pairs with their max-distance factors. Max is
// computed from the REST pose at build time: rest dist × factor.
const ROPE_SPEC: ReadonlyArray<{ a: GaitJointName; b: GaitJointName; factor: number }> = [
  // Anchors — the free-floating leg chains stay attached to the pelvis.
  // bindRig constrains each thigh only to its shin; hipL↔hips is NOT a rig
  // constraint, and collapse releases the rest-pull that held the legs on.
  { a: 'hipL', b: 'hips', factor: COLLAPSE_TUNING.anchorSlack },
  { a: 'hipR', b: 'hips', factor: COLLAPSE_TUNING.anchorSlack },
  // Clavicle anchors — a clavicle that starts OFF the spine (side= offset,
  // the goblin and soldier) has no rig constraint to the chest; the rest
  // pull held it there while standing, and collapse releases the rest pull.
  // collapseRopes skips names a body lacks, so the zombie is untouched.
  { a: 'clavicleL', b: 'chest', factor: COLLAPSE_TUNING.anchorSlack },
  { a: 'clavicleR', b: 'chest', factor: COLLAPSE_TUNING.anchorSlack },
  // Knee keepers — legs may fold freely but never fully straighten: a
  // corpse keeps a slack bend instead of rigid plank limbs.
  { a: 'hipL', b: 'footL', factor: COLLAPSE_TUNING.legSlack },
  { a: 'hipR', b: 'footR', factor: COLLAPSE_TUNING.legSlack },
  // Elbow keepers — same for the arms.
  { a: 'shoulderL', b: 'handL', factor: COLLAPSE_TUNING.armSlack },
  { a: 'shoulderR', b: 'handR', factor: COLLAPSE_TUNING.armSlack },
  // Splay keepers — the body folds but does not starfish.
  { a: 'hipL', b: 'hipR', factor: COLLAPSE_TUNING.splay },
  { a: 'shoulderL', b: 'shoulderR', factor: COLLAPSE_TUNING.splay },
];

// ---------------------------------------------------------------------------
// CORPSE INTEGRITY (spec 2026-11-02 §4, owner: "ragdoll is good but it should
// maintain the body integrity to some tweakable degree"). The rig has bone
// lengths and elbow/knee stops and nothing else, so a released spine and neck
// are free hinges: measured on the zombie, head->pelvis fell from 0.71 m to
// 0.11 m (the head lands in the pelvis) and chest->pelvis 0.48 -> 0.20 m.
// BRACES are two-sided distance limits between joints with no bone between
// them, relaxed only while collapsed: the TRUNK group keeps the torso's length
// and stops it shearing flat; the HEAD group keeps the head out of the torso
// with room to loll. One integrity value (0..1) sets every brace's tolerance
// around its rest distance; 0 adds nothing (the fall before braces, exactly).
// ---------------------------------------------------------------------------

export type BraceGroup = 'trunk' | 'head';

/** A two-sided distance limit, in rig-point indices; `rest` from the bind pose. */
export interface BraceLimit {
  a: number;
  b: number;
  rest: number;
  group: BraceGroup;
}

/** The live integrity knob (debug panel / seam) and the solve's pass count. */
export const CORPSE_INTEGRITY = { value: 0.7, iterations: 4 };
export function setCorpseIntegrity(v: number): void {
  CORPSE_INTEGRITY.value = clamp01(v);
}

/** Fractional give either side of rest, at integrity 0 (loose) and 1 (tight).
 *  The head's is wider: a lolled head reads dead, a folded spine reads broken. */
export const BRACE_TOLERANCE: Readonly<Record<BraceGroup, { loose: number; tight: number }>> = {
  trunk: { loose: 0.6, tight: 0.04 },
  head: { loose: 0.75, tight: 0.15 },
};

export function braceTolerance(group: BraceGroup, integrity: number): number {
  const t = BRACE_TOLERANCE[group], k = clamp01(integrity);
  return t.loose + (t.tight - t.loose) * k;
}

const BRACE_SPEC: ReadonlyArray<{ a: GaitJointName; b: GaitJointName; group: BraceGroup }> = [
  { a: 'chest', b: 'pelvis', group: 'trunk' },
  { a: 'chest', b: 'hips', group: 'trunk' },
  { a: 'shoulderL', b: 'hipL', group: 'trunk' },
  { a: 'shoulderR', b: 'hipR', group: 'trunk' },
  { a: 'shoulderL', b: 'hipR', group: 'trunk' },
  { a: 'shoulderR', b: 'hipL', group: 'trunk' },
  { a: 'shoulderL', b: 'shoulderR', group: 'trunk' },
  { a: 'hipL', b: 'hipR', group: 'trunk' },
  { a: 'head', b: 'chest', group: 'head' },
  { a: 'head', b: 'pelvis', group: 'head' },
  { a: 'head', b: 'shoulderL', group: 'head' },
  { a: 'head', b: 'shoulderR', group: 'head' },
];

/** The body's brace set, built once at bind time beside collapseRopes. Pairs
 *  whose joints the body lacks, or that sit on one point, are skipped. */
export function collapseBraces(names: readonly GaitJointName[], restPose: readonly Vec3[]): BraceLimit[] {
  const out: BraceLimit[] = [];
  for (const spec of BRACE_SPEC) {
    const a = names.indexOf(spec.a);
    const b = names.indexOf(spec.b);
    const pa = a >= 0 ? restPose[a] : undefined;
    const pb = b >= 0 ? restPose[b] : undefined;
    if (!pa || !pb) continue;
    const rest = len(sub(pa, pb));
    if (rest < 1e-4) continue;
    out.push({ a, b, rest, group: spec.group });
  }
  return out;
}

/**
 * Relax the braces: `iterations` Gauss-Seidel passes, each pulling a pair back
 * inside [rest(1-tol), rest(1+tol)], split half/half between free ends as
 * stepRig's constraints are. Each correction moves `prev` with `pos`, so it
 * adds no speed: a brace that read as velocity fought the floor every step and
 * pumped a lying corpse back up to 2 m (owner playtest 2026-11-02, worst in
 * bullet time). Integrity <= 0 returns the input untouched (the pre-brace
 * fall, bit for bit).
 */
export function relaxBraces(
  points: readonly RigPoint[],
  braces: readonly BraceLimit[],
  integrity: number,
  iterations: number = CORPSE_INTEGRITY.iterations,
): readonly RigPoint[] {
  if (integrity <= 0 || braces.length === 0) return points;
  const out: RigPoint[] = points.map(p => ({ pos: [p.pos[0], p.pos[1], p.pos[2]] as Vec3, prev: [p.prev[0], p.prev[1], p.prev[2]] as Vec3, pinned: p.pinned }));
  const tol = { trunk: braceTolerance('trunk', integrity), head: braceTolerance('head', integrity) };
  for (let it = 0; it < iterations; it++) {
    for (const br of braces) {
      const pa = out[br.a], pb = out[br.b];
      if (!pa || !pb) continue;
      const dx = pb.pos[0] - pa.pos[0], dy = pb.pos[1] - pa.pos[1], dz = pb.pos[2] - pa.pos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1e-9) continue;
      const lo = br.rest * (1 - tol[br.group]), hi = br.rest * (1 + tol[br.group]);
      const target = dist < lo ? lo : dist > hi ? hi : dist;
      if (target === dist) continue;
      const wa = pa.pinned ? 0 : 1, wb = pb.pinned ? 0 : 1;
      if (wa + wb === 0) continue;
      const k = (dist - target) / dist / (wa + wb);
      if (wa) { pa.pos = [pa.pos[0] + dx * k, pa.pos[1] + dy * k, pa.pos[2] + dz * k]; pa.prev = [pa.prev[0] + dx * k, pa.prev[1] + dy * k, pa.prev[2] + dz * k]; }
      if (wb) { pb.pos = [pb.pos[0] - dx * k, pb.pos[1] - dy * k, pb.pos[2] - dz * k]; pb.prev = [pb.prev[0] - dx * k, pb.prev[1] - dy * k, pb.prev[2] - dz * k]; }
    }
  }
  return out;
}

// HIP CONES (owner playtest 2026-11-03: the corpse "collapses in itself"). The
// free ragdoll had no hip limit: thighs folded 100-175 deg up against the belly
// and splayed 80-90 deg out (the splits), so a dead zombie balled up. Each cone
// holds the thigh inside a human range in the live pelvis frame (down = pelvis
// to chest reversed, forward = up x right, out = away from the other hip).
// A correction rotates the thigh into range by moving knee and foot by half
// and the hip back by half (a distance constraint's split, so a body falling
// onto its folded leg is pushed apart rather than one leg snapping). See `move`
// for the velocity: without it no version of this limit settled (2026-11-02/03).
export interface HipCone {
  hip: number; knee: number; foot: number;
  /** The other hip: with this one, the pelvis's right axis. */
  otherHip: number;
  pelvis: number; chest: number;
  /** The right hip: the pelvis's right axis is otherHip -> hip (on the left, hip -> otherHip). */
  right: boolean;
  /** The ankle spring (relaxAnkles): the toe, absent on a body without one. */
  ankle?: AnkleRest;
}

/** The foot's rest aim in the shin frame (ankleFrame): pitch from straight down the shin toward the toe side, yaw out. */
export interface AnkleRest { toe: number; pitch: number; yaw: number; fwdSign: number; }

export const HIP_LIMITS = {
  /** Thigh forward of straight down along the trunk (rad). */
  flex: 120 * Math.PI / 180,
  /** Behind straight down. */
  extend: 25 * Math.PI / 180,
  abduct: 45 * Math.PI / 180,
  adduct: 20 * Math.PI / 180,
  /** Most one pass moves the knee back toward range (m). The game corpse caps it (game-actor.ts CORPSE_STEP_CAPS). */
  maxStep: Infinity,
};

export const HIP_SPLIT = { leg: 1, foot: 0, hip: 0 };

export function collapseHipCones(names: readonly GaitJointName[], restPose?: readonly Vec3[]): HipCone[] {
  const at = (n: GaitJointName) => names.indexOf(n);
  const pelvis = at('pelvis'), chest = at('chest');
  if (pelvis < 0 || chest < 0) return [];
  const out: HipCone[] = [];
  for (const [s, o] of [['L', 'R'], ['R', 'L']] as const) {
    const hip = at(`hip${s}`), knee = at(`knee${s}`), foot = at(`foot${s}`), otherHip = at(`hip${o}`);
    if (hip < 0 || knee < 0 || otherHip < 0) continue;
    const cone: HipCone = { hip, knee, foot, otherHip, pelvis, chest, right: s === 'R' };
    const toe = at(`toe${s}`);
    if (restPose && foot >= 0 && toe >= 0) {
      const p = (i: number) => restPose[i]!;
      const fr = ankleFrame(p(hip), p(knee), p(foot), p(otherHip), cone.right);
      const t = sub(p(toe), p(foot)), lt = len(t);
      if (fr && lt > 1e-6) {
        // The forward axis's sign is whichever side the rest toe points to.
        const fwdSign = dot3(t, fr.f) < 0 ? -1 : 1;
        const a = ankleAngles(t, lt, fr.s, fr.r, fr.f, fwdSign);
        cone.ankle = { toe, pitch: a.pitch, yaw: a.yaw, fwdSign };
      }
    }
    out.push(cone);
  }
  return out;
}

// THE ANKLE SPRING (owner playtest 2026-11-03: the ankle "is very floppy").
// The game never pins the toe (rig-bind.ts pinTips runs only in the lab), so
// on a corpse the foot hangs off the ankle by its bone length alone: a ball
// joint with no range. A hard stop in constrainRigBends (knee-ankle-toe, the
// knee's hinge machinery) fought the floor and the feet thrashed 10-100 mm a
// frame (2026-11-03, reverted). This is soft instead: the toe is pulled a
// fraction of the way back into a human range each frame, moving pos and prev
// together so the pull adds no speed, and its speed against the foot heading
// further out is dropped. Inside the range nothing acts. The floor wins
// outright: a toe on the floor that the pull would drive into it is left
// alone (pulled anyway, the floor lifted it back every frame and the fight
// leaked up the leg as a 3 mm/frame slide of the whole corpse).
// Tried and dropped (16 seeds, toes unpinned as in the game): a pull toward the
// rest aim inside the range (a resting foot held off rest fought it forever: a
// 3 mm/frame creep in the arena); a swing damper on the toe against the foot
// (whole-leg flips of 110-480 mm); a rigid foot at its rest aim (most settling
// time and late jumps). This one cut feet left over 40 deg off rest from 12/32
// to 4/32 with every corpse settling.
export const ANKLE_LIMITS = {
  /** Toe down along the shin past rest (plantarflexion, rad). */
  plantar: 40 * Math.PI / 180,
  /** Toe up toward the knee past rest (dorsiflexion). */
  dorsi: 20 * Math.PI / 180,
  /** Either way about the shin: stands in for the hip rotation the rig cannot hold. */
  twist: 30 * Math.PI / 180,
  /** Share of the way back into range per frame. */
  outside: 0.5,
  /** Share of a blocked toe's pull the ankle takes instead (0 = none). */
  lift: 1,
  /** Most the toe (or the ankle under it) moves in one step (m). The game corpse caps it (game-actor.ts CORPSE_STEP_CAPS). */
  maxStep: Infinity,
};

/** A toe this close above its floor is on it (m). */
const ANKLE_CONTACT_M = 0.005;

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The shin frame: s down the shin, r the pelvis's right axis made square to the thigh and then to the shin, f = r x s
 *  (sign fixed by the caller). Square to the thigh first because the shin alone can lie along the hip line (a leg folded
 *  across the body: measured 0.84-0.99 cosine) and its frame then spun, whipping the toe 110-160 mm a frame; the thigh
 *  cannot (the hip cone holds it within 45 deg of straight down sideways), and the knee hinges about that axis. */
function ankleFrame(hip: Vec3, knee: Vec3, foot: Vec3, otherHip: Vec3, right: boolean) {
  const unit = (v: Vec3): Vec3 | null => { const l = len(v); return l < 1e-6 ? null : [v[0] / l, v[1] / l, v[2] / l]; };
  const square = (v: Vec3, to: Vec3): Vec3 => { const k = dot3(v, to); return [v[0] - to[0] * k, v[1] - to[1] * k, v[2] - to[2] * k]; };
  const s = unit(sub(foot, knee)), th = unit(sub(knee, hip));
  const ac = sub(hip, otherHip);
  if (!s || !th) return null;
  const r = unit(square(square(right ? ac : [-ac[0], -ac[1], -ac[2]], th), s));
  if (!r) return null;
  const f: Vec3 = [r[1] * s[2] - r[2] * s[1], r[2] * s[0] - r[0] * s[2], r[0] * s[1] - r[1] * s[0]];
  return { s, r, f };
}

function ankleAngles(t: Vec3, lt: number, s: Vec3, r: Vec3, f: Vec3, fwdSign: number) {
  const ts = dot3(t, s) / lt, tf = dot3(t, f) * fwdSign / lt, tr = dot3(t, r) / lt;
  return { pitch: Math.atan2(tf, ts), yaw: Math.asin(Math.max(-1, Math.min(1, tr))) };
}

/** One soft pass of the ankle springs (and swing dampers) on the cones that carry one. */
export function relaxAnkles(
  points: readonly RigPoint[],
  cones: readonly HipCone[],
  /** The contact height under point `i` (the corpse floor plus its lift). */
  floor: (i: number, p: RigPoint) => number,
  limits: typeof ANKLE_LIMITS = ANKLE_LIMITS,
): RigPoint[] {
  if (!cones.some(c => c.ankle)) return points as RigPoint[];
  const out = points.slice() as RigPoint[];
  for (const c of cones) {
    const a = c.ankle;
    const knee = out[c.knee], foot = out[c.foot], hip = out[c.hip], other = out[c.otherHip], toe = a && out[a.toe];
    if (!a || !knee || !foot || !hip || !other || !toe || toe.pinned) continue;
    const fr = ankleFrame(hip.pos, knee.pos, foot.pos, other.pos, c.right);
    const t = sub(toe.pos, foot.pos), lt = len(t);
    if (!fr || lt < 1e-6) continue;
    const { pitch, yaw } = ankleAngles(t, lt, fr.s, fr.r, fr.f, a.fwdSign);
    const pc = Math.max(a.pitch - limits.plantar, Math.min(a.pitch + limits.dorsi, pitch));
    const yc = Math.max(a.yaw - limits.twist, Math.min(a.yaw + limits.twist, yaw));
    if (pc === pitch && yc === yaw) continue;
    const k = limits.outside;
    const cp = Math.cos(pc), sp = Math.sin(pc), cy = Math.cos(yc), sy = Math.sin(yc);
    const fs = a.fwdSign;
    const want: Vec3 = [
      (fr.s[0] * cp + fr.f[0] * fs * sp) * cy + fr.r[0] * sy,
      (fr.s[1] * cp + fr.f[1] * fs * sp) * cy + fr.r[1] * sy,
      (fr.s[2] * cp + fr.f[2] * fs * sp) * cy + fr.r[2] * sy];
    // Toward the range: the edge's toe less the toe.
    const e: Vec3 = [want[0] * lt - t[0], want[1] * lt - t[1], want[2] * lt - t[2]], le = len(e);
    if (le < 1e-9) continue;
    const n: Vec3 = [e[0] / le, e[1] / le, e[2] / le];
    // Part of the way along the chord, then back out to the foot's length (a swing, not a shortening).
    const m: Vec3 = [t[0] + e[0] * k, t[1] + e[1] * k, t[2] + e[2] * k];
    const lm = len(m);
    let d: Vec3 = lm < 1e-6 ? [0, 0, 0] : [m[0] * lt / lm - t[0], m[1] * lt / lm - t[1], m[2] * lt / lm - t[2]];
    const ld = len(d);
    if (ld > limits.maxStep) d = scale(d, limits.maxStep / ld);
    // The floor wins: a toe on it is not pulled into it (the speed below still goes). The ankle takes the correction
    // instead (toes dug in prop the foot up), as a distance constraint gives it to the free end, and its speed heading
    // back is dropped as the toe's is. ANKLE_LIMITS.lift scales it. (Straight up only, it fought gravity and the knee
    // and no corpse of 16 settled.)
    const g = floor(a.toe, toe);
    if (toe.pos[1] <= g + ANKLE_CONTACT_M && toe.pos[1] + d[1] < g) {
      const l = limits.lift;
      if (l > 0 && !foot.pinned) {
        const fpos: Vec3 = [foot.pos[0] - d[0] * l, foot.pos[1] - d[1] * l, foot.pos[2] - d[2] * l];
        let fprev: Vec3 = [foot.prev[0] - d[0] * l, foot.prev[1] - d[1] * l, foot.prev[2] - d[2] * l];
        const fv = -((fpos[0] - fprev[0]) * n[0] + (fpos[1] - fprev[1]) * n[1] + (fpos[2] - fprev[2]) * n[2]);
        if (fv < 0) fprev = [fprev[0] - n[0] * fv, fprev[1] - n[1] * fv, fprev[2] - n[2] * fv];
        out[c.foot] = { ...foot, pos: fpos, prev: fprev };
      }
      d = [0, 0, 0];
    }
    const pos: Vec3 = [toe.pos[0] + d[0], toe.pos[1] + d[1], toe.pos[2] + d[2]];
    let prev: Vec3 = [toe.prev[0] + d[0], toe.prev[1] + d[1], toe.prev[2] + d[2]];
    // As the hip cone's `move`: drop the toe's speed against the foot still swinging it out of range.
    const vn = (pos[0] - prev[0] - (foot.pos[0] - foot.prev[0])) * n[0]
      + (pos[1] - prev[1] - (foot.pos[1] - foot.prev[1])) * n[1]
      + (pos[2] - prev[2] - (foot.pos[2] - foot.prev[2])) * n[2];
    if (vn < 0) prev = [prev[0] + n[0] * vn, prev[1] + n[1] * vn, prev[2] + n[2] * vn];
    out[a.toe] = { ...toe, pos, prev };
  }
  return out;
}

// THE FOOT PLANT (owner playtest 2026-11-03: "the legs always slide out flat";
// a zombie never dies with its knees buckling under it, rump up, slumped over).
// Probe feet travelled ~1.3 m in a collapse with knees ending ~18 deg bent: the
// knee stop fixed a bend by swinging the foot, and the bone solve split every
// length correction half-and-half, so a moving knee dragged its foot. The floor
// only grips a point pushed INTO it, so nothing held a resting foot. A foot that
// comes to rest on the floor is PINNED (stepRig, the floor and every corpse
// limit leave a pinned point alone, and the knee stop then places the knee:
// rig.ts plantedKnee), so the body folds over it. It lets go when the leg is
// pulled nearly straight (the body falling away drags it) or folded past the
// knee's range (the hips came down on it): a foot never anchors a whole corpse.
export const FOOT_PLANT = {
  /** A foot this close above its floor is on it (m). */
  contactM: 0.02,
  /** Slower than this along the floor, it plants (m/s). */
  maxSpeed: 0.6,
  /** Hip to foot over the leg's full length past which it lets go. */
  stretch: 0.97,
  /** The knee fold past which it lets go (rad): the knee stop's maxFlex less a margin. */
  maxFold: 140 * Math.PI / 180,
  /** A freed foot plants again only this far inside both release limits (a share of the leg / rad): without the gap
   *  a foot at a limit pinned and let go on alternate steps. */
  gap: 0.03,
  gapFold: 15 * Math.PI / 180,
};

export interface FootPlant { hip: number; knee: number; foot: number; thigh: number; shin: number; }

/** The two legs' plants from the rest pose (bone lengths); a body missing a point skips that leg. */
export function collapseFootPlants(names: readonly GaitJointName[], restPose: readonly Vec3[]): FootPlant[] {
  const out: FootPlant[] = [];
  for (const s of ['L', 'R'] as const) {
    const hip = names.indexOf(`hip${s}`), knee = names.indexOf(`knee${s}`), foot = names.indexOf(`foot${s}`);
    if (hip < 0 || knee < 0 || foot < 0 || !restPose[hip] || !restPose[knee] || !restPose[foot]) continue;
    out.push({ hip, knee, foot, thigh: len(sub(restPose[knee]!, restPose[hip]!)), shin: len(sub(restPose[foot]!, restPose[knee]!)) });
  }
  return out;
}

/** Decides each foot's pin for the NEXT step, from this step's end pose: plants a slow foot on the floor, frees a
 *  stretched or over-folded leg. A newly planted or freed foot keeps no speed. */
export function plantFeet(
  points: readonly RigPoint[],
  plants: readonly FootPlant[],
  /** The contact height under point `i` (the corpse floor plus its lift). */
  floor: (i: number, p: RigPoint) => number,
  dt: number,
  tuning: typeof FOOT_PLANT = FOOT_PLANT,
  /** Knees plant too (the slump, slump-death.ts): a knee that comes down onto the floor holds there and its foot
   *  lets go, so the shin lies down behind it and the hips pivot over the knees, rump up. Without it the hips kept
   *  sinking past a kneeling knee, the knee placement drove it into the floor, the floor threw it up 0.46 m in a
   *  frame and the legs slid out flat. */
  kneel = false,
): RigPoint[] {
  if (plants.length === 0) return points as RigPoint[];
  const out = points.slice() as RigPoint[];
  for (const pl of plants) {
    const hip = out[pl.hip], foot = out[pl.foot], knee = out[pl.knee];
    if (!hip || !foot || !knee) continue;
    if (kneel) {
      if (knee.pinned) continue;
      // On contact, at any speed: a knee coming down hard sticks (a kneeling knee is moving fast when it lands, and
      // waiting for it to slow left it to be thrown back up).
      if (knee.pos[1] <= floor(pl.knee, knee) + tuning.contactM) {
        out[pl.knee] = { ...knee, pinned: true, prev: knee.pos };
        if (foot.pinned) out[pl.foot] = { ...foot, pinned: false, prev: foot.pos };
        continue;
      }
    }
    const d = len(sub(foot.pos, hip.pos)), full = pl.thigh + pl.shin;
    // The fold the hip-to-foot span forces (law of cosines).
    const c = (pl.thigh * pl.thigh + pl.shin * pl.shin - d * d) / (2 * pl.thigh * pl.shin);
    const fold = Math.PI - Math.acos(Math.max(-1, Math.min(1, c)));
    const free = d > tuning.stretch * full || fold > tuning.maxFold;
    if (foot.pinned) {
      if (free) out[pl.foot] = { ...foot, pinned: false, prev: foot.pos };
      continue;
    }
    if (d > (tuning.stretch - tuning.gap) * full || fold > tuning.maxFold - tuning.gapFold) continue;
    if (foot.pos[1] > floor(pl.foot, foot) + tuning.contactM) continue;
    const vx = foot.pos[0] - foot.prev[0], vz = foot.pos[2] - foot.prev[2];
    if (Math.hypot(vx, vz) > tuning.maxSpeed * dt) continue;
    out[pl.foot] = { ...foot, pinned: true, prev: foot.pos };
  }
  return out;
}

/** Every planted foot let go (the body stood back up, or the corpse is gone): a pin left set would hold the foot
 *  through the walk. */
export function releaseFeet(points: readonly RigPoint[], plants: readonly FootPlant[]): RigPoint[] {
  if (!plants.some(pl => points[pl.foot]?.pinned || points[pl.knee]?.pinned)) return points as RigPoint[];
  const out = points.slice() as RigPoint[];
  for (const pl of plants) for (const i of [pl.foot, pl.knee]) if (out[i]?.pinned) out[i] = { ...out[i]!, pinned: false };
  return out;
}

/** Relax the hip cones, `iterations` passes. No cones (or a body missing a
 *  point) returns the input untouched. */
export function relaxHipCones(
  points: readonly RigPoint[],
  cones: readonly HipCone[],
  iterations: number = CORPSE_INTEGRITY.iterations,
  limits: typeof HIP_LIMITS = HIP_LIMITS,
): readonly RigPoint[] {
  if (cones.length === 0) return points;
  const out: RigPoint[] = points.map(p => ({ pos: [p.pos[0], p.pos[1], p.pos[2]] as Vec3, prev: [p.prev[0], p.prev[1], p.prev[2]] as Vec3, pinned: p.pinned }));
  // Moves pos and prev together (no speed added), then drops the speed still heading out of range: a limb held at the
  // limit is a resting contact, and speed kept into it built up every frame and leaked through the bones as a creep.
  const move = (p: RigPoint | undefined, d: Vec3, k: number) => {
    if (!p || p.pinned || k === 0) return;
    p.pos = [p.pos[0] + d[0] * k, p.pos[1] + d[1] * k, p.pos[2] + d[2] * k];
    p.prev = [p.prev[0] + d[0] * k, p.prev[1] + d[1] * k, p.prev[2] + d[2] * k];
    const ld = len(d);
    if (ld < 1e-9) return;
    const n: Vec3 = [d[0] * Math.sign(k) / ld, d[1] * Math.sign(k) / ld, d[2] * Math.sign(k) / ld];
    const vn = (p.pos[0] - p.prev[0]) * n[0] + (p.pos[1] - p.prev[1]) * n[1] + (p.pos[2] - p.prev[2]) * n[2];
    if (vn < 0) p.prev = [p.prev[0] + n[0] * vn, p.prev[1] + n[1] * vn, p.prev[2] + n[2] * vn];
  };
  for (let it = 0; it < iterations; it++) {
    for (const c of cones) {
      const hip = out[c.hip], knee = out[c.knee], other = out[c.otherHip], pel = out[c.pelvis], chest = out[c.chest];
      if (!hip || !knee || !other || !pel || !chest) continue;
      const up = sub(chest.pos, pel.pos), across = sub(hip.pos, other.pos), thigh = sub(knee.pos, hip.pos);
      const lu = len(up), la = len(across), lt = len(thigh);
      if (lu < 1e-6 || la < 1e-6 || lt < 1e-6) continue;
      const down: Vec3 = [-up[0] / lu, -up[1] / lu, -up[2] / lu];
      const outA: Vec3 = [across[0] / la, across[1] / la, across[2] / la];
      // `out` with its trunk component removed; right is `out` on the right hip, -out on the left.
      const dd = outA[0] * down[0] + outA[1] * down[1] + outA[2] * down[2];
      const o0: Vec3 = [outA[0] - down[0] * dd, outA[1] - down[1] * dd, outA[2] - down[2] * dd];
      const lo = len(o0);
      if (lo < 1e-6) continue;
      const o: Vec3 = [o0[0] / lo, o0[1] / lo, o0[2] / lo];
      const r: Vec3 = c.right ? o : [-o[0], -o[1], -o[2]];
      // forward = up x right = -down x right
      const fwd: Vec3 = [
        -(down[1] * r[2] - down[2] * r[1]), -(down[2] * r[0] - down[0] * r[2]), -(down[0] * r[1] - down[1] * r[0])];
      const t: Vec3 = [thigh[0] / lt, thigh[1] / lt, thigh[2] / lt];
      const td = t[0] * down[0] + t[1] * down[1] + t[2] * down[2];
      const tf = t[0] * fwd[0] + t[1] * fwd[1] + t[2] * fwd[2];
      const to = t[0] * o[0] + t[1] * o[1] + t[2] * o[2];
      const abd = Math.asin(Math.max(-1, Math.min(1, to)));
      const flex = Math.atan2(tf, td);
      const abdC = Math.max(-limits.adduct, Math.min(limits.abduct, abd));
      const flexC = Math.max(-limits.extend, Math.min(limits.flex, flex));
      if (abdC === abd && flexC === flex) continue;
      const ca = Math.cos(abdC), sa = Math.sin(abdC), cf = Math.cos(flexC), sf = Math.sin(flexC);
      const want: Vec3 = [
        (down[0] * cf + fwd[0] * sf) * ca + o[0] * sa,
        (down[1] * cf + fwd[1] * sf) * ca + o[1] * sa,
        (down[2] * cf + fwd[2] * sf) * ca + o[2] * sa];
      let d: Vec3 = [want[0] * lt - thigh[0], want[1] * lt - thigh[1], want[2] * lt - thigh[2]];
      const ld = len(d);
      if (ld > limits.maxStep) d = scale(d, limits.maxStep / ld);
      move(knee, d, HIP_SPLIT.leg);
      move(out[c.foot], d, HIP_SPLIT.foot);
      move(hip, d, -HIP_SPLIT.hip);
    }
  }
  return out;
}

/**
 * Builds the body's rope set from its joint names (gait's jointNamesForBody
 * output) and the rig's rest pose. Called once at bind time; the result is
 * constant for the body and passed into stepCollapse's signal each frame.
 * Ropes whose joints are absent from this body are skipped.
 */
export function collapseRopes(names: readonly GaitJointName[], restPose: readonly Vec3[]): RopeLimit[] {
  const out: RopeLimit[] = [];
  for (const spec of ROPE_SPEC) {
    const a = names.indexOf(spec.a);
    const b = names.indexOf(spec.b);
    const pa = a >= 0 ? restPose[a] : undefined;
    const pb = b >= 0 ? restPose[b] : undefined;
    if (!pa || !pb) continue;
    out.push({ a, b, max: len(sub(pa, pb)) * spec.factor });
  }
  return out;
}

// THE CORPSE IS SOLID (owner playtest 2026-11-03, weridbody.mov: arms through the chest, a hand inside the hips,
// legs through each other). A corpse had no self-collision but the arm guard spheres (rig.ts torsoGuards), which sit
// where an UPRIGHT torso would be and turn only with the body's yaw: once the body tips over they float in the air,
// and the legs had none at all. Here every bone is a capsule (radius = the flesh around its middle, from the body's
// prims; the trunk an elliptical one, as wide as its flanks and as deep as its belly: a round trunk the depth of the
// belly let forearms sink 8 cm into its sides, weirdzombie.mov) and listed pairs are kept apart in the LIVE pose. A pair's clearance never exceeds 90% of its rest-pose
// distance, so the authored stance is never in contact. Each part of a segment that is attached to the other (a
// shoulder at the chest, a hip at the pelvis, both hips at the pelvis) is left out by its range.
export interface BodyCapsule {
  a: number; b: number;
  /** Flesh radius; for an elliptical trunk, its front-to-back half-thickness. */
  r: number;
  /** An elliptical trunk's side-to-side half-width, across `lat` (its hip-to-hip plus shoulder-to-shoulder line). */
  w?: number;
  lat?: readonly [number, number, number, number];
}
export interface BodyPair {
  i: number; j: number;
  /** Fractions of each capsule's segment that collide (the attached end is left out). */
  si: readonly [number, number]; sj: readonly [number, number];
  /** Clearance as a share of the two flesh radii along the contact (skin, or less where the rest pose is closer). */
  fit: number;
}
export interface CorpseBody {
  capsules: readonly BodyCapsule[]; pairs: readonly BodyPair[]; invMass: readonly number[];
  /** Each rig point's flesh radius (the thickest capsule ending at it; the trunk's depth), for the world's contacts
   *  (corpse-contact.ts). CORPSE_POINT_R where no capsule ends. */
  pointR: readonly number[];
  /** The trunk's joint cones, pelvis then neck (relaxSpineCones). */
  cones: readonly SpineCone[];
}
/** A rig point's flesh radius where no capsule ends at it (m). */
export const CORPSE_POINT_R = 0.06;

export const BODY_COLLIDE = {
  iterations: 2,
  /** Trunk points (pelvis, chest, hips, shoulders) move this share of a limb's: a falling body pushes the arm aside,
   *  not the chest. */
  torsoMass: 0.35,
  /** Pair clearance at most this share of its rest-pose distance. */
  restShare: 0.9,
  /** Limb-against-limb clearance as a share of the flesh's: the SDF flesh blends where limbs meet, so a shallow
   *  touch reads as flesh pressed together, and full radii held a collapsed body's knees apart against its hip cones
   *  (a fight that kept the feet buzzing awake). */
  skin: 0.8,
  /** Against the trunk and head, which are wide and must not swallow a limb (owner playtest 2026-11-04,
   *  weirdzombie.mov: forearms sunk into the flanks, an arm through the head). */
  trunkSkin: 0.92,
  /** Most one pass moves a point (m); the game corpse caps it (game-actor.ts CORPSE_STEP_CAPS). */
  maxStep: Infinity,
};

type CapsuleName = 'torso' | 'head' | 'upperL' | 'upperR' | 'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR'
  | 'footL' | 'footR';
const CAPSULE_SPEC: ReadonlyArray<[CapsuleName, GaitJointName, GaitJointName]> = [
  ['torso', 'pelvis', 'chest'], ['head', 'neck', 'head'],
  ['upperL', 'shoulderL', 'elbowL'], ['upperR', 'shoulderR', 'elbowR'],
  ['foreL', 'elbowL', 'handL'], ['foreR', 'elbowR', 'handR'],
  ['thighL', 'hipL', 'kneeL'], ['thighR', 'hipR', 'kneeR'],
  ['shinL', 'kneeL', 'footL'], ['shinR', 'kneeR', 'footR'],
  ['footL', 'footL', 'toeL'], ['footR', 'footR', 'toeR'],
];
const FULL = [0, 1] as const;
const TRUNK_POINTS: readonly GaitJointName[] = ['pelvis', 'chest', 'hipL', 'hipR', 'shoulderL', 'shoulderR'];
/** The trunk's width line: hip to hip plus shoulder to shoulder, R to L. */
const TRUNK_LAT: readonly GaitJointName[] = ['hipR', 'hipL', 'shoulderR', 'shoulderL'];
type PairSpec = readonly [CapsuleName, readonly [number, number], CapsuleName, readonly [number, number]];
type Range = readonly [number, number];
/** Each limb capsule and the part of it that may touch the rest of the body (a shoulder rides the chest, a hip
 *  the pelvis). */
const LIMB = (side: 'L' | 'R') => ({
  upper: [`upper${side}`, [0.45, 1]], fore: [`fore${side}`, FULL],
  thigh: [`thigh${side}`, [0.35, 1]], shin: [`shin${side}`, FULL], foot: [`foot${side}`, FULL],
}) as const satisfies Record<string, readonly [CapsuleName, Range]>;
const pair = (x: readonly [CapsuleName, Range], y: readonly [CapsuleName, Range]): PairSpec => [x[0], x[1], y[0], y[1]];
const PAIR_SPEC: ReadonlyArray<PairSpec> = (() => {
  const L = LIMB('L'), R = LIMB('R');
  const torso = ['torso', FULL] as const, belly = ['torso', [0.35, 1]] as const, head = ['head', FULL] as const;
  const out: PairSpec[] = [];
  for (const s of [L, R]) {
    // Arms out of the trunk and head.
    out.push(pair(s.upper, torso), pair(s.fore, torso), pair(s.upper, head), pair(s.fore, head));
    // Shins and feet out of the belly and chest (the pelvis end stays free: a body can sit on its heels). The thigh
    // against the trunk is the hip cone's (relaxHipCones): a second limit on the same joint fought it and the feet
    // buzzed awake.
    out.push(pair(s.shin, belly), pair(s.foot, belly), pair(s.thigh, head), pair(s.shin, head), pair(s.foot, head));
  }
  // Legs out of each other (the hips sit side by side at the pelvis).
  for (const [a, b] of [[L, R], [R, L]] as const) out.push(pair(a.thigh, b.shin), pair(a.foot, b.shin), pair(a.foot, b.thigh));
  out.push(pair(L.thigh, R.thigh), pair(L.shin, R.shin), pair(L.foot, R.foot));
  // Arms out of each other.
  out.push(pair(L.upper, R.upper), pair(L.fore, R.fore), pair(L.upper, R.fore), pair(L.fore, R.upper));
  // Arms out of the legs.
  for (const a of [L, R]) for (const l of [L, R]) for (const arm of [a.upper, a.fore]) {
    out.push(pair(arm, l.thigh), pair(arm, l.shin), pair(arm, l.foot));
  }
  return out;
})();

/** Closest points between segments p0-p1 and q0-q1 (Ericson 5.1.9): the fractions s, t along each. */
function closestSegSeg(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): [number, number] {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0);
  const a = dot3(d1, d1), e = dot3(d2, d2), f = dot3(d2, r);
  const cl = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x;
  if (a < 1e-12 && e < 1e-12) return [0, 0];
  if (a < 1e-12) return [0, cl(f / e)];
  const c = dot3(d1, r);
  if (e < 1e-12) return [cl(-c / a), 0];
  const b = dot3(d1, d2), den = a * e - b * b;
  let s = den > 1e-12 ? cl((b * f - c * e) / den) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = cl(-c / a); } else if (t > 1) { t = 1; s = cl((b - c) / a); }
  return [s, t];
}
const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];

/** Capsule `c`'s flesh radius toward unit normal `n` (an elliptical trunk is wider across than deep). */
function radiusToward(c: BodyCapsule, pos: (k: number) => Vec3, n: Vec3): number {
  if (c.w === undefined || !c.lat) return c.r;
  const ax = sub(pos(c.b), pos(c.a)), aL = len(ax);
  if (aL < 1e-9) return c.r;
  const axis = scale(ax, 1 / aL);
  const raw = sub(add3(pos(c.lat[1]), pos(c.lat[3])), add3(pos(c.lat[0]), pos(c.lat[2])));
  const side = sub(raw, scale(axis, dot3(raw, axis))), sL = len(side);
  if (sL < 1e-9) return c.r;
  const e1 = scale(side, 1 / sL), e2 = cross(axis, e1);
  const x = dot3(n, e1), z = dot3(n, e2), h = Math.hypot(x, z);
  if (h < 1e-6) return Math.min(c.r, c.w);  // straight along the axis: the end cap
  return 1 / Math.hypot(x / h / c.w, z / h / c.r);
}
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The body's capsules and pairs, built once at bind time beside collapseBraces. `girth(q, dir?)`: the flesh's
 *  half-thickness at q, along bind-space `dir` (unit), or its thinnest without one. */
export function collapseBody(
  names: readonly GaitJointName[], restPose: readonly Vec3[], girth: (q: Vec3, dir?: Vec3) => number,
): CorpseBody | null {
  const caps = new Map<CapsuleName, number>(), capsules: BodyCapsule[] = [];
  const ix = (n: GaitJointName) => names.indexOf(n);
  const lat = TRUNK_LAT.map(ix);
  for (const [n, an, bn] of CAPSULE_SPEC) {
    const a = ix(an), b = ix(bn);
    if (a < 0 || b < 0 || !restPose[a] || !restPose[b] || len(sub(restPose[a]!, restPose[b]!)) < 1e-4) continue;
    const at = (s: number) => lerp3(restPose[a]!, restPose[b]!, s);
    let cap: BodyCapsule = { a, b, r: Math.max(0.02, girth(at(0.5))) };
    if (n === 'torso' && lat.every(k => k >= 0 && restPose[k])) {
      // Elliptical: the mean half-width and half-depth over the trunk's middle.
      const L = lat as unknown as [number, number, number, number];
      const ax = sub(restPose[b]!, restPose[a]!);
      const axis = scale(ax, 1 / len(ax));
      const raw = sub(add3(restPose[L[1]]!, restPose[L[3]]!), add3(restPose[L[0]]!, restPose[L[2]]!));
      const side = sub(raw, scale(axis, dot3(raw, axis)));
      if (len(side) > 1e-6) {
        const e1 = scale(side, 1 / len(side)), e2 = cross(axis, e1);
        const mean = (dir: Vec3) => [0.25, 0.5, 0.75].reduce((t, s) => t + girth(at(s), dir), 0) / 3;
        const w = mean(e1), d = mean(e2);
        if (w > 0.02 && d > 0.02) cap = { a, b, r: d, w, lat: L };
      }
    }
    caps.set(n, capsules.length); capsules.push(cap);
  }
  const pairs: BodyPair[] = [];
  const restAt = (k: number) => restPose[k]!;
  for (const [ni, si, nj, sj] of PAIR_SPEC) {
    const i = caps.get(ni), j = caps.get(nj);
    if (i === undefined || j === undefined) continue;
    const A = capsules[i]!, B = capsules[j]!;
    const p0 = lerp3(restPose[A.a]!, restPose[A.b]!, si[0]), p1 = lerp3(restPose[A.a]!, restPose[A.b]!, si[1]);
    const q0 = lerp3(restPose[B.a]!, restPose[B.b]!, sj[0]), q1 = lerp3(restPose[B.a]!, restPose[B.b]!, sj[1]);
    const [s, t] = closestSegSeg(p0, p1, q0, q1);
    const dv = sub(lerp3(p0, p1, s), lerp3(q0, q1, t)), restD = len(dv);
    const n: Vec3 = restD > 1e-6 ? scale(dv, 1 / restD) : [0, 1, 0];
    const sum = radiusToward(A, restAt, n) + radiusToward(B, restAt, scale(n, -1));
    const trunk = ni === 'torso' || ni === 'head' || nj === 'torso' || nj === 'head';
    const fit = Math.min(trunk ? BODY_COLLIDE.trunkSkin : BODY_COLLIDE.skin, restD * BODY_COLLIDE.restShare / sum);
    if (fit * sum > 0.01) pairs.push({ i, j, si, sj, fit });
  }
  if (pairs.length === 0) return null;
  // The trunk's points (the braces hold them in shape: a push on a hip fought the hip-to-hip brace) move least.
  const invMass = restPose.map(() => 1);
  for (const n of TRUNK_POINTS) { const k = names.indexOf(n); if (k >= 0) invMass[k] = BODY_COLLIDE.torsoMass; }
  const pointR = restPose.map(() => 0);
  for (const c of capsules) for (const k of [c.a, c.b]) pointR[k] = Math.max(pointR[k]!, c.r);
  return { capsules, pairs, invMass, pointR: pointR.map(r => r || CORPSE_POINT_R), cones: spineCones(names, restPose) };
}

/** How deep pair `pr` overlaps in pose `pos` (m; negative = apart), at its own fit or at `fit`. */
export function bodyPairOverlap(body: CorpseBody, pr: BodyPair, pos: (k: number) => Vec3, fit = pr.fit): number {
  const A = body.capsules[pr.i]!, B = body.capsules[pr.j]!;
  const p0 = lerp3(pos(A.a), pos(A.b), pr.si[0]), p1 = lerp3(pos(A.a), pos(A.b), pr.si[1]);
  const q0 = lerp3(pos(B.a), pos(B.b), pr.sj[0]), q1 = lerp3(pos(B.a), pos(B.b), pr.sj[1]);
  const [u, v] = closestSegSeg(p0, p1, q0, q1);
  const delta = sub(lerp3(p0, p1, u), lerp3(q0, q1, v)), d = len(delta);
  const n: Vec3 = d > 1e-6 ? scale(delta, 1 / d) : [0, 1, 0];
  return (radiusToward(A, pos, n) + radiusToward(B, pos, scale(n, -1))) * fit - d;
}

/**
 * Push overlapping capsule pairs apart. Position-based on the four segment ends (barycentric weights, inverse
 * masses), moving `prev` with `pos` so the push adds no speed, and the pair's closing speed along the contact
 * normal is dropped (an inelastic touch: without it a limb kept driving in and was pushed back out every step, a
 * buzz that never let the corpse sleep). Pinned points do not move. `maxStep` caps the largest move per pass.
 */
export function relaxBodyCollisions(
  points: readonly RigPoint[], body: CorpseBody | null | undefined,
  limits: { iterations: number; maxStep: number } = BODY_COLLIDE,
): RigPoint[] {
  if (!body) return points as RigPoint[];
  let out: RigPoint[] | null = null;
  for (let it = 0; it < limits.iterations; it++) {
    for (const pr of body.pairs) {
      const src = out ?? points;
      const A = body.capsules[pr.i]!, B = body.capsules[pr.j]!;
      const ids = [A.a, A.b, B.a, B.b];
      const P = ids.map(k => src[k]!);
      if (ids.some((k, x) => !P[x])) continue;
      const p0 = lerp3(P[0]!.pos, P[1]!.pos, pr.si[0]), p1 = lerp3(P[0]!.pos, P[1]!.pos, pr.si[1]);
      const q0 = lerp3(P[2]!.pos, P[3]!.pos, pr.sj[0]), q1 = lerp3(P[2]!.pos, P[3]!.pos, pr.sj[1]);
      const [u, v] = closestSegSeg(p0, p1, q0, q1);
      const cp = lerp3(p0, p1, u), cq = lerp3(q0, q1, v);
      const delta = sub(cp, cq), d = len(delta);
      // A degenerate touch (axes cross exactly): push along world up, the floor's side.
      const n: Vec3 = d > 1e-6 ? scale(delta, 1 / d) : [0, 1, 0];
      const at = (k: number) => src[k]!.pos;
      const clearance = (radiusToward(A, at, n) + radiusToward(B, at, scale(n, -1))) * pr.fit;
      if (d >= clearance) continue;
      const s = pr.si[0] + (pr.si[1] - pr.si[0]) * u, t = pr.sj[0] + (pr.sj[1] - pr.sj[0]) * v;
      // Each end's share of its contact point and its sign along n.
      const k = [1 - s, s, -(1 - t), -t];
      const w = ids.map((id, x) => P[x]!.pinned ? 0 : body.invMass[id] ?? 1);
      let den = 0;
      for (let x = 0; x < 4; x++) den += k[x]! * k[x]! * w[x]!;
      if (den < 1e-9) continue;
      let pen = (clearance - d) / den;
      let most = 0;
      for (let x = 0; x < 4; x++) most = Math.max(most, Math.abs(k[x]! * w[x]! * pen));
      if (most > limits.maxStep) pen *= limits.maxStep / most;
      // Closing speed of the contact points along n (per step), dropped when they approach.
      const vel = (x: number) => sub(P[x]!.pos, P[x]!.prev);
      const vp = lerp3(vel(0), vel(1), s), vq = lerp3(vel(2), vel(3), t);
      const vn = dot3(sub(vp, vq), n), stop = vn < 0 ? -vn / den : 0;
      if (!out) out = points.map(p => ({ ...p }));
      for (let x = 0; x < 4; x++) {
        if (w[x] === 0) continue;
        const kw = k[x]! * w[x]!;
        const move = scale(n, kw * pen), dv = scale(n, kw * stop);
        const p = out[ids[x]!]!;
        out[ids[x]!] = { ...p, pos: [p.pos[0] + move[0], p.pos[1] + move[1], p.pos[2] + move[2]],
          prev: [p.prev[0] + move[0] - dv[0], p.prev[1] + move[1] - dv[1], p.prev[2] + move[2] - dv[2]] };
      }
    }
  }
  return out ?? (points as RigPoint[]);
}

// THE TRUNK'S JOINTS HAVE A RANGE (owner playtests 2026-11-05).
// THE PELVIS: "the lower torso or abdomen ... can rotate like 360 unnaturally ... a round orb sticking out". The pelvis
// bone is a 14 cm stub from the pelvis point up to the hips point, and the trunk's flesh below the belly (the pelvis
// blob, the gut) turns with it (rig-bind.ts THE LYING TRUNK). The rig held that point by the stub and a loose brace to
// the chest, both along the spine: nothing kept it from swinging round the hips, and most probe corpses came to rest
// with it folded 85 degrees off the spine, the gut hung out at the side.
// THE NECK: "the neck also is a bit too floppy". The head hangs off two 16 cm neck bones held only by the head braces
// (33% give at the default integrity): each bent 100 degrees and more and the head folded 120 degrees off the spine
// in a slump. A human neck bends about 50-60 degrees chin to chest, 60 back and 45 to the side, over its length.
// Each cone keeps a joint's bone (pivot -> tip) within `maxDeg` of where it points at rest, in its parent's frame
// (the parent bone base -> pivot, turned by the body's width line), so the zombie's head keeps its forward hang. A
// bone out of its cone is turned back about the pivot with its length kept, carrying what hangs off it (the head off
// the neck); `prev` moves with each point, so no speed is added; at most `maxStep` of the tip a call.
export interface SpineCone {
  base: number; pivot: number; tip: number;
  /** The width line (R -> L) squaring the parent's frame. */
  latR: number; latL: number;
  /** The bone's rest direction in the parent frame (axis, width, depth). */
  rest: Vec3;
  maxDeg: number;
  /** Points rigidly turned with the tip (the head and jaw off the neck). */
  carry: readonly number[];
}
export const SPINE_CONES = { pelvisDeg: 20, neckDeg: 30, maxStep: Infinity };

const CONE_SPEC: ReadonlyArray<{ base: GaitJointName; pivot: GaitJointName; tip: GaitJointName; lat: readonly [GaitJointName, GaitJointName]; deg: 'pelvisDeg' | 'neckDeg'; carry: readonly GaitJointName[] }> = [
  { base: 'chest', pivot: 'hips', tip: 'pelvis', lat: ['hipR', 'hipL'], deg: 'pelvisDeg', carry: [] },
  { base: 'hips', pivot: 'chest', tip: 'neck', lat: ['shoulderR', 'shoulderL'], deg: 'neckDeg', carry: ['head', 'jaw'] },
  { base: 'chest', pivot: 'neck', tip: 'head', lat: ['shoulderR', 'shoulderL'], deg: 'neckDeg', carry: ['jaw'] },
];

/** The parent frame at `pivot`: axis base -> pivot, the width line squared to it, depth = axis x width. */
function coneFrame(pos: (k: number) => Vec3, c: { base: number; pivot: number; latR: number; latL: number }): [Vec3, Vec3, Vec3] | null {
  const ax = sub(pos(c.pivot), pos(c.base)), aL = len(ax);
  if (aL < 1e-6) return null;
  const axis = scale(ax, 1 / aL), raw = sub(pos(c.latL), pos(c.latR));
  const side = sub(raw, scale(axis, dot3(raw, axis))), sL = len(side);
  if (sL < 1e-6) return null;
  const w = scale(side, 1 / sL);
  return [axis, w, cross(axis, w)];
}

function spineCones(names: readonly GaitJointName[], restPose: readonly Vec3[]): SpineCone[] {
  const out: SpineCone[] = [];
  const ix = (n: GaitJointName) => names.indexOf(n);
  for (const sp of CONE_SPEC) {
    const c = { base: ix(sp.base), pivot: ix(sp.pivot), tip: ix(sp.tip), latR: ix(sp.lat[0]), latL: ix(sp.lat[1]) };
    if (Object.values(c).some(k => k < 0 || !restPose[k])) continue;
    const fr = coneFrame(k => restPose[k]!, c);
    const d = sub(restPose[c.tip]!, restPose[c.pivot]!), dl = len(d);
    if (!fr || dl < 1e-4) continue;
    const u = scale(d, 1 / dl);
    out.push({ ...c, rest: [dot3(u, fr[0]), dot3(u, fr[1]), dot3(u, fr[2])], maxDeg: SPINE_CONES[sp.deg],
      carry: sp.carry.map(ix).filter(k => k >= 0) });
  }
  return out;
}

/** Rotate v about unit axis k by angle (Rodrigues). */
function rotateAbout(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle), kv = cross(k, v), kd = dot3(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

export function relaxSpineCones(
  points: readonly RigPoint[], body: CorpseBody | null | undefined, limits: { maxStep: number } = SPINE_CONES,
): RigPoint[] {
  if (!body?.cones.length) return points as RigPoint[];
  let out: RigPoint[] | null = null;
  for (const c of body.cones) {
    const src = out ?? points;
    const T = src[c.tip], Pv = src[c.pivot];
    if (!T || !Pv || T.pinned || !src[c.base] || !src[c.latR] || !src[c.latL]) continue;
    const fr = coneFrame(k => src[k]!.pos, c);
    const d = sub(T.pos, Pv.pos), L = len(d);
    if (!fr || L < 1e-6) continue;
    const u = scale(d, 1 / L);
    const centre: Vec3 = [
      fr[0][0] * c.rest[0] + fr[1][0] * c.rest[1] + fr[2][0] * c.rest[2],
      fr[0][1] * c.rest[0] + fr[1][1] * c.rest[1] + fr[2][1] * c.rest[2],
      fr[0][2] * c.rest[0] + fr[1][2] * c.rest[1] + fr[2][2] * c.rest[2],
    ];
    const cosA = Math.max(-1, Math.min(1, dot3(u, centre))), off = Math.acos(cosA), max = c.maxDeg * Math.PI / 180;
    if (off <= max) continue;
    // Turn the bone back toward the centre, about the axis square to both (straight opposite: any axis across).
    let k = cross(u, centre);
    if (len(k) < 1e-6) k = cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
    k = scale(k, 1 / len(k));
    let turn = off - max;
    // The tip moves 2 L sin(turn / 2): cap it.
    const tipMove = 2 * L * Math.sin(turn / 2);
    if (tipMove > limits.maxStep) turn = 2 * Math.asin(Math.min(1, limits.maxStep / (2 * L)));
    out ??= points.slice() as RigPoint[];
    for (const i of [c.tip, ...c.carry]) {
      const p = out[i];
      if (!p || p.pinned) continue;
      const np = add3(Pv.pos, rotateAbout(sub(p.pos, Pv.pos), k, turn));
      const mv = sub(np, p.pos);
      out[i] = { ...p, pos: np, prev: [p.prev[0] + mv[0], p.prev[1] + mv[1], p.prev[2] + mv[2]] };
    }
  }
  return out ?? (points as RigPoint[]);
}
