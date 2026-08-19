# Array-mesh SDF adapters — qualification notes

**Date:** 2026-08-19
**Status:** Qualified. `X1.sdf-authoring` complete.
**Evidence:** `adapter-qualification.json` (machine-readable, regenerate with
the command recorded in `qualification.json` → `arrayMeshAdapters.command`).

## What shipped

`scripts/blender_sdf_grid.py` gained a public array-mesh contract
(`MeshArrayInput`, `canonicalize_mesh_array`, `mesh_payload_hash`,
`validate_adapter_request`, `write_mesh_payloads`) and two narrow adapters:

- `bake_mesh_union_to_dense(meshes, spec)` — folds 2..8 OpenVDB level sets
  with `min`;
- `bake_mesh_intersection_to_dense(source, support, spec)` — folds exactly two
  with `max`.

Both reuse Task 1's qualified `direct-vdb` route and never retry the fallback
on failure: a route is requested explicitly or the call raises `route drift`.

## Measured results

| Gate | Hand union | Humanoid forearm intersection |
| --- | --- | --- |
| Lattice | 99 x 135 x 78 @ 2 mm | 44 x 40 x 38 @ 6 mm |
| Repeat f32/R16F/metadata | identical | identical |
| Negative components | 106 (99.22 % in one body) | 1 |
| Boundary minimum | +12.000 mm | +25.314 mm |
| Wall clock per run | 2.3 s | 2.2 s |

The hand's 106 components are **not** a shattered field: one body holds 38,400
of 38,702 negative voxels, and 89 of the remaining components are single
isosurface-speck voxels. `negativeComponentStats` records the distribution so a
future regression that genuinely fragments the field is distinguishable from
this benign speckle. The humanoid intersection is a single solid body.

Neither source is closed by index — the humanoid soup has 26,985 boundary edges
across 758 components, the hand soup 530 across 2 — because both carry
duplicated seam/cut vertices. The dense sign and boundary gates are the
qualification, not a watertightness claim. Support primitives, by contrast, are
mandatory closed boxes and measure 0 boundary edges.

## Finding: `face_owners` flood-fill contaminates owned-face AABBs

Sizing the forearm support volume from faces owned by `RightForeArm` produced a
**body-sized** box (0.60 x 0.43 x 0.73 m) that swallowed 11,872 `Hips` faces,
the head and both legs, and left a stray one-voxel component.

Root cause: `derive_partitions` flood-fills face ownership across edge
adjacency and falls back to "own strongest bone" for isolated islands (this
source has 236 floating 1–7-face components). 168 of `RightForeArm`'s 1,592
owned faces are islands weighted to joints 9–12 sitting ~0.5 m away in
bind-local metres. The owned-face **count** is correct (it matches
`source-report.json`); only the AABB is contaminated.

`derive_partitions`' own recorded `coverage.partitions[].boundsLocalMin/Max`
uses the weight-bound vertex mask and is clean
(−0.096, −0.050, −0.087) .. (0.069, 0.270, 0.044). The qualifier therefore
sizes from those validated bounds via `partition_bind_bounds()` and records the
contaminated owned-face bounds plus `ownedFaceStrays` alongside as evidence.

**Consequence for the humanoid spike:** the distance/color brick baker must
size bricks from the partition's bind bounds (or an explicit outlier-rejecting
extent), **never** from a raw owned-face AABB. Doing the latter silently
inflates every brick to body size.

## Chisel

Chisel 4.0.1 remains optional, development-only authoring/diagnostic software
and is not a production dependency. See
`docs/dev-notes/2026-08-19-chisel-sdf-qualification/notes.md`.
