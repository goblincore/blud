# Blender SDF Grid Adapters Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Use
> `superpowers:test-driven-development` for every behavior change and
> `superpowers:verification-before-completion` before any completion claim.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `X1.sdf-authoring` by adding deterministic, bounded array-mesh
union/intersection adapters to the successful Blender/OpenVDB Task 1 backend,
then prove them against the firm-grip hand and the canonical humanoid source.

**Architecture:** Normal Python validates and canonicalizes immutable mesh
inputs, writes deterministic little-endian payloads into a task-owned temporary
directory, and launches the existing Blender-inner process. Blender reconstructs
the meshes without changing face order, bakes one OpenVDB level set per mesh,
and folds those grids with explicit `min` (union) or `max` (intersection).
Expensive real-source qualification lives in a separate CLI so unit tests stay
fast. OpenVDB `direct-vdb` remains the selected production route; the existing
Grid-to-Mesh/libigl route remains an explicit fallback, not an automatic retry.

**Tech Stack:** Python 3.12 via `uv`, NumPy, Blender 5.2.x Python and Geometry
Nodes, Blender-bundled OpenVDB, libigl 2.6 fallback, `unittest`.

**Spec:**
`docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md`

**Supersedes:** Task 2 only of
`docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md`. Task 1 of
that plan is already complete and is the required base.

## Required Base and Integration Setup

Start a fresh isolated branch/worktree from the successful Task 1 commit, not
from its failed successor:

```bash
git switch -c codex/blender-sdf-grid-adapters 4019415
git cherry-pick 02c074b
```

The cherry-pick adds the already-successful canonical humanoid source export,
partition code, tests, and its owner-supplied source GLB. It is needed only so
the bounded real-source qualifier can call the established source/bind logic.
It is not the failed adapter work.

Hard exclusions:

- Do not merge or cherry-pick `cf1d2e7` or
  `dispatch/blender-sdf-grid-authoring-task-2`. That commit adds only a duplicate
  10 MB GLB and contains none of the requested adapter implementation.
- Do not resume the cancelled Chisel dispatcher task. Chisel is optional
  authoring/diagnostic software, not part of this production adapter plan.
- Do not change the selected route from `direct-vdb` and do not restore
  `GeometryNodeSDFGridBoolean`. Blender 5.2 returns Grid 2 for every tested
  boolean operation; Task 1's OpenVDB `FloatGrid.combine(min/max)` is the
  qualified workaround.

Before editing, prove the combined base is healthy:

```bash
uv run scripts/test_blender_sdf_grid.py -v
uv run scripts/test_bake_humanoid_sdf.py -v
git diff --check
```

Expected: the Blender grid suite reports 28 passing tests; humanoid Task 1's
suite passes; no whitespace errors. If the cherry-pick conflicts or either
baseline is red, stop and diagnose the integration rather than modifying the
adapter.

## Global Safety and Performance Constraints

- All temporary `.bin`, `.json`, `.vdb`, `.blend`, `.ply`, and `.npz` files
  live under a `tempfile.mkdtemp`/`TemporaryDirectory` outside git.
- Public adapters never mutate caller arrays. Canonicalization always creates
  owned C-contiguous little-endian copies.
- No Python loop may compare every vertex with every face. Vectorized O(V+F)
  validation and indexed gathers are allowed; O(V×F) is forbidden.
- Pin and test these input ceilings in `scripts/blender_sdf_grid.py`:

```python
MAX_MESHES = 8
MAX_VERTICES_PER_MESH = 250_000
MAX_TRIANGLES_PER_MESH = 500_000
MAX_DENSE_VOXELS = 16_000_000
BLENDER_TIMEOUT_S = 300
```

- Reject limits before launching Blender. Include the rejected count and limit
  in the exception.
- Never call libigl on Route A. Route B may call libigl only after a closed
  Grid-to-Mesh result passes its existing topology check.
- Keep production source assets out of adapter unit tests. Real-source tests
  use the dedicated qualifier and never bake a full atlas.
- Every report records route, Blender version, source hashes, payload hashes,
  transforms, grid contract hash, timings, dimensions, sign/topology gates,
  and repeated-run byte equality.
