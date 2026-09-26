# New game flow: the void, the portal, Night Train first — Design

**Date:** 2026-09-24 · **Status:** approved (owner, 2026-09-24) · **Kind:** design restructure (docs only, no code)
**Changes:** [vision](../../game/vision.md) §6.1, §10.3, §10.4 · [Night Train design](../../game/levels/01-night-train/design.md) · [Wake design](../../game/levels/00-the-wake/design.md)

## Why

The first playtest of the Wake (2026-09-24, after Outdoor v1) showed it is a poor first level:
early, visually flat, and zombies alone are not interesting. A wide graveyard is also hard to keep
tight for a new player. Night Train is linear, carriage by carriage, and can be a tightly
controlled first ten minutes: zombies, then a firefight, then new weapons, then the Stoker.

## Decisions

1. **First launch:** intro cutscene → title menu → **New game** → the void. (Replaces the vision's
   "no title screen, the game starts in the Wake".) What the cutscene shows is open; the first
   slice uses a title card.
2. **The void is the hub, unlit.** Darkness, no visible floor, one glowing portal (Diablo II
   style: an upright oval of swirling light). Through it the player sees rail tracks running off
   into a dark distance. There is nothing to fight; walking into the portal is the only action.
   The owner thinks of the void and the hub as one place: the hub's first state, with everything
   in it hidden.
3. **The portal drops the player straight into Night Train's first carriage.** Night Train's
   platform beat (running for the moving train) is cut.
4. **Night Train is level 1 and the first level played.** It ends as designed (the firebox, the
   dawn), then **the first CD starts the pull-back into the Flat** (moved from the end of the
   Wake). After that the train is the hub, as vision §10.3 describes: the Line, the desert, the
   lift-off, the Stoker.
5. **Encounters use the cultists.** Cultists (tommy guns) replace the soldier ticket inspectors;
   the optional bloatmaw over the buffet stays as the extra monster.
6. **The Wake becomes a later level, reached when the train crashes back to earth.** It gains
   cultists and at least one new monster when it resumes. Its place in the order is open.
   Its pipeline and Outdoor v1 work stay as they are.

## Night Train: revised beats

| # | Carriage | Encounter | Teaches | First slice |
| --- | --- | --- | --- | --- |
| 1 | Guard's van (portal arrival) | 3–4 zombies burst from trunks | Melee, the shotgun, close quarters | yes |
| 2 | Third class | 6–8 sleeping guests (zombies), wake on the first shot | Crowds in an aisle | no |
| 3 | Dining car | **First firefight:** 2–3 cultists behind tables, plus zombie waiters | Cover, enemies that shoot back | yes |
| 4 | Sleeper | Mixed ambushes behind compartment doors; **a new weapon** | Routes, the brake cord | no |
| 5 | Party carriage | Biggest fight: dancers turn, zombies and cultists mixed | Everything together | yes |
| 6 | Coat check | Quiet; the future hub carriage | Breathing room | no |
| 7 | Tender | 2–3 climbing the sides, open air | Exposure | no |
| 8 | Cab | The Stoker, the firebox, the dawn, the pull-back | The set piece | yes (Stoker static) |

**First slice:** carriages 1, 3, 5 and 8 with vestibules between; about 4–5 minutes. The new
weapon moves into the dining car or the party carriage while the sleeper is absent.

## Build order (each item is its own spec → plan)

1. **This design as doc updates** (this spec).
2. **The void and the portal:** a level with no visible floor geometry; a portal showing a live
   view of another scene (render-to-texture of the tracks); walking into it loads Night Train by
   the `?level=` reload the Esc menu already uses. The menu's **New game** starts here.
3. **The train carriage kit:** carriage and vestibule geometry in Blender through the level
   pipeline; window planes with scrolling night scenery; camera sway.
4. **Night Train first slice:** carriages 1, 3, 5, 8, the encounters above, the Stoker as a
   static body.
5. **Later:** the dawn set piece, the pull-back, the intro cutscene, the remaining carriages.

## Open

- What the intro cutscene shows.
- Where on the Line the crash happens, and whether the Line still runs both ways once the
  train has crashed (vision §10.3 "Riding back").
- Whether the void shows more of the hub as the game goes on, or is only ever seen once.
