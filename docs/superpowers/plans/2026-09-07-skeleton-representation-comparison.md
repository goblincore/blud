# Skeleton Representation Comparison Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to execute only the assigned task. Experimental work remains isolated and opt-in.

**Goal:** Compare faithful skeleton meshes and sampled skeleton SDFs while preserving forward character readability.

**Owner clarification (2026-09-08, supersedes exact-parity requirements):** the existing skeleton is a useful reference, not an exact visual target. Fewer ribs, a better mesh skull shape and other deliberate anatomy improvements are explicitly allowed. Keep broadly compatible scale, rigging, recognizable anatomy and gameplay readability. Label intentional art differences separately from bugs. Source/extraction accuracy tests validate the CHOSEN shape; they must not force every prototype to reproduce the old anatomy or the old world-axis bend/squash quirks. Do not spend budget perfecting old-geometry parity. The hard gates are: no clipping, no leaks through intact flesh, no broken wound reveals/severing, no distracting shading mismatches; reuse authored forward lighting conventions. Intentional improved rigid bend behaviour is allowed — record differences rather than defaulting back to procedural merely to imitate quirks. Zombie first, soldier next.

**Architecture:** Shared rigid-segment field fixtures feed two isolated representations. Meshes must match forward shading and field exposure; volumes stay within the existing field/shading path. Evidence determines a recommendation, not automatic integration.

**Tech Stack:** TypeScript, Three.js WebGPU/TSL/WGSL, existing CPU field and mesh extraction, Vitest, private CDP GPU capture.

**Spec:** docs/superpowers/specs/2026-09-07-skeleton-representation-comparison-design.md

## Global Constraints

- Base on reviewed main cb51bf1b; inherit predecessor task commits. Never modify primary checkout, main, unrelated gargoyle work, or extracted placeholder assets.
- Baseline forward, segment bone cull on; tubes off. No forward+ implementation, organs rewrite, default change, merge or push.
- This is a research comparison. Keep unsupported cases explicit and procedural fallback correct; failed feasibility is a legitimate result, fabricated parity is not.
- Read AGENTS.md and required DualMem context. Read docs/dev-notes/2026-09-07-bone-segment-spheres/notes.md, docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md, and docs/dev-notes/2026-09-07-m2-main-integration/notes.md. Inspect existing shell experiments and explain what they actually measured before reusing them.
- GPU tasks strictly sequential, private ports 5396/9396. Use scripts/lab-servers.sh, bounded CDP requests and cleanup of owned resources only. No timing on a busy GPU, no indefinite load polling. Save partial output at each phase.
- Checkpoint and commit functional progress before GPU work; reserve final 10 minutes for an honest report. Each task has a 25-minute bounded deliverable; unresolved implementation is documented, never hidden by auto-retry.
- CPU checks: npx vitest run <touched test files> --maxWorkers=2 --minWorkers=1; npx tsc --noEmit. Runtime changes require npm run build. Full suite is coordinator-owned after implementation settles.

## Dependency graph

Task 1 -> Task 2 -> Task 3 -> Task 4. The implementations are logically alternatives but share integration seams and one GPU, so execute sequentially.

### Task 1: Establish field contract and deterministic comparison fixtures

**Files:**
- Read: src/lab/sdf-zombie/rig-bind.ts, rig-frames.ts, bone-derive.ts, pack.ts, chunk-bake-field.ts; webgpu/march.wgsl.ts, zombie-gpu.ts, bone-instancer.ts, chunk-bake-geometry.ts, shell-spike.wgsl.ts, shell-spike-main.ts.
- Create: src/lab/sdf-zombie/webgpu/skeleton-spike/contract.ts and contract.test.ts.
- Create: docs/dev-notes/2026-09-07-skeleton-comparison/task-1.md and fixture-contract.md.

**Interfaces:** Publish the concrete segment source adapter and tests before later tasks. Core representation selector:
```ts
export type SkeletonMode = 'procedural' | 'mesh' | 'volume';
export type Point3 = readonly [number, number, number];
export interface BoneFieldSource {
  character: string;
  segment: string;
  revision: string;
  bounds: { min: Point3; max: Point3 };
  distance(p: Point3): number;
}
```
`distance` consumes segment-local metres and contains bone geometry only, preserving its authored operations; organs are excluded. If bone-to-segment assignment crosses a smooth union/nonrigid boundary, explicitly describe and retain procedural fallback rather than incorrectly slicing it. Extend this contract only with actual documented needs.

