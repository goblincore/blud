# Level design guide

**Date:** 2026-09-23 · **Format:** [Level Format v1 spec](../../superpowers/specs/2026-09-23-level-format-design.md)
· **Blender:** [blender-conventions.md](blender-conventions.md) (written by Wake Plan 1, Task 4)
· **Vision:** [../vision.md](../vision.md)

How a level goes from a design doc to something playable, for every level.
The Wake is the first one through; its plan
([Wake Plan 1](../../superpowers/plans/2026-09-11-wake-1-level-format.md), Tasks 5a–5d)
follows these stages exactly.

---

## 1. The stages

| # | Stage | Output | Who |
| --- | --- | --- | --- |
| 1 | **Reference study** | `docs/game/levels/<nn>-<name>/reference-study.md`: lessons in words and numbers | Agent |
| 2 | **Layout** | `layout.md` next to the design: room/corridor tables, encounters, secrets, sightlines, plus a top-down plan | Agent drafts, owner approves |
| 3 | **Blockout** | `assets-source/levels/<id>.blend` → `public/assets/levels/<id>.level.json`, a level test | Agent builds, owner tweaks live in Blender |
| 4 | **Placeholder dressing** | A `dressing` collection in the `.blend`: rough props so reviews read as a place | Agent |
| 5 | **Playtest** | Notes in the level's `tasks.md`; changes go back to stage 2 or 3 | Owner |
| 6 | **Art pass** | Real kit and meshes | Later (after the pipeline verdict and the format's mesh key) |

Don't skip stage 2. A blockout built straight from the design doc's beat
sheet has the right rooms and no level design in it.

## 2. References

**Rule (vision):** take the *type* of a classic level, never its layout,
details or assets. Study for proportions, pacing, loops, fight placement and
how secrets are hidden, then write the lessons down in words and numbers.

### 2.1 Blood's maps

All of Blood's maps are in `~/Downloads/notblood-macos/BLOOD.RFF`
(E1M1–E6M9, BB1–9, DM1–3). The repo can read them:

```bash
python3 - <<'EOF'
import sys; sys.path.insert(0, 'scripts')
from pathlib import Path
from rff_reader import read_rff, iter_by_ext
from map_parser import parse_map
maps = {e.name: e for e in iter_by_ext(read_rff(Path.home() / 'Downloads/notblood-macos/BLOOD.RFF'), 'MAP')}
m = parse_map(maps['E1M1'].data)
print(len(m['sectors']), len(m['walls']), len(m['sprites']))   # 155 1498 559
EOF
```

`scripts/levels/blood_map_plan.py` draws any map top-down as an SVG in
`.lab-tmp/map-research/` and prints its size, sector heights and enemy counts:

```bash
python3 scripts/levels/blood_map_plan.py E1M1 [--bu-per-m 256]
rsvg-convert -w 1400 .lab-tmp/map-research/E1M1.svg -o .lab-tmp/map-research/E1M1.png
```

Useful facts:

- **Geometry.** Sectors are polygons: `sector.wallptr` / `wallnum` index into
  `walls`, each wall runs to `walls[wall.point2]`, and `wall.nextsector >= 0`
  means the wall is an opening into another sector.
- **Things.** Sprites with `statnum == 6` are enemies ("dudes"); `lotag` is the
  type. E1M1 has 46: types 202, 203, 205, 219, 220. Look the numbers up in the
  NotBlood source (`blood/src/blood.h`, the `kDude…` enum; clone
  `github.com/clipmove/NotBlood` into `.lab-tmp/` if it isn't on disk). Items,
  weapons and keys are other statnums; same source.
- **Scale.** The retired sim uses 256 Build units per metre (`src/sim/units.ts`),
  with heights (`z`) 16× finer. At that scale E1M1 is 336 × 240 m and its
  median sector is 8 m tall; at 512 BU/m it's 168 × 120 m and 4 m. **Calibrate
  first**: measure a few doorways and corridors and pick the factor that makes
  a doorway about 2.2 m high. Write the factor into the study.
- **Never commit anything derived from Blood data** (plans, renders, tile
  images). Write them to `.lab-tmp/map-research/`; the study quotes numbers
  and describes what it saw.

### 2.2 Other references

Quake, Doom and other classics: published top-down maps, playthrough videos
and your memory of playing them are all fine to study. Same rule: lessons in
words, no copied layouts.

## 3. Measurements

From `src/lab/sdf-zombie/webgpu/game-player.ts` and the navigation grid. Goblin
scale (the Flat's task F-D5) may still change these; if it does, update this table.

| What | Value | Why |
| --- | --- | --- |
| Player capsule | radius 0.32 m, height 1.75 m, eyes at 1.62 m | `PLAYER` |
| Walk speed | 3.4 m/s | A 20 m room takes about 6 s to cross |
| Jump | about 1.0 m high (6.0 m/s up, gravity 18) | Jumpable ledges ≤ 0.9 m |
| Step-up | **none**: the floor is flat at y = 0 | Any solid box blocks walking; raised floors need `multi-floor` (not in the web engine yet) |
| Narrowest corridor enemies can use | **1.4 m** | 0.4 m grid with 0.34 m inflation; narrower gaps are player-only |
| Lowest ceiling | 2.2 m (2.4 m if enemies come through) | Capsule plus headroom |
| Cover | 0.9–1.2 m high | Crouch-free: the player peeks over |
| Gaps between furniture | ≥ 1.4 m where enemies must path | Same as corridors |

## 4. Enemies you can place today

Only two kinds work in the game: **`zombie`** (melee) and **`soldier`**
(ranged). Spawn markers accept only these (spec: `spawn:<zombie|soldier>:<id>`).

When a design calls for something else (a bloatmaw, a waiter), place a zombie
or soldier in its spot and list the swap in `layout.md`:

| Spawn id | Placed as | Design wants | Notes |
| --- | --- | --- | --- |
| `buffet-1` | zombie | bloatmaw | Floats over the buffet later |

Fights should work with these two kinds alone. Don't build an encounter that
only makes sense with an enemy that doesn't exist yet.

## 5. Layout (stage 2)

`layout.md` is the level's plan of record until the `.blend` exists. It holds:

1. **Room and corridor tables** in game space (x, z in metres; player heads
   toward −z; heights): the same tables the build script reads.
2. **Encounters:** every spawn, what wakes it (a trigger, an alert, a wave) and
   where the player is when it does.
3. **Sightlines:** from each doorway, what the player sees first. Each new room
   should show its exit or its landmark from the entrance.
4. **Loops:** at least one route that lets the player circle a fight (Blood's
   maps loop heavily; the reference study counts how much).
5. **Secrets:** where, how they're hinted, what they hold.
6. **Pickups:** ammo and health, placed after the fights they pay for.
7. **The swap table** (§4).
8. **A top-down plan** (§5.1).

### 5.1 The plan drawing

`scripts/levels/level_plan.py` draws any `.level.json` top-down as an SVG
(rooms with sizes, corridors, solids, gates, triggers, spawns, graves,
pickups, windows, lights, the start; 1 m grid; `--state` for a variant):

```bash
python3 scripts/levels/level_plan.py public/assets/levels/<id>.level.json
rsvg-convert -w 1000 .lab-tmp/level-plans/<id>.svg -o .lab-tmp/level-plans/<id>.png
```

The loop is: edit the tables (or the `.blend`), build, export, draw, review.
Put the current PNG in front of the owner at every review; don't describe a
layout in prose when you can show it.

## 6. Blockout (stage 3)

- **First draft by script** (`scripts/levels/build_<id>_blockout.py`) so the
  layout tables turn into a `.blend` repeatably.
- **After the first build, the `.blend` is the source of truth.** Edit it live
  in Blender over the Blender MCP (the owner can watch and adjust), or by hand.
  Follow [blender-conventions.md](blender-conventions.md).
- **After every edit:** export, run the level's test (`npm test -- level-json.<id>`),
  and open `/sdf-game.html?level=<id>`.
- **Screenshots for review:** render a top view and a few eye-height views
  (1.62 m) from Blender into `.lab-tmp/`.

## 7. Placeholder dressing (stage 4)

Level Format v1 only draws boxes in the game (spec §12: meshes come later, as
an additive key). Dressing lives in the `.blend`'s **`dressing`** collection,
which the exporter ignores. It makes Blender renders and reviews read as a
place, and it becomes the starting kit for the art pass.

Where props come from, best first:

1. **Modelled in Blender** (over the MCP), rough, low-poly: headstones, pews,
   coffins, seats.
2. **CC0 downloads:** Poly Haven, Kenney, Quaternius, ambientCG. Save them under
   `assets-source/dressing/<source>/` and list every one in
   `assets-source/dressing/LICENSES.md` (name, source URL, licence).
3. **Other free models** only if the licence allows redistribution; otherwise
   keep them local and uncommitted, like the Blood assets.

Never use ripped Blood art as dressing, even locally in a `.blend` that gets committed.

## 8. Checklist before a level is "blocked out"

- [ ] The level test passes: it parses, the web engine can load it, the start
      routes to the exit, every spawn is standable, and gates block what they should.
- [ ] It plays start to exit at `?level=<id>`.
- [ ] `layout.md` matches the `.blend` (tables regenerated or edited).
- [ ] Every enemy is a zombie or soldier; swaps are listed.
- [ ] Nothing derived from Blood is committed.
