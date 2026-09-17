# Per-pass GPU attribution

1280x800, repeats=1, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 34.21 | 94% |
| sdf:polys | 1.19 | 3% |
| post:fxaa | 0.21 | 1% |
| compute:tile-bin | 0.19 | 1% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.09 | 0% |
| gpu:idle | 0.09 | 0% |
| compute:probe-gather | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.06 | 0% |
| sdf:last-blit | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **36.51** | 100% |
| GPU span p50 (first start → last end) | 36.79 |  |
| fenced frame p50 | 36.60 |  |
| gap (frame − span) | -0.19 | -1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:tick | 5.50 |
| cpu:draw | 4.50 |
| cpu:phase:crowd-goo-outer | 3.00 |
| cpu:phase:crowd-sdf-render | 3.00 |
| cpu:phase:crowd-sdf-inner | 2.90 |
| cpu:phase:body-step | 2.70 |
| cpu:phase:wound-hit | 2.10 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:crowd-sync | 0.50 |
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

- **walk** (57.92 ms labelled — droplets 3→3, goo quads 257→257): sdf:march 32.19, cpu:tick 5.40, cpu:draw 4.60, cpu:phase:crowd-goo-outer 3.20, cpu:phase:crowd-sdf-render 3.20
- **fire** (72.87 ms labelled — droplets 3→78, goo quads 257→302): sdf:march 43.29, cpu:tick 5.70, cpu:draw 5.00, cpu:phase:crowd-goo-outer 3.30, cpu:phase:crowd-sdf-render 3.30
- **gib** (32.57 ms labelled — droplets 78→8, goo quads 302→258): sdf:march 8.20, cpu:tick 5.50, cpu:draw 4.10, cpu:phase:body-step 2.70, cpu:phase:crowd-goo-outer 2.70

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 34.13 | 85% |
| gpu:idle | 4.00 | 10% |
| sdf:polys | 1.04 | 3% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.13 | 0% |
| compute:probe-gather | 0.12 | 0% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **40.04** | 100% |
| GPU span p50 (first start → last end) | 36.51 |  |
| fenced frame p50 | 37.42 |  |
| gap (frame − span) | 0.91 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:phase:wound-hit | 5.30 |
| cpu:draw | 4.70 |
| cpu:tick | 4.60 |
| cpu:phase:crowd-goo-outer | 3.90 |
| cpu:phase:crowd-sdf-render | 3.90 |
| cpu:phase:crowd-sdf-inner | 3.70 |
| cpu:phase:body-step | 1.90 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (63.25 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 32.42, cpu:draw 5.00, gpu:idle 4.69, cpu:tick 4.40, cpu:phase:crowd-goo-outer 4.20
- **fire** (67.26 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 32.39, cpu:phase:wound-hit 5.70, cpu:draw 4.80, cpu:tick 4.60, cpu:phase:crowd-goo-outer 3.90
- **gib** (68.41 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 39.14, cpu:tick 4.60, cpu:draw 4.50, gpu:idle 3.92, cpu:phase:crowd-goo-outer 3.80

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 36.60 | 0% |
| crowd-off | 2 | 37.42 | 0% |
