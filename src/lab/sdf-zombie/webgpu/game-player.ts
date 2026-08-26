// src/lab/sdf-zombie/webgpu/game-player.ts
//
// First-person player for sdf-game.html: pointer-look state, WASD intent,
// gravity, and CAPSULE-vs-AABB collision against the level's collider list.
// Pure — no three, no DOM — so the resolution is unit-testable against
// hand-worked cases. No Rapier: that belongs to the pre-SDF stack.
//
// The capsule is a vertical segment (feet+R .. top-R) with radius R. Against
// each AABB we take the closest point between the segment and the box by
// alternating projection (clamp to box <-> clamp to segment, a few rounds —
// both projections are exact and the pair converges fast for our shapes),
// then push out along the separating vector when it is shorter than R.
// A segment point INSIDE the box falls back to the box's min-penetration
// axis, which is the only degenerate case a vertical capsule in a box world
// can hit (spawned overlapping, or a dt so large it tunneled).

import type { Vec3 } from '../types';
import type { Aabb } from './game-level';

/** Mutable triple — Vec3 is readonly; the capsule resolve pushes in place. */
export type Mut3 = [number, number, number];

export interface PlayerState {
  /** Feet position (ground contact point), world metres. */
  pos: Mut3;
  vel: Mut3;
  yaw: number;   // rad; forward = [sin yaw, 0, -cos yaw] (lab FPV convention)
  pitch: number; // rad, clamped
  grounded: boolean;
}

export const PLAYER = {
  radius: 0.32,
  height: 1.75,
  eye: 1.62,
  walkSpeed: 3.4,
  accel: 40,
  airAccel: 8,
  friction: 10,
  gravity: -18,
  jumpSpeed: 6.0,
  pitchLimit: 1.45,
} as const;

