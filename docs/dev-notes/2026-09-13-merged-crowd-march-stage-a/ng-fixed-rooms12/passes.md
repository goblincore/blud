# Per-pass GPU attribution

1280x800, repeats=1, rooms=1,2, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 55.71 | 84% | 32.72 | 85% |
| gpu:idle | 0.01 | 0% | 3.86 | 10% |
| sdf:polys | 0.92 | 1% | 1.04 | 3% |
| post:fxaa | 0.22 | 0% | 0.22 | 1% |
| post:blit | 0.13 | 0% | 0.13 | 0% |
| compute:probe-gather | 0.13 | 0% | 0.12 | 0% |
| goo:surface | 0.12 | 0% | 0.10 | 0% |
| post:vhs | 0.09 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.04 | 0% | 0.07 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.05 | 0% | 0.04 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 8.76 | 13% | 0.00 | 0% |
| **labelled total (sum of medians)** | **66.30** | 100% | **38.49** | 100% |
| GPU span p50 (first start → last end) | 60.62 |  | 35.11 |  |
| fenced frame p50 | 60.15 |  | 36.81 |  |
| gap (frame − span) | -0.47 | -1% of frame | 1.70 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 5.00 | 5.00 |
| cpu:tick | 5.10 | 4.80 |
| cpu:phase:wound-hit | 4.20 | 4.60 |
| cpu:phase:body-step | 2.30 | 2.20 |
| cpu:phase:skeleton-mesh | 0.50 | 0.50 |
| cpu:phase:blood-simulation-and-sync | 0.20 | 0.10 |
| cpu:phase:encounter | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (49.32 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 30.51, cpu:draw 5.10, cpu:tick 4.80, gpu:idle 4.05, cpu:phase:body-step 2.30
- **fire** (55.84 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 31.85, cpu:phase:wound-hit 6.10, cpu:draw 5.00, cpu:tick 4.60, gpu:idle 3.66
- **gib** (56.02 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 37.15, cpu:tick 4.90, cpu:draw 4.70, gpu:idle 3.83, cpu:phase:body-step 2.20

## crowd-quad

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.13 | 75% | 32.28 | 91% |
| sdf:polys | 1.04 | 8% | 1.29 | 4% |
| gpu:idle | 1.31 | 10% | 1.01 | 3% |
| post:fxaa | 0.22 | 2% | 0.21 | 1% |
| compute:tile-bin | 0.19 | 1% | 0.19 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 0% |
| goo:surface | 0.09 | 1% | 0.09 | 0% |
| compute:probe-gather | 0.01 | 0% | 0.09 | 0% |
| post:vhs | 0.08 | 1% | 0.08 | 0% |
| sdf:composite | 0.05 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.06 | 0% | 0.06 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **13.43** | 100% | **35.60** | 100% |
| GPU span p50 (first start → last end) | 13.50 |  | 37.61 |  |
| fenced frame p50 | 14.76 |  | 38.03 |  |
| gap (frame − span) | 1.26 | 9% of frame | 0.42 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 7.50 | 10.80 |
| cpu:tick | 5.10 | 6.30 |
| cpu:phase:body-step | 2.50 | 3.30 |
| cpu:phase:wound-hit | 2.10 | 2.70 |
| cpu:phase:tile-binning-submit | 0.80 | 1.00 |
| cpu:phase:skeleton-mesh | 0.40 | 0.60 |
| cpu:phase:crowd-sync | 0.40 | 0.40 |
| cpu:phase:encounter | 0.10 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (64.12 ms labelled — droplets 5→3, goo quads 257→257): sdf:march 29.72, cpu:draw 19.70, cpu:tick 6.10, cpu:phase:body-step 3.20, sdf:polys 1.30
- **fire** (104.41 ms labelled — droplets 3→88, goo quads 257→310): sdf:march 45.50, cpu:draw 39.10, cpu:tick 6.90, cpu:phase:body-step 3.60, cpu:phase:wound-hit 3.40
- **gib** (29.71 ms labelled — droplets 88→12, goo quads 310→262): sdf:march 8.86, cpu:draw 5.90, cpu:tick 5.60, cpu:phase:body-step 2.90, gpu:idle 1.21

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 60.15 | 0% |
| baseline | 2 | 36.81 | 0% |
| crowd-quad | 1 | 14.76 | 0% |
| crowd-quad | 2 | 38.03 | 0% |
