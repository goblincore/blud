# Character-view refactor — pixel baseline (2026-09-06)

The before-state for the [shared character view
refactor](../../superpowers/plans/2026-09-06-shared-character-view.md).

## The gate

```bash
scripts/refactor-baseline.sh /tmp/after-task-N
diff docs/dev-notes/2026-09-06-refactor-baselines/MANIFEST /tmp/after-task-N/MANIFEST
```

Empty diff = pass. A non-empty diff names the exact view that moved.

**One sanctioned exception:** plan Task 4, where the lab converges onto the
game's damage path and its wound behaviour legitimately changes. That step
records a NEW baseline instead of comparing, and is gated by the owner's eyes.

## Determinism — measured, not assumed

Three captures across three fresh page loads, plus a fourth from a separate
vite+Chrome lifecycle, all produced
`77d1659dac5c48c321f655dc8b0e7321182ea9b11ddd1abc3a97644432f489ce` for the
`crowd6` view.

If a run ever yields two hashes for the same code, this property has broken:
**stop and report** rather than loosening the comparison.

## Views

Five, so a regression confined to one camera cannot hide. The five hashes are
all distinct, which is what makes the baseline discriminating.

| label | crowd | yaw | pitch | dist |
| --- | --- | --- | --- | --- |
| solo-front | 0 | 0.6 | 0.12 | 2.4 |
| solo-side | 0 | 1.9 | 0.10 | 2.4 |
| solo-close | 0 | 0.6 | 0.30 | 1.4 |
| crowd6 | 6 | 0.6 | 0.12 | 2.4 |
| crowd6-wide | 6 | 0.6 | 0.05 | 4.0 |

## Trap

`crowd-capture.mjs` writes its PNG, prints its JSON, then **never exits** — a
live CDP WebSocket keeps node's event loop alive. Any loop over it hangs on the
first iteration, looking exactly like a slow capture. The result is complete
before the hang, so a per-run `timeout` is the correct harness and **`rc=124`
is the success path**.

## Game gates (added 2026-09-06, after the slug fix)

`GAME-GATES` records the four `sdf-game-*-gate.mjs` verdicts. Re-run with:

```bash
scripts/game-gate-baseline.sh /tmp/after-task-N
diff docs/dev-notes/2026-09-06-refactor-baselines/GAME-GATES /tmp/after-task-N/VERDICTS
```

**These are THRESHOLD gates, not hash gates.** Unlike the lab captures, the
game is not reproducible byte-for-byte across runs — bodies wander, so a
target's position differs run to run (measured: `-4.67,-4.85` vs
`-4.79,-4.81` on two runs of identical code). **Compare the verdicts, never
the numbers.**

Why this exists: every task in the plan says "the four game gates unmoved",
but "unmoved from what" was never recorded — so the first failure (slug) was
unattributable and cost a checkout of the previous commit plus a full re-run
to learn it had been red all along.

**The bleed gate rewrites tracked files.** It re-captures its evidence PNGs
into `docs/dev-notes/2026-08-31-bleeding-wounds/` on every run, leaving ten
modified files. `game-gate-baseline.sh` restores them; if you run that gate by
hand, `git checkout --` that directory or you will commit them by accident.

Argument shapes differ per gate and are NOT interchangeable — `bleed` takes a
MODE first (`parity|reel|bench`); passing it a port yields "unknown mode".

## The bleed gate is FLAKY — do not trust a single run (measured 2026-09-06)

`sdf-game-bleed-gate.mjs parity` derives its pass threshold per-run from two
same-state captures ("the floor") and fails when the toggle cycle exceeds it.
Both numbers are wildly unstable. Four runs on **byte-identical code**:

| run | floor | toggle | verdict |
| --- | --- | --- | --- |
| a | 137,230 | 203,845 | FAIL |
| b | 141,188 | 37,056 | PASS |
| c | 191,299 | 164,484 | PASS |
| d | 152,940 | 118,812 | PASS |

The toggle measurement swings **5.5x** and the floor **40%**. Worse, in run (a)
the gate's own two control cycles — both measuring the same state with **no
toggle** — differed 4x (137,230 vs 32,559), and it takes the max, so the
threshold is set by whichever control happened to be noisiest.

**A single FAIL from this gate is not evidence of a regression.** Re-run it at
least three times before believing it. It also passes on `maxChannelDelta`
while failing on raw pixel count, which is a further sign the pixel-count axis
is the unreliable one.

Worth fixing properly (more control samples, or gate on `maxChannelDelta`), but
that is its own change — not something to do inside a refactor.
