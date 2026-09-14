# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 105.75 | 78% |
| sdf:march-chunks | 27.25 | 20% |
| sdf:polys | 1.34 | 1% |
| post:fxaa | 0.31 | 0% |
| post:blit | 0.17 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:last-blit | 0.06 | 0% |
| goo:surface | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| gpu:idle | 0.02 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **135.28** | 100% |
| GPU span p50 (first start → last end) | 118.96 |  |
| fenced frame p50 | 120.45 |  |
| gap (frame − span) | 1.49 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 6.00 |
| cpu:draw | 5.90 |
| cpu:phase:body-step | 3.10 |
| cpu:phase:wound-hit | 2.10 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (153.20 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 127.71, cpu:draw 7.10, gpu:idle 6.00, cpu:tick 6.00, cpu:phase:body-step 3.10
- **fire** (128.63 ms labelled — droplets 7→152, goo quads 259→360): sdf:march 104.84, cpu:tick 5.90, cpu:draw 5.30, gpu:idle 4.32, cpu:phase:body-step 3.00
- **gib** (135.69 ms labelled — droplets 152→76, goo quads 360→287): sdf:march 89.98, sdf:march-chunks 27.25, cpu:tick 6.30, cpu:draw 5.50, cpu:phase:body-step 3.10

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 80.67 | 94% |
| gpu:idle | 1.89 | 2% |
| sdf:polys | 1.83 | 2% |
| post:fxaa | 0.30 | 0% |
| compute:tile-bin | 0.29 | 0% |
| post:blit | 0.18 | 0% |
| post:vhs | 0.12 | 0% |
| sdf:shell-hull | 0.10 | 0% |
| sdf:composite | 0.08 | 0% |
| sdf:last-blit | 0.07 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:surface | 0.05 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **85.66** | 100% |
| GPU span p50 (first start → last end) | 85.91 |  |
| fenced frame p50 | 89.87 |  |
| gap (frame − span) | 3.96 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 55.00 |
| cpu:tick | 8.50 |
| cpu:phase:wound-hit | 5.40 |
| cpu:phase:body-step | 4.50 |
| cpu:phase:tile-binning-submit | 1.50 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (147.58 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 78.44, cpu:draw 47.90, cpu:tick 8.80, cpu:phase:body-step 4.70, sdf:polys 2.02
- **fire** (174.47 ms labelled — droplets 7→235, goo quads 259→419): sdf:march 86.11, cpu:draw 62.30, cpu:tick 8.10, cpu:phase:wound-hit 5.60, cpu:phase:body-step 4.30
- **gib** (153.86 ms labelled — droplets 235→15, goo quads 419→265): sdf:march 78.75, cpu:draw 55.10, cpu:tick 8.00, cpu:phase:body-step 4.50, gpu:idle 1.94

## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 158.48 | 97% |
| sdf:polys | 1.75 | 1% |
| gpu:idle | 1.30 | 1% |
| compute:tile-bin | 0.38 | 0% |
| post:fxaa | 0.30 | 0% |
| post:blit | 0.16 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| sdf:composite | 0.06 | 0% |
| goo:surface | 0.05 | 0% |
| sdf:last-blit | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.03 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **162.79** | 100% |
| GPU span p50 (first start → last end) | 163.15 |  |
| fenced frame p50 | 177.52 |  |
| gap (frame − span) | 14.37 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 88.80 |
| cpu:tick | 6.90 |
| cpu:phase:wound-hit | 4.10 |
| cpu:phase:body-step | 3.80 |
| cpu:phase:tile-binning-submit | 1.30 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (201.27 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 106.62, cpu:draw 76.60, cpu:tick 7.50, cpu:phase:body-step 4.10, sdf:polys 1.80
- **fire** (314.45 ms labelled — droplets 6→107, goo quads 258→331): sdf:march 166.33, cpu:draw 127.40, cpu:tick 6.40, cpu:phase:wound-hit 4.10, cpu:phase:body-step 3.50
- **gib** (355.12 ms labelled — droplets 107→9, goo quads 331→261): sdf:march 199.42, cpu:draw 137.90, cpu:tick 6.80, cpu:phase:body-step 3.90, sdf:polys 1.76

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 120.45 | 0% |
| crowd-quad | 1 | 89.87 | 0% |
| crowd-boxes | 1 | 177.52 | 0% |
