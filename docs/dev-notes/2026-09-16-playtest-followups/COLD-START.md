# Cold-session startup pause — attribution and the body-build memo (task 1)

2026-09-16 playtest follow-ups, task 1. Worktree
`2026-09-16-blud-playtest-followups-task-1`, branch
`codex/playtest-followups-task-1`, from **`ed97cd14`** (`claude/dynamite-weapon-slot`).
Fix commit **`b8636ffc`**. Node `v22.22.1`. Google Chrome **152.0.7977.84**,
Apple M3 (10 GPU cores), 24 GB, macOS 26.3.1. Baseline defaults:
`/sdf-game.html` (mesh skeleton, crowd ON, res `800` render target, shipped
upscale stage on). No merge, no push; the owner's servers on 5391/5415 and
their Chrome were never touched.

## 0. What the owner reported vs. what was actually measured

Owner: *"Random long pause on cold start, but subsequent reloads smoother."*

Measured (fresh Chrome profile, headed, 1512×982 DPR 2, `seed=7`, 3 loads per
profile — load 0 is the first-ever navigation, loads 1–2 are same-session
reloads):

| arm (n fresh profiles) | cold READY | reload-1 READY | cold-only premium |
| --- | ---: | ---: | ---: |
| before, 6 samples | **4 074 ms** mean (3 928–4 384) | **3 817 ms** mean (3 764–3 875) | ~210–260 ms |
| after, 3 samples | **3 698 ms** mean; **3 290 ms** excluding one contended run | 3 361 ms mean; **3 138 ms** excluding that run | ~150 ms |

**The cold-vs-reload gap is real but small (~150–260 ms, ~5 %).** It is *not*
the body build and *not* the mesh extraction: both cost the same on the first
load and on every reload (see §2). It is the first-use / first-session caches —
module HTTP/V8 and WebGPU shader-compile warmup: cold transfers 239 requests /
**17.03 MB** (`transferSize`) and the reloads 238 / **110 KB** revalidated
(17.02 MB `encodedBodySize`, i.e. localhost 304s), worth only ~60 ms of
`backend`.

What actually dominates the pause is **load-invariant blocking work that runs
before the loader says READY on every load** (~3.8–4.1 s), and the single
largest fixable piece of it was the per-actor body build. §4 shows the fix
removing ~0.74 s of it on both the cold and reload paths.

The owner's random 38.9 s one-off and WebGPU device loss did **not** reproduce:
18 cold-start loads + 1 full freeze-probe run, `gpuLost` null / `uncaptured 0`
every time, no page errors (§9).

## 1. Protocol

- Owned Vite (`--strictPort`) on **5490**, owned Chrome on CDP **9490**,
  scratch and profiles under `.lab-tmp/` (gitignored). One GPU job at a time;
  the owner's 5391/5415 and the dispatch sibling's 5403 were left alone.
- Primary matched set: headed Chrome, fresh `--user-data-dir` per run,
  `http://localhost:5490/sdf-game.html?seed=7` at 1512×982 DPR 2 (the owner's
  headed-equivalent), `LOADS=3`.
- **Matched A/B under identical instrumentation**: the memo is disabled with
  `?bodycache=0` on the *same build*, so only the memo differs. before =
  `bc0-1..3` (`?bodycache=0`), after = `bc1-1..3`. `cold-h1..3` (no
  instrumentation, committed HEAD before the fix) corroborate the before arm's
  timings. Background load at run start: 3.30–5.08 (OrbStack/Spotlight/user
  Chrome); every number is reported raw with its load.
- Tooling: [`scripts/cold-start-probe.mjs`](../../../scripts/cold-start-probe.mjs)
  (per-load boot marks, warm sub-phases, extraction counters, long tasks, rAF,
  CDP CPU profile, resource census) and
  [`scripts/summarize-cold-start.mjs`](../../../scripts/summarize-cold-start.mjs)
  (→ `matrix.json` + compact records). Raw evidence:
  [`captures/cold-start/`](captures/cold-start) (`matrix.json`,
  `bc0-*.compact.json`, `bc1-*.compact.json`, `cold-h*.compact.json`,
  `first-actions-follow1.json`, `shot-{off,on}-arena.jpg`).

