// src/lab/sdf-zombie/gib-chunks.ts
import type { LimbId, Vec3 } from './types';

const GRAVITY = -9.8;
const RESTITUTION = 0.42;
const FLOOR_FRICTION = 0.72;
const AIR_DRAG = 0.006;
/** Squash decays back to zero at this rate per second. */
const SQUASH_RELAX = 5.5;

export interface Chunk {
  limb: LimbId;
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** 0 = round, 1 = fully flattened. Drives non-uniform scale in the shader. */
  squash: number;
  spin: number;
  angle: number;
}

export function makeChunk(limb: LimbId, pos: Vec3, vel: Vec3, radius: number): Chunk {
  // Spin proportional to horizontal speed, so fast chunks tumble harder.
  const spin = (vel[0] + vel[2]) * 1.4;
  return { limb, pos, vel, radius, squash: 0, spin, angle: 0 };
}

export function stepChunk(c: Chunk, dt: number): Chunk {
  let [x, y, z] = c.pos;
  let [vx, vy, vz] = c.vel;
  let { squash, spin, angle } = c;

  vy += GRAVITY * dt;
  const drag = 1 - AIR_DRAG;
  vx *= drag; vy *= drag; vz *= drag;

  x += vx * dt; y += vy * dt; z += vz * dt;
  angle += spin * dt;

  if (y < c.radius) {
    y = c.radius;
    if (vy < 0) {
      // Squash scales with impact speed — this is what sells wetness.
      squash = Math.min(1, squash + Math.min(Math.abs(vy) * 0.16, 0.9));
      vy = -vy * RESTITUTION;
      if (Math.abs(vy) < 0.35) vy = 0;
    }
    vx *= FLOOR_FRICTION; vz *= FLOOR_FRICTION;
    spin *= FLOOR_FRICTION;
    if (Math.abs(spin) < 0.05) spin = 0;
  }

  squash = Math.max(0, squash - SQUASH_RELAX * dt);

  const out: Chunk = { ...c, pos: [x, y, z], vel: [vx, vy, vz], squash, spin, angle };
  return finite(out) ? out : { ...c, vel: [0, 0, 0], spin: 0, squash: 0 };
}

function finite(c: Chunk): boolean {
  return [...c.pos, ...c.vel, c.squash, c.spin, c.angle]
    .every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
}
