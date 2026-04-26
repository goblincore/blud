---
title: M5-C — Flare/burn behavior fidelity (NotBlood-faithful)
date: 2026-04-25
status: queued for dispatch
parent: docs/superpowers/specs/2026-04-25-blud-m4-flare-gun-design.md
---

# Goal

Three problems landed in the M4 + M5-A flow that this spec fixes together
because they share investigation territory in NotBlood source:

1. **Flare projectile graphic missing in flight.** The FlareGun fires an arc
   projectile but the player sees nothing in the air — `flare.ts:175`'s
   `renderView` is empty (the FPV port handled the *hand*, never the
   in-flight *projectile*). Dynamite has projectile rendering wired
   (`configureProjectileRendering` / `setProjectileCamera`) — flare needs
   the same treatment.

2. **Burn behavior doesn't match Blood.** Today: stuck flare attaches → DoT
   ticks → enemy dies. In Blood: stuck flare attaches → after a delay → the
   enemy *ignites*, **the sprite type and animation set swap to the burning
   variant**, the AI panics, then they die using a *burn-death* animation.
   For axe-zombie we already extracted `zombie-burn-chase` and
   `zombie-death-burn` SEQs months ago, but the runtime never actually swaps
   to them — the existing Burning brain state runs panic AI but keeps
   playing the normal `zombie-chase` sprite. Cultists don't even have a
   Burning state at all.

3. **Cultist animation gaps** were two issues:
   - **a) Missing tiles 2891-2997** for `cultist-shotgun-death-normal` —
     fixed in the commit before this spec. Already on `main`. The dispatch
     should still verify (no code work).
   - **b)** Possible additional gaps if the burning-cultist SEQs reference
     tiles outside the existing dump. Investigate during Phase 1.

This is one dispatch spanning all three because untangling the burn
behavior requires understanding NotBlood's flare→ignite→burn pipeline,
which is also where the projectile-sprite info lives.

# NotBlood source-of-truth (the dispatch reads these directly)

The dispatch's first phase is **investigation** — read these files and
write a findings doc before touching code:

| File                                                                       | What's in it                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aiburn.cpp`         | `cultistBurnChase`, `cultistBurnGoto`, `cultistBurnSearch`, `cultistBurnAttack`, `zombieABurn*` AISTATEs (and the equivalent for axe-zombie) |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.cpp` lines ~3000-3070 | The `pSprite->type` swap from `kDudeCultistShotgun` → `kDudeBurningCultist` triggered by `damageType == kDamageBurn` |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aicult.cpp`         | Confirms shotgun-cultist baseline AISTATEs + their SEQ offsets |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/dude.cpp`           | `dudeInfo[]` table — find `kDudeBurningCultist` (=240, dudeInfo index 40) and `kDudeBurningZombieAxe` (=241, dudeInfo index 41) seqStartIds |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/common_game.h`      | `kDude*`, `kMissile*`, `kCallback*` enum constants     |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/missile.cpp`        | `missileInfo[]` — find sprite tile for `kMissileFlareRegular` (=301) |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/callback.cpp`       | `FlareBurst`, `fxFlareSpark`, `fxFlareSparkLite` — the visual effects layered on stuck flares |

# Pre-task setup already on `main` (do NOT redo)

- The cultist tile gap is fixed: `public/assets/blood-tiles/2583-2997.png`
  fully populated (3 tiles missing — 2600/2601/2947 — are empty slots in
  BLOOD.RFF itself; animator skips them).
- `scripts/extract_seq.py` and `scripts/extract_qav.py` are extensible —
  the dispatch may add new IDs to `SEQ_NAMES_BY_ID` and run them. Check
  `assets-source/blood-extracted/tilesXXX_tiles/` for sprite PNGs (with
  zero-padded filenames; copy to `public/assets/blood-tiles/` UNPADDED).

# Architecture — three independent fixes

## Fix 1 — Flare projectile graphic (Phase 4)

The dynamite has a `configureProjectileRendering` / `setProjectileCamera`
pattern that draws a billboard for the in-flight TNT bundle. Mirror it for
the flare:

- Find the flare missile sprite tile from `missileInfo[kMissileFlareRegular]`
  (in NotBlood `missile.cpp` or wherever `missileInfo[]` lives — Phase 1
  finds it). Copy the PNG to `public/assets/blood-tiles/` if not already
  served.
