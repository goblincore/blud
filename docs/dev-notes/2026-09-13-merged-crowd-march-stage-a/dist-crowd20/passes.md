# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 57.78 | 84% |
| gpu:idle | 8.28 | 12% |
| sdf:polys | 1.84 | 3% |
| post:fxaa | 0.30 | 0% |
| sdf:shell-hull | 0.19 | 0% |
| post:blit | 0.16 | 0% |
| goo:surface | 0.12 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:composite | 0.07 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **68.95** | 100% |
| GPU span p50 (first start → last end) | 61.66 |  |
| fenced frame p50 | 62.75 |  |
| gap (frame − span) | 1.09 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 8.30 |
| cpu:phase:wound-hit | 1.50 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (74.84 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 57.77, cpu:draw 7.50, gpu:idle 5.40, sdf:polys 2.04, cpu:phase:skeleton-mesh 0.90
- **fire** (81.45 ms labelled — droplets 0→129, goo quads 0→349): sdf:march 57.53, cpu:draw 8.80, gpu:idle 8.28, cpu:phase:wound-hit 2.40, sdf:polys 1.60
- **gib** (80.94 ms labelled — droplets 129→17, goo quads 349→267): sdf:march 58.59, gpu:idle 8.88, cpu:draw 8.60, sdf:polys 1.62, cpu:phase:skeleton-mesh 0.90

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 28.71 | 84% |
| gpu:idle | 2.11 | 6% |
| sdf:polys | 2.06 | 6% |
| sdf:shell-hull | 0.41 | 1% |
| compute:tile-bin | 0.37 | 1% |
| post:fxaa | 0.22 | 1% |
| post:blit | 0.13 | 0% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **34.36** | 100% |
| GPU span p50 (first start → last end) | 34.54 |  |
| fenced frame p50 | 35.17 |  |
| gap (frame − span) | 0.63 | 2% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 11.00 |
| cpu:phase:wound-hit | 3.00 |
| cpu:phase:tile-binning-submit | 1.90 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (45.97 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 28.74, cpu:draw 9.00, sdf:polys 2.08, gpu:idle 1.82, cpu:phase:tile-binning-submit 1.70
- **fire** (52.63 ms labelled — droplets 0→253, goo quads 0→437): sdf:march 28.07, cpu:draw 11.60, cpu:phase:wound-hit 3.70, cpu:phase:tile-binning-submit 2.20, gpu:idle 2.14
- **gib** (49.57 ms labelled — droplets 253→14, goo quads 437→264): sdf:march 29.02, cpu:draw 10.30, gpu:idle 2.31, cpu:phase:tile-binning-submit 2.20, sdf:polys 2.07

## baseline-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 15.79 | 56% |
| gpu:idle | 9.67 | 34% |
| sdf:polys | 1.71 | 6% |
| post:fxaa | 0.26 | 1% |
| post:blit | 0.16 | 1% |
| sdf:shell-hull | 0.15 | 1% |
| post:vhs | 0.10 | 0% |
| goo:surface | 0.10 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% |
| sdf:last-blit | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **28.08** | 100% |
| GPU span p50 (first start → last end) | 18.59 |  |
| fenced frame p50 | 20.23 |  |
| gap (frame − span) | 1.64 | 8% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.90 |
| cpu:phase:wound-hit | 2.10 |
| cpu:phase:skeleton-mesh | 1.00 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (39.32 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 16.05, cpu:draw 10.80, gpu:idle 8.32, sdf:polys 1.83, cpu:phase:skeleton-mesh 1.10
- **fire** (40.36 ms labelled — droplets 0→132, goo quads 0→352): sdf:march 14.97, gpu:idle 9.73, cpu:draw 9.40, cpu:phase:wound-hit 2.10, sdf:polys 1.60
- **gib** (40.84 ms labelled — droplets 132→15, goo quads 352→265): sdf:march 16.29, gpu:idle 9.90, cpu:draw 9.60, sdf:polys 1.70, cpu:phase:wound-hit 1.00

## crowd-quad-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 12.37 | 74% |
| sdf:polys | 1.98 | 12% |
| gpu:idle | 1.32 | 8% |
| compute:tile-bin | 0.23 | 1% |
| post:fxaa | 0.22 | 1% |
| sdf:shell-hull | 0.16 | 1% |
| post:blit | 0.13 | 1% |
| post:vhs | 0.09 | 1% |
| goo:surface | 0.09 | 1% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| sdf:last-blit | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **16.73** | 100% |
| GPU span p50 (first start → last end) | 16.89 |  |
| fenced frame p50 | 18.72 |  |
| gap (frame − span) | 1.83 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 11.80 |
| cpu:phase:tile-binning-submit | 2.40 |
| cpu:phase:wound-hit | 1.50 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:tick | 0.40 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (33.91 ms labelled — droplets 0→0, goo quads 0→0): cpu:draw 13.00, sdf:march 12.27, cpu:phase:tile-binning-submit 3.00, sdf:polys 1.97, gpu:idle 1.33
- **fire** (33.20 ms labelled — droplets 0→215, goo quads 0→411): sdf:march 12.47, cpu:draw 10.40, cpu:phase:wound-hit 2.60, cpu:phase:tile-binning-submit 2.00, sdf:polys 1.98
- **gib** (37.82 ms labelled — droplets 215→14, goo quads 411→264): cpu:draw 15.00, sdf:march 12.49, cpu:phase:tile-binning-submit 3.10, sdf:polys 2.00, gpu:idle 1.51

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 62.75 | 0% |
| crowd-quad | 1 | 35.17 | 0% |
| baseline-s05 | 1 | 20.23 | 0% |
| crowd-quad-s05 | 1 | 18.72 | 0% |
