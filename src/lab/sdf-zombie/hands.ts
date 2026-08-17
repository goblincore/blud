// src/lab/sdf-zombie/hands.ts
//
// First-person SDF hands — pure DATA + tween math (spec §2,
// docs/superpowers/specs/2026-08-16-sdf-lab-fpv-dynamite-design.md).
//
// The hands are SDF FLESH: the same capsule `Primitive` language the zombie
// body is authored in (body.ts), posed in CAMERA-LOCAL space — x right, y up,
// +z toward the scene, camera/eye at the origin, units metres. They are sized
// for a bottom-of-frame first-person framing: mittens in the lower corners
// converging on the held dynamite, forearm stubs running off the bottom of
// the frame. Claymation-chunky — 5 prims per hand (spec: 4–6): forearm stub,
// wrist, palm, fused-finger mitten, thumb.
//
// No rendering here. The wiring task marches these as a small camera-anchored
// field: take HAND_PRIMS, add the per-prim transform poseAt returns, fold,
// and run the existing Verlet jiggle (rig.ts) with HAND_JIGGLE.
//
// Timing comes from fpv.ts's cook state machine — never a second clock:
// handPhaseFromCook maps CookPhase ('idle'|'cooking'|'cooldown') onto the
// five ANIMATION phases (idle / light / cook / throw / recover):
//
//   idle ──press──► light ──0.15s──► cook ──release──► throw ──0.12s──► recover ──0.28s──► idle
//   (fpv idle)      (fpv cooking)    (fpv cooking)     (fpv cooldown)   (fpv cooldown)
//
// The splits (lightSec, throwSec) are authored here; the window totals are
// fpv's: light + cook ≤ DYNAMITE_COOK.fuseMaxSec, throw + recover ==
// FPV_TUNING.throwRecoverSec (see HAND_PHASE_SEC).
//
// Tween model — every phase is a blend from its canonical source (the
// previous phase's fully-blended keyframe) to its own static keyframe, over
// phase-local seconds, with smoothstep easing (zero slope at both ends: no
// velocity pops). The idle bob is a global oscillator added on top, weighted
// per phase (full sway idle, damped while acting, none mid-throw); the
// weight is eased with the same s so boundaries stay continuous. By
// construction each phase's blend finishes within its window, so sampling
// the previous phase at its window end and the next at t=0 yields the SAME
// pose — asserted in hands.test.ts.
//
// The one state-dependent boundary — cook exits at a VARIABLE time (release
// early / overcook) — is handled by the optional `entry` argument: the wiring
// snapshots poseAt at the transition frame and feeds it back; the next phase
// then blends FROM that captured pose (bob stripped and re-added exactly, so
// poseAt(B, 0, c, entry) === entry, asserted in tests). Canonical 3-arg calls
// stay continuous along the full-charge path.
//
// Determinism: pure functions of their arguments — no Date.now, no
// Math.random, no module state mutated after load. Identical inputs produce
// bit-identical output.
import type { Primitive, Vec3 } from './types';
import { FPV_TUNING, type CookState } from './fpv';
import { DYNAMITE_COOK } from '../../game/gibs/tuning';

// ——— Prim set ——————————————————————————————————————————————————————————————

/** Prim order is part of the interface: poses and jiggle data index it. */
export const HAND_PRIM_NAMES = ['forearm', 'wrist', 'palm', 'mitten', 'thumb'] as const;
export const HAND_PRIM_COUNT = HAND_PRIM_NAMES.length;

/**
 * The RIGHT hand (lead — it holds and throws; FPV_TUNING.handOffsetM.lateral
 * is +, so the bundle leaves lower-right). The left hand is its x-mirror, so
 * tuning edits ONE table. Camera-local metres, rest pose == the idle pose.
 */
