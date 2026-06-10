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

/** One integration step. Pure — caller stores the returned vel back into motion. */
export function stepBallistic(
  pos: Vec3,
  motion: BallisticMotion,
  dt: number,
  gravityMps2: number,
): BallisticStep {
  const vy = motion.vel.y - gravityMps2 * dt;
  const next = {
    x: pos.x + motion.vel.x * dt,
    y: pos.y + vy * dt,
    z: pos.z + motion.vel.z * dt,
  };
  if (vy <= 0 && next.y <= motion.groundY) {
    return {
      pos: { x: next.x, y: motion.groundY, z: next.z },
      vel: { x: 0, y: 0, z: 0 },
      landed: true,
    };
  }
  return { pos: next, vel: { x: motion.vel.x, y: vy, z: motion.vel.z }, landed: false };
}