- In `flare.ts`, expose a render hook similar to dynamite. The `FlareGun`
  already has `getProjectilePos(now)` → `Vec3 | null`. Plumb a small
  billboard mesh in `main.ts` (or in a new `flare-projectile-renderer.ts`
  if it reads cleaner) that follows that position when active and hides
  when null.
- Tile rendering: same nearest-neighbor + sRGB setup as the rest of the
  blood-tiles pipeline. Look at how dynamite's projectile billboard is set
  up for the cleanest reference.

## Fix 2 — Burn behavior (Phases 5-6)

In NotBlood: when an enemy takes `kDamageBurn` damage AND is in normal
medium (not in water), `pSprite->type` is reassigned to the "burning
variant" type. That swap drags in:
- A different `seqStartId` (so different sprite tiles)
- A different baseline AISTATE (`cultistBurnGoto` etc — the burning enemy
  panics toward the player, can sometimes still attack)
- A reset of HP to the burning-variant's `startHealth` (so the DoT runs
  fresh against the burn-form)

In Blud, we don't have a separate dude type system — `AxeZombie` and
`ShotgunCultist` are concrete classes. The simplest faithful port is:

- **A new `Burning` AI/animation phase** on each enemy class (zombie
  already has `ZombieState.Burning` in its brain — the brain runs panic
  AI but the animator still plays `zombie-chase`. Fix the animator wiring
  so `Burning` plays `zombie-burn-chase`. Add the same to cultist.)
- **Ignite trigger:** today the `StuckFlare` deals continuous DoT from the
  moment of stick. Match Blood's "ignite after delay" by adding a
  `igniteDelaySec` (something like 0.5-0.8s based on how Blood feels) on
  StuckFlare. Before ignition: smoke only, no DoT. After ignition: enemy
  enters Burning phase, DoT begins, sprite swaps.
- **Burn death:** when an enemy dies while in the Burning phase, play the
  `*-death-burn` SEQ instead of `*-death-normal`. The zombie has
  `zombie-death-burn` already extracted. Cultist needs investigation:
  the burning-cultist's death anim probably lives at the burning-cultist
  seqStartId + offset (Phase 1 confirms; Phase 2 extracts if needed).
- **Cultist Burning state** does NOT need to reuse zombie's panic-thrash
  random-target logic verbatim. Cultist can simply: stop firing, sprint
  toward the player at 1.4× speed, no shooting, until DoT kills them.
  Match the in-game *feel* of NotBlood's `cultistBurnGoto` (which uses
  `thinkGoto`) — they run for cover/exit, but in our arena that just
  means they make a beeline at the player.

## Fix 3 — Cultist animation gap verification (Phase 3)

Mostly already done on `main`. Verify by:
- Counting tiles in 2583-2997 range: should be 412 (out of 415, 3 known
  empties).
- Spawning a cultist (`T` key), shooting them, watching the death-normal
  animation play through end-to-end without disappearing.

If during Phase 1 the dispatch finds that burning-cultist SEQs reference
tiles outside the existing dump, **extract those too** (Phase 2 asset
prep). Same for any flare-projectile sprite tile not yet served.

# Acceptance

1. **Flare projectile visible.** `Shift+F`-fire (or `2`+left-click after
   M5-B) shows a small bright billboard arcing through the air until impact.
2. **Stuck flare → ignite → burning sprite.** A flare hits a zombie or
   cultist → smoke for ~0.7s → enemy ignites → sprite swaps to the
   burn-chase variant → enemy panics → eventually dies → corpse uses the
   burn-death sprite.
3. **Cultist death animation plays through end-to-end** without
   disappearing frames.
4. `npx tsc --noEmit` green; `npm run build` green; `npm test` — all 1599
   pre-existing tests pass; new tests cover the ignite-delay timer + the
   anim-key-on-burn-state mapping.
5. **Phase 1 findings doc committed** at
   `docs/dev-notes/2026-04-25-notblood-flare-burn-mechanic.md` — covers
   what was investigated, what got ported as-is, what got simplified for
   Blud's two-class enemy system.

# Out of scope

- F2 items (already deferred per user): charred-corpse death sprite, real
  flare SFX file content, flare ammo cap, cascade gibs.
- Multi-player burn-cross-infection (Blood has it; we don't simulate AI
  vs AI flares in arena anyway).
- Burning-Beast / Burning-Innocent variants (we don't ship those enemies).
