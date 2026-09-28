# Boiler Room resize (8 × 28 m) — verification, 2026-09-28

Plan: [2026-09-27-boiler-room-resize](../../superpowers/plans/2026-09-27-boiler-room-resize.md). Tasks 1–2 (kit, level)
landed earlier the same day; this note covers Tasks 3–4. Captures use the owner's default light layers (no `?layers=`).

## Gates (Task 3 moved their coordinates; all against the rebuilt level JSON)

| gate | result |
| --- | --- |
| `sdf-game-train-gate` | walk: 41 waypoints, every room to the cab (new Boiler Room probes: favours, pistons, chill-out, DJ end); **cost: over budget at load 7–25** (third class +15.4 ms, Boiler Room +12.7 ms vs +12) — see Cost |
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

## Cost

The train gate's +12 ms art budget failed at a 1-minute load of 7–25 (the owner's own Chrome game tabs were running;
this measurement has swung to +33 ms at load 6.5 before). The light gate's Boiler Room cost was report-only at load 12
(+0.15 ms list vs off; beacons on − off −2.65 ms, GPU +0.99 ms). **Re-measure on a quiet machine** (load < 4, game tabs
closed): `LAB_TMP=.lab-tmp bash scripts/sdf-game-train-gate.sh` and `LIGHT_GATE_ONLY_COST=1 bash scripts/sdf-game-light-gate.sh`.

## Gotcha

Setting the light clock back before the torch's switch-on reads the torch as off (its ramp runs on that clock):
sweep light times forward from `lights().time` after switching it on.
