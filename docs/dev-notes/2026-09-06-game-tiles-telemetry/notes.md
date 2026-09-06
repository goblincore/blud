# Game tile visual playtest and combat recorder

Owner requested a tile-culling visual run before performance comparisons, and integration of the existing telemetry recorder into current main. Baseline: main `86fadff4`; recorder originally `f1004e91`, adapted onto current worker-bake code as `f61fe41f`.

## Play

Run the dev server and open `/sdf-game.html?slug&tiles-playtest`.

- Tile culling starts ON for the ten actor bodies. F6/button toggles it live. Detached chunks retain the existing group-cull path. A displayed fallback count means those actors are using ordinary group culling for that frame.
- F8 / Record starts a run. F8 / Stop & Save saves a unique JSON file in the serving checkout's ignored `telemetry/` folder. Repeat for another run.
- F9 / Mark visual issue saves the current camera, actor geometry and wound state without stopping play. Use it when a seam, missing patch, flicker or other problem is visible. A snapshot is data, not a screenshot.
- Runs stop at three minutes, 18,000 drawn frames or a 12 MiB payload budget. Events are capped at 4,000; detailed snapshots at 16. Dropped counts are explicit. Failed saves retain the capture for retry/download.
- The recorder is available in ordinary dev launches too; tile bindings are allocated only with `?tiles-playtest`. Production builds expose neither playtest controls nor recording UI. Main's normal tile default remains off pending the owner's visual decision.

## What is captured

Natural drawn-frame intervals, synchronous CPU phases, player/camera state, dimensions/frame cap, render settings, actor/chunk/blood counts, total wounds, tile activity/fallbacks, and worker bake pending/error state. Shot/impact/sever events retain chronology. Impacts include actor/model/room, world point, direction, accepted wound attachment-local point, primitive index, source line/bone/region, radius/type/depth and actor pose. After a hit batch, an actor-wounds event captures its current wound ring and alive regions.

Recording start and manual markers capture already-posed actor primitives, clusters, bones, wounds and numeric renderer uniforms. Snapshots are intentionally bounded, not taken every frame. `snapshot-cost` events identify their CPU recording overhead. Chunk snapshots are limited state summaries; this is not deterministic game replay, a saved image, a per-pixel contributor census or a complete chunk-render reconstruction.

Worker bake request, completion, cancellation and swap events preserve the current asynchronous lifecycle. Worker `bakeMs` is reported separately from main-thread swap time. No GPU fence/readback is inserted by recording. No GPU timing claim: intervals include pacing/scheduling; CPU submission time excludes GPU execution. Counts are CPU scene state, not shaded coverage.

Summary late-frame metrics use the explicit 30 fps target plus a 2 ms scheduling tolerance. Raw intervals remain available; visibility gaps and the first recorded frame are excluded from summaries. A frame interval describes the gap before its row; correlate events in that gap and CPU work in the previous row. Nested CPU phases must not be added to their parents. At a 30 fps cap, a ~33.3 ms median alone does not reveal GPU headroom.

Build metadata is fetched from the dev server at recording start, with commit/dirty state explicitly scoped to the working tree at that time. Server-start provenance is retained separately. Dirty source is not a reproducible committed build; frozen snapshots support diagnosis but do not certify the exact compiled program.

## Tile integration

One independent compute binding per actor view. Bin after pose uploads and final camera matrices, immediately before SDF drawing. Use actual SDF target dimensions; allocate for the maximum supported/current dimensions. Grid/group overflow falls back safely without truncating primitive lists. On/off state survives cast rebuilds and supported resolution changes. Removed bindings are closed by the controller; underlying GPU cache release remains renderer-owned, as in the existing tile implementation.

Existing cluster/group culling remains the control. Tile binning historically showed no clear speedup in its tested single-body fixture. This change establishes a visual toggle and useful recordings; it makes no performance claim and implements no bounded local-pair/triple marcher.

## Verification

`scripts/game-tiles-telemetry-check.mjs <vitePort> <cdpPort>` checks actual WebGPU boot, all ten actor tile bindings, F6, F8/F9, natural slug impact/location logging, local save, resolution changes, cast rebuild and zero tile allocation on ordinary launch. It captures a screenshot and functional JSON. It performs no timing comparison or performance sweep.

Focused CPU tests cover tile capacity/fallback/lifecycle, immutable event ownership, bounded snapshots/bytes, frame pacing summaries, recorder controls and save recovery. Full suite/build results are recorded at integration completion.

Verified before integration: 218 Vitest files / 3,535 tests passed with `NODE_OPTIONS=--no-experimental-webstorage`; the default unrestricted Node run exposed 11 existing panel/localStorage failures, avoided by using the configured DOM storage. After the final pending-start cancellation fix, all 12 recorder core/control tests and TypeScript passed. Production build passed. Independent code review found no remaining actionable issues after provenance and cancellation fixes.

The functional WebGPU run saved 136 natural frames, three geometry snapshots and eight events, including a real torso impact with world/local coordinates; all ten actors remained tile-enabled after resolution and cast changes. The screenshot was visually inspected for readable controls and gross missing geometry. This is functional evidence, not the owner's visual approval or a performance result. No performance comparison was run.
