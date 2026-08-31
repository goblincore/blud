
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 3 | 14.29 | 9.36 | 14.25 | 15.75 | 24.44 |
| baseline | 4 | 4 | 9.47 | 11.66 | 9.33 | 7.73 | 42.60 |
| bleed-off | 3 | 3 | 14.19 | 9.31 | 14.16 | 15.51 | 43.06 |
| bleed-off | 4 | 4 | 9.60 | 11.86 | 9.08 | 8.23 | 45.88 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 3 | 14.29 / 14.43 / 14.18 | 0.25 | 2% |
| baseline | 4 | 9.47 / 9.33 / 9.79 | 0.46 | 5% |
| bleed-off | 3 | 14.19 / 14.19 / 14.15 | 0.04 | 0% |
| bleed-off | 4 | 9.15 / 9.96 / 9.60 | 0.81 | 9% |

**Worst repeat spread: 9%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out |
| ---: | --- | ---: | ---: | ---: |
| 3 | walk | 8→8 | 0→0 | 0→0 |
| 3 | fire | 8→8 | 0→13 | 0→0 |
| 3 | gib | 8→8 | 13→14 | 0→0 |
| 4 | walk | 9→9 | 0→0 | 0→0 |
| 4 | fire | 9→4 | 0→14 | 0→0 |
| 4 | gib | 4→4 | 14→16 | 0→1 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 3 | 3 | 15.10 | 20.80 | 326.80 | 21.6x | walk (326.8 ms) |
| 4 | 4 | 11.00 | 15.90 | 335.80 | 30.5x | walk (335.8 ms) |
