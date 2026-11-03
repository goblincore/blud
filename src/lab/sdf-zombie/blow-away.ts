// src/lab/sdf-zombie/blow-away.ts
//
// BLOWN AWAY (owner playtest 2026-11-02): "the general deaths from like a shotgun mostly cause enemies to
// collapse straight down but there should also be some deaths where they are blown away — off their feet,
// flying on their back". The soft target's death throw (soft-death.ts) already does exactly that for the
// cultist; this picks WHEN a hard target's death plays it, from the volley that killed him.
//
// The volley: every round that landed within VOLLEY_SEC of the last one (a double-barrel blast's pellets
// arrive together). A heavy one — a slug, an explosion, or a close shotgun group — rolls against a chance
// that grows with the pellet count; a hit low on the legs never throws (it sweeps him). The throw is
// BLOW_THROW, jittered: harder than the cultist's DEATH_THROW, whose 0.9 m/s lift left the feet in the
// floor's friction, so the body only pivoted over its heels. Here every joint leaves the floor and the
// top travels further than the feet, so he flies and lands on his back. While airborne the corpse damps
// at BLOW_AIR_DAMPING (game-actor.ts): the rig's 6% per 1/60 s bled the flight out in a quarter second.
//
// Pure: randomness comes in as a function; no clock.
import type { DeathThrow } from './soft-death';
import type { Vec3 } from './types';

/** Rounds closer together than this (sim seconds) are one volley. */
export const VOLLEY_SEC = 0.12;

export interface KillVolley {
  pellets: number;
  slugs: number;
  blasts: number;
  /** World direction of the last round. */
  dirWorld: Vec3;
  /** Any round struck the torso or head (a pure leg volley never throws). */
  upper: boolean;
  /** Muzzle-to-hit distance of the closest round that knew its muzzle (m); Infinity when none did (a slug, an
   *  explosion, an enemy's round), which skips the range falloff. */
  rangeM: number;
}

export const EMPTY_VOLLEY: KillVolley = { pellets: 0, slugs: 0, blasts: 0, dirWorld: [0, 0, 0], upper: false, rangeM: Infinity };

/** Launch speeds (m/s) — see DeathThrow. Eyeballed in the arena at a 2.2 m double barrel. */
export const BLOW_THROW: Record<'gun' | 'blast', DeathThrow> = {
  gun: { base: 3.0, tilt: 2.4, lift: 2.6 },
  blast: { base: 4.2, tilt: 2.8, lift: 3.4 },
};

/** Velocity bleed per 1/60 s while a thrown corpse is in the air, for BLOW_AIR_SEC after the throw. */
export const BLOW_AIR_DAMPING = 0.012;
export const BLOW_AIR_SEC = 0.7;

/** Tuning (wound panel `blowAway` scales every chance). Pellets: below `minPellets` a volley never throws;
 *  at `fullPellets` it throws with `pellets` chance (a point-blank double barrel lands 12-16).
 *  RANGE (owner playtest 2026-11-02: "point blank should happen often, further less"): a gun volley's chance is
 *  full inside `nearM` and smoothsteps to nothing at `farM`. Explosions ignore range. */
export const BLOW_AWAY = {
  scale: 1,
  slug: 0.55,
  blast: 1,
  pellets: 0.85,
  minPellets: 5,
  fullPellets: 12,
  nearM: 2.5,
  farM: 7,
};

export function setBlowAway(k: Partial<typeof BLOW_AWAY>): void { Object.assign(BLOW_AWAY, k); }

/** Adds one round to the volley. */
export function addToVolley(v: KillVolley, round: 'pellet' | 'slug' | 'blast', dirWorld: Vec3, upper: boolean,
  rangeM = Infinity): KillVolley {
  return {
    rangeM: Math.min(v.rangeM, rangeM),
    pellets: v.pellets + (round === 'pellet' ? 1 : 0),
    slugs: v.slugs + (round === 'slug' ? 1 : 0),
    blasts: v.blasts + (round === 'blast' ? 1 : 0),
    dirWorld: [...dirWorld] as Vec3,
    upper: v.upper || upper,
  };
}

/** 1 inside `nearM`, a smoothstep down to 0 at `farM`; 1 for an unknown range. */
export function blowAwayRange(rangeM: number, t: typeof BLOW_AWAY = BLOW_AWAY): number {
  if (!Number.isFinite(rangeM)) return 1;
  const k = Math.min(1, Math.max(0, (rangeM - t.nearM) / Math.max(1e-6, t.farM - t.nearM)));
  return 1 - k * k * (3 - 2 * k);
}

/** The chance this volley blows the body away, 0..1. */
export function blowAwayChance(v: KillVolley, t: typeof BLOW_AWAY = BLOW_AWAY): number {
  if (v.blasts > 0) return Math.min(1, t.blast * t.scale);
  if (!v.upper) return 0;
  let c = 0;
  if (v.slugs > 0) c = t.slug;
  if (v.pellets >= t.minPellets) {
    const k = Math.min(1, (v.pellets - t.minPellets + 1) / Math.max(1, t.fullPellets - t.minPellets + 1));
    c = Math.max(c, t.pellets * k);
  }
  return Math.min(1, c * blowAwayRange(v.rangeM, t) * t.scale);
}

/** The throw for a killing volley, or null (he drops where he stands). `rand` is called a fixed number of
 *  times so a seeded stream replays the same death. */
export function planBlowAway(v: KillVolley, rand: () => number, t: typeof BLOW_AWAY = BLOW_AWAY): DeathThrow | null {
  const roll = rand();
  const j = () => 0.8 + 0.4 * rand();
  const base = v.blasts > 0 ? BLOW_THROW.blast : BLOW_THROW.gun;
  const out: DeathThrow = { base: base.base * j(), tilt: base.tilt * j(), lift: base.lift * j() };
  return roll < blowAwayChance(v, t) && Math.hypot(v.dirWorld[0], v.dirWorld[2]) > 1e-6 ? out : null;
}
