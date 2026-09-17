# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4, prelude: __sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 9.07 | 45% | 8.95 | 44% |
| gpu:idle | 3.58 | 18% | 5.81 | 29% |
| compute:probe-gather | 5.00 | 25% | 4.09 | 20% |
| sdf:shell-hull | 0.07 | 0% | 0.39 | 2% |
| post:fxaa | 0.23 | 1% | 0.24 | 1% |
| sdf:field-mesh | 0.31 | 2% | 0.21 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| sdf:polys | 0.88 | 4% | 0.11 | 1% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:composite | 0.06 | 0% | 0.07 | 0% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.07 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.68 | 3% | 0.00 | 0% |
| **labelled total (sum of medians)** | **20.33** | 100% | **20.31** | 100% |
| GPU span p50 (first start → last end) | 19.84 |  | 17.76 |  |
| fenced frame p50 | 23.52 |  | 20.18 |  |
| gap (frame − span) | 3.68 | 16% of frame | 2.42 | 12% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 4.20 | 11.30 |
| cpu:tick | 9.30 | 11.10 |
| cpu:draw | 7.00 | 6.90 |
| cpu:phase:body-step | 4.50 | 5.40 |
| cpu:phase:skeleton-mesh | 0.50 | 0.60 |
| cpu:phase:encounter | 0.40 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.30 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (46.39 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 12.20, cpu:draw 7.40, gpu:idle 6.67, cpu:phase:body-step 6.40, compute:probe-gather 5.48
- **fire** (53.67 ms labelled — droplets 0→66, goo quads 0→288): cpu:phase:wound-hit 11.60, sdf:march 9.96, cpu:tick 9.40, cpu:draw 5.80, gpu:idle 5.45
- **gib** (44.51 ms labelled — droplets 66→0, goo quads 288→256): cpu:tick 11.50, sdf:march 9.24, cpu:draw 7.30, cpu:phase:body-step 5.60, gpu:idle 4.63

## probe-nolights

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 11.06 | 55% | 9.30 | 42% |
| gpu:idle | 4.89 | 24% | 6.36 | 29% |
| sdf:march-chunks | 0.00 | 0% | 2.41 | 11% |
| compute:probe-gather | 2.16 | 11% | 1.83 | 8% |
| sdf:polys | 0.92 | 5% | 0.86 | 4% |
| sdf:field-mesh | 0.35 | 2% | 0.31 | 1% |
| post:fxaa | 0.24 | 1% | 0.24 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| sdf:shell-hull | 0.07 | 0% | 0.09 | 0% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.07 | 0% |
| sdf:composite | 0.08 | 0% | 0.07 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.01 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **20.24** | 100% | **21.90** | 100% |
| GPU span p50 (first start → last end) | 20.18 |  | 20.76 |  |
| fenced frame p50 | 24.25 |  | 25.09 |  |
| gap (frame − span) | 4.07 | 17% of frame | 4.33 | 17% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:draw | 8.30 | 10.60 |
| cpu:tick | 10.90 | 10.10 |
| cpu:phase:wound-hit | 7.50 | 5.00 |
| cpu:phase:body-step | 5.20 | 4.80 |
| cpu:phase:skeleton-mesh | 0.60 | 0.60 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:encounter | 0.40 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (45.29 ms labelled — droplets 0→0, goo quads 0→0): cpu:draw 10.60, cpu:tick 9.90, sdf:march 7.69, gpu:idle 6.23, cpu:phase:body-step 5.00
- **fire** (46.18 ms labelled — droplets 0→41, goo quads 0→276): sdf:march 9.45, cpu:draw 8.60, cpu:tick 8.50, cpu:phase:wound-hit 5.70, gpu:idle 5.36
- **gib** (52.23 ms labelled — droplets 41→10, goo quads 276→260): sdf:march 13.15, cpu:tick 11.60, cpu:draw 10.60, cpu:phase:body-step 5.40, gpu:idle 4.13

## probe-norays

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.64 | 60% | 8.95 | 62% |
| gpu:idle | 4.91 | 28% | 3.41 | 24% |
| sdf:polys | 0.89 | 5% | 0.76 | 5% |
| sdf:shell-hull | 0.09 | 0% | 0.39 | 3% |
| post:fxaa | 0.24 | 1% | 0.22 | 2% |
| sdf:field-mesh | 0.38 | 2% | 0.19 | 1% |
| post:blit | 0.14 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 1% |
| sdf:composite | 0.08 | 0% | 0.06 | 0% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.06 | 0% |
| goo:surface | 0.06 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% | 0.02 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| compute:probe-gather | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **17.70** | 100% | **14.44** | 100% |
| GPU span p50 (first start → last end) | 19.39 |  | 12.16 |  |
| fenced frame p50 | 22.88 |  | 13.73 |  |
| gap (frame − span) | 3.49 | 15% of frame | 1.57 | 11% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 3.80 | 9.50 |
| cpu:tick | 10.20 | 7.70 |
| cpu:draw | 8.00 | 4.40 |
| cpu:phase:body-step | 4.90 | 3.80 |
| cpu:phase:skeleton-mesh | 0.60 | 0.50 |
| cpu:phase:encounter | 0.40 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (21.41 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 5.30, sdf:march 5.21, cpu:draw 3.10, cpu:phase:body-step 2.90, gpu:idle 2.72
- **fire** (48.27 ms labelled — droplets 0→65, goo quads 0→288): sdf:march 10.13, cpu:phase:wound-hit 9.50, cpu:tick 8.70, gpu:idle 6.81, cpu:draw 5.30
- **gib** (33.63 ms labelled — droplets 65→0, goo quads 288→256): sdf:march 9.47, cpu:tick 8.20, cpu:draw 4.70, cpu:phase:body-step 4.10, gpu:idle 3.12

## probe-rate4

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 9.87 | 43% | 6.28 | 37% |
| compute:probe-gather | 4.74 | 21% | 4.23 | 25% |
| gpu:idle | 5.40 | 23% | 3.92 | 23% |
| sdf:march-chunks | 0.86 | 4% | 0.82 | 5% |
| sdf:polys | 0.90 | 4% | 0.77 | 5% |
| post:fxaa | 0.24 | 1% | 0.24 | 1% |
| sdf:field-mesh | 0.42 | 2% | 0.20 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| sdf:shell-hull | 0.08 | 0% | 0.09 | 1% |
| post:vhs | 0.09 | 0% | 0.09 | 1% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.06 | 0% |
| sdf:composite | 0.10 | 0% | 0.06 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.05 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.01 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **23.11** | 100% | **17.04** | 100% |
| GPU span p50 (first start → last end) | 19.78 |  | 14.75 |  |
| fenced frame p50 | 24.56 |  | 17.10 |  |
| gap (frame − span) | 4.78 | 19% of frame | 2.35 | 14% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 10.40 | 7.30 |
| cpu:draw | 8.20 | 6.90 |
| cpu:phase:wound-hit | 4.00 | 5.50 |
| cpu:phase:body-step | 5.00 | 3.80 |
| cpu:phase:skeleton-mesh | 0.50 | 0.50 |
| cpu:phase:encounter | 0.40 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.70 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (32.69 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 7.00, cpu:draw 5.70, compute:probe-gather 4.95, gpu:idle 4.73, sdf:march 4.28
- **fire** (50.03 ms labelled — droplets 0→49, goo quads 0→281): cpu:phase:wound-hit 10.20, cpu:tick 8.20, cpu:draw 8.00, sdf:march 7.91, gpu:idle 5.05
- **gib** (43.31 ms labelled — droplets 49→137, goo quads 281→309): sdf:march 11.07, cpu:tick 9.40, cpu:draw 7.10, cpu:phase:body-step 4.60, compute:probe-gather 3.93

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 14.83 / 23.52 / 25.35 | 71% |
| baseline | 4 | 14.73 / 28.17 / 20.18 | 91% |
| probe-nolights | 3 | 15.80 / 26.03 / 24.25 | 65% |
| probe-nolights | 4 | 14.38 / 29.97 / 25.09 | 108% |
| probe-norays | 3 | 13.19 / 24.16 / 22.88 | 83% |
| probe-norays | 4 | 12.38 / 35.52 / 13.73 | 187% |
| probe-rate4 | 3 | 18.40 / 28.19 / 24.56 | 53% |
| probe-rate4 | 4 | 17.10 / 25.41 / 15.84 | 60% |
