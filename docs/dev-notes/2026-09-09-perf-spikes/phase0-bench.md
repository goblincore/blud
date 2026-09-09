
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 3 | 22.69 | 15.45 | 22.69 | 29.14 | 33.90 |
| baseline | 4 | 4 | 22.64 | 14.32 | 22.64 | 34.43 | 43.54 |
| baseline | 5 | 5 | 25.21 | 19.99 | 25.21 | 35.38 | 38.36 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 3 | 22.69 / 20.85 | 1.84 | 9% |
| baseline | 4 | 21.99 / 22.64 | 0.65 | 3% |
| baseline | 5 | 16.26 / 25.21 | 8.95 | 55% |

**Worst repeat spread: 55%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | walk | 8→7 | 0→0 | 0→0 | 0→0 | 0→0 |
| 3 | fire | 7→8 | 0→16 | 0→0 | 0→70 | 0→292 |
| 3 | gib | 8→7 | 16→17 | 0→0 | 70→11 | 292→263 |
| 4 | walk | 6→4 | 0→0 | 0→0 | 0→0 | 0→0 |
| 4 | fire | 4→4 | 0→16 | 0→0 | 0→50 | 0→280 |
| 4 | gib | 4→7 | 16→17 | 0→0 | 50→9 | 280→261 |
| 5 | walk | 8→8 | 0→0 | 0→0 | 0→0 | 0→0 |
| 5 | fire | 8→5 | 0→16 | 0→0 | 0→79 | 0→300 |
| 5 | gib | 5→13 | 16→16 | 0→0 | 79→0 | 300→256 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
