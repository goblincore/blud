# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 19.17 | 69% | 16.33 | 65% |
| gpu:idle | 6.19 | 22% | 6.64 | 27% |
| sdf:polys | 0.82 | 3% | 0.83 | 3% |
| post:fxaa | 0.36 | 1% | 0.39 | 2% |
| post:blit | 0.23 | 1% | 0.25 | 1% |
| sdf:composite | 0.15 | 1% | 0.15 | 1% |
| post:smear | 0.12 | 0% | 0.12 | 0% |
| goo:surface | 0.13 | 0% | 0.11 | 0% |
| sdf:occluder | 0.06 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.12 | 0% | 0.06 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.49 | 2% | 0.00 | 0% |
| **labelled total (sum of medians)** | **27.86** | 100% | **24.98** | 100% |
| GPU span p50 (first start → last end) | 34.31 |  | 25.78 |  |
| fenced frame p50 | 36.39 |  | 28.72 |  |
| gap (frame − span) | 2.08 | 6% of frame | 2.94 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 8.40 | 7.90 |
| cpu:phase:wound-hit | 3.40 | 4.50 |
| cpu:draw | 4.40 | 3.90 |
| cpu:phase:body-step | 3.60 | 3.60 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (48.55 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 13.00, sdf:march 9.97, gpu:idle 8.78, cpu:draw 8.10, cpu:phase:body-step 6.40
- **fire** (42.83 ms labelled — droplets 0→61, goo quads 0→288): sdf:march 18.13, cpu:tick 7.60, cpu:phase:wound-hit 6.40, cpu:draw 3.80, cpu:phase:body-step 3.50
- **gib** (38.35 ms labelled — droplets 61→134, goo quads 288→310): sdf:march 22.09, cpu:tick 5.10, gpu:idle 3.72, cpu:draw 2.60, cpu:phase:body-step 2.30

## wound-list-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 23.32 | 85% | 27.82 | 75% |
| gpu:idle | 2.31 | 8% | 7.08 | 19% |
| sdf:polys | 0.78 | 3% | 0.87 | 2% |
| post:fxaa | 0.34 | 1% | 0.38 | 1% |
| post:blit | 0.25 | 1% | 0.28 | 1% |
| sdf:composite | 0.16 | 1% | 0.14 | 0% |
| post:smear | 0.11 | 0% | 0.13 | 0% |
| goo:surface | 0.10 | 0% | 0.12 | 0% |
| sdf:occluder | 0.06 | 0% | 0.09 | 0% |
| sdf:shell-hull | 0.13 | 0% | 0.07 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **27.58** | 100% | **37.00** | 100% |
| GPU span p50 (first start → last end) | 33.23 |  | 38.95 |  |
| fenced frame p50 | 35.75 |  | 43.23 |  |
| gap (frame − span) | 2.52 | 7% of frame | 4.28 | 10% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 7.90 | 6.90 |
| cpu:phase:wound-hit | 4.60 | 6.60 |
| cpu:draw | 4.20 | 3.50 |
| cpu:phase:body-step | 3.50 | 3.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (53.66 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 14.30, sdf:march 11.82, gpu:idle 8.95, cpu:draw 8.80, cpu:phase:body-step 7.20
- **fire** (62.93 ms labelled — droplets 0→57, goo quads 0→283): sdf:march 28.86, cpu:phase:wound-hit 16.10, cpu:tick 6.70, cpu:draw 3.20, gpu:idle 3.01
- **gib** (55.47 ms labelled — droplets 57→11, goo quads 283→261): sdf:march 39.93, cpu:tick 5.40, cpu:draw 2.80, gpu:idle 2.40, cpu:phase:body-step 2.40

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 19.55 / 39.09 / 36.39 | 100% |
| baseline | 4 | 28.72 / 40.84 / 26.58 | 54% |
| wound-list-on | 3 | 35.53 / 38.55 / 35.75 | 8% |
| wound-list-on | 4 | 45.55 / 43.23 / 39.58 | 15% |
