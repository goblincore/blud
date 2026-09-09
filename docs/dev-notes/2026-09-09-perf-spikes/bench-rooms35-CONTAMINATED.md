
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 3 | 45.26 | 33.88 | 46.02 | 49.69 | 71.21 |
| baseline | 5 | 5 | 59.56 | 60.10 | 64.14 | 51.46 | 120.02 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| baseline | 3 | 45.26 / 40.96 | 4.30 | 10% |
| baseline | 5 | 42.79 / 59.56 | 16.77 | 39% |

**Worst repeat spread: 39%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | walk | 8→8 | 0→0 | 0→0 | 0→0 | 0→0 |
| 3 | fire | 8→10 | 0→16 | 0→0 | 0→66 | 0→289 |
| 3 | gib | 10→10 | 16→16 | 0→0 | 66→0 | 289→256 |
| 5 | walk | 8→8 | 0→0 | 0→0 | 0→0 | 0→0 |
| 5 | fire | 8→4 | 0→16 | 0→0 | 0→198 | 0→382 |
| 5 | gib | 4→8 | 16→18 | 0→1 | 198→134 | 382→312 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 3 | 3 | 120.60 | 184.50 | 492.10 | 4.1x | fire (492.1 ms) |
| 5 | 5 | 63.70 | 95.10 | 335.40 | 5.3x | fire (335.4 ms) |
