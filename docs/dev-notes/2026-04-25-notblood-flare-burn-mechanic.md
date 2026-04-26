---
title: NotBlood Flare → Burn Mechanic Investigation
date: 2026-04-25
author: claude
tags: [blud, notblood, flare, burn, investigation]
---

# NotBlood Flare → Burn Mechanic Investigation

Sources read:
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aiburn.cpp` — burning-enemy AISTATEs
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aicult.cpp` — shotgun-cultist baseline AI
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.cpp` ~2990-3300 — `actKillDude`, burn-type swap, death handling
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.cpp` ~3867-3920 — `kMissileFlareRegular` impact handler
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.h` — `actBurnSprite`, `MissileType` struct
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/dude.cpp` — `dudeInfo[]` entries for burning variants
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/dude.h` — `DUDEINFO` struct fields
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/common_game.h` — `kDude*`, `kMissile*` enums
- `/Users/donny/Documents/Raze/NotBlood/source/blood/src/callback.cpp` — `FlareBurst`, `fxFlareSpark`, `fxFlareSparkLite`

---

## 1. Flare → Ignite Trigger

**Damage type:** `kDamageBurn` (from `actor.h:33`).

**How Blood gets from "stuck flare" to "enemy takes burn damage":**

When `kMissileFlareRegular` (the flare projectile) hits a sprite (`actor.cpp:3867`):
1. `actBurnSprite(owner, pXSpriteHit, 480)` is called — sets `burnTime = 480` tics (4 sec @ 120 TPS) and `burnSource`.
2. Each tick, the sprite's update loop decrements `burnTime` and calls `actDamageSprite(burnSource, pSprite, kDamageBurn, 8)` (line 4232-4233).
3. Every 4 tics (120 TPS / 4 = 30 steps/sec), the sprite takes 8 damage of type `kDamageBurn`.
4. Total: 480 tics × (8 dmg / 4 tics) = ~960 damage over 4 seconds, applied in 120 ticks of 8 each = 960 damage.

**Ignite timing:** There is NO explicit "ignite delay" in Blood. The burn damage starts immediately on flare stick. The "ignition" visual effect (sprite swap) happens either:
- For **cultists**: when HP would drop to 0 from burn damage (`actKillDude` intercepts `kDamageBurn`, swaps type to `kDudeBurningCultist`, heals HP to `dudeInfo[40].startHealth` = 25). The cultist burns as normal cultist until near-death, then **transforms** into a burning cultist with fresh HP.
- For **zombies**: NO type swap. The zombie just takes DoT, plays the burn-chase anim (`nSeq=3`) for damage reactions, and eventually dies normally.

**Blud adaptation:** We add an `IGNITE_DELAY_SEC` (~0.6s) before DoT begins. This creates the "flare sticks → smoke → ignition" visual rhythm without needing Blood's "die-to-swap" mechanic. The delay is a feel-tune, not a 1:1 port.

---

## 2. The Dude-Type Swap

The swap happens in `actKillDude` (`actor.cpp:3030`):

```cpp
case kDudeCultistTommy:
case kDudeCultistShotgun:
case kDudeCultistTesla:
case kDudeCultistTNT:
    if (damageType == kDamageBurn && pXSprite->medium == kMediumNormal)
    {
        pSprite->type = kDudeBurningCultist;
        aiNewState(pSprite, pXSprite, &cultistBurnGoto);
        actHealDude(pXSprite, dudeInfo[40].startHealth, dudeInfo[40].startHealth);
        return;  // <-- death is CANCELED, cultist survives as burning variant
    }
```

**Why HP gets HEALED:** The swap only triggers inside `actKillDude` — the cultist's HP has already reached 0 (would die). Blood cancels death by healing HP to `dudeInfo[40].startHealth` (25), making the cultist survive as a **fresh burning entity**. The burn DoT then runs against this 25 HP. When it reaches 0 again, the burning cultist actually dies with burn-death anim.

