# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4, prelude: __sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 6.68 | 49% | 8.75 | 59% |
| compute:probe-gather | 4.82 | 35% | 4.08 | 27% |
| sdf:polys | 0.77 | 6% | 0.76 | 5% |
| gpu:idle | 0.37 | 3% | 0.36 | 2% |
| post:fxaa | 0.22 | 2% | 0.23 | 2% |
| sdf:field-mesh | 0.23 | 2% | 0.20 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.08 | 1% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.03 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **13.65** | 100% | **14.87** | 100% |
| GPU span p50 (first start → last end) | 13.68 |  | 12.47 |  |
| fenced frame p50 | 15.31 |  | 14.84 |  |
| gap (frame − span) | 1.63 | 11% of frame | 2.37 | 16% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 2.40 | 5.50 |
| cpu:tick | 5.00 | 4.70 |
| cpu:draw | 4.20 | 3.10 |
| cpu:phase:body-step | 2.50 | 2.30 |
| cpu:phase:skeleton-mesh | 0.30 | 0.30 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (22.01 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 5.68, cpu:tick 4.50, compute:probe-gather 4.11, cpu:draw 3.20, cpu:phase:body-step 2.20
- **fire** (32.44 ms labelled — droplets 0→69, goo quads 0→292): sdf:march 8.95, cpu:phase:wound-hit 5.50, cpu:tick 5.20, compute:probe-gather 4.08, cpu:draw 3.20
- **gib** (26.79 ms labelled — droplets 69→0, goo quads 292→256): sdf:march 10.32, cpu:tick 4.80, compute:probe-gather 4.00, cpu:draw 2.90, cpu:phase:body-step 2.40

## cone-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| gpu:idle | 16.02 | 50% | 15.41 | 49% |
| sdf:march | 8.18 | 25% | 9.13 | 29% |
| compute:probe-gather | 4.84 | 15% | 4.33 | 14% |
| sdf:polys | 0.82 | 3% | 0.80 | 3% |
| sdf:cone | 0.68 | 2% | 0.61 | 2% |
| post:fxaa | 0.23 | 1% | 0.24 | 1% |
| sdf:field-mesh | 0.26 | 1% | 0.21 | 1% |
| sdf:shell-hull | 0.08 | 0% | 0.14 | 0% |
| post:blit | 0.14 | 0% | 0.13 | 0% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.71 | 2% | 0.00 | 0% |
| **labelled total (sum of medians)** | **32.29** | 100% | **31.34** | 100% |
| GPU span p50 (first start → last end) | 31.93 |  | 29.53 |  |
| fenced frame p50 | 19.64 |  | 17.32 |  |
| gap (frame − span) | -12.29 | -63% of frame | -12.21 | -71% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 5.90 | 9.20 |
| cpu:phase:wound-hit | 3.40 | 6.00 |
| cpu:draw | 5.00 | 5.50 |
| cpu:phase:body-step | 2.90 | 4.50 |
| cpu:phase:skeleton-mesh | 0.40 | 0.50 |
| cpu:phase:encounter | 0.30 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.00 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.30 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (51.70 ms labelled — droplets 0→0, goo quads 0→0): gpu:idle 16.89, cpu:tick 10.10, cpu:draw 6.30, compute:probe-gather 5.27, cpu:phase:body-step 5.10
- **fire** (54.38 ms labelled — droplets 0→53, goo quads 0→282): gpu:idle 15.25, sdf:march 9.95, cpu:phase:wound-hit 7.90, cpu:tick 6.70, cpu:draw 4.20
- **gib** (59.99 ms labelled — droplets 53→10, goo quads 282→260): gpu:idle 17.60, sdf:march 12.77, cpu:tick 10.20, cpu:draw 6.10, cpu:phase:body-step 4.90

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 13.93 / 15.31 / 30.13 | 116% |
| baseline | 4 | 14.84 / 13.92 / 24.28 | 74% |
| cone-on | 3 | 15.02 / 19.64 / 28.73 | 91% |
| cone-on | 4 | 16.25 / 31.97 / 17.32 | 97% |
