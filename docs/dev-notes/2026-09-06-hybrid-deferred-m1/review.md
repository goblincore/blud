# Hybrid deferred M1 — coordinator review

The isolated comparison fixture is implemented and its real WebGPU gate passes. Meshes and the wounded SDF character publish unlit surface data, resolve visibility, and receive the same dynamic lights. This establishes the shared lighting boundary; it does not migrate the game or establish production visual parity.

## Recovery and review

Dispatch tasks 1 and 2 completed at `7c9974e8` and `3e7575ff`. Task 3 timed out at 45 minutes, preserving `b3157f73`. Its continuation timed out at 60 minutes, preserving `0b6ccaf4`. These were exit-124 timeouts, not confirmed provider rate limits. The coordinator resumed the saved branch in an isolated review worktree.

The continuation's browser gate left its CDP connection open after successful checks, so completed validation runs never exited. The final gate now closes its owned tab/socket on success and failure, with bounded CDP requests and close handling.

Independent reviews and coordinator verification covered these fixes:

- Suppress scene backgrounds while writing surface targets, preserve all caller state, clear owned hardware depth explicitly, and prevent inherited renderer MRT from overriding owned passes.
- Apply WebGPU projection convention before caching inverse view-projection; use the fragment's existing pixel center without adding another half pixel.
- Start the showcase automatically after warmup. `?paused=1` is the deterministic automation launch; API changes synchronize controls and redraw frozen views. A real-browser regression first failed on the frozen original and passes with this fix.
- Make all orb lights point lights in both modes. Spotlights remain covered by the isolated spotlight check.
- Await `GPUQueue.onSubmittedWorkDone()` before reporting completed-frame timing, even when timestamp queries are unavailable. Reject timing while the animation loop is active.
- Reduce orb light intensity from 9 to 2 and marker emission from 7 to 1.5 after inspecting washed-out wound captures. The final captures retain tissue/rib detail and recognizable colored sources.

## Reproduce

```sh
npm run dev -- --port 5310 --strictPort
# Open http://localhost:5310/sdf-deferred.html
# Automation owns its browser/server and cleans up both:
LAB_VITE_PORT=5307 LAB_CDP_PORT=9307 scripts/deferred-check.sh
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
```

The fixture defaults to deferred mode, three animated lights, and fixed 800x600 internal resolution. Controls expose legacy/deferred, SDF scale, diagnostic attachments, camera poses, light count, Play/Pause lights, source visibility, wounds, and loop freeze. `setLightTime(t)` pauses exactly; resuming continues from that time. CSS window resizing never changes the internal cap.

## Functional evidence

`validation.json` records **21 passing real-browser checks**, no JavaScript/console/WebGPU errors, 22 PNGs, and 36 timing runs. The shell gate exits 0 and cleans up its owned browser and Vite processes.

- Four resolved surface attachments are bit-invariant under moving lights when source meshes are hidden; lit output changes on both mesh and flesh.
- All resolved attributes match a CPU visibility selection from actual producer buffers. Both visibility directions pass at SDF scales 1 and 0.5.
- Wounds change traced depth and tissue color deterministically. Legacy/deferred SDF hit depths match exactly at all 367 compared wound-pose sample locations; the readback contains 81,496 legacy flesh hits.
- Explicit 640x480 then 800x600 target reallocation restores identical surface hashes. CSS-only resizing and repeated mode switches preserve valid rendering.
- Source position/color, hidden-source occlusion, pause/resume, 1/8/16 light counts, and red/cyan illumination of flesh pass.
- The generated surface WGSL contains one `marchSurface` call, followed by the three dependent attribute readbacks. The definition is the only other occurrence.
- The spotlight centroid is within two pixels of its CPU projection. This is a coarse reconstruction check; the layer regression test covers the exact half-pixel convention.

## Images inspected

The coordinator opened all 22 final task-3 PNGs, not just the earlier producer smoke tests.

