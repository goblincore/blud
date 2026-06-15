/**
 * Pure port of NotBlood's death/gib DECISION logic.
 *
 * Source: NotBlood `blood/src/actor.cpp` `actKillDude` (~3010-3500) and the
 * sub-160 explosion demotion in `actDamageSprite` (~3563), plus the chunk
 * velocity math in `blood/src/gib.cpp` `GibThing` (~361-432).
 *
 * This module owns only the *decision* — what kind of death, whether the body
 * bursts, whether a head pops off — and the raw Build-unit chunk launch
 * velocities. Entity-side effects (anim play, ballistic launch, SFX, the m/s
 * unit conversion) stay in the entities / GibSystem (see Task 8-10 wiring).
 *
 * Units: gibSpawns velocities are in **Build-units-per-tic** (raw), exactly as
 * the source computes them. The only unit conversion lives at the GibSystem
 * edge (Task 8 adapter via `buPerTicToMps`). Keeping this pipeline unit-pure is
 * what makes a future deterministic 120-tic netcode core a clean swap.
 *
 * Determinism: all randomness flows through the injectable {@link Rng}; pass a
 * seeded `mulberry32` for reproducible outcomes, `Math.random` in production.
 * (NotBlood itself uses the global `wrand()` seeded per-map, so exact values
 * differ — but the distributions are identical, which is what matters.)
 */

import type { Rng } from '../rng';
import { chance } from '../rng';
import { getDudeInfo, gibList, KDude } from './notblood-tables.gen';

/**
 * NotBlood DAMAGE_TYPE (actor.h). Values mirror the `KDamage` const in
 * notblood-tables.gen.ts (codegen from the same C enum); re-declared as a
 * proper enum here so {@link DeathInput.damageType} is a nominal type.
 */
export enum KDamage {
  kDamageFall = 0,
  kDamageBurn,
  kDamageBullet,
  kDamageExplode,
  kDamageDrown,
  kDamageSpirit,
  kDamageTesla,
}

/**
 * Single-hit damage at/above which an explosion gibs the dude outright instead
 * of killing it intact. Source: the `actDamageSprite` demotion
 * (`damageType == kDamageExplode && damage < 160 ? kDamageFall : damageType`,
 * actor.cpp:3563) — a sub-160 explosion becomes a fall (intact flung corpse).
 */
export const GIB_DAMAGE_THRESHOLD = 160;

export interface DeathInput {
  /** kDude* value (e.g. {@link KDude.kDudeZombieAxeNormal}). */
  dudeType: number;
  damageType: KDamage;
  /** Post-scaling damage delivered by the killing hit. */
  damage: number;
  /** Re-gibbing an existing corpse (kThingBloodChunks thing in the source). */
  isCorpse: boolean;
  rng: Rng;
}

