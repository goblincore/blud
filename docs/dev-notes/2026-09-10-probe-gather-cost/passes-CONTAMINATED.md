# Per-pass GPU attribution

1280x800, repeats=3, rooms=3,4, prelude: __sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 9.05 | 48% | 7.98 | 47% |
| compute:probe-gather | 7.19 | 38% | 6.02 | 35% |
| gpu:idle | 0.41 | 2% | 1.24 | 7% |
| sdf:polys | 0.80 | 4% | 0.77 | 4% |
| sdf:field-mesh | 0.41 | 2% | 0.29 | 2% |
| post:fxaa | 0.24 | 1% | 0.23 | 1% |
| post:blit | 0.13 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 0% | 0.09 | 1% |
| sdf:shell-hull | 0.07 | 0% | 0.08 | 0% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.07 | 0% |
| sdf:composite | 0.08 | 0% | 0.06 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **18.71** | 100% | **17.11** | 100% |
| GPU span p50 (first start → last end) | 17.88 |  | 14.36 |  |
| fenced frame p50 | 19.61 |  | 16.81 |  |
| gap (frame − span) | 1.73 | 9% of frame | 2.45 | 15% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 2.00 | 6.30 |
| cpu:tick | 5.50 | 5.90 |
| cpu:draw | 4.70 | 5.10 |
| cpu:phase:body-step | 2.60 | 2.90 |
| cpu:phase:skeleton-mesh | 0.40 | 0.40 |
| cpu:phase:encounter | 0.20 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:goo-sync | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (28.43 ms labelled — droplets 0→0, goo quads 0→0): compute:probe-gather 6.28, cpu:tick 5.90, sdf:march 5.13, cpu:draw 4.10, cpu:phase:body-step 3.00
- **fire** (38.90 ms labelled — droplets 0→57, goo quads 0→284): sdf:march 8.31, cpu:phase:wound-hit 6.90, cpu:tick 6.20, compute:probe-gather 6.06, cpu:draw 4.40
- **gib** (34.68 ms labelled — droplets 57→0, goo quads 284→256): sdf:march 10.37, cpu:draw 5.90, compute:probe-gather 5.72, cpu:tick 5.70, cpu:phase:body-step 2.70

## cone-on

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| gpu:idle | 19.94 | 51% | 18.12 | 57% |
| compute:probe-gather | 6.86 | 17% | 6.05 | 19% |
| sdf:march | 9.44 | 24% | 5.43 | 17% |
| sdf:polys | 0.82 | 2% | 0.80 | 3% |
| sdf:cone | 0.87 | 2% | 0.47 | 1% |
| post:fxaa | 0.24 | 1% | 0.23 | 1% |
| sdf:field-mesh | 0.37 | 1% | 0.18 | 1% |
| sdf:shell-hull | 0.10 | 0% | 0.14 | 0% |
| post:blit | 0.14 | 0% | 0.13 | 0% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:composite | 0.08 | 0% | 0.06 | 0% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.06 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| post:vhs-input | 0.05 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.04 | 0% | 0.02 | 0% |
| goo:density | 0.01 | 0% | 0.02 | 0% |
| effects | 0.03 | 0% | 0.01 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **39.22** | 100% | **31.90** | 100% |
| GPU span p50 (first start → last end) | 40.62 |  | 29.40 |  |
| fenced frame p50 | 22.42 |  | 16.20 |  |
| gap (frame − span) | -18.20 | -81% of frame | -13.20 | -81% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:tick | 7.00 | 7.40 |
| cpu:phase:wound-hit | 2.80 | 7.30 |
| cpu:draw | 6.00 | 5.20 |
| cpu:phase:body-step | 3.50 | 3.70 |
| cpu:phase:skeleton-mesh | 0.50 | 0.50 |
| cpu:phase:encounter | 0.30 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.00 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |
| cpu:phase:chunk-bake-swap | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (47.98 ms labelled — droplets 0→0, goo quads 0→0): gpu:idle 18.48, cpu:tick 6.70, compute:probe-gather 6.36, cpu:draw 5.40, sdf:march 4.70
- **fire** (75.23 ms labelled — droplets 0→69, goo quads 0→291): gpu:idle 23.69, cpu:phase:wound-hit 20.20, cpu:tick 7.50, sdf:march 5.92, compute:probe-gather 5.78
- **gib** (50.97 ms labelled — droplets 69→12, goo quads 291→262): gpu:idle 16.29, sdf:march 9.39, cpu:tick 7.00, compute:probe-gather 5.76, cpu:draw 4.90

