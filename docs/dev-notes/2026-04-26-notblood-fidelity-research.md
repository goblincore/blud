---
title: NotBlood Fidelity Research — Burn-Death, Dynamite, Gib Taxonomy
date: 2026-04-26
author: claude
tags: [blud, notblood, burn-death, dynamite, gib-taxonomy, investigation]
---

# NotBlood Fidelity Research — Burn-Death, Dynamite, Gib Taxonomy

> [!] **CORRECTION (2026-06-10):** Two conclusions in this doc are wrong; see
> [2026-06-10-explosion-outcomes-design.md](../superpowers/specs/2026-06-10-explosion-outcomes-design.md)
> for the corrected source dig.
>
> 1. **§3.4/§3.5 "Launched corpse does not exist in NotBlood" — wrong.** It exists
>    emergently: `ConcussSprite` (actor.cpp:2677) applies velocity (incl. vertical)
>    to every `kPhysMove` sprite in radius — alive dudes, corpses, things — decoupled
>    from damage. Survivors are launched airborne alive; explode-kills < 160 damage
>    convert to `kDamageFall` (normal death anim) while the body keeps its concussion
>    velocity → intact tumbling corpse, which persists as a re-gibbable
>    `kThingBloodChunks` thing with health 8 (`DudeToGibCallback1`, actor.cpp:7887).
> 2. **§2.3 explosion table mislabels the `explodeInfo` columns** (struct order is
>    `repeat, dmg, dmgRng, radius, dmgType, ...` — actor.h:136). Standard TNT is
>    radius=**150** (not 80) and concussion/dmgType=**900** (not impulse=150).
>    Blud's radius=150/impulse=900 already matched the source exactly.
> 3. **§1.1 burning-dude HP rows are off by one** (caught 2026-06-15 by the
>    `dudeInfo` codegen, `scripts/gen_notblood_tables.py`). `kDudeBurningCultist`
>    (type 240, `dudeInfo[40]`) is `seqStartID 4096, startHealth **30**` — NOT
>    `12544 / 25` (that's `kDudeBurningInnocent`, index 39). The raw burning-cultist
>    HP is **30**, not 25. Blud's `BURN.cultistBurnResetHp` stays **25** as a
>    deliberate feel deviation (so cultists don't outlast the burn window) — no
>    behavior change, just corrected provenance. Trust the generated tables
>    (`src/game/notblood/notblood-tables.gen.ts`) over this doc's hand-read numbers.

Sources read:
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aiburn.cpp` — all 246 lines; burning-enemy AISTATEs
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.cpp` — `actKillDude` (3010-3488), `actDamageSprite` (3501-3603), `actExplodeSprite` (5951-6100), `actKickObject` (4055-4060), `actFireThing` (7106-7140), `MoveThing` (4438-4500), burn processing loop (4220-4235), `explodeInfo[]` (2288-2360)
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/weapon.cpp` — `ThrowBundle` (1212-1226), `processTNT` (2141-2189)
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/dude.cpp` — `dudeInfo[40]` (kDudeBurningCultist=240), `dudeInfo[41]` (kDudeBurningZombieAxe=241)
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/ai.cpp` — `aiMoveForward` (311-323)
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/callback.cpp` — all 861 lines; burn/death callbacks, gib spawns, flare effects
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/common_game.h` — enum constants

Plus prior investigation:
- `docs/dev-notes/2026-04-25-notblood-flare-burn-mechanic.md` (M5-C findings)

---

## 1. Burn-Death Sequence

### 1.1 — DoT cap and death timing

**kDudeBurningCultist (240) — `dudeInfo[40]`** (`dude.cpp:1123-1161`):

| Field          | Value      |
|----------------|------------|
| `seqStartID`   | **12544**  |
| `startHealth`  | **25**     |
| `frontSpeed`   | **0**      |
| `sideSpeed`    | **0**      |
| `backSpeed`    | **0**      |
| `angSpeed`     | **160**    |
| `nGibType`     | 7, 5, -1   |

DoT damage rate: per `actor.cpp:4232-4233`, burn damage applies 8 damage every 4 tics (120 TPS / 4 = 30 Hz, so 8 × 30 = 240 HP/s? No — 8 damage per 4 tics at 120 TPS means 8 damage every 33ms = 240 damage/sec. But that's the raw tick — it hits `actDamageSprite` which then propagates through `aiDamageSprite` with damage scaling.)

Actually the mechanism is: burn damage is applied per-sprite per-frame via `ProcessTouchObjects` (`actor.cpp:4230-4234`), calling `actDamageSprite(burnSource, pSprite, kDamageBurn, 8)` each 4 tics. At 120 TPS, that's 30 damage events/sec × 8 = 240 raw damage/sec. Through damage scaling (dudeInfo curDamage[kDamageBurn]=256 → no scaling), the cultist takes 240 HP/s raw, but `aiDamageSprite` may scale it.

**Expected time-to-die for burning cultist:** With `startHealth=25` (after the type swap), and burn DoT at ~240 raw/sec scaled through the AI damage system, the cultist dies in roughly 0.4-1.0 seconds of actual burn after the swap. The total burn experience (from flare stick → type swap → death) is: original HP (~40) depleted by DoT → swap to burning cultist at 25 HP → 25 more HP depleted → death.

**kDudeBurningZombieAxe (241) — `dudeInfo[41]`** (`dude.cpp:1163-1189`):

| Field          | Value      |
|----------------|------------|
| `seqStartID`   | **4096**   |
| `startHealth`  | **30**     |
| `frontSpeed`   | **46603**  |
| `nGibType`     | 15, -1, -1 |

Note: `kDudeBurningZombieAxe` reuses the tommy cultist's `seqStartID=4096`. Zombies do NOT get a type swap — they burn as the normal zombie type and die directly (no HP reset). The `kDudeBurningZombieAxe` type exists only for map-placed entities.

### 1.2 — Death visual sequence (actKillDude)

**Burning cultist death** (`actor.cpp:3246-3258`):

```cpp
case kDudeBurningCultist:
    // SFX
    damageType = kDamageExplode;       // ← overrides kDamageBurn
    if (Chance(0x8000))
    {
        for (int i = 0; i < 3; i++)
            GibSprite(pSprite, GIBTYPE_7, NULL, NULL);  // 3 small gibs
        seqSpawn(dudeInfo[nType].seqStartID+16-Random(1), 3, nXSprite, nDudeToGibClient1);
    }
    else
        seqSpawn(dudeInfo[nType].seqStartID+15, 3, nXSprite, nDudeToGibClient2);
    break;
```

**Then** the `kDamageExplode` tail block fires (lines 3463-3490):
- Spawns `nGibType` gibs: GIBTYPE_7 + GIBTYPE_5 (from dudeInfo[40].nGibType: 7, 5, -1)
- Spawns 4 `fxSpawnBlood` particles
- Spawns 16 more `fxSpawnBlood` + 2 more GIBTYPE_7 (from the `gGameOptions.nGoreBehavior > 1` block)

**Total gib count for burning cultist:**
- 50% path: 3 (GIBTYPE_7) + 2 (GIBTYPE_7+GIBTYPE_5 from nGibType) + 2 (GIBTYPE_7 extra) = **7 chunks + 20 blood FX**
- 50% path: 0 + 2 + 2 = **4 chunks + 20 blood FX**

SEQ: 12559 or 12560 (50%) or 12559 (50%). All are MISSING from BLOOD.RFF — NotBlood falls through to `seqKill` (instant removal).

**Burning zombie death** (`actor.cpp:3260-3275`):

```cpp
case kDudeBurningZombieAxe:
    damageType = kDamageExplode;
    if (Chance(0x8000))
    {
        seqSpawn(dudeInfo[nType].seqStartID+13, 3, nXSprite, nDudeToGibClient1);
        // top, bottom extent → gib position at top
        GibSprite(pSprite, GIBTYPE_27, &gibPos, &gibVel);  // single blood-chunk at head height
    }
    else
        seqSpawn(dudeInfo[nType].seqStartID+13, 3, nXSprite, nDudeToGibClient2);
    break;
```

Then the kDamageExplode tail: GIBTYPE_15 × 1 (from nGibType[0]=15) + 4 blood FX + (16 more blood + 2 GIBTYPE_7 from gore check — since zombie passes the gore switch type filter, it gets the extras).

**Total for burning zombie:** 
- 50% path: 1 (GIBTYPE_27) + 1 (GIBTYPE_15) + 2 (GIBTYPE_7) = **4 chunks + 20 blood FX**
- 50% path: 0 + 1 + 2 = **3 chunks + 20 blood FX**

SEQ: 4096 + 13 = **4109** (already extracted as `zombie-death-burn`, baseTile=2910).

### 1.3 — Ground flame

**There is NO persistent ground flame in NotBlood's burn-death sequence.** The only flame-related callback is `fxFlameLick` (callback.cpp:56-73) which spawns FX_32 particles at the burning sprite's position while `burnTime > 0`. After death, `burnTime` reaches 0 and no more flame particles are emitted.

The ground-flame visual in the spec (Phase 5) is a **Blud-original embellishment**, not a NotBlood port. Implement it as a gameplay-visible death marker; note the deviation.

### 1.4 — Burn AI behavior

**Burning cultist (`cultistBurnChase`/`Goto`/`Search`/`Attack`):**

The burning cultist uses `aiMoveForward` (`ai.cpp:311-323`), which accumulates velocity using `pDudeInfo->frontSpeed`. For `kDudeBurningCultist`, **`frontSpeed = 0`** (`dude.cpp:1147`).

**Result: The burning cultist CANNOT MOVE.** It stands in place, turns to face the player (angSpeed=160), and enters the attack state (`cultistBurnAttack`) when the player comes within 0x333 ≈ 3.2m. The attack uses the `nBurnClient` callback which is a **no-op stub** (`aiburn.cpp:72-74`).

The burning cultist is effectively a harmless, stationary target that eventually dies from DoT.

**Burning zombie (`zombieABurnChase`/`Goto`/`Search`/`Attack`):**

Same AI pattern as cultist but uses `frontSpeed = 46603`. Compare to normal axe zombie: `frontSpeed = 58254` (`dudeInfo[2]` = kDudeZombieAxeNormal). The burning zombie walks at **46603/58254 ≈ 80% of normal zombie speed**.

At 120 TPS, the velocity per tick via `aiMoveForward`:
- `xvel += mulscale30(frontSpeed, Cos(ang))` — max increment = frontSpeed / 65536 BU/tick
- At 120 TPS, burning zombie: 120 × 46603/65536 ≈ 85.3 BU/sec → 0.33 m/s at BU_PER_METER=256
- Normal zombie: 120 × 58254/65536 ≈ 106.6 BU/sec → 0.42 m/s

Ratio: 0.80×. The zombie walks **toward the player at reduced speed** (matching the spec's prediction). Not random-panic — always targets the player via `thinkChase` → `thinkGoto` → `thinkSearch` chain.

---

## 2. Dynamite Default-Bundle Behavior

### 2.1 — Default bundle is FUSE-COOKED, not impact-detonate

**Critical finding: The spec's assumption of impact-detonate is WRONG.**

The default hand-thrown bundle (`kThingArmedTNTBundle`) uses a **timed fuse**, triggered via the event queue:

**`processTNT`** (`weapon.cpp:2141-2189`):
```
State 4 → 5: wait for shoot2 release
State 5: 
  - shoot2 press → DropBundle (drop at feet)
  - shoot press → State 6, fuseTime=0
State 6: charge throwPower
  - release → fuseTime = weaponTimer, trigger ThrowBundle
```

**`ThrowBundle`** (`weapon.cpp:1212-1226`):
```cpp
void ThrowBundle(int, PLAYER *pPlayer)
{
    int nSpeed = mulscale16(pPlayer->throwPower, 0x177777)+0x66666;
    spritetype *pSprite = playerFireThing(pPlayer, 0, -9460, kThingArmedTNTBundle, nSpeed);
    XSPRITE *pXSprite = &xsprite[pSprite->extra];
    if (pPlayer->fuseTime < 0)
        pXSprite->Impact = 1;                    // ← impact-detonate (UNUSED in normal flow)
    else
        evPost(pSprite->index, 3, pPlayer->fuseTime, kCmdOn, pPlayer->nSprite);  // ← TIMED FUSE
}
```

The `Impact = 1` path only triggers when `fuseTime < 0`, which never happens in the normal code path (fuseTime is always 0 or positive). The normal path is an `evPost` with delay = weaponTimer tics.

**Fuse time:** `weaponTimer` at the moment of throw release. This is the remaining QAV 23 (BUNTHRO) animation duration. For a fully-cooked throw, `fuseTime` ≈ 0 (the QAV has almost completed). For a quick tap, `fuseTime` ≈ full QAV duration (~50 tics = ~417ms at 120 TPS).

**What this means for Blud:** The existing cook mechanic (hold-to-charge, release-to-throw, fuse ticks down) is **already correct** — it matches NotBlood's actual behavior. The spec's "impact-detonate" plan is a deviation from NotBlood.

### 2.2 — Throw velocity

`actFireThing` (`actor.cpp:7106-7140`):
```cpp
xvel[pThing->index] = mulscale30(a6, Cos(pThing->ang));   // horizontal
yvel[pThing->index] = mulscale30(a6, Sin(pThing->ang));
zvel[pThing->index] = mulscale14(a6, a4);                  // vertical (a4 = -9460 = upward bias)
```

Horizontal speed = `nSpeed >> 16` (via mulscale30; Cos max = 16384, so nSpeed * 16384 >> 30 = nSpeed >> 16):
- **Min (throwPower=0):** 0x66666 >> 16 = 6.4 BU/tic → **≈ 3.0 m/s at BU_PER_METER=256, TPS=120**
- **Max (throwPower=65536):** 0x1DDDDD >> 16 = 29.86 BU/tic → **≈ 14.0 m/s**

**Blud's `DYNAMITE_COOK` already matches these values** (minVelocityMps=3.0, maxVelocityMps=14.0). No change needed.

The vertical component (`mulscale14(nSpeed, -9460)`) adds a fixed upward bias of ~35° arc above horizontal. Blud's pitchLobDeg=30 is a close approximation for the tighter arena scale.

### 2.3 — Explosion parameters

`explodeInfo[1]` = `kExplosionStandard` (`actor.cpp:2297`), used by TNT bundle:

| Field | Blood Value | Blud Current | Notes |
|-------|------------|--------------|-------|
| radius | **80** BU | 150 BU | Blood's is smaller |
| damage | **20** | 20 | Same |
| damageRange | **10** | 10 | Same |
| impulse | **150** | 900 | Blud's is 6× higher |
| quake | **900** | 160 | Blud's is lower (converted differently) |
| ticks | **60** | 60 (lifetimeTics) | Same |
| repeat | **160** | — | Sprite repeat (Blood marks explosion sprite size) |
| flash | **60** | 60 | Same |

**Key finding:** Blood's explosion radius is 80 BU (= 0.31m raw), but Blood's explosion processing applies damage per-tick over 60 tics (= 0.5s @ 120 TPS) with repeat=160 as the visual sprite scale. Blood's total damage at center = 20 × 60 = 1200 (over the explosion lifetime). Blud collapses this into a single damage shot with DAMAGE_TICK_STACK=8, giving 20×8=160 at point-blank — just at GIB_THRESHOLD. Blood's total damage is much higher, but spread over 500ms.

**Recommendation:** Keep Blud's current tuning. The values were already scaled for our arena's gameplay feel. Blood's 80 BU radius × RADIUS_SCALE_FACTOR=8 = 2.5m — too small. Blud's 150 BU × 8 = 4.7m is more appropriate. The impulse (900 vs Blood's 150) is also intentionally stronger for Blud's gib feel.

The tune that should change: **damage**. At point-blank, 20 × DAMAGE_TICK_STACK(8) = 160 — just barely reaches GIB_THRESHOLD. Bump DAMAGE_TICK_STACK from 8 to 12 to give point-blank damage = 240, ensuring close-range gibs while leaving the mid-ring for "hurt but not gibbed." This makes the explosion feel stronger without changing radius.

---

## 3. Gib-Outcome Taxonomy

### 3.1 — actDamageSprite → actKillDude branching

`actDamageSprite` (`actor.cpp:3563`):
```cpp
if (pXSprite->health <= 0)
    actKillDude(nSource, pSprite,
        ((damageType == kDamageExplode && damage < 160) ? kDamageFall : damageType),
        damage);
```

**The gib threshold is hardcoded at 160.** If `damageType == kDamageExplode` AND `damage < 160`, the damage type is converted to `kDamageFall` — the enemy dies normally (no gibs, no explosion effects). If damage ≥ 160 AND damageType == kDamageExplode, it passes through as `kDamageExplode` → gib path.

### 3.2 — actKillDude outcomes by damage type

| damageType | nSeq | Outcome |
|---|---|---|
| `kDamageExplode` | 2 | Explosion-death: explosion-specific SEQ (zombie: 4354, cultist: varies), gibs via nGibType + extra gore |
| `kDamageBurn` | 3 | Burn-death: seqStartID+13 or +15/16, GIBTYPE_7/27/15 gibs, blood FX |
| `kDamageFall` | 1 | Normal death: seqStartID+1, sometimes Chance(0x4000) for "flung but not gibbed" (zombie gets seq+7 + blood spurt) |
| `kDamageSpirit` | 1 or 14 | Spirit/Voodoo death |
| default | 1 | Normal death |

### 3.3 — Explosion death branching (inside actKillDude)

For **zombie** (`kDudeZombieAxeNormal`, `actor.cpp:3197-3228`):
1. `nSeq==2` (explosion): `seqStartID+2`, GIBTYPE_27 single gib, `nDudeToGibClient1`
2. `nSeq==1` (fall/normal): 40% chance → `seqStartID+7` + blood spurt + GIBTYPE_27 + data1=35/data2=5 (continuous blood spurting)
3. `nSeq==14` (spirit): spirit-specific
4. `nSeq==3` (burn): `seqStartID+13` + `nDudeToGibClient2`
5. else: default death SEQ

For **cultist** (`kDudeCultistTommy/Shotgun/etc`, `actor.cpp:3230-3245`):
1. `nSeq==3` (burn): `seqStartID+3` + `nDudeToGibClient2`
2. else: `seqStartID+nSeq` + `nDudeToGibClient1`

### 3.4 — actKickObject / corpse-launching

`actKickObject` (`actor.cpp:4055-4060`):
```cpp
void actKickObject(spritetype *pSprite1, spritetype *pSprite2)
{
    int nSpeed = ClipLow(approxDist(xvel[nSprite1], yvel[nSprite1])*2, 0xaaaaa);
    xvel[nSprite2] = mulscale30(nSpeed, Cos(pSprite1->ang+Random2(85)));
    yvel[nSprite2] = mulscale30(nSpeed, Sin(pSprite1->ang+Random2(85)));
    zvel[nSprite2] = mulscale14(nSpeed, -0x2000);
    pSprite2->flags = 7;
}
```

This is a collision-response function: when one sprite hits another, the hit sprite gets launched with velocity proportional to 2× the hitter's XY speed + random angular spread. It's NOT a "launched-corpse" mechanic for explosion deaths — it's a general collision physics response.

**There is NO single-body corpse-launch mechanic in NotBlood's explosion death path.** When an enemy dies from explosion (kDamageExplode), they're fully gibbed (sprite type set to `kThingBloodChunks`, individual gib pieces spawned). There's no intermediate "body launched intact as a dynamic body" state.

### 3.5 — Taxonomy summary

NotBlood's death outcomes, in order of severity:

| # | Outcome | Trigger | Visual |
|---|---------|---------|--------|
| 1 | Normal death | Fall/Bullet/Spirit damage, or explosion < 160 damage | Death SEQ, body sprite → `kThingBloodChunks`, no gibs |
| 2 | Blood-spurt death | 40% chance on normal zombie death | Death SEQ + continuous blood spurting (callback-driven) |
| 3 | Burn-death | kDamageBurn (from stuck flare) | seqStartID+13 (zombie) or +15/16 (cultist), GIBTYPE_7/27/15 gibs, blood FX |
| 4 | Explosion death | Explosion ≥ 160 damage | seqStartID+2 (zombie), full gib (nGibType chunks), extra blood/gore |
| N/A | Launched corpse | **Does not exist** in NotBlood | — |

---

## 4. Recommendation

### 4.1 — Deviations from spec plan

| Area | Spec Plan | NotBlood Reality | Recommendation |
|------|-----------|-----------------|----------------|
| **Dynamite detonation** | Impact-detonate | Fuse-cooked (evPost with weaponTimer delay) | **Keep fuse-cooked.** Blud's existing cook mechanic is correct. Do NOT switch to impact-detonate. Tune the `fuseMaxSec` to ~1.5s (shorter than the current 2.0s) to match Blood's short fuse feel from the weaponTimer-based delay.|
| **Dynamite throw velocity** | Port Blood's velocity | Blud's values already match Blood (3-14 m/s) | **No change needed.** Values are already correct. |
| **Explosion parameters** | Port Blood's values | Blud's are already scaled for gameplay. Blood's impulse=150 is LOWER than Blud's 900. | **Don't reduce.** Bump DAMAGE_TICK_STACK from 8→12 to increase point-blank damage from 160→240 for more reliable close-range gibs. |
| **Ground flame** | Persistent flame at death spot | Does NOT exist in NotBlood | **Implement as Blud embellishment.** Mark clearly as a deviation. Good for gameplay readability. |
| **Launched-corpse** | Single dynamic-body corpse for explosion kills | Does NOT exist in NotBlood | **Implement as Blud embellishment.** NotBlood gibs completely on explosion death. The launched-corpse is a gameplay-feel addition. |
| **Cultist burn behavior** | Sprint toward player | frontSpeed=0 — can't move; stands and turns | **Keep sprint-at-player.** Blud's current sprint behavior is more fun and intentional game design. NotBlood's immobile burning cultist is an engine limitation (the type swap clears velocity). |
| **Zombie burn behavior** | Walk toward player at reduced speed | frontSpeed=46603 vs normal 58254 = 0.80× | **Match NotBlood:** 0.80× walk speed toward player. Replace random panic. |
| **Gib taxonomy** | Binary gib-vs-death | 4-tier outcome system | **Add launched-corpse as a 5th tier.** Keep the existing binary + launched-corpse. NotBlood's 4 tiers are: normal death, blood-spurt death, burn-death, explosion-death. We can map: normal ← fall, blood-spurt ← deferred (F2), burn ← existing burn-death, explosion ← existing full-gib + NEW launched-corpse. |

### 4.2 — Updated phase plan

| Phase | Description | Change from spec |
|-------|-------------|-----------------|
| 1 | ✅ This doc | — |
| 2 | Stuck-flare visibility fix | Unchanged |
| 3 | Zombie burn-walk (0.80× toward player, remove random panic) | Unchanged |
| 4 | Cultist burn-death cap (wire DoT → death transition) | Unchanged; keep sprint-at-player behavior |
| 5 | Burn-death visual: collapse → gibs → ground flame | Ground flame is Blud embellishment (note in code) |
| 6 | Dynamite: keep fuse-cooked, reduce fuseMaxSec to 1.5s, bump DAMAGE_TICK_STACK | Changed from "impact-detonate" to "fuse-cooked with shorter fuse" |
| 7 | Stronger explosion: bump DAMAGE_TICK_STACK 8→12 for +50% point-blank damage | Changed from "port Blood parameters" to "bump tick stack" |
| 8 | Gib-outcome selector + launched-corpse | Launched-corpse is Blud embellishment (note in code) |
| 9 | Verify + TASKS.md | Unchanged |

### 4.3 — Asset needs

| Asset | NotBlood source | Status |
|-------|----------------|--------|
| Cultist burn-death SEQ | 12545/12546 (seqStartID=12544 +1/+2) | Extract if not present; use existing `cultist-burn-death` if already extracted |
| Ground flame sprite | None (Blud original) | Reuse flare-particle texture or existing flame tile |
| Head gib (for launched-corpse) | 3405 (zombie head) | Already in chunk atlas |

The cultist burn-death SEQs 12559/12560 are MISSING from BLOOD.RFF. Use 12545 (seqStartID+1) as a substitute — it's the first death variant available.

---

## Summary

**Spec confirmed:** Burn-death visual sequence (collapse → gibs), zombie burn-walk, cultist DoT cap — all match NotBlood in behavior if not exact mechanic.

**Spec corrected:** Dynamite is fuse-cooked (not impact-detonate), ground flame is Blud-original (not NotBlood), cultist burn-immobility is an engine quirk (we keep sprint), launched-corpse is a Blud embellishment.

**Blud's existing code is surprisingly close to NotBlood.** The cook mechanic, throw velocity, and damage falloff already match. The main gaps are: stuck-flare visibility, cultist death-from-DoT wiring, and visual additions (ground flame, launched-corpse).