- Record indexed boundary/non-manifold diagnostics for every input, but do not
  reject the two canonical character sources merely for indexed boundary
  edges. Both assets contain duplicated seam/cut vertices and are not closed
  by index. Their dense sign and boundary gates are the qualification. Closed
  support primitives remain mandatory for intersection.

---

### Task 1: Freeze the public array-mesh and canonical payload contract

**Files:**

- Modify: `scripts/blender_sdf_grid.py`
- Modify: `scripts/test_blender_sdf_grid.py`

**Produces:** `MeshArrayInput`, pure validation/canonicalization helpers,
deterministic payload descriptors, and preflight resource guards. This task
does not launch Blender.

- [ ] **Step 1: Write RED contract tests**

Add a `MeshArrayContractTest` class. Use a four-vertex tetrahedron fixture so
all tests remain pure and instant.

```python
class MeshArrayContractTest(unittest.TestCase):
    def test_canonical_copy_is_little_endian_owned_and_does_not_mutate_input(self):
        vertices, triangles = tetrahedron_arrays()
        original_v = vertices.copy()
        original_f = triangles.copy()
        mesh = SDF.MeshArrayInput(
            label="tetra",
            vertices_m=vertices[:, ::-1][:, ::-1],  # non-contiguous view
            triangles=triangles.astype(">i8"),
            source_sha256="ab" * 32,
            source_to_grid_m=SDF.IDENTITY_4X4,
        )
        canonical = SDF.canonicalize_mesh_array(mesh)
        self.assertEqual(canonical.vertices_m.dtype.str, "<f8")
        self.assertEqual(canonical.triangles.dtype.str, "<u4")
        self.assertTrue(canonical.vertices_m.flags.c_contiguous)
        self.assertTrue(canonical.vertices_m.flags.owndata)
        np.testing.assert_array_equal(vertices, original_v)
        np.testing.assert_array_equal(triangles, original_f)

    def test_payload_hash_is_stable_but_covers_geometry_source_and_transform(self):
        base = canonical_tetra_input()
        h0 = SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(base))
        h1 = SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(base))
        self.assertEqual(h0, h1)
        self.assertNotEqual(h0, payload_hash_with_one_vertex_changed(base))
        self.assertNotEqual(h0, payload_hash_with_source_hash_changed(base))
        self.assertNotEqual(h0, payload_hash_with_translation_changed(base))

    def test_rejects_invalid_geometry_and_transforms_before_blender(self):
        for mesh, message in invalid_mesh_cases():
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                SDF.canonicalize_mesh_array(mesh)

    def test_resource_limits_are_checked_without_launching_blender(self):
        with self.assertRaisesRegex(ValueError, "dense voxel count"):
            SDF.validate_adapter_request(
                (canonical_tetra_input(),),
                dataclasses.replace(SDF.fixture_spec(), dimensions=(257, 257, 257)),
            )
```

`invalid_mesh_cases()` must cover:

- vertices not shaped `(V, 3)`;
- triangles not shaped `(F, 3)`;
- empty arrays;
- NaN or infinity;
- negative or out-of-range triangle indices;
- degenerate repeated-index triangles;
- a source hash that is not 64 lowercase hexadecimal characters;
- a transform that is not finite 4×4 affine;
- a final affine row other than `(0, 0, 0, 1)`;
- reflection (`det < 0`), anisotropic scale, uniform scale, shear, and a
  non-orthonormal rotation; and
- every configured mesh/vertex/triangle/voxel ceiling.

- [ ] **Step 2: Run RED**

```bash
uv run scripts/test_blender_sdf_grid.py MeshArrayContractTest -v
```

Expected: import/attribute failures for `MeshArrayInput` and its helpers. Do
not weaken an existing Task 1 test to make the new class run.

- [ ] **Step 3: Implement the import-safe public dataclass**

Place it beside the existing frozen request/result dataclasses, before any
`bpy` import:

