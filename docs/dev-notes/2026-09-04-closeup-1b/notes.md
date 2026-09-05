# Close-up task 1b — the staging library, Question A, and the exit bound

**Date:** 2026-09-04 · **Branch:** `dispatch/2026-09-04-closeup-task-1b`
**Status:** done · **Base:** main `ea7d989` (task 1 merged as `8da0bdd`)

## What this task was

Task 1 (120 m cap) answered Question B — the three-r185 distance decay was
scene fog — and built the close-up harness, but died mid-Question-A with
spreads blown out and pages crashing under machine load. Task 1b's job:

1. Extract the harness into a library every remaining close-up task imports.
2. Answer Question A with the stability problem taken seriously.
3. Re-take the `GAME_HULL_EXIT_BOUND` census (fog fix unblocked it) and
   decide the flip.

## Step 1 — the library (`scripts/lib/sdf-closeup-stage.mjs`)

`connectGame` (tab + CDP + exit-time tab close), `bootCloseupPage` (fresh
page per run), `applyShipDefaults` (the explicit fourteen-lever pin),
`stageCloseUp` (ladder search keeping the BEST coverage rung),
`stampFacingWounds` (the three loud assertions), `runInterleaved` (rotation +
fresh page + stable mode). The bench is a thin caller.

**Proof is by diff, not by reading.** The pre-extraction script (with an
output-only staging-record dump) ran twice: staging records byte-identical
across independent boots (`d 0.6, cov 0.15426666666666666, body 1` on all
four legs — the frozen scene is deterministic). The extracted-library bench
ran twice more: byte-identical again, pre vs post. Row-level residuals (the
wounded legs' coverage in the 5th decimal) are GPU readback jitter of the
same class as the two pre-extraction boots differ from each other.

**Smoke test:** `stageCloseUp` needs a live WebGPU page — it cannot run in
vitest, so no test asserts it. The GPU-free decision code IS tested
(`interleaveOrder`, `passesLoadGate` — 7/7).

## Step 2 — Question A

Legs: normal (wounded+shading) / flat (wounded, flat albedo) / normal0
(clean+shading) / flat0 (clean+flat) — the four-way that separates the walk,
the shading chain, and the wound add-on. Ship defaults pinned; frozen boot;
spillChance 0.

**Stability machinery (all counted, never silent):**
- Load gate: a row is rejected when 1-min loadavg rose > 8 above its own
  leg-start sample or exceeds 24 absolute; rejected rows re-run in makeup
  reps. Final run: **16 load rejections, 3 makeup reps** — the machine (an
  unrelated agent session's `du`/vitest churn) spiked to load 146–184
  mid-run and every spike is visible as a rejection, not smeared into a mean.
- Crash retry: capped in-place re-connect + reload + re-stage. One whole run
  was LOST to a driver bug this exposed: a page crash closed the websocket
  and pending sends pended forever — node exited "unsettled top-level await"
  with no FAIL. Fixed: pending sends reject on ws close/error, routing the
  death through the retry path. (crashRetries 0 in the final run.)
- Interleave + median per leg; per-row load quoted.

**The environment verdict is part of the result:** at loadavg 12–30 the
`flat`/`flat0` legs were intermittently 50–100% inflated while `normal0` in
the same rep read quiet — loadavg cannot see churn phase, and one poisoned
row (flat 109.9 vs normal 45.8, physically impossible ordering) passed the
gate. So the certificate comes from the two GENUINELY quiet windows (rep6,
rep7: load 5–9, physically sane ordering in all four legs):

| leg | rep6 | rep7 | combined median |
|---|---|---|---|
| normal (wounded, shading) | 52.12 | 38.55 | 45.33 |
| flat (wounded, walk only) | 33.18 | 30.33 | 31.76 |
| normal0 (clean, shading) | 14.57 | 16.04 | 15.31 |
| flat0 (clean, walk only) | 12.77 | 13.44 | 13.11 |

**Question A's answer (as % of the wounded fill-screen frame):**

| component | value | window range |
|---|---|---|
| clean walk (flat0/N) | 28.9% | 24.5–34.9% |
| **wound walk** (wound shadow + wound fold near craters) | **41.1%** | **39.2–43.8%** |
| post-hit shading chain (normal−flat)/N | 30.0% | 21.3–36.3% |
| shading on the clean body alone | 4.9% | 3.5–6.7% |
| wound total add-on (normal−normal0)/N | 66.2% | 58.4–72.0% |

Honest caveat: n = 2 clean windows out of ~10 attempts; the ranges above ARE
the uncertainty. But the ordering is physically consistent in both windows,
the counters (steps/hit 7.3 wounded vs 6.9 clean; missStepShare ~0.49) agree,
and the largest component is stable to ±2.3 points.

**What it means for tasks 2 and 3:** the program is NOT aimed at the wrong
half — but the split inside the right half inverts the assumed priorities:

- The single largest identifiable cost is the **wound-adjacent walk** (~41%,
  the most stable number in the table): the wound shadow's up-to-14 evals and
  the wound fold, concentrated near craters. The spec files this under
  "walk", and lever 3's wound early-out measured ≈0 — nobody is attacking the
  biggest column.
- The post-hit shading chain (lever 2's probes) attacks ~30% — real, second.
- The clean walk is ~29%, already harvested ~40% by perf r2.
- Clean-body shading is noise (5%). Screen-space normals alone would recover
  at most a third of the shading column, not a third of the frame.

Task 3's depth prepass and any wound-shadow work must be measured on the
WOUNDED fill-screen staging — `stageCloseUp` + `stampFacingWounds` is that
scene, which is exactly why the library exists.

## Step 3 — `GAME_HULL_EXIT_BOUND` re-census and flip

`scripts/sdf-exit-bound-census.mjs`: per view, occupancy triple
(off → on → off) + decoded off/on/off2 screenshot pairs. Views: room 1 at
0.5 / 3 / 9 m, rooms 3/4 in bench-style standoff (4 m beyond the group,
facing it). **Census CLEAN at every view**: hits / rasterised /
meanStepsHit bit-identical on/off (including both multi-body rooms —
historically the deletion site), state-clean (off2 == off1), pixel diffs
0.005–0.013% at/below each view's own noise floor. The step win survives:
**missStepShare 0.58 → 0.46** (room-4 standoff; 0.44–0.60 → 0.30–0.46 across
views), meanStepsHit unchanged, deterministic across reps.

Timing A/B (`sdf-exit-bound-ab.mjs`, room-4 standoff, interleaved, same load
gate): bound-off p50 19.33 [17.28..24.28] spread 40.5%, bound-on p50 20.73
[19.14..21.20] spread 10.8% — unresolvable at that night's load; the flip
rests on exactness (bit-identical hit sets) + counters + r2's timed −0.28 ms,
not on this A/B.

**`GAME_HULL_EXIT_BOUND` SHIPS 1** (`6a514a0`). Boot binding verified
in-page; tsc 0; vitest src/lab 2457/2457.

### Two instrument findings recorded en route

1. **`hashMarchTarget` is not a live-frame parity hash.** Outside a
   debug-mode render the march target is not refreshed by the running loop —
   the hash read a stale frame (constant `c1b031c5` across different staged
   views), and calling it was observed to leave the NEXT occupancy read
   all-miss. Only valid immediately after a debug-mode render (as
   texRoundTrip uses it).
2. **The bare `teleport` seam blinds the occupancy readback.** It drops the
   player at the room centre — inside the frozen spawn cluster — where every
   hit pixel is also covered by a nearer body's box whose rays miss; mode 4
   gives the readback to the nearest write (the depth-winner bias documented
   in march.wgsl.ts's occupancy block). Measured: hits 0 / rasterised 39725
   with bodies plainly on screen; the same scene from the 4 m standoff reads
   hits 13940. Anyone censing a clustered crowd must stand off first.

## Verdicts

1. Library: EXISTS (`scripts/lib/sdf-closeup-stage.mjs`), proven
   behaviour-preserving by byte-diff, smoke-tested on the GPU-free seams.
2. Question A: RESOLVED at decision grade with honest error bars — shading
   ~30%, wound walk ~41%, clean walk ~29%; wound total ~66%. Task 2 keeps its
   target; the wound-shadow walk is the bigger, un-attacked column and
   belongs in task 2's scope or a new task.
3. Exit bound: census clean, counters win, **flipped to 1**.
