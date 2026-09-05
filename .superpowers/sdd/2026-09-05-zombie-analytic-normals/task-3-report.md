# Task 3 report — incomplete after first gameplay GPU evidence

Date: 2026-09-05, 14:55 EDT. Worktree `/Users/donny/Projects/blud/.worktrees/zombie-analytic-normals`, branch `codex/zombie-analytic-normals`, implementation base `edeca69`.

**Current status, updated 15:22 EDT:** Task 3 is incomplete. A real game GPU run at `95e9206` compiled cleanly and produced six valid raw numerical comparisons, including head/torso coverage above 50% and exact depth/fallback parity. It failed the original mixed-wound coverage floor, and its beauty was contaminated by temporal diagnostic history. Corrected fixtures/capture are implemented but their rerun was blocked by load1 17.7056. `intact` remains deferred and Task 4 must not begin. The original checkpoint account below is historical; the final section records new evidence and remaining work.

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

## Initial checkpoint: real GPU gate / environmental blocker

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

**At the initial 14:55 checkpoint only: GPU samples were zero, coverage unavailable, and motion artifacts unavailable. The later first-run section supersedes these counts.** The previous Task 2 real GPU kernel pass remains valid as prior evidence; it is not a substitute for this new full-game pipeline.

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

## Real gameplay run and capture correction — 15:10–15:22 EDT

After the controller observed improved external machine state and authorized a new attempt, the exact guarded owned5251/9251 command from this report passed preflight at load1 **7.41650390625**. It ran current `95e9206` with `--phase intact --out /tmp/zombie-ng-intact-resume`. Full game WGSL compiled/executed on real WebGPU with a clean console. The run exited **1**, not success: `INTACT FAIL: mixed-wounded: analytic coverage below 10% probe floor`. Both owned processes were reaped by the trap; ports are free and `/tmp/chrome-lab-9251` was cleaned. No foreign process was touched.

Tracked exact original output: `docs/dev-notes/2026-09-05-zombie-analytic-normals/intact-first-run.json`. All six cases had **depthChanged=0, depthMax=0, fallbackMax=0, nonFinite=0**. Total comparison count is 208,795 hit pixels across scenes, not distinct body samples or a performance counter. Whole-body 88.92% analytic; anatomical torso 10,840/12,516=86.61%; anatomical head 7,270/8,698=83.58%; animated/scaled body 91.67% analytic (10 anisotropic, 4 rotated rows). Maximum scalar error 1.0361e-8. Base-normal p99 remained below 1.50 degrees; animated max was 6.59 degrees. Actual unsupported bare-bones state produced 37,440/37,440 `unsupported` hits with exact legacy normals. Narrow wounded upper body produced 26,935/26,935 `wound-pending` hits and exact legacy normals.

The first-run raw eligibility/normal PNGs remain valid, and representative head/torso diagnostics are tracked. **Beauty does not remain valid:** controller inspection found violet primitive patches and horizontal bands much larger than the raw normal differences. Root cause is the shipped `post-aa.ts` temporal accumulation, `mix(current, history, .25)`: the driver rendered just one beauty frame after eligibility, retaining 25% diagnostic RGB in legacy and then 6.25% in hybrid. This is capture-state contamination, not evidence of gradient look differences. All original PNGs and 24 motion frames remain under `/tmp/zombie-ng-intact-resume/` as explicitly **non-acceptance evidence**. The original motion followed the crater and therefore exercised legacy wound fallback.

Within the controller-authorized bounded correction:

- Added a read-only `__sdfGame.smear` getter. The driver asserts the actual shipped 0.25 value; no material or temporal tuning is changed. Twenty identical zero-dt beauty frames attenuate even owner-channel intensity128 below `128*.25^20=1.1642e-10`. Other smear settings are rejected; this is not a blanket guarantee for 0.6.
- Every beauty capture fences with raw target readback and records actual standard debugCfg, normalGradientCfg, baseColor, march/surface/face/wound settings, fxaa and smear. Both legs must match after ignoring only the requested normal mode. Standard debug and flat-albedo must be zero, gradient diagnostic zero.
- Moved the reel before the crater. For each pair, advance4 simulation frames once, freeze, capture both modes at the same body/camera/light pose with only zero-dt history flushing, then advance to the next pair.
- Retained the narrow wound view as a full wound-pending control. Added wider 2.4 m wounded-body framing and the unchanged >=10% mixed floor, with actual wound rows/bounds/settings recorded. The 0.16 m slug plus the previously recorded shipped settings yield production reach `0.16*(2*1.15+3*.42)+4*.015+.25 = .8796 m`; the original closeup was entirely inside it. No shader, reach or threshold was changed. Mixed wide coverage is not a wounded-closeup optimization claim.

