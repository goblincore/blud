# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4, prelude: __sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 6.41 | 45% | 9.95 | 62% |
| compute:probe-gather | 4.83 | 34% | 4.03 | 25% |
| sdf:polys | 0.78 | 5% | 0.76 | 5% |
| gpu:idle | 0.39 | 3% | 0.37 | 2% |
| post:fxaa | 0.22 | 2% | 0.23 | 1% |
| sdf:field-mesh | 0.30 | 2% | 0.21 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 1% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.07 | 1% | 0.03 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.01 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.79 | 6% | 0.00 | 0% |
| **labelled total (sum of medians)** | **14.28** | 100% | **16.04** | 100% |
| GPU span p50 (first start → last end) | 14.85 |  | 14.96 |  |
| fenced frame p50 | 16.97 |  | 18.27 |  |
| gap (frame − span) | 2.12 | 12% of frame | 3.31 | 18% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 1.20 | 5.50 |
| cpu:tick | 5.40 | 5.00 |
| cpu:draw | 4.50 | 3.40 |
| cpu:phase:body-step | 2.60 | 2.50 |
| cpu:phase:skeleton-mesh | 0.30 | 0.30 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (23.20 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 5.57, cpu:tick 4.90, compute:probe-gather 4.03, cpu:draw 3.40, cpu:phase:body-step 2.50
- **fire** (34.52 ms labelled — droplets 0→217, goo quads 0→401): sdf:march 10.88, cpu:phase:wound-hit 6.50, cpu:tick 5.10, compute:probe-gather 3.94, cpu:draw 3.20
- **gib** (32.93 ms labelled — droplets 217→10, goo quads 401→262): sdf:march 14.58, cpu:tick 5.00, compute:probe-gather 4.22, cpu:draw 3.50, cpu:phase:body-step 2.50

## probe-rate4

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 5.88 | 41% | 9.83 | 61% |
| compute:probe-gather | 4.10 | 28% | 3.97 | 24% |
| gpu:idle | 1.86 | 13% | 0.77 | 5% |
| sdf:polys | 0.77 | 5% | 0.74 | 5% |
| post:fxaa | 0.22 | 2% | 0.22 | 1% |
| sdf:field-mesh | 0.27 | 2% | 0.18 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 1% | 0.09 | 1% |
| sdf:field-mesh-weave | 0.06 | 0% | 0.06 | 0% |
| sdf:composite | 0.06 | 0% | 0.06 | 0% |
| goo:surface | 0.05 | 0% | 0.05 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:shell-hull | 0.08 | 1% | 0.04 | 0% |
| sdf:last-blit | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.80 | 6% | 0.00 | 0% |
| **labelled total (sum of medians)** | **14.47** | 100% | **16.22** | 100% |
| GPU span p50 (first start → last end) | 13.81 |  | 14.00 |  |
| fenced frame p50 | 16.08 |  | 16.56 |  |
| gap (frame − span) | 2.27 | 14% of frame | 2.56 | 15% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 1.30 | 5.60 |
| cpu:tick | 5.40 | 5.00 |
| cpu:draw | 4.50 | 3.20 |
| cpu:phase:body-step | 2.70 | 2.50 |
| cpu:phase:skeleton-mesh | 0.30 | 0.30 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (24.21 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 5.54, cpu:tick 5.10, compute:probe-gather 4.00, cpu:draw 3.30, cpu:phase:body-step 2.60
- **fire** (34.74 ms labelled — droplets 0→66, goo quads 0→290): sdf:march 11.02, cpu:phase:wound-hit 6.10, cpu:tick 5.40, compute:probe-gather 3.93, cpu:draw 3.30
- **gib** (30.72 ms labelled — droplets 66→152, goo quads 290→327): sdf:march 13.62, cpu:tick 5.00, compute:probe-gather 3.98, cpu:draw 3.00, cpu:phase:body-step 2.40

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 17.10 / 16.83 / 16.97 | 2% |
| baseline | 4 | 18.42 / 16.71 / 18.27 | 10% |
| probe-rate4 | 3 | 16.08 / 16.12 / 15.24 | 6% |
| probe-rate4 | 4 | 10.44 / 16.56 / 17.30 | 66% |
