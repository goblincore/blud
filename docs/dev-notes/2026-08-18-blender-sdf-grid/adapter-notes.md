# Array-mesh SDF adapters — qualification notes

**Date:** 2026-08-19
**Status:** Qualified **for geometrically closed operands**.
`X1.sdf-authoring` complete; the humanoid path is unblocked, the hand-union
path needs a closed hand soup first (see the finding below).
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
| Route | `direct-vdb` | `direct-vdb` |
| Negative components | 106 (99.22 % in one body) | 1 |
| Boundary minimum | +12.000 mm | +25.314 mm |
| Per-operand interior | **FAIL** | pass |
| Wall clock per run | 2.3 s | 2.2 s |

**The humanoid intersection qualifies. The hand union does not.** Both bake
deterministically and both repeat byte-identically — the adapters are correct.
The hand union fails on its INPUT, for the reason below.

## Finding: `direct-vdb` needs GEOMETRICALLY closed operands

Mesh to SDF Grid (OpenVDB `meshToLevelSet`) cannot sign an interior through a
real hole. Given one, it emits an **unsigned shell**: a thin band of near-zero
values around the surface with "outside" on both sides of it.

Measured on the firm-grip hand union:

| Operand | Exclusive negatives | Exclusive voxels | Filled |
| --- | ---: | ---: | ---: |
| `firm-grip-hand` | 302 | 490,201 | 0.06 % |
| `wrist-continuation` (closed box) | 32,665 | 32,665 | 100 % |

38,400 of the union's 38,702 negative voxels are the **box**. The hand
contributes 302. Yet 36,503 voxels above the box carry `|d| < 1 voxel` — the
hand is present, as a shell. `preview-hand-union-slices.png` shows it directly:
the box is a filled rectangle, the hand is a hollow outline.

Indexed boundary edges are NOT the test. Both character sources duplicate
seam/cut vertices and read as wildly open by index while being closed as
surfaces. `SDF.welded_mesh_info()` welds coincident vertices first; what
survives is a real hole:

| Mesh | Boundary edges (indexed) | Boundary edges (welded) | Closed |
| --- | ---: | ---: | --- |
| `humanoid-body` | 26,985 | 137 | no (0.14 % of 98,003 tris) |
| `firm-grip-hand` | 530 | **66** | no (2.0 % of 3,300 tris) |
| support / wrist boxes | 0 | 0 | yes |

The humanoid's 137 residual edges are negligible against 98,003 triangles and
it bakes as a clean solid. The hand's 66 residual edges are a substantial open
ring on a 3,300-triangle mesh — the wrist cap does not actually close the
surface — and the interior leaks.

**This was originally missed** because the plan's dense gates only ask for
*some* negatives, both signs, and no negative on the lattice boundary. The
closed wrist box satisfied all three on its own. `score_operand_coverage()` +
`require_operand_interior()` now score each union operand inside the region no
other operand covers, so a silent non-contributor fails the run.

**Consequences:**

- Any Blender-native SDF union of the authored hand poses must weld and cap the
  soup first, or use the winding-number route (`bake_hand_sdf.py` libigl
  unsigned + fast winding number) that produced the SHIPPED hand volume. This
  directly affects `X1.hand-followups`, whose plan is to build one
  hand+wrist+native-forearm field via Blender-native union.
- The humanoid path is unaffected and qualified.

## Previews

There is no runtime humanoid page yet (Tasks 2-7 of the sever spike), so
`scripts/preview_adapter_fields.py` CPU sphere-traces the dense fields:

- `preview-humanoid-forearm.png` / `-slices.png` — a solid forearm with visible
  musculature and flat cut caps where the closed support box clipped it.
- `preview-hand-union.png` / `-slices.png` — the solid wrist box and the hand's
  hollow shell, i.e. the finding above.

The tracer lands on the first positive->non-positive **sign change**, refined by
linear interpolation. An epsilon-on-distance test with a step floor is wrong on
a discrete grid: the floor overrides `step <= |d|`, and rays jump the surface
(measured: 2,585 rays passed within one voxel and never registered).

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
