# Shared wound torso comparison — 2026-09-06

This is the first bounded experiment requested in the SDF handoff, not the migration of the previous cached-wound game pipeline. Open `/shared-wounds-probe.html` from this worktree's Vite server.

## Implemented

- Immutable intact/light/heavy recipes with at most two analytic sphere cutters. Light removes one sphere; heavy unions two overlapping spheres.
- One shared R32F atlas holds the two damaged presets: 32×32×64 texels, **262,144 bytes / 256 KiB**. Intact is evaluated analytically. There are no per-actor source/target volumes. CPU atlas backing is another 256 KiB, plus a transient upload copy; this is not total renderer memory.
- Per-region state is four numbers: current, target, queued severity and transition start. Repeated hits cannot exceed heavy. A heavier hit during a 160ms transition queues behind it, preserving continuity with at most two sampled endpoints. This can defer the heavier transition by the remaining duration (at most 160ms).
- Both representations use the same authored cutter geometry. The sampled evaluator reconstructs field value and gradient from the same eight corners per non-intact endpoint. The first probe computes gradients during each march evaluation, then reuses the accepting evaluation for the normal.
- The trilinear field is the candidate geometry. Its global derivative certificate comes from stored edge slopes, with component bounds floored at one to cover the clamped-volume outside extension. Both transition interpolation and max(body,-cut) inherit the larger input bound. Analytic approximation error is bounded only inside the atlas; the outside extension has a separate definition.

## Evidence

`report.json` records actual GPU rendering: six settled views (three stages, two angles), five transition snapshots, and a Reset-during-animation followed by Hit check. No tested ray exhausted the 160-step cap. Both representations produced the same silhouette hit counts, with small differences in cavity coverage from discretization. Screenshots show the same concave cavity in each panel, with visible sampling differences along the cached rim.

At the frontal heavy state, mean hit steps were approximately **1.66 analytic / 2.32 sampled** (see current JSON for exact values). These means include the intact skin pixels that hit the exact torso envelope immediately. They do not establish GPU time or the cost of real posed zombies. The sampled representation takes more steps here and performs texture reads for shapes that are cheap analytically. There is **no measured speedup** from sampling these simple presets.

Six behavioral CPU tests cover 100 actor states × 100 hits without library growth, two-endpoint playback, long-frame catch-up, monotonic severity, analytic-vs-sampled error, finite-difference gradient agreement, and outside-box behavior. Combined with the quick shader tests, 244 tests pass; TypeScript passes. Independent review found the animation reset issue (fixed and browser-tested) and the error-bound documentation qualification above.

The initial fixture marched from a generic near distance without an envelope and encountered exhausted grazing rays. The current fixture intersects the exact intact torso ellipsoid to bound entry/exit; every carved state is a subset of that envelope. This models the role of the game's hull bounds. No step-limit increase was used to hide that failure.

## Interpretation and next integration

The shared state/storage model is useful for either representation. Start the game adapter with bounded analytic presets for simple cavities; retain shared sampled data for richer authored shapes if it earns its cost in a matched comparison. This is a direction to test, not a production winner declaration.

The existing cached shapes and game integration on `codex/zoned-wounds-visual-fix` have **not been migrated**. This probe does not test region selection, moving owner frames, multi-actor GPU load, original wound recipes, head/limb fallback, injuries/severing, detached pieces, mesh baking or recycling. The 256 KiB prototype is one region and one scalar channel, so it is not a drop-in equivalent to the old five-owner RGBA cache's ~24 MiB per instance.

A production migration should share immutable region/variant/severity content, bind IDs and frames per actor, and snapshot IDs/transition state for detached pieces. The mesh-bake worker and hit/sever logic must consume the same selected damage representation as rendering. Do not simply share the old mutable composed atlases: actors would alter one another's wounds.

## Reproduce

```sh
npx vitest run src/lab/sdf-zombie/shared-wounds/presets.test.ts --maxWorkers=1 --minWorkers=1
export LAB_VITE_PORT=5289 LAB_CDP_PORT=9289
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node docs/dev-notes/2026-09-06-shared-wound-torso/check.mjs
```