```python
IDENTITY_4X4 = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)

@dataclasses.dataclass(frozen=True)
class MeshArrayInput:
    label: str
    vertices_m: npt.NDArray[np.floating]
    triangles: npt.NDArray[np.integer]
    source_sha256: str
    source_to_grid_m: tuple[tuple[float, float, float, float], ...] = IDENTITY_4X4
```

The transform maps source coordinates to the adapter's common grid-local metre
basis. Translation and a proper rotation are allowed. Scale, shear, and
reflection are rejected because the caller must strip source scene scale and
declare a rigid metre-space frame before baking.

`canonicalize_mesh_array(mesh)` returns a new `MeshArrayInput` with owned
`<f8` vertices and `<u4` triangles, a tuple-of-tuples transform, and a stripped
non-empty label. It validates geometry and transform without modifying the
input.

Use tolerances of `1e-9` for the affine row and `1e-6` for
`R.T @ R == identity` and `det(R) == +1`. Do not silently polar-snap a public
adapter transform; the upstream humanoid source code already owns any
asset-specific bind normalization.

- [ ] **Step 4: Implement canonical payload bytes and hashes**

Add an internal frozen descriptor:

```python
@dataclasses.dataclass(frozen=True)
class MeshPayloadDescriptor:
    label: str
    vertex_count: int
    triangle_count: int
    vertices_file: str
    triangles_file: str
    vertices_sha256: str
    triangles_sha256: str
    source_sha256: str
    source_to_grid_m: tuple[tuple[float, float, float, float], ...]
    payload_sha256: str
```

Write raw `mesh-000.vertices.f64le` and `mesh-000.triangles.u32le` bytes. File
names are relative to `request.json`; absolute temporary paths never enter the
canonical source hash. `payload_sha256` is the SHA-256 of canonical JSON
containing the label, counts, per-file hashes, upstream source hash, transform,
and format strings (`f64le`, `u32le`, `x-y-z`, `triangles`).

The descriptor writer must reject path separators in labels, use numeric file
indices for names, and verify that writing then reading the file hashes yields
the same digests.

- [ ] **Step 5: Implement request guards**

`validate_adapter_request(meshes, spec)` validates and returns a tuple of
canonical inputs. It checks `1 <= len(meshes) <= MAX_MESHES`, per-mesh limits,
`np.prod(spec.dimensions) <= MAX_DENSE_VOXELS`, dimensions greater than one,
finite ordered bounds, and consistency between `spec.voxel_measured()` and the
declared voxel size within the existing Task 1 tolerance.

The public union adapter will later require at least two meshes; the public
intersection adapter will require exactly two. Keep those operation-specific
checks outside this shared helper.

- [ ] **Step 6: Run GREEN and regression tests**

```bash
uv run scripts/test_blender_sdf_grid.py MeshArrayContractTest -v
uv run scripts/test_blender_sdf_grid.py -v
git diff --check
```

Expected: the new pure tests pass and all 28 original Task 1 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/blender_sdf_grid.py scripts/test_blender_sdf_grid.py
git commit -m "feat(sdf-tools): freeze array mesh payload contract"
```

---

### Task 2: Connect array meshes to the qualified Blender/OpenVDB core

**Files:**

- Modify: `scripts/blender_sdf_grid.py`
- Modify: `scripts/test_blender_sdf_grid.py`

**Produces:** `bake_mesh_union_to_dense(...)` and
`bake_mesh_intersection_to_dense(...)` using the same `DenseSdfResult` contract
as Task 1.

- [ ] **Step 1: Write RED inner-loader and adapter tests**

Add pure corruption tests plus three small Blender integration tests:

```python
class MeshArrayAdapterTest(unittest.TestCase):
    def test_inner_loader_rejects_truncated_or_hash_changed_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            descriptor = write_tetra_payload(Path(tmp))
            Path(tmp, descriptor.vertices_file).write_bytes(b"short")
            with self.assertRaisesRegex(ValueError, "vertices.*size|hash"):
                SDF.load_mesh_payload(Path(tmp), descriptor_to_json(descriptor))

    def test_union_of_three_array_meshes_is_deterministic(self):
        meshes = three_overlapping_tetrahedra()
        a = SDF.bake_mesh_union_to_dense(meshes, small_fixture_spec())
        b = SDF.bake_mesh_union_to_dense(meshes, small_fixture_spec())
        self.assertEqual(a.source_sha256, b.source_sha256)
        self.assertEqual(a.values_f32.tobytes(), b.values_f32.tobytes())
        self.assertEqual(SDF.encode_r16f_bytes(a), SDF.encode_r16f_bytes(b))
        self.assertLess(a.sample((0.0, 0.0, 0.0)), 0.0)

    def test_intersection_uses_max_and_preserves_input_arrays(self):
        source, support = overlapping_closed_cubes_as_arrays()
        before = tuple(x.copy() for x in (
            source.vertices_m, source.triangles,
            support.vertices_m, support.triangles,
        ))
        result = SDF.bake_mesh_intersection_to_dense(
            source, support, small_fixture_spec())
        self.assertLess(result.sample((0.0, 0.0, 0.0)), 0.0)
        self.assertGreater(result.sample((0.07, 0.0, 0.0)), 0.0)
        assert_arrays_unchanged(before, source, support)

    def test_adapter_never_silently_changes_route(self):
        with self.assertRaisesRegex(RuntimeError, "route drift"):
            run_with_inner_result_route_changed()
