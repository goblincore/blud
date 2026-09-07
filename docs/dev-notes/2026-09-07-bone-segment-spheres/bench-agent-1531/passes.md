# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 13.30 | 79% | 16.20 | 84% |
| gpu:idle | 2.42 | 14% | 1.92 | 10% |
| sdf:polys | 0.53 | 3% | 0.53 | 3% |
| post:fxaa | 0.23 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| sdf:composite | 0.09 | 1% | 0.08 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% |
| goo:surface | 0.05 | 0% | 0.04 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **16.93** | 100% | **19.29** | 100% |
| GPU span p50 (first start → last end) | 16.04 |  | 18.52 |  |
| fenced frame p50 | 17.67 |  | 24.06 |  |
| gap (frame − span) | 1.63 | 9% of frame | 5.54 | 23% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.50 | 4.60 |
| cpu:phase:wound-hit | 4.10 | 2.70 |
| cpu:draw | 2.40 | 2.40 |
| cpu:phase:body-step | 2.00 | 2.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (17.63 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.79, cpu:tick 4.20, cpu:draw 2.40, cpu:phase:body-step 2.00, gpu:idle 1.11
- **fire** (32.12 ms labelled — droplets 0→70, goo quads 0→292): sdf:march 16.29, cpu:tick 4.90, cpu:phase:wound-hit 2.70, cpu:draw 2.50, cpu:phase:body-step 2.20
- **gib** (36.29 ms labelled — droplets 70→5, goo quads 292→258): sdf:march 22.44, cpu:tick 4.90, cpu:draw 2.40, cpu:phase:body-step 2.20, gpu:idle 2.00

## bone-cull-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 13.06 | 77% | 16.75 | 85% |
| gpu:idle | 2.67 | 16% | 1.79 | 9% |
| sdf:polys | 0.53 | 3% | 0.52 | 3% |
| post:fxaa | 0.23 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| sdf:composite | 0.12 | 1% | 0.08 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% |
| goo:surface | 0.05 | 0% | 0.04 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **16.96** | 100% | **19.69** | 100% |
| GPU span p50 (first start → last end) | 15.97 |  | 19.75 |  |
| fenced frame p50 | 18.14 |  | 24.47 |  |
| gap (frame − span) | 2.17 | 12% of frame | 4.72 | 19% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.60 | 4.70 |
| cpu:phase:wound-hit | 4.70 | 4.30 |
| cpu:draw | 2.40 | 2.40 |
| cpu:phase:body-step | 2.20 | 2.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (18.07 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.62, cpu:tick 4.50, cpu:draw 2.50, cpu:phase:body-step 2.20, gpu:idle 1.13
- **fire** (32.99 ms labelled — droplets 0→41, goo quads 0→275): sdf:march 15.07, cpu:tick 5.10, cpu:phase:wound-hit 4.60, cpu:draw 2.50, cpu:phase:body-step 2.30
- **gib** (45.19 ms labelled — droplets 41→0, goo quads 275→256): sdf:march 31.79, cpu:tick 4.80, cpu:draw 2.50, cpu:phase:body-step 2.30, gpu:idle 1.91

## bone-seg-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.65 | 78% | 16.78 | 85% |
| gpu:idle | 2.33 | 14% | 1.77 | 9% |
| sdf:polys | 0.53 | 3% | 0.54 | 3% |
| post:fxaa | 0.23 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| sdf:composite | 0.08 | 0% | 0.08 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% |
| goo:surface | 0.05 | 0% | 0.04 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| effects | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **16.18** | 100% | **19.74** | 100% |
| GPU span p50 (first start → last end) | 15.37 |  | 19.31 |  |
| fenced frame p50 | 17.68 |  | 25.47 |  |
| gap (frame − span) | 2.31 | 13% of frame | 6.16 | 24% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.60 | 4.70 |
| cpu:phase:wound-hit | 3.90 | 3.40 |
| cpu:draw | 2.40 | 2.40 |
| cpu:phase:body-step | 2.30 | 2.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (18.10 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.74, cpu:tick 4.40, cpu:draw 2.40, cpu:phase:body-step 2.30, gpu:idle 1.11
- **fire** (33.88 ms labelled — droplets 0→74, goo quads 0→295): sdf:march 16.78, cpu:tick 5.20, cpu:phase:wound-hit 3.40, cpu:draw 2.40, cpu:phase:body-step 2.40
- **gib** (45.54 ms labelled — droplets 74→9, goo quads 295→261): sdf:march 31.94, cpu:tick 4.70, cpu:draw 2.50, cpu:phase:body-step 2.30, gpu:idle 1.94

## bone-mesh-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.73 | 75% | 14.45 | 83% |
| gpu:idle | 2.13 | 15% | 1.59 | 9% |
| sdf:polys | 0.78 | 5% | 0.76 | 4% |
| post:fxaa | 0.26 | 2% | 0.26 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| sdf:composite | 0.07 | 0% | 0.07 | 0% |
| post:smear | 0.07 | 1% | 0.07 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% |
| goo:surface | 0.05 | 0% | 0.04 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **14.33** | 100% | **17.47** | 100% |
| GPU span p50 (first start → last end) | 13.33 |  | 17.01 |  |
| fenced frame p50 | 14.96 |  | 22.55 |  |
| gap (frame − span) | 1.63 | 11% of frame | 5.54 | 25% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.10 | 4.30 |
| cpu:phase:wound-hit | 4.50 | 3.60 |
| cpu:draw | 2.70 | 2.80 |
| cpu:phase:body-step | 1.70 | 1.80 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (17.33 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.78, cpu:tick 3.90, cpu:draw 2.70, cpu:phase:body-step 1.70, gpu:idle 0.81
- **fire** (30.36 ms labelled — droplets 0→55, goo quads 0→283): sdf:march 13.28, cpu:tick 4.60, cpu:phase:wound-hit 4.30, cpu:draw 2.90, cpu:phase:body-step 1.90
- **gib** (37.82 ms labelled — droplets 55→0, goo quads 283→256): sdf:march 23.66, cpu:tick 4.80, cpu:draw 3.00, gpu:idle 2.05, cpu:phase:body-step 2.00

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 17.67 / 17.61 / 18.58 | 6% |
| baseline | 4 | 24.06 / 17.17 / 25.30 | 47% |
| bone-cull-on | 3 | 17.88 / 18.14 / 21.92 | 23% |
| bone-cull-on | 4 | 24.47 / 24.42 / 29.76 | 22% |
| bone-seg-on | 3 | 17.68 / 17.57 / 24.80 | 41% |
| bone-seg-on | 4 | 24.33 / 25.47 / 29.16 | 20% |
| bone-mesh-on | 3 | 14.96 / 14.83 / 23.76 | 60% |
| bone-mesh-on | 4 | 22.55 / 15.85 / 23.25 | 47% |
