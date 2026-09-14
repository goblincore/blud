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
| sdf:march | 186.23 | 95% |
| gpu:idle | 5.65 | 3% |
| sdf:polys | 1.98 | 1% |
| post:fxaa | 0.33 | 0% |
| post:blit | 0.18 | 0% |
| sdf:shell-hull | 0.13 | 0% |
| sdf:last-blit | 0.12 | 0% |
| sdf:composite | 0.12 | 0% |
| post:vhs | 0.11 | 0% |
| goo:surface | 0.07 | 0% |
| post:vhs-input | 0.05 | 0% |
| effects | 0.01 | 0% |
| goo:density | 0.01 | 0% |
| **labelled total (sum of medians)** | **195.02** | 100% |
| GPU span p50 (first start → last end) | 189.65 |  |
| fenced frame p50 | 190.23 |  |
| gap (frame − span) | 0.58 | 0% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 6.80 |
| cpu:tick | 6.70 |
| cpu:phase:wound-hit | 4.80 |
| cpu:phase:body-step | 3.80 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (179.82 ms labelled — droplets 31→26, goo quads 267→266): sdf:march 152.20, cpu:draw 7.30, cpu:tick 6.70, gpu:idle 6.22, cpu:phase:body-step 3.80
- **fire** (242.33 ms labelled — droplets 26→141, goo quads 266→349): sdf:march 206.56, cpu:draw 7.60, gpu:idle 7.01, cpu:tick 6.80, cpu:phase:wound-hit 6.40
- **gib** (213.95 ms labelled — droplets 141→7, goo quads 349→258): sdf:march 187.76, cpu:tick 6.70, cpu:draw 6.00, gpu:idle 4.47, cpu:phase:body-step 3.70

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 93.21 | 92% |
| sdf:march-chunks | 3.59 | 4% |
| gpu:idle | 2.51 | 2% |
| compute:tile-bin | 0.47 | 0% |
| sdf:shell-hull | 0.47 | 0% |
| post:fxaa | 0.31 | 0% |
| sdf:polys | 0.18 | 0% |
| post:blit | 0.18 | 0% |
| post:vhs | 0.11 | 0% |
| sdf:composite | 0.07 | 0% |
| sdf:last-blit | 0.06 | 0% |
| goo:surface | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:density | 0.04 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **101.33** | 100% |
| GPU span p50 (first start → last end) | 101.00 |  |
| fenced frame p50 | 102.41 |  |
| gap (frame − span) | 1.41 | 1% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 81.10 |
| cpu:tick | 10.00 |
| cpu:phase:body-step | 5.80 |
| cpu:phase:wound-hit | 4.70 |
| cpu:phase:tile-binning-submit | 1.70 |
| cpu:phase:skeleton-mesh | 0.80 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |

Per segment (top passes, room 1):

- **walk** (206.14 ms labelled — droplets 6→5, goo quads 258→258): sdf:march 96.32, cpu:draw 85.80, cpu:tick 9.50, cpu:phase:body-step 5.50, gpu:idle 2.58
- **fire** (206.25 ms labelled — droplets 5→123, goo quads 258→343): sdf:march 98.44, cpu:draw 79.50, cpu:tick 10.00, cpu:phase:body-step 5.70, cpu:phase:wound-hit 5.00
- **gib** (192.46 ms labelled — droplets 123→24, goo quads 343→267): sdf:march 85.44, cpu:draw 78.00, cpu:tick 10.70, cpu:phase:body-step 6.30, sdf:march-chunks 3.59

## crowd-boxes: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 190.23 | 0% |
| crowd-quad | 1 | 102.41 | 0% |
