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
