
## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| crowd-off | 1 | 1 | 39.15 | 57.01 | 42.86 | 9.29 | 85.39 |
| crowd-quad | 1 | 1 | 45.35 | 52.63 | 50.06 | 8.82 | 90.94 |
| crowd-boxes | 1 | 1 | 43.37 | 50.47 | 47.24 | 8.93 | 82.17 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| crowd-off | 1 | (per-body) | - | - | - | - |
| crowd-quad | 1 | soldier@1 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@2 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@4 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | soldier@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-boxes | 1 | soldier@1 | 0 | 0.00 | 0.00 | 0 |
| crowd-boxes | 1 | zombie@2 | 0 | 0.00 | 0.00 | 0 |
| crowd-boxes | 1 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| crowd-boxes | 1 | zombie@4 | 0 | 0.00 | 0.00 | 0 |
| crowd-boxes | 1 | soldier@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-boxes | 1 | zombie@5 | 0 | 0.00 | 0.00 | 0 |

## Repeatability — READ THIS BEFORE ANY DELTA

Spread of the overall median across identical repeats. A leg whose
spread exceeds the delta you care about has not measured anything.
On 2026-08-31 three identical runs read 10.1 / 5.6 / 56.1 ms on a busy
machine, which is why this section exists.

| leg | room | reps (overall median ms) | spread | spread % of min |
| --- | ---: | --- | ---: | ---: |
| crowd-off | 1 | 39.15 / 38.38 | 0.77 | 2% |
| crowd-quad | 1 | 44.71 / 45.35 | 0.64 | 1% |
| crowd-boxes | 1 | 42.25 / 43.37 | 1.12 | 3% |

**Worst repeat spread: 3%.** Judge each delta
against ITS OWN legs' spread, not against this worst case — one noisy leg
does not invalidate a delta measured between two quiet ones. A delta smaller
than either leg's spread is UNRESOLVED, not zero.

## Census — what was ON SCREEN while those numbers were taken

A cost column is unreadable without this. Read `bodies` first: if it
falls through the run, the cheap segments were timing an empty room.

| room | segment | bodies in→out | wounds in→out | chunks in→out | droplets in→out | goo quads in→out |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | t0 | 3→8 | 7→7 | 0→0 | 0→0 | 256→256 |
| 1 | t1 | 8→7 | 7→23 | 0→0 | 0→0 | 256→256 |
| 1 | t2 | 7→0 | 23→23 | 0→0 | 0→0 | 256→256 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