export interface MoveInput {
  /** -1..1 strafe (x) and forward (z) intent in VIEW space. */
  x: number;
  z: number;
  jump: boolean;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Closest point between the vertical segment [lo, hi] (x/z fixed) and the
 *  AABB, by alternating projection. Returns the segment point and box point. */
function closestSegAabb(
  sx: number, sz: number, yLo: number, yHi: number, b: Aabb,
): { seg: Mut3; onBox: Mut3 } {
  // Start from the box's closest point to the segment midpoint.
  let q: Mut3 = [sx, clamp((yLo + yHi) / 2, b.min[1], b.max[1]), sz];
  let c: Mut3 = [
    clamp(q[0], b.min[0], b.max[0]),
    clamp(q[1], b.min[1], b.max[1]),
    clamp(q[2], b.min[2], b.max[2]),
  ];
  for (let i = 0; i < 4; i++) {
    // Clamp c's y onto the segment (x/z are fixed — the segment is vertical).
    q = [sx, clamp(c[1], yLo, yHi), sz];
    c = [
      clamp(q[0], b.min[0], b.max[0]),
      clamp(q[1], b.min[1], b.max[1]),
      clamp(q[2], b.min[2], b.max[2]),
    ];
  }
  return { seg: q, onBox: c };
}

/**
 * Resolve a capsule against the collider set, in place on `pos`.
 * `pos` is the FEET position. Returns true when any push happened.
 */
export function resolveCapsule(pos: Mut3, colliders: readonly Aabb[]): boolean {
  const r = PLAYER.radius;
  let touched = false;
  // Two passes so a push out of one box into another still settles.
  for (let pass = 0; pass < 2; pass++) {
    for (const b of colliders) {
      // Cheap reject on the capsule's own AABB.
      if (pos[0] + r < b.min[0] || pos[0] - r > b.max[0]
        || pos[2] + r < b.min[2] || pos[2] - r > b.max[2]
        || pos[1] + PLAYER.height < b.min[1] || pos[1] > b.max[1]) continue;
      const yLo = pos[1] + r;
      const yHi = pos[1] + PLAYER.height - r;
      const { seg, onBox } = closestSegAabb(pos[0], pos[2], yLo, yHi, b);
      const d: Mut3 = [seg[0] - onBox[0], seg[1] - onBox[1], seg[2] - onBox[2]];
      const distSq = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (distSq >= r * r) continue;
      touched = true;
      if (distSq > 1e-12) {
        const dist = Math.sqrt(distSq);
        const push = (r - dist) / dist;
        pos[0] += d[0] * push;
        pos[1] += d[1] * push;
        pos[2] += d[2] * push;
      } else {
        // Segment point inside the box: min-penetration axis fallback.
        const pens: [number, Mut3][] = [
          [seg[0] - b.min[0] + r, [-1, 0, 0]],
          [b.max[0] - seg[0] + r, [1, 0, 0]],
          [seg[1] - b.min[1] + r, [0, -1, 0]],
          [b.max[1] - seg[1] + r, [0, 1, 0]],
          [seg[2] - b.min[2] + r, [0, 0, -1]],
          [b.max[2] - seg[2] + r, [0, 0, 1]],
        ];
        pens.sort((a, z) => a[0] - z[0]);
        const [amount, dir] = pens[0]!;
        pos[0] += dir[0] * amount;
        pos[1] += dir[1] * amount;
        pos[2] += dir[2] * amount;
      }
    }
  }
  return touched;
}

/**
 * One movement step: intent -> horizontal velocity (ground friction /
 * acceleration), gravity, integrate, collide with colliders and the y=0
 * floor. Mutates and returns `s`. dt is clamped like the lab's frame clamp.
 */
export function stepPlayer(
  s: PlayerState,
  input: MoveInput,
  dt: number,
  colliders: readonly Aabb[],
): PlayerState {
  const dtc = Math.min(Math.max(dt, 0), 1 / 30);

  // View-space intent -> world. Forward = [sin yaw, 0, -cos yaw];
  // right = [cos yaw, 0, sin yaw].
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  const wishX = sy * input.z + cy * input.x;
  const wishZ = -cy * input.z + sy * input.x;
  const wishLen = Math.hypot(wishX, wishZ);
  const nx = wishLen > 1e-6 ? wishX / wishLen : 0;
  const nz = wishLen > 1e-6 ? wishZ / wishLen : 0;
  const target = PLAYER.walkSpeed * Math.min(wishLen, 1);

  const accel = s.grounded ? PLAYER.accel : PLAYER.airAccel;
  s.vel[0] = clamp(s.vel[0] + clamp(nx * target - s.vel[0], -accel * dtc, accel * dtc), -60, 60);
  s.vel[2] = clamp(s.vel[2] + clamp(nz * target - s.vel[2], -accel * dtc, accel * dtc), -60, 60);
  if (s.grounded && wishLen < 1e-6) {
    // Ground friction when no intent: exponential-ish stop.
    const f = Math.max(0, 1 - PLAYER.friction * dtc);
    s.vel[0] *= f;
    s.vel[2] *= f;
  }

  if (input.jump && s.grounded) {
    s.vel[1] = PLAYER.jumpSpeed;
    s.grounded = false;
  }
  s.vel[1] += PLAYER.gravity * dtc;

  s.pos[0] += s.vel[0] * dtc;
  s.pos[1] += s.vel[1] * dtc;
  s.pos[2] += s.vel[2] * dtc;

  // The floor plane.
  if (s.pos[1] <= 0) {
    s.pos[1] = 0;
    if (s.vel[1] < 0) s.vel[1] = 0;
    s.grounded = true;
  } else {
    s.grounded = false;
  }

  const before: Mut3 = [s.pos[0], s.pos[1], s.pos[2]];
  if (resolveCapsule(s.pos, colliders)) {
    // Kill the velocity component along the push so walls don't pump speed.
    const push: Mut3 = [s.pos[0] - before[0], s.pos[1] - before[1], s.pos[2] - before[2]];
    const len = Math.hypot(push[0], push[1], push[2]);
    if (len > 1e-9) {
      const n: Mut3 = [push[0] / len, push[1] / len, push[2] / len];
      const into = s.vel[0] * n[0] + s.vel[1] * n[1] + s.vel[2] * n[2];
      if (into < 0) {
        s.vel[0] -= n[0] * into;
        s.vel[1] -= n[1] * into;
        s.vel[2] -= n[2] * into;
      }
      if (push[1] > 1e-6 && s.vel[1] < 0) { s.vel[1] = 0; s.grounded = true; }
    }
  }
  return s;
}

/** Eye position for the camera. */
export function eyeOf(s: PlayerState): Vec3 {
  return [s.pos[0], s.pos[1] + PLAYER.eye, s.pos[2]];
}
