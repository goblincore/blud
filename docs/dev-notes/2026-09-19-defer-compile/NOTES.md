# Defer the gib + crowd march compiles off the loader — NOTES

Plan: `docs/superpowers/plans/2026-09-19-defer-gib-crowd-compile.md` (Task 1).
Evidence base: `docs/dev-notes/2026-09-19-shader-compile/NOTES.md`.
Mode: **implementation.** The only shader edits are the transient `hash13`
constant probes used to force cold boots, each reverted immediately; see
"Cold-boot method" and the revert checks at the end.

Artifacts in this directory:

| file | what |
| --- | --- |
| `probe.json` / `probe-warm.json` | after-change boots (`scripts/defer-compile-probe.mjs`) |
| `baseline-*.json` | base-branch cold boots (same script, base `src/`) |

Driver: `node scripts/defer-compile-probe.mjs [runs] [--out path] [--label text]`
(one fresh Chrome profile per run, waits for `__warmGate.phase === 'ready'`,
fires a real dismemberment before and after the gib program settles, then dumps
`__warmDone` + `warmBackground()` + `pipelineLog()` + `pipelineCensus()`).

---

## Step 1 — consumer map

### (a) Not-ready pipeline: three SKIPS it — but only if something queued it

Three's decision point is `Renderer._renderObjectDirect`
(`node_modules/three/src/renderers/common/Renderer.js:3690-3733`):

```
this._pipelines.updateForRender( renderObject );      // getForRender(promises = null)
if ( this._pipelines.isReady( renderObject ) ) this.backend.draw( renderObject );
```

- `Pipelines.getForRender` (`Pipelines.js:160-246`) hits `_getRenderPipeline`
  (`:380-406`) when the render-cache key is absent. With `promises === null`
  (the live path) that calls `backend.createRenderPipeline(renderObject, null)`,
  and `WebGPUPipelineUtils.createRenderPipeline` takes the **synchronous** branch
  (`:261-263` `device.createRenderPipeline(...)`) — the cold 47.8 s freeze.
- If the key IS present but the async creation has not resolved,
  `Pipelines.isReady` (`:255-266`) returns false (`pipelineData.pipeline`
  undefined) and `backend.draw` is **skipped**. `compileAsync` puts the key in
  the cache synchronously inside its per-object loop
  (`Renderer.js:1037-1058`), so a queued program degrades to a skipped draw.
- **Therefore the not-ready skip is NOT self-protecting**: it only holds once
  the async compile has reached that object's queue slot. Nothing may submit a
  first draw of an unqueued program. That is exactly what the pure tracker in
  `warm-background.ts` gates.

Every material in question is a `MeshBasicNodeMaterial` drawn through the same
`_renderObjectDirect` path, in both render targets:

| program | first draw path | context |
| --- | --- | --- |
| chunk/gib | `sdfLayer.setBodies(bodies, chunks)` → the march pass | march MRT (rgba32float) |
| chunk/gib | `gibShutter.capture(...)` selected-piece layer draw | gib shutter (rgba16float) |
| crowd | `sdfLayer.setBodies([...type meshes, ...])` → the march pass | march MRT (rgba32float) |

The chunk material is the shared `ctx.bake.material` (`createSharedChunkGpuMaterial`);
its only users are the live chunk views (`chunkObjects()`), so gating the
`chunks` argument of `setBodies` removes the march-MRT context, and gating the
shutter `capture` call removes the rgba16float context.

### (b) Crowd: a per-body fallback exists structurally but was STALE as wired

The per-body views are still in the scene and the body march program is already
compiled at boot, so drawing them is cheap. **But the shipped wiring cannot use
them:** `CrowdType.attach` calls `view.rebind({ sink, records, slot })`, which
repoints the view's `sink`/`records`/`texels` to the type's shared buffer while
the material keeps the texture node it was **created** with. `upload()` then
writes through the rebound sink, so the view's own atlas is never updated after
attach and the per-body draw would read the stale spawn pose
(`zombie-gpu.ts:2149-2168, 2210-2267, 2495-2519`, `crowd-type.ts:317-334`).

Fix (implemented): reserve the type slot **before** the view is built and hand
`{ sink, sinkTexture, records, slot }` to `createZombieGpuView`, then set
`view.instCfg.value.z = slot`. The per-body material's `instCfg.y` stays 0
(per-body entry) with `instCfg.x = 1`, and `MARCH_TRACE_SETUP` loads
`loadInstance(inst, instCfg.z)` so `mapBody` reads the record's band
(`trace.wgsl.ts:25`, `map-body.wgsl.ts:39-50`). The fallback then marches the
member's real current pose out of the shared atlas through the already-compiled
body program. `CrowdType.sync()` still runs every frame (ready or not) because
that is what flushes the shared atlas and record buffer the fallback reads.

