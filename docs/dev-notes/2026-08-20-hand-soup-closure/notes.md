# Hand soup closure — the holes were the nail beds, not the wrist cap

**Date:** 2026-08-20
**Task:** `X1.hand-soup-closure` — make the authored dynamite-grip hand poses
geometrically closed so Blender's Mesh to SDF Grid signs them as solids.
**Status:** DONE — per-operand interior gate passes; all suites green.

## Hole census (before)

Per-pose measurement (weld at 1 µm first, then boundary loops — the indexed
count is the seam-duplicate trap and means nothing). Identical on all six
poses `pose-00-open` .. `pose-05-firm-grip`:

| Metric | Value |
| --- | ---: |
| boundary edges (indexed) | 530 |
| boundary edges (welded 1 µm) | **66** (all incidence-1; 0 non-manifold) |
| distinct loops | **5** |
| components (welded) | 1 |
| signed volume | +6.87e-4 .. +7.11e-4 m³ |

Loop anatomy (open-pose centroids, local frame: +X thumbward, +Y distal,
+Z dorsal; wrist origin at y=−0.035):

| Loop | Edges | Span (mm) | Centroid (m) | Anatomy |
| --- | ---: | --- | --- | --- |
| 1 | 14 | 13.3×10.4×16.1 | (0.111, 0.176, 0.049) | index fingertip |
| 2 | 14 | 11.5×7.3×15.1 | (0.051, 0.202, 0.063) | middle fingertip |
| 3 | 14 | 11.7×3.2×16.8 | (−0.002, 0.186, 0.069) | ring fingertip |
| 4 | 14 | 9.5×2.2×9.4 | (−0.039, 0.147, 0.057) | pinky fingertip |
| 5 | 10 | 8.9×15.3×17.7 | (0.121, 0.098, 0.058) | thumb tip |

Identification evidence: the y-ordering matches finger lengths exactly
(middle 0.202 > ring 0.186 > index 0.176 > pinky 0.147); the four 14-edge
rings track `fingerT` across poses while the 10-edge ring moves only when
`thumbT` changes (thumb-lock, firm-grip). Geometry continues **distal** of
every ring (up to +9 mm), so these are not open tube-ends but window holes
partway along each digit.

**None of the holes are at the wrist cap.** The cut/cap chain is sound:
586 indexed boundary edges → 572 after bisect → 530 after cap, i.e. the cap
removes exactly the 42-edge cut ring it creates.

## Root cause

`extract_right_hand_components()` (bake_hand_sdf.py) keeps "whole non-nail
components" — the X1.26 design spec deliberately excludes the nail meshes
(170 verts / 186 tris / 10 open plate shells). But the skin has a **matching
nail-bed cutout per digit**, so dropping the plates leaves one open ring per
digit: 4×14-edge finger rings + 1×10-edge thumb ring = 66 welded boundary
edges, exactly the residual the adapter qualification measured.

The right-hand nail components are 16/16/16/16/10 verts — plate rims of
14/14/14/14/10 edges, matching the skin cutout rings 1:1. Confirmed by
census of the source glTF (`first_person_hands_rigged/scene.gltf`).

Why the shipped winding-number volume didn't care: libigl's
generalized-winding-number signer tolerates open patches (the holes read as
the "hollow-looking fingertip/nail recesses" the owner accepted at the X1.26
visual gate). Mesh to SDF Grid does not — it emitted an unsigned shell
(302 of 490,201 interior voxels on the firm-grip union).

## Fix (source level, not post-hoc)

`wrist_cut_cap()` in `scripts/bake_hand_sdf.py` gained
`close_nail_beds=False` (keyword-only). When enabled, after the wrist cap:

1. `_welded_hole_loops()` partitions boundary edges into seam pairs (an edge
   with a coincident boundary twin — closed as a surface) vs real hole edges
   (no twin at its endpoint positions), and chains the real ones into loops
   by rounded position key.
2. `_fill_nail_bed_holes()` welds each ring's seam-split vertices at 1 µm
   (same recipe as the cut ring), verifies every consecutive edge pair shares
   an actual vertex (holes_fill refuses open chains), then
   `holes_fill` + `triangulate` per ring.
3. The result is verified with `blender_sdf_grid.welded_mesh_info()` —
   `closed` or SystemExit. Indexed boundary edges are never the judge.

`scripts/author_dynamite_grip.py`'s pose stage passes
`close_nail_beds=True`. The X1.26 static bake (`bake_hand_sdf.py` itself)
keeps the default, so the input soup of the SHIPPED hand volume is
byte-identical — that volume is not re-baked here.

Keeping the nail plates instead (the "true" closure) was considered and
rejected: the plates are open shells sitting proud of the skin, keeping them
would change the owner-approved surface (the X1.26 spec's component selection
deliberately excludes them), and their rims are only positionally coincident
with the cutouts, not topologically joined.

## After

All six poses, measured by `welded_mesh_info()`:

| Metric | Before | After |
| --- | ---: | ---: |
| welded boundary edges | 66 | **0** |
| components | 1 | 1 |
| signed volume (open pose) | +7.114e-4 m³ | **+7.457e-4 m³** |
| triangles per pose | 3,300 | 3,356 (+56 fill faces) |
| vertices per pose | 1,912 | 1,912 (unchanged) |

Fill breakdown: 5 rings [14, 14, 14, 14, 10] edges → +56 triangles
(4×12 + 8), identical across all six poses. The signed volume rises slightly
because the open-mesh fan sum was under-counting through the holes; the
after number is the true enclosed volume.

**Visible shell: unchanged except over the holes.** Vertex-for-vertex diff
(before vs after, open and firm-grip): identical vertex sets, max position
delta 0.0000 mm both directions; every original triangle retained; the only
new surface is the 56 triangles spanning the five nail beds (which were
previously see-through holes reading as the accepted "nail recesses").
The tracked pose contact sheet was regenerated once with the closed soups.

## The real gate

`uv run scripts/qualify_blender_sdf_real_sources.py --hand` (and the full
two-source run) — **PASS**. Firm-grip union, 99×135×78 @ 2 mm,
`direct-vdb`, byte-identical across two Blender processes:

| Operand | Exclusive interior voxels | Fill | Before |
| --- | ---: | ---: | ---: |
| `firm-grip-hand` | **86,659** of 490,201 | **17.68 %** | 302 (0.06 %) |
| `wrist-continuation` | 32,665 of 32,665 | 100 % | 32,665 (100 %) |

Negative components: 106 → **1**. The humanoid intersection is untouched
(f32 hash `aa74bd27004a`, same as recorded 2026-08-19). The hand union's
new f32 hash is `49448a3f8d13`. Checked-in evidence regenerated:
`docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-qualification.json`.

## Verification

- `uv run scripts/test_author_dynamite_grip.py -v` — 12 tests OK, including
  the new `test_every_pose_is_welded_closed` (RED before the fix:
  `boundaryEdges: 66` on every pose).
- `uv run scripts/test_blender_sdf_grid.py -v` — 48 OK.
- `uv run scripts/test_qualify_blender_sdf_real_sources.py -v` — 17 OK.
- `npx vitest run` — 1,516 passed (106 files).
- `npx tsc --noEmit` — clean.

No test weakened, skipped or deleted. `X1.hand-followups`' Blender-native
union leg is unblocked.