## steps-48

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 8.96 | 39% | 6.48 | 39% |
| compute:probe-gather | 6.83 | 30% | 6.15 | 37% |
| gpu:idle | 5.20 | 22% | 2.09 | 13% |
| sdf:polys | 0.87 | 4% | 0.79 | 5% |
| sdf:field-mesh | 0.40 | 2% | 0.26 | 2% |
| post:fxaa | 0.24 | 1% | 0.24 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| post:vhs | 0.09 | 0% | 0.09 | 1% |
| sdf:shell-hull | 0.08 | 0% | 0.07 | 0% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.06 | 0% |
| sdf:composite | 0.07 | 0% | 0.06 | 0% |
| goo:surface | 0.06 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| sdf:march-chunks | 0.00 | 0% | 0.00 | 0% |
| **labelled total (sum of medians)** | **23.13** | 100% | **16.59** | 100% |
| GPU span p50 (first start → last end) | 21.42 |  | 13.90 |  |
| fenced frame p50 | 26.18 |  | 16.14 |  |
| gap (frame − span) | 4.76 | 18% of frame | 2.24 | 14% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 3.10 | 8.70 |
| cpu:tick | 10.10 | 6.10 |
| cpu:draw | 7.70 | 5.40 |
| cpu:phase:body-step | 5.00 | 3.00 |
| cpu:phase:skeleton-mesh | 0.60 | 0.40 |
| cpu:phase:encounter | 0.40 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (28.20 ms labelled — droplets 0→0, goo quads 0→0): compute:probe-gather 6.30, cpu:tick 5.30, cpu:draw 5.20, sdf:march 4.31, cpu:phase:body-step 2.80
- **fire** (45.60 ms labelled — droplets 0→71, goo quads 0→293): cpu:phase:wound-hit 8.70, cpu:tick 7.70, sdf:march 6.77, cpu:draw 5.90, compute:probe-gather 5.87
- **gib** (37.30 ms labelled — droplets 71→9, goo quads 293→259): sdf:march 9.81, cpu:tick 6.00, compute:probe-gather 5.76, cpu:draw 5.20, gpu:idle 3.80

## steps-24

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 10.28 | 41% | 6.95 | 38% |
| compute:probe-gather | 6.79 | 27% | 6.09 | 33% |
| gpu:idle | 5.99 | 24% | 2.69 | 15% |
| sdf:polys | 0.89 | 4% | 0.81 | 4% |
| sdf:march-chunks | 0.00 | 0% | 0.78 | 4% |
| post:fxaa | 0.26 | 1% | 0.24 | 1% |
| sdf:field-mesh | 0.37 | 1% | 0.23 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 1% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:field-mesh-weave | 0.08 | 0% | 0.07 | 0% |
| sdf:composite | 0.09 | 0% | 0.07 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.02 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| **labelled total (sum of medians)** | **25.21** | 100% | **18.37** | 100% |
| GPU span p50 (first start → last end) | 24.08 |  | 17.80 |  |
| fenced frame p50 | 29.18 |  | 21.10 |  |
| gap (frame − span) | 5.10 | 17% of frame | 3.30 | 16% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 11.20 | 7.40 |
| cpu:tick | 12.80 | 6.80 |
| cpu:draw | 9.40 | 4.30 |
| cpu:phase:body-step | 6.20 | 3.30 |
| cpu:phase:skeleton-mesh | 0.70 | 0.40 |
| cpu:phase:encounter | 0.50 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (28.80 ms labelled — droplets 0→0, goo quads 0→0): compute:probe-gather 6.33, cpu:tick 5.90, sdf:march 4.55, cpu:draw 4.00, cpu:phase:body-step 3.00
- **fire** (44.62 ms labelled — droplets 0→75, goo quads 0→296): cpu:phase:wound-hit 7.90, cpu:tick 7.80, sdf:march 6.84, compute:probe-gather 5.96, gpu:idle 5.08
- **gib** (36.92 ms labelled — droplets 75→159, goo quads 296→337): sdf:march 9.65, cpu:tick 6.80, compute:probe-gather 6.00, cpu:draw 4.50, cpu:phase:body-step 3.40