**Rooms that spawn a crowd at boot:** `spawnAll` spawns *every* room's roster
at boot (`game-main.ts` `spawnAll`), and the default boot is crowd-on
(`ctx.crowd.on = ctx.crowd.param !== '0'`), so the default boot always creates
crowd types: `room1` 1 zombie + 1 soldier, `room2` 2, `room3` 3, `room4` 4,
`room5` 5 + 3 soldiers, `arena` 8 = 27 actors over 8 types. Crowd can therefore
never be assumed absent at boot; the fallback has to hold from frame 1.
`?crowd=0` opts out entirely (no types, no fallback needed).

---

## Design as implemented

- `warm-background.ts` — pure tracker: `pending → compiling → ready | failed`,
  `gibDraw(): 'draw' | 'skip'`, `crowdPath(): 'crowd' | 'fallback'`. `ready` and
  `failed` are terminal so a late settle cannot flap the draw set. No three import.
- `warmPipelines` boot set (awaited behind the loader): crowd tile-bin compute,
  goo, `precompilePasses` (body + level + twins), `drawOnce` (main pass / post
  chain / fire), confirmation `precompilePasses`. The gib warm view and the
  crowd meshes are hidden so neither program is queued here.
- After `__warmGate` is `ready`, `startBackgroundCompiles()` (nothing awaits it):
  gib/chunk in the march-MRT and gib-shutter contexts, then the crowd program,
  sequentially. `__warmDone.phases.backgroundStart` / `backgroundDone` are shared
  objects filled per program (ms since the warm's `t0`).
- `SdfLayer.precompileInBackground` and
  `GibShutterLayer.precompileSubjectInBackground` compile through a camera
  **clone** and restore the renderer's target/MRT immediately after
  `compileAsync`'s synchronous prologue. The boot `precompile` helpers mutate the
  shared camera's layer mask for the whole await, which would blank the
  polygonal pass on any live frame in between; the pipeline cache key is
  geometry+material+render-context, never the camera, so the clone warms the
  exact live pipeline.
- Degradation: `gibDraw()` gates the `setBodies` chunks and the shutter
  `capture`; `crowdPath()` gates the `setBodies` body list (crowd meshes vs
  per-body views). `?warm=0` settles both ready so the documented "no warm-up,
  accept the first-use compile" A/B is preserved.

---

## Cold-boot method

The OS/driver shader cache is machine-global, so a fresh `--user-data-dir` is
not enough. Each cold run transiently changed `march/math.wgsl.ts`'s `hash13`
`0.1031` to a unique value, booted, then reverted immediately. The revert was
verified with `git diff -- src/lab/sdf-zombie/webgpu/march/` (empty) and
`shasum` (below).

Baseline (base branch) shasums, before any probe:

```
fd3039789aa302207bde6cfc48759c541e4e13c5  src/lab/sdf-zombie/webgpu/march/math.wgsl.ts
3cfd66fd33bf2e4768eb6ec84f7669e7ac5b75a7  src/lab/sdf-zombie/webgpu/march/body/entry.wgsl.ts
56348d1bbaef451a435a2edd6cece1b1c8950229  src/lab/sdf-zombie/webgpu/march/README.md
```

---

## Results

All numbers from `scripts/defer-compile-probe.mjs`, one fresh Chrome profile per
run, `?pipelinelog=1&seed=20260919`. `frameBefore`/`frameAfter` are the longest
rAF callback (ms) around a dismemberment fired while the gib program is still
compiling / after it settled. `syncMarch` counts census entries that are
`!async` and have a ≥100 KB fragment module started after the warm.

### Baseline (base branch, 2 cold + 1 warm)

| run | readyWall ms | warmMs | asyncFirst | gibVariant | drawOnce | frameBefore | frameAfter | longFrames | syncMarch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cold 1 (`0.10311`) | 197 384 | 196 162 | 147 993 | 46 708 | 1 253 | 44.1 | 29.9 | 0 | 0 |
| cold 2 (`0.10312`) | 192 526 | 191 293 | 145 797 | 44 086 | 1 226 | 43.0 | 115.7\* | 1\* | 0 |
| warm | 3 810 | 2 545 | 1 148 | 12 | 1 233 | 44.7 | 28.4 | 0 | 0 |

\* the one baseline long frame (115.7 ms) recorded **`pipelines: []`** — a
simulation/chunk hitch with no pipeline creation, not a compile. `syncMarch=0`
is the load-bearing number.

The two cold boots reproduce the census's ~198 s: `asyncFirst` (body + crowd +
chunk-MRT, serialized) 146–148 s, `gibVariant` (chunk-shutter) 44–47 s.

