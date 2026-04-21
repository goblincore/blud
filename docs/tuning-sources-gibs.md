# Blood gib sprite picnums — extracted from NotBlood

Source: https://github.com/clipmove/NotBlood (GPL — values only, not code).
Extracted: 2026-04-21.

Companion to [`tuning-sources.md`](./tuning-sources.md). Pulls the concrete
tile numbers (picnums) that Blood spawns as body gibs, wall debris, blood
droplets, etc. when a dude dies to overkill damage or the gore/spray callbacks
fire.

## Two-tier gib system

Blood has **two independent gib-spawn paths**, both dispatched by
`GibSprite(spritetype*, GIBTYPE, pos, vel)` in `gib.cpp:435`:

1. **`GIBFX` entries** → spawn short-lived FX sprites through `gFX.fxSpawn()`.
   The `FX_ID` identifies an index into `gFXData[]` in `fx.cpp:61`. Each FX
   row has its own `picnum`, gravity, airdrag, lifetime, pal. These are the
   **small chunky bits** (blood drips, glass shards, wood splinters, sparks,
   bubbles).
2. **`GIBTHING` entries** → spawn full physics *Thing* sprites via
   `actSpawnThing()`. The `at0` field is a `kThing*` type (heavier, collides,
   persists). The `at4` field is an **explicit picnum override** that
   replaces the thing's default tile. These are the **actual body gibs**
   (arms, legs, skulls, torsos, eyeballs).

Both flavours are assembled per gib-type in `gibList[]` (`gib.cpp:227`),
indexed 0…30 (`enum GIBTYPE` in `gib.h:26`). `kGibMax = 31`.

## GIBTYPE dispatch table (gibList[])

From `gib.cpp:227-259`. Format: `GIBTYPE_n → fx_set × count + thing_set × count`.

| GIBTYPE | Contents | Used for |
|---|---|---|
| 0  | `gibFxGlassT` ×2 (FX_18 shard, FX_31 chunk) | glass T-shapes |
| 1  | `gibFxGlassS` ×1 (FX_18) | glass small |
| 2  | `gibFxBurnShard` ×1 (FX_16) | burn debris |
| 3  | `gibFxWoodShard` ×1 (FX_17) | wood debris |
| 4  | `gibFxMetalShard` ×1 (FX_30) | metal debris |
| 5  | `gibFxFireSpark` ×1 (FX_14) | burning deaths |
| 6  | `gibFxShockSpark` ×1 (FX_15) | tesla / lightning |
| 7  | `gibFxBloodChunks` ×1 (FX_13, picnum **2154**) | **generic blood spray** — the most-common enemy gib. |
| 8  | `gibFxBubblesS` ×1 (FX_25) | underwater small |
| 9  | `gibFxBubblesM` ×1 (FX_24) | underwater medium |
| 10 | `gibFxBubblesL` ×1 (FX_23) | underwater large |
| 11 | `gibFxIcicles` ×1 (FX_31) | ice |
| 12 | `gibFxGlassCombo1` ×2 | window break |
| 13 | `gibFxGlassCombo2` ×5 (multi-coloured glass) | stained glass |
| 14 | `gibFxWoodCombo` ×3 | heavy wood break |
| **15** | `gibHuman[]` ×7 **THINGS** | **human-sized dude overkill (cultist, zombie, innocent, player)** — see below |
| 16 | `gibFxMedicCombo` ×4 | medic kit explode |
| 17 | `gibFxFlareSpark` ×1 (FX_28) | flare burn |
| 18 | `gibFxBloodBits` ×1 (FX_13, reduced chance) | light blood spray |
| **19** | `gibFxRockShards` ×2 (FX_46 **2406**, FX_31 **2620**) | **stone gargoyle** crumble |
| 20 | `gibFxPaperCombo1` ×2 (paper + fire) | paper burn |
| 21 | `gibFxPlantCombo1` ×3 (plant chunks + fire) | vegetation |
| 22 | `gibFx13BBA8` ×1 (FX_49) | dirt puff |
| 23 | `gibFx13BBC0` ×1 (FX_50) | dirt puff variant |
| 24 | `gibFx13BBD8` ×2 (FX_50 + FX_15) | dirt + spark |
| 25 | `gibFx13BC04` ×1 (FX_32) | unnamed |
| 26 | `gibFx13BC1C` ×1 (FX_56) | puff |
| **27** | `gibAxeZombieHead` ×1 **THING** | **axe-zombie decapitation** (picnum **3405**) |
| **28** | `gibMime[]` ×6 **THINGS** | **phantasm/mime-tier dude** |
| **29** | `gibHound[]` ×4 **THINGS** | **hell hound** |
| **30** | `gibFleshGargoyle[]` ×5 **THINGS** | **flesh gargoyle** |

