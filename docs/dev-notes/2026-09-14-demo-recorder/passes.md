# Per-pass GPU attribution

1280x800, repeats=3, rooms=2, query: seed=4242

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 2 ms | share |
| --- | ---: | ---: |
| sdf:march | 38.53 | 83% |
| gpu:idle | 5.24 | 11% |
| sdf:polys | 1.46 | 3% |
| post:fxaa | 0.33 | 1% |
| post:blit | 0.19 | 0% |
| sdf:last-blit | 0.18 | 0% |
| goo:surface | 0.15 | 0% |
| post:vhs | 0.13 | 0% |
| sdf:composite | 0.10 | 0% |
| sdf:shell-hull | 0.09 | 0% |
| post:vhs-input | 0.06 | 0% |
| compute:probe-gather | 0.06 | 0% |
| goo:density | 0.02 | 0% |
| effects | 0.01 | 0% |
| **labelled total (sum of medians)** | **46.54** | 100% |
| GPU span p50 (first start → last end) | 42.20 |  |
| fenced frame p50 | 50.69 |  |
| gap (frame − span) | 8.49 | 17% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 2 |
| --- | ---: |
| cpu:tick | 10.30 |
| cpu:draw | 7.60 |
| cpu:phase:wound-hit | 7.50 |
| cpu:phase:body-step | 4.80 |
| cpu:phase:skeleton-mesh | 0.60 |
| cpu:phase:encounter | 0.30 |
| cpu:phase:blood-simulation-and-sync | 0.20 |
| cpu:phase:goo-sync | 0.10 |
| cpu:phase:wound-flush | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 |

Per segment (top passes, room 2):

- **walk** (56.53 ms labelled — droplets 21→15, goo quads 263→262): sdf:march 27.08, cpu:tick 9.60, cpu:draw 6.90, gpu:idle 5.24, cpu:phase:body-step 4.40
- **fire** (80.71 ms labelled — droplets 15→134, goo quads 262→348): sdf:march 37.70, cpu:tick 11.40, cpu:phase:wound-hit 9.60, cpu:draw 7.90, cpu:phase:body-step 5.20
- **gib** (105.01 ms labelled — droplets 134→19, goo quads 348→269): sdf:march 68.74, cpu:tick 11.20, cpu:draw 8.20, gpu:idle 5.41, cpu:phase:body-step 5.20

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 2 | 60.38 / 50.69 / 46.31 | 30% |
