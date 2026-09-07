# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.67 | 71% | 15.30 | 68% |
| gpu:idle | 3.61 | 20% | 5.81 | 26% |
| sdf:polys | 0.57 | 3% | 0.67 | 3% |
| post:fxaa | 0.24 | 1% | 0.28 | 1% |
| post:blit | 0.14 | 1% | 0.17 | 1% |
| sdf:composite | 0.09 | 0% | 0.10 | 0% |
| post:smear | 0.08 | 0% | 0.09 | 0% |
| goo:surface | 0.05 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.06 | 0% |
| sdf:occluder | 0.02 | 0% | 0.04 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.31 | 2% | 0.00 | 0% |
| **labelled total (sum of medians)** | **17.87** | 100% | **22.60** | 100% |
| GPU span p50 (first start → last end) | 20.69 |  | 24.49 |  |
| fenced frame p50 | 24.03 |  | 27.53 |  |
| gap (frame − span) | 3.34 | 14% of frame | 3.04 | 11% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 4.20 | 8.00 |
| cpu:tick | 6.90 | 7.20 |
| cpu:draw | 4.00 | 3.80 |
| cpu:phase:body-step | 3.10 | 3.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.60 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (34.57 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 10.10, sdf:march 6.87, gpu:idle 6.60, cpu:draw 5.00, cpu:phase:body-step 4.60
- **fire** (47.97 ms labelled — droplets 0→57, goo quads 0→284): sdf:march 18.61, cpu:tick 8.70, cpu:phase:wound-hit 8.00, cpu:draw 3.90, cpu:phase:body-step 3.70
- **gib** (36.79 ms labelled — droplets 57→0, goo quads 284→256): sdf:march 20.38, cpu:tick 5.90, cpu:draw 2.90, cpu:phase:body-step 2.60, gpu:idle 2.34

## bone-mesh-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 16.93 | 71% | 14.05 | 67% |
| gpu:idle | 3.32 | 14% | 5.17 | 24% |
| sdf:polys | 1.45 | 6% | 1.05 | 5% |
| post:fxaa | 0.48 | 2% | 0.31 | 1% |
| post:blit | 0.19 | 1% | 0.16 | 1% |
| sdf:composite | 0.75 | 3% | 0.13 | 1% |
| post:smear | 0.10 | 0% | 0.08 | 0% |
| goo:surface | 0.29 | 1% | 0.07 | 0% |
| sdf:shell-hull | 0.16 | 1% | 0.07 | 0% |
| sdf:occluder | 0.05 | 0% | 0.03 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **23.74** | 100% | **21.12** | 100% |
| GPU span p50 (first start → last end) | 31.95 |  | 23.69 |  |
| fenced frame p50 | 35.27 |  | 31.43 |  |
| gap (frame − span) | 3.32 | 9% of frame | 7.74 | 25% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 6.80 | 9.40 |
| cpu:phase:wound-hit | 4.20 | 8.40 |
| cpu:draw | 4.70 | 5.50 |
| cpu:phase:body-step | 2.80 | 3.70 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (39.71 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 10.80, sdf:march 8.52, cpu:draw 7.10, gpu:idle 6.29, cpu:phase:body-step 4.70
- **fire** (52.68 ms labelled — droplets 0→42, goo quads 0→278): sdf:march 16.29, cpu:phase:wound-hit 12.40, cpu:tick 9.60, cpu:draw 5.40, cpu:phase:body-step 3.70
- **gib** (44.15 ms labelled — droplets 42→138, goo quads 278→314): sdf:march 20.46, cpu:tick 8.30, cpu:draw 4.90, gpu:idle 3.54, cpu:phase:body-step 3.20

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 24.03 / 17.42 / 28.02 | 61% |
| baseline | 4 | 27.53 / 20.06 / 31.58 | 57% |
| bone-mesh-on | 3 | 75.24 / 17.33 / 35.27 | 334% |
| bone-mesh-on | 4 | 16.27 / 31.43 / 33.34 | 105% |
