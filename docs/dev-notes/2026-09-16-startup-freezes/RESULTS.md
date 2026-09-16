# Startup, WebGPU loss and first-gib freeze — attribution and fixes

2026-09-16. Worktree `2026-09-16-blud-startup-freeze-attribution`, branch
`codex/blud-startup-freeze-attribution`, from **`fdf20ad0`** (inherits the
rupture-rotation work `ae30d9c2` and the probe buffer correction). Node
`v22.22.1`. This is the profiling task queued by
[PROBE-FIX.md](PROBE-FIX.md) and the gib follow-up
[`../2026-09-16-gib-follow-up/HANDOFF.md`](../2026-09-16-gib-follow-up/HANDOFF.md).

Accepted behaviour this task preserves (none of it was changed): rupture
rotation/release, faces and the mesh-skeleton default, and the baked-piece
optimization. The retained appearance is re-verified by native vision in §8.

## 0. What this session found, in one paragraph

Under a controlled, matched protocol the owner's **38.9 s boot did not
reproduce**: six boots of the shipped default URL measured 2.3–5.0 s of warm
work and 3.9–10.7 s from navigation to warm completion, with no `device.lost`
and no uncaptured WebGPU error. What *does* reproduce is (a) a real but much
smaller startup cost dominated by **one real drawn frame** (lazy mesh-skeleton
extraction ~2 s CPU + synchronous GPU pipeline creation) and **one async
fullscreen pipeline** (~0.6–1.3 s), (b) a **first-gib/action freeze** of
300–760 ms frames caused by three.js rebuilding render pipelines it already
built (the same 8 materials, identical descriptor signatures, ~12 times a
session), and (c) in opt-in `?gibrender=carve` mode only, a **22.3 s synchronous
carve library build** — the historical ~19.7 s — which the default URL never
runs. The probe overflow fix (`fdf20ad0`) is verified live at the full admitted
budget (1024 bone rows → 2048 capsules, 0 errors). Two lifecycle defects were
found and fixed: the loader claimed READY on its 15 s bound while warm-up was
still running, and a finished warm-up force-restarted a deliberately paused
render loop.

## 1. Protocol

- One GPU job at a time, own Chrome profile (`--user-data-dir` keyed by CDP
  port) and own Vite (`--strictPort`) on **5480/9480**. The owner's candidate
  server on **5415** (`rupture-live-review`) and the stale task-3 server on
  **5403** were never touched.
- Matched page URL for every timing sample:
  `http://localhost:5480/sdf-game.html?room=arena&gibbones=core&pipelinelog=1&seed=7`.
  Crowd flags ride the URL; crowd was never toggled mid-run.
- **Cold vs warm**: "cold" is a brand-new Chrome profile (cold GPU/pipeline
  shader cache, deleted from our own `.lab-tmp` scratch — never the owner's
  personal cache). "Warm" is a second/third boot in the same profile. Two
  independent cold/warm pairs (A and B) plus two post-change boots.
- Live loop only (no `frozen=1`, no hand-stepping). Frame times are the page's
  own rAF deltas. Frozen capture rigs are visual rigs, not perf tests.
- Browser: Google Chrome **152.0.7977.84**, `--headless=new
  --enable-unsafe-webgpu`. Machine: Apple M3 (10 GPU cores), 24 GB, macOS
  **26.3.1**. Load average during the matrix: **5.41/4.77/3.93** to
  **6.07/5.14/4.16** (`captures/machine-load.txt`); the final validated run ran
  at a lower load. This contention is why single samples are not trusted.

Harness:

```
bash scripts/link-dev-assets.sh                       # gitignored dev placeholders
LAB_VITE_PORT=5480 LAB_CDP_PORT=9480 LAB_TMP="$PWD/.lab-tmp" \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; \
           node scripts/startup-freeze-probe.mjs 5480 9480 .lab-tmp/startup-probe <label> [qs]'
```

`scripts/startup-freeze-probe.mjs` (new) is the attribution instrument: it
CDP-profiles the whole boot, polls `__bootMarks`/`__warmDone`, reads the loader
state, drives room entry → first shot → first dynamite detonation (release,
first visible chunk, first worker bake submit/reply/upload, first textured-head
draw) → repeated blasts → probe-gather stress, and reports
`pipelineLog().longFrames` / `.duplicates`, `probeDynamic()`, `chunkStats()` and
the new GPU diagnostics. Raw records: [`captures/`](captures) (`probe-*.json`,
each ~80–95 kB, one per boot).

