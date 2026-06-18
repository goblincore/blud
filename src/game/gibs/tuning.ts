/**
 * Tuning constants for M2 gib/weapon systems.
 *
 * Raw NotBlood values (HP, explosion stats, gib counts) are derived from the
 * generated tables in `../notblood/notblood-tables.gen.ts` (codegen from the C
 * aggregate tables — see scripts/gen_notblood_tables.py). Each derivation cites
 * the raw table + index it pulls from.
 *
 * Constants that do NOT have a raw source — Blud feel values, formula-derived
 * ports, and deliberate deviations from NotBlood — stay as documented local
 * literals with a comment noting they are NOT derived.
 *
 * See also:
 *  - docs/tuning-sources.md     (R1 — enemy HP, damage, explosion, weapon timers)
 *  - docs/tuning-sources-gibs.md (R2 — gib picnums + FX_27 trail mechanic)
 */

import { explodeInfo, dudeInfo, gibList, KDude } from '../notblood/notblood-tables.gen';

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
// Derived from explodeInfo[1] (raw C aggregate; source: actor.cpp:2300-2310).
// Build-unit values — radius converted to meters at query time.
const STD = explodeInfo[1]; // kExplosionStandard
export const EXPLOSION_STANDARD = {
  radius: STD.radius,        // 150 BU — converted to meters at query time (radius / BU_PER_METER)
  damage: STD.dmg,           // 20
  damageRange: STD.dmgRng,   // 10 — actual ∈ [damage - range, damage + range]
  impulse: STD.dmgType,      // 900 — NOTE: the C field is misnamed "dmgType";
                             // for explosions it holds the ConcussSprite impulse.
  lifetimeTics: STD.ticks,   // 60
  quake: STD.quakeEffect,    // 160
  flash: STD.flashEffect,    // 60
} as const;

// NOT in the aggregate tables — this is a control-flow constant from
// actKillDude (single-hit dmg ≥ 160 ⇒ skip death, gib directly). It will be
// sourced from the resolveDeathOutcome port (later task); kept as a literal here.
export const GIB_THRESHOLD = 160;

// NOT derived — Blud feel value porting NotBlood actExplodeSprite's florhit
// branch (actor.cpp ~5995): florhit==0 ⇒ air SEQ (compact fireball), else
// ground SEQ (dome→mushroom). NotBlood's florhit is a binary "rested on the
// floor this move"; Blud approximates it with the detonation's distance to the
// nearest static floor below — at-or-under this many meters reads as a ground
// burst. ~0.6 m comfortably catches a dynamite ball at rest (~0.08 m above the
// floor) and mid-bounce, while a chest-height airburst on an enemy (~1 m) is air.
export const GROUND_BURST_THRESHOLD_M = 0.6;

// NOT derived — VISUAL-ONLY scale for the explosion sprite, decoupled from the
// gameplay AOE radius. The fireball's rendered half-HEIGHT (meters) is the
// scaled AOE radiusM × this factor; width follows the tile aspect. Tuned down
// from the old 0.6 (which read ~5.6 m tall, ~3× a zombie) after the SEQ-faithful
// atlases — the real Blood SEQ tiles fill the frame far more than the old
// sparse mushroom, so the same factor looked oversized. Playtest knob.
export const EXPLOSION_VFX_HEIGHT_SCALE = 0.42;

