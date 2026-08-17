// src/lab/sdf-zombie/stagger.ts
//
// Hit-stagger — escalates a fresh wound (profile + shot direction) into a
// whole-body reaction, per spec §4. The verlet rig's impulseAt shove is the
// per-joint jolt; this module is the reaction it escalates INTO:
//
//   pellet  → flinch   — one-beat shoulder/torso twitch along the shot.
//   blast   → lurch    — directional root displacement along the shot, a
//                        recovery-step request for the IK foot plant, and a
//                        gait-phase knock that recovers over ~1 s.
//   burn    → shudder  — a short high-frequency tremor along the shot axis.
//
// Reactions are PURE functions of (StaggerState, StaggerSignal, dt): no
// Date.now, no Math.random. The clock is state.age, the only per-body
// variation is state.seed (the shudder's phase offset, so two bodies never
// tremble in sync) — identical inputs produce bit-identical output
// (determinism is load-bearing; the reaction feeds the same solver every
// frame).
//
// COMPOSITION CONTRACT (task 4): the output is a sibling of gait.ts's —
// rootOffset adds to gait's rootOffset, each key in offsets adds to
// gait.pose.offsets[key] (missing keys = zero), all in BODY-LOCAL space
// (rotate both by the wander heading with gait's rotateYaw). The shot
// direction in the signal must therefore also be body-local: rotate the
// world ray direction with rotateYaw(dir, -heading) before passing it in.
//
// Two signals the wiring consumes:
//   - staggered: while true, feed it to ik.ts stepClutch's `staggered` input
//     — any active wound-clutch is interrupted for the reaction's duration.
//   - phaseKnock: a gait-clock TIME offset (s) to add to gait state.time
//     before stepping (state.time + phaseKnock). A blast shoves the stride
//     out of sync; the knock decays to 0 over phaseKnockTime and the gait
//     phase returns to normal. Zero for flinch/shudder.
//
// Supersession: a new hit replaces the active reaction only when it is at
// least as severe (blast > burn > pellet); equal severity restarts the same
// kind with the new direction (continuous pellet fire keeps re-flinching,
// and re-blasts re-lurch). A weaker hit during a stronger reaction is
// ignored — the stronger reaction keeps its clock and direction.
import type { Vec3 } from './types';
import type { WoundType } from './damage';
import type { GaitJointName } from './gait';
import { scale } from './vec';

const TAU = Math.PI * 2;
const Z: Vec3 = [0, 0, 0];

/** The three whole-body reactions, in severity order (higher supersedes). */
export type StaggerKind = 'flinch' | 'lurch' | 'shudder';

/** All reaction amplitudes, timings and decay curves in one place. */
export const STAGGER_TUNING = {
  // Flinch (pellet) — a one-beat shoulder/torso twitch. Amplitude raised
  // 0.04 → 0.085 in the motion-polish pass: 4 cm was sub-perceptual at the
  //  god-cam's working distance on a ~1.9 m body (the owner's "shots show no
  //  visible reaction").
  /** Peak shoulder twitch (m). */
  flinchAmp: 0.085,
  /** One-beat duration (s). */
  flinchBeat: 0.3,
  /** Root share of the twitch (fraction). */
  flinchRootScale: 0.35,
  /** Chest share of the shoulder twitch (fraction). */
  flinchChestScale: 0.6,

  // Lurch (blast) — directional root displacement + recovery step + phase
  // knock. The envelope is a normalised attack-decay: peak = lurchAmp at
  // ~lurchRise, then decays with time constant lurchDecay. 5τ = 1.0 s, which
  // is the reaction's total duration — the "recovers over ~1 s" of spec §4.
  /** Peak root displacement along the shot (m). Raised 0.17 → 0.26 in the
   *  motion-polish pass — the rest-pull damps the targets hard, so the
   *  visible lurch lands well under the target value. */
  lurchAmp: 0.26,
  /** Attack time constant (s). */
  lurchRise: 0.05,
  /** Decay time constant (s) — 5τ is the lurch's duration. */
  lurchDecay: 0.2,
  /** Upper-body share of the root displacement (fraction). */
  lurchUpperScale: 0.55,
  /** Recovery-step request window start (s). */
  recoveryStepAt: 0.18,
  /** Recovery-step request window length (s). */
  recoveryStepDur: 0.32,
  /** Peak gait-clock knock (s) — how far the stride shoves out of sync. */
  phaseKnockMax: 0.12,
  /** The knock recovers over this long (s) — keep it at the lurch duration
   *  (lurchDecay * 5) so it reaches exactly 0 as the reaction ends. */
  phaseKnockTime: 1.0,

  // Shudder (burn) — a short high-frequency tremor along the shot axis.
  /** Peak upper-body oscillation (m). */
  shudderAmp: 0.02,
  /** Tremor frequency (Hz). */
  shudderFreq: 11,
  /** Attack time constant (s). */
  shudderRise: 0.03,
  /** Decay time constant (s) — 5τ is the shudder's duration. */
  shudderDecay: 0.14,
  /** Root share of the tremor (fraction). */
  shudderRootScale: 0.4,
  /** Elbow/neck share of the tremor (fraction). */
  shudderLimbScale: 0.8,
} as const;

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/** The stagger clock. age is the current reaction's seconds so far; seed is
 *  the per-body determinism source (shudder phase). */
