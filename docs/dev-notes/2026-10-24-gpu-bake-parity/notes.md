# GPU bake field parity: first numbers (2026-10-24)

Rollout step 2 of [the GPU body-normal bake spec](../../superpowers/specs/2026-10-24-gpu-body-normal-bake-design.md).
The bake field (`src/lab/sdf-zombie/body-normal-bake/bake.wgsl.ts`: the game's leaf WGSL under `sdBodyClosed`'s
fold) against `sdBody` (validate.ts), through Dawn in Node on the owner's Mac (Metal, apple-m3).

## Op fixtures (`scripts/body-normal-bake/field-ops.gpu.test.ts`, 4096 points each)

All 28 fixtures agree to **5e-9 .. 3.3e-8 m** (bar 2e-6). Mutation check: switching the bake fold's chamfer rule
to the runtime's `(prof & 7) == 1` fails exactly one fixture, `chamfer and bent`, by 7.0e-2 m. The suite sees the
chamfer + bend mismatch open question 1 is about.

## Character detail bodies (`field-characters-{0,1}.gpu.test.ts`, 1500 points each)

| character | prims | Metal (Mac) | llvmpipe (CI) |
| --- | --- | --- | --- |
| chair | 952 | 4.3e-8 | 4.9e-8 |
| flayer | 1100 | 2.3e-7 | 4.3e-7 |
| gibbet | 1310 | 5.0e-8 | 5.5e-8 |
| butcher | 1313 | 5.2e-8 | 5.2e-8 |
| venus | 1395 | 4.8e-8 | 6.7e-8 |
| deadeye | 1306 | 5.4e-8 | 5.5e-7 |
| gamer | 3537 | 5.8e-8 | 6.9e-8 |
| gorehound | 1273 | 4.5e-8 | 6.7e-8 |
| twinhead | 1229 | 1.1e-7 | 6.9e-8 |
| **teratoma** | 1790 | **6.6e-6 (fails the 2e-6 bar)** | **1.5e-5 (fails)** |

Wall time for both shards in parallel: ~3 min on the (busy) Mac, 75 s of tests in the `gpu-parity` CI job (run
40134775372), almost all of it CPU body builds and `sdBody`. On llvmpipe the op fixtures read 6e-9 .. 5.3e-8 except
`chamfer and bent` at 5.8e-7, the same bent-prim conditioning as below, still under the bar.

## The teratoma miss: f32 conditioning of a NEARLY STRAIGHT bent prim

`worst-prim.mts teratoma` bisects the fold prefix: the whole error enters at one prim (detail line src 600), an
untapered bent capsule, r 0.02, 0.158 m long, bend displacement ~1.2 cm, with the point just inside it.

`bend-conditioning.mts` evaluates that prim alone at 20k points, scaling its bend, at its own position and moved
near the origin:

| bend | max error at abs(p) ~1.6 m | near the origin |
| --- | --- | --- |
| x0.25 | 3.8e-5 | 5.9e-5 |
| x1 | **3.7e-4** | **4.3e-4** |
| x4 | 1.1e-5 | 1.3e-5 |
| x16 | 8.8e-8 | 5.0e-8 |

Not position precision (the same at the origin), and it vanishes as the bend grows: it is `sdBezierT`'s cubic
(iq's construction) losing f32 precision when `bv = A - 2B + C` is small but not zero. `kk = 1 / dot(bv, bv)` is
~1700 here and scales every coefficient; `coneBend`'s degenerate guard only catches `dot(bb, bb) < 1e-12`, i.e.
exactly straight. The 1/8 and 1/32 grid refines after the root do not recover a sub-mm minimum.

**The game draws this same error** (it is the shipped leaf), so it is not a bake bug; it is the shipped f32 field
disagreeing with the f64 CPU field (click-to-shoot) by up to ~0.4 mm near slightly bent prims.

What it does to normals (`bend-normal-error.mts`, 3000 surface points on the x1 prim, CPU-vs-GPU central
differences): mean **0.056 deg**, worst **4.8 deg** at the bake's eps 6e-4 (worst 1.9 deg at the game's 1.5e-3).
Isolated spikes, not noise: in an 8-bit normal map a worst texel would be ~10 codes off.

## Options (owner)

1. **Fix the leaf**: after the cubic, polish the best `t` with one or two Newton steps on `dot(q - pt, pt')` (exact
   in f64 already, so the CPU mirror gets the same steps and stays bit-for-bit the same function). Changes the drawn
   surface by up to ~0.4 mm on slightly bent prims: march-hash re-pin and an owner look; a few ALU per bent prim.
2. **Leave the leaf**, and raise the parity bar for bent prims only (the error is bounded by the bend's conditioning,
   so the bar could scale with `kk`). The bake then inherits the spikes the game already has.
3. **Leave the leaf and the bar**; let teratoma (and any future slightly bent character) fail until 1 lands.

## Update 2026-10-24 (later): the fix, Newton polish in `coneBend` and `sdBentCone`

Owner: "Fix it in the leaf … measure the march-hash and frame-cost change, and show me before/after on teratoma
before re-pinning." **Nothing is re-pinned yet.**

