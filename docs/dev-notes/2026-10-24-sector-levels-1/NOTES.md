# Sector levels 1 — walk an empty E1M1 (notes)

[Plan](../../superpowers/plans/2026-10-24-sector-levels-1-walk-e1m1.md) ·
[spec](../../superpowers/specs/2026-10-24-doom-sector-levels-design.md) · 2026-10-24

## What was built

- **Format** (`sector-def.ts`, `sector-json.ts`): `geometry: "sectors"` levels — vertices, sectors
  (floor, ceiling, light, zone, materials, optional special), lines (front/back, `door`, `exit`).
  The parser synthesizes one art-shelled room per zone and hands the shared markers (start,
  lights, solids, spawns, pickups, triggers, cues) to `parseLevelJson`. `parseLevel` picks
  sectors or rooms. Committed fixture: `public/assets/levels/fixtures/sectors.level.json`.
- **Ground** (`level-ground.ts`, `sector-ground.ts`): the `LevelGround` interface (flat ground for
  room levels, byte-identical behaviour there); point-in-sector on a 4 m grid, floors, ceilings,
  blocking lines (opening under 1.9 m headroom, or a climb over the 0.75 m step).
- **Player** (`game-player.ts`): segment collision against blocking lines, feet on the sector
  floor, ceilings, the eye easing up steps (`stepLag`).
- **Geometry and mesh** (`sector-geometry.ts`, `game-sector-mesh.ts`): sector polygons with holes,
  oriented wall quads (lower/upper/mid), one merged mesh per zone and role in the level group,
  room-tagged like level art, the arena's stone material everywhere.
- **Converter** (`scripts/levels/doom_map.py`, `doom_tables.py`, tests in
  `scripts/tests/test_doom_map.py`): WAD → `public/assets/levels/doom-<map>.level.json` (gitignored,
  a dev placeholder like the Blood assets) plus an optional SVG plan.
- **Gate** (`scripts/sdf-game-doom-gate.{sh,mjs}`, ports 5483/9483): the fixture always (boot,
  step up, ledge stop, pit drop, column stop), then E1M1 when generated (boot, the route, budget,
  `SHOTS=1` writes `.lab-tmp/doom/e1m1-<waypoint>-<yaw>.png`, yaw k = −z, +x, +z, −x).
- **Run it:** `npm run dev:doom` (`/sdf-game.html?level=doom-e1m1`).

Converter summary for E1M1:
`public/assets/levels/doom-e1m1.level.json: 88 sectors, 486 lines, 12 zones, 8 door lines, 9 lights`
(doors written open, floor-lower targets written lowered, lifts static).

## The E1M1 route (gate default, `DEFAULT_ROUTE`; `DOOM_ROUTE` overrides)

`[[0, 0], [0, -17], [5.75, -22.75], [8.5, -34], [30.25, -33.75], [32.75, -31.25], [49.75, -31.25], [57.75, -23.25]]`

Start (sector 29, floor 0) → north across the start room (zone 3, floor −0.5/−0.25) → its
north-east door → the bent corridor (zone 7) → the window room (zone 2, 7 m ceiling) → the
corridor east, down a 0.25 m step (zone 9) → onto the zigzag walkway over the nukage (sector 49,
floor −0.75). Picked by a grid search over the generated level (0.25 m cells, 0.75 m step, 1.9 m
headroom, 0.45 m clear of every blocking line, hurt sectors excluded) and every leg checked as a
straight line, not by eye. The search's full path to the exit (sector 70) has ~15 waypoints:
after the zigzag it goes `[61, -17]`, `[60.25, -12]`, `[64.25, -8]`, `[62.5, 1]`, `[62.25, 18.75]`,
`[61.5, 31.75]`, `[61.5, 33]` (zone 5 then zone 11) — not gated yet; the next plan's gate can extend
the route with them. Legs get `max(6 s, 2 s + length / 2.4 m/s)`.

Every leg passes (each ends within 0.6 m of its target, feet on the reported floor).

## Budget

At the start pose, after warm-up, median of three `timeDraws(21)` medians:

