# Train carriage kit — Design

**Date:** 2026-09-25 · **Status:** approved (owner, 2026-09-25)
**Parent:** [New game flow](2026-09-24-new-game-flow-design.md) (build order item 3b) · **Uses:**
[Level mesh key](2026-09-24-level-mesh-key-design.md) · **Level:** [Night Train design](../../game/levels/01-night-train/design.md),
[RE0 reference study](../../game/levels/01-night-train/reference-study-re0.md)

## 1. What it is

The art and tech of Night Train's first slice: a kit of carriage modules and props, the four
first-slice carriages built from it and walkable end to end, windows that show night scenery
scrolling past, and the train's motion. **No gameplay:** no enemies, no Stoker behaviour, no
dawn. Those are the Night Train slice (build order item 4).

**Art direction** (owner, reference study): an old-timey interior. A dark wood dado under pale,
stained panels; brass frames and rails; a clerestory ceiling with side brackets and round lamps;
carpet runners, red velvet, curtains. Take the RE0 train's materials and silhouette, **not its
dimensions**: ours are 3.0 m wide, 2.6 m ceilings, aisles of at least 1.4 m.

## 2. Decisions

1. **Bays assembled by a script.** `kit.blend` holds bay modules and props; a build script
   lays out each carriage from a table; the result is refined by hand. Kit pieces stay linked.
2. **Windows are a WGSL shader in the glass**, with scenery presets (only `night` now).
3. **Motion:** camera roll, bob and rail-joint jolts, plus lamps and curtains swinging on the
   same rhythm. Visual only; one pure module; sim time.
4. **Scope:** the kit plus carriages 1, 3, 5 and 8, dressed and walkable, no gameplay.
5. **Textures:** Blender procedural materials baked to images (at most 1024 px), embedded.

## 3. The kit: `assets-source/levels/kit.blend`

Built by `scripts/levels/build_train_kit.py`. Units are game metres. A **bay** is 1.9 m long in a
carriage 3.0 m wide inside. Every module's origin is on the carriage centreline at floor level, at
the bay's start, so the build script places bays by adding 1.9 m.

| Collection (kit piece) | What |
| --- | --- |
| `bay-wall-window` | One side's wall for a bay: dado (0.95 m, vertical boards, cap rail), pale panel above, a window opening with a brass frame and a `window:night` glass pane, a brass handrail |
| `bay-wall-plain` | The same wall without the window |
| `bay-wall-door` | The same wall with a compartment door (closed, not interactive in v1) |
| `bay-pillar` | The pillar between bays |
| `bay-ceiling-26`, `bay-ceiling-32` | A ceiling bay at 2.6 m / 3.2 m: curved sides, clerestory with its rail, ribbed brackets, a round lamp (emissive) |
| `bay-floor-planks`, `bay-floor-runner` | A floor bay: planks, or planks with a carpet runner |
| `end-wall-door` | A carriage end wall with a door opening (1.4 m wide) and frame |
| `vestibule` | A 1.2 m connector between carriages: floor plate, bellows walls, roof |
| `lamp-hanging` | A pendant lamp (tagged `sway: lamp`, pivot at the ceiling) |
| `curtain` | A window curtain pair (tagged `sway: curtain`) |
| `seat-bench` | A high-backed double bench (red velvet) |
| `luggage-rack`, `trunk`, `coffin` | Guard's van dressing |
| `dining-table`, `dining-chair`, `buffet-counter` | Dining car |
| `jukebox`, `favour-table` | Party carriage |
| `cab-shell` | The cab as one piece: shell, firebox with door (emissive glow), boiler backhead, gauges, the Stoker's floor space, a coal door toward the (absent) tender |

**Baked materials (shared):** `train.wood-dark`, `train.panel`, `train.brass`, `train.runner`,
`train.velvet`, `train.iron`. Each is a Blender procedural node material (wood grain from wave and
noise, stains from noise, the runner from a tiled pattern), baked to 512 or 1024 px by the kit
script and embedded. The emissives (`train.lamp`, `train.firebox`) are flat colours, with no bake.

## 4. The carriages: `night-train`

Built by `scripts/levels/build_night_train.py` into `assets-source/levels/night-train.blend`,
exported as usual (`night-train.level.json` + `night-train.art.glb`).

