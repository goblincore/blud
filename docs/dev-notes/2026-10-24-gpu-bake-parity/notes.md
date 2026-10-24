# GPU bake field parity: first numbers (2026-10-24)

Rollout step 2 of [the GPU body-normal bake spec](../../superpowers/specs/2026-10-24-gpu-body-normal-bake-design.md).
The bake field (`src/lab/sdf-zombie/body-normal-bake/bake.wgsl.ts`: the game's leaf WGSL under `sdBodyClosed`'s
fold) against `sdBody` (validate.ts), through Dawn in Node on the owner's Mac (Metal, apple-m3).

## Op fixtures (`scripts/body-normal-bake/field-ops.gpu.test.ts`, 4096 points each)

All 28 fixtures agree to **5e-9 .. 3.3e-8 m** (bar 2e-6). Mutation check: switching the bake fold's chamfer rule
to the runtime's `(prof & 7) == 1` fails exactly one fixture, `chamfer and bent`, by 7.0e-2 m. The suite sees the
chamfer + bend mismatch open question 1 is about.

## Character detail bodies (`field-characters-{0,1}.gpu.test.ts`, 1500 points each)

| character | prims | max abs(gpu − cpu) |
| --- | --- | --- |
| chair | 952 | 4.3e-8 |
| flayer | 1100 | 2.3e-7 |
| gibbet | 1310 | 5.0e-8 |
| butcher | 1313 | 5.2e-8 |
| venus | 1395 | 4.8e-8 |
| deadeye | 1306 | 5.4e-8 |
| gamer | 3537 | 5.8e-8 |
| gorehound | 1273 | 4.5e-8 |
| twinhead | 1229 | 1.1e-7 |
| **teratoma** | 1790 | **6.6e-6 (fails the 2e-6 bar)** |

Wall time for both shards in parallel: ~3 min, almost all of it CPU body builds (gamer ~90 s) and `sdBody`.

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
