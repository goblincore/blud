# Per-pass GPU attribution

1280x800, repeats=2, rooms=3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| goo:density | 11.89 | 45% | 14.53 | 48% |
| sdf:march | 12.28 | 47% | 13.75 | 46% |
| sdf:polys | 0.95 | 4% | 0.78 | 3% |
| post:fxaa | 0.29 | 1% | 0.29 | 1% |
| sdf:composite | 0.21 | 1% | 0.25 | 1% |
| goo:surface | 0.23 | 1% | 0.17 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| post:smear | 0.08 | 0% | 0.08 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **26.16** | 100% | **30.07** | 100% |
| GPU span p50 (first start → last end) | 29.59 |  | 32.94 |  |
| fenced frame p50 | 19.98 |  | 24.25 |  |
| gap (frame − span) | -9.61 | -48% of frame | -8.69 | -36% of frame |

Per segment (top passes, room 4):

- **walk** (8.83 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.87, sdf:polys 1.25, post:fxaa 0.28, post:blit 0.15, post:smear 0.08
- **fire** (32.21 ms labelled — droplets 0→70, goo quads 0→293): goo:density 16.54, sdf:march 13.60, goo:surface 0.65, sdf:polys 0.55, post:fxaa 0.37
- **gib** (57.71 ms labelled — droplets 70→14, goo quads 293→264): goo:density 28.37, sdf:march 26.86, sdf:composite 1.01, sdf:polys 0.53, post:fxaa 0.33

## goo-dens-0.35

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 11.94 | 50% | 18.40 | 51% |
| goo:density | 9.94 | 42% | 15.39 | 43% |
| sdf:polys | 0.81 | 3% | 0.94 | 3% |
| sdf:composite | 0.20 | 1% | 0.34 | 1% |
| post:fxaa | 0.26 | 1% | 0.27 | 1% |
| goo:surface | 0.25 | 1% | 0.20 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **23.71** | 100% | **35.85** | 100% |
| GPU span p50 (first start → last end) | 27.36 |  | 39.03 |  |
| fenced frame p50 | 20.40 |  | 29.32 |  |
| gap (frame − span) | -6.96 | -34% of frame | -9.71 | -33% of frame |

Per segment (top passes, room 4):

- **walk** (8.35 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.56, sdf:polys 1.12, post:fxaa 0.24, post:blit 0.14, goo:surface 0.08
- **fire** (38.93 ms labelled — droplets 0→61, goo quads 0→287): goo:density 18.88, sdf:march 18.40, sdf:polys 0.54, sdf:composite 0.30, post:fxaa 0.29
- **gib** (75.06 ms labelled — droplets 61→0, goo quads 287→256): goo:density 36.73, sdf:march 35.85, sdf:composite 1.03, sdf:polys 0.53, post:fxaa 0.33

## goo-dens-0.25

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.02 | 52% | 18.29 | 51% |
| goo:density | 9.13 | 39% | 14.92 | 42% |
| sdf:polys | 0.95 | 4% | 0.94 | 3% |
| sdf:composite | 0.18 | 1% | 0.50 | 1% |
| post:fxaa | 0.31 | 1% | 0.32 | 1% |
| goo:surface | 0.31 | 1% | 0.25 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **23.21** | 100% | **35.52** | 100% |
| GPU span p50 (first start → last end) | 26.83 |  | 38.53 |  |
| fenced frame p50 | 20.89 |  | 27.24 |  |
| gap (frame − span) | -5.94 | -28% of frame | -11.29 | -41% of frame |

Per segment (top passes, room 4):

- **walk** (9.30 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.79, sdf:polys 1.88, post:fxaa 0.24, post:blit 0.14, post:smear 0.07
- **fire** (40.45 ms labelled — droplets 0→59, goo quads 0→284): goo:density 19.70, sdf:march 18.29, sdf:composite 0.88, sdf:polys 0.55, goo:surface 0.38
- **gib** (74.69 ms labelled — droplets 59→0, goo quads 284→256): goo:density 36.52, sdf:march 34.69, sdf:composite 1.16, goo:surface 1.11, sdf:polys 0.54

## goo-dens-0.125

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 11.81 | 49% | 16.17 | 50% |
| goo:density | 10.51 | 43% | 14.37 | 44% |
| sdf:polys | 0.72 | 3% | 0.87 | 3% |
| sdf:composite | 0.15 | 1% | 0.27 | 1% |
| post:fxaa | 0.35 | 1% | 0.25 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| goo:surface | 0.34 | 1% | 0.13 | 0% |
| post:smear | 0.08 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **24.20** | 100% | **32.35** | 100% |
| GPU span p50 (first start → last end) | 27.47 |  | 35.30 |  |
| fenced frame p50 | 20.12 |  | 25.83 |  |
| gap (frame − span) | -7.35 | -37% of frame | -9.47 | -37% of frame |

Per segment (top passes, room 4):

- **walk** (8.24 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.53, sdf:polys 1.08, post:fxaa 0.24, post:blit 0.14, post:smear 0.07
- **fire** (38.85 ms labelled — droplets 0→58, goo quads 0→284): goo:density 19.69, sdf:march 16.88, sdf:composite 0.94, sdf:polys 0.53, post:fxaa 0.32
- **gib** (50.69 ms labelled — droplets 58→0, goo quads 284→256): goo:density 25.74, sdf:march 22.55, sdf:composite 1.11, sdf:polys 0.53, post:fxaa 0.27

## goo-cap-300

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.02 | 51% | 16.51 | 50% |
| goo:density | 9.88 | 42% | 14.85 | 45% |
| sdf:polys | 0.79 | 3% | 0.75 | 2% |
| post:fxaa | 0.26 | 1% | 0.30 | 1% |
| sdf:composite | 0.20 | 1% | 0.21 | 1% |
| goo:surface | 0.29 | 1% | 0.16 | 0% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| post:smear | 0.07 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.05 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **23.75** | 100% | **33.07** | 100% |
| GPU span p50 (first start → last end) | 27.14 |  | 34.86 |  |
| fenced frame p50 | 20.22 |  | 28.71 |  |
| gap (frame − span) | -6.92 | -34% of frame | -6.15 | -21% of frame |

Per segment (top passes, room 4):

- **walk** (9.32 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 6.82, sdf:polys 1.86, post:fxaa 0.24, post:blit 0.14, post:smear 0.07
- **fire** (35.01 ms labelled — droplets 0→70, goo quads 0→293): goo:density 16.81, sdf:march 16.60, sdf:polys 0.53, post:fxaa 0.38, goo:surface 0.19
- **gib** (57.84 ms labelled — droplets 70→8, goo quads 293→260): goo:density 27.99, sdf:march 27.40, sdf:composite 1.08, sdf:polys 0.54, post:fxaa 0.28

## goo-mintexel-1

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.01 | 48% | 15.58 | 49% |
| goo:density | 10.76 | 43% | 14.12 | 45% |
| sdf:polys | 0.76 | 3% | 0.66 | 2% |
| post:fxaa | 0.33 | 1% | 0.35 | 1% |
| sdf:composite | 0.22 | 1% | 0.27 | 1% |
| goo:surface | 0.39 | 2% | 0.22 | 1% |
| post:blit | 0.14 | 1% | 0.14 | 0% |
| post:smear | 0.08 | 0% | 0.07 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.06 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **24.80** | 100% | **31.49** | 100% |
| GPU span p50 (first start → last end) | 29.02 |  | 31.53 |  |
| fenced frame p50 | 21.76 |  | 20.69 |  |
| gap (frame − span) | -7.26 | -33% of frame | -10.84 | -52% of frame |

Per segment (top passes, room 4):

- **walk** (9.63 ms labelled — droplets 0→0, goo quads 0→0): sdf:march 7.80, sdf:polys 1.14, post:fxaa 0.24, post:blit 0.14, goo:surface 0.10
- **fire** (32.86 ms labelled — droplets 0→69, goo quads 0→267): sdf:march 15.58, goo:density 15.51, sdf:polys 0.54, post:fxaa 0.44, goo:surface 0.27
- **gib** (58.77 ms labelled — droplets 69→9, goo quads 267→261): goo:density 28.59, sdf:march 27.20, sdf:composite 1.08, goo:surface 0.73, sdf:polys 0.53

## goo-density-off

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 12.34 | 45% | 19.00 | 55% |
| sdf:polys | 13.63 | 50% | 14.28 | 41% |
| sdf:composite | 0.22 | 1% | 0.45 | 1% |
| post:fxaa | 0.30 | 1% | 0.36 | 1% |
| goo:surface | 0.29 | 1% | 0.21 | 1% |
| post:blit | 0.14 | 1% | 0.16 | 0% |
| post:smear | 0.08 | 0% | 0.09 | 0% |
| sdf:shell-hull | 0.08 | 0% | 0.06 | 0% |
| sdf:occluder | 0.02 | 0% | 0.03 | 0% |
| **labelled total (sum of medians)** | **27.12** | 100% | **34.64** | 100% |
| GPU span p50 (first start → last end) | 28.13 |  | 41.64 |  |
| fenced frame p50 | 21.12 |  | 32.32 |  |
| gap (frame − span) | -7.01 | -33% of frame | -9.32 | -29% of frame |

Per segment (top passes, room 4):

- **walk** (16.08 ms labelled — droplets 0→0, goo quads 0→0): sdf:polys 8.49, sdf:march 6.93, post:fxaa 0.24, post:blit 0.14, sdf:composite 0.08
- **fire** (41.48 ms labelled — droplets 0→71, goo quads 0→293): sdf:polys 20.32, sdf:march 19.00, sdf:composite 0.96, post:fxaa 0.46, goo:surface 0.37
- **gib** (88.29 ms labelled — droplets 71→9, goo quads 293→261): sdf:polys 43.41, sdf:march 42.17, sdf:composite 1.36, goo:surface 0.56, post:fxaa 0.44

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 3 | 19.66 / 19.98 | 2% |
| baseline | 4 | 20.00 / 24.25 | 21% |
| goo-dens-0.35 | 3 | 15.63 / 20.40 | 31% |
| goo-dens-0.35 | 4 | 20.79 / 29.32 | 41% |
| goo-dens-0.25 | 3 | 15.40 / 20.89 | 36% |
| goo-dens-0.25 | 4 | 18.29 / 27.24 | 49% |
| goo-dens-0.125 | 3 | 14.96 / 20.12 | 34% |
| goo-dens-0.125 | 4 | 19.94 / 25.83 | 30% |
| goo-cap-300 | 3 | 14.62 / 20.22 | 38% |
| goo-cap-300 | 4 | 20.07 / 28.71 | 43% |
| goo-mintexel-1 | 3 | 15.10 / 21.76 | 44% |
| goo-mintexel-1 | 4 | 20.69 / 18.65 | 11% |
| goo-density-off | 3 | 15.25 / 21.12 | 38% |
| goo-density-off | 4 | 29.43 / 32.32 | 10% |
