# Per-pass GPU attribution

1280x800, repeats=3, rooms=2

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 51.25 | 95% |
| sdf:polys | 1.50 | 3% |
| gpu:idle | 0.27 | 0% |
| post:fxaa | 0.23 | 0% |
| post:blit | 0.14 | 0% |
| compute:tile-bin | 0.14 | 0% |
| goo:surface | 0.11 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:last-blit | 0.09 | 0% |
| compute:probe-gather | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% |
| sdf:composite | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% |
| **labelled total (sum of medians)** | **54.10** | 100% |
| GPU span p50 (first start → last end) | 56.04 |  |
| fenced frame p50 | 67.08 |  |
| gap (frame − span) | 11.04 | 16% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:draw | 15.60 |
| cpu:tick | 10.50 |
| cpu:phase:wound-hit | 9.00 |
| cpu:phase:body-step | 5.20 |
| cpu:phase:crowd-sync | 0.80 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.20 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 2):

- **walk** (64.20 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 20.09, cpu:draw 14.70, cpu:tick 12.40, gpu:idle 6.40, cpu:phase:body-step 6.40
- **fire** (100.68 ms labelled — droplets 6→163, goo quads 258→362): sdf:march 51.34, cpu:draw 15.40, cpu:tick 12.20, cpu:phase:wound-hit 10.80, cpu:phase:body-step 5.90
- **gib** (118.96 ms labelled — droplets 163→16, goo quads 362→266): sdf:march 69.59, cpu:draw 28.80, cpu:tick 9.70, cpu:phase:body-step 5.00, sdf:polys 1.56

## crowd-off

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 42.86 | 82% |
| gpu:idle | 7.25 | 14% |
| sdf:polys | 1.34 | 3% |
| post:fxaa | 0.27 | 1% |
| post:blit | 0.15 | 0% |
| compute:probe-gather | 0.13 | 0% |
| goo:surface | 0.13 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| sdf:last-blit | 0.08 | 0% |
| sdf:composite | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **52.52** | 100% |
| GPU span p50 (first start → last end) | 48.73 |  |
| fenced frame p50 | 52.63 |  |
| gap (frame − span) | 3.90 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:phase:wound-hit | 12.30 |
| cpu:tick | 12.10 |
| cpu:draw | 11.00 |
| cpu:phase:body-step | 5.30 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.20 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 2):

- **walk** (93.43 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 37.81, cpu:draw 17.90, cpu:tick 16.60, gpu:idle 8.78, cpu:phase:body-step 8.10
- **fire** (97.58 ms labelled — droplets 6→172, goo quads 258→364): sdf:march 39.66, cpu:phase:wound-hit 15.80, cpu:tick 12.50, cpu:draw 12.10, gpu:idle 8.44
- **gib** (85.32 ms labelled — droplets 172→14, goo quads 364→264): sdf:march 51.71, cpu:tick 9.20, cpu:draw 8.10, gpu:idle 7.48, cpu:phase:body-step 4.00

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 64.61 / 67.41 / 67.08 | 4% |
| crowd-off | 2 | 52.63 / 47.07 / 53.05 | 13% |
