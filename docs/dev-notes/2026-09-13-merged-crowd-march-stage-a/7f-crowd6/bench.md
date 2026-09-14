
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
| 0 | crowd-on-tiles-off | 1 | frame-cap | n/a | probe evaluate failed after 30 s: CDP Runtime.evaluate (id 48) never answered in 60s — rep0 crowd-on-tiles-off/room1/passes [probe] params: {"expression":"__sdfGame.bench({ room: 1, mode: \"passes\",  |

## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 82.46 | 72.86 | 83.41 | 85.33 | 105.96 |
| crowd-on | 1 | 1 | 89.47 | 90.24 | 138.70 | 83.89 | 155.67 |

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
| 1 | walk | 12→11 | 16→16 | 0→0 | 6→6 | 258→258 |
| 1 | fire | 11→11 | 16→32 | 0→0 | 6→226 | 258→410 |
| 1 | gib | 11→9 | 32→33 | 0→0 | 226→16 | 410→266 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
