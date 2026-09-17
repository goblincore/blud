# R1 bench evidence — per-pass tables, verbatim

Run 2026-09-10, 1280x800, BENCH_LEGS=baseline BENCH_PASSES=1, harness ship-truth pins
(setOccluder(false), setHullExitBound(true)) in place on BOTH builds; no prelude.

## r0 = pre-R1 (`49fb77ee` worktree), run A: rooms 3,4
```
1280x800, repeats=3, rooms=3,4
## baseline
| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 5.05 | 38% | 6.11 | 51% |
| compute:probe-gather | 4.87 | 37% | 4.00 | 34% |
| sdf:polys | 0.78 | 6% | 0.76 | 6% |
| sdf:field-mesh | 0.87 | 7% | 0.23 | 2% |
| post:fxaa | 0.23 | 2% | 0.23 | 2% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.08 | 1% | 0.08 | 1% |
| sdf:field-mesh-weave | 0.08 | 1% | 0.08 | 1% |
| goo:surface | 0.07 | 1% | 0.06 | 1% |
| sdf:composite | 0.06 | 0% | 0.06 | 1% |
| gpu:idle | 0.07 | 1% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 1% | 0.04 | 0% |
| effects | 0.02 | 0% | 0.02 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.75 | 6% | 0.00 | 0% |
| **labelled total (sum of medians)** | **13.20** | 100% | **11.91** | 100% |
| GPU span p50 (first start → last end) | 14.23 |  | 14.99 |  |
| fenced frame p50 | 16.77 |  | 18.64 |  |
| gap (frame − span) | 2.54 | 15% of frame | 3.65 | 20% of frame |
| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 0.90 | 4.90 |
| cpu:tick | 5.10 | 4.70 |
| cpu:draw | 4.30 | 3.00 |
| cpu:phase:body-step | 2.50 | 2.30 |
| cpu:phase:skeleton-mesh | 0.30 | 0.30 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
## Repeatability (fenced frame p50 across repeats)
| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 17.34 / 16.77 / 16.29 | 6% |
| baseline | 4 | 18.66 / 14.21 / 18.64 | 31% |
```

## r1 = R1 build, run A: rooms 3,4
```
1280x800, repeats=3, rooms=3,4
## baseline
| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 6.23 | 68% | 7.31 | 79% |
| sdf:polys | 0.77 | 8% | 0.73 | 8% |
| post:fxaa | 0.22 | 2% | 0.22 | 2% |
| sdf:field-mesh | 0.24 | 3% | 0.21 | 2% |
| compute:probe-gather | 0.15 | 2% | 0.18 | 2% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 1% |
| sdf:field-mesh-weave | 0.08 | 1% | 0.08 | 1% |
| goo:surface | 0.07 | 1% | 0.07 | 1% |
| sdf:composite | 0.07 | 1% | 0.06 | 1% |
| gpu:idle | 0.19 | 2% | 0.06 | 1% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.04 | 0% |
| effects | 0.02 | 0% | 0.02 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.74 | 8% | 0.00 | 0% |
| **labelled total (sum of medians)** | **9.13** | 100% | **9.26** | 100% |
| GPU span p50 (first start → last end) | 12.42 |  | 11.95 |  |
| fenced frame p50 | 14.15 |  | 14.33 |  |
| gap (frame − span) | 1.73 | 12% of frame | 2.38 | 17% of frame |
| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 1.10 | 5.90 |
| cpu:tick | 5.20 | 5.00 |
| cpu:draw | 4.30 | 3.20 |
| cpu:phase:body-step | 2.70 | 2.50 |
| cpu:phase:skeleton-mesh | 0.30 | 0.40 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.30 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
## Repeatability (fenced frame p50 across repeats)
| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 14.04 / 15.26 / 14.15 | 9% |
| baseline | 4 | 16.76 / 11.87 / 14.33 | 41% |
```