// ——— Concussion launch (explosion physics on dudes) ————————————
// NOT derived from the tables — Blud feel values porting NotBlood actor.cpp:2677
// ConcussSprite, which adds velocity (incl. vertical) to every kPhysMove sprite
// in explosion proximity, alive or dead, decoupled from damage. Magnitude scales
// with size/mass/dist²; we collapse the mass/size term (all current dudes are
// human-sized) into velocityScale.
export const EXPLOSION_LAUNCH = {
  velocityScale: 0.028,     // impulse(≤900) → m/s; point-blank ≈ 25 m/s — NotBlood
                            // launches read VIOLENT: a survivor crosses the room
  upwardBias: 0.5,          // added to normalized radial dir y before re-normalize
                            // (ConcussSprite z-term: ground blast kicks dudes upward)
  falloffFloor: 0.45,       // launch speed never drops below this fraction of point-blank.
                            // NotBlood ConcussSprite is inverse-square with a 0x40000
                            // baseline — velocity stays strong out to the radius edge,
                            // which is what makes edge SURVIVORS fly comically. Without a
                            // floor, the survive-window (damage < hp) and launch-window
                            // (speed ≥ min) never overlap → launched-alive unreachable.
  minUpKickMps: 6.0,        // vertical-kick floor on every concussion launch — guarantees
                            // a readable slapstick arc (NotBlood's z-kick reads near-
                            // constant because the dz term is compressed >>4)
  minLaunchSpeedMps: 2.0,   // below this no ballistic launch — just normal stagger
  gravityMps2: 14,          // still heavier than real, but floaty enough to read the arc
  impactGibSpeedMps: 13,    // landing harder than this bursts the body (alive or dead) —
                            // NotBlood's fall/impact damage gibbing on hard landings
  wallRestitution: 0.45,    // launched bodies bounce off arena walls with this bounciness
  headSpawnHeightM: 1.4,    // head gib spawns at sprite top (NotBlood GetSpriteExtents top)
  headVelInherit: 0.5,      // head inherits half body velocity (NotBlood xvel>>1)
  headUpKickMps: 5.0,       // NotBlood zvel -0xccccc up-kick equivalent (explosion gib)
  headPopChance: 0.25,      // Chance(0x4000) — normal-death head-pop signature
  headPopUpKickMps: 3.5,    // gentler up-kick for the normal-death head-pop
} as const;

// ——— Ballistic arena bounds ————————————————————————————
// NOT derived — Blud-specific arena geometry. M1 arena is a 40×40 box
// (arena.ts floorSize=40, walls at ±20). Launched bodies reflect off the walls —
// NotBlood dudes bounce off geometry when concussed across a room. Inset by
// body radius so sprites don't clip walls.
export const BALLISTIC_BOUNDS = {
  minX: -19.5, maxX: 19.5,
  minZ: -19.5, maxZ: 19.5,
} as const;

// ——— Corpse persistence ————————————————————————————————
// NOT derived — Blud feel values. Source mechanic: NotBlood actor.cpp:7887
// DudeToGibCallback1 turns a dead dude into a kThingBloodChunks THING with
// health 8 (thingInfo[26]) and full gib vulnerability (data4=319); it persists
// and re-gibs on any later explosion. (NotBlood gives the corpse-thing health
// 8; Blud re-gibs corpses unconditionally instead, so no hp field here.)
export const CORPSE = {
  maxCorpses: 12,           // cluster cap — oldest corpse force-reaped beyond this
  reapAfterSec: 30,         // corpse lifetime before reap
} as const;

// ——— Dynamite throw ————————————————————————————————————
// NOT derived from tables — ported from Blood formulas (weapon.cpp:1215
// ThrowBundle, actor.cpp:7106 actFireThing, weapon.cpp:2218 charge formula).
// The tables module doesn't carry these; they live as inline arithmetic in C.
//
// Blood: nSpeed = mulscale16(throwPower, 0x177777) + 0x66666
//        xvel   = mulscale30(nSpeed, Cos(ang))   // Cos = costable[] (trig.h)
//        zvel   = mulscale14(nSpeed, slope + (-9460))
//
// CORRECTED 2026-06-17 (range felt far too short vs NotBlood). The OLD comment
// assumed Cos returns ±2^14 (the `sintable`), giving xvel ≈ nSpeed>>16 ≈ 30 →
// ~14 m/s. WRONG: Blood's Cos()/Sin() (trig.h) read `costable[]`, the 2^30
// high-precision table (costable[0] = 0x40000000). So mulscale30(nSpeed, Cos≈2^30)
// ≈ nSpeed. The thrown bundle is a kThing moved by MoveThing as `x += xvel>>12`
// per tic (actor.cpp:4423), with light airdrag (actAirDrag a2=128 ≈ 0.2%/tic,
// actor.cpp:6298) and gravity zvel+=58254/tic while airborne.
//
// Simulating that exact integer trajectory (see /tmp dyn_sim) gives the real
// horizontal RANGE, at Blud's 256 BU/m render scale:
//   min charge  ≈   3 m
//   half charge ≈  25 m
//   full charge ≈  68 m   (clears the 40 m arena — "throws a lot further")
// Blud's prior 14 m/s reached only ~17 m at full charge. NOTE we match the
// source RANGE, not its raw launch speed: Blood's physics scale ≠ its render
// scale (the sim's launch speeds/gravity read absurd in metres), and Blud's
// dynamite is a Rapier body under sane world gravity, so range ∝ v². The source
// is ~4× our old range → ~2× the launch velocity (below).
//
// PITCH BIAS: the a4 argument to actFireThing is `slope + (-9460)`. Blood's
// slope range is [-16384, +16384] for aim in [-90°, +90°]. The constant
// -9460 adds a fixed upward lob of arcsin(9460/16384) ≈ 35.3° above the
// player's aim vector, regardless of where they're looking. Ported as
// PITCH_LOB_DEG below.
export const DYNAMITE_COOK = {
  maxChargeSec: 2.0,          // 240 tics @ 120 TPS (matches Blood's divscale16 / 240)
  minVelocityMps: 6.0,        // tuned so min-charge range ≈ 3 m (source-simulated; range ∝ v²)
  maxVelocityMps: 28.0,       // tuned so full-charge range ≈ 68 m (source-simulated; was 14 → ~17 m)
  fuseMaxSec: 1.5,            // Blood weaponTimer-based fuse ≈ 50 tics ≈ 0.4s; Blud 1.5s for feel
                              // (used by alt-fire / drop / overcook self-explode; NOT primary throw)
  impactSafetyFuseSec: 5.0,   // Primary-fire impact-detonate: this is the in-flight fallback timeout
                              // for projectiles that never hit anything. Generous so a fully-cooked
                              // throw can clear the arena before fallback. Mirrors NotBlood's
                              // weapon.cpp:1221 Impact=1 path where fuseTime=-1 disables timed fuse.
  pitchLobDeg: 30,            // Blood port ≈ 35°, eased to 30° for our tighter arena scale
} as const;

