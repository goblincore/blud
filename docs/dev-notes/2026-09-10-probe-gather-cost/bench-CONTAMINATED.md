
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 3 | 19.61 | 13.31 | 19.61 | 27.29 | 97.29 |
| baseline | 4 | 4 | 16.81 | 12.61 | 16.63 | 19.28 | 47.26 |
| cone-on | 3 | 3 | 22.42 | 14.47 | 20.39 | 28.40 | 35.40 |
| cone-on | 4 | 4 | 16.20 | 14.01 | 16.74 | 17.54 | 58.68 |
| steps-48 | 3 | 3 | 26.18 | 18.97 | 20.32 | 31.61 | 53.57 |
| steps-48 | 4 | 4 | 16.14 | 11.59 | 30.38 | 17.55 | 53.26 |
| steps-24 | 3 | 3 | 29.18 | 17.26 | 31.19 | 29.62 | 70.15 |
| steps-24 | 4 | 4 | 21.10 | 12.81 | 21.10 | 24.69 | 78.72 |
| steps-16 | 3 | 3 | 24.85 | 14.21 | 23.89 | 30.12 | 54.92 |
| steps-16 | 4 | 4 | 19.03 | 11.98 | 19.53 | 20.57 | 56.30 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 3 | 19.61 / 17.55 / 26.89 | 9.34 | 53% |
| baseline | 4 | 19.03 / 16.63 / 16.81 | 2.40 | 14% |
| cone-on | 3 | 22.42 / 18.44 / 26.58 | 8.14 | 44% |
| cone-on | 4 | 14.59 / 20.48 / 16.20 | 5.89 | 40% |
| steps-48 | 3 | 16.89 / 26.18 / 27.93 | 11.04 | 65% |
| steps-48 | 4 | 14.06 / 30.38 / 16.14 | 16.32 | 116% |
| steps-24 | 3 | 17.54 / 33.95 / 29.18 | 16.41 | 94% |
| steps-24 | 4 | 21.10 / 25.23 / 16.37 | 8.86 | 54% |
| steps-16 | 3 | 17.96 / 33.16 / 24.85 | 15.20 | 85% |
| steps-16 | 4 | 19.03 / 24.07 / 15.57 | 8.50 | 55% |

**Worst repeat spread: 116%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | walk | 6→7 | 0→0 | 0→0 | 0→0 | 0→0 |
| 3 | fire | 7→8 | 0→16 | 0→1 | 0→32 | 0→273 |
| 3 | gib | 8→8 | 16→16 | 1→0 | 32→6 | 273→258 |
| 4 | walk | 5→4 | 0→0 | 0→0 | 0→0 | 0→0 |
| 4 | fire | 4→4 | 0→16 | 0→0 | 0→57 | 0→284 |
| 4 | gib | 4→4 | 16→16 | 0→0 | 57→0 | 284→256 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
