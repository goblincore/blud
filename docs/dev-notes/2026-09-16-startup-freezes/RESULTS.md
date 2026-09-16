# Startup, WebGPU loss and first-gib freeze — corrected attribution and the action-stall fix

2026-09-16 (second pass). Worktree `2026-09-16-blud-action-stall-fix`, branch
`codex/blud-action-stall-fix`, from **`a678273d`**. Node `v22.22.1`.
Commits: `c2dbdaa9` (full-fidelity pipeline attribution), `7eda66a5` (probe
viewport/DPR), `d393d682` (**the blast-stall fix**), `34c076f2` (warm
lifecycle), `97c462a6` (probe first-detonation record + summarizer), plus this
doc and its evidence. This supersedes the attribution in the previous
RESULTS.md revision; the earlier lifecycle fixes it inherited (`049f29e7` /
`a678273d`) are preserved.

Accepted behaviour preserved (not changed): rupture
rotation/release/spin, faces, the mesh-skeleton default, the baked-piece
optimization, lights and shadows. Re-verified by native vision in §9.

## 0. Reviewer corrections to the previous report

The previous pass's headline mechanism — *"the same 8 pipelines with
byte-identical descriptors rebuilt 12×; three's cache entry is evicted by mesh
churn"* — was **not established by its evidence**. Corrected here:

1. **The old `descriptorSignature` could not prove pipeline identity.** It
   named topology/cull/frontFace, a few depth/stencil scalars, multisample
   count, colour-target *formats* and entry points. It omitted the **shader
   module content**, the **pipeline layout**, **vertex buffer formats**, the
   **blend state and colour write masks**, **stencil ops**, **depth bias**,
   **alphaToCoverage** and **unclippedDepth**. Two creations could match it and
   still be different GPU pipelines. The detector is now full-fidelity, and it
   also records three.js's own render cache key (`stageVertex.id,
   stageFragment.id, backend.getRenderCacheKey`) captured from
   `backend.createRenderPipeline(renderObject).pipeline.cacheKey`, plus the
   shader-module hashes (wrapped `createShaderModule`), the pipeline-layout
   content signature (wrapped `createBindGroupLayout`/`createPipelineLayout`)
   and every `Pipelines.delete`/`_releasePipeline` eviction. The old claim did
   not survive; the corrected causal path is in §2.
2. **The old `warm-gate` tests tested identity/ternary helpers**, not the
   lifecycle. `warmPipelines` catches its own throw, so its promise resolves on
   failure and the loader could show READY after a recorded warm error; and
   restoring the loop state snapshotted at warm START overwrote a pause
   requested while the warm was in flight. Both are now fixed and tested with
   deferred promises and fake timers (§5).
3. **The prior narrative said "2.3–5.0 s" while its own phase table contained
   5.731 s.** This report uses raw measured values only. The previous task
   established **no performance improvement**; its stress-gather p95 included
   actor spawning; and its 960×720 DPR-1 headless viewport is **not** the
   owner's headed viewport. All three limits are kept explicit in §6/§10.

## 1. Protocol (matched before/after)

- One GPU job at a time; own Chrome profile (`--user-data-dir` keyed by CDP
  port) and own Vite (`--strictPort`) on **5480/9480**, scratch under
  `/tmp/…-lab` (outside the Vite root — with it inside, Vite reloads the page
  when Chrome writes its profile, and the boot never completes). The owner's
  servers on **5391/5415** and the stale **5403** were never touched.
- Matched page URL for every timing sample:
  `http://localhost:5480/sdf-game.html?room=arena&gibbones=core&pipelinelog=1&seed=7&crowd=1&vhs=blud&res=800`.
  Boot flags only; crowd was never toggled mid-run. Settings held fixed for
  every run: seed 7, room `arena`, gibbones `core`, `crowd=1`, `vhs=blud`,
  `res=800` (800×600 render), graphics `default` with the **shipped upscale
  stage on** (`upscale` absent) and DPR 1 for the matched set (`after-dpr2` is
  the DPR-2 control). `&upscale=1` is NOT a valid value — it is parsed as a
  model config and breaks the boot; that mistake cost two discarded runs.
