// src/lab/sdf-zombie/dynamite-flight.ts
//
// Pure ballistic integrator for a thrown dynamite bundle (spec §3): gravity,
// floor bounce and wall bounce with Blood's elastic feel, fuse countdown
// (impact + timer rules per the game), and a spin state for the cheap mesh
// prop. Mirrors the sim kThing mover (src/sim/thing.ts) and the sim projectile
// fuse rules (src/sim/projectile.ts) WITHOUT importing them — the sim modules
// own SimState, which the lab doesn't have. All game numbers arrive as data:
// DYNAMITE_COOK + BALLISTIC_BOUNDS from src/game/gibs/tuning.ts; gravity /
// elastic / rest-speed from the kThing mover's documented comments (cited
// below, not imported); the light airdrag from tuning.ts's source-sim note
// (actAirDrag a2=128 ≈ 0.2%/tic) — the source sim that produced the ~68 m
// full-charge reach (which tuned the 6→28 m/s band) included that drag, so
// reproducing the reach requires it.
//
// stepFlight(state, dt) is a pure (state, dt) → state function; detonation is
// NOT resolved here — the wiring polls detonated(state) and runs the gore
// stack. Deterministic: no Date.now, no Math.random, fixed 120 Hz sub-steps
// (the sim's own tic rate), so identical inputs yield identical trajectories.
import type { Vec3 } from './types';
import { BALLISTIC_BOUNDS, DYNAMITE_COOK } from '../../game/gibs/tuning';

/** Arena rectangle on the ground plane (injected; defaults to BALLISTIC_BOUNDS). */
export interface FlightBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FlightState {
  /** Bundle center, meters; the floor is at y = 0. */
  pos: Vec3;
  /** Velocity, m/s. */
  vel: Vec3;
  /** Seconds of fuse remaining before timer detonation. */
  fuse: number;
  /** Seconds since spawn (drives the impact grace window). */
  age: number;
  /** Spawn origin (drives the impact safe-distance rule). */
  spawn: Vec3;
  /** Prop roll angle, radians (visual only — the cheap mesh bundle). */
  spin: number;
  /** Detonate on geometry contact (after grace + safe distance), per the game. */
  impactMode: boolean;
  /** Vertical settled on the floor; horizontal keeps sliding (kThing behavior). */
  resting: boolean;
  /** Fuse out or qualifying impact — stop integrating; the wiring resolves. */
  detonated: boolean;
}

export const FLIGHT_TUNING = {
  /** Gravity (m/s²) — src/sim/thing.ts THING_GRAVITY_DV comment: "matches the
   *  Rapier world gravity from src/physics/world.ts: y=-25 → magnitude 25 m/s²". */
  gravityMps2: 25,
  /** Floor/wall restitution — src/sim/thing.ts DEFAULT_ELASTIC = 24576 in 16.16
   *  = 0.375: "Blood thingInfo elastic for TNT (0.375 in 16.16)". */
  elastic: 0.375,
  /** Below this |vy| on floor contact the bundle rests (keeps sliding
   *  horizontally — src/sim/thing.ts REST_VY = metersPerSecToFp(0.5)). */
  restSpeedMps: 0.5,
  /** Light airdrag (/s) — tuning.ts source-sim note: "actAirDrag a2=128
   *  ≈ 0.2%/tic" → 128/65536 per tic × 120 tics/s = 0.234375/s. Exponential
   *  decay applied per sub-step. Reproduces the source-simulated ~68 m
   *  full-charge reach that tuned the velocity band. */
  airdragPerSec: 0.234375,
  /** Impact grace (s) before geometry contact counts — src/sim/projectile.ts
   *  THROW.impactGraceTics = round(0.05 · 120). */
  impactGraceSec: 0.05,
  /** Impact safe distance (m) from spawn — src/sim/projectile.ts
   *  IMPACT_SAFE_DIST_SQ_FP = (0.7 m)²: contact closer than this never
   *  detonates (protects the spawn-in-hand contact). */
  impactSafeDistM: 0.7,
  /** Integrator sub-step (s) — the sim's fixed 120 tic/s (src/sim/units.ts
   *  TICS_PER_SEC = 120). Bounces and impact checks happen per sub-step,
   *  exactly like the game's per-tic mover. */
  subStepSec: 1 / 120,
  /** Prop tumble rate (rad/s) while airborne. Blood's bundle does NOT tumble
   *  (ang set once at spawn, never updated — dynamite.ts header) — this is a
   *  LAB-PROP feel value for the cheap cylinder-bundle mesh. */
  spinRateRadPerSec: 12,
} as const;

/**
 * Spawn a thrown bundle. Defaults mirror the game's wiring (main.ts):
 * impact-mode throws carry the in-flight safety fuse
 * (DYNAMITE_COOK.impactSafetyFuseSec), fuse-only carries DYNAMITE_COOK.fuseMaxSec.
 */
