# GPU body-normal bake — design (2026-10-24)

Owner: the body-normal bake "is slowing things down in the pipeline … it would be ideal to bake on GPU though we
would need to match against CPU implementation … maybe write tests in CI to make sure it's aligned". Chosen over
worker threads: a WebGPU compute bake run from Node through **Dawn** (the `webgpu` npm package), with `sdBody`
kept as the reference field and a CI job that holds the two fields together.

## The problem

`scripts/bake-body-normal.ts` (spec `2026-10-21-body-normal-map-design.md`) ray-marches `sdBody`
(`validate.ts`) per texel on one CPU core: for each texel, up to 300 sphere-trace steps into the plain body
and again into the detailed body, then two 6-tap gradients, about 600+ field evaluations. Early characters
were around 200k texels against ~1,200 prims. The current bake is ~885k texels against ~3,700 prims, roughly
10x the work, and it was at ~19 CPU-minutes when it was reported. Every new `.detail` iteration pays that.

The cost is all `sdBody` evaluations, and every texel is independent: a textbook GPU job.

## What we measured (2026-10-24)

**Dawn in Node works on both machines that matter.** The probe (`.github/dawn-probe/probe.mjs`, temporary)
compiles a WGSL compute kernel, evaluates a capsule + `smin` field at 65,536 points, and compares to the same
field in JS:

| Where | Adapter | 65k points | max abs(gpu − cpu) |
| --- | --- | --- | --- |
| owner's Mac | Metal, apple-m3 | 10.7 ms (incl. first submit) | 6.8e-8 |
| GitHub `ubuntu-latest` | Vulkan, llvmpipe (Mesa 26.0.8, LLVM 21.1.8), via `apt install mesa-vulkan-drivers` | 1.1 ms warm | 8.4e-8 |

The CI recipe is three lines (apt install, `npm i webgpu`, run); the runner job took 53 s end to end.
`webgpu@0.6.2` ships prebuilt `dawn.node` for darwin-universal, linux-x64/arm64 and win32 (~20 MB per
platform). No browser, no Vite, no CDP.

**What the bake actually marches.** Every character with a `.detail` file, built with detail folded in
(base `.blob` + `.detail`):

| Character | Prims | Features beyond plain/tapered capsules |
| --- | --- | --- |
| butcher | 1313 | 331 bent, 2 chamfer, 2 carve |
| chair | 952 | 3 bent, 3 chamfer |
| deadeye | 1306 | 330 bent, 1 chamfer, 1 carve |
| flayer | 1100 | 174 bent |
| gamer | 3537 | 1 bent, 4 chamfer |
| gibbet | 1310 | — |
| gorehound | 1273 | 4 bent |
| teratoma | 1790 | 464 bent |
| twinhead | 1229 | 381 bent, 6 chamfer, 6 carve, 7 box |
| venus | 1395 | 505 bent, 2 chamfer, 4 strand |

No shells, shell warps, grooves, orientations, dead prims or head splits in any of them today, but the bake
must still handle every op `sdBody` handles (the next character may use them), so parity covers all of them.
`.detail` lines are only ever `bar` (tapered, sometimes bent capsule) and `blob` (scaled ellipsoid).

## Field audit: `sdBody` against the shipped WGSL

`sdBodyClosed` is a two-pass fold over every live cluster's prims: additive prims through `smin` /
`sminChamfer`, then carves (`smax`) and grooves (`sdGroove`). Each prim's distance is `sdPrimitive`. The WGSL
leaf functions already mirror `sdPrimitive` op for op, and say so in their comments:

