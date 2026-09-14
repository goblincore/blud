# Per-pass GPU attribution

1280x800, repeats=3, rooms=1, query: crowd=1&tiles-playtest

**MATRIX ABANDONED EARLY: CDP socket closed (code 1006) — no browser left to bench — later legs were never attempted.**
**INCOMPLETE — 3 leg-run(s) failed and are absent below:** rep0 crowd-on/room1 (bench), rep1 baseline/room1 (boot:wait-for-__sdfGame), rep1 crowd-on/room1 (boot:wait-for-__sdfGame)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 206.53 | 97% |
| sdf:polys | 2.72 | 1% |
| gpu:idle | 1.59 | 1% |
| sdf:shell-hull | 0.79 | 0% |
| post:fxaa | 0.45 | 0% |
| post:blit | 0.42 | 0% |
| sdf:last-blit | 0.29 | 0% |
| sdf:composite | 0.22 | 0% |
| post:vhs | 0.21 | 0% |
| goo:surface | 0.19 | 0% |
| post:vhs-input | 0.14 | 0% |
| effects | 0.12 | 0% |
| goo:density | 0.06 | 0% |
| **labelled total (sum of medians)** | **213.74** | 100% |
| GPU span p50 (first start → last end) | 228.68 |  |
| fenced frame p50 | 234.67 |  |
| gap (frame − span) | 5.99 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 14.10 |
| cpu:phase:wound-hit | 13.10 |
| cpu:tick | 11.70 |
| cpu:phase:body-step | 7.20 |
| cpu:phase:skeleton-mesh | 1.20 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (240.99 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 190.86, cpu:draw 18.70, cpu:tick 13.20, cpu:phase:body-step 8.00, sdf:polys 3.58
- **fire** (278.47 ms labelled — droplets 0→82, goo quads 0→303): sdf:march 218.76, cpu:phase:wound-hit 19.40, cpu:draw 14.00, cpu:tick 11.30, cpu:phase:body-step 6.70
- **gib** (247.34 ms labelled — droplets 82→10, goo quads 303→262): sdf:march 206.79, cpu:draw 12.60, cpu:tick 11.10, cpu:phase:body-step 6.70, sdf:polys 2.24

## crowd-on: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 234.67 | 0% |
