# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 61.58 | 90% |
| gpu:idle | 4.83 | 7% |
| sdf:polys | 1.11 | 2% |
| post:fxaa | 0.21 | 0% |
| post:blit | 0.12 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **68.25** | 100% |
| GPU span p50 (first start → last end) | 64.09 |  |
| fenced frame p50 | 64.71 |  |
| gap (frame − span) | 0.62 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 5.90 |
| cpu:tick | 5.30 |
| cpu:phase:wound-hit | 5.30 |
| cpu:phase:body-step | 2.60 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (64.23 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 42.53, cpu:draw 6.40, cpu:tick 5.40, gpu:idle 4.82, cpu:phase:body-step 2.70
- **fire** (99.63 ms labelled — droplets 6→116, goo quads 258→336): sdf:march 71.55, cpu:phase:wound-hit 6.20, cpu:draw 6.10, gpu:idle 5.44, cpu:tick 5.30
- **gib** (82.80 ms labelled — droplets 116→9, goo quads 336→259): sdf:march 62.19, cpu:tick 5.30, cpu:draw 5.30, gpu:idle 4.11, cpu:phase:body-step 2.50

## crowd-on

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 66.08 | 95% |
| sdf:polys | 1.34 | 2% |
| gpu:idle | 1.28 | 2% |
| compute:tile-bin | 0.24 | 0% |
| post:fxaa | 0.21 | 0% |
| compute:probe-gather | 0.19 | 0% |
| post:blit | 0.13 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **69.83** | 100% |
| GPU span p50 (first start → last end) | 70.09 |  |
| fenced frame p50 | 73.95 |  |
| gap (frame − span) | 3.86 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 25.00 |
| cpu:tick | 6.80 |
| cpu:phase:body-step | 3.70 |
| cpu:phase:wound-hit | 3.60 |
| cpu:phase:tile-binning-submit | 1.20 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (63.65 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 32.45, cpu:draw 15.70, cpu:tick 6.30, cpu:phase:body-step 3.50, gpu:idle 1.35
- **fire** (132.71 ms labelled — droplets 6→123, goo quads 258→343): sdf:march 76.42, cpu:draw 35.60, cpu:tick 7.10, cpu:phase:body-step 3.90, cpu:phase:wound-hit 3.60
- **gib** (141.63 ms labelled — droplets 123→3, goo quads 343→257): sdf:march 73.27, cpu:draw 50.50, cpu:tick 7.40, cpu:phase:body-step 4.10, sdf:polys 1.38

## crowd-on-tiles-off

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 123.19 | 98% |
| sdf:polys | 1.33 | 1% |
| post:blit | 0.13 | 0% |
| compute:tile-bin | 0.12 | 0% |
| post:fxaa | 0.11 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| sdf:last-blit | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.07 | 0% |
| gpu:idle | 0.06 | 0% |
| compute:probe-gather | 0.06 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **125.44** | 100% |
| GPU span p50 (first start → last end) | 125.60 |  |
| fenced frame p50 | 129.81 |  |
| gap (frame − span) | 4.21 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.10 |
| cpu:tick | 5.80 |
| cpu:phase:wound-hit | 4.10 |
| cpu:phase:body-step | 3.00 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (113.71 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 94.82, cpu:draw 7.50, cpu:tick 5.50, cpu:phase:body-step 2.90, sdf:polys 1.26
- **fire** (156.15 ms labelled — droplets 6→218, goo quads 258→402): sdf:march 131.69, cpu:draw 7.30, cpu:tick 5.90, cpu:phase:wound-hit 5.10, cpu:phase:body-step 3.00
- **gib** (168.67 ms labelled — droplets 218→13, goo quads 402→263): sdf:march 149.95, cpu:draw 6.40, cpu:tick 5.70, cpu:phase:body-step 3.00, sdf:polys 1.35

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 64.71 | 0% |
| crowd-on | 1 | 73.95 | 0% |
| crowd-on-tiles-off | 1 | 129.81 | 0% |