// ——— Blood trail (FX_27) ————————————————————————————————
// NOT derived from tables — source is fx.cpp:89 (gFXData[27]) which the gen
// script does not emit (only explodeInfo/dudeInfo/thingInfo/gibList are codegen'd).
// Values ported from callback.cpp:180-192 (fxBloodSpurt scheduling) + fx.cpp:89.
export const BLOOD_TRAIL = {
  // — Source-faithful (NotBlood FX_27, callback.cpp:180-192 + fx.cpp:89) —
  emitHz: 20,                 // 6 tics @ 120 TPS → 20 Hz (per flying chunk)
  velScale: 1 / 256,          // Blood: xvel >> 8 = 1/256 inheritance
  lifetimeSec: 4.0,           // 480 tics @ 120 TPS — restored as the RUNTIME value:
                              // chunks.ts had hardcoded 2.5s, which made fewer
                              // droplets alive at once → trails read SPARSER than
                              // the NotBlood reference. 4s (source) keeps them dense.
  tile: 733,
  // — Raw Blood fixed-point refs (do NOT feed to runtime physics; see warning) —
  gravityBlood: 27962,        // BU/tic² raw
  airdragBlood: 4096,         // raw airdrag coefficient
  sizePx: 32,                 // 32×32 sprite (Blood xrepeat/yrepeat)
  // — Runtime/feel values used by the renderer (raw Blood values don't convert
  //   cleanly; hand-tuned for hang-time + on-screen density) —
  gravity: 5.0,               // was 6.0 — slightly more hang so droplets linger
  airdrag: 0.5,
  size: 0.22,                 // was 0.18 — reads denser at game distance
} as const;

// ——— Gib-moment radial burst (FX_13) ————————————————————
// NOT derived from tables — source is fx.cpp:75 (gFXData[13], the main
// blood-chunk spray at the gib instant) which the gen script does not emit.
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

// ——— Source-faithful gib chunk velocity scale ————————————————
// Blud feel knob (NOT derived). Multiplies the m/s velocities that come from the
// NotBlood gibSpawns table (death-outcome.ts spawnBodyChunks → outcome-adapter
// gibSpawnToMps) before they drive ChunkSystem bodies. 1.0 = pure source-faithful
// (the project owner's chosen default; raw NotBlood is fast — up to ~75 m/s
// horizontal, ~225 m/s vertical from the gibHuman atc/at10 spread bounds).
// Dial DOWN after playtest if chunks fly too hot.
export const GIB_CHUNK_VELOCITY_SCALE = 1.0;

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
  /**
   * Spawn the iconic kickable bouncing zombie head as part of this profile's
   * gib burst. Default true for the zombie profile (Blood signature). Cultists
   * and other non-zombie enemies should set this false — it looks weird seeing
   * a zombie head fly out of a cultist corpse.
   */
  spawnsKickableHead: boolean;
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

