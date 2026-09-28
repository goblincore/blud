// src/lab/sdf-zombie/rockets.ts
//
// The warbull's ROCKETS as plain data (spec 2026-09-27-warbull-design.md,
// "Behaviour"). Pure: no three, no clock of its own, no world of its own.
//
// A rocket is SLOW on purpose. Enemy pellets fly at the pellet band (the
// player sees a streak and it is already there); a rocket crawls at ~9 m/s,
// a third of a second across a room's width, so a strafing player can step
// out of its line. That is the whole balance of a weapon whose blast is the
// player's own dynamite: you must be able to see it coming.
//
// Stepping takes the world as three segment tests (walls/floor/ceiling, the
// player, other actors), so this module never learns about colliders or
// capsules; game-main supplies them. A rocket DETONATES on the first thing its
// frame segment touches, when it runs out of range, and never on its own
// firer inside the arming time (it leaves from inside his fist).
//
// The blast itself is not here: game-main hands the detonation point to the
// dynamite path (detonateAt) at ROCKET.blastRadiusScale of a bundle's radius,
// with the FIRER excluded (he is not hurt by his own rockets), and adds the
// player's share (blastFalloff). rocketLineSafe is his trigger discipline:
// no firing into a wall at his feet.
import type { Vec3 } from './types';

export const ROCKET = {
  /** m/s: slow and visible (see the header). */
  speed: 9,
  /** Drawn radius, m: fatter than a slug, it is a warhead. */
  radius: 0.09,
  /** Detonates after this many metres of flight. */
  maxRange: 20,
  /** Seconds before it can hit its own firer (it spawns at his muzzle). */
  armSec: 0.15,
  /** Player damage at the epicentre, and the radius it falls to 0 over. The
   *  soldier's pellet is 3 and a sword hit 15 (player-vitals.ts): a rocket on
   *  your feet is the worst thing in the game short of your own dynamite,
   *  and two of three in a volley landing kills from full health's 100 at
   *  the centre only. */
  blastPlayerDamage: 45,
  blastPlayerRadius: 3.2,
  /** Multiplier on the DYNAMITE blast radius (explosion-aoe.ts, 4.69 m) for
   *  what a rocket does to BODIES: half, 2.34 m. A bundle is the player's
   *  room-clearer; at full size every rocket that met a doorframe near him
   *  took the warbull and his neighbours with it (owner playtest,
   *  2026-09-28: "he shoots into a wall in front of him and kills
   *  himself"). */
  blastRadiusScale: 0.5,
  /** He holds fire when the first wall along his line, or the player, is
   *  closer than this (m): the blast radius above plus his own half-width
   *  and a margin. Inside it the charge takes over (charge.ts). */
  safeDistance: 3.2,
} as const;

/** May he fire a rocket down this line? `playerDist` is the distance to the
 *  target; `obstacleDist` the distance to the first solid thing along the
 *  line (Infinity when clear). A wall BEYOND the player does not matter: the
 *  rocket meets the player first. */
export function rocketLineSafe(playerDist: number, obstacleDist: number): boolean {
  if (playerDist < ROCKET.safeDistance) return false;
  return obstacleDist >= playerDist || obstacleDist >= ROCKET.safeDistance;
}

export interface Rocket {
  pos: Vec3;
  vel: Vec3;
  ageSec: number;
  /** Metres flown. */
  travelled: number;
  /** Actor id of the firer. */
  owner: number;
}

export type DetonationCause = 'world' | 'player' | 'actor' | 'range';
export interface Detonation { at: Vec3; cause: DetonationCause; owner: number }

export interface RocketWorld {
  /** True when the segment crosses solid level geometry (walls, floor,
   *  ceiling, furniture). */
  hitsWorld(from: Vec3, to: Vec3): boolean;
  /** True when the segment passes through the player. */
  hitsPlayer(from: Vec3, to: Vec3): boolean;
  /** True when the segment passes through any actor OTHER than `owner`
   *  (and through the owner too once `armed`). */
  hitsActor(from: Vec3, to: Vec3, owner: number, armed: boolean): boolean;
}

export function spawnRocket(origin: Vec3, dir: Vec3, owner: number): Rocket {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const s = ROCKET.speed / l;
  return { pos: [...origin] as Vec3, vel: [dir[0] * s, dir[1] * s, dir[2] * s], ageSec: 0, travelled: 0, owner };
}

/** Advance every rocket one step. Returns the survivors and this step's
 *  detonations. A rocket that hits something detonates at the START of the
 *  step that hit (the last free point), so the blast is never inside a wall. */
export function stepRockets(rockets: readonly Rocket[], dt: number, world: RocketWorld): { live: Rocket[]; detonations: Detonation[] } {
  const live: Rocket[] = [];
  const detonations: Detonation[] = [];
  for (const r of rockets) {
    const from = r.pos;
    const to: Vec3 = [from[0] + r.vel[0] * dt, from[1] + r.vel[1] * dt, from[2] + r.vel[2] * dt];
    const ageSec = r.ageSec + dt;
    const armed = ageSec >= ROCKET.armSec;
    const cause: DetonationCause | null =
      world.hitsWorld(from, to) ? 'world'
        : world.hitsPlayer(from, to) ? 'player'
          : world.hitsActor(from, to, r.owner, armed) ? 'actor'
            : null;
    if (cause) { detonations.push({ at: [...from] as Vec3, cause, owner: r.owner }); continue; }
    const travelled = r.travelled + Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    if (travelled >= ROCKET.maxRange) { detonations.push({ at: to, cause: 'range', owner: r.owner }); continue; }
    live.push({ ...r, pos: to, ageSec, travelled });
  }
  return { live, detonations };
}

/** The player's share of a blast at `dist` metres: 1 at the epicentre,
 *  falling quadratically to 0 at blastPlayerRadius (a near miss stings, a
 *  direct hit is devastating). */
export function blastFalloff(dist: number): number {
  const u = Math.max(0, 1 - dist / ROCKET.blastPlayerRadius);
  return u * u;
}

/** Whole hit points the player takes from a blast `dist` metres away. */
export function blastPlayerDamage(dist: number): number {
  return Math.round(ROCKET.blastPlayerDamage * blastFalloff(dist));
}
