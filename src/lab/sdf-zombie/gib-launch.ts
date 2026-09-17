// src/lab/sdf-zombie/gib-launch.ts
//
// WHERE A GIB PIECE COMES FROM, PHYSICALLY — the active lab's replacement for
// the correlated radial concussion shove the owner reported as "pieces cluster
// too much".
//
// THE TWO NOTBLOOD PATHS, AND WHICH ONE A GIB IS
// ---------------------------------------------
// NotBlood launches a gibbed dude's chunks through TWO independent mechanisms,
// and the active lab used the wrong one:
//
//   1. ConcussSprite (actor.cpp:2677) — a generic shockwave shove applied to
//      every kPhysMove sprite in the blast radius. It is RADIAL from the blast
//      and INVERSE-SQUARE in distance, so two body parts a few centimetres
//      apart receive almost the same velocity vector. That is exactly the
//      correlation the owner saw: chest and abdomen leave on one spoke.
//   2. GibSprite -> GibThing's no-pVel branch (gib.cpp:361-432, called from
//      actKillDude actor.cpp:3463-3468 with pVel=NULL) — each body chunk is
//      spawned with its OWN RANDOM spread from the gib table's `atc` (Build
//      x/y floor plane) and `at10` (Build -z, upward kick) fields. It has NO
//      radial/explosion bias: independence is the source behavior.
//
// The two coexist in the source (a gib thing is still a kPhysMove sprite, so
// the same blast that spawned it may also concuss it). So the source-faithful
// lab launch is: INDEPENDENT per-piece table spread + a SHARED coherent
// body shove. That is what this module produces.
//
// UNIT CHAIN (verified against the existing port, not re-derived from C — the
// NotBlood source tree is NOT present on this machine; see PHYSICS.md "gaps"):
//
//   death-outcome.ts `spread(f)`  = floor((f * 0x40000) / 120)   raw xvel field
//   outcome-adapter.ts             MoveThing integrates xvel >> 12
//                                  => true BU/tic = field / 4096
//   tuning.ts buPerTicToMps        => m/s = (field / 4096) * 120 / 256
//
//   gibList[15] (gibHuman, the human zombie/cultist OVERKILL set; all 7 things)
//     atc  = 300 -> 655360 field -> 160 BU/tic ->  75 m/s (horizontal max)
//     at10 = 900 -> 1966080 field -> 480 BU/tic -> 225 m/s (upward max)
//
// CALIBRATION, HONESTLY LABELLED. Those raw magnitudes are genuine Blood
// numbers, but Blood's physics scale is not the lab's: the lab runs 9.8 m/s²
// gravity against Blood's much heavier z-acceleration, so a 225 m/s up-kick
// arcs for ~15 s and leaves the arena in a frame. `GIB_LAUNCH.spreadScale`
// therefore scales the source ENVELOPE down to the lab's arc while preserving
// the SOURCE RATIO exactly (at10/atc = 3, so the up envelope is 3x the
// horizontal envelope). This is the same reasoning as DYNAMITE_COOK's
// "match the source RANGE, not its raw launch speed" note. `spreadScale` is a
// Blud feel value, NOT derived.
import type { Vec3 } from './types';

/** The gib-table spread fields a piece launches from. Source: gibList[15]
 *  (`gibHuman`) in the generated tables — every one of its 7 things carries
 *  `atc: 300, at10: 900`. Kept as a value so a future per-enemy gib set (mime /
 *  hound / gargoyle rows) can be threaded through without changing this API. */
export const GIB_TABLE_SPREAD = {
  atc: 300,
  at10: 900,
} as const;

/** Build-engine unit chain, pinned to the existing port's constants. */
const BU = {
  /** GibThing's per-second -> per-tic scaling: `(field << 18) / 120`, and
   *  `0x40000 === 1 << 18`. */
  FIELD_SHIFT: 0x40000,
  TICS_PER_SECOND: 120,
  /** MoveThing integrates `xvel >> 12`, so the raw field descales by 4096. */
  VEL_INTEGRATION: 4096,
  BU_PER_METER: 256,
} as const;

/**
 * The ported NotBlood horizontal/vertical spread magnitude, in m/s, for a raw
 * `atc`/`at10` field. This is the EXACT unit chain the retired port uses
 * (`death-outcome.ts` spread -> `outcome-adapter.ts` descale ->
 * `tuning.ts` buPerTicToMps); the lab does not import the retired modules (they
 * pull Rapier/THREE), so the arithmetic is mirrored here and pinned by test.
 */
