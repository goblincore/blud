# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**2 leg-run(s) aborted by the frame guard and skipped:** rep0 baseline/room1 (probe p50 n/a ms), rep0 crowd-boxes/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline: NO PASS SAMPLES

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 124.06 | 95% |
| gpu:idle | 2.56 | 2% |
| sdf:polys | 2.39 | 2% |
| sdf:shell-hull | 0.49 | 0% |
| compute:tile-bin | 0.43 | 0% |
| post:fxaa | 0.30 | 0% |
| post:blit | 0.17 | 0% |
| post:vhs | 0.10 | 0% |
| sdf:last-blit | 0.10 | 0% |
| sdf:composite | 0.09 | 0% |
| goo:surface | 0.06 | 0% |
| sdf:march-chunks | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:density | 0.03 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **130.90** | 100% |
| GPU span p50 (first start → last end) | 130.20 |  |
| fenced frame p50 | 137.21 |  |
| gap (frame − span) | 7.01 | 5% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 102.00 |
| cpu:tick | 10.50 |
| cpu:phase:body-step | 6.60 |
| cpu:phase:wound-hit | 3.30 |
| cpu:phase:tile-binning-submit | 1.90 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (236.60 ms labelled — droplets 6→7, goo quads 258→259): sdf:march 114.08, cpu:draw 95.00, cpu:tick 10.40, cpu:phase:body-step 6.80, gpu:idle 2.56
- **fire** (301.03 ms labelled — droplets 7→229, goo quads 259→413): sdf:march 157.76, cpu:draw 111.30, cpu:tick 9.90, cpu:phase:body-step 6.10, cpu:phase:wound-hit 5.80
- **gib** (255.61 ms labelled — droplets 229→70, goo quads 413→285): sdf:march 121.48, cpu:draw 103.70, cpu:tick 12.00, cpu:phase:body-step 7.60, gpu:idle 2.47

## crowd-boxes: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| crowd-quad | 1 | 137.21 | 0% |
