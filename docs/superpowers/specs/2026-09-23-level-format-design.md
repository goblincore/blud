# Level Format v1 — Design Spec

**Date:** 2026-09-23 · **Status:** accepted for implementation
**Implemented by:** [plan 2026-09-11-wake-1-level-format](../plans/2026-09-11-wake-1-level-format.md) (revised 2026-09-23)
**Used by:** [The Wake](../../game/levels/00-the-wake/design.md), [Night Train](../../game/levels/01-night-train/design.md), every later level and the train hub.

---

## 1. Why

The game has no level format. The only level is the testbed ring in
`src/lab/sdf-zombie/webgpu/game-level.ts`: five box rooms written as data, with
collision boxes hand-built for that one layout, read directly as globals
(`ROOMS`, `TUNNELS`, `FURNITURE`, `PLAYER_START`) by `game-main.ts` and about a
dozen feature modules.

Levels need to be **authored in Blender, stored as data, and loaded by name**,
and that data must outlive the web build: release is a Rust + wgpu port
(production scope §4.6). So the format is a documented, engine-neutral data
contract, and this spec is its source of truth. TypeScript types, the Blender
exporter and the future Rust loader all implement this document.

## 2. Principles

1. **Authors draw spaces, not walls.** A level lists rooms, corridors and
   boxes. Walls, openings, door headers and corridor ceilings are *generated*
   by one documented rule (§6). Moving a room moves its walls.
2. **Plain JSON, one file per level.** `public/assets/levels/<id>.level.json`.
   No binary, no references to engine types.
3. **Strict.** Unknown keys are errors. Validation reports *every* problem at
   once. A level that parses is a level the engine can load, or a level the
   engine rejects with a clear capability message (§8).
4. **The format can describe more than the engine supports yet.** Floor heights,
   stairs, windows and open sky are in v1 from the start, so levels never need
   re-authoring when the engine catches up.
5. **Shared fixtures.** Golden files under `public/assets/levels/fixtures/`
   are the conformance suite: the TypeScript parser tests and, later, the Rust
   loader tests read the same files.

## 3. Space and units

- Metres. **Y up.** The player walks toward **−z** to go "north". Yaw 0 faces
  −z; positive yaw turns right (toward +x). Pitch is ignored at load.
- Blender is Z-up. The exporter converts **game (x, y, z) = Blender (x, z, −y)**
  and **game yaw = −(Blender rotation about Z)**.
- Rectangles on the ground are written as 2-D `[x, z]` pairs; everything else
  is 3-D `[x, y, z]`.
- Exported numbers are rounded to millimetres. Validation tolerance is **0.02 m**.
- Generated walls are **0.3 m** thick (`LEVEL_WALL_T`), outside the room rectangle.

## 4. The file (schema v1)

Top level. Every key listed; keys marked *opt* may be omitted.

| Key | Type | Meaning |
| --- | --- | --- |
| `version` | `1` | Format version. Anything else is rejected |
| `id` | string | Matches the file name; `[a-z0-9-]+` |
| `name` | string *opt* | Display name; defaults to `id` |
| `ammo` | `"finite"` \| `"infinite"` *opt* | Default `"finite"` |
| `loadout` | string[] *opt* | Weapons held at the start, e.g. `["melee"]` |
| `completeOn` | string *opt* | Event that completes the level; default `"pickup.cd"` |
| `palette` | object *opt* | `wall`, `floor`, `ceil`, `tunnel`, `solid`: RGB 0–1 |
| `states` | string[] *opt* | Named variants of the level (§7). Default `["default"]` |
| `skyline` | skyline preset name *opt* | Backdrop beyond open-sky rooms (Outdoor v1) |
| `rooms` | Room[] | At least one |
| `tunnels` | Tunnel[] *opt* | Corridors joining two rooms |
| `stairs` | Stair[] *opt* | Ramps between floor heights |
| `furniture` | Box[] *opt* | Floor-standing boxes (cover) |
| `solids` | Box[] *opt* | Any other solid box |
| `gates` | Gate[] *opt* | Solid until an event opens them |
| `triggers` | Trigger[] *opt* | Fire an event when the player enters |
| `windows` | Window[] *opt* | Wall planes that show a view |
| `lights` | Light[] *opt* | Point lights; become room accents |
| `start` | Start | Player start |
| `spawns` | Spawn[] *opt* | Enemies present at load |
| `graves` | Grave[] *opt* | Enemies released by a wave event |
| `pickups` | Pickup[] *opt* | Items |
| `bells` | Bell[] *opt* | Shootable bells |

Every element in every array may also carry **`states`** (string[]) to exist
only in those states (§7).

### 4.1 Elements

