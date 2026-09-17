# Cone pre-pass A/B — does not reproduce, do not ship

**2026-09-10.** Closing the backlog's "cone pre-pass" item with a direct A/B on
the current ship config.

```
BENCH_LEGS=baseline,cone-on BENCH_ROOMS=3,4 BENCH_REPEATS=3 BENCH_PASSES=1
BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'
```
Artifacts: `/tmp/sdf-bench-cone/` (also `cone-ab-passes.md` beside this note).

## The decision: DO NOT SHIP, and the −22% is stale

| | room 3 | room 4 |
| --- | ---: | ---: |
| `sdf:march`, baseline | 6.68 | 8.75 |
| `sdf:march`, cone-on | **8.18** | **9.13** |
| `sdf:cone` (its own new pass) | 0.68 | 0.61 |

The march is **higher** with the cone on, not lower, and the cone adds ~0.6 ms
of pass time of its own. There is no win to find here.

**This run is CONTAMINATED** — worst repeat spread **116%**, and the `cone-on`
leg is worse than noisy, it is structurally broken: `gpu:idle` reports
**15–16 ms, 49–50% of its labelled total**, and the harness's gap goes
**negative (−12.2 to −12.3 ms)**, i.e. the leg spent most of its frame with the
GPU waiting on the CPU. Round 1's cone-on leg showed the same signature
(`gpu:idle` 18–20 ms, gap −18 ms). **That reproducibility across two separate
runs is itself the finding:** enabling the cone pre-pass costs a submission
stall, so on top of not helping it has a mechanism for hurting.

So the conclusion rests on three agreeing sources rather than on my own clean
measurement:

1. this A/B, in which the cone shows no march reduction even while the run is
   too noisy to price it;
2. `TASKS.md` `X1.14`, which measured the cone pre-pass at **0.4%**;
3. `TASKS.md` `X1.15` — "Occluder inner-hull pre-pass — LANDED, and it
   **SUPERSEDES the cone**".

The `−22% at 10 bodies` figure quoted in `sdf-layer.ts:220-238` and in
`TASKS.md:2552-2556` predates the occluder hull. It is stale doc-rot, and the
doc-rot audit already flagged it.

**Honest limit:** I could not produce a clean measurement of the cone myself.
Two attempts, both contaminated by other load on the machine. The "do not ship"
decision is well supported; the *magnitude* of the cone's cost is not something
I measured.

## Why the runs keep failing

Round 1: another agent + the harness GUI tab. Round 3: load 6.8–7.0 with a
second agent active, and repeat spread climbing to 116% on the later legs as
that load rose. The 2026-08-31 note's warning stands unchanged — read the
Repeatability section FIRST and judge each delta against its own legs' spread.
The one metric that survives contention is a **within-leg pass row**
(`compute:probe-gather` held 6.01–7.19 ms across five legs while frames swung
116%), which is why the gather result in
`../2026-09-10-probe-gather-cost/notes.md` is trustworthy and this one is not.
