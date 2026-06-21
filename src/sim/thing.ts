// src/sim/thing.ts
import { mulfp, metersPerSecToFp, fpFromMeters } from './fp';
import { clipMoveXZ, type SimAABB } from './geometry';

/** A generic deterministic moving thing (Blood kThing / MoveThing port). Integer
 *  fp position/velocity; gravity on Y; floor + wall bounce by `elastic`. Reused by
 *  the dynamite projectile (plan 3) and the kickable head (plan 3.5). */
export interface ThingState {
  x: number; y: number; z: number;     // fp position (y = feet/bottom; floor = 0)
  vx: number; vy: number; vz: number;  // fp/tic velocity
  radius: number;                       // fp horizontal radius for wall clip
  elastic: number;                      // 16.16 restitution (Blood elastic; 24576 = 0.375)
  resting: boolean;
}

/** THING_GRAVITY matches the Rapier world gravity from src/physics/world.ts:
 *  `new RAPIER.World({ x: 0, y: -25, z: 0 })` → magnitude 25 m/s².
 *  This preserves the dynamite arc/range feel tuned against that gravity. */
export const THING_GRAVITY_DV = metersPerSecToFp(25 / 120); // Δvy per tic at 120 tic/s
export const DEFAULT_ELASTIC = 24576; // Blood thingInfo elastic for TNT (0.375 in 16.16)
const REST_VY = metersPerSecToFp(0.5); // below this |vy| on floor contact → rest

export function makeThing(x: number, y: number, z: number): ThingState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, radius: fpFromMeters(0.08), elastic: DEFAULT_ELASTIC, resting: false };
}

/** Advance one tic. Returns true if the thing contacted geometry (floor or wall)
 *  this tic — used for impact-detonation. Pure: mutates `t`. */
export function stepThing(t: ThingState, geo: SimAABB[]): boolean {
  let hit = false;

  // gravity + vertical integrate, with floor bounce
  t.vy -= THING_GRAVITY_DV;
  t.y += t.vy;
  if (t.y <= 0) {
    t.y = 0;
    hit = true;
    if (t.vy < 0) {
      const up = mulfp(-t.vy, t.elastic); // reflect + dampen
      if (up <= REST_VY) { t.vy = 0; t.resting = true; }
      else { t.vy = up; t.resting = false; }
    }
  } else {
    t.resting = false;
  }

  // horizontal move with wall clip + bounce
  const moved = clipMoveXZ({ x: t.x, z: t.z }, t.vx, t.vz, t.radius, geo);
  if (moved.x !== t.x + t.vx) { t.vx = mulfp(-t.vx, t.elastic); hit = true; }
  if (moved.z !== t.z + t.vz) { t.vz = mulfp(-t.vz, t.elastic); hit = true; }
  t.x = moved.x;
  t.z = moved.z;

  return hit;
}
