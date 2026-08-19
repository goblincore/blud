# Humanoid source closedness — measured

**Date:** 2026-08-19
**Source:** `assets-source/humanoid-sdf/zombie-rigged.glb`
(SHA-256 `2b23530a…3cd28`, 10,234,820 bytes, 62,166 v / 98,003 tri)
**Why:** `X1.sdf-authoring` established that Blender's **Mesh to SDF Grid** emits
an *unsigned shell* rather than a solid when handed an operand with a real hole.
Task 2 of the sever spike feeds the whole body through it. Nobody had run the
closedness gate on the humanoid itself.

## Result

| Metric | Raw indices | Welded 1 µm |
| --- | --- | --- |
| boundary edges (incidence 1) | 26,985 | **76** |
| non-manifold edges (incidence ≥3) | — | **61** |
| `welded_mesh_info().boundaryEdges` (counts `≠ 2`) | — | **137** |
| components | 758 | **1** |
| signed volume | — | **+0.137 m³** |

Weld tolerance makes no difference across 1e-6 / 1e-5 / 1e-4 — the count is
stable at 137, so these are geometric, not precision artifacts.

**The raw 26,985 is UV-seam vertex splitting and is meaningless.** This is exactly
the trap the qualification note warns about; judge with `welded_mesh_info()`.

**Note on the 137.** `closed_mesh_info` counts edges whose incidence is `!= 2`, so
it merges boundary and non-manifold into one number. The split above (76 / 61) is
the useful decomposition: pinholes are the sign-leak risk, non-manifold edges are
overlapping/self-intersecting geometry that voxelization normally tolerates.

## The holes are pinholes, not open cuffs

44 distinct boundary loops, every one of them **2–5 vertices spanning 1–8 mm**.
Largest is a 5-vertex loop on `LeftHand` with a 2×3×2 mm span. These are dropped
triangles from the source generator, not a hollow interior or an open hem.

Boundary-loop vertices by dominant-weight bone:

| Bone | verts | Bone | verts |
| --- | --- | --- | --- |
| `LeftHand` | 54 | `LeftLeg` | 4 |
| `Head` | 26 | `RightToeBase` | 3 |
| `LeftShoulder` | 17 | `RightArm` | 2 |
| `RightLeg` | 10 | `Hips` | 2 |
| | | `LeftForeArm` | 2 |

**`RightForeArm` and `RightHand` have zero.** That is why the adapter
qualification's humanoid `RightForeArm` intersection (44×40×38 @ 6 mm) came back
with exactly one negative component and repeated byte-identically across separate
Blender processes — it was measuring the one part of the body that is clean.

## Consequence for the spike

Every pinhole is at or below the 6 mm limb pitch and most are below the 3 mm
detail pitch, so the level-set conversion may bridge them. **Unmeasured either
way** — do not assume it does, do not pre-emptively repair.

The per-operand interior gate added to Task 2 is what catches a sign leak: a bone
whose source operand bakes unsigned shows a collapsed negative-voxel count against
its support operand (the hand-soup signature was 302 of 38,702). At-risk bricks in
descending order: `Head` (3 mm detail brick, face is a visual gate item),
`LeftHand`, `LeftShoulder`.

If a brick fails, fill only that brick's loops — each is a 2–5 vertex ring, so a
fan triangulation closes it — re-bake, and record the fill. Do not weaken the
gate, coarsen the pitch, switch routes, or fall back to libigl.

## Also corrected here

The plan's Task 2 Step 3 described the graph as combining operands with
**SDF Grid Boolean: Intersection**. That is stale: `GeometryNodeSDFGridBoolean` is
registered but deliberately unused because in Blender 5.2.0 headless it evaluates
to its Grid 2 input regardless of operation. The real composition is one
Mesh-to-SDF-Grid tree per mesh → bake each to disk → OpenVDB `combine(max)`.

`direct-vdb` is **not** a move off Mesh to SDF Grid. OpenVDB owns the boolean fold
and the dense readback only; mesh→grid conversion is still Blender's node, so the
closedness precondition is untouched by that route choice. The path that does not
care about closedness is the libigl generalized-winding-number sampler in
`scripts/bake_hand_sdf.py`, which is what shipped the hand volume and what
`X1.hand-soup-closure` names as the escape hatch for the hand.
