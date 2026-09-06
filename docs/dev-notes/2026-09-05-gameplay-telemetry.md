# Manual gameplay telemetry

Owner-approved Record / Stop & Save control for sdf-game, added on top of main b78bca2. Separate from both analytic normals and zoned wound caches. Dev server only; no production UI or remote collection.

## Capture

Open sdf-game.html, press F8 or click Record, play normally, then press F8 again. Capture auto-stops after three minutes or18,000 drawn frames. Stop writes a uniquely named JSON file under the serving checkout’s ignored telemetry/ directory. A failed save retains the data and requires Retry save or Download JSON before another recording; a stalled save times out after15seconds. Saved files are never overwritten.

Record before the first shot to retain setup hitches, then include repeated shots and some movement near wounded bodies. Stop after the spike. Browser refresh loses a recording that has not been saved/downloaded.

Console seams: __sdfGame.telemetry.start(), .stop(), .active, .lastCapture(). Capture only observes natural animation-loop frames; manual __sdfGame.step() is intentionally excluded.

## Interpretation

- intervalMs is the interval between DRAWN frame starts, including cap/vsync, browser scheduling and previous-frame work. This page defaults to30FPS, so33ms is expected. It is not GPU time. The interval describes the gap BEFORE its row; inspect previous-row CPU work and events during that gap.
- tickCpuMs and drawCpuMs time synchronous CPU simulation and render submission. GPU execution, driver/compiler work on other threads and garbage collection outside those spans cannot be independently attributed. GPU duration is explicitly unavailable.
- phases are inclusive: wound-hit/wound-flush are inside projectiles-and-hits; chunk-bake is inside chunks-and-guts. Never add parents and children together. Event callbacks between frames may contribute phases to the next row.
- Shot, impact, sever and chunk bake events use milliseconds since recording began. Expensive spans (>=2ms) and discrete events emit blud: User Timing labels for optional Chrome DevTools traces; their browser entry buffers are cleared immediately. No forced GPU fence or readback is added.
- States include scene counts, camera pose, render dimensions, frame cap, refresh estimate, visibility and whether the pointer is locked. Counts are CPU-side scene/proxy state, not exact shaded-pixel coverage.
- First-frame and visibility-gap intervals remain in raw data but are excluded from summary percentiles. 4,000event limit reports droppedEvents; frame limit stops rather than overwriting the first shot.
- Build commit and dirty state are fetched at recording start; server-start provenance is recorded separately. Dirty builds are labelled, not presented as clean main.

## Verification

Six focused Vitest tests cover timing/event alignment, bounded retention, visibility filtering, duration/invalid samples, failed-save recovery and unique local file persistence. TypeScript passes. The failure recovery regression was observed failing before the fix.

Real WebGPU smoke test on isolated Chrome9260/Vite5260 used F8 to record and stop, fired a slug through the real game seam, and persisted35natural frames plus shot/impact/sever events. A sampled impact frame carried distinct wound-hit, wound-flush and projectile CPU spans, with one live chunk and255blood droplets. Screenshot inspected; controls readable. This was functional validation, not an overhead measurement or a reproduction of the owner’s40–50ms issue.

## Update 2026-09-06

See [game tile playtest and extended capture](2026-09-06-game-tiles-telemetry/notes.md) for F6 tile toggling, F9 visual markers, world/local wound data, bounded geometry snapshots and asynchronous chunk-worker events. No performance comparison is claimed.
