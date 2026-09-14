# Per-pass GPU attribution

1280x800, repeats=1, rooms=1,2, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 91.33 | 82% | 48.79 | 86% |
| gpu:idle | 0.01 | 0% | 5.03 | 9% |
| sdf:polys | 1.73 | 2% | 1.69 | 3% |
| post:fxaa | 0.35 | 0% | 0.31 | 1% |
| post:blit | 0.22 | 0% | 0.20 | 0% |
| post:vhs | 0.15 | 0% | 0.14 | 0% |
| sdf:composite | 0.10 | 0% | 0.11 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.10 | 0% |
| compute:probe-gather | 0.18 | 0% | 0.09 | 0% |
| goo:surface | 0.08 | 0% | 0.07 | 0% |
| sdf:last-blit | 0.10 | 0% | 0.06 | 0% |
| post:vhs-input | 0.06 | 0% | 0.06 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 16.41 | 15% | 0.00 | 0% |
| **labelled total (sum of medians)** | **110.84** | 100% | **56.67** | 100% |
| GPU span p50 (first start → last end) | 109.05 |  | 52.31 |  |
| fenced frame p50 | 113.91 |  | 57.23 |  |
| gap (frame − span) | 4.86 | 4% of frame | 4.92 | 9% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 8.50 | 6.60 |
| cpu:tick | 8.80 | 6.00 |
| cpu:draw | 7.10 | 5.50 |
| cpu:phase:body-step | 3.50 | 2.60 |
| cpu:phase:skeleton-mesh | 0.60 | 0.40 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.20 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.10 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (66.35 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 44.64, cpu:tick 5.60, cpu:draw 5.50, gpu:idle 5.03, cpu:phase:body-step 2.40
- **fire** (75.02 ms labelled — droplets 6→169, goo quads 258→360): sdf:march 45.25, cpu:phase:wound-hit 7.90, cpu:tick 5.80, cpu:draw 5.30, gpu:idle 4.74
- **gib** (79.22 ms labelled — droplets 169→16, goo quads 360→266): sdf:march 54.58, cpu:tick 6.40, cpu:draw 5.70, gpu:idle 5.20, cpu:phase:body-step 2.80

## crowd-quad

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 55.64 | 93% | 16.80 | 66% |
| gpu:idle | 1.33 | 2% | 6.44 | 25% |
| sdf:shell-hull | 0.09 | 0% | 0.90 | 4% |
| compute:tile-bin | 0.24 | 0% | 0.22 | 1% |
| post:fxaa | 0.26 | 0% | 0.22 | 1% |
| sdf:polys | 1.68 | 3% | 0.16 | 1% |
| compute:probe-gather | 0.07 | 0% | 0.14 | 1% |
| post:blit | 0.17 | 0% | 0.13 | 1% |
| post:vhs | 0.11 | 0% | 0.09 | 0% |
| sdf:composite | 0.07 | 0% | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| goo:surface | 0.05 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.06 | 0% | 0.03 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **59.84** | 100% | **25.31** | 100% |
| GPU span p50 (first start → last end) | 61.06 |  | 25.82 |  |
| fenced frame p50 | 65.78 |  | 28.01 |  |
| gap (frame − span) | 4.72 | 7% of frame | 2.19 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 22.50 | 13.40 |
| cpu:tick | 9.60 | 11.60 |
| cpu:phase:wound-hit | 8.40 | 7.40 |
| cpu:phase:body-step | 4.70 | 5.70 |
| cpu:phase:tile-binning-submit | 1.30 | 1.60 |
| cpu:phase:skeleton-mesh | 0.50 | 0.60 |
| cpu:phase:crowd-sync | 0.20 | 0.30 |
| cpu:phase:encounter | 0.20 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.20 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (62.25 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 18.37, cpu:draw 14.20, cpu:tick 11.80, gpu:idle 6.87, cpu:phase:body-step 5.80
- **fire** (68.23 ms labelled — droplets 6→188, goo quads 258→374): sdf:march 17.98, cpu:draw 13.60, cpu:tick 11.80, cpu:phase:wound-hit 7.40, gpu:idle 6.61
- **gib** (52.72 ms labelled — droplets 188→17, goo quads 374→267): sdf:march 14.35, cpu:draw 11.10, cpu:tick 10.70, gpu:idle 5.78, cpu:phase:body-step 5.30

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 113.91 | 0% |
| baseline | 2 | 57.23 | 0% |
| crowd-quad | 1 | 65.78 | 0% |
| crowd-quad | 2 | 28.01 | 0% |