The **single authorized corrected rerun** stopped at preflight load1 **17.70556640625 >12**, exit2, before starting any server. No more waiting or GPU attempts followed. The corrected capture/fixture code is therefore **not GPU-verified**. Keep `intact: deferred` while preserving first-run `passed:false` and its explicit coverage failure.

TDD: temporal-history regression was observed RED before implementation (`/tmp/zombie-ng-beauty-red.txt`). Offline verdict regression was observed RED on the stale claim of zero gameplay GPU samples (`/tmp/zombie-ng-partial-red.txt`). The updated offline verdict consumes the partial `intact.json` record, preserves numerical coverage and no longer fabricates zero samples. `--phase verdict` still runs entirely offline and exits1 with an incomplete summary. Updated `verdict.md`, `summary.json`, `intact.json`, notes and gate evidence distinguish valid raw results, contaminated beauty, and unexecuted corrections.

Final checks (all success unless the expected verdict exit1 is stated):

```text
node --test --test-concurrency=1 scripts/lib/normal-gradient-intact.test.mjs scripts/lib/normal-gradient-gates.test.mjs scripts/zombie-normal-gradient-check.test.mjs
# 10 passed /0 failed; /tmp/zombie-ng-capture-fixes-green.txt
node --check scripts/zombie-normal-gradient-check.mjs
node --check scripts/lib/normal-gradient-intact.mjs
npx tsc --noEmit
# all exit0
node scripts/zombie-normal-gradient-check.mjs --phase verdict --out docs/dev-notes/2026-09-05-zombie-analytic-normals --vite 1 --cdp 1
# expected exit1, incomplete; reports6 real scene comparisons, not zero
```

Remaining: scoped review of these latest capture fixes; an authorized load-guarded corrected GPU run; actual narrow-control/wider-mixed checks; clean paired beauty and intact-motion inspection. No default enablement, Task4 implementation, performance run, merge, push or external memory save occurred.

## Resumed corrected gameplay validation and final fixture — 2026-09-05

User resumed after laptop pause at clean8260b57. Fresh preflight load1=7.3642578, ownedports5251/9251free. Corrected driver ran at `/tmp/zombie-ng-intact-corrected-1738`, exit1 with exactly two failures: `wounded-upper-body-control: expected complete wound-pending fallback` and `mixed-wounded: analytic coverage below 10% probe floor`. Seven cases compiled/executed cleanly. All depth/fallback comparisons exact; intact head/torso/motion clean. Exact JSON preserved as `docs/dev-notes/2026-09-05-zombie-analytic-normals/intact-corrected-1738.json`; historical first-run JSON is untouched.

The torso scene had23analytic,2owner-unstable,16452wound-pending/16477hits; pulling back produced7analytic,1owner-unstable,6686wound-pending/6694hits. Controller geometry review identified actual centerY1.020 and conservativeproductionreach0.8796 as almostwholebody exclusion. Camera distance alone could not satisfy mixedcoverage. The100%control expectation was also unjustified after the prior motion. These were fixture assumptions, not shader defects. Controller temporarily reported missing actor/weapon in woundedhybrid screenshots, then retracted it: identical SHA256 and fresh individual views confirmed actor+weapon in both. No capture lifecycle, delay, shader or productionsetting change was made for that claim.

Approved bounded correction: torso control requires actual wound-pending pixels plus unchanged numericparity, with measured negligibleanalytic share; separate fresh page reboots same game, reapplies shippeddefaults, asserts no priorwounds, stages aimY1.7,d1.45, stamps single shippedslug. ActualdebugWoundsanchor, primIdx, anatomy and posedgeometry are recorded. Require anchorY>=1.5/headowner and lowerleg endpoints beyond expandedbound before wholebody aimY.95,d2.4 comparison. Existing>=10%and>=100analytic floor remains unchanged. No wound-surface acceleration claim.