const HAND_PRIMS_R: readonly Primitive[] = [
  // 0 forearm stub — runs off the bottom-right of the frame.
  { a: [0.36, -0.43, 0.41], b: [0.53, -0.63, 0.30], radius: 0.050, scale: [1, 1, 1], blendK: 0.008, limb: 'armR', cluster: 1 },
  // 1 wrist — flows from the stub toward the palm.
  { a: [0.38, -0.47, 0.40], b: [0.30, -0.41, 0.44], radius: 0.045, scale: [1, 0.92, 1], blendK: 0.008, limb: 'armR', cluster: 1 },
  // 2 palm — broad and flat, cupping the stick.
  { a: [0.31, -0.38, 0.45], b: [0.21, -0.31, 0.50], radius: 0.052, scale: [1.12, 0.85, 1.0], blendK: 0.007, limb: 'armR', cluster: 1 },
  // 3 mitten — the fused-finger mass that grips the dynamite, pointing
  // up-inward toward screen centre where the stick stands.
  { a: [0.26, -0.34, 0.48], b: [0.15, -0.25, 0.53], radius: 0.047, scale: [1, 1, 1], blendK: 0.006, limb: 'armR', cluster: 1 },
  // 4 thumb — wraps the inner side of the stick.
  { a: [0.20, -0.36, 0.44], b: [0.12, -0.28, 0.47], radius: 0.026, scale: [1, 1, 1], blendK: 0.006, limb: 'armR', cluster: 1 },
];

/** x-mirror into the left hand: negate x of both capsule ends, swap cluster. */
function mirrorPrimX(p: Primitive): Primitive {
  return { ...p, a: [-p.a[0], p.a[1], p.a[2]], b: [-p.b[0], p.b[1], p.b[2]], limb: 'armL', cluster: 0 };
}

// ——— Tuning ——————————————————————————————————————————————————————————————————

export const HANDS_TUNING = {
  /** Global framing nudge applied by buildHandPrims (pos shift + uniform size
   *  scale) so the wiring can reseat the hands without editing the tables.
   *  HAND_PRIMS below is baked at these defaults — call buildHandPrims() after
   *  changing them. */
  anchor: { pos: [0, 0, 0] as Vec3, uniform: 1 },
  /** Idle sway: figure-eight bob, x at 1 cycle / period, y at 2 (weapon sway). */
  bob: { periodSec: 0.9, lateralAmpM: 0.014, verticalAmpM: 0.011, forwardAmpM: 0.006 },
  /** Authored splits of fpv's windows: light+cook ≤ fuseMaxSec,
   *  throw+recover == throwRecoverSec (asserted in tests). */
  phaseSec: { light: 0.15, throw: 0.12 },
  /** Per-phase blend-in durations; each must fit inside its phase window
   *  (recover blends across its whole window, derived — see blendSecFor). */
  blendSec: { idle: 0.3, light: 0.1, cook: 0.55, throw: 0.08 },
  /** Idle-bob weight per phase — damped while the hands act, zero mid-throw,
   *  fading back in through recover. Eased with the phase blend. */
  bobWeight: { idle: 1, light: 0.35, cook: 0.15, throw: 0, recover: 1 },
} as const;

/** Phase windows in seconds, derived from fpv's constants (never duplicated). */
export const HAND_PHASE_SEC = {
  light: HANDS_TUNING.phaseSec.light,
  /** Max cook duration = the fuse window minus the light beat. */
  cookMax: DYNAMITE_COOK.fuseMaxSec - HANDS_TUNING.phaseSec.light,
  throw: HANDS_TUNING.phaseSec.throw,
  /** Recover = fpv's cooldown minus the throw beat. */
  recover: FPV_TUNING.throwRecoverSec - HANDS_TUNING.phaseSec.throw,
} as const;

/** Both hands' rest prims (anchor defaults). left = x-mirror of right. */
export function buildHandPrims(): { left: Primitive[]; right: Primitive[] } {
  const { pos, uniform } = HANDS_TUNING.anchor;
  const seat = (p: Primitive): Primitive => ({
    ...p,
    a: [p.a[0] * uniform + pos[0], p.a[1] * uniform + pos[1], p.a[2] * uniform + pos[2]],
    b: [p.b[0] * uniform + pos[0], p.b[1] * uniform + pos[1], p.b[2] * uniform + pos[2]],
    radius: p.radius * uniform,
  });
  return {
    right: HAND_PRIMS_R.map(seat),
    left: HAND_PRIMS_R.map(p => seat(mirrorPrimX(p))),
  };
}

/** Convenience const baked at module load (buildHandPrims() for live tuning). */
export const HAND_PRIMS = buildHandPrims();

// ——— Pose keyframes ————————————————————————————————————————————————————————

export type HandPhase = 'idle' | 'light' | 'cook' | 'throw' | 'recover';