- **before = `a678273d` + the diagnostics commit `c2dbdaa9`** (identical
  instrumentation, no behaviour fix); **after = the candidate**. 3 runs each,
  plus one headed-equivalent run (`after-dpr2`, 1512×982 DPR 2).
- Browser: Google Chrome **152.0.7977.84**, `--headless=new
  --enable-unsafe-webgpu`. Machine: Apple M3 (10 GPU cores), 24 GB, macOS
  26.3.1. Load average at the start of each run: before 3.77 / 3.75 / 8.91;
  after 7.03 / 6.64 / 9.66; dpr2 8.66. **Background load (OrbStack at
  ~230 % CPU, Spotlight, the user's Chrome) was high and unequal**, so every
  timing number is reported raw with its load, and only the effect that is
  reproducible across all three matched pairs is claimed as the fix.
- Only one owned GPU browser was alive at a time; tabs and Chrome profiles
  created by these runs were closed with the run.

Harness (one set):

```
LAB_VITE_PORT=5480 LAB_CDP_PORT=9480 LAB_TMP=/tmp/…-lab \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; \
           PROFILE=1 bash .lab-tmp/run-probe.sh before 3 "&crowd=1&vhs=blud&res=800"'
node scripts/summarize-probe.mjs .lab-tmp/startup-probe after 3
```

Compact per-run records: [`captures/action-stall/`](captures/action-stall)
(`before{1..3}.compact.json`, `after{1..3}.compact.json`,
`after-dpr21.compact.json`, `matrix.json`). The full records, including the CDP
CPU profiles, are in the worktree's gitignored `.lab-tmp/startup-probe/`.

## 2. Corrected attribution: what actually caused the 180–230 ms blast frames

The three `before` runs are numerically identical on the action path, which
makes the mechanism unambiguous:

| before run | repeated-blast windows | pipelines created | window p95 | window max | LONG frames (≥100 ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| before1 | 6 | **189** | 221.5 ms | 221.5 ms | **11** |
| before2 | 6 | **189** | 230.2 ms | 230.2 ms | **11** |
| before3 | 6 | **189** | 234.0 ms | 234.0 ms | **11** |

Every long frame and every creation lands inside a blast window, and the frame
detail names 17–18 creations per frame with six material labels
(`MeshBasicNodeMaterial_191`, `MeshStandardMaterial_384/494/537/576`,
`MeshBasicMaterial_783`). Two such frames per detonation — **ignite and
expiry**.

**The correct detector result.** The authoritative three-cache-key census shows
these are *not* the same key re-created; the **full-descriptor** census shows
they are the same **GPU pipeline** re-created under a new key:

```
before descriptorGroups (label, creations, distinct three keys)
  MeshBasicMaterial_786        18 creations / 18 distinct keys
  MeshBasicNodeMaterial_191    14 / 14
  MeshBasicNodeMaterial_773     7 /  2   ← two LEGITIMATE variants, not 7
  MeshStandardMaterial_715      7 /  7
  Steel_682                     7 /  7
```

`MeshBasicMaterial_786`'s full signature (shader module hashes + layout hash +
targets + buffers + depth state) is identical on all 18 creations while three's
cache key differs each time — i.e. the same GPU pipeline rebuilt, because
`ProgrammableStage` ids are a global counter (`three/src/renderers/common/
ProgrammableStage.js`) and a new stage instance produces a new key even for
identical WGSL. `MeshBasicNodeMaterial_773` is the control: 7 creations with
only **2** distinct keys, the two genuine light-count variants. The detector
does not misclassify legitimate variants.

**The causal path** (three r185, read locally):

1. `explosionLightPool[i].visible` was toggled per blast (ignite:
   `pl.visible = k > 0.001`; idle: `pl.visible = false`; boot:
   `pl.visible = false`).
2. `LightsNode.customCacheKey()` hashes the **ids of the visible lights**
   (`three/src/nodes/lighting/LightsNode.js:147-172`). Toggling visibility
   therefore changes the scene's lights-node key.
3. That key is part of the `NodeBuilderState`/shader variant chosen for every
   material lit by the scene lights (`RenderObject.getDynamicCacheKey` →
   `NodeManager.getCacheKey`), so a different light variant means a different
   WGSL source.
4. `RenderObjects.get()` disposes and recreates render objects whose dynamic
   key moved (`three/src/renderers/common/RenderObjects.js:127-134`), which
   calls `Pipelines.delete` and releases the old variant's
   `ProgrammableStage`/pipeline when its `usedTimes` reaches 0
   (`three/src/renderers/common/Pipelines.js:274-284,431-433`).
5. The next blast re-ignites the same variant, which is no longer cached, so
   17–18 `createRenderPipeline` calls run mid-frame.

This is causal, not coincident: the churn frames occur exactly on the light
transitions, the descriptor-identical/distinct-key census is the signature of
key churn, and removing the transitions removes the churn (§4). The three
`PointLight:?` entries in the warm's flipped-object list (61 hidden objects)
are the same three pool lights, so the warm→play restore re-keyed the lights
node as well.

**The "mesh churn releases the pipeline" hypothesis is not supported.**
`geometry.dispose()` alone does not evict a pipeline
(`RenderObject.js:337-344`; `getGeometryCacheKey` is structural), and
`retireActor` removes gibbed actor views without disposing them. The evictions
that were measured are render-object re-creation, and the object census in
`before` (below) names the viewmodel/gun parts, not gib meshes:

```
before evictions = 403 per run
  byObject: Mesh 292, (unnamed) 62, Mesh:Watch_Screen 17, Mesh:hand_L 17, Mesh:crown1 15
after  evictions = 120-121 per run
  byObject: (unnamed) 62, Mesh 58
```

The per-head baked-chunk `faceMaterial` create/dispose in `freeBaked` is real
but secondary: it is a `MeshBasicNodeMaterial` and it does not appear in the
measured blast-frame creation set.

## 3. The fix (`d393d682`) — smallest measured change

`src/lab/sdf-zombie/webgpu/game-main.ts`: the explosion light pool is created
**permanently visible** and the per-frame update modulates **intensity only**.

- `pl.visible = false` at construction → `pl.visible = true`.
- `if (!e) { pl.visible = false; pl.intensity = 0; }` → `if (!e) { pl.intensity = 0; }`.
- `pl.visible = k > 0.001;` → removed.

Intensity 0 contributes no light and intensity is not part of the lights-node
key, so the shader variant is chosen once (during the warm) and never changes.
The pool is no longer part of the warm's hidden-object flip either. Cost: three
idle point-light iterations in the lit shaders, against ~400 ms of pipeline
churn per blast. No renderer rewrite, no monkeypatch, no quality/default
reduction, no disabled lighting, no swallowed errors, and no cost moved into
startup (the variant compiled is the same one the warm already compiled with
the lights flipped visible).

**Residual, not fixed:** the warm's hidden-object flip/restore of the other 58
meshes still re-keys their render objects. It shows up as the same six
`MeshBasicNodeMaterial_185/195/196/197/198/199` entries rebuilt 5× (4
releases) between frame ~5 and ~41–44 in **both** before and after, with
creation times of 1–13 ms — it does not produce long frames and is not a blast
stall. It is recorded as UNRESOLVED (§9) rather than papered over.

## 4. Matched before/after results

### Repeated blasts (six windows, fixed 450 ms cadence, one detonation each)

| set (load) | pipelines created | window p95 | window max | LONG frames |
| --- | ---: | ---: | ---: | ---: |
| before1 (3.77) | 189 | 221.5 ms | 221.5 ms | 11 |
| before2 (3.75) | 189 | 230.2 ms | 230.2 ms | 11 |
| before3 (8.91) | 189 | 234.0 ms | 234.0 ms | 11 |
| **after1 (7.03)** | **0** | **31.3 ms** | **32.9 ms** | **0** |
| **after2 (6.64)** | **0** | **34.3 ms** | **34.3 ms** | **0** |
| **after3 (9.66)** | **1** | **34.7 ms** | **34.9 ms** | **0** |
| after-dpr2 (8.66) | 0 | 34.3 ms | 36.2 ms | 0 |

The blast-frame p95 falls **221.5–234.0 ms → 31.3–34.9 ms** (≈85 % lower) and
the ≥100 ms frames go **11 → 0** in every one of the six windows. The effect is
reproducible at higher load than the best before run (after3 at 9.66 is still
34.7 ms) and at 1512×982 DPR 2.

### Repeated shots (six windows)

| set | pipelines created | p95 | max | LONG frames |
| --- | ---: | ---: | ---: | ---: |
| before | 3 / 0 / 3 | 31.6 / 30.9 / 38.0 ms | 31.9 / 35.0 / 43.3 ms | 0 / 0 / 0 |
| after | 3 / 3 / 0 | 31.0 / 41.3 / 42.4 ms | 31.6 / 41.5 / 42.6 ms | 0 / 0 / 0 |

Shots were never a multi-hundred-ms stall surface; the 3 first-repeat
creations are a first-use cost and are unchanged.

### Session long frames and pipeline/session totals

| | before (3 runs) | after (3 runs) |
| --- | --- | --- |
| long frames (≥100 ms), total | 16 / 16 / 16 | 0 / 4 / 3 |
| … with pipeline creations | 16 / 16 / 16 | 0 / 0 / 2 |
| … with **no** creations | 0 / 0 / 0 | 0 / 4 / 1 |
| render-cache-key rebuild census (sum) | 70 / 70 / 70 | 70 / 70 / 70 (warm only) |
| evictions (`Pipelines.delete`) | 403 / 403 / 403 | 120 / 120 / 121 |
| shader modules created / bytes / distinct | 674 / 16,353,422 B / 411 | 255 / 9,047,735 B / 195 |

The residual after long frames are investigated: `after2` frames 230 (115.6 ms),
740 (113.3 ms), 829 (109.6 ms), 830 (114.8 ms) and `after3` 798 (106.1 ms) have
**0 creations** and fall in the first-shot / crowd-spawn stress phases;
`after3` 179 (119.9 ms, 2 creations of `MeshBasicMaterial_912`) and 216
(156.2 ms, 4 creations of `MeshBasicNodeMaterial_191/727/762`) are first-shot
first-use under load 9.66. None is a blast window. The ≥100 ms frames with no
creation are named, not left unexplained: they are CPU (spawn/gather) cost, not
pipeline creation.

### Warm / boot (raw; no improvement claimed)

| set (load) | warm steps | nav→warmDone | drawOnce | precompile |
| --- | ---: | ---: | ---: | ---: |
| before1 (3.77) | 2284 ms | 4106 ms | 1567.8 ms | 578.5 ms |
| before2 (3.75) | 2298 ms | 3820 ms | 1597.4 ms | 573.4 ms |
| before3 (8.91) | 2385 ms | 3901 ms | 1697.0 ms | 558.4 ms |
| after1 (7.03) | 3485 ms | 5606 ms | 2555.7 ms | 830.0 ms |
| after2 (6.64) | 2603 ms | 4419 ms | 1784.3 ms | 652.0 ms |
| after3 (9.66) | 3523 ms | 5814 ms | 2440.6 ms | 874.1 ms |
| after-dpr2 (8.66) | 2524 ms | — | 1781.1 ms | 613.9 ms |

Boot duration tracks machine load, and the after runs ran at ~2× the before
load; **no warm/boot improvement or regression is claimed**. The previous
task's raw spread (2 283–5 731 ms of warm steps, including the 5 731 ms row its
narrative rounded to "5.0 s") stands as the pre-fix corpus. The fix's expected
startup effect is neutral-to-positive (it removes the post-warm light-variant
re-key rather than moving work into boot), and that is all that is claimed.

