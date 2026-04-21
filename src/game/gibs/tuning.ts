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
