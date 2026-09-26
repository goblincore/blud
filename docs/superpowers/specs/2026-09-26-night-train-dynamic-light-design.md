# Night Train dynamic light and the flashlight — Design

**Date:** 2026-09-26 · **Status:** decisions approved (owner, 2026-09-25/26); **waits on the game loop**
**Part 2 of 3** of the Night Train look revision ([part 1, the restyle](2026-09-25-night-train-art-v2-design.md)
§1 lists all three). **Depends on:** the game loop ([Wake Plan 2](../plans/2026-09-11-wake-2-game-loop.md),
refreshed with Night Train as its test level): pickups and trigger events.

## 1. What it is

The first level plays in the dark. You find the flashlight in the first room; lamps fail, flicker
and black out during fights; a thunderstorm rages outside and lightning lights the carriages
through the windows; passing lights sweep through them; furnaces glow.

## 2. Decisions (owner)

1. **The flashlight is a pickup.** The level starts dark. The flashlight hangs on a hook by a dying
   lamp in the **baggage hold** (the first room); picking it up turns the beam on and wakes the
   trunk zombie. No battery for now.
2. **The view outside is a thunderstorm** (a `storm` window preset: roiling clouds, rain on the
   glass, lightning bolts), and **lightning lights the interior**, timed with the bolts in the glass.
3. **Lightning and passing-light sweeps both** (2026-09-26): cold, sudden flashes and warm,
   rhythmic sweeps.
4. **The outside light enters through the windows only:** one **shadowed directional "window
   light" per carriage**, outside the train, its shadow map fitted to the carriage the player is in
   (the Outdoor v1 moon's pattern). Lightning is a hard blue-white spike, a flicker, then dark;
   sweeps swing its direction along the train with a warm tint. The shadow map renders only while
   the light is lit (the moon's `autoUpdate = false` + `needsUpdate` idling; `castShadow` decided at
   boot and never toggled, the r185/r186 rule).
5. **Failing lamps: moods and scripted events.** Every lamp has an ambient mood in the layout table
   (steady, flickering, stuttering, dying, dead; seeded, so replays match); scripted blackouts and
   surges fire on level events (the van's lamp dies as the flashlight is taken; the party carriage
   strobes and cuts when the dancers turn; a blackout mid-fight in the sleeper).
6. **Furnaces and the firebox** pulse with orange fire light (the kit's boilers and the cab's firebox
   get flickering point lights).

## 3. Open (for the plan, after the game loop)

- The storm preset's look in detail (cloud layers, rain streaks on the glass, bolt shapes and rate).
- The exact scripted events per carriage (they come with the encounter script).
- Cost: the window light's shadow pass redraws the carriage's art during flashes and sweeps; fold
  in the deferred small-dressing shadow cut (no shadows on valves, gauges, hats, streamers,
  bunting, grilles, gears, lamp cages).
