# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 11.99 | 79% | 14.29 | 85% |
| gpu:idle | 2.07 | 14% | 1.24 | 7% |
| sdf:polys | 0.53 | 3% | 0.53 | 3% |
| post:fxaa | 0.23 | 2% | 0.24 | 1% |
| post:blit | 0.14 | 1% | 0.13 | 1% |
| sdf:composite | 0.07 | 0% | 0.12 | 1% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| goo:surface | 0.04 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **15.26** | 100% | **16.75** | 100% |
| GPU span p50 (first start → last end) | 13.76 |  | 18.95 |  |
| fenced frame p50 | 15.10 |  | 23.07 |  |
| gap (frame − span) | 1.34 | 9% of frame | 4.12 | 18% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.30 | 4.50 |
| cpu:phase:wound-hit | 5.00 | 2.90 |
| cpu:draw | 2.40 | 2.50 |
| cpu:phase:body-step | 1.90 | 2.00 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (16.66 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.39, cpu:tick 4.00, cpu:draw 2.30, cpu:phase:body-step 1.80, gpu:idle 1.05
- **fire** (30.25 ms labelled — droplets 0→70, goo quads 0→293): sdf:march 14.29, cpu:tick 4.80, cpu:phase:wound-hit 2.90, cpu:draw 2.60, cpu:phase:body-step 2.10
- **gib** (40.11 ms labelled — droplets 70→12, goo quads 293→262): sdf:march 25.09, cpu:tick 4.90, cpu:draw 2.60, gpu:idle 2.37, cpu:phase:body-step 2.20

## owner-refold-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 9.35 | 73% | 14.23 | 83% |
| gpu:idle | 1.92 | 15% | 1.33 | 8% |
| sdf:polys | 0.54 | 4% | 0.54 | 3% |
| post:fxaa | 0.35 | 3% | 0.36 | 2% |
| sdf:composite | 0.08 | 1% | 0.23 | 1% |
| goo:surface | 0.18 | 1% | 0.22 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| post:smear | 0.09 | 1% | 0.08 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **12.75** | 100% | **17.21** | 100% |
| GPU span p50 (first start → last end) | 14.41 |  | 19.29 |  |
| fenced frame p50 | 16.64 |  | 22.56 |  |
| gap (frame − span) | 2.23 | 13% of frame | 3.27 | 14% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.30 | 4.90 |
| cpu:phase:wound-hit | 4.70 | 3.90 |
| cpu:draw | 2.40 | 2.60 |
| cpu:phase:body-step | 1.90 | 2.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (17.93 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.69, cpu:tick 4.40, cpu:draw 2.50, cpu:phase:body-step 2.00, gpu:idle 1.10
- **fire** (32.95 ms labelled — droplets 0→71, goo quads 0→293): sdf:march 14.23, cpu:tick 4.90, cpu:phase:wound-hit 4.70, cpu:draw 2.60, cpu:phase:body-step 2.20
- **gib** (40.97 ms labelled — droplets 71→8, goo quads 293→260): sdf:march 26.01, cpu:tick 5.20, cpu:draw 2.90, cpu:phase:body-step 2.40, gpu:idle 1.79

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 15.10 / 19.49 / 14.81 | 32% |
| baseline | 4 | 23.07 / 27.14 / 13.29 | 104% |
| owner-refold-off | 3 | 16.64 / 16.70 / 12.44 | 34% |
| owner-refold-off | 4 | 26.38 / 22.56 / 21.61 | 22% |
