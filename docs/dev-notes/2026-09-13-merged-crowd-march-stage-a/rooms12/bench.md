
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 28.44 | 25.30 | 27.06 | 31.66 | 46.83 |
| baseline | 2 | 2 | 55.47 | 25.75 | 55.17 | 59.56 | 90.23 |
| crowd-on | 1 | 1 | 41.69 | 28.69 | 41.87 | 48.21 | 58.47 |
| crowd-on | 2 | 2 | 61.78 | 60.42 | 61.78 | 65.31 | 91.46 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 1 | 19.70 / 43.50 / 28.44 | 23.80 | 121% |
| baseline | 2 | 36.33 / 55.47 / 58.34 | 22.01 | 61% |
| crowd-on | 1 | 28.92 / 41.69 / 63.54 | 34.62 | 120% |
| crowd-on | 2 | 48.95 / 61.78 / 65.26 | 16.31 | 33% |

**Worst repeat spread: 121%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | walk | 1→4 | 0→0 | 0→0 | 0→0 | 0→0 |
| 1 | fire | 4→4 | 0→16 | 0→0 | 0→102 | 0→322 |
| 1 | gib | 4→5 | 16→16 | 0→0 | 102→9 | 322→259 |
| 2 | walk | 5→2 | 0→0 | 0→0 | 0→0 | 0→0 |
| 2 | fire | 2→4 | 0→16 | 0→0 | 0→220 | 0→404 |
| 2 | gib | 4→4 | 16→17 | 0→0 | 220→8 | 404→260 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
