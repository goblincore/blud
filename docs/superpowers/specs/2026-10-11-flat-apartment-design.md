# The Flat's entry hall and bathroom — design

**Date:** 2026-10-11 · **Status:** design approved by the owner (2026-10-11), plan next · **Branch:** `claude/flat-room` (stacked on the room and the iMac) ·
**Parent:** [the Flat's room in the engine](2026-10-11-flat-room-design.md) · **Flat design:** [`docs/game/flat/design.md`](../../game/flat/design.md) ·
**Owner decisions (2026-10-11):** the flat is a small apartment, not one room; an entry hall south of the room with the front door and the bathroom off it;
the bathroom has a claw-foot tub with a hand shower, a toilet, a sink and a mirror; the mirror is a framed dark polished glass for now (the real planar mirror is a later spike);
**the vision's rule that the goblin's face is never shown is discarded** (the "covered mirror" lines in `docs/game/vision.md` and the covered-mirror row of the Flat design are superseded).

## 1. Why

The owner realised the flat needs more than the one room: an apartment has an entry and a bathroom. The room built in slice 1 (2.7 × 3.6 m, the window, the kotatsu, the
iMac) stays as it is; the flat grows south and east of it.

## 2. The plan view

Blender space (x east, y north); the window is on the north wall of the main room. Dimensions in metres.

```
 y=3.6  ┌───────────────────────────┐
        │   main room 2.7 × 3.6     │ ░ ░ ░ filler (collision only)
        │   (unchanged)             │ ░ ░ ░
 y=0    ├────────╴ arch ╶───────────┤░░░░░░░░░░░░░░░
        │                          ◦│  bathroom 1.75 × 2.0
        │   entry hall 2.7 × 2.0   ◦ doorway (0.8)
        │   genkan step · hooks    ◦│  tub · toilet · sink · mirror
 y=-2.0 └────────╴ front door ╶─────┴───────────────┘
       x=-1.35                   x=1.35           x=3.1
```

| Part | Box | Notes |
| --- | --- | --- |
| Room box | x -1.35 to 3.1, y -2.0 to 3.6, height 2.56 (the vault's crown) | one engine room; the format's 1.4 m minimum applies only to doorways *between* rooms |
| Main room | x -1.35 to 1.35, y 0 to 3.6 | unchanged |
| Entry hall | x -1.35 to 1.35, y -2.0 to 0 | the vault runs on over it; the front door is on its south wall (the door built earlier, moved); the old south wall of the room becomes an arched passage |
| Bathroom | x 1.35 to 3.1, y -2.0 to 0 | a flat ceiling at 2.3 m; doorway off the hall's east wall |
| Filler | x 1.35 to 3.1, y 0 to 3.6 | solid collision, never seen |

**The passage** (the old south wall, y 0): an arch 1.2 m wide, springing at 1.55 m, with the door's stone surround on the hall side. **The front door** (y -2.0): the closed arched oak
door, 0.8 m wide, springing at 1.65 m, unchanged. **The bathroom doorway** (the hall's east wall, x 1.35): 0.8 m wide, 1.75 m high, centred at y -1.1, with a wooden architrave. The leaf the
owner was told would be "swung open" is dropped: in a bathroom this small it collides with the fixtures. A leaf (openable) is a later task.

The player starts in the hall by the front door, facing north, so the flow is door, hall, arch, room.

## 3. What goes in

**Hall** (stone, the same castle ashlar): a raised genkan step (8 cm) over the northern 1.3 m of the floor, which the player really steps up onto (a collider lower than 0.5 m is walkable); coat hooks (bone spurs on an oak rail)
and a low shoe cubby with a few shoes on the west wall; a wall sconce by the bathroom doorway; a stone rib and two vertebral conduits along the vault.

**Bathroom** (its walls lined with small stained tile, a flat ceiling, a tile floor):
- **A claw-foot cast-iron tub** along the east wall: a lofted rounded-rectangle shell (dark cast-iron outside, white enamel inside and on the rim) on four bone-and-bronze claws. Chrome taps and a riser with a hand shower at the south end; a chrome curtain ring overhead (no curtain yet).
- **A toilet** against the north wall (tank, lid, bowl, seat) and **a pedestal sink** on the south wall with chrome taps.
- **The mirror** over the sink on the south wall: a stone-and-bone frame around a dark polished glass (a generated texture: a deep warm black, a vignette and a painted glint). It reads as a mirror from the doorway and
  reflects nothing yet.
- **A Giger pipe run** down the north-east corner into the tub, with a flesh collar where it meets the ceiling. A bare bulb (a green-white lamp) on the ceiling.

## 4. How it is built

Everything stays in the Blender level route; nothing changes in the renderer.

| Unit | Does |
| --- | --- |
| `flat_layout.py` | The footprint (`HY0`, `BX1`), the passage, the front door's new plane, the bathroom doorway, the genkan step, the new collision boxes and `SOLIDS` (the filler and the partitions), the new lights, the new start. |
| `flat/shell.py` | Generalised: the arch and its stone surround are parameterised (`arch_region`, `arch_surround`), so the same code builds the passage and the front door. The west and east walls get a hall segment each (their own texture, so the stone keeps its resolution); the vault, impost, the floor and a rib extend over the hall; the hall's east wall gets the bathroom doorway. |
| `flat/hall.py` (new) | The genkan step, the hooks and the cubby, the sconce, the hall conduits. |
| `flat/bath.py` (new) | The tile lining, the floor, the ceiling, the tub and its claws, the taps and riser, the toilet, the sink, the mirror, the doorway frame, the pipe run, the lamp. |
| `flat/materials.py`, `flat/make_textures.py` | Tile, bath floor, mirror glass and the two hall wall textures; enamel, chrome and bronze materials. |
| `build_the_flat.py` | Calls the new builders; creates the `solids` collection from the layout. |
| `sdf-game-flat-gate.mjs`, `level-json.flat.test.ts` | The gate walks hall to bathroom and hall to room; the test expects the new footprint and a start in the hall; new shots. |

**Collision:** the partitions are `solids` (the two halves of the hall/bathroom wall, the two halves of the old south wall around the passage, the filler); the fixtures are `furniture` boxes at least 0.6 m high
(lower boxes are stepped onto: the capsule's least-penetration push-out).

## 5. Budget and risks

About 10 new materials (+10 draw primitives; the cap is 60, 40 today), roughly +60 000 triangles (the cap is 400 000, 363 000 today), so the **triangle cap rises to 500 000**
(owner: optimisation later). The frame stays under 33 ms. One engine fact to verify first: the dynamic light list holds 32 lights and the probe gather uses 8; the flat will have about 10.
The risk is the wall work: parameterising the arch code and splitting the long walls changes slice 1's code, so the first task re-runs the whole gate after the refactor with no geometry changes.

## 6. Out of scope (follow-ups)

1. **The real planar mirror** (a reflected render, the player's body in it): its own spike. 2. **An openable bathroom door leaf and front door**; anything outside the front door.
3. **A shower curtain**, towels, bath clutter, a kitchenette in the hall. 4. **Updating `docs/game/vision.md`** for the discarded face rule (the owner can ask). 5. The goblin and his human height.
6. **Earlier stages as `states`** of the whole flat. 7. The optimisation pass; the bone, spine and radiator look pass.
