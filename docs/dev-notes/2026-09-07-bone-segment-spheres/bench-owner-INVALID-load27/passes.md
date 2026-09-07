# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 19.58 | 76% | 17.32 | 66% |
| gpu:idle | 4.61 | 18% | 7.57 | 29% |
| sdf:polys | 0.75 | 3% | 0.68 | 3% |
| post:fxaa | 0.31 | 1% | 0.27 | 1% |
| post:blit | 0.18 | 1% | 0.15 | 1% |
| sdf:composite | 0.14 | 1% | 0.09 | 0% |
| post:smear | 0.10 | 0% | 0.08 | 0% |
| goo:surface | 0.09 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.11 | 0% | 0.05 | 0% |
| sdf:occluder | 0.03 | 0% | 0.03 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **25.91** | 100% | **26.30** | 100% |
| GPU span p50 (first start → last end) | 27.01 |  | 19.19 |  |
| fenced frame p50 | 30.13 |  | 25.30 |  |
| gap (frame − span) | 3.12 | 10% of frame | 6.11 | 24% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 11.70 | 11.60 |
| cpu:phase:wound-hit | 4.50 | 8.80 |
| cpu:draw | 6.60 | 5.80 |
| cpu:phase:body-step | 5.40 | 5.30 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.20 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (40.73 ms labelled — droplets 0→0, goo quads 0→0): cpu:tick 12.10, gpu:idle 7.92, sdf:march 7.04, cpu:draw 6.40, cpu:phase:body-step 5.90
- **fire** (56.76 ms labelled — droplets 0→55, goo quads 0→283): sdf:march 17.32, cpu:tick 10.80, cpu:phase:wound-hit 10.10, gpu:idle 6.55, cpu:draw 5.30
- **gib** (59.58 ms labelled — droplets 55→0, goo quads 283→256): sdf:march 28.60, cpu:tick 12.00, gpu:idle 5.86, cpu:draw 5.70, cpu:phase:body-step 5.60

## bone-seg-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 17.90 | 64% | 26.45 | 78% |
| gpu:idle | 7.44 | 27% | 4.75 | 14% |
| sdf:polys | 0.91 | 3% | 0.85 | 2% |
| post:blit | 0.19 | 1% | 0.41 | 1% |
| post:fxaa | 0.37 | 1% | 0.36 | 1% |
| sdf:composite | 0.20 | 1% | 0.31 | 1% |
| sdf:shell-hull | 0.11 | 0% | 0.22 | 1% |
| sdf:march-chunks | 0.40 | 1% | 0.22 | 1% |
| goo:surface | 0.13 | 0% | 0.20 | 1% |
| post:smear | 0.10 | 0% | 0.16 | 0% |
| sdf:occluder | 0.03 | 0% | 0.10 | 0% |
| goo:density | 0.02 | 0% | 0.07 | 0% |
| **labelled total (sum of medians)** | **27.80** | 100% | **34.10** | 100% |
| GPU span p50 (first start → last end) | 27.46 |  | 38.49 |  |
| fenced frame p50 | 33.28 |  | 48.49 |  |
| gap (frame − span) | 5.82 | 17% of frame | 10.00 | 21% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 11.40 | 14.50 |
| cpu:phase:wound-hit | 4.70 | 13.80 |
| cpu:phase:body-step | 5.50 | 7.70 |
| cpu:draw | 5.70 | 7.30 |
| cpu:phase:blood-simulation-and-sync | 0.20 | 0.20 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (44.10 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 13.84, cpu:tick 12.60, cpu:phase:body-step 6.40, cpu:draw 6.30, gpu:idle 2.02
- **fire** (80.37 ms labelled — droplets 0→65, goo quads 0→288): sdf:march 28.56, cpu:tick 14.80, cpu:phase:wound-hit 13.80, cpu:phase:body-step 7.70, cpu:draw 7.10
- **gib** (74.79 ms labelled — droplets 65→0, goo quads 288→256): sdf:march 33.41, cpu:tick 16.10, cpu:phase:body-step 8.20, cpu:draw 8.20, gpu:idle 4.76

## bone-mesh-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 14.33 | 61% | 22.26 | 77% |
| gpu:idle | 6.55 | 28% | 4.50 | 16% |
| sdf:polys | 1.13 | 5% | 1.01 | 4% |
| post:fxaa | 0.35 | 1% | 0.36 | 1% |
| sdf:composite | 0.25 | 1% | 0.21 | 1% |
| post:blit | 0.18 | 1% | 0.18 | 1% |
| goo:surface | 0.10 | 0% | 0.11 | 0% |
| post:smear | 0.11 | 0% | 0.09 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.07 | 0% |
| sdf:occluder | 0.03 | 0% | 0.04 | 0% |
| goo:density | 0.02 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.37 | 2% | 0.00 | 0% |
| **labelled total (sum of medians)** | **23.50** | 100% | **28.83** | 100% |
| GPU span p50 (first start → last end) | 23.78 |  | 27.23 |  |
| fenced frame p50 | 29.43 |  | 33.91 |  |
| gap (frame − span) | 5.65 | 19% of frame | 6.68 | 20% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 12.20 | 10.20 |
| cpu:phase:wound-hit | 3.40 | 8.90 |
| cpu:draw | 8.70 | 6.40 |
| cpu:phase:body-step | 5.50 | 4.30 |
| cpu:phase:blood-simulation-and-sync | 0.20 | 0.20 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.60 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (33.63 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 9.06, cpu:tick 8.90, cpu:draw 5.20, gpu:idle 4.40, cpu:phase:body-step 3.90
- **fire** (63.90 ms labelled — droplets 0→215, goo quads 0→399): sdf:march 22.34, cpu:phase:wound-hit 13.20, cpu:tick 10.50, cpu:draw 6.60, gpu:idle 4.61
- **gib** (68.78 ms labelled — droplets 215→10, goo quads 399→262): sdf:march 38.16, cpu:tick 10.70, cpu:draw 6.30, gpu:idle 5.27, cpu:phase:body-step 4.40

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 30.66 / 30.13 / 27.82 | 10% |
| baseline | 4 | 25.30 / 32.46 / 22.01 | 47% |
| bone-seg-on | 3 | 26.29 / 33.28 / 51.90 | 97% |
| bone-seg-on | 4 | 48.49 / 27.84 / 62.72 | 125% |
| bone-mesh-on | 3 | 29.07 / 29.43 / 56.11 | 93% |
| bone-mesh-on | 4 | 26.51 / 33.91 / 49.45 | 87% |
