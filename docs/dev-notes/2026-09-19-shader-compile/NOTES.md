# Shader compile-time census — Task 1 (per-pipeline cold-boot census)

Plan: `docs/superpowers/plans/2026-09-19-shader-compile-time.md` (Task 1)
Mode: **MEASURE ONLY.** No shader, material, variant key or warm-up order change
is committed. The only transient shader edits were two diagnostic boots (one
comment, one numeric constant), both reverted before any test ran — see
"Reproducing a cold boot" below; `git diff -- src/lab/sdf-zombie/webgpu/march/`
is empty and `shasum` was checked after each revert.

Artifacts in this directory:

| file | what |
| --- | --- |
| `census.json` | 6 fresh-profile cold boots, `?pipelinelog=1`, full per-creation census |
| `cold-probe-constant.json` | 1 boot with a transient `hash13` constant change: **a real 198 s cold boot** |
| `comment-probe.json` | 1 boot with a transient WGSL comment: new module hashes, still fast |
| `march-wgsl-diff.txt` | unified diff of two body-shape march fragment modules (3 lines differ) |

Driver: `node scripts/compile-census.mjs [runs] [--out path] [--note text]`
(report mode: `node scripts/compile-census.mjs --report [path]`).

Run wall-clock (all times UTC, for GPU-contention attribution):

| file | window |
| --- | --- |
| trial 1 (validation) | 2026-09-19T04:27:11Z |
| trial 2 (`--sources 3`) | 2026-09-19T04:29:08Z |
| `census.json` (6 runs) | 2026-09-19T04:30:24Z – 04:31:14Z |
| `comment-probe.json` | 2026-09-19T04:31:54Z |
| `cold-probe-constant.json` | 2026-09-19T04:32:19Z – 04:35:40Z |

---

## Step 1 — what was already measurable

- `webgpu/pipeline-log.ts` wraps `device.createRenderPipeline[Async]` /
  `createComputePipeline[Async]`, `createShaderModule`, `createBindGroupLayout`,
  `createPipelineLayout`, `backend.createRenderPipeline` and three's pipeline
  release paths. Enabled by `?pipelinelog=1` (or
  `__sdfGame.setPipelineLog(true)`); disabled it is a closure hop per creation
  plus an integer add per frame. It already recorded: descriptor label,
  sync/async, **wall ms from call to promise resolution**, start `t`, the full
  descriptor signature, three's render-cache key (`threeKey`), the object /
  material / geometry identity, and content hashes of the vertex/fragment
  modules. `getPipelineLog()` exposed only aggregates plus the slowest 16 and the
  long-frame records — the wrong shape for "where did 80 s of boot go".
- `warm-gate.ts` owns the boot contract: `compiling → still-compiling → ready`
  (15 s bound only changes wording; the warm is still awaited), and reports the
  real outcome (`warm-failed`, `device-lost`). `warmPipelines` writes
  `__warmDone` with `ms`, `bootBeforeWarmMs` and per-phase timings
  (`flip`, `crowdBins`, `goo`, `asyncFirst`, `gibVariant`, `drawOnce`,
  `precompile`).
- `scripts/boot-time.mjs` already measured `{drawOnce, warmMs}` on a fresh
  profile; `scripts/sdf-demo-hash.mjs` / `march-hash.mjs` are pixel gates.
- **Missing** for this task: WGSL byte length per module, a full census of every
  creation (not just the slowest 16), and any way to tell two march variants
  apart beyond the opaque cache key. Step 2 added exactly those.

## Step 2 — instrumentation added (default-off)

`pipeline-log.ts`:

- `wgslFingerprint(code)` — pure, renderer-free, tested: byte count, sorted
  `fn` names (the effective wgslFn **include list**, capped at 240, exact count),
  `struct` names, `@binding(`/`@location(` counts. This is the plain-data seam
  that says *what* a 243 KB module is, not just how big.
- `PipelineCreationRecord` gained `endT`, `vertexShaderBytes`,
  `fragmentShaderBytes`, `computeShaderBytes`; `ShaderModuleStat` gained the
  fingerprint.
