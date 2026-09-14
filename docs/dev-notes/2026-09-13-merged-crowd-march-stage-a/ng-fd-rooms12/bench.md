
## INCOMPLETE RUN — 0 leg-run(s) failed, 1 aborted, 3 completed

Failed runs are ABSENT from every table below, so a leg may have fewer
repeats than the header claims, or be missing entirely. Do not read a
delta across a leg listed here without re-running it.

| rep | leg | room | mode | phase | error |
| ---: | --- | ---: | --- | --- | --- |

Aborted legs (probe frame p50 over BENCH_FRAME_CAP_MS, or the probe
timed out) — the real run was SKIPPED to protect the GPU:

| rep | leg | room | aborted | probe p50 ms | reason |
| ---: | --- | ---: | --- | ---: | --- |
| 0 | baseline | 1 | frame-cap | n/a | probe evaluate failed after 30 s: CDP Runtime.evaluate (id 17) never answered in 60s — rep0 baseline/room1/passes [probe] params: {"expression":"__sdfGame.bench({ room: 1, mode: \"passes\", warmup: 4, |

## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 2 | 2 | 36.50 | 34.59 | 35.40 | 39.56 | 49.91 |
| crowd-quad | 1 | 1 | 15.12 | 15.58 | 16.09 | 14.47 | 23.92 |
| crowd-quad | 2 | 2 | 71.72 | 38.66 | 71.72 | 85.45 | 92.72 |

## Crowd census — per type (visible / meanDistance m / rectFrac / clampedTiles)

`meanDistance` is the mean camera-to-body-centre distance over the DRAWN
instances of the last sync (crowd-type info()). The distance scene reads it
as its scene descriptor: a distant crowd should sit well above the 1-2 m of
a close-up stack, and `rectFrac` says how much screen the quad covered.

| leg | room | type | visible | meanDistance | rectFrac | clampedTiles |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 2 | (per-body) | - | - | - | - |
| crowd-quad | 1 | soldier@1 | 1 | 6.10 | 0.09 | 0 |
| crowd-quad | 1 | zombie@2 | 1 | 7.38 | 0.05 | 0 |
| crowd-quad | 1 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@4 | 2 | 10.66 | 0.04 | 0 |
| crowd-quad | 1 | soldier@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 1 | zombie@5 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | soldier@1 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | zombie@2 | 2 | 2.48 | 1.00 | 0 |
| crowd-quad | 2 | zombie@3 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | zombie@4 | 0 | 0.00 | 0.00 | 0 |
| crowd-quad | 2 | soldier@5 | 2 | 9.22 | 0.09 | 0 |
| crowd-quad | 2 | zombie@5 | 2 | 5.47 | 0.98 | 0 |

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
| 1 | walk | 3→4 | 16→16 | 0→0 | 6→6 | 258→258 |
| 1 | fire | 4→4 | 16→16 | 0→0 | 6→139 | 258→359 |
| 1 | gib | 4→4 | 16→16 | 0→0 | 139→3 | 359→257 |
| 2 | walk | 6→6 | 16→16 | 0→0 | 7→6 | 259→258 |
| 2 | fire | 6→7 | 16→24 | 0→0 | 6→165 | 258→357 |
| 2 | gib | 7→7 | 24→25 | 0→0 | 165→18 | 357→268 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
