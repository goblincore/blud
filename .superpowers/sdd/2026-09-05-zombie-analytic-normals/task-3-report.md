# Task 3 report — BLOCKED on real gameplay WebGPU validation

Date: 2026-09-05, 14:55 EDT. Worktree `/Users/donny/Projects/blud/.worktrees/zombie-analytic-normals`, branch `codex/zombie-analytic-normals`, implementation base `edeca69`.

Task 3 code is implemented and focused tests pass. Task 3 is **not complete**: the required real game WebGPU compilation, numeric readback, head/torso coverage and moving-light/body reel have not run. `intact` is `deferred`, not pass or a shader correctness failure. No GPU data is represented as available. Task 4 must not begin on this evidence.

## Implementation

- Added independent default-off `normalGradientCfg` vec4: x legacy/hybrid, y beauty/base-normal/eligibility, z/w zero/reserved. `__sdfGame.setNormalGradient`, `setNormalGradientDebug`, and `normalGradientStatus` manage it. Current actors and detached chunks update immediately; future actors take the requested values and chunk creation/reset copies the template values. Shared chunk uniforms include the new field through the existing generic binding loop.
- Appended derivative helper dependencies to the full march only. Scalar `mapBody`, cone, depth prepass, shadow traversal, culls and shipped tuning remain unchanged.
- Added private `ngBody`/`ngGroup` final-hit value+unnormalized-gradient fold. It follows production primitive order, group/cluster culls, tile entries, scales, orientation and effective `4*k` smooth unions. It does not write production `gFoldBest`, `gFoldBestIdx` or `gFoldBestDistort`.
- Ownership certificate tracks best/runner-up evaluated scalar distances plus excluded candidate lower bounds. Supported capsule gradients have norm <=1 under minScale scaling. Evaluated competitors require a gap >`2*sqrt(3)*.0015`; excluded groups use an enclosing-sphere bound over the whole radius-R neighborhood, divided by group distortion, and must stay above best+R. The certificate also inspects groups omitted from tile lists. A point-only cull is never treated as proof of stencil ownership. Unsupported excluded profiles conservatively veto the candidate.
- Added four cheap production noise-only samples through the same stable owner's `restPoint`, with production fbm frequency and the actual gloss/metal-suppressed amplitude. The stencil is divided by `4*.0015` before adding it to the geometric gradient. Only the final finite/nonzero sum is normalized. The existing later `surfCfg2` microdetail and face bump remain in place exactly once.
- Every invalid candidate calls the original complete `calcNormal`, with full detail. Wound union/per-wound reach spheres are expanded by R. The non-early-out wound branch conservatively falls back wherever its union bound admits the neighborhood. Bare-bones/exposed internal mode and sampled-volume mode fallback before the fold; curved internal ribs alone do not veto intact flesh. Common capsule authored cutters can be excluded outside their complete smax stencil support; unsupported cutters/grooves remain conservative fallback. Nonzero tile bands fallback until a separate atlas-owner contract exists.
- `classifyNormalSupport(Body)` provides a coarse capability summary, ignoring separately stored internal bones. It does not authorize bypassing local checks. An actor with supported and unsupported visible primitives reports both common capability and an unsupported reason.
- Added a raw Float32 march-target readback under existing `installDebugProbe`; removes 256-byte GPU row padding. The intact driver compares raw depth/base normals, classifies reasons before antialias/color conversion, records actual material knobs and posed anisotropic/oriented row counts, and saves separate diagnostic/beauty images plus paired motion frames when it runs. It restores any pinned `performance.now` and resets mode/debug state in `finally`.

## TDD / focused verification

Initial RED: 6 new tests failed (missing support methods, default-off binding/propagation, final-hit branch and ownership condition); 197 existing march tests passed. After implementation and the explicit positional uniform pin update, the initial focused GREEN was 213/213. A subsequent local-cutter support guard was observed RED (1 failure /9 pass) before implementation.

Final commands, all exit 0 on 2026-09-05 at approximately 14:54–14:55:

```text
npx vitest run src/lab/sdf-zombie/webgpu/normal-gradient-reference.test.ts src/lab/sdf-zombie/webgpu/normal-gradient-support.test.ts src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts --maxWorkers=1 --no-file-parallelism
# 233 passed: march 199, reference 19, WGSL registration/isolation 10, support/Lipschitz 5
node --test scripts/lib/normal-gradient-gates.test.mjs
# 2 passed
npx tsc --noEmit
# exit 0
node --check scripts/zombie-normal-gradient-check.mjs
# exit 0
git diff --check
# clean
```

Logs: `/tmp/zombie-ng-task3-red.txt`, `/tmp/zombie-ng-carve-red.txt`, `/tmp/zombie-ng-task3-final-tests.txt`. No full-repository suite, no parallel test workers and no subagents were used.

## Real GPU gate / exact environmental blocker

The authorized launch command was prepared and attempted three times behind the required free-port/load guard:

```bash
set -e
export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251
if lsof -nP -iTCP:5251 -iTCP:9251 -sTCP:LISTEN; then exit 2; fi
node -e 'const n=require("os").loadavg()[0]; console.log("load1",n); if(n>12)process.exit(2)'
source scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/zombie-normal-gradient-check.mjs --phase intact --out /tmp/zombie-ng-intact --vite 5251 --cdp 9251
```

All three attempts stopped before `lab_servers_up`, exit 2: load1 **20.4717**, **27.2534**, **25.7822**. A lightweight intermediate observation reached **83.7939**. The controller identified concurrent user workload and explicitly authorized bounded retries only, followed by a deferred handoff. Ports 5251/9251 were free. No Vite/Chrome/GPU device was started; no foreign process was touched or stopped. The shell escalation was authorized; this was a load-gate stop, not an automatic approval rejection.

