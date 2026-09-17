# Merged crowd march — hand-off brief (for a fresh session to brainstorm + spec + plan)

**Date:** 2026-09-13 · **Status:** brief only — NOT a design; the picking-up session runs the brainstorming
skill against this, then writes the spec and plan. · **Priority (owner):** high, right after neural-upscale
run 5b lands (`TASKS.md`). · **Owner's why:** crowds are the game (zombies), and gibs would otherwise be an
explosion of marched instances; fifty zombies should not cost fifty bodies' worth of bindings and draws.

## 1. Where the cost is today (measured, 2026-09-13)
- The march ships as ONE pass with a draw PER BODY: each body's proxy box rasterises with its own
  `MeshBasicNodeMaterial` (`zombie-gpu.ts` `createMarchMaterial`, ~100 named uniform/texture inputs bound
  from that body's `MarchUniforms` + its own prim `DataTexture`, face sheet, segment-volume atlas) and traces
  only its own field. Overlapping proxy boxes trace the same pixel once per body until the depth test resolves.
  The front-to-back per-body-pass variant with an accumulated-depth gate was measured a net loss and ships off.
- `sdf:march` 5–8 ms in rooms 1–2 (3–5 bodies). The run-5 refine pass (a second proxy-box twin per body) is
  body-bound for the same reason (6–11 ms); run 5b's Task E (ownership early-out) is the per-body patch.
- The upscale net is already screen-bound (fullscreen passes). Gib chunks already share ONE material with
  instanced geometry (`baked-chunks.ts`, `bone-instancer.ts`) — the closest existing pattern.

## 2. The idea (owner + Claude, 2026-09-13)
One union field, one ray per pixel. Split state by what varies:
- **Per character TYPE** (identical across every zombie): face sheet, segment-volume atlas (rest-space bakes),
  the rest-space prim template, and nearly all material/lighting knobs (skin ramp, wetness, noise config, wound
  look, meat detail). → shared atlases / one uniform block per type; one material per type (or one for all).
- **Per INSTANCE** (genuinely different): pose (bone transforms), wound list + severed-cluster flags, melt/flash
  state, colour variant, placement, damage revision. → a record per instance in a storage buffer, indexed by the
  shader.
- **Prim rows** are per instance today because the CPU packs the POSED prims every frame (`pack.ts packBody`,
  `DATA_ROWS = 22` rows per body, `ROW_PRIM_A/B/SCALE/CLUSTER_BOUNDS…` in `march.wgsl.ts`). Two stages:
  (a) keep CPU posing, share one tall atlas with a per-instance row range in the record (smallest change: the
  packer already writes rows, the shader already indexes rows); (b) later, pose on the GPU from the type's rest
  template + the record's bones (what makes 50 zombies free on the CPU; the gib path already leans this way).
- **Per-pixel dispatch**: the tile list (`?tiles-playtest`, bench legs `tiles-on` / `tiles-raycull`; the CPU
  binner packs per-tile cluster entries, `tileHdr`/`tileEnt` storage buffers, `tileCfg`) becomes the per-pixel
  list of (instance, cluster) pairs the ray folds. Today it is per body and off by default.
- **Consequences**: the march becomes screen-bound (cost ∝ pixels × steps, not bodies × box area); gibs become
  instances; the run-5 refine becomes a single fullscreen pass (no twins, no ownership early-out); the deferred
  renderer's SDF producer registers one object instead of N.

## 3. What to read first (pointers, not line numbers — they move)
- `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`: `createMarchUniforms` (the ~100 knobs — classify each as per-type
  or per-instance), `createMarchMaterial` (the binding block; note the "ORDER MATTERS"/meltCfg notes: an unbound
  declared input shades as zero silently), `createZombieGpuView` (proxy box, cone/depth-pre/refine twins,
  `setSkeletonVolume`, per-frame `update`/`setTime`), `refineTailUniforms` (run 5b: the first place a
  material was built from a *copy* of a body's uniforms).
- `src/lab/sdf-zombie/webgpu/march.wgsl.ts`: `MARCH_BODY_PARAMS` (the signature; pinned by tests to the exact
  parameter list), `HELPERS` chain (`mapBody`, `foldGroup`, tile preload in `MARCH_TRACE_SETUP`, wound list),
  `DATA_ROWS`/`ROW_*` layout, `MARCH_BODY = fn + PARAMS + TRACE(SETUP+LOOP+POST) + SURFACE_PREP + LIGHT`
  (run 5 split; `REFINE_BODY` reuses everything but the walk).
- `src/lab/sdf-zombie/pack.ts` (`packBody`): what a posed body becomes on the CPU each frame.
- `src/lab/sdf-zombie/webgpu/sdf-layer.ts`: the march pass structure (`setBodies`, `withMarchMrt`, the
  front-to-back gate code path, `setChunkPass`), MRT attachments (`output`, `marchNormal`, `marchAnchor`), the
  refine pass (run 5) and its `REFINE_LAYER` twins.
- Tile list: grep `tileCfg`, `TILE_MAX_ENTRIES`, `kTileWrite`, the CPU binner (`tiles` in game-main / zombie-gpu).
- Gib/chunk instancing: `baked-chunks.ts`, `bone-instancer.ts`, `chunk-bake-*.ts` (one shared material, instanced).
- Deferred: `deferred-sdf.ts` (`marchSurface` = PARAMS + PROLOGUE + TRACE + PREP + TAIL — the same sections must
  keep working), `deferred-layer.ts` router registrations (`'sdf'` producer per body today).
- Gates that must survive: `scripts/march-hash.mjs` (exact march-target hash; canonical fields-off room1
  `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` at 2026-09-13 — a merged march will legitimately CHANGE it only if
  the field is identical and the walk identical; expect bit-identity to be the acceptance bar for stage (a)),
  `scripts/sdf-game-bench.mjs` (`BENCH_PASSES=1` pass attribution; rooms 1–2 at least, plus a crowd room),
  `scripts/upscale-smoke.mjs` / `upscale-trained-smoke.mjs` (the upscaler must still get `march`, `normal`,
  `detail`, `refine` textures), G3/G1 for the net, `refine-smoke.mjs`.

## 4. Constraints and traps (from this session's history)
- `wgslFn` binds inputs BY NAME; a declared input with no binding logs once and shades as ZERO (meltCfg note).
  Every per-instance value that moves into a record must be REMOVED from the signature in the same commit.
- Per-material texture nodes drift: only the main material's level-shadow / segment-volume nodes are rebound;
  run 5's twin lost the key light this way. In a merged design there is one material, so this class of bug
  disappears — but the per-frame rebind sites in game-main must be found and retargeted.
- WebGPU limits: 16 sampled textures per stage (the dc upscale layout already sits at the edge); a type atlas
  design must count bindings. Storage buffers for records/tiles are the way around it.
- The face sheet is authored per character (`characters/*.blob`, face bake); per type is fine, per instance
  variants would need an atlas page index in the record.
- Corpses: soldier-only corpse bake (`corpseBakeEligible`) converts dead bodies to meshes; extending it to all
  characters is a separate cheap task and reduces the crowd the march sees. Do it or plan around it.
- The march kernel's parameter count and section split are pinned by tests (`march.wgsl.test.ts`,
  `deferred-sdf.test.ts`); expect to rewrite those pins deliberately, not "fix" them.
- Machine: MacBook Air 24 GB; do not run the whole vitest suite while a capture/training is live.

## 5. Suggested staging (for the brainstorm to confirm or reject)
1. **Classify** every `MarchUniforms` knob and texture as per-type / per-instance; measure how many instances of
   each type the game reaches (crowd room). Output: a table in the spec.
2. **Stage (a)**: shared prim atlas + instance records + one material per type; CPU posing kept; tile list on by
   default as the per-pixel dispatch. Acceptance: march-hash bit-identical on rooms 1–2 (same field, same walk),
   bench p50 flat or better at 3–5 bodies, and a crowd room (15–50 zombies) showing the screen-bound curve.
3. **Refine as a fullscreen pass** (drop the twins; `REFINE_BODY` keeps its sections; the pass reads records).
4. **Gibs as instances** of the chunk type; dead bodies via the (extended) corpse bake.
5. **Stage (b)** GPU posing — only if the CPU packer is the bottleneck at crowd sizes.

## 6. Open questions for the brainstorm
- One material for all types (type index in the record, atlases with page indices) vs one per type (N draws,
  simpler bindings)? Binding-count and the 16-texture limit decide.
- Wounds: per-instance wound rows today live in the prim texture rows (`ROW_*`); in a record they need a
  fixed cap per instance — what cap, and does the wound union-reach cull (`woundBound`) survive?
- Per-instance skin-noise variation: a per-record noise offset (cheap) vs baked noise volumes (the
  micro-optimisation the owner parked: fbm → 3D texture indexed by the rest anchor).
- How the deferred renderer's SDF producer registers a merged march (one object, N instances).
- What the tile binner costs on the CPU at 50 instances, and whether it moves to a compute pass.
