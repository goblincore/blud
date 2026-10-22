// src/lab/sdf-zombie/bile.ts
//
// The gibbet's BILE (characters/gibbet.blob): a glob squirted from the drip at the bottom of its caged sac and LOBBED
// at the player. Plain data like rockets.ts: no three, no clock of its own, no world of its own; game-tick steps it
// with the world's segment tests and draws it as a tinted tracer.
//
// WHY A LOB. The gibbet's other attack is a spike stab up close, so the squirt is its answer to a player who keeps
// their distance. A lob is slow and arcs, so it reads from across the room (you see the sac swing, clench, and the
// glob rise) and can be stepped out of, the same balance as the warbull's 9 m/s rocket. It splashes on whatever it
// hits; only the player takes damage (it is bile, not a warhead).
import type { Vec3 } from './types';

export const BILE = {
  /** Launch speed, m/s: slow enough to see the arc and step out of it. */
  speed: 9.5,
  /** Gravity on the glob, m/s^2: real gravity, so the arc reads as thrown liquid. */
  gravity: 9.8,
  /** Drawn and collision radius, m: a fat glob. */
  radius: 0.07,
  /** Seconds before it can hit anything (it leaves from inside the sac's drip). */
  armSec: 0.12,
  /** Gone after this long in flight, s. */
  maxAge: 3,
  /** Player damage on a direct hit (player-vitals.ts scale: a zombie bite is 10, a sword hit 15). */
  playerDamage: 12,
} as const;

export interface Bile {
  pos: Vec3;
  vel: Vec3;
  ageSec: number;
  /** Actor id of the firer. */
  owner: number;
}

export interface BileWorld {
  /** True when the segment crosses solid level geometry (walls, floor, ceiling, furniture). */
  hitsWorld(from: Vec3, to: Vec3): boolean;
  /** True when the segment passes through the player. */
  hitsPlayer(from: Vec3, to: Vec3): boolean;
}

export type BileCause = 'world' | 'player' | 'age';
export interface Splash { at: Vec3; cause: BileCause; owner: number }

/** The launch velocity that lobs a glob from `origin` onto `target` at BILE.speed: the LOW arc when the target is in
 *  range (the faster, flatter one, harder to dodge late), else the 45-degree throw toward it (it falls short: a
 *  telegraph, never a miss that looks like a bug). Pure. */
export function lobVelocity(origin: Vec3, target: Vec3, speed: number = BILE.speed, g: number = BILE.gravity): Vec3 {
  const dx = target[0] - origin[0], dz = target[2] - origin[2], dy = target[1] - origin[1];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return [0, speed, 0];
  const hx = dx / d, hz = dz / d;
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  const angle = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * d)) : Math.PI / 4;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [hx * c * speed, s * speed, hz * c * speed];
}

export function spawnBile(origin: Vec3, target: Vec3, owner: number): Bile {
  return { pos: [...origin] as Vec3, vel: lobVelocity(origin, target), ageSec: 0, owner };
}

/** Advance every glob one step under gravity. Returns the survivors and this step's splashes (at the last free
 *  point, so a splash is never inside a wall). Unarmed globs pass through everything. */
export function stepBile(globs: readonly Bile[], dt: number, world: BileWorld): { live: Bile[]; splashes: Splash[] } {
  const live: Bile[] = [];
  const splashes: Splash[] = [];
  for (const b of globs) {
    // EXACT for constant gravity (the parabola, not an Euler step), so the glob lands where lobVelocity aimed it
    // whatever the frame rate (an Euler step lands short by an amount that grows with dt and the flight time).
    const vel: Vec3 = [b.vel[0], b.vel[1] - BILE.gravity * dt, b.vel[2]];
    const from = b.pos;
    const to: Vec3 = [from[0] + b.vel[0] * dt, from[1] + b.vel[1] * dt - 0.5 * BILE.gravity * dt * dt, from[2] + b.vel[2] * dt];
    const ageSec = b.ageSec + dt;
    const armed = ageSec >= BILE.armSec;
    const cause: BileCause | null = !armed ? null
      : world.hitsPlayer(from, to) ? 'player'
        : world.hitsWorld(from, to) ? 'world'
          : ageSec >= BILE.maxAge ? 'age' : null;
    if (cause) { splashes.push({ at: [...from] as Vec3, cause, owner: b.owner }); continue; }
    live.push({ ...b, pos: to, vel, ageSec });
  }
  return { live, splashes };
}
