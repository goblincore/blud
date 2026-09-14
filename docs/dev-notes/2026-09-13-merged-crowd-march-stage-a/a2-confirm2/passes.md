# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 125.15 | 94% |
| gpu:idle | 4.98 | 4% |
| sdf:polys | 1.66 | 1% |
| post:fxaa | 0.30 | 0% |
| compute:probe-gather | 0.27 | 0% |
| post:blit | 0.18 | 0% |
| sdf:last-blit | 0.12 | 0% |
| post:vhs | 0.11 | 0% |
| sdf:composite | 0.10 | 0% |
| sdf:shell-hull | 0.10 | 0% |
| goo:surface | 0.07 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **133.13** | 100% |
| GPU span p50 (first start → last end) | 128.65 |  |
| fenced frame p50 | 132.19 |  |
| gap (frame − span) | 3.54 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 5.10 |
| cpu:tick | 4.90 |
| cpu:phase:wound-hit | 3.50 |
| cpu:phase:body-step | 2.30 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (99.25 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 79.28, cpu:draw 5.10, gpu:idle 4.83, cpu:tick 4.80, cpu:phase:body-step 2.20
- **fire** (150.35 ms labelled — droplets 6→227, goo quads 258→411): sdf:march 125.36, gpu:idle 5.20, cpu:draw 5.20, cpu:tick 5.10, cpu:phase:wound-hit 3.50
- **gib** (182.62 ms labelled — droplets 227→17, goo quads 411→267): sdf:march 160.29, gpu:idle 5.45, cpu:draw 5.00, cpu:tick 4.90, cpu:phase:body-step 2.20

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 46.29 | 90% |
| gpu:idle | 1.88 | 4% |
| sdf:polys | 1.63 | 3% |
| compute:tile-bin | 0.28 | 1% |
| post:fxaa | 0.22 | 0% |
| post:blit | 0.22 | 0% |
| sdf:last-blit | 0.16 | 0% |
| post:vhs | 0.15 | 0% |
| compute:probe-gather | 0.13 | 0% |
| sdf:composite | 0.09 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| post:vhs-input | 0.07 | 0% |
| goo:surface | 0.06 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **51.27** | 100% |
| GPU span p50 (first start → last end) | 51.71 |  |
| fenced frame p50 | 54.47 |  |
| gap (frame − span) | 2.76 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 13.00 |
| cpu:tick | 10.20 |
| cpu:phase:body-step | 5.10 |
| cpu:phase:wound-hit | 3.00 |
| cpu:phase:tile-binning-submit | 1.60 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:crowd-sync | 0.30 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (85.60 ms labelled — droplets 8→8, goo quads 260→260): sdf:march 46.38, cpu:draw 13.20, cpu:tick 11.60, cpu:phase:body-step 5.80, gpu:idle 2.08
- **fire** (87.00 ms labelled — droplets 8→117, goo quads 260→337): sdf:march 47.29, cpu:draw 11.50, cpu:tick 10.30, cpu:phase:wound-hit 5.40, cpu:phase:body-step 5.00
- **gib** (71.99 ms labelled — droplets 117→17, goo quads 337→267): sdf:march 38.54, cpu:draw 13.20, cpu:tick 7.70, cpu:phase:body-step 3.90, gpu:idle 1.94

## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 15.15 | 54% |
| gpu:idle | 10.82 | 39% |
| sdf:shell-hull | 0.99 | 4% |
| compute:tile-bin | 0.26 | 1% |
| post:fxaa | 0.24 | 1% |
| compute:probe-gather | 0.17 | 1% |
| post:blit | 0.14 | 1% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.07 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| sdf:polys | 0.01 | 0% |
| **labelled total (sum of medians)** | **28.07** | 100% |
| GPU span p50 (first start → last end) | 28.92 |  |
| fenced frame p50 | 31.61 |  |
| gap (frame − span) | 2.69 | 9% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 14.60 |
| cpu:tick | 12.80 |
| cpu:phase:body-step | 6.40 |
| cpu:phase:tile-binning-submit | 1.90 |
| cpu:phase:wound-hit | 1.10 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:crowd-sync | 0.30 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (68.27 ms labelled — droplets 6→6, goo quads 258→258): cpu:draw 15.70, sdf:march 14.61, cpu:tick 13.10, gpu:idle 12.22, cpu:phase:body-step 7.10
- **fire** (72.50 ms labelled — droplets 6→137, goo quads 258→357): sdf:march 14.98, cpu:draw 14.10, cpu:tick 12.30, cpu:phase:wound-hit 10.60, gpu:idle 9.20
- **gib** (68.98 ms labelled — droplets 137→18, goo quads 357→268): sdf:march 16.07, cpu:draw 15.40, cpu:tick 13.00, gpu:idle 11.55, cpu:phase:body-step 6.50

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 132.19 | 0% |
| crowd-quad | 1 | 54.47 | 0% |
| crowd-boxes | 1 | 31.61 | 0% |