### Headed-equivalent resolution

`after-dpr21` ran at 1512×982, DPR 2. `viewport` records
`{width:1512, height:982, dpr:2, canvasW:800, canvasH:600}`: the game's render
target is fixed by the `res=800` rung (800×600) and only presentation scales
with the window, so the owner's headed window size changes presentation cost,
not the march/scene resolution. The blast fix holds at that viewport
(0 creations, 34.3 ms p95, 0 long frames).

### Probe-gather: spawn vs steady state, and the capsule fix

The stress levels now measure a **spawn window** and, after a 3 s settle, a
separate **2 s steady window** with no spawning in it. `rows` is the bone-ROW
count (`gates.capsules`, rows × 2 = capsules).

| cumulative bodies | bone rows | steady p95 before | steady p95 after | spawn p95 before | spawn p95 after | probe errors |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 395 | 27.8 / 33.8 / 49.5 ms | 28.1 / 36.8 / 61.7 ms | 196.9 / 190.7 / 250.5 | 31.5 / 29.2 / 29.8 | 0 |
| 15 | **935** | 88.0 / 156.6 / 155.8 ms | 226.3 / 164.7 / 188.7 ms | 53.0 / 85.0 / 707.4 | 77.8 / 86.3 / 82.7 | 0 |
| 27 | **1024 (cap)** | 273.4 / 332.4 / 262.3 ms | 445.5 / 417.4 / 338.0 ms | 573.8 / 492.9 / 649.7 | 633.1 / 1504.6 / 763.4 | 0 |
| 47 | **1024 (cap)** | 411.3 / 613.7 / 561.3 ms | 608.9 / 1069.2 / 751.3 ms | 851.2 / 849.7 / 917.9 | 1080.7 / 2070.7 / 1138.8 | 0 |

