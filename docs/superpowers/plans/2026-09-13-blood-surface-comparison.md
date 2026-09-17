# Blood surface quality and comparison lab

Goal: Preserve the user's preferred dynamic, small, stretched, glossy blood while removing block-shaped reconstruction. Add optional cohesive tapered strands and occasional ragged sheets. Build an honest synchronized comparison page before changing shipping defaults. Shutter blur is explicitly deferred.

Architecture: reuse BloodSim and createGooLayer; preserve the original renderer branch exactly by default. Candidate reconstruction and connected geometry are opt-in and available in the comparison page and the actual game. No substitute canvas animation or unrelated fluid simulation.
Tech stack: TypeScript, Three WebGPU/TSL/WGSL, Vite, Vitest.

Constraints: training is running. NO GPU work, browser previews, captures, benchmarks, training, or heavy builds in this dispatch. Run only narrowly scoped CPU tests with one worker. Do not touch training assets, datasets, .lab-tmp, private QA directories, existing services, or main-checkout runtime source. Work in the dispatch-created isolated worktree only; abort if cwd resolves to the primary checkout. No push/merge. Commit scoped files. No external subagents. Shared node_modules may be linked but not modified/reinstalled. Visual acceptance remains PENDING until owner confirms training is finished. Do not claim visual or shader compilation success from mocked tests.

Dependency graph: one dispatch task; A -> B -> C -> focused verification, sequential within the same worktree.

### Task 1: Blood reconstruction, connected geometry, and synchronized comparison

Files:
- Modify src/lab/sdf-zombie/webgpu/goo-layer.ts and focused goo-layer.test.ts
- Modify src/lab/sdf-zombie/webgpu/game-main.ts only for opt-in candidate wiring/diagnostics; shipping defaults unchanged
- Create src/lab/sdf-zombie/webgpu/blood-connections.ts and focused tests if needed
- Create sdf-blood-compare.html and src/lab/sdf-zombie/webgpu/blood-compare-main.ts (small supporting modules/styles allowed)
- Modify src/lab/sdf-zombie/blood-sim.ts only if stable emitter identity is necessary; do not alter existing integration/emission/rng behavior
- Modify vite.config.ts only if entry registration is required
- Create docs/dev-notes/2026-09-13-blood-surface-comparison.md

Read actual AGENTS instructions and relevant source first. Prior investigation establishes:
- goo-layer default densityScale .5, tied to sdfLayer.targetSize. Surface floors coordinates and textureLoads the field, then hard-discards below threshold.
- Active game depth material outputs alpha 1: edge smoothstep changes color, not coverage. Switching texture filtering alone cannot affect integer loads.
- Game defaults: sizeScale .14, threshold .65, blur 0, stretch 4, edge 2.75, absorb 1.6, spec 2.85, gloss 220, rim 0, shadowRed .19.
- Goo ON hides bead/ribbon renderer; mist remains hard-cutout. Existing ribbons are individual particle histories with unlit vertex colors, not cross-stream sheets. Do not simply turn those on and double-render particles.
- Field is additive density + density-weighted depth + gut mask. Preserve gut channel and depth behavior; organs must not be recolored.

A. Smoother reconstruction without changing the fluid motion/look
- [ ] Add explicit original/smooth reconstruction mode defaulting to original, preserving old shader path and uniforms.
- [ ] Interpolate the density field at continuous output positions BEFORE thresholding. Handle density-weighted channels coherently and reject empty/depth-discontinuous neighbors where appropriate. Do not interpolate post-threshold RGB/depth indiscriminately across background.
- [ ] Implement actual antialiased silhouette coverage for the candidate depth composite while respecting foreground walls/body occlusion. Explain chosen alpha/depth strategy and its limits. Do not revert to always-on-top overlay or introduce transparent fragments that incorrectly occlude the scene. If architectural depth compositing changes are required, keep them scoped and candidate-only.
- [ ] Keep blur=0 and preferred material/emission values. Avoid solving aliasing by enlarging blobs or weakening highlights globally. Add density resolution diagnostic independent of overall output size.
- [ ] Audit normal reconstruction so candidate does not simply replace blocks with unstable specular noise. Retain the baseline normal path separately for comparison.

B. Optional connected blood, preserving the original simulation
- [ ] Build bounded, deterministic tapered connections for a coherent emission stream (same emitter and nearby age/space), NOT arbitrary screen-overlapping particles. Add stream IDs only if needed with no new RNG consumption in baseline simulation.
- [ ] Add sparse small sheet patches spanning related flow paths, with smooth breakup and seeded surface-attached edge noise/holes. Avoid static giant sails or connecting unrelated wounds; enforce length/area/lifetime budgets and degeneracy rejection.
- [ ] Use wet shaded surfaces consistent with existing goo rather than flat MeshBasic ribbon colors. Existing goo can carry droplets/pools; avoid doubling entire particle populations. Make strands and sheets independently toggleable for attribution.
- [ ] If true sheets cannot be implemented correctly in scope, retain a clearly labeled experimental option and document exactly what remains; do not call ribbons sheets or fabricate visual success.

C. Comparison page and real game opt-in
- [ ] Provide Original / Smooth / Smooth + connections variants from identical seeded BloodSim state, exposure time and camera. Prefer a single canvas with selectable A/B and optional split view; no independently advancing duplicate simulations.
- [ ] Controls: replay burst, pause/step, speed, orbit camera, variants, dark/neutral background, obstacle occlusion fixture, resolution display and density scale. Keep controls concise, not a huge tuning dashboard. Start paused with explicit Play to avoid unexpected GPU activity when opened later.
- [ ] Use game defaults and actual shared production rendering functions. Include moving droplets, sustained jet, close overlap and landing/pool cases; use common simulation state read-only for all variants.
- [ ] Add reproducible seed/frame diagnostics and screenshot/capture instructions. Report actual target dimensions and active modes, not estimated values.
- [ ] Wire candidate in /sdf-game.html behind documented query flags with baseline the default. Existing URLs and training renderer contracts unchanged. No launching a server or browser now.

Verification/review handoff
- [ ] Focused CPU tests for interpolation/coverage math, empty/depth boundaries where factored, and connection topology (different emitters never connect, bounded lifetime/length, stable replay, no NaNs). Use single worker, e.g. npx vitest run <scoped files> --maxWorkers=1 --minWorkers=1.
- [ ] Inspect final diff and commit only scoped files. Record exact commands/results and limitations.
- [ ] Write review notes: architecture, flags, comparison URL, changed files, potential depth/alpha risks, tests; explicitly list WebGPU compile, visual parity, gameplay and performance as NOT RUN due to training.
- [ ] Deferred acceptance checklist: baseline image parity; shader compile; isolated mist/goo attribution; same-frame comparison at equal resolution; stationary and moving cameras; against body and occluder; no texture swimming; same game scene at 800x600 with real post effects; quiet full-frame benchmark separately. Reviewer/user decides if candidate retains the liked appearance. No automatic promotion.