TDD: coverage test failed against old completefallback behavior (6pass/1fail); updated predicate passed7tests, including rejection for absentwoundfallback and each unchangedmixedfloor. Offline processregression failed on stale `corrected validation has not run`, then passed after schema consumed actualvisualstatus and preserved historicalruns. Further RED on stale `partial` with intactpass was fixed; final focused tests:

```text
node --test --test-concurrency=1 scripts/lib/normal-gradient-intact.test.mjs scripts/lib/normal-gradient-gates.test.mjs scripts/zombie-normal-gradient-check.test.mjs
#12pass,0fail
node --check scripts/zombie-normal-gradient-check.mjs
node --check scripts/lib/normal-gradient-intact.mjs
#exit0
```

No TypeScript or shader changed in this correction; previous tscpass applies. No fullsuite or parallelGPU ran.

The single authorized fixture rerun used this exact guarded command in the worktree:

```bash
set -e
export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251
if lsof -nP -iTCP:5251 -iTCP:9251 -sTCP:LISTEN; then exit 2; fi
node -e 'const n=require("os").loadavg()[0]; console.log("load1",n); if(n>12) process.exit(2)'
source scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/zombie-normal-gradient-check.mjs --phase intact --out /tmp/zombie-ng-intact-head-wound --vite 5251 --cdp 9251
```

Guardload6.46875; actualoutput `INTACT PASS: 7 named cases; evidence /tmp/zombie-ng-intact-head-wound`, exit0, emptyfailures, onlyVitedebugconsole. Cleanuptrap completed; independent lsofverified bothportsfree. Exact result is tracked `intact-head-wound.json`.

Latest real coverage: wholebody8337/9376=88.92%; anatomicaltorso10840/12516=86.61%; anatomicalhead7270/8698=83.58%; animated34322/37440=91.67%; barebones37440/37440unsupported; torso control23/16477analytic with16452woundpending and2ownerunstable; freshheadwound1702/9469=17.9744%analytic,7645woundpending,122ownerunstable. **Wounded head642/642 and torso2962/2962 remain fallback.** Mixed supportedskin is lowerbody. Everycase depthChanged/depthMax/fallbackMax/nonFinite=0; largestscalar1.0361e-8; p99<1.50°,max6.5903°animated versuslegacyfinitestencil. Headwoundactualworldanchor(-4.7335875178,1.5806371699,-4.6493816204),primIdx2/limbhead, radius.16; boundradius.8796; belowreachY.6984390937; sixlegendpointrows beyondverticalreach. Raw geometry/stamp settings accompany JSON.

Controller technically approved correctedbeauty head/torso, motionpairs0/6/11, torso-wound and freshhead-woundbeauty+eligibility. FreshmixedRGBbyteROI meanabsdelta.00393,max8; noobviousregression. These are imagecomparison observations, not performance or temporalflickergates. Durable originalPNGviewer lives in SDD `owner-review/review.html` (controller-managed). Actualsmear.25;20zero-dtflushframes; pairedstatechecks allpass. Historical contaminated firstbeauty remains nonacceptance; corrected1738cleanbeauty is valid despite its coveragefailure.

Updated `intact.json` version2 links allthree rawruns and preserves all20repeatedscenecomparisons. Offlineverdict now reports actual correctedbeauty/motion, latestnumericresults, historicalfailures and intactpass truthfully. Command `node scripts/zombie-normal-gradient-check.mjs --phase verdict --out docs/dev-notes/2026-09-05-zombie-analytic-normals --vite 1 --cdp 1` still exits1 **as expected** because wounds remains skipped and timing/ownerlook are unfulfilled; it opens no browser.

Final technicalstatus: Task3 intactpass subject to scoped finalreport/testreview; ownerLookpending. Task4 and performance remain unstarted this turn. Chunk-containingeligibility captures remainrejected; future zonedcacheintegration mustforcefulllegacy ifzonedCfg.xactive. No defaultenablement, geometrychange, foreignprocess, subagent, memorysave, merge or push. Nextuserstep is intactownerlook.
