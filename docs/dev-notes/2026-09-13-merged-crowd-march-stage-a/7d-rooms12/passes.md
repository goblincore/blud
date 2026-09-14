# Per-pass GPU attribution

1280x800, repeats=1, rooms=1,2, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 53.70 | 90% | 39.00 | 87% |
| gpu:idle | 0.01 | 0% | 4.11 | 9% |
| sdf:polys | 0.92 | 2% | 1.05 | 2% |
| post:fxaa | 0.21 | 0% | 0.21 | 0% |
| post:blit | 0.13 | 0% | 0.13 | 0% |
| compute:probe-gather | 0.09 | 0% | 0.12 | 0% |
| post:vhs | 0.09 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.04 | 0% | 0.07 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.05 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.00 | 0% |
| sdf:march-chunks | 4.22 | 7% | 0.00 | 0% |
| **labelled total (sum of medians)** | **59.62** | 100% | **44.95** | 100% |
| GPU span p50 (first start → last end) | 56.44 |  | 41.29 |  |
| fenced frame p50 | 56.45 |  | 43.36 |  |
| gap (frame − span) | 0.01 | 0% of frame | 2.07 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 4.60 | 5.10 |
| cpu:draw | 4.90 | 4.80 |
| cpu:tick | 4.90 | 4.80 |
| cpu:phase:body-step | 2.20 | 2.10 |
| cpu:phase:skeleton-mesh | 0.50 | 0.40 |
| cpu:phase:encounter | 0.10 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.10 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (53.65 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 35.07, cpu:draw 5.10, cpu:tick 4.70, gpu:idle 4.24, cpu:phase:body-step 2.10
- **fire** (61.70 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 38.43, cpu:phase:wound-hit 5.20, cpu:tick 4.80, cpu:draw 4.70, gpu:idle 4.00
- **gib** (61.99 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 43.35, cpu:tick 4.80, cpu:draw 4.60, gpu:idle 4.15, cpu:phase:body-step 2.10

## crowd-on

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 68.36 | 93% | 72.99 | 93% |
| gpu:idle | 3.17 | 4% | 3.51 | 4% |
| sdf:polys | 1.04 | 1% | 1.18 | 2% |
| post:fxaa | 0.21 | 0% | 0.21 | 0% |
| compute:tile-bin | 0.11 | 0% | 0.16 | 0% |
| post:blit | 0.18 | 0% | 0.14 | 0% |
| post:vhs | 0.09 | 0% | 0.10 | 0% |
| sdf:last-blit | 0.08 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.05 | 0% |
| goo:surface | 0.04 | 0% | 0.04 | 0% |
| compute:probe-gather | 0.03 | 0% | 0.04 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **73.49** | 100% | **78.64** | 100% |
| GPU span p50 (first start → last end) | 70.60 |  | 74.82 |  |
| fenced frame p50 | 68.46 |  | 79.09 |  |
| gap (frame − span) | -2.14 | -3% of frame | 4.27 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 6.60 | 5.60 |
| cpu:tick | 5.20 | 5.40 |
| cpu:phase:body-step | 2.70 | 2.70 |
| cpu:phase:wound-hit | 5.10 | 1.50 |
| cpu:phase:skeleton-mesh | 0.40 | 0.30 |
| cpu:phase:crowd-sync | 0.20 | 0.20 |
| cpu:phase:encounter | 0.10 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (57.80 ms labelled — droplets 7→8, goo quads 259→260): sdf:march 37.89, cpu:draw 5.40, cpu:tick 5.10, gpu:idle 4.08, cpu:phase:body-step 2.60
- **fire** (98.66 ms labelled — droplets 8→151, goo quads 260→354): sdf:march 72.99, cpu:draw 5.70, cpu:tick 5.50, cpu:phase:wound-hit 5.00, gpu:idle 3.68
- **gib** (148.74 ms labelled — droplets 151→3, goo quads 354→257): sdf:march 131.01, cpu:draw 5.70, cpu:tick 5.50, cpu:phase:body-step 2.80, sdf:polys 1.23

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 56.45 | 0% |
| baseline | 2 | 43.36 | 0% |
| crowd-on | 1 | 68.46 | 0% |
| crowd-on | 2 | 79.09 | 0% |
