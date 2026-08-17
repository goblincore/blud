// src/lab/sdf-zombie/fpv-mode.ts
//
// FPV mode orchestration (X1.23 task 4, spec
// docs/superpowers/specs/2026-08-16-sdf-lab-fpv-dynamite-design.md): the
// god-cam ↔ first-person mode machine, the cook → throw → flight → detonate
// pipeline, and the hand-pose driver — everything renderer-independent
// between `webgpu/lab-main.ts` (the view) and the four task 1-3 modules
// (fpv.ts controller, dynamite-flight.ts ballistics, hands.ts pose data,
// explosion-aoe.ts resolver).
//
// THE SEAM this module exists for: lab-main stays lean by receiving
//   - an `FpvGorePort` — the gore-stack operations one detonation performs
//     (implemented there against the existing pipeline: pushWound, the
//     collapse meter, impulseAt, severLimb/severDistal, gibEverything, chunk
//     velocities, the burst billboard), and
//   - an `FpvWorld` — lazy reads of the live scene (posed hero, chunks, the
//     world-space hand prims) evaluated at detonation time.
// `applyExplosionEffect(port, effect, at, hero)` is the single mapping from
// resolveExplosion's bundle to those operations — unit-tested here with a
// recording stub port, so the ROUTING (gib supersedes wounds; meter credited
// directly) is verified without a renderer.
//
// METER CONTRACT (the reason `creditMeter` exists as its own operation):
// stepCollapse weights fresh wounds by their PROFILE radius, ignoring the
// wound's own radius — feeding a blast's many small falloff-scaled wounds
// through the freshWounds path would add ~16 × 0.13 = 2.08 meter for ANY
// in-radius blast and collapse the zombie from an edge graze. The resolver
// pre-computes `meterCredit` (Σ actual radii × weight) and THIS module hands
// it to the port as a number; the port credits the meter directly. The same
// wounds go to `stampWounds` for rendering/carving only.
//
// Determinism: pure functions of (state, input, dt, now, world, port) — no
// Date.now, no Math.random, no module state mutated after load. The view
// layer may add non-deterministic flourish (spark flicker) on top.
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import { sub as vsub, len as vlen } from './vec';
import type { Wound } from './damage';
import type { ChainCut } from './connectivity';
import type { MotionSignals } from './motion';
import {
  EMPTY_FPV_INPUT, cookCharge, eyePos, makeFpv, stepFpv,
  throwDirection, throwOrigin, throwSpeedMps,
  type FpvBounds, type FpvInput, type FpvState,
} from './fpv';
import { makeFlight, stepFlight, type FlightState } from './dynamite-flight';
import {
  HAND_JIGGLE, buildHandPrims, handPhaseFromCook, poseAt,
  type HandPhase, type HandPhaseRef, type HandPoseSample,
} from './hands';
import {
  resolveExplosion, type BurstVisual, type ChunkImpulse, type LiveChunkRef,
} from './explosion-aoe';

// ——— The gore port ————————————————————————————————————————————————————————

/** Everything one detonation can do to the lab, as operations. The lab-main
 *  implementation routes each to the EXISTING system — nothing here
 *  re-implements gore; it only sequences it. */
export interface FpvGorePort {
  /** Blast wounds for the hero's ring — rendering + carve fuel ONLY (the
   *  meter is credited separately; see the module header). */
  stampWounds(wounds: readonly Wound[]): void;
  /** Credits the collapse meter DIRECTLY by `effect.meterCredit`. */
  creditMeter(credit: number): void;
  /** Concussion shove for the hero rig (velocity m/s; the port converts to a
   *  Verlet displacement via impulseAt). */
  impulseRig(at: Vec3, vel: Vec3): void;
  /** Full-limb severs — the keyboard-sever path (severLimb + chunk spawn). */
  severFullLimbs(limbs: readonly LimbId[]): void;
  /** Mid-limb joint cuts — the click-shoot distal path (severDistal). */
  applyChainCuts(cuts: readonly ChainCut[]): void;
  /** The gib decision won: gibAllPieces + gobs + scraps (gibEverything). */
  gibBody(): void;
  /** Concussion velocity ADDed to live chunks' ballistic state. */
  impulseChunks(impulses: readonly ChunkImpulse[]): void;
  /** Air/ground burst billboard at the detonation point. */
  spawnBurst(visual: BurstVisual): void;
  /** Hand-splash wounds for the hands' own wound ring. */
  stampHandWounds(wounds: readonly Wound[]): void;
  /** Feeds the blast into the motion reaction path (stagger/clutch) with the
   *  SAME signal shape a blast click-shoot produces — blast maps to 'lurch'. */
  pushShot(shot: NonNullable<MotionSignals['shot']>): void;
}