## 2. Attribution (before the fix)

Boot marks are `performance.now()` pushes inside `main()`; deltas in ms,
one representative cold load (`bc0-2`):

| phase | before (bc0-2) | after (bc1-2) |
| --- | ---: | ---: |
| `room-probes-start -> player-start` (spawnAll: body build + GPU view) | **869** | **130** |
| `mesh-sync-start -> mesh-sync-end` (`SegmentMeshCache.get` extraction) | 786 | 762 |
| `mesh-sync-end -> warm-draw-once-done` (rest of the live draw path) | 826 | 873 |
| `warm-draw-once-done -> warm-precompile-done` | 579 | 594 |
| total READY | 3 978 | 3 302 |

Boot CPU profile (self-time, ms; cold load):

| function | before | after |
| --- | ---: | ---: |
| `validate.ts sdBody` | **426** | **38** |
| `pipeline-log.ts device.createShaderModule` (wrapping `device.createShaderModule`) | 325 | 334 |
| `validate.ts boneBreach` | 186 | (out of top) |
| `validate.ts sdPrimitive` | 181 | 76 |
| `skeleton-spike/contract.ts distance` | 146 | 132 |
| `validate.ts sdBentCone` / `sdBezierTs` / `at` | 137 / 98 / 90 | 135 / 84 / 94 |
| total | 3 971 | 3 291 |