```

Also test a translated/rotated `source_to_grid_m` against an equivalent mesh
whose vertices were transformed ahead of time. The two dense f32 and R16F
outputs must be byte-identical.

- [ ] **Step 2: Run RED**

```bash
uv run scripts/test_blender_sdf_grid.py MeshArrayAdapterTest -v
```

Expected: adapter methods are missing. The corruption test may initially fail
because the inner loader does not exist.

- [ ] **Step 3: Extend the request JSON without regressing analytic fixtures**

Keep the existing `MeshInput` representation unchanged. Array-backed requests
use a tagged mesh entry:

```json
{
  "kind": "array-payload",
  "label": "right-forearm",
  "vertexCount": 935,
  "triangleCount": 1506,
  "verticesFile": "mesh-000.vertices.f64le",
  "trianglesFile": "mesh-000.triangles.u32le",
  "verticesSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "trianglesSha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "sourceSha256": "2222222222222222222222222222222222222222222222222222222222222222",
  "sourceToGridM": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
  "payloadSha256": "3333333333333333333333333333333333333333333333333333333333333333"
}
```

The inner loader resolves files relative to the request path, rejects absolute
paths and `..`, verifies byte count and hash before `np.frombuffer`, reshapes
exactly from the declared counts, reapplies the public validation, and then
applies `sourceToGridM` once with row-vector NumPy math. It creates a Blender
mesh with `from_pydata`, calls `mesh.validate()` and fails if Blender corrected
anything, then runs the existing `_bl_determinize_mesh` routine.

Do not convert array inputs into one joined mesh. Every source remains a
separate conventional triangle mesh and therefore a separate level set. Record
its indexed topology diagnostics before Blender; the real-source gates decide
whether imperfect source topology still produced a valid dense sign field.

- [ ] **Step 4: Generalize Task 1's two-grid fold**

Rename `_bl_bake_two_grids` to `_bl_bake_grids` and accept 1–8 objects. Bake
each object's level set independently through the existing explicit node
contract, then fold in stable request order:

```python
combine = min if request["operation"] == "union" else max
result_grid = baked[0]
for next_grid in baked[1:]:
    result_grid.combine(next_grid, combine)
```

`single` still requires exactly one mesh; `union` requires at least two;
`intersection` requires exactly two for this plan. Store the final grid under
the pinned grid name. Record each component grid hash/active bounds in inner
diagnostics so a reordered or omitted operand is visible.

- [ ] **Step 5: Implement the two narrow public adapters**

Use these exact interfaces:

```python
def bake_mesh_union_to_dense(
    meshes: Sequence[MeshArrayInput],
    spec: SdfGridSpec,
    *,
    route: str = SdfGridRoute.DIRECT_VDB,
    blender_bin: str | None = None,
    keep_tmp: bool = False,
    diagnostics: dict[str, Any] | None = None,
) -> DenseSdfResult:
    return _bake_mesh_arrays(
        operation="union", meshes=tuple(meshes), spec=spec, route=route,
        blender_bin=blender_bin, keep_tmp=keep_tmp, diagnostics=diagnostics,
    )