- `getPipelineCensus()` → every creation in completion order + the module
  fingerprint census + per-module WGSL sources, bounded (48 MB). Exposed as
  `__sdfGame.pipelineCensus()` and `__sdfGame.pipelineShaderSource(hash)`.
  `pipelineLog()` is unchanged.
- Cost when off: one `WeakMap.set` per shader module (byte length only) and the
  existing counters. Everything else (hashes, fingerprints, source retention,
  census arrays) is behind `enabled`.

`scripts/compile-census.mjs` starts its own vite + headless Chrome, **one fresh
`--user-data-dir` per run**, waits for `__warmGate.phase === 'ready'` or 240 s
(records which), dumps `__warmDone` + `bootMarks` + the census, runs sequentially
and writes `census.json`.

---

## Step 3 — the six cold boots (`census.json`)

| run | wall start (UTC) | warmMs | asyncFirst | gibVariant | drawOnce | precompile | entries |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 04:30:25 | 3026 | 1351.1 | 10.1 | 1430.7 | 161.0 | 213 |
| 2 | 04:30:31 | 3732 | 1826.2 | 7.8 | 1673.0 | 134.8 | 214 |
| 3 | 04:30:37 | 4245 | 1943.5 | 9.0 | 1840.2 | 138.8 | 213 |
| 4 | 04:30:45 | 7309 | 3247.7 | 16.4 | 3322.9 | 244.3 | 214 |
| 5 | 04:30:56 | 8337 | 5161.8 | 20.9 | 2879.3 | 106.2 | 214 |
| 6 | 04:31:08 | 2831 | 1207.9 | 6.7 | 1399.8 | 88.0 | 213 |

All six settled `ready`, none timed out, none exceeded 8.4 s. **No slow run
occurred in this window** — see "Reproducing a cold boot" for why, and for the
198 s cold boot that was reproduced deliberately.

Per boot: **213–214 pipeline creations, 154 sync + 59–60 async.**

### Step 4a — top 15 by median compile ms (warm, 6 runs)

| median ms | runs | sync/async | vert KB | frag KB | label |
| ---: | ---: | --- | ---: | ---: | --- |
| 153.1 | 3 | async | 1.5 | 6.7 | `renderPipeline_shutter:candidate-resolve_807` |
| 152.6 | 3 | async | 1.8 | 24.4 | `renderPipeline_MeshBasicNodeMaterial_793` (skinned actor, rgba16float) |
| 150.6 | 3 | async | 2.9 | 1.3 | `renderPipeline_MeshBasicNodeMaterial_776` (chunk skin, masked) |
| 84.2 | 6 | async | 3.9 | 236.9 | march **crowd** variant (5 locations) |
| 83.9 | 6 | async | 3.8 | 237.4 | march **body** variant (3 locations) |
| 82.2 | 6 | async | 3.9 | 236.9 | march crowd |
| 76.6 | 6 | async | 3.9 | 236.9 | march crowd |
| 70.4 | 6 | async | 3.8 | 237.4 | march body |
| 69.7 | 2 | async | 1.7 | 12.3 | `MeshBasicNodeMaterial_849` (skinned actor, rgba32float) |
| 69.2 | 6 | async | 3.8 | 237.4 | march body |
| 64.3 | 6 | async | 3.8 | 237.4 | march body |
| 60.6 | 6 | async | 3.8 | 237.4 | march body |
| 58.2 | 6 | async | 3.8 | 237.4 | march body |
| 54.9 | 6 | async | 3.8 | 237.4 | march body |
| 53.3 | 6 | async | 3.8 | 237.4 | march body |

Observations: the *median* warm cost is dominated by march body/crowd
(50–85 ms each) but three **small** non-march pipelines (6.7 KB, 24.4 KB, 1.3 KB
fragment WGSL) cost ~150 ms each on the boots where they are created — warm
compile time is not a function of WGSL size at this scale (overall Pearson
r = 0.58; within march r = 0.14). All march creations are `async`; all 154 sync
creations are cheap.

