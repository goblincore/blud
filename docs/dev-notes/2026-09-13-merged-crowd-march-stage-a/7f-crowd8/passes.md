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
| sdf:march | 80.66 | 91% |
| gpu:idle | 5.88 | 7% |
| sdf:polys | 1.06 | 1% |
| post:fxaa | 0.21 | 0% |
| post:blit | 0.13 | 0% |
| sdf:shell-hull | 0.08 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.05 | 0% |
| goo:surface | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:density | 0.01 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **88.31** | 100% |
| GPU span p50 (first start → last end) | 82.94 |  |
| fenced frame p50 | 83.91 |  |
| gap (frame − span) | 0.97 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 7.10 |
| cpu:tick | 6.20 |
| cpu:phase:wound-hit | 5.00 |
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

- **walk** (109.08 ms labelled — droplets 6→6, goo quads 258→258): sdf:march 82.25, cpu:draw 8.20, gpu:idle 6.52, cpu:tick 6.10, cpu:phase:body-step 3.30
- **fire** (118.27 ms labelled — droplets 6→235, goo quads 258→419): sdf:march 86.98, cpu:draw 7.30, cpu:tick 6.30, gpu:idle 6.06, cpu:phase:wound-hit 5.50
- **gib** (100.33 ms labelled — droplets 235→19, goo quads 419→269): sdf:march 77.19, cpu:tick 6.20, cpu:draw 6.00, gpu:idle 4.03, cpu:phase:body-step 3.30

## crowd-on

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 140.06 | 97% |
| sdf:polys | 1.51 | 1% |
| gpu:idle | 1.36 | 1% |
| sdf:shell-hull | 0.29 | 0% |
| compute:tile-bin | 0.27 | 0% |
| post:fxaa | 0.21 | 0% |
| post:blit | 0.13 | 0% |
| post:vhs | 0.08 | 0% |
| sdf:composite | 0.06 | 0% |
| sdf:last-blit | 0.04 | 0% |
| post:vhs-input | 0.04 | 0% |
| goo:surface | 0.04 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **144.11** | 100% |
| GPU span p50 (first start → last end) | 145.30 |  |
| fenced frame p50 | 146.75 |  |
| gap (frame − span) | 1.45 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 101.30 |
| cpu:tick | 8.50 |
| cpu:phase:wound-hit | 5.60 |
| cpu:phase:body-step | 5.00 |
| cpu:phase:tile-binning-submit | 1.50 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (281.91 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 150.21, cpu:draw 111.60, cpu:tick 8.50, cpu:phase:body-step 5.00, sdf:polys 1.51
- **fire** (224.16 ms labelled — droplets 7→236, goo quads 259→420): sdf:march 106.12, cpu:draw 89.90, cpu:tick 9.70, cpu:phase:wound-hit 5.90, cpu:phase:body-step 5.70
- **gib** (305.69 ms labelled — droplets 236→16, goo quads 420→266): sdf:march 158.34, cpu:draw 126.90, cpu:tick 8.00, cpu:phase:body-step 4.70, sdf:polys 1.55

## crowd-on-tiles-off: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 83.91 | 0% |
| crowd-on | 1 | 146.75 | 0% |
