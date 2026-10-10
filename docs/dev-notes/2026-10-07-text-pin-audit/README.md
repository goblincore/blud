# Text-pin audit (2026-10-07)

A "text pin" is a test that reads a source code file as a string and asserts on
its text (`expect(src).toContain('some line')`, `indexOf(a) < indexOf(b)`).
Six of them broke in one day of moving code that changed no behaviour, so all
38 test files that read code this way were audited: 834 assertions.

| Verdict | Assertions | What was done |
| --- | --- | --- |
| RESTATES (only says a line exists) | 458 | deleted |
| COVERED (a behavioural test already asserts it) | 22 | deleted |
| STALE | 25 | deleted, except the three below |
| KEEP (guards a real ordering or wiring hazard, no seam) | 120 | kept |
| CONVERT (a behavioural test would be cheap) | 209 | kept as they are; converting is open work |

Removed: 94 `it` blocks and 488 assertions across 23 test files (969 lines). The
suite went from 8,425 to 8,331 tests. No source file changed.

Held back on purpose:
- `gib-shutter-layer.test.ts` (the game-main half of the deferred prewarm
  block) and `march-private-seed-guard.test.ts`: judged stale only because the
  deferred renderer is paused. Paused is not removed.
- `zombie-gpu-burn.test.ts`, the key-order block: its stale verdict says three
  r186 binds `wgslFn` object parameters by name, which contradicts the "bound
  POSITIONALLY" comments in `zombie-gpu.ts`. Settle that first.

The per-file tables are in `batch-1.md` to `batch-4.md`. Their line numbers are
from before the deletions.

## Open: the CONVERT rows

The three largest, each with an existing harness to build on:
- `goo-layer.test.ts` (about 70 assertions): `goo-upload.test.ts` already runs
  the real `createGooLayer` on a stub renderer.
- `earlyz/seed-pass.test.ts` (70): `sdf-layer.test.ts` drives the real
  `createSdfLayer(...).render()` on a fake renderer. Not verified that it can
  host the seed mesh.
- `dynamite-panel.test.ts`: `applyDynamiteTuning(ctx, patch)` and
  `dynamiteTuningValues(ctx)` are exported and take a context; a round trip
  over `DYNAMITE_KEYS` replaces both pins.

## Rule from here

Do not add a text pin where a behavioural test is possible. When one is the
only option (boot or draw order inside `main()`), say in the test what breaks
if the order changes.