export function makeFlight(
  pos: Vec3,
  vel: Vec3,
  opts: { impactMode?: boolean; fuseSec?: number } = {},
): FlightState {
  const impactMode = opts.impactMode ?? true;
  const fuse = opts.fuseSec
    ?? (impactMode ? DYNAMITE_COOK.impactSafetyFuseSec : DYNAMITE_COOK.fuseMaxSec);
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [vel[0], vel[1], vel[2]],
    fuse,
    age: 0,
    spawn: [pos[0], pos[1], pos[2]],
    spin: 0,
    impactMode,
    resting: false,
    detonated: false,
  };
}

/** True once the fuse is out or a qualifying impact occurred — the wiring
 *  resolves the explosion, this module only reports it. */
export function detonated(state: FlightState): boolean {
  return state.detonated;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One 120 Hz sub-step (the game's tic): gravity + integrate, airdrag, floor /
 *  wall bounce with elastic damping, then the detonation checks in the sim's
 *  order (fuse first, then qualifying impact). */
function stepSub(s: FlightState, sub: number, b: FlightBounds): FlightState {
  const T = FLIGHT_TUNING;
  const pos: [number, number, number] = [...s.pos];
  const vel: [number, number, number] = [...s.vel];

  // Fuse + age first — mirrors stepProjectiles (fuseTics -= 1 before the mover).
  const fuse = s.fuse - sub;
  const age = s.age + sub;

  // Gravity + integrate (semi-implicit Euler, vy-first — mirrors stepThing).
  vel[1] -= T.gravityMps2 * sub;
  pos[0] += vel[0] * sub;
  pos[1] += vel[1] * sub;
  pos[2] += vel[2] * sub;

  // Airdrag — exponential per sub-step.
  const drag = Math.exp(-T.airdragPerSec * sub);
  vel[0] *= drag;
  vel[1] *= drag;
  vel[2] *= drag;

  // — Floor (y = 0): reflect + dampen, or rest once the bounce is weak.
  //   resting zeroes the VERTICAL only; horizontal keeps sliding (stepThing). —
  let hit = false;
  let resting = s.resting;
  if (pos[1] <= 0) {
    pos[1] = 0;
    hit = true;
    if (vel[1] < 0) {
      const up = -vel[1] * T.elastic;
      if (up <= T.restSpeedMps) {
        vel[1] = 0;
        resting = true;
      } else {
        vel[1] = up;
        resting = false;
      }
    }
  } else {
    resting = false;
  }

  // — Walls: bounce planes = BALLISTIC_BOUNDS (the game's arena-inset
  //   constant; the bundle's 0.08 m radius is subsumed by the inset). —
  if (pos[0] < b.minX) { pos[0] = b.minX; vel[0] = -vel[0] * T.elastic; hit = true; }
  if (pos[0] > b.maxX) { pos[0] = b.maxX; vel[0] = -vel[0] * T.elastic; hit = true; }
  if (pos[2] < b.minZ) { pos[2] = b.minZ; vel[2] = -vel[2] * T.elastic; hit = true; }
  if (pos[2] > b.maxZ) { pos[2] = b.maxZ; vel[2] = -vel[2] * T.elastic; hit = true; }

  // — Detonation, in the sim's order (stepProjectiles): fuse out wins; else a
  //   qualifying impact — past the grace window AND ≥ safe distance from
  //   spawn. Contact within the safe distance (e.g. thrown at your own feet)
  //   bounces harmlessly instead of detonating. —
  let det = s.detonated;
  if (fuse <= 0) {
    det = true;
  } else if (s.impactMode && age >= T.impactGraceSec && hit) {
    const dx = pos[0] - s.spawn[0];
    const dy = pos[1] - s.spawn[1];
    const dz = pos[2] - s.spawn[2];
    if (dx * dx + dy * dy + dz * dz >= T.impactSafeDistM * T.impactSafeDistM) det = true;
  }

  // Prop spin: lazy tumble while airborne; freezes at rest / on detonation.
  const spin = det || resting ? s.spin : s.spin + T.spinRateRadPerSec * sub;

  return {
    pos, vel, fuse, age, spawn: s.spawn, spin,
    impactMode: s.impactMode, resting, detonated: det,
  };
}

/**
 * Advance the flight by `dt` seconds (clamped to 0..0.25), consuming it in
 * 120 Hz sub-steps so bounces and impact checks land on the game's tic grid.
 * Pure and deterministic: same (state, dt, bounds) → same next state. Once
 * `detonated` is true the state stops changing.
 */
export function stepFlight(
  state: FlightState,
  dt: number,
  bounds: FlightBounds = BALLISTIC_BOUNDS,
): FlightState {
  const dtc = clamp(dt, 0, 0.25);
  const b = {
    minX: Math.min(bounds.minX, bounds.maxX),
    maxX: Math.max(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  };
  const sub = FLIGHT_TUNING.subStepSec;
  let out = state;
  let remaining = dtc;
  while (remaining > 1e-9 && !out.detonated) {
    const step = Math.min(remaining, sub);
    remaining -= step;
    out = stepSub(out, step, b);
  }
  return out;
}
