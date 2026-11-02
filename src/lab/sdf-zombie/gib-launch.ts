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
export function hash01(key: string, salt: number, seed: number): number {
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

/**
 * THE BLAST-SHAPED LAUNCH (gib-switch.ts `launch`, 2026-10-29). The diagnosis: pieces left ~6.1 m/s UP and only
 * ~3 m/s sideways at every distance (the 6 m/s `minUpKickMps` floor on the shared shove plus the 0-6.1 m/s up
 * spread), so an offset blast read as a vertical fountain beside the explosion rather than the body being blown
 * away from it. This keeps the independent per-piece spread (smaller, so the shared direction reads) and
 * replaces the shared shove with one shaped by the blast:
 *
 *   - its SPEED rises with the falloff: a shove at the edge of the gib range, a violent burst point-blank;
 *   - its DIRECTION is the horizontal blast -> body line far out, blending into a burst out of the body's own
 *     centre (piece origin - torso) close in, so a direct hit still bursts instead of fountaining;
 *   - a modest up tip and a LOW up floor, so every piece still arcs and lands on the floor.
 *
 * Pure and deterministic (same hash as gibLaunchVelocity).
 */
export const GIB_BLAST_LAUNCH = {
  /** Falloff (resolver, nearest surface) at which the shaping starts: about the edge of the gib range. */
  fallLo: 0.45,
  /** Shared speed, m/s, at fallLo and at falloff 1. */
  speedLo: 4.2,
  speedHi: 10,
  /** Falloff band over which the line direction blends into the body burst. */
  burstLo: 0.6,
  burstHi: 0.9,
  /** The burst's vertical share of (origin - torso), so it fans out sideways rather than up. */
  burstFlatten: 0.5,
  /** Up tip added to the shared direction before normalizing. */
  upK: 0.45,
  /** Share of the per-piece table spread kept (horizontal, up). */
  spreadH: 0.7,
  spreadUp: 0.35,
  /** Vertical floor, m/s (the old shove floored at 6). */
  minUpMps: 1.5,
} as const;

export function gibBlastLaunchVelocity(args: {
  key: string; seed: number;
  /** The blast, the body's torso centre (as drawn) and this piece's origin. */
  at: Vec3; torso: Vec3; origin: Vec3;
  /** The resolver's falloff at this body (nearest surface), 0..1. */
  falloff: number;
  spread?: { atc: number; at10: number };
  tuning?: typeof GIB_BLAST_LAUNCH;
}): Vec3 {
  const T = args.tuning ?? GIB_BLAST_LAUNCH;
  const spread = args.spread ?? GIB_TABLE_SPREAD;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const f = clamp01(args.falloff);
  const u = clamp01((f - T.fallLo) / (1 - T.fallLo));
  const speed = T.speedLo + (T.speedHi - T.speedLo) * u;
  const w = clamp01((f - T.burstLo) / (T.burstHi - T.burstLo));
  // The line: horizontal blast -> torso. Straight under the body there is none: all burst.
  const lx = args.torso[0] - args.at[0], lz = args.torso[2] - args.at[2];
  const ll = Math.hypot(lx, lz);
  const wl = ll < 1e-3 ? 1 : w;
  const line: Vec3 = ll < 1e-3 ? [0, 0, 0] : [lx / ll, 0, lz / ll];
  // The burst: out of the body's own centre, flattened. A piece AT the centre takes a seeded horizontal heading.
  let bx = args.origin[0] - args.torso[0], by = (args.origin[1] - args.torso[1]) * T.burstFlatten,
    bz = args.origin[2] - args.torso[2];
  let bl = Math.hypot(bx, by, bz);
  if (bl < 1e-3) {
    const a = hash01(args.key, 4, args.seed) * Math.PI * 2;
    bx = Math.cos(a); by = 0; bz = Math.sin(a); bl = 1;
  }
  let dx = line[0] * (1 - wl) + (bx / bl) * wl;
  let dy = (by / bl) * wl + T.upK;
  let dz = line[2] * (1 - wl) + (bz / bl) * wl;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const h = sourceSpreadMps(spread.atc) * GIB_LAUNCH.spreadScale * T.spreadH;
  const up = sourceSpreadMps(spread.at10) * GIB_LAUNCH.spreadScale * T.spreadUp;
  const r1 = hash01(args.key, 1, args.seed), r2 = hash01(args.key, 2, args.seed), r3 = hash01(args.key, 3, args.seed);
  let vx = dx * speed + (r1 * 2 - 1) * h;
  let vy = Math.max(dy * speed + r3 * up, T.minUpMps);
  let vz = dz * speed + (r2 * 2 - 1) * h;
  const s = Math.hypot(vx, vy, vz);
  if (s > GIB_LAUNCH.maxSpeedMps) { const k = GIB_LAUNCH.maxSpeedMps / s; vx *= k; vy *= k; vz *= k; }
  return [vx, vy, vz];
}
