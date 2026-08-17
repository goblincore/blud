// src/lab/sdf-zombie/fpv.ts
//
// Pure first-person controller for the SDF lab's FPV walk mode (spec §1):
// pointer-lock look (yaw/pitch from mouse deltas, pitch clamped), WASD ground
// movement on the arena plane at the game's 1.75 m eye height, arena-bounds
// clamping (bounds injected), plus the dynamite COOK state machine: idle →
// cooking (held; charge 0..1 over DYNAMITE_COOK.maxChargeSec) → thrown
// (release velocity mapped through the game's charge→velocity band exactly as
// weapons/dynamite.ts does) → cooldown. Cooking past max charge self-detonates
// in hand (spec §2 flourish hook): stepCook emits an 'overcook' SIGNAL and the
// wiring resolves the in-hand explosion + hand wounds — never this module.
//
// No rendering, no THREE, no Date.now/Math.random — `now` (the injected cook
// clock) and `dt` are parameters, so identical (state, input, dt, now, bounds)
// inputs produce bit-identical results. Game constants come from DYNAMITE_COOK
// + BALLISTIC_BOUNDS (src/game/gibs/tuning.ts); the few values the game keeps
// private (eye height, walk speed, mouse sensitivity, pitch clamp, throw hand
// offset) are named constants here, each citing its source.
//
// Conventions (documented once, used everywhere in this module):
//   - yaw: radians; 0 = facing -Z; positive = clockwise seen from above (y up).
//     Mouse right (dx > 0) increases yaw — the same WORLD behavior as the game's
//     pointer-look (main.ts MOUSE_SENS_BANGLE), with the sign normalized so
//     "look right" turns toward +X. Forward = (sin yaw, 0, -cos yaw).
//   - pitch: radians; positive = up; mouse down (dy > 0) decreases pitch.
//     Clamped to ±FPV_TUNING.pitchClampRad (the game's PITCH_LIMIT_BANGLE).
//   - pos: the player's FEET on the ground plane, y always 0; the eye/camera
//     sits +eyeHeightM above (see eyePos). Matches the sim's feet-based player
//     (sim/player.ts y = feet; floor = 0).
import type { Vec3 } from './types';
import { BALLISTIC_BOUNDS, DYNAMITE_COOK } from '../../game/gibs/tuning';

const TAU = Math.PI * 2;

/** Arena rectangle on the ground plane (bounds are injected — see stepFpv). */
export interface FpvBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type CookPhase = 'idle' | 'cooking' | 'cooldown';

export interface CookState {
  phase: CookPhase;
  /** Cook-clock seconds when the current phase began. */
  phaseAt: number;
  /** Cook-clock seconds when the current cook began (meaningful while cooking). */
  cookStart: number;
}

export interface FpvState {
  /** Feet position on the arena plane — [x, 0, z], y always 0. */
  pos: Vec3;
  /** Yaw in radians — see header. */
  yaw: number;
  /** Pitch in radians (positive = up), clamped to ±FPV_TUNING.pitchClampRad. */
  pitch: number;
  /** The dynamite cook state machine. */
  cook: CookState;
}

export interface FpvInput {
  /** Mouse delta x in counts; right = positive. */
  dx: number;
  /** Mouse delta y in counts; down = positive. */
  dy: number;
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  /** Left mouse pressed — starts cooking (from idle). */
  press: boolean;
  /** Left mouse released — throws (while cooking). */
  release: boolean;
}

export const EMPTY_FPV_INPUT: FpvInput = {
  dx: 0, dy: 0, forward: false, back: false, left: false, right: false,
  press: false, release: false,
};

/** One-shot events the controller EMITS for the wiring to resolve — this module
 *  never resolves them itself (the overcook in-hand explosion + hand wounds are
 *  the spec §2 flourish, owned by the wiring). */
export type CookSignal =
  | { kind: 'throw'; chargeFrac: number; speedMps: number }
  | { kind: 'overcook' };

export const FPV_TUNING = {
  /** Eye height above the feet (m). The game keeps this private
   *  (src/sim/render.ts EYE_HEIGHT_M = 1.75); the lab mirrors it as a constant. */
  eyeHeightM: 1.75,
  /** Walk speed (m/s) — sim/player.ts WALK = metersPerSecToFp(6). */
  walkSpeedMps: 6.0,
  /** Pointer-look sensitivity (rad per mouse count) — main.ts MOUSE_SENS_BANGLE. */
  mouseSensRadPerCount: 0.0022,
  /** Pitch clamp (±rad) — main.ts PITCH_LIMIT_BANGLE = π/2 − 0.05. */
  pitchClampRad: Math.PI / 2 - 0.05,
  /** Post-throw lockout (s) before the next cook can start — the game's throwing
   *  anim (dynamite.ts PHASE_DURATIONS.throwingMs = 336 ms) as a feel value. */
  throwRecoverSec: 0.4,
  /** Camera-space throw origin offset (m), mirroring main.ts DYN_THROW_*: the
   *  bundle leaves the lower-right of the view and arcs toward center. */
  handOffsetM: { lateral: 0.35, vertical: -0.5, forward: 0.4 },
} as const;

