# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 13.43 | 73% | 14.22 | 79% |
| gpu:idle | 3.46 | 19% | 2.61 | 14% |
| sdf:polys | 0.61 | 3% | 0.59 | 3% |
| post:fxaa | 0.22 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:march-chunks | 0.27 | 1% | 0.07 | 0% |
| sdf:composite | 0.07 | 0% | 0.07 | 0% |
| goo:surface | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.04 | 0% |
| sdf:occluder | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **18.42** | 100% | **18.11** | 100% |
| GPU span p50 (first start → last end) | 16.41 |  | 17.21 |  |
| fenced frame p50 | 20.80 |  | 19.63 |  |
| gap (frame − span) | 4.39 | 21% of frame | 2.42 | 12% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 7.30 | 7.30 |
| cpu:phase:wound-hit | 3.40 | 5.90 |
| cpu:draw | 4.10 | 3.80 |
| cpu:phase:body-step | 3.20 | 3.30 |
| cpu:phase:chunk-bake-swap | 0.30 | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (22.30 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.38, cpu:tick 6.10, cpu:draw 3.10, cpu:phase:body-step 2.90, gpu:idle 1.61
- **fire** (44.92 ms labelled — droplets 0→49, goo quads 0→283): sdf:march 14.55, cpu:tick 9.70, cpu:phase:wound-hit 5.90, cpu:draw 4.70, gpu:idle 4.33
- **gib** (39.76 ms labelled — droplets 49→8, goo quads 283→260): sdf:march 21.37, cpu:tick 6.60, cpu:draw 3.60, cpu:phase:body-step 2.90, gpu:idle 2.61

## bone-cull-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.64 | 74% | 13.83 | 78% |
| gpu:idle | 3.25 | 19% | 2.46 | 14% |
| sdf:polys | 0.55 | 3% | 0.55 | 3% |
| sdf:march-chunks | 0.00 | 0% | 0.30 | 2% |
| post:fxaa | 0.23 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:composite | 0.07 | 0% | 0.07 | 0% |
| goo:surface | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.04 | 0% |
| sdf:occluder | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **17.10** | 100% | **17.77** | 100% |
| GPU span p50 (first start → last end) | 16.56 |  | 16.62 |  |
| fenced frame p50 | 19.28 |  | 20.56 |  |
| gap (frame − span) | 2.72 | 14% of frame | 3.94 | 19% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 6.10 | 7.00 |
| cpu:phase:wound-hit | 3.30 | 3.70 |
| cpu:draw | 3.40 | 3.50 |
| cpu:phase:body-step | 2.80 | 3.30 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.40 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.00 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (20.15 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.14, cpu:tick 5.10, cpu:draw 3.00, cpu:phase:body-step 2.50, gpu:idle 1.27
- **fire** (45.66 ms labelled — droplets 0→42, goo quads 0→278): sdf:march 13.83, cpu:tick 11.10, cpu:phase:wound-hit 5.10, cpu:phase:body-step 4.90, cpu:draw 4.90
- **gib** (42.05 ms labelled — droplets 42→11, goo quads 278→263): sdf:march 24.03, cpu:tick 6.50, cpu:draw 3.40, cpu:phase:body-step 3.00, gpu:idle 2.39

## bone-mesh-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 11.64 | 68% | 12.25 | 75% |
| gpu:idle | 3.72 | 22% | 2.52 | 16% |
| sdf:polys | 0.80 | 5% | 0.79 | 5% |
| post:fxaa | 0.25 | 1% | 0.26 | 2% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:composite | 0.07 | 0% | 0.07 | 0% |
| goo:surface | 0.04 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.04 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| effects | 0.00 | 0% | 0.00 | 0% |
| sdf:march-chunks | 0.24 | 1% | 0.00 | 0% |
| **labelled total (sum of medians)** | **17.08** | 100% | **16.24** | 100% |
| GPU span p50 (first start → last end) | 15.24 |  | 15.87 |  |
| fenced frame p50 | 17.91 |  | 18.67 |  |
| gap (frame − span) | 2.67 | 15% of frame | 2.80 | 15% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 5.80 | 7.10 |
| cpu:draw | 4.10 | 4.30 |
| cpu:phase:wound-hit | 2.40 | 3.70 |
| cpu:phase:body-step | 2.30 | 2.90 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (21.34 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.29, cpu:tick 5.30, cpu:draw 3.70, cpu:phase:body-step 2.30, gpu:idle 1.28
- **fire** (41.41 ms labelled — droplets 0→43, goo quads 0→276): sdf:march 12.37, cpu:tick 10.30, cpu:draw 5.60, cpu:phase:body-step 4.00, cpu:phase:wound-hit 3.70
- **gib** (36.59 ms labelled — droplets 43→10, goo quads 276→260): sdf:march 18.95, cpu:tick 6.40, cpu:draw 4.10, cpu:phase:body-step 2.60, gpu:idle 2.26

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 18.36 / 20.98 / 20.80 | 14% |
| baseline | 4 | 19.63 / 23.10 / 19.54 | 18% |
| bone-cull-on | 3 | 19.28 / 18.79 / 21.83 | 16% |
| bone-cull-on | 4 | 22.05 / 20.56 / 19.74 | 12% |
| bone-mesh-on | 3 | 17.91 / 17.68 / 19.20 | 9% |
| bone-mesh-on | 4 | 18.64 / 18.67 / 26.04 | 40% |
