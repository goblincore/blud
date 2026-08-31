
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 3 | 21.42 | 14.72 | 21.61 | 22.57 | 69.05 |
| baseline | 4 | 4 | 14.56 | 15.71 | 14.35 | 10.92 | 67.44 |
| occluder-off | 3 | 3 | 21.24 | 14.81 | 22.08 | 22.79 | 80.86 |
| occluder-off | 4 | 4 | 14.93 | 16.55 | 14.53 | 11.40 | 78.08 |
| cone-on | 3 | 3 | 18.77 | 14.80 | 21.94 | 18.77 | 47.70 |
| cone-on | 4 | 4 | 14.73 | 15.97 | 13.62 | 14.41 | 65.40 |
| fxaa-off | 3 | 3 | 21.40 | 14.74 | 21.40 | 22.84 | 69.59 |
| fxaa-off | 4 | 4 | 13.96 | 15.55 | 13.95 | 10.86 | 65.13 |
| scale-0.7 | 3 | 3 | 13.03 | 10.72 | 13.70 | 13.55 | 41.93 |
| scale-0.7 | 4 | 4 | 10.95 | 12.40 | 10.91 | 7.65 | 52.11 |
| scale-0.5 | 3 | 3 | 9.06 | 7.35 | 9.15 | 10.17 | 20.83 |
| scale-0.5 | 4 | 4 | 6.64 | 7.21 | 6.58 | 5.91 | 32.35 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 3 | 21.42 / 22.05 / 21.40 | 0.65 | 3% |
| baseline | 4 | 14.56 / 14.35 / 15.02 | 0.67 | 5% |
| occluder-off | 3 | 21.24 / 21.97 / 18.39 | 3.58 | 19% |
| occluder-off | 4 | 14.93 / 14.89 / 15.32 | 0.43 | 3% |
| cone-on | 3 | 15.52 / 18.77 / 21.70 | 6.18 | 40% |
| cone-on | 4 | 14.73 / 15.59 / 13.85 | 1.74 | 13% |
| fxaa-off | 3 | 21.66 / 21.40 / 21.39 | 0.27 | 1% |
| fxaa-off | 4 | 13.77 / 13.96 / 14.41 | 0.64 | 5% |
| scale-0.7 | 3 | 13.03 / 13.00 / 15.03 | 2.03 | 16% |
| scale-0.7 | 4 | 11.59 / 10.47 / 10.95 | 1.12 | 11% |
| scale-0.5 | 3 | 9.06 / 9.10 / 8.63 | 0.47 | 5% |
| scale-0.5 | 4 | 6.64 / 6.60 / 7.04 | 0.44 | 7% |

**Worst repeat spread: 40% of the smaller value.** That is too large to read ablation deltas from — treat every comparison below as UNRESOLVED.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out |
| ---: | --- | ---: | ---: | ---: |
| 3 | walk | 8→8 | 0→0 | 0→0 |
| 3 | fire | 8→8 | 0→11 | 0→0 |
| 3 | gib | 8→8 | 11→12 | 0→0 |
| 4 | walk | 9→9 | 0→0 | 0→0 |
| 4 | fire | 9→8 | 0→16 | 0→1 |
| 4 | gib | 8→4 | 16→17 | 1→1 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 3 | 3 | 30.10 | 37.70 | 158.80 | 5.3x | fire (158.8 ms) |
| 4 | 4 | 17.90 | 30.30 | 597.70 | 33.4x | walk (597.7 ms) |
