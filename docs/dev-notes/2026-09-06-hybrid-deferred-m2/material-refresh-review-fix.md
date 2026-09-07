# Material refresh review fix — deferred adapters follow live source tuning

**Date:** 2026-09-06 · **Branch:** `codex/dispatch/2026-09-06-hybrid-deferred-m2-material-refresh`
**Scope:** review correction between task 4 (shadow maps) and task 5 (game integration). Game
integration only; no shader/light-model changes; task-4 work preserved untouched.

## The verified defect

At the reviewed task-3 commit (`ba815c51`), `game-deferred-scene.ts` `adapterFor()` cached
`createDeferredMeshMaterial(source, receiver)` **forever** (one adapter per
`(source material, receiver)` pair, built once, never re-examined). The adapter constructor
copies the source Standard material's surface state exactly once — color, map, normalMap,
normalScale, roughness, roughnessMap, metalness, metalnessMap, emissive, emissiveMap,
emissiveIntensity, alphaTest, side, vertexColors.

Meanwhile `game-main.ts` `__sdfGame.setGunTuning()` (lines ~4053–4066) mutates the **source**
materials live — gun roughness/metalness/envMapIntensity, hand `normalScale.setScalar()` and
roughness — then sets `source.needsUpdate = true`. After the first deferred draw, none of that
reached the cached adapter: the owner's tuning moved the forward-blended (pre-deferred) look
only if it rendered forward, and did nothing in the G-buffer the deferred light pass actually
shades from. Both sides were confirmed by reading the code before anything was written.

## The fix (commits `e9dfacfc`, `34fbfd53`)

**Source-version invalidation with in-place refresh.** The cache entry became
`{ adapter, sourceVersion }`:

- On cache hit, `adapterFor` compares `src.version` against the version observed when the
  surface state was copied. Divergence ⇒ `copyDeferredMeshSurfaceState(src, adapter)` re-copies
  the state onto the **same adapter object**, then `adapter.needsUpdate = true`, then records
  the new version.
- `copyDeferredMeshSurfaceState` was extracted in `deferred-mesh.ts` from the factory's own
  copy block, so construction and refresh share one source of truth for what is copied. It
  copies ONLY the surface list above — deliberately not envMap (unlit G-buffer rule), not the
  structural contract (fog/transparent/blending/depth/lights, forced at construction), not
  `mrtNode`/`surfaceKind` (receiver metadata frozen per (source, receiver) pair).
- **No rebuild, no replacement, no new disposal paths.** The adapter identity is stable, so
  each adapter still disposes exactly once, with the router (`dispose()` loop unchanged apart
  from the entry unwrap). Source materials/textures were never disposed and still are not.
  A throw inside `copyDeferredMeshSurfaceState` leaves the old adapter cached at its old
  version (retry next draw) and the draw's `finally` still restores every flipped
  visibility/material field — the existing exception-safe restoration is untouched.

Why `src.version` is the right signal: three 0.185's `Material.needsUpdate` is a **setter only**
— `set needsUpdate(v) { if (v === true) this.version++; }` (verified in the installed
`three/src/materials/Material.js`, no getter). Plain scalar fields (`roughness`, `normalScale`)
do NOT bump version; the game's flow always follows mutations with `needsUpdate = true`, so the
version counter moves exactly when the game retunes. Texture-reference assignment (`mat.map =
x`) is also a plain field in 0.185 — the refresh's `adapter.needsUpdate = true` is what makes
the renderer re-read the graph when a map was rebound (three's own machinery keys caches on
`material.version`, e.g. `Renderer._getShadowNodes`). Unchanged draws compare two integers and
reuse the cache with zero copying and zero version churn.

`needsUpdate`'s GETTER is not trusted anywhere (per the review instruction): we never read
`source.needsUpdate`; the version counter is the only signal consulted.

## Tests

**CPU regression (red first), `game-deferred-scene.test.ts` — "live source-material refresh
(review fix)"** — 3 new tests, 27/27 in the file:

1. *setGunTuning flow:* draw → mutate source roughness/metalness/normalScale + rebind `map` +
   `needsUpdate = true` → draw again. Asserts the material **actually submitted to the mock
   renderer** is the SAME cached adapter object (no rebuild), carrying every new value, and
   that the original material reference is restored; a third unchanged draw keeps the identity
   and values. Fails against the old code (stale 0.9 roughness observed).
2. *per-receiver:* one source registered 'full' AND 'level-only' → both adapters refresh
   independently, `surfaceKind` metadata frozen on both.
3. *disposal:* after a refresh, router `dispose()` disposes the adapter exactly once and never
   the source.

Full `src/lab/sdf-zombie/webgpu` suite: **1380/1381 green, 0 failed** (1380 tests, 71 files).
`npx tsc --noEmit` clean. Functional fix committed **before** extended checks.

**GPU (on device), `scripts/deferred-scene-check.sh` on private ports 5332/9332 — 10/10 PASS.**
All 9 pre-existing checks unchanged (compile/routing unaffected). Added check
`live-source-tuning-reaches-adapter`, end-to-end on the real WebGPU device:

- `tuneFloorMaterial({ roughness: 0.2, metalness: 0.85 })` — the setGunTuning flow (scalars,
  then `needsUpdate = true`) on the floor's SOURCE Standard material, after the first draws;
- `readFloorSurface()` reads the **raw surface channels** — `albedoRoughness.w` and
  `normalMetalness.w`, by attachment NAME via the typed readback helper, from the resolved
  target (the resolve pass copies producer data through; the light pass writes elsewhere) —
  at the same projected floor pixel, before and after;
- measured: roughness **0.6519 → 0.1372** (ratio 0.211 == the expected 0.2/0.95 — the floor's
  authored 0.95 multiplies a roughnessMap texel, so the ratio, not a delta, is asserted) and
  metalness **0 → 0.8496** (metalness has no map: pure scalar). Before the fix these stayed
  frozen at the first-draw values. Evidence JSON:
  `docs/dev-notes/2026-09-06-hybrid-deferred-m2/task3-scene-check.json`
  (check name `live-source-tuning-reaches-adapter`).

Readback trap worth recording: both surface vec4 attachments are `<vec3 term, scalar>` — the
scalar is the **fourth** channel (+3 read index). Index 2 of `normalMetalness` is the normal
map-perturbed z (read 0.0587 on the first run and tripped the baseline assertion); this is the
exact misread the readback helper's header comment warns about, now also noted at
`readFloorSurface`.

The check runs AFTER the PNG capture and restores the authored finish (0.95 / 0.0) afterwards,
so `task3-scene.png` stays the canonical untuned layout. Verified by pixel-diffing the
regenerated capture against the pre-branch one: 63 of 3,072,000 channel samples differ, all
±1 (one ±113 half-cycle) on ~21 SDF-body silhouette/AA edge pixels — render nondeterminism.
The floor region shows zero deltas; a real roughness retint would shift the lit floor
broadly.

## Remaining limits

- **Version-only invalidation.** A source mutated WITHOUT `needsUpdate = true` (or any other
  version bump) is not observed — scalars are plain fields in three 0.185. The game never does
  this (`setGunTuning` always bumps), and the sanctioned design is version invalidation, but a
  future caller that mutates sources bare will silently miss the G-buffer. If that ever
  matters, per-draw state hashing is the escalation, not a needsUpdate read.
- **Texture CONTENT changes are shared-object writes** (maps are held by reference); they flow
  through automatically and need nothing here. Texture REFERENCE swaps are covered only when
  accompanied by a version bump (as the game does).
- Fields outside the copy list (`envMap`, `envMapIntensity`, `fog`, opacity) remain deliberately
  excluded from the raw surface output; envMap stays out of the G-buffer by design.
- The refresh bumps the adapter's version, so the next frame after a tuning change re-runs the
  node-graph setup (pipeline cache absorbs it). Frequency is user-tuning-events, not frames.
- **Task 5 must still verify live tuning in the actual game** (`__sdfGame.setGunTuning` against
  the gun/hand view-model materials) — this gate proves the router mechanics on the scene
  fixture, not the game's own material wiring.