| Element | Fields |
| --- | --- |
| **Room** | `id` (int ≥ 1, unique), `name` (unique), `min` `[x,z]`, `max` `[x,z]`, `floor` (y, *opt*, default 0), `height` (ceiling above the floor), `sky` (sky preset name *opt*: open-air room showing this sky instead of a ceiling), `ground` (ground preset, default `"stone"`), `paths` (`{ground, min [x,z], max [x,z]}`[] *opt*: strips of another ground on the floor), `edge` (`{style, height}` *opt*, open-sky rooms only: the visible edge) |
| **Tunnel** | `a`, `b` (room ids), `min` `[x,z]`, `max` `[x,z]`, `height`. Its floor is the rooms' floor (§5) |
| **Stair** | `id`, `min` `[x,y,z]`, `max` `[x,y,z]`, `up`: `"+x"`, `"-x"`, `"+z"`, `"-z"`. A ramp rising from `min.y` to `max.y` toward `up` |
| **Box** (furniture, solids) | `min` `[x,y,z]`, `max` `[x,y,z]` |
| **Gate** | `id`, `opensOn` (event), `min`, `max` |
| **Trigger** | `id`, `event`, `once` (bool *opt*, default true), `min`, `max` |
| **Window** | `id`, `view` (string), `min`, `max`: a thin box lying on one room wall |
| **Light** | `pos` `[x,y,z]`, `color` `[r,g,b]`, `power` (number) |
| **Start** | `pos` `[x,y,z]`, `yaw` |
| **Spawn** | `id`, `kind` (`"zombie"` \| `"soldier"`), `pos`, `yaw` *opt* |
| **Grave** | `id`, `wave` (int ≥ 0), `pos`, `yaw` *opt* |
| **Pickup** | `id`, `item`, `pos` |
| **Bell** | `id`, `pos`, `radius` *opt* (default 0.8) |

**Pickup items (v1):** `melee`, `shotgun`, `dynamite`, `shells`, `health`, `cd`.
Adding an item is a v1-compatible change (§9).

Marker ids (gates, triggers, windows, stairs, spawns, graves, pickups, bells)
share one namespace and must be unique.

### 4.2 Example

```json
{
  "version": 1, "id": "two-rooms", "name": "Two rooms",
  "ammo": "finite", "loadout": ["melee"], "completeOn": "pickup.cd",
  "states": ["combat", "quiet"],
  "rooms": [
    { "id": 1, "name": "west", "min": [0, 0], "max": [8, 8], "height": 3 },
    { "id": 2, "name": "east", "min": [9.6, 0], "max": [17.6, 8], "height": 3 }
  ],
  "tunnels": [{ "a": 1, "b": 2, "min": [8, 3.2], "max": [9.6, 4.8], "height": 2.2 }],
  "furniture": [{ "min": [1, 0, 1], "max": [2, 0.9, 2] }],
  "gates": [{ "id": "door", "opensOn": "open.door", "min": [8.6, 0, 3.2], "max": [9, 2.2, 4.8] }],
  "triggers": [{ "id": "t1", "event": "wave.0", "min": [2, 0, 2], "max": [3, 2, 3] }],
  "windows": [{ "id": "w1", "view": "night-fields", "min": [3, 1, -0.05], "max": [5, 2, 0.05] }],
  "lights": [{ "pos": [1, 1.2, 7], "color": [1, 0.5, 0.2], "power": 9 }],
  "start": { "pos": [4, 0, 4], "yaw": 1.5708 },
  "spawns": [{ "id": "z1", "kind": "zombie", "pos": [14, 0, 4], "states": ["combat"] }],
  "graves": [{ "id": "g1", "wave": 0, "pos": [12, 0, 6] }],
  "pickups": [{ "id": "cd", "item": "cd", "pos": [16, 1, 4] }],
  "bells": [{ "id": "bell", "pos": [15, 2.5, 1.5], "radius": 0.8 }]
}
```

## 5. Validation rules

All rules are checked; the parser throws one error listing every failure,
prefixed with the level id.

- **Numbers** are finite; vectors have the right length; every box has
  `max > min` on every axis.
- **Rooms:** unique ids and names; non-empty rectangle; `height > 0`.
- **Tunnels:** join two different existing rooms **on the same floor**; both
  ends sit flush (within 0.02 m) against a wall of each room, and the tunnel
  lies within that wall's span. The axis (`x` or `z`) is inferred from which
  walls it touches. Minimum width **1.4 m** (the enemy navigation grid cannot
  route narrower; §6.4).
- **Stairs** lie inside a room or tunnel footprint; `max.y − min.y ≤ 3`.
- **Furniture** sits on its room's floor and its centre is inside a room.
- **Windows** lie on exactly one room wall (the box straddles the wall plane),
  inside that wall's span and height. The parser records the room and side.
- **Lights** are inside a room; they become that room's accents.
- **Start, pickups** are on a floor (room or tunnel). **Spawns, graves, bells**
  are inside a room (not a corridor).
- **States:** every `states` entry on an element appears in the top-level
  `states`.
- **Outdoor (Outdoor v1 §4.2):** `sky`, `ground`, `edge.style`, `skyline` and every
  path's `ground` name a known preset (Outdoor v1 §4.1). `edge` only on a room with
  `sky`; `0.3 ≤ edge.height ≤ room height`. Every path lies inside its room's
  rectangle and has positive extent.
- **Unknown keys** anywhere are errors (typo protection).

## 6. Generation rules

Given a parsed level, the engine generates collision and display geometry.
These rules are the contract; the TypeScript and Rust generators must agree
(fixtures pin them).

