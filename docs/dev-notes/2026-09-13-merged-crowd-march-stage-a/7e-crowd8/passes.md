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
| sdf:march | 48.02 | 86% |
| gpu:idle | 5.32 | 10% |
| sdf:polys | 1.30 | 2% |
| post:fxaa | 0.34 | 1% |
| post:blit | 0.19 | 0% |
| post:vhs | 0.12 | 0% |
| sdf:composite | 0.10 | 0% |
| sdf:shell-hull | 0.10 | 0% |
| goo:surface | 0.06 | 0% |
| sdf:last-blit | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% |
| effects | 0.02 | 0% |
| goo:density | 0.02 | 0% |
| **labelled total (sum of medians)** | **55.70** | 100% |
| GPU span p50 (first start → last end) | 51.08 |  |
| fenced frame p50 | 54.87 |  |
| gap (frame − span) | 3.79 | 7% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 8.30 |
| cpu:draw | 7.30 |
| cpu:phase:wound-hit | 6.30 |
| cpu:phase:body-step | 4.20 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (141.76 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 111.06, cpu:draw 8.10, cpu:tick 7.70, gpu:idle 6.64, cpu:phase:body-step 4.10
- **fire** (78.89 ms labelled — droplets 6→215, goo quads 258→399): sdf:march 43.16, cpu:tick 8.20, cpu:draw 7.40, cpu:phase:wound-hit 7.00, gpu:idle 5.58
- **gib** (64.40 ms labelled — droplets 215→14, goo quads 399→264): sdf:march 35.10, cpu:tick 8.90, cpu:draw 6.90, gpu:idle 4.85, cpu:phase:body-step 4.60

## crowd-on: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 54.87 | 0% |
