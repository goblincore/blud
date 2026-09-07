
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 2 | 2 | 14.66 | 9.94 | 15.11 | 17.63 | 37.60 |
| baseline | 4 | 4 | 13.84 | 9.27 | 15.71 | 18.99 | 36.18 |
| tiles-on | 2 | 2 | 10.67 | 7.11 | 10.57 | 18.40 | 28.37 |
| tiles-on | 4 | 4 | 20.03 | 9.23 | 20.03 | 26.65 | 43.10 |
| tiles-raycull | 2 | 2 | 10.55 | 6.90 | 10.55 | 17.67 | 28.82 |
| tiles-raycull | 4 | 4 | 21.50 | 9.66 | 21.50 | 29.91 | 36.81 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 2 | 14.66 / 18.76 / 8.42 | 10.34 | 123% |
| baseline | 4 | 13.84 / 13.50 / 20.75 | 7.25 | 54% |
| tiles-on | 2 | 17.35 / 10.67 / 10.67 | 6.68 | 63% |
| tiles-on | 4 | 15.09 / 20.03 / 20.03 | 4.94 | 33% |
| tiles-raycull | 2 | 16.83 / 10.31 / 10.55 | 6.52 | 63% |
| tiles-raycull | 4 | 22.83 / 21.50 / 21.23 | 1.60 | 8% |

**Worst repeat spread: 123%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out |
| ---: | --- | ---: | ---: | ---: |
| 2 | walk | 10→10 | 0→0 | 0→0 |
| 2 | fire | 10→9 | 0→16 | 0→0 |
| 2 | gib | 9→9 | 16→16 | 0→0 |
| 4 | walk | 7→4 | 0→0 | 0→0 |
| 4 | fire | 4→4 | 0→16 | 0→0 |
| 4 | gib | 4→4 | 16→16 | 0→0 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2 | 2 | 16.20 | 27.60 | 227.90 | 14.1x | fire (227.9 ms) |
| 4 | 4 | 26.00 | 35.10 | 237.20 | 9.1x | fire (237.2 ms) |