export interface StaggerState {
  /** Active reaction, or null when calm. */
  kind: StaggerKind | null;
  /** Seconds since the current reaction started. */
  age: number;
  /** The shot direction driving the current reaction (body-local). */
  dir: Vec3;
  /** Per-body seed — any integer; never changes. */
  seed: number;
}

/** A fresh calm stagger state. */
export function makeStaggerState(seed: number): StaggerState {
  return { kind: null, age: 0, dir: Z, seed: seed >>> 0 };
}

/** A hit that landed this frame. */
export interface StaggerHit {
  /** Wound profile — decides flinch/lurch/shudder and the magnitudes. */
  type: WoundType;
  /** Shot direction, BODY-LOCAL (see the header) — the reaction follows it. */
  dir: Vec3;
}

/** Per-frame input. */
export interface StaggerSignal {
  /** A hit that landed this frame, or null. */
  hit: StaggerHit | null;
}

/** One stagger step — the reaction to add onto the gait pose. */
export interface StaggerStep {
  state: StaggerState;
  /** Root displacement (m) — ADD to gait's rootOffset (body-local). */
  rootOffset: Vec3;
  /** Per-joint offsets (m) — ADD to gait's offsets (body-local); missing = 0. */
  offsets: Partial<Record<GaitJointName, Vec3>>;
  /** True while a reaction is active — feed to stepClutch's `staggered`. */
  staggered: boolean;
  /** Blast only: true for one window mid-lurch. The wiring forces the IK
   *  foot plant to re-lock (a fresh stance edge) while it's up — the body
   *  catches itself after the shove. */
  recoveryStep: boolean;
  /** Blast only: gait-clock TIME offset (s) to add to gait state.time before
   *  stepping — the stride is knocked out of sync and recovers over
   *  phaseKnockTime. Zero for flinch/shudder. */
  phaseKnock: number;
}

// ---------------------------------------------------------------------------
// Deterministic primitives.
// ---------------------------------------------------------------------------

const KIND_FOR: Record<WoundType, StaggerKind> = {
  pellet: 'flinch',
  blast: 'lurch',
  burn: 'shudder',
};

const SEVERITY: Record<StaggerKind, number> = { flinch: 0, shudder: 1, lurch: 2 };

/** Total reaction duration per kind — 5 decay time constants. */
const DURATION: Record<StaggerKind, number> = {
  flinch: STAGGER_TUNING.flinchBeat,
  lurch: STAGGER_TUNING.lurchDecay * 5,
  shudder: STAGGER_TUNING.shudderDecay * 5,
};

/** One-beat bump: sin(π·u), 0 at both ends — the pellet flinch. */
function beatEnv(u: number): number {
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
}

/** Normalised attack-decay envelope: rises from 0 over `rise`, decays with
 *  time constant `decay`, peak = exactly 1 (at ~rise·ln(1+decay/rise)). */
