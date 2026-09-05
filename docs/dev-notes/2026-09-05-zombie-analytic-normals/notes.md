# Zombie analytic-normal reference evidence

Date: 2026-09-05. Scope: Task 1 mathematical reference and compiled-zombie inventory. No renderer or WGSL runtime path changed.

## Reference convention

For an untapered capsule, the reference transforms the sample and endpoints by the same component-wise inverse scale. It finds the closest point on that transformed segment, then returns

`d = (length(v) - radius) * min(scale)` and `g = (v / length(v)) / scale * min(scale)`.

The gradient stays unnormalized. A zero-length segment is handled as a point before projection divides by segment length. A sample on the capsule axis has no unique direction and returns a zero gradient with `degenerate`; nonpositive scales and nonfinite diagnostic inputs throw before producing NaN.

The oriented test applies the production conjugate-quaternion transform about the primitive midpoint to the sample and both endpoints. Its world gradient uses the transform Jacobian transpose, which is the forward quaternion rotation. Smooth min uses the shipped effective width `4 * kIn`, preserves fold-order tie selection, and blends the unnormalized input gradients. Smooth max is `-smin(-a,-b)`. Invalid reasons propagate from every branch with nonzero blend weight; an invalid branch outside support is discarded.

## Compiled zombie inventory

The inventory uses the same compile/build fixture as `characters/zombie-blob.test.ts`, then runs the real rig and pack paths at body yaw 0.61 rad. The raw `.blob` has 12 authored body definitions, but `compileBlob` appends four generated face primitives: head, jaw, brow and nose. Mirroring expands this to 23 visible rows.

- Visible flesh: 23 rows: 9 capsules and 14 spheres; 10 anisotropically scaled; all straight, untapered, round-blended.
- Authored carve/groove rows: 0. Current wounds are procedural and belong to later tasks.
- Internal: 68 rows: 60 bone and 8 organ. This set contains 37 bent rows and 13 tapered rows, so it cannot be treated as ordinary capsules when wounded internals become visible.
- Packed total: 91/128 rows. The posed fixture has 58 nonidentity orientation rows in four real quaternion groups. Four visible oriented rows are generated face ellipsoids.

Full counts, generated-face row identities, cluster ranges and representative posed quaternions are in `inventory.json`.

## Numerical evidence

Independent six-sample central differences were evaluated at epsilon 1e-3, 5e-4 and 2.5e-4 metres.

| Case | Scalar error | Gradient error at 1e-3 | at 5e-4 | at 2.5e-4 |
| --- | ---: | ---: | ---: | ---: |
| anisotropic capsule interior `[0.31, 0.22, 0.28]` | 0 | 1.154e-6 | 2.885e-7 | 7.211e-8 |
| anisotropic capsule endcap `[0.65, 0.86, -0.18]` | 0 | 1.968e-6 | 4.919e-7 | 1.230e-7 |

The error falls by about 4x on each epsilon halving, as expected for central differences. A rotated anisotropic capsule had scalar error 0 and gradient error 4.611e-11 at epsilon 1e-5. The constructed anisotropic smooth blend had scalar error 5.551e-17 and gradient error 5.233e-11; its input gradient magnitudes were 0.7906 and 0.9566, so normalizing either input before composition changes the answer and is caught by the test.

Adversarial samples just outside and inside a capsule endpoint join had scalar errors 2.168e-17 and 0, with gradient errors 1.944e-11 and 1.611e-11 at epsilon 1e-6. A smooth point only 0.22 mm from the scaled capsule axis had scalar error 0 and gradient error 1.883e-6 at the same epsilon. These remain named tests rather than being averaged into the smooth-point result.

Named singular cases remain in the suite: a point on a capsule axis returns `degenerate`, and an equal-distance hard-min tie returns `hard-boundary`. The tetrahedral detail stencil recovers the exact gradient `[2, -3, 4]` of the independent linear field.

## TDD and verification

RED after API shells: Vitest collected 16 tests and failed 16 on the deliberate `not implemented` functions. Node collected two gate tests and failed both for the same reason. GREEN after adding the required named adversarial cases: all 19 reference tests and both gate tests pass. TypeScript initially identified one unchecked indexed tuple access in the central-difference helper; changing it to an explicit checked assignment made `npx tsc --noEmit` clean.

Commands:

