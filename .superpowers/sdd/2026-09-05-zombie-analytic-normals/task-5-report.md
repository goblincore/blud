# Task 5 report — incomplete zombie analytic-normal verdict

Date: 2026-09-05. Base: `8637914`. Worktree: `/Users/donny/Projects/blud/.worktrees/zombie-analytic-normals`. Status: **INCOMPLETE**.

## Result

Task 5 took the required negative path. The driver now detects missing prerequisites before any CDP/browser setup, preserves the passed reference and GPU-kernel gates, marks wounds and dependent visual/timing work skipped by gate, keeps owner look pending, writes `summary.json`, and exits nonzero. No geometry, shader, gameplay or feature-default behavior changed.

The evidence remains: Task 1 passed at `dcca600`; Task 2 passed 11 real WebGPU kernel cases and its negative control produced 16 expected mismatches at `edeca69`; Task 3 has a default-off implementation and 233 focused Vitest + 2 Node tests plus prior tsc/syntax checks, but zero gameplay GPU samples. Its guarded launch attempts stopped before servers at load1 20.47, 27.25 and 25.78; an intermediate observation reached 83.79. Task 4 was correctly skipped because `intact` is deferred.

## Files

- `scripts/zombie-normal-gradient-check.mjs`
- `scripts/zombie-normal-gradient-check.test.mjs`
- `docs/dev-notes/2026-09-05-zombie-analytic-normals/gates.json`
- `docs/dev-notes/2026-09-05-zombie-analytic-normals/summary.json`
- `docs/dev-notes/2026-09-05-zombie-analytic-normals/verdict.md`
- `docs/dev-notes/2026-09-05-zombie-analytic-normals/notes.md`
- `docs/superpowers/specs/2026-09-05-zombie-analytic-normals-design.md`
- `TASKS.md`

## TDD and commands

RED:

```text
node --test scripts/zombie-normal-gradient-check.test.mjs
# exit 1 after the old verdict path attempted CDP; expected VERDICT INCOMPLETE but received "VERDICT FAIL: TypeError: fetch failed"
```

GREEN:

```text
node --test scripts/zombie-normal-gradient-check.test.mjs
# 1 test passed; exit 0
```

Tracked verdict generation:

```text
node scripts/zombie-normal-gradient-check.mjs --phase verdict --out docs/dev-notes/2026-09-05-zombie-analytic-normals --vite 5251 --cdp 9251
# exit 1 as required: VERDICT INCOMPLETE; no browser/GPU process opened
```

Final focused verification after all edits: the Node process test passed 1/1; `node --check scripts/zombie-normal-gradient-check.mjs` exited 0; both tracked JSON files parsed; and `git diff --check` exited 0. No full suite, browser, GPU run or redundant TypeScript check was performed.

## Gate state

- `reference: pass`
- `gpuKernel: pass`
- `intact: deferred`
- `wounds: skipped-by-gate`
- `visualEvidence: skipped-by-gate`
- `timing: skipped-by-gate`
- `ownerLook: pending`

`summary.json` uses `null` for unavailable timing and coverage measurements and has no images or reel. It reports conclusion `incomplete`; it contains no 0 ms or 0% substitutes.

## Unresolved work

Static review of Task 3 found that the intact driver needs anatomical ROI coverage instead of counting every camera-framed hit, staging failures must not call `process.exit` past cleanup, and the motion yaw sign must be corrected. The Task 3 implementer will address these after this commit; no reviewed source implementation was changed here.

After those fixes, wait for load1 <=12 and run `--phase intact` from this worktree with owned Vite 5251/CDP 9251. Validate full shader compilation, numeric/depth/fallback parity, anatomical coverage and motion evidence before changing `intact`. Then run Task 4 and the full Task 5 paired scene/timing protocol.

The independent cache branch contains `zonedCfg.x`, which is absent here. A future combined branch must force full legacy normals whenever the cache is active until cached-field gradients are separately validated. Cache gradients and reduced-rate AO/scatter remain future work. The prototype stays default off; no merge or push occurred.
