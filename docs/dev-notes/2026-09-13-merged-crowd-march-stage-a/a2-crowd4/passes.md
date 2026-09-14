# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 122.00 | 94% |
| gpu:idle | 5.41 | 4% |
| sdf:polys | 1.59 | 1% |
| post:fxaa | 0.31 | 0% |
| post:blit | 0.17 | 0% |
| sdf:shell-hull | 0.11 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:composite | 0.08 | 0% |
| sdf:last-blit | 0.08 | 0% |
| goo:surface | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **129.97** | 100% |
| GPU span p50 (first start → last end) | 124.94 |  |
| fenced frame p50 | 130.12 |  |
| gap (frame − span) | 5.18 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 5.60 |
| cpu:tick | 5.60 |
| cpu:phase:body-step | 2.70 |
| cpu:phase:wound-hit | 2.30 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (114.01 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 92.25, cpu:tick 5.60, cpu:draw 5.50, gpu:idle 4.81, cpu:phase:body-step 2.80
- **fire** (168.61 ms labelled — droplets 6→254, goo quads 258→438): sdf:march 139.69, cpu:draw 5.90, gpu:idle 5.68, cpu:tick 5.60, cpu:phase:wound-hit 5.60
- **gib** (148.57 ms labelled — droplets 254→14, goo quads 438→266): sdf:march 125.46, cpu:draw 5.70, cpu:tick 5.60, gpu:idle 5.42, cpu:phase:body-step 2.70

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 69.32 | 94% |
| sdf:polys | 1.62 | 2% |
| gpu:idle | 1.27 | 2% |
| compute:tile-bin | 0.31 | 0% |
| post:fxaa | 0.26 | 0% |
| compute:probe-gather | 0.21 | 0% |
| post:blit | 0.15 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| sdf:composite | 0.06 | 0% |
| goo:surface | 0.05 | 0% |
| sdf:last-blit | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **73.56** | 100% |
| GPU span p50 (first start → last end) | 73.66 |  |
| fenced frame p50 | 77.49 |  |
| gap (frame − span) | 3.83 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 43.00 |
| cpu:tick | 6.90 |
| cpu:phase:body-step | 3.70 |
| cpu:phase:wound-hit | 3.20 |
| cpu:phase:tile-binning-submit | 1.30 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:chunk-bake-swap | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (107.28 ms labelled — droplets 52→32, goo quads 276→268): sdf:march 55.72, cpu:draw 33.80, cpu:tick 6.70, cpu:phase:body-step 3.60, gpu:idle 1.80
- **fire** (139.01 ms labelled — droplets 32→115, goo quads 268→335): sdf:march 70.18, cpu:draw 47.50, cpu:tick 6.90, cpu:phase:wound-hit 4.40, cpu:phase:body-step 3.60
- **gib** (141.86 ms labelled — droplets 115→7, goo quads 335→258): sdf:march 73.43, cpu:draw 50.20, cpu:tick 7.30, cpu:phase:body-step 4.00, sdf:polys 1.52

## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 82.56 | 94% |
| sdf:polys | 1.69 | 2% |
| gpu:idle | 1.60 | 2% |
| sdf:march-chunks | 0.68 | 1% |
| compute:tile-bin | 0.31 | 0% |
| post:fxaa | 0.26 | 0% |
| compute:probe-gather | 0.21 | 0% |
| post:blit | 0.15 | 0% |
| sdf:shell-hull | 0.11 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.07 | 0% |
| goo:surface | 0.05 | 0% |
| sdf:last-blit | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **87.89** | 100% |
| GPU span p50 (first start → last end) | 87.39 |  |
| fenced frame p50 | 89.24 |  |
| gap (frame − span) | 1.85 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 57.10 |
| cpu:tick | 7.10 |
| cpu:phase:wound-hit | 4.90 |
| cpu:phase:body-step | 3.90 |
| cpu:phase:tile-binning-submit | 1.20 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:chunk-bake-swap | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (159.59 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 83.51, cpu:draw 58.30, cpu:tick 6.90, cpu:phase:body-step 3.80, sdf:polys 1.88
- **fire** (215.07 ms labelled — droplets 6→111, goo quads 258→331): sdf:march 135.99, cpu:draw 55.00, cpu:tick 7.40, cpu:phase:wound-hit 4.90, cpu:phase:body-step 3.90
- **gib** (155.65 ms labelled — droplets 111→0, goo quads 331→256): sdf:march 78.59, cpu:draw 58.50, cpu:tick 7.20, cpu:phase:body-step 3.90, gpu:idle 1.71

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 130.12 | 0% |
| crowd-quad | 1 | 77.49 | 0% |
| crowd-boxes | 1 | 89.24 | 0% |