### Step 4b — the march family, by shape

Per run the family is **32 creations built from `march/` sources, 3 shapes, 31
distinct fragment-module hashes**. All three shapes contain `marchBody`; the
include-list difference is the whole variant story:

| shape | frag WGSL | fns | bindings | locations | distinct modules/run | warm median ms | include-list diff vs body |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **body** (per-body proxy box) | 243 087 B | 78 | 20 | 3 | 23 | 48.7 | — |
| **crowd** (quad dispatch) | 242 591 B | 77 | 19 | 5 | 7 | 56.1 | `−coneFetch`, `+` `iCentre/iHalf/iSlot` vertex attributes |
| **chunk/gib** (lean warm view) | 241 352 B | 75 | 16 | 3 | 1 (3 over 6 runs) | 25.1 | `−coneFetch −occFetch −shellFetch` |

The chunk shape is created in **two render contexts** (rgba32float march MRT and
rgba16float gib-shutter capture target), i.e. two pipelines from one shader.
Every other family member is created once. The family is **78.3 %** of the naive
sum of all creation ms across the six runs, and **82–93 %** of the merged
`[t, endT]` wall coverage of the compile window — i.e. essentially all of the
boot's shader work.

**Families NOT present on this boot.** The default `/sdf-game.html` (legacy
renderer, default room) creates no `refineBody`, `sdfSurfaceMarch`,
`coneMarch`, `depthPrepassMarch` or `chunkBody`/`chunkShade` module. The refine
pass is a `?graphics=high` target, deferred (`?renderer=deferred`) swaps
`marchBody` for `sdfSurfaceMarch`, and cone/depth-prepass contribute *includes*
(`coneFetch`, `depthPreFetch`, `coneStrand`, …) inside the three shapes above
rather than pipelines of their own. Those opt-in configurations were not
measured; if any of them is enabled by default in a future revision it adds
another **(shape × target)** program and therefore another ~48 s cold compile,
not another cheap instance.

**What makes the 23 body variants different: one generated identifier.**
`march-wgsl-diff.txt` is the complete diff of two of them (243 087 B, 4 599
lines): **3 differing lines**, all the TSL-generated storage-node name for the
crowd instance-record buffer (`inst`, argument 87 of `marchBody`):
`struct NodeBuffer_1844Struct` / `var<storage, read> NodeBuffer_1844` /
`&NodeBuffer_1844.value`. The 2 100-line body and its ~100 positional arguments
are byte-identical. The crowd shape's extra difference is the 5-location
instanced vertex layout and the missing `coneFetch`; the chunk shape's is the
three missing fetch includes.

### Step 4c — share of boot compile time (warm runs)

| run | all union coverage | march coverage | march share | march naive sum | all naive sum |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1411.6 | 1163.5 | 82 % | 1163.5 | 1462.1 |
| 2 | 1849.9 | 1606.4 | 87 % | 1606.4 | 2031.9 |
| 3 | 2056.1 | 1683.0 | 82 % | 1683.0 | 2367.9 |
| 4 | 3550.7 | 2828.3 | 80 % | 2828.3 | 4264.2 |
| 5 | 4958.2 | 4624.4 | 93 % | 4624.4 | 5050.6 |
| 6 | 1228.6 | 1031.5 | 84 % | 1031.5 | 1352.3 |

(ms. "Naive sum" adds every creation's `ms`; async creations barely overlap, so
coverage ≈ sum — confirmed below.)

### Step 4d — the slow boot (reproduced deliberately)

**Why none of the six was slow.** The OS/driver shader cache is
**machine-global**, not per-Chrome-profile: the trial boots at 04:27–04:29 had
already compiled this exact WGSL, so the six runs all hit it. A fresh
`--user-data-dir` is necessary but not sufficient.

