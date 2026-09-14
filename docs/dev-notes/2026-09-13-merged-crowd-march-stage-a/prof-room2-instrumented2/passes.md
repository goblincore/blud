# Per-pass GPU attribution

1280x800, repeats=1, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 49.80 | 95% |
| sdf:polys | 1.24 | 2% |
| post:fxaa | 0.27 | 1% |
| compute:probe-gather | 0.22 | 0% |
| post:blit | 0.17 | 0% |
| sdf:last-blit | 0.14 | 0% |
| goo:surface | 0.14 | 0% |
| post:vhs | 0.11 | 0% |
| gpu:idle | 0.10 | 0% |
| sdf:composite | 0.10 | 0% |
| compute:tile-bin | 0.09 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| post:vhs-input | 0.07 | 0% |
| effects | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| **labelled total (sum of medians)** | **52.58** | 100% |
| GPU span p50 (first start → last end) | 54.03 |  |
| fenced frame p50 | 58.10 |  |
| gap (frame − span) | 4.07 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:draw | 18.20 |
| cpu:phase:crowd-goo-outer | 16.50 |
| cpu:phase:crowd-sdf-render | 16.50 |
| cpu:phase:crowd-sdf-inner | 16.30 |
| cpu:tick | 6.60 |
| cpu:phase:wound-hit | 5.60 |
| cpu:phase:body-step | 3.50 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:crowd-sync | 0.50 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-uniform-copy | 0.00 |
| cpu:phase:crowd-atlas-flush | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (90.60 ms labelled — droplets 13→14, goo quads 260→261): sdf:march 42.61, cpu:draw 10.00, cpu:phase:crowd-goo-outer 8.20, cpu:phase:crowd-sdf-render 8.20, cpu:phase:crowd-sdf-inner 8.00
- **fire** (191.19 ms labelled — droplets 14→190, goo quads 261→376): sdf:march 49.55, cpu:draw 32.00, cpu:phase:crowd-goo-outer 29.90, cpu:phase:crowd-sdf-render 29.90, cpu:phase:crowd-sdf-inner 29.60
- **gib** (297.89 ms labelled — droplets 190→8, goo quads 376→264): sdf:march 69.71, cpu:draw 54.40, cpu:phase:crowd-goo-outer 53.00, cpu:phase:crowd-sdf-render 53.00, cpu:phase:crowd-sdf-inner 52.80

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 38.46 | 94% |
| sdf:polys | 1.05 | 3% |
| post:fxaa | 0.24 | 1% |
| sdf:last-blit | 0.18 | 0% |
| compute:probe-gather | 0.14 | 0% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.13 | 0% |
| sdf:composite | 0.11 | 0% |
| gpu:idle | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| post:vhs-input | 0.04 | 0% |
| effects | 0.02 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **40.79** | 100% |
| GPU span p50 (first start → last end) | 41.75 |  |
| fenced frame p50 | 43.25 |  |
| gap (frame − span) | 1.50 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:phase:wound-hit | 5.40 |
| cpu:tick | 5.00 |
| cpu:draw | 4.90 |
| cpu:phase:crowd-goo-outer | 3.90 |
| cpu:phase:crowd-sdf-render | 3.90 |
| cpu:phase:crowd-sdf-inner | 3.70 |
| cpu:phase:body-step | 2.20 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (64.60 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 36.44, cpu:draw 5.20, cpu:tick 5.00, cpu:phase:crowd-goo-outer 4.20, cpu:phase:crowd-sdf-render 4.20
- **fire** (68.56 ms labelled — droplets 6→164, goo quads 258→357): sdf:march 35.90, cpu:phase:wound-hit 6.10, cpu:tick 5.10, cpu:draw 4.80, cpu:phase:crowd-goo-outer 3.90
- **gib** (70.82 ms labelled — droplets 164→16, goo quads 357→266): sdf:march 44.37, cpu:tick 4.90, cpu:draw 4.60, cpu:phase:crowd-goo-outer 3.80, cpu:phase:crowd-sdf-render 3.80

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 58.10 | 0% |
| crowd-off | 2 | 43.25 | 0% |
