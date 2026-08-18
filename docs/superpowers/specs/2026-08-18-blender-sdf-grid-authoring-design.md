# Blender-Native SDF Grid Authoring Design

**Date:** 2026-08-18

**Status:** Approved shared prerequisite for the textured humanoid spike and the
FPV full distal-arm rerun.

**Implementation plan:**
`docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md`

## Purpose

Qualify Blender 5.2's built-in Geometry Nodes SDF grid operations as Blud's
offline mesh-to-SDF authoring front end before either character bake commits a
large atlas. The qualification must determine what Blender can produce
headlessly and deterministically; the presence of a node in the UI is not
sufficient evidence.

The shared stage owns no game runtime behavior. It standardizes mesh import,
voxel size, grid transform, sign convention, SDF boolean composition,
conversion, diagnostics and provenance for later bakers.

## Required built-in operations

The implementation uses Blender 5.2 Geometry Nodes only:

- **Mesh to SDF Grid** for mesh voxelization;
- **SDF Grid Boolean** for union, intersection and difference;
- **Grid to Mesh** for an explicit watertight-mesh fallback;
- **Store Named Grid** plus a Bake node or Volume output when Blender can write
  the resulting grid as interoperable OpenVDB; and
- **Grid Info** and **Sample Grid** for transform/value diagnostics where the
  evaluated API exposes them.

No commercial add-on is required. Chisel may be reconsidered only if this
qualification proves that the built-in workflow is too slow or too awkward for
the approved resolutions.

## Two allowed output routes

### Route A — direct grid

Preferred. Store the final named SDF grid as OpenVDB, then convert its active
topology, inactive signed interior tiles and transform into Blud's
endpoint-inclusive dense grid. Reading only active narrow-band voxels is
forbidden because it would turn deep interior back into positive background.
The converter must preserve signed distances in metres, explicit bounds, voxel
pitch and axis order. It may run inside Blender's Python when OpenVDB bindings
are unavailable to the normal `uv` environment.

### Route B — deterministic mesh round trip

Fallback. Convert the final SDF grid with **Grid to Mesh** using threshold zero
and adaptivity zero, export the resulting closed mesh, and feed that mesh to the
existing libigl/winding-number baker on the final approved dense grid.

The selected route is written to every manifest and report. A baker may not
silently switch routes or treat a polygonized mesh as direct grid samples.
Route B still uses Blender's built-in grid for union/intersection and surface
cleanup; libigl only performs the final deterministic sampling.

## Coordinate and determinism contract

- Blender version is pinned to 5.2.x in the report and node graph contract.
- All inputs and outputs use metres and a documented right-handed basis.
- Bounds, voxel size, band width, background value, interpolation, threshold
  and adaptivity are explicit inputs, never UI defaults.
- Negative values are interior and positive values exterior.
- A known analytic cube and sphere must have the expected sign, distance,
  bounds and zero surface after conversion.
- Repeating the same headless bake twice must produce byte-identical canonical
  metadata and either byte-identical direct-grid output or numerically identical
  dense samples before R16F encoding.
- The node graph is constructed by script and serialized into a canonical
  contract; no manually edited `.blend` file is an untracked source of truth.
- Temporary `.blend`, `.vdb`, `.ply` and `.npz` intermediates remain outside
  git. Only reproducible outputs, tests and reports are committed.

## Character-specific use

### Textured humanoid

Voxelize the complete source body in each target bone's bind-local coordinates.
Represent the weight-derived planar support region as a closed mesh/SDF and
intersect it with the body SDF. This preserves the original silhouette while
producing closed, independently transformable bone bricks with the declared
parent/child overlap. Source texture projection remains a separate closest-
surface operation against the original GLB.

### FPV distal arm

Align the accepted X1.27 grip-hand surface and the humanoid forearm once, add a
minimal authored overlap/bridge, convert both to a common SDF grid and union
them before extracting one continuous distal surface/grid. Grid filtering may
not alter the fingers, prop-contact region or elbow boundary beyond the
existing numeric tolerances.

The grid stage solves geometry continuity only. FPV hand positions, lighter
reach, ignition, withdrawal and casual underhand toss remain governed by the
original Blud keyframe corridor and owner review.

## Acceptance gate

The shared qualification passes only when:

- the required nodes exist and execute in `blender --background`;
- cube/sphere sign, distance, transform and bounds probes pass;
- union and intersection create the expected connected/overlap topology;
- Route A is either proven with repeatable samples or explicitly rejected with
  a captured reason and Route B passes;
- Route B produces one closed component with zero boundary edges and bounded
  surface error;
- two repeated runs satisfy the determinism contract; and
- the report records Blender version, selected route, commands, timings,
  hashes, numeric errors and the exact node graph contract.

Failure stops both large character bakes for review. It does not authorize an
undocumented add-on or a silent return to the previous pipeline.
