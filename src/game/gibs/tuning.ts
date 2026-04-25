/**
 * Tuning constants for M2 gib/weapon systems.
 *
 * Every constant below is sourced from the NotBlood repository
 * (/Users/donny/Documents/Raze/NotBlood/source/blood/src/) with an explicit
 * source-file citation. When feel-tuning drifts a value from Blood's, keep
 * the original as a sibling `// blood: ...` comment so the delta is visible.
 *
 * See also:
 *  - docs/tuning-sources.md     (R1 — enemy HP, damage, explosion, weapon timers)
 *  - docs/tuning-sources-gibs.md (R2 — gib picnums + FX_27 trail mechanic)
 */

// ——— Unit conversion ————————————————————————————————————

/** Build engine units per meter. Calibrated in M1; re-verify if arena scale changes. */
export const BU_PER_METER = 256;

/** Blood runs at a fixed 120 ticks/sec; all "per-tic" Blood values convert via this. */
export const TICS_PER_SECOND = 120;

/** Convert a velocity expressed in Build-units-per-tic to meters-per-second. */
export function buPerTicToMps(buPerTic: number): number {
  return (buPerTic * TICS_PER_SECOND) / BU_PER_METER;
}

/** Convert an acceleration expressed in Build-units-per-tic² to meters-per-second². */
export function buPerTicSquaredToMpsSquared(buPerTicSquared: number): number {
  return (buPerTicSquared * TICS_PER_SECOND * TICS_PER_SECOND) / BU_PER_METER;
}

// ——— Explosion (kExplosionStandard — TNT Bundle) ————————————————
// source: actor.cpp:2300-2310 (explodeInfo[1]); docs/tuning-sources.md:456
export const EXPLOSION_STANDARD = {
  radius: 150,        // Build units — converted to meters at query time (radius / BU_PER_METER)
  damage: 20,
  damageRange: 10,    // actual ∈ [damage - range, damage + range]
  impulse: 900,
  lifetimeTics: 60,
  quake: 160,
  flash: 60,
} as const;

// source: R1 NotBlood gib-threshold extraction (single-hit dmg ≥ 160 ⇒ skip death, gib directly)
export const GIB_THRESHOLD = 160;

// ——— Dynamite throw ————————————————————————————————————
// source: weapon.cpp:1215 (ThrowBundle), actor.cpp:7106 (actFireThing), weapon.cpp:2218 (charge formula)
//
// Blood: nSpeed = mulscale16(throwPower, 0x177777) + 0x66666
//        xvel   = mulscale30(nSpeed, cos(ang))
//        zvel   = mulscale14(nSpeed, slope + (-9460))
//
// The xvel path: since cos/sin returns values in [-16384, +16384] (= 2^14),
// mulscale30(nSpeed, ±16384) == nSpeed >> 16. So the horizontal throw-speed
// in BU/tic equals nSpeed >> 16:
//   min = 0x66666   >> 16 =  6.4 BU/tic   (throwPower = 0)
//   max = 0x1DDDDD  >> 16 = 29.86 BU/tic  (throwPower = 65536, full charge)
//
// (An earlier comment here had the max as 13.86 — off by 2× because it did
// the arithmetic on (0x66666 + 0x177777) >> 16 instead of reading the Build
// scale-30 correctly. The felt-too-light throw in M2 came from that bug.)
//
// Converting BU/tic → m/s with BU_PER_METER=256, TICS_PER_SECOND=120:
//   min ≈  6.4 * 120 / 256 ≈  3.0 m/s
//   max ≈ 29.9 * 120 / 256 ≈ 14.0 m/s
//
// PITCH BIAS: the a4 argument to actFireThing is `slope + (-9460)`. Blood's
// slope range is [-16384, +16384] for aim in [-90°, +90°]. The constant
// -9460 adds a fixed upward lob of arcsin(9460/16384) ≈ 35.3° above the
// player's aim vector, regardless of where they're looking. Ported as
// PITCH_LOB_DEG below.
export const DYNAMITE_COOK = {
  maxChargeSec: 2.0,          // 240 tics @ 120 TPS (matches Blood's divscale16 / 240)
  minVelocityMps: 3.0,        // Blood nSpeed min (0x66666 >> 16) → m/s
  maxVelocityMps: 14.0,       // Blood nSpeed max (0x1DDDDD >> 16) → m/s
  fuseMaxSec: 2.0,            // fuse starts on press; same envelope as charge
  pitchLobDeg: 30,            // Blood port ≈ 35°, eased to 30° for our tighter arena scale
} as const;

