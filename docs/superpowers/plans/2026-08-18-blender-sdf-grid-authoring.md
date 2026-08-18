# Blender-Native SDF Grid Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and package a deterministic, headless Blender 5.2 Geometry
Nodes mesh-to-SDF workflow shared by the humanoid and FPV distal-arm bakers.

**Architecture:** A Blender-inner script constructs a pinned Geometry Nodes
graph using Mesh to SDF Grid, SDF Grid Boolean and either Store Named Grid or
Grid to Mesh. A normal-Python outer driver validates source hashes, launches
Blender, converts the chosen result into explicit metre-space samples, and
records a canonical route/transform contract. Direct OpenVDB extraction is
preferred; a zero-threshold, zero-adaptivity mesh round trip plus the existing
libigl sampler is the only allowed fallback.

**Tech Stack:** Blender 5.2.x Python and Geometry Nodes, OpenVDB when exposed by
Blender, Python 3.12 via `uv`, NumPy, libigl 2.6, `unittest`.

**Spec:**
`docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md`

## Global Constraints

- Do not install or purchase an add-on for this spike.
- Construct the node graph from Python; do not depend on an opaque hand-edited
  `.blend` file.
- Pin metres, basis, bounds, voxel size, band width, background, interpolation,
  threshold and adaptivity in the canonical contract.
- Direct-grid output must prove negative-inside/positive-outside samples and an
  explicit index-to-metre transform.
- Mesh fallback must use Grid to Mesh threshold `0.0`, adaptivity `0.0`, then
  the existing winding-number signed sampler.
- Never silently select a route. `direct-vdb` or `grid-to-mesh-libigl` appears
  in every result and downstream manifest.
- Keep temporary VDB/mesh/blend files outside git.

---

### Task 1: Capture RED and qualify Blender's headless SDF node contract

**Files:**
- Create: `scripts/blender_sdf_grid.py`
- Create: `scripts/test_blender_sdf_grid.py`
- Create: `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`
- Create: `docs/dev-notes/2026-08-18-blender-sdf-grid/analytic-preview.png`

**Interfaces:**
- Produces: `SdfGridSpec`, `SdfGridRoute`, `build_node_contract(spec)`,
  `run_blender_sdf(request)`, `run_analytic_fixture(...)`,
  `validate_dense_sdf(result)`, CLI modes
  `--probe-capabilities`, `--blender-inner`, `--analytic-fixture`, and the
  canonical qualification report consumed by both character plans.

- [ ] **Step 1: Write failing import and analytic-contract tests**

```python
class AnalyticGridContractTest(unittest.TestCase):
    def test_cube_has_metre_space_sign_and_surface(self):
        result = SDF.run_analytic_fixture("cube", voxel_size_m=0.01)
        SDF.validate_dense_sdf(result)
        self.assertLess(result.sample((0.0, 0.0, 0.0)), -0.049)
        self.assertGreater(result.sample((0.11, 0.0, 0.0)), 0.009)
        self.assertLess(abs(result.sample((0.05, 0.0, 0.0))), 0.011)

    def test_contract_never_relies_on_node_defaults(self):
        contract = SDF.build_node_contract(SDF.SdfGridSpec.analytic_default())
        for key in ("voxelSizeM", "bandWidth", "backgroundM",
                    "threshold", "adaptivity", "indexToMetres"):
            self.assertIn(key, contract)
```

- [ ] **Step 2: Run RED**

Run: `uv run scripts/test_blender_sdf_grid.py -v`

Expected: FAIL because `scripts/blender_sdf_grid.py` and its interfaces do not
exist.

- [ ] **Step 3: Implement the outer/inner process boundary**

Define import-safe frozen request/result dataclasses before any `bpy` import.
The outer process resolves Blender from `PATH`, creates a task-owned temporary
directory, writes canonical JSON, and invokes:

```bash
blender --background --factory-startup --python scripts/blender_sdf_grid.py -- \
  --blender-inner /absolute/request.json /absolute/result.json
```

The inner process asserts Blender 5.2.x and registration of
`GeometryNodeMeshToSDFGrid`, `GeometryNodeSDFGridBoolean`,
`GeometryNodeGridToMesh` and `GeometryNodeStoreNamedGrid`. It constructs the
node tree, assigns every socket explicitly, evaluates it, and writes capability
and route diagnostics. Imports under normal Python must never import `bpy`.

