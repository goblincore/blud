# The Flat's room in the engine — design

**Date:** 2026-10-11 · **Status:** design approved by the owner (2026-10-11), plan next · **Branch:** `claude/flat-room` ·
**Look-dev:** [`docs/dev-notes/2026-10-01-flat-room-lookdev/`](../../dev-notes/2026-10-01-flat-room-lookdev/notes.md) ·
**Flat design:** [`docs/game/flat/design.md`](../../game/flat/design.md) · **Tasks:** [`docs/game/flat/tasks.md`](../../game/flat/tasks.md) (F-A1, F-T1) ·
**Level format:** [level-format design](2026-09-23-level-format-design.md), [level mesh key](2026-09-24-level-mesh-key-design.md) ·
**Owner decisions (2026-10-11):** first slice is a walkable room; the last stage of the room; structure and hero props only; route 1 (port the look-dev into an engine build script).

## 1. Why

The Flat's room exists only as a Cycles look-dev: four renders and a Blender generator (`room.py`, about 90 KB of procedural
node materials). The owner approved the look on 2026-10-01 ("the room is good for now") and asked for it in the engine.
The engine already has a route for a Blender-authored place: a `.blend` exported by `scripts/levels/export_level.py`
to a level JSON plus an art `.glb`, loaded at `?level=<id>` (Night Train and the Wake were built that way). This design
puts the room through that route, without changing the renderer.

## 2. Scope

**In (the first slice):**

- A level `flat`, loaded at `/sdf-game.html?level=flat`, with a dev-menu entry. Walkable, with collision.
- The last-stage room, as on the look-dev sheet:
  - **The stone shell:** ashlar walls, the segmental barrel vault with transverse ribs on stepped corbels, the impost course,
    the round-arched window with its deep reveal, voussoirs, quoins and diamond lattice, the niche, flagstones and tatami.
  - **The Giger layer:** vertebral conduits along the vault and down the walls, the turned (vertebral) rib, the fleshy
    collars where services enter the stone, the ribbed boiler on the stone sink, the ribcage radiator under the window and the thigh-thick duct.
  - **Hero props:** the kotatsu with its quilt, the futon, the fridge, the bookshelf with its books, the paper lantern,
    the fairy lights, and a placeholder amber shape on the kotatsu where the iMac will go.
- The window light and the room's lamps.

**Out (separate tasks, §11):** the iMac's translucent material and the CRT screen; the goblin's pose at the kotatsu; the
clutter pass (posters, plushies, manga wall, food, socks, gashapon); the earlier stages as level `states`; the "fleshier"
design pass; the goblin rescale.

## 3. Scale and layout

The look-dev's dimensions are kept. Game space is Y up; Blender maps (x, y, z) to game (x, z, -y), so the window's north wall is game -z.

| Item | Value |
| --- | --- |
| Floor | 2.7 m wide (x -1.35 to 1.35) by 3.6 m long (six tatami); the window wall is the north end |
| Vault | segmental barrel along the long axis, springing at 1.95 m, radius 1.8 m, crown about 2.56 m |
| Window | centre x 0.12 m, half width 0.36 m, sill 0.62 m, springing 1.42 m, wall thickness 0.62 m |
| Kotatsu | centre (0.12, 2.36), board top 0.44 m |
| Eye height | the engine's default (1.75 m); no engine change |

The player is human-sized and the levels are scaled to them (doorways and portals 2.2 m). The goblin stays 1.30 m for now.
The owner's view is that the goblin should become human-sized (it is the player character, and the levels are scaled to
the player); that is a separate task (§11), and the room does not depend on it.

## 4. Architecture

One job per unit. The look-dev scripts stay untouched, as provenance.

