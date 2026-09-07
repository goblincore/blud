# Per-pass GPU attribution

1280x800, repeats=2, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| gpu:idle | 41.72 | 75% | 38.59 | 65% |
| sdf:march | 11.97 | 22% | 18.03 | 31% |
| sdf:polys | 0.55 | 1% | 0.75 | 1% |
| sdf:composite | 0.16 | 0% | 0.66 | 1% |
| post:fxaa | 0.27 | 0% | 0.37 | 1% |
| goo:surface | 0.28 | 1% | 0.21 | 0% |
| post:blit | 0.14 | 0% | 0.17 | 0% |
| sdf:shell-hull | 0.09 | 0% | 0.09 | 0% |
| post:smear | 0.08 | 0% | 0.09 | 0% |
| sdf:occluder | 0.03 | 0% | 0.04 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **55.29** | 100% | **59.02** | 100% |
| GPU span p50 (first start → last end) | 25.82 |  | 37.11 |  |
| fenced frame p50 | 21.50 |  | 29.90 |  |
| gap (frame − span) | -4.32 | -20% of frame | -7.21 | -24% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 5.40 | 5.00 |
| cpu:phase:wound-hit | 4.80 | 4.80 |
| cpu:draw | 2.80 | 2.50 |
| cpu:phase:body-step | 2.30 | 2.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.50 | 0.00 |

Per segment (top passes, room 4):

- **walk** (74.25 ms labelled — droplets 0→0, goo quads 0→0): gpu:idle 56.12, sdf:march 8.05, cpu:tick 4.40, cpu:draw 2.40, cpu:phase:body-step 2.00
- **fire** (40.85 ms labelled — droplets 0→56, goo quads 0→283): sdf:march 19.18, cpu:tick 5.50, cpu:phase:wound-hit 4.80, gpu:idle 2.70, cpu:draw 2.60
- **gib** (48.56 ms labelled — droplets 56→0, goo quads 283→256): sdf:march 31.38, cpu:tick 5.20, gpu:idle 2.59, cpu:draw 2.50, cpu:phase:body-step 2.30

## goo-density-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 25.25 | 80% | 32.74 | 84% |
| sdf:composite | 1.51 | 5% | 1.80 | 5% |
| gpu:idle | 1.81 | 6% | 1.53 | 4% |
| sdf:polys | 1.34 | 4% | 1.11 | 3% |
| goo:surface | 0.40 | 1% | 0.54 | 1% |
| post:fxaa | 0.56 | 2% | 0.53 | 1% |
| post:blit | 0.27 | 1% | 0.24 | 1% |
| post:smear | 0.16 | 1% | 0.15 | 0% |
| sdf:occluder | 0.13 | 0% | 0.10 | 0% |
| sdf:shell-hull | 0.18 | 1% | 0.08 | 0% |
| **labelled total (sum of medians)** | **31.60** | 100% | **38.81** | 100% |
| GPU span p50 (first start → last end) | 34.96 |  | 42.81 |  |
| fenced frame p50 | 40.39 |  | 49.65 |  |
| gap (frame − span) | 5.43 | 13% of frame | 6.84 | 14% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 5.20 | 10.50 |
| cpu:tick | 8.20 | 6.10 |
| cpu:draw | 4.10 | 2.80 |
| cpu:phase:body-step | 3.60 | 2.80 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.50 | 0.00 |

Per segment (top passes, room 4):

- **walk** (35.64 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 17.17, cpu:tick 6.50, cpu:draw 3.10, cpu:phase:body-step 3.00, sdf:polys 1.77
- **fire** (63.63 ms labelled — droplets 0→70, goo quads 0→293): sdf:march 34.64, cpu:phase:wound-hit 10.50, cpu:tick 6.30, cpu:draw 2.80, cpu:phase:body-step 2.70
- **gib** (61.19 ms labelled — droplets 70→9, goo quads 293→261): sdf:march 42.84, cpu:tick 5.70, cpu:phase:body-step 2.70, cpu:draw 2.50, gpu:idle 2.45

## goo-dens-0.125

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| gpu:idle | 65.46 | 72% | 53.32 | 70% |
| sdf:march | 21.58 | 24% | 20.62 | 27% |
| sdf:polys | 0.97 | 1% | 0.86 | 1% |
| sdf:composite | 1.32 | 1% | 0.70 | 1% |
| post:fxaa | 0.42 | 0% | 0.45 | 1% |
| goo:surface | 0.42 | 0% | 0.28 | 0% |
| post:blit | 0.22 | 0% | 0.21 | 0% |
| post:smear | 0.11 | 0% | 0.10 | 0% |
| sdf:shell-hull | 0.13 | 0% | 0.06 | 0% |
| sdf:occluder | 0.05 | 0% | 0.05 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **90.68** | 100% | **76.67** | 100% |
| GPU span p50 (first start → last end) | 37.81 |  | 37.45 |  |
| fenced frame p50 | 36.02 |  | 34.41 |  |
| gap (frame − span) | -1.79 | -5% of frame | -3.04 | -9% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 4.00 | 11.50 |
| cpu:tick | 8.40 | 6.10 |
| cpu:draw | 4.40 | 2.90 |
| cpu:phase:body-step | 3.70 | 2.70 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (109.17 ms labelled — droplets 0→0, goo quads 0→0): gpu:idle 83.60, sdf:march 10.31, cpu:tick 6.10, cpu:draw 3.10, cpu:phase:body-step 2.80
- **fire** (55.66 ms labelled — droplets 0→37, goo quads 0→274): sdf:march 25.29, cpu:phase:wound-hit 11.50, cpu:tick 6.60, cpu:draw 3.00, cpu:phase:body-step 2.80
- **gib** (42.61 ms labelled — droplets 37→0, goo quads 274→256): sdf:march 26.34, cpu:tick 5.40, gpu:idle 2.74, cpu:draw 2.60, cpu:phase:body-step 2.40

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 19.98 / 21.50 | 8% |
| baseline | 4 | 28.39 / 29.90 | 5% |
| goo-density-off | 3 | 21.99 / 40.39 | 84% |
| goo-density-off | 4 | 27.39 / 49.65 | 81% |
| goo-dens-0.125 | 3 | 22.53 / 36.02 | 60% |
| goo-dens-0.125 | 4 | 22.02 / 34.41 | 56% |