export function makeFpv(pos: Vec3 = [0, 0, 0], yaw = 0, pitch = 0): FpvState {
  return { pos, yaw, pitch, cook: { phase: 'idle', phaseAt: 0, cookStart: 0 } };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wraps an angle to (-π, π]. */
export function wrapPi(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  if (r > Math.PI) r -= TAU;
  return r;
}

/** Pure look update: applies a mouse delta to yaw/pitch with the game's clamp. */
export function lookFromDelta(
  yaw: number, pitch: number, dx: number, dy: number,
): { yaw: number; pitch: number } {
  const c = FPV_TUNING.pitchClampRad;
  return {
    yaw: wrapPi(yaw + dx * FPV_TUNING.mouseSensRadPerCount),
    pitch: clamp(pitch - dy * FPV_TUNING.mouseSensRadPerCount, -c, c),
  };
}

/** Eye position (m): feet + eyeHeightM on Y. */
export function eyePos(state: FpvState): Vec3 {
  return [state.pos[0], FPV_TUNING.eyeHeightM, state.pos[2]];
}

/** Camera-space unit axes for the FPV look. `forward` includes the pitch — this
 *  is the LOOK basis (main.ts's camera basis), NOT the lobbed throw direction:
 *  the throw's upward lob applies only to the launch vector (throwDirection). */
function lookBasis(yaw: number, pitch: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const cosP = Math.cos(pitch);
  const forward: Vec3 = [Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP];
  const right: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
  // up = right × forward (right-handed camera basis; at yaw/pitch 0 → +Y).
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up };
}

/** Throw origin (m): eye + camera-space hand offset — the bundle leaves the
 *  hands (mirrors muzzleWorldPosition in src/game/weapons/muzzle-pos.ts). */
export function throwOrigin(state: FpvState): Vec3 {
  const eye = eyePos(state);
  const { forward, right, up } = lookBasis(state.yaw, state.pitch);
  const o = FPV_TUNING.handOffsetM;
  return [
    eye[0] + right[0] * o.lateral + up[0] * o.vertical + forward[0] * o.forward,
    eye[1] + right[1] * o.lateral + up[1] * o.vertical + forward[1] * o.forward,
    eye[2] + right[2] * o.lateral + up[2] * o.vertical + forward[2] * o.forward,
  ];
}

// ——— Charge → velocity: the game's mapping, by its constants ————————————————
// weapons/dynamite.ts: chargeFraction(heldSec) clamps to [0,1] over
// DYNAMITE_COOK.maxChargeSec; throwVelocityMps lerps min→max across the band.
// Re-derived here FROM THE CONSTANTS (dynamite.ts itself imports THREE, so the
// pure lab mirrors the behavior instead of the module).

/** Cook charge 0..1 — clamp over DYNAMITE_COOK.maxChargeSec (mirrors dynamite.ts). */
export function chargeFraction(heldSec: number): number {
  return clamp(heldSec / DYNAMITE_COOK.maxChargeSec, 0, 1);
}

/** Throw speed (m/s) from a charge fraction — lerp across the game's
 *  minVelocityMps → maxVelocityMps band (mirrors dynamite.ts throwVelocityMps). */
export function throwSpeedMps(chargeFrac: number): number {
  const c = clamp(chargeFrac, 0, 1);
  return DYNAMITE_COOK.minVelocityMps
       + c * (DYNAMITE_COOK.maxVelocityMps - DYNAMITE_COOK.minVelocityMps);
}

/** Unit launch direction: aim yaw/pitch + the game's upward lob
 *  (DYNAMITE_COOK.pitchLobDeg) — the radians mirror of sim throwVelocity(). */
export function throwDirection(yaw: number, pitch: number): Vec3 {
  const eff = pitch + (DYNAMITE_COOK.pitchLobDeg * Math.PI) / 180;
  const h = Math.cos(eff);
  return [Math.sin(yaw) * h, Math.sin(eff), -Math.cos(yaw) * h];
}

/** Full release velocity at `now`: throwDirection × throwSpeedMps(charge) —
 *  the exact mapping weapons/dynamite.ts's doThrow performs, as a vector. */
