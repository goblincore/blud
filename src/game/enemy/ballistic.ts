import type { Vec3 } from '../gibs/particles';

/**
 * Kinematic ballistic flight for launched enemies — both alive (NotBlood
 * ConcussSprite throws survivors airborne) and dead (sub-160 explosion kills
 * keep their concussion velocity → intact tumbling corpse). The enemy's
 * kinematic body is moved by integrating this motion in update().
 */
export interface BallisticMotion {
  vel: Vec3;
  /** Y to land at — captured from the body's translation at launch time. */
  groundY: number;
}

export interface BallisticStep {
  pos: Vec3;
  vel: Vec3;
  landed: boolean;
}

/** Axis-aligned XZ walls a launched body reflects off (NotBlood dudes bounce
 *  off room geometry when concussed across it). */
export interface BallisticBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One integration step. Pure — caller stores the returned vel back into motion.
 *  With `bounds`, the body reflects off the XZ walls at `restitution` bounciness. */
export function stepBallistic(
  pos: Vec3,
  motion: BallisticMotion,
  dt: number,
  gravityMps2: number,
  bounds?: BallisticBounds,
  restitution = 0.45,
): BallisticStep {
  const vy = motion.vel.y - gravityMps2 * dt;
  const next = {
    x: pos.x + motion.vel.x * dt,
    y: pos.y + vy * dt,
    z: pos.z + motion.vel.z * dt,
  };
  let vx = motion.vel.x;
  let vz = motion.vel.z;
  if (bounds) {
    if (next.x > bounds.maxX) { next.x = bounds.maxX; vx = -vx * restitution; }
    else if (next.x < bounds.minX) { next.x = bounds.minX; vx = -vx * restitution; }
    if (next.z > bounds.maxZ) { next.z = bounds.maxZ; vz = -vz * restitution; }
    else if (next.z < bounds.minZ) { next.z = bounds.minZ; vz = -vz * restitution; }
  }
  if (vy <= 0 && next.y <= motion.groundY) {
    return {
      pos: { x: next.x, y: motion.groundY, z: next.z },
      vel: { x: 0, y: 0, z: 0 },
      landed: true,
    };
  }
  return { pos: next, vel: { x: vx, y: vy, z: vz }, landed: false };
}
