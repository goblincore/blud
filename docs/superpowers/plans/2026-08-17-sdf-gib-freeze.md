# SDF Gib Freeze Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a full 18-piece WebGPU SDF gib complete without any gameplay frame exceeding 50 ms, on both the first gib and repeated gibs.

> **Implementation outcome (2026-08-17):** Profiling narrowed the reusable
> boundary below the original 40-exclusive-material design. One asynchronously
> precompiled NodeMaterial is safe to share because TSL `onObjectUpdate` selects
> each mesh's exclusive texture/uniform state before its draw. Mesh identities
> are still pooled at the existing 40-chunk cap because Three r185 retains a
> `RenderObject` until its material is disposed. The precompiled mesh becomes
> slot zero, so warm-up and gameplay use the same object and float SDF target
> context. See the [evidence note](../../dev-notes/2026-08-17-sdf-gib-freeze/notes.md).

**Architecture:** Replace per-spawn construction of complete chunk views and NodeMaterials with a bounded pool of persistent, exclusive chunk-view slots. Each slot owns its mutable data texture, uniforms, proxy meshes, and materials; spawning resets and uploads a slot, while despawning hides and returns it without disposing renderer objects. Prove the reuse boundary with profiling before completing the refactor, and amortize any unavoidable startup preparation outside gameplay frames.

**Tech Stack:** TypeScript, Three.js r185 WebGPU/TSL, WGSL, Vitest, the SDF zombie lab's visible-window rAF probe and in-page benchmark.

**Spec:** `docs/superpowers/specs/2026-08-16-sdf-lab-skeleton-reveal-design.md`

---

## Global constraints

- Work only on the dispatched task branch based on `claude/gib-wound-bugs-b8c728`.
- Read `AGENTS.md`, `TASKS.md`, this plan, and the failed-task report at `/Users/donny/.claude/dispatch/reports/2026-08-17-post-polish-bugs-task-1-20260817-104512.txt` before editing.
- Use DualMem as required by `AGENTS.md`.
- WebGPU SDF lab only. Do not touch gameplay gibs, hands/FPV, motion, shader seam blending, or WebGL.
- Do not port commit `168cd11`'s seam work. It fixed a deterministic posed discontinuity but was rejected after a real 10-body A/B regressed from 18.57 ms to 33.18 ms.
- Do not assume GPU pipeline compilation is the cause. The failed task disproved that hypothesis.
- Do not edit `TASKS.md`.
- Preserve the shared X1.26 fallback volume texture contract and all current hand-volume behavior.
- Follow test-driven development: make the lifecycle seam fail in a focused test before changing production code.
- Reject rAF results from a hidden/background page. Run probes in one visible browser window and report the exact script/steps.
- Commit the finished task only after the full verification gate passes.

## Known evidence; start here

- The synchronous `gibEverything()` call itself takes about 1 ms.
- The first rendered frame after 18 chunks were spawned stalled 5.8-6.5 seconds in the original measurements.
- Repeated gibs stalled again (about 13 seconds in one run) even though the renderer program count did not increase.
- Six chunk materials produced only two additional programs; later repeated gibs produced zero new programs.
- Instrumented `GPUDevice.createRenderPipeline*` and `createShaderModule` calls were approximately 0-0.1 ms during the stall.
- A CPU profile placed the time in Three.js NodeMaterial builder/generator/cache-key work, repeated once per fresh chunk material/view.
- Material keys matched; the remaining cache divergence appeared to involve per-render-object dynamic state such as the lights node. Confirm the exact boundary rather than guessing.
- `createChunkGpuView()` currently allocates a data texture, uniforms, `MeshBasicNodeMaterial`s, proxy geometry/meshes, and fallback volume state for every spawn; `spawnChunk()` disposes the oldest view once `MAX_CHUNKS` (40) is exceeded.

---

### Task 1: Reproduce and isolate the reusable boundary

**Files:**
- Inspect: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Inspect: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Create: `docs/dev-notes/2026-08-17-sdf-gib-freeze/notes.md`

- [ ] Start from a clean baseline and run the visible-window rAF probe for a full `gibEverything()` spawn. Record first-gib worst frame and at least one repeated-gib worst frame.
- [ ] Record the chunk count, program-count delta, and renderer-side creation calls during both probes.
- [ ] Capture one CPU profile of the stalled frame and identify the dominant Three.js builder/generator stack.
- [ ] Run a minimal experiment that creates one complete chunk view/material once, removes it, then reuses the same view/material for a different chunk payload. The experiment must show whether whole-view reuse avoids another builder stall.
- [ ] If whole-view reuse does not remove the stall, stop and profile the next cache-key divergence before implementing a pool. Document the evidence and adapt the boundary narrowly.

**Gate:** Do not implement the full pool until reuse of a persistent renderer object is proven to eliminate the repeated builder cost.

---

### Task 2: Specify the slot lifecycle with failing tests

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/chunk-view-pool.ts`
- Create: `src/lab/sdf-zombie/webgpu/chunk-view-pool.test.ts`
- Modify as needed: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`

