# Early-Z for the SDF march (conservative depth), stage 1 — Design

**Date:** 2026-10-01 · **Status:** APPROVED by the owner 2026-10-01 (spike "early-Z + hull"; scope "stage 1 now,
stage 2 later, gated"; decisions D1–D8 as written; both §10 owner questions answered yes).
**Context:** the Dreams research (Obsidian `Claude Notes/Research/2026-10-01-dreams-sdf-techniques-vs-blud.md`), the
post-hit noise split ([dev note](../../dev-notes/2026-10-01-posthit-noise-split/NOTES.md)) and the early-Z probe
([dev note](../../dev-notes/2026-10-01-earlyz-probe/NOTES.md)).

## 1. Why

- **Every march fragment writes plain `@builtin(frag_depth)`**, from a back-face proxy box (`zombie-gpu.ts:1552`,
  `:1608`), so the GPU cannot reject it before the shader runs. A body hidden behind another body, or behind a wall it
  is only partly behind, pays the full walk and shading. Bodies that are fully hidden are already culled on the CPU by
  line of sight (`actor-sight.ts:29-49`); partly hidden ones are not. The march target holds no level depth at all.
- **Conservative depth works on the owner's Chrome 154 / Metal**, although Chrome does not advertise it. In the probe,
  16 hidden full-screen layers of an expensive shader cost **116 ms with plain `frag_depth` and 0.057 ms with
  `@builtin(frag_depth, greater)`**, also with `discard`.
- **The walk is where march time goes**: 6.0 ms clean and 14.1 ms with 5 wounds on one close body. Post-hit work is
  1.7 / 3.7 ms, and procedural noise is ~0. Early-Z removes both the walk and the shading of hidden fragments, so it
  is the lever that matches the cost.
- The parked hull renderer (2026-09-02) never claimed early-Z ("the spec's crowd win needs early-Z, which phase 0
  deliberately does not claim"). This spec claims it for the shipped box proxies first. The hull comes back only if
  this pays (§9).

## 2. Goal and non-goals

**Goal:** behind a default-off flag, crowd-type march draws keep hardware early-Z:
- body behind body is rejected before marching;
- body behind level geometry (doorways, carriage walls, props) is rejected before marching;
- the image is unchanged, except a possible upscaler fringe at level-occlusion edges (§7, look check);
- the frame cost is measured on real scenes.

**Non-goals (stage 1):**
- The per-body path (`?crowd=0`), gib/chunk views, refine/cone twins and the far pass. They keep today's materials.
- A tighter proxy than the box: that is stage 2 (§9).
- Native field mode (`?upscale=0`, an 800×300 target with row parity). The seed pass is disabled there (§3 D6), so
  it gets body-vs-body early-Z only.
- Shipping. Default stays off until the owner has looked and the bench says it pays.

## 3. Decisions (recommended, pending owner approval)

1. **One compile-time flag, `?earlyz=1`**, read once at module load, in the `limbs-flag.ts` / `?skinCavity` pattern.
   With the flag off the emitted WGSL is byte-identical, so `march-golden.test.ts` and `march-hash.mjs` cannot move.
   All new WGSL is emitted only under the flag.
2. **Front faces + `greater`** for the crowd-type march material when the flag is on. `greater` promises the written
   depth is at or beyond the raster depth: true for a ray marched forward from the proxy's front face, false for a
   back face.
3. **The contract is enforced in the shader:** written depth = `max(hitDepth, fragmentRasterDepth)`. Rounding at the
   entry face (a surface touching the box face) can then never write a nearer depth than promised. Breaking the
   promise is undefined behaviour, so this clamp is not optional.
4. **Analytic box exit.** Today `tMaxBox = length(worldPos - camPos)` reads the BACK-face position as the exit
   (`ray-window.wgsl.ts:7`). Under the flag, `tMaxBox` comes from the same slab test as `boxEntry`
   (`ray-window.wgsl.ts:32-42`), taking the far root. The far-pass early-out (`trace.wgsl.ts:50-55`) also assumes back
   faces. The far pass is out of scope and stays on the shipped path.
5. **Camera-inside fallback = the shipped material.** An instance whose box, inflated by `NEAR_GUARD` (0.25 m, against
   the 0.1 m near plane), contains the camera goes in a second instanced draw that uses today's back-face, plain-depth
   material. That draw is unchanged and already compiled. So each crowd type draws two batches, front (`greater`) and
   back (shipped), split on the CPU in `sync()`, which already sorts instances nearest-first (`crowd-type.ts:401-418`).
   Melee range is where the back batch fires.
6. **Seed the march depth with the level depth** (upscaler boot only).
   - A full-screen depth-only pass runs first in the march target: no colour write, depth compare `always`, depth
     write on.
   - It writes the **farthest** level depth of the 2×2 output pixels each march texel covers. That is conservative: a
     texel is pre-occluded only when all four output pixels are covered by level geometry nearer than the body.
   - The source is post-aa's `sceneTarget.depthTexture` (full res, Depth24Plus, already sampled by `post-sscs.ts:92`).
   - Disabled when FXAA is off (the canvas depth is not sampleable) and in field mode.
   - The composite's per-pixel depth test against the level stays as it is.
   - Verify in the plan's first task how three 0.186 maps `depthTest`/`depthFunc` for this quad: it must come out
     as compare `always` with depth writes ON. If `depthTest: false` also drops writes, use `depthFunc = AlwaysDepth`.
7. **Draw order:** near-to-far across crowd types. *(Amended by the plan, 2026-10-01: the BACK batches draw first,
   right after the seed, then the front batches near-to-far. The back batch holds the camera-inside bodies, which are
   the nearest and therefore the best occluders: their plain-`frag_depth` depth lands in the buffer before any
   front-face fragment is tested. Drawing them last, as first written, would waste them.)* Every crowd mesh sits at the world origin, so three's z sort ties
   them (`Renderer.js:3298-3305`). Under the flag, each type's `renderOrder` is set per frame from its nearest
   instance; back batches draw before front batches (amendment above). The seed pass draws before everything (lowest `renderOrder`).
8. **Feature detection by compiling, not by `wgslLanguageFeatures`.** At boot, compile a one-line shader with exactly
   the syntax we emit, inside a validation error scope. If it fails, the flag turns itself off with one console
   warning and the boot is the shipped boot. No `requires fragment_depth;` is emitted: Chrome 154 accepts the
   qualifier without it, and three's fragment template has no directive slot (`WGSLNodeBuilder.js:2636-2662`). If a
   later Chrome starts enforcing `requires`, the detection fails and the boot falls back.

## 4. Approaches considered

- **A. Per-material opt-in patch of three's WGSL builder (recommended).** Wrap `WGSLNodeBuilder.prototype.getFragDepth`
  (exported from `three/webgpu`; 0.186 line 1648). When `this.material.conservativeDepth === 'greater'`, register the
  builtin as `'frag_depth, greater'`; `getBuiltins` prints the name verbatim, giving `@builtin( frag_depth, greater )`.
  The flag is a real own property, so it enters the render-object cache key (`RenderObject.js:743-751`; `userData` does
  not). About 30 lines in one module, with a version guard that refuses to patch anything except three 0.186.x.
  Precedent for runtime wrapping: `pipeline-log.ts:607-609`, `:754-756`.
- **B. A hand-written WebGPU pipeline for the march.** Full control, but it means re-plumbing every binding three
  manages today (14 sampled textures, 5 storage buffers, the MRT, warm-up precompile). Weeks of work for the same
  one-attribute change. It belongs to the Rust + wgpu port, where the attribute is native.
- **C. No new feature: an in-shader level-depth clamp.** Bind a downsampled level depth and cut `tMax` at the wall. It
  catches body-behind-wall only, never body-behind-body. It costs a sampled-texture slot, and per-body views already
  use 14 of 16. Its benefit is subsumed by A + D6, which seeds the depth buffer instead and needs no texture slot in
  the march.

## 5. Architecture

Pure, renderer-free modules (Vitest):
- `earlyz/batch-split.ts`: `splitInstances(boxes, cameraPos, nearGuard) → { front: ids[], back: ids[] }`. A box is
  centre + half-extents; it goes in `back` if the inflated box contains the camera. Order is preserved, so the sorted
  nearest-first list stays sorted.
- `earlyz/type-order.ts`: `typeRenderOrder(types: { key, nearestBack, nearestFront }[]) → Map<key, { back, front }>`,
  each batch kind ranked near-to-far, with the seed first, then back batches, then front batches (D7 amended).

Renderer-facing:
- `earlyz/flag.ts`: `EARLYZ_FLAG` read once from `location.search`; false under Vitest.
- `earlyz/conservative-depth-patch.ts`: the §4 A wrapper, plus `detectConservativeDepth(device): Promise<boolean>` (D8).
- `crowd-type.ts`: under the flag, a second instanced mesh per type with the front-face `greater` material; `sync()`
  calls `splitInstances` and packs two instance lists.
- WGSL, under the flag only:
  - analytic exit in `ray-window.wgsl.ts` (D4);
  - the depth clamp in the material's depth expression (D3);
  - a seed shader `earlyz/seed-depth.wgsl.ts` (D6: `textureLoad` of 4 level-depth texels, `max`, written as depth).
- `sdf-layer.ts`: the seed quad on `SDF_LAYER` with the lowest `renderOrder`, enabled only under the flag, in the
  upscaler boot, with FXAA on.
- Warm-up: `precompilePasses` must compile the front material and the seed pass under the flag, or the first frame
  stalls (the 2026-09-18 freeze class).
- Seams: `__sdfGame.earlyzInfo() → { flag, detected, seed: on/off + reason, batches: { type: { front, back } } }`.

## 6. Data flow and error handling

Each frame, under the flag:
1. Crowd `sync()` sorts instances, then `splitInstances`, then packs the front and back lists.
2. `typeRenderOrder` sets each mesh's `renderOrder`.
3. The march target clears, then the seed pass writes level depth.
4. Back batches draw (shipped path; the nearest bodies, so they occlude everything after them).
5. Front batches draw near-to-far, rejected by early-Z where something nearer is already in the depth buffer.
6. Composite as today.

Fallbacks, each reported once in `earlyzInfo()` and the console:
- detection fails → flag off for the boot;
- FXAA off → no seed;
- field mode → no seed;
- a crowd type with zero front instances → front mesh `instanceCount = 0`.

A body never disappears. The worst case is that it pays today's cost (back batch, no seed).

## 7. Testing and measurement

**Unit (Vitest):**
- `splitInstances`: inside, outside, on the guard boundary, order preserved.
- `typeRenderOrder`: ties, empty types.
- WGSL text: flag off is byte-identical to today (the golden test already pins this); flag on contains
  `frag_depth, greater` exactly once per front material and the `max(` clamp.

**Gates that must not move:** `march-golden.test.ts` and `march-hash.mjs` at flag off. Re-run both.

**Parity, flag on vs off, frozen frame** (new `scripts/earlyz-parity.mjs`):
- Composited output, per-pixel diff, room 1 and a crowd grid.
- Expected: zero diff away from level-occlusion edges.
- At those edges the upscaler now sees "miss" texels where it used to see hidden flesh, so a 1–2 px fringe may
  appear. Report its pixel count and max diff, and put both in the look sheet.

**Look sheet for the owner** (side-by-side, flag off / on, per the owner's step-by-step rule):
- a doorway with a body half behind the frame;
- an overlapping pack of 6;
- a melee-range body (back batch);
- a far crowd.

**Cost** (`scripts/sdf-game-bench.mjs`): add an `earlyz` leg. Extend `legUrl()` (`:383-386`) to carry a per-leg query,
since the flag is compile-time and the bench reloads per run. Scenes:
- the two room-1 recordings (`BENCH_DEMO`, equal workload);
- `BENCH_CROWD=8/16/24` grids (body-vs-body);
- `BENCH_SCENE=distance`;
- a Night Train doorway scene. No bench leg exists for it; add one by staging the camera in a carriage doorway with
  bodies beyond, reusing the train gate's boot (`sdf-game-train-gate.mjs:149`).

Fenced frame p50 and `sdf:march`, alternating legs, `uptime` recorded, rejected if load > 4.

## 8. Success criteria and the stage-2 gate

**Stage 1 is worth keeping when:**
- parity holds (only the edge fringe), and the owner passes the look sheet;
- `sdf:march` drops by at least 1 ms p50 on at least one ordinary scene (a room recording or the doorway), with no
  regression above noise on the others;
- the back batch shows no hitch at melee range;
- the cold-compile increase is recorded (one more march pipeline under the flag).

**Gate for stage 2:** open the hull spec only if stage 1 holds AND the bench shows the remaining cost is in empty-box
pixels or the fixed `sdf:shell-hull` pass (~3.7 ms). The occupancy reader must be fixed first: it reads before the
discard (PASSOFF-2 §2.1), so today it cannot price empty-box pixels.

## 9. Stage 2 outline (not designed; gated by §8)

Replace the box with a hull that needs no per-frame extraction:
- **Build once:** a conservative hull per character type, extracted from the rest pose and inflated by blend k plus a
  band. Alternatively, rigid inflated pieces per bone, which stay a valid outer bound by the smooth-min coverage
  argument already proved for the shell renderer (2026-09-03 notes, item 3).
- **Re-extract only on wound change.** Carves only remove material, so the old hull stays a bound; torn lips and rim
  bumps need the inflation margin.
- **Same depth contract:** front faces + `greater` + the D3 clamp + D5 fallback.
- Candidate to replace the sphere shell pass's entry/exit textures.
- **Open:** joints under extreme bends; the walk length inside an inflated hull; a mesh's camera-inside test.

## 10. Risks and open questions

1. **Unadvertised feature.** Chrome 154 accepts `frag_depth, greater` but does not list `fragment_depth`; the gpuweb
   proposal is Draft. D8 handles a future change, but this ships only behind a flag until Chrome advertises it.
   **Owner 2026-10-01: yes, acceptable behind the default-off flag.**
2. **Upscaler fringe** at level-occlusion edges (§7). If visible, an alternative is to seed only from texels whose
   4 pixels are well inside the level geometry (erode the seed by one texel).
3. **Two batches per crowd type** double the instanced draws: ~6 types → 12 draws, CPU-light. A new material variant
   per type adds cold-compile time under the flag.
4. **Where does the win show?** Fully hidden bodies are already CPU-culled. The win is partly hidden bodies and crowd
   overlap. If ordinary rooms hold neither, stage 1 may measure as a wash outside crowd grids. The doorway scene and
   the recordings decide.
5. **Per-body path** (`?crowd=0`, refine boots) stays on today's materials. **Owner 2026-10-01: yes, out of scope.**
