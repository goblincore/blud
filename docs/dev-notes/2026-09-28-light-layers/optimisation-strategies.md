# Optimisation strategies — parked, 2026-09-28

The owner settled the body look on 2026-09-28 ([notes](notes.md)) and asked what could be simplified or moved to
the GPU. **Parked**: the Boiler Room resize goes first. This is the menu for when it resumes. Rule for every item:
measure before and after (`attributePassSamples` for GPU passes — on Apple GPUs a pass's own end − start is queue
residency, not cost; the light gate's cost section `LIGHT_GATE_ONLY_COST=1` for frame medians; quiet machine, load
average under 4).

## MEASURED 2026-09-29 (quiet machine, load ~4) — read this before the sections below

The "tube shadows are ~4–9 ms per carriage" figure below was wrong: the cost harness runs with the sim frozen, so it
never re-rendered a shadow map, and the number was really the tubes' lights in the level materials. Measured properly
(`LIGHT_GATE_TUBE_SHADOW=1 LIGHT_GATE_ONLY_COST=1 scripts/sdf-game-light-gate.sh`, sim steps + draws):

- **Live tube shadow re-renders: 0.0 ms (third class), +0.3..1.0 ms (Boiler Room).** So the static/dynamic bake in §1
  would save under 1 ms: **not worth building.** 256² maps done (`TUBE.shadowSize`), cost neutral.
- **A real three.js light costs its level materials ~1 ms a frame per room** (`sdf:shell-hull` pass). The wins:
  every tube's omni spill made list-only (**−3 ms Boiler Room**, −0.5 third class, frames indistinguishable), and the
  Boiler Room's second tube row built list-only (**+2 ms instead of +10**).
- What the tube system costs now (`?tubes=0` vs default): about **+4 ms per carriage**, of which beams 0, shadow-map
  sampling ~0.7 (Boiler Room), live shadow renders ~0–1, the rest (~3 ms) the tube spots themselves in the level
  materials. The only structural fix left is §2 below (level materials on the shared list).

## 1. Tube shadow maps (largest known cost: ~4–9 ms per carriage) — SUPERSEDED, see above

Today (`game-dynamic-light-leaves.ts`, `TUBE`): every tube is a `SpotLight` with a **512²** hard shadow map. Maps
render once at boot, then **every other sim step for every lit tube in the player's carriage** (`rt.shadowTick & 1`).
Casters: the level art plus the zombie hulls (`SHADOW_HULL_LAYER`). The Boiler Room now has 4 tubes, third class 2.

- **256² maps — owner approved (2026-09-28): "fairly simple, 256 would be perfectly fine".** One constant
  (`TUBE.shadowSize`). The 09-27 A/B found them indistinguishable; it saved no measurable time then, because the
  cost is draw calls into the map, not fill. So do it for memory/fill, but expect the real win from the items below.
- **Bake the static part (owner: "baking sounds like a good option").** The art never moves; only the zombies and
  the swing do. Options, cheapest first:
  1. Render each tube's map with the art once at boot into a static depth texture; each live update renders only
     the hull layer into a second small map; the shader takes the min of the two depths. Draw calls per update
     drop from the carriage's art (~100+) to the few visible hulls.
  2. Skip the swing in the shadow camera (the swing is small); then the static map never needs re-rendering.
  3. Update hull maps only when a body in that tube's cone moved (dirty flag from the actor positions).
- **Cull casters per tube:** only hulls inside the cone's bounding sphere (the cone is ~3.3 m across at the floor).
- **Lower rate for far tubes:** every step for the tube over the player, every 4th for the others.

## 2. Level lighting on the shared list (planned "part 3, plan 2")

The level's three.js materials loop over their lights per fragment (the per-room lists already drop other rooms'
accents). Moving level materials onto the shared list (one storage buffer, per-room picks, the shadow atlas) is
the planned route and removes three's per-light shader variants and their uniform upkeep. Biggest structural win;
largest job. See [rendering](../../tasks/rendering.md).

## 3. Retire code paths the chosen look no longer uses

The chosen default (list on; the old per-pixel torch while it is lit; S-curve off) leaves in the march shader:
the list-torch branch (chest-judged beam tail, the white clip, `listTorchShare`), skin detail for everyone but the
soldier, and on the CPU the old presenting-key path (`presentingLamp`/`applyWindowKey`) that runs only with the list
off. **Keep the LIGHT LAYERS switches until the owner has lived with the look**, then delete behind a decision:
a smaller march body means fewer registers (occupancy) and faster cold compiles (the warm gate). Measure the
march pass before and after.

## 4. Light picking on the GPU

Every frame the CPU builds the list (`writeLightList`) and picks 4 lights per body (`pickLights`, allocation-free)
and writes them into each instance record. A compute pass could pick per instance on the GPU from the same buffer.
Earlier profiling found the frame CPU-bound on **draw calls**, not this — measure the pick's share of the CPU
frame first; likely a small win unless crowds grow.

## 5. Beacons (+0.7 ms frame in the Boiler Room)

Per-frame hard shadows for two rotating spots while armed. Same bake idea as the tubes (static art map + hull
map), or render the beacon shadow at half rate (the sweep is 0.7 rev/s).

## Suggested order when this resumes

1. Profile third class, the Boiler Room (after the strobe) and the ring into one ranked table.
2. 256² tube maps (owner-approved, trivial).
3. Static/dynamic split of the tube shadows (the bake), then the beacons with the same machinery.
4. Retire unused paths (after an owner sign-off on the look).
5. Plan 2 (level materials on the list) as its own spec and plan.