// ——— Blood trail (FX_27) ————————————————————————————————
// source: callback.cpp:180-192 (fxBloodSpurt scheduling) + fx.cpp:89 (gFXData[27])
export const BLOOD_TRAIL = {
  emitHz: 20,                 // 6 tics @ 120 TPS → 20 Hz
  velScale: 1 / 256,          // Blood: xvel >> 8 = 1/256 inheritance
  gravityBlood: 27962,        // BU/tic² (raw Blood value, kept for reference)
  airdragBlood: 4096,         // raw Blood airdrag coefficient
  lifetimeSec: 4.0,           // 480 tics @ 120 TPS
  sizePx: 32,                 // 32×32 sprite (Blood xrepeat/yrepeat)
  tile: 733,
} as const;

// ——— Gib-moment radial burst (FX_13) ————————————————————
// source: fx.cpp:75 (gFXData[13]) — the main blood-chunk spray at the gib instant
export const GIB_BURST = {
  count: 10,                  // starting target: 10 particles per gib
  speedMin: 3.0,              // m/s radial spread (Blood-equivalent rough target)
  speedMax: 8.0,
  gravityBlood: 46603,
  airdragBlood: 2048,
  lifetimeSec: 4.0,           // 480 tics
  sizePx: 40,                 // 40×40 (Blood xrepeat/yrepeat)
  tile: 2154,
} as const;

// ——— Gib profile ————————————————————————————————————————
// M3 infrastructure for per-enemy death customization. Each enemy type
// declares a profile; GibSystem reads it at gib time for spawn counts +
// flesh/bone weights. M5 enemies plug in without refactoring ChunkSystem.

export interface ChunkRange { min: number; max: number }

export interface GibProfile {
  /** Flesh tier picnums — torso/arm/leg/spine/misc sprites. */
  fleshPicnums: number[];
  /** Bone tier picnums — clean bones, decorative skull/femur sprites. */
  bonePicnums: number[];
  /** Probability [0,1] a single chunk roll picks from bonePicnums. */
  boneWeight: number;
  /** Count of body-part chunks to spawn (uniform int in [min,max]). */
  bodyPartCount: ChunkRange;
  /** Count of FX_13 blood particles to spray (used by GibSystem). */
  chunkCount: ChunkRange;
}

/** Pick a single chunk picnum biased by profile.boneWeight. */
export function pickChunkPicnum(profile: GibProfile, rng: () => number): number {
  if (profile.bonePicnums.length > 0 && rng() < profile.boneWeight) {
    return profile.bonePicnums[Math.floor(rng() * profile.bonePicnums.length)]!;
  }
  const flesh = profile.fleshPicnums;
  return flesh[Math.floor(rng() * flesh.length)]!;
}

/** Uniform int in [range.min, range.max]. */
export function rollChunkCount(range: ChunkRange, rng: () => number): number {
  if (range.min === range.max) return range.min;
  return range.min + Math.floor(rng() * (range.max - range.min + 1));
}

/** Blood-derived flesh picnums for humanoid enemies (torso, arm, leg, spine, misc). */
export const HUMANOID_FLESH_PICNUMS = [1454, 1268, 1269, 1456, 1267] as const;

/**
 * Bone-tier picnums — filled by Task 5 after visual extraction. Empty list here
 * means Task 4 only wires the flesh path; boneWeight stays at 0 until Task 5
 * populates BONE_PICNUMS and bumps the weight to 0.2.
 */
