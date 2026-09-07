# Per-pass GPU attribution

1280x800, repeats=2, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| goo:density | 12.16 | 45% | 14.40 | 50% |
| sdf:march | 12.20 | 45% | 11.59 | 40% |
| gpu:idle | 0.90 | 3% | 1.05 | 4% |
| sdf:polys | 0.70 | 3% | 0.67 | 2% |
| post:fxaa | 0.26 | 1% | 0.28 | 1% |
| goo:surface | 0.23 | 1% | 0.20 | 1% |
| sdf:composite | 0.19 | 1% | 0.16 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.06 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **26.97** | 100% | **28.67** | 100% |
| GPU span p50 (first start → last end) | 29.78 |  | 31.74 |  |
| fenced frame p50 | 21.13 |  | 18.80 |  |
| gap (frame − span) | -8.65 | -41% of frame | -12.94 | -69% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.60 | 4.80 |
| cpu:phase:wound-hit | 5.30 | 4.00 |
| cpu:draw | 2.50 | 2.40 |
| cpu:phase:body-step | 2.00 | 2.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (16.76 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.45, cpu:tick 4.30, cpu:draw 2.30, cpu:phase:body-step 1.90, sdf:polys 0.99
- **fire** (47.27 ms labelled — droplets 0→56, goo quads 0→284): goo:density 16.04, sdf:march 11.08, cpu:phase:wound-hit 5.50, cpu:tick 5.10, cpu:draw 2.50
- **gib** (68.49 ms labelled — droplets 56→14, goo quads 284→264): goo:density 26.91, sdf:march 25.32, cpu:tick 5.20, gpu:idle 2.71, cpu:draw 2.60

## goo-density-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.25 | 42% | 16.57 | 50% |
| sdf:polys | 14.07 | 48% | 14.34 | 44% |
| gpu:idle | 1.66 | 6% | 1.18 | 4% |
| post:fxaa | 0.27 | 1% | 0.27 | 1% |
| sdf:composite | 0.29 | 1% | 0.20 | 1% |
| post:blit | 0.13 | 0% | 0.13 | 0% |
| goo:surface | 0.23 | 1% | 0.09 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **29.09** | 100% | **32.95** | 100% |
| GPU span p50 (first start → last end) | 28.33 |  | 32.52 |  |
| fenced frame p50 | 21.41 |  | 28.22 |  |
| gap (frame − span) | -6.92 | -32% of frame | -4.30 | -15% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 4.60 | 4.70 |
| cpu:phase:wound-hit | 4.30 | 3.70 |
| cpu:draw | 2.40 | 2.40 |
| cpu:phase:body-step | 2.00 | 2.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (25.41 ms labelled — droplets 0→0, goo quads 0→0): sdf:polys 8.41, sdf:march 6.92, cpu:tick 4.40, cpu:draw 2.30, cpu:phase:body-step 1.90
- **fire** (55.08 ms labelled — droplets 0→55, goo quads 0→283): sdf:polys 19.27, sdf:march 18.30, cpu:phase:wound-hit 5.40, cpu:tick 5.00, cpu:draw 2.40
- **gib** (69.11 ms labelled — droplets 55→0, goo quads 283→256): sdf:polys 27.57, sdf:march 26.73, cpu:tick 5.00, cpu:draw 2.50, cpu:phase:body-step 2.30

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 21.13 / 20.68 | 2% |
| baseline | 4 | 13.43 / 18.80 | 40% |
| goo-density-off | 3 | 20.37 / 21.41 | 5% |
| goo-density-off | 4 | 26.77 / 28.22 | 5% |