// Flesh picnums for humanoid enemies (torso, arm, leg, spine, misc). These are
// the deduped tiles of gibList[15] (gibHuman: 1454, 1267, 1268, 1269, 1456),
// kept as a curated literal rather than derived because the selection order
// matters for pickChunkPicnum's RNG indexing (a straight dedupe would reorder).
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

// gibHuman (gibList[15]) is the human gib set: zombie nGibType[0] = 15.
// Its thing list has 7 body-part entries — the source count for a full gib.
const GIB_HUMAN_PART_COUNT = gibList[15].things?.length ?? 7; // 7

export const ZOMBIE_GIB_PROFILE: GibProfile = {
  fleshPicnums: [...HUMANOID_FLESH_PICNUMS],
  bonePicnums: BONE_PICNUMS,
  boneWeight: 0.2,
  bodyPartCount: { min: 4, max: GIB_HUMAN_PART_COUNT }, // max derived from gibHuman
                             // (gib.cpp:188); min is a Blud feel value (fewer
                             // chunks on partial gibs) — NOT derived.
  chunkCount: { min: 8, max: 14 },
  spawnsKickableHead: true, // Blood signature — kickable zombie head
};

/**
 * Cultist gib profile — same flesh/bone picnums as zombie for now (F2.cultist.gibs
 * will eventually give cultists their own palette), but `spawnsKickableHead` is
 * disabled because cultists are not zombies and shouldn't drop zombie heads.
 * bodyPartCount is a deliberate Blud deviation (2-4) from the raw gibHuman
 * count (7) — cultists spawn fewer chunks; NOT derived.
 */
export const CULTIST_GIB_PROFILE: GibProfile = {
  fleshPicnums: [...HUMANOID_FLESH_PICNUMS],
  bonePicnums: BONE_PICNUMS,
  boneWeight: 0.2,
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
  spawnsKickableHead: false,
};

// ——— Axe zombie ————————————————————————————————————
// hp derived from dudeInfo[kDudeZombieAxeNormal] (raw C aggregate; dude.cpp).
// Movement/timing values are Blud feel — NOT derived.
const ZOMBIE = dudeInfo[KDude.kDudeZombieAxeNormal - KDude.kDudeBase]!;
export const AXE_ZOMBIE = {
  hp: ZOMBIE.startHealth,       // 60 (raw)
  meleeDamage: 10,              // aizomba.cpp hit damage — Blud feel value
  meleeRange: 1.5,            // m — ~sprite reach
  attackCooldownSec: 1.0,     // between swings
  speed: 3.0,                 // m/s — walk speed (shambler pace)
  aggroRadiusM: 40,           // when within this distance the zombie chases
  gibThresholdOverride: undefined as number | undefined, // use global GIB_THRESHOLD
} as const;

// ——— Shotgun cultist —————————————————————————————
// hp derived from dudeInfo[kDudeCultistShotgun] (raw C aggregate; dude.cpp).
// Fire/timing values are Blud feel ports of aicult.cpp — NOT derived.
const CULTIST_SHOTGUN = dudeInfo[KDude.kDudeCultistShotgun - KDude.kDudeBase]!;
export const SHOTGUN_CULTIST = {
  hp: CULTIST_SHOTGUN.startHealth, // 40 (raw)
  walkSpeedMps: 2.3,           // BU/tic 34952 → m/s
  aggroRadiusM: 18,            // half of see-dist (cultist sees better than zombie)
  fireRangeM: 12,              // stops moving and fires when within
  fireWindupSec: 0.5,          // 60 tics @ 120 TPS — how long Aim phase lasts
  fireCooldownSec: 1.5,        // delay after Recoil before next Fire
  recoilDurationSec: 0.4,      // how long Recoil phase lasts
} as const;

// ——— Shotgun blast (pellet projectile) ———————————
// NOT derived from tables — Blud feel ports of NotBlood weapon.cpp shotgun fire
// dmg + aicult.cpp cultistSFire pellet spread. The tables module has no weapon fields.
// TODO: cultist-specific gib palette (F2 follow-up) — reuse ZOMBIE_GIB_PROFILE for now
export const SHOTGUN_BLAST = {
  pelletCount: 7,              // canonical Blood shotgun pellet count
  pelletSpeedMps: 55,
  pelletMaxRangeM: 25,
  pelletDamage: 12,            // per pellet — 7 × 12 = 84 max if all hit
  spreadConeDeg: 14,           // half-angle of the pellet cone
} as const;