| Unit | Does | Depends on |
| --- | --- | --- |
| `scripts/levels/flat_layout.py` | Data only: dimensions, each prop's and light's placement, collision boxes, the start marker. Same role as `night_train_layout.py`. | nothing |
| `scripts/levels/flat/shell.py` | Ashlar walls, vault, ribs and corbels, impost, window reveal (voussoirs, quoins, lattice, soffit), niche, flagstones, tatami. | `flat_layout`, `materials` |
| `scripts/levels/flat/giger.py` | Vertebral conduits and collars, the turned rib, the boiler, the radiator, the duct. | `flat_layout`, `materials` |
| `scripts/levels/flat/props.py` | Kotatsu and quilt, futon, fridge, bookshelf and books, lantern, fairy lights, the iMac placeholder. | `flat_layout`, `materials` |
| `scripts/levels/flat/materials.py` | Plain glTF-exportable PBR materials from image textures, replacing the Cycles node trees. | the textures |
| `scripts/levels/build_the_flat.py` | Entry point. Builds the collections per `blender-conventions.md` and writes `assets-source/levels/flat.blend`. | the units above |
| `assets-source/levels/flat-textures/` | Textures at 1024 px or less: the baked Bryce rock (colour and normal), per-wall stain maps, tatami, quilt, bone, gunmetal, flesh. | `textures.py`'s PIL ideas, the kit's rock |
| `public/assets/levels/flat.level.json`, `flat.art.glb` | The export, committed (as Night Train's are), so CI never needs Blender. | `export_level.py` |
| engine | One `LEVEL_CHOICES` entry in `game-menu.ts`; `level-json.flat.test.ts`. | the level JSON |

Build and export:

```bash
blender --background --factory-startup --python scripts/levels/build_the_flat.py
blender --background assets-source/levels/flat.blend --python scripts/levels/export_level.py -- public/assets/levels/flat.level.json
```

## 5. The level's contents

- **Room:** one `room:1:flat` box (`shell: art`: the generated surfaces are not drawn, the art is the room's look). Floor at 0;
  the box top is the vault crown. The vault's curve is art only. A player's head (1.75 m) is below the springing line
  (1.95 m) where the vault leaves the walls, so the box ceiling never shows.
- **Collision:** the room box, plus `furniture` boxes for the kotatsu, futon, fridge, bookshelf, boiler and sink counter.
  Levels with art draw no `furniture` or `solids` boxes (collision only), so the art owns every visible surface.
- **Start:** a `start` marker at the south end, facing the window.
- **Window:** a static textured plane in the window opening showing the Bryce idyll
  (`docs/dev-notes/2026-10-01-flat-emergence-lookdev/view-bryce-moody.png`, the one the look-dev sheet shows, downsized to 1024 px). Scrolling window views are
  Night Train work and are not needed here.
- **Level properties:** `level_id` `flat`, `level_name` "The Flat", no enemies, no pickups, no weapons. `complete_on` defaults to
  `pickup.cd`, which this level never fires. The first plan task confirms that an unarmed level with no spawns, pickups or
  completion loads cleanly; if the engine needs more, the fix is a property in the `.blend`, not an engine change.

## 6. Materials and textures

Art materials are standard glTF PBR (base colour, roughness, metalness, normal, emissive; textures embedded, at most 1024 px,
which the exporter enforces). Meshes are joined per room and per material, so draw calls follow the material count.

- **Stone:** the baked rock colour and normal from `assets-source/levels/kit-textures/` (the look-dev's `rock-color.png`),
  with the ashlar's block relief carried by a normal map. Real geometry is kept only where the silhouette needs it: the
  window reveal, voussoirs, quoins, ribs, corbels and the impost.
- **Wet and rust runs:** the look-dev's per-wall stain maps are baked into a base-colour texture per wall (four wall
  materials), rather than a procedural shader.
- **Giger parts:** gunmetal and bone are shared across every conduit, so the whole layer is a handful of materials.
- **Soft goods:** the tatami, quilt and futon are three small textures.
- **Emissive:** the lantern, the fairy lights and the iMac placeholder, capped by the engine at intensity 1.

About 25 materials in all.

## 7. Lighting

The look-dev's lights map to a few level `lights` (point lights with a `power` property): the cool window light (the only
cool light in the room), the red paper lantern, the candle in its sconce, and a warm amber light at the iMac placeholder
("the machine is the only amber"). The fairy lights and the placeholder's glow are emissive art, not lights. The level
uses the engine's per-room light list; the plan checks the count against its per-room cap.

## 8. Budget

No precedent exists for a small closed room, so this is a proposal. It is checked, not assumed:

- At most about 40 art draw calls, about 400 000 triangles (raised from 250 000 by the owner, 2026-10-11: the look first, then an optimisation pass), and textures of 1024 px or less.
- The frame holds under 33 ms (the 30 fps goal) in the room on the owner's machine.
- The Wake's art cost +75 draws and +5 ms, Night Train's +200 and +12 ms, for reference.
- File size is not a constraint (owner, 2026-10-11).

## 9. Verification

- **Automated:** `level-json.flat.test.ts` (a start marker inside the room, collision boxes, the art present, texture sizes,
  the budget check through `level-art.ts`); `npm run typecheck`; `npm run test:changed`; the module index test. `march-hash`
  must be unchanged, since no renderer code changes.
- **Visual:** in-engine screenshots from the four look-dev cameras (wide, over the shoulder, the iMac, the window), composed
  into a sheet beside `room-sheet.jpg`, for the owner to compare.
- **Frame cost:** draw calls and frame time with the existing harness.
- **Build-script assertions:** the start point and every collision box sit inside the room; no texture is over 1024 px;
  object names carry no long float suffixes (a Blender abort found in the look-dev).
- **Order of work, each step walked and looked at before the next:**
  1. The shell: walls, vault, window with the idyll plane, floor, collision, start marker, the window light.
  2. The Giger layer.
  3. The hero props.
  4. The budget pass and the comparison sheet.

## 10. Risks

- **Triangle and draw-call cost of the ashlar.** Mitigated by the normal-map route in §6 and the budget in §8, checked at step 1
  before the other layers are added.
- **Procedural look to image textures.** The look-dev's stone and stains are shader-driven; some of the character may not survive
  the bake. The comparison sheet in §9 is the check, and the owner is the judge.
- **Light count.** If the room's lights exceed the per-room cap, the amber and candle merge into one.

## 11. Follow-ups (separate tasks)

1. **The goblin, human-sized.** The owner wants the goblin near human height, since the player is human-sized and the levels
   are scaled to them. `height 1.30` in `goblin.blob` is a label; the proportions are authored in absolute metres, and the WAM
   kit, armour, gait, poses and held-weapon carries are tuned at 1.30. Its own spec and plan.
2. **The iMac's translucent material and the live CRT screen** (the engine route the look-dev noted: a WGSL shell reusing
   the candled egg's analytic lamp-and-shadow term; render-to-texture, F-T2).
3. **The goblin at the kotatsu** (the pose layer's `sit`), once the goblin's size is settled.
4. **The clutter pass.**
5. **Earlier stages as level `states`** (stage 1: rusted pipes and stone ribs), and the owner's "fleshier" design.
6. **Camera transitions and the emergence scene** (F-T3, F-T5).
7. **An optimisation pass** (owner, 2026-10-11): the conduits' rings and spines and the quilt are the heavy geometry; do it after the look is right.
8. **The look of the bone rings, spines and the radiator** needs work (owner, 2026-10-11, after milestone 2): the cream rings and the radiator ribs read differently from the look-dev.