Only types 15, 27, 28, 29, 30 spawn persistent body-chunk tiles. The rest are
transient FX sprites (still valuable for blood-spray feel but short-lived).

## Body-gib thing tables (picnums you can pull from ART)

All from `gib.cpp:189-225`. Each row is `{kThingType, picnum, chance, vx, vz}`.
Chance `917504 / 65536 ≈ 14x` — internal "Chance()" weight; `65536 = 100%`.
`425 = kThingBloodBits`, `427 = kThingZombieHead`.

### `gibHuman[]` — GIBTYPE_15 (cultists, zombies, innocents, player)
`gib.cpp:189-197`

- picnum **1454** — torso/rib cage A (spawned ×2, certain)
- picnum **1267** — head/skull (spawned ×2, certain)
- picnum **1268** — arm (certain)
- picnum **1269** — leg (certain)
- picnum **1456** — spine/chunk (certain)

Seven entries total, ~5 distinct picnums (1454 and 1267 appear twice to
boost spawn density).

### `gibMime[]` — GIBTYPE_28 (phantasm / mime / pale dude)
`gib.cpp:199-206`. Uses pale-variant tiles.

- picnum **2405** — mime torso (×2, certain)
- picnum **2404** — mime head (certain)
- picnum **1268** — arm (50% chance, `32768`)
- picnum **1269** — leg (50% chance)
- picnum **1456** — spine (50% chance)

### `gibHound[]` — GIBTYPE_29 (hell hound)
`gib.cpp:208-213`

- picnum **1326** — hound-specific chunk (certain)
- picnum **1268** — arm/paw (50%)
- picnum **1269** — leg (50%)
- picnum **1456** — spine (50%)

### `gibFleshGargoyle[]` — GIBTYPE_30 (flesh gargoyle)
`gib.cpp:215-221`

- picnum **1369** — gargoyle torso (certain)
- picnum **1361** — gargoyle head/chunk (certain)
- picnum **1268** — arm (50%)
- picnum **1269** — leg (50%)
- picnum **1456** — spine (50%)

### `gibAxeZombieHead[]` — GIBTYPE_27 (decapitation)
`gib.cpp:223-225`. Spawns one `kThingZombieHead` (type 427) which is itself
animated and has its own AI (rolls around, can be kicked).

- picnum **3405** — severed zombie head (bouncing, interactive)

### Unique body-gib picnums (deduplicated)

Thirteen distinct body tiles cover every dude gib:

| Picnum | Role | TILES*.art |
|---|---|---|
| 1267 | head/skull | tiles004.art (1267 / 256 = 4) |
| 1268 | arm | tiles004.art |
| 1269 | leg | tiles004.art |
| 1326 | hound chunk | tiles005.art |
| 1361 | gargoyle head | tiles005.art |
| 1369 | gargoyle torso | tiles005.art |
| 1454 | torso/rib cage | tiles005.art |
| 1456 | spine | tiles005.art |
| 2404 | mime head | tiles009.art |
| 2405 | mime torso | tiles009.art |
| 3405 | zombie head (bouncing) | tiles013.art |

Plus the **blood-bits sprite** pool that most dude deaths also spawn via FX:

