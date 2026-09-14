
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 2 | 2 | 55.87 | 33.41 | 55.87 | 64.98 | 74.02 |
| crowd-off | 2 | 2 | 39.54 | 36.72 | 39.10 | 45.51 | 53.65 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 2 | soldier@1 | 0 | 0.00 | 0.00 | 0 |
| baseline | 2 | zombie@2 | 2 | 2.31 | 1.00 | 0 |
| baseline | 2 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| baseline | 2 | zombie@4 | 0 | 0.00 | 0.00 | 0 |
| baseline | 2 | soldier@5 | 2 | 5.88 | 0.68 | 0 |
| baseline | 2 | zombie@5 | 2 | 4.76 | 1.00 | 0 |
| crowd-off | 2 | (per-body) | - | - | - | - |

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
| 2 | walk | 6→6 | 17→17 | 0→0 | 21→14 | 264→260 |
| 2 | fire | 6→6 | 17→17 | 0→0 | 14→28 | 260→268 |
| 2 | gib | 6→6 | 17→18 | 0→0 | 28→11 | 268→261 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
