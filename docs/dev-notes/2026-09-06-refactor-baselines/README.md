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