- [ ] Extract a small pool/lifecycle abstraction that can be tested without WebGPU. It should own a fixed-capacity set of exclusive slots and expose checkout, return, and reset semantics.
- [ ] Write failing tests for: deterministic slot reuse; no double checkout; returned slots becoming available; capacity never exceeding 40; FIFO eviction/return behavior matching the current lab cap; and reset clearing all per-chunk state that could leak between owners.
- [ ] Add a construction counter/factory seam and a failing regression proving that, after pool preparation, repeated checkout/return cycles perform zero new view/material constructions.
- [ ] Keep the pure pool independent of Three.js so failures are fast and deterministic.

**Gate:** Run `npx vitest run src/lab/sdf-zombie/webgpu/chunk-view-pool.test.ts` and preserve the RED output in the dev-note before production implementation.

---

### Task 3: Make chunk views resettable and pool-safe

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/chunk-view-pool.ts`
- Modify: `src/lab/sdf-zombie/webgpu/chunk-view-pool.test.ts`
- Modify only if required: existing focused `zombie-gpu` tests

- [ ] Refactor the current `createChunkGpuView()` internals into a persistent slot whose material, cone material, meshes, geometry, mutable uniforms, and data texture survive across owners.
- [ ] Add an explicit reset/upload operation taking the new `Chunk`, primitive list, template uniforms, torn ends, and shared volume texture.
- [ ] Copy every current template uniform deliberately, reset wound/torn-end rows and counts, upload rest rows for the new local primitives, reset transforms/scales/visibility, and ensure stale face/head/gore state cannot leak.
- [ ] Preserve the shared fallback-volume ownership rule: pooled slots must not create or dispose one fallback texture per checkout.
- [ ] Make return hide/detach the slot without disposing its material, geometry, data texture, or cone state. Final lab teardown still disposes every slot exactly once.
- [ ] Keep `ChunkGpuView.update()` behavior and world/local recentering intact.
- [ ] Do not share mutable uniform nodes between simultaneously live slots; pool slots are exclusive.

**Gate:** Focused pool tests green, existing chunk/view tests green, and a repeated slot-reset test proves payload A cannot leak into payload B.

---

### Task 4: Prepare the bounded pool outside gameplay frames

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/chunk-view-pool.ts`
- Modify as needed: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`

- [ ] Replace `spawnChunk()`'s direct `createChunkGpuView()` call with pool checkout/reset.
- [ ] Return evicted/expired chunks to the pool instead of disposing them.
- [ ] Size the pool to the existing `MAX_CHUNKS = 40`; do not increase the gameplay cap.
- [ ] Prepare slots incrementally during lab startup/loading. Never construct all 40 in one visible gameplay frame.
- [ ] If a slot must render once to complete Three.js builder state, warm it while hidden or offscreen and spread work across frames. Measure startup worst-frame time.
- [ ] Do not let an unprepared slot enter the scene: delay that chunk's visibility briefly rather than blocking the world.
- [ ] Expose only the smallest diagnostic hook needed to read pool size, ready/free/live counts, and total construction count from tests/browser probes.

**Gate:** After preparation, first and repeated full-body gibs create zero new views/materials and never exceed pool capacity.

---

### Task 5: Prove the freeze is gone without moving it elsewhere

**Files:**
- Modify: `docs/dev-notes/2026-08-17-sdf-gib-freeze/notes.md`

- [ ] Run the same visible-window rAF probe for the first full 18-piece gib and at least two repeated gibs.
- [ ] Acceptance: no measured gameplay frame exceeds 50 ms.
- [ ] Record startup preparation duration and worst startup frame. Acceptance: no single visible startup frame exceeds 50 ms; if it does, further amortize preparation.
- [ ] Record construction counts before/after each gib; they must not increase after preparation.
- [ ] Verify 40-live-chunk cap behavior by exceeding the cap, confirming the oldest chunk is removed and its slot becomes reusable.
- [ ] Visually confirm chunks still render, tumble, carry torn ends, trail goo, and despawn/reuse without stale geometry or shading.
- [ ] Run the in-page 1-body and 10-body benchmarks as a regression check; record results, but do not substitute them for the rAF gib probe.
- [ ] Run `npm run build` and `npm test` from a fresh shell invocation.
- [ ] Run `git diff --check` and confirm `TASKS.md`, hands/FPV, motion, and seam files are untouched.
- [ ] Commit with a focused message such as `fix(sdf-lab): pool persistent gib chunk views`.

## Final acceptance

- Full 18-piece first gib: worst visible gameplay frame <= 50 ms.
- Two repeated full gibs: worst visible gameplay frame <= 50 ms each.
- No new view/material construction after pool preparation.
- Pool capacity remains 40, exclusive slot state resets correctly, and teardown disposes each slot once.
- No startup frame > 50 ms; any necessary warm-up is amortized or visibility-gated.
- Chunk visuals/physics remain correct.
- Focused tests, full `npm test`, `npm run build`, and `git diff --check` pass.
- Evidence is committed in `docs/dev-notes/2026-08-17-sdf-gib-freeze/notes.md`.