/** Lazy reads of the live scene, evaluated at detonation time. The hero is
 *  the only body: crowd bodies are static perf fixtures and the wound/sever
 *  systems are hero-only in the lab. */
export interface FpvWorld {
  heroPosed(): BuildResult;
  chunks(): LiveChunkRef[];
  /** World-space hand prims as last uploaded to the hands view (left hand's
   *  5 then the right's, matching buildHandPrims' order). */
  handPrimsWorld(): Primitive[];
}

// ——— applyExplosionEffect ————————————————————————————————————————————————

/**
 * Routes one resolved explosion bundle to the gore port. Ordering mirrors the
 * click-shoot path: wounds → meter → rig impulse → sever checks, then the
 * scene-wide effects. `gibbed` supersedes everything per-body (the game's
 * single-hit rule): gib replaces wounds/cuts, so no double-kill.
 */
export function applyExplosionEffect(
  port: FpvGorePort,
  effect: ReturnType<typeof resolveExplosion>,
  at: Vec3,
  hero: BuildResult,
): void {
  for (const b of effect.perBody) {
    if (b.gibbed) {
      port.gibBody();
      continue;
    }
    if (b.wounds.length > 0) port.stampWounds(b.wounds);
    if (b.meterCredit > 0) port.creditMeter(b.meterCredit);
    if (b.rigImpulse) {
      port.impulseRig(b.rigImpulse.at, b.rigImpulse.vel);
      // The stagger reaction, same signal a blast shot produces. Direction:
      // blast → nearest surface (the shove already carries the point).
      const d = vsub(b.rigImpulse.at, at);
      const l = vlen(d);
      const dir: Vec3 = l < 1e-6 ? [0, 0, 1] : [d[0] / l, d[1] / l, d[2] / l];
      const prim = hero.prims[b.wounds[0]?.primIdx ?? -1];
      port.pushShot({
        type: 'blast',
        dirWorld: dir,
        woundWorld: b.rigImpulse.at,
        torso: prim?.limb === 'torso',
      });
    }
    if (b.severedLimbs.length > 0) port.severFullLimbs(b.severedLimbs);
    if (b.chainCuts.length > 0) port.applyChainCuts(b.chainCuts);
  }
  if (effect.chunkImpulses.length > 0) port.impulseChunks(effect.chunkImpulses);
  port.spawnBurst(effect.burst);
  if (effect.handWounds.length > 0) port.stampHandWounds(effect.handWounds);
}

// ——— Hand jiggle ——————————————————————————————————————————————————————————

/** One Verlet point per prim (its capsule midpoint), camera-local. */
export interface HandJigglePoint { pos: Vec3; prev: Vec3 }
export interface HandJigglePoints { left: HandJigglePoint[]; right: HandJigglePoint[] }

/**
 * Fresh jiggle points at the hands' rest pose. The per-prim recipe
 * (HAND_JIGGLE.perPrim: stiffness/damping shares, pinned forearm) is applied
 * in stepHandJiggle — rig.ts's stepRig takes uniform opts, so this is the
 * same integrator shape expressed per-prim, exactly as hands.ts specifies.
 */
export function makeHandJiggle(): HandJigglePoints {
  const prims = buildHandPrims();
  const mk = (side: Primitive[]): HandJigglePoint[] =>
    side.map(p => ({
      pos: [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2] as Vec3,
      prev: [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2] as Vec3,
    }));
  return { left: mk(prims.left), right: mk(prims.right) };
}

/**
 * One jiggle step toward `targets` (the POSED prim midpoints this frame —
 * the rest pull follows the animation, which is what makes the cook-hold
 * wobble read as flesh weight). Verlet integrate with per-prim damping and
 * softened camera-local gravity, lerp toward the target with per-prim
 * stiffness, then relax the adjacent-prim links at linkStiffness. Pinned
 * prims snap to the target and kill their velocity.
 */
