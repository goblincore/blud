
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 66.52 | 70.31 | 66.15 | 64.20 | 97.94 |
| crowd-quad | 1 | 1 | 36.42 | 36.08 | 36.77 | 36.42 | 55.64 |
| baseline-s05 | 1 | 1 | 21.05 | 21.11 | 21.07 | 21.03 | 40.50 |
| crowd-quad-s05 | 1 | 1 | 19.28 | 18.64 | 19.48 | 19.46 | 38.97 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 1 | (per-body) | - | - | - | - |
| crowd-quad | 1 | soldier | 1 | 5.49 | 0.13 | 0 |
| crowd-quad | 1 | zombie | 24 | 6.38 | 0.50 | 0 |
| baseline-s05 | 1 | (per-body) | - | - | - | - |
| crowd-quad-s05 | 1 | soldier | 1 | 5.65 | 0.17 | 0 |
| crowd-quad-s05 | 1 | zombie | 24 | 6.38 | 0.53 | 90 |

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
| 1 | walk | 27→27 | 0→0 | 0→0 | 0→0 | 0→0 |
| 1 | fire | 27→27 | 0→9 | 0→0 | 0→124 | 0→344 |
| 1 | gib | 27→27 | 9→10 | 0→0 | 124→15 | 344→265 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
