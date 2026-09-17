# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**1 leg-run(s) aborted by the frame guard and skipped:** rep0 crowd-on-tiles-off/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 76.57 | 92% |
| gpu:idle | 5.30 | 6% |
| sdf:polys | 1.07 | 1% |
| post:fxaa | 0.21 | 0% |
| post:blit | 0.13 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **83.66** | 100% |
| GPU span p50 (first start → last end) | 79.16 |  |
| fenced frame p50 | 82.46 |  |
| gap (frame − span) | 3.30 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.00 |
| cpu:tick | 5.90 |
| cpu:phase:wound-hit | 5.10 |
| cpu:phase:body-step | 2.90 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (94.28 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 69.47, cpu:draw 7.70, cpu:tick 5.80, gpu:idle 5.66, cpu:phase:body-step 3.00
- **fire** (109.02 ms labelled — droplets 6→226, goo quads 258→410): sdf:march 79.90, cpu:draw 6.80, gpu:idle 5.90, cpu:tick 5.80, cpu:phase:wound-hit 5.10
- **gib** (106.63 ms labelled — droplets 226→16, goo quads 410→266): sdf:march 81.77, cpu:draw 6.70, cpu:tick 6.00, gpu:idle 5.11, cpu:phase:body-step 3.00

## crowd-on

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 82.77 | 95% |
| gpu:idle | 1.39 | 2% |
| sdf:polys | 1.37 | 2% |
| compute:tile-bin | 0.24 | 0% |
| compute:probe-gather | 0.21 | 0% |
| post:fxaa | 0.21 | 0% |
| post:blit | 0.12 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.04 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **86.67** | 100% |
| GPU span p50 (first start → last end) | 86.58 |  |
| fenced frame p50 | 89.47 |  |
| gap (frame − span) | 2.89 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 49.90 |
| cpu:tick | 7.70 |
| cpu:phase:wound-hit | 4.50 |
| cpu:phase:body-step | 4.30 |
| cpu:phase:tile-binning-submit | 1.40 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (160.81 ms labelled — droplets 43→33, goo quads 279→273): sdf:march 84.70, cpu:draw 58.70, cpu:tick 7.20, cpu:phase:body-step 4.00, sdf:polys 1.37
- **fire** (184.87 ms labelled — droplets 33→256, goo quads 273→428): sdf:march 118.78, cpu:draw 41.90, cpu:tick 7.50, cpu:phase:wound-hit 6.00, cpu:phase:body-step 4.00
- **gib** (146.47 ms labelled — droplets 256→14, goo quads 428→264): sdf:march 74.60, cpu:draw 52.00, cpu:tick 8.10, cpu:phase:body-step 4.60, gpu:idle 1.45

## crowd-on-tiles-off: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 82.46 | 0% |
| crowd-on | 1 | 89.47 | 0% |