- [x] Map bone packing and posed transforms end to end. Identify exact field composition, normal/material selection, wound clipping and existing mesh exposure; distinguish bones from organs and explain why a separate mesh cannot automatically duplicate those operations.
- [x] Inspect shell, volume/texture and bake experiments via rg --files and DualMem; record reusable components and their measured limits. Do not assume a shell is a baked distance volume.
- [x] Implement the minimal source adapter with regression tests using real zombie skull, pelvis and rib segments. using real zombie skull, pelvis and rib segments. Test local->posed->local round trips and source distance agreement, including subtraction cavities. Example assertion (use real fixture values):
```ts
expect(Math.abs(source.distance(p) - referenceDistance(p))).toBeLessThan(1e-6);
```
- [x] Define reproducible fixture states for intact, head wound, pelvis wound, rib exposure, bent limb and sever; pinned in docs/dev-notes/2026-09-07-skeleton-comparison/fixture-contract.md.; pin camera, light, timestep, resolution and character configuration. Save actual state fields/signatures in fixture-contract.md for both implementers. Do not create a second gameplay simulation.
- [x] Run focused tests/typecheck. Record feasibility risks, exact file/function landmarks and minimum next implementation steps. Results in docs/dev-notes/2026-09-07-skeleton-comparison/task-1.md. Record feasibility risks, exact file/function landmarks and minimum next implementation steps. Commit a usable foundation or a clearly documented blocked finding; do not claim a visual or GPU pass from CPU tests.

### Task 2: Faithful mesh prototype with forward shading

**Files:**
- Read: predecessor fixture-contract.md and contract.ts; existing chunk-bake-geometry.ts, bone-instancer.ts, rig-frames.ts, march.wgsl.ts and sdf-layer.ts.
- Create: src/lab/sdf-zombie/webgpu/skeleton-spike/mesh.ts and mesh.test.ts.
- Modify only as required: webgpu/game-main.ts, zombie-gpu.ts, march.wgsl.ts; add a small experiment selector module instead of broad refactoring.
- Create: docs/dev-notes/2026-09-07-skeleton-comparison/task-2.md and mesh evidence.

**Interfaces:** Consume BoneFieldSource. Export a cached geometry factory with explicit disposal and keys including source revision and extraction resolution. Expose opt-in mesh through a development `skeleton=mesh` query, with absence preserving baseline. Record exact API for task 3.

- [ ] Read Task 1 findings first; if its field adapter is incomplete, finish only the prerequisite needed for a meaningful mesh prototype and record scope consumed.
- [ ] Add failing tests proving mesh bounds and sampled surfaces match the CHOSEN skull/pelvis/rib anatomy (authored or deliberately improved — owner clarification) within extraction-cell error; preserve holes and disconnected components. Use existing surface extraction where applicable. Test cache invalidation and disposal. Do not substitute capsules or tubes.
- [ ] Build cached segment-local meshes and pose using existing bone frames. Retain procedural handling for nonrigid/smooth-union cases until proven, and record coverage/fallback counts.
- [ ] Integrate in forward mode behind the selector. Match existing bone material, fill/key/flashlight, wetness, Fresnel, gamma and normal conventions; factor shared shading only if it preserves baseline. Implement the correct wound/flesh exposure rule, not only depth hiding. If that cannot fit the task budget, retain an isolated anatomy fixture and report gameplay parity NOT achieved.
- [ ] Verify shader compilation and inspect matched baseline/mesh skull, pelvis and rib captures under darkness and flashlight plus one posed/sever state. Include normal/depth views and per-mode switches proving the intended path was used. No performance measurements in this task. Exact pixel parity is NOT required (owner clarification); gate on clipping, leaks, wound reveals and shading mismatch.
- [ ] Run focused tests/typecheck/build. Commit before extended capture; report visible seams, missing wound interactions, shading differences and next steps without calling them acceptable. Keep prototype opt-in and runnable.

### Task 3: Sampled skeleton SDF prototype in the shared shading path

**Files:**
- Read: predecessor contract and fixture docs; webgpu/march.wgsl.ts, zombie-gpu.ts and pack.ts.
- Create: src/lab/sdf-zombie/webgpu/skeleton-spike/volume.ts, volume.test.ts and volume.wgsl.ts.
- Modify only needed experiment selector, webgpu/march.wgsl.ts and zombie-gpu.ts bindings.
- Create: docs/dev-notes/2026-09-07-skeleton-comparison/task-3.md and volume evidence.

