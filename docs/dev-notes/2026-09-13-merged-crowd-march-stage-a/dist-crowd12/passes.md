# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 30.54 | 77% |
| gpu:idle | 7.17 | 18% |
| sdf:polys | 1.09 | 3% |
| post:fxaa | 0.23 | 1% |
| sdf:shell-hull | 0.14 | 0% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **39.62** | 100% |
| GPU span p50 (first start → last end) | 32.49 |  |
| fenced frame p50 | 33.93 |  |
| gap (frame − span) | 1.44 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.80 |
| cpu:phase:wound-hit | 1.80 |
| cpu:phase:skeleton-mesh | 0.80 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (44.66 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 30.28, cpu:draw 6.90, gpu:idle 4.56, sdf:polys 1.22, cpu:phase:skeleton-mesh 0.70
- **fire** (51.41 ms labelled — droplets 0→210, goo quads 0→406): sdf:march 30.53, cpu:draw 8.50, gpu:idle 7.17, cpu:phase:wound-hit 1.90, cpu:phase:skeleton-mesh 0.90
- **gib** (50.37 ms labelled — droplets 210→13, goo quads 406→263): sdf:march 30.87, cpu:draw 8.10, gpu:idle 7.50, cpu:phase:wound-hit 0.90, sdf:polys 0.82

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 18.12 | 83% |
| sdf:polys | 1.55 | 7% |
| gpu:idle | 1.03 | 5% |
| compute:tile-bin | 0.29 | 1% |
| post:fxaa | 0.22 | 1% |
| sdf:shell-hull | 0.15 | 1% |
| post:blit | 0.13 | 1% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **21.79** | 100% |
| GPU span p50 (first start → last end) | 21.88 |  |
| fenced frame p50 | 23.41 |  |
| gap (frame − span) | 1.53 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.20 |
| cpu:phase:tile-binning-submit | 1.50 |
| cpu:phase:wound-hit | 1.30 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (31.57 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 17.95, cpu:draw 7.90, sdf:polys 1.53, cpu:phase:tile-binning-submit 1.40, gpu:idle 0.67
- **fire** (37.45 ms labelled — droplets 0→195, goo quads 0→397): sdf:march 18.66, cpu:draw 9.70, cpu:phase:wound-hit 2.30, sdf:polys 1.57, cpu:phase:tile-binning-submit 1.50
- **gib** (35.28 ms labelled — droplets 195→14, goo quads 397→264): sdf:march 18.12, cpu:draw 9.50, sdf:polys 1.57, cpu:phase:tile-binning-submit 1.50, gpu:idle 1.39

## baseline-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 11.63 | 56% |
| gpu:idle | 7.23 | 35% |
| sdf:polys | 1.18 | 6% |
| post:fxaa | 0.24 | 1% |
| post:blit | 0.14 | 1% |
| sdf:shell-hull | 0.13 | 1% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| sdf:last-blit | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **20.84** | 100% |
| GPU span p50 (first start → last end) | 13.54 |  |
| fenced frame p50 | 14.81 |  |
| gap (frame − span) | 1.27 | 9% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.20 |
| cpu:phase:wound-hit | 1.60 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (25.19 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 11.51, cpu:draw 5.80, gpu:idle 5.19, sdf:polys 1.23, cpu:phase:skeleton-mesh 0.50
- **fire** (30.69 ms labelled — droplets 0→248, goo quads 0→432): sdf:march 11.68, gpu:idle 7.89, cpu:draw 6.40, cpu:phase:wound-hit 1.60, sdf:polys 1.10
- **gib** (29.34 ms labelled — droplets 248→14, goo quads 432→264): sdf:march 11.77, gpu:idle 7.57, cpu:draw 6.30, sdf:polys 1.08, cpu:phase:wound-hit 0.80

## crowd-quad-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 10.04 | 76% |
| sdf:polys | 1.60 | 12% |
| gpu:idle | 0.60 | 5% |
| post:fxaa | 0.21 | 2% |
| compute:tile-bin | 0.17 | 1% |
| post:blit | 0.13 | 1% |
| sdf:shell-hull | 0.09 | 1% |
| post:vhs | 0.08 | 1% |
| goo:surface | 0.08 | 1% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| sdf:last-blit | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **13.13** | 100% |
| GPU span p50 (first start → last end) | 13.11 |  |
| fenced frame p50 | 14.18 |  |
| gap (frame − span) | 1.07 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.40 |
| cpu:phase:tile-binning-submit | 1.20 |
| cpu:phase:wound-hit | 0.80 |
| cpu:phase:skeleton-mesh | 0.50 |
| cpu:tick | 0.20 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:blood-simulation-and-sync | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (20.87 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 9.85, cpu:draw 6.20, sdf:polys 1.59, cpu:phase:tile-binning-submit 1.20, gpu:idle 0.56
- **fire** (26.08 ms labelled — droplets 0→196, goo quads 0→398): sdf:march 10.15, cpu:draw 7.80, cpu:phase:wound-hit 2.70, sdf:polys 1.61, cpu:phase:tile-binning-submit 1.30
- **gib** (23.69 ms labelled — droplets 196→15, goo quads 398→265): sdf:march 10.10, cpu:draw 7.70, sdf:polys 1.62, cpu:phase:tile-binning-submit 1.20, cpu:phase:wound-hit 0.70

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 33.93 | 0% |
| crowd-quad | 1 | 23.41 | 0% |
| baseline-s05 | 1 | 14.81 | 0% |
| crowd-quad-s05 | 1 | 14.18 | 0% |
