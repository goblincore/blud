
## INCOMPLETE RUN — 0 leg-run(s) failed, 1 aborted, 2 completed

Failed runs are ABSENT from every table below, so a leg may have fewer
repeats than the header claims, or be missing entirely. Do not read a
delta across a leg listed here without re-running it.

| rep | leg | room | mode | phase | error |
| ---: | --- | ---: | --- | --- | --- |

Aborted legs (probe frame p50 over BENCH_FRAME_CAP_MS, or the probe
timed out) — the real run was SKIPPED to protect the GPU:

| rep | leg | room | aborted | probe p50 ms | reason |
| ---: | --- | ---: | --- | ---: | --- |
| 0 | crowd-boxes | 1 | frame-cap | n/a | probe evaluate failed after 30 s: CDP Runtime.evaluate (id 50) never answered in 60s — rep0 crowd-boxes/room1/passes [probe] params: {"expression":"__sdfGame.bench({ room: 1, mode: \"passes\", warmup: |

## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 190.23 | 153.91 | 214.08 | 190.23 | 242.23 |
| crowd-quad | 1 | 1 | 102.41 | 103.73 | 115.68 | 100.66 | 173.48 |

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
| 1 | walk | 17→16 | 17→17 | 0→0 | 31→26 | 267→266 |
| 1 | fire | 16→15 | 17→33 | 0→0 | 26→141 | 266→349 |
| 1 | gib | 15→15 | 33→33 | 0→0 | 141→7 | 349→258 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
