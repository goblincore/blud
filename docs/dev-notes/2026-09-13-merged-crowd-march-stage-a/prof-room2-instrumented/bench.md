
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 2 | 2 | 47.47 | 45.29 | 59.80 | 13.76 | 67.48 |
| crowd-off | 2 | 2 | 46.52 | 43.85 | 44.83 | 51.02 | 60.30 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 2 | soldier@1 | 1 | 3.14 | 0.34 | 0 |
| baseline | 2 | zombie@2 | 1 | 1.40 | 1.00 | 0 |
| baseline | 2 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| baseline | 2 | zombie@4 | 0 | 0.00 | 0.00 | 0 |
| baseline | 2 | soldier@5 | 0 | 0.00 | 0.00 | 0 |
| baseline | 2 | zombie@5 | 0 | 0.00 | 0.00 | 0 |
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
| 2 | walk | 6→6 | 16→16 | 0→0 | 5→6 | 258→258 |
| 2 | fire | 6→6 | 16→16 | 0→0 | 6→95 | 258→316 |
| 2 | gib | 6→2 | 16→17 | 0→0 | 95→8 | 316→258 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
