# Per-pass GPU attribution

1280x800, repeats=3, rooms=1,2,3,4

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline

| pass | room 1 ms | share | room 2 ms | share | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sdf:march | 5.39 | 67% | 6.09 | 62% | 9.41 | 67% | 13.12 | 55% |
| goo:density | 0.62 | 8% | 2.58 | 26% | 3.43 | 25% | 9.64 | 40% |
| sdf:polys | 1.40 | 17% | 0.54 | 5% | 0.53 | 4% | 0.53 | 2% |
| post:fxaa | 0.24 | 3% | 0.22 | 2% | 0.23 | 2% | 0.23 | 1% |
| post:blit | 0.13 | 2% | 0.12 | 1% | 0.12 | 1% | 0.12 | 1% |
| post:smear | 0.07 | 1% | 0.07 | 1% | 0.07 | 0% | 0.07 | 0% |
| sdf:composite | 0.06 | 1% | 0.06 | 1% | 0.06 | 0% | 0.06 | 0% |
| sdf:shell-hull | 0.05 | 1% | 0.03 | 0% | 0.06 | 0% | 0.04 | 0% |
| goo:surface | 0.04 | 0% | 0.04 | 0% | 0.04 | 0% | 0.04 | 0% |
| sdf:occluder | 0.01 | 0% | 0.02 | 0% | 0.02 | 0% | 0.02 | 0% |
| effects | 0.01 | 0% | 0.00 | 0% | 0.00 | 0% | 0.00 | 0% |
| **labelled total** | **8.00** | 100% | **9.75** | 100% | **13.98** | 100% | **23.88** | 100% |
| fenced frame p50 | 8.09 |  | 8.41 |  | 14.15 |  | 19.03 |  |
| gap (frame − passes) | 0.09 | 1% of frame | -1.34 | -16% of frame | 0.17 | 1% of frame | -4.85 | -25% of frame |

Per segment (top passes, room 4):

- **walk** (7.84 ms labelled): sdf:march 5.90, sdf:polys 1.40, post:fxaa 0.22, post:blit 0.13, post:smear 0.07
- **fire** (26.71 ms labelled): sdf:march 13.12, goo:density 12.47, sdf:polys 0.52, post:fxaa 0.23, post:blit 0.12
- **gib** (43.36 ms labelled): goo:density 21.35, sdf:march 20.88, sdf:polys 0.52, post:fxaa 0.23, post:blit 0.12

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
| baseline | 1 | 7.55 / 8.09 / 8.74 | 16% |
| baseline | 2 | 8.29 / 8.41 / 13.52 | 63% |
| baseline | 3 | 14.15 / 13.97 / 14.66 | 5% |
| baseline | 4 | 17.76 / 21.75 / 19.03 | 22% |