## 2. Phase table (ms; median of the reproducible boots)

`nav→main` is module load/parse (Vite dev); `zombies+rooms` is the one synchronous
section in `main()`; `gun` is the GLB await; the warm columns are its own
sub-phases. Raw rows are in `captures/probe-*.json` (`final.bootMarks`,
`warm.phases`).

| boot (load) | nav→main | zombies+rooms | gun | warm steps | · drawOnce | · precompile | · goo | · crowdBins | nav→warmDone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coldA (5.4) | 595 | 965 | 251 | 3887 | 2824 | 846 | 198 | 18 | 5816 |
| warmA (5.4) | 174 | 1085 | 274 | 3316 | 2291 | 855 | 155 | 15 | 5020 |
| coldB (6.1) | 1049 | 1732 | 362 | 3187 | 2109 | 799 | 256 | 23 | 6547 |
| warmB (6.1) | 173 | 1234 | 321 | 3912 | 2812 | 856 | 227 | 17 | 5851 |
| after-main (—) | 1542 | 2315 | 762 | 5731 | 4190 | 1343 | 164 | 33 | 10677 |
| final (low) | 474 | 859 | 204 | **2283** | **1586** | **571** | 114 | 12 | **3918** |
| carve `?gibrender=carve` | 287 | 2168 | 459 | **27539** | 3699 | 1255 | **22558** | 26 | 30778 |

**Cold vs warm is not the story.** A brand-new Chrome profile booted in the
same 3.2–3.9 s warm range as a warm reload (paired), so the owner's 38.9 s is
not a cold-shader-cache effect on this machine.

### Named dominant costs

1. **`drawOnce` — the one real frame** (1.6–4.3 s of the warm). CDP CPU profile
   attribution (boot window, 4–10 s total): the largest first-party self-times
   are `extractSegmentMesh` (~1.9 s) and the skeleton contract `distance`
   (~1.7 s) — both called from `warmPipelines`, i.e. inside the first draw,
   because the mesh skeleton is extracted lazily on the first render of an
   actor and then cached per `revision@cellSize`. `createProgram` (three)
   adds ~0.5–0.9 s of shader-program creation. This is the accepted mesh
   skeleton's one-time cost, not a regression.
2. **`precompilePasses` — one async fullscreen pipeline** (0.57–1.34 s). The
   session's slowest creation is always `renderPipeline_MeshBasicNodeMaterial_185`
   via `compile#8` (0.56–1.32 s); the other 10 passes are cache hits or
   milliseconds. This is the post/VHS chain compiling in its real target, which
   the live draw traversal cannot reach.
3. **`zombies+rooms` — CPU body build** (0.86–2.3 s). CPU profile self-time:
   `sdBody` ~1.7 s, `boneBreach` ~2.1 s, `sdPrimitive`/`sdBentCone`/`sdBezierTs`
   the rest. This is `build-body.ts`'s containment filter (line 100) plus
   `validateBody`'s `checkBoneContainment` — always-on correctness checks over
   the authored SDF.
4. **`goo` precompile** 0.11–0.35 s, **crowd tile-bin warm** 12–33 ms
   (7 types), **hidden-object flip** ≤0.2 ms (61 objects).
5. **Module load** 0.2–1.6 s (Vite dev; the production bundle is a single
   2.17 MB `main` chunk — see `npm run build`).

## 3. Carve: not invoked by default; 22.3 s when it is

`?gibrender=carve` is the only boot trigger (`game-main.ts` `if (gibRenderMode
=== 'carve') setTimeout(ensureCarvedLibrary, 0)`). Proof of the boundary:

- Default URL: `__sdfGame.gibRenderer()` returns
  `{ mode: 'march', carvedLibraryBuilt: false, carvedBuildMs: 0 }` in every
  default boot; no `[gib-carve]` console line ever appears.