```text
npx vitest run src/lab/sdf-zombie/webgpu/normal-gradient-reference.test.ts --maxWorkers=1 --no-file-parallelism
node --test scripts/lib/normal-gradient-gates.test.mjs
npx tsc --noEmit
```

## Task 2 — isolated WebGPU derivative kernels

The `gpuKernel` gate is `pass`. The isolated Three WebGPU page registered the helpers through a previous-helper-only `wgslFn` chain and rendered one RGBA32F value/gradient sample plus a separate reason-code pass for each fixture. Numeric outputs use `outputNode`, `NoToneMapping`, `NoColorSpace`, `NoBlending`, no fog and an aligned RGBA32F readback.

Eleven named cases ran on the real WebGPU backend: unit sphere, capsule interior, capsule endcap, nonuniform scale, rotated nonuniform scale, smooth min, smooth max, an anisotropic blend, the capsule-axis singularity, a hard-min tie and an invalid branch excluded by the blend. The eight smooth cases matched both Task 1 CPU answers and independent scalar finite differences. Maximum scalar error was `3.085e-8`; maximum gradient-component error was `1.342e-7`. The invalid cases returned reason codes `2` degenerate, `3` hard-boundary and `1` unsupported. The excluded invalid branch conservatively retained `unsupported`, which is compatible with later strict per-branch reason propagation.

The negative control set a diagnostic uniform that negated GPU `gx` after kernel evaluation. The same driver failed 16 CPU/oracle component comparisons; its first failure was the unit sphere's `gx` error `2 > 0.012`. The mutation is confined to the diagnostic entry and is off by default.

Tracked results are in `kernel.json` and `kernel-visualization.svg`. Raw reports and the runtime screenshot are `/tmp/zombie-ng-kernel/` and `/tmp/zombie-ng-kernel-negative/`.

## Task 3 — integration implemented; real gameplay gate deferred

The final-hit hybrid is default-off. It combines unnormalized supported geometry gradients with four production noise-only samples under a conservative radius-`sqrt(3)*.0015` rest-owner certificate. Invalid local regions execute complete legacy `calcNormal`; procedural wound reaches are expanded by that full radius. Curved internal ribs do not globally reject intact flesh. The independent uniform is bound for full march variants and propagated to new actors/chunks. Scalar tracing is unchanged.

Focused verification: 233 Vitest tests, 2 Node gate tests, TypeScript and driver syntax all pass. The required actual gameplay run did **not** start: bounded owned-server launch attempts were rejected by the load preflight at load1 20.47, 27.25 and 25.78, above the required 12. No new GPU device, samples, coverage images or motion reel exists. `intact: deferred` records that absence honestly; Task 2 kernel evidence cannot stand in for the full new game pipeline.

Criteria fixed before gameplay data: independently >=50% eligible intact head and torso hit pixels; report whole body separately; other scene 10% is a probe floor only. Use raw Float32 target reason/depth/normal data, before antialias/color conversion. Require exact depth equality, fallback component error <=1e-6, geometric scalar error <=1e-5, and legacy finite-stencil angle p99<=5 degrees /max<=25 degrees. Angle comparison is distinct from mathematical derivative correctness and owner look. No timing claim or owner acceptance follows.

Future combination with the independent zoned-wound experiment must force full legacy normals while `zonedCfg.x` is active until separate cached-gradient work passes. This baseline has no such uniform and does not speculate one into its interfaces. Detailed handoff: `.superpowers/sdd/2026-09-05-zombie-analytic-normals/task-3-report.md`; machine-readable missing evidence: `intact.json`.

## Task 5 — incomplete verdict

The prerequisite gate stopped the chain. `reference` and `gpuKernel` remain passed, `intact` remains deferred, `wounds` is skipped by gate, visual evidence and timing are skipped by gate, and owner look remains pending. `summary.json` contains no invented measurements: gameplay coverage and timings are unavailable, with no images or reel.

The verdict driver now handles this state entirely offline, writes the structured incomplete summary, updates dependent gates and exits nonzero. A focused process-level test proves that it does not attempt CDP when prerequisites are missing. See `verdict.md` for the evidence assessment, static-review findings and exact resume sequence.

## Task 3 static-review fix round 1

