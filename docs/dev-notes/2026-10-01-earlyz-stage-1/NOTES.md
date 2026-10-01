# Early-Z stage 1 — results of record (2026-10-01)

Plan: `docs/superpowers/plans/2026-10-01-sdf-march-early-z-stage-1.md` · Spec: `docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md`

## Baselines (before Task 1)

Recorded at base commit `c484305c` (clean tree, branch `claude/sdf-rendering-dream-techniques-f29768`), no stage-1 code yet.

- `npm test -- march-golden crowd-type game-context`: 5 files, 49 tests — **48 passed, 1 failed (pre-existing)**.
  - `march-golden.test.ts` 2/2 pass
  - `crowd-type.test.ts` 11/11 pass
  - `game-context.test.ts` 3/3 pass
  - `scripts/game-context-codemod.test.ts` 29/29 pass
  - `scripts/game-context-coverage.test.ts` 3/4 pass. **Pre-existing failure, not caused by this plan:**
    `binding maps > leaves ctx as the only state binding in main()` expects `['ctx']` and gets
    `['ctx', 'actorFill', 'fleshSpawnRng']`. Both bindings are already in committed `game-main.ts`
    (`const actorFill = new WeakMap(...)` ~L2627, `const fleshSpawnRng = mulberry32(...)` ~L5408). Later tasks
    must hold this at exactly this one failure with exactly these two extra names, and must not add a third.
- `node scripts/march-hash.mjs` (default mode, run inside `lab-servers`, load average 2.9 at start): **PASS**, exit 0, first run.
  The script prints no PASS word. It calls `fail()` and exits non-zero on any mismatch, so exit 0 with `room1`
  equal to the pinned `DEFAULT_HASH` is the pass.

  ```
  {"room1":"d7392d5234c98ddc1babb3b29860abc3a02ced84","room1-repeat":"d7392d5234c98ddc1babb3b29860abc3a02ced84","room1-wounded":"76bd51aa6eb281297999463529a0b782ce2b67f6"}
  ```
