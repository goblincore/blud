# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 69.56 | 91% |
| gpu:idle | 4.68 | 6% |
| sdf:polys | 0.96 | 1% |
| post:fxaa | 0.21 | 0% |
| compute:probe-gather | 0.16 | 0% |
| post:blit | 0.12 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:last-blit | 0.07 | 0% |
| sdf:composite | 0.07 | 0% |
| goo:surface | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| effects | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **76.08** | 100% |
| GPU span p50 (first start → last end) | 71.80 |  |
| fenced frame p50 | 73.60 |  |
| gap (frame − span) | 1.80 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 4.90 |
| cpu:draw | 4.90 |
| cpu:phase:wound-hit | 4.90 |
| cpu:phase:body-step | 2.30 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (74.15 ms labelled — droplets 36→28, goo quads 270→266): sdf:march 53.54, cpu:draw 5.70, gpu:idle 5.08, cpu:tick 4.90, cpu:phase:body-step 2.30
- **fire** (107.19 ms labelled — droplets 28→243, goo quads 266→415): sdf:march 81.17, cpu:draw 5.50, cpu:phase:wound-hit 5.30, gpu:idle 5.30, cpu:tick 5.00
- **gib** (89.13 ms labelled — droplets 243→11, goo quads 415→261): sdf:march 72.14, cpu:tick 5.00, cpu:draw 3.90, gpu:idle 2.73, cpu:phase:body-step 2.30

## crowd-on

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 10.24 | 76% |
| gpu:idle | 1.33 | 10% |
| sdf:polys | 0.99 | 7% |
| post:fxaa | 0.21 | 2% |
| compute:tile-bin | 0.21 | 2% |
| post:blit | 0.13 | 1% |
| compute:probe-gather | 0.09 | 1% |
| post:vhs | 0.08 | 1% |
| sdf:composite | 0.05 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:surface | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **13.50** | 100% |
| GPU span p50 (first start → last end) | 13.43 |  |
| fenced frame p50 | 14.37 |  |
| gap (frame − span) | 0.94 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 5.70 |
| cpu:tick | 5.10 |
| cpu:phase:wound-hit | 3.20 |
| cpu:phase:body-step | 2.70 |
| cpu:phase:tile-binning-submit | 0.80 |
| cpu:phase:skeleton-mesh | 0.30 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (30.62 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 11.58, cpu:draw 6.20, cpu:tick 5.30, cpu:phase:body-step 2.80, gpu:idle 1.17
- **fire** (29.54 ms labelled — droplets 7→202, goo quads 259→390): sdf:march 7.83, cpu:draw 5.60, cpu:tick 5.20, cpu:phase:wound-hit 3.20, cpu:phase:body-step 2.80
- **gib** (28.28 ms labelled — droplets 202→13, goo quads 390→263): sdf:march 10.02, cpu:draw 5.60, cpu:tick 4.90, cpu:phase:body-step 2.40, gpu:idle 1.20

## crowd-on-tiles-off

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 24.59 | 80% |
| gpu:idle | 4.60 | 15% |
| sdf:polys | 0.93 | 3% |
| post:blit | 0.14 | 0% |
| compute:tile-bin | 0.11 | 0% |
| post:fxaa | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| compute:probe-gather | 0.07 | 0% |
| sdf:last-blit | 0.07 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **30.91** | 100% |
| GPU span p50 (first start → last end) | 27.43 |  |
| fenced frame p50 | 29.68 |  |
| gap (frame − span) | 2.25 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 5.40 |
| cpu:draw | 5.40 |
| cpu:phase:wound-hit | 3.40 |
| cpu:phase:body-step | 2.90 |
| cpu:phase:skeleton-mesh | 0.30 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (47.59 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 27.66, cpu:draw 5.40, cpu:tick 5.20, gpu:idle 4.24, cpu:phase:body-step 2.80
- **fire** (48.02 ms labelled — droplets 6→138, goo quads 258→358): sdf:march 22.67, cpu:tick 5.40, cpu:draw 5.40, cpu:phase:wound-hit 5.30, gpu:idle 3.77
- **gib** (46.05 ms labelled — droplets 138→22, goo quads 358→272): sdf:march 23.60, gpu:idle 6.08, cpu:tick 5.40, cpu:draw 5.20, cpu:phase:body-step 2.90

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 73.60 | 0% |
| crowd-on | 1 | 14.37 | 0% |
| crowd-on-tiles-off | 1 | 29.68 | 0% |