Implemented the three driver findings on top of Task 5's offline incomplete-verdict commit `04a479a`. Head and torso now each use the staged actor's raw hit-owner index mapped to `posed().prims[].limb`, with independent hit/analytic/fallback denominators. Other actors retain depth/occlusion but use negative sentinel RGB during the eligibility pass; their exact color and flat-albedo setting restore in `finally`. Chunk-containing eligibility captures are rejected until Task 4 extends piece identity/masks for impact/sever coverage. All staging calls go through wrappers with throwing failure callbacks, and moving-camera yaw uses `atan2(dx,-dz)` toward the body.

RED: all 5 new behavioral tests failed against unimplemented helper shells. GREEN: 8 focused Node tests passed (5 fixes, 2 gates, 1 process-level offline verdict regression); both modified driver/helper modules pass syntax checks and `git diff --check` is clean. Static re-review remains pending. No browser, GPU launch or retry occurred in this fix round; `intact` stays deferred and Task 4 stays skipped by prerequisite. Raw gameplay evidence, visual acceptance and timing remain unavailable.

## First real gameplay run and corrected-capture checkpoint — 15:22 EDT

This supersedes the earlier zero-gameplay-sample checkpoint above. At `95e9206`, owned5251/9251 passed load1 7.4165 and the real game WGSL compiled cleanly. Six raw scene comparisons are preserved unchanged in `intact-first-run.json`: exact depth and fallback normals throughout; head anatomical coverage83.58%, torso86.61%, whole-body88.92%, animated91.67%; scalar error <=1.0361e-8. The unsupported control correctly fell back completely. The run exited1 because the narrow upper-body slug view was100% wound-pending, below the mixed10% floor.

Original beauty images are **non-acceptance evidence**: shipped temporal smear0.25 retained raw eligibility colors after only one beauty frame. Valid raw numbers/diagnostic PNGs are separate from those contaminated screenshots and24 original motion frames. The corrected driver preserves smear0.25, asserts actual state, flushes20 zero-dt frames and fences before each beauty screenshot, checks paired material/debug state, and captures the intact motion reel before stamping. It retains the narrow wound fallback control and adds wider body framing outside the production0.8796m wound reach, with unchanged mixed floor. This is not a wounded-closeup acceleration claim.

That correction's one guarded rerun was stopped immediately at load1 17.7056>12; no servers started and no retry followed. Ten focused Node tests, syntax checks and tsc pass; latest capture corrections still require scoped review and actual GPU validation. `intact` remains deferred; first-run `passed:false` is preserved. The incomplete verdict/summary generator now reports real partial gameplay evidence rather than zero samples. Task4, valid visual evidence, performance timing and owner look remain pending or skipped by prerequisite as recorded in gates.


## Final checkpoint review

Scoped static review of `95e9206..fcd4978` approved the capture/fixture corrections with no Critical or Important findings. The reviewer checked zero-dt drawing, temporal history advancement and readback ordering in the existing renderer. This is approval of an unfinished checkpoint; corrected GPU validation, Task 4 and gameplay performance remain deferred. `TASKS.md` now reflects the valid partial gameplay evidence.

## Resumed validation — Task3 technical pass

This supersedes the deferred/unexecuted capture claims above. Corrected1738 actually ran seven scenes: its clean beauty and matched intact motion passed controller inspection, while the torso control's unjustified100% fallback requirement and wider mixed coverage failed. The exact failed result remains `intact-corrected-1738.json`. The earlier first-run JSON and rejected beauty remain separate.

Investigation established that the torso wound's centerY1.020 and reach0.8796 exclude nearly the entire visible body; changing camera distance cannot solve that. The approved fresh-page head-slug fixture records actual worldanchor(-4.7335875,1.5806372,-4.6493816), head primitive2, shippedradius0.16 and unchangedreach0.8796. It passes the unchanged mixedfloor with1702/9469=17.97%analytic lower-body pixels,7645wound-pending and122owner-unstable. Wounded head and torso are both entirely fallback. The torso control remains visible with only23/16477analytic pixels and unknown cost; it is not an acceleration claim.

The final guarded owned5251/9251 launch passed load1=6.46875, ran seven named cases with no failures or shader-console errors, and cleaned up both ports. Head/torso anatomicalcoverage83.58%/86.61%; all depths and fallback normals exactly equal. Controller inspected fresh mixed beauty and eligibility plus corrected head/torso and motion0/6/11 with no obvious regression. A transient missingbody claim was retracted after samehash freshviews confirmed both actor and weapon; no capture wait or shader fix was needed.

