# Offline gib assets — Task 2 handoff: moving mesh gibs

Branch `codex/offline-gib-assets-task-2`, baseline `30e66c84`, parent
`a08c8f43` (Task 1). Isolated dispatch worktree; **no merge, no push, primary
checkout untouched**. CPU-only: no browser, no WebGPU, no GPU run, no playtest
(Task 3 owns the visual gate and the GPU run).

This file is Task 2's handoff. Task 3 writes `REPORT.md`; Task 1's report is in
this directory as `REPORT.md` at `a08c8f43` (it is git history now).

## What this delivers

The committed offline sets now load into the running game as **reusable,
deformable meshes** on an opt-in render mode, with explicit fallback, pooling and
counters. The shipped default is unchanged (`?gibrender=` unset → `march`), as
the plan requires until the visual gate.

**Default vs eligibility, stated plainly.** The eligibility code path is the
ORDINARY default build — the default `parts` split of an undamaged archetype
body, per piece, not a curated demo seam. What is *not* yet done is flipping the
URL default to it: the plan explicitly says "keep ... current default safe until
visual gate", so `march` remains the default and Task 3 flips it only if the
zombie and soldier visual gates pass. This is therefore a complete eligibility
path with a deliberately unflipped default, not a partial implementation.

| File | Role |
| --- | --- |
| `webgpu/gib-asset-loader.ts` | Manifest → archetype doc → bin; decode + numeric validate; typed `GibAssetLoadError` reasons; generation-guarded cancellation; no three, no extraction. |
| `webgpu/gib-asset-deform.ts` | Pure CPU deform: rest bind frames → posed/slough frames, normals recomputed area-weighted; row-aligned (immediate) and source-indexed (rupture) frame builders. |
| `webgpu/gib-asset-runtime.ts` | Per-archetype shared library (immutable rest geometry + one material), per-part `GibAssetInstancePool`, `GibAssetRuntime` load/cache/counters, `gibAssetEligible`. |
| `webgpu/gib-asset-runtime.test.ts` | 13 tests: loader fallback reasons, deform identity/rigid/posed, shared-asset immutability, eligibility, pool reuse, runtime counters. |
| `webgpu/gib-asset-integration.test.ts` | 5 CPU end-to-end tests: pose tracking exact, slough moves the mesh, settle/recycle via the sprite-piece lifecycle, head face frame, low-budget split policy, damaged-piece eligibility. |
| `webgpu/gib-sprite-pieces.ts` | One additive hook: `SpritePiece.onDetach`, called from the single `detach` point, so an asset piece returns its pooled buffers when evicted/cleared. |
| `webgpu/game-main.ts` | `?gibrender=assets`, boot preload, per-piece asset spawn + fallback, rupture frame plumbing, counters, `__sdfGame` seams. |

No `.gitignore`, asset, or primary-checkout change. **No extracted Blood pixels
were read, baked or committed**; the head face texture stays an external
reference (see limitations).

## Exact usage

```bash
# Opt-in renderer (default remains `march`)
open '/sdf-game.html?gibrender=assets'          # arm at boot, then throw dynamite

# Paired rig seams (all live, no reload):
__sdfGame.setGibRenderMode('assets')            # awaits the load; returns ready
__sdfGame.gibRenderMode()                       # mode/ready/assets{armed,zombie,soldier}
__sdfGame.gibAssetStats()                       # hits, fallbacks by reason, load bytes, live meshes
__sdfGame.gibAssetLibrary()                    # per-archetype state/fingerprint/bytes
__sdfGame.preloadGibAssets()                    # arm without switching mode
__sdfGame.resetGibAssets()                      # cancel in-flight loads, drop caches + pieces
__sdfGame.chunkStats().gibAssets                # same census inside the chunk stats
```

Relevant existing knobs still apply: `?gib=parts|clusters|pieces`,
`?gibbones=all|core|off`, `?gibtear`, `?tearslough`, `?giblaunch`,
`?gibstagger`, `?gibspritelive`, `?gibspriterest`.

## How it is wired

1. **Load once per archetype.** Boot (`?gibrender=assets`) or
   `setGibRenderMode('assets')` fetches `public/assets/lab/gibs/manifest.json`
   and, per archetype, the `.gib.json`/`.gib.bin`, decodes every piece and runs
   the Task-1 validator. One shared material is created on first successful
   load. Until an archetype resolves, a body falls back to marched pieces
   (counted) — never to no gore.
