# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**2 leg-run(s) aborted by the frame guard and skipped:** rep0 crowd-on/room1 (probe p50 n/a ms), rep0 crowd-on-tiles-off/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 34.28 | 87% |
| gpu:idle | 3.81 | 10% |
| sdf:polys | 0.80 | 2% |
| post:fxaa | 0.21 | 1% |
| post:blit | 0.12 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% |
| post:vhs-input | 0.03 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **39.54** | 100% |
| GPU span p50 (first start → last end) | 36.03 |  |
| fenced frame p50 | 38.25 |  |
| gap (frame − span) | 2.22 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 7.50 |
| cpu:draw | 6.60 |
| cpu:phase:wound-hit | 5.60 |
| cpu:phase:body-step | 4.40 |
| cpu:phase:skeleton-mesh | 1.00 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (136.46 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 104.76, cpu:draw 9.40, cpu:tick 7.80, gpu:idle 6.09, cpu:phase:body-step 4.50
- **fire** (63.28 ms labelled — droplets 6→128, goo quads 258→348): sdf:march 32.41, cpu:tick 7.50, cpu:phase:wound-hit 6.70, cpu:draw 6.40, cpu:phase:body-step 4.30
- **gib** (51.23 ms labelled — droplets 128→3, goo quads 348→257): sdf:march 27.48, cpu:tick 7.30, cpu:draw 5.60, cpu:phase:body-step 4.30, gpu:idle 3.52

## crowd-on: NO PASS SAMPLES

## crowd-on-tiles-off: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 38.25 | 0% |
