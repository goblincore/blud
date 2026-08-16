// src/lab/sdf-zombie/gib-chunks.ts
//
// Hand-rolled deterministic chunk physics. Deliberately NOT Rapier: the game's
// cosmetic ChunkSystem uses Rapier, but the lab wants a stepper whose every
// constant is a knob and whose output is pure state-in/state-out. The game's
// playtested Rapier values are the tuning TARGETS here (restitution 0.55,
// tumble +/-9 rad/s per axis), not a dependency.
import type { LimbId, Vec3 } from './types';
import {
  add, cross, dot, len, normalize, scale,
  qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat,
} from './vec';

const GRAVITY = -9.8;
/** Game ChunkSystem capsule restitution (chunks skip off floors). */
const RESTITUTION = 0.55;
/** Horizontal + angular velocity multiplier while in floor contact. */
const FLOOR_FRICTION = 0.72;
const AIR_DRAG = 0.006;
/** Squash decays back to zero at this rate per second. */
const SQUASH_RELAX = 5.5;
/** Spawn tumble amplitude: (rng-0.5)*2*TUMBLE = +/-9 rad/s, the game's angvel. */
const TUMBLE = 9;
/** Below this speed a grounded chunk starts easing flat. */
const TOPPLE_SPEED = 0.6;
/** Radians/sec the long axis eases toward horizontal (~90deg in 0.4s). */
const TOPPLE_RATE = 4.0;

export interface Chunk {
  limb: LimbId;
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** 0 = round, 1 = fully flattened. Drives non-uniform scale in the shader. */
  squash: number;
  /** Orientation, unit quaternion [x,y,z,w]. */
  quat: Quat;
  /** Angular velocity, rad/s about each world axis. */
  angVel: Vec3;
  /** Chunk-LOCAL long axis (unit). The topple aligns this with the floor. */
  longAxis: Vec3;
}

export function makeChunk(
  limb: LimbId, pos: Vec3, vel: Vec3, radius: number,
  longAxis: Vec3, rng: () => number = Math.random,
): Chunk {
  // Tumble proportional-ish to being launched at all; flat amplitude matches
  // the game ChunkSystem's setAngvel((rand-0.5)*18) = +/-9 rad/s.
  const angVel: Vec3 = [
    (rng() - 0.5) * 2 * TUMBLE,
    (rng() - 0.5) * 2 * TUMBLE,
    (rng() - 0.5) * 2 * TUMBLE,
  ];
  return {
    limb, pos, vel, radius, squash: 0,
    quat: qIdentity(), angVel, longAxis: normalize(longAxis),
  };
}

export function stepChunk(c: Chunk, dt: number): Chunk {
  let [x, y, z] = c.pos;
  let [vx, vy, vz] = c.vel;
  let { squash } = c;
  let quat = c.quat;
  let angVel = c.angVel;

  vy += GRAVITY * dt;
  const drag = 1 - AIR_DRAG;
  vx *= drag; vy *= drag; vz *= drag;

  x += vx * dt; y += vy * dt; z += vz * dt;

  // Integrate orientation from angular velocity.
  const w = len(angVel);
  if (w > 1e-6) {
    quat = qNormalize(qMul(qFromAxisAngle(scale(angVel, 1 / w), w * dt), quat));
  }

  let grounded = false;
  if (y < c.radius) {
    y = c.radius;
    grounded = true;
    if (vy < 0) {
      // Squash scales with impact speed — this is what sells wetness.
      squash = Math.min(1, squash + Math.min(Math.abs(vy) * 0.16, 0.9));
      vy = -vy * RESTITUTION;
      if (Math.abs(vy) < 0.35) vy = 0;
    }
    vx *= FLOOR_FRICTION; vz *= FLOOR_FRICTION;
    angVel = scale(angVel, FLOOR_FRICTION);
    if (len(angVel) < 0.05) angVel = [0, 0, 0];
  }

  // Topple: a grounded, slow chunk eases its long axis toward horizontal, so
  // limbs lie flat instead of standing on end. Handcrafted substitute for a
  // collision mesh; deterministic and tunable.
  const speed = Math.hypot(vx, vy, vz);
  if (grounded && speed < TOPPLE_SPEED) {
    const worldLong = qRotate(quat, c.longAxis);
    const horizLen = Math.hypot(worldLong[0], worldLong[2]);
    // A perfectly vertical axis has no horizontal shadow to fall toward — give
    // it a nudge direction deterministically from the quat's x component sign.
    const target: Vec3 = horizLen < 1e-3
      ? [quat[0] >= 0 ? 1 : -1, 0, 0]
      : normalize([worldLong[0], 0, worldLong[2]]);
    const cosA = Math.min(1, Math.max(-1, dot(worldLong, target)));
    const angle = Math.acos(cosA);
    if (angle > 0.01) {
      const rawAxis = cross(worldLong, target);
      const axis = len(rawAxis) < 1e-6 ? ([0, 0, 1] as Vec3) : normalize(rawAxis);
      const step = Math.min(angle, TOPPLE_RATE * dt);
      quat = qNormalize(qMul(qFromAxisAngle(axis, step), quat));
    }
  }

  squash = Math.max(0, squash - SQUASH_RELAX * dt);

  const out: Chunk = { ...c, pos: [x, y, z], vel: [vx, vy, vz], squash, quat, angVel };
  return finite(out) ? out : {
    ...c, vel: [0, 0, 0], angVel: [0, 0, 0], squash: 0,
  };
}

/** Squash factors: flatten y, bulge xz — applied in WORLD axes after rotation. */
export function squashFactors(c: Chunk): { sx: number; sy: number; sz: number } {
  const s = Math.min(1, Math.max(0, c.squash));
  return { sx: 1 + s * 0.35, sy: 1 - s * 0.5, sz: 1 + s * 0.35 };
}

/**
 * World position of a chunk-local point: rotate by the chunk quat, squash in
 * world axes, translate to the chunk. THE one transform both renderer paths'
 * apply() must use — hand-rolling it twice is how the paths drift.
 */
export function chunkPoint(
  c: Chunk, local: Vec3, sx: number, sy: number, sz: number,
): Vec3 {
  const r = qRotate(c.quat, local);
  return [c.pos[0] + r[0] * sx, c.pos[1] + r[1] * sy, c.pos[2] + r[2] * sz];
}

function finite(c: Chunk): boolean {
  return [...c.pos, ...c.vel, ...c.angVel, ...c.quat, c.squash]
    .every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
}
