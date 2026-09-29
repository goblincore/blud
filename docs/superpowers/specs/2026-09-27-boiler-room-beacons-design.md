# Boiler Room emergency beacons — Design

**Date:** 2026-09-27 · **Status:** design approved by the owner in chat.
**Context:** Night Train, carriage 5, "the Boiler Room" (the former party carriage: DJ deck, disco ball, steam, pistons). Its two ceiling lamps run the `strobe` script when the player crosses the threshold (u 5.5–6.5): they surge, strobe for 3 s, then die for good. Today nothing replaces them. Bodies are lit from the shared light list (part 3 plan 1: `docs/dev-notes/2026-09-27-shared-light-list/notes.md`).

## 1. The beat (owner choice A)

1. The player enters: party lighting.
2. At the threshold, the strobe runs: a surge, 3 s of strobing, then the lamps die.
3. At that moment the two red emergency beacons stutter on for about 0.3 s, then hold and sweep for the rest of the level.

## 2. The beacons (owner choice A for placement, B for richness)

**Placement.** There are **two**, ceiling-mounted and centred (x 0), in the Boiler Room carriage frame:
- one at **u ≈ 4**, near the entrance;
- one at **u ≈ 14**, near the DJ deck.

They rotate in **opposite directions**.

**Each beacon has four parts:**
- **The light.** A red spotlight (colour about `(1.0, 0.08, 0.05)`), tilted about **35° below horizontal** and rotating about the vertical axis at about **0.7 rev/s**.
  - It lights the level (three.js light list, `onlyRooms` = the Boiler Room).
  - It lights bodies through the shared light list, as a spot source with a new **`beacon`** profile: a hard red rim, and a gain calibrated like the tube's.
- **Hard shadows.** The shadow map is 512², and zombie shadows swing with the beam. It re-renders **every frame, but only while the beacon is on and the player is in the Boiler Room**. That is the tubes' policy: `autoUpdate = false` plus `needsUpdate`.
- **The beam.** A faint red cone that reuses the tube beam (`tube-beam.wgsl.ts`) and turns with the light, so the sweep reads through the steam.
- **The housing.** A small red dome on the ceiling. Its emissive follows the beacon's level.

**Rules that stay in force:**
- Never toggle a light's `.visible`: the level goes to 0 instead.
- `castShadow` is set at boot only.
- The rotation and the switch-on run on the **sim clock** (`ctx.world.light.time`), so replays and the headless gate see the same sweep. The `setLightTime` seam pins it for march-hash.

## 3. How it fits

| Piece | Where | What |
|---|---|---|
| Level format | `level-def.ts` / `level-json.ts`; `export_level.py`; `night_train_layout.py` / `build_night_train.py` | A new light `fixture: 'beacon'`, alongside `'bulb' \| 'tube'`, with an optional `spin` (rev/s, signed). It is authored in the layout script, re-exported, and parsed with validation. Any level can use it. |
| The switch-on | `lamp-moods.ts` (pure) | A new `LampScript` mode, **`emergency`**: level 0 until `at + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS`, then a seeded flicker-on over about 0.3 s, then 1. Beacons start with mood `dead`. |
| Arming | `level-events.ts` / the dynamic-light runtime | The Boiler Room's existing `light.strobe.room.5` event also gives every **beacon** in that room the `emergency` script, at the same time. No new trigger. |
| The rotation | a pure helper (`train-motion.ts` or a new `beacon.ts`) | `beaconAxis(t, spin, tilt, phase)` gives the spot axis. It is deterministic and unit-tested. |
| The runtime | `game-dynamic-light-leaves.ts` | `makeBeacon`, next to `makeTube`: a SpotLight plus its target, shadow, beam and housing. It is stepped in `stepDynamicLight`: level, axis, beam, housing emissive, shadow refresh policy. |
| The shared list | `game-light-list-leaves.ts`, `light-profiles.ts` | The beacon becomes a spot source with profile `beacon`, rooms = the Boiler Room, and ref intensity = its base. The profile table gains `beacon`, its 7th of 8 slots. |

## 4. Proof and cost

- **Unit tests:** the `emergency` script timing, the beacon axis over time, the level-JSON parse and validation of `fixture: 'beacon'` / `spin`, and the profile packing.
- **Light gate, new section:**
  - before the strobe, the beacons are at level 0;
  - after the strobe ends, they are at level 1;
  - their axis changes between two sim times;
  - a Boiler Room body's picks include a beacon light;
  - the shadow frame count rises while the beacons are on.
- **Contact sheet** for the owner: the Boiler Room after the strobe, at 3–4 rotation angles, with zombies and steam in view.
- **Cost:** the gate's cost section in the Boiler Room, with the beacons on. If the two shadow passes break the +1.5 ms budget, **report the numbers to the owner**. Do not drop the shadows silently.
- **march-hash:** its pins will move, because the level changed. Re-pin them with `node scripts/march-hash.mjs`, as PR #25 notes.

## 5. Out of scope

- Haze and volumetrics (part 3 plan 3). The beam is the tube-beam stand-in.
- Beacons anywhere other than the Boiler Room.
- Sound (a siren).
