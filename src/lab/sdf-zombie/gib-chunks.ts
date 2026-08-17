// src/lab/sdf-zombie/gib-chunks.ts
//
// Hand-rolled deterministic chunk physics. Deliberately NOT Rapier: the game's
// cosmetic ChunkSystem uses Rapier, but the lab wants a stepper whose every
// constant is a knob and whose output is pure state-in/state-out. The game's
// playtested Rapier values are the tuning TARGETS here (restitution 0.55),
// not a dependency.
//
// Motion-polish pass (severed-limb helicopter fix): limbs and gobs tumble
// differently. A severed arm launched with the game's ±9 rad/s angvel reads
// as a spinning helicopter seed; limbs now spawn with a slower tumble and
// ALL chunks bleed angular velocity in the air, so the tumble decays instead
// of spinning at full rate until the floor kills it. Gobs keep the chaotic
// spawn. Launch speeds and gravity are untouched — the arcs are game-hot and
// authoritative; only the spin was tuned.
import type { LimbId, Vec3 } from './types';
import {
  add, cross, dot, len, normalize, scale,
  qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat,
} from './vec';

/** All chunk-stepper constants in one place. */
export const CHUNK_TUNING = {
  gravity: -9.8,
  /** Game ChunkSystem capsule restitution (chunks skip off floors). */
  restitution: 0.55,
  /** Horizontal + angular velocity multiplier while in floor contact. */
  floorFriction: 0.72,
  airDrag: 0.006,
  /** Squash decays back to zero at this rate per second. */
  squashRelax: 5.5,
  /** LIMB spawn tumble amplitude (rad/s): (rng-0.5)*2*limbTumble. Lower than
   *  the gobs' — a tumbling forearm reads heavy, not helicopter. */
  limbTumble: 4.2,
  /** GOB spawn tumble amplitude (rad/s) — the game's setAngvel((rand-0.5)*18)
   *  = ±9, kept chaotic for the amorphous hunks. */
  gobTumble: 9,
  /** Airborne angular-velocity decay (1/s) — the tumble bleeds off in flight
   *  instead of spinning at spawn rate until the floor stops it. */
  angularAirDamp: 1.9,
  /** Extra grounded spin kill per contact frame, multiplied with
   *  floorFriction for angVel only — a sliding chunk stops rolling fast. */
  angularFloorDamp: 0.55,
  /** Below this speed a grounded chunk starts easing flat. */
  toppleSpeed: 0.6,
  /** Radians/sec the long axis eases toward horizontal (~90deg in 0.4s). */
  toppleRate: 4.0,
} as const;

/** What the chunk IS — limbs tumble heavy, gobs chaotic (CHUNK_TUNING). */
export type ChunkKind = 'limb' | 'gob';

const GRAVITY = CHUNK_TUNING.gravity;
const RESTITUTION = CHUNK_TUNING.restitution;
const FLOOR_FRICTION = CHUNK_TUNING.floorFriction;
const AIR_DRAG = CHUNK_TUNING.airDrag;
const SQUASH_RELAX = CHUNK_TUNING.squashRelax;
const TOPPLE_SPEED = CHUNK_TUNING.toppleSpeed;
const TOPPLE_RATE = CHUNK_TUNING.toppleRate;

export interface Chunk {
  limb: LimbId;
  /** limb | gob — picks the spawn tumble amplitude (CHUNK_TUNING). */
  kind: ChunkKind;
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
  kind: ChunkKind = 'limb',
): Chunk {
  // Tumble proportional-ish to being launched at all. Limbs tumble slower
  // than the game's ±9 rad/s (helicopter fix); gobs keep the chaotic spawn.
  const tumble = kind === 'gob' ? CHUNK_TUNING.gobTumble : CHUNK_TUNING.limbTumble;
  const angVel: Vec3 = [
    (rng() - 0.5) * 2 * tumble,
    (rng() - 0.5) * 2 * tumble,
    (rng() - 0.5) * 2 * tumble,
  ];
  return {
    limb, kind, pos, vel, radius, squash: 0,
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

  // Airborne angular damping: the tumble DECAYS in flight (helicopter fix).
  angVel = scale(angVel, Math.max(0, 1 - CHUNK_TUNING.angularAirDamp * dt));

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
    angVel = scale(angVel, FLOOR_FRICTION * CHUNK_TUNING.angularFloorDamp);
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
