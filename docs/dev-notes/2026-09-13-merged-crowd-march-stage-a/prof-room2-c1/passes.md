# Per-pass GPU attribution

1280x800, repeats=1, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 55.05 | 94% |
| sdf:polys | 1.31 | 2% |
| compute:probe-gather | 0.35 | 1% |
| sdf:last-blit | 0.30 | 1% |
| post:fxaa | 0.28 | 0% |
| post:blit | 0.23 | 0% |
| gpu:idle | 0.20 | 0% |
| goo:surface | 0.17 | 0% |
| sdf:composite | 0.14 | 0% |
| sdf:shell-hull | 0.13 | 0% |
| post:vhs | 0.13 | 0% |
| compute:tile-bin | 0.13 | 0% |
| post:vhs-input | 0.08 | 0% |
| effects | 0.04 | 0% |
| goo:density | 0.03 | 0% |
| **labelled total (sum of medians)** | **58.57** | 100% |
| GPU span p50 (first start → last end) | 60.76 |  |
| fenced frame p50 | 63.18 |  |
| gap (frame − span) | 2.42 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:draw | 26.80 |
| cpu:phase:crowd-goo-outer | 25.60 |
| cpu:phase:crowd-sdf-render | 25.60 |
| cpu:phase:crowd-sdf-inner | 25.40 |
| cpu:tick | 6.50 |
| cpu:phase:body-step | 3.30 |
| cpu:phase:wound-hit | 2.50 |
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

- **walk** (120.25 ms labelled — droplets 16→12, goo quads 261→259): sdf:march 47.10, cpu:draw 16.40, cpu:phase:crowd-goo-outer 14.40, cpu:phase:crowd-sdf-render 14.40, cpu:phase:crowd-sdf-inner 14.20
- **fire** (234.18 ms labelled — droplets 12→159, goo quads 259→357): sdf:march 54.41, cpu:draw 41.20, cpu:phase:crowd-goo-outer 39.50, cpu:phase:crowd-sdf-render 39.50, cpu:phase:crowd-sdf-inner 39.30
- **gib** (312.83 ms labelled — droplets 159→17, goo quads 357→267): sdf:march 73.53, cpu:draw 57.20, cpu:phase:crowd-goo-outer 55.30, cpu:phase:crowd-sdf-render 55.30, cpu:phase:crowd-sdf-inner 55.10

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 43.24 | 93% |
| sdf:polys | 1.16 | 2% |
| compute:probe-gather | 0.44 | 1% |
| sdf:last-blit | 0.33 | 1% |
| gpu:idle | 0.30 | 1% |
| post:fxaa | 0.28 | 1% |
| sdf:shell-hull | 0.23 | 0% |
| post:blit | 0.19 | 0% |
| sdf:composite | 0.17 | 0% |
| goo:surface | 0.17 | 0% |
| post:vhs | 0.11 | 0% |
| post:vhs-input | 0.08 | 0% |
| effects | 0.02 | 0% |
| goo:density | 0.02 | 0% |
| **labelled total (sum of medians)** | **46.74** | 100% |
| GPU span p50 (first start → last end) | 48.44 |  |
| fenced frame p50 | 50.06 |  |
| gap (frame − span) | 1.62 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:phase:wound-hit | 5.40 |
| cpu:tick | 4.90 |
| cpu:draw | 4.70 |
| cpu:phase:crowd-sdf-render | 3.90 |
| cpu:phase:crowd-goo-outer | 3.80 |
| cpu:phase:crowd-sdf-inner | 3.70 |
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

- **walk** (69.09 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 40.33, cpu:tick 4.90, cpu:draw 4.70, cpu:phase:crowd-goo-outer 3.90, cpu:phase:crowd-sdf-render 3.90
- **fire** (73.32 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 41.06, cpu:phase:wound-hit 6.00, cpu:tick 4.80, cpu:draw 4.50, cpu:phase:crowd-goo-outer 3.70
- **gib** (77.06 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 48.65, cpu:tick 5.00, cpu:draw 4.70, cpu:phase:crowd-goo-outer 4.00, cpu:phase:crowd-sdf-render 4.00

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 63.18 | 0% |
| crowd-off | 2 | 50.06 | 0% |
