// src/sim/render.ts
import { fpToMeters } from './fp';
import { bloodAngleToRadians } from './units';
import type { PlayerState } from './player';
import type { ProjectileState } from './projectile';

const EYE_HEIGHT_M = 1.75; // eye above feet (matches the legacy player feel)

export interface PlayerRender {
  xMeters: number; zMeters: number; eyeYMeters: number;
  yawRad: number; pitchRad: number;
}

/** Shortest-arc lerp of a Blood angle (handles 2048 wraparound). */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 1024 + 2048) % 2048) - 1024; // shortest arc in [-1024, 1024)
  const r = a + d * t;
  return ((r % 2048) + 2048) % 2048;               // keep in [0, 2048)
}

export interface ProjectileRender { xMeters: number; yMeters: number; zMeters: number; }

/** Interpolate projectile positions between the previous and current tic, in meters.
 *  Match by index — a projectile detonated this tic (in prev but not cur) is dropped.
 *  The runner uses the same prev/cur snapshots it already keeps for the player. */
export function renderProjectiles(prev: ProjectileState[], cur: ProjectileState[], alpha: number): ProjectileRender[] {
  const n = Math.min(prev.length, cur.length);
  const out: ProjectileRender[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i]!, b = cur[i]!;
    out.push({
      xMeters: fpToMeters(a.x + (b.x - a.x) * alpha),
      yMeters: fpToMeters(a.y + (b.y - a.y) * alpha),
      zMeters: fpToMeters(a.z + (b.z - a.z) * alpha),
    });
  }
  return out;
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