**Root cause of the biggest block.** `spawnAll` spawns 23 actors (19 zombie +
4 soldier across `ROOMS`). `buildCharacterBody` ran the *whole deterministic
pipeline per actor*: `parseBlob` + `compileFace` + `compileCharacter` +
`buildBody`, and `buildBody` derives bones and runs the containment checks
(`boneBreach` per derived bone + `validateBody`'s whole-body SDF scans). A
local benchmark measured **26 ms per zombie build and 43 ms per soldier
build** (23 builds = 0.67 s); with the caller-side face/`.blob` compile the
spawn block was **~0.86 s**. This is why every profile's top self-time was
`validate.ts` SDF evaluation, not module loading.

**The second block is the extraction and it is unchanged.** 39 unique segment
meshes are extracted per load (`extractCount=39`, shared by revision across all
23 actors): `extractMs` **700–790 ms** on cold *and* on every reload, the
single worst key `zombie:axial:1-2:33:d25a5fde@0.01` at **515–580 ms**. Warm
lookups are trivial, and severing does not invalidate the cache (prior
finding, still true). It is behind the loader, not a post-READY play freeze.

**No post-READY freeze was found.** After READY, the 2.5 s live sampler reads
p50 17 ms / p95 17–18 ms / max 18–33 ms in every uncontended load, before and
after.

## 3. The fix (`b8636ffc`)

`BodyBuildCache` (build-body.ts) is a signature-keyed memo around an explicit
builder; `buildCharacterBody` (character-view.ts) memoizes its pre-translate
half on a key of **every input that can change the body**: character name +
`entry.src.length`, the face params, the bone ratio, and the `BodyOverride`
JSON. The first zombie and first soldier build once; the other 21 actors hit.
Callers still receive a per-actor body because `translateBody` copies every
mutable array — the cached value is never handed out as a mutable actor body,
so severing/rigging cannot corrupt it. Invalidations are structural (a changed
`.blob`/face/ratio/override is a different key); a page load rebuilds the cache
with the registry. Entries hold CPU-only structures and carry no GPU
resources, so nothing is disposed per entry; `clearBodyBuildCache()` is the
test seam.

`?bodycache=0` disables the memo (always build) for a matched A/B. New
diagnostics: `SegmentMeshCache.stats()` (`extractCount/extractMs/first,last
ExtractAt/maxExtract*`) exposed as `__sdfGame.skeletonMesh().cacheStats`, and
`__sdfGame.bodyBuild()`; plus one-shot `mesh-sync-start`/`mesh-sync-end` boot
marks. The instrumentation adds one `performance.now()` per cache miss and two
`bootMarks` pushes per page; no shader hashing was added.

Measured effect: memo `misses=2, hits=21, buildMs=77–101 ms` per load (vs 23
builds / ~670 ms before). **The work is removed, not moved** — it was already
before READY, and both user-visible readiness and total boot shrink.

## 4. Matched before/after

Cold load (first-ever navigation, fresh profile):

| run | load | READY ms | spawn block ms | bodyBuild buildMs / misses | mesh extractMs | long-task total ms |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| bc0-1 | 0 | 4 129 | 849 | (memo off) | 752.0 | 2 793 |
| bc0-2 | 0 | 3 978 | 869 | (memo off) | 775.5 | 2 817 |
| bc0-3 | 0 | 3 978 | 859 | (memo off) | 788.7 | 2 855 |
| cold-h1 | 0 | 4 049 | 862 | — | 753.9 | 2 891 |
| cold-h2 | 0 | 4 384 | 865 | — | — | 3 011 |
| cold-h3 | 0 | 3 928 | 869 | — | — | 2 828 |
| **before mean** | | **4 074** | **862** | | | |
| bc1-1 | 0 | **3 277** | 121 | 77.4 / 2 | 703.3 | 2 027 |
| bc1-2 | 0 | **3 302** | 130 | 83.4 / 2 | 752.3 | 2 136 |
| bc1-3 | 0 | **4 516** † | 153 | 94.1 / 2 | 1 034.4 † | 2 980 † |
| **after mean (all 3)** | | 3 698 | **135** | | | |
| **after mean (1–2)** | | **3 290** | **125** | | | |

† `bc1-3` ran contended: its per-load extraction jumped to 877–1 218 ms
(vs 700–790 elsewhere) and one load showed a 574 ms post-READY frame. The
uncontended pair is the honest after claim; the contended run is kept in the
table and in `matrix.json`.

Warm reloads agree: reload-1 READY **3 817 ms → 3 138 ms** (uncontended after),
spawn block **832 ms → 104 ms**.

Net: **spawn block −736 ms**, **loader READY −784 ms (~19 %) on the cold load**
(before mean 4 074 → 3 290 uncontended), and −679 ms on warm reloads. The fix is
identical on both because the work it removes was load-invariant.

## 5. First shot / blast / bake unchanged (regression check)

Ran the existing `startup-freeze-probe.mjs` once post-fix on the prior matched
rig (`?room=arena&gibbones=core&pipelinelog=1&seed=7&crowd=1&vhs=blud&res=800`,
960×720 DPR 1, canvas 800×600): [`first-actions-follow1.json`](captures/cold-start/first-actions-follow1.json).

- warm 2 306 ms (drawOnce 1 623, precompile 608); clean blast behaviour
  preserved: repeated shots 2 creations / p95 34.8 ms / 0 long frames; repeated
  blasts **1 creation / p95 31.9 ms / 0 long frames**; first detonation
  4 creations / 0 long frames (the accepted `d393d682` result).
- gib timeline: first visible chunk 188 ms, first worker bake submit 2 129 ms,
  main-thread swap 2 484 ms (worker 216 ms, swap 0.6 ms), first textured head
  draw 3 683 ms — the worker and swap are still not the hitch.
- capsule diagnostics: `errors 0`, `bound true`, `dynOn true` at 395 / 935 /
  1024 bone rows.
- No device loss, `uncaptured 0`, no page errors.

## 6. Tests and build

```
npx vitest run <11 files: probe-dynamic, probe-dynamic-cull, probe-gather-workgroup,
  probe-dynamic.wgsl, probe-grid.wgsl, probe-lighting-node, warm-gate, pipeline-log,
  build-body-cache, character-view, skeleton-spike/mesh>
# 11 files passed, 157 tests passed (Node v22.22.1)
npm run build   # tsc --noEmit && vite build — exit 0, ✓ built in 5.23s
```

`build-body-cache.test.ts` pins the memo's safety properties: one build for
repeated actors, a hit returns the same untranslated body, every caller still
gets its own translated body, a face change misses, and a cached body deep-equals
an uncached one. `mesh.test.ts` re-verified cache identity/disposal and real
segment extraction.

## 7. Visual check (native vision)

Two fresh-profile captures with identical framing (arena, nearest body id 17),
one per arm: [`shot-off-arena.jpg`](captures/cold-start/shot-off-arena.jpg)
(`?bodycache=0`) and [`shot-on-arena.jpg`](captures/cold-start/shot-on-arena.jpg)
(memo on). Read natively, both show the arena with **intact, face-bearing
zombies** — head/skull with face texture, both arms with exposed bone mesh and
intact hands, legs and torso present; the background horde bodies render too.
The two frames differ only in wander/animation phase (separate runs), not in
body structure. HUD: `bodies 5/23 · arena · probe 0.75`, `t16 rgb, step 11000`.
No missing, duplicated or half-built actor appears in either arm. This is not a
pixel A/B (animation timing differs) — the structural equality is separately
pinned by the deep-equality test in §6.

## 8. FIXED vs ATTRIBUTED vs UNRESOLVED

**FIXED**
1. Per-actor body build/containment validation: 23 builds → 2 per load;
   spawn block 862 → 135 ms mean; cold READY −784 ms (~19 %) uncontended;
   same gain on warm reloads.

**ATTRIBUTED, NOT FIXED**
1. `SegmentMeshCache` extraction: 39 meshes / **700–790 ms** every load
   (load-invariant), worst single key 515–580 ms. A build-time precomputed
   mesh asset (revision-keyed, hydrate before the warm drawOnce, sync-extract
   fallback on mismatch) is the next step; not attempted here because the
   closure-based segment field needs a real bake pipeline, which is a rewrite
   the task told us to prefer not to make.
2. Shader/pipeline compile inside `drawOnce`+`precompile`: ~1.4 s combined
   (`device.createShaderModule` 325–334 ms self-time alone). Load-invariant
   and deliberately behind the loader by the warm design.
3. The residual warm hidden-mesh flip re-key (six `MeshBasicNodeMaterial_185/
   195–199` pipelines, 5 creations / 4 releases, sub-10 ms) — unchanged from
   the prior report and not a long frame.

**UNRESOLVED**
1. Owner's random 38.9 s one-off and WebGPU device loss: not reproduced in 18
   fresh-profile loads + 1 freeze-probe run; `device.lost`/`uncaptured-error`
   diagnostics remain in place.
2. The cold-only premium itself (~150–260 ms) is first-session browser/V8/shader
   cache warmup; there is no app-level change that removes it without shipping
   a production bundle or pre-warming caches, neither of which is in scope.

## 9. Limitations

- One machine, one GPU (Apple M3), measured under unequal background load
  (3.30–5.08). The ~0.74 s effect is far larger than the run-to-run spread and
  is identical in all six before and all three after runs, but the absolute
  READY numbers are not contended-free and are reported raw.
- `?bodycache=0` bypasses the memo, so the before arm's `bodyBuild` counters
  read 0; the **spawn-block mark delta** is the before/after attribution, not
  the counter.
- Headed Chrome with `Emulation.setDeviceMetricsOverride` at DPR 2 is the
  owner's headed-equivalent viewport, not their literal window; the canvas
  render target is fixed at the res `800` rung (800×600), only presentation
  scales.
- No production-preview arm was run: the measured cold/reload delta was only
  ~200 ms and the fix is in runtime code, so a bundle arm would separate
  module startup from runtime without changing the fix. Recorded as not done.
- No owner playtest; no merge or push.
