// src/lab/sdf-zombie/prop-drop.ts
//
// A released held prop: ballistic flight with an end-over-end tumble, then
// a floor rest. Same shape as the FPV's ejected-shell arc (game-viewmodel.ts
// ejectedShell) — exaggerated gravity, seeded spin — but as a stepped state
// rather than a closed form, because a dropped gun has to LAND and stay.
// Pure: no wall clock, seed in, same numbers out.
import type { Vec3 } from './types';
import { add, normalize, qFromAxisAngle, qMul, qNormalize, scale, type Quat } from './vec';

export const DROP = {
  /** Exaggerated, to match the pellet/shell gravity. */
  gravity: -6.2,
  /** The prop rests this high off the floor (half its thickness). */
  floorPad: 0.03,
  /** Bounce restitution on landing. */
  restitution: 0.25,
  /** Horizontal speed bleed per landing. */
  friction: 0.5,
  /** Below this |vy| after a bounce the prop settles. */
  restCutoff: 0.35,
  /** Spin rate (rad/s) at release, jittered by the seed. */
  spin: 9,
} as const;

export interface DropState {
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  /** Unit spin axis and rate; rate 0 once resting. */
  spinAxis: Vec3;
  spinRate: number;
  resting: boolean;
}

function jitter(seed: number, n: number): number {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Start a drop from the prop's current pose with the hand's velocity. */
export function releaseProp(pos: Vec3, quat: Quat, handVel: Vec3, seed: number): DropState {
  const j = (n: number) => jitter(seed, n);
  return {
    pos: [pos[0], pos[1], pos[2]],
    quat: [quat[0], quat[1], quat[2], quat[3]],
    vel: add(handVel, [0.4 * j(0), 0.6 + 0.3 * j(1), 0.4 * j(2)]),
    spinAxis: normalize([1, 0.2 * j(3), 0.3 * j(4)]),
    spinRate: DROP.spin * (1 + 0.25 * j(5)),
    resting: false,
  };
}

/** One integration step. `floorY` is the floor plane. */
export function stepDrop(s: DropState, dt: number, floorY: number): DropState {
  if (s.resting) return s;
  let vel: Vec3 = [s.vel[0], s.vel[1] + DROP.gravity * dt, s.vel[2]];
  let pos = add(s.pos, scale(vel, dt));
  let quat = qNormalize(qMul(qFromAxisAngle(s.spinAxis, s.spinRate * dt), s.quat));
  let spinRate = s.spinRate;
  let resting = false;
  const rest = floorY + DROP.floorPad;
  if (pos[1] <= rest) {
    pos = [pos[0], rest, pos[2]];
    if (Math.abs(vel[1]) < DROP.restCutoff) {
      resting = true;
      spinRate = 0;
      // Lie flat: keep the yaw, drop the pitch/roll.
      const yaw = Math.atan2(2 * (quat[3] * quat[1] + quat[0] * quat[2]), 1 - 2 * (quat[1] * quat[1] + quat[2] * quat[2]));
      quat = qFromAxisAngle([0, 1, 0], yaw);
      return { pos, quat, vel: [0, 0, 0], spinAxis: s.spinAxis, spinRate, resting };
    }
    vel = [vel[0] * DROP.friction, -vel[1] * DROP.restitution, vel[2] * DROP.friction];
    spinRate *= 0.6;
  }
  return { pos, quat, vel, spinAxis: s.spinAxis, spinRate, resting };
}