/** A body-chunk gib with its launch velocity in Build-units-per-tic. */
export interface GibSpawn {
  tile: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface DeathOutcome {
  /** Body bursts into chunks now. */
  gibbed: boolean;
  /** Kickable head gib (NotBlood GIBTYPE_27 / gibList[27]) — zombie explode death. */
  spawnsHead: boolean;
  /** Normal-death head-pop signature (NotBlood `Chance(0x4000)`, zombie only). */
  headPop: boolean;
  /** Dude persists as a re-gibgable intact corpse (Blud: `!gibbed`). */
  becomesCorpse: boolean;
  /** Damage type after the sub-160 explode→fall conversion. */
  damageTypeResolved: KDamage;
  /** Body chunks from `nGibType → gibList` (empty unless gibbed). */
  gibSpawns: GibSpawn[];
}

// ——— NotBlood Random / Random2 ports (common_game.h:838-845) ————————————
// Random(n)  = mulscale15(wrand(), n)   ∈ [0, n)
// Random2(n) = mulscale14(wrand(), n)-n ∈ [-n, +n), mean 0

/** NotBlood `Random(n)`: uniform in [0, n). */
function random(rng: Rng, n: number): number {
  return n <= 0 ? 0 : rng() * n;
}

/** NotBlood `Random2(n)`: uniform in [-n, +n), mean 0. */
function random2(rng: Rng, n: number): number {
  return n <= 0 ? 0 : rng() * 2 * n - n;
}

/**
 * Fixed-point per-tic spread used by GibThing's no-pVel path
 * (`(field<<18)/120`, gib.cpp:409-414). `0x40000` (=1<<18) keeps the multiply
 * in safe-integer range; the `/120` is Blood's per-second→per-tic scaling.
 */
function spread(field: number): number {
  return Math.floor((field * 0x40000) / 120);
}

/**
 * NotBlood `actKillDude` damage-type → death-sequence index (actor.cpp:3183).
 * The sequence selects the death anim and gates the head-pop / head-spawn paths.
 */
function deathSeq(damageType: KDamage, dudeType: number): number {
  switch (damageType) {
    case KDamage.kDamageExplode:
      return 2;
    case KDamage.kDamageBurn:
      return 3;
    case KDamage.kDamageSpirit:
      if (dudeType === KDude.kDudeZombieAxeNormal || dudeType === KDude.kDudeZombieAxeBuried) return 14;
      if (dudeType === KDude.kDudeZombieButcher) return 11;
      return 1;
    case KDamage.kDamageFall:
    default: // kDamageBullet / kDamageDrown / kDamageTesla → default death
      return 1;
  }
}

/**
 * Spawn the body-chunk gibs for a gibbed dude.
 *
 * Ports `actKillDude`'s nGibType loop (actor.cpp:3463-3468):
 *   for i in 3: if nGibType[i] > -1: GibSprite(pSprite, nGibType[i], NULL, NULL)
 *
 * `GibSprite` is called with pVel=NULL, so each GIBTHING lands in GibThing's
 * no-pVel branch (gib.cpp:409-414): velocities are pure random spread from the
 * GIBTHING `atc`/`at10` fields — no radial/explosion bias (the concussion
 * launch is a separate sprite-velocity effect, not a gib effect).
 *
 * The z-branch assumes floor proximity (the overwhelmingly common case for an
 * explosion death): `zvel = -Random((at10<<18)/120)` — an upward kick (Build
 * -z = up). The ceiling / floor-aligned geometry branches (gib.cpp:416-426) are
 * deferred to the entity, which has the sector geometry.
 */
function spawnBodyChunks(dudeType: number, rng: Rng): GibSpawn[] {
  const info = getDudeInfo(dudeType);
  if (!info) return [];
  const out: GibSpawn[] = [];
  // nGibType is a readonly literal tuple (e.g. [15, -1, -1]) thanks to the
  // `as const` gen; map(Number) widens the literal values (incl. the -1
  // sentinels) to plain numbers so gibList indexing stays clean.
  for (const gibIdx of info.nGibType.map(Number).filter((i) => i >= 0)) {
    const gib = gibList[gibIdx];
    if (!gib?.things) continue;
    for (const thing of gib.things) {
      // NotBlood GibThing chance gate (gib.cpp:374): chance >= 0x10000 (e.g.
      // gibHuman's 917504) is an unconditional always-spawn; otherwise a
      // Chance() roll. Short-circuiting the always case avoids pointless rng
      // draws without changing the result.
      if (thing.chance < 0x10000 && !chance(rng, thing.chance)) continue;
      // Each thing's velocity uses its OWN atc/at10 (gib.cpp:409-414).
      const spreadXY = spread(thing.atc);
      out.push({
        tile: thing.tile,
        vx: random2(rng, spreadXY),
        vy: random2(rng, spreadXY),
        vz: -random(rng, spread(thing.at10)),
      });
    }
  }
  return out;
}

/**
 * Resolve the death/gib outcome for a dude killed by `damage` of `damageType`.
 *
 * Faithful to NotBlood `actKillDude` + the `actDamageSprite` sub-160 demotion.
 * Pure: no Three/Rapier/global-state access — all randomness via the injected
 * {@link Rng}.
 */
export function resolveDeathOutcome(input: DeathInput): DeathOutcome {
  const { dudeType, damageType, damage, isCorpse, rng } = input;
  const isZombie = dudeType === KDude.kDudeZombieAxeNormal;

  // — Corpse re-gib (NotBlood kThingBloodChunks things burst on any explosion
  //   contact — no 160 threshold, no head). Blud surfaces this as `isCorpse`;
  //   the source reaches it via the thing-damage path rather than actKillDude.
  if (isCorpse) {
    return {
      gibbed: true,
      spawnsHead: false,
      headPop: false,
      becomesCorpse: false, // corpse consumed by the burst
      damageTypeResolved: damageType,
      gibSpawns: spawnBodyChunks(dudeType, rng),
    };
  }

  // — actDamageSprite sub-160 demotion (actor.cpp:3563): a sub-threshold
  //   explosion is converted to kDamageFall before actKillDude runs, so the
  //   dude dies intact (a flung, re-gibgable corpse) rather than bursting.
  const damageTypeResolved: KDamage =
    damageType === KDamage.kDamageExplode && damage < GIB_DAMAGE_THRESHOLD
      ? KDamage.kDamageFall
      : damageType;

  if (damageTypeResolved === KDamage.kDamageExplode) {
    // Full gib — actKillDude nSeq==2 path. Body chunks from nGibType; the axe
    // zombie additionally spawns its kickable head (GIBTYPE_27) at the sprite
    // top (actor.cpp:3206). Other dude types burst without a head.
    return {
      gibbed: true,
      spawnsHead: isZombie,
      headPop: false,
      becomesCorpse: false,
      damageTypeResolved,
      gibSpawns: spawnBodyChunks(dudeType, rng),
    };
  }

  // Normal death (fall / burn / spirit / default). The body persists as an
  // intact corpse. NotBlood kDudeZombieAxeNormal nSeq==1 path pops the head on
  // `Chance(0x4000)` with a blood spurt (actor.cpp:3214); other dudes just die.
  const headPop = isZombie && deathSeq(damageTypeResolved, dudeType) === 1 && chance(rng, 0x4000);

  return {
    gibbed: false,
    spawnsHead: false,
    headPop,
    becomesCorpse: true,
    damageTypeResolved,
    gibSpawns: [],
  };
}
