# march.wgsl Phase 2 Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn `marchBody` from one ~2,100-line WGSL function assembled out of
string pieces into a handful of real WGSL functions passing small structs, so
`refineBody` stops being a second full copy for the compiler, and then collapse
the crowd and body march into ONE program (~48 s of the cold boot).

**Spec:** `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md` —
read it first. Phase 1 (the file split) is done: tasks 1–3 merged, see
`docs/dev-notes/2026-09-18-march-split/NOTES.md`.

**Architecture:** The feature blocks already live in
`webgpu/march/body/blocks/**` and are spliced into three parent strings. Phase 2
changes what those strings ARE: `trace()`, `surface()` and `light()` become
declared WGSL functions taking `MarchIn` / `Hit` / `Surface` structs, and both
entry points (`marchBody`, `refineBody`) become thin wrappers that pack the
positional uniform list into those structs and call the same functions. No block
text changes in this plan; only where the text lives and what it is passed.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest,
headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  logic in pure renderer-free tested modules; load-bearing rendering in hand-written
  WGSL; state on `ctx` or in a feature module; deterministic sim; plain-data seams.
- **wgslFn parse rules:** every WGSL string handed to `wgslFn` must BEGIN with
  `fn` — three's parser is `^fn`-anchored. A `struct` therefore CANNOT open a
  string; declare it AFTER the function in the same string (WGSL module-scope
  declarations are order-independent). `SDF_SURFACE_STATE` in `deferred-sdf.ts`
  and `MARCH_NORMAL_OUT` already use exactly this trailing-declaration pattern —
  copy it rather than inventing another.
- In `MARCH_BODY_PARAMS` never put a `:` inside a comment (it breaks the parser).
- **The golden test is phase 1's gate, not phase 2's.** Phase 2 CHANGES the
  shader text on purpose, so `march/march-golden.test.ts` will fail: update its
  snapshot deliberately, in the same commit as the change that moved the text,
  and say in the message what moved. It must never be updated to silence a
  surprise.
- **The pixel gate is the real gate:** `node scripts/march-hash.mjs` inside
  `scripts/lab-servers.sh`, room1 `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d`
  (repeat identical, wounded `1381a866703b827745486a1062240a46bee5c73f`) and
  room2 (`MARCH_HASH_ROOM=2 MARCH_HASH_TILES=0`)
  `35b6d5619f7f85a52e852056a09f6c0fbfacf2c5`. A diff means behaviour changed —
  diagnose, never loosen.
- **NEVER run two pixel gates at once.** A concurrent headless capture (another
  agent, another worktree) makes the gate read wrong AND non-deterministic
  hashes; that cost a bisect on 2026-09-19. Check for other
  `chrome --remote-debugging-port=93xx` processes first.
- **Targeted tests** (`npm test -- march …`) plus `npx tsc --noEmit`, except
  where a task says to run the full suite. Known pre-existing failures: 15 on
  main (`game-actor-torso-slug` ×2, `march-step-soundness`, `surface-nets-cpu`,
  the blob/skeleton set) — compare the failure SET, not the count.
- **Cold boot is the point of this plan: report it.** `scripts/compile-census.mjs`
  per program, fresh profile. The OS shader cache is machine-global, so a cold
  compile needs a real constant change to invalidate (see
  `docs/dev-notes/2026-09-19-shader-compile/NOTES.md`).
- Work ONLY in your worktree. Never `git stash`. `node_modules` is symlinked.
- Headless capture only — the in-app browser pane loses the WebGPU device.
- Extracted Blood assets are dev placeholders — never commit them.

---

## Task 1: Baselines, and a cold-compile measurement that can be trusted

**Files:** `docs/dev-notes/2026-09-20-march-phase-2/NOTES.md` (new)

- [ ] **Step 1: Pixel + test baseline.** Record the three room1 fields and room2
      from a run with nothing else capturing, and `npx tsc --noEmit` + the march
      suite counts.
- [ ] **Step 2: Warm boot.** `scripts/compile-census.mjs`, 3 runs, record
      `drawOnce` and the per-pipeline table.
- [ ] **Step 3: Cold boot.** Invalidate the machine-global cache with a
      transient numeric change in a march constant (the census notes describe
      the exact trick), run once, revert. Record total and per-program seconds.
      Expect ~4 programs × ~48 s.
- [ ] **Step 4: Write the numbers into NOTES.md** as the table every later task
      appends a row to. A task that cannot show its row did not measure.

## Task 2: `MarchIn` — pack the positional list once

**Files:** `webgpu/march/body/params.wgsl.ts`, `webgpu/march/body/entry.wgsl.ts`,
new `webgpu/march/body/io.wgsl.ts`

- [ ] **Step 1:** Declare `struct MarchIn { … }` carrying the ~100 uniforms,
      grouped by the comment headings the positional list already uses
      (geometry, wound cfg, colours, light, spot, surface, debug). Declare it in
      `io.wgsl.ts` AFTER a tiny `fn` (the parse rule above).
- [ ] **Step 2:** `marchBody` keeps its positional signature — three drives it —
      and its FIRST statement builds `var m: MarchIn = MarchIn(worldPos, camPos, …);`
      in the exact parameter order.