- `task3-overview-{legacy,deferred}-scale{1,0.5}.png`: identical room, character, pillar, and crate silhouettes. Deferred lights color both surface types; legacy flesh looks substantially darker/more directional because its lighting model differs.
- `task3-{albedo,normal,depth,material}-scale{1,0.5}.png`: mapped stone material/normal data, flesh class and wound silhouette, consistent room depth, and intentional coarse SDF edges at half resolution. No inverted orientation, stretched normals, or false material fill was seen.
- `task3-wound-scale{1,0.5}.png`: the two chest cavities, ribs, and tissue colors remain visible. Half resolution loses fine face/wound detail as expected.
- `task3-{mesh-front,sdf-front}-scale{1,0.5}.png`: pillar hides flesh from the front pose; flesh is in front of the room and overlaps the pillar edge from the reverse pose. Mesh edges stay full resolution.
- `task3-orbs-t{0,0.7,1.4,2.1}.png`: cyan illumination moves across the floor/back wall, magenta moves over ceiling/pillar/character, and amber sweeps the torso/pillar. Markers disappear correctly behind geometry. This is a timestamped sequence, not a claimed video.

## Completed-frame measurements

Fixed 800x600, overview camera, stationary wounded character, frozen light time 0.7, source spheres visible. Chrome 152 headless WebGPU, Apple / metal-3 (`adapter.json`, queried on the same machine/browser build); device supports 8 color attachments and 32 attachment bytes/sample (required 4 and 28). The gate used three alternating repetitions per legacy/deferred pair, each with 8 warm frames and 32 measured frames. Browser validation ran before the CPU test suite; old abandoned validation tabs were closed first. No other dispatched renderer job was active.

Each cell below is **pooled p50 / p95 milliseconds** across 96 measured frames. Raw per-run distributions and samples are in `validation.json`.

| SDF scale | Lights | Legacy p50 / p95 ms | Deferred p50 / p95 ms |
|---|---:|---:|---:|
| 1 | 1 | 17.6 / 23.9 | 16.2 / 19.3 |
| 1 | 8 | 17.6 / 23.2 | 16.6 / 21.6 |
| 1 | 16 | 20.1 / 26.3 | 18.0 / 24.2 |
| 0.5 | 1 | 14.3 / 16.7 | 13.9 / 16.4 |
| 0.5 | 8 | 13.7 / 17.5 | 13.2 / 16.4 |
| 0.5 | 16 | 14.0 / 17.4 | 13.1 / 15.2 |

These are wall-clock submission plus actual GPU completion and query-drain costs, **not GPU timestamps or game FPS**. The adapter supports timestamp queries, but the shared lab renderer documents unreliable per-frame attribution across multiple render passes; GPU-only elapsed values were not reported. This is a stated limitation of the performance evidence, not a claimed timestamp measurement.

The legacy SDF receives only one moving spotlight plus its static key; legacy meshes use Three point-light falloff. Deferred applies every point light to both classes with its shared falloff. Accordingly, this is a feature/cost comparison, not equal-lighting-quality performance parity. The differences are too small and the fixture too limited to justify a game-wide speedup claim.

## Scope and remaining integration work

Functional M1 acceptance is satisfied. Shared buffers and lighting, resolution isolation, real tracing/wounds, deterministic orb showcase, shader checks, and image evidence are present. See the verification results below for full-suite/build status. Performance evidence uses completed-frame wall time with the timestamp limitation above.

M1 lights are unshadowed. Legacy flesh AO, scatter, local shading, static-key details, flat-face-specific lighting, and display compensation are intentionally not visually matched; the task-2 inventory in `notes.md` explains the exported material data and omitted lighting. General transparency, production shadow integration, game actors/chunks/blood, full flesh look tuning, clustered light culling, and postprocessing remain future work. No implementation has been merged into main or made the game default.

## Final verification

- `LAB_VITE_PORT=5307 LAB_CDP_PORT=9307 scripts/deferred-check.sh`: exit 0, 21 checks, 36 timing runs, no page/GPU errors. Repeated after the final intensity adjustment.
- `NODE_OPTIONS=--no-experimental-webstorage npm test`: exit 0; **222 files, 3,598 tests passed** (142.58 seconds).
- `npm run build`: exit 0; TypeScript and Vite production build passed. Vite reports its large-chunk advisory.
- `git diff --check`: clean.

Review branch: `codex/deferred-m1-review`. Preserved worktree: `/Users/donny/.codex/worktrees/blud-deferred-m1-review`. Earlier failed dispatch worktrees and branches remain available; no destructive retry was used.