**Reproducing it.** The technique the codebase already documents (`game-main.ts`:
"Measured by changing one smin constant on unchanged code: drawOnce 1.8 s cached
→ 80–101 s cold") is a transient change that alters the **compiled program**.
Two probes isolate the cache key:

1. `comment-probe.json` — `/* cold-cache-probe */` inserted into `MARCH_BODY`.
   Every march module hash changed (bytes +22), **boot stayed fast**
   (`warmMs` 2589, `asyncFirst` 1141). The WGSL comment does not survive into the
   compiled MSL, so the driver cache hit. This proves the cache is keyed on the
   compiled program, not on the TSL/WGSL string, and that a source change alone
   is not enough.
2. `cold-probe-constant.json` — `hash13`'s `0.1031` → `0.10311`. This changes
   every compiled march program. Result: **`warmMs` 197 988 ms,
   `asyncFirst` 147 323.6 ms, `gibVariant` 49 246.7 ms, `drawOnce` 1 255.4 ms**
   (the loader's 15 s wording bound fired, `gate.timedOut = true`; the gate still
   reached `ready`, no device loss, no 240 s timeout).

Both probes were reverted immediately; `shasum` of
`march/body/entry.wgsl.ts`, `march/math.wgsl.ts` and `march/README.md` matched
the pre-probe values and `git diff -- src/lab/sdf-zombie/webgpu/march/` is empty.

**Attribution (cold run).**

| ms | sync/async | shape | target | label |
| ---: | --- | --- | --- | --- |
| 49 686.7 | async | body 243 088 B / 3 loc | rgba32float | `MeshBasicNodeMaterial_356` |
| 49 244.1 | async | chunk 241 353 B / 3 loc | rgba16float | `MeshBasicNodeMaterial_813` (gib shutter) |
| 49 009.9 | async | chunk 241 353 B / 3 loc | rgba32float | `MeshBasicNodeMaterial_813` (march MRT) |
| 47 583.7 | async | crowd 242 592 B / 5 loc | rgba32float | `MeshBasicNodeMaterial_395` |
| **195 524** | | | | **99.0 % of `warmMs` 197 988** |

- The other **28 march creations took ~31 ms each** (e.g. the 22 later body
  instances and 6 later crowd instances) — the driver dedupes them against the
  first, because their compiled program is identical modulo the `inst`
  identifier.
- The other **~180 pipelines took 209 ms in total**.
- **Not one pathological variant, and not everything slowing uniformly**: exactly
  **one cold compile per distinct (march shape × render target)** combination,
  each ~48–50 s. `asyncFirst` = 147 323 ms is the crowd + body + chunk-MRT cold
  compiles **serialized** (merged coverage 147 219 ms of a 147 391 ms window;
  async coverage = the whole window — async compiles do not overlap).
  `gibVariant` = 49 247 ms is the chunk shader's *second* target format, cold
  again. The shape differences are <1 % of bytes (241–243 KB), yet each costs the
  same ~48 s, so **WGSL size does not predict cold cost within the family**
  (Pearson r = −0.66 is an artifact of the three slow shapes being nearly equal
  in size while 28 fast hits dominate the sample; the warm r = 0.14 is the honest
  one).

### Step 4e — bytes vs compile time

- Warm, march variants: **r = 0.14** over 192 (variant, run) samples.
- Warm, all pipelines: **r = 0.58** (the three ~150 ms non-march pipelines are
  1–25 KB, which pulls the all-pipeline fit down).
- Cold, march variants: r = −0.66, **not meaningful** — see above.
- Pipelines with ≥100 KB fragment WGSL are 32/213 creations (**15 %** of
  creations, 99 % of cold time).

---

## Step 5 — ranked recommendations (NOT implemented)

Expected wins are wall-clock on a **cold** boot (`warmMs` 198 s in the probe);
warm-boot effects are noted separately.

1. **Take the gib/chunk variant off the synchronous boot path. — ~98 s cold.**
   It is 2 of the 4 cold compiles: the chunk-MRT context inside `asyncFirst`
   (49.0 s) and the gib-shutter rgba16float context in `gibVariant` (49.2 s).
   Warm it costs ~25 ms, so the boot is buying nothing when the cache is warm —
   it is pure cold-boot tax. `87b8f71c` added it to prevent a mid-game freeze
   (measured 47.8 s + a second stall on first dismemberment); the fix is to keep
   that protection but move it **off the loader path**: schedule the same warm
   view in an idle/after-ready callback (or on first room transition) so the
   player is in the game at ~50 s instead of ~198 s. Risk: the background compile
   still saturates `MTLCompilerService` and the first gib can hitch if it arrives
   before the warm finishes; the existing not-ready-pipeline skip gives a
   precedent for degrading instead of stalling.
2. **Stop compiling crowd at boot; compile it on first crowd use. — ~48 s cold.**
   The crowd shape is its own 242.6 KB / 5-location program and one of the four
   cold compiles (47.6 s cold, 56 ms warm). Most boot rooms have no crowd, so
   this is another warm-up that only pays off in crowd rooms. Same idle/background
   staging as (1). This plus (1) removes 3 of 4 cold compiles (~146 s).
3. **Collapse the crowd and body *programs* into one shader (runtime branch,
   not compile-time shape). — ~48 s cold, and the port-correct fix.**
   The crowd differs from the body by a 5-location instanced vertex layout and
   dropping `coneFetch`; both are candidate runtime flags (the quad-dispatch
   `rays.rayDir` path already exists at runtime). If one program serves both, a
   cold boot needs one march library instead of two. This is a shader change and
   is strictly harder than simply deferring (2); do (2) first, then (3) if crowd
   rooms must load fast.
4. **Stage the warm-up around what frame 1 actually needs. — up to ~147 s to
   first playable frame.** `asyncFirst` is 3 serial cold compiles. If only the
   body/level/gun/post compiles gate `ready` (body is 49.7 s cold), the game is
   playable ~50 s in, with crowd/chunk compiled afterwards. This is the same
   mechanism as (1)+(2) expressed as a warm-up policy; it is the only option that
   makes the *cold* boot feel bounded when a new march library is unavoidable.
   Caveat: everything compiled behind the loader still has to happen; staging
   moves the waiting, it does not remove it.
5. **Shrink the march entry (phase 2 of
   `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md`). — the only
   lever on the ~48 s per-shape cost.** Size inside the family does not predict
   cold cost, which means the 48 s is per-program, dominated by the 2 100-line
   `marchBody` body / ~100 positional parameters at 243 KB. A materially smaller
   entry is the only way to cut the per-compile constant; expect roughly
   proportional savings (~24 s/shape if halved), but this has not been measured
   and is the highest-uncertainty item.
6. **Deduplicate the 23 body material instances / 7 crowd instances. — ~0 s
   cold, ~1.2 s warm.** The browser does **not** pay 31 cold compiles: the driver
   dedupes the 30 non-first instances (they compiled in ~31 ms each cold). So "31
   march variants" is not the cold-boot problem the plan assumed. It *is* the
   warm-boot problem (32 × 30–85 ms `createRenderPipelineAsync` ≈ 1.2 s of the
   2.8–8.3 s warm boot), and it is a **port hazard**: a Rust + wgpu port with a
   pipeline per instance would pay every one of them. For the port, build one
   pipeline per shape and bind per-instance buffers via bind groups, so generated
   identifier differences can never multiply shader modules.

**Corrected premise.** The plan's "each march variant is a very large Metal
compile" is false for material instances: 23 body instances share one compiled
program. The true cost unit is a distinct **(march shape × render target)**
program, and the default boot has four: body, crowd, chunk-MRT, chunk-shutter.

---

## Step 6 — gates

- `npm test -- pipeline-log game-context-coverage` — pass (17 pipeline-log +
  4 context-coverage; no new failures).
- `npx tsc --noEmit` — clean.
- `scripts/march-hash.mjs` room 1 unchanged vs
  `docs/dev-notes/2026-09-18-march-split/NOTES.md`:
  `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d` (repeat identical).
- `git diff -- src/lab/sdf-zombie/webgpu/march/` empty; transient probes reverted.