export function releaseVelocity(state: FpvState, now: number): Vec3 {
  const speed = throwSpeedMps(chargeFraction(now - state.cook.cookStart));
  const d = throwDirection(state.yaw, state.pitch);
  return [d[0] * speed, d[1] * speed, d[2] * speed];
}

/** Cook charge 0..1 at `now` (0 unless cooking) — drives the HUD charge bar. */
export function cookCharge(state: FpvState, now: number): number {
  if (state.cook.phase !== 'cooking') return 0;
  return chargeFraction(now - state.cook.cookStart);
}

/**
 * The COOK state machine, one step.
 *
 *   idle ──press──► cooking ──release──► cooldown ──recover──► idle
 *                      │
 *                      └── held ≥ DYNAMITE_COOK.fuseMaxSec ──► idle + 'overcook'
 *
 * The released 'throw' signal carries the charge fraction and the speed mapped
 * through the game's band (throwSpeedMps); the wiring composes the direction
 * (throwDirection/releaseVelocity) and hands the flight to dynamite-flight.ts.
 * Pure and deterministic in (state, input, now).
 */
export function stepCook(
  cook: CookState,
  input: Pick<FpvInput, 'press' | 'release'>,
  now: number,
): { state: CookState; signal: CookSignal | null } {
  switch (cook.phase) {
    case 'idle':
      if (input.press) {
        return { state: { phase: 'cooking', phaseAt: now, cookStart: now }, signal: null };
      }
      return { state: cook, signal: null };

    case 'cooking': {
      // Overcook wins over a same-step release — mirrors dynamite.ts, where
      // onFrame's in-hand explosion (→ idle) fires before onRelease can throw.
      if (now - cook.cookStart >= DYNAMITE_COOK.fuseMaxSec) {
        return { state: { phase: 'idle', phaseAt: now, cookStart: now }, signal: { kind: 'overcook' } };
      }
      if (input.release) {
        const chargeFrac = chargeFraction(now - cook.cookStart);
        return {
          state: { phase: 'cooldown', phaseAt: now, cookStart: now },
          signal: { kind: 'throw', chargeFrac, speedMps: throwSpeedMps(chargeFrac) },
        };
      }
      return { state: cook, signal: null };
    }

    case 'cooldown': {
      if (now - cook.phaseAt < FPV_TUNING.throwRecoverSec) {
        return { state: cook, signal: null };
      }
      // Recover over — a press at this exact moment starts the next cook
      // (the game's onFrame → idle transition also precedes the next press).
      if (input.press) {
        return { state: { phase: 'cooking', phaseAt: now, cookStart: now }, signal: null };
      }
      return { state: { phase: 'idle', phaseAt: now, cookStart: now }, signal: null };
    }
  }
}

/**
 * One FPV frame: look (mouse deltas), WASD movement on the arena plane clamped
 * to `bounds` (injected; defaults to the game's BALLISTIC_BOUNDS), and the cook
 * machine. `now` is the cook clock in seconds (monotonically increasing,
 * injected), `dt` the frame time for movement. Returns the next state plus any
 * one-shot signal (throw/overcook) for the wiring to resolve.
 */
export function stepFpv(
  state: FpvState,
  input: FpvInput,
  dt: number,
  now: number,
  bounds: FpvBounds = BALLISTIC_BOUNDS,
): { state: FpvState; signal: CookSignal | null } {
  const dtc = clamp(dt, 0, 0.25);

  // — Look: yaw/pitch from mouse deltas (pitch clamped) —
  const { yaw, pitch } = lookFromDelta(state.yaw, state.pitch, input.dx, input.dy);

  // — WASD on the arena plane —
  const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let lx = strafe;
  let lz = -fwd; // local: +X right, -Z forward (player-motion.ts convention)
  if (lx !== 0 && lz !== 0) {
    const inv = 1 / Math.hypot(lx, lz);
    lx *= inv;
    lz *= inv;
  }
  // world = right·lx + forward·lz, with right=(cos yaw,0,sin yaw),
  // forward=(sin yaw,0,-cos yaw): look right (yaw π/2) → walk +X.
  const wx = Math.cos(yaw) * lx - Math.sin(yaw) * lz;
  const wz = Math.sin(yaw) * lx + Math.cos(yaw) * lz;
  const b = {
    minX: Math.min(bounds.minX, bounds.maxX),
    maxX: Math.max(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  };
  const pos: Vec3 = [
    clamp(state.pos[0] + wx * FPV_TUNING.walkSpeedMps * dtc, b.minX, b.maxX),
    0,
    clamp(state.pos[2] + wz * FPV_TUNING.walkSpeedMps * dtc, b.minZ, b.maxZ),
  ];

  // — Cook —
  const { state: cook, signal } = stepCook(state.cook, input, now);

  return { state: { pos, yaw, pitch, cook }, signal };
}
