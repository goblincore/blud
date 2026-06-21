// src/sim/render.ts
import { fpToMeters } from './fp';
import { bloodAngleToRadians } from './units';
import type { PlayerState } from './player';

const EYE_HEIGHT_M = 1.75; // eye above feet (matches the legacy player feel)

export interface PlayerRender {
  xMeters: number; zMeters: number; eyeYMeters: number;
  yawRad: number; pitchRad: number;
}

/** Shortest-arc lerp of a Blood angle (handles 2048 wraparound). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 1024 + 2048) % 2048) - 1024; // [-1024, 1024)
  return a + d * t;
}

/** Interpolate the player between the previous and current tic for smooth
 *  rendering, and convert to meters/radians. This is the sim→render boundary. */
export function renderPlayer(prev: PlayerState, cur: PlayerState, alpha: number): PlayerRender {
  const lx = prev.x + (cur.x - prev.x) * alpha;
  const ly = prev.y + (cur.y - prev.y) * alpha;
  const lz = prev.z + (cur.z - prev.z) * alpha;
  const feetY = fpToMeters(ly);
  return {
    xMeters: fpToMeters(lx),
    zMeters: fpToMeters(lz),
    eyeYMeters: feetY + EYE_HEIGHT_M,
    yawRad: bloodAngleToRadians(lerpAngle(prev.yaw, cur.yaw, alpha)),
    pitchRad: bloodAngleToRadians(lerpAngle(prev.pitch, cur.pitch, alpha)),
  };
}
