# Night Train art direction v2 (restyle) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Night Train kit as a grimy industrial prison train (spec part 1): scratched specular steel, pipes, gears, cages, soot, booths, party remnants; darker lights. Layout, window scenery and sway unchanged.

**Architecture:** `build_train_kit.py` gets a new material pipeline (per material: colour, roughness and a bump height baked to colour, roughness and tangent-space normal PNGs, at most 1024 px) and restyled pieces under the same names where the role is the same. `build_night_train.py` places them from the unchanged layout tables, plus a small per-carriage dressing pass (valves, gauges, boilers, gears, grilles, streamers, bunting, hats).

**Tech Stack:** Blender 5.2 (bmesh, Cycles EMIT/NORMAL bakes, glTF export of base colour, metallic-roughness and normal), TypeScript tests, CDP gate.

**Spec:** [2026-09-25-night-train-art-v2-design.md](../specs/2026-09-25-night-train-art-v2-design.md)

---

### Task 1: Kit v2 (`scripts/levels/build_train_kit.py`)

- [ ] **Materials:** `procedural(kind)` returns three sockets (colour, roughness, height) for `steel`, `steel-scratched`, `plate` (a brick-texture seam grid plus a rivet grid from a fine Voronoi), `grate` (bars from a UV sawtooth), `rust`, `pipe`, `brass-old`, `leather` (Voronoi-edge cracks), `canvas` (grimy bunk canvas), `soot` (an alpha gradient), `party` (Voronoi cells through a saturated ramp). Bakes: colour and roughness by EMIT (roughness saved non-colour), normal by a NORMAL bake of a Principled BSDF with `Bump(height)`. Final materials: Principled with the three images (normal through a Normal Map node), constant metallic; `train.soot` is black with alpha from its map (blend). `train.lamp` and `train.firebox` stay emissive; the lamp's strength drops to 0.6.
- [ ] **Shell pieces** (names kept): `bay-wall-{window,plain,door}` (riveted plate below, brushed steel above, heavy bolted window frame, two bracketed pipe runs, a soot decal at the base), `bay-pillar` (an I-beam), `bay-ceiling-W-H` (steel arch, a rib, a centre pipe, a caged lamp), `bay-floor-plate-W` and `bay-floor-grate-W` (replacing planks/runner), `end-wall-door-W-H` (riveted bulkhead, heavy frame), `partition-H` (plate and steel both faces), **new** `cage-partition-H` (bars and rails, 1 m long, scaled), `vestibule` (bellows, grate floor, pipe).
- [ ] **Props** (restyled): `lamp-hanging` (caged, on a rod; sway), `curtain` (a tattered canvas rag; sway), `seat-bench`, `luggage-rack` (steel frame, grate shelf), `trunk`, `trunk-big`, `coffin` (steel), `desk`, `stove`, `buffet-island`, `galley-stoves`, `galley-counter`, `bar`, `pillar-round` (a riveted steel column), `bunk` (steel racks, canvas mattresses), `jukebox` (battered steel), `favour-table` (steel), `cab-shell` (blackened steel, pipes, gauges, the firebox). **New:** `booth` (facing leather benches and a steel table along a wall, 0.75 × 1.8 m), `boiler` (a wall boiler with a glowing grate, 0.8 × 0.8 m footprint), `gear-housing`, `grille`, `valve`, `gauges`, `streamers`, `bunting-W` (across the carriage), `party-hats`.
- [ ] Build with `--renders`; look at every piece. **Commit** `feat(train): kit v2 — grimy industrial steel (baked colour, roughness, normal), cages, booths, boilers, remnants`.

### Task 2: Build v2 (`scripts/levels/build_night_train.py`)

- [ ] Floors: plate in the van, grate elsewhere. `table` props → a `booth` against their wall (turned for the east side). Cage partitions: the van's partitions and the sleeper's corridor wall. Dressing per carriage: a `valve` or `gauges` on alternate bays (both sides); `boiler` + furniture box in the sleeper's north lobby (east) and the party carriage's south-east corner; `gear-housing` on every bulkhead beside the door; `grille` on alternate bays of the van; `streamers` on every party bay and every other dining bay, `bunting` across alternate party bays, `party-hats` on booths and favour tables. Lights: power 3 → 1.5.
- [ ] Build, export; `npx vitest run src/lab/sdf-zombie/webgpu/level-json.night-train` (the layout's checks, including navigation, must still pass with the boilers). Blender eye-height renders of every room. **Commit** `feat(train): night-train v2 dressing`.

### Task 3: Review and checks

- [ ] The train gate (windows, sway, the walk, cost within +200 draws / +10 ms), Void, art, Wake, shorty gates; the full suite. The art file size and texture sizes (≤ 1024 px) recorded.
- [ ] In-game screenshots of each room for the owner. TASKS.md. **Commit** `test(train): v2 checks`.
