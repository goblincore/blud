# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**1 leg-run(s) aborted by the frame guard and skipped:** rep0 crowd-boxes/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 123.59 | 93% |
| gpu:idle | 6.36 | 5% |
| sdf:polys | 1.50 | 1% |
| post:fxaa | 0.32 | 0% |
| post:blit | 0.18 | 0% |
| post:vhs | 0.11 | 0% |
| sdf:shell-hull | 0.11 | 0% |
| sdf:composite | 0.09 | 0% |
| sdf:last-blit | 0.09 | 0% |
| goo:surface | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **132.50** | 100% |
| GPU span p50 (first start → last end) | 126.64 |  |
| fenced frame p50 | 126.53 |  |
| gap (frame − span) | -0.11 | -0% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 6.10 |
| cpu:draw | 6.10 |
| cpu:phase:wound-hit | 5.80 |
| cpu:phase:body-step | 3.20 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (174.82 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 148.08, cpu:draw 7.40, gpu:idle 6.71, cpu:tick 5.90, cpu:phase:body-step 3.20
- **fire** (151.79 ms labelled — droplets 7→224, goo quads 259→408): sdf:march 120.08, gpu:idle 6.41, cpu:draw 6.40, cpu:phase:wound-hit 6.20, cpu:tick 6.00
- **gib** (135.43 ms labelled — droplets 224→19, goo quads 408→269): sdf:march 114.63, cpu:tick 6.30, cpu:draw 4.70, cpu:phase:body-step 3.30, gpu:idle 2.29

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 92.99 | 95% |
| sdf:polys | 1.92 | 2% |
| gpu:idle | 1.56 | 2% |
| sdf:shell-hull | 0.40 | 0% |
| compute:tile-bin | 0.35 | 0% |
| post:fxaa | 0.27 | 0% |
| post:blit | 0.16 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:composite | 0.08 | 0% |
| sdf:last-blit | 0.08 | 0% |
| goo:surface | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **98.05** | 100% |
| GPU span p50 (first start → last end) | 98.31 |  |
| fenced frame p50 | 103.86 |  |
| gap (frame − span) | 5.55 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 74.50 |
| cpu:tick | 9.00 |
| cpu:phase:body-step | 4.90 |
| cpu:phase:wound-hit | 2.30 |
| cpu:phase:tile-binning-submit | 1.60 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (164.89 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 80.29, cpu:draw 64.00, cpu:tick 8.30, cpu:phase:body-step 4.70, sdf:polys 1.88
- **fire** (206.33 ms labelled — droplets 7→112, goo quads 259→332): sdf:march 96.41, cpu:draw 85.00, cpu:tick 9.10, cpu:phase:body-step 4.90, cpu:phase:wound-hit 2.60
- **gib** (205.75 ms labelled — droplets 112→8, goo quads 332→258): sdf:march 101.78, cpu:draw 79.80, cpu:tick 9.80, cpu:phase:body-step 5.80, sdf:polys 1.84

## crowd-boxes: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 126.53 | 0% |
| crowd-quad | 1 | 103.86 | 0% |
