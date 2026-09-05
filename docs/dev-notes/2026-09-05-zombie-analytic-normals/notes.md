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
