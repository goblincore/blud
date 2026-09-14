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
| sdf:march | 99.51 | 93% |
| gpu:idle | 5.91 | 5% |
| sdf:polys | 1.35 | 1% |
| post:fxaa | 0.22 | 0% |
| post:blit | 0.13 | 0% |
| sdf:shell-hull | 0.11 | 0% |
| post:vhs | 0.09 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:last-blit | 0.06 | 0% |
| goo:surface | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% |
| effects | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **107.54** | 100% |
| GPU span p50 (first start → last end) | 103.31 |  |
| fenced frame p50 | 103.25 |  |
| gap (frame − span) | -0.06 | -0% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 8.20 |
| cpu:tick | 7.10 |
| cpu:phase:wound-hit | 4.30 |
| cpu:phase:body-step | 4.00 |
| cpu:phase:skeleton-mesh | 0.90 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (120.68 ms labelled — droplets 31→26, goo quads 267→266): sdf:march 92.61, cpu:draw 8.30, cpu:tick 7.10, gpu:idle 5.54, cpu:phase:body-step 4.00
- **fire** (155.67 ms labelled — droplets 26→141, goo quads 266→349): sdf:march 118.15, cpu:draw 8.60, gpu:idle 7.33, cpu:tick 7.20, cpu:phase:wound-hit 7.00
- **gib** (122.95 ms labelled — droplets 141→7, goo quads 349→258): sdf:march 95.52, cpu:draw 7.50, cpu:tick 7.10, gpu:idle 4.62, cpu:phase:body-step 3.90

## crowd-on: NO PASS SAMPLES

## crowd-on-tiles-off: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 103.25 | 0% |
