# Per-pass GPU attribution

1280x800, repeats=1, rooms=1,2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.79 | 82% | 44.91 | 95% |
| sdf:polys | 1.04 | 8% | 1.36 | 3% |
| post:fxaa | 0.22 | 2% | 0.21 | 0% |
| gpu:idle | 0.30 | 2% | 0.14 | 0% |
| post:blit | 0.13 | 1% | 0.14 | 0% |
| compute:tile-bin | 0.20 | 1% | 0.11 | 0% |
| goo:surface | 0.10 | 1% | 0.10 | 0% |
| sdf:last-blit | 0.07 | 1% | 0.10 | 0% |
| compute:probe-gather | 0.04 | 0% | 0.10 | 0% |
| post:vhs | 0.08 | 1% | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 1% | 0.07 | 0% |
| sdf:composite | 0.05 | 0% | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **13.15** | 100% | **47.45** | 100% |
| GPU span p50 (first start → last end) | 13.55 |  | 48.20 |  |
| fenced frame p50 | 14.52 |  | 53.01 |  |
| gap (frame − span) | 0.97 | 7% of frame | 4.81 | 9% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 6.30 | 10.80 |
| cpu:tick | 5.00 | 6.30 |
| cpu:phase:wound-hit | 2.10 | 4.40 |
| cpu:phase:body-step | 2.40 | 3.10 |
| cpu:phase:skeleton-mesh | 0.40 | 0.60 |
| cpu:phase:crowd-sync | 0.40 | 0.50 |
| cpu:phase:encounter | 0.10 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (43.96 ms labelled — droplets 0→0, goo quads 256→256): sdf:march 23.15, cpu:draw 8.50, cpu:tick 5.70, cpu:phase:body-step 2.90, sdf:polys 1.27
- **fire** (79.51 ms labelled — droplets 0→158, goo quads 256→355): sdf:march 44.91, cpu:draw 16.20, cpu:tick 6.60, cpu:phase:wound-hit 4.40, cpu:phase:body-step 3.30
- **gib** (120.14 ms labelled — droplets 158→16, goo quads 355→266): sdf:march 61.63, cpu:draw 43.00, cpu:tick 6.80, cpu:phase:body-step 3.40, sdf:polys 1.36

## crowd-off

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 66.26 | 85% | 38.62 | 79% |
| gpu:idle | 0.09 | 0% | 7.80 | 16% |
| sdf:polys | 1.11 | 1% | 1.22 | 3% |
| post:fxaa | 0.26 | 0% | 0.25 | 1% |
| post:blit | 0.15 | 0% | 0.14 | 0% |
| compute:probe-gather | 0.10 | 0% | 0.13 | 0% |
| goo:surface | 0.14 | 0% | 0.12 | 0% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:shell-hull | 0.05 | 0% | 0.07 | 0% |
| sdf:composite | 0.08 | 0% | 0.07 | 0% |
| sdf:last-blit | 0.09 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 9.23 | 12% | 0.00 | 0% |
| **labelled total (sum of medians)** | **77.71** | 100% | **48.62** | 100% |
| GPU span p50 (first start → last end) | 72.23 |  | 41.95 |  |
| fenced frame p50 | 73.80 |  | 45.81 |  |
| gap (frame − span) | 1.57 | 2% of frame | 3.86 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:tick | 9.00 | 9.50 |
| cpu:draw | 7.90 | 8.90 |
| cpu:phase:wound-hit | 8.90 | 8.40 |
| cpu:phase:body-step | 3.70 | 4.10 |
| cpu:phase:skeleton-mesh | 0.70 | 0.70 |
| cpu:phase:encounter | 0.20 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.20 | 0.20 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.10 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (73.98 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 35.17, cpu:tick 10.80, cpu:draw 10.60, gpu:idle 9.56, cpu:phase:body-step 4.60
- **fire** (82.74 ms labelled — droplets 6→169, goo quads 258→360): sdf:march 36.76, cpu:phase:wound-hit 13.40, cpu:tick 9.60, cpu:draw 8.90, gpu:idle 6.45
- **gib** (73.41 ms labelled — droplets 169→16, goo quads 360→266): sdf:march 43.99, gpu:idle 7.82, cpu:tick 7.00, cpu:draw 7.00, cpu:phase:body-step 3.00

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 14.52 | 0% |
| baseline | 2 | 53.01 | 0% |
| crowd-off | 1 | 73.80 | 0% |
| crowd-off | 2 | 45.81 | 0% |
