
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 28.26 | 28.19 | 30.06 | 28.07 | 39.86 |
| crowd-quad | 1 | 1 | 16.16 | 16.41 | 16.12 | 15.18 | 26.14 |
| baseline-s05 | 1 | 1 | 12.09 | 12.25 | 12.51 | 11.41 | 23.81 |
| crowd-quad-s05 | 1 | 1 | 10.94 | 10.75 | 11.61 | 10.94 | 20.57 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 1 | (per-body) | - | - | - | - |
| crowd-quad | 1 | soldier | 1 | 5.67 | 0.13 | 0 |
| crowd-quad | 1 | zombie | 8 | 6.12 | 0.27 | 0 |
| baseline-s05 | 1 | (per-body) | - | - | - | - |
| crowd-quad-s05 | 1 | soldier | 1 | 5.57 | 0.17 | 0 |
| crowd-quad-s05 | 1 | zombie | 8 | 6.12 | 0.32 | 0 |

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
| 1 | walk | 11→11 | 0→0 | 0→0 | 0→0 | 0→0 |
| 1 | fire | 11→11 | 0→15 | 0→0 | 0→124 | 0→344 |
| 1 | gib | 11→11 | 15→16 | 0→0 | 124→16 | 344→266 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
