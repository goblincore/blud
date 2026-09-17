
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 56.45 | 42.88 | 74.23 | 56.45 | 85.34 |
| baseline | 2 | 2 | 43.36 | 38.44 | 42.70 | 46.55 | 58.70 |
| crowd-on | 1 | 1 | 68.46 | 64.99 | 94.09 | 67.82 | 138.64 |
| crowd-on | 2 | 2 | 79.09 | 43.00 | 79.09 | 137.98 | 157.64 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |

**Worst repeat spread: 0%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | walk | 6→6 | 17→17 | 0→0 | 40→30 | 274→270 |
| 1 | fire | 6→6 | 17→17 | 0→2 | 30→491 | 270→548 |
| 1 | gib | 6→4 | 17→17 | 2→0 | 491→93 | 548→301 |
| 2 | walk | 6→6 | 16→16 | 0→0 | 7→6 | 259→258 |
| 2 | fire | 6→7 | 16→24 | 0→0 | 6→165 | 258→357 |
| 2 | gib | 7→7 | 24→25 | 0→0 | 165→18 | 357→268 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
