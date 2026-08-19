# Chisel 4.0.1 SDF Qualification Spike

**Date:** 2026-08-19

**Status:** Cancelled after the useful decision point; forearm repeat incomplete

**Decision:** Keep OpenVDB as the production SDF backbone. Treat Chisel as an
optional, development-only Blender authoring and diagnostic tool.

## Why the spike stopped

The headless GLM 5.3 `max` task was manually cancelled to stop API-credit
spend. The cancellation happened after analytic union/intersection and the
real firm-grip hand had produced decisive evidence, but before the failed
forearm support-window experiment could be corrected and repeated. The
dispatcher may therefore display the task as `failed`; this is a cancellation
status, not a conclusion that Chisel itself failed.

Do not resume the cancelled dispatcher task. Its worktree contains no commit.
If Chisel is revisited, start a new bounded experiment from the evidence and
unresolved gate recorded here.

## Bottom line

- OpenVDB remains the default for deterministic mesh-to-SDF conversion,
  boolean composition, dense lattice extraction, and downstream baker
  contracts.
- Chisel is promising for interactive SDF modeling inside Blender, fast
  alternate mesh bakes, and diagnosis/comparison of conventional meshes.
- The useful hybrid is: author or inspect in Chisel, export a conventional
  mesh, then pass that mesh through the qualified OpenVDB pipeline.
- Chisel is not a qualified production backend for Blud. Its real forearm
  support intersection did not pass, and its add-on bootstrap and native-wheel
  lifecycle add avoidable production coupling.
- No Chisel add-on or native implementation may be copied or vendored into the
  project. The installed extension is GPL-3.0-or-later and remains an optional
  local development dependency.

## Environment and provenance

The spike ran with Blender 5.2.0 LTS, Python 3.13.13, Chisel 4.0.1, and the
bundled `armesher` 4.0.1 arm64 wheel.

| Artifact | SHA-256 |
| --- | --- |
| `blender_manifest.toml` | `c83734e8cc67fea01aae3f909dddb2d0d2d48a3427016d63048cea0fcb0b75ea` |
| `armesher-4.0.1-cp313-cp313-macosx_11_0_arm64.whl` | `c47dcb0f48f69fa64b33f6446d8de5095f75993fadf01a92cff3ab3be02b352b` |
| extracted native module | `f8cc857b90eb3ee16848d978acaf9be669ea6875e4d929a9d3ab6a820e50b662` |

`armesher.VERSION` was `4.0.1`; its build hash was
`43defedee93e24556b5f5246236c48fbef75c24655d497657e09e2d910dda0b8`.
The machine-readable checkpoint is in `qualification.json` beside this note.
The raw, temporary spike evidence remains under
`/private/tmp/blud-chisel-sdf-qual` for this machine only.

## Headless integration findings

- Chisel's normal Blender operator is modal. The low-level `armesher` API can
  run headlessly.
- A Blender `--factory-startup` control run clears the extension manager's
  extracted `.local` wheel directory. Enabling the add-on re-extracts it, so a
  real adapter would need an explicit bootstrap step. Calling
  `read_factory_settings` after add-on enable unregisters it.
- `bake_mesh_sdf` returns flat float32 values with x-fastest order, dimensions
  `(x, y, z)`, an origin, and scalar spacing. The dense array is reshaped as
  `(z, y, x)`. Voxel centers are
  `origin + (index + 0.5) * spacing`.
- Canonical bakes should pass `normals=None`. The native minimum padding is
  six voxels. Although values above Chisel's documented UI maximum of 64 were
  accepted, the pipeline must not rely on undocumented padding.
- Baking a joined, overlapping triangle soup retains internal faces. Boolean
  composition therefore needs `SDFEvaluator.from_csdl(..., mesh_grids=...)`
  or the OpenVDB composition path; mesh joining alone is not a union.

## Analytic qualification

Separate Blender processes produced byte-identical analytic outputs. Both
operations used a common metre-space lattice and the pinned x-fastest layout.

| Gate | Union | Intersection |
| --- | ---: | ---: |
| Repeated f32 bytes equal | yes | yes |
| Repeated R16F bytes equal | yes | yes |
| Sentinel samples | 0 | 0 |
| Negative components | 1 | 1 |
| Maximum surface error | 0.779 mm | 0.210 mm |
| Chisel two-primitive bake | 0.249–0.269 s | 1.194–1.237 s |

The analytic result is strong enough to retain Chisel as a useful alternate
authoring/diagnostic tool. It does not justify replacing the already-qualified
OpenVDB route.

## Firm-grip hand

The real `pose-05-firm-grip.npz` mesh baked successfully and repeated
deterministically. The source had 1,912 vertices and 3,300 triangles. At
resolution 128 and padding 41, Chisel produced a `193 × 210 × 165` grid with
1.503640 mm spacing in 1.1249 seconds. Winding confidence was 0.95915 and the
exact shell covered the requested lattice margin.

After resampling to the shipped hand lattice:

- sign agreement was 99.9788%;
- Chisel had 215,486 negative voxels versus 215,774 shipped negatives;
- median absolute difference was 0;
- the 99.9th percentile difference was 0.63 mm;
- only 17 voxels exceeded 5 mm, concentrated in a thin-feature cluster; and
- the maximum absolute difference was 10.651 mm.

This is a good diagnostic match, not a migration reason. The shipped OpenVDB
hand remains authoritative.

## Forearm/support intersection: incomplete gate

The bounded `RightForeArm` crop itself baked quickly: 935 vertices, 1,506
triangles, 2.500275 mm spacing, `82 × 144 × 69`, 0.2338 seconds, and winding
confidence 0.86076. Its exact shell, however, covered only 20.002 mm.

The attempted Chisel intersection with the closed support box did not cover
the target lattice. It left 33,810 sentinel samples and differed from the crop
field by as much as 41.191 mm even where the first diagnostic expected support
coverage. That run is invalid as qualification evidence. The task was stopped
before correcting the support envelope and repeating it.

If this gate is ever revisited, first construct a support primitive whose exact
field shell covers every target sample, assert zero sentinels before comparing
values, and only then run the result twice. Do not treat the existing forearm
JSON as a failed quality comparison; it is a failed test setup.

## OpenVDB control and next work

The successful OpenVDB Task 1 branch is
`dispatch/blender-sdf-grid-authoring-task-1` at `4019415`. Its 28 tests pass,
the analytic hashes match its original report, `direct-vdb` is the selected
route, and its explicit OpenVDB `min`/`max` composition works around Blender
5.2's broken `GeometryNodeSDFGridBoolean` behavior.

The old Task 2 branch must not be merged or cherry-picked. It added only a
10 MB `zombie-rigged.glb`, did not implement the adapters, and entered an
accidental O(vertices × faces) diagnostic before failing. Continue from Task
1 with the bounded adapter plan in
`docs/superpowers/plans/2026-08-19-blender-sdf-grid-adapters-continuation.md`.

## References

- [Chisel 4 documentation](https://chisel.ezelar.com/v4/)
- [Chisel mesh primitive](https://chisel.ezelar.com/v4/primitives/mesh)
- [Chisel conversion operations](https://chisel.ezelar.com/v4/operations/convert)
- [Chisel changelog](https://chisel.ezelar.com/v4/changelog)
- `docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md`
- `docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md`
