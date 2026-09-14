# Per-pass GPU attribution

1280x800, repeats=1, rooms=1,2, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**1 leg-run(s) aborted by the frame guard and skipped:** rep0 baseline/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 0.00 | 0% | 32.75 | 84% |
| gpu:idle | 0.00 | 0% | 4.13 | 11% |
| sdf:polys | 0.00 | 0% | 1.03 | 3% |
| post:fxaa | 0.00 | 0% | 0.21 | 1% |
| post:blit | 0.00 | 0% | 0.13 | 0% |
| compute:probe-gather | 0.00 | 0% | 0.12 | 0% |
| goo:surface | 0.00 | 0% | 0.10 | 0% |
| post:vhs | 0.00 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.00 | 0% | 0.07 | 0% |
| sdf:composite | 0.00 | 0% | 0.06 | 0% |
| post:vhs-input | 0.00 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.00 | 0% | 0.03 | 0% |
| goo:density | 0.00 | 0% | 0.01 | 0% |
| effects | 0.00 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **0.00** | 100% | **38.78** | 100% |
| GPU span p50 (first start → last end) | 0.00 |  | 35.14 |  |
| fenced frame p50 | 0.00 |  | 36.50 |  |
| gap (frame − span) | 0.00 | 0% of frame | 1.36 | 4% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 0.00 | 5.20 |
| cpu:tick | 0.00 | 4.90 |
| cpu:draw | 0.00 | 4.60 |
| cpu:phase:body-step | 0.00 | 2.30 |
| cpu:phase:skeleton-mesh | 0.00 | 0.40 |
| cpu:phase:encounter | 0.00 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.00 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (49.75 ms labelled — droplets 7→6, goo quads 259→258): sdf:march 31.17, cpu:tick 4.80, cpu:draw 4.80, gpu:idle 4.25, cpu:phase:body-step 2.30
- **fire** (54.82 ms labelled — droplets 6→165, goo quads 258→357): sdf:march 31.01, cpu:phase:wound-hit 5.60, cpu:tick 4.90, cpu:draw 4.70, gpu:idle 3.81
- **gib** (55.70 ms labelled — droplets 165→18, goo quads 357→268): sdf:march 36.65, cpu:tick 5.00, cpu:draw 4.60, gpu:idle 4.01, cpu:phase:body-step 2.30

## crowd-quad

| pass | room 1 ms | share | room 2 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.24 | 73% | 52.14 | 92% |
| sdf:polys | 1.04 | 7% | 1.35 | 2% |
| gpu:idle | 1.70 | 12% | 0.92 | 2% |
| compute:probe-gather | 0.04 | 0% | 0.35 | 1% |
| post:blit | 0.13 | 1% | 0.30 | 1% |
| post:fxaa | 0.22 | 2% | 0.28 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.23 | 0% |
| compute:tile-bin | 0.20 | 1% | 0.21 | 0% |
| sdf:shell-hull | 0.06 | 0% | 0.15 | 0% |
| goo:surface | 0.09 | 1% | 0.14 | 0% |
| post:vhs | 0.08 | 1% | 0.13 | 0% |
| post:vhs-input | 0.04 | 0% | 0.10 | 0% |
| sdf:composite | 0.05 | 0% | 0.09 | 0% |
| goo:density | 0.02 | 0% | 0.06 | 0% |
| effects | 0.01 | 0% | 0.02 | 0% |
| **labelled total (sum of medians)** | **13.94** | 100% | **56.49** | 100% |
| GPU span p50 (first start → last end) | 14.11 |  | 64.58 |  |
| fenced frame p50 | 15.12 |  | 71.72 |  |
| gap (frame − span) | 1.01 | 7% of frame | 7.14 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 | room 2 |
| --- | ---: | ---: |
| cpu:draw | 7.60 | 35.20 |
| cpu:tick | 5.20 | 6.60 |
| cpu:phase:body-step | 2.50 | 3.40 |
| cpu:phase:wound-hit | 4.30 | 1.40 |
| cpu:phase:tile-binning-submit | 0.80 | 0.90 |
| cpu:phase:skeleton-mesh | 0.40 | 0.40 |
| cpu:phase:crowd-sync | 0.40 | 0.40 |
| cpu:phase:encounter | 0.10 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 2):

- **walk** (57.10 ms labelled — droplets 16→12, goo quads 262→260): sdf:march 22.26, cpu:draw 20.30, cpu:tick 5.80, cpu:phase:body-step 2.90, sdf:polys 1.29
- **fire** (119.74 ms labelled — droplets 12→133, goo quads 260→347): sdf:march 52.14, cpu:draw 48.80, cpu:tick 6.90, cpu:phase:body-step 3.60, cpu:phase:wound-hit 1.40
- **gib** (157.56 ms labelled — droplets 133→16, goo quads 347→266): sdf:march 69.76, cpu:draw 68.60, cpu:tick 7.10, cpu:phase:body-step 3.80, sdf:polys 1.44

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 36.50 | 0% |
| crowd-quad | 1 | 15.12 | 0% |
| crowd-quad | 2 | 71.72 | 0% |