/** Sparse per-prim keyframe entry; absent pos = rest, absent scale = ×1. */
export interface PrimPose {
  /** Camera-local offset from the prim's rest position (m). */
  pos?: Vec3;
  /** Multiplier on the prim's ellipsoid scale (grip swell / extend thin). */
  scale?: Vec3;
}

/** One hand's keyframe — sparse array indexed by HAND_PRIM_NAMES order. */
export type HandKeyframe = readonly (PrimPose | undefined)[];

/**
 * Role-keyed pose tables (camera space, NOT mirrored — the hands act
 * differently): `lead` = the right hand (holds + throws the stick, exits
 * lower-right per FPV_TUNING.handOffsetM), `support` = the left hand (raises
 * the lighter to the fuse, drops away on throw). Silhouettes follow the
 * game's 2D dynamite frames as described in the spec: idle low and relaxed,
 * light brings the fuse up to the flame, cook tenses around the stick,
 * throw extends the lead hand, recover settles home (target == idle).
 */
export const HAND_POSES: {
  lead: Record<HandPhase, HandKeyframe>;
  support: Record<HandPhase, HandKeyframe>;
} = {
  lead: {
    // idle: rest pose, zero offsets.
    idle: [],
    // light: raise the stick tip toward the flame, first squeeze.
    light: [
      { pos: [0, 0.02, 0] },                                     // forearm
      { pos: [0, 0.03, 0] },                                     // wrist
      { pos: [-0.02, 0.05, 0.01], scale: [1.04, 1, 1.04] },      // palm
      { pos: [-0.03, 0.07, 0.02], scale: [1.05, 1.05, 1.05] },   // mitten
      { pos: [-0.04, 0.08, 0.02] },                              // thumb
    ],
    // cook: hands tense around the stick — pull in/up/back, knuckle-whiten.
    cook: [
      { pos: [-0.01, 0.01, -0.005] },                                  // forearm
      { pos: [-0.015, 0.02, -0.01] },                                  // wrist
      { pos: [-0.03, 0.035, -0.015], scale: [1.08, 1.02, 1.08] },      // palm
      { pos: [-0.045, 0.05, -0.02], scale: [1.1, 1.12, 1.1] },         // mitten
      { pos: [-0.06, 0.06, -0.01], scale: [1.12, 1.12, 1.12] },        // thumb
    ],
    // throw: lead hand extends up-out-forward, fingers thinning out.
    throw: [
      { pos: [0.02, 0.05, 0.03] },                                // forearm
      { pos: [0.03, 0.07, 0.05] },                                // wrist
      { pos: [0.05, 0.1, 0.08] },                                 // palm
      { pos: [0.06, 0.12, 0.1], scale: [0.96, 0.96, 0.96] },      // mitten
      { pos: [0.03, 0.09, 0.06] },                                // thumb
    ],
    // recover: target IS the idle pose (zero offsets); the motion is the
    // blend home from throw, with the bob fading back in.
    recover: [],
  },
  support: {
    idle: [],
    // light: the lighter hand rises higher — it brings the flame TO the fuse.
    light: [
      { pos: [0, 0.03, 0] },                                     // forearm
      { pos: [0, 0.04, 0] },                                     // wrist
      { pos: [0.01, 0.06, 0.02] },                               // palm
      { pos: [0.02, 0.09, 0.03], scale: [1.06, 1.06, 1.06] },    // mitten
      { pos: [0.03, 0.09, 0.02] },                               // thumb
    ],
    // cook: mirror-tense, converging inward (+x for the left hand).
    cook: [
      { pos: [0.01, 0.01, -0.005] },                                  // forearm
      { pos: [0.015, 0.02, -0.01] },                                  // wrist
      { pos: [0.035, 0.035, -0.015], scale: [1.08, 1.02, 1.08] },      // palm
      { pos: [0.05, 0.05, -0.02], scale: [1.1, 1.12, 1.1] },           // mitten
      { pos: [0.065, 0.06, -0.01], scale: [1.12, 1.12, 1.12] },        // thumb
    ],
    // throw: support hand drops back and outward, out of the throw's way.
    throw: [
      { pos: [-0.01, -0.02, -0.01] },                            // forearm
      { pos: [-0.02, -0.03, -0.02] },                            // wrist
      { pos: [-0.04, -0.05, -0.03] },                            // palm
      { pos: [-0.06, -0.07, -0.04], scale: [0.97, 0.97, 0.97] }, // mitten
      { pos: [-0.03, -0.05, -0.02] },                            // thumb
    ],
    recover: [],
  },
};

