# Per-pass GPU attribution

1280x800, repeats=2, rooms=1

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## crowd-off

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 28.51 | 85% |
| gpu:idle | 3.61 | 11% |
| sdf:polys | 0.77 | 2% |
| post:fxaa | 0.22 | 1% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| sdf:last-blit | 0.04 | 0% |
| post:vhs-input | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **33.69** | 100% |
| GPU span p50 (first start → last end) | 30.18 |  |
| fenced frame p50 | 32.05 |  |
| gap (frame − span) | 1.87 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:phase:wound-hit | 5.30 |
| cpu:tick | 4.80 |
| cpu:draw | 3.10 |
| cpu:phase:crowd-goo-outer | 2.50 |
| cpu:phase:crowd-sdf-render | 2.50 |
| cpu:phase:body-step | 2.40 |
| cpu:phase:crowd-sdf-inner | 2.40 |
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
| sdf:march | 36.70 | 95% |
| sdf:polys | 0.87 | 2% |
| post:fxaa | 0.21 | 1% |
| compute:tile-bin | 0.17 | 0% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.09 | 0% |
| gpu:idle | 0.08 | 0% |
| post:vhs | 0.08 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.04 | 0% |
| sdf:shell-hull | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **38.62** | 100% |
| GPU span p50 (first start → last end) | 34.24 |  |
| fenced frame p50 | 34.68 |  |
| gap (frame − span) | 0.44 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:phase:wound-hit | 5.70 |
| cpu:tick | 5.00 |
| cpu:draw | 3.40 |
| cpu:phase:body-step | 2.40 |
| cpu:phase:crowd-goo-outer | 2.20 |
| cpu:phase:crowd-sdf-render | 2.20 |
| cpu:phase:crowd-sdf-inner | 2.00 |
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
| crowd-off | 1 | 31.26 / 32.05 | 3% |
| crowd-quad | 1 | 34.68 / 34.09 | 2% |