- **Capsule fix verified above 512 rows:** rows 935 and 1024 run with
  `errors: 0`, `bound: true`, `dynOn: true` in all seven runs. 935 is the first
  level above the 512/owner's-515 range and it is clean.
- **Steady-state gather is a real, separate cost**, isolated from spawning:
  ~28–62 ms at 395 rows, ~165–226 ms at 935 rows, and 338–1069 ms at the
  1024-row cap. The previous report's 1.0–2.3 s figure conflated this with the
  spawn CPU; the spawn window is the higher number (up to 2.07 s here) and the
  steady window is the gather. Not reopened to lower the test load.

### First gib / bake timeline (unchanged)

first visible chunk 241–547 ms after detonate; first worker bake submit
1.98–3.54 s; main-thread bake swap 0.4–0.9 ms; first textured-head draw
3.17–5.12 s. The worker and the swap are not the hitch (unchanged finding).

## 5. Warm lifecycle fixes (`34c076f2`), live-verified

- `warmPipelines` now returns `'ok' | 'failed'`; `coordinateWarmGate`
  (warm-gate.ts) awaits the **outcome**. A failed/rejected warm settles the
  loader as `warm-failed` with honest wording — never READY; a lost device as
  `device-lost`. On the 15 s bound the loader only changes wording and keeps
  awaiting; it never reveals on the bound alone.
