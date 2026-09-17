# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## crowd-off

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 33.19 | 88% |
| gpu:idle | 2.67 | 7% |
| sdf:polys | 0.97 | 3% |
| post:fxaa | 0.25 | 1% |
| post:blit | 0.14 | 0% |
| goo:surface | 0.10 | 0% |
| compute:probe-gather | 0.09 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:shell-hull | 0.06 | 0% |
| sdf:last-blit | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| effects | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **37.74** | 100% |
| GPU span p50 (first start → last end) | 36.12 |  |
| fenced frame p50 | 36.69 |  |
| gap (frame − span) | 0.57 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:phase:wound-hit | 8.70 |
| cpu:tick | 4.80 |
| cpu:draw | 3.50 |
| cpu:phase:crowd-goo-outer | 2.80 |
| cpu:phase:crowd-sdf-render | 2.80 |
| cpu:phase:crowd-sdf-inner | 2.70 |
| cpu:phase:body-step | 2.10 |
| cpu:phase:skeleton-mesh | 0.30 |
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
| sdf:march | 44.20 | 95% |
| sdf:polys | 1.04 | 2% |
| post:fxaa | 0.24 | 1% |
| compute:tile-bin | 0.20 | 0% |
| post:blit | 0.15 | 0% |
| gpu:idle | 0.14 | 0% |
| compute:probe-gather | 0.10 | 0% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:last-blit | 0.05 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **46.49** | 100% |
| GPU span p50 (first start → last end) | 42.18 |  |
| fenced frame p50 | 42.84 |  |
| gap (frame − span) | 0.66 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:phase:wound-hit | 5.60 |
| cpu:tick | 5.30 |
| cpu:draw | 3.30 |
| cpu:phase:body-step | 2.60 |
| cpu:phase:crowd-goo-outer | 2.10 |
| cpu:phase:crowd-sdf-render | 2.10 |
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
| crowd-off | 1 | 36.69 | 0% |
| crowd-quad | 1 | 42.84 | 0% |
