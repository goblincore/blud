# Ending plan 1 (the control room): notes

Plan: [2026-09-30-night-train-control-room.md](../../superpowers/plans/2026-09-30-night-train-control-room.md) ·
spec: [egg ending design](../../superpowers/specs/2026-09-30-night-train-egg-ending-design.md).

## What was built

| Commit | What |
| --- | --- |
| `262e3c1e` | Kit: control-room pieces (CRT consoles in 3 colours, server rack, CRT wall, firebox door, egg plinth + placeholder egg, cable tray, blank end wall) |
| `c23425b6` | Kit fix: console keyboard sits on the desk; 5 mm screen offsets |
| `7f500abf` | Level: the 3 x 8 m cab becomes an 8 x 10 m `control-room` (z -130.4...-140.4) with the placeholder egg at u 6.3; the `level.end` box is around the egg |
| `18456322` | Train and loop gates walk to and complete at the control-room egg |
| this commit | Notes, layout doc, regenerated layout drawing, task board; `night_train_layout.py --svg` fixed (it still unpacked 2-tuples from `lamps()` after the Boiler Room's shadow flag was added) |

## Gates

- Train gate (`.lab-tmp/train-gate-after.txt`): PASS.
- `sdf-game-light-gate`: PASS (wall 234 s). `sdf-disco-check`: PASS (wall 12 s).

```
pose     draw calls (no art -> art)   frame ms (no art -> art, median of 5 A/B rounds)
office     164 -> 346                   18.90 -> 23.40  (paired +4.80)
third      153 -> 319                   19.60 -> 23.50  (paired +3.90)
dining     140 -> 288                   17.60 -> 22.40  (paired +4.20)
coats      123 -> 248                   18.60 -> 23.10  (paired +4.00)
sleeper    114 -> 213                   18.00 -> 19.40  (paired +1.30)
boiler     103 -> 181                   16.60 -> 20.50  (paired +2.90)
control     56 -> 79                    16.70 -> 18.30  (paired +1.40)
ok   cost: inside budget (+200 draws, +12 ms)
```

The new `control` pose (0, -131.4, facing the egg) costs +23 draws, +1.4 ms paired.

Old poses, before (`.lab-tmp/train-gate-before.txt`) vs after; "art" is the art-on minus art-off draws:

| pose | total before -> after | art draws before -> after |
| --- | --- | --- |
| office | 320 -> 346 | 164 -> 182 |
| third | 295 -> 319 | 148 -> 166 |
| dining | 264 -> 288 | 130 -> 148 |
| coats | 227 -> 248 | 107 -> 125 |
| sleeper | 193 -> 213 | 81 -> 99 |
| boiler | 157 -> 181 | 60 -> 78 |

Rooms 1-7 are byte-identical in the level JSON, yet every pose pays a constant **+18 art draws**
(the no-art column also moves by +3..+8, other objects/lights). Boot line: 177 art meshes / 283
source instanced meshes, was 160 / 250. Paired ms deltas are within the gate's noise.

## Finding: where the extra draws come from (instancing is not the cause)

Hypothesis "new repeated kit pieces are exported as GPU-instanced meshes that are always drawn":
**refuted in its mechanism, confirmed in its effect.**

- `scripts/levels/export_level.py` makes every repeated kit piece an instanced glTF node (one per
  room, piece, part). But at load `batchArt()` in `src/lab/sdf-zombie/webgpu/game-art-leaves.ts`
  bakes every static mesh and every instance into world space and merges them per
  `artBatchKey` = (room, material, shadow flag, vertex layout). So instanced vs joined makes no
  difference at runtime: the draw count is the number of distinct (room, material, shadow)
  batches. The "283 instanced" in the boot line is only the count of source InstancedMeshes
  before that merge.
- The old cab was 9 joined meshes (0 instanced, 8 materials). Room 8 is now 52 mesh nodes, 33
  instanced (all 33 of the +33 are room 8): 20 from the new pieces (crt-console x12 parts over 3
  colours, server-rack x6, cable-tray x2) and 13 from the reused `bay-*-80-34` shell pieces. Room 8
  goes from 8 to 18 distinct materials (the three CRT screen colours, beige, LED, egg, rubber, rust,
  plinth...), so about 10 more batches by the GLB count (runtime shows +17 art meshes; the gap
  was not chased).
- Nothing culls art by room. The only visibility switches on art are the debug `setArtVisible`
  and three's per-mesh frustum cull. A room-sized batch has a bounding sphere about 13 m across and
  the carriage is a straight tunnel, so when the camera looks down the train every room's batches
  are inside the frustum, doors and walls included (no occlusion culling for art). That is why the
  office pose pays for room 8 (and every room pays for every other room ahead of it).

Cheapest fixes, not implemented:

1. **Fewer materials in room 8** (smallest change, no engine work): give the three CRT colours one
   material (vertex colour, or one small atlas texture) and fold beige/LED/rubber/rust into existing
   kit materials. Expected: about -6..-8 batches, roughly -6..-10 draws at every pose.
2. **Per-room art visibility** (biggest win): each frame (or on room change) hide art batches whose
   room is not the player's room or its neighbours (`userData.room` is already on every batch and
   `nearRoomMask` exists for lights). Expected: about -18 draws at the office/third/dining/coats
   poses from room 8 alone, and far more overall since rooms 1-7 are about 120 batches.
   Needs a check that nothing is seen through the door at range (vestibules are 1.2 m, the
   neighbour rule covers it).

Headroom: the worst pose (office) is +182 art draws against the +200 budget, so **about 18 draws
of headroom**. Any further room-8 or other art will break the gate unless one of the fixes lands.

## In-game look vs the blockout

Image: `control-room-ingame.png` (from the door, facing north; the tuning panels are the dev UI).
Blockout: `control-room-door.png`, `egg-close.png`.

- The egg is centred and reads as a large milky ellipsoid on the plinth, with the orange plinth
  ring and the black tube stubs around its base, like the blockout (the blockout's veins, inner
  egg and glass are plan 2).
- The CRT wall fills the north wall behind it, lit in amber, cyan and green tiles; racks with
  blinking LEDs line both sides; the firebox door glows orange on the east wall's north end
  and no console overlaps it.
- Room is dim and warm, with the egg pool and firebox glow; nothing pure black or blown out.
- Cable trays: dark beams run under the ceiling at each side; they read as beams under the arch,
  not buried in it. No defect found, nothing changed.
- Only the door view exists. No side or wide view was captured.

## Open items

- The egg is a placeholder (flat milky colour); plan 2 is the WGSL egg pass.
- Lighting is a first pass (egg light and firebox light at power 4.0, one dying tube).
- The consoles' CRT screens are static emissive colours, not animated.
- Draw-call headroom at the office pose is about 18 of the +200 budget (see above).