function attackDecayEnv(age: number, rise: number, decay: number): number {
  if (age <= 0) return 0;
  const peakAge = rise * Math.log(1 + decay / rise);
  const peak = (1 - Math.exp(-peakAge / rise)) * Math.exp(-peakAge / decay);
  const e = (1 - Math.exp(-age / rise)) * Math.exp(-age / decay);
  return peak > 0 ? e / peak : 0;
}

/** Deterministic 32-bit hash of the seed → a phase in [0, 2π) for the
 *  shudder, so two bodies with different seeds never tremble in sync. */
function hashPhase(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * TAU;
}

// ---------------------------------------------------------------------------
// The stagger.
// ---------------------------------------------------------------------------

/**
 * One stagger step: processes any fresh hit, ages the active reaction, and
 * produces the reaction to add onto the gait pose. Pure and deterministic —
 * same (state, signal, dt) always yields the same step.
 *
 * A hit is processed BEFORE aging: it (re)starts its reaction at age 0 the
 * frame it lands, and the clock advances by dt after. Hits with severity
 * below the active reaction's are dropped (see the header).
 */
export function stepStagger(state: StaggerState, sig: StaggerSignal, dt: number): StaggerStep {
  const T = STAGGER_TUNING;
  let { kind, age, dir } = state;
  const seed = state.seed;

  const hit = sig.hit;
  if (hit && (!kind || SEVERITY[KIND_FOR[hit.type]] >= SEVERITY[kind])) {
    kind = KIND_FOR[hit.type];
    age = 0;
    dir = [hit.dir[0], hit.dir[1], hit.dir[2]];
  }

  if (kind) {
    age += Math.max(dt, 0);
    if (age >= DURATION[kind]) {
      kind = null;
      age = 0;
      dir = Z;
    }
  }

  const next: StaggerState = { kind, age, dir, seed };
  if (!kind) {
    return { state: next, rootOffset: Z, offsets: {}, staggered: false, recoveryStep: false, phaseKnock: 0 };
  }

  let rootOffset: Vec3 = Z;
  const offsets: Partial<Record<GaitJointName, Vec3>> = {};
  let phaseKnock = 0;
  let recoveryStep = false;

  if (kind === 'flinch') {
    const env = beatEnv(age / T.flinchBeat);
    const d = scale(dir, env * T.flinchAmp);
    rootOffset = scale(dir, env * T.flinchAmp * T.flinchRootScale);
    offsets.chest = scale(d, T.flinchChestScale);
    offsets.shoulderL = d;
    offsets.shoulderR = d;
  } else if (kind === 'lurch') {
    const env = attackDecayEnv(age, T.lurchRise, T.lurchDecay);
    rootOffset = scale(dir, env * T.lurchAmp);
    const up = scale(rootOffset, T.lurchUpperScale);
    offsets.chest = up;
    offsets.neck = up;
    offsets.head = up;
    offsets.shoulderL = up;
    offsets.shoulderR = up;
    offsets.elbowL = up;
    offsets.elbowR = up;
    offsets.handL = up;
    offsets.handR = up;
    // Phase knock: full at the instant of impact, quadratic ease-out to 0
    // exactly when the lurch ends (phaseKnockTime == lurchDecay * 5).
    const u = age / T.phaseKnockTime;
    const knock = u >= 1 ? 0 : T.phaseKnockMax * (1 - u) * (1 - u);
    phaseKnock = dir[0] >= 0 ? knock : -knock;
    recoveryStep = age >= T.recoveryStepAt && age < T.recoveryStepAt + T.recoveryStepDur;
  } else {
    const env = attackDecayEnv(age, T.shudderRise, T.shudderDecay);
    const osc = Math.sin(TAU * T.shudderFreq * age + hashPhase(seed));
    const d = scale(dir, env * osc * T.shudderAmp);
    rootOffset = scale(d, T.shudderRootScale);
    offsets.chest = d;
    offsets.neck = scale(d, T.shudderLimbScale);
    offsets.head = d;
    offsets.shoulderL = d;
    offsets.shoulderR = d;
    offsets.elbowL = scale(d, T.shudderLimbScale);
    offsets.elbowR = scale(d, T.shudderLimbScale);
    offsets.handL = d;
    offsets.handR = d;
  }

  return { state: next, rootOffset, offsets, staggered: true, recoveryStep, phaseKnock };
}
