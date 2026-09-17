# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4, prelude: __sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 6.69 | 51% | 9.66 | 63% |
| compute:probe-gather | 4.64 | 35% | 4.00 | 26% |
| sdf:polys | 0.77 | 6% | 0.75 | 5% |
| post:fxaa | 0.22 | 2% | 0.22 | 1% |
| sdf:field-mesh | 0.23 | 2% | 0.20 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 1% |
| gpu:idle | 0.09 | 1% | 0.08 | 0% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 1% | 0.04 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **13.18** | 100% | **15.41** | 100% |
| GPU span p50 (first start → last end) | 13.94 |  | 14.34 |  |
| fenced frame p50 | 15.90 |  | 17.28 |  |
| gap (frame − span) | 1.96 | 12% of frame | 2.94 | 17% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 5.00 | 4.80 |
| cpu:phase:wound-hit | 2.80 | 4.20 |
| cpu:draw | 4.10 | 3.30 |
| cpu:phase:body-step | 2.40 | 2.40 |
| cpu:phase:skeleton-mesh | 0.30 | 0.40 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (21.77 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 5.47, cpu:tick 4.50, compute:probe-gather 4.03, cpu:draw 3.20, cpu:phase:body-step 2.20
- **fire** (33.54 ms labelled — droplets 0→213, goo quads 0→397): sdf:march 10.46, cpu:phase:wound-hit 5.70, cpu:tick 5.10, compute:probe-gather 3.94, cpu:draw 3.50
- **gib** (30.66 ms labelled — droplets 213→10, goo quads 397→262): sdf:march 13.23, cpu:tick 4.80, compute:probe-gather 4.00, cpu:draw 3.20, cpu:phase:body-step 2.40

## probe-rate4

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 6.92 | 46% | 11.41 | 64% |
| compute:probe-gather | 4.90 | 32% | 4.02 | 22% |
| gpu:idle | 1.54 | 10% | 0.77 | 4% |
| sdf:polys | 0.77 | 5% | 0.74 | 4% |
| post:fxaa | 0.22 | 1% | 0.22 | 1% |
| sdf:field-mesh | 0.21 | 1% | 0.22 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 0% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.04 | 0% |
| effects | 0.01 | 0% | 0.02 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **15.10** | 100% | **17.91** | 100% |
| GPU span p50 (first start → last end) | 12.54 |  | 15.46 |  |
| fenced frame p50 | 14.83 |  | 17.52 |  |
| gap (frame − span) | 2.29 | 15% of frame | 2.06 | 12% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 2.90 | 6.10 |
| cpu:tick | 5.10 | 5.10 |
| cpu:draw | 4.30 | 3.50 |
| cpu:phase:body-step | 2.60 | 2.50 |
| cpu:phase:skeleton-mesh | 0.30 | 0.40 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (23.25 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.17, cpu:tick 4.60, compute:probe-gather 4.03, cpu:draw 3.20, cpu:phase:body-step 2.30
- **fire** (37.08 ms labelled — droplets 0→224, goo quads 0→408): sdf:march 11.72, cpu:phase:wound-hit 7.00, cpu:tick 5.40, compute:probe-gather 4.02, cpu:draw 3.60
- **gib** (33.46 ms labelled — droplets 224→12, goo quads 408→262): sdf:march 14.69, cpu:tick 5.50, compute:probe-gather 4.10, cpu:draw 3.50, cpu:phase:body-step 2.70

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 16.08 / 13.77 / 15.90 | 17% |
| baseline | 4 | 17.56 / 14.49 / 17.28 | 21% |
| probe-rate4 | 3 | 12.86 / 14.83 / 19.15 | 49% |
| probe-rate4 | 4 | 17.52 / 17.52 / 17.62 | 1% |
