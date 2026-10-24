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
import { len, sub } from './vec';

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
  /** Rope: knee stays bent — max hip↔foot is this fraction of full extension. */
  legSlack: 0.94,
  /** Rope: elbow stays bent — max shoulder↔hand fraction of full extension. */
  armSlack: 0.9,
  /** Rope: max hip↔hip / shoulder↔shoulder spread (× rest distance). */
  splay: 1.6,
} as const;

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
  for (const w of sig.wounds) meter = clamp01(meter + WOUND_PROFILES[w.type].radius * T.meterRadiusWeight);
  for (const limb of sig.severed) meter = clamp01(meter + T.severedLimbWeight);

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