This is a Blood quirk: the "ignite" isn't a visual overlay — it's a **death canceled at the last frame**, resetting the dude as a different type. Net result: cultist takes ~60 dmg from burn, HP hits 0, transforms to burning cultist at 25 HP, takes ~25 more burn damage, dies for real.

**Zombies do NOT get this swap.** There is no `kDudeZombieAxeNormal → kDudeBurningZombieAxe` case in `actKillDude`. Zombies just take burn damage until death with no type change.

---

## 3. Burning Enemy SEQs

### kDudeBurningCultist (240) — `dudeInfo[40]`

| Field | Value |
|-------|-------|
| `seqStartID` | **12544** |
| `startHealth` | 25 |
| `frontSpeed` / `sideSpeed` / `backSpeed` | 0 / 0 / 0 (can't move by itself!) |
| `angSpeed` | 160 |
| `fleeHealth` | 100 |

Movement speed is 0 — the burning cultist depends on AISTATE `thinkGoto` to move (uses internal velocity setting, not the dudeInfo speed fields).

**AISTATEs** (all use seq offset `3`):
- `cultistBurnIdle`: seq 3, no-op think
- `cultistBurnChase`: seq 3, `aiMoveForward` + `thinkChase`
- `cultistBurnGoto`: seq 3, `aiMoveForward` + `thinkGoto`, 3600 tic duration → transitions to `cultistBurnSearch`
- `cultistBurnSearch`: seq 3, `aiMoveForward` + `thinkSearch`, 3600 tic duration → loops to `cultistBurnSearch`
- `cultistBurnAttack`: seq 3, `nBurnClient` callback, 120 tic duration → transitions to `cultistBurnChase`

All burning cultist states use the same seqId=3 → **SEQ 12547** ("PRIS1D3").

**Death SEQs:**
SEQs 12555-12563 are ALL MISSING from BLOOD.RFF. In Blood's `actKillDude` for `kDudeBurningCultist`:
```cpp
case kDudeBurningCultist:
    if (Chance(0x8000))
        seqSpawn(dudeInfo[nType].seqStartID+16-Random(1), ...); // 12559 or 12560
    else
        seqSpawn(dudeInfo[nType].seqStartID+15, ...); // 12559
```
Both target missing SEQs. Blood falls through to `seqKill` (instant removal) when the SEQ doesn't exist.

**Available SEQs for burning cultist (12544-12550):**
- 12544: "PRIS1I1" — idle/stand
- 12545: "PRIS1D1" — possibly death variant 1
- 12546: "PRIS1D1" — possibly death variant 2
- 12547: "PRIS1D3" — burn-thrash (chase/attack/goto/search)
- 12548: "PRIS1E1"
- 12549: "PRIS1R1"
- 12550: "PRIS1M1"

For Blud, we'll extract **12547** for `cultist-burn-chase` and **12545** (or 12546) for `cultist-burn-death`.

### kDudeBurningZombieAxe (241) — `dudeInfo[41]`

| Field | Value |
|-------|-------|
| `seqStartID` | **4096** (same as kDudeCultistTommy!) |
| `startHealth` | 30 |
| `frontSpeed` | 46603 |
| `fleeHealth` | 100 |

Uses the same `seqStartID` as the tommy cultist! Burning zombie axe reuses cultist tommy sprites. But importantly: **in practice, the zombie never actually becomes `kDudeBurningZombieAxe`** — there's no swap in `actKillDude` for zombies. The burning zombie type exists only for map-placed entities.

**What actually happens for zombies on fire:**
- Damage reaction (`actor.cpp:3151`): `kDamageBurn → nSeq = 3`
- Zombie plays `dudeInfo[3].seqStartID + 3` = 4352 + 3 = **SEQ 4355** (already extracted as `zombie-burn-chase`, baseTile=3321)
- Dies from burn: `dudeInfo[3].seqStartID + 13` = 4352 + 13 = **SEQ 4365** (already extracted as `zombie-death-burn`, baseTile=2910)

All zombie burn assets are already extracted. No new SEQs needed for zombie burning.

---

## 4. Burning Enemy AI Behavior

**Burning cultist AI (aiburn.cpp):**
- Enters `cultistBurnChase` → moves toward player, checks LOS
- If close enough (nDist < 0x333 ≈ 819 BU ≈ 3.2m) and within periphery angle → enters `cultistBurnAttack`
- `cultistBurnAttack` has a 120-tic duration then returns to `cultistBurnChase`
- If target is lost/dead → `cultistBurnSearch` (wanders)
- If no target at all → `cultistBurnGoto` (moves toward last known target pos)

**Key difference from baseline cultist:** The burning cultist STILL ATTACKS (melee, not shotgun — the seq 3 animation is a burning flail/lunge). The attack uses `nBurnClient` callback which is a NO-OP stub. The burning cultist keeps chasing and flailing at the player until it dies.

**Burning zombie AI:** Same chase→search→attack pattern via `thinkChase`/`thinkGoto`/`thinkSearch` shared functions. Also still attacks.

**Blud simplification:** For our arena, cultist burning = sprint toward player at 1.4× speed, no shooting. The NotBlood burning attack is melee-range only and the seq callback is a no-op — so "rush at player" is functionally correct. Zombie burning keeps the existing panic-thrash random-target behavior.

---

## 5. Flare Projectile Sprite Tile

From `missileInfo[]` in `actor.cpp:1505`:

```cpp
// Regular flare (kMissileFlareRegular = 301)
{
    2424,      // picnum (sprite tile)
    3145728,   // velocity
    0,         // ???
    32,        // xrepeat
    32,        // yrepeat
    (char)-128, // shade
    32,        // clipdist
},
```

**Flare projectile sprite tile: 2424.** 32×32 pixels. Copied from `assets-source/blood-extracted/tiles009_tiles/02424.png` → `public/assets/blood-tiles/2424.png`.

Also used by `FlareBurst` (callback.cpp:97) as the flare-alt missile sprite (8 sub-flares burst on stick).

---

## 6. Visual Effects on Stuck Flares

**`FlareBurst` (callback.cpp:92):** Spawns 8 `kMissileFlareAlt` sprites radiating outward from the stuck flare, using tile 2424. Live for 960 tics (8 sec). Despawns self + original flare sprite.

**`fxFlareSpark` (callback.cpp:125):** Spawns a single FX_28 particle (spark) at the flare position with randomized velocity. Re-posts every 4 tics. Continuous spark emission.

**`fxFlareSparkLite` (callback.cpp:138):** Same as `fxFlareSpark` but re-posts every 12 tics (slower). For "lite" flare variant.

**Blud decision:** Keep our existing smoke-column treatment. The FlareBurst sub-flares and spark effects are nice but in-scope only for a full VFX pass. Our smoke columns already give good spatial feedback. **MVP: no change.**

---

## Summary

| Item | NotBlood | Blud Port |
|------|----------|-----------|
| Ignite timing | Immediate DoT on stick; cultists die-to-swap at HP=0 | 0.6s ignite delay; then DoT + sprite swap |
| Cultist burn behavior | Type swap to `kDudeBurningCultist` at HP=0; fresh 25 HP; melee flail AI | `CultistState.Burning` on ignite; sprint at player; no shooting |
| Zombie burn behavior | No type swap; plays burn-chase (SEQ 4355) as damage reaction | Already have `ZombieState.Burning` + panic AI; just wire `zombie-burn-chase` anim |
| Burn-chase SEQ | Cultist: 12547, Zombie: 4355 | Extract 12547; 4355 already extracted |
| Burn-death SEQ | Cultist: 12559/12560 (MISSING in RFF), Zombie: 4365 | Use 12545 for cultist burn-death; 4365 already extracted |
| Flare projectile tile | 2424 (32×32) | Tile copied; billboard rendering follows dynamite pattern |
| Stuck-flare VFX | FlareBurst (8 sub-flares) + fxFlareSpark (continuous sparks) | Smoke columns only (MVP) |