| `sdBody` op (validate.ts) | WGSL (webgpu/march/) | Status |
| --- | --- | --- |
| orient (conjugate about midpoint) | `sdPrimO` | mirrored; identity quat → `sdPrim` bit-identical |
| scale divide, `minScale` | `sdPrim` / `sdPrimO` | mirrored |
| strand | `coneStrand`, `strandLip`, `strandHash4` | mirrored; reads `gWindDrift` (bake: 0, CPU `windPhase` 0) |
| box (`sdRoundBox`) | `sdPrim` prof & 8 | mirrored |
| bent cone (`sdBentCone`) | `coneBend`, `sdBezierT` | mirrored |
| plain / tapered capsule | `coneCap` | mirrored |
| shell + clip + warp (`sdShellWrap`) | `sdShell` | mirrored; pack always writes hasClip = 1 for a shell, matching the CPU's unconditional clip; the warp reads `gBodyAnchor` (bake: rest, zero) |
| `smin`, `sminChamfer`, `smax`, `sdGroove` | `primitives.wgsl.ts` | mirrored |
| carve / groove pass | `applyCarves` | mirrored (chamfer rejected on carves at compile time) |
| dead prims, skipped ops (bone, organ) | `S.w` codes in `pack.ts` | mirrored |
| head split (`splitField`) | `mapBody` piece loop | not needed: bakes are rest pose, no split |

**One real divergence.** The runtime additive fold (`fields/groups.wgsl.ts` `foldGroup`) chamfers only when
`(prof & 7) == 1`, i.e. *chamfer and nothing else*. A prim that is chamfered **and bent** (prof 3) folds
through plain `smin` on the GPU, but `sdBodyClosed` folds any `blendProfile === 'chamfer'` prim through
`sminChamfer`. `blob-compile.ts` rejects chamfer on carves and shells, but not on bent prims. The CPU field
backs click-to-shoot, so where this happens the shot field and the drawn surface disagree slightly.
**It happens in 10 of the 42 shipped `.blob`s:** dragon 1, gargoyle 3, goblin 1, goblin-home 1,
goblin-cinematic 2, goblin-cinematic-home 2, minotaur 2, ogre 4, twinhead 3, warbull 2 chamfered bent prims.
Open question 1 decides which side is right; the bake follows `sdBody` either way.

**What the bake does not reuse.** `mapBody` itself is the wrong entry point: it is the crowd- and
split-aware, wound-, volume-, noise- and tile-carrying runtime fold, has 15 parameters and a pile of private
globals, and is limited by the runtime packer (`MAX_PRIMS` 256 per body, 64 per cluster). The detail bodies
are 950–3,540 prims. The bake reuses the **leaf** WGSL (every function in the table) and adds its own
~40-line fold that is a line-for-line mirror of `sdBodyClosed`.

## Design

### Modules (renderer-free, per the plan template)

Split today's script into pure modules under `src/lab/sdf-zombie/body-normal-bake/`; the script becomes a
CLI over them.

- `regions.ts`: region setup (torso axis, `--limb`, `--torso-seg`, `--torso-axis`), row layout, and
  `nearBody` (the per-row prim cull). Moved, not changed.
- `frame.ts`: the frame math (A, f, s, ray direction per column, T/B from the plain normal) and the
  texel encode. Shared by both backends so they cannot disagree on anything except the field.
- `header.ts`: the region-table row and the `.json` sidecar. Moved.
- `cpu-bake.ts`: today's `skin` / `grad` loop over `sdBody`. The reference.
- `gpu-pack.ts`: the bake's data texture (the game's rows via `writePrimRows`, one column per prim) and the
  fold-order prim list.
- The Dawn driver is **`scripts/lib/dawn-field.ts`**, not under `src/`: it loads a native module, and nothing the
  app typecheck or the browser build sees may. (Implementation note, 2026-10-24: dawn.node 0.6.2 frees its `GPU`
  instance when it is garbage collected and the next callback into it segfaults, exit 139; the driver keeps the
  instance in a module-level variable.)
- `bake.wgsl.ts`: the kernel (below).

The texel encode stays on the CPU: the kernel returns `(nd·T, nd·B, nd·nb, hit)` as floats, so the bytes
in the PNG come from one function regardless of backend.

### Packing

The leaf WGSL reads prims from a `texture_2d<f32>` by column (`ROW_PRIM_A`, `ROW_PRIM_B`, `ROW_PRIM_SCALE`,
`ROW_PRIM_SHAPE`, `ROW_PRIM_BEND`, `ROW_PRIM_QUAT`, `ROW_PRIM_SHELL`, `ROW_PRIM_CLIP`, `ROW_PRIM_WARP`,
`ROW_PRIM_STRAND`). The bake writes the **same rows with the same writer**: `pack.ts`'s `writePrim` closure
is lifted to an exported `writePrimRows(rows, prim, index, w)`, and `packBody` calls it unchanged. That is a
pure refactor, guarded by the existing pack tests and the march golden snapshot; the zombie pin demands
those rows stay bit-identical and this cannot move them.

