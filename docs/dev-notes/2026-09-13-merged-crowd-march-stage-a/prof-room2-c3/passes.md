# Per-pass GPU attribution

1280x800, repeats=1, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 49.74 | 95% |
| sdf:polys | 1.33 | 3% |
| post:fxaa | 0.21 | 0% |
| compute:tile-bin | 0.20 | 0% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.10 | 0% |
| gpu:idle | 0.09 | 0% |
| post:vhs | 0.09 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.06 | 0% |
| sdf:last-blit | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **52.20** | 100% |
| GPU span p50 (first start → last end) | 52.73 |  |
| fenced frame p50 | 55.87 |  |
| gap (frame − span) | 3.14 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:tick | 5.30 |
| cpu:draw | 4.60 |
| cpu:phase:wound-hit | 3.80 |
| cpu:phase:crowd-goo-outer | 3.10 |
| cpu:phase:crowd-sdf-render | 3.10 |
| cpu:phase:crowd-sdf-inner | 3.00 |
| cpu:phase:body-step | 2.60 |
| cpu:phase:crowd-sync | 0.60 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:crowd-atlas-flush | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-uniform-copy | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (55.32 ms labelled — droplets 21→14, goo quads 264→260): sdf:march 29.40, cpu:tick 5.40, cpu:draw 4.70, cpu:phase:crowd-sdf-render 3.20, cpu:phase:crowd-goo-outer 3.10
- **fire** (79.43 ms labelled — droplets 14→28, goo quads 260→268): sdf:march 49.83, cpu:tick 5.50, cpu:draw 4.60, cpu:phase:wound-hit 3.80, cpu:phase:crowd-goo-outer 3.10
- **gib** (84.20 ms labelled — droplets 28→11, goo quads 268→261): sdf:march 57.98, cpu:tick 5.20, cpu:draw 4.60, cpu:phase:crowd-goo-outer 3.20, cpu:phase:crowd-sdf-render 3.20

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 35.79 | 86% |
| gpu:idle | 4.00 | 10% |
| sdf:polys | 1.05 | 3% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.13 | 0% |
| compute:probe-gather | 0.12 | 0% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.00 | 0% |
| **labelled total (sum of medians)** | **41.70** | 100% |
| GPU span p50 (first start → last end) | 38.42 |  |
| fenced frame p50 | 39.54 |  |
| gap (frame − span) | 1.12 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:phase:wound-hit | 5.60 |
| cpu:tick | 4.70 |
| cpu:draw | 4.50 |
| cpu:phase:crowd-goo-outer | 3.70 |
| cpu:phase:crowd-sdf-render | 3.70 |
| cpu:phase:crowd-sdf-inner | 3.60 |
| cpu:phase:body-step | 2.10 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (62.55 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 33.78, cpu:draw 4.50, cpu:tick 4.40, gpu:idle 4.21, cpu:phase:crowd-goo-outer 3.80
- **fire** (69.49 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 34.08, cpu:phase:wound-hit 6.10, cpu:tick 4.90, cpu:draw 4.60, gpu:idle 3.89
- **gib** (69.94 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 41.06, cpu:tick 4.70, cpu:draw 4.40, gpu:idle 3.93, cpu:phase:crowd-goo-outer 3.60

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 55.87 | 0% |
| crowd-off | 2 | 39.54 | 0% |