def bake_mesh_intersection_to_dense(
    source: MeshArrayInput,
    support: MeshArrayInput,
    spec: SdfGridSpec,
    *,
    route: str = SdfGridRoute.DIRECT_VDB,
    blender_bin: str | None = None,
    keep_tmp: bool = False,
    diagnostics: dict[str, Any] | None = None,
) -> DenseSdfResult:
    return _bake_mesh_arrays(
        operation="intersection", meshes=(source, support), spec=spec,
        route=route, blender_bin=blender_bin, keep_tmp=keep_tmp,
        diagnostics=diagnostics,
    )
```

Both functions canonicalize before creating their temporary directory, write
payloads, build a canonical request, and delegate to one refactored outer
runner shared with `run_blender_sdf`. They never catch a Route A failure and
retry Route B. Callers must explicitly request the fallback route.

`DenseSdfResult.source_sha256` becomes the operation hash over operation,
ordered payload hashes, route, and the full grid spec. Preserve Task 1 analytic
fixture hashes by using this new operation hash only for array-backed requests.

Diagnostics include `payloads`, `operationSourceSha256`, resource counts,
temporary directory policy, subprocess command, Blender/inner timings, selected
route, component-grid diagnostics, and the existing node-contract hash.

- [ ] **Step 6: Run GREEN, determinism, and fallback gates**

```bash
uv run scripts/test_blender_sdf_grid.py MeshArrayAdapterTest -v
uv run scripts/test_blender_sdf_grid.py -v
uv run scripts/blender_sdf_grid.py --probe-capabilities
uv run scripts/blender_sdf_grid.py --analytic-fixture
git diff --check
```

Expected:

- all legacy and adapter tests pass;
- the three-way union and two-way intersection each repeat byte-identically;
- transformed-input equivalence is byte-identical;
- capability output still selects `direct-vdb`;
- the analytic fixture hashes remain those recorded by Task 1; and
- no tracked temporary files appear in `git status --short`.

- [ ] **Step 7: Commit**

```bash
git add scripts/blender_sdf_grid.py scripts/test_blender_sdf_grid.py
git commit -m "feat(sdf-tools): add OpenVDB mesh adapters"
```

---

### Task 3: Qualify bounded hand union and humanoid intersection sources

**Files:**

- Create: `scripts/qualify_blender_sdf_real_sources.py`
- Create: `scripts/test_qualify_blender_sdf_real_sources.py`
- Modify: `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`
- Create: `docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-qualification.json`

**Produces:** a repeatable, machine-readable real-source smoke report. It does
not write production atlases or runtime assets.

- [ ] **Step 1: Write RED pure qualifier tests**

Keep source preparation and gate scoring pure enough to test without Blender:

```python
class RealSourceQualificationContractTest(unittest.TestCase):
    def test_box_mesh_is_closed_right_handed_and_inside_declared_bounds(self):
        vertices, faces = QUAL.closed_box_mesh((-1, -2, -3), (1, 2, 3))
        self.assertEqual(vertices.shape, (8, 3))
        self.assertEqual(faces.shape, (12, 3))
        self.assertEqual(SDF.closed_mesh_info(vertices, faces)["boundaryEdges"], 0)

    def test_repeat_gate_requires_metadata_f32_and_r16f_equality(self):
        self.assertFalse(QUAL.score_repeat(run_a(), run_b_with_one_f32_changed())["passed"])
        self.assertTrue(QUAL.score_repeat(run_a(), exact_copy_of_run_a())["passed"])

    def test_report_rejects_empty_negative_region_boundary_touch_and_route_drift(self):
        for result, message in invalid_dense_results():
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                QUAL.score_dense_gate(result, expected_route="direct-vdb")

    def test_forearm_bounds_use_owned_faces_in_bind_local_metres(self):
        bounds = QUAL.partition_owned_bounds(tiny_source_soup(), tiny_partition_result(), "RightForeArm")
        np.testing.assert_allclose(bounds.minimum_m, EXPECTED_MINIMUM_M)
        np.testing.assert_allclose(bounds.maximum_m, EXPECTED_MAXIMUM_M)
