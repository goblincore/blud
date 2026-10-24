// src/lab/sdf-zombie/fireball.ts
//
// The imp's FIREBALL (characters/imp.blob) and its THROW. Plain data like bile.ts and rockets.ts: no three, no clock
// of its own, no world of its own; game-tick steps it with the world's segment tests and draws it as a tinted tracer,
// and enemy-mind.ts makeImpMind decides when to throw.
//
// WHY NOT THE ROCKET. The teratoma's fireball is the warbull's rocket: a 9 m/s warhead whose blast is the dynamite's
// (45 at the centre, gibs, concussion). An imp throws often, from a body that is quick on its feet, so its fireball is
// a lighter thing: a ball of fire flung straight from the hand, faster than the rocket (it is thrown, and an imp is a
// skirmisher) but still slow enough to read and sidestep across a room, which hurts on a direct hit and singes on a
// near miss. It bursts on whatever it touches and harms only the player (the zombie mind's teammates are not its
// targets, and #69's lesson is that monsters must not wound themselves with their own blasts).
//
// THE THROW. The fireball is born in the right hand's burning socket (kit hand.r|ember) and leaves from it: the arm
// cocks up and back over the shoulder, whips forward overhand, and the ball flies on the release, from the hand's
// tip (MotionProfile.spit from handTipR), at the player's chest. The arm motion is attack.ts's `throw` arc; the
// beat timings below place the release where that arc's strike carries the hand forward of the shoulder.
import type { Vec3 } from './types';

export const FIREBALL = {
  /** Flight speed, m/s: quicker than the rocket's 9, slower than any round; ~0.9 s across a 10 m room. */
  speed: 11,
  /** A slight droop, m/s^2: a thrown ball, not a laser. Aimed with it allowed for (fireballVelocity). */
  gravity: 1.5,
  /** Drawn and collision radius, m. */
  radius: 0.085,
  /** Seconds before it can hit anything (it leaves from inside the socket). */
  armSec: 0.08,
  /** Gone after this long in flight, s. */
  maxAge: 2.5,
  /** Player damage on a direct hit (player-vitals.ts scale: a zombie bite is 10, a sword hit 15, a rocket 45). */
  playerDamage: 14,
  /** A burst within this distance of the player's middle that missed still singes, for this much. */
  splashRadius: 0.9,
  splashDamage: 5,
} as const;

/** The throw's beats and the imp mind's ranged tuning (enemy-mind.ts makeImpMind). */
export const IMP_TUNING = {
  /** The whole throw, s: the wind-up is attack.ts's first quarter (ATTACK_TUNING.windupEnd), the overhand strike
   *  the next. Quick: an imp is a skirmisher, but the cocked arm must read as a telegraph. */
  throwSec: 0.95,
  /** The phase the ball leaves the hand: late in the strike, the arm thrown forward past the shoulder. */
  fireAt: 0.44,
  /** It throws at a player between these distances (m) it can see, every cooldown seconds, the first after `first`.
   *  Inside `min` it closes and claws instead. */
  band: { min: 2.6, max: 16 },
  cooldown: 1.9,
  first: 0.8,
} as const;

/** The ball leaves this frame (prevPhase -> phase crosses IMP_TUNING.fireAt). */
export function throwFires(prevPhase: number, phase: number): boolean {
  const at = IMP_TUNING.fireAt;
  return prevPhase < at && phase >= at;
}

export interface Fireball {
  pos: Vec3;
  vel: Vec3;
  ageSec: number;
  /** Actor id of the thrower. */
  owner: number;
}

export interface FireballWorld {
  /** True when the segment crosses solid level geometry (walls, floor, ceiling, furniture). */
  hitsWorld(from: Vec3, to: Vec3): boolean;
  /** True when the segment passes through the player. */
  hitsPlayer(from: Vec3, to: Vec3): boolean;
}

export type FireballCause = 'world' | 'player' | 'age';
export interface Burst { at: Vec3; cause: FireballCause; owner: number }

/** The launch velocity that carries a ball from `origin` to `target` at FIREBALL.speed under its slight droop: the
 *  straight line, lifted by the drop over the flight time. Pure. */
export function fireballVelocity(origin: Vec3, target: Vec3, speed: number = FIREBALL.speed, g: number = FIREBALL.gravity): Vec3 {
  const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-6) return [0, 0, speed];
  const t = l / speed;
  const v: Vec3 = [d[0] / t, d[1] / t + 0.5 * g * t, d[2] / t];
  const s = speed / (Math.hypot(v[0], v[1], v[2]) || 1);
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function spawnFireball(origin: Vec3, target: Vec3, owner: number): Fireball {
  return { pos: [...origin] as Vec3, vel: fireballVelocity(origin, target), ageSec: 0, owner };
}

/** Advance every ball one step. Returns the survivors and this step's bursts (at the last free point, so a burst is
 *  never inside a wall). Unarmed balls pass through everything. */
export function stepFireballs(balls: readonly Fireball[], dt: number, world: FireballWorld): { live: Fireball[]; bursts: Burst[] } {
  const live: Fireball[] = [];
  const bursts: Burst[] = [];
  for (const b of balls) {
    // Exact for constant gravity, like bile.ts, so it lands where fireballVelocity aimed it at any frame rate.
    const g = FIREBALL.gravity;
    const vel: Vec3 = [b.vel[0], b.vel[1] - g * dt, b.vel[2]];
    const from = b.pos;
    const to: Vec3 = [from[0] + b.vel[0] * dt, from[1] + b.vel[1] * dt - 0.5 * g * dt * dt, from[2] + b.vel[2] * dt];
    const ageSec = b.ageSec + dt;
    const armed = ageSec >= FIREBALL.armSec;
    const cause: FireballCause | null = !armed ? null
      : world.hitsPlayer(from, to) ? 'player'
        : world.hitsWorld(from, to) ? 'world'
          : ageSec >= FIREBALL.maxAge ? 'age' : null;
    if (cause) { bursts.push({ at: [...from] as Vec3, cause, owner: b.owner }); continue; }
    live.push({ ...b, pos: to, vel, ageSec });
  }
  return { live, bursts };
}

/** The player's share of a burst: the full hit when it struck them, a singe when it burst near (within splashRadius
 *  of `playerMid`, the middle of their capsule), else 0. */
export function burstPlayerDamage(burst: Burst, playerMid: Vec3): number {
  if (burst.cause === 'player') return FIREBALL.playerDamage;
  const d = Math.hypot(burst.at[0] - playerMid[0], burst.at[1] - playerMid[1], burst.at[2] - playerMid[2]);
  return d <= FIREBALL.splashRadius ? FIREBALL.splashDamage : 0;
}
