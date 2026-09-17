# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 123.93 | 93% |
| gpu:idle | 5.76 | 4% |
| sdf:polys | 1.80 | 1% |
| post:fxaa | 0.35 | 0% |
| post:blit | 0.21 | 0% |
| post:vhs | 0.15 | 0% |
| sdf:shell-hull | 0.14 | 0% |
| sdf:composite | 0.11 | 0% |
| sdf:last-blit | 0.10 | 0% |
| goo:surface | 0.07 | 0% |
| post:vhs-input | 0.06 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **132.73** | 100% |
| GPU span p50 (first start → last end) | 127.95 |  |
| fenced frame p50 | 131.69 |  |
| gap (frame − span) | 3.74 | 3% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:tick | 6.30 |
| cpu:draw | 6.10 |
| cpu:phase:wound-hit | 5.60 |
| cpu:phase:body-step | 3.40 |
| cpu:phase:skeleton-mesh | 0.70 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |
| cpu:phase:goo-sync | 0.00 |
| cpu:phase:tile-binning-submit | 0.00 |

Per segment (top passes, room 1):

- **walk** (161.55 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 130.31, gpu:idle 8.75, cpu:draw 7.90, cpu:tick 6.70, cpu:phase:body-step 3.70
- **fire** (165.20 ms labelled — droplets 7→243, goo quads 259→427): sdf:march 133.92, cpu:tick 6.30, cpu:phase:wound-hit 6.00, cpu:draw 5.80, gpu:idle 5.80
- **gib** (138.01 ms labelled — droplets 243→16, goo quads 427→268): sdf:march 114.91, cpu:tick 6.20, cpu:draw 5.20, gpu:idle 4.14, cpu:phase:body-step 3.20

## crowd-quad

| pass | room 1 ms | share |
| --- | ---: | ---: |
| sdf:march | 69.64 | 94% |
| sdf:polys | 1.63 | 2% |
| gpu:idle | 1.07 | 1% |
| sdf:shell-hull | 0.35 | 0% |
| compute:tile-bin | 0.31 | 0% |
| post:fxaa | 0.30 | 0% |
| post:blit | 0.17 | 0% |
| post:vhs | 0.11 | 0% |
| sdf:composite | 0.08 | 0% |
| sdf:last-blit | 0.06 | 0% |
| goo:surface | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% |
| **labelled total (sum of medians)** | **73.84** | 100% |
| GPU span p50 (first start → last end) | 75.05 |  |
| fenced frame p50 | 79.97 |  |
| gap (frame − span) | 4.92 | 6% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 1 |
| --- | ---: |
| cpu:draw | 46.10 |
| cpu:tick | 7.90 |
| cpu:phase:body-step | 4.30 |
| cpu:phase:wound-hit | 2.70 |
| cpu:phase:tile-binning-submit | 1.40 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:chunk-bake-swap | 0.30 |
| cpu:phase:encounter | 0.20 |
| cpu:phase:crowd-sync | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 1):

- **walk** (121.99 ms labelled — droplets 7→7, goo quads 259→259): sdf:march 59.48, cpu:draw 43.60, cpu:tick 7.50, cpu:phase:body-step 4.20, sdf:polys 2.17
- **fire** (168.95 ms labelled — droplets 7→336, goo quads 259→452): sdf:march 90.80, cpu:draw 53.90, cpu:tick 8.10, cpu:phase:wound-hit 4.70, cpu:phase:body-step 4.40
- **gib** (132.51 ms labelled — droplets 336→54, goo quads 452→276): sdf:march 69.55, cpu:draw 43.10, cpu:tick 7.90, cpu:phase:body-step 4.50, cpu:phase:tile-binning-submit 1.50

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 131.69 | 0% |
| crowd-quad | 1 | 79.97 | 0% |