```

`score_dense_gate` requires finite values, both signs, at least one negative
component, no negative sample on the six lattice boundary faces, and the
expected explicit route. A one-component requirement is appropriate for the
synthetic support box intersection; the hand union may retain multiple closed
finger islands only if the source soup itself contains them, so record rather
than hard-code its component count.

- [ ] **Step 2: Run RED**

```bash
uv run scripts/test_qualify_blender_sdf_real_sources.py -v
```

Expected: import failure because the qualifier does not exist.

- [ ] **Step 3: Implement bounded hand union preparation**

Import `export_pose_soups` from `scripts/author_dynamite_grip.py`, export into
a `TemporaryDirectory`, and load `pose-05-firm-grip.npz`. Use only its
`vertices` and `faces`; verify its source/authoring hashes through the existing
authoring contract.

`blender_pose_stage` currently renders a contact sheet to the hard-coded
tracked path
`docs/dev-notes/2026-08-17-sdf-dynamite-grip/pose-contact-sheet.png` even when
the soups are temporary. Before export, hash that file. After export, require
the hash to be unchanged. If it changes, fail the qualifier and fix the source
export path; never stage or silently restore the preview.

Build one closed wrist continuation box in the hand soup's existing local metre
basis (`y` is distal). Define the wrist band as vertices whose y coordinate is
within 5 mm of the soup's minimum y. The box spans that band's x/z bounds plus
5 mm on every side, overlaps the soup from `min_y` through `min_y + 10 mm`, and
extends proximally to `min_y - 50 mm`. Require at least four wrist-band vertices
and record their count and the derived box bounds. Union the firm-grip soup and
box on a grid with 2 mm pitch and at least six voxels of positive boundary
margin. Cap each dimension at 192 and total voxels at `MAX_DENSE_VOXELS`; fail
rather than coarsen silently.

Run the union twice in separate Blender processes. Require identical canonical
metadata after removing timings/temp paths, identical f32 bytes, identical
R16F bytes, both signs, no negative boundary samples, and explicit
`direct-vdb` route.

- [ ] **Step 4: Implement bounded humanoid support intersection preparation**

Use the successfully cherry-picked functions from
`scripts/bake_humanoid_sdf.py`:

```python
with tempfile.TemporaryDirectory(prefix="blud-humanoid-source-") as tmp:
    soup = HUM.export_source_npz(Path(tmp) / "source.npz")
partitions = HUM.derive_partitions(soup)
forearm = next(p for p in partitions.partitions if p.name == "RightForeArm")
```

Transform the complete canonical source soup into the forearm's bind-local metre
basis with `forearm.model_to_bind`. This is a vectorized matrix multiply; do
not duplicate `_rigid_bind_pair` and do not scan vertices per face.

Derive the forearm smoke bounds from faces owned by `RightForeArm`:

```python
row = next(i for i, p in enumerate(partitions.partitions)
           if p.name == "RightForeArm")
owned_faces = soup.faces[partitions.face_owners == row]
owned_vertex_ids = np.unique(owned_faces.reshape(-1))
owned_local = transformed_vertices[owned_vertex_ids]
```

Create a closed support box spanning the owned x/z bounds plus 20 mm, from the
owned distal y minimum minus 20 mm through the y midpoint. Pass the complete
transformed body mesh as `source` and that 12-triangle box as `support`. This
avoids making an open triangle crop and bounds the output lattice to the
forearm region. The source's indexed boundary diagnostics remain visible in
the report; the dense sign gates, not a false watertightness claim, qualify the
result. This does not reproduce the full production support-volume design.

Use the partition's 6 mm pitch, at least four output samples of positive margin
around the support box, and dimensions derived endpoint-inclusively from the
bounds. Assert the resulting lattice is below `MAX_DENSE_VOXELS` before
launching Blender.

Run the intersection twice in separate Blender processes. Require explicit
`direct-vdb`, identical normalized metadata/f32/R16F, both signs, no negative
boundary samples, exactly one negative component, and a negative probe at the
deepest result sample. Record source/owned face counts, bind transform,
partition support planes, support-box bounds, pitch, and timing.

- [ ] **Step 5: Implement CLI and atomic report update**

Expose:

```bash
uv run scripts/qualify_blender_sdf_real_sources.py --hand --humanoid \
  --output /absolute/adapter-qualification.json