/** Which pose table each side plays. */
export const HAND_ROLE_OF_SIDE = { left: 'support', right: 'lead' } as const;
export type HandRole = keyof typeof HAND_POSES; // 'lead' | 'support'

// ——— Tween ———————————————————————————————————————————————————————————————————

/** A posed prim: rest-space offset (bob included) + ellipsoid scale multiplier. */
export interface HandTransform {
  pos: Vec3;
  scale: Vec3;
}

/** poseAt's result — per-hand per-prim transforms, prim order as authored. */
export interface HandPoseSample {
  left: readonly HandTransform[];
  right: readonly HandTransform[];
  /** Bob weight baked into pos — pass the sample back as `entry` to continue
   *  seamlessly across a variable-exit boundary (early release / overcook). */
  bobWeight: number;
}

/** Canonical blend source of each phase (the previous phase's keyframe).
 *  idle's canonical source is recover (the normal loop); the overcook path
 *  cook → idle is variable-exit — use the `entry` argument there. */
const PREV_PHASE: Record<HandPhase, HandPhase> = {
  idle: 'recover', light: 'idle', cook: 'light', throw: 'cook', recover: 'throw',
};

/** Blend duration of a phase; recover blends across its whole window. */
function blendSecFor(phase: HandPhase): number {
  if (phase === 'recover') return Math.max(HAND_PHASE_SEC.recover, 1e-3);
  const b = HANDS_TUNING.blendSec[phase];
  return b > 0 ? b : 1;
}

/** Smoothstep ease on [0,1] — zero slope at both ends (no velocity pop). */
export function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Idle bob offset at `bobClock` seconds — figure-eight weapon sway. */
export function bobOffset(bobClock: number): Vec3 {
  const b = HANDS_TUNING.bob;
  const th = (Math.PI * 2 * bobClock) / b.periodSec;
  return [
    b.lateralAmpM * Math.sin(th),
    b.verticalAmpM * Math.sin(2 * th),
    b.forwardAmpM * Math.cos(th),
  ];
}

/** Resolve a sparse keyframe into dense per-prim pos/scale transforms. */
function denseKeyframe(kf: HandKeyframe): HandTransform[] {
  const out: HandTransform[] = [];
  for (let i = 0; i < HAND_PRIM_COUNT; i++) {
    const e = kf[i];
    out.push({ pos: e?.pos ?? [0, 0, 0], scale: e?.scale ?? [1, 1, 1] });
  }
  return out;
}

const lerpN = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerpN(a[0], b[0], t), lerpN(a[1], b[1], t), lerpN(a[2], b[2], t),
];

/**
 * The hand pose at `phase`-local time `phaseT` seconds (from
 * handPhaseFromCook), with the idle bob evaluated at `bobClock` seconds.
 *
 * `entry` (optional): a previously captured sample — the wiring snapshots
 * poseAt at a transition frame (early release, overcook) and passes it here
 * so the next phase blends FROM the actual pose instead of the canonical
 * exit. The bob baked into `entry` is stripped with the CURRENT bobClock, so
 * capture and resume on the same frame for exactness.
 */
