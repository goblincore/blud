# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4, prelude: __sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 7.05 | 51% | 9.87 | 63% |
| compute:probe-gather | 4.85 | 35% | 3.99 | 25% |
| sdf:polys | 0.79 | 6% | 0.75 | 5% |
| gpu:idle | 0.11 | 1% | 0.27 | 2% |
| post:fxaa | 0.23 | 2% | 0.22 | 1% |
| sdf:field-mesh | 0.21 | 2% | 0.17 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 1% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 1% | 0.03 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **13.79** | 100% | **15.76** | 100% |
| GPU span p50 (first start → last end) | 14.19 |  | 14.26 |  |
| fenced frame p50 | 16.15 |  | 16.64 |  |
| gap (frame − span) | 1.96 | 12% of frame | 2.38 | 14% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 2.30 | 5.30 |
| cpu:tick | 5.10 | 4.70 |
| cpu:draw | 4.10 | 3.10 |
| cpu:phase:body-step | 2.40 | 2.30 |
| cpu:phase:skeleton-mesh | 0.30 | 0.30 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (22.20 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 5.55, cpu:tick 4.50, compute:probe-gather 3.99, cpu:draw 3.20, cpu:phase:body-step 2.20
- **fire** (34.12 ms labelled — droplets 0→222, goo quads 0→406): sdf:march 10.11, cpu:phase:wound-hit 6.60, cpu:tick 5.10, compute:probe-gather 3.95, cpu:draw 3.20
- **gib** (30.81 ms labelled — droplets 222→11, goo quads 406→261): sdf:march 13.42, cpu:tick 4.90, compute:probe-gather 4.13, cpu:draw 2.90, cpu:phase:body-step 2.40

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 17.86 / 15.05 / 16.15 | 19% |
| baseline | 4 | 14.98 / 18.41 / 16.64 | 23% |
