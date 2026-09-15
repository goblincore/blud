# Per-pass GPU attribution

1280x800, repeats=2, rooms=1

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## crowd-off

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 34.83 | 87% |
| gpu:idle | 3.53 | 9% |
| sdf:polys | 0.85 | 2% |
| post:fxaa | 0.25 | 1% |
| post:blit | 0.15 | 0% |
| goo:surface | 0.11 | 0% |
| post:vhs | 0.09 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:last-blit | 0.07 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **40.15** | 100% |
| GPU span p50 (first start → last end) | 37.01 |  |
| fenced frame p50 | 39.15 |  |
| gap (frame − span) | 2.14 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 5.60 |
| cpu:phase:wound-hit | 5.50 |
| cpu:draw | 3.40 |
| cpu:phase:body-step | 2.70 |
| cpu:phase:crowd-sdf-render | 2.70 |
| cpu:phase:crowd-goo-outer | 2.70 |
| cpu:phase:crowd-sdf-inner | 2.60 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 1):


## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 46.33 | 95% |
| sdf:polys | 0.97 | 2% |
| post:fxaa | 0.23 | 0% |
| compute:tile-bin | 0.17 | 0% |
| gpu:idle | 0.15 | 0% |
| post:blit | 0.14 | 0% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:last-blit | 0.07 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **48.52** | 100% |
| GPU span p50 (first start → last end) | 43.85 |  |
| fenced frame p50 | 45.35 |  |
| gap (frame − span) | 1.50 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 5.30 |
| cpu:phase:wound-hit | 5.20 |
| cpu:draw | 3.40 |
| cpu:phase:body-step | 2.60 |
| cpu:phase:crowd-goo-outer | 2.20 |
| cpu:phase:crowd-sdf-render | 2.20 |
| cpu:phase:crowd-sdf-inner | 2.10 |
| cpu:phase:crowd-sync | 0.50 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:crowd-atlas-flush | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-uniform-copy | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 1):


## crowd-boxes

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 38.70 | 94% |
| sdf:polys | 1.08 | 3% |
| post:fxaa | 0.26 | 1% |
| gpu:idle | 0.23 | 1% |
| compute:tile-bin | 0.20 | 0% |
| post:blit | 0.15 | 0% |
| goo:surface | 0.10 | 0% |
| compute:probe-gather | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:last-blit | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **41.17** | 100% |
| GPU span p50 (first start → last end) | 40.76 |  |
| fenced frame p50 | 43.37 |  |
| gap (frame − span) | 2.61 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 5.30 |
| cpu:phase:wound-hit | 5.20 |
| cpu:draw | 3.40 |
| cpu:phase:body-step | 2.60 |
| cpu:phase:crowd-goo-outer | 2.30 |
| cpu:phase:crowd-sdf-render | 2.30 |
| cpu:phase:crowd-sdf-inner | 2.10 |
| cpu:phase:crowd-sync | 0.50 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:crowd-atlas-flush | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:crowd-uniform-copy | 0.00 |
| cpu:phase:crowd-set-bodies | 0.00 |

Per segment (top passes, room 1):


## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| crowd-off | 1 | 39.15 / 38.38 | 2% |
| crowd-quad | 1 | 44.71 / 45.35 | 1% |
| crowd-boxes | 1 | 42.25 / 43.37 | 3% |
