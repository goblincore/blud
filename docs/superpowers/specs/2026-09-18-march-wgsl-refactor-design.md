# march.wgsl.ts refactor — design (2026-09-18)

## Problem

`src/lab/sdf-zombie/webgpu/march.wgsl.ts` is 4,800 lines / 277 KB of WGSL in
TypeScript template strings, imported by ~27 files, with a 2,771-line string-
assertion test (`march.wgsl.test.ts`, 487 assertions). Every burning/gore/melt
feature edits it, so parallel tasks conflict in it and its fragile spots keep
biting:

- **`marchBody` is one ~2,100-line WGSL function**, assembled from string
  pieces (`MARCH_BODY_PARAMS` + `MARCH_TRACE_SETUP` + `MARCH_TRACE_LOOP` +
  `FACE_LAYER_WGSL` + `MARCH_TRACE_POST` + `MARCH_BODY_SURFACE_PREP` +
  `MARCH_BODY_LIGHT`).
- **~100 positional parameters** (`MARCH_BODY_PARAMS`); a `:` inside a comment
  there breaks three's `wgslFn` parser.
- **`HELPERS` is a hand-ordered include list** ("order is load-bearing"); an
  omitted helper passes unit tests and fails at pipeline creation.
- **`refineBody` re-assembles the same setup/post/surface/light pieces** — a
  second full copy for the compiler.

## Decision (owner, 2026-09-18)

Two phases. **Phase 1 now:** a mechanical, bit-identical file split. **Phase 2
after data:** restructure the shader itself, scoped by the compile-time
measurements (the separate compile-time investigation that follows the 104 s
boot regression fix).

## Phase 1 — split the file, change no shader text

- New folder `src/lab/sdf-zombie/webgpu/march/`. Every export keeps its **exact
  name and exact string value**; `march.wgsl.ts` becomes a barrel that
  re-exports everything, so the ~27 importers and the existing tests do not
  change.
- Target layout (one responsibility per module):

| Module | Contents (current exports) |
|---|---|
| `march/layout.ts` | `DATA_ROWS`, all `ROW_*`, `MAX_GROUPS`, `RAY_CULL_SLACK`, `QUAD_ENTRY_SLACK`, `WOUND_STEP_MUL`, `soldierFaceDamageShadow` — pure TS, no WGSL |
| `march/math.wgsl.ts` | `HASH13`, `NOISE3`, `FBM`, `NOISE_LOCAL`, `Q_ROT`, `Q_MUL`, `Q_FROM_TO` |
| `march/primitives.wgsl.ts` | `SMIN`, `SMIN_CHAMFER`, `SMAX`, `SD_GROOVE`, `CONE_CAP`, `SD_BEZIER_T`, `CONE_BEND`, `STRAND_*`, `CONE_STRAND`, `SD_ROUND_BOX`, `SD_PRIM`, `SD_PRIM_ORIENTED`, `SD_SHELL`, `DETAIL_FIELD` |
| `march/fields/*.wgsl.ts` | `carves` (`REST_POINT`, `APPLY_CARVES`), `wounds` (`APPLY_WOUNDS`, `WOUND_MASK`, `WOUND_SHADOW`), `tissue` (`TISSUE_RAMP`, `CHAR_MASK`), `volume` (`SAMPLE_VOLUME`), `groups` (`FOLD_GROUP`, `INSTANCE_STATE`), `bones` (`FOLD_BONE_RANGE`, `APPLY_BONES`) |
| `march/map-body.wgsl.ts` | `MAP_BODY`, `CALC_NORMAL` |
| `march/cone-march.wgsl.ts` | `CONE_MARCH`, `DEPTH_PREPASS_MARCH`, `DEPTH_PRE_FETCH`, `QUAD_TILE_EMPTY_WGSL` |
| `march/shade-helpers.wgsl.ts` | `TEXEL`, `SOFT_SHOULDER`, `FLICKER`, `LEVEL_SHADOW` |
| `march/melt.ts` | face-melt / melt-skin constants, `HEAD_EXTERIOR_GORE_KEEP` re-export |
| `march/body/params.wgsl.ts` | `MARCH_BODY_PARAMS` |
| `march/body/trace.wgsl.ts` | `MARCH_TRACE_SETUP`, `MARCH_TRACE_LOOP`, `MARCH_TRACE_POST`, `MARCH_BODY_TRACE` |
| `march/body/face.wgsl.ts` | `FACE_LAYER_WGSL` |
| `march/body/surface.wgsl.ts` | `MARCH_BODY_SURFACE_PREP`, `MARCH_NORMAL_OUT`, `MARCH_ANCHOR_READ`, `MARCH_BURN_OUT` |
| `march/body/light.wgsl.ts` | `MARCH_BODY_LIGHT` |
| `march/body/entry.wgsl.ts` | `MARCH_BODY`, `REFINE_LOOP`, `REFINE_PARAMS`, `REFINE_BODY` |
| `march/helpers.ts` | `HELPERS` (same order) |

- **Feature blocks out of the giant strings.** Inside `MARCH_TRACE_POST`,
  `MARCH_BODY_SURFACE_PREP` and `MARCH_BODY_LIGHT`, self-contained feature
  blocks (burn, gore/rupture, melt, face damage, wound tint — whatever the code
  actually has) move to `march/body/blocks/<feature>.wgsl.ts` and are spliced
  back with `${…}` interpolation. The joined strings stay byte-identical.
  This is the part that stops parallel feature tasks colliding.
- **Tests follow the modules:** `march.wgsl.test.ts` splits into test files next
  to the modules they assert on; assertions are moved, not rewritten.

### Gates (all must hold at every commit)

1. **String golden:** a new `march/march-golden.test.ts` snapshots the sha1 of
   every string export of `march.wgsl.ts` plus the joined `HELPERS`,
   `MARCH_BODY` and `REFINE_BODY`. It is written and committed **before** any
   move, and must not change.
2. **Pixel gate:** `scripts/march-hash.mjs` (exact float readback of the march
   target) identical before/after, both rooms, wounded variant included.
3. `npx tsc --noEmit`, the march tests, and every importer's tests green.
4. Cold-boot `drawOnce` reported vs the base (shader text is identical, so it
   must be within noise).

## Phase 2 — restructure the shader (sketch; planned after the compile data)

- Split `marchBody` into real WGSL functions — `trace() -> Hit`,
  `surface(Hit) -> Surface`, `light(Surface) -> vec4` — passing small structs.
- Replace the ~100 positional parameters with named uniform structs.
- `refineBody` calls the same functions instead of re-joining the text.
- Build the helper include list from declared dependencies; a missing or
  misordered helper fails a unit test, not pipeline creation.
- Gates: `march-hash` identical (or an explained, owner-approved diff), cold
  boot time and GPU frame cost reported against phase 1.
- Also the natural point to make the WGSL port-ready for the Rust + wgpu
  release (production scope §4.6): plain WGSL with explicit bindings, no
  three.js `wgslFn` parsing constraints.

## Not in scope

Behaviour or look changes, performance work beyond measuring, the other
`*.wgsl.ts` modules.
