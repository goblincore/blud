
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 3 | 36.39 | 30.92 | 36.69 | 38.87 | 60.84 |
| baseline | 4 | 4 | 28.72 | 25.60 | 29.53 | 31.71 | 64.05 |
| wound-list-on | 3 | 3 | 35.75 | 27.20 | 36.35 | 42.04 | 61.79 |
| wound-list-on | 4 | 4 | 43.23 | 28.30 | 44.86 | 52.78 | 71.12 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 3 | 19.55 / 39.09 / 36.39 | 19.54 | 100% |
| baseline | 4 | 28.72 / 40.84 / 26.58 | 14.26 | 54% |
| wound-list-on | 3 | 35.53 / 38.55 / 35.75 | 3.02 | 8% |
| wound-list-on | 4 | 45.55 / 43.23 / 39.58 | 5.97 | 15% |

**Worst repeat spread: 100%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | walk | 10→7 | 0→0 | 0→0 | 0→0 | 0→0 |
| 3 | fire | 7→6 | 0→16 | 0→1 | 0→310 | 0→424 |
| 3 | gib | 6→2 | 16→17 | 1→0 | 310→14 | 424→264 |
| 4 | walk | 7→4 | 0→0 | 0→0 | 0→0 | 0→0 |
| 4 | fire | 4→3 | 0→16 | 0→0 | 0→61 | 0→288 |
| 4 | gib | 3→2 | 16→18 | 0→1 | 61→134 | 288→310 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