export function sourceSpreadMps(field: number): number {
  if (!(field > 0)) return 0;
  const rawField = Math.floor((field * BU.FIELD_SHIFT) / BU.TICS_PER_SECOND);
  const buPerTic = rawField / BU.VEL_INTEGRATION;
  return (buPerTic * BU.TICS_PER_SECOND) / BU.BU_PER_METER;
}

/** Blud tuning for the source-derived launch. */
export const GIB_LAUNCH = {
  /**
   * Blud calibration of the source spread envelope (NOT derived). At 0.027 the
   * maxima are ~2.0 m/s horizontal and ~6.1 m/s up — the same arc class as the
   * concussion launch it replaces (point-blank ~8.8 m/s), which is the energy
   * the owner already accepted; the change here is the DISTRIBUTION.
   */
  spreadScale: 0.027,
  /**
   * Fraction of the shared body shove (blast concussion / inherited motion)
   * every piece receives. 1 would make the whole set drift on one vector and
   * read as a single mass; 0 would drop the blast read entirely. 0.6 keeps the
   * coherent push visible while the independent spread separates the pieces.
   */
  coherentFrac: 0.6,
  /** Hard per-piece speed bound (m/s). */
  maxSpeedMps: 16,
} as const;

export interface GibLaunchTuning {
  spreadScale: number;
  coherentFrac: number;
  maxSpeedMps: number;
}

/** FNV-1a-style deterministic hash -> a stable [0, 1) for a key/salt/seed.
 *  PURE: the same key+seed always re-rolls the same spread, and different
 *  global seeds (the page's `?seed=`) give different bursts. Deliberately NOT
 *  the shared `rngStreams.misc` stream, so adding this launch cannot shift the
 *  draws of any other system (torn-end radii, head faces, ...). */
function hash01(key: string, salt: number, seed: number): number {
  let h = (2166136261 ^ Math.imul(salt >>> 0, 2654435761)) >>> 0;
  h = (h ^ Math.imul((seed >>> 0) + 1, 40503)) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The launch velocity of ONE gib piece, in lab/world axes (+y up).
 *
 *   spread  — independent per-piece uniform x/z in [-h, +h] and +y in [0, 3h],
 *             from the piece's own key and the global seed (source GibThing),
 *   bodyVel — the SHARED coherent shove (blast concussion at the body's own
 *             surface, plus any inherited body motion), applied once at
 *             `coherentFrac` (source ConcussSprite),
 *
 * with the sum clamped to `maxSpeedMps`. Pure and deterministic.
 */
export function gibLaunchVelocity(args: {
  /** Stable per-piece identity (`"torso.chest#3"`); decides the spread roll. */
  key: string;
  /** The page's demo seed — same seed, same burst. */
  seed: number;
  /** Shared coherent velocity (m/s, lab axes). Applied at `coherentFrac`. */
  bodyVel: Vec3;
  /** Table spread fields; defaults to the human gib set. */
  spread?: { atc: number; at10: number };
  tuning?: GibLaunchTuning;
}): Vec3 {
  const t = args.tuning ?? GIB_LAUNCH;
  const spread = args.spread ?? GIB_TABLE_SPREAD;
  const h = sourceSpreadMps(spread.atc) * t.spreadScale;
  const up = sourceSpreadMps(spread.at10) * t.spreadScale;
  // Build x/y are the floor plane -> lab x/z; Build -z is up -> lab +y.
  const r1 = hash01(args.key, 1, args.seed);
  const r2 = hash01(args.key, 2, args.seed);
  const r3 = hash01(args.key, 3, args.seed);
  let vx = (r1 * 2 - 1) * h + args.bodyVel[0] * t.coherentFrac;
  let vy = r3 * up + args.bodyVel[1] * t.coherentFrac;
  let vz = (r2 * 2 - 1) * h + args.bodyVel[2] * t.coherentFrac;
  const speed = Math.hypot(vx, vy, vz);
  if (speed > t.maxSpeedMps) {
    const k = t.maxSpeedMps / speed;
    vx *= k; vy *= k; vz *= k;
  }
  return [vx, vy, vz];
}
