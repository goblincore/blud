# Boiler Room resize (8 × 28 m) — verification, 2026-09-28

Plan: [2026-09-27-boiler-room-resize](../../superpowers/plans/2026-09-27-boiler-room-resize.md). Tasks 1–2 (kit, level)
landed earlier the same day; this note covers Tasks 3–4. Captures use the owner's default light layers (no `?layers=`).

## Gates (Task 3 moved their coordinates; all against the rebuilt level JSON)

| gate | result |
| --- | --- |
| `sdf-game-train-gate` | PASS: walk 41 waypoints, every room to the cab (new Boiler Room probes: favours, pistons, chill-out, DJ end); cost inside budget on a quiet machine — see Cost |
| `sdf-game-loop-gate` | PASS (the firebox now at z −135.9) |
| `sdf-disco-check` | PASS: the ball at z −104, all 96 stars on the resized room's faces; red pulses after the strobe |
| `sdf-game-light-gate` | PASS, including the beacons (both lit and turning, the moved dancer picks a beacon) |
| `march-hash` | PASS, pins unchanged (room 1 is untouched) |

Draw calls in the Boiler Room: 114 → 174 with the art (+60, budget +200; fewer than every other carriage).

## Look ([room-sheet.png](room-sheet.png))

Party (tubes, stars), both window walls, the strobe, after the strobe (beacon beams, red stars), the dance floor.
- **One row of 4 tubes (decision 5):** the room reads dark toward the side walls; the pools, the stars and the
  beacons carry it. Owner call: keep, or add the second row (`lamps()` can take two).
- **Disco stars at 4 m walls:** sparse but readable; `DISCO.count` (96) could rise if the owner wants more.

## Beacons on bodies under the owner's default ([beacon-on-body.png](beacon-on-body.png))

A dancer 3.6 m past the south beacon, a quarter turn in four steps, torch off (top) and lit (bottom):
- **Torch off:** the beacon reads strongly; facing the beam, the body goes flat saturated red (the open 09-27
  "blows out flat red" item).
- **Torch lit:** the torch dominates (the old per-pixel beam); the beacon shows as a red floor pool and only a faint
  tinge on the body. Owner call: fine, or give the beacon more weight on torch-lit bodies.

## Cost (quiet machine, load 3.5–3.9, the owner's game tabs closed)

- **Train gate, art on vs off:** the Boiler Room +60 draws / +6.7 ms (108 → 168; 10.7 → 19.0 ms); every carriage
  +4.1..+6.7 ms, inside +200 draws / +12 ms. PASS. (The first run, at load 7–25 with the game tabs open, read
  +12.7 ms here and +15.4 ms in unchanged third class: load, not the resize.)
- **Light gate cost (enforced):** the list costs 0.00 ms in third class and −0.05 ms in the Boiler Room (budget
  +1.5 ms); the beacons on − off **+1.05 ms frame, +0.74 ms GPU** (was +0.75 / +1.12 at 4.2 m wide), 144 shadow
  renders over 72 frames. PASS.

## Gotcha

Setting the light clock back before the torch's switch-on reads the torch as off (its ramp runs on that clock):
sweep light times forward from `lights().time` after switching it on.
