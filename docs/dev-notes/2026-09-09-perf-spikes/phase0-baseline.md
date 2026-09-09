# Phase 0 baseline — and the finding that invalidates the actor-LOD premise

**2026-09-09, quiet machine.** `BENCH_LEGS=baseline BENCH_PASSES=1
BENCH_ROOMS=3,4,5 BENCH_REPEATS=2`.

```
=== LOAD AT START ===  7:05  load averages: 3.47 3.45 4.43
=== EXIT 0 ===         7:07  load averages: 3.99 3.55 4.35
```

## The headline: the two phases we added are NOISE

| cpu phase | room 3 | room 4 | room 5 |
| --- | ---: | ---: | ---: |
| `cpu:phase:wound-hit` | 6.60 | 4.70 | 7.90 |
| `cpu:tick` | 6.30 | 6.50 | 6.40 |
| `cpu:draw` | 5.20 | 4.70 | 5.20 |
| `cpu:phase:body-step` | 3.00 | 3.10 | 3.20 |
| **`cpu:phase:skeleton-mesh`** | **0.40** | **0.50** | **0.50** |
| **`cpu:phase:encounter`** | **0.20** | **0.20** | **0.20** |

The values are non-zero, so the wraps are sampling correctly — this is a real
measurement, not a missing instrument. **The mesh-skeleton path costs 0.5 ms
and the encounter director costs 0.2 ms.** Together, 0.7 ms of a ~22 ms frame.

## Where the frame actually goes

| pass | room 3 | share | room 4 | share | room 5 | share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `sdf:march` | 17.30 | **75%** | 18.47 | **83%** | 20.84 | **82%** |
| `gpu:idle` | 4.05 | 18% | 2.54 | 11% | 3.19 | 13% |
| `sdf:polys` | 0.69 | 3% | 0.70 | 3% | 0.69 | 3% |
| everything else combined | <0.7 | | <0.5 | | <0.5 | |

Fenced frame p50: **22.69 / 21.99 / 16.26–25.21** ms for rooms 3/4/5, against a
33.3 ms budget. Room 5 gib peaks at `sdf:march` 31.40 ms.

**The march is the frame, exactly as the 2026-09-07 study concluded.** Nothing
about the soldier or the mesh skeletons changed that.

## What this means for the actor-LOD plan — its premise is WRONG

`docs/superpowers/plans/2026-09-09-actor-lod-culling.md` was written on the
argument that the frame had become CPU-bound because nothing is gated by
visibility: ~282 meshes touched per frame, 15 actors fully simulated regardless
of room. That reasoning was sound about the *code* and wrong about the *cost*.
All of it together is 0.7 ms.

**Therefore, delete from the plan:**

- the `near` / `suspended` tier split
- `ZombieActor.stepCoarse` and `resume`
- the Verlet rig translation on promotion, its tests, and the staggered
  coarse-tick schedule

That machinery was the fiddly, risky half of the design — Verlet promotion
could have shipped a visible body-explosion bug — and it was aimed at 0.7 ms.

**Keep, but re-justify:** a *render* cull on `setBodies`. The owner's original
observation stands and the census confirms it — room 3 spawns 3 actors but the
run saw **8 bodies**, because enemies pursue across rooms. More bodies on screen
is more covered pixels, and the march is fill-bound. So culling still attacks
the right term — it just has to act on the march, not on the simulation.

Honest caveat on how much it can win: the proxy boxes are `frustumCulled=false`,
but an off-screen box clips to no fragments, so the *frustum* half of the cull
probably buys little. The value is in **occluded** bodies — on-screen but behind
a wall — which do rasterise and march. That is a narrower claim than the plan
made and should be measured with an A/B before being built out.

## Corrections to the earlier investigation

`notes.md` in this directory reported room 3 at 41–45 ms and called it a ~3x
regression against 2026-09-07's 14.15 ms. **On a quiet machine it is 20.9–22.7
ms.** The contaminated runs were inflated roughly 2x, as their own CAVEAT
warned. A real regression remains (~14 → ~21, roughly +50%) but it is smaller
than reported and it lives in `sdf:march`, not in CPU.

## Repeatability — read before trusting any delta

| leg | room | reps | spread |
| --- | ---: | --- | ---: |
| baseline | 3 | 22.69 / 20.85 | 9% |
| baseline | 4 | 21.99 / 22.64 | 3% |
| baseline | 5 | 16.26 / 25.21 | **55%** |

**Room 5 is not usable for deltas at 2 repeats.** Anything measured there needs
more reps or it is unresolved.

## Harness bug found on the way

A first attempt at this run (full 34-leg matrix) **hung silently** at 141/204
leg-runs: 19 minutes with Chrome alive at 1.3% CPU, CDP responsive, page loaded.
`send()` in `scripts/sdf-game-bench.mjs:83` has no timeout and no reject path,
and no `ws.on('close')` rejects pending promises — a lost CDP response wedges
the harness forever. Compounding it, `passes.md`/`bench.md`/`bench.json` are
only written after the entire matrix, so the hang cost the whole run. Tracked
separately; it would silently burn an unattended dispatch or CI run.