| Picnum | Role | Source |
|---|---|---|
| **2154** | blood chunk (FX_13) | `fx.cpp:75` — main blood splat tile |
| 2269 | fire spark (FX_14) | `fx.cpp:76` |
| 1720 | shock spark (FX_15) | `fx.cpp:77` |
| 2280 | burn shard (FX_16) | `fx.cpp:78` |
| 3135 | wood shard (FX_17) | `fx.cpp:79` |
| 3261 | glass shard (FX_18) | `fx.cpp:80` |
| 3265 | glass shard colour A (FX_19) | `fx.cpp:81` |
| 3269 | glass shard colour B (FX_20) | `fx.cpp:82` |
| 3273 | glass shard colour C (FX_21) | `fx.cpp:83` |
| 3277 | glass shard colour D (FX_22) | `fx.cpp:84` |
| 1128 | bubble (FX_23/24/25) | `fx.cpp:85-87` |
| 1131 | bubble variant (FX_26) | `fx.cpp:88` |
|  733 | blood splat (FX_27) | `fx.cpp:89` |
| 2261 | flare spark (FX_28) | `fx.cpp:90` |
| 2185 | metal shard (FX_30) | `fx.cpp:92` |
| 2620 | icicle (FX_31) | `fx.cpp:93` |
| 2078 | plant chunk A (FX_44) | `fx.cpp:106` |
| 1106 | plant chunk B (FX_45) | `fx.cpp:107` |
| 2406 | rock shard (FX_46) | `fx.cpp:108` |
| 3511 | paper shred (FX_47) | `fx.cpp:109` |
|  926 | smoke puff (FX_56) | `fx.cpp:117` |

## Per-enemy gib assignments (dudeInfo[].nGibType[3])

Extracted from `dude.cpp` — 55 dudes, 22-field struct header, then
`nGibType[3]` (three-wide array; `-1` means unused). See `dude.h:48`.

Human-tier enemies use **15** (`gibHuman[]` — arms/legs/torso/spine):

- kDudeCultistTommy (201) → 15, -1, -1
- kDudeCultistShotgun (202) → 15, -1, -1
- kDudeZombieAxeNormal (203) → 15, -1, -1
- kDudeZombieButcher (204) → 15, -1, -1
- kDudeZombieAxeBuried (205) → 15, -1, -1
- kDudeCultistTommyProne (230) → 15, -1, -1
- kDudePlayer1..8 (231-238) → 15, -1, -1
- kDudeCultistReserved (243) → 15, -1, -1
- kDudeZombieAxeLaying (244) → 15, -1, -1
- kDudeInnocent (245) → 15, -1, -1
- kDudeCultistTesla (247) → 15, -1, -1
- kDudeCultistTNT (248) → 15, -1, -1
- kDudeCultistBeast (249) → 15, -1, -1

Note: zombies use the **same gibHuman pool** as cultists. There is **no
zombie-specific body-gib set**. The only zombie-specific gib is
`gibAxeZombieHead` (GIBTYPE_27), but that's triggered explicitly by
decapitation sequences in `actor.cpp:3204,3217,3267`, not by the overkill
pathway.

Non-human enemies use **7** (`gibFxBloodChunks` — no solid chunks, only
blood-spray FX):

- kDudeHand (212), Spider* (213-216), GillBeast (217), BoneEel (218),
  Bat (219), Rat (220), Pod*/Tentacle* (221-226), Cerberus (227-228),
  Tchernobog (229), TinyCaleb (250), Beast (251), BurningTinyCaleb (252),
  BurningBeast (253) → 7, -1, -1

Burning human variants stack FX:

- kDudeBurningInnocent (239) → 7, 5, -1 (blood + fire sparks)
- kDudeBurningCultist (240) → 7, 5, -1
- kDudeBurningZombieAxe (241) → 7, 5, -1
- kDudeBurningZombieButcher (242) → 7, 5, -1
- kDudeCultistShotgunProne (246) → 7, 5, -1

Gargoyles:

