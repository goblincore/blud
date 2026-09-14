# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 60.96 | 84% |
| gpu:idle | 9.05 | 12% |
| sdf:polys | 1.84 | 3% |
| post:fxaa | 0.29 | 0% |
| sdf:shell-hull | 0.21 | 0% |
| post:blit | 0.17 | 0% |
| goo:surface | 0.12 | 0% |
| post:vhs | 0.11 | 0% |
| sdf:composite | 0.07 | 0% |
| post:vhs-input | 0.05 | 0% |
| sdf:last-blit | 0.05 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **72.93** | 100% |
| GPU span p50 (first start → last end) | 64.61 |  |
| fenced frame p50 | 66.52 |  |
| gap (frame − span) | 1.91 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.60 |
| cpu:phase:wound-hit | 1.40 |
| cpu:phase:skeleton-mesh | 1.20 |
| cpu:tick | 0.40 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (84.14 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 64.83, cpu:draw 8.80, gpu:idle 5.81, sdf:polys 2.20, cpu:phase:skeleton-mesh 1.20
- **fire** (86.81 ms labelled — droplets 0→124, goo quads 0→344): sdf:march 60.92, cpu:draw 10.30, gpu:idle 9.61, sdf:polys 1.59, cpu:phase:wound-hit 1.40
- **gib** (87.35 ms labelled — droplets 124→15, goo quads 344→265): sdf:march 59.58, gpu:idle 12.46, cpu:draw 9.80, sdf:polys 1.53, cpu:phase:skeleton-mesh 1.20

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 30.20 | 85% |
| sdf:polys | 1.97 | 6% |
| gpu:idle | 1.87 | 5% |
| sdf:shell-hull | 0.44 | 1% |
| compute:tile-bin | 0.38 | 1% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.12 | 0% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **35.53** | 100% |
| GPU span p50 (first start → last end) | 35.46 |  |
| fenced frame p50 | 36.42 |  |
| gap (frame − span) | 0.96 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 12.00 |
| cpu:phase:wound-hit | 3.00 |
| cpu:phase:tile-binning-submit | 2.50 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (49.86 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 30.33, cpu:draw 10.90, cpu:phase:tile-binning-submit 2.30, sdf:polys 1.96, gpu:idle 1.62
- **fire** (55.99 ms labelled — droplets 0→256, goo quads 0→440): sdf:march 30.29, cpu:draw 13.00, cpu:phase:wound-hit 3.00, cpu:phase:tile-binning-submit 2.50, gpu:idle 2.05
- **gib** (53.04 ms labelled — droplets 256→14, goo quads 440→264): sdf:march 30.06, cpu:draw 12.30, cpu:phase:tile-binning-submit 2.50, gpu:idle 2.03, sdf:polys 2.00

## baseline-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 17.09 | 58% |
| gpu:idle | 10.26 | 35% |
| sdf:polys | 1.51 | 5% |
| post:fxaa | 0.24 | 1% |
| sdf:shell-hull | 0.17 | 1% |
| post:blit | 0.14 | 0% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **29.71** | 100% |
| GPU span p50 (first start → last end) | 19.41 |  |
| fenced frame p50 | 21.05 |  |
| gap (frame − span) | 1.64 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 8.80 |
| cpu:phase:wound-hit | 1.30 |
| cpu:phase:skeleton-mesh | 1.00 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (36.40 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 17.09, cpu:draw 8.20, gpu:idle 7.55, sdf:polys 1.63, cpu:phase:skeleton-mesh 0.90
- **fire** (42.16 ms labelled — droplets 0→131, goo quads 0→351): sdf:march 17.05, gpu:idle 10.57, cpu:draw 9.60, cpu:phase:wound-hit 1.30, sdf:polys 1.27
- **gib** (41.14 ms labelled — droplets 131→14, goo quads 351→264): sdf:march 17.10, gpu:idle 11.11, cpu:draw 8.70, sdf:polys 1.26, cpu:phase:skeleton-mesh 0.90

## crowd-quad-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 13.49 | 74% |
| sdf:polys | 2.03 | 11% |
| gpu:idle | 1.04 | 6% |
| sdf:march-chunks | 0.57 | 3% |
| compute:tile-bin | 0.26 | 1% |
| sdf:shell-hull | 0.22 | 1% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.12 | 1% |
| post:vhs | 0.08 | 0% |
| goo:surface | 0.08 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| sdf:last-blit | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **18.22** | 100% |
| GPU span p50 (first start → last end) | 17.95 |  |
| fenced frame p50 | 19.28 |  |
| gap (frame − span) | 1.33 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.70 |
| cpu:phase:tile-binning-submit | 1.90 |
| cpu:phase:wound-hit | 0.70 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (28.94 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 13.41, cpu:draw 8.70, sdf:polys 2.00, cpu:phase:tile-binning-submit 1.90, gpu:idle 0.94
- **fire** (31.98 ms labelled — droplets 0→255, goo quads 0→439): sdf:march 13.70, cpu:draw 10.20, sdf:polys 2.04, cpu:phase:tile-binning-submit 1.90, gpu:idle 1.08
- **gib** (31.83 ms labelled — droplets 255→231, goo quads 439→401): sdf:march 13.49, cpu:draw 9.60, sdf:polys 2.05, cpu:phase:tile-binning-submit 1.90, gpu:idle 1.09

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 66.52 | 0% |
| crowd-quad | 1 | 36.42 | 0% |
| baseline-s05 | 1 | 21.05 | 0% |
| crowd-quad-s05 | 1 | 19.28 | 0% |