| run | load avg | draw calls | frame ms (three readings) | verdict |
| --- | --- | --- | --- | --- |
| 1 | ~40 | 346 | 32.50 (15.4, 32.5, 33.0) | pass |
| 2 | ~20–50 | 224 | 34.10 (31.3, 34.1, 34.9) | FAIL (> 33.3) |
| 3 | ~13–28 | 102 | **5.50** (3.6, 5.5, 6.3) | pass |

The machine was shared and heavily loaded during runs 1–2 (load average 20–215; the Flat gate
measured 44.6 ms in the same hour and 28.1 ms once the load fell, the Wake did not finish its
precompile in 180 s and passed later). Run 3, on a quieter machine, is the real number: **5.5 ms,
~100 draw calls**. Runs 1–2 were load, not the level. Every zone room's light list holds 15–16
lights (`__sdfGame.levelProbes.lights`); lighting is a later plan (4) and was not touched. The
draw-call reading is noisy (102 / 224 / 346 across runs: the game's own rAF frames can land
between the reset and the read); the gate now resets the counters, draws one frame, then reads,
because a bare `drawStats(true)` after boot read 0 (as it still does in the Flat gate).

## Shots looked at (`.lab-tmp/`, never committed)

`.lab-tmp/doom/fixture.png`, `fixture-steps.png`, `fixture-pit.png`, and `.lab-tmp/doom/e1m1-<0..7>-<0..3>.png`;
the representative ones: `e1m1-0-1.png` (start, facing +x: a solid brick wall turning a corner, brick
ceiling), `e1m1-1-1.png` (north end of the start room: a door jamb, walls and floor), `e1m1-4-1.png`
(window room facing +x: a lower ceiling's soffit, a wall corner, floor), `e1m1-6-1.png` (the corridor
east: walls and ceiling at one brick scale), `e1m1-7-2.png` (on the zigzag facing +z: dark, the
walkway's edge wall low in frame; no nukage glow yet, plan 3).

What they show: walls, ceilings and floors are solid and stone-textured at one brick scale; no
black gaps where a wall should be and no inside-out faces seen; soffits (ceiling steps) read as
planes. The level is very dark away from the flashlight (no sector light yet, plan 4), so far walls
and floors fade to flat grey-black and the shots cannot prove the absence of a floor over a pit
in the dark parts; the reviewer BFS and the gate's floor checks are the evidence there. Close to a
wall the flashlight blows the bricks out (`e1m1-2-3.png`, `e1m1-5-0.png`).

## Known gaps (left on purpose or found in review)

- **Slugs pass through sector walls**: `game-hit-trace.ts` reads the AABB colliders only.
- **Dynamite, gibs and blood land at y = 0**, not on the sector floor.
- **The emergence hand-off and the head-sever standoff seam don't look up the sector floor.**
- **`teleport` to a zone's box centre can land outside every sector** (zone boxes are bounding
  boxes of irregular sectors).
- **Lights choose the first overlapping zone room** (zone boxes overlap).
- **Lights only in zones ≥ 150 m²** (9 for E1M1).
- **Loop chaining at pinch vertices takes the first edge** (sweeping clockwise from the way back).
- **Wall texture U restarts per quad** (a seam at each vertex), and a **horizontal seam at y ≈ 2 m**
  where the stone texture's vertical tile isn't seamless.
- **12 of 88 sectors are unreachable** from the start (reviewer BFS, step 0.75 m, headroom 1.75 m;
  76 reachable including the exit sector 70): ledges above Doom's step, pedestals, and the secret
  lift (sectors 87/58) written at its top, since lifts are static in step 1.
- **Converter floor-lower specials all go to the lowest neighbour floor**: Doom's 19/45/83/102 go
  to the highest neighbour, 36/70/71/98 to highest + 8 units.
- **Special 16 sectors are re-set to door height** (written open).
- **Tagged remote doors** (E1M1 sectors 2 and 4) have no door line: plan 2 must make them movable
  from their tagged trigger lines.

## Owner follow-ups

- After the playtest, if the feel is confirmed: a separate design pass on formalizing the level
  model around Doom-style sectors as part of the overall engine and code structure — rooms vs
  sectors, zones as the lighting/event unit, and how level code is organized for the Rust port.

Owner checkpoint: play `npm run dev:doom` and judge the space.
