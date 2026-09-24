# Outdoor v1 — Design Spec

**Date:** 2026-09-23 · **Status:** approved in brainstorming, spec awaiting owner review
**Extends:** [Level Format v1](2026-09-23-level-format-design.md) (additive keys, §9) ·
**First user:** [The Wake](../../game/levels/00-the-wake/layout.md) (task W-B7) ·
**Follow-ups:** terrain elevation (spec 2), the level mesh key (the spec after this), deferred support

---

## 1. Why

The Wake's gates, lane and graveyard are the game's first outdoor spaces, and the
engine only knows closed dungeon rooms. Measured on `main` (2026-09-23):

- Nothing draws a sky. An open-sky room shows the clear colour, which is the dungeon
  fog, near black.
- The probe bake traces a sealed six-wall box (`room-probes.ts` `roomProbeRequest`,
  `probe-grid.ts` `hitEnclosure`), so an open room gets bounce light from a phantom
  ceiling.
- SDF bodies always light as if under a ceiling (`level-def.ts` `enclosureOfIn` returns
  six walls; `bounceCfg.z` "ceilingEnabled" is always 1).
- The flashlight's bounce patch (`computeBounceSpot`) can land on that phantom ceiling.
- Thrown dynamite is capped at the room's height (`ceilingAt`).
- The dungeon rig has no sun or moon (`sunIntensity: 0`); the flashlight is the only
  shadowed light.
- One stone material set covers every surface; rooms differ by a colour tint only.
- An open room's generated walls still rise to its full height, so the 32 m graveyard
  reads as an 8.5 m-walled courtyard.

## 2. Decisions (owner, 2026-09-23)

| Question | Decision |
| --- | --- |
| Scope | **Outdoor v1**: sky and moon, sky lighting, ground, edges and skyline. Flat. Terrain elevation is spec 2 |
| Mood | **Stylised, coloured night**: a strongly coloured sky, a big moon, low clouds lit from below, tinting everything. Readable, painterly, closer to Blood's skies than to realism |
| Moon shadows | **Level and bodies cast**; bodies receive moonlight as light only (no self-shadowing in v1) |
| Edges | **Generated now, meshes next**: `edge` and `skyline` keys in this spec; the mesh key is the next spec and replaces generated edges and backdrops where art exists |
| Ground | **Per room plus path strips** with soft blended edges |
| Sky lighting model | **Approach A**: the sky is the enclosure's open side. Sky visibility tracing (ambient occlusion under the tower, between headstones) is a later refinement |
| Renderer | **Forward only** (the default). Deferred has no directional light kind yet; deferred support is a follow-up |

## 3. Principles

1. **The sky is the box's open side.** Every system that reads the room box (probe
   bake, body enclosure, flashlight bounce) keeps its box and swaps the ceiling for the
   sky: an emitter of the sky's radiance, not a reflector. Wall area above an open
   room's `edge` height is sky as well. Closed rooms are untouched.
2. **The ring stays bit-identical.** It has no open-sky rooms; every new path is gated
   on a room having `sky`.
3. **Presets are data.** Skies, grounds, edge styles and skylines are named presets in
   pure modules. The level file names them; the Rust port reads the same tables.
4. **Additive to Level Format v1.** New optional keys with defaults (spec §9): the parser,
   the exporter, the format spec and a fixture change together.

## 4. Format additions (Level Format v1, compatible)

### 4.1 Keys

| Where | Key | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| Room | `ground` | ground preset name | `"stone"` | The floor's material |
| Room | `paths` | Path[] *opt* | `[]` | Rectangles of another ground laid over the floor |
| Room | `edge` | `{ style, height }` *opt* | none | Open-sky rooms only: the visible edge. `style` is an edge preset, `height` in metres |
| Level | `skyline` | skyline preset name *opt* | none | Backdrop drawn beyond the edges of every open-sky room |
| Path | `ground`, `min` `[x,z]`, `max` `[x,z]` | | | One strip |

The existing room `sky` (string) now names a **sky preset**.

**Presets in v1:**