**Task 3 GPU samples: zero. Task 3 coverage pixels: unavailable. Task 3 motion artifacts: unavailable.** The previous Task 2 real GPU kernel pass remains valid as prior evidence; it is not a substitute for this new full-game pipeline.

## Predeclared intact criteria and remaining work

Controller tightened the coverage criterion before any gameplay samples: intact **head >=50%** and **torso >=50%** analytic hit pixels independently. Whole-body coverage is reported separately; 10% on other scenes is only a probe-running floor and not a performance claim. Count from raw target reason values, never post-AA screenshot colors.

The driver additionally requires exact raw float depth equality, fallback normal max component error <=1e-6, eligible geometric scalar error <=1e-5, finite base normals, and legacy-stencil direction difference <=5 degrees p99 /25 degrees maximum. Those angle tolerances are comparison to the shipped finite stencil, **not an exact-gradient proof**. Task 1/2 scalar/derivative oracle evidence, final depth preservation, fallback parity, usable real-actor coverage and owner look remain distinct gates.

On a quiet machine, run the exact command above, then investigate any compiler/numeric/coverage failure inside Task 3. Required scenes in the driver: real whole zombie; intact torso; intact head; posed/anisotropic/rotated flesh; actual unsupported bare-bones state; one slug **crater stamp only** with intact surrounding skin; paired moving rig/camera flashlight frames at shipped noise/material settings. The stamp has no impulse, stagger or sever effect. Inspect images, make the short paired reel from the saved PNG frames, save small representative artifacts and `intact.json`, then consider `intact: pass`. No performance verdict has been measured.

## Self-review / concerns

1. **Real pipeline is unvalidated.** WGSL parse/string tests and tsc cannot rule out a runtime shader binding/compilation failure. The newly extended driver has only had syntax validation; its API/staging/readback path itself still needs a real run.
2. Certificate coverage and cost are unknown. It conservatively reads group bounds for tile omissions and can fall back inside loose enclosing spheres. Profile-unsupported candidates and nonzero tile bands currently veto strictly. Do not claim a net speedup or sufficient head/torso coverage from the primitive tests.
3. The coarse `supportedBodies` report summarizes visible geometry capability. It is not a count of eligible pixels and is not permission to ignore sampled state, active bare-bones mode, wounds or local ownership checks.
4. Keep the wound-cache chain independent. This baseline does **not** contain `zonedCfg`. A future combined integration **must force full legacy normals whenever `zonedCfg.x` is active**, until a separate cached-gradient implementation is proven. No speculative cache uniform/interface was added here.
5. Owner visual acceptance remains pending. Mode stays off; no merge, push, auto-enable, or Task 4 implementation occurred.

Commit: the narrow Task 3 implementation commit containing this report (parent `edeca69`); controller receives its SHA in the return message.

## Fix round 1 — driver findings implemented, static re-review pending

Follow-up base: Task 5 incomplete-verdict commit `04a479a`. No shader/renderer changes in this fix round, and the existing offline verdict branch is preserved.

1. **Anatomy and staged-body identity:** `normalAnatomyCoverage` maps raw eligibility owner indices to the staged actor's actual `posed().prims[].limb`. Head and torso each report their own `hits`, `analytic`, `fallback`, and `analyticFraction`; the >=50% gates use the corresponding region, with at least 100 region hit pixels. Other limb pixels cannot inflate either denominator. During the eligibility pass only, all other actors keep geometry and clip depth but emit negative RGB through the existing flat-albedo seam. That excludes another actor's identical local owner indices. `withNormalBodyMask` restores exact original base color and flat-albedo setting on success, setup failure, or readback failure via `finally`. No new/reserved uniform slots were consumed. Captures with detached chunks are explicitly rejected; **Task 4 must extend body/piece identity and anatomical masks before claiming impact/sever coverage**.
2. **Failure propagation:** every intact-driver stage and wound-stamp call now uses `stageNormalCloseup` / `stampNormalWounds`, wrappers passing an explicit throwing failure callback to the underlying staging functions. These cannot inherit the library's `process.exit` default. Errors propagate through the inner state/clock cleanup and outer JSON/tab cleanup.
3. **Moving camera:** `normalOrbitPose` computes yaw from `atan2(targetX-cameraX, -(targetZ-cameraZ))`, with pitch from the same target distance. Tested for both orbit signs.

TDD: `/tmp/zombie-ng-fix-red.txt` records 5 failures for the 5 helper shells before implementation. The tests exercise independent anatomical denominators with non-head/torso/foreign/background/unknown-owner rows, both yaw signs, thrown staging/wound failures reaching cleanup, and exact other-body look restoration on failed readback. Final focused verification:

```text
node --test --test-concurrency=1 scripts/lib/normal-gradient-intact.test.mjs scripts/lib/normal-gradient-gates.test.mjs scripts/zombie-normal-gradient-check.test.mjs
# 8 passed, 0 failed (5 fixes +2 gates +1 offline verdict regression)
node --check scripts/zombie-normal-gradient-check.mjs
node --check scripts/lib/normal-gradient-intact.mjs
# both exit 0
git diff --check
# clean
```

GREEN output: `/tmp/zombie-ng-fix-green.txt`. The offline process test proves prerequisites still produce an incomplete summary/nonzero exit without touching CDP. No full suite, browser/GPU launch, load retry, subagent, or external-memory operation ran. `verdict.md` and notes now distinguish implemented fixes from pending static re-review. `intact` remains deferred; gameplay GPU samples/captures remain zero; Task 4 remains skipped. Runtime sentinel preservation, owner mapping and the real readback path still need the required game GPU gate when authorized on a quiet machine. The prior exact resume command and numerical/coverage criteria remain applicable after static re-review.