**The change** (both fields, plus the WGSL transcription in `bend.test.ts`): after the cubic roots and the 1/8, 1/32
grid passes, two Newton steps from the best t, each kept only if it lowers G (still monotone):
1. on the squared distance |q − P(t)|²/2 (a quartic, exact in one step on a straight chord from any start);
2. on G(t) = |q − P(t)| − r(t) itself (the taper moves G's minimiser off the closest point).

Straight-line code, no loop and no branch. The first try, a three-iteration branching loop, gave the same accuracy, but
the crowd/gib background compiles then missed the 180 s warm budget on every boot. That was not only the loop: cold
HEAD (with a one-line no-op to bust the cache) misses it too on this machine. The probe closing the tab abandons the
compiles, so every probe was cold. A boot held open until the compiles finish (`warm-probe.mjs … HOLD`) warms the cache.
After that, both background compiles finish in 139 s with the final leaf.

**Accuracy** (`bend-survey.mts`, `bend-truth.mts`, each bent prim alone, 2000 points):

| | before | after |
| --- | --- | --- |
| shipped base bodies: bent prims over 2e-6 | 29 of 141, worst 6.6e-4 m | **0 of 141, worst 6.7e-7** |
| detail bodies: bent prims over 2e-6 | (teratoma failing) | **0 of 2193, worst 1.4e-7** |
| twinhead worst prim vs brute force: GPU / CPU | 6.6e-4 / 1.4e-8 | 1.3e-7 / 1.1e-16 |
| bloatmaw worst prim vs brute force: GPU / CPU | 2.9e-4 / 9.1e-6 | 7.5e-8 / 8.3e-17 |
| `npm run test:gpu` | 37 of 38 (teratoma 6.6e-6) | **38 of 38** |

The CPU field (click-to-shoot, validators) gets better too: its grid refine stopped short on steeply tapered bends.

**Teratoma** (`leaf-render.mts`, deterministic: the bake field rendered twice in one process, CONE_BEND's HEAD text
swapped in for BEFORE). The failing prim is a `.detail` line, so it is the BAKE's view of teratoma; the game's teratoma
base body has no affected prim.
- [leaf-render-teratoma-600.png](leaf-render-teratoma-600.png): before | after | diff x8. Before, a dotted line of
  wrong shading runs along the bent tube; after, a clean surface. 765 of 102,400 px change, up to 113/255.
- [error-map-teratoma-600-before.png](error-map-teratoma-600-before.png) → [after](error-map-teratoma-600-after.png):
  slice through the prim. Field error 1.8e-3 → 5.4e-8 m, normal error (bake eps) 7.8 → 0.00 deg.
- The lab turntables (`blob-turntable.mjs`) are NOT a usable A/B: per its own KNOWN LIMIT they are not reproducible run
  to run (here 4-12% of pixels and the reference cube's position differed between legs).
- twinhead's worst prim (src 248, 6.6e-4) renders with 0 changed pixels: its error was inside the body.

**march-hash: unchanged.** room1 `0c71e712…` (the pinned canonical), repeat equal, wounded `bf6836cd…`, with the cache
warm. The staged close-up draws no prim whose surface moved. The only pin that moves is the source-text golden
`webgpu/march/__snapshots__/march-golden.test.ts.snap` (the "MOVE-ONLY" sha1 of every march string export), red until
re-pinned on the owner's OK.

**Frame cost.** The leaf alone (`field-microbench.mts`, Dawn, before and after interleaved in one process, 262144 points
per dispatch): **+3.6 to +3.9 %** of field time on bodies with bent prims (twinhead, cyclops, teratoma); zombie (no
bends) −2.9 %, the noise. Scene B in the game bench (`bench-ab.sh`, interleaved HEAD / polished / HEAD / polished, 2
runs each): p50 HEAD 44.4, 54.8, 56.1, 51.0 ms; polished 56.6, 64.0, 56.8, 53.7 ms. That does not resolve a few
percent: the machine drifted under XProtect scans during the session (~150 % CPU), and run-to-run spread is ±6 ms. The
before leg hours earlier read 41-43 ms on a quieter machine; that is machine state, not the leaf. A clean scene-B number
needs a quiet machine.

## Update 2026-10-24 (step 3): the GPU bake, and every map re-baked

`scripts/bake-body-normal.ts` now bakes on the GPU by default (`--cpu` forces the reference; no adapter falls back to
it). **gibbet: 568 s of CPU (quiet machine) -> 3.4 s on the GPU.** Every committed map re-bakes in 0.7-12 s.

**Full-image parity, gibbet** (GPU vs a fresh `--cpu` bake of the same source, all 212,992 texels,
`rebake/full-compare.mjs`): 135,288 byte-identical, 77,702 one code apart, 2 three or four codes apart, none worse.
The fresh CPU bake is byte-identical to step 1's (`bf8f044b…`): the Newton polish does not touch gibbet (no bent prims).

**The re-bake** (`scripts/body-normal-bake/rebake-all.ts`, report in [rebake/REPORT.md](rebake/REPORT.md)) against
the committed maps:
- eight characters: a third of their texels move by **one code** (the f32 GPU vs the f64 CPU, as above); a handful by
  more (twinhead 18 texels over 4 codes, venus 7, butcher 1, flayer 1). Sampled backend parity on every layout: no
  coverage mismatch, max 1 code;
- **gamer and teratoma are stale**: their committed maps were baked before torso prims moved, so the torso axis
  (derived from the prims) moved too (teratoma's by 4 cm in z). Their maps move a lot: gamer 3.6 % of texels by over
  32 codes (the torso band and the forearm/stalk segments), teratoma 16 %, the same detail shifted along u
  ([gamer](rebake/gamer-sheet.png), [teratoma](rebake/teratoma-sheet.png): committed | GPU | diff x 8). The runtime reads
  the axis from the map's own header row, so a re-baked map is self-consistent; the committed ones are what is off.
- `bake-args.json` reproduces the other eight committed region tables exactly; two generator headers were wrong
  (flayer's forearm ranges, venus's torso band rows).

**Not committed yet: the re-baked maps** (owner look first, spec rollout step 3). On the owner's OK: copy
`.lab-tmp/rebake/*-body-n.{png,json}` over `public/assets/lab/`, and add `check-bake-args.test.ts`, which holds the
committed region tables to `bake-args.json` and is red for gamer and teratoma until then.
