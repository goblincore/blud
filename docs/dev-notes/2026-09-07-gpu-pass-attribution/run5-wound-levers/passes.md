# Per-pass GPU attribution

1280x800, repeats=2, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 13.18 | 77% | 15.59 | 84% |
| gpu:idle | 1.93 | 11% | 1.14 | 6% |
| sdf:polys | 0.57 | 3% | 0.54 | 3% |
| sdf:composite | 0.21 | 1% | 0.38 | 2% |
| post:fxaa | 0.36 | 2% | 0.36 | 2% |
| goo:surface | 0.41 | 2% | 0.32 | 2% |
| post:blit | 0.17 | 1% | 0.14 | 1% |
| post:smear | 0.08 | 0% | 0.09 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **17.03** | 100% | **18.66** | 100% |
| GPU span p50 (first start → last end) | 18.47 |  | 20.83 |  |
| fenced frame p50 | 21.72 |  | 26.53 |  |
| gap (frame − span) | 3.25 | 15% of frame | 5.70 | 21% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.70 | 4.60 |
| cpu:phase:wound-hit | 4.30 | 4.10 |
| cpu:draw | 2.70 | 2.40 |
| cpu:phase:body-step | 2.00 | 2.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (17.07 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.36, cpu:tick 4.10, cpu:draw 2.30, cpu:phase:body-step 1.90, gpu:idle 1.03
- **fire** (36.13 ms labelled — droplets 0→71, goo quads 0→294): sdf:march 15.59, cpu:phase:wound-hit 6.10, cpu:tick 5.00, cpu:draw 2.50, cpu:phase:body-step 2.10
- **gib** (41.99 ms labelled — droplets 71→13, goo quads 294→263): sdf:march 25.86, cpu:tick 4.90, cpu:draw 2.50, gpu:idle 2.48, cpu:phase:body-step 2.20

## wstep-0.6

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 13.27 | 73% | 19.46 | 84% |
| gpu:idle | 1.73 | 10% | 2.24 | 10% |
| sdf:polys | 0.56 | 3% | 0.57 | 2% |
| post:fxaa | 0.39 | 2% | 0.29 | 1% |
| sdf:composite | 0.58 | 3% | 0.19 | 1% |
| post:blit | 0.15 | 1% | 0.17 | 1% |
| goo:surface | 0.71 | 4% | 0.14 | 1% |
| post:smear | 0.10 | 1% | 0.09 | 0% |
| sdf:shell-hull | 0.09 | 0% | 0.06 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.57 | 3% | 0.00 | 0% |
| **labelled total (sum of medians)** | **18.19** | 100% | **23.27** | 100% |
| GPU span p50 (first start → last end) | 18.25 |  | 24.27 |  |
| fenced frame p50 | 21.95 |  | 31.93 |  |
| gap (frame − span) | 3.70 | 17% of frame | 7.66 | 24% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.70 | 4.80 |
| cpu:phase:wound-hit | 3.90 | 4.20 |
| cpu:draw | 2.60 | 2.40 |
| cpu:phase:body-step | 2.00 | 2.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |

Per segment (top passes, room 4):

- **walk** (18.06 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.68, cpu:tick 4.30, cpu:draw 2.40, cpu:phase:body-step 2.00, gpu:idle 1.45
- **fire** (41.24 ms labelled — droplets 0→61, goo quads 0→286): sdf:march 20.50, cpu:tick 5.50, cpu:phase:wound-hit 5.30, cpu:draw 2.70, gpu:idle 2.51
- **gib** (47.34 ms labelled — droplets 61→13, goo quads 286→263): sdf:march 30.59, cpu:tick 5.10, gpu:idle 3.46, cpu:draw 2.50, cpu:phase:body-step 2.30

## wound-earlyout-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.35 | 76% | 15.31 | 79% |
| gpu:idle | 2.14 | 13% | 2.02 | 10% |
| sdf:march-chunks | 0.00 | 0% | 0.59 | 3% |
| sdf:polys | 0.58 | 4% | 0.58 | 3% |
| post:fxaa | 0.31 | 2% | 0.26 | 1% |
| post:blit | 0.15 | 1% | 0.20 | 1% |
| sdf:composite | 0.17 | 1% | 0.13 | 1% |
| post:smear | 0.08 | 0% | 0.09 | 0% |
| goo:surface | 0.24 | 1% | 0.08 | 0% |
| sdf:shell-hull | 0.09 | 1% | 0.05 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **16.14** | 100% | **19.35** | 100% |
| GPU span p50 (first start → last end) | 17.78 |  | 17.52 |  |
| fenced frame p50 | 22.44 |  | 22.53 |  |
| gap (frame − span) | 4.66 | 21% of frame | 5.01 | 22% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.80 | 5.60 |
| cpu:phase:wound-hit | 5.20 | 4.20 |
| cpu:draw | 2.70 | 3.00 |
| cpu:phase:body-step | 2.10 | 2.50 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.40 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (22.83 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.60, cpu:tick 5.90, cpu:draw 3.30, cpu:phase:body-step 2.60, gpu:idle 2.05
- **fire** (34.90 ms labelled — droplets 0→71, goo quads 0→293): sdf:march 15.31, cpu:tick 5.70, cpu:phase:wound-hit 4.20, cpu:draw 3.00, cpu:phase:body-step 2.40
- **gib** (44.78 ms labelled — droplets 71→9, goo quads 293→261): sdf:march 27.58, cpu:tick 5.20, gpu:idle 3.18, cpu:draw 2.70, cpu:phase:body-step 2.30

## wound-cull-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.80 | 74% | 19.64 | 87% |
| gpu:idle | 2.30 | 13% | 1.39 | 6% |
| sdf:polys | 0.61 | 4% | 0.55 | 2% |
| sdf:composite | 0.36 | 2% | 0.27 | 1% |
| post:fxaa | 0.28 | 2% | 0.25 | 1% |
| goo:surface | 0.18 | 1% | 0.16 | 1% |
| post:blit | 0.18 | 1% | 0.14 | 1% |
| sdf:march-chunks | 0.36 | 2% | 0.09 | 0% |
| post:smear | 0.09 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.09 | 1% | 0.07 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **17.30** | 100% | **22.68** | 100% |
| GPU span p50 (first start → last end) | 18.01 |  | 24.03 |  |
| fenced frame p50 | 20.79 |  | 29.21 |  |
| gap (frame − span) | 2.78 | 13% of frame | 5.18 | 18% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 5.20 | 5.00 |
| cpu:phase:wound-hit | 4.00 | 3.60 |
| cpu:draw | 2.90 | 2.60 |
| cpu:phase:body-step | 2.30 | 2.20 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.50 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (19.50 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.37, cpu:tick 4.90, cpu:draw 2.70, cpu:phase:body-step 2.30, gpu:idle 1.03
- **fire** (40.68 ms labelled — droplets 0→71, goo quads 0→293): sdf:march 19.64, cpu:phase:wound-hit 7.00, cpu:tick 5.00, cpu:draw 2.50, gpu:idle 2.37
- **gib** (72.90 ms labelled — droplets 71→12, goo quads 293→262): sdf:march 54.80, cpu:tick 5.10, gpu:idle 4.33, cpu:draw 2.70, cpu:phase:body-step 2.20

## bleed-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.52 | 79% | 14.75 | 86% |
| gpu:idle | 1.63 | 12% | 1.23 | 7% |
| sdf:polys | 0.53 | 4% | 0.54 | 3% |
| post:fxaa | 0.24 | 2% | 0.24 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| sdf:composite | 0.06 | 0% | 0.07 | 0% |
| post:smear | 0.06 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.06 | 0% | 0.05 | 0% |
| goo:surface | 0.04 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.02 | 0% |
| **labelled total (sum of medians)** | **13.30** | 100% | **17.15** | 100% |
| GPU span p50 (first start → last end) | 12.40 |  | 16.47 |  |
| fenced frame p50 | 14.96 |  | 20.92 |  |
| gap (frame − span) | 2.56 | 17% of frame | 4.45 | 21% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.30 | 4.60 |
| cpu:phase:wound-hit | 5.10 | 3.80 |
| cpu:draw | 2.10 | 2.30 |
| cpu:phase:body-step | 1.90 | 2.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:blood-simulation-and-sync | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (16.69 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.49, cpu:tick 4.00, cpu:draw 2.10, cpu:phase:body-step 1.80, gpu:idle 1.16
- **fire** (30.54 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 14.75, cpu:tick 4.90, cpu:phase:wound-hit 3.80, cpu:draw 2.50, cpu:phase:body-step 2.10
- **gib** (39.91 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 26.79, cpu:tick 5.00, cpu:draw 2.60, cpu:phase:body-step 2.30, gpu:idle 1.70

## chunks-skip

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.20 | 78% | 16.33 | 84% |
| gpu:idle | 1.73 | 11% | 1.70 | 9% |
| sdf:polys | 0.54 | 3% | 0.53 | 3% |
| post:fxaa | 0.36 | 2% | 0.25 | 1% |
| sdf:composite | 0.14 | 1% | 0.20 | 1% |
| goo:surface | 0.27 | 2% | 0.19 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| post:smear | 0.08 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **15.59** | 100% | **19.51** | 100% |
| GPU span p50 (first start → last end) | 17.63 |  | 21.24 |  |
| fenced frame p50 | 19.84 |  | 28.40 |  |
| gap (frame − span) | 2.21 | 11% of frame | 7.16 | 25% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.40 | 4.60 |
| cpu:phase:wound-hit | 4.90 | 3.10 |
| cpu:draw | 2.60 | 2.40 |
| cpu:phase:body-step | 1.90 | 2.00 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (17.06 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.61, cpu:tick 4.10, cpu:draw 2.30, cpu:phase:body-step 1.90, gpu:idle 0.93
- **fire** (34.05 ms labelled — droplets 0→55, goo quads 0→283): sdf:march 16.33, cpu:tick 5.00, cpu:phase:wound-hit 3.10, gpu:idle 2.75, cpu:draw 2.50
- **gib** (43.04 ms labelled — droplets 55→0, goo quads 283→256): sdf:march 27.63, cpu:tick 5.10, gpu:idle 3.21, cpu:draw 2.70, cpu:phase:body-step 2.30

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 19.63 / 21.72 | 11% |
| baseline | 4 | 20.25 / 26.53 | 31% |
| wstep-0.6 | 3 | 21.95 / 20.88 | 5% |
| wstep-0.6 | 4 | 15.97 / 31.93 | 100% |
| wound-earlyout-off | 3 | 16.05 / 22.44 | 40% |
| wound-earlyout-off | 4 | 22.53 / 20.22 | 11% |
| wound-cull-off | 3 | 20.79 / 19.89 | 5% |
| wound-cull-off | 4 | 29.21 / 15.95 | 83% |
| bleed-off | 3 | 14.54 / 14.96 | 3% |
| bleed-off | 4 | 20.74 / 20.92 | 1% |
| chunks-skip | 3 | 19.84 / 15.62 | 27% |
| chunks-skip | 4 | 28.40 / 21.73 | 31% |
