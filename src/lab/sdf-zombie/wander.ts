// src/lab/sdf-zombie/wander.ts
//
// Pure arena-locomotion controller: picks random points inside injected
// bounds, shambles between them with heavy-damped (rate-limited) turns, and
// pauses idle beats after each arrival. No Date.now, no Math.random — the RNG
// is injected (makeRng), so identical (state, rng, dt, bounds) inputs produce
// identical trajectories.
//
// Heading convention: radians, 0 = facing +z, positive = clockwise seen from
// above (y up). headingDir(heading) is the world-space forward vector, which
// matches the body authoring (body.ts faces +z) and rotateYaw in gait.ts.
import type { Vec3 } from './types';

const TAU = Math.PI * 2;

/** Arena rectangle on the ground plane. */
export interface WanderBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The wander controller's moving state. */
export interface WanderState {
  /** Body position on the ground plane — [x, 0, z]. */
  pos: Vec3;
  /** Facing (yaw) in radians — see headingDir. */
  heading: number;
  /** Current forward speed in m/s (0 while idle). */
  speed: number;
  /** Current target point, or null before the first pick / after idle. */
  target: Vec3 | null;
  /** Seconds of idle pause remaining (0 = moving). */
  idle: number;
}

/** A unit-interval random source. Create one with makeRng(seed). */
export type Rng = () => number;

/** All wander knobs in one place. */
export const WANDER_TUNING = {
  /** Cruise speed (m/s). */
  speed: 1.15,
  /** Speed change rate (m/s²) — no instant starts or stops. */
  accel: 2.2,
  /** Max heading change (rad/s) — the heavy-damped turn. */
  turnRate: 1.7,
  /** Idle pause after an arrival, in seconds [min, max]. */
  idleMin: 0.8,
  idleMax: 2.4,
  /** Distance at which an arrival counts (m). */
  arriveRadius: 0.4,
  /** Distance over which the body brakes to a stop (m). */
  brakeDist: 1.2,
  /** Targets and the body stay this far inside the injected bounds (m). */
  margin: 0.5,
} as const;

/** Deterministic mulberry32 PRNG — the seeded RNG to inject into stepWander. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** World-space forward vector for a heading — [sin h, 0, cos h]. */
export function headingDir(heading: number): Vec3 {
  return [Math.sin(heading), 0, Math.cos(heading)];
}

/** Wraps an angle to (-π, π]. */
export function wrapPi(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  if (r > Math.PI) r -= TAU;
  return r;
}

function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  return v + (d > maxDelta ? maxDelta : d < -maxDelta ? -maxDelta : d);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A random point inside `bounds`, kept `margin` away from the edges. */
function pickTarget(rng: Rng, b: WanderBounds, from: Vec3): Vec3 {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const margin = Math.min(WANDER_TUNING.margin, Math.min(w, d) / 2 - 1e-3);
  if (w <= 0 || d <= 0 || margin < 0) return from;
  return [b.minX + margin + rng() * (w - 2 * margin), 0, b.minZ + margin + rng() * (d - 2 * margin)];
}

/**
 * One wander step: advances the controller toward its current target, or
 * picks a new one after the idle pause ends. Pure and deterministic — same
 * (state, rng, dt, bounds) always yields the same next state.
 *
 * Wiring (task 4): feed this the lab's wander state + a makeRng(seed) source
 * each frame, then rotate gait offsets into world space by state.heading
 * (rotateYaw) and move the body root by state.pos.
 */
export function stepWander(
  state: WanderState,
  rng: Rng,
  dt: number,
  bounds: WanderBounds,
  /** Cruise speed (m/s). Defaults to WANDER_TUNING.speed — the zombie. */
  cruiseSpeed: number = WANDER_TUNING.speed,
): WanderState {
  const dtc = Math.min(Math.max(dt, 0), 0.25);
  const T = WANDER_TUNING;
  // Normalise the rect so reversed bounds can't break the clamps.
  const b: WanderBounds = {
    minX: Math.min(bounds.minX, bounds.maxX),
    maxX: Math.max(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  };

  let { pos, heading, speed, target, idle } = state;
  const accel = T.accel * dtc;

  if (idle > 0) {
    idle = Math.max(0, idle - dtc);
    speed = approach(speed, 0, accel);
    if (idle > 0) return { pos, heading, speed, target, idle };
    target = null; // pause over — the next leg starts fresh
  }

  if (!target) target = pickTarget(rng, b, pos);

  const dx = target[0] - pos[0];
  const dz = target[2] - pos[2];
  const dist = Math.hypot(dx, dz);

  if (dist < T.arriveRadius) {
    return {
      pos,
      heading,
      speed: approach(speed, 0, accel),
      target,
      idle: T.idleMin + rng() * (T.idleMax - T.idleMin),
    };
  }

  // Heavy-damped turn: the heading is rate-limited, never instant.
  const desired = Math.atan2(dx, dz);
  const maxTurn = T.turnRate * dtc;
  heading = wrapPi(heading + clamp(wrapPi(desired - heading), -maxTurn, maxTurn));

  // Speed: accelerate toward cruise, brake as the target nears.
  const cruise = cruiseSpeed * Math.min(1, dist / T.brakeDist);
  speed = approach(speed, cruise, accel);

  const dir = headingDir(heading);
  pos = [
    clamp(pos[0] + dir[0] * speed * dtc, b.minX, b.maxX),
    0,
    clamp(pos[2] + dir[2] * speed * dtc, b.minZ, b.maxZ),
  ];

  return { pos, heading, speed, target, idle };
}
