# Task 5 wound checkpoint report — incomplete verdict

Base: `6737ba8`. Reporting implementation commit: `d9eb11c` (`docs(lab): report deferred wound validation`). Branch: `codex/zombie-analytic-normals`. No merge, push, default enablement, browser, server, or GPU run occurred.

## Result

The offline `--phase verdict` path now consumes retained `wounds.json` evidence as well as intact history. Its generated `summary.json` remains conclusively incomplete:

- `reference: pass`, `gpuKernel: pass`, `intact: pass`
- `wounds: deferred`
- `visualEvidence: skipped-by-gate`
- `timing: skipped-by-gate`, with `measurements: null`
- full `ownerLook: pending`
- coverage scope: `intactValidation: complete`; `fullWoundGameplayValidation: deferred`

The summary retains the 11-case wound oracle count, 13 wound scene comparisons, wall/rim and fallback regions, exact depth/fallback results, actual event/piece identities, localized reviewed proof metrics, first-read legacy control, motion scope, historical runs, tracked beauty artifacts, and explicit remaining work. It does not turn coverage percentages into a timing, speedup, visual-gate, or owner-acceptance claim.

Human-facing `verdict.md`, `notes.md`, and `TASKS.md` now record the exact partial evidence: torso wall 2,074/2,627 and rim 11,015/11,993 analytic; exposed curved fallback 101 stagger, 429 overlap (374 unsupported + 55 hard boundary), and 61 head pixels; one real elbow sever from 10 to 11 pieces with two wounds; body p99/max 1.7301/44.3470 degrees under the retained artifact-specific review; detached `chunk:1` 1,183/1,283 analytic with p99/max 5.8465/8.9135 degrees still unresolved; and the corrected legacy-to-legacy first-read confound (3,666 depth pixels, max 0.084325075) before settled exact legacy-to-hybrid depth/fallback.

Motion claims are limited to 24 subsequent stagger frames and 12 sever-flight frames. The original two initial projectile/impact ticks were not fully paired, and moving-light review remains scoped to actor appearance because background shadows differed. Intact owner approval is recorded separately from pending full wounded-candidate approval.

## Durable evidence

All ten historical raw wound JSON reports were copied byte-identically into deterministic gzip archives under `docs/dev-notes/2026-09-05-zombie-analytic-normals/wound-raw/`. `wounds.json` retains each original `/tmp` path and SHA256 and adds its tracked archive path. A verification script decompressed all ten archives and reproduced all ten recorded SHA256 values. Large RGBA32F and PNG histories were not added; the four existing representative wound beauty PNGs remain the visual checkpoint.

## Verification

- TDD RED: the new partial-wound verdict test failed because coverage was the ambiguous bare `partial`.
- TDD GREEN/final: `node --test scripts/zombie-normal-gradient-check.test.mjs` — 4/4 pass.
- `node --check scripts/zombie-normal-gradient-check.mjs` — pass.
- `node --check scripts/zombie-normal-gradient-check.test.mjs` — pass.
- `git diff --check` — pass before commit.
- Archive verification — 10/10 deterministic gzip archives decompress to their recorded raw SHA256 values.
- Structured summary assertion — intact pass, wounds deferred, timing skipped with null measurements, full owner pending, explicit coverage scopes, conclusion incomplete.
- `node scripts/zombie-normal-gradient-check.mjs --phase verdict --out docs/dev-notes/2026-09-05-zombie-analytic-normals --vite 1 --cdp 1` — expected exit 1 with `VERDICT INCOMPLETE`; no network/browser/server error.

No TypeScript changed, so `tsc` was not repeated. The Task 4 shader/reference matrix had already passed and was intentionally not rerun.

## Remaining work

1. When load1 is at most 12, validate the final bounded settling and detached-piece point adapter on real WebGPU. Produce an independent proof for the detached chunk p99 5.8465-degree pixels and review it without changing the threshold.
2. Validate the newly paired initial projectile/impact ticks and stronger full-state beauty signatures. Preserve rejected frames and the background-shadow limitation.
3. Only after `wounds` passes, run the full positive paired gameplay timing protocol. There is currently no performance result.
4. Obtain full wounded-candidate owner review before changing `ownerLook`.
5. Keep the feature default off and the wound-cache work independent. No merge or push is authorized by this checkpoint.