The bake texture is `nPrims` wide. WebGPU's default `maxTextureDimension2D` is 8192 (Dawn on Metal and
llvmpipe both report at least that), against a 3,537-prim maximum today. The bake throws a clear error past
the limit rather than splitting.

Per-row culling stays exactly as it is: `nearBody` runs on the CPU per region row and the kernel gets a
storage buffer of prim-index lists plus `(offset, count)` per row, for both the plain and detail bodies. Both
backends therefore fold the same prims in the same order.

### The kernel

One invocation per texel; workgroup 64 along the row; one dispatch per region.

- `bakeField(p, list)`: pass 1 folds additive prims (`sdPrim` / `sdPrimO`, then `sdShell` when prof & 4)
  with `sminChamfer` when the prim's chamfer bit is set, else `smin`, exactly `sdBodyClosed`'s rule. Pass 2
  does carves and grooves exactly as `applyCarves`. Dead, bone and organ prims are skipped by the same `S.w`
  codes.
- `skin` and `grad` are line-for-line ports of the script's (300 steps, hit at 1e-4, step
  `max(d * 0.9, 2e-4)`, gradient epsilon 6e-4).
- The private globals the leaf functions read (`gWindDrift`, `gBodyAnchor`, …) are declared in the kernel
  preamble at their rest values. A kernel test pins that list, so a new global in a leaf fails here with a
  clear message, not on the GPU as a bare parse error.
- Leaf strings are assembled in dependency order from their exported constants (the same strings
  `HELPERS` includes), not copied.

**Precision.** The kernel is f32 and the CPU f64. Near the body, |p| < 2.5 m, so f32 resolves about 2e-7 m,
well under the 1e-4 hit threshold. The 6e-4 central difference loses about 1e-4 relative accuracy in the
normal, which is about 0.01 of an 8-bit code step. Expected disagreement is grazing-angle texels where the
two marches pick different hits, and ±1 encode rounding.

### CLI

`npx tsx scripts/bake-body-normal.ts <character> … [--cpu]`. The GPU is the default. With no adapter (no
GPU, no driver), or with `--cpu`, the script runs the CPU reference and says which it used. The `.json`
sidecar records `backend` and the adapter description, so a reviewer can see how a committed map was made.

### Optional: worker threads for the fallback

Splitting `cpu-bake.ts`'s rows across `worker_threads` gives the reference path the ~6–8x from the original
suggestion. It is independent of everything above and lands last, only if the CPU path is still used in
practice (dispatch agents without a GPU).

## Tests

All GPU tests live in `*.gpu.test.ts`, are left out of the default vitest include, and run in a dedicated
CI job. Locally they run with `npm run test:gpu`. With no adapter they **skip** locally and **fail** in CI
(`BLUD_REQUIRE_GPU=1`), so a broken lavapipe install can never read as green.

1. **Op fixtures** (`body-normal-bake/field-ops.gpu.test.ts`). One synthetic body per op: plain capsule,
   taper, bent, bent + taper, box, round box, scaled ellipsoid, oriented, strand (straight and bent), shell,
   shell + warp, chamfer, chamfer + bend, carve, groove, dead prim, bone/organ skip, two clusters. Each is
   evaluated at ~4k points on and around the surface on both backends: abs(gpu − cpu) ≤ 2e-6 m. A failure
   names the op. The chamfer + bend fixture pins open question 1's answer.
   A second fixture set runs the same op bodies through the **runtime** fold (`foldGroup`), which is how
   the chamfer + bend mismatch would have been caught. That set is optional and needs a small harness for
   `mapBody`'s globals.