- `createLoopController` separates the loop's **intent** from the warm's
  suspension. All external `setLoopRunning` calls (including the rig seams) go
  through the intent; the warm only suspends/releases, so the most recent
  intent wins.
- Live probe evidence on the real warm path, all runs:

| lifecycle check | before (old code) | after |
| --- | --- | --- |
| loop stays armed after a warm started armed | true | true |
| **loop stays paused after a warm started paused** | false (bug) | false |
| **pause requested WHILE the warm is in flight** | **true (bug)** | **false** |
| loader gate phase | n/a | `ready` ×3 |

The first-pause case (`loopAfterPausedWarm`) was already correct in the old code
because it snapshotted at START; the case the reviewer identified —
pause **during** the warm — returned `true` before and returns `false` after.
`warm-gate.test.ts` (12 tests) now drives the real coordinator with deferred
promises and fake timers: fast success, slow success across the 15 s bound,
failure, rejected warm, device loss, prereq gating, and pause/resume during
warm. `pipeline-log.test.ts` (13 tests) pins the collisions the old signature
produced (different shaders, layouts, blends, write masks, vertex formats,
stencil ops) and asserts legitimate target/sample variants stay distinct.

## 6. Carve and default-path scope

Unchanged from the previous pass and re-affirmed: `?gibrender=carve` is the
only trigger and is absent from the owner's URL; the default URL never builds
the carved library. Off-thread carve remains a **separate, explicitly named
open item** (§9); it was not touched because no measurement shows it on the
default path. The retained diagnostics (`device.lost` /
`onuncapturederror`) still cover the rare default device-loss case.