## steps-16

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 8.88 | 36% | 6.78 | 37% |
| compute:probe-gather | 6.90 | 28% | 6.01 | 33% |
| gpu:idle | 5.77 | 24% | 2.87 | 16% |
| sdf:polys | 0.88 | 4% | 0.79 | 4% |
| sdf:march-chunks | 0.79 | 3% | 0.69 | 4% |
| post:fxaa | 0.24 | 1% | 0.24 | 1% |
| sdf:field-mesh | 0.41 | 2% | 0.21 | 1% |
| post:blit | 0.14 | 1% | 0.13 | 1% |
| post:vhs | 0.09 | 0% | 0.09 | 0% |
| sdf:field-mesh-weave | 0.07 | 0% | 0.06 | 0% |
| sdf:composite | 0.08 | 0% | 0.06 | 0% |
| goo:surface | 0.06 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.07 | 0% | 0.05 | 0% |
| post:vhs-input | 0.04 | 0% | 0.04 | 0% |
| sdf:last-blit | 0.03 | 0% | 0.02 | 0% |
| goo:density | 0.02 | 0% | 0.02 | 0% |
| effects | 0.02 | 0% | 0.01 | 0% |
| **labelled total (sum of medians)** | **24.50** | 100% | **18.13** | 100% |
| GPU span p50 (first start → last end) | 21.55 |  | 15.39 |  |
| fenced frame p50 | 24.85 |  | 19.03 |  |
| gap (frame − span) | 3.30 | 13% of frame | 3.64 | 19% of frame |

CPU per frame (ms, median over repeats of p50):

| cpu | room 3 | room 4 |
| --- | ---: | ---: |
| cpu:phase:wound-hit | 4.40 | 7.60 |
| cpu:tick | 11.60 | 6.60 |
| cpu:draw | 9.20 | 4.20 |
| cpu:phase:body-step | 5.70 | 3.20 |
| cpu:phase:skeleton-mesh | 0.70 | 0.40 |
| cpu:phase:encounter | 0.40 | 0.10 |
| cpu:phase:blood-simulation-and-sync | 0.10 | 0.10 |
| cpu:phase:goo-sync | 0.10 | 0.10 |
| cpu:phase:chunk-bake-swap | 0.40 | 0.00 |
| cpu:phase:wound-flush | 0.00 | 0.00 |
| cpu:phase:projectiles-and-hits | 0.00 | 0.00 |
| cpu:phase:chunks-and-guts | 0.00 | 0.00 |

Per segment (top passes, room 4):

- **walk** (26.40 ms labelled — droplets 0→0, goo quads 0→0): compute:probe-gather 6.26, cpu:tick 5.10, sdf:march 4.67, cpu:draw 3.60, cpu:phase:body-step 2.60
- **fire** (45.58 ms labelled — droplets 0→55, goo quads 0→283): cpu:phase:wound-hit 9.00, cpu:tick 7.90, sdf:march 6.70, compute:probe-gather 5.95, cpu:draw 5.40
- **gib** (35.62 ms labelled — droplets 55→11, goo quads 283→261): sdf:march 11.21, cpu:tick 6.60, compute:probe-gather 5.82, cpu:draw 4.40, cpu:phase:body-step 3.20

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 19.61 / 17.55 / 26.89 | 53% |
| baseline | 4 | 19.03 / 16.63 / 16.81 | 14% |
| cone-on | 3 | 22.42 / 18.44 / 26.58 | 44% |
| cone-on | 4 | 14.59 / 20.48 / 16.20 | 40% |
| steps-48 | 3 | 16.89 / 26.18 / 27.93 | 65% |
| steps-48 | 4 | 14.06 / 30.38 / 16.14 | 116% |
| steps-24 | 3 | 17.54 / 33.95 / 29.18 | 94% |
| steps-24 | 4 | 21.10 / 25.23 / 16.37 | 54% |
| steps-16 | 3 | 17.96 / 33.16 / 24.85 | 85% |
| steps-16 | 4 | 19.03 / 24.07 / 15.57 | 55% |
