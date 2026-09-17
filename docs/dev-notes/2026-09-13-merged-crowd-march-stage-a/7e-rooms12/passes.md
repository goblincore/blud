# Per-pass GPU attribution

1280x800, repeats=1, rooms=1,2, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 50.70 | 89% | 26.40 | 79% |
| gpu:idle | 0.01 | 0% | 5.14 | 15% |
| sdf:polys | 0.92 | 2% | 1.11 | 3% |
| post:fxaa | 0.21 | 0% | 0.22 | 1% |
| post:blit | 0.13 | 0% | 0.14 | 0% |
| compute:probe-gather | 0.08 | 0% | 0.10 | 0% |
| post:vhs | 0.08 | 0% | 0.09 | 0% |
| sdf:shell-hull | 0.04 | 0% | 0.07 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.05 | 0% | 0.04 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 4.35 | 8% | 0.00 | 0% |
| **labelled total (sum of medians)** | **56.74** | 100% | **33.47** | 100% |
| GPU span p50 (first start → last end) | 53.11 |  | 29.23 |  |
| fenced frame p50 | 54.15 |  | 32.45 |  |
| gap (frame − span) | 1.04 | 2% of frame | 3.22 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 4.60 | 6.30 |
| cpu:tick | 4.90 | 5.90 |
| cpu:draw | 5.20 | 5.70 |
| cpu:phase:body-step | 2.10 | 2.60 |
| cpu:phase:skeleton-mesh | 0.50 | 0.50 |
| cpu:phase:encounter | 0.10 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.10 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (47.02 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 24.29, gpu:idle 5.83, cpu:tick 5.80, cpu:draw 5.80, cpu:phase:body-step 2.70
- **fire** (55.16 ms labelled — droplets 6→169, goo quads 258→360): sdf:march 25.96, cpu:phase:wound-hit 7.00, cpu:tick 6.00, cpu:draw 5.70, gpu:idle 5.13
- **gib** (54.68 ms labelled — droplets 169→16, goo quads 360→266): sdf:march 32.02, cpu:tick 6.00, cpu:draw 5.70, gpu:idle 4.86, cpu:phase:body-step 2.60

## crowd-on

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 65.97 | 92% | 36.24 | 94% |
| sdf:polys | 1.18 | 2% | 1.22 | 3% |
| post:fxaa | 0.15 | 0% | 0.22 | 1% |
| post:blit | 0.17 | 0% | 0.15 | 0% |
| sdf:last-blit | 0.11 | 0% | 0.13 | 0% |
| compute:tile-bin | 0.15 | 0% | 0.12 | 0% |
| compute:probe-gather | 0.05 | 0% | 0.12 | 0% |
| post:vhs | 0.11 | 0% | 0.10 | 0% |
| gpu:idle | 3.37 | 5% | 0.09 | 0% |
| sdf:composite | 0.07 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.07 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| goo:density | 0.01 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **71.53** | 100% | **38.67** | 100% |
| GPU span p50 (first start → last end) | 68.76 |  | 39.40 |  |
| fenced frame p50 | 68.12 |  | 42.07 |  |
| gap (frame − span) | -0.64 | -1% of frame | 2.67 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 11.40 | 11.00 |
| cpu:tick | 6.70 | 10.00 |
| cpu:phase:wound-hit | 6.10 | 7.60 |
| cpu:phase:body-step | 3.40 | 4.80 |
| cpu:phase:skeleton-mesh | 0.40 | 0.60 |
| cpu:phase:crowd-sync | 0.20 | 0.30 |
| cpu:phase:encounter | 0.10 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.00 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.10 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (72.27 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 38.10, cpu:draw 12.90, cpu:tick 11.60, cpu:phase:body-step 5.70, sdf:polys 1.24
- **fire** (65.91 ms labelled — droplets 6→88, goo quads 258→309): sdf:march 29.55, cpu:draw 10.50, cpu:tick 9.80, cpu:phase:wound-hit 7.60, cpu:phase:body-step 4.70
- **gib** (62.75 ms labelled — droplets 88→6, goo quads 309→258): sdf:march 37.75, cpu:draw 8.70, cpu:tick 7.50, cpu:phase:body-step 3.70, cpu:phase:wound-hit 1.90

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 54.15 | 0% |
| baseline | 2 | 32.45 | 0% |
| crowd-on | 1 | 68.12 | 0% |
| crowd-on | 2 | 42.07 | 0% |
