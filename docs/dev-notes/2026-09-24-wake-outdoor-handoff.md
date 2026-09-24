# Hand-off: the Wake level pipeline + Outdoor v1 (2026-09-24)

**Branch:** `claude/wake-level-pipeline-1afb01` (worktree `.claude/worktrees/wake-level-pipeline-1afb01`),
about 50 commits on top of `main` 8abbfb4b. **Nothing is merged to `main` yet.**
Status board: [TASKS.md](../../TASKS.md) (top section) · Wake tasks: [00-the-wake/tasks.md](../game/levels/00-the-wake/tasks.md).

## Where things stand

### Wake Plan 1 — Level Format v1 + Blender pipeline: done
[Plan](../superpowers/plans/2026-09-11-wake-1-level-format.md) · [format spec](../superpowers/specs/2026-09-23-level-format-design.md)

- `level-def.ts`, `level-json.ts`, `active-level.ts`: the ring and authored levels behind
  `ctx.world.level`; `?level=<id>[&state=]` loads `public/assets/levels/<id>.level.json`.
- Blender: `scripts/levels/export_level.py` (+ `docs/game/levels/blender-conventions.md`),
  `build_the_wake_blockout.py`, `dress_the_wake.py` (placeholder props in a `dressing`
  collection; the exporter ignores it), `render_level_views.py` + `level_surfaces.ts`
  (Blender eye-height renders using the game's own wall generator; views in
  `scripts/levels/the-wake.views.json`).
- The Wake: [reference study](../game/levels/00-the-wake/reference-study.md) and
  [layout](../game/levels/00-the-wake/layout.md) (approved, then reviewed: the route bends
  from the SW lych gate to the NE slab; the funeral home is a gothic manor on the
  graveyard's north edge, as dressing only).
- Gates: `npm test -- level-json.the-wake` (8), `LAB_TMP=.lab-tmp scripts/sdf-game-wake-gate.sh`
  (5 checks), ring regression `scripts/sdf-game-shorty-gate.sh`.

### Outdoor v1: landed; tuning pending
[Spec](../superpowers/specs/2026-09-23-outdoor-v1-design.md) · [plan](../superpowers/plans/2026-09-23-outdoor-v1.md)

- Presets `outdoor-presets.ts`; format keys `ground`, `paths`, `edge`, `skyline`; tagged
  surfaces; the probe sky term; the body enclosure's top face is the sky; the flashlight
  bounce skips the sky; `outdoor-light.ts` (moon rooms, shadow frame, fog blend); the
  WGSL sky dome (`sky.wgsl.ts` + twin `sky-color.ts`); procedural textures;
  `game-outdoor-leaves.ts` wires the moon (shadow decided at boot, idled with
  `shadow.autoUpdate = false`), dome, skyline, fog blend, seams.
- The ring is unchanged; boot is within noise. The Wake uses it (grass, gravel/dirt paths,
  2.2 m walls, a hedge lane, a treeline).

## Next session, in order

1. **Tune `SKY_PRESETS.night` with the owner.** Grass reads too dark; the sky colours are a
   first guess. Live: `/sdf-game.html?level=the-wake`, `__sdfGame.setSky('moon.intensity', 2)`,
   `__sdfGame.setSky('horizon', [r, g, b])`, `__sdfGame.sky()`. Capture both sides with
   `.lab-tmp/wake-views.sh` (in-game) and `render_level_views.py` (Blender), compose them
   side by side, then copy the approved values into `outdoor-presets.ts`. Re-run the Wake gate.
2. **Merge the branch to `main`** once the owner is happy (it's large: run the targeted
   suites, both gates and a boot-time check first).
3. **Level mesh key spec** (brainstorm → spec): draw the Blender dressing (the manor,
   the tower, headstones) in the game; it replaces generated edges and skyline where art exists.
4. **Outdoor follow-ups:** edge caps and the fence plinth (not drawn yet); one edge style per
   room is a v1 limit (the Wake wants a fence on the graveyard's east side).
5. **Terrain elevation** (Outdoor spec 2, with multi-floor): the player, actors, navigation,
   probes and bodies all assume y = 0 today.
6. **Wake Plans 2–3** (game loop, content) can start: their pure tasks are dispatchable.

## Owner notes to carry

- Art direction for the Wake: a sense of decadent decay (crumbling walls, irregular
  shapes); the bell tower placeholder is unimaginative; the iron gates should be
  impressive; a gothic castle element (now the manor). Simplified forms are fine for
  first-pass dressing (Wake task W-A1).
- Review levels on Blender eye-height renders with the dressing, not in-game box screenshots.
- No soldier in the Wake (all zombies).
- Dispatch models: `zai/glm-5.3-flash` by default (it has vision); `zai/glm-5.3` for
  tasks needing deeper knowledge. Kimi returns 403 (subscription), and `dispatch.conf`'s
  `DEFAULT_MODEL` is still a Kimi model.

## Gotchas found this session

- Blender renames duplicate object names (`.001`): exporter fields must be parsed with
  `base_name()`.
- A script building a scene and exporting in the same headless Blender session needs
  `view_layer.update()` before reading `matrix_world` (fixed in the exporter).
- Rotating or scaling a bmesh-built prop pivots at the world origin: bake the transform into
  the mesh.
- `spawnPoints(room)` reads the ring's table by room id; use `roomSpawnPoints(ctx, room)`.
- The deferred router hides unstamped `MeshBasicNodeMaterial`s in the level group
  (windows use the wall material + emissive).
- Headless gates can't read the WebGPU canvas from page JS; decode a CDP screenshot
  (`decodePng` in `sdf-game-wake-gate.mjs`).
- three is r186; never toggle `castShadow` live (the r185 crash path is still unguarded).
- Never copy a dispatch plan file after the engine has run it (it carries `status: running`).
