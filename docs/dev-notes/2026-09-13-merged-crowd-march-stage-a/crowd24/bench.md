
## INCOMPLETE RUN — 3 leg-run(s) failed, 1 completed

**The matrix was ABANDONED early: CDP socket closed (code 1006) — no browser left to bench.** Legs after the last
failure below were never attempted at all, so their absence is not a
measurement — it is a gap.

Failed runs are ABSENT from every table below, so a leg may have fewer
repeats than the header claims, or be missing entirely. Do not read a
delta across a leg listed here without re-running it.

| rep | leg | room | mode | phase | error |
| ---: | --- | ---: | --- | --- | --- |
| 0 | crowd-on | 1 | passes | bench | CDP Runtime.evaluate (id 34) never answered in 330s — rep0 crowd-on/room1/passes [bench] params: {"expression":"__sdfGame.bench({ room: 1, mode: \"passes\", warmup: 120, chunkFrames: 10, label: \"crow |
| 1 | baseline | 1 | passes | boot:wait-for-__sdfGame | game page never booted (__sdfGame absent after 120s) |
| 1 | crowd-on | 1 | passes | boot:wait-for-__sdfGame | CDP socket closed (code 1006) — refusing to send CDP Runtime.evaluate (rep1 crowd-on/room1/passes [boot:wait-for-__sdfGame]) |

## Throughput (chunked + fenced) — median chunk-mean ms, median of repeats

| leg | room | spawned | overall | walk | fire | gib | worst chunk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 1 | 234.67 | 225.32 | 262.17 | 234.09 | 336.04 |

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
| 1 | walk | 23→25 | 0→0 | 0→0 | 0→0 | 0→0 |
| 1 | fire | 25→25 | 0→16 | 0→0 | 0→82 | 0→303 |
| 1 | gib | 25→23 | 16→17 | 0→0 | 82→10 | 303→262 |

## Spike (fenced per frame, baseline only) — ratios within a run ONLY

| room | bodies | p50 | p95 | max | max/p50 | worst segment |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
