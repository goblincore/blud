# march.wgsl.ts split — Task 1 (golden gate + leaf modules)

Plan: `docs/superpowers/plans/2026-09-18-march-wgsl-split.md`
Spec: `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md` (phase 1)

This is a MOVE-ONLY refactor: every export keeps its exact name and exact
string value; `march.wgsl.ts` becomes a barrel. The sha1 golden snapshot
(`src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap`)
was written at `11fffe13` before the first move and must never change.

## Step 2 — baselines (base commit `11fffe13`, shader text unmodified)

`scripts/march-hash.mjs` (headless Chrome + vite on 5323/9323, fresh
`.lab-tmp` profile). Exact-float readback of the march target:

```json
{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
```

`room1` matches the script's pinned `DEFAULT_HASH`; `room1-repeat == room1`
(determinism proof holds); `room1-wounded != room1` (the gate sees the wound).

Room 2 (crowd-parity diagnostic, `MARCH_HASH_ROOM=2`). `march-hash.mjs` runs
its shipped-default canonical pin even under `MARCH_HASH_ROOM=2`, where the
captured hash is room 2's and cannot equal the room-1 pin — a script
limitation. There are two ways to bypass the pin; the URL-neutral one is
`MARCH_HASH_TILES=0` (it skips the pin and, unlike `MARCH_HASH_TILES=1`, never
calls `setTiles`, so the scene is the page default). Baseline, URL unchanged:

```json
{"room2":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5","room2-repeat":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5"}
```

One baseline sample taken with the other bypass (`MARCH_HASH_QUERY=upscale=0`,
which appends a duplicate `upscale=0` to the URL) read `76ada45a…`. That value
never reproduced: the URL-neutral baseline and every after run give
`35b6d561…`. Room 2 is the diagnostic, not the pinned canonical (the script's
header only pins room 1), so treat room 2 as a repeat-stable but
boot-sensitive instrument and compare like-for-like URLs.

Cold-boot (`scripts/boot-time.mjs`, own vite + headless Chrome, FRESH
`--user-data-dir` per run, waits for `__warmGate.phase === 'ready'`):

| run | drawOnce (ms) | warmMs |
| --- | ---: | ---: |
| 1 | 1261.6 | 2579 |
| 2 | 1242.5 | 2549 |

`drawOnce` is `__warmDone.phases.drawOnce`; `warmMs` is `__warmDone.ms`.

## Sizes before

| file | bytes | lines |
| --- | ---: | ---: |
| `webgpu/march.wgsl.ts` | 277753 | 4800 |

## Step 7 — after

### Golden gate

Snapshot unchanged since `11fffe13` (`git diff 11fffe13 HEAD -- <snap>` is
empty); `npm test -- march-golden` passes. Every string export, the joined
`HELPERS`, and the export-name set are byte-identical.

### Pixel gate (`scripts/march-hash.mjs`)

Room 1 (pinned canonical), after:

```json
{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
```

Identical to Step 2 in all three fields.

Room 2 (URL-neutral `MARCH_HASH_TILES=0`, three fresh-Chrome runs):
`35b6d5619f7f85a52e852056a09f6c0fbfacf2c5` every time, with
`room2-repeat == room2`. Identical to the Step 2 URL-neutral baseline.

### Cold boot — interleaved A/B (code vs thermal drift)

The after-state sample taken right after the pixel gate read higher
(`drawOnce` 1630/2314 ms) than the early Step 2 numbers (1243/1262 ms), but the
shader text is provably byte-identical. To separate code from machine state the
base commit `11fffe13` was checked out into a temporary worktree (same
`node_modules` symlink, same `boot-time.mjs`) and run interleaved with the
after tree, three pairs, both on fresh profiles:

| pair | base drawOnce | after drawOnce | base warmMs | after warmMs |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2487.9 | 2861.3 | 135434 | 6392 |
| 2 | 2910.8 | 2772.5 | 5712 | 6475 |
| 3 | 2617.9 | 2375.7 | 6732 | 5588 |

`drawOnce` distributions overlap (base 2376–2911, after 2376–2861) — no code
effect. `warmMs` is dominated by driver shader-cache state: one base run hit a
135 s cold compile (the documented 104 s-class regression), the rest sat at
5.6–6.7 s for both trees. The Step 2 drawOnce of ~1.25 s was simply a faster
machine state than the A/B window; the controlled comparison is the A/B, and it
shows after within noise of base.