## 7. Tests and build

```
npx vitest run src/lab/sdf-zombie/probe-dynamic.test.ts \
  src/lab/sdf-zombie/probe-dynamic-cull.test.ts \
  src/lab/sdf-zombie/webgpu/probe-gather-workgroup.test.ts \
  src/lab/sdf-zombie/webgpu/probe-dynamic.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/probe-grid.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/probe-lighting-node.test.ts \
  src/lab/sdf-zombie/webgpu/warm-gate.test.ts \
  src/lab/sdf-zombie/webgpu/pipeline-log.test.ts
# 8 files passed, 124 tests passed (Node v22.22.1)

npm run build   # tsc --noEmit && vite build — exit 0, ✓ built in 4.14s
```

## 8. Diagnostic cost (honest limit)

The full-fidelity detector hashes every shader module source when
`?pipelinelog=1` is on. That is 16.35 MB (before) / 9.05 MB (after) per boot and
shows as `device.createShaderModule … pipeline-log.ts` self-time of
318–659 ms in the boot CPU profiles. **Both arms carry the same overhead**, so
the before/after comparison is unaffected, but the absolute warm numbers in §4
include it and the production path (no `?pipelinelog=1`) does not. Disabled,
the wraps are scalar counters only, as before.

## 9. Retained appearance (native vision)

Captured with the accepted rupture rig on this branch (`RUP_VIEW=front
RUP_DIST=2.4 RUP_FRAMES=16 RUP_SEED=7`) and opened with the native viewer — not
read from filenames. Telemetry matches the accepted Task 4 numbers exactly
(`f11` body rot 54.8°, release `f12` chunk rot 59.4°, spin 4.63 rad/s,
16 chunks, tier `parts`). Artifacts:
[`captures/action-stall/rupture-after-sheet.jpg`](captures/action-stall/rupture-after-sheet.jpg),
`rupture-after-telemetry.json`.

- **f0 onset** — intact posed zombie, arms down, head/face intact.
- **f1–f3** — chest band separates; mottling appears; ribs begin to show.
- **f4–f8** — cavity brightens, rib ladder reads, regions are visibly rotated
  apart.
- **f10–f11** — regions rotated (not upright/parallel), ribs exposed, mottled
  chunk surface already present (no material pop).
- **f12 release** — chunks spawn in the *same* configuration as f11: no snap
  back to upright, no material blink; the head stays a distinct, face-bearing
  mass.
- **f13/f15** — pieces keep turning and scatter.

