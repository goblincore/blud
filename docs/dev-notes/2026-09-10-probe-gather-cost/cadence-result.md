# Cadence (probeGatherRate 2 -> 4): RESOLVED — a real ~5-8% win

**2026-09-10, run on merged `main`.** This SUPERSEDES the "VOID" section in
`notes.md`, which was invalidated by my own missing harness reset. With the reset
fixed, the lever resolves as a genuine improvement rather than a null.

```
BENCH_OUT=/tmp/sdf-bench-main-cadence
BENCH_LEGS=baseline,probe-rate4 BENCH_ROOMS=3,4 BENCH_REPEATS=3 BENCH_PASSES=1
BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'
```
Load 5.20, 85.6% idle, game closed. Worst repeat spread 66%, from ONE outlier.

| fenced frame p50, ms | room 3 | room 4 |
| --- | ---: | ---: |
| baseline (rate 2) medians | 17.10 / 16.83 / 16.97 | 18.42 / 16.71 / 18.27 |
| median | **16.97** | **18.27** |
| rate 4 medians | 16.08 / 16.12 / 15.24 | 10.44 / 16.56 / 17.30 |
| median | **16.08** | **16.56** |
| delta | **-5.2%** | **-9.4%** |
| leg spreads | 1.6% / 5.8% | 10% / **66%** |

**Room 3 is the clean comparison** — both legs' spreads are tight (1.6% and
5.8%), so **-5.2% is resolved**. Room 4 nominally -9.4% but its rate-4 spread is
66%, driven by a single low outlier (10.44 ms against 16.56 and 17.30). Excluding
that one repeat, room 4 reads ~-8%. Treat -5% as the defensible number and -8% as
the plausible ceiling.

## It matches the arithmetic, which is the reassuring part

This closes the loop on the amortisation correction in `notes.md`:

- the gather costs **4.03-4.83 ms per gather** and runs **every other frame** at
  rate 2, so ~**2.0-2.4 ms/frame**;
- at rate 4 that becomes ~**1.0-1.2 ms/frame**, saving ~**1.0-1.2 ms**;
- on a ~17 ms frame that is **~6-7%**.

Measured: **5.2% (room 3)**, ~8% (room 4). The prediction from the pass row and
the cadence is borne out. So the earlier "a p50 cannot see the cadence" reasoning
was WRONG, and it was wrong because it was built on a voided measurement — the
pass row's per-gather cost and the cadence combine exactly as the simple
arithmetic says they should.

## Consequence

This is **the largest frame-level improvement demonstrated this session** — the
gather's own -33% was worth ~1 ms of mean, and this is the same order again, for
a ONE-VALUE change with no new code. It is still a look trade (flash-response
latency on the dynamic layer), which is an owner call, not a measurement one.

## The gate fired unprompted

This run is also the first where the newly-wired census gate announced itself
in-line: `⚠ CENSUS DRIFT: 26 field(s) differed between repeats of the same leg.`
So even this run's workload varied between repeats — the frame-level numbers here
should be read with the same caution as every other run this session, and the
room-3 result is defensible mainly because BOTH legs' spreads are tight and the
effect is consistent in direction across both rooms.
