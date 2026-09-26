# Night Train dynamic light and the flashlight — Design

**Date:** 2026-09-26 · **Status:** decisions approved (owner, 2026-09-25/26); open items settled 2026-09-26 (§3); plan: [2026-09-26-night-train-dynamic-light](../plans/2026-09-26-night-train-dynamic-light.md)
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

## 3. Settled (2026-09-26)

- **The storm is violent (owner: B):** clouds churning and lit from within, scrolling with the
  train; rain streaks running on the glass; big forked bolts close by. A flash whitens the sky and
  shows the poles and treeline for a moment. Inside, lightning is a hard blue-white spike. Bolts
  come every 6–14 s (seeded), each on one side of the train, so its light comes through that
  side's windows. Passing-light sweeps come about every 20 s: warm, swinging from ahead to behind
  over about 1.5 s.
- **Scripted light events** (a `light.<mode>.room.<n>` command; `cues` in the level map one event to
  more). Until encounters exist, trigger boxes stand in for the dancers turning:
  1. The baggage hold: taking the flashlight kills the van lamp (it sputters, then goes dark) and
     alerts room 1, the trunk zombie. Alerting stays a no-op until the encounter work.
  2. The sleeper: a blackout at the corridor's midpoint. The lamps cut for 6 s, then stutter back.
  3. The party carriage: a surge, a 3 s strobe, then dark for good, once you are past its threshold.
- **Lamp moods:**

  | Carriage | Mood |
  | --- | --- |
  | van | dying |
  | dining | flickering, with one lamp dead |
  | sleeper | stuttering |
  | party | steady |
  | cab | steady |
  | fires (boilers, office stove, galley stoves, firebox) | `fire` |

  Moods run on the sim clock, so replays match.
- **The flashlight is off when a level has a `flashlight` pickup;** every other level keeps it on
  from the start. Its brightness scales the spot, the beam on the bodies and the bounce. It is
  never hidden.
- **Cost:** only the window light of the carriage the player is in re-renders its shadow, and only
  while it is lit. The other carriages keep their last map. Small dressing (valves, gauges, grilles,
  gears, streamers, bunting, hats) stops casting shadows.
- **Known gap:** the SDF bodies do not see the window light (they shade in the march). Lightning
  reaches them only through the scene; direct lightning on bodies comes with part 3 or later.
