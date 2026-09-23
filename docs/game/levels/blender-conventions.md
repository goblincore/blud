# Authoring a level in Blender

**Spec:** `docs/superpowers/specs/2026-09-23-level-format-design.md` (the source of truth)
**Exporter:** `scripts/levels/export_level.py`

## Space
- Metres. Blender is Z-up; the game is Y-up. game (x, y, z) = Blender (x, z, −y).
  Game "north" (−z) is Blender +Y.
- Snap to a 0.1 m grid. Corridor ends must sit *exactly* on a room wall.
- A room's floor is the bottom of its box. Floors other than z = 0 need the
  engine's `multi-floor` support (spec §8); the level still exports.

## Collections (names exact)

| Collection | Contains | Object name | Notes |
| --- | --- | --- | --- |
| `rooms` | box meshes | `room:<id>:<name>` | Box bottom = floor, top = ceiling. Custom property `sky` (a view name) makes it open-air |
| `tunnels` | box meshes | `tunnel:<a>:<b>` | Both ends flush with their rooms' walls; same floor as both rooms; ≥ 1.4 m wide |
| `stairs` | box meshes | `stair:<up>:<id>` | `<up>` is `+x`, `-x`, `+z` or `-z` in **game** axes |
| `furniture` | box meshes | any | Sits on its room's floor |
| `solids` | box meshes | any | Any other solid box |
| `gates` | box meshes | `gate:<event>:<id>` | Solid until `<event>` fires |
| `triggers` | box meshes | `trigger:<event>:<id>` | Custom property `once` (default true) |
| `windows` | thin box meshes | `window:<view>:<id>` | Straddles exactly one room wall |
| `lights` | point lights | any | Custom property `power` (default energy ÷ 10) |
| `markers` | empties | see below | +Y arrow is "forward" |
| `dressing` | any meshes | any | **Ignored by the exporter.** Placeholder props for reviews; the art pass's starting kit ([level design guide](level-design-guide.md) §7) |

## Markers
`start` (exactly one; Z rotation = facing) · `spawn:<zombie|soldier>:<id>` ·
`grave:<wave>:<id>` · `pickup:<melee|shotgun|dynamite|shells|health|cd>:<id>` ·
`bell:<id>` (custom property `radius`, default 0.8).

## States
Scene custom property `states` = comma-separated names (first is the default).
Any object's custom property `states` = comma-separated names it exists in.

## Scene custom properties
`level_id` (required), `level_name`, `ammo` (`finite`|`infinite`), `loadout`
(comma-separated), `complete_on` (default `pickup.cd`), `states`.

Blender's duplicate suffix (`.001`) is ignored. Event names use dots, never
colons.

## Export
    blender --background assets-source/levels/<id>.blend \
      --python scripts/levels/export_level.py -- public/assets/levels/<id>.level.json

Then run the level's test (`npm test -- level-json.<id>`) and open
`/sdf-game.html?level=<id>` (add `&state=<name>` for another state).