```

Default behavior runs both sources. `--hand` or `--humanoid` alone limits the
run for diagnosis. The output path must be explicit for tests and defaults to
the checked-in adapter report only for the full two-source run.

Write to a sibling temporary file, parse it back, then use `Path.replace` so a
cancelled Blender process cannot leave a half-written report. Canonical JSON
must sort keys and use a trailing newline. Timings are evidence but excluded
from repeat equality.

Use the following import-safe dataclasses as the in-memory schema, then convert
them to lower-camel-case canonical JSON. This pins the `runs` array used by the
verification commands and downstream consumers:

```python
@dataclasses.dataclass(frozen=True)
class RepeatGate:
    metadata_equal: bool
    f32_equal: bool
    r16f_equal: bool

@dataclasses.dataclass(frozen=True)
class QualificationRun:
    source: Literal[
        "firm-grip-hand-union",
        "humanoid-right-forearm-intersection",
    ]
    passed: bool
    source_sha256: str
    operation_source_sha256: str
    f32_sha256: str
    r16f_sha256: str
    repeat: RepeatGate
    grid: dict[str, Any]
    gates: dict[str, Any]
    source_contract: dict[str, Any]
    timings: dict[str, float]

@dataclasses.dataclass(frozen=True)
class AdapterQualificationReport:
    schema_version: Literal[1]
    generated_at: str
    selected_route: Literal["direct-vdb"]
    passed: bool
    runs: tuple[QualificationRun, QualificationRun]
```

`grid` contains dimensions, metre bounds, measured voxel size, grid/node
contract hashes, and value range. `gates` contains both-sign, boundary,
component, and repeat results. `source_contract` contains every measured
source count/hash, rigid transform, derived support bound, and operation input
hash. The qualifier refuses to serialize a full report unless the runs appear
once each in the literal order shown above.

Add a concise `arrayMeshAdapters` section to the existing Task 1
`qualification.json` containing the adapter report SHA-256, selected route,
both gate statuses, and the exact command. Do not alter Task 1's original
capability or analytic result hashes.

- [ ] **Step 6: Run GREEN and the real qualification twice**

```bash
uv run scripts/test_qualify_blender_sdf_real_sources.py -v
uv run scripts/test_blender_sdf_grid.py -v
uv run scripts/qualify_blender_sdf_real_sources.py --hand --humanoid \
  --output docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-qualification.json
cp docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-qualification.json \
  /tmp/blud-adapter-qualification-first.json
uv run scripts/qualify_blender_sdf_real_sources.py --hand --humanoid \
  --output /tmp/blud-adapter-qualification-second.json
jq -S 'del(.runs[].timings, .generatedAt)' \
  /tmp/blud-adapter-qualification-first.json > /tmp/blud-adapter-a.normalized.json
jq -S 'del(.runs[].timings, .generatedAt)' \
  /tmp/blud-adapter-qualification-second.json > /tmp/blud-adapter-b.normalized.json
cmp /tmp/blud-adapter-a.normalized.json /tmp/blud-adapter-b.normalized.json
git diff --quiet -- docs/dev-notes/2026-08-17-sdf-dynamite-grip/pose-contact-sheet.png
git diff --check
```

Expected: unit suites pass; both real-source gates are `passed`; normalized
reports compare byte-identically; their recorded f32 and R16F hashes match;
the existing grip preview is untouched; no production atlas/runtime asset is
created.

If either source exceeds 300 seconds, any negative sample touches a lattice
boundary, the route drifts, or repeat hashes differ, stop. Preserve the report
as a failed local diagnostic outside git and do not mark `X1.sdf-authoring`
complete.

- [ ] **Step 7: Commit**

```bash
git add scripts/qualify_blender_sdf_real_sources.py \
  scripts/test_qualify_blender_sdf_real_sources.py \
  docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json \
  docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-qualification.json
