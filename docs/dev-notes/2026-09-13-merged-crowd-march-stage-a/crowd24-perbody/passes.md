# Per-pass GPU attribution

1280x800, repeats=3, rooms=1

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 55.38 | 94% |
| sdf:polys | 1.42 | 2% |
| gpu:idle | 0.79 | 1% |
| post:fxaa | 0.35 | 1% |
| sdf:shell-hull | 0.25 | 0% |
| post:blit | 0.21 | 0% |
| post:vhs | 0.13 | 0% |
| sdf:composite | 0.10 | 0% |
| sdf:last-blit | 0.10 | 0% |
| goo:surface | 0.07 | 0% |
| post:vhs-input | 0.06 | 0% |
| effects | 0.02 | 0% |
| goo:density | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% |
| **labelled total (sum of medians)** | **58.86** | 100% |
| GPU span p50 (first start → last end) | 72.41 |  |
| fenced frame p50 | 85.83 |  |
| gap (frame − span) | 13.42 | 16% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 10.60 |
| cpu:draw | 10.00 |
| cpu:phase:body-step | 6.70 |
| cpu:phase:wound-hit | 5.60 |
| cpu:phase:skeleton-mesh | 1.10 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (154.55 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 120.90, cpu:draw 10.60, cpu:tick 10.20, cpu:phase:body-step 6.30, sdf:polys 3.02
- **fire** (94.66 ms labelled — droplets 0→69, goo quads 0→291): sdf:march 53.30, cpu:tick 10.60, cpu:phase:wound-hit 10.20, cpu:draw 8.90, cpu:phase:body-step 6.70
- **gib** (81.73 ms labelled — droplets 69→150, goo quads 291→328): sdf:march 44.52, cpu:tick 13.40, cpu:draw 9.80, cpu:phase:body-step 8.40, cpu:phase:wound-hit 1.30

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 84.62 / 157.04 / 85.83 | 86% |
