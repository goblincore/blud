# Blood tuning values — extracted from NotBlood

Source: https://github.com/clipmove/NotBlood (GPL — used here for values only, not code).
Extracted: 2026-04-20.

This is a values-only reference: numeric constants (HP, damage, timers, speeds, angles)
pulled from NotBlood's source so they can serve as tuning starting points. Attribution is
per-line: `NotBlood <path>:<line>`.

## Units cheat-sheet

- **Tic rate**: `kTicRate = 120` tics/sec. `kTicsPerFrame = 4`, so `kTicsPerSec = 30` game-
  frames/sec. Many timers are in 120-Hz tics (divide by 120 for seconds); QAV-level and
  game-logic timers are generally in 120-Hz tics. `common_game.h:84-86`.
- **HP is stored `<<4`**: dude.cpp records `startHealth` as raw HP (e.g. 40), but the live
  value is `startHealth << 4`. All damage values passed to `actDamageSprite` are in that
  same 16ths scale. Integer HP = stored HP / 16.
- **Damage factor (resistance) is a scale-by-256 multiplier**: `curDamage[dmgType]` of
  256 = neutral, 128 = half damage, 512 = double. See `DUDEINFO.curDamage[]` below.
- **Speed units**: `frontSpeed`/`sideSpeed`/`backSpeed` on dudes and `frontAccel` on
  player postures are acceleration values in Build-fixed-point (pre-mulscale8 against
  player input). Angular speed `angSpeed` is in Build angle units per tic
  (Build circle = 2048 units). For reference, player stand `frontAccel = 0x4000 = 16384`;
  cultist `frontSpeed = 46603`.
- **Distances**: Build world units. `1024` ≈ one Blood "grid square". Sight ranges are
  typically `51200` (≈ 50 squares). Melee distances commonly `512` (~half-square).
- **Angles**: `kAng360 = 2048`, `kAng180 = 1024`, `kAng90 = 512`, `kAng45 = 256`.
- **Explosion impulse/"dmgType" field**: despite the name in the struct, this field is
  used as a concussion impulse scalar, not a `DAMAGE_TYPE` enum.
  See `actor.cpp:6498,6569` usage. Units are unscaled knockback impulse.

## The `DUDEINFO` record

Every enemy is a row in `dudeInfo[]` (`dude.cpp:28`). Fields (`dude.h:26-53`):

```
seqStartID, startHealth, mass, at6, clipdist, eyeHeight, aimHeight,
hearDist, seeDist, periphery, meleeDist, fleeHealth, hinderDamage,
changeTarget, changeTargetKin, alertChance, lockOut,
frontSpeed, sideSpeed, backSpeed, angSpeed,
nGibType[3], startDamage[7], curDamage[7], at8c, at90
```

- `startDamage[]` / `curDamage[]` are per-damage-type resistance/vulnerability
  multipliers (256 = normal; 0 = immune; <256 = resistant; >256 = extra-vulnerable).
  Damage types index order: `Fall, Burn, Bullet, Explode, Drown, Spirit, Tesla`
  (`actor.h:32-39`).
- `hinderDamage` is the "recoil/pain chance": once `cumulDamage >= hinderDamage<<4`,
  the dude plays the recoil animation (`ai.cpp:1460`).
- `changeTarget` / `changeTargetKin` are chance-out-of-scaled-damage to retarget
  (`ai.cpp:935-941`).
