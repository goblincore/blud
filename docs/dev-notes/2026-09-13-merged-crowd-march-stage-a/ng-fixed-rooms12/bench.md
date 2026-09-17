
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 60.15 | 44.10 | 78.96 | 60.15 | 93.69 |
| baseline | 2 | 2 | 36.81 | 33.79 | 35.44 | 40.91 | 51.56 |
| crowd-quad | 1 | 1 | 14.76 | 15.01 | 14.65 | 14.52 | 20.87 |
| crowd-quad | 2 | 2 | 38.03 | 36.69 | 52.39 | 12.72 | 59.06 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 1 | (per-body) | - | - | - | - |
| baseline | 2 | (per-body) | - | - | - | - |
| crowd-quad | 1 | soldier@1 | 1 | 5.35 | 0.13 | 0 |
| crowd-quad | 1 | zombie@2 | 1 | 7.51 | 0.06 | 0 |
| crowd-quad | 1 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@4 | 2 | 10.81 | 0.04 | 0 |
| crowd-quad | 1 | soldier@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | soldier@1 | 1 | 3.17 | 0.33 | 0 |
| crowd-quad | 2 | zombie@2 | 1 | 1.37 | 1.00 | 0 |
| crowd-quad | 2 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | zombie@4 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | soldier@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | zombie@5 | 0 | 0.00 | 0.00 | 0 |

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
