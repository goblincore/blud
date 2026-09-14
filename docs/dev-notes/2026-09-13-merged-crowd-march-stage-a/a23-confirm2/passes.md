# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 75.61 | 92% |
| gpu:idle | 4.30 | 5% |
| sdf:polys | 0.98 | 1% |
| post:fxaa | 0.21 | 0% |
| compute:probe-gather | 0.16 | 0% |
| post:blit | 0.13 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:last-blit | 0.07 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:composite | 0.07 | 0% |
| goo:surface | 0.05 | 0% |
| post:vhs-input | 0.03 | 0% |
| effects | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **81.79** | 100% |
| GPU span p50 (first start → last end) | 78.27 |  |
| fenced frame p50 | 81.07 |  |
| gap (frame − span) | 2.80 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 5.30 |
| cpu:tick | 5.20 |
| cpu:phase:wound-hit | 4.90 |
| cpu:phase:body-step | 2.40 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (79.00 ms labelled — droplets 36→28, goo quads 270→266): sdf:march 57.92, cpu:draw 6.00, cpu:tick 5.10, gpu:idle 4.88, cpu:phase:body-step 2.40
- **fire** (109.62 ms labelled — droplets 28→243, goo quads 266→415): sdf:march 83.72, cpu:draw 5.90, cpu:tick 5.20, cpu:phase:wound-hit 5.10, gpu:idle 4.58
- **gib** (96.70 ms labelled — droplets 243→11, goo quads 415→261): sdf:march 79.18, cpu:tick 5.20, cpu:draw 4.30, gpu:idle 2.45, cpu:phase:body-step 2.40

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 21.14 | 87% |
| sdf:polys | 1.03 | 4% |
| gpu:idle | 1.03 | 4% |
| sdf:march-chunks | 0.27 | 1% |
| compute:tile-bin | 0.23 | 1% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.13 | 1% |
| post:vhs | 0.08 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **24.43** | 100% |
| GPU span p50 (first start → last end) | 23.86 |  |
| fenced frame p50 | 25.90 |  |
| gap (frame − span) | 2.04 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.90 |
| cpu:tick | 6.10 |
| cpu:phase:body-step | 3.30 |
| cpu:phase:wound-hit | 2.70 |
| cpu:phase:tile-binning-submit | 1.00 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:chunk-bake-swap | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (36.19 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 14.67, cpu:draw 7.30, cpu:tick 5.80, cpu:phase:body-step 3.30, gpu:idle 1.16
- **fire** (48.43 ms labelled — droplets 6→346, goo quads 258→444): sdf:march 22.10, cpu:draw 8.50, cpu:tick 6.30, cpu:phase:body-step 3.40, cpu:phase:wound-hit 2.70
- **gib** (46.59 ms labelled — droplets 346→59, goo quads 444→272): sdf:march 21.90, cpu:draw 8.90, cpu:tick 6.10, cpu:phase:body-step 3.30, sdf:polys 1.10

## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 10.78 | 68% |
| sdf:march-chunks | 1.93 | 12% |
| gpu:idle | 1.34 | 8% |
| sdf:polys | 0.89 | 6% |
| compute:tile-bin | 0.23 | 1% |
| post:fxaa | 0.22 | 1% |
| post:blit | 0.13 | 1% |
| post:vhs | 0.08 | 1% |
| compute:probe-gather | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **15.92** | 100% |
| GPU span p50 (first start → last end) | 15.73 |  |
| fenced frame p50 | 17.22 |  |
| gap (frame − span) | 1.49 | 9% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.20 |
| cpu:tick | 6.10 |
| cpu:phase:wound-hit | 5.90 |
| cpu:phase:body-step | 3.20 |
| cpu:phase:tile-binning-submit | 1.00 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:chunk-bake-swap | 0.30 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (37.75 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 11.92, cpu:draw 8.40, cpu:tick 7.50, cpu:phase:body-step 4.00, gpu:idle 1.64
- **fire** (38.28 ms labelled — droplets 6→213, goo quads 258→397): sdf:march 11.16, cpu:draw 7.00, cpu:phase:wound-hit 6.10, cpu:tick 5.90, cpu:phase:body-step 3.10
- **gib** (31.92 ms labelled — droplets 213→84, goo quads 397→288): sdf:march 10.11, cpu:draw 5.60, cpu:tick 5.40, cpu:phase:body-step 2.80, sdf:march-chunks 1.93

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 81.07 | 0% |
| crowd-quad | 1 | 25.90 | 0% |
| crowd-boxes | 1 | 17.22 | 0% |
