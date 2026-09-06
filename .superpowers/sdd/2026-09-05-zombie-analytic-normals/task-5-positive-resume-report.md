# Task 5 positive resume — unfinished reviewable checkpoint

Status: **INCOMPLETE**. Tasks 1–4 and owner d1a7450 look approval remain passed. Timing is deferred. No GPU measurement, no new gameplay capture, no speedup/regression claim, no default enable, no main merge/push. Root retains memory/Obsidian ownership.

## Implemented scope

- `--phase verdict` now dispatches the static positive measurement path when prerequisite gates pass, and `--defer-timing` writes an explicit offline incomplete checkpoint without opening a browser. It preserves existing owner approval even in the old missing-prerequisite path.
- `normal-gradient-performance.mjs` prepares intact/wounded torso FIRST, then intact/wounded head and an actual bare-bones unsupported control. Fresh seeded pages, full `CLOSEUP_LADDER`, explicit 35% target (unsupported control reports its actual coverage), native realtime `performance.now`, 120 warmup and 240 measured frames per leg. Actual current defaults are retained; no historical `applyShipDefaults`, hull exit bound and mesh baking ON, no spill suppression. Static crater frames remain frozen diagnostic workloads.
- A before-boot hook captures the renderer's actual GPU device/queue, restores requestAdapter/requestDevice after acquisition, checks native clock and device errors, and fences every 10-frame chunk with `GPUQueue.onSubmittedWorkDone`. This intentionally differs from historical catch-swallowed timestamp-query resolve. No timestamp durations or boot-time proxy is reported as GPU time/compile cost.
- Five accepted alternating full pairs, at most three replacements after the first five attempts. Both load endpoints <=12 and absolute per-leg drift <=4, full-pair rejection, exact fixture signature matching, hidden/invalid/zero-time rejection, raw chunk means plus pooled p50/p95/p99 and every paired delta. Partially completed/rejected data is checkpointed.
- Fresh untimed legacy-repeat, exact hit-depth and fallback-normal parity, staged-body masks, anatomical/wound-wall/rim/reason shares, raw RGBA32F and representative beauty path. Capture-only clock pin restores in finally before any later timing. Live/baked census is separate.

**All new GPU paths remain unexecuted and unvalidated.** The actual two-body close-up with surroundings, walking/flashlight timing, and impact/stagger/sever timing fixtures remain **unimplemented**, not merely waiting for their samples. The driver reports them explicitly and cannot declare the full positive protocol complete. Direct matched current-main shader control is also unimplemented/unmeasured; runtime off/on cannot quantify shared shader compiler/register overhead. Pure compile cost, normal field-work counters and unfenced frame intervals are unavailable.

## Why measurements did not run

Fresh preflight at **2026-09-05T23:52:10.931Z** gave load1 **15.3505859375**, load5 12.6591796875 and load15 9.20703125. No server/browser/device started. Root then directed all GPU work to stay held while the user inspects the separate zoned-baked-wounds task. No idle wait loop or retry occurred. The separate zoned-wounds worker subsequently acquired GPU ownership for its own benchmark. Main has meanwhile advanced to b78bca2 (strand-wind merge 386e028); this candidate remains integrated with b280709. No mixed-version shipping comparison or unrelated merge was attempted. `task-5-preflight.json` retains the actual blocked sample; later explicit offline reporting samples are not quiet-launch permission.

`paired-timings.json`, `summary.json`, `verdict.md`, `gates.json`, notes and TASKS agree: incomplete, timing deferred, all scenes unmeasured. The prior summary was archived byte-identically as deterministic gzip; its size/SHA256 are in `task-5-preflight.json`. Existing failed/incomplete Task 1–4 evidence was retained.

## Focused verification

- RED/GREEN: arithmetic module absent initially failed; four pair-arithmetic tests then passed. New positive offline checkpoint test failed before implementation and passed after it.
- `node --test scripts/lib/normal-gradient-verdict.test.mjs scripts/zombie-normal-gradient-check.test.mjs scripts/lib/normal-gradient-gates.test.mjs`: **11/11 pass**.
- `node --check scripts/lib/normal-gradient-performance.mjs` and driver: pass.
- `git diff --check`: pass.
- Explicit `node scripts/zombie-normal-gradient-check.mjs --phase verdict --defer-timing --out docs/dev-notes/2026-09-05-zombie-analytic-normals --vite 5251 --cdp 9251`: expected **exit 1 / incomplete**, no browser opened.
- No TypeScript/production rendering source changed; no tsc, full suite or previous GPU capture matrix rerun.

## Handoff

Scoped review this fixed checkpoint first. After root releases GPU ownership and load is quiet, run one owned 5251/9251 lifecycle with cleanup trap, measure both primary torso fixtures and send raw path/paired results early. Fix actual harness defects if found, keeping failed artifacts. A clear repeatable primary regression may end the heavy protocol as no-go with all remaining scenes explicit. Otherwise finish the missing secondary fixtures and direct shipping control before any net shipping conclusion. Feature stays default off.

Commit: see the implementation commit containing this report; based on 9d6445c. Root's separate `progress.md` edits were intentionally left unstaged.

## Scoped review fixes — round 1

Based on **059d6df**, addressing only the four scoped findings. Status remains **INCOMPLETE**, all new GPU paths remain unvalidated, and the owner chose to let the separate zoned-wounds benchmark finish before the manual playtest. No browser/server, GPU launch, tsc, full suite or new gameplay fixture was attempted.

1. Pair order now advances with the **accepted pair count**; rejection retries the next required accepted-pair order. The regression test rejects attempts between accepted pairs and checks all five accepted orders, not just attempted order.
2. Both intact-torso and wounded-torso timing sets are saved before either coverage pass. The same static orchestration function used by the real driver is exercised offline, including no-go termination only after both primary captures. A failed or deferred capture cannot erase the already-saved primary timing sets.
3. Eligibility raw RGBA32F and a JSON metrics sidecar are written before zero/low-coverage assertions. The sidecar retains target dimensions, target actor pixels, actual coverage, reasons, anatomy, parity, SHA256 and explicit threshold failure. Zero-hit analytic share is unavailable (`null`). Focused tests inspect exact retained bytes and metrics after both zero and 25%-coverage rejections.
4. Positive reports now record clean/dirty source state on the base commit and SHA256 for the executed driver/protocol modules, captured before generating artifacts. The old 9d6445c entries were retrospectively corrected to **dirty working tree based on 9d6445c**, with original source hashes explicitly unavailable; the duplicate offline entry was removed. The current explicit deferred report records dirty-on-059d6df provenance with actual source hashes. Identical repeated offline checkpoints do not append duplicate gate evidence.

Verification: **13/13 focused Node tests pass**, including the new failures observed before implementation; both syntax checks and `git diff --check` pass. The explicit deferred CLI again exits **1 / INCOMPLETE**, with `browserOpened:false`. Existing correctness and owner gates remain passed. Controller `progress.md` changes remain unstaged. No performance, shipping-win or default-enablement claim is made.