- `alertChance` = 32768 (50% in Blood's `Chance(x/65536)` scheme) for nearly every
  vanilla enemy.

`kDudeBase = 200`. Indices below are `type - kDudeBase`. `common_game.h:350-406`.

---

## Enemies

All rows reference `dude.cpp` line numbers for the opening `{` of that enemy's entry
in `dudeInfo[]`. Read the next ~28 lines to get the full record.

### Cultist with Tommygun (kDudeCultistTommy, type=201, idx=1)
NotBlood `dude.cpp:58`.
- HP: **40**
- Mass: 70
- Clipdist: 48
- Eye height: 41   Aim height: 20
- Hear distance: 10240   See distance: 51200   Periphery: 512 (~90°)
- Flee health: 10   Hinder (recoil) damage: **8** HP cumulative
- Change-target chance on hit: 256/65536 = 0.4%   same-type: 16/65536
- Alert chance: 32768/65536 = 50%
- Front speed: 46603   Side: 34952   Back: 13981   Ang speed: 256
- Damage resistances (`curDamage`, 256 = neutral): Fall 256, Burn 256, Bullet 96,
  Explode 256, Drown 256, Spirit 256, Tesla 192 — so cultists take **~0.375×** bullet
  damage (noticeably tanky to tommy), slightly resistant to tesla.

### Cultist with Sawed-off (kDudeCultistShotgun, idx=2)
NotBlood `dude.cpp:86`.
- HP: **40**, otherwise nearly identical to tommy cultist.
- Bullet resistance same 96/256.

### Zombie Axe (normal) (kDudeZombieAxeNormal, idx=3)
NotBlood `dude.cpp:114`.
- HP: **60**
- Mass: 70, Clipdist 48, Eye 46
- Front 58254, Side 46603, Back 34952, Ang 384 (faster turner than cultist)
- Hinder damage: 15   Alert chance: 32768
- Bullet resistance: 112/256 (~0.44×) — takes more bullet damage than cultists
- Fall 256, Burn 256

### Zombie Butcher (kDudeZombieButcher, idx=4)
NotBlood `dude.cpp:142`.
- HP: **80**
- Mass: **200** (heavy — harder to knock back)
- Front 23301, Side 23301, Back 13981 — noticeably slower than axe zombie
- Bullet: 32, Explode 128, Spirit 64, Tesla 128 — very bullet-resistant (~0.125×)

### Zombie Axe (buried) (kDudeZombieAxeBuried, idx=5)
NotBlood `dude.cpp:170`.
- HP: 60. Hear dist 5120 (half of normal).
- Periphery 341 (narrower), seeDist=0 (only hears).

### Gargoyle Flesh (kDudeGargoyleFlesh, idx=6)
NotBlood `dude.cpp:198`.
- HP: **110**
- Mass: 120, Clipdist 64, Eye 13
- Front 46603, Side 34952, Back 23301, Ang 384
- Hinder damage: 25 (harder to stagger)
- Fall 0, Burn 128, Bullet 48, Explode 208, Drown 256, Spirit 256, Tesla 256

### Gargoyle Stone (kDudeGargoyleStone, idx=7)
NotBlood `dude.cpp:226`.
- HP: **200**
- Mass: 200
- Hinder damage: 20
- Damage resistances: 0, 0, 10, 10, 0, 128, 64 — almost immune to bullets (10/256 ≈ 0.04×).

### Gargoyle Statue Flesh / Stone (idx=8, idx=9)
NotBlood `dude.cpp:254`, `dude.cpp:282`. HP 100 each, mostly stationary (front/side/back/ang = 0).

### Phantasm (kDudePhantasm, idx=10)
NotBlood `dude.cpp:310`.
- HP: **100**
- Mass: 70, Clipdist 64, Eye 25
- Front 58254, Side 46603, Back 34952, Ang 384 (fast + maneuverable)
- Hinder damage: 10
- Bullet resistance: 48/256 (~0.19×)

### Hellhound (kDudeHellHound, idx=11)
NotBlood `dude.cpp:338`.
- HP: **70**
- Mass: 120, Clipdist 80
- Eye 6
- Front 116508, Side 81555, Back 69905 — **very fast**, roughly 2.5× cultist speed
- Hinder damage: 20
- Periphery 682 (~120°)
- Bullet resistance 48/256, Burn 0 (immune), Fall 48

### Choking Hand (kDudeHand, idx=12)
NotBlood `dude.cpp:366`.
- HP: **10**
- Mass: 70, Clipdist 32, Eye 0
- Front 58254, Side 46603, Back 34952, Ang 384
- Bullet: 256, Burn 256 — no resistance; dies easy.

### Spiders (Brown / Red / Black / Mother) (idx 13–16)
NotBlood `dude.cpp:394`, `422`, `450`, `478`.
- HP: **10 / 25 / 75 / 100**
- Mass: 5, 10, 20, 40 respectively (very light — kick-punts them)
- Periphery 682 for all
- Mother spider HP is hard-coded to be overridden at spawn: `actor.cpp:2595`
  `dudeInfo[kDudeSpiderMother-kDudeBase].startHealth = bHalfMotherSpiderHp ? 50 : 100;`

### Bloated Butcher (Gill Beast / Bone Eel family are separate; NotBlood has Gill Beast as idx=17)
The classic "Bloated Butcher" is the Zombie Butcher variant above (idx=4). If you meant the
Cerberus-adjacent bloated enemy, see Cerberus below. Gill Beast:

### Gill Beast (kDudeGillBeast, idx=17)
NotBlood `dude.cpp:506`.
- HP: **50**
- Mass: 200, Clipdist 64, Eye 37
- Hinder 10, Bullet 48, Burn 80

### Bone Eel (kDudeBoneEel, idx=18)
NotBlood `dude.cpp:534`. HP 25.

### Bat (kDudeBat, idx=19)
NotBlood `dude.cpp:562`. HP 10. Mass 5.

### Rat (kDudeRat, idx=20)
NotBlood `dude.cpp:590`. HP 10. Mass 5. Hear 10240, See 25600.

### Pod Green (kDudePodGreen, idx=21) / Fire (idx=23) / Mother (idx=25)
NotBlood `dude.cpp:618` (Green HP 50), `674` (Fire HP 100), `730` (Mother HP 200).
All immobile (frontSpeed=0), clipdist 64, periphery 1024 (full 180°).

### Tentacles Green / Fire / Mother (idx=22, 24, 26)
NotBlood `dude.cpp:646`, `702`, `758`. HP 10 / 20 / 50.

### Cerberus Two-Head (kDudeCerberusTwoHead, idx=27)
NotBlood `dude.cpp:786`.
- HP: **200**
- Mass: 1000
- Clipdist 64, Eye 29, Aim 10
- Front 69905, Side 58254, Back 46603 — slower than hellhound but still fast
- Hear dist 40960   See dist 102400 (much further than standard)
- Bullet resistance 16/256 (~0.06× — very tough)

### Cerberus One-Head (kDudeCerberusOneHead, idx=28)
NotBlood `dude.cpp:814`. HP 100.

### Tchernobog (kDudeTchernobog, idx=29)
NotBlood `dude.cpp:842`.
- HP: **32** (comment says "// 800," — vanilla internal value is 32; NotBlood exposes
  `bMaxTchernobogHp` which overrides to 255 at `actor.cpp:2596`).
- Mass: 1500, Clipdist 128
- Bullet resistance: 1/256 — effectively immune to bullets.
- Explode 4/256, Drown 0.

### Cultist Tommy Prone / Shotgun Prone / Tesla / TNT / Beast (idx=30, 46, 47, 48, 49)
- Tommy Prone: `dude.cpp:870`, HP 25
- Shotgun Prone: `dude.cpp:1318`, HP 25
- Cultist Tesla: `dude.cpp:1346`, HP 40
- Cultist TNT: `dude.cpp:1374`, HP 40
- Cultist Beast: `dude.cpp:1402`, HP 40

### Burning variants
- Burning Innocent (idx=39): `dude.cpp:1122`, HP 25
- Burning Cultist (idx=40): `dude.cpp:1150`, HP 30
- Burning Zombie Axe (idx=41): `dude.cpp:1178`, HP 12
- Burning Zombie Butcher (idx=42): `dude.cpp:1206`, HP 25
- Burning Tiny Caleb (idx=52): `dude.cpp:1486`, HP 10
- Burning Beast (idx=53): `dude.cpp:1514`, HP 25

### Innocent (kDudeInnocent, idx=45)
NotBlood `dude.cpp:1290`. HP 100.

### Tiny Caleb (kDudeTinyCaleb, idx=50)
NotBlood `dude.cpp:1430`. HP 10.

### Beast (kDudeBeast, idx=51)
NotBlood `dude.cpp:1458`. HP **120**. Front 116508 (very fast). Hinder 10.
- `nGibType` overrides: gib type 7 (blood), Beast-specific body sprite.

### Player template (for completeness)
NotBlood `dude.cpp:1573`. Human mode:
- HP: **100**   Mass: 70   Clipdist 48
- Hear 0x800 = 2048   See 0xc800 = 51200   Periphery 0x155 = 341
- Hinder 10   Tesla damage mult: 0x120/256 = 1.125× (takes more tesla damage).

### Difficulty scaling
`actor.cpp:2493` `int DudeDifficulty[5] = { 512, 384, 256, 208, 160 };`
Applied as `curDamage[j] = mulscale8(DudeDifficulty[gGameOptions.nEnemyHealth], startDamage[j])`
at `actor.cpp:2620`. "Well Done" (index 0) doubles damage taken by enemies (scale 512/256);
"Extra Crispy" (index 4) reduces it to 160/256 ≈ 0.625×.

---

## Weapons — hit-scan / melee (the `gVectorData` table)

`VECTORDATA` struct (`actor.h:156-166`):
```
dmgType, dmg, impulse, maxDist, fxChance, burnTime, bloodSplats, splatChance, surfHit[15]
```

- `dmg` is the base damage (passed as `dmg<<4` to `actDamageSprite`), so a dude with
  neutral bullet resistance takes `dmg` raw HP per hit.
- `impulse` is the knockback velocity delta scalar (Build fixed-point; 65536 = 1.0).
- `maxDist` is the vector range in world units (0 = unlimited within a sector).

All rows defined in `actor.cpp:79-701`.

### Pitchfork (kVectorTine = 0)
- dmg: **17**, impulse: **174762** (~2.66× "normal"), maxDist: 1152 (~1.1 squares — melee)
- fxChance: 10240, bloodSplats: 1, splatChance: 20480
- Source: `actor.cpp:82-106`
- Fire pattern (primary): 4 "tines" per swing at x-offsets `(2*i-3)*40 ∈ {-120,-40,40,120}`,
  with random angular jitter `Random2(2000)` (3 axes).
  Source: `weapon.cpp:1150-1154`.

### Flare Gun (missile — see missile table below)

### Sawed-off Shotgun pellets — single barrel (kVectorShell = 1)
- dmg: **4**, impulse: 65536 (~1.0), maxDist: 0 (unlimited, any sector)
- fxChance: 8192, bloodSplats: 1, splatChance: 12288
- Source: `actor.cpp:108-133`
- Pellet count (single): **16 pellets** (`n = nTrigger<<4` with `nTrigger=1`)
  Source: `weapon.cpp:1307`
- Spread: each pellet offset `Random3(1500)` XY, `Random3(500)` Z. Source: `weapon.cpp:1319-1321`
- Base total damage per shot: 16 × 4 = 64 (before resistance).

### Sawed-off Shotgun pellets — double barrel (kVectorShellAP = 4)
- dmg: **6**, impulse: 87381 (~1.33×), maxDist: 0
- Source: `actor.cpp:190-215`
- Pellet count (double): **32 pellets** (`nTrigger=2`, `n = 2<<4 = 32`). Source: `weapon.cpp:1307`
- Spread: `Random3(2500)` XY, `Random3(1500)` Z. Source: `weapon.cpp:1326-1328`
- Base total damage per shot: 32 × 6 = 192 (before resistance).

### Bullet (generic — used by cultist Tommygun AI, kVectorBullet = 2)
- dmg: **7**, impulse: 21845 (~0.33×), maxDist: 0
- Source: `actor.cpp:135-161`

### Tommygun AP (akimbo / spread alt, kVectorTommyAP = 3)
- dmg: **20**, impulse: 65536, maxDist: 0
- Source: `actor.cpp:163-188`

### Tommygun regular (primary fire, kVectorTommyregular = 5)
- dmg: **12**, impulse: 65536, maxDist: 0
- fxChance: 16384, bloodSplats: 1, splatChance: 12288
- Source: `actor.cpp:217-242`
- Fire pattern (primary): 1 shot/tic with jitter `Random3(400)` vertical, `Random3(1200)` horizontal.
  Source: `weapon.cpp:1394-1402`
- Akimbo spread: fires two barrels at offsets ±120. Source: `weapon.cpp:1404-1418`

### Bat Bite (AI, kVectorBatBite = 6)
- dmg: **4**, impulse: 0, maxDist: 921 (melee-ish)
- Source: `actor.cpp:244-269`

### Bone-Eel Bite (kVectorBoneelBite = 7)
- dmg: **12**, impulse: 0, maxDist: 1177. Source: `actor.cpp:271-296`

### Gill-Beast Bite (kVectorGillBite = 8)
- dmg: **9**, impulse: 0, maxDist: 1177. Source: `actor.cpp:298-323`

### Beast Slash (player Beast mode / AI Beast melee, kVectorBeastSlash = 9)
- dmg: **50**, dmgType: **kDamageExplode**, impulse: 43690, maxDist: 1024
- **Note**: uses `kDamageExplode` — subject to the gib threshold rule (see gib section).
- Source: `actor.cpp:325-350`

### Axe (Zombie axe) (kVectorAxe = 10)
- dmg: **18**, impulse: 436906 (~6.67×, strongest knockback), maxDist: 1024
- Source: `actor.cpp:352-377`

### Cleaver (Zombie butcher) (kVectorCleaver = 11)
- dmg: **9**, impulse: 218453 (~3.33×), maxDist: 1024
- Source: `actor.cpp:379-404`

### Phantasm Slash (kVectorGhost = 12)
- dmg: **20**, impulse: 436906, maxDist: 1024
- Source: `actor.cpp:406-431`

### Gargoyle Slash (kVectorGargSlash = 13)
- dmg: **16**, impulse: 218453, maxDist: 1024
- Source: `actor.cpp:433-458`

### Cerberus Bite / Hack (kVectorCerberusHack = 14)
- dmg: **19**, impulse: 218453, maxDist: 614
- Source: `actor.cpp:460-485`

### Hellhound Bite (kVectorHoundBite = 15)
- dmg: **10**, impulse: 218453, maxDist: 614
- Source: `actor.cpp:487-512`

### Rat Bite (kVectorRatBite = 16)
- dmg: **4**, impulse: 0, maxDist: 921. Source: `actor.cpp:514-539`

### Spider Bite (kVectorSpiderBite = 17)
- dmg: **8**, impulse: 0, maxDist: 614. Source: `actor.cpp:541-566`

### Tchernobog Burn (kVectorTchernobogBurn = 20)
- dmg: **2**/tic, dmgType: **kDamageBurn**, burnTime: 15, range 0
- Source: `actor.cpp:621-646`

### Voodoo 1.0 fallback vector (kVectorVoodoo10 = 21)
- dmg: **25**, dmgType: **kDamageSpirit**. Source: `actor.cpp:648-673`

### Generic Dude Punch (NOONE_EXTENSIONS, kVectorGenDudePunch = 22)
- dmg: **37**, dmgType: **kDamageFall**, impulse: 874762, maxDist: 620
- Source: `actor.cpp:675-700`

---

## Weapons — player projectile / special

### Flare (primary, `kMissileFlareRegular`)
- Fired by `FireFlare` — 1 missile, ammo cost 1. Visibility kick 30. `weapon.cpp:1553-1571`.
- On hit, flare lodges in target and burns them over time.

### Flare alt-fire (`kMissileFlareAlt` — grenade-like air burst)
- Fired by `AltFireFlare` — 1 missile, **ammo cost 8**. Visibility kick 45.
- On explode uses `kExplosionFireball` (radius 120, small damage). `weapon.cpp:1573-1591`,
  `actor.cpp:5972-5978`.

### Voodoo Doll (primary, `FireVoodoo`)
- Uses `kDamageSpirit`, damage varies by state (trigger-minus-1 picks branch):
  - Case 0 (normal): **17 HP** spirit damage. `weapon.cpp:1613`.
  - Case 1 (WeaponLower target): **9 HP**. `weapon.cpp:1621`.
  - Case 2 (blind effect): **11 HP**. `weapon.cpp:1639`.
  - Case 3 (big hit): **49 HP**. `weapon.cpp:1631`.
  - Case 4 (self-damage backfire): 1<<4 = 1 HP. `weapon.cpp:1600`.
- Ammo cost: `nDamage/4` per hit.

### Voodoo Doll (alt-fire, `AltFireVoodoo`)
- Dumps all remaining ammo (up to 51200 u range) on multiple targets, damage scales
  with ammoCount: `nDamage = ((ammo<<1) + Random2(ammo>>3)) << 4`, then distance-falls off
  to 0 at 51200. See `weapon.cpp:1707-1738`.
- 1.0x "classic" behaviour in `weapon.cpp:1660-1703`.

### Tommygun (primary via `FireTommy`)
- 1 shot at base, 2 shots akimbo, 5× per trigger on quad-damage.
  Spread per shot: `Random3(400)` vertical, `Random3(1200)` horizontal.
- Source: `weapon.cpp:1345-1423`.
- Uses `kVectorTommyregular` → 12 dmg per bullet (see above).

### Sawed-off — handled above.

### Napalm Launcher
- `FireNapalm` (primary, single): 1 × `kMissileFireballNapalm`. Ammo cost 1. `weapon.cpp:1822-1846`
- `FireNapalm2` (akimbo double shot): 2 missiles at ±120 offset. Ammo 2. `weapon.cpp:1848-1868`
- `AltFireNapalm` (napalm ball/blob): thrown thing `kThingNapalmBall`,
  data4 = `ClipHigh(ammoCount, 12)` napalm fragments, initial burn 600 tics (5 sec).
  `weapon.cpp:1870-1888`.
- Explosion type on impact: `kExplosionNapalm` (radius 150, dmg 20±10, impulse 800, burn 5).
  `actor.cpp:5965` + `explodeInfo[7]`.

### Tesla Cannon
- `FireTesla` primary — fires `kMissileTeslaRegular` (id 306), ammo cost **1**.
  Akimbo uses `teslaMissile[]` at `weapon.cpp:1778-1786`.
- `AltFireTesla` — fires `kMissileTeslaAlt` (id 302), ammo cost **35**. Visibility 40.
  `weapon.cpp:1811-1819`.
- Chain damage from tesla alt: see `weapon.cpp:3089,3108` — `actDamageSprite(..., kDamageTesla, nDamage<<4)`.

### Life Leech
- Primary: fires `kMissileLifeLeechRegular`, ammo cost **1**. Random jitter r1/r2/r3
  `Random2(2000)`/2000/1000. `weapon.cpp:1890-1912`.
- If out of ammo, self-damages for 16 (`kDamageSpirit`).
- Alt-fire (drop): spawns a `kThingDroppedLifeLeech` sentry with HP **2400** (150<<4
  implied; NotBlood lowers this to `(75 + hp/2)<<4` when `WeaponsNotBlood()`).
  `weapon.cpp:1914-1951`.

### Pitchfork (primary) — handled above (kVectorTine, 17 dmg × 4 tines).

### Pitchfork alt-fire / charge (NotBlood mod)
- Hold alt-fire to charge; when released at >50% power plays special sfx, and if
  player has quad-damage + max charge, spawns a `kMissileFireball`. `weapon.cpp:1122-1148`.
- Charge rate: 210 ticks to full (240 with quad-damage). `weapon.cpp:2217`.

### Aerosol Spray Can
- `FireSpray` (primary): 1 × `kMissileFlameSpray` per trigger, ammo cost 4 per burst.
  `weapon.cpp:1157-1169`.
- Thrown can (alt): `ThrowCan` spawns `kThingArmedSpray`, explosion type `kExplosionSpray`
  (radius 180, dmg 10±10, impulse 40, burn 10 tics).
  `weapon.cpp:1171-1188`, `actor.cpp:6008-6012`, `explodeInfo[4]`.
- Throw velocity: `mulscale16(throwPower, 0x177777) + 0x66666`. `weapon.cpp:1174`.

### Dynamite / TNT (primary = single stick, alt = bundle)
- **Single TNT stick** (`kThingArmedTNTStick`): explosion type `kExplosionSmall`
  → radius 75, damage 10±10, impulse 450. `actor.cpp:5987-5992`, `explodeInfo[0]`.
- **TNT Bundle** (`kThingArmedTNTBundle`): `kExplosionStandard`
  → radius 150, damage 20±10, impulse 900. `actor.cpp:5994-6006`, `explodeInfo[1]`.
- **Proximity bomb** (`kThingArmedProxBomb`): `kExplosionStandard` as above; arm delay
  240 tics (2 sec). `weapon.cpp:1252`.
- **Remote bomb** (`kThingArmedRemoteBomb`): `kExplosionStandard`; triggered by player.
- **Fuse time**: default fuse = `pPlayer->weaponTimer` at time of throw (i.e. the
  remaining time in the current QAV animation). Special: setting `pPlayer->fuseTime = -1`
  causes impact-on-contact detonation (`weapon.cpp:1220-1221`).
- Throw velocity: `mulscale16(throwPower, 0x177777) + 0x66666`. Same formula for all
  thrown ordinance. `weapon.cpp:1215, 1249, 1266`.
- Max throw charge time: 240 tics (2 sec) to full 65536 power. `weapon.cpp:2166-2167`.
- Barrel explosion (`kThingTNTBarrel`): `kExplosionLarge`
  → radius 225, damage 40±15, impulse 1350. `actor.cpp:6014-6032`, `explodeInfo[2]`.

---

## Explosion table (`explodeInfo[]` at `actor.cpp:2288-2377`)

Struct (`actor.h:136-147`) — fields read in order:
`repeat (sprite size), dmg, dmgRng (±), radius (world-units), impulse/"dmgType"
 (concussion scalar), burnTime, ticks (life), quakeEffect, flashEffect`.

| # | Name | repeat | dmg | ±rng | radius | impulse | burn | life | quake | flash |
|---|------|--------|-----|------|--------|---------|------|------|-------|-------|
| 0 | Small (TNT stick) | 40 | 10 | 10 | **75** | 450 | 0 | 60 | 80 | 40 |
| 1 | Standard (Bundle/Prox/Remote) | 80 | 20 | 10 | **150** | 900 | 0 | 60 | 160 | 60 |
| 2 | Large (TNT barrel) | 120 | 40 | 15 | **225** | 1350 | 0 | 60 | 240 | 80 |
| 3 | Fireball (flare alt, Cerberus FB) | 80 | 5 | 10 | 120 | 20 | 10 | 60 | 0 | 40 |
| 4 | Spray can | 120 | 10 | 10 | 180 | 40 | 10 | 60 | 0 | 80 |
| 5 | (unused?) | 160 | 15 | 10 | 240 | 60 | 10 | 60 | 0 | 120 |
| 6 | (unused?) | 40 | 20 | 10 | 120 | 0 | 10 | 30 | 60 | 40 |
| 7 | Napalm | 80 | 20 | 10 | 150 | 800 | 5 | 60 | 160 | 60 |

- **Damage curve vs distance**: Damage scales linearly down by distance inside the
  `radius` (see `actor.cpp:6456-6500` — `radius` is the hard cutoff; damage is
  attenuated by a `scale(size, r-dist, r)` factor in practice).
- **Gib threshold interaction**: explosion damage passed to `actDamageSprite` uses
  `kDamageExplode`. A single-hit damage ≥ 160 (internal 16ths — i.e. 10 HP raw) causes
  the target to skip the normal death sequence and instead play the "explode/gib"
  sequence (see below).

---

## Gib thresholds — THE KEY NUMBER

From `actor.cpp:3563`:
```
actKillDude(nSource, pSprite,
    ((damageType == kDamageExplode && damage < 160) ? kDamageFall : damageType),
    damage);
```

- **The rule**: after damage is scaled by the enemy's `curDamage[damageType]`, if the
  kill-blow is an explode-type hit AND the **post-resistance damage is ≥ 160 (internal)**
  = **10 raw HP** of explode damage in a single hit, then `actKillDude` receives
  `kDamageExplode` and plays the gib sequence (nSeq=2). Otherwise the death reverts to
  `kDamageFall` (nSeq=1, normal death animation).
- "10 raw HP of explode damage" sounds tiny, but remember resistances: e.g. Gargoyle
  Stone's Explode resistance is 10/256, so the attacker has to deal ~256 unscaled before
  that gargoyle will gib; Cultist (Explode 256/256) gibs easily.
- Gib-animation dispatch with secondary gib-spawn is in `actor.cpp:3199, 3208, 3217,
  3222, 3235, 3249, 3252, 3281, 3445, 3456`. Several enemies also call `GibSprite(...)`
  with a gib-type to spew visible chunks.
- `kDamageBurn` and other deaths use nSeq=3 (burn death) — no gib chunks.
- Burning-variant enemies (`kDudeBurning*`) force `damageType = kDamageExplode` in their
  kill handler regardless of the actual kill damage type, guaranteeing gibs.
  Sources: `actor.cpp:3244`, `3259`, `3280`, `3444`, `3455`.

### Zombie axe "head pop" trick
- Zombie Axe has a 50% chance (`Chance(0x4000)`) on a regular spirit-damage kill to
  **detach the head as a gib** while the body keeps flailing (nSeq=1 branch at
  `actor.cpp:3206-3217`).

---

## Knockback impulses per weapon hit

Summarized from the `impulse` field of each `VECTORDATA` row. All values are Build
fixed-point (65536 ≈ 1.0 speed-unit-per-tic). Higher = more punt.

| Attack / weapon | Impulse |
|---|---|
| Pitchfork tine | 174762 |
| Shotgun shell (single) | 65536 |
| Shotgun shell AP (double) | 87381 |
| Tommy bullet (generic) | 21845 |
| Tommy AP (akimbo) | 65536 |
| Tommy regular (primary) | 65536 |
| Beast slash | 43690 |
| Zombie axe | **436906** (highest knockback) |
| Butcher cleaver | 218453 |
| Phantasm slash | 436906 |
| Gargoyle slash | 218453 |
| Cerberus bite | 218453 |
| Hellhound bite | 218453 |
| Rat / bat / spider / gill / eel bite | 0 (no knockback) |
| Generic dude punch (ext) | 874762 |
| Explosion (Small/Bundle/Large) | 450 / 900 / 1350 |

Explosion knockback is also applied directly via `ConcussSprite` with the explosion's
impulse field. `actor.cpp:6498-6499`.

---

## Refire, reload, and AI attack timers

Weapon fire rhythms are driven by QAV animation lengths (`weaponQAV[n]->at10`
total-ticks) in `weapon.cpp`. NotBlood doesn't expose a tidy "refire time" constant per
weapon — the tic count is embedded in the QAV data file. The player `weaponTimer`
counts down by `kTicsPerFrame = 4` per frame (`weapon.cpp:2389`), and on reaching 0 the
next cycle begins.

### AI attack state cooldowns (ticks @ kTicRate=120)
These are explicit, searchable constants. Format: `AISTATE { stateType, seqID,
callbackID, stateTicks, ... }` from `aicult.cpp:60-97` et al.

| State | stateTicks (@120Hz) | Source |
|---|---|---|
| `cultistSFire` (shotgun cultist fires, then chase) | 60 (0.5 sec) | `aicult.cpp:80` |
| `cultistSThrow` (shotgun cultist throws TNT) | 120 (1.0 sec) | `aicult.cpp:71` |
| `cultistTThrow` / `cultistTsThrow` (Tommy/Tesla throw TNT) | 120 (1.0 sec) | `aicult.cpp:70, 72` |
| `cultistTFire` / `cultistTsFire` (tommy/tesla fire loop) | 0 (continuous) | `aicult.cpp:81-82` |
| `cultistDodge` | 90 (0.75 sec) | `aicult.cpp:66` |
| `cultistGoto` | 600 (5 sec) | `aicult.cpp:67` |
| `cultistSearch` | 1800 (15 sec) | `aicult.cpp:79` |
| `cultistRecoil` | 0 (plays until seq ends) | `aicult.cpp:87` |
| `genRecoil` (generic pain) | 20 (0.17 sec) | `ai.cpp:76` |

### Cultist accuracy scaling (difficulty)
`aicult.cpp:108-110` — shotgun cultist hitscan jitter:
`dx += Random3((5 - nDifficulty) * 1000);`
So on Well Done (nDifficulty=0) jitter = ±5000 units; on Extra Crispy (4) = ±1000 (tight).

### Cultist Tesla fire chance by difficulty
`ai.cpp:78`:
`int gCultTeslaFireChance[5] = {0x2000, 0x4000, 0x8000, 0xa000, 0xe000};`
(Still Kicking: 12.5%, Pink on the Inside: 25%, Lightly Broiled: 50%, Well Done: 62.5%, Extra Crispy: 87.5%.)

### Cultist TNT throw pattern
`aicult.cpp:218-220` — on difficulty >2 (Well Done / Extra Crispy) cultists throw
**bundles** instead of single sticks.

---

## Dynamite / thrown-thing behaviour

- **Fuse timer**: set from `pPlayer->weaponTimer` at release (end of the QAV). In
  practice ~120–240 tics depending on hold duration. Setting `fuseTime = -1` makes
  the stick/bundle detonate on first impact. `weapon.cpp:1220-1223, 2154, 2170, 2728`.
- **Hold-to-cook**: while holding alt, `throwPower = clip((gFrameClock - throwTime) /
  240, 65536)` — 240 tics (2 sec) to max power. `weapon.cpp:2166`.
- **Fuse countdown while held**: throwing with `fuseTime = weaponTimer` means the fuse
  is already ticking during the cook — so cooked dynamite explodes sooner after
  release.
- **Throw velocity**: `mulscale16(throwPower, 0x177777) + 0x66666`. So min velocity at
  0% = 0x66666 ≈ 6.25 units, max at 100% = 0x66666 + 0x177777 ≈ 21.9 units (Build-per-tic).
  `weapon.cpp:1215`.
- **Proximity bomb arm time**: 240 tics = 2 sec. `weapon.cpp:1252`.
- **Radius/damage**: see explosion table row 1 (Standard): **radius 150, damage 20±10,
  impulse 900**.

---

## Player

All from `gPostureDefaults[kModeMax][kPostureMax]` at `player.cpp:150-179`.
`POSTURE` fields (`player.h:90-106`):
`frontAccel, sideAccel, backAccel, pace[0] pace[1], bobV, bobH, swayV, swayH,
 eyeAboveZ, weaponAboveZ, xOffset, zOffset, normalJumpZ, pwupJumpZ`.

### Normal human — Stand (`player.cpp:154`)
- frontAccel = **0x4000 = 16384**
- sideAccel = 16384
- backAccel = 16384
- pace: walk=14, run=17 (these are bob-cadence values, not speed)
- bobV=24, bobH=16, swayV=32, swayH=80
- eye-above-Z = 0x1600 = 5632
- weapon-above-Z = 0x1200 = 4608
- x/z view offset = 0xc00, 0x90
- **normalJumpZ = -0xbaaaa = -764586** (Z velocity on jump)
- **pwupJumpZ (Jump Boots) = -0x175555 = -1529173** (~2× height)

### Normal human — Swim (`player.cpp:155`)
- front/side/back accel = 0x1200 = 4608 (underwater drag)
- normalJumpZ = 0x5b05 = 23301 (descend while holding jump)

### Normal human — Crouch (`player.cpp:156`)
- front/side/back accel = 0x2000 = 8192 (half speed)
- pace: 22 / 28 (heavier bob cadence)
- normalJumpZ = 0, pwupJumpZ = 0 (no jumping crouched)

### "Normal beast" posture (Beast-mode polymorph, `player.cpp:161-164`)
- Same accel/jump values as normal human — no speed boost.

### Shrink / Grow postures (`player.cpp:168-178`)
- Shrink stand: frontAccel = 10384, normalJumpZ = -564586, pwupJumpZ = -1329173
- Grow stand: frontAccel = 19384, normalJumpZ = -1014586, pwupJumpZ = -1779173

### Player drag / gravity
- `gDudeDrag = 0x2a00 = 10752` — generic dude drag coefficient. `actor.cpp:2379`.
- Gravity isn't a single scalar — applied per-physics-frame via `zvel += gravityStep`
  in `actor.cpp` / `gameutil.cpp` movement paths.

### Spin180 speed
- `player.cpp:2139`: `const int speed = (posture == kPostureSwim) ? 64 : 128;` per tic.
  So the 180° spin takes ~1024/128 = 8 tics ≈ 67 ms standing.

### Handicap multipliers (applied to player incoming damage)
`player.cpp:146-148`: `int Handicap[] = { 144, 208, 256, 304, 368 };`
256 = neutral, 144 = tough (0.56×), 368 = fragile (1.44×). Index into player's difficulty
setting.

### Player HP
- Start: **100 HP** (from player's DUDEINFO row `dude.cpp:1578`).
- Life-essence powerup: +20 HP up to **100** cap. `gPowerUpInfo[09]` @ `player.cpp:102`.
- Life-seed: +100 HP up to **200** cap. `gPowerUpInfo[10]` @ `player.cpp:103`.
- Doctor's bag: +100 up to 100. Medicine pouch: +50 up to 100.

### Ammo caps (`gAmmoInfo[]`, `player.cpp:181-194`)
| index | max | notes |
|---|---|---|
| 1 | 100 | flare pistol |
| 2 | 100 | shotgun shells |
| 3 | 500 | tommygun bullets |
| 4 | 100 | napalm |
| 5 | 50 | TNT sticks/bundles |
| 6 | 2880 | spray can fuel |
| 7 | 250 | tesla |
| 8 | 100 | life leech |
| 9 | 100 | voodoo |
| 10 | 50 | prox |
| 11 | 50 | remote |

### Player damage-type resistance (from player DUDEINFO template, `dude.cpp:1599`)
`0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0x120` — all 1.0× except Tesla = 1.125× (so
players take slightly extra tesla damage — see the "Tesla cultists are scary" design).

### Armor data (`player.cpp:204-210`)
`armorData[5]`: columns appear to be max/step-size per armor slot. The default "basic
armor" row = `{0x320, 0x640, 0x320, 0x640, 0x320, 0x640}` = max absorb 800/1600 per type.

---

## Corpse / burn / life-cycle timers

- **Burn time cap**:
  `pXSprite->burnTime = ClipHigh(pXSprite->burnTime + nTime, isDude ? 2400 : 1200);`
  `actor.h:211-215`. So dudes burn at most 2400 tics (20 sec); things burn at most 1200
  (10 sec).
- **Burn tick decrement**: `burnTime -= kTicsPerFrame` each frame (`actor.cpp:4232`).
- **Napalm alt-fire initial burn**: 600 tics (5 sec) applied to the thrown ball itself.
  `weapon.cpp:1882`.
- **Corpse persistence / despawn**: corpses persist indefinitely in vanilla Blood —
  there is no global "decay timer". Corpses can be *kicked* into gibs via
  `actKickObject` (`actor.cpp:4055`). No numerical gib-despawn constant found outside
  of sprite slot reuse.
- **Proximity bomb arming**: 240 tics (2 sec). `weapon.cpp:1252`.
- **Life-leech drop state timer**: 120 tics (1 sec) between `kCallbackLeechStateTimer`.
  `weapon.cpp:1932`.
- **Voodoo drop arming**: 90 tics. `weapon.cpp:1759`.
- **Zombie axe head-spurt sfx / blood**: `data1 = 35; data2 = 5;` on detach
  (`actor.cpp:3211-3212`).
- **Post-death hit-to-explode (on already-dying)**: when a dude's HP ≤ 0 and an explode
  hit lands with damage ≥ 160, their death sequence upgrades to gib. Same rule as above.

---

## Powerup durations (@120Hz tics)

`gPowerUpInfo[]` at `player.cpp:92-144`. Columns: `pickupSound, pickupOnce, bonusTime, maxTime`.

| Powerup | bonusTime (tics / ≈sec) | maxTime (tics / ≈sec) |
|---|---|---|
| Doctor's bag (07) | 100 | 100 |
| Medicine pouch (08) | 50 | 100 |
| Life essence (09) | 20 | 100 |
| Life seed (10) | 100 | 200 |
| Red potion (11) | 2 | 200 |
| Feather fall (12) | 3600 / **30 s** | 432000 |
| Cloak invis (13) | 3600 / **30 s** | 432000 |
| Death mask (14) | 3600 / **30 s** | 432000 |
| Jump boots (15) | 3600 / **30 s** | 432000 |
| Guns akimbo / Quad (17) | 3600 / **30 s** | 1728000 |
| Diving suit (18) | 3600 / **30 s** | 432000 |
| Gas mask (19) | 3600 / **30 s** | 432000 |
| Crystal ball (21) | 3600 / **30 s** | 432000 |
| Reflective shots (24) | 3600 / **30 s** | 432000 |
| Beast vision (25) | 3600 / **30 s** | 432000 |
| Delirium shroom (28) | 900 / **7.5 s** | 432000 |
| Asbestos armor (39) | 3600 | 432000 |

---

## Missile base definitions (`missileInfo[]` at `actor.cpp:1505`)

Struct (`actor.h:125-134`): `picnum, velocity, angleOfs, xrepeat, yrepeat, shade, clipDist`.

Not reproduced in full (it's a large per-sprite table). Interesting entries you'll want
if implementing projectile physics include:
- `kMissileBase = 300` — butcher knife
- `kMissileFlareRegular = 301`
- `kMissileTeslaAlt = 302`
- `kMissileFlareAlt = 303`
- `kMissileFlameSpray = 304`
- `kMissileFireball = 305`
- `kMissileFireballNapalm = 307`
- `kMissileLifeLeechRegular = 315`
- See `common_game.h:408-430` for the full enum.

Missile `velocity` is Build-per-tic fixed-point. To dig each specific missile's speed,
read `actor.cpp:1505-1700` for the full table.

---

## Gaps / couldn't find

- **Explicit numerical refire rates per weapon**: embedded in QAV animation length
  data, not as a table of constants. The `weaponQAV[n]->at10` value is loaded from the
  QAV asset. NotBlood uses `kQAVEnd = 126` and the qav files are in game data, not
  source. You can infer refire from watching the animation loop length.
- **Corpse despawn timer**: Blood does not appear to have a universal corpse decay
  timer. Corpses persist until level end or they're kicked/explosion-gibbed. If this
  existed it would be in `actor.cpp` and `gPost` queue handling, but none of the
  constants searched map to a decay TTL.
- **Pain chance as probability**: Blood uses a cumulative-damage model rather than a
  per-hit Chance() roll. `hinderDamage` is a threshold in HP (not a probability),
  triggering recoil when `cumulDamage >= hinderDamage<<4`. See `ai.cpp:1460`.
- **Per-weapon spread cone in degrees**: NotBlood stores spread as rectangular
  `Random3(N)` jitter on the 3D vector, not as a half-angle. Converting to degrees
  requires a distance assumption: e.g. shotgun single-barrel XY jitter `±1500` at
  range ~1024 ≈ tan⁻¹(1500/1024) ≈ ±56° (but these are actually pitch-offsets applied
  to a unit-length direction vector of scale 65536, so real spread cone ≈ ±tan⁻¹(1500/
  65536) ≈ ±1.3°). Check the actual vector usage in `actFireVector`.
- **Knockback for explosions on player**: `ConcussSprite` is called with the `impulse`
  field of the explosion — see `actor.cpp:6498`. The actual velocity delta formula
  (distance-fall-off of the impulse) is in `ConcussSprite` (not further extracted
  here).
- **Beast-mode player pitchfork / claw stats**: uses `kVectorBeastSlash` (dmg 50,
  explode type) — already listed.
- **Napalm launcher primary impact damage**: handled via
  `NapalmSeqCallback` → per-fragment missile damage — table of per-frame damage not
  extracted here (embedded in seq callbacks).
- **Dynamite damage-falloff curve specifics**: the exact linear-vs-quadratic model is
  in `actor.cpp:6456-6500` — not reproduced verbatim here, but the radius cutoff is
  hard (`explodeInfo[type].radius`), and falloff uses `scale(..., radius-dist, radius)`
  i.e. **linear falloff from full-damage at center to 0 at radius**.

---

## Further-reading pointers

Most of the "meat" sits in these files (lines are from NotBlood master, 2026-04):
- `source/blood/src/dude.cpp:28-1571` — full `dudeInfo[]` table (54 enemy records)
- `source/blood/src/actor.cpp:79-701` — `gVectorData[]` (23 hit-attack types)
- `source/blood/src/actor.cpp:2288-2377` — `explodeInfo[]` (8 explosion types)
- `source/blood/src/actor.cpp:1147-1700` — ammo/weapon-item/missile tables
- `source/blood/src/weapon.cpp:1106-1960` — per-weapon `Fire*` functions
- `source/blood/src/player.cpp:92-210` — powerups / postures / handicap / armor
- `source/blood/src/ai.cpp:78, 914-1460` — AI damage / hinder / difficulty hooks
- `source/blood/src/ai*.cpp` per-enemy — AISTATE definitions with explicit cooldowns

End of extracted values.