- [ ] **Step 4: Implement and probe both result routes**

First attempt a named `FloatGrid` volume bake/export and read back its grid
class, transform, background, active values and inactive signed tiles. Add a
deep-interior probe so an active-voxel-only reader fails. If Blender does not
expose a repeatable supported path, capture the exact exception/API absence and
mark Route A unsupported rather than guessing.

For Route B, connect the same final SDF grid to Grid to Mesh with threshold
`0.0` and adaptivity `0.0`, export a triangulated PLY, assert one closed
component/zero boundary edges, and resample it through the existing libigl
winding-number path. Both routes return the same `DenseSdfResult` contract:

```python
@dataclasses.dataclass(frozen=True)
class DenseSdfResult:
    route: Literal["direct-vdb", "grid-to-mesh-libigl"]
    dimensions: tuple[int, int, int]
    bounds_min_m: tuple[float, float, float]
    bounds_max_m: tuple[float, float, float]
    voxel_size_m: tuple[float, float, float]
    values_f32: np.ndarray
    source_sha256: str
    node_contract_sha256: str
```

- [ ] **Step 5: Run analytic, boolean and transform gates**

Test a cube, sphere, overlapping pair union, body/support intersection, rotated
input and translated input. Pin sign, expected bounds, zero-surface error,
connected components and index-to-metre round trips. Run the complete analytic
fixture twice and compare canonical JSON plus encoded R16F bytes.

- [ ] **Step 6: Record qualification and commit**

The report records Blender version, available nodes, Route A result/reason,
selected route, commands, node contract, dimensions, timings, hashes, maximum
analytic surface error and repeated-run equality. Inspect the preview, run
`git diff --check`, then commit:

```bash
git add scripts/blender_sdf_grid.py scripts/test_blender_sdf_grid.py \
  docs/dev-notes/2026-08-18-blender-sdf-grid
git commit -m "feat(sdf-tools): qualify Blender SDF grid authoring"
```

---

### Task 2: Freeze downstream adapters and real-source smoke fixtures

**Files:**
- Modify: `scripts/blender_sdf_grid.py`
- Modify: `scripts/test_blender_sdf_grid.py`
- Modify: `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`

**Interfaces:**
- Consumes: Task 1's selected route and `DenseSdfResult`.
- Produces: `bake_mesh_union_to_dense(...)`,
  `bake_mesh_intersection_to_dense(...)`, `encode_r16f_le(...)`, and immutable
  canonical metadata used by `bake_humanoid_sdf.py` and
  `bake_fpv_distal_arm.py`.

- [ ] **Step 1: Add RED mutation and real-source smoke tests**

Require rejection of changed source hashes, missing/non-finite transforms,
reflections, anisotropic object scale, reordered axes, unsupported Blender
versions, altered node socket values, truncated intermediate output and route
changes. Add bounded smoke fixtures using the firm-grip pose referenced by
`public/assets/lab/hand-sdf-dynamite-grip-r.json` and a small surface crop from
`assets-source/humanoid-sdf/zombie-rigged.glb`; do not bake full production
atlases.

- [ ] **Step 2: Implement the two narrow adapters**

`bake_mesh_union_to_dense` accepts already aligned closed meshes plus one common
grid spec. `bake_mesh_intersection_to_dense` accepts a source mesh and one
closed support mesh in the same local basis. Both return `DenseSdfResult`,
preserve input buffers, and include every source/parameter hash in canonical
metadata. No generic Geometry Nodes DSL is added.

- [ ] **Step 3: Verify repeatability and downstream compatibility**

Run:

```bash
uv run scripts/test_blender_sdf_grid.py -v
uv run scripts/blender_sdf_grid.py --probe-capabilities
uv run scripts/blender_sdf_grid.py --analytic-fixture
git diff --check
```

Expected: all tests PASS; two fixture runs produce identical metadata and R16F
bytes; the report names one selected route; previews show an unmirrored hand
crop and a correctly clipped humanoid support volume.

- [ ] **Step 4: Commit**

```bash
git add scripts/blender_sdf_grid.py scripts/test_blender_sdf_grid.py \
  docs/dev-notes/2026-08-18-blender-sdf-grid
git commit -m "test(sdf-tools): bind Blender grids to character bakers"
```

## Handoff

Do not begin either large atlas bake until this plan is green and reviewed.
The humanoid and FPV plans consume the selected route and canonical node
contract; neither may reimplement or weaken it.
