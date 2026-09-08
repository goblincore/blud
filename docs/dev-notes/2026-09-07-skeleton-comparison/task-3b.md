# Skeleton comparison — Task 3b: volume runtime integration

Status: **IMPLEMENTED, GPU boot verified; visual acceptance pending** on branch
`codex/dispatch/2026-09-08-skeleton-task-3b-volume-integration`, based on `e347020c`.

## Runtime path

`?skeleton=volume` is development-only and forward-only. The missing query,
production builds, deferred mode, mesh mode, non-zombie actors, organs, chunks,
overflow segments, and every outside-grid query retain the procedural path.

The mode-2 bone-segment loop now reads one segment-local `r32float` atlas. An
in-domain manual-trilinear sample hard-mins into the already-carved flesh field,
so wounds, bone material selection, wetness, flashlight, ambient, and the rest
of the existing forward shading remain in the same march. Outside the grid or
without an enabled atlas row, the loop runs the exact existing
`foldBoneRange`. Organs remain in the procedural tail.

Each distinct revision set owns one shared atlas texture. Eleven zombie actors
therefore used one atlas, while every actor owns only a 32 x 4 RGBA pose/meta
texture. Pose rows update in place each frame. Sources bind to stable
`actor.body`, not the freshly allocated `actor.posed()` result; ordinary
animation does not rebuild. Sever/body replacement rebuilds sources and atlas
only when the revision set changes. Refcounts dispose the old atlas and evict
its grids after the last actor releases it; cast rebuild and HMR release all
per-actor metadata. The shared source fix also stops mesh mode from rebuilding
sources every frame; cast rebuild/HMR now clear mesh actor slots before
disposing its revision cache, preventing inherited mesh geometry retention.

Live segment slots compact after severing. `pack.ts` stores the original
`boneSegment` id in the segment-range `.w`; the shader uses that id for atlas
metadata while using the compact slot for bounds/ranges. This prevents a
surviving segment from sampling a dead neighbour's grid.

Sampled fields use finite-difference normals. The analytic primitive-gradient
path is disabled for volume actors because its bone derivative describes the
procedural primitive, not the atlas sample.

## Diagnostics

`__sdfGame.skeletonDiagnostics()` synchronously reports `requestedMode`, the
actually constructed `activeMode`, and volume `{ actors, grids, gridBytes,
atlases, atlasBytes, bakeMs, atlasBuilds }`. `atlasBuilds` is cumulative and
must stay fixed across ordinary animation. Shader debug mode 8 emits sampled
segment evaluations in red and procedural fallbacks in green. No public
readback wrapper was added in this bounded task, so the runtime fallback rate
is not yet measured.

## Verification and evidence

- Focused pack, volume GPU, march WGSL, zombie GPU and deferred signature
  suites: **335/335 passed**.
- `npm run build`: **passed** (`tsc --noEmit` and Vite production build).
- Coordinator GPU smoke before the sparse-id/lifecycle follow-up fixes: WebGPU
  boot and rendering succeeded with no WGSL validation error; 11 zombie actors,
  18 grids, one 11.67 MB atlas, 5.57 s bake; intact repeat was byte-identical
  and a wound capture rendered. Evidence is in
  `/tmp/skeleton-volume-smoke/validation.json` and sibling PNGs. A baseline-
  shared 404 remained in console classification and was not a shader failure.
- Final-commit GPU lifecycle probe: **passed**. `atlasBuilds` stayed 1 across
  20 simulation steps; cast rebuild incremented it to 2 and returned to 11
  actors, one atlas and 18 grids at the baseline byte count. No shader errors
  were reported. The harness later failed because it retained the pre-rebuild
  actor id while actor ids intentionally continue; this is a harness staging
  defect after the completed lifecycle assertions, not a runtime failure.
  Evidence: `/tmp/skeleton-volume-lifecycle/validation.json`.
- Owner visual judgement is pending. CPU/build and lifecycle success do not
  prove anatomy, clipping, wound reveal, sever, or shading acceptance.

## Known limitations

- Zombie only. Soldier and other character sources stay procedural.
- Five-millimetre grids cost several seconds to bake at startup and 11.67 MB
  for the observed zombie atlas.
- The shader counters exist, but outside-grid fallback rate has not been read
  back.
- Deliberate rigid rib bend/squash differences remain allowed by the owner;
  broken surfaces, leaks, clipping, or failed wound reveals are still bugs.
