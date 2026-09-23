# Hybrid march — timing prototype plan (2026-09-22)

**Question:** is `coarse march + sparse full-res rays on the hard pixels` actually cheaper than today's
`0.5 march + t16`? The look is settled: in the offline splice preview (`scripts/upscale4x-splice.ts`) the owner said
0.25 and 0.35 hybrids look as good as 0.5. Wounds read fine up close. Interior softness is not a concern
(skin texture is procedural noise). So the only question left is speed, and it has to be MEASURED. The two
earlier marching-realm attempts both looked fine on paper and lost on the GPU (the 2026-09-04 depth prepass cut hit
steps 6.6 → 3.6 but made the frame **slower**; run-5 refine costs 6–11 ms).

**Hard pixels** (all derived from the coarse march): a silhouette (3x3 mixes hit and miss), a depth edge (> 8 cm
inside a 3x3), a prim seam where the colour also changes (tonemapped delta > 0.08; skin-to-skin joins do not count),
and the face circle (0.8 × head radius). Wounds get no special rays. Offline share of body pixels at 0.35:
7 % at 0.9 m, ~24 % at 1.2–2.5 m, 56 % at 3.5 m.

## Step 0 — measured estimate, no engine code

The sparse pass cannot be timed until it exists, but each of its parts can be timed in the game's own melee scene
(6 bodies, 1.4 m, the ship perf scene), on one page with alternating legs and a quiet machine:

1. `sdf:march` at **0.5** (ship), **0.25**, **0.35** and **1.0**, with the hit tolerance both on (ship) and off (the
   look). Melee bench `MELEE_LEGS` with `setSdfScale`. Also `sdf:upscale` (t16) at ship, because the hybrid does not
   need it.
2. **Cost of the hard pixels at 1.0**, from the cost census (mode 14: per-pixel prims + wound rows/7, the census
   unit that tracked time this session). The mask is built from a 0.25/0.35 read of the same frame (colour,
   depth, mode-11 prim ids, head circles). **Divergence is priced pessimistically:** the GPU runs fragments in
   ~8x4 warps, so any warp that holds even one hard pixel is charged its MOST expensive lane for all 32 lanes.
   Result: `f` = (charged cost of the hard warps) / (total cost at 1.0).
3. **Estimate:** `hybrid ≈ T(coarse) + f × T(1.0) + ~0.2 ms (mask + composite)` against `T(0.5) + T(t16)`.

**Go / no-go:** go to step 1 only if the estimate saves **≥ 25 %** of `sdf:march + upscale` in the clean AND the
wounded phase. Below that, overheads the estimate cannot see (a second pass's setup, proxy raster, a cold material)
have eaten savings this size before.

## Step 1 — the real sparse pass (only if step 0 says go)

Clone the run-5 refine plumbing (it is already a second, output-resolution body pass with per-body twin meshes on
their own layer, `REFINE_LAYER`, an MRT target and a compile hook), but twin the **normal march body** (`MARCH_BODY`)
instead of `REFINE_BODY`, with an early `discard` wherever an output-resolution hard-mask texture is 0. The mask
comes from a small full-screen pass over the coarse march. Everything sits behind a `?hybrid` boot flag and is
allocated only when the flag is on, the same way refine is kept byte-identical to ship. Composite: hard pixels
from the sparse target, the rest bilinear from the coarse march. Timed with the melee bench as a `hybrid` leg.

Costs to expect: one cold compile of a new material variant (~30–50 s), no `march-golden` change (flag off = ship
path untouched), `refineOn`-style allocation discipline (march-hash).

## Step 2 — only if step 1 holds up on the GPU

Tune the mask, add crater-core rays for 2.5 m+ wounds, the output-res detail noise if the owner ever wants it, and
the owner A/B in play.

## Step 0 result (2026-09-22, quiet machine, load 2.6–3.0) — **NO-GO**

Melee scene (6 bodies, crush), clean phase, 3 reps × 60 frames, one page, alternating legs, hit tolerance off in
every non-ship leg. `sdf:march` p50:

| leg | march ms |
| --- | ---: |
| ship (0.5, tolerance on) | 9.6–10.0 |
| 0.5, tolerance off | 10.6–10.7 |
| 0.35, tolerance off | 7.2 |
| 0.25, tolerance off | 6.0 |
| 1.0, tolerance off | 32.9–33.4 |

Hard-pixel estimate on the same frozen frame (`MELEE_HYBRID_EST=1`):

| coarse | hard share of rasterised px | of warps | sparse pass, warp-priced | per-pixel (lower bound) |
| --- | ---: | ---: | ---: | ---: |
| 0.25 | 28.4 % | 33.6 % | 61.5 % of T(1.0) | 41.7 % |
| 0.35 | 23.1 % | 36.3 % | 64.3 % of T(1.0) | 35.6 % |

Estimate: `hybrid(0.25) ≈ 6.0 + 0.615 × 33.1 ≈ 26.4 ms`; even the no-divergence lower bound is
`6.0 + 0.417 × 33.1 ≈ 19.8 ms`, against **today ≈ 9.8 + ~0.6 (t16) ≈ 10.4 ms**. The hybrid is ~2–2.5× SLOWER.

Why: in the crush scene the hard pixels are 23–28 % of the rasterised pixels (six overlapping bodies = many silhouettes
and depth edges, far more than the single-body preview's 7–24 %), and they are the EXPENSIVE ones — silhouette and
grazing rays walk the longest — so they carry ~40 % of the full-res cost per pixel, ~60 % once warps are priced.
Full res costs 3.4× the 0.5 march, so even a third of it is more than the whole of today's march. The wounded phase
did not run (wound staging: 21/36 stamps landed, a staging refusal, unrelated to the question); the clean gap is large
enough that it cannot change the verdict.

**Conclusion.** The hybrid LOOKS right, but the real-ray budget it needs costs more than it saves: a third
confirmation of the multiscale note's "coarse data does not make fine pixels cheaper". Step 1 is not built.
What the run does say: a plain 0.25 march is −38 % `sdf:march` (6.0 vs 9.8) and 0.35 is −27 %. So any future win at
this lever has to come from a RECONSTRUCTION that needs no full-res rays (a trained net, temporal accumulation), not
from re-marching edges.