export function stepHandJiggle(
  jiggle: HandJigglePoints,
  targets: { left: readonly Vec3[]; right: readonly Vec3[] },
  dt: number,
): HandJigglePoints {
  const J = HAND_JIGGLE;
  const step = (side: readonly HandJigglePoint[], tgt: readonly Vec3[]): HandJigglePoint[] =>
    side.map((p, i) => {
      const spec = J.perPrim[i] ?? { stiffness: 1, damping: 1, pinned: false };
      const rest = tgt[i] ?? p.pos;
      if (spec.pinned) return { pos: rest, prev: rest };
      // Frame-rate independent rest pull, same shaping as rig.ts.
      const st = 1 - Math.pow(1 - J.restStiffness * spec.stiffness, Math.max(dt, 1e-4) * 60);
      const damp = Math.min(0.95, J.damping * spec.damping);
      const vx = (p.pos[0] - p.prev[0]) * (1 - damp);
      const vy = (p.pos[1] - p.prev[1]) * (1 - damp);
      const vz = (p.pos[2] - p.prev[2]) * (1 - damp);
      let x = p.pos[0] + vx + J.gravity[0] * dt * dt;
      let y = p.pos[1] + vy + J.gravity[1] * dt * dt;
      let z = p.pos[2] + vz + J.gravity[2] * dt * dt;
      x += (rest[0] - x) * st; y += (rest[1] - y) * st; z += (rest[2] - z) * st;
      return { pos: [x, y, z], prev: p.pos };
    });

  let left = step(jiggle.left, targets.left);
  let right = step(jiggle.right, targets.right);

  // Link relaxation: adjacent prims keep their authored spacing, loosely.
  const relax = (side: HandJigglePoint[], tgt: readonly Vec3[]) => {
    for (let it = 0; it < J.iterations; it++) {
      for (let i = 0; i + 1 < side.length; i++) {
        const a = side[i]!, b = side[i + 1]!;
        const restA = tgt[i]!, restB = tgt[i + 1]!;
        const dx = restB[0] - restA[0], dy = restB[1] - restA[1], dz = restB[2] - restA[2];
        const rest = Math.hypot(dx, dy, dz) || 1e-6;
        const d = vsub(b.pos, a.pos);
        const l = vlen(d);
        if (l < 1e-9) continue;
        const corr = ((l - rest) / l) * J.linkStiffness * 0.5;
        const cx = d[0] * corr, cy = d[1] * corr, cz = d[2] * corr;
        const pinnedA = J.perPrim[i]?.pinned ?? false;
        const pinnedB = J.perPrim[i + 1]?.pinned ?? false;
        if (!pinnedA) a.pos = [a.pos[0] + cx, a.pos[1] + cy, a.pos[2] + cz];
        if (!pinnedB) b.pos = [b.pos[0] - cx, b.pos[1] - cy, b.pos[2] - cz];
      }
    }
  };
  relax(left, targets.left);
  relax(right, targets.right);
  return { left, right };
}

/**
 * The camera-local prims to march this frame. Algebraically the prim shift
 * is `jigglePoint − restMidpoint`: the jiggle points CHASE the posed
 * midpoints (handPoseTargets), so a settled point carries the pose offset
 * and the residual `(point − posedTarget)` is the visible wobble. Written
 * explicitly here so the pose term is visible at the call site:
 *   shift = poseOffset + (point − posedTarget).
 * The pose's per-prim scale multipliers fold in independently.
 */
