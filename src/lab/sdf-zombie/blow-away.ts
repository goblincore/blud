// src/lab/sdf-zombie/blow-away.ts
//
// BLOWN AWAY (owner playtest 2026-11-02): "the general deaths from like a shotgun mostly cause enemies to
// collapse straight down but there should also be some deaths where they are blown away — off their feet,
// flying on their back". The soft target's death throw (soft-death.ts) already does exactly that for the
// cultist; this picks WHEN a hard target's death plays it, from the volley that killed him.
//
// The volley: every round that landed within VOLLEY_SEC of the last one (a double-barrel blast's pellets
// arrive together). A heavy one — a slug, an explosion, or a close shotgun group — rolls against its WEAPON's
// chance (BLOW_AWAY.weapons: the single barrel, the double barrel, the slug, an explosion; owner 2026-11-06: "make
// the blown away ragdoll frequency a per weapon config like double shotty"), which for a shotgun grows with the
// pellet count and falls off with range; a hit low on the legs never throws (it sweeps him). The throw is
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
  /** A pellet of the volley came from both barrels at once (the double barrel's chance applies). */
  double: boolean;
}

export const EMPTY_VOLLEY: KillVolley = { pellets: 0, slugs: 0, blasts: 0, dirWorld: [0, 0, 0], upper: false, rangeM: Infinity, double: false };

/** Launch speeds (m/s) — see DeathThrow. Eyeballed in the arena at a 2.2 m double barrel. */
export const BLOW_THROW: Record<'gun' | 'blast', DeathThrow> = {
  gun: { base: 3.0, tilt: 2.4, lift: 2.6 },
  blast: { base: 4.2, tilt: 2.8, lift: 3.4 },
};

/** Velocity bleed per 1/60 s while a thrown corpse is in the air, for BLOW_AIR_SEC after the throw. */
export const BLOW_AIR_DAMPING = 0.012;
export const BLOW_AIR_SEC = 0.7;

/** The weapons a throw is rolled for. An enemy's round is a single-barrel shotgun pellet. */
export type BlowWeapon = 'shotgun' | 'doubleShotgun' | 'slug' | 'explosion';

/** One weapon's throw. `chance` is the chance at full strength. Pellets: below `minPellets` landed a volley never
 *  throws, from `fullPellets` it has the full chance (unset: any one round does). RANGE (owner playtest 2026-11-02:
 *  "point blank should happen often, further less"): full inside `nearM`, a smoothstep to nothing at `farM` (unset:
 *  no falloff; only rounds that know their muzzle have a range). */
export interface BlowWeaponTuning { chance: number; minPellets?: number; fullPellets?: number; nearM?: number; farM?: number }

/** Tuning (the wound panel: `blowAway` scales every chance, the per-weapon sliders set each weapon's, and
 *  `blowAwayRange` both shotguns' `farM`). The single barrel lands up to 10 pellets point blank, the double barrel
 *  12-16. The double barrel's 0.75 is a touch under the 0.85 it shared with the single barrel (owner 2026-11-06:
 *  "maybe a little too high but generally okay"). */
export const BLOW_AWAY = {
  scale: 1,
  weapons: {
    shotgun: { chance: 0.85, minPellets: 5, fullPellets: 12, nearM: 2.5, farM: 7 },
    doubleShotgun: { chance: 0.75, minPellets: 5, fullPellets: 12, nearM: 2.5, farM: 7 },
    slug: { chance: 0.55 },
    explosion: { chance: 1 },
  } as Record<BlowWeapon, BlowWeaponTuning>,
};

export function setBlowAway(k: { scale?: number; weapons?: Partial<Record<BlowWeapon, Partial<BlowWeaponTuning>>> }): void {
  if (k.scale !== undefined) BLOW_AWAY.scale = k.scale;
  for (const [w, t] of Object.entries(k.weapons ?? {}) as [BlowWeapon, Partial<BlowWeaponTuning>][])
    BLOW_AWAY.weapons[w] = { ...BLOW_AWAY.weapons[w], ...t };
}

/** Adds one round to the volley; `barrels` is how many barrels fired the pellet's shot. */
export function addToVolley(v: KillVolley, round: 'pellet' | 'slug' | 'blast', dirWorld: Vec3, upper: boolean,
  rangeM = Infinity, barrels: 1 | 2 = 1): KillVolley {
  return {
    rangeM: Math.min(v.rangeM, rangeM),
    pellets: v.pellets + (round === 'pellet' ? 1 : 0),
    slugs: v.slugs + (round === 'slug' ? 1 : 0),
    blasts: v.blasts + (round === 'blast' ? 1 : 0),
    dirWorld: [...dirWorld] as Vec3,
    upper: v.upper || upper,
    double: v.double || (round === 'pellet' && barrels === 2),
  };
}

/** 1 inside `nearM`, a smoothstep down to 0 at `farM`; 1 for an unknown range or a weapon with no falloff. */
export function blowAwayRange(rangeM: number, w: BlowWeaponTuning): number {
  if (!Number.isFinite(rangeM) || w.nearM === undefined || w.farM === undefined) return 1;
  const k = Math.min(1, Math.max(0, (rangeM - w.nearM) / Math.max(1e-6, w.farM - w.nearM)));
  return 1 - k * k * (3 - 2 * k);
}

/** A weapon's chance for `rounds` landed at `rangeM`, before the global scale. */
function weaponChance(w: BlowWeaponTuning, rounds: number, rangeM: number): number {
  const min = w.minPellets ?? 1, full = Math.max(min, w.fullPellets ?? min);
  if (rounds < min) return 0;
  const k = Math.min(1, (rounds - min + 1) / (full - min + 1));
  return w.chance * k * blowAwayRange(rangeM, w);
}

/** The chance this volley blows the body away, 0..1: an explosion's, else the better of the slug's and the shotgun's
 *  (the double barrel's when any pellet came from both barrels). */
export function blowAwayChance(v: KillVolley, t: typeof BLOW_AWAY = BLOW_AWAY): number {
  if (v.blasts > 0) return Math.min(1, weaponChance(t.weapons.explosion, v.blasts, Infinity) * t.scale);
  if (!v.upper) return 0;
  let c = 0;
  if (v.slugs > 0) c = weaponChance(t.weapons.slug, v.slugs, v.rangeM);
  if (v.pellets > 0) c = Math.max(c, weaponChance(t.weapons[v.double ? 'doubleShotgun' : 'shotgun'], v.pellets, v.rangeM));
  return Math.min(1, c * t.scale);
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
