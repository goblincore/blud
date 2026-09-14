# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 24.92 | 73% |
| gpu:idle | 7.23 | 21% |
| sdf:polys | 1.00 | 3% |
| post:fxaa | 0.23 | 1% |
| post:blit | 0.14 | 0% |
| sdf:shell-hull | 0.12 | 0% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **33.97** | 100% |
| GPU span p50 (first start → last end) | 26.80 |  |
| fenced frame p50 | 28.26 |  |
| gap (frame − span) | 1.46 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.70 |
| cpu:phase:wound-hit | 2.50 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (40.26 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 24.82, cpu:draw 7.20, gpu:idle 5.49, sdf:polys 1.08, cpu:phase:skeleton-mesh 0.70
- **fire** (46.54 ms labelled — droplets 0→124, goo quads 0→344): sdf:march 25.23, cpu:draw 8.30, gpu:idle 7.28, cpu:phase:wound-hit 2.60, sdf:polys 0.81
- **gib** (45.00 ms labelled — droplets 124→16, goo quads 344→266): sdf:march 24.91, gpu:idle 8.42, cpu:draw 7.80, cpu:phase:wound-hit 1.00, sdf:polys 0.78

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 11.88 | 78% |
| sdf:polys | 1.44 | 9% |
| gpu:idle | 0.75 | 5% |
| sdf:shell-hull | 0.27 | 2% |
| compute:tile-bin | 0.26 | 2% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.12 | 1% |
| goo:surface | 0.09 | 1% |
| post:vhs | 0.08 | 1% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.02 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **15.25** | 100% |
| GPU span p50 (first start → last end) | 15.05 |  |
| fenced frame p50 | 16.16 |  |
| gap (frame − span) | 1.11 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.40 |
| cpu:phase:wound-hit | 2.60 |
| cpu:phase:tile-binning-submit | 1.10 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (23.70 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 12.73, cpu:draw 6.20, sdf:polys 1.42, cpu:phase:tile-binning-submit 1.10, gpu:idle 0.50
- **fire** (26.01 ms labelled — droplets 0→253, goo quads 0→437): sdf:march 10.82, cpu:draw 6.60, cpu:phase:wound-hit 2.80, sdf:polys 1.44, cpu:phase:tile-binning-submit 1.10
- **gib** (23.59 ms labelled — droplets 253→14, goo quads 437→264): sdf:march 10.53, cpu:draw 6.60, sdf:polys 1.45, cpu:phase:tile-binning-submit 1.10, gpu:idle 1.04

## baseline-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 9.09 | 50% |
| gpu:idle | 7.33 | 40% |
| sdf:polys | 1.00 | 5% |
| post:fxaa | 0.24 | 1% |
| post:blit | 0.14 | 1% |
| sdf:shell-hull | 0.11 | 1% |
| goo:surface | 0.09 | 1% |
| post:vhs | 0.09 | 1% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **18.21** | 100% |
| GPU span p50 (first start → last end) | 10.87 |  |
| fenced frame p50 | 12.09 |  |
| gap (frame − span) | 1.22 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 8.20 |
| cpu:phase:wound-hit | 1.20 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (26.06 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 9.22, cpu:draw 8.50, gpu:idle 5.57, sdf:polys 1.10, cpu:phase:skeleton-mesh 0.70
- **fire** (33.56 ms labelled — droplets 0→127, goo quads 0→347): sdf:march 9.18, cpu:draw 9.10, gpu:idle 8.54, cpu:phase:wound-hit 3.80, sdf:polys 0.83
- **gib** (26.87 ms labelled — droplets 127→18, goo quads 347→268): sdf:march 8.86, gpu:idle 7.41, cpu:draw 6.90, cpu:phase:wound-hit 1.20, sdf:polys 0.80

## crowd-quad-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 7.61 | 75% |
| sdf:polys | 1.45 | 14% |
| gpu:idle | 0.34 | 3% |
| post:fxaa | 0.19 | 2% |
| post:blit | 0.13 | 1% |
| post:vhs | 0.09 | 1% |
| goo:surface | 0.08 | 1% |
| sdf:shell-hull | 0.07 | 1% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| compute:tile-bin | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| sdf:last-blit | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **10.10** | 100% |
| GPU span p50 (first start → last end) | 10.13 |  |
| fenced frame p50 | 10.94 |  |
| gap (frame − span) | 0.81 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.00 |
| cpu:phase:wound-hit | 1.50 |
| cpu:phase:tile-binning-submit | 1.10 |
| cpu:phase:skeleton-mesh | 0.40 |
| cpu:tick | 0.20 |
| cpu:phase:crowd-sync | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (17.02 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.57, cpu:draw 5.40, sdf:polys 1.44, cpu:phase:tile-binning-submit 1.00, cpu:phase:skeleton-mesh 0.40
- **fire** (21.42 ms labelled — droplets 0→257, goo quads 0→441): sdf:march 7.77, cpu:draw 6.50, cpu:phase:wound-hit 2.50, sdf:polys 1.45, cpu:phase:tile-binning-submit 1.10
- **gib** (18.89 ms labelled — droplets 257→14, goo quads 441→264): sdf:march 7.60, cpu:draw 6.20, sdf:polys 1.47, cpu:phase:tile-binning-submit 1.10, cpu:phase:wound-hit 0.70

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 28.26 | 0% |
| crowd-quad | 1 | 16.16 | 0% |
| baseline-s05 | 1 | 12.09 | 0% |
| crowd-quad-s05 | 1 | 10.94 | 0% |
