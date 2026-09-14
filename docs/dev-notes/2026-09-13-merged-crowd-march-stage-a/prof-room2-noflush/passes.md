# Per-pass GPU attribution

1280x800, repeats=1, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 36.42 | 90% |
| sdf:polys | 1.33 | 3% |
| sdf:composite | 0.66 | 2% |
| sdf:last-blit | 0.62 | 2% |
| goo:surface | 0.46 | 1% |
| gpu:idle | 0.24 | 1% |
| post:fxaa | 0.21 | 1% |
| compute:probe-gather | 0.21 | 1% |
| post:blit | 0.13 | 0% |
| post:vhs | 0.08 | 0% |
| compute:tile-bin | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **40.56** | 100% |
| GPU span p50 (first start → last end) | 42.08 |  |
| fenced frame p50 | 46.59 |  |
| gap (frame − span) | 4.51 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:tick | 5.60 |
| cpu:draw | 5.30 |
| cpu:phase:crowd-goo-outer | 3.70 |
| cpu:phase:crowd-sdf-render | 3.70 |
| cpu:phase:crowd-sdf-inner | 3.60 |
| cpu:phase:body-step | 2.80 |
| cpu:phase:wound-hit | 1.90 |
| cpu:phase:skeleton-mesh | 0.50 |
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

- **walk** (59.32 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 28.78, cpu:tick 5.80, cpu:draw 5.30, cpu:phase:crowd-goo-outer 3.80, cpu:phase:crowd-sdf-render 3.80
- **fire** (69.25 ms labelled — droplets 6→104, goo quads 258→320): sdf:march 36.42, cpu:tick 5.60, cpu:draw 5.30, cpu:phase:crowd-goo-outer 3.70, cpu:phase:crowd-sdf-render 3.70
- **gib** (78.77 ms labelled — droplets 104→15, goo quads 320→265): sdf:march 46.95, cpu:tick 5.50, cpu:draw 5.30, cpu:phase:crowd-sdf-render 3.80, cpu:phase:crowd-goo-outer 3.80

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 38.82 | 89% |
| sdf:polys | 1.06 | 2% |
| sdf:composite | 0.79 | 2% |
| gpu:idle | 0.77 | 2% |
| sdf:last-blit | 0.60 | 1% |
| goo:surface | 0.55 | 1% |
| post:fxaa | 0.24 | 1% |
| compute:probe-gather | 0.23 | 1% |
| post:blit | 0.14 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **43.40** | 100% |
| GPU span p50 (first start → last end) | 43.79 |  |
| fenced frame p50 | 45.08 |  |
| gap (frame − span) | 1.29 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:phase:wound-hit | 5.40 |
| cpu:tick | 4.70 |
| cpu:draw | 4.40 |
| cpu:phase:crowd-goo-outer | 3.80 |
| cpu:phase:crowd-sdf-render | 3.80 |
| cpu:phase:crowd-sdf-inner | 3.60 |
| cpu:phase:body-step | 2.00 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 2):

- **walk** (63.48 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 35.68, cpu:draw 4.50, cpu:tick 4.40, cpu:phase:crowd-goo-outer 3.90, cpu:phase:crowd-sdf-render 3.90
- **fire** (71.61 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 37.05, cpu:phase:wound-hit 5.50, cpu:tick 4.90, cpu:draw 4.40, cpu:phase:crowd-goo-outer 3.80
- **gib** (73.10 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 44.94, cpu:tick 4.80, cpu:draw 4.50, cpu:phase:crowd-goo-outer 3.80, cpu:phase:crowd-sdf-render 3.80

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 46.59 | 0% |
| crowd-off | 2 | 45.08 | 0% |