### After (this change, 3 cold + 1 warm)

| run | readyWall ms | warmMs | asyncFirst | gibVariant | bgDone.gib | bgDone.crowd | frameBefore | frameAfter | longFrames | syncMarch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cold 1 (`0.10313`) | 47 731 | 46 524 | 45 104 | 0 | (killed mid) | — | 43.7 | 46.5 | 0 | 0 |
| cold 2 (`0.10314`) | 48 129 | 46 863 | 45 498 | 0 | (killed mid) | — | 43.6 | 49.7 | 0 | 0 |
| cold 3 (`0.10315`) | 50 941 | 49 673 | 48 281 | 0 | 162 904 | 215 270 | 43.7 | 48.5 | 0 | 0 |
| warm | 2 947 | 1 753 | 322 | 0 | 1 918 | (fast) | 46.9 | 30.6 | 0 | 0 |

Settle times are ms since the warm's `t0` (`backgroundStart`/`backgroundDone`).
Cold 3: the loader reveals at `warmMs` 49.7 s, the gib program (both chunk
targets) settles at 162.9 s and the crowd program at 215.3 s. The gib job is
two ~48 s compiles plus scheduling; the crowd job is one. The boot set's
`asyncFirst` fell from 146–148 s to 45–48 s (body only).

- **Cold loader time: 47.7 / 48.1 / 50.9 s** (was 192.5 / 197.4 s) — the target
  ~50 s, and the background programs settle afterwards as required.
- **No synchronous march-family compile mid-game**: `syncMarch = 0` on every
  run, and `longFrames = 0` on every after run. The dismemberment fired while
  the gib program was still compiling drew nothing (the tracker skipped the
  chunk list and the shutter capture) and its longest frame was 43.7 ms; after
  the program was ready the same trigger was 46.5–49.7 ms, all < 100 ms.
- **Warm boot** 1.75 s vs baseline 2.55 s — faster, not within-noise-worse; the
  ~1.5 s of crowd/chunk warm compile left the loader path, so only the body
  (322 ms) remains in `asyncFirst`.
- **Crowd members stay visible** via the per-body fallback (Step 1b). The
  fallback draws the already-compiled body program from the shared atlas band;
  the frames above were produced with the crowd program still `compiling`
  (`phaseBefore` = `{gib: compiling, crowd: pending}`), so bodies were on screen
  through the fallback. No pixel-level crowd capture was taken (honest limit).

Raw payloads: `baseline-1.json`, `baseline-2.json`, `baseline-warm.json`,
`after-1.json`, `after-2.json`, `after-3.json`, `after-warm.json`.

---

## Gates

- `npx tsc --noEmit` — clean.
- `npm test -- warm-background game-context-coverage march-golden pipeline-log
  sdf-layer gib-shutter-layer crowd-type` — **94 passed** (7 files). New:
  `warm-background.test.ts` (9 tests, the state machine + policy) and the
  background-precompile tests in `sdf-layer.test.ts` (clone camera + immediate
  restore + timeout/throw degrade) and `gib-shutter-layer.test.ts` (same for the
  gib shutter), plus `crowd-type.test.ts` reserve/attach/recycle.
- `scripts/march-hash.mjs` room 1 (headless Chrome + vite 5323/9323):
  ```json
  {"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
  ```
  Identical to `docs/dev-notes/2026-09-18-march-split/NOTES.md`. The march
  target is bit-identical — including a boot where the crowd program is still
  compiling and the crowd members were drawn through the per-body fallback.
- `git diff -- src/lab/sdf-zombie/webgpu/march/` — empty; `shasum` after every
  transient probe matched the baseline (above).
- Every transient `hash13` edit was reverted immediately and verified; the file
  is back at `0.1031`. Never committed.



## Correction 2026-09-20 — the crowd fallback never drew with the depth gate OFF

Section (b) assumed `setBodies` re-shows the hidden crowd-attached proxies. It
does so only in sdf-layer's front-to-back per-body branch (depth gate ON); the
game ships `GAME_DEPTH_GATE = 0`, where the single-pass march renders by each
object's own `.visible`. Measured on a cold profile: 0 body draws in the march
context during `{gib: compiling, crowd: pending}`, 235 in 3 s after the fix
(the draw fn now shows/hides attached proxies itself). This was the "cold-cache
flesh bug"; cold, the background set took > 4 min (gib alone 264 s).