The light fix does not change this: the pool's intensity envelope and the
blast's own lighting are unchanged; only the light's membership in the scene's
light set is now stable.

**The explosion light still reaches the room** (whole-frame mean luminance, not
a changed-pixel count — a transient light lifts every wall slightly):

```
fxlight 0 (off) : room mean 29.89 -> 29.93  (+0.04)  mesh intensity [0,0,0]
fxlight 1 (SHIP): room mean 30.07 -> 39.00  (+8.93)  mesh intensity [136.2,0,0]
```

`mesh intensity [136.2,0,0]` is read live from `__sdfGame.dynamite()`, so the
light is on in the material, not just allocated. Artifact:
[`captures/action-stall/explosion-light-reach.txt`](captures/action-stall/explosion-light-reach.txt).

## 10. FIXED vs INVESTIGATED vs UNRESOLVED

**FIXED**
1. **Blast-frame stalls (this task's core).** Explosion light visibility
   toggling re-keyed the scene lights node and rebuilt the light shader variant
   mid-frame: 189 pipeline creations and 11 ≥100 ms frames per six blasts →
   0–1 creations and 0 long frames; p95 221.5–234.0 ms → 31.3–34.9 ms.
2. **Warm loader honesty on failure / device loss** (`coordinateWarmGate`).
3. **Loop intent vs warm suspension**: a pause requested during the warm is
   respected (live: `true` before → `false` after).
4. Probe gather overflow (>512 rows → 1024 rows, 0 errors) — inherited and
   re-verified live.
5. Full-fidelity pipeline attribution: shader-source hashes, layout content
   signatures, the true three cache key, and eviction recording with object
   identity.

**INVESTIGATED (attributed with raw evidence, not fixed)**
1. Steady-state gather at the 1024-row cap: 338–1069 ms p95 in a clean 2 s
   window with no spawning (separate from the spawn CPU, which reaches 2.07 s).
2. Residual warm→play re-key of the six `MeshBasicNodeMaterial_185/195–199`
   pipelines (5 creations / 4 releases, 1–9 ms each, frames ~5→41–44) caused by
   the warm's hidden-mesh flip/restore. No long frame.
3. The residual after long frames with **no** creations (105–116 ms) are
   CPU/gather during first-shot and crowd spawn, under load 8.7–9.7.
4. Device loss / the owner's 38.9 s did not reproduce in any of the seven runs;
   diagnostics are retained.

**UNRESOLVED**
1. The owner's 38.9 s one-off — needs the contended / GPU-process-restarted
   conditions to reproduce.
2. The warm hidden-object flip/restore re-key (§2 residual): a real second-order
   churn, currently sub-10 ms.
3. Carve's ~22.3 s synchronous build (opt-in only) still needs an owned worker
   or a reusable baked library. **Explicitly open; not started.**
4. Steady-state probe gather at maximum occupancy (1024 rows) is genuinely
   expensive and load-sensitive.

## 11. Limitations

- Single machine, one GPU (Apple M3), seven runs in one window under
  **unequal, high background load** (3.75–9.66). The blast-stall fix is claimed
  because it is identical across all three matched pairs and at DPR 2; the
  warm/boot numbers are not used to claim any improvement.
- Headless Chrome at 960×720 DPR 1 (and the 1512×982 DPR 2 control) is still
  not the owner's live playtest; model inspection and native-vision captures
  are not acceptance.
- The `before` arm is `a678273d` **plus the diagnostics commit**, not the bare
  commit: the same detector had to run on both sides. The diagnostics are
  behaviour-neutral apart from the shader-hash CPU cost documented in §8.
- The probe revision used for these records predates `97c462a6`, so the
  first-detonation window was recorded as `undefined` in these seven files; the
  first blast is still covered by the session long frames and the gib timeline,
  and the probe now records it correctly.
- `probeDynamic().gates.capsules` is a bone-ROW count despite the name.
- No owner playtest; no merge or push was performed.