The temporary worktree was removed; `git worktree list` no longer shows it.

### Sizes after

| file | bytes | lines |
| --- | ---: | ---: |
| `webgpu/march.wgsl.ts` (barrel) | 229859 | 3869 |
| `webgpu/march/layout.ts` | 9103 | 165 |
| `webgpu/march/math.wgsl.ts` | 3168 | 70 |
| `webgpu/march/primitives.wgsl.ts` | 30839 | 611 |
| `webgpu/march/melt.ts` | 3628 | 64 |
| `webgpu/march/shade-helpers.wgsl.ts` | 3697 | 72 |

Barrel: 277753 → 229859 bytes, 4800 → 3869 lines.

### VERIFY

`npx tsc --noEmit && npm test -- march crowd-atlas crowd-records deferred-sdf
game-actor-bounded-wounds normal-gradient surface-nets write-wounds zombie-gpu`
→ 2 failed / 407 passed. Both failures pre-exist the move and reproduce on the
untouched base (`march.wgsl.ts` restored from `11fffe13`, `layout.ts` removed):

- `march-step-soundness.test.ts` — 1 test (`at06.hit` expected true).
- `surface-nets-cpu.test.ts` — 1 test (band coverage 0.01189 > 0.01).

The task brief named only `game-actor-torso-slug` as a known failure; these two
are additional pre-existing failures on this branch base, not regressions.
`march.wgsl.test.ts` (240 tests) stays green.

### Forced test-pointer edit

`march.wgsl.test.ts` reads `./march.wgsl?raw` to pin the `ROW_PRIM_CLIP`
docstring ("no longer documents w as spare"). That docstring moved to
`layout.ts` with its declaration, so the raw-source pin now reads both modules
(`moduleSource + layoutSource`). The assertion itself is unchanged; Task 3 moves
this test next to `layout.ts`. No other importer or test was edited.

### Circular-import check

No `march/*` module imports `../march.wgsl`. `primitives.wgsl.ts` imports only
`./layout`; `melt.ts` imports only `../../gib-look-tuning`; `layout.ts`,
`math.wgsl.ts` and `shade-helpers.wgsl.ts` import nothing. Only the golden test
(and the other importers) read the barrel.

---

# march.wgsl.ts split — Task 2 (fields, map, cone march, helpers, body)

Branch `dispatch/2026-09-18-march-split-2`, base `3b75b2a8` (Task 1 merged).
Same MOVE-ONLY contract: golden snapshot unchanged since `11fffe13`.

## Module map after Task 2

`march.wgsl.ts` is now 103 lines: 20 `export *` lines plus its header comment
(the wgslFn parse rules, copied to `march/README.md`).

| module | bytes | lines |
| --- | ---: | ---: |
| `march.wgsl.ts` (barrel) | 6009 | 103 |
| `march/layout.ts` | 9103 | 165 |
| `march/math.wgsl.ts` | 3168 | 70 |
| `march/primitives.wgsl.ts` | 30839 | 611 |
| `march/melt.ts` | 3628 | 64 |
| `march/shade-helpers.wgsl.ts` | 3697 | 72 |
| `march/fields/carves.wgsl.ts` | 6599 | 122 |
| `march/fields/wounds.wgsl.ts` | 13128 | 231 |
| `march/fields/tissue.wgsl.ts` | 3126 | 62 |
| `march/fields/volume.wgsl.ts` | 6678 | 110 |
| `march/fields/groups.wgsl.ts` | 16704 | 286 |
| `march/fields/bones.wgsl.ts` | 8346 | 145 |
| `march/map-body.wgsl.ts` | 15540 | 266 |
| `march/cone-march.wgsl.ts` | 11972 | 230 |
| `march/body/params.wgsl.ts` | 14460 | 278 |
| `march/body/trace.wgsl.ts` | 85392 | 1373 |
| `march/body/face.wgsl.ts` | 11161 | 175 |
| `march/body/surface.wgsl.ts` | 6541 | 114 |
| `march/body/light.wgsl.ts` | 19896 | 322 |
| `march/body/entry.wgsl.ts` | 6736 | 106 |
| `march/helpers.ts` | 3415 | 52 |

Before: `march.wgsl.ts` 229859 bytes / 3869 lines.

## Golden gate

