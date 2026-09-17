# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 74.17 | 94% |
| gpu:idle | 3.02 | 4% |
| sdf:polys | 0.96 | 1% |
| post:fxaa | 0.21 | 0% |
| compute:probe-gather | 0.17 | 0% |
| post:blit | 0.13 | 0% |
| sdf:last-blit | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:composite | 0.07 | 0% |
| goo:surface | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| effects | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **79.08** | 100% |
| GPU span p50 (first start → last end) | 76.67 |  |
| fenced frame p50 | 79.75 |  |
| gap (frame − span) | 3.08 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 5.50 |
| cpu:tick | 5.10 |
| cpu:phase:wound-hit | 5.00 |
| cpu:phase:body-step | 2.30 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (80.47 ms labelled — droplets 36→28, goo quads 270→266): sdf:march 59.00, cpu:draw 6.30, cpu:tick 5.10, gpu:idle 4.91, cpu:phase:body-step 2.40
- **fire** (108.03 ms labelled — droplets 28→243, goo quads 266→415): sdf:march 82.19, cpu:draw 6.10, cpu:tick 5.20, cpu:phase:wound-hit 5.10, gpu:idle 4.27
- **gib** (93.54 ms labelled — droplets 243→11, goo quads 415→261): sdf:march 76.07, cpu:tick 5.10, cpu:draw 4.50, gpu:idle 2.39, cpu:phase:body-step 2.30

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 18.87 | 86% |
| sdf:polys | 1.18 | 5% |
| gpu:idle | 1.08 | 5% |
| compute:tile-bin | 0.19 | 1% |
| post:fxaa | 0.16 | 1% |
| post:blit | 0.13 | 1% |
| compute:probe-gather | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:surface | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **22.03** | 100% |
| GPU span p50 (first start → last end) | 22.01 |  |
| fenced frame p50 | 23.52 |  |
| gap (frame − span) | 1.51 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 8.40 |
| cpu:tick | 6.20 |
| cpu:phase:wound-hit | 3.80 |
| cpu:phase:body-step | 3.30 |
| cpu:phase:tile-binning-submit | 1.00 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (41.84 ms labelled — droplets 46→30, goo quads 272→266): sdf:march 18.79, cpu:draw 8.50, cpu:tick 6.00, cpu:phase:body-step 3.30, sdf:polys 1.17
- **fire** (45.55 ms labelled — droplets 30→142, goo quads 266→350): sdf:march 18.37, cpu:draw 8.60, cpu:tick 6.20, cpu:phase:wound-hit 3.80, cpu:phase:body-step 3.30
- **gib** (42.84 ms labelled — droplets 142→28, goo quads 350→266): sdf:march 19.36, cpu:draw 8.10, cpu:tick 6.20, cpu:phase:body-step 3.30, sdf:polys 1.16

## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 17.34 | 84% |
| sdf:polys | 1.14 | 5% |
| gpu:idle | 1.04 | 5% |
| sdf:march-chunks | 0.23 | 1% |
| compute:tile-bin | 0.22 | 1% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.13 | 1% |
| post:vhs | 0.08 | 0% |
| compute:probe-gather | 0.07 | 0% |
| sdf:shell-hull | 0.06 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:surface | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **20.71** | 100% |
| GPU span p50 (first start → last end) | 20.68 |  |
| fenced frame p50 | 21.98 |  |
| gap (frame − span) | 1.30 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.30 |
| cpu:tick | 5.80 |
| cpu:phase:body-step | 3.10 |
| cpu:phase:wound-hit | 2.70 |
| cpu:phase:tile-binning-submit | 0.90 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (39.46 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 18.91, cpu:draw 7.10, cpu:tick 5.70, cpu:phase:body-step 3.10, sdf:polys 1.02
- **fire** (40.78 ms labelled — droplets 6→126, goo quads 258→346): sdf:march 16.72, cpu:draw 7.40, cpu:tick 5.70, cpu:phase:body-step 3.10, cpu:phase:wound-hit 2.70
- **gib** (39.32 ms labelled — droplets 126→89, goo quads 346→284): sdf:march 16.66, cpu:draw 7.80, cpu:tick 6.00, cpu:phase:body-step 3.10, sdf:polys 1.18

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 79.75 | 0% |
| crowd-quad | 1 | 23.52 | 0% |
| crowd-boxes | 1 | 21.98 | 0% |
