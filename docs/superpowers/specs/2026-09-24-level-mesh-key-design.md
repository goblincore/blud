# Level mesh key: real Blender art in the game — Design

**Date:** 2026-09-24 · **Status:** approved (owner, 2026-09-24)
**Parent:** [New game flow](2026-09-24-new-game-flow-design.md) (build order item 3, split: this engine spec
first, then the train carriage kit) · **Format:** [Level Format v1](2026-09-23-level-format-design.md)
· **Related:** [Outdoor v1](2026-09-23-outdoor-v1-design.md), [the Void](2026-09-24-void-portal-design.md)

## 1. Why

The game draws only generated surfaces: rooms, walls, corridors, furniture and solids as flat or
procedurally textured boxes. Everything that makes the Wake look like a place (the manor, the tower,
the headstones, the gates) lives only in the `.blend`'s `dressing` collection, which the exporter
ignores. The owner's playtest verdict on the Wake was "boring visually", and Night Train as boxes
would be the same. This spec is the "mesh key" the level design guide's art pass (§1, step 6) was
waiting for.

## 2. Decisions

1. **One art file per level.** The `dressing` collection exports to `<level id>.art.glb` beside
   the level JSON. **Kit pieces** are modelled once in `assets-source/levels/kit.blend` and linked
   into each level's `.blend` as collection instances.
2. **Art is visual only.** Collision stays as the generated walls plus `furniture` and `solids`
   boxes, which are authored next to the art. Enemy navigation is unchanged.
3. **Room key `shell: "art"`**: that room's generated walls, floor and ceiling are not drawn. Its
   collision, lights and bounce colours stay. It is per room: a carriage's shell is one piece of art.
4. **Materials are standard glTF PBR** (base colour, roughness, metalness, normal, emissive,
   textures). Textures are embedded, at most 1024 px on a side.
5. **Proof:** the Wake's existing dressing, plus a tiny fixture for `shell: "art"` and a linked kit
   piece.

## 3. Format additions (additive, format spec §10)

- **Top-level `art`**: a file name (`^[a-z0-9-]+\.art\.glb$`), resolved beside the level JSON
  (`public/assets/levels/`). Needs capability **`art`**.
- **Room `shell`**: `"generated"` (default) or `"art"`. `"art"` needs capability **`art`**, and
  excludes `void` and `paths`. (An `edge` is allowed: `shell: "art"` skips its drawing too, and
  collision is unchanged.)
- `ENGINE_CAPABILITIES` gains `art`. `layoutSurfaces` skips a `shell: "art"` room's planes the way
  it skips a `void` room. **A level with `art` draws no `furniture` or `solids` boxes**: they are
  collision only, and the art draws them (art modelled over a box z-fights it; found in the fixture's
  seats and the Wake's pillars and tower). Gates still draw, since they vanish when opened. `enclosureOfIn` is unchanged (bounce colours still come from the palette).

## 4. Export

`scripts/levels/export_level.py` writes the JSON as today, then, if the scene has a non-empty
`dressing` collection, the art:

1. **Room tag:** each dressing object gets a room: its `room` custom property (a room id), else
   the room whose rectangle contains its world bounding-box centre, else the nearest room.
2. **Joining (draw calls):** in a temporary copy of the scene, objects that are **not** collection
   instances are joined **per room, per material** (after applying modifiers and transforms). Each
   joined mesh is named `art:<room id>:<material>` and gets a `room` extra.
3. **Instances:** linked kit pieces (collection instances) are realised per room and exported with
   the glTF exporter's GPU instancing (`EXT_mesh_gpu_instancing`), one instanced mesh per kit piece
   per room, named `kit:<room id>:<piece>`.
4. **Shadows:** an object with custom property `shadow = false` is joined into a separate
   `…:noshadow` group.
5. **Write** `bpy.ops.export_scene.gltf` (GLB, Y-up so the game's axes come out directly, embedded
   textures, `export_gpu_instances=True`, no cameras or lights) to `<level id>.art.glb`, and set
   `"art"` in the JSON. The exporter refuses a texture over 1024 px, by name.

The `.blend` is never modified; the joins happen in the temporary copy.

## 5. In the game

- **Load:** when `def.art` is set, boot fetches the GLB and parses it with three's `GLTFLoader`
  (`parseAsync` on the fetched bytes, like `dynamite-prop.ts`). A missing or unparsable file is a
  boot error that names the file.
- **Place:** each mesh, and each instanced mesh, joins `ctx.world.levelGroup` **before** the
  per-room light lists are assigned. The existing loop converts its material with `fromMaterial`
  and gives it the room's lights and probe node. The room comes from the mesh's `room` extra
  (`userData.room`), not its position.
- **Shadows:** `castShadow` / `receiveShadow` on, except `…:noshadow` meshes.
- **Emissive** works as it does on the Wake's windows, with no extra light (authored `lights` still
  light the room).
- **`?art=0`** skips loading the art (dev flag, for A/B and the gate's baseline).
- Pure decisions (room tagging from a name, the budget check) live in `level-art.ts`; the three
  wiring lives in `game-art-leaves.ts`.

## 6. Proof

- **The Wake:** the existing dressing (the manor with towers, spires and lit windows, the bell
  tower, headstones, lanterns, the portal arch and the gates) exports to `the-wake.art.glb` and
  draws in the game. Rooms stay `generated` (the dressing sits on the generated ground and inside
  the low walls).
- **Fixture `art-shell`:** one `shell: "art"` room of 3 × 12 m, with a box shell (floor, walls,
  ceiling as art) and one cube "seat" linked from `assets-source/levels/fixtures/test-kit.blend`,
  placed three times (instanced). Seat collision is a `furniture` box.

## 7. Testing

- **Unit:**
  - `level-json` accepts `art` and `shell`, rejects a bad file name, `shell` + `void`, and a
    missing capability;
  - `shell: "art"` draws no planes but keeps its colliders;
  - `level-art.ts` room tagging;
  - the Wake and fixture level tests name their art file.
- **Headless gate** `scripts/sdf-game-art-gate.sh`:
  - the fixture boots with `art` active; its shell draws (the screen is not the clear colour
    where the generated wall would be) and the three seats are one instanced draw;
  - the Wake boots with its art; the gate records draw calls (`renderer.info.render.drawCalls`)
    and median frame time over 120 frames at three fixed poses, before (art off: `?art=0`) and
    after.
- **Budget:** measured first, then proposed to the owner and written into the gate. Starting
  point: at most +50 draw calls and +2 ms median frame time at the worst pose.
- **Regression:** the ring, Void, Wake and shorty gates pass; boot `drawOnce` within noise.

## 8. Open

- Level of detail for large art; texture compression (KTX2).
- Art replacing the Wake's generated skyline and edges (follows naturally once this works).
- Art for enemy-visible occlusion (navigation and sight still use boxes).