2. **Route the ordinary default plan.** `gibActor` resolves `assetMode` once per
   body. For each piece of the ordinary `parts` plan (and `gibTierPlan`'s
   low-budget shapes) it looks the part up by name, checks eligibility, takes a
   per-instance geometry from the pool, deforms it, and spawns it through the
   **existing** sprite-piece lifecycle (`makeChunk` + `stepChunk` + settle/park
   + caps). Physics, pooling, delayed release, partial dismemberment, bone-only
   pieces and the deferred opt-in are all the shipped code paths.
3. **Deform to what was drawn.** Rupture hand-off (`?gibtear>0`): the asset's
   sealed rest bind frames are mapped through `frame.deformedPrims`/
   `deformedBones` by source index, and the mesh is placed at the chunk pivot
   with the region quaternion. Immediate gib (`?gibtear=0`): the piece's own
   already-sealed posed prims are the row-aligned frames. This is a
   deformation hand-off, not a crossfade.
4. **Explicit, testable eligibility.** `gibAssetEligible` requires the runtime
   piece's `srcPrims`/`srcBones` to equal the asset's recorded source sets. A
   severed/damaged piece has a different set and falls back per piece; the rest
   of the body still uses assets.
5. **Fallback reasons are counted**, not silent: `no-library`, `no-asset`,
   `source-mismatch`, `no-pool`, plus the loader reasons `no-manifest`,
   `no-entry`, `schema`, `stale`, `malformed`, `aborted`, `fetch-failed`.

## Verification (CPU only — no GPU claim)

- `npx tsc --noEmit` — clean.
- `npm run build` (tsc + vite) — clean, built in 3.26 s.
- Focused gib suites — 133 tests pass:
  `gib-asset-runtime`, `gib-asset-integration`, `gib-asset`, `gib-library`,
  `gib-carve`, `gib-parts`, `gib-chunks`, `gib-sprite-pieces`.
- Full `vitest run` — **340 files, 5338 tests, all passing** (127 s), run at the
  commit this handoff describes.
- Deform measurements (CPU):
  - Pose tracking on the immediate path is **exact** (a rigid translation of the
    piece translates every mesh vertex by the same vector to 1e-4).
  - Rest identity is **exact** for the asset's own bind frames.
  - Under the full-strength slough, `torso.chest`'s mesh skin sits a mean
    **~2.1 cm** from the drawn whole-body field (max ~10.3 cm), and the piece
    moves ~26 cm off its rest placement. This residual is the Task-1
    binding/seal approximation (the asset geometry was baked from the planner's
    **sealed** cut prims, while the rupture draws the **unsealed** posed body);
    it is a measured limit, not asserted to be zero.

## Honest limitations / known gaps (for Task 3)

- **Head face projection is NOT wired.** The head piece loads with its face
  frame (`axes`, `centre`) and is rendered with the shared gore material, but
  the per-fragment face texture projection needs the face uniforms to be carried
  into the piece's world transform. Task 3's "no faceless heads" gate must add
  that; the data (frame + external texture) is present.
- **Cut faces may read dry.** Task 1 baked `bakeColor.a` (wound mask) from a
  rest pose with `torn: []`, so the cut-aware mask the carve path derives
  (`cutAwareField` in `gib-carve.ts`) is **not** in the committed set. The
  detail layer's per-pixel blood is on, but the vertex wetness on a cut face is
  0. Regenerating the set with the cut-aware mask (or a Task-2/Task-3 runtime
  variant) is the fix; the committed bins were deliberately not regenerated in
  this task to avoid silently invalidating Task 1's fingerprint contract.
- **No GPU, no visual gate, no benchmark.** Loader/parse cost, memory tradeoff,
  first/repeated explosion cost and p95 frame cost are Task 3's to measure.
- **Soldier assets load and are eligible, but only the zombie path has been
  exercised** by the CPU tests, and soldiers are not guaranteed to be present in
  every level.
- **Default is still `march`.** Assets are opt-in until Task 3 passes the
  ordinary zombie/soldier visual gate; nothing here claims they do.
- Size/VRAM: 8.4 MB committed; per-instance deformed geometry is bounded by the
  part set and the existing live/rest caps (128/64 by default), with buffers
  returned to the pool on `onDetach`.

## Later candidates

Other archetypes in `character-registry.ts` can use the same loader/runtime
contract once zombie/soldier pass. No measured rationale yet; deliberately not
expanded.
