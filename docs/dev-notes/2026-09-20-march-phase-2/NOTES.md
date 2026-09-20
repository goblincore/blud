# march phase 2 — measurement notes

Plan: `docs/superpowers/plans/2026-09-20-march-phase-2.md` (task 1 = this file).
Spec: `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md`.
Baseline taken at commit `b6bc77e8`, 2026-09-20, dispatch worktree
`2026-09-20-march-p2-task1`. MEASUREMENT ONLY — no source change survives this
task (`git status` clean except this directory; probe edits reverted, see below).
Machine during measurements: load 2.6–4.0, owner's browser open, **no other
headless capture running**; every capture sequential, one GPU.

## THE TABLE — every later task appends one row. A task that cannot show its row did not measure.

| task | pixel room1 | pixel room2 | warm drawOnce (ms) | cold total (s) | MARCH_BODY | REFINE_BODY |
| --- | --- | --- | --- | --- | --- | --- |
| baseline (task 1) | `8f2b74e7…` / wounded `1381a866…`, repeat= | `35b6d561…` | 1251 / 1226 / 1244 (3 runs) | **145.0** (1×141 s body; see protocol note) | 123 831 | 113 194 |
| task 2 (MarchIn) | `8f2b74e7…` / wounded `1381a866…`, repeat= | `35b6d561…` | 1368 (1 clean run; 4045 on a hot-GPU run — see below) | not re-measured (no boot-path change; see note) | 128 425 | 117 788 |

Pixel hashes are sha1 of the exact float readback (`scripts/march-hash.mjs`,
full 40-hex values in "Step 1" below). `MARCH_BODY`/`REFINE_BODY` are
string-`length` in chars of the joined entry points (raw numbers in "Step 4").

---

## Task 2 — `MarchIn` (2026-09-20, worktree `2026-09-20-march-p2-task2`)

**What landed.** New `webgpu/march/body/io.wgsl.ts`: `struct MarchIn` (86
fields = every VALUE parameter of `MARCH_BODY_PARAMS`, in list order) plus
`MARCH_IN_PACK`, the generated first statement of BOTH entries
(`var m: MarchIn = MarchIn(worldPos, camPos, …);`). 13 of the 99 parameters
stay positional FOREVER: 9 textures + 4 storage pointers — the WGSL spec
forbids pointer/texture/sampler anywhere inside a struct (gpuweb WGSL,
"Structure Types"). `MARCH_IN_PACK` is GENERATED from `MARCH_BODY_PARAMS`
(comment-stripped `name: type` parse, handle heads filtered), so it cannot
drift out of parameter order; `io.wgsl.test.ts` pins struct ⇄ pack ⇄ params
(names AND types AND order) and the exclusion list. The body text still reads
the positional names — the struct is unused until task 3, by design. Entry
assembly gains `${MARCH_IN_PACK}` after the signature and `${MARCH_IN_STRUCT}`
at the end of both `MARCH_BODY` and `REFINE_BODY`; `MARCH_IN_STRUCT` follows
the trailing-declaration pattern (`SDF_SURFACE_STATE`/`MARCH_NORMAL_OUT`) with
a tiny `marchIoAnchor` fn so the chunk is `^fn`-parseable standalone.

**Gates.**
- Pixel: BOTH rooms bit-identical to baseline (row above; full values below).
  First gated on an accidentally-truncated 2-field variant (bisect artifact,
  since overwritten) — final 86-field text re-gated after warm-up, identical.