export function posedHandPrims(
  rest: { left: Primitive[]; right: Primitive[] },
  pose: HandPoseSample,
  jiggle: HandJigglePoints,
): { left: Primitive[]; right: Primitive[] } {
  const one = (side: 'left' | 'right'): Primitive[] =>
    rest[side].map((p, i) => {
      const tr = pose[side][i] ?? { pos: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
      const j = jiggle[side][i]?.pos ?? [
        (p.a[0] + p.b[0]) / 2 + tr.pos[0],
        (p.a[1] + p.b[1]) / 2 + tr.pos[1],
        (p.a[2] + p.b[2]) / 2 + tr.pos[2],
      ];
      const ox = j[0] - (p.a[0] + p.b[0]) / 2;
      const oy = j[1] - (p.a[1] + p.b[1]) / 2;
      const oz = j[2] - (p.a[2] + p.b[2]) / 2;
      return {
        ...p,
        a: [p.a[0] + ox, p.a[1] + oy, p.a[2] + oz],
        b: [p.b[0] + ox, p.b[1] + oy, p.b[2] + oz],
        scale: [
          p.scale[0] * tr.scale[0], p.scale[1] * tr.scale[1], p.scale[2] * tr.scale[2],
        ],
      };
    });
  return { left: one('left'), right: one('right') };
}

/** The posed+jiggled midpoints — the jiggle rest targets for this frame. */
export function handPoseTargets(
  rest: { left: Primitive[]; right: Primitive[] },
  pose: HandPoseSample,
): { left: Vec3[]; right: Vec3[] } {
  const one = (side: 'left' | 'right'): Vec3[] =>
    rest[side].map((p, i) => {
      const tr = pose[side][i] ?? { pos: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
      return [
        (p.a[0] + p.b[0]) / 2 + tr.pos[0],
        (p.a[1] + p.b[1]) / 2 + tr.pos[1],
        (p.a[2] + p.b[2]) / 2 + tr.pos[2],
      ];
    });
  return { left: one('left'), right: one('right') };
}

// ——— Camera basis + hand world transform ————————————————————————————————
// fpv.ts's documented conventions (its lookBasis is private): yaw 0 faces -Z,
// mouse right increases yaw; camera-local (x,y,z) → world is
// right·x + up·y + forward·z around the eye.

function camBasis(yaw: number, pitch: number): { f: Vec3; r: Vec3; u: Vec3 } {
  const cp = Math.cos(pitch);
  const f: Vec3 = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  const r: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
  const u: Vec3 = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  return { f, r, u };
}

/**
 * Camera-local hand prims → world space at the given eye pose. Same formula
 * as fpv.ts's throwOrigin (the only other place this basis is used), so the
 * marched hands and the throw origin can never drift apart.
 */
export function handPrimsToWorld(
  posed: { left: Primitive[]; right: Primitive[] },
  eye: Vec3,
  yaw: number,
  pitch: number,
): Primitive[] {
  const { f, r, u } = camBasis(yaw, pitch);
  const tx = (p: Vec3): Vec3 => [
    eye[0] + r[0] * p[0] + u[0] * p[1] + f[0] * p[2],
    eye[1] + r[1] * p[0] + u[1] * p[1] + f[1] * p[2],
    eye[2] + r[2] * p[0] + u[2] * p[1] + f[2] * p[2],
  ];
  return [
    ...posed.left.map(p => ({ ...p, a: tx(p.a), b: tx(p.b) })),
    ...posed.right.map(p => ({ ...p, a: tx(p.a), b: tx(p.b) })),
  ];
}

// ——— Camera kick ——————————————————————————————————————————————————————————

export const KICK_TUNING = {
  /** Shake frequency (Hz) — a violent judder, not a slow sway. */
  freqHz: 9,
  /** Envelope time constant (s) — quake/40 ≈ 4 at the epicentre should be
   *  over in ~a third of a second, like the game's 0.3 s screenshake. */
  decayTauSec: 0.28,
  /** Radians of camera deflection per unit magnitude — the game's
   *  shake(quake/40, 0.3) is a screen-space jolt; this is its FPV analog. */
  radPerMag: 0.02,
  /** Past this age the kick is dropped entirely (envelope < 3%). */
  cutoffSec: 1.0,
} as const;

export interface FpvKick { start: number; mag: number }

/** Damped-oscillation camera deflection at `now` (radians). Deterministic —
 *  no RNG; pitch and roll run on detuned frequencies so it never reads as a
 *  pure axis wobble. */
export function kickAngles(kick: FpvKick | null, now: number): { pitch: number; roll: number } {
  if (!kick) return { pitch: 0, roll: 0 };
  const t = now - kick.start;
  if (t < 0 || t > KICK_TUNING.cutoffSec) return { pitch: 0, roll: 0 };
  const env = Math.exp(-t / KICK_TUNING.decayTauSec) * KICK_TUNING.radPerMag * kick.mag;
  const w = Math.PI * 2 * KICK_TUNING.freqHz * t;
  return {
    pitch: env * Math.sin(w) * 0.6,
    roll: env * Math.sin(w * 0.63 + 1.3),
  };
}

// ——— The mode machine —————————————————————————————————————————————————————

export type FpvModeName = 'god' | 'fpv';

export interface FpvModeState {
  mode: FpvModeName;
  /** The controller state persists across exits, so re-entering FPV resumes
   *  where the player stood (and an in-flight bundle keeps its thrower). */
  fpv: FpvState;
  /** The live thrown bundle; steps in BOTH modes (a god-cam spectator can
   *  watch the arc land). Null after detonation. */
  flight: FlightState | null;
  /** Hand Verlet points, camera-local. */
  jiggle: HandJigglePoints;
  /** Idle-bob clock (seconds; advances with dt, not wall time). */
  bobClock: number;
  /** Pose snapshot captured at a variable cook exit (early release /
   *  overcook) for seamless blending; consumed by the first frame of the
   *  next hand phase. Null when the canonical blend applies. */
  handEntry: HandPoseSample | null;
  /** The phase `handEntry` was captured in. */
  handEntryFrom: HandPhase | null;
  /** The hands' phase LAST frame — the entry-consumption edge detector. */
  lastHandPhase: HandPhase;
  /** Active camera kick, if any. */
  kick: FpvKick | null;
}

/** Fresh state in god mode at the authored spawn ([0,0,4] facing -Z, so the
 *  shambler's home corner at the origin is straight ahead). */
export function makeFpvMode(start: FpvModeName = 'god'): FpvModeState {
  return {
    mode: start,
    fpv: makeFpv([0, 0, 4], 0, -0.03),
    flight: null,
    jiggle: makeHandJiggle(),
    bobClock: 0,
    handEntry: null,
    handEntryFrom: null,
    lastHandPhase: 'idle',
    kick: null,
  };
}

/** Enter FPV (idempotent). Optional spawn override for automation. */
export function enterFpvMode(
  state: FpvModeState,
  opts: { pos?: Vec3; yaw?: number; pitch?: number } = {},
): FpvModeState {
  if (state.mode === 'fpv') return state;
  let fpv = state.fpv;
  if (opts.pos || opts.yaw !== undefined || opts.pitch !== undefined) {
    fpv = {
      ...fpv,
      pos: opts.pos ?? fpv.pos,
      yaw: opts.yaw ?? fpv.yaw,
      pitch: opts.pitch ?? fpv.pitch,
    };
  }
  return { ...state, mode: 'fpv', fpv };
}

/** Exit to the god-cam (idempotent). Controller + flight persist. */
export function exitFpvMode(state: FpvModeState): FpvModeState {
  if (state.mode === 'god') return state;
  return { ...state, mode: 'god' };
}

// ——— The frame ————————————————————————————————————————————————————————————

export interface FpvModeFrame {
  mode: FpvModeName;
  /** Eye position + aim while in FPV (god mode reports the persistent state
   *  anyway — the wiring ignores it there). */
  eye: Vec3;
  yaw: number;
  pitch: number;
  /** Kick deflection in radians (always 0 in god mode usage). */
  kick: { pitch: number; roll: number };
  /** Cook charge 0..1 at `now` — the HUD bar. */
  charge: number;
  /** Hand animation phase + phase-local seconds. */
  handPhase: HandPhaseRef;
  /** The pure tweened pose (bob included, jiggle NOT — the caller folds the
   *  jiggle via posedHandPrims with frame state it keeps). */
  handPose: HandPoseSample;
  /** The live bundle, if any (for the stick prop). */
  flight: FlightState | null;
}

/**
 * One FPV-mode frame. `input` is consumed only in FPV mode (god mode passes
 * EMPTY_FPV_INPUT); the flight steps in both; detonation resolves through
 * `world` + `port` and kicks the FPV camera. `now` is fpv.ts's cook clock —
 * the same monotonic seconds the wiring feeds every frame.
 */
export function stepFpvMode(
  state: FpvModeState,
  input: FpvInput,
  dt: number,
  now: number,
  world: FpvWorld,
  port: FpvGorePort,
  bounds?: FpvBounds,
): { state: FpvModeState; frame: FpvModeFrame } {
  const dtc = Math.max(0, Math.min(dt, 0.25));
  let mode = state.mode;
  let fpv = state.fpv;
  let flight = state.flight;
  let jiggle = state.jiggle;
  let bobClock = state.bobClock;
  let handEntry = state.handEntry;
  let handEntryFrom = state.handEntryFrom;
  let kick = state.kick;

  /** Resolve one detonation end-to-end: bundle → port calls → camera kick. */
  const detonate = (at: Vec3): void => {
    const hero = world.heroPosed();
    const effect = resolveExplosion(at, [{ id: 'hero', body: hero }], {
      chunks: world.chunks(),
      eye: eyePos(fpv),
      hands: { prims: world.handPrimsWorld() },
    });
    applyExplosionEffect(port, effect, at, hero);
    kick = { start: now, mag: effect.cameraKick };
  };

  // — Controller (FPV input only in FPV mode) —
  let signal: ReturnType<typeof stepFpv>['signal'] = null;
  const cookBefore = fpv.cook;
  if (mode === 'fpv') {
    const r = stepFpv(fpv, input, dtc, now, bounds);
    fpv = r.state;
    signal = r.signal;
  }

  // — Variable cook exits: snapshot the on-screen pose so the next hand
  //   phase blends from what was actually there (hands.ts's `entry`).
  if (signal && (signal.kind === 'throw' || signal.kind === 'overcook')) {
    const prev = handPhaseFromCook(cookBefore, now);
    handEntry = poseAt(prev.phase, prev.phaseT, bobClock);
    handEntryFrom = prev.phase;
  }

  // A bundle spawned this frame integrates from the NEXT frame — the spawn
  // velocity is the exact release velocity, not one drag-step decayed.
  let spawnedThisFrame = false;
  if (signal?.kind === 'throw') {
    // The signal carries the release speed (mapped through the game's band);
    // the direction is the CURRENT aim + the game's lob.
    const d = throwDirection(fpv.yaw, fpv.pitch);
    flight = makeFlight(throwOrigin(fpv), [d[0] * signal.speedMps, d[1] * signal.speedMps, d[2] * signal.speedMps]);
    spawnedThisFrame = true;
  } else if (signal?.kind === 'overcook') {
    // Detonates in hand — the explosion sits at the bundle's held position.
    detonate(throwOrigin(fpv));
  }

  // — Flight (both modes; never a same-frame spawn) —
  if (flight && !spawnedThisFrame && !flight.detonated) {
    flight = stepFlight(flight, dtc);
    if (flight.detonated) {
      detonate(flight.pos);
      flight = null;
    }
  }

  // — Hands —
  bobClock += dtc;
  const ref = handPhaseFromCook(fpv.cook, now);
  const useEntry = handEntry !== null && handEntryFrom !== null && ref.phase !== handEntryFrom
    ? handEntry : undefined;
  if (useEntry) { handEntry = null; handEntryFrom = null; }
  const handPose = poseAt(ref.phase, ref.phaseT, bobClock, useEntry);
  // Jiggle is skipped in god mode (hands hidden) but the state stays warm —
  // re-entering FPV resumes without a teleport.
  if (mode === 'fpv') {
    jiggle = stepHandJiggle(jiggle, handPoseTargets(buildHandPrims(), handPose), dtc);
  }

  if (kick && now - kick.start > KICK_TUNING.cutoffSec) kick = null;

  return {
    state: {
      mode, fpv, flight, jiggle, bobClock,
      handEntry, handEntryFrom, lastHandPhase: ref.phase, kick,
    },
    frame: {
      mode,
      eye: eyePos(fpv),
      yaw: fpv.yaw,
      pitch: fpv.pitch,
      kick: kickAngles(kick, now),
      charge: cookCharge(fpv, now),
      handPhase: ref,
      handPose,
      flight,
    },
  };
}

/**
 * Automation throw (`__sdfLab.throwDynamite(charge)`): releases a bundle at
 * `chargeFrac` from the persistent FPV aim WITHOUT the pointer/hold loop —
 * the cook machine jumps to cooldown, the hands play throw→recover from the
 * current pose (entry snapshot), and the flight spawns exactly as a release
 * would. Usable in god mode too (the bundle just spawns from the stored
 * aim). Returns the state with the bundle live.
 */
export function forceThrow(
  state: FpvModeState,
  chargeFrac: number,
  now: number,
): FpvModeState {
  const c = Math.max(0, Math.min(1, chargeFrac));
  const speed = throwSpeedMps(c);
  const d = throwDirection(state.fpv.yaw, state.fpv.pitch);
  const flight = makeFlight(
    throwOrigin(state.fpv),
    [d[0] * speed, d[1] * speed, d[2] * speed],
  );
  const prev = handPhaseFromCook(state.fpv.cook, now);
  return {
    ...state,
    flight,
    fpv: { ...state.fpv, cook: { phase: 'cooldown', phaseAt: now, cookStart: now } },
    handEntry: poseAt(prev.phase, prev.phaseT, state.bobClock),
    handEntryFrom: prev.phase,
  };
}

/** Re-exported so the wiring can build an input without importing fpv.ts
 *  separately (and so tests exercise the same empty-input constant). */
export { EMPTY_FPV_INPUT };
