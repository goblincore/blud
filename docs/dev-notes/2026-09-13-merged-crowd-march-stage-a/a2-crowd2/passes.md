# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 100.01 | 95% |
| sdf:polys | 1.19 | 1% |
| sdf:composite | 0.80 | 1% |
| goo:surface | 0.80 | 1% |
| sdf:last-blit | 0.61 | 1% |
| post:fxaa | 0.51 | 0% |
| gpu:idle | 0.23 | 0% |
| compute:probe-gather | 0.18 | 0% |
| post:blit | 0.14 | 0% |
| effects | 0.12 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **104.83** | 100% |
| GPU span p50 (first start → last end) | 104.95 |  |
| fenced frame p50 | 107.93 |  |
| gap (frame − span) | 2.98 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.10 |
| cpu:tick | 5.30 |
| cpu:phase:wound-hit | 4.50 |
| cpu:phase:body-step | 2.40 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (96.85 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 75.71, cpu:draw 6.70, cpu:tick 5.30, gpu:idle 2.55, cpu:phase:body-step 2.50
- **fire** (124.34 ms labelled — droplets 6→227, goo quads 258→411): sdf:march 100.01, cpu:draw 6.10, cpu:tick 5.30, cpu:phase:wound-hit 4.50, cpu:phase:body-step 2.40
- **gib** (137.79 ms labelled — droplets 227→17, goo quads 411→267): sdf:march 117.36, cpu:draw 6.00, cpu:tick 5.20, cpu:phase:body-step 2.40, sdf:polys 1.28

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 42.64 | 89% |
| sdf:polys | 1.24 | 3% |
| gpu:idle | 1.21 | 3% |
| sdf:composite | 0.80 | 2% |
| sdf:last-blit | 0.75 | 2% |
| compute:probe-gather | 0.40 | 1% |
| compute:tile-bin | 0.23 | 0% |
| post:fxaa | 0.22 | 0% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.08 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **47.91** | 100% |
| GPU span p50 (first start → last end) | 49.71 |  |
| fenced frame p50 | 51.53 |  |
| gap (frame − span) | 1.82 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 21.30 |
| cpu:tick | 7.00 |
| cpu:phase:wound-hit | 4.50 |
| cpu:phase:body-step | 3.80 |
| cpu:phase:tile-binning-submit | 1.10 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:chunk-bake-swap | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (86.40 ms labelled — droplets 48→29, goo quads 274→265): sdf:march 41.12, cpu:draw 26.50, cpu:tick 6.90, cpu:phase:body-step 3.70, gpu:idle 1.34
- **fire** (87.53 ms labelled — droplets 29→143, goo quads 265→351): sdf:march 43.13, cpu:draw 21.30, cpu:tick 7.10, cpu:phase:wound-hit 4.50, cpu:phase:body-step 3.80
- **gib** (97.28 ms labelled — droplets 143→25, goo quads 351→264): sdf:march 45.32, cpu:draw 32.90, cpu:tick 7.00, cpu:phase:body-step 3.80, cpu:phase:tile-binning-submit 1.30

## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 10.88 | 65% |
| sdf:march-chunks | 2.73 | 16% |
| gpu:idle | 1.13 | 7% |
| sdf:polys | 0.92 | 6% |
| compute:tile-bin | 0.22 | 1% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.13 | 1% |
| compute:probe-gather | 0.09 | 1% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.05 | 0% |
| sdf:shell-hull | 0.04 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **16.62** | 100% |
| GPU span p50 (first start → last end) | 15.24 |  |
| fenced frame p50 | 16.00 |  |
| gap (frame − span) | 0.76 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.10 |
| cpu:tick | 5.40 |
| cpu:phase:wound-hit | 3.40 |
| cpu:phase:body-step | 2.80 |
| cpu:phase:tile-binning-submit | 0.90 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:chunk-bake-swap | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (32.29 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 12.26, cpu:draw 7.00, cpu:tick 5.30, cpu:phase:body-step 2.90, gpu:idle 1.07
- **fire** (34.28 ms labelled — droplets 6→234, goo quads 258→418): sdf:march 11.24, cpu:draw 6.40, cpu:tick 5.50, cpu:phase:wound-hit 3.40, cpu:phase:body-step 2.80
- **gib** (31.74 ms labelled — droplets 234→88, goo quads 418→290): sdf:march 9.67, cpu:tick 5.40, cpu:draw 5.40, cpu:phase:body-step 2.80, sdf:march-chunks 2.73

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 107.93 | 0% |
| crowd-quad | 1 | 51.53 | 0% |
| crowd-boxes | 1 | 16.00 | 0% |