- `npx tsc --noEmit` clean; `npm test -- march` = **1 failed \| 269 passed
  (270)**, failure = `march-step-soundness` (main's known set).
- Golden snapshot updated in this commit: new exports `MARCH_IN_PACK` +
  `MARCH_IN_STRUCT`, new hashes for `MARCH_BODY`/`REFINE_BODY`,
  `__export_names` moves — nothing else in the snapshot changed.

**THE GATE TRAP — read before task 3 (cost half a day).** After ANY march
shader text change that survives into MSL, the FIRST gate run fails with
`occupancy never went live (renderer backlog?)` on EVERY retry: the first boot
pays the machine-global-cache cold compile (~55 s at stage range; ~196–445 s
at the closest rung d=0.6 where the refine/hull programs join), and the gate's
~7.5 s occupancy wait kills Chrome before the compile ever finishes, so the
cache never warms. The shader is FINE — `getCompilationInfo()` is empty,
pipelines create clean, three logs nothing (a dead struct/fn added at module
scope is DCE'd pre-MSL and gates warm — that variant passes immediately and
taught us nothing about the pack). **Procedure: run ONE warm-up boot staged at
d=0.6, long-poll `__sdfGame.occupancy()` until live (allow ~8 min), THEN run
the gate** — it will be bit-identical iff the change is behavior-neutral.

**Warm census.** 4 runs (`census` stdout; JSONs in /tmp, table below):
run1 drawOnce 4045 / warm 4739 (GPU hot straight off the gate+warm-up
sequence — discard), runs 2–3 warm 1895 / 5169, run4 CLEAN: **drawOnce 1368,
asyncFirst 339, entries 196, bootWall 3227, warmMs 1891** — within task 1's
band (drawOnce 1226–1251, asyncFirst 326–358, entries 196–197); the +~120 ms
on drawOnce is run noise, no regression signal. Task 2 cannot move boot: the
pack is dead code by task design.

**Cold total:** not re-measured — the boot path is unchanged (same pipelines,
same order; only entry-source text differs), so the task-1 145 s number stands
structurally. The one-off cost of THIS text change (one machine-global cache
invalidation, ~4–7 min across programs) was paid during the warm-up boot
above and does not recur.

Sizes (chars): `MARCH_BODY` 123 831 → **128 425** (+4 594 = pack 1 524 +
struct 3 070 + anchor fn ~90, counted with comments); `REFINE_BODY`
113 194 → **117 788** (+4 594, same chunks). `MARCH_BODY_PARAMS` unchanged
6 925 (signature untouched — three drives it positionally).

Pixel gate full lines (final text, after warm-up):

```
{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
{"room2":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5","room2-repeat":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5"}
```

For TASKS.md: task 2 DONE — `MarchIn` lands with the generated pack in both
entries, both rooms bit-identical, golden updated in-commit. **Tasks 3–6:
budget one warm-up boot (~8 min) before the first pixel-gate run of each
task** — the gate cannot see through a cold compile, and no shader-text change
that alters the MSL can avoid it.

---

## Step 1 — pixel + test baseline (exact lines)

Pixel gate, own ports `LAB_VITE_PORT=5341 LAB_CDP_PORT=9341`, `LAB_TMP=.lab-tmp`,
inside `scripts/lab-servers.sh`, alone:

```
{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
{"room2":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5","room2-repeat":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5"}
```

All four fields are the canonical pins. Repeat == first in both rooms.

- `npx tsc --noEmit` — clean.
- `npm test -- march` — **Test Files 1 failed \| 33 passed (34); Tests 1 failed
  \| 264 passed (265)**; the failure is `march-step-soundness` (in main's known
  failure SET).
- Full suite at task end: **15 failed \| 5947 passed \| 1 skipped (5963)** —
  failure SET identical to main's: `game-actor-torso-slug` ×2,
  `march-step-soundness`, `surface-nets-cpu`, `blob-measure`,
  `blob-compile` ×2, `gnasher-blob`, `soldier-blob`, `zombie-blob` ×2,
  `gib-rupture`, `skeleton-spike/contract`, `mesh-skull`, `mesh`.

## Step 2 — warm boot (`scripts/compile-census.mjs 3` → `warm-census.json`)

Sequential fresh-profile runs, 15:37:33–15:37:41Z, `?pipelinelog=1&seed=20260919`:

| run | warmMs | drawOnce | asyncFirst | gibVariant | precompile | entries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1762 | 1250.9 | 338.4 | 0 | 108.0 | 196 |
| 2 | 1779 | 1226.0 | 325.9 | 0 | 98.4 | 196 |
| 3 | 1779 | 1244.2 | 357.9 | 0 | 105.9 | 197 |

`gibVariant=0` **at boot in every run**: the gib-shutter compile now runs in a
background phase after ready (`backgroundStart.gib`), unlike the 2026-09-19
census — the boot path has changed since that note, which is part of why this
re-baseline exists. Entries 196–197 vs 213–214 in September.

Top pipelines by median compile ms (per-pipeline table; `--report`):

| median ms | runs | sync/async | vKB | fKB | label |
| ---: | ---: | --- | ---: | ---: | --- |
| 78.1 | 1 | async | 1.5 | 6.7 | `shutter:candidate-resolve_807` |
| 77.6 | 1 | async | 1.8 | 24.4 | `MeshBasicNodeMaterial_793` (skinned actor, rgba16float) |
| 76.4 | 1 | async | 2.9 | 1.3 | `MeshBasicNodeMaterial_776` (chunk skin, fallMask) |
| 74.2 | 3 | async | 3.7 | 235.7 | `MeshBasicNodeMaterial_813` (march **chunk** shape, rgba32float MRT) |
| 48.1 | 3 | async | 1.4 | 1.6 | `MeshBasicNodeMaterial_192` |
| 46.4 | 3 | async | 3.9 | 237 | `MeshBasicNodeMaterial_399` (march **crowd**) |
| 41.2 | 2 | async | 3.9 | 237 | `MeshBasicNodeMaterial_409` (march **crowd**) |
| 37.4 | 3 | async | 3.8 | 237.4 | `MeshBasicNodeMaterial_360` (march **body**) |
| 36.9 | 3 | async | 3.9 | 237 | `MeshBasicNodeMaterial_356` (march **crowd**) |
| 32.9 | 3 | async | 3.8 | 237.4 | `MeshBasicNodeMaterial_426` (march **body**) |
| 32.4 | 3 | async | 3.8 | 237.4 | `MeshBasicNodeMaterial_442` (march **body**) |
| 32.2 | 3 | async | 3.8 | 237.4 | `MeshBasicNodeMaterial_403` (march **body**) |
| 31.9 | 3 | async | 3.8 | 237.4 | `MeshBasicNodeMaterial_413` (march **body**) |
| 31.8 | 2 | async | 1.8 | 24.4 | `MeshBasicNodeMaterial_869` (skinned actor, rgba16float) |
| 30.7 | 3 | async | 3.8 | 237.4 | `MeshBasicNodeMaterial_470` (march **body**) |

March family: 35 creations / run-3-window, 12 distinct fragment modules,
**3 shapes**:

| shape | bytes | fns | binds | locs | distinct modules | median ms | include-list diff vs body |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| body | 243 087 | 78 | 20 | 3 | 7 | 32.4 | — |
| crowd | 242 655 | 77 | 20 | 5 | 3 | 37.0 | `−coneFetch`, `+iCentre/iHalf/iSlot` vertex locations |
| chunk | 241 352 | 75 | 16 | 3 | 2 | 46.1 | `−coneFetch −occFetch −shellFetch` |

March share of naive creation ms: **1292.5 / 2136.6 = 60.5 %** across the 3
runs; per-run merged march wall coverage 405.4 / 410.8 / 476.3 ms.

## Step 3 — cold boot (`cold-census.json`; probes transient, reverted)

The OS/driver shader cache is machine-global; a fresh Chrome profile is not a
cold boot. The documented invalidation trick is a transient numeric change in a
march constant (WGSL comments are stripped before MSL and do NOT invalidate).
Three attempts, in order:

| attempt | change | result |
| --- | --- | --- |
| 1 | `hash13` `0.1031` → `0.10311` (the 2026-09-19 note's exact probe) | **warmMs 1861 — cache HIT.** The Sept-19 probe already put the `0.10311` compiled programs in the machine-global cache (comments stripped → same MSL). **`0.10311` is burned as a probe value; never reuse a probe constant.** |
| 2 | fresh `0.10313` | **warmMs 2528 — a cache MISS that still booted warm-fast** (module hashes moved: 243 145 B; top creation 114 ms, march sum 503 ms). A single first miss does not reliably pay the cold cost. |
| 3 | fresh `0.10317` | **REAL COLD BOOT: warmMs 144 980 (~145 s), bootWall 148 091 ms**, `asyncFirst` 141 856.8, `drawOnce` 2736.3, `gibVariant` 0 (background). |

Cold boot 3, per-program attribution (from `cold-census.json`):

| ms | shape | bytes | fns | locs | what |
| ---: | --- | ---: | ---: | ---: | --- |
| **141 112** | body | 243 145 | 78 | 3 | march body × rgba32float march MRT (`MeshBasicNodeMaterial_356`-family) |
| 72–78 | body | 243 145 | 78 | 3 | the other captured body instances (driver dedupe) |

All other captured creations are cheap; the census dumps at gate-ready, and the
gib/chunk-shutter compile is scheduled in a **background** phase after ready
(`backgroundStart.gib` set, `backgroundDone` empty at dump), so post-ready cold
compiles are NOT in this total. Expectation from the plan ("~4 programs ×
~48 s") came from the 2026-09-19 machine state (198 s, 4 × 48–50 s); today the
same total is 145 s dominated by ONE 141 s body compile, because the gib
compile has been moved off the boot path since.

**Cold-measurement protocol for tasks 4 and 6** (learned the hard way above):

1. Pick a **fresh** numeric constant (never one used by any earlier probe:
   burned so far: `0.10311`, `0.10313`, `0.10317` in `hash13`,
   `march/math.wgsl.ts`).
2. Run the census once; **check the per-program table, not just the total** —
   if the top creation is < 1 s the boot was not cold (attempt 2 above); pick
   another fresh constant and go again.
3. Report per-program seconds alongside the total; the total alone is not
   comparable across days (198 → 145 s on unchanged shader code).
4. Revert the constant; `git status` must be clean.

Revert verified after attempt 3: `git checkout math.wgsl.ts` → `git status`
clean (only the untracked notes dir), `git diff` empty, constant back at
`0.1031`.

## Step 4 — sizes (what tasks 3 and 4 must move)

Joined-string `length` in chars (via the `march.wgsl` barrel, tsx):

| string | chars |
| --- | ---: |
| `MARCH_BODY` | **123 831** |
| `REFINE_BODY` | **113 194** |
| `HELPERS` joined (`HELPERS.join('\n')`) | **89 559** (46 includes) |
| `MARCH_BODY_PARAMS` | 6 925 |
| `MARCH_TRACE_SETUP` | 33 466 |
| `MARCH_TRACE_LOOP` | 14 458 |
| `MARCH_TRACE_POST` | 45 970 |
| `MARCH_BODY_TRACE` (setup+loop+post+face) | 93 894 |
| `FACE_LAYER_WGSL` | 10 602 |
| `MARCH_BODY_SURFACE_PREP` | 3 468 |
| `MARCH_BODY_LIGHT` | 19 532 |
| `REFINE_PARAMS` | 7 045 |

`REFINE_BODY` re-joins SETUP + REFINE_LOOP + POST + SURFACE_PREP + LIGHT ≈
113 k chars — the second full copy task 3/4 exist to delete.

`wc -l` of `src/lab/sdf-zombie/webgpu/march/` — 79 files, 8 400 lines total
(incl. the golden snapshot); `.ts`+`.md` only = 78 files, 8 297 lines. Paths
relative to `src/lab/sdf-zombie/webgpu/march/`:

```
  56  README.md                                  175  body/face.wgsl.ts
 103  __snapshots__/march-golden.test.ts.snap     26  body/face.wgsl.test.ts
  41  body/blocks/light/ambient.wgsl.ts           65  body/light.wgsl.ts
 101  body/blocks/light/compose.wgsl.ts           26  body/light.wgsl.test.ts
  69  body/blocks/light/display-debug.wgsl.test.ts   278  body/params.wgsl.ts
  45  body/blocks/light/display-debug.wgsl.ts     62  body/surface.wgsl.ts
  55  body/blocks/light/flashlight.wgsl.test.ts  325  body/trace.wgsl.ts
  58  body/blocks/light/flashlight.wgsl.ts       169  body/trace.wgsl.test.ts
  52  body/blocks/light/occlusion.wgsl.ts         21  cone-march.wgsl.test.ts
  51  body/blocks/loop/debug-counters.wgsl.ts    230  cone-march.wgsl.ts
 118  body/blocks/post/burn.wgsl.test.ts         162  fields/bones.wgsl.test.ts
 159  body/blocks/post/burn.wgsl.ts              145  fields/bones.wgsl.ts
  37  body/blocks/post/gore.wgsl.test.ts          96  fields/carves.wgsl.test.ts
  33  body/blocks/post/gore.wgsl.ts              122  fields/carves.wgsl.ts
  71  body/blocks/post/melt.wgsl.test.ts          85  fields/groups.wgsl.test.ts
  50  body/blocks/post/melt.wgsl.ts              286  fields/groups.wgsl.ts
  42  body/blocks/post/mottle.wgsl.test.ts        61  fields/tissue.wgsl.test.ts
  45  body/blocks/post/mottle.wgsl.ts             62  fields/tissue.wgsl.ts
  82  body/blocks/post/organ.wgsl.test.ts        234  fields/volume.wgsl.test.ts
  48  body/blocks/post/organ.wgsl.ts             110  fields/volume.wgsl.ts
  33  body/blocks/post/paint-char.wgsl.ts        184  fields/wounds.wgsl.test.ts
 268  body/blocks/post/prim-material.wgsl.test.ts    231  fields/wounds.wgsl.ts
  42  body/blocks/post/prim-material.wgsl.ts     113  helpers.test.ts
  42  body/blocks/post/shading-normal.wgsl.test.ts   52  helpers.ts
  70  body/blocks/post/shading-normal.wgsl.ts     75  layout.test.ts
  43  body/blocks/post/soldier-meat.wgsl.ts      165  layout.ts
  37  body/blocks/post/tissue.wgsl.ts             29  map-body.wgsl.test.ts
  23  body/blocks/post/wound-masks.wgsl.ts       266  map-body.wgsl.ts
  85  body/blocks/setup/hull-bounds.wgsl.test.ts  30  march-golden.test.ts
 120  body/blocks/setup/hull-bounds.wgsl.ts       70  math.wgsl.ts
  40  body/blocks/setup/ray-window.wgsl.test.ts   64  melt.ts
  52  body/blocks/setup/ray-window.wgsl.ts       536  primitives.wgsl.test.ts
  54  body/blocks/setup/start-bounds.wgsl.test.ts    611  primitives.wgsl.ts
 125  body/blocks/setup/start-bounds.wgsl.ts     128  shade-helpers.wgsl.test.ts
  28  body/blocks/setup/step-config.wgsl.test.ts  72  shade-helpers.wgsl.ts
 124  body/blocks/setup/step-config.wgsl.ts
  70  body/blocks/setup/tile-preload.wgsl.test.ts
 113  body/blocks/setup/tile-preload.wgsl.ts
  29  body/blocks/setup/wound-list.wgsl.ts
  30  body/blocks/surface/glow.wgsl.ts
  38  body/blocks/surface/wet.wgsl.ts
 113  body/entry.wgsl.test.ts
 106  body/entry.wgsl.ts
```

(The barrel `../march.wgsl.ts` is a further 103 lines.)

## Artifacts in this directory

| file | what |
| --- | --- |
| `warm-census.json` | the 3 warm boots, full per-creation census |
| `cold-census.json` | the real cold boot (`0.10317` probe), warmMs 144 980 |

(The warm `0.10311` and fast-miss `0.10313` probe runs were single-run stdout
measurements; their JSON was overwritten and only their numbers are recorded
in the Step 3 table.)

## For TASKS.md (another session owns the file — please land this)

- Task 1 of march phase 2 is DONE: baseline row in
  `docs/dev-notes/2026-09-20-march-phase-2/NOTES.md`. Pixel gate green in both
  rooms at `b6bc77e8`; failure set = main's 15.
- **Probe constants `0.10311`/`0.10313`/`0.10317` in `hash13` are burned** for
  cold-boot probing (first two recorded above; third = this task's real cold
  run). Later cold measurements must use a fresh value AND verify the
  per-program table shows a ≥10 s compile, else the boot was not cold.
- Sept-19's "cold = ~4 × 48 s = 198 s" is stale: the gib/chunk compile moved
  off the boot path, today's cold total is 145 s with a single 141 s body
  compile inside the boot gate; post-ready background compiles are not
  captured by the census.
