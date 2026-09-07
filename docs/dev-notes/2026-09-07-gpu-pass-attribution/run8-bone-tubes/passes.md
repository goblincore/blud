# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 11.91 | 78% | 11.94 | 82% |
| gpu:idle | 2.03 | 13% | 1.48 | 10% |
| sdf:polys | 0.56 | 4% | 0.53 | 4% |
| post:fxaa | 0.24 | 2% | 0.22 | 2% |
| post:blit | 0.14 | 1% | 0.13 | 1% |
| post:smear | 0.08 | 1% | 0.07 | 0% |
| sdf:composite | 0.10 | 1% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.04 | 0% |
| goo:surface | 0.08 | 0% | 0.04 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.03 | 0% |
| sdf:occluder | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **15.27** | 100% | **14.59** | 100% |
| GPU span p50 (first start → last end) | 16.34 |  | 14.65 |  |
| fenced frame p50 | 21.98 |  | 16.78 |  |
| gap (frame − span) | 5.64 | 26% of frame | 2.13 | 13% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.70 | 5.00 |
| cpu:phase:wound-hit | 4.70 | 2.70 |
| cpu:draw | 2.70 | 2.50 |
| cpu:phase:body-step | 2.00 | 2.30 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.40 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (19.14 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.08, cpu:tick 5.00, cpu:draw 2.60, cpu:phase:body-step 2.30, gpu:idle 1.04
- **fire** (28.16 ms labelled — droplets 0→55, goo quads 0→283): sdf:march 11.94, cpu:tick 5.30, cpu:phase:wound-hit 2.70, cpu:draw 2.60, cpu:phase:body-step 2.40
- **gib** (35.27 ms labelled — droplets 55→0, goo quads 283→256): sdf:march 20.96, cpu:tick 4.70, gpu:idle 2.63, cpu:draw 2.60, cpu:phase:body-step 2.10

## bone-mesh-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 9.59 | 74% | 10.48 | 76% |
| gpu:idle | 1.77 | 14% | 1.51 | 11% |
| sdf:polys | 0.65 | 5% | 0.88 | 6% |
| sdf:march-chunks | 0.22 | 2% | 0.27 | 2% |
| post:fxaa | 0.25 | 2% | 0.26 | 2% |
| post:blit | 0.14 | 1% | 0.15 | 1% |
| sdf:composite | 0.07 | 1% | 0.08 | 1% |
| post:smear | 0.08 | 1% | 0.08 | 1% |
| goo:surface | 0.04 | 0% | 0.05 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.04 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| effects | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **12.92** | 100% | **13.85** | 100% |
| GPU span p50 (first start → last end) | 11.71 |  | 15.09 |  |
| fenced frame p50 | 13.78 |  | 18.13 |  |
| gap (frame − span) | 2.07 | 15% of frame | 3.04 | 17% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 5.00 | 7.30 |
| cpu:draw | 3.50 | 4.40 |
| cpu:phase:wound-hit | 1.60 | 3.30 |
| cpu:phase:body-step | 2.00 | 2.90 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.60 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.00 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (20.37 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.74, cpu:tick 5.50, cpu:draw 3.30, cpu:phase:body-step 2.20, gpu:idle 1.01
- **fire** (33.67 ms labelled — droplets 0→55, goo quads 0→283): sdf:march 11.03, cpu:tick 7.50, cpu:draw 4.40, cpu:phase:wound-hit 4.10, cpu:phase:body-step 2.90
- **gib** (39.13 ms labelled — droplets 55→0, goo quads 283→256): sdf:march 16.04, cpu:tick 8.50, cpu:draw 5.50, cpu:phase:body-step 3.40, gpu:idle 1.99

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 15.03 / 21.98 / 23.81 | 58% |
| baseline | 4 | 20.35 / 15.38 / 16.78 | 32% |
| bone-mesh-on | 3 | 12.25 / 13.78 / 14.07 | 15% |
| bone-mesh-on | 4 | 19.19 / 18.13 / 14.64 | 31% |