Task3 `intact` now passes; ownerLook remains pending and Task4/performance remain unstarted. Offline verdict preserves all20scene comparisons across three runs and remains incomplete for those later gates. Twelve focused Node tests and syntax checks pass after observedRED/GREEN coverage/report regressions. No TypeScript changed; prior tsc remained valid. See latest `verdict.md`, `intact.json`, and the Task3 report for commands and limitations.

## Task 5 wound checkpoint — incomplete verdict

Task 4 now has retained partial real-GPU evidence rather than being unstarted. The offline verdict consumes `wounds.json` alongside the intact history and distinguishes `intactValidation: complete` from `fullWoundGameplayValidation: deferred`. It keeps `wounds: deferred`, `visualEvidence: skipped-by-gate`, `timing: skipped-by-gate`, and full `ownerLook: pending`. The owner-approved intact look is recorded as a narrower completed scope.

The tracked wound evidence preserves 11 production GPU oracle cases, 13 scene comparisons, exact completed depth/fallback comparisons, actual affected wall/rim coverage, exposed curved-internal fallback, seven real `fireSlug` event records, one demonstrated sever to `chunk:1`, localized body/torso derivative-owner-noise proofs, and the unresolved detached-chunk p99 5.8465-degree proof. It also corrects the moving-shoulder result to a reproduced first-read legacy-to-legacy settling confound: 3,666 depth pixels changed with max 0.084325075 before the settled legacy-to-hybrid comparison became exact.

Motion evidence is limited to 24 subsequent stagger frames and 12 sever-flight frames. The original two initial flight/impact ticks were not fully paired, and earlier background-shadow differences limit the moving-light visual statement to actor appearance. Four representative wound beauty PNGs remain tracked; historical review applies only to those exact artifacts.

Ten historical wound JSON reports are archived byte-identically as deterministic gzip files under `wound-raw/`. Their original `/tmp` paths and SHA256 values remain in `wounds.json`, which also records each durable archive path. No large raw RGBA32F or PNG history was added.

The final Task 4 harness changes remain unvalidated on GPU because the last preflights were 26.50 and 55.74, above the required 12. No server/browser was launched and no more GPU attempts were made. Coverage percentages remain correctness/fallback evidence only; there is no performance or full acceptance claim.


## Task 5 positive-path preparation — incomplete, no GPU measurement

The static paired measurement path is implemented in `scripts/lib/normal-gradient-performance.mjs`, wired into `--phase verdict`, with pure full-pair/load/statistic controls in `normal-gradient-verdict.mjs`. It captures the actual renderer GPU device before boot and uses `queue.onSubmittedWorkDone`, preserving native timing-clock semantics and exact chunk samples. It records both load endpoints, rejects a whole pair for either invalid leg, alternates order, and caps three replacement attempts. Current main hull exit bounds and chunk baking stay ON; historical `applyShipDefaults` is deliberately absent. Fresh untimed eligibility records anatomical and wound-wall/rim shares, exact depth/fallback controls, and external raw paths. All new GPU execution remains unvalidated.

A fresh 2026-09-05T23:52:10.931Z preflight returned load `[15.3505859375,12.6591796875,9.20703125]`; no owned GPU resources were started. The controller subsequently held all GPU launches to coordinate the separate zoned-baked-wounds manual session. The explicit `--defer-timing` checkpoint exits 1 INCOMPLETE without connecting to CDP and preserves correctness/owner gates. Timing is deferred. Five static fixture paths are prepared; two-body/surroundings, walking/flashlight, and impact/stagger/sever measurement fixtures remain unimplemented. Direct current-main shader control and compile/register overhead are unmeasured. This is not Task 5 completion.

Eleven focused Node tests passed, including a red/green positive offline checkpoint test, both-end and falling-load controls, complete-pair rejection, three replacement bound, exact seeded fixture mismatch, invalid/hidden/zero-time negatives and pooled chunk percentiles/paired differences. Driver/module syntax and `git diff --check` passed. No TypeScript or production renderer source changed; no tsc/full suite or old GPU matrix was repeated. Historical summary bytes are preserved in `summary-before-positive.json.gz` with SHA256 in `task-5-preflight.json`.
