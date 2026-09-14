# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 132.38 | 96% |
| sdf:polys | 2.08 | 2% |
| gpu:idle | 1.98 | 1% |
| sdf:shell-hull | 0.50 | 0% |
| compute:tile-bin | 0.39 | 0% |
| post:fxaa | 0.35 | 0% |
| post:blit | 0.18 | 0% |
| post:vhs | 0.12 | 0% |
| sdf:last-blit | 0.11 | 0% |
| sdf:composite | 0.11 | 0% |
| goo:surface | 0.07 | 0% |
| post:vhs-input | 0.06 | 0% |
| goo:density | 0.03 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **138.38** | 100% |
| GPU span p50 (first start → last end) | 138.55 |  |
| fenced frame p50 | 149.61 |  |
| gap (frame − span) | 11.06 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 76.20 |
| cpu:tick | 9.30 |
| cpu:phase:body-step | 5.70 |
| cpu:phase:wound-hit | 3.70 |
| cpu:phase:tile-binning-submit | 1.80 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (300.51 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 154.44, cpu:draw 120.10, cpu:tick 9.90, cpu:phase:body-step 5.90, sdf:polys 2.95
- **fire** (354.75 ms labelled — droplets 6→240, goo quads 258→424): sdf:march 191.26, cpu:draw 135.50, cpu:tick 9.30, cpu:phase:body-step 5.60, cpu:phase:wound-hit 3.70
- **gib** (165.24 ms labelled — droplets 240→17, goo quads 424→267): sdf:march 92.05, cpu:draw 50.70, cpu:tick 9.10, cpu:phase:body-step 5.50, gpu:idle 1.85

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| crowd-quad | 1 | 149.61 | 0% |