- Explicit `&gibrender=carve`: `carvedBuildMs = 22270.7 ms`, console line
  `[gib-carve] zombie library: 11 pieces, 38738 verts, 68 bone prims in the
  field, 22271 ms (cells 1)`, and `gibRenderer()` reports
  `{ mode: 'carve', carvedLibraryBuilt: true, carvedBuildMs: 22270.7 }`.

The carve build is **synchronous main-thread CPU**, and because it is scheduled
with `setTimeout(0)` it fires inside the warm's `await gooLayer.precompile()`
macrotask slot — which is why that boot's `goo` phase reads 22,558 ms. A second
warm on the same page (the lifecycle check) took 974 ms, proving the 22.5 s was
the carve build, not goo. **The historical ~19.7 s the owner remembered is this
build, and it applies to `gibrender=carve` only.** It is not on the owner's URL
(`?room=arena&gibbones=core` has no `gibrender`), so it is not the default-mode
startup delay. Fixing it needs the carve off-thread (§10, UNRESOLVED).

## 4. Probe overflow: verified at the admitted maximum

`__sdfGame.probeDynamic().gates.capsules` is the **bone-row** count packed into
the gather, capped at `PROBE_MAX_BONE_INSTANCES` (1024); the producer expands it
to 2 capsules/row (2048). The live stress (`spawnCrowd`, healthy zombies in the
arena) in `captures/probe-final.json`:

| bodies spawned | bone rows packed | probe errors | dynOn | lights | gather frames gained / 1.8 s |
| ---: | ---: | ---: | --- | ---: | ---: |
| 6 | 490 (≈ owner's 515) | **0** | true | 1–3 | 15 |
| 9 | **1024 (cap)** | **0** | true | 3 | 9 |
| 12 | **1024 (cap)** | **0** | true | 1 | 5 |
| 20 | **1024 (cap)** | **0** | true | 1 | 3 |

1024 rows → 2048 capsules is exactly the allocation the `fdf20ad0` fix sized;
before the fix `packCapsulesFromBoneInstances` would have thrown at 1030
capsules (the owner's 515 rows). `probeDynamic().errors` stayed 0, `bound: true`,
`radianceGain 0.15`, `visStrength 1`, and the gather kept ticking (`frames`
advancing) — no silent freeze and no silent truncation. The unit tests cover the
reported 515-row and full 1024-row inputs directly (§7).

**Cost of the formerly-thrown work**: with 12–20 bodies near the room the gather
now does the work it used to abort, and the frame p95 in that window rises to
1.0–2.3 s (from 0.35 s at 490 rows). That window also includes spawning 20–47
actors, so it is an upper bound, not a clean gather delta; it is still the
honest measure that the intended gather is expensive at maximum occupancy and
was never actually paid before.

## 5. The first-gib / repeated-action freeze (reproduced, attributed, not fixed)

Blast timeline from `captures/probe-*.json` (live loop, real sim; poll granularity
50 ms, so the first-chunk figure is an upper bound set by poll alignment):

- first visible chunk: **0.08–1.3 s** after `detonate` (`live` jumps to the 64 cap);
- first worker bake submit: **2.8–5.3 s** after the blast;
- first bake swap (main-thread upload): **0.4–1.7 ms** — the worker is not the hitch;
- worker CPU bake: **156–977 ms**; first textured-head bake: **3.3–8.1 s** after the blast.

The long frames during blasts name **17–23 pipeline creations each**
(300–758 ms frames). Repeated-blast p95 was load-dependent and ranged 42–758 ms
across boots, with the two highest-actor runs at 690 and 758 ms. The new
duplicate detector (`pipelineLog().duplicates`) shows why: the same 8
`MeshStandardMaterial` pipelines, with **byte-identical descriptor signatures**,
are rebuilt **12 times per session** (`firstFrame` = the warm, `lastFrame` ≈ 306,
i.e. across room entry, the first shot and every blast). The GPU pipeline is
identical; three.js still calls `createRenderPipeline` because the cache key
(`stageVertex.id,stageFragment.id,backend.getRenderCacheKey`) is re-keyed or its
entry evicted — most plausibly by the shell/dynamite-prop/room mesh churn
removing and re-adding RenderObjects (`usedTimes → 0` releases the pipeline).
This is a real, reproducible defect, and the fix is a mesh/material-lifetime
change, not a warm-up one; it is recorded as UNRESOLVED with a reproduction.

## 6. WebGPU loss and uncaptured errors

New device-health capture in `lab-renderer.ts` (`device.lost`,
`device.onuncapturederror`, exposed as `__sdfGame.gpuDiagnostics()`):

| run | lost | uncaptured | page errors |
| --- | --- | --- | --- |
| coldA / warmA / coldB / warmB | null | 0 | [] |
| after-main / final | null | 0 | [] |
| carve / dupcheck | null | 0 | [] |

**Device loss did not reproduce** in any of the six controlled boots or the
extra action/carve runs. Diagnostics are retained, so if the owner's loss
recurs, `__sdfGame.gpuDiagnostics()` now carries the reason, message and time.
One benign `index count of 0` draw warning and one 404 resource load appeared;
neither is a render/validation error.

## 7. Changes made (FIXED)

| # | Change | File | Why |
| --- | --- | --- | --- |
| 1 | **Honest loader gate.** The 15 s bound no longer resolves the gate on its own; on a timeout the loader says it is still compiling, the loop stays paused, and READY + auto-hide happen only when `warmPipelines()` actually settles. | `webgpu/game-main.ts`, `webgpu/warm-gate.ts` | The old `Promise.race` reported READY and hid the loader while warm-up still ran with the loop paused — the "loaded, then frozen" window. |
| 2 | **Warm restores the loop state it found**, via `restoreLoopState(wasRunning)`, instead of `setLoopRunning(true)` in `finally`. | `game-main.ts`, `warm-gate.ts` | A bench/rig that deliberately paused the loop was silently restarted by a late warm completion. Verified live: `rewarm()` with the loop paused leaves `loopRunning()===false`. |
| 3 | **Boot phase marks + warm sub-phases.** `__sdfGame.bootMarks()`, `warmDone()` (with `phases`, `bootBeforeWarmMs`, `flippedNames`); `ms` is now the sum of the warm's own sub-phases. | `game-main.ts` | There was no way to separate boot phases from warm steps; the old single number could not be broken down. |
| 4 | **Device diagnostics**: `device.lost` / `onuncapturederror` capture, `loopRunning` getter, `gpuDiagnostics` on the handle. | `lab-renderer.ts` | There was no device-loss evidence channel at all. |
| 5 | **Pipeline duplicate detector**: every creation records a descriptor signature; `pipelineLog().duplicates` ranks identical pipelines built more than once. | `pipeline-log.ts` | Names alone cannot distinguish a legitimate context variant from cache thrash. |
| 6 | **Probe-gather / gib / session observability**: `chunkStats().faceBaked`, `gibRenderer()`, `rewarm()`. | `game-main.ts` | Needed to separate the first textured-head draw, prove the carve boundary and exercise the loop-restore contract. |
| 7 | **`scripts/startup-freeze-probe.mjs`** (new). | `scripts/` | The focused startup + first-gib probe the task asked for. |

Lifecycle contract tests: `warm-gate.test.ts` (3 tests) pins the loader
decision and the restore rule. Live integration: the probe's `lifecycle` check
returned `{ loopAfterRunningWarm: true, loopAfterPausedWarm: false }` on the
real warm path — the assertion that would have caught the unconditional
restart. The timeout branch of the loader gate is unit-tested, not
live-triggered (no boot approached the 15 s bound in this window).

### Tests and build

```
npx vitest run src/lab/sdf-zombie/probe-dynamic.test.ts \
  src/lab/sdf-zombie/probe-dynamic-cull.test.ts \
  src/lab/sdf-zombie/webgpu/probe-gather-workgroup.test.ts \
  src/lab/sdf-zombie/webgpu/probe-dynamic.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/probe-grid.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/probe-lighting-node.test.ts \
  src/lab/sdf-zombie/webgpu/warm-gate.test.ts
# 7 files passed, 102 tests passed (Node v22.22.1)

npm run build   # tsc --noEmit && vite build — exit 0, ✓ built in 8.46s
```

### Before / after

The two fixes are lifecycle correctness, and the reproducible warm duration is
dominated by machine load, so **no timing improvement is claimed**: warm steps
spread 2.3–5.0 s across the pre-change boots and 2.3–5.7 s across the post-change
boots, and repeated-blast p95 stayed in the same load-dependent range. What
changed is behaviour under the pathological conditions: a
warm-up slower than 15 s no longer produces a fake READY, and a paused loop
stays paused. The owner's 38.9 s and the blast-frame p95 remain open (§10).

## 8. Retained appearance (native vision)

Captured with the accepted rupture rig on this branch
(`RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=16`), then opened with the native
viewer — not read from filenames. Telemetry matches the accepted Task 4 numbers
exactly (`f11` body rot 54.8°, release `f12` chunk rot 59.4°, spin 4.63 rad/s,
16 chunks, tier `parts`). Artifacts:
[`captures/rupture-preserved-sheet.jpg`](captures/rupture-preserved-sheet.jpg),
`-onset/-f11/-f12/-f15.jpg`, `rupture-preserved-telemetry.json`.

- **f0 onset** — intact posed zombie, arms down, head/face intact.
- **f1–f4** — the chest band lifts and a pale rib ladder opens; flesh peels.
- **f8–f11** — regions are visibly rotated apart (not upright/parallel), ribs
  exposed, and the mottled chunk surface is already present on the last window
  frame (no material pop).
- **f12 release** — chunks spawn in the *same* configuration as f11: no snap
  back to upright, no material blink.
- **f13–f15** — pieces continue turning and scatter; the head stays a distinct,
  face-bearing mass.

Mesh-skeleton default and baked optimization were untouched (`skeleton` and
`gib` defaults are not in the changed files).

## 9. FIXED vs INVESTIGATED vs UNRESOLVED

**FIXED**
1. Probe gather overflow (`fdf20ad0`, inherited and verified live): 0 errors at
   1024 bone rows → 2048 capsules; 515 rows covered by unit test.
2. Loader honesty on a slow warm (no READY before the work settles).
3. Warm-up loop restore (paused loop stays paused) — verified live.
4. Device-loss / uncaptured-error evidence channel (was absent).
5. Boot/warm/first-gib attribution instrumentation (marks, sub-phases, duplicate
   detector, gib timeline, `faceBaked`, `gibRenderer`, `rewarm`).

**INVESTIGATED (attributed with raw evidence, not fixed)**
1. Reproducible startup is 2.3–5.0 s warm + ~2–5 s boot; named costs in §2.
2. The owner's 38.9 s did not reproduce (6 boots); cold profile made no
   difference; no device loss. Prime remaining hypothesis: GPU-process
   contention/loss at the time of the report.
3. Carve is opt-in only; explicit cost 22.3 s synchronous CPU (§3).
4. First-gib/repeated-action freeze: 17–23 pipeline creations/frame from the
   same 8 pipelines rebuilt ~12× (byte-identical descriptors) — §5.
5. Gather cost at maximum occupancy: 1.0–2.3 s frame p95 in the stress window.

**UNRESOLVED**
1. The 38.9 s one-off — needs the owner's contended / GPU-process-restarted
   conditions to reproduce; diagnostics are now in place.
2. Pipeline-cache churn during room entry/shots/blasts. Reproduction:
   `pipelineLog().duplicates` after a blast. Fix direction: stop the
   shell/dynamite-prop/room mesh churn that evicts three's pipeline entries
   (pool the meshes) rather than warming more pipelines.
3. Carve's 22.3 s synchronous build. Needs an owned worker (or a reusable baked
   library) — a deliberate scheduling change, not a timing tweak. Not started.
4. Reproducible blast-frame p95 ~700 ms, unchanged by this task.

## 10. Limitations

- Single machine, one GPU (Apple M3), all samples from one session window under
  load average 3.9–6.1; medians/spreads are reported, not single samples.
- Headless Chrome 152 at 960×720 DPR 1 is not the owner's headed window; GPU
  driver behaviour under a contended browser GPU process may differ (this is the
  leading explanation for the unreproduced 38.9 s).
- `probeDynamic().gates.capsules` is the bone-ROW count despite the name
  (rows × 2 = capsules). Left as-is to avoid disturbing the panel/tests.
- The loader-timeout branch was unit-tested, not live-triggered.
- The `spawnCrowd` gather-stress frames include the spawn itself; they bound the
  gather cost rather than isolating it.
- No owner playtest: model inspection and native-vision captures are not
  acceptance. No merge or push was performed.