2. **Character field parity** (`field-characters-{0,1}.gpu.test.ts`, two shards so the slow builds run in
   parallel). For every character with a `.detail` file, its detail body (which holds every plain-body prim too)
   at 1,500 points (detail builds cost up to ~90 s and `sdBody` up to ~7 ms a point on the CPU): 2k on the skin (found by the CPU `skin` from random region
   rays) plus 1k in the shell around it. Same bar, starting at 2e-6 m. The bar is set from measured
   llvmpipe and Metal numbers in the implementation PR, never loosened to make a red run pass.
3. **Bake parity** (`bake-parity.gpu.test.ts`). twinhead (boxes, carves, chamfers, heavy bending) and venus
   (strands) baked both ways at 64 columns × 24 rows per region: coverage identical except ≤ 0.5% of
   texels; covered texels within ±1 code on ≥ 99.5% and ±4 on all. Small enough for llvmpipe.
4. **Kernel text** (plain vitest, no GPU, in the default suite). The kernel compiles through Dawn's WGSL
   parser where available and otherwise passes a static check: every leaf it calls is included, every
   private global a leaf reads is declared, and no `&&` mixes with `||` unparenthesised (the WGSL gotcha
   that blanked pipelines before).

**CI job** (`.github/workflows/ci.yml`, new `gpu-parity` job on `ubuntu-latest`):
`apt-get install -y mesa-vulkan-drivers`, `npm ci`, `BLUD_REQUIRE_GPU=1 npx vitest run --project gpu`.
About a minute plus test time. `webgpu` becomes a devDependency.

## Rollout

1. **Refactor, byte-identical.** Lift `writePrimRows` and split the script into the modules above with the
   CPU backend only. Gate: re-bake one committed map (gibbet, the cheapest) and require a byte-identical PNG
   and `.json` (bar the new `backend` field).
2. **Kernel + field tests + CI job.** Tests 1, 2 and 4; the `gpu-parity` job is green on the branch. Remove
   the temporary `dawn-probe` workflow.
3. **GPU bake + bake parity.** Test 3; GPU becomes the default. Re-bake every committed `*-body-n.png` on
   the GPU, attach a per-character diff report (coverage delta, code histogram) and side-by-side shots in
   the arena, and let the owner look before the re-baked maps are committed.
4. **Optional:** worker threads for the CPU path.

## Open questions (owner)

1. **Chamfer on a bent prim.** The runtime folds it round; `sdBody` chamfers it. Which is intended? Either
   make `foldGroup` chamfer on `(prof & 1) != 0 && (prof & 4) == 0`, which changes the drawn surface of any
   such prim and needs a look plus a march-hash re-pin, or reject chamfer + bend in `blob-compile.ts` like
   chamfer + shell. The bake mirrors `sdBody` regardless, so this can be settled separately, but it is a
   CPU/GPU field mismatch in the shipped game today, independent of the bake.
2. **Re-baking committed maps.** Step 3 re-bakes every map on the GPU so all of them come from one backend.
   The alternative is to leave them alone and only use the GPU for new bakes. Re-baking is recommended, as
   it makes the step-3 diff the best end-to-end parity evidence we have.

## Update 2026-10-24: step 2 numbers

Op fixtures agree to 3.3e-8 m or better and catch the chamfer + bend rule; nine of ten characters agree to 2.3e-7 m.
**teratoma fails (6.6e-6 m)**: the shipped `sdBezierT` loses f32 precision on NEARLY STRAIGHT bent prims, up to
~0.4 mm and ~5 degrees of normal at isolated points. That is the game's own leaf, not the bake. Numbers, scripts and
the options are in [the step 2 notes](../../dev-notes/2026-10-24-gpu-bake-parity/notes.md).

**Open question 3, bent-prim f32 conditioning.** Polish `coneBend`'s best `t` with Newton steps (both fields; a
game render change with a march-hash re-pin), or scale the parity bar with the bend's conditioning, or leave it
failing until fixed.

**Answered 2026-10-24: fix the leaf.** Newton polish in `coneBend` and `sdBentCone`; every bent prim in every shipped and
detail body is now within 6.7e-7 m of `sdBody`, and the parity suite is green (38 of 38). march-hash unchanged; the
march source-text golden awaits a re-pin. Numbers and pictures:
[the step 2 notes](../../dev-notes/2026-10-24-gpu-bake-parity/notes.md), last section.