`git diff 11fffe13 HEAD -- <snap>` is empty; `npm test -- march-golden` passes.
Every string export, the joined `HELPERS`, and the export-name set are
byte-identical across all eight Task-2 commits.

## Pixel gate (`scripts/march-hash.mjs`)

Room 1 (pinned canonical), identical to Task 1 Step 2 in all three fields:

```json
{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}
```

Room 2 (URL-neutral `MARCH_HASH_ROOM=2 MARCH_HASH_TILES=0`), identical:

```json
{"room2":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5","room2-repeat":"35b6d5619f7f85a52e852056a09f6c0fbfacf2c5"}
```

## Cold boot — interleaved A/B (fresh profile each run)

Base worktree checked out at `3b75b2a8` (same `node_modules` symlink, same
`boot-time.mjs`), run alternately with the after tree, three pairs:

| pair | base drawOnce | after drawOnce | base warmMs | after warmMs |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1598.9 | 1371.8 | 3214 | 3137 |
| 2 | 1420.7 | 1301.1 | 2744 | 2588 |
| 3 | 1340.8 | 1651.6 | 2794 | 3799 |

Base `drawOnce` 1341–1599, after 1301–1652 — overlapping, no code effect (the
absolute level differs from Task 1's window; the controlled A/B is the
comparison). The temporary base worktree was removed.

## VERIFY

`npx tsc --noEmit` passes; the VERIFY suite is 2 failed / 407 passed at every
commit — the same two pre-existing failures documented in Task 1
(`march-step-soundness` near-wound multiplier, `surface-nets-cpu` BAND
COVERAGE).

## Forced test-pointer edit

`march.wgsl.test.ts` read `./march.wgsl?raw` for three structural pins that
Task 2 moves out of the barrel (`FOLD_GROUP`'s `gInstBurn`/`gBurnEmit`,
`CHAR_MASK`'s `fireRamp`, `MARCH_TRACE_POST`/`MARCH_BODY_LIGHT`'s `primGlow`).
A prep commit replaced those raw reads with `MARCH_TREE_SRC` — the barrel plus
every `.ts` file under `march/`, read via `readdirSync({recursive:true})`. The
assertions themselves are unchanged; Task 3 relocates them next to their
modules. The `ROW_PRIM_CLIP` docstring pin already read `moduleSource +
layoutSource` from Task 1 and is untouched.

## Circular-import check

`madge` is not installed and `npx` cannot fetch it here. Grep confirms no
`march/*` module imports `../march.wgsl` (the only hit is
`march/march-golden.test.ts`, the gate that is supposed to read the barrel).
Each new module imports its dependencies directly, so there is no cycle.


# Task 3 — feature blocks + test split (2026-09-19)

## Inventory (before any extraction)

Line numbers are `march/body/*.wgsl.ts` at base `e3077f7c`. Each block is a
contiguous run cut verbatim into `march/body/blocks/<section>/<name>.wgsl.ts`
and spliced back as `${NAME}` on its own line (block text carries no trailing
newline; the parent line keeps it), so every joined string is byte-identical.
Glue left in the parent: string openers, `let p = …`, the post-hit preamble
(hit reload, debug 11, flat-albedo seam, counter snapshot), the key/spec/fresnel
lines and the emission compose line.

| Section | Lines | Block | Contents |
|---|---|---|---|
| trace SETUP | 39–143 | `setup/tile-preload` | tile-list preload, quad-mode entry |
| | 144–165 | `setup/wound-list` | per-ray wound list |
| | 166–279 | `setup/hull-bounds` | occluder pre-pass, outer-hull entry/exit |
| | 280–325 | `setup/ray-window` | tMax, proxy-box entry, early discards, steps |
| | 326–442 | `setup/step-config` | hit epsilon + AA, noise anchor, relaxed omega, wound step mul |
| | 443–561 | `setup/start-bounds` | cone/depth-prepass/temporal start bounds |
| trace LOOP | 763–807 | `loop/debug-counters` | debug modes 4/5/8 (return before discard) |
| trace POST | 848–882 | `post/prim-material` | painted/gloss/metal/glow read |
| | 883–946 | `post/shading-normal` | rest anchor, analytic gradient, calcNormal fallback, debug 12 |
| | 947–963 | `post/wound-masks` | wound/char masks, micro-detail |
| | 964–994 | `post/tissue` | tissue ramp, viscera |
| | 996–1036 | `post/organ` | hitMat identity read, organ tint |
| | 1038–1076 | `post/mottle` | colour mottle |
| | 1080–1106 | `post/gore` | gore mask |
| | 1108–1144 | `post/soldier-meat` | soldier wound stain + meat detail |
| | 1146–1172 | `post/paint-char` | painted-prim overwrite, char mix |
| | 1174–1326 | `post/burn` | burning body, soot, skeleton show-through |
| | 1328–1370 | `post/melt` | melt / bare-bone paling |
| SURFACE_PREP | 16–47 | `surface/wet` | wetness, melt wetness, specPow |
| | 49–72 | `surface/glow` | face + per-prim glow |
| LIGHT | 23–74 | `light/flashlight` | analytic flashlight |
| | 92–137 | `light/occlusion` | scatter, AO, wound shadow, level shadow |
| | 139–173 | `light/ambient` | bounce, probe grid, bounce spot, dynamic probes |
| | 174–268 | `light/compose` | metal tint, muzzle flash, fleshLit, face flat, shoulder |
| | 281–319 | `light/display-debug` | legacy display decode, heatmaps |

