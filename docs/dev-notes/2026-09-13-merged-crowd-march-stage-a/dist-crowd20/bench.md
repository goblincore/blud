
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 62.75 | 61.66 | 63.91 | 66.44 | 93.90 |
| crowd-quad | 1 | 1 | 35.17 | 35.19 | 34.96 | 35.81 | 67.65 |
| baseline-s05 | 1 | 1 | 20.23 | 20.54 | 18.98 | 20.74 | 63.91 |
| crowd-quad-s05 | 1 | 1 | 18.72 | 18.59 | 18.27 | 19.24 | 55.72 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 1 | (per-body) | - | - | - | - |
| crowd-quad | 1 | soldier | 1 | 5.53 | 0.14 | 0 |
| crowd-quad | 1 | zombie | 20 | 6.31 | 0.49 | 0 |
| baseline-s05 | 1 | (per-body) | - | - | - | - |
| crowd-quad-s05 | 1 | soldier | 1 | 5.45 | 0.17 | 0 |
| crowd-quad-s05 | 1 | zombie | 20 | 6.31 | 0.52 | 3 |

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
| 1 | walk | 23→23 | 0→0 | 0→0 | 0→0 | 0→0 |
| 1 | fire | 23→23 | 0→10 | 0→0 | 0→129 | 0→349 |
| 1 | gib | 23→23 | 10→11 | 0→0 | 129→17 | 349→267 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