| Kind | Names |
| --- | --- |
| Sky | `night` (the Wake's stylised night; tuned live, then frozen as data) |
| Ground | `stone` (today's cobble, the default), `flagstone`, `gravel`, `dirt`, `grass` |
| Edge | `wall` (stone, with a cap), `fence` (iron railing on a low plinth), `hedge` |
| Skyline | `treeline`, `rooftops`, `hills` |

### 4.2 Validation (added to spec §5)

- `sky`, `ground`, `edge.style`, `skyline` and every path's `ground` name a known preset.
- `edge` only on a room with `sky`; `0.3 ≤ edge.height ≤ room height`.
- Every path lies inside its room's rectangle and has positive extent.
- Unknown keys are still errors.

### 4.3 Capabilities

`open-sky` (already in spec §8) now means "sky, moon and sky lighting"; it stays
supported. No new capability: ground, paths, edges and skyline are supported
everywhere.

### 4.4 Blender authoring

Room custom properties `ground`, `edge_style`, `edge_height`; paths are boxes in a
`paths` collection named `path:<ground>:<room id>`; scene property `skyline`.
`docs/game/levels/blender-conventions.md` and `export_level.py` change with the parser.

## 5. Generation rules (added to spec §6)

- **Walls of an open-sky room.** Display planes stop at `edge.height` and draw in the
  edge preset's style; above it nothing is drawn (the sky shows). Without `edge`, open
  rooms draw walls to full height, as today. **Collision is unchanged**: walls still reach
  floor + height, invisible above the edge, so nobody climbs out.
- **Doorways in an edge.** Openings and tunnel lintels are generated as today; an
  opening's header is drawn only up to the edge height (a gateway in a low wall).
- **Ground.** The floor plane takes the room's ground preset. Each path is a floor
  quad a few millimetres above it with the path's ground and a soft alpha fall-off
  (about 0.3 m) at its edges.
- **Skyline.** For a level with `skyline`, the engine draws two or three silhouette
  bands on large cylinders around the level's bounds, at increasing distance, in
  colours from the sky preset. Always drawn; closed rooms hide them behind their
  ceilings and walls. They never collide and write no shadows.

## 6. The sky and the moon

- **`sky-presets.ts` (pure).** A preset holds the sky gradient (zenith, horizon,
  band), the moon (direction, disc size, halo, colour, strength), stars, a low cloud
  band (colour, height, lit-from-below tint), the sky's ambient radiance for lighting,
  the ground bounce colour, and the outdoor fog (colour, near, far). The fog colour
  equals the horizon colour, so distance blends into the sky.
- **The sky dome.** One inverted sphere around the camera with a small node-material
  shader: gradient, moon disc and halo, stars, cloud band. Drawn first, depth-write off,
  fog off. Visible only through open-sky rooms, because every closed room has a ceiling.
- **The moon light.** One `DirectionalLight`, created at boot **only if the level has
  an open-sky room**. `castShadow` is decided at boot and never toggled. The project is
  on three **r186** (`package.json` 0.186.0); `game-main.ts`'s comments describe a crash
  when `castShadow` is toggled live on r185, and r186's `ShadowNode.updateBefore` still
  reads `this.shadowMap.depthTexture` without a null check after a reset, so the
  design does not rely on toggling.
- **Only open rooms see the moon.** Level meshes already get per-room light lists
  (`levelSceneLights`); the moon joins the lists of open-sky rooms and of tunnels that
  touch one, and nothing else, so interiors never light through their ceilings.
- **Fog follows the player.** The rig's fog blends between the room's fog (outdoor
  preset or dungeon) over about 1 s as the player crosses a doorway.
- **Tuning.** Seams `__sdfGame.sky()` and `__sdfGame.setSky(field, value)` and a panel
  section, following the existing tuning panels; tuned values are copied back into the
  preset.

## 7. Sky lighting (approach A)

| System | Today | Outdoor v1 |
| --- | --- | --- |
| Probe bake (`roomProbeRequest`, `probe-grid.ts`) | Rays hit six reflecting walls | The request gains `sky: { radiance, above }`. A ray leaving through the top, or through a wall above `above` (the edge height), returns the sky radiance and does not bounce. The moon joins the request's key light for open rooms |
| Probe calibration (`matchedGain`) | Closed-box bake | Unchanged in form; open rooms calibrate against their sky bake |
| Body enclosure (`enclosureOfIn`, `bounceCfg`, `ambientAt`) | Six walls; ceiling on | In an open room the top face is emissive sky: its contribution is the sky radiance, independent of the key light. The GPU path gets that term on the existing ceiling slot; closed rooms unchanged |
| Body key light | The practical-hard-key preset | In an open room the moon is the body's key (direction, colour, strength), through the same key uniforms bodies read today; the flashlight stays additive |
| Flashlight bounce (`computeBounceSpot`) | Can hit the ceiling | Skips the top face (and walls above the edge) in open rooms |
| Dynamite (`ceilingAt`) | Room height | Open rooms return no ceiling (a high cap, e.g. room height + 30 m), so a lob arcs up and comes down |

**Moon shadows.** One shadow map (2048², PCF like today) fitted each frame to the open
room the player is in or nearest to, clamped to that room's rectangle plus a margin.
Level meshes cast and receive. Bodies **cast** through the same caster path the
flashlight's shadow uses today; they receive the moon
as light only. Outside open rooms the map is not rendered: `shadow.autoUpdate = false`
with `shadow.needsUpdate` set only while the player is in or next to an open room (r186's
`ShadowNode.updateBefore` skips the pass without disposing the map).

## 8. Ground, edges and skyline materials

Procedural textures, like today's stone set (`theme-material-set.ts`): one small
module per preset family (`ground-presets.ts`, `edge-presets.ts`, `skyline-presets.ts`),
each pure data plus a texture builder. Grass is a flat textured ground in v1 (no blades);
the fence is an alpha-tested railing texture on a plane above a low stone plinth; the
hedge is a box band with a leafy texture. Materials go through the same per-room
material path as walls, so probes and light lists apply.

## 9. The Wake adopts it

| Room | sky | ground | paths | edge |
| --- | --- | --- | --- | --- |
| gates | `night` | `gravel` | — | `wall`, 2.4 m |
| lane | `night` | `gravel` | — | `hedge`, 2.6 m |
| graveyard | `night` | `grass` | gravel paths lych gate → round the tower → slab portal; dirt round the open grave | `wall`, 2.2 m (`fence` on the east side is a follow-up: one style per room in v1) |
| crypt, ossuary | — | `flagstone` | — | — |
| vestibule, parlour | — | `stone` | — | — |

Level `skyline: "treeline"`. The Blender dressing's manor stays in the `.blend` until
the mesh key; the skyline carries the distance in-game.

## 10. Modules

| Module | Kind | Responsibility |
| --- | --- | --- |
| `sky-presets.ts` | pure | Sky presets; `skyRadiance(preset)`, `moonLight(preset)`, `outdoorFog(preset)` |
| `ground-presets.ts`, `edge-presets.ts`, `skyline-presets.ts` | pure (+ texture builders) | Preset tables; procedural textures |
| `level-def.ts`, `level-json.ts` | pure | New keys, validation, generation (§4, §5) |
| `room-probes.ts`, `probe-grid.ts` | pure | The `sky` term (§7) |
| `level-def.ts` `enclosureOfIn`, `ambient.ts` | pure | Emissive sky top |
| `sky-dome.ts` | render | The dome's node material |
| `game-outdoor-leaves.ts` | leaf | Moon light, its shadow fit, fog blend, light-list membership, seams |
| `game-main.ts` | wiring | Boot: create the moon and dome when the level has open rooms; materials by preset |

## 11. Testing

- **Pure:** preset tables validate; `skyRadiance`/`moonLight` are deterministic; the parser
  accepts and rejects the new keys (every rule in §4.2); generation: an edged room's
  display walls stop at the edge while its colliders reach full height; path quads sit
  inside their room.
- **Probe sky term:** a probe in an open room receives the sky radiance from +Y; the same
  room closed is bit-identical to today's bake; the ring's bakes are bit-identical.
- **Fixture:** `public/assets/levels/fixtures/open-sky.level.json` exercises every new key
  (the Rust loader's conformance case).
- **Headless (extends `sdf-game-wake-gate.sh`):** in the graveyard, pixels above the
  horizon are not the fog colour (the sky draws); the moon shadow map is live
  outdoors and idle in the crypt; a body in the graveyard has the moon as its key.
- **Ring:** `sdf-game-shorty-gate.sh` passes; boot within noise of base.
- **Look:** Blender renders are the art target; in-game captures from the same
  eye-height positions go to the owner for the tuning pass.

## 12. Out of scope

Terrain elevation and slopes (spec 2, with multi-floor). The level mesh key and showing
the Blender dressing in-game (next spec). Deferred-renderer support. Sky visibility
tracing / ambient occlusion outdoors. Weather, rain, moving clouds, a day cycle. Grass
blades and foliage. More than one edge style per room.
