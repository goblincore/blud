# Post-spanning bench baseline — and why the old numbers were never comparable

**Date:** 2026-09-01 · **Ran:** `scripts/dungeon-bench.sh`, room 4, 3 repeats,
legs alternating. Raw: `baseline-post-spanning.json`.

## Why this was run

The dungeon relight checkpoint left the bench as an open question: shadow-hull
spanning (`f08d30d`) took shadow instances from 30 to 51 per body, and a
one-off HUD read afterwards showed 54.4 ms against the 21–27 ms the committed
baseline recorded. That reading was never reproduced or trusted. The committed
baseline (`dda2011`, 15:14) **predates** the spanning commit (`f08d30d`,
16:13), so nothing measured the shipped state.

## Result

| leg | pre-spanning p50 | post-spanning p50 | delta |
| --- | ---: | ---: | ---: |
| dungeon-off | 18.84 | 11.15 | −40.8% |
| dungeon-no-shadow | 21.46 | 11.81 | −45.0% |
| dungeon-shadow | 21.36 | 11.80 | −44.8% |

Shadow gate: **+0.1%**, passes (limit +40%). Per-leg spread across repeats is
now 5–11%, down from 14–16%.

**The 54.4 ms reading is not reproduced.** Nothing here shows a regression from
spanning.

## The finding that matters more than the numbers

**Do not read the −45% as a speedup from spanning.** `dungeon-off` runs the
gallery rig with no flashlight and no shadows — spanning cannot touch it — and
it dropped 40.8%, essentially the same as the two shadow legs. A change that
only affects shadow casting cannot speed up the leg that casts none. The drop
is environmental (machine load at the time of the earlier run; the relight
dispatch agents were active around then), not attributable to any commit.

The census also differs between runs — the earlier run carried 8 bodies through
the fire segment, this one 5 — so the workloads were not even equal.

### Consequence for any future cost gate

**This bench's absolute numbers are not comparable across runs.** Only the
leg-to-leg deltas *within a single run* are meaningful, because the legs
alternate inside one process on one machine state.

So a cost gate must never compare a fresh measurement against a stored
baseline. It must add its condition as **another alternating leg inside one
run**. For the wound pass (`docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md`
§4 gate 7) that means one run with legs: no wounds / wounds without bone /
wounds with bone — not a run before and a run after.

This also retroactively explains why the goo fire-segment delta is still
recorded as UNRESOLVED at ±0.1–0.25 ms: it was chasing an effect an order of
magnitude below this bench's cross-run drift.