### 6.1 Openings

An **opening** is where a tunnel meets a room wall: west/east walls
(`x = minX` / `maxX`) meet `x`-axis tunnels and span z; north/south walls
(`z = minZ` / `maxZ`) meet `z`-axis tunnels and span x. Openings are sorted
along the wall.

### 6.2 Collision boxes

For each room, with floor `f` and height `h`, per wall:
- wall segments between openings, from `f` to `f + h`, `0.3 m` thick outside the
  room rectangle, extended by the wall thickness at the corners;
- above each opening, a **header** from `f + tunnel.height` to `f + h`.

For each tunnel: two side walls (0.3 m, outside the corridor) up to the taller
joined room's height, and a **lintel** from `f + tunnel.height` to that height.

Then every furniture box, solid, and (while closed) gate. A room with `sky` has
no ceiling; walls still reach `f + h`.

### 6.3 Display geometry

Inward-facing planes: a floor and (unless `sky`) a ceiling per room; wall
planes split around openings, with a header plane above each; corridor floors
and side walls; lintel boxes; furniture, solids and gates as boxes (gates
separately so they can be hidden). Windows are planes on their wall, drawn over
it. Plane rectangles must have positive extent on the wall's span axis (axis-0
walls span z, axis-2 walls span x).

### 6.4 Navigation

Enemy navigation is built over room and tunnel rectangles with **gates open**,
from boxes that block walking height. Its grid is 0.4 m with 0.34 m actor
inflation, hence the 1.4 m minimum corridor width.

### 6.5 Outdoor (Outdoor v1 §5)

Open-sky rooms (`sky`), grounds, paths, edges and skylines generate by the rules
in [Outdoor v1 §5](2026-09-23-outdoor-v1-design.md): display walls of an edged
room stop at `edge.height` while collision still reaches `f + h`; the floor
plane takes the room's `ground` and each path is a floor quad a few millimetres
above it; a `skyline` draws silhouette bands beyond the level's bounds. The
TypeScript and Rust generators must agree there as here.

## 7. States

A level can describe several **states** of the same place: the Night Train in
`combat` and in `quiet` (the hub), a revisited stop in a later tone phase.

- The top-level `states` lists them; the **first is the default**.
- An element with `states` exists only in those states; an element without
  `states` exists in all of them.
- The engine loads one state: `?level=<id>&state=<name>`, or the default.
- The parser returns the level **already filtered** to that state; nothing
  downstream knows states exist.

## 8. Capabilities

The format can describe features the engine doesn't support yet. The parser
**derives** what a level needs (authors never declare it):

| Capability | Needed when | Web engine v1 |
| --- | --- | --- |
| `multi-floor` | any room `floor ≠ 0`, or any stair | **Not supported** (player, actors and navigation assume y = 0) |
| `windows` | any window | Supported as a static placeholder plane; scrolling views are Night Train work |
| `open-sky` | any room with `sky` | Supported: no ceiling, a flat sky colour |

The engine refuses to load a level that needs an unsupported capability, with
a message naming it. The level still parses and its tests still run.

## 9. Versioning

- **Compatible within v1:** new optional keys with defaults, new pickup items,
  new events, new window views, new capabilities. The parser, the exporter and
  this spec change together in one commit, with a fixture.
- **Breaking → v2:** renaming or removing keys, changing a default, changing a
  generation rule's output. A v2 parser must still read v1 files (or a
  migration script converts them).

## 10. Events

Strings with dots, never colons.

| Event | Fired by | Meaning |
| --- | --- | --- |
| `wave.<n>` | triggers, scripts | Release grave wave n |
| `bell.toll.<n>` | a bell's nth toll | Also calls `wave.<n>` |
| `alert.room.<id>` | triggers | Turn every enemy in that room toward the player |
| `pickup.<item>` | collecting a pickup | e.g. `pickup.cd` |
| *level `completeOn`* | any of the above | Ends the level |

Gates open on any event, by name.

## 11. Blender authoring

Full conventions: [`docs/game/levels/blender-conventions.md`](../../game/levels/blender-conventions.md).
In short: collections `rooms`, `tunnels`, `stairs`, `furniture`, `solids`,
`gates`, `triggers`, `windows`, `lights`, `markers`; names carry the fields
(`room:<id>:<name>`, `tunnel:<a>:<b>`, `stair:<up>:<id>`, `gate:<event>:<id>`,
`trigger:<event>:<id>`, `window:<view>:<id>`, `spawn:<kind>:<id>`,
`grave:<wave>:<id>`, `pickup:<item>:<id>`, `bell:<id>`, `start`); custom
properties carry the rest (`sky`, `once`, `radius`, `power`, `states`). Scene
properties carry the level header (`level_id`, `level_name`, `ammo`, `loadout`,
`complete_on`, `states`).

## 12. Out of scope for v1

Arbitrary meshes as level geometry (art passes will attach meshes to rooms
later, as an additive v1 key), sloped or non-rectangular rooms, doors that
animate, moving platforms, sound emitters (G3), the scrolling-view system itself.