export function poseAt(
  phase: HandPhase,
  phaseT: number,
  bobClock: number,
  entry?: HandPoseSample,
): HandPoseSample {
  const t = Number.isFinite(phaseT) && phaseT > 0 ? phaseT : 0;
  const s = smooth01(t / blendSecFor(phase));
  const bob = bobOffset(bobClock);
  const tgtW = HANDS_TUNING.bobWeight[phase];

  const sampleHand = (role: HandRole, entryHand: readonly HandTransform[], entryW: number): HandTransform[] => {
    const tgt = denseKeyframe(HAND_POSES[role][phase]);
    // Source: the captured entry — with its baked-in bob (offset · entryW)
    // stripped back out, so the bob is re-added through the eased weight and
    // poseAt(B, 0, c, entry) === entry exactly — or the canonical previous
    // keyframe.
    const src: readonly HandTransform[] = entry
      ? entryHand.map(tr => ({
          pos: [tr.pos[0] - bob[0] * entryW, tr.pos[1] - bob[1] * entryW, tr.pos[2] - bob[2] * entryW] as Vec3,
          scale: tr.scale,
        }))
      : denseKeyframe(HAND_POSES[role][PREV_PHASE[phase]]);
    const srcW = entry ? entryW : HANDS_TUNING.bobWeight[PREV_PHASE[phase]];
    const w = lerpN(srcW, tgtW, s);

    const out: HandTransform[] = [];
    for (let i = 0; i < HAND_PRIM_COUNT; i++) {
      const pos = lerpV(src[i]!.pos, tgt[i]!.pos, s);
      out.push({
        pos: [pos[0] + bob[0] * w, pos[1] + bob[1] * w, pos[2] + bob[2] * w],
        scale: lerpV(src[i]!.scale, tgt[i]!.scale, s),
      });
    }
    return out;
  };

  const entryW = entry?.bobWeight ?? 0;
  return {
    left: sampleHand('support', entry?.left ?? [], entryW),
    right: sampleHand('lead', entry?.right ?? [], entryW),
    bobWeight: entry
      ? lerpN(entryW, tgtW, s)
      : lerpN(HANDS_TUNING.bobWeight[PREV_PHASE[phase]], tgtW, s),
  };
}

// ——— fpv cook-state → hand-phase mapping ————————————————————————————————————

/** A hand animation phase plus its phase-local seconds. */
export interface HandPhaseRef {
  phase: HandPhase;
  phaseT: number;
}

/**
 * Map fpv.ts's cook state onto the hand animation phases — the ONLY place
 * the two clocks meet. `now` is fpv's cook clock (the same `now` passed to
 * stepCook); phaseT is seconds since the hand phase began.
 *
 *   fpv 'idle'    → idle
 *   fpv 'cooking' → light (first lightSec) → cook (rest, ≤ fuseMaxSec)
 *   fpv 'cooldown'→ throw (first throwSec) → recover (rest, == throwRecoverSec)
 */
export function handPhaseFromCook(cook: CookState, now: number): HandPhaseRef {
  const t = now - cook.phaseAt;
  switch (cook.phase) {
    case 'idle':
      return { phase: 'idle', phaseT: t };
    case 'cooking':
      return t < HAND_PHASE_SEC.light
        ? { phase: 'light', phaseT: t }
        : { phase: 'cook', phaseT: t - HAND_PHASE_SEC.light };
    case 'cooldown':
      return t < HAND_PHASE_SEC.throw
        ? { phase: 'throw', phaseT: t }
        : { phase: 'recover', phaseT: t - HAND_PHASE_SEC.throw };
  }
}

// ——— Verlet jiggle spec (data for the wiring; rig.ts runs it) ————————————

/** Per-prim jiggle behaviour, ordered like HAND_PRIM_NAMES. */
export interface PrimJiggle {
  /** Rest-pull stiffness for this prim's jiggle point (rig restStiffness share). */
  stiffness: number;
  /** Velocity bleed for this prim (rig damping share), 0..1. */
  damping: number;
  /** Pinned prims never leave the posed rest (the frame-exiting forearm). */
  pinned: boolean;
}

/**
 * The jiggle recipe the wiring feeds into rig.ts: one Verlet point per prim
 * (its capsule midpoint), distance constraints between adjacent prims at
 * linkStiffness, per-prim rest-pull/damping from perPrim, gravity in
 * CAMERA-LOCAL space (softened — hands are near the eye, flesh sags more
 * than it falls). Distal flesh (mitten, thumb) is loose so the cook-hold
 * wobbles; the forearm stub is pinned as the frame anchor.
 */
export const HAND_JIGGLE = {
  gravity: [0, -1.6, 0] as Vec3,
  damping: 0.12,
  iterations: 3,
  restStiffness: 0.18,
  linkStiffness: 0.55,
  perPrim: [
    { stiffness: 1.0, damping: 0.4, pinned: true },   // forearm — frame anchor
    { stiffness: 0.85, damping: 0.35, pinned: false }, // wrist
    { stiffness: 0.65, damping: 0.3, pinned: false },  // palm
    { stiffness: 0.45, damping: 0.22, pinned: false }, // mitten — the wobble
    { stiffness: 0.4, damping: 0.2, pinned: false },   // thumb
  ] as readonly PrimJiggle[],
} as const;
