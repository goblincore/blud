# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**1 leg-run(s) aborted by the frame guard and skipped:** rep0 crowd-on/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 83.52 | 92% |
| gpu:idle | 4.92 | 5% |
| sdf:polys | 1.19 | 1% |
| post:fxaa | 0.21 | 0% |
| post:blit | 0.13 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.06 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **90.36** | 100% |
| GPU span p50 (first start → last end) | 85.49 |  |
| fenced frame p50 | 87.91 |  |
| gap (frame − span) | 2.42 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.90 |
| cpu:tick | 6.30 |
| cpu:phase:wound-hit | 4.90 |
| cpu:phase:body-step | 3.30 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (94.82 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 69.94, cpu:draw 7.50, cpu:tick 6.20, gpu:idle 5.21, cpu:phase:body-step 3.30
- **fire** (120.13 ms labelled — droplets 6→237, goo quads 258→421): sdf:march 90.16, cpu:draw 6.90, cpu:tick 6.30, cpu:phase:wound-hit 5.70, gpu:idle 4.92
- **gib** (108.58 ms labelled — droplets 237→12, goo quads 421→264): sdf:march 84.05, cpu:draw 6.50, cpu:tick 6.40, gpu:idle 4.68, cpu:phase:body-step 3.40

## crowd-on: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 87.91 | 0% |