**Interfaces:** Consume BoneFieldSource and existing selector; add `skeleton=volume`. Texture field sampling consumes segment-local metres and returns distance in metres plus any declared conservative error bound. No additional lighting path.

- [ ] Read actual shared field operators and Task 1/2 limitations. Test the sampler on real subtractive skull/pelvis/rib points, grid boundaries, pose transforms, segments touching and thin bones before GPU wiring.
- [ ] Implement bounded cached grids with explicit dimensions, voxel spacing, format, quantization error and memory reporting. Evaluate at least two resolutions. Do not allocate an unbounded full-character texture for every actor. Cache by source revision; invalidation and disposal must be tested.
- [ ] Use trilinear sampling (manual if chosen GPU format is not filterable), explicit outside-grid behavior, and a justified conservative step/fallback policy. Never clamp to an edge texel and pretend it represents arbitrary outside distance. Verify crossings against the procedural oracle; approximation tolerance must not be silently added to acceptance criteria.
- [ ] Preserve segment smooth-union/subtraction order and pose semantics; keep organs procedural. Feed sampled bone distance into existing wound/material/normal/lighting selection so authored forward fill remains. For unsupported transforms or seams, use explicit procedural fallback and report its rate.
- [ ] GPU compare same Task 1 states in procedural/volume modes, inspecting shape, normals, thin structures, cavities, darkness and wet highlights. Record max/percentile distance/depth error and missing crossings; capture at scales 1 and 0.5 where feasible. No performance measurements yet.
- [ ] Run focused tests/typecheck/build and commit; report exact coverage, grid bytes, startup bake cost and any fidelity failure. A prototype with a demonstrated blocker is a useful result; do not automatically recommend it.

### Task 4: Visual comparison and bounded performance verdict

**Files:**
- Create: scripts/skeleton-compare.mjs and scripts/skeleton-compare.sh.
- Create: docs/dev-notes/2026-09-07-skeleton-comparison/review.md, validation.json, measurements.json and captures.
- Read: both prototype reports, fixture-contract.md; scripts/sdf-game-bench.mjs, scripts/lab-servers.sh and webgpu/gpu-pass-timing.ts.
- Modify diagnostic modules only if needed to capture exact state; do not redesign either representation in this task.

**Interfaces:** Compare procedural/mesh/volume via predecessor selector and diagnostics; source branch/commit, mode, character, camera/pose/wounds/lights, resolution, representation counts and fallback rate must accompany each evidence item.

- [ ] Read all earlier reports and validate actual implementation coverage. Mark missing candidates unavailable rather than benchmarking a procedural fallback as the candidate. If neither candidate is functionally ready, produce a concrete blocker report and stop.
- [ ] Build bounded CDP capture that owns its resources, saves after each fixture, and checks deterministic state. Baseline repeatability first; disable/freeze cosmetic variation consistently without changing tested bone shading. Capture zombie then soldier; goblin optional after required cases.
- [ ] Inspect matched intact/head/pelvis/rib/bent-joint/sever images at scales 1 and 0.5, darkness/flashlight/wet response. Record source-specific defects and whether mesh lighting really matches forward. Do not grade using whole-frame brightness alone. Include actual mode-use counters to detect fallback-only runs. Label intentional art differences separately from bugs.
- [ ] Commit visual/functional findings before timing. Check for competing GPU work or actively rendering previews; if busy record timing unavailable, preserve resources and finish rather than wait. Never close user tabs or kill foreign processes.
- [ ] On an idle GPU use three interleaved repetitions with eight warmup frames and 32 measured frames per fixture/mode, actual GPU queue/timestamps, bounded runtime. Record median/p95/raw samples, spread, adapter and end-to-end total as well as pass costs. No production-FPS claims from hand-stepped wall time. Report bake latency, triangles/grid bytes, CPU upload, cache growth and fallback rate. If baseline spread exceeds 10%, label small deltas unresolved.
- [ ] Produce a recommendation: mesh, volume, neither, or insufficient evidence. Explain how much of the measured gain survives with correct lighting/shape and what must happen before production. Keep forward/procedural default. Include reproducible launch commands for owner playtest; no automatic merge/push.