- kDudeGargoyleFlesh (206) → **30**, -1, -1 (gibFleshGargoyle — with distinct torso/head 1369/1361)
- kDudeGargoyleStone (207) → **19**, -1, -1 (gibFxRockShards — stone crumble, no body parts)
- kDudeGargoyleStatueFlesh (208) → -1, -1, -1 (no gib)
- kDudeGargoyleStatueStone (209) → -1, -1, -1
- kDudePhantasm (210) → -1, -1, -1 (phantasm doesn't pre-emit gibs; mime set 28 is used by other code paths if any)

Hound:

- kDudeHellHound (211) → **29**, -1, -1 (gibHound)

Call site: `actor.cpp:3467-3468`

```
if (pDudeInfo->nGibType[i] > -1)
    GibSprite(pSprite, (GIBTYPE)pDudeInfo->nGibType[i], NULL, NULL);
```

Loop runs 3x per overkill death, one per slot in the `nGibType[3]` array.

## Other hardcoded GibSprite() call-sites (actor.cpp)

Not dudeInfo-driven — these are triggered by specific events:

- `actor.cpp:2847` — kThingBloodChunks (flying gib) hitting water/wall → GIBTYPE_5 (fire spark? likely a typo in original — worth checking what type 5 spawns for that case; it's actually `gibFxFireSpark`).
- `actor.cpp:3204, 3217, 3267` — axe zombie decap → GIBTYPE_27 (spawn zombie head 3405).
- `actor.cpp:3248, 3490` — mid-hit sprays → GIBTYPE_7 (blood chunks).
- `actor.cpp:3604, 3657, 6030` — combo effects → GIBTYPE_14 (wood combo — probably for breakable props).
- `actor.cpp:3645` — tesla/electrical → GIBTYPE_6 (shock spark).
- `actor.cpp:3652` — metal shards → GIBTYPE_4.
- `actor.cpp:3805` — missile impact → GIBTYPE_24.
- `actor.cpp:3821` — missile impact (sparks) → GIBTYPE_6.
- `actor.cpp:3895, 6873, 6889` — flare → GIBTYPE_17.
- `actor.cpp:4016` — wall hits → GIBTYPE_22 or GIBTYPE_23 (dirt puffs).
- `actor.cpp:5970..6084` — kThingKickablePail, barrels, etc. breaking → GIBTYPE_5 (sparks on break).
- `actor.cpp:6109-6113` — `kThingObjectGib` uses sprite's own xrepeat/yrepeat/ang as gib-type indices (shifted by -1). This is Blood's mapper-controlled "custom gibbable object" feature.

## ART file location for each picnum

Each `TILES0NN.ART` covers tiles `[N*256, N*256+255]` (256 tiles per file).
Compute: `N = picnum / 256`.

**Body-gib pool (GIBTYPE_15/27/28/29/30 thing picnums):**
- tiles004.art: 1267, 1268, 1269
- tiles005.art: 1326, 1361, 1369, 1454, 1456
- tiles009.art: 2404, 2405
- tiles013.art: 3405

**FX / blood-spray pool (most-common in-flight "gibs"):**
- tiles002.art: 733 (blood splat)
- tiles003.art: 926 (smoke puff)
- tiles004.art: 1106 (plant), 1128/1131 (bubbles)
- tiles006.art: 1720 (shock spark)
- tiles008.art: 2078 (plant), **2154 (blood chunks — the hero tile)**, 2185 (metal shard), 2261 (flare), 2269 (fire), 2280 (burn)
- tiles009.art: 2406 (rock), 2620 (icicle)
- tiles012.art: 3135 (wood), 3261, 3265, 3269, 3273, 3277 (glass family)
- tiles013.art: 3511 (paper)

**Total distinct gib picnums: 32** (11 body things + 21 FX sprites).

## Gaps / notes

- I did not trace kThingBone (421) — it's a Thing type used for wall-bone
  decoration and isn't in the dude-overkill pathway. If you want "bones on
  the floor" sprites, it lives in the Things section of `common_game.h:451`
  with its own picnum defined elsewhere in ART metadata.
- The `FX_13` blood chunk sprite at picnum 2154 is multi-frame (40×40 repeat,
  shade -12, gravity 46603, airdrag 2048, lifetime 480 tics = 4s). In Blood
  the tile itself has multiple orientations defined by `picanm` data in the
  ART — not reflected in picnum alone. When ripping frames expect 2154-2168
  range to be a flipbook.
- GIBTYPE constants are anonymous (`GIBTYPE_0..GIBTYPE_30`) — NotBlood never
  gave them semantic names. Maintainers' comments in gibList[] confirm the
  purpose inference above, but some (22/23/25/26) remain `gibFx13B*` with
  hex-address-style names from decompiled Blood source.
- `gibMime[]` (GIBTYPE_28) is defined but nothing in vanilla dudeInfo[] uses
  it. Phantasm (210) has `-1,-1,-1`. It's likely reached through a custom
  (nnexts) path or kThingObjectGib mapper trigger.
- `kDudeVanillaMax = 254` has gib triple `7, -1, 18` — that's a placeholder
  "generic monster" template for modded dudes (blood chunks + light blood
  bits).