// ——— Flare gun ————————————————————————————
// NOT derived — Blud-specific weapon feel values (no raw table source).
export const FLARE_GUN = {
  raisingMs: 300,         // hold time before fire (no charge mechanic)
  muzzleVelMps: 25,       // initial projectile speed along camera-forward
  gravityMps2: 9.81,      // arc gravity (Y-axis down)
  ammoMax: 10,            // starting flare count
  // Safety fallback (defense in depth), NOT the primary despawn. A flare that
  // threads through all geometry can never live longer than this. The
  // per-frame floor/wall collision (flare.ts segment sweep) is the primary
  // despawn — matching NotBlood MoveMissile, where the floor hit is the
  // natural end (Blood has no flare timeout). 8s comfortably exceeds the
  // ~4.5s flight time of a max-range arc.
  maxLifetimeSec: 8,
} as const;

// ——— Tommygun cultist ———————————————————————————
// hp derived from dudeInfo[kDudeCultistTommy] (raw C aggregate; dude.cpp).
// Fire/timing values are Blud feel ports of aicult.cpp — NOT derived.
const CULTIST_TOMMY = dudeInfo[KDude.kDudeCultistTommy - KDude.kDudeBase]!;
export const TOMMY_CULTIST = {
  hp: CULTIST_TOMMY.startHealth, // 40 (raw)
  walkSpeedMps: 2.3,           // frontSpeed 46603 (same as shotgun cultist)
  aggroRadiusM: 18,
  fireRangeM: 12,
  fireWindupSec: 0.5,          // 60 tics @ 120 TPS (same aim cadence as shotgun)
  recoilDurationSec: 0.4,      // how long Recoil phase lasts after taking damage
} as const;

// ——— Tommygun bullet (kVectorBullet) ——————————
// NOT derived from tables — source is weapon.cpp kVectorBullet dmg=7 + spread
// formula (Random3(1200) horizontal jitter at 5120 units → half-angle).
export const TOMMY_BULLET = {
  damage: 7,
  // atan(1200 / 5120) * 180/π ≈ 13.2° half-angle cone
  spreadHalfAngleDeg: Math.atan(1200 / 5120) * (180 / Math.PI),
} as const;

// ——— Burn (applied by stuck flares) ————————
// NOT derived from tables — Blud feel values porting Blood actor.cpp fire/burn
// damage paths (kDamageBurn); generic DOT mechanic found across Blood's actor
// type handlers. The tables module has no burn-specific fields.
export const BURN = {
  durationSec: 6,                 // stuck flare burn lifetime
  dpsPerFlare: 8,                 // HP/s drained by each attached flare
  igniteDelaySec: 0.6,            // flare sticks → smoke → ignite after this delay
  panicSpeedMultiplier: 1.4,      // burning enemy thrashes at 1.4x base speed
  panicTargetRerollSec: 0.4,      // re-roll panic direction every 0.4s
  panicTargetRadiusM: 3,          // panic target picked within 3m of enemy
  zombieBurnSpeedMul: 0.8,        // burning zombie walks at 0.80× normal speed toward player
                                  // (kDudeBurningZombieAxe frontSpeed 46603 vs normal 58254)
  cultistBurnResetHp: 25,         // DELIBERATE DEVIATION — Blud HP cap on Burning state
                                  // entry. The raw NotBlood value is 30
                                  // (dudeInfo[40].startHealth for kDudeBurningCultist;
                                  // actor.cpp:3036 heals to it on burn transition), but 25
                                  // is kept so full-HP cultists don't outlast the burn window.
  groundFlameLifetimeSec: 4.0,    // ground-flame visual duration after burn-death
  groundFlameFadeSec: 0.5,        // ground-flame fade-out window (last N seconds)
  groundFlameSizeM: 0.6,          // ground-flame billboard size
} as const;

// ——— Wave runner ——————————————————————————
// NOT derived — Blud-specific wave pacing feel values.
export const WAVE_PRESETS = {
  breatherSec: 1.5,               // pause between waves once cleared
  zombieToughHpMultiplier: 2,     // 'zombie-tough' = 2x axe-zombie hp
} as const;
