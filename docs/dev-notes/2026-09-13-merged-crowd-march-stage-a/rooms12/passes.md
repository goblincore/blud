# Per-pass GPU attribution

1280x800, repeats=3, rooms=1,2, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 15.49 | 65% | 42.25 | 89% |
| gpu:idle | 6.52 | 27% | 2.48 | 5% |
| sdf:polys | 1.04 | 4% | 1.46 | 3% |
| post:fxaa | 0.24 | 1% | 0.34 | 1% |
| sdf:last-blit | 0.06 | 0% | 0.19 | 0% |
| post:blit | 0.14 | 1% | 0.18 | 0% |
| post:vhs | 0.09 | 0% | 0.12 | 0% |
| sdf:composite | 0.07 | 0% | 0.10 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.07 | 0% |
| goo:surface | 0.04 | 0% | 0.06 | 0% |
| compute:probe-gather | 0.10 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.05 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **23.93** | 100% | **47.38** | 100% |
| GPU span p50 (first start → last end) | 23.05 |  | 49.15 |  |
| fenced frame p50 | 28.44 |  | 55.47 |  |
| gap (frame − span) | 5.39 | 19% of frame | 6.32 | 11% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 6.70 | 12.70 |
| cpu:tick | 11.40 | 12.00 |
| cpu:draw | 9.70 | 8.80 |
| cpu:phase:body-step | 5.00 | 5.20 |
| cpu:phase:skeleton-mesh | 0.70 | 0.90 |
| cpu:phase:encounter | 0.20 | 0.40 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.20 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:tile-binning-submit | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (49.66 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 18.95, cpu:tick 12.00, cpu:draw 8.30, cpu:phase:body-step 5.40, gpu:idle 1.63
- **fire** (104.40 ms labelled — droplets 0→220, goo quads 0→404): sdf:march 44.80, cpu:phase:wound-hit 29.30, cpu:tick 11.00, cpu:draw 7.70, cpu:phase:body-step 4.40
- **gib** (85.72 ms labelled — droplets 220→8, goo quads 404→260): sdf:march 53.75, cpu:tick 11.10, cpu:draw 8.30, cpu:phase:body-step 4.60, gpu:idle 2.78

## crowd-on

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 32.07 | 94% | 50.06 | 95% |
| sdf:polys | 1.03 | 3% | 1.31 | 2% |
| post:fxaa | 0.25 | 1% | 0.27 | 1% |
| post:blit | 0.19 | 1% | 0.19 | 0% |
| compute:tile-bin | 0.09 | 0% | 0.17 | 0% |
| post:vhs | 0.11 | 0% | 0.13 | 0% |
| sdf:last-blit | 0.09 | 0% | 0.13 | 0% |
| gpu:idle | 0.06 | 0% | 0.12 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.08 | 0% |
| sdf:composite | 0.06 | 0% | 0.07 | 0% |
| post:vhs-input | 0.06 | 0% | 0.06 | 0% |
| compute:probe-gather | 0.02 | 0% | 0.05 | 0% |
| goo:surface | 0.04 | 0% | 0.04 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **34.18** | 100% | **52.71** | 100% |
| GPU span p50 (first start → last end) | 36.34 |  | 60.10 |  |
| fenced frame p50 | 41.69 |  | 61.78 |  |
| gap (frame − span) | 5.35 | 13% of frame | 1.68 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 10.10 | 11.00 |
| cpu:tick | 9.10 | 8.60 |
| cpu:phase:wound-hit | 7.30 | 8.30 |
| cpu:phase:body-step | 4.50 | 4.20 |
| cpu:phase:skeleton-mesh | 0.50 | 0.50 |
| cpu:phase:crowd-sync | 0.30 | 0.20 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (80.49 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 48.87, cpu:draw 10.90, cpu:tick 8.20, gpu:idle 5.00, cpu:phase:body-step 4.00
- **fire** (90.91 ms labelled — droplets 0→76, goo quads 0→297): sdf:march 51.83, cpu:phase:wound-hit 13.70, cpu:draw 10.00, cpu:tick 8.00, cpu:phase:body-step 3.70
- **gib** (76.68 ms labelled — droplets 76→9, goo quads 297→260): sdf:march 51.59, cpu:draw 9.20, cpu:tick 7.00, cpu:phase:body-step 3.60, cpu:phase:wound-hit 1.30

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 19.70 / 43.50 / 28.44 | 121% |
| baseline | 2 | 36.33 / 55.47 / 58.34 | 61% |
| crowd-on | 1 | 28.92 / 41.69 / 63.54 | 120% |
| crowd-on | 2 | 48.95 / 61.78 / 65.26 | 33% |
