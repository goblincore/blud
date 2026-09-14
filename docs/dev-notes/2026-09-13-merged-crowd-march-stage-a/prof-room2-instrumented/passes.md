# Per-pass GPU attribution

1280x800, repeats=1, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 42.53 | 92% |
| sdf:polys | 1.26 | 3% |
| sdf:composite | 0.58 | 1% |
| sdf:last-blit | 0.52 | 1% |
| goo:surface | 0.32 | 1% |
| post:fxaa | 0.22 | 0% |
| gpu:idle | 0.20 | 0% |
| compute:tile-bin | 0.20 | 0% |
| post:blit | 0.13 | 0% |
| compute:probe-gather | 0.12 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| effects | 0.02 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **46.30** | 100% |
| GPU span p50 (first start → last end) | 48.40 |  |
| fenced frame p50 | 47.47 |  |
| gap (frame − span) | -0.93 | -2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:draw | 8.40 |
| cpu:phase:crowd-sdf-render | 6.70 |
| cpu:tick | 6.00 |
| cpu:phase:body-step | 3.10 |
| cpu:phase:wound-hit | 2.40 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:crowd-sync | 0.50 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-atlas-flush | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (83.98 ms labelled — droplets 5→6, goo quads 258→258): sdf:march 39.22, cpu:draw 15.50, cpu:phase:crowd-sdf-render 14.50, cpu:tick 6.20, cpu:phase:body-step 3.20
- **fire** (151.43 ms labelled — droplets 6→95, goo quads 258→316): sdf:march 51.23, cpu:draw 41.00, cpu:phase:crowd-sdf-render 39.30, cpu:tick 6.60, cpu:phase:wound-hit 4.10
- **gib** (29.86 ms labelled — droplets 95→8, goo quads 316→258): sdf:march 8.71, cpu:tick 5.40, cpu:draw 4.80, cpu:phase:crowd-sdf-render 3.50, cpu:phase:body-step 2.70

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 39.52 | 91% |
| sdf:polys | 1.11 | 3% |
| sdf:composite | 0.68 | 2% |
| sdf:last-blit | 0.63 | 1% |
| gpu:idle | 0.35 | 1% |
| goo:surface | 0.32 | 1% |
| compute:probe-gather | 0.27 | 1% |
| post:fxaa | 0.24 | 1% |
| post:blit | 0.14 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **43.46** | 100% |
| GPU span p50 (first start → last end) | 44.63 |  |
| fenced frame p50 | 46.52 |  |
| gap (frame − span) | 1.89 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:tick | 4.80 |
| cpu:draw | 4.60 |
| cpu:phase:wound-hit | 4.50 |
| cpu:phase:crowd-sdf-render | 3.80 |
| cpu:phase:body-step | 2.20 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (56.54 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 36.67, cpu:draw 4.70, cpu:tick 4.70, cpu:phase:crowd-sdf-render 3.90, cpu:phase:body-step 2.20
- **fire** (65.08 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 37.71, cpu:phase:wound-hit 5.50, cpu:tick 4.80, cpu:draw 4.70, cpu:phase:crowd-sdf-render 3.70
- **gib** (66.41 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 45.62, cpu:tick 4.90, cpu:draw 4.60, cpu:phase:crowd-sdf-render 3.70, cpu:phase:body-step 2.20

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 47.47 | 0% |
| crowd-off | 2 | 46.52 | 0% |