git commit -m "test(sdf-tools): qualify real mesh adapters"
```

---

### Task 4: Final regression, status handoff, and review

**Files:**

- Modify: `TASKS.md`
- Modify: `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`

- [ ] **Step 1: Run all focused verification from a clean process**

```bash
uv run scripts/test_blender_sdf_grid.py -v
uv run scripts/test_qualify_blender_sdf_real_sources.py -v
uv run scripts/test_bake_humanoid_sdf.py -v
uv run scripts/blender_sdf_grid.py --probe-capabilities
uv run scripts/blender_sdf_grid.py --analytic-fixture
uv run scripts/qualify_blender_sdf_real_sources.py --hand --humanoid \
  --output /tmp/blud-adapter-final.json
npm test
npm run build
git diff --check
```

Expected:

- all Python tests pass, including the original 28 Task 1 tests;
- both real-source adapter gates pass and match the checked-in report hashes;
- Blender 5.2.x is recorded and `direct-vdb` remains selected;
- the Blender SDF Grid Boolean bug remains documented with OpenVDB min/max as
  the workaround;
- the full TypeScript/Vitest suite and production build pass; and
- `git status --short` contains only the intended plan/task files.

- [ ] **Step 2: Inspect the final diff and request code review**

Review specifically for:

- accidental O(V×F) work;
- unchecked mesh sizes or paths;
- input-array mutation;
- route fallback hidden in exception handling;
- transforms applied zero or two times;
- payload hashes that omit source, transform, operation, or grid spec;
- temporary or owner-source artifacts added to git; and
- weakened Task 1 assertions.

Use `superpowers:requesting-code-review`. Address only technically verified
feedback and rerun the affected tests afterward.

- [ ] **Step 3: Update the status board only after every gate is green**

Change `X1.sdf-authoring` to `[x]` and summarize:

- Blender/OpenVDB Task 1 and array adapters are qualified;
- `direct-vdb` is selected;
- booleans use explicit OpenVDB `min`/`max` because Blender 5.2's SDF Grid
  Boolean node is broken;
- analytic, hand-union, and humanoid-intersection repeats are byte-identical;
  and
- Chisel remains optional development tooling, not a production dependency.

Remove only the words `Blocked by X1.sdf-authoring` from
`X1.humanoid-sever-spike` and `X1.hand-followups`. Preserve all other pause,
usage, visual-direction, and performance language. This plan clears a backend
dependency; it does not authorize either large downstream bake.

- [ ] **Step 4: Commit the verified handoff**

```bash
git add TASKS.md docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json
git commit -m "docs(sdf-tools): close grid authoring qualification"
```

## Completion Contract

`X1.sdf-authoring` is complete only when all of the following are true:

- the implementation descends from `4019415` and does not include `cf1d2e7`;
- the original Task 1 suite remains green with unchanged analytic hashes;
- array payload corruption, transform, resource, and route-drift gates are
  tested before Blender execution where possible;
- two- and three-input OpenVDB folds repeat byte-identically;
- the firm-grip union and canonical humanoid/forearm-support intersection each
  pass twice with matching normalized metadata, f32 bytes, and R16F bytes;
- no source preview, temporary payload, production atlas, or runtime asset is
  changed by qualification;
- focused Python, full Vitest, and production build checks pass; and
- the final report and `TASKS.md` accurately state the selected route and
  Blender 5.2 boolean workaround.

## Execution Recommendation

Run Tasks 1–4 serially with review checkpoints. A Codex subagent-driven pass is
the cost-conscious default. If dispatched headlessly, queue four dependent
tasks against the integration base above and use a bounded model/reasoning
setting; GLM 5.3 `max` is not required for these now-explicit tasks. Do not
start downstream humanoid or FPV atlas work automatically when Task 4 finishes.
