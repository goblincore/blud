# Per-pass GPU attribution

1280x800, repeats=2, rooms=3,4,5

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share | room 5 ms | share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sdf:march | 17.30 | 75% | 18.47 | 83% | 20.84 | 82% |
| gpu:idle | 4.05 | 18% | 2.54 | 11% | 3.19 | 13% |
| sdf:polys | 0.69 | 3% | 0.70 | 3% | 0.69 | 3% |
| post:fxaa | 0.23 | 1% | 0.22 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% | 0.13 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% | 0.07 | 0% |
| sdf:composite | 0.08 | 0% | 0.07 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% | 0.05 | 0% |
| goo:surface | 0.05 | 0% | 0.04 | 0% | 0.04 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% | 0.01 | 0% |
| effects | 0.00 | 0% | 0.00 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.35 | 1% | 0.01 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **23.07** | 100% | **22.32** | 100% | **25.35** | 100% |
| GPU span p50 (first start → last end) | 19.41 |  | 20.19 |  | 22.75 |  |
| fenced frame p50 | 22.69 |  | 22.64 |  | 25.21 |  |
| gap (frame − span) | 3.28 | 14% of frame | 2.45 | 11% of frame | 2.46 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 | room 5 |
| --- | ---: | ---: | ---: |
| cpu:phase:wound-hit | 6.60 | 4.70 | 7.90 |
| cpu:tick | 6.30 | 6.50 | 6.40 |
| cpu:draw | 5.20 | 4.70 | 5.20 |
| cpu:phase:body-step | 3.00 | 3.10 | 3.20 |
| cpu:phase:skeleton-mesh | 0.40 | 0.50 | 0.50 |
| cpu:phase:encounter | 0.20 | 0.20 | 0.20 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.10 | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.40 | 0.00 |

Per segment (top passes, room 5):

- **walk** (38.04 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 17.26, cpu:tick 6.40, cpu:draw 5.70, cpu:phase:body-step 3.40, gpu:idle 3.35
- **fire** (48.02 ms labelled — droplets 0→79, goo quads 0→300): sdf:march 20.30, cpu:phase:wound-hit 7.90, cpu:tick 6.60, cpu:draw 4.60, gpu:idle 3.35
- **gib** (53.16 ms labelled — droplets 79→0, goo quads 300→256): sdf:march 31.40, cpu:tick 6.30, cpu:draw 5.50, cpu:phase:body-step 3.10, gpu:idle 3.05

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 22.69 / 20.85 | 9% |
| baseline | 4 | 21.99 / 22.64 | 3% |
| baseline | 5 | 16.26 / 25.21 | 55% |