`FACE_LAYER_WGSL` (`body/face.wgsl.ts`) was already its own block. Block
modules are NOT re-exported from the barrel: the golden test hashes the barrel's
export names, and blocks are internal to the body strings.

## Results (task 3)

**Blocks:** 25 feature blocks under `march/body/blocks/{setup,loop,post,surface,light}/`,
one commit each, each gated by `tsc` + the golden + the march shader-text tests.
`body/trace.wgsl.ts` 1,373 → 325 lines, `body/light.wgsl.ts` 322 → 65,
`body/surface.wgsl.ts` 114 → 62. Largest block: `post/burn` (159 lines incl. header).
What stays in the parents is glue: string openers, the post-hit preamble, the
key/spec/fresnel lines, the emission line, and the march walk itself
(`MARCH_TRACE_LOOP`'s `for` body, ~175 lines — the next candidate if phase 2
wants the walk as its own function).

Cutter lesson: the first pass located blocks by LINE NUMBER, and every block
import added at the top shifted the lines below it — the text stayed
byte-identical (golden green), but every cut after the first landed off its
feature boundary. The golden cannot see a misplaced cut, only a changed byte.
Redone from the melt commit, locating each block by its exact original line run
(must match exactly once); the interpolation counts per block then matched the
inventory (prim-material 3 row constants, wound-list 2, …).

**Test split:** `march.wgsl.test.ts` (2,790 lines) → 30 test files beside their
modules (3,177 lines incl. headers/imports) + `webgpu/march-test-support.ts`
(`MARCH_TREE_SRC`, `ALL`, `declaredName`). Support lives OUTSIDE `march/`, and
`MARCH_TREE_SRC` now skips `*.test.ts` (own commit, 240 green before the move):
a test file inside the tree would otherwise match its own needle and turn every
positive pin vacuous. The grab-bag `ported features reach the entry point`
describe is split by `it()` across the files it pins, keeping its title.
Counts: 187 `it()` declarations (240 with `it.each` expansion) and 650
`expect()` calls, before and after; sorted title lists identical.

**Gates at `fa7bd796`:**
- golden: unchanged (every barrel export, joined `HELPERS`, export names).
- VERIFY: 407 passed / 2 failed — the two pre-existing failures; 409 total as base.
- Pixel (`march-hash.mjs`, base `e3077f7c` and after, same machine):
  room1 `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d` (repeat identical, wounded
  `1381a866…`), room2 (`MARCH_HASH_ROOM=2 MARCH_HASH_TILES=0`)
  `35b6d5619f7f85a52e852056a09f6c0fbfacf2c5` — identical, and equal to the
  task-1/2 values.

**Pixel-gate false alarm (worth knowing):** three runs during this task read
room1 `b6422b41…` / repeat `9871c2c2…` ("not deterministic within boot") and
once "canonical moved: ce7045ac…", reproducibly enough to look like a code
bisect hit (it even "bisected" to the test-split commit). It was a concurrent
headless capture — a game-main dispatch agent running its own lab-servers +
march-hash on other ports, same GPU. Re-run alone, every commit gives the pinned
hashes. Never run two pixel gates at once; check for other
`--remote-debugging-port=93xx` Chromes before believing a pixel-gate failure.