// Picnums chosen from Blood tiles001.art. 421 = kThingBone (canonical diagonal bone),
// 446 = skull-with-candle decoration, 447 = small skull.
// See public/assets/gibs-placeholder/bone/ for the PNGs.
export const BONE_PICNUMS: number[] = [421, 446, 447];

export const ZOMBIE_GIB_PROFILE: GibProfile = {
  fleshPicnums: [...HUMANOID_FLESH_PICNUMS],
  bonePicnums: BONE_PICNUMS,
  boneWeight: 0.2,
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
};

// ——— Axe zombie ————————————————————————————————————
// source: docs/tuning-sources.md R1 (aizomba.cpp + dudeInfo[axeZombie])
// Starting values — these are our best read from NotBlood; feel-tune in Task 12 if needed.
export const AXE_ZOMBIE = {
  hp: 60,                     // dudeInfo[axeZombie].startHealth
  meleeDamage: 10,            // aizomba.cpp hit damage
  meleeRange: 1.5,            // m — ~sprite reach
  attackCooldownSec: 1.0,     // between swings
  speed: 3.0,                 // m/s — walk speed (shambler pace)
  aggroRadiusM: 40,           // when within this distance the zombie chases
  gibThresholdOverride: undefined as number | undefined, // use global GIB_THRESHOLD
} as const;

// ——— Shotgun cultist —————————————————————————————
// source: NotBlood dude.cpp dudeInfo[2] (kDudeCultistShotgun=202),
// aicult.cpp cultistSFire (60 tic delay = 0.5s), weapon.cpp shotgun fire dmg
export const SHOTGUN_CULTIST = {
  hp: 40,
  walkSpeedMps: 2.3,           // BU/tic 34952 → m/s
  aggroRadiusM: 18,            // half of see-dist (cultist sees better than zombie)
  fireRangeM: 12,              // stops moving and fires when within
  fireWindupSec: 0.5,          // 60 tics @ 120 TPS — how long Aim phase lasts
  fireCooldownSec: 1.5,        // delay after Recoil before next Fire
  recoilDurationSec: 0.4,      // how long Recoil phase lasts
} as const;

// ——— Shotgun blast (pellet projectile) ———————————
// source: NotBlood weapon.cpp shotgun fire dmg;
// aicult.cpp cultistSFire pellet spread
// TODO: cultist-specific gib palette (F2 follow-up) — reuse ZOMBIE_GIB_PROFILE for now
export const SHOTGUN_BLAST = {
  pelletCount: 7,              // canonical Blood shotgun pellet count
  pelletSpeedMps: 55,
  pelletMaxRangeM: 25,
  pelletDamage: 12,            // per pellet — 7 × 12 = 84 max if all hit
  spreadConeDeg: 14,           // half-angle of the pellet cone
} as const;

// ——— Flare gun ————————————————————————————————
export const FLARE_GUN = {
  raisingMs: 300,         // hold time before fire (no charge mechanic)
  muzzleVelMps: 25,       // initial projectile speed along camera-forward
  gravityMps2: 9.81,      // arc gravity (Y-axis down)
  ammoMax: 10,            // starting flare count
} as const;

// ——— Burn (applied by stuck flares) ————————
// source: Blood actor.cpp fire/burn damage paths (kDamageBurn); generic
// DOT mechanic found across Blood's actor type handlers.
export const BURN = {
  durationSec: 6,                 // stuck flare burn lifetime
  dpsPerFlare: 8,                 // HP/s drained by each attached flare
  panicSpeedMultiplier: 1.4,      // burning enemy thrashes at 1.4x base speed
  panicTargetRerollSec: 0.4,      // re-roll panic direction every 0.4s
  panicTargetRadiusM: 3,          // panic target picked within 3m of enemy
} as const;

// ——— Wave runner ——————————————————————————
export const WAVE_PRESETS = {
  breatherSec: 1.5,               // pause between waves once cleared
  zombieToughHpMultiplier: 2,     // 'zombie-tough' = 2x axe-zombie hp
} as const;