| # | Carriage | Length | Ceiling | Bays and props |
| --- | --- | --- | --- | --- |
| 1 | Guard's van | 16 m | 2.6 m | Mostly plain walls (few windows), luggage racks, trunks, two coffins |
| 3 | Dining car | 18 m | 2.6 m | Windows both sides, tables with chairs in bays, a buffet counter at one end, runner floor |
| 5 | Party carriage | 20 m | 3.2 m | Windows, favour tables, the jukebox, hanging lamps, runner floor |
| 8 | Cab | about 8 m | cab shell | The cab shell |

- The carriages sit in a row toward −z (the cab is north, like every level's exit). A
  `vestibule` connects each pair: a level-format tunnel 1.4 m wide and 1.2 m long.
- Each carriage is a room with `shell: "art"`. **Collision comes from the same table:**
  every seat, table, counter, rack and trunk emits a `furniture` box; aisles stay at least
  1.4 m clear.
- **Lights:** lamps are emissive. Each carriage also has one or two authored warm point lights
  (power tuned in the gate), so the per-room light lists stay small.
- **Start:** the back of the guard's van, facing the cab. **The Void's portal** target
  becomes `night-train`.

## 5. Windows

- **Mesh key extension:** an art material named `window:<preset>` is replaced in the game by the
  scenery material for that preset. (The general rule: material names can select engine
  materials; this is the first.)
- **`train-window.wgsl.ts`** (`TRAIN_WINDOW`) with twin **`train-window.ts`**: the view ray
  through the pane (from the camera through the fragment) meets, in order:
  - **poles and fence posts:** vertical strips at a fixed distance beside the track, pitch
    40 m (poles) and 3 m (posts), scrolling at the train's speed;
  - **the treeline:** a noise silhouette band at about 60 m, scrolling at parallax speed;
  - **far hills:** a lower-frequency silhouette at about 400 m, barely moving;
  - **the sky:** the night gradient and moon from `SKY_COLOR` (Outdoor v1), reused.

  Motion is along the carriage axis. The preset holds colours, distances and speed; only
  `night` exists in v1 (dawn, desert and stars later). The glass is unlit and additive-free
  (opaque), at emissive level 1 like the art cap.
- **Speed** is a runtime value (m/s, default 20), with a seam so the dawn beat can change it later.

## 6. Motion

- **`train-motion.ts`** (pure; input: sim time `t`, speed):
  - `cameraSway(t)` → `{ roll, bob }`: roll from two incommensurate sines (±0.6°), bob ±6 mm;
  - `joltAt(t, speed)` → an impulse every rail length (18 m) that decays over 0.25 s (adds to
    bob and roll);
  - `lampSwing(t, phase)` → a pendulum angle driven by the same roll and jolts (±4°);
  - `curtainSway(t, phase)` → 0..1 bend amount.

  All are bounded and deterministic.
- **`game-train-leaves.ts`** applies it only when the level has `window:` glass or `sway`
  pieces. The camera roll and bob are added after the player's view is set (never into the
  player position or collision). Lamps rotate about their pivot. Curtains bend in the vertex
  shader by the uniform.

## 7. Testing

- **Unit:**
  - `train-motion` (bounded, periodic, a jolt per 18 m at the given speed, same inputs give
    the same outputs);
  - `train-window` twin (a ray hits a pole at the configured pitch; the treeline and hills sit
    below the horizon; the sky above matches `SKY_COLOR`'s twin);
  - `level-json.night-train` (four art-shelled carriages in order; vestibules at least 1.4 m;
    a `furniture` box under every seat, table, counter, rack and trunk; the start in carriage 1);
  - the Void's portal targets `night-train`.
- **Headless gate** `scripts/sdf-game-train-gate.sh`:
  - boots `night-train` with art;
  - the window region's pixels differ between two frames 0.5 s apart, and are not flat;
  - the camera roll varies over 2 s;
  - an autopilot walk from the guard's van reaches the cab;
  - entering the Void's portal loads `night-train`;
  - the cost at three poses (van, dining, party) is recorded as draw calls and fenced frame
    time. The budget is proposed to the owner after the first measurement.
- **Regression:** ring, Void, Wake, art and shorty gates; the full suite.

## 8. Open

- Decay variants (broken windows, torn curtains, fallen racks), the tender and the other
  carriages, sound (wheels, wind, the jukebox), the dawn preset, interactive compartment doors.
