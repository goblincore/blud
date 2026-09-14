# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 44.64 | 81% |
| gpu:idle | 8.08 | 15% |
| sdf:polys | 1.40 | 3% |
| post:fxaa | 0.26 | 0% |
| sdf:shell-hull | 0.16 | 0% |
| post:blit | 0.15 | 0% |
| goo:surface | 0.11 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **55.05** | 100% |
| GPU span p50 (first start → last end) | 47.48 |  |
| fenced frame p50 | 49.81 |  |
| gap (frame − span) | 2.33 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.80 |
| cpu:phase:wound-hit | 1.70 |
| cpu:phase:skeleton-mesh | 0.80 |
| cpu:tick | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (58.61 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 41.01, cpu:draw 7.40, gpu:idle 6.98, sdf:polys 1.39, cpu:phase:skeleton-mesh 0.80
- **fire** (67.65 ms labelled — droplets 0→210, goo quads 0→406): sdf:march 46.03, cpu:draw 8.20, gpu:idle 7.81, cpu:phase:wound-hit 1.80, sdf:polys 1.44
- **gib** (68.69 ms labelled — droplets 210→13, goo quads 406→263): sdf:march 47.76, gpu:idle 8.20, cpu:draw 7.90, sdf:polys 1.45, cpu:phase:wound-hit 1.00

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 26.94 | 83% |
| gpu:idle | 1.98 | 6% |
| sdf:polys | 1.94 | 6% |
| sdf:shell-hull | 0.38 | 1% |
| compute:tile-bin | 0.37 | 1% |
| post:fxaa | 0.24 | 1% |
| post:blit | 0.14 | 0% |
| goo:surface | 0.09 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **32.33** | 100% |
| GPU span p50 (first start → last end) | 32.30 |  |
| fenced frame p50 | 33.32 |  |
| gap (frame − span) | 1.02 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.00 |
| cpu:phase:tile-binning-submit | 1.70 |
| cpu:phase:wound-hit | 1.20 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (42.66 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 27.37, cpu:draw 7.80, sdf:polys 1.96, gpu:idle 1.66, cpu:phase:tile-binning-submit 1.60
- **fire** (46.85 ms labelled — droplets 0→190, goo quads 0→392): sdf:march 25.80, cpu:draw 9.70, cpu:phase:wound-hit 2.60, gpu:idle 2.12, cpu:phase:tile-binning-submit 1.90
- **gib** (45.77 ms labelled — droplets 190→14, goo quads 392→264): sdf:march 27.14, cpu:draw 9.00, gpu:idle 2.11, sdf:polys 1.95, cpu:phase:tile-binning-submit 1.70

## baseline-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 14.13 | 54% |
| gpu:idle | 9.64 | 37% |
| sdf:polys | 1.55 | 6% |
| post:fxaa | 0.26 | 1% |
| post:blit | 0.16 | 1% |
| sdf:shell-hull | 0.15 | 1% |
| goo:surface | 0.10 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:composite | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% |
| sdf:last-blit | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **26.22** | 100% |
| GPU span p50 (first start → last end) | 16.69 |  |
| fenced frame p50 | 18.02 |  |
| gap (frame − span) | 1.33 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.60 |
| cpu:phase:wound-hit | 2.30 |
| cpu:phase:skeleton-mesh | 0.80 |
| cpu:tick | 0.40 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (32.13 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 14.05, cpu:draw 8.40, gpu:idle 6.23, sdf:polys 1.57, cpu:phase:skeleton-mesh 0.80
- **fire** (40.09 ms labelled — droplets 0→248, goo quads 0→432): sdf:march 13.97, cpu:draw 10.20, gpu:idle 9.84, cpu:phase:wound-hit 2.30, sdf:polys 1.36
- **gib** (40.80 ms labelled — droplets 248→14, goo quads 432→264): sdf:march 14.54, cpu:draw 10.90, gpu:idle 10.45, sdf:polys 1.48, cpu:phase:wound-hit 1.00

## crowd-quad-s05

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 11.89 | 76% |
| sdf:polys | 1.85 | 12% |
| gpu:idle | 0.98 | 6% |
| post:fxaa | 0.22 | 1% |
| compute:tile-bin | 0.21 | 1% |
| sdf:shell-hull | 0.14 | 1% |
| post:blit | 0.13 | 1% |
| post:vhs | 0.09 | 1% |
| goo:surface | 0.09 | 1% |
| sdf:composite | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| sdf:last-blit | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **15.73** | 100% |
| GPU span p50 (first start → last end) | 15.82 |  |
| fenced frame p50 | 17.09 |  |
| gap (frame − span) | 1.27 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 9.40 |
| cpu:phase:tile-binning-submit | 1.80 |
| cpu:phase:wound-hit | 1.00 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:tick | 0.30 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (33.02 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 12.99, cpu:draw 12.10, cpu:phase:tile-binning-submit 2.60, sdf:polys 1.96, gpu:idle 1.10
- **fire** (28.49 ms labelled — droplets 0→188, goo quads 0→390): sdf:march 11.56, cpu:draw 9.30, sdf:polys 1.82, cpu:phase:tile-binning-submit 1.70, cpu:phase:wound-hit 1.00
- **gib** (27.40 ms labelled — droplets 188→14, goo quads 390→264): sdf:march 11.82, cpu:draw 8.30, sdf:polys 1.85, cpu:phase:tile-binning-submit 1.60, gpu:idle 0.89

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 49.81 | 0% |
| crowd-quad | 1 | 33.32 | 0% |
| baseline-s05 | 1 | 18.02 | 0% |
| crowd-quad-s05 | 1 | 17.09 | 0% |