## r0 run B: room 4 only
```
1280x800, repeats=3, rooms=4
## baseline
| pass | room 4 ms | share |
| --- | ---: | ---: |
| sdf:march | 5.93 | 50% |
| compute:probe-gather | 3.99 | 34% |
| sdf:polys | 0.76 | 6% |
| sdf:field-mesh | 0.27 | 2% |
| post:fxaa | 0.23 | 2% |
| post:blit | 0.13 | 1% |
| sdf:field-mesh-weave | 0.08 | 1% |
| post:vhs | 0.08 | 1% |
| sdf:composite | 0.06 | 1% |
| goo:surface | 0.06 | 1% |
| gpu:idle | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:shell-hull | 0.04 | 0% |
| effects | 0.02 | 0% |
| sdf:last-blit | 0.02 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **11.76** | 100% |
| GPU span p50 (first start → last end) | 11.96 |  |
| fenced frame p50 | 13.96 |  |
| gap (frame − span) | 2.00 | 14% of frame |
| cpu | room 4 |
| --- | ---: |
| cpu:phase:wound-hit | 5.50 |
| cpu:tick | 4.80 |
| cpu:draw | 3.10 |
| cpu:phase:body-step | 2.30 |
| cpu:phase:skeleton-mesh | 0.30 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
## Repeatability (fenced frame p50 across repeats)
| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 4 | 14.23 / 13.96 / 13.87 | 3% |
```

## r1 run B: room 4 only
```
1280x800, repeats=3, rooms=4
## baseline
| pass | room 4 ms | share |
| --- | ---: | ---: |
| sdf:march | 7.49 | 78% |
| sdf:polys | 0.73 | 8% |
| compute:probe-gather | 0.39 | 4% |
| post:fxaa | 0.21 | 2% |
| sdf:field-mesh | 0.18 | 2% |
| post:blit | 0.13 | 1% |
| gpu:idle | 0.09 | 1% |
| post:vhs | 0.09 | 1% |
| sdf:field-mesh-weave | 0.08 | 1% |
| goo:surface | 0.07 | 1% |
| sdf:composite | 0.06 | 1% |
| post:vhs-input | 0.04 | 0% |
| sdf:shell-hull | 0.04 | 0% |
| effects | 0.02 | 0% |
| sdf:last-blit | 0.02 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **9.65** | 100% |
| GPU span p50 (first start → last end) | 12.86 |  |
| fenced frame p50 | 14.96 |  |
| gap (frame − span) | 2.10 | 14% of frame |
| cpu | room 4 |
| --- | ---: |
| cpu:phase:wound-hit | 5.60 |
| cpu:tick | 4.90 |
| cpu:draw | 3.10 |
| cpu:phase:body-step | 2.50 |
| cpu:phase:skeleton-mesh | 0.30 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
## Repeatability (fenced frame p50 across repeats)
| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 4 | 12.59 / 14.96 / 16.76 | 33% |
```

## Control that FAILED to isolate the march: BENCH_PRELUDE='__sdfGame.setProbeRays(0)'
With zero rays the march row collapses to ~0 and the frame's gap balloons (12.26/15.22 ms fenced vs 3.80/3.94 labelled), so this seam is NOT a usable gather-off control. Recorded so nobody re-runs it expecting an answer.
```
# r0 rays=0, room 4
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.
| sdf:march | 0.02 | 1% |
| compute:probe-gather | 0.01 | 0% |
| **labelled total (sum of medians)** | **3.80** | 100% |
| fenced frame p50 | 12.26 |  |
## Repeatability (fenced frame p50 across repeats)
# r1 rays=0, room 4
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.
| compute:probe-gather | 0.01 | 0% |
| sdf:march | 0.00 | 0% |
| **labelled total (sum of medians)** | **3.94** | 100% |
| fenced frame p50 | 15.22 |  |
## Repeatability (fenced frame p50 across repeats)
```