- [ ] **Step 3:** Do NOT rewrite the block text to read `m.*` yet. This task is
      the plumbing only: build the struct, leave the body reading the positional
      names, confirm the shader still compiles and the pixel gate is identical
      (an unused struct costs nothing).
- [ ] **Step 4:** Gate: pixel identical, golden snapshot updated deliberately,
      warm boot reported. Commit.

## Task 3: `trace()` as a real function

**Files:** `webgpu/march/body/trace.wgsl.ts`, `io.wgsl.ts`, `entry.wgsl.ts`, `helpers.ts`

- [ ] **Step 1:** Declare `struct Hit { t: f32, p: vec3<f32>, best: i32, field: vec4<f32>, nearWound: bool, band: i32, … }`
      — exactly the values `MARCH_TRACE_POST` reads out of the loop today.
- [ ] **Step 2:** Move SETUP + LOOP into `fn marchTrace(m: MarchIn) -> Hit`,
      keeping the block splices as they are. The debug early-returns inside the
      loop return a sentinel `Hit` (`t < 0` with a debug colour field) rather
      than returning from the entry — the entry re-raises them.
- [ ] **Step 3:** `marchBody` and `refineBody` both call `marchTrace`.
      `refineBody` keeps its own REFINE_LOOP variant: pass a flag in `MarchIn`
      (`refine: u32`) and branch inside, or keep two small trace fns if the
      branch costs a register — measure before choosing, and write down which.
- [ ] **Step 4:** Gate: pixel identical, golden updated, warm boot + module size
      reported. Commit.

## Task 4: `surface()` and `light()`

**Files:** `webgpu/march/body/{trace,surface,light}.wgsl.ts`, `io.wgsl.ts`, `entry.wgsl.ts`

- [ ] **Step 1:** `struct Surface { albedo, n, gloss, metal, wet, specPow, glow, burnEmit, … }`
      — what SURFACE_PREP hands the lighting tail today.
- [ ] **Step 2:** `fn marchSurface(m: MarchIn, h: Hit) -> Surface` (the post-hit
      material chain: prim material, normal, masks, tissue, organ, mottle, face,
      gore, meat, paint/char, burn, melt).
- [ ] **Step 3:** `fn marchLight(m: MarchIn, h: Hit, s: Surface) -> vec4<f32>`
      (flashlight, occlusion, ambient, compose, display/debug).
- [ ] **Step 4:** Both entries become: pack `MarchIn`, `marchTrace`,
      `marchSurface`, `marchLight`. `REFINE_BODY` stops re-joining the
      setup/post/surface/light text — that is the second full copy this plan
      exists to delete. Report `MARCH_BODY.length` + `REFINE_BODY.length` before
      and after.
- [ ] **Step 5:** Gate: pixel identical, golden updated, COLD boot re-measured
      (this is the task that should move it). Commit.

## Task 5: the include list from declared dependencies

**Files:** `webgpu/march/helpers.ts`, new `webgpu/march/helpers.test.ts`

- [ ] **Step 1:** Give each WGSL string module a declared dependency list
      (`{ src, needs: ['SMIN', 'NOISE3'] }`), derived from what its text calls.
- [ ] **Step 2:** Build `HELPERS` by topological sort instead of by hand, and
      keep the emitted ORDER identical to today's hand-ordered list (assert it in
      the test — this is a refactor, not a reorder).
- [ ] **Step 3:** A test that a missing or misordered dependency fails HERE
      rather than at pipeline creation: drop a helper from the graph in the test
      and assert the builder throws naming it.
- [ ] **Step 4:** Gate: pixel identical, march suite green. Commit.

## Task 6: one program for crowd and body

**Files:** `webgpu/zombie-gpu.ts`, `webgpu/march/body/entry.wgsl.ts`, `webgpu/game-main.ts`

- [ ] **Step 1:** Write down what actually differs between the two programs
      today (instancing, the quad empty-tile gate, proxy-box overrides, the
      bound records) in NOTES.md. Include the pipeline-log evidence.
- [ ] **Step 2:** Collapse them into one WGSL entry with a runtime flag in
      `MarchIn` (`instanced: u32`), so the driver compiles ONE program.
- [ ] **Step 3:** Measure: cold boot (expect ~48 s off), warm boot, and GPU
      frame cost for a crowd scene AND a single-body close-up — the close-up is
      the case this project optimises for, and a uniform branch in the hot loop
      is exactly where it could regress.
- [ ] **Step 4:** Gate: pixel identical in BOTH rooms, crowd gate
      (`scripts/sdf-game-crowd-gate.mjs`) green, cold/warm/frame numbers in
      NOTES.md, full vitest suite compared to the base failure SET. Commit.

## Verification summary

| Gate | Command | Pass condition |
| --- | --- | --- |
| Types | `npx tsc --noEmit -p .` | clean |
| Unit | `npm test -- march` | march suite green; full suite = base's 15 failures |
| Pixel | `node scripts/march-hash.mjs` (inside lab-servers, alone) | room1/room2 as above |
| Golden | `npm test -- march-golden` | updated deliberately, per commit |
| Cold boot | `scripts/compile-census.mjs` (invalidated cache) | reported every task; task 4 and 6 must improve it |
| Crowd | `scripts/sdf-game-crowd-gate.mjs` | green after task 6 |
