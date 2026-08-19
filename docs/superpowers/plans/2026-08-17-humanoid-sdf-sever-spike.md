# Textured Humanoid SDF Forearm-Sever Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated WebGPU spike that renders the owner's textured rigged zombie from bone-local SDF/color atlases, scrubs its right elbow through 0–100 degrees, severs a physics-driven distal forearm with matching fleshy cut surfaces and no first-use pause, and takes aimed wounds on the baked flesh through the same layered material as the cut cap.

**Architecture:** A Blender export stage writes bind-pose geometry, UVs, skin weights, texture pixels, skeleton metadata and closed weight-derived support volumes. The qualified Blender 5.2 Geometry Nodes backend converts the complete source body and each support volume to SDF grids, intersects them into tightly packed bone-local bricks, and uses either proven direct OpenVDB samples or the explicit Grid-to-Mesh/libigl fallback. A strict TypeScript loader feeds a dedicated clustered WGSL marcher; pure pose/sever state drives elbow lag, softness, complementary cut masks, and the existing deterministic chunk stepper. The new page remains isolated from the production game and current zombie lab.

**Tech Stack:** TypeScript 5.6, Vitest, Three.js 0.185 WebGPU/TSL, WGSL, Vite 5, Python 3.12 via `uv`, Blender 5.2 Geometry Nodes/Python, OpenVDB when qualified, NumPy 2.5, libigl 2.6 fallback, existing `gib-chunks.ts` physics.

**Spec:** `docs/superpowers/specs/2026-08-17-humanoid-sdf-sever-spike-design.md`

**Wound spec (folded in, owner call 2026-08-19):** `docs/superpowers/specs/2026-08-19-humanoid-sdf-wound-damage-design.md`. It supersedes its own "lands after the gate" sequencing: the spike's owner gate is judging whether a baked representation keeps the procedural zombie's live-wound feel, so the testable build has to carry wounds. Wounds are the LAST slice of this plan (Tasks 8–10), not a parallel one — they consume the atlas, manifest, pose model, cluster marcher and sever masks that Tasks 2–6 produce.

## Global Constraints

- Complete and review `docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md` first. This plan consumes its selected route and canonical node contract; it may not reimplement them or silently switch routes.
- Read the spec, `TASKS.md`, `AGENTS.md`, `scripts/bake_hand_sdf.py`, `src/lab/sdf-zombie/webgpu/hand-volume.ts`, `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, and `src/lab/sdf-zombie/gib-chunks.ts` before editing.
- The canonical owner-created input is `/Users/donny/Downloads/zombietest2/Meshy_AI_zombie_biped/Meshy_AI_zombie_biped_Character_output.glb`, currently 10,234,820 bytes with observed SHA-256 `2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28`. Recompute and verify; never modify Downloads.
- Commit the normalized source GLB and generated atlas assets. Preserve original filename, byte length, and hash in the manifest.
- Use R16F little-endian distance and RGBA8 color. Target pitch is at most 6 mm for torso/limbs and at most 3 mm for head/hands. Never silently coarsen.
- Use a single logical 3D distance atlas and color atlas. Binary transport may be deterministically split into <=64 MiB parts, but the GPU reconstruction must be one texture per logical atlas; this is not multi-page sampling.
- The right elbow overlap is one 30 mm weight-derived planar band. Do not use spherical/capsule end masks that extend deep into the neighboring limb.
- The full spike is WebGPU-only. Missing WebGPU, corrupt assets, invalid fields, or unsupported atlas dimensions are blocking errors, not mesh fallbacks.
- All detached render objects, materials, shader variants, physics state, and proxy geometry must exist and be warmed before **Sever Forearm** becomes enabled.
- Pressing sever must not change pipeline/material creation counters and must not produce a deterministic frame above 50 ms from first-use work.
- Atlas bytes, bake time, and steady GPU time are reported diagnostics. Visual fidelity and no-pause interaction are the gates.
- Do not add walking, torso blasts, multi-wound blast clusters, whole-body gib chains, wound fluid/gushing gore, skeleton reveal, compression/LOD, full soft-body physics, or game integration. Click-to-shoot and single aimed wounds are now IN scope, in Tasks 8–10 only.
- Severing stays the one baked mid-forearm cut plane. Arbitrary cut planes are out of scope.
- The wound slice re-keys `damage.ts`'s model onto bone bricks; it does not re-invent it. `WoundType`, `WOUND_PROFILES`, `pushWound`, `writeWounds()`, the `APPLY_WOUNDS`/`WOUND_MASK`/`CHAR_MASK` WGSL and the `ROW_WOUND`/`ROW_WOUND_META` texel layout are reused. `frame()`, `basisFromAxis`, `qRotate`-on-`prim.orient`, the `bodyYaw` de-yaw/re-yaw threading and the `p.op === 'sub'` carve skip are deliberately NOT ported.
- Every bounds test in the wound path reads `occupiedBoundsMin/Max` derived from the partition's weight-derived bind bounds (`coverage.partitions[].boundsLocalMin/Max`), never `boundsMin/Max` and never a raw `face_owners` owned-face AABB.
- The spike's 50 ms first-use interaction gate extends to the FIRST SHOT after page load, not just the first sever.
- Do not touch unrelated user files. Each task commits only its focused changes on its dispatch branch.

---

### Prerequisite P0: Qualify the shared Blender-native SDF backend

**Plan:** `docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md`

- [ ] Execute both shared tasks and obtain a reviewed
  `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`.
- [ ] Require one explicit selected route (`direct-vdb` or
  `grid-to-mesh-libigl`), passing analytic sign/transform/boolean probes and
  byte-deterministic R16F fixtures.
- [ ] Stop this plan if the shared qualification is absent, failed, uses an
  unpinned Blender version or depends on an opaque manually edited `.blend`.

---

### Task 1: Canonical source export and weight-derived partitions

**Files:**
- Create: `assets-source/humanoid-sdf/zombie-rigged.glb`
- Create: `scripts/bake_humanoid_sdf.py`
- Create: `scripts/test_bake_humanoid_sdf.py`
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/source-report.json`
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/partition-preview.png`

**Interfaces:**
- Consumes: canonical Downloads GLB named in Global Constraints; P0's qualified node contract; the reusable `GridSpec`, `grid_points`, `bake_chunk`, and `validate_field` behavior in `scripts/bake_hand_sdf.py`.
- Produces: `SourceSoup`, `BonePartition`, `JointBand`, `inspect_source(path)`, `derive_joint_band(...)`, `joint_halfspaces(...)`, `support_mesh(...)`, `inside_support(...)`, `derive_partitions(source)`, `export_source_npz(path)`, and CLI modes `--inspect-only`, `--blender-export`, and `--render-partitions`; Task 2 imports these symbols directly.

- [ ] **Step 1: Copy and hash the canonical owner asset without changing it**

Run:

```bash
mkdir -p assets-source/humanoid-sdf
cp /Users/donny/Downloads/zombietest2/Meshy_AI_zombie_biped/Meshy_AI_zombie_biped_Character_output.glb assets-source/humanoid-sdf/zombie-rigged.glb
shasum -a 256 assets-source/humanoid-sdf/zombie-rigged.glb
cmp /Users/donny/Downloads/zombietest2/Meshy_AI_zombie_biped/Meshy_AI_zombie_biped_Character_output.glb assets-source/humanoid-sdf/zombie-rigged.glb
```

Expected: `cmp` exits 0 and the recomputed digest equals the observed digest, or the task stops and reports the actual digest before authoring a manifest.

- [ ] **Step 2: Write failing import/partition tests**

Create `scripts/test_bake_humanoid_sdf.py` as a PEP 723 `unittest` script with `libigl==2.6.2`, `numpy==2.5.2`, and Pillow. Load the baker through `importlib.util` like `scripts/test_bake_hand_sdf.py`. Include these concrete contracts:

```python
class SourceContractTest(unittest.TestCase):
    def test_real_owner_glb_has_required_rig_texture_and_topology(self):
        info = BAKE.inspect_source(BAKE.SOURCE_GLB)
        self.assertEqual(info.vertex_count, 62166)
        self.assertEqual(info.triangle_count, 98003)
        self.assertEqual(info.joint_count, 24)
        self.assertEqual(info.texture_size, (2048, 2048))
        self.assertIn("RightArm", info.bone_names)
        self.assertIn("RightForeArm", info.bone_names)
        self.assertIn("RightHand", info.bone_names)

class PartitionContractTest(unittest.TestCase):
    def test_right_elbow_uses_one_30mm_planar_overlap(self):
        points = np.array([
            [-0.040, 0.0, 0.0], [-0.012, 0.0, 0.0],
            [ 0.000, 0.0, 0.0], [ 0.012, 0.0, 0.0],
            [ 0.040, 0.0, 0.0],
        ])
        parent_w = np.array([0.95, 0.62, 0.50, 0.38, 0.05])
        child_w = 1.0 - parent_w
        band = BAKE.derive_joint_band(
            "RightArm", "RightForeArm", points, parent_w, child_w,
            axis=np.array([1.0, 0.0, 0.0]), width_m=0.030,
        )
        self.assertAlmostEqual(band.width_m, 0.030, places=9)
        self.assertAlmostEqual(np.linalg.norm(band.axis), 1.0, places=9)
        np.testing.assert_allclose(band.center, np.zeros(3), atol=1e-9)

    def test_halfspace_support_has_only_the_declared_overlap(self):
        parent, child = BAKE.joint_halfspaces(
            center=np.zeros(3), axis=np.array([1.0, 0.0, 0.0]), width_m=0.030)
        self.assertTrue(BAKE.inside_support(np.array([ 0.014, 0, 0]), parent))
        self.assertTrue(BAKE.inside_support(np.array([-0.014, 0, 0]), child))
        self.assertFalse(BAKE.inside_support(np.array([ 0.050, 0, 0]), parent))
        self.assertFalse(BAKE.inside_support(np.array([-0.050, 0, 0]), child))
```

Add `test_support_mesh_is_closed_outward_and_matches_halfspaces`: construct the
same synthetic band inside `[-0.1, 0.1]^3`, call `support_mesh`, require every
edge incidence to equal two, signed volume to be positive, all vertices to
satisfy the declared planes within `1e-9`, and points at ±50 mm on the rejected
side to lie outside. This test must fail before `support_mesh` exists.

The fixture must encode actual dominant and secondary skin weights around a synthetic parent/child joint; do not make the tests call the implementation to construct their expected planes.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run: `uv run scripts/test_bake_humanoid_sdf.py -v`

Expected: import succeeds, then tests fail because the new dataclasses/functions are absent.

- [ ] **Step 4: Implement the deterministic Blender export contract**

In `scripts/bake_humanoid_sdf.py`, define these import-safe types and constants before any Blender-only import:

```python
SOURCE_GLB = REPO_ROOT / "assets-source/humanoid-sdf/zombie-rigged.glb"
OUT_DIR = REPO_ROOT / "public/assets/lab/humanoid-sdf"
ELBOW_OVERLAP_M = 0.030
LIMB_PITCH_M = 0.006
DETAIL_PITCH_M = 0.003
MARGIN_M = 0.012

@dataclasses.dataclass(frozen=True)
class SourceInfo:
    vertex_count: int
    triangle_count: int
    joint_count: int
    bone_names: tuple[str, ...]
    texture_size: tuple[int, int]
    source_sha256: str
    texture_sha256: str

@dataclasses.dataclass(frozen=True)
class SourceSoup:
    vertices: np.ndarray       # (V,3) model metres
    faces: np.ndarray          # (F,3) uint32
    face_uvs: np.ndarray       # (F,3,2), GLB UV convention recorded
    joints: np.ndarray         # (V,4) joint slots
    weights: np.ndarray        # (V,4), normalized
    bone_names: tuple[str, ...]
    parents: tuple[int, ...]
    inverse_bind: np.ndarray   # (B,4,4)
    albedo_rgba: np.ndarray    # (H,W,4) uint8
    base_color_factor: np.ndarray  # (4,) float64
    texture_transform: np.ndarray  # (3,3) homogeneous UV transform

@dataclasses.dataclass(frozen=True)
class JointBand:
    parent: str
    child: str
    center: np.ndarray
    axis: np.ndarray
    width_m: float

@dataclasses.dataclass(frozen=True)
class BonePartition:
    name: str
    joint_index: int
    parent_index: int
    bind_to_model: np.ndarray
    model_to_bind: np.ndarray
    support_planes: np.ndarray  # (N,4), inside when dot(n,p)+w <= 0
    pitch_m: float
```

Follow `bake_hand_sdf.py`'s outer/inner process split. Plain Python's `inspect_source` creates a temporary NPZ and invokes the same file through `blender --background --python ... -- --blender-export <npz>`; it then loads the NPZ and returns `SourceInfo`. The Blender-only branch must be guarded so importing the module under `uv` never imports `bpy`. Resolve `blender` from `PATH` and fail with the exact attempted command if it is unavailable.

The `--blender-export` stage must import the GLB into a clean Blender scene, locate all mesh primitives sharing the one skin, triangulate without applying pose animation, preserve face-corner UVs, normalize weights, extract skeleton parentage/inverse binds, decode the base-color image to RGBA8, preserve the material's base-color factor and `KHR_texture_transform` as explicit arrays, and write one `.npz`. It hard-fails on a missing UV, texture, skin, inverse bind, non-finite value, or inconsistent skeleton.

- [ ] **Step 5: Implement weight-derived planar support regions**

`derive_partitions(source)` must:

1. compute dominant and runner-up bones per vertex from normalized weights;
2. derive each parent/child boundary centre from vertices whose two leading bones are that pair and whose weight difference is <=0.15;
3. use the measured joint-to-child direction as the normalized plane axis;
4. create local oriented bounds from dominant-weight surface points;
5. expand parent and child bounds by 15 mm toward each other, yielding exactly 30 mm total elbow overlap;
6. add planar half-spaces at parent/child boundaries rather than spherical endcaps;
7. assign faces with no strong dominant weight to the strongest adjacent partition deterministically, lowest joint index breaking ties;
8. emit `unowned_face_indices` and per-joint coverage diagnostics.

`derive_joint_band` is the separately tested pure operation that selects the
`abs(parentWeight - childWeight) <= 0.15` samples, projects their centroid onto
the supplied normalized axis, and returns the named centre/axis/width.
`joint_halfspaces` returns the parent and child plane sets expanded by half the
declared width; this is the only operation allowed to create the elbow overlap.

`inside_support(point, partition)` evaluates all `support_planes`. The support
planes only partition the real source surface and never replace its silhouette;
Task 2 realizes their intersection through the qualified Blender SDF backend.

`support_mesh(partition, brick_bounds)` clips a closed box against the same
planes and emits one finite, outward-wound, manifold support mesh. Its signed
volume must be positive and every retained corner must satisfy
`inside_support`. Task 2 converts this mesh to an SDF and intersects it with the
complete source-body SDF; open partition surface patches are never voxelized as
standalone solids.

- [ ] **Step 6: Run tests GREEN and generate the real source report/preview**

Run:

```bash
uv run scripts/test_bake_humanoid_sdf.py -v
uv run scripts/bake_humanoid_sdf.py --inspect-only
uv run scripts/bake_humanoid_sdf.py --render-partitions
```

The report must include source hash, vertices, triangles, boundary/non-manifold edges, 24 named joints, texture dimensions, bind positions, face ownership, every joint band, and specifically the `RightArm -> RightForeArm -> RightHand` chain. The preview must color partitions distinctly and show the elbow overlap from front and side. Reject any forearm region extending more than 30 mm into the upper arm or vice versa.

- [ ] **Step 7: Commit Task 1**

```bash
git add assets-source/humanoid-sdf/zombie-rigged.glb scripts/bake_humanoid_sdf.py scripts/test_bake_humanoid_sdf.py docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike
git commit -m "feat(sdf-lab): define humanoid bone partitions"
```

---

### Task 2: Deterministic distance and source-color atlases

**Files:**
- Modify: `scripts/bake_humanoid_sdf.py`
- Modify: `scripts/test_bake_humanoid_sdf.py`
- Create: `public/assets/lab/humanoid-sdf/zombie-humanoid.json`
- Create: `public/assets/lab/humanoid-sdf/zombie-distance-*.r16f`
- Create: `public/assets/lab/humanoid-sdf/zombie-color-*.rgba8`
- Create: `public/assets/lab/humanoid-sdf/zombie-coarse.f32`
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/bake-report.json`
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/bind-textured-preview.png`

**Interfaces:**
- Consumes: Task 1 `SourceSoup`, `BonePartition`, `JointBand`, `derive_partitions`, `support_mesh`; P0 `bake_mesh_intersection_to_dense`, `DenseSdfResult`, selected route and canonical node contract; plus the canonical source asset.
- Produces: manifest version 1 with `kind: "humanoid-bone-sdf"`; `support_mesh`, `BrickRequest`, `AtlasBrick`, `AtlasLayout`, `pack_bricks`, `layout_has_overlap`, `barycentric_uv`, `sample_bone_brick`, `sample_surface_color`, `sample_rgba_bilinear`, `bake_distance_and_color`, `resample_coarse_brick`, `build_manifest_dict`, `validate_checked_in`; real checked-in R16F/RGBA8 logical atlases plus the coarse f32 brick pack for Tasks 3 and 10.

**Two carried-forward requirements this task must absorb (read before starting):**

1. **`support_mesh` does not exist yet.** Task 1's declared interface promised it, but only `derive_joint_band`, `joint_halfspaces` and `inside_support` landed in `scripts/bake_humanoid_sdf.py`; the per-partition `supportPlanes` are recorded in `source-report.json` and nothing consumes them. This task implements it, and Task 1's unwritten test `test_support_mesh_is_closed_outward_and_matches_halfspaces` comes with it.
2. **The coarse CPU brick is a requirement of this pass, not a later add-on.** It is emitted here so the manifest never needs a version bump plus a full byte-determinism revalidation to acquire it. See Step 4b.

- [ ] **Step 1: Write failing grid, packing, color, and manifest tests**

Add concrete tests before implementation:

```python
class AtlasPackingTest(unittest.TestCase):
    def test_pack_is_deterministic_non_overlapping_and_padded(self):
        specs = [
            BAKE.BrickRequest("Torso", (41, 80, 30)),
            BAKE.BrickRequest("RightHand", (32, 25, 18)),
            BAKE.BrickRequest("Head", (35, 42, 33)),
        ]
        a = BAKE.pack_bricks(specs, max_dim=256, padding=2)
        b = BAKE.pack_bricks(list(reversed(specs)), max_dim=256, padding=2)
        self.assertEqual(a.to_json(), b.to_json())
        self.assertFalse(BAKE.layout_has_overlap(a))
        self.assertTrue(all(min(x.offset) >= 2 for x in a.bricks))

class ColorProjectionTest(unittest.TestCase):
    def test_bilinear_rgba_sampling_pins_uv_orientation(self):
        tex = np.array([
            [[255, 0, 0, 255], [0, 255, 0, 255]],
            [[0, 0, 255, 255], [255, 255, 255, 255]],
        ], dtype=np.uint8)
        rgba = BAKE.sample_rgba_bilinear(tex, np.array([[0.0, 0.0], [1.0, 1.0], [0.5, 0.5]]))
        np.testing.assert_array_equal(rgba[0], np.array([255, 0, 0, 255], dtype=np.uint8))
        np.testing.assert_array_equal(rgba[1], np.array([255, 255, 255, 255], dtype=np.uint8))
        np.testing.assert_allclose(rgba[2], np.array([128, 128, 128, 255]), atol=1)

    def test_barycentric_uv_uses_all_three_face_corners(self):
        uv = BAKE.barycentric_uv(
            np.array([[0.2, 0.3, 0.5]]),
            np.array([[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]]),
        )
        np.testing.assert_allclose(uv[0], np.array([0.3, 0.5]), atol=1e-12)

class ManifestTest(unittest.TestCase):
    def test_real_checked_in_assets_validate(self):
        result = BAKE.validate_checked_in()
        source = BAKE.inspect_source(BAKE.SOURCE_GLB)
        self.assertEqual(result["kind"], "humanoid-bone-sdf")
        self.assertEqual(result["boneCount"], 24)
        self.assertLessEqual(result["maxLimbPitchM"], 0.006 + 1e-9)
        self.assertLessEqual(result["maxDetailPitchM"], 0.003 + 1e-9)
        self.assertEqual(result["unownedFaces"], 0)
        self.assertEqual(result["pageCount"], 1)
        self.assertEqual(result["sourceTextureSha256"], source.texture_sha256)
```

Also test R16F little-endian order, RGBA8 x-fastest-y-z order, <=64 MiB transport part splitting/reassembly, per-part and combined hashes, positive brick boundaries, negative interiors, real atlas byte lengths, and rejection of a part reordered or truncated by one byte. Mutation tests must reject a changed Blender version, selected route, node-contract hash, SDF grid transform, threshold, adaptivity or support-mesh hash.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `uv run scripts/test_bake_humanoid_sdf.py -v`

Expected: the new atlas/manifest tests fail for missing functions and outputs while Task 1 tests remain green.

- [ ] **Step 3: Implement Blender-native bone-local SDF intersections and source-color sampling**

For each `BonePartition`, build an endpoint-inclusive local grid over its dominant-weight points plus 12 mm exterior margin. Use 3 mm pitch for bone names containing `Head` or `Hand`; use 6 mm for all others. Transform the complete source mesh into the bone's bind-local basis, create `support_mesh(partition, bounds)`, and call P0's qualified adapter:

```python
dense = bake_mesh_intersection_to_dense(
    source_mesh=source_mesh_in_bone_bind,
    support_mesh=support_mesh(partition, brick_bounds),
    grid_spec=GridSpec(bounds=brick_bounds, voxel_size_m=pitch_m),
    required_route=qualification.selected_route,
    required_contract_sha256=qualification.node_contract_sha256,
)
bone_sdf = dense.values_f32
```

**This line was stale and is corrected here.** The Blender graph converts each
mesh with its own **Mesh to SDF Grid** tree, bakes each grid to disk, and folds
them with an explicit OpenVDB `combine(max)` read back through Blender's bundled
`openvdb` module. `GeometryNodeSDFGridBoolean` is REGISTERED BUT DELIBERATELY
UNUSED: in Blender 5.2.0 headless it evaluates to its Grid 2 input regardless of
operation, measured across four wirings. A `Join Geometry` + single Mesh to SDF
Grid shortcut is also wrong for overlapping inputs — OpenVDB distances hit the
internal faces of the joined soup (measured: overlap centre reads −0.01 instead
of −0.05). All of this is already handled inside
`bake_mesh_intersection_to_dense`; call it and do not rewire the graph.

Direct-grid mode consumes the resulting signed metre-space values. Fallback mode
polygonizes that exact intersection with threshold zero/adaptivity zero and
invokes the existing libigl winding-number sampler only for the final dense grid.
No standalone open bone patch is a signing input.

**Measured closedness of the canonical source (2026-08-19, probe on the checked-in
GLB — do not re-derive, but do re-check if the source hash changes).** After a
1 um positional weld the body is ONE connected component with a positive signed
volume of 0.137 m3, but it is NOT closed: `welded_mesh_info()` reports 137 edges
with an incidence other than two, which splits into **76 true boundary edges in
44 distinct pinhole loops** plus **61 non-manifold edges**. Every loop is 2–5
vertices spanning 1–8 mm — dropped triangles from the source generator, not open
cuffs, hems, or a hollow interior. The raw indexed count of 26,985 is UV-seam
vertex splitting and is meaningless; this is exactly why the qualification says
to judge with `welded_mesh_info()`.

Where the holes are, by dominant-weight bone (boundary-loop vertices):
`LeftHand` 54, `Head` 26, `LeftShoulder` 17, `RightLeg` 10, `LeftLeg` 4,
`RightToeBase` 3, `RightArm` 2, `Hips` 2, `LeftForeArm` 2. **`RightForeArm` and
`RightHand` have none**, which is why the qualification's humanoid
`RightForeArm` intersection came back with exactly one negative component and
repeated byte-identically. The spike's critical chain is clean.

What this means for you:

- Do **not** pre-emptively repair the mesh. Every pinhole is at or below the
  6 mm limb pitch and most are below the 3 mm detail pitch, so the level-set
  conversion may well bridge them. Measure first.
- The **per-operand interior gate is what catches a sign leak.** A bone whose
  source operand bakes as an unsigned shell will show a collapsed negative-voxel
  count against its support operand — the hand-soup signature was 302 of 38,702.
  `Head` and `LeftHand` are the two bricks most at risk. `Head` matters most: it
  is a 3 mm detail brick and the face is a visual gate item.
- If a brick does fail the gate, the fix is to fill **only** that brick's pinhole
  loops (each is a 2–5 vertex ring; fan-triangulate it) and re-bake, and to record
  the fill in `bake-report.json`. It is NOT to weaken the gate, coarsen the pitch,
  switch routes, or fall back to libigl.

Use libigl closest-triangle queries against the original source mesh only for
color projection. `sample_surface_color` computes barycentric coordinates on
the returned source triangle, interpolates its three face-corner UVs, applies
the exported GLB texture transform and base-color factor, resolves the recorded
V-axis convention once, and bilinearly samples the RGBA8 base color. Fill the
complete brick so trilinear color is defined on both sides of the isosurface.

**`support_mesh(partition, bounds)` must produce a GEOMETRICALLY closed operand.**
Build it as the convex polytope of the partition's recorded `supportPlanes`
intersected with the brick bounds box, emitted as an outward-wound manifold
triangle mesh. This is not a style preference: `X1.sdf-authoring` measured that
Blender's **Mesh to SDF Grid** emits an *unsigned shell* rather than a solid
when handed an operand with a real hole — the hand soup kept 66 boundary edges
after a 1 um weld and contributed 302 of 38,702 negative voxels. Judge closedness
with `blender_sdf_grid.welded_mesh_info()`, never raw indexed boundary edges, and
fail the bake loudly on a nonzero boundary-edge count. Reuse
`blender_sdf_grid.closed_box_mesh` for the degenerate all-planes-cull case.

Each brick must independently pass finite/negative-core/positive-boundary validation, and additionally a **per-operand interior gate**: both the source mesh and the support mesh must each contribute a plausible negative-voxel count on their own, so a silently unsigned operand cannot pass by riding the other one's interior. At every declared joint, probe the two brick fields along the measured axis and require simultaneous inside coverage within the overlap but not 50 mm across the boundary.

- [ ] **Step 4: Implement deterministic 3D packing and transport parts**

Define:

```python
@dataclasses.dataclass(frozen=True)
class BrickRequest:
    bone: str
    dims: tuple[int, int, int]

@dataclasses.dataclass(frozen=True)
class AtlasBrick:
    bone: str
    dims: tuple[int, int, int]
    offset: tuple[int, int, int]
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]
    voxel: tuple[float, float, float]

@dataclasses.dataclass(frozen=True)
class AtlasLayout:
    dimensions: tuple[int, int, int]
    padding: int
    bricks: tuple[AtlasBrick, ...]
```

Sort candidates by descending volume then bone name. Place with deterministic first-fit 3D shelves, searching supported power-of-two-ish containers from smallest voxel capacity upward without exceeding the target adapter's 3D dimension limit recorded by the task. Distance and color use the identical offsets/dimensions. Empty atlas texels are positive distance and transparent black color.

Write logical bytes in x-fastest-y-z order. Split transport files at 64 MiB boundaries without changing the logical concatenated byte stream. The manifest records ordered `parts: [{url, byteLength, sha256}]`, `combinedByteLength`, and `combinedSha256` separately for distance and color.

Build deterministic runtime metadata in the same pass. Record the exported source-to-runtime and inverse basis matrices, source texture-pixel hash, Blender version, selected SDF route, canonical node-contract hash, support-mesh hashes, every numeric bake parameter, each brick's padding/page index/occupied local bounds/field stats, and a one-page atlas count. Build clusters that cover every retained bone exactly once as a primary member, add only directly adjacent joint bones as helpers, cap each cluster at four sampled bones, and emit conservative bind/sweep bounds. The named right-arm cluster must contain `RightArm`, `RightForeArm`, and `RightHand` and its sweep bounds must include the measured 0–100 degree flexion plus maximum warp.

Derive the sever plane deterministically in `RightForeArm` bind-local space: use the normalized proximal-to-distal forearm axis, place the plane halfway between the occupied forearm bounds projected onto that axis, and store its normalized `[nx, ny, nz, w]`. Store `cutSeed: 12648430`, `irregularityM: 0.004`, and `rimWidthM: 0.008` in the right-arm manifest section; Tasks 4–7 consume these values and may not invent replacements.

- [ ] **Step 4b: Emit the coarse CPU distance bricks and the occupied bounds**

The click-to-shoot path in Task 10 needs a CPU-readable field. The 33.5 MiB R16F
distance atlas is a GPU upload and stays one; instead resample each retained
bone's brick to a coarse f32 grid in the same pass:

```python
def resample_coarse_brick(dense_f32, dims, max_dim: int = 16) -> tuple[np.ndarray, tuple[int, int, int]]:
    """Trilinear resample a bone's dense field to at most `max_dim` per axis,
    preserving the brick's aspect ratio (never up-sampling a short axis)."""
```

Requirements:

- At most 16 per axis, f32, little-endian, x-fastest-y-z — the same logical
  ordering as the R16F atlas so one reader convention serves both. Roughly
  16 KiB per bone and ~350 KiB for 22 bones.
- Concatenated into one `zombie-coarse.f32` transport file in `manifest.bones[]`
  array order, with per-bone `{offset, dims, byteLength}` plus a
  `combinedByteLength` and `combinedSha256` in the manifest — the identical hash
  contract the distance/color atlases use. A truncated or reordered coarse pack
  must be rejected by `validate_checked_in()` exactly as a bad atlas part is.
- Values are metre-space signed distance in the bone's BIND-LOCAL frame, so the
  Task 10 sphere-trace runs in bind-local with no extra transform.
- Record the achieved pitch per bone in `bake-report.json`. A 16³ brick over a
  forearm is roughly 20 mm; that is the accuracy Task 10's refinement step is
  budgeted against.

In the same pass, record per bone in the manifest:

- `occupiedBoundsMin/Max` — the tight occupied region, derived from the
  partition's **weight-derived bind bounds** (`coverage.partitions[].boundsLocalMin/Max`),
  NOT from a `face_owners` owned-face AABB. The owned-face AABB was historically
  contaminated (a body-sized 0.60 x 0.43 x 0.73 m `RightForeArm` box swallowing
  11,872 `Hips` faces) by the `_edge_adjacency` defect fixed in `01fd701`; the
  weight-derived bounds never depended on face ownership at all and are the
  stable choice. Tasks 8 and 10 broad-phase against these and are forbidden from
  reading `boundsMin/Max`, which carries the exterior margin plus trilinear
  padding and would hand shoulder hits to the spine.

- [ ] **Step 4c: Pin the narrow band at `HUMANOID_BAND_WIDTH = 16`**

`blender_sdf_grid.DEFAULT_BAND_WIDTH` is 6, which clamps the field at ±36 mm on
a 6 mm limb brick and **±18 mm on a 3 mm detail brick**. That is narrower than
ONE coarse voxel on the head and hands, whose coarse pitch is 20–28 mm. The
coarse resample then cannot localise its zero crossing — neighbouring samples
jump from saturated-negative to saturated-positive with nothing between them —
so Task 10's sphere-trace degrades to roughly half a coarse voxel (~10 mm)
instead of the few millimetres it budgets for. It also caps the marcher's step
length in empty space.

Define `HUMANOID_BAND_WIDTH = 16` in `bake_humanoid_sdf.py` and pass it at the
`SdfGridSpec` site and into `manifest.bake.bandWidth`. **Do not change
`blender_sdf_grid.DEFAULT_BAND_WIDTH`**: that default is pinned by the
`X1.sdf-authoring` analytic fixtures and their byte-determinism hashes, and the
canonical node-contract hash is built from the default spec. Only the humanoid
bricks widen.

Measured consequences (2026-08-19, band 6 → 16):

- Band becomes ±96 mm on limb bricks and ±48 mm on detail bricks, spanning at
  least 3 coarse voxels on every bone (worst: `Head` 3.5, `Spine02` 4.2).
- **The isosurface does not move.** Across the whole 8.4 M-voxel atlas: 0 sign
  flips, identical negative count (1,312,790), and a max delta of exactly
  0.000000 mm for every voxel within 15 mm of the surface. The only voxels that
  changed had `|d| >= 15.18 mm` — the far field that used to be clamped.
- Coarse-brick saturation drops from ~50 % to under 10 % on most bones
  (`RightHand` 67.1 → 20.5 %, `Head` 75.4 → 40.9 %), and what remains is almost
  entirely **exterior** saturation in far brick corners, where a conservative
  step is exactly what a sphere tracer wants. Interior saturation is ~0 %
  except `Head` at 5.2 %.
- Bake cost 130.8 s → 182.2 s. The bricks are dense, so storage is unchanged.

Add two guards: a mutation test that a changed `bake.bandWidth` is rejected,
and a test asserting `HUMANOID_BAND_WIDTH == 16`, that it differs from
`SDF.DEFAULT_BAND_WIDTH`, and that the checked-in manifest carries it.

- [ ] **Step 5: Bake, validate, repeat, and render the real asset**

Run:

```bash
uv run scripts/bake_humanoid_sdf.py
uv run scripts/bake_humanoid_sdf.py --validate-only
shasum -a 256 public/assets/lab/humanoid-sdf/zombie-*
cmp <(uv run scripts/bake_humanoid_sdf.py --print-coarse-hash) <(uv run scripts/bake_humanoid_sdf.py --print-coarse-hash)
cp public/assets/lab/humanoid-sdf/zombie-humanoid.json /tmp/zombie-humanoid-first.json
uv run scripts/bake_humanoid_sdf.py
cmp /tmp/zombie-humanoid-first.json public/assets/lab/humanoid-sdf/zombie-humanoid.json
uv run scripts/test_bake_humanoid_sdf.py -v
```

Before accepting byte determinism, exclude wall-clock duration from the hashed/compared manifest or put it only in `bake-report.json`. Render `bind-textured-preview.png` by reconstructing every zero isosurface in bind pose and applying the baked color. Reject missing fingers/face, cuff or hem closures that change the exterior, empty color patches, axis mirroring, or visible partition seams.

- [ ] **Step 6: Record measured evidence and commit Task 2**

`bake-report.json` must list duration, logical and transport bytes, atlas dimensions, per-brick pitch/dimensions/field stats, combined hashes, color coverage, joint probes, source hash, per-bone coarse-brick dims/achieved-pitch/hash, and the per-operand interior counts from the support-mesh gate.

```bash
git add scripts/bake_humanoid_sdf.py scripts/test_bake_humanoid_sdf.py public/assets/lab/humanoid-sdf docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike
git commit -m "feat(sdf-lab): bake textured humanoid bone atlases"
```

---

### Task 3: Strict humanoid atlas loader

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/humanoid-volume.ts`
- Create: `src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts`

**Interfaces:**
- Consumes: Task 2 manifest, ordered distance/color transport parts, and the `zombie-coarse.f32` pack.
- Produces: `HumanoidVolumeManifest`, `HumanoidBrickManifest`, `HumanoidJointManifest`, `HumanoidClusterManifest`, `HumanoidVolumeAssets`, `HumanoidCoarseBricks`, `validateHumanoidVolumeManifest(input)`, `loadHumanoidVolume(url)`, `createRgba8Texture(bits, dims)`, and idempotent `dispose()`; Tasks 4–10 import these exact names.

**Coarse-pack addendum (wound slice dependency).** The loader validates and
exposes the coarse f32 bricks alongside the GPU atlases:

- `HumanoidCoarseBricks` holds one `Float32Array` view per bone plus its `dims`
  and bind-local `boundsMin/Max`, indexed by **`manifest.bones[]` array
  position**, the same index space as `poseMatrices`, `HumanoidPoseState.bones`
  and `humanoid-sever`'s `distalIndices`.
- Validation is as strict as the atlas path: reject a wrong `combinedByteLength`,
  a `combinedSha256` mismatch, a per-bone `offset + byteLength` that overruns the
  pack, any bone whose `dims` exceed 16 per axis, and any non-finite value. These
  are blocking errors, not warnings.
- The coarse bricks stay CPU-side and are never uploaded as a texture.
- `HumanoidBrickManifest` exposes `occupiedBoundsMin/Max` as a required field.
  Add a validator test asserting a manifest missing it is REJECTED, so the wound
  broad phase can never silently fall back to `boundsMin/Max`.

- [ ] **Step 1: Write failing validator tests against the real manifest**

Model the test structure on `hand-volume.test.ts`. Pin literal fields and mutate one field per rejection:

```typescript
describe('validateHumanoidVolumeManifest', () => {
  it('accepts the checked-in owner asset', () => {
    const m = validateHumanoidVolumeManifest(checkedIn);
    expect(m.version).toBe(1);
    expect(m.kind).toBe('humanoid-bone-sdf');
    expect(m.source.sha256).toBe('2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28');
    expect(m.bones).toHaveLength(24);
    expect(m.bones.map(b => b.name)).toEqual(expect.arrayContaining(['RightArm', 'RightForeArm', 'RightHand']));
    expect(m.joints.find(j => j.parent === 'RightArm' && j.child === 'RightForeArm')?.overlapM).toBeCloseTo(0.03, 9);
  });
});
```

Reject wrong kind/version/encoding/order, traversal or absolute part paths, duplicate/missing bones, parent cycles, invalid bind/inverse-bind matrices, non-unit joint axes, wrong elbow overlap, overlapping/out-of-atlas bricks, pitch beyond the approved caps, part or combined byte mismatch, malformed hashes, color/distance layout drift, and clusters with more than four sampled bones.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts`

Expected: fail because the loader module does not exist.

- [ ] **Step 3: Implement exact runtime types and validation**

Use these stable public shapes:

```typescript
export interface HumanoidBrickManifest {
  bone: string;
  jointIndex: number;
  parentIndex: number;
  offset: [number, number, number];
  dimensions: [number, number, number];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxelSize: [number, number, number];
  padding: 2;
  pageIndex: 0;
  occupiedBoundsMin: [number, number, number];
  occupiedBoundsMax: [number, number, number];
  fieldStats: {
    min: number;
    max: number;
    negativeCount: number;
    positiveCount: number;
    boundaryMin: number;
  };
  bindToModel: number[];   // 16 finite column-major values
  modelToBind: number[];   // checked inverse of bindToModel
}

export interface HumanoidBakeParameters {
  limbPitchM: number;
  detailPitchM: number;
  marginM: number;
  jointOverlapM: number;
  atlasPadding: number;
  maxTransportPartBytes: number;
}

export interface HumanoidVolumeManifest {
  version: 1;
  kind: 'humanoid-bone-sdf';
  order: 'x-fastest-y-z';
  source: {
    url: string;
    originalFilename: string;
    byteLength: number;
    sha256: string;
    textureSha256: string;
  };
  sourceToRuntime: number[]; // 16 finite column-major values
  runtimeToSource: number[]; // checked inverse of sourceToRuntime
  bake: HumanoidBakeParameters;
  pageCount: 1;
  atlasDimensions: [number, number, number];
  distance: BinaryAtlasContract & { encoding: 'r16f-le' };
  color: BinaryAtlasContract & { encoding: 'rgba8' };
  bones: HumanoidBrickManifest[];
  joints: HumanoidJointManifest[];
  clusters: HumanoidClusterManifest[];
  rightArm: {
    upperArm: 'RightArm';
    forearm: 'RightForeArm';
    hand: 'RightHand';
    cutPlaneLocal: [number, number, number, number];
    cutSeed: number;
    irregularityM: number;
    rimWidthM: number;
  };
}

export interface BinaryPartContract {
  url: string;
  byteLength: number;
  sha256: string;
}

export interface BinaryAtlasContract {
  parts: BinaryPartContract[];
  combinedByteLength: number;
  combinedSha256: string;
}

export interface HumanoidJointManifest {
  parent: string;
  child: string;
  centerModel: [number, number, number];
  axisModel: [number, number, number];
  overlapM: number;
}

export interface HumanoidClusterManifest {
  name: string;
  primaryBones: string[]; // every retained bone is primary in exactly one cluster
  sampleBones: string[];  // primaries plus direct joint helpers, length 1..4
  sweepBoundsMin: [number, number, number];
  sweepBoundsMax: [number, number, number];
}

export interface HumanoidVolumeAssets {
  manifest: HumanoidVolumeManifest;
  distanceTexture: THREE.Data3DTexture;
  colorTexture: THREE.Data3DTexture;
  boneIndex: ReadonlyMap<string, number>;
  dispose(): void;
}
```

Mirror the baker's rejection rules rather than coercing values. Verify matrix products against identity within `1e-4`, source/runtime basis inversion, exact bake caps, one-page layout, brick padding/page/bounds/stats, joint references, cluster primary coverage and maximum membership, source and texture hashes, normalized cut plane, finite cut parameters, and the exact right-arm mapping.

- [ ] **Step 4: Implement ordered-part loading and texture construction**

Fetch JSON first, validate it before allocation, then fetch each part relative to the manifest URL. Verify per-part bytes/hash, concatenate in declared order, verify combined bytes/hash, and only then allocate textures. R16F uses raw `Uint16Array`; RGBA8 uses raw `Uint8Array`, `THREE.RGBAFormat`, `THREE.UnsignedByteType`, nearest filtering, clamp on all axes, no mipmaps, and unpack alignment 1. Host endianness remains a hard guard for distance.

Stub `fetch` in tests to prove ordering, relative resolution, tamper rejection, length rejection, no texture allocation before validation, correct texture formats/dimensions, and exactly-once-safe disposal.

- [ ] **Step 5: Run focused and adjacent tests GREEN**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts src/lab/sdf-zombie/webgpu/hand-volume.test.ts src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lab/sdf-zombie/webgpu/humanoid-volume.ts src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts
git commit -m "feat(sdf-lab): load humanoid bone atlases"
```

---

### Task 4: Pure elbow, softness, and sever ownership state

**Files:**
- Create: `src/lab/sdf-zombie/humanoid-pose.ts`
- Create: `src/lab/sdf-zombie/humanoid-pose.test.ts`
- Create: `src/lab/sdf-zombie/humanoid-sever.ts`
- Create: `src/lab/sdf-zombie/humanoid-sever.test.ts`

**Interfaces:**
- Consumes: Task 3 `HumanoidVolumeManifest`; existing `Vec3`, quaternion helpers, `Chunk`, `makeChunk`, and `stepChunk`.
- Produces: `HumanoidBonePose`, `HumanoidPoseState`, `makeHumanoidPose`, `stepHumanoidPose`, `poseMatrices`, `jointWorldPosition`, `HumanoidSeverState`, `makeHumanoidSever`, `severForearm`, `stepHumanoidSever`, `resetHumanoidSever`, `SeverRenderState`; Tasks 5–7 consume these exact names.

- [ ] **Step 1: Write failing elbow/softness tests**

```typescript
import { readFileSync } from 'node:fs';
import { validateHumanoidVolumeManifest } from './webgpu/humanoid-volume';

const realManifest = validateHumanoidVolumeManifest(JSON.parse(
  readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
));

it.each([0, 50, 100])('produces finite right-arm poses at %s degrees', deg => {
  const s = makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 });
  const poses = poseMatrices(s, realManifest);
  expect(poses).toHaveLength(realManifest.bones.length);
  expect([...poses].every(Number.isFinite)).toBe(true);
});

it('keeps the weight-derived elbow fixed while the forearm rotates 0..100', () => {
  const p0 = poseMatrices(makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 }), realManifest);
  const p100 = poseMatrices(makeHumanoidPose(realManifest, { elbowDeg: 100, softness01: 0 }), realManifest);
  const elbow0 = jointWorldPosition(p0, realManifest, 'RightForeArm');
  const elbow100 = jointWorldPosition(p100, realManifest, 'RightForeArm');
  elbow0.forEach((v, i) => expect(v).toBeCloseTo(elbow100[i]!, 6));
  const hand0 = jointWorldPosition(p0, realManifest, 'RightHand');
  const hand100 = jointWorldPosition(p100, realManifest, 'RightHand');
  expect(Math.hypot(...hand0.map((v, i) => v - hand100[i]!))).toBeGreaterThan(0.001);
});

it('critically damps toward the target and never overshoots at moderate softness', () => {
  let s = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0.5 });
  const samples: number[] = [];
  for (let i = 0; i < 180; i++) { s = stepHumanoidPose(s, { elbowTargetDeg: 100, softness01: 0.5 }, 1 / 60); samples.push(s.elbowDeg); }
  expect(Math.max(...samples)).toBeLessThanOrEqual(100 + 1e-6);
  expect(samples.at(-1)).toBeCloseTo(100, 1);
});
```

Also test dt<=0/NaN no-op, dt clamping, 0–1 softness clamping, quaternion normalization, unchanged bind pose for non-right-arm bones, and deterministic motion for identical input sequences.

- [ ] **Step 2: Write failing sever/physics tests**

```typescript
const zeroVelocity = () => ({
  linear: [0, 0, 0] as const,
  angular: [0, 0, 0] as const,
});
const posedAt = (elbowDeg: number, softness01: number) =>
  makeHumanoidPose(realManifest, { elbowDeg, softness01 });

it('transfers exactly once with continuous distal pose and inherited velocity', () => {
  const initial = makeHumanoidSever(realManifest);
  const pose = posedAt(63, 0.55);
  const cut = severForearm(initial, pose, { linear: [0.2, 0.1, 0], angular: [0, 0, 1.4] });
  expect(cut.phase).toBe('detached');
  expect(cut.releaseCount).toBe(1);
  expect(cut.render.attachedCutMode).toBe('proximal');
  expect(cut.render.detachedCutMode).toBe('distal');
  expect(cut.render.cutPlaneLocal).toEqual(realManifest.rightArm.cutPlaneLocal);
  expect(severForearm(cut, pose, zeroVelocity())).toBe(cut);
});

it('steps through the existing limb chunk physics and reset is idempotent', () => {
  let s = severForearm(makeHumanoidSever(realManifest), posedAt(50, 0.5), zeroVelocity());
  s = stepHumanoidSever(s, 1 / 60, false);
  expect(s.chunk?.kind).toBe('limb');
  const reset = resetHumanoidSever(s);
  expect(reset.phase).toBe('intact');
  expect(resetHumanoidSever(reset)).toEqual(reset);
});
```

Test pause physics, impact impulse/jiggle excitation, exponential decay, finite fallback, frozen hand-to-forearm relationship after detach, and proximal skeleton ownership continuing after detach.

- [ ] **Step 3: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/humanoid-pose.test.ts src/lab/sdf-zombie/humanoid-sever.test.ts`

Expected: module-not-found/missing-symbol failures.

- [ ] **Step 4: Implement the pure pose contract**

Use stable state shapes:

```typescript
export interface HumanoidBonePose { position: Vec3; quaternion: Quat }
export interface HumanoidPoseState {
  elbowTargetDeg: number;
  elbowDeg: number;
  elbowVelocityDeg: number;
  softness01: number;
  timeSec: number;
  bones: readonly HumanoidBonePose[];
}

export function jointWorldPosition(
  matrices: Float32Array,
  manifest: HumanoidVolumeManifest,
  boneName: string,
): Vec3;
```

The elbow axis/pivot comes from the manifest `RightArm -> RightForeArm` joint. Apply the elbow delta to `RightForeArm`, `RightHand`, and all descendants in hierarchy order. For softness 0, set angle directly. For softness >0, use a stable critically damped spring with frequency interpolated from 18 Hz at rigid-near to 3 Hz at maximum softness and clamp integration dt to 1/30 s. Surface warp amplitude is not baked into matrices; expose `softness01` and `timeSec` for Task 5 shader uniforms.

- [ ] **Step 5: Implement sever ownership over the existing chunk stepper**

```typescript
export type SeverPhase = 'intact' | 'detached';
export type CutMode = 'none' | 'proximal' | 'distal';
export interface SeverRenderState {
  attachedCutMode: CutMode;
  detachedCutMode: CutMode;
  cutPlaneLocal: readonly [number, number, number, number];
  detachedVisible: boolean;
  jiggleImpulse: number;
}
export interface HumanoidSeverState {
  phase: SeverPhase;
  releaseCount: number;
  chunk: Chunk | null;
  frozenDistalBones: readonly HumanoidBonePose[];
  render: SeverRenderState;
}

export interface ReleaseVelocity {
  linear: Vec3;
  angular: Vec3;
}
```

On sever, compute the distal root at the cut-plane centre, freeze forearm/hand transforms relative to it, create `makeChunk('armR', position, inherited.linear, radius, forearmAxis, seededRng, 'limb')`, then replace the returned chunk's generated `angVel` with `inherited.angular`. This explicit overwrite preserves the supplied angular velocity without changing the existing `makeChunk` API. `stepHumanoidSever` delegates translation/rotation/floor behavior to `stepChunk`, detects impact from the velocity/contact change, and drives a bounded decaying `jiggleImpulse`. Pause returns the same physics pose while allowing the rest of the page to render.

- [ ] **Step 6: Run GREEN and commit Task 4**

```bash
npx vitest run src/lab/sdf-zombie/humanoid-pose.test.ts src/lab/sdf-zombie/humanoid-sever.test.ts src/lab/sdf-zombie/gib-chunks.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/humanoid-pose.ts src/lab/sdf-zombie/humanoid-pose.test.ts src/lab/sdf-zombie/humanoid-sever.ts src/lab/sdf-zombie/humanoid-sever.test.ts
git commit -m "feat(sdf-lab): model humanoid elbow and sever state"
```

---

### Task 5: Textured clustered humanoid marcher and elbow view

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts`
- Create: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/humanoid-view.ts`
- Create: `src/lab/sdf-zombie/webgpu/humanoid-view.test.ts`

**Interfaces:**
- Consumes: Task 3 `HumanoidVolumeAssets`; Task 4 `HumanoidPoseState`, `HumanoidBonePose`, and `poseMatrices`; existing `createLabRenderer` conventions and `three/webgpu` single-import rule.
- Produces: WGSL `HUMANOID_HELPERS`, `MARCH_HUMANOID`; `HumanoidView`, `HumanoidResourceCounts`, `createHumanoidView(assets)`, `setPose`, `setSoftness`, `setTime`, `setCut`, `setDetachedTransform`, `setVisible`, `warmupObjects`, `resourceCounts`, and `dispose`; Task 6 extends cut behavior and Task 7 wires the page.

- [ ] **Step 1: Write failing WGSL contract and CPU-mirror tests**

Following `march.wgsl.test.ts`, require every helper to begin with `fn`, be dependency ordered, avoid the existing reserved-word list, and be referenced by `MARCH_HUMANOID`. Pin these behaviors:

```typescript
expect(MARCH_HUMANOID).toContain('sampleDistanceBrick');
expect(MARCH_HUMANOID).toContain('sampleColorBrick');
expect(MARCH_HUMANOID).toContain('jointBlendWeight');
expect(MARCH_HUMANOID).toContain('surfaceWarp');
expect(MARCH_HUMANOID).toContain('cutField');
expect(MARCH_HUMANOID).toContain('tornCapMaterial');
```

Add a CPU mirror fixture with two overlapping sphere/bricks proving hard-min outside the declared band, conservative smooth-min inside it, identical color weights, complementary proximal/distal plane masks, and finite outside-atlas distance.

- [ ] **Step 2: Write failing view lifecycle tests**

Construct tiny 8³ distance/color textures and a two-bone manifest. Assert `createHumanoidView` creates one attached group and one hidden detached group, all cluster meshes are created immediately, pose updates mutate uniforms/data rather than object identity, `resourceCounts().materials` is stable across `setPose`, and `dispose` releases each view-owned descriptor texture/geometry/material exactly once. The view must not dispose the shared distance/color atlases; `HumanoidVolumeAssets.dispose()` remains their sole owner.

- [ ] **Step 3: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts`

- [ ] **Step 4: Implement the bone-atlas WGSL field**

Use one descriptor `DataTexture` with fixed rows per bone for pose position/quaternion, brick offset/dimensions, bounds min/inverse extent, and active/cut metadata. A cluster contains at most four literal bone indices from the validated manifest. For each candidate bone:

1. transform world point by the conjugate bone quaternion into bind-local space;
2. reject outside local bounds with a conservative metric distance;
3. manually trilinear-sample eight R16F atlas texels at `brick.offset + localIndex`;
4. apply bounded bone-local `surfaceWarp` only inside a four-amplitude surface shell;
5. combine adjacent bones with smooth-min only inside their declared joint band; otherwise hard-min;
6. retain the two dominant samples and blend their eight-tap RGBA8 colors using the identical distance/joint weights;
7. return distance plus material metadata for hit shading.

The marcher writes real WebGPU depth exactly as `zombie-gpu.ts` does. Start with the existing latex lighting constants, multiply exterior albedo by the baked color in linear space, and reserve explicit skin-edge/wet-flesh/deep colors for Task 6 cut shading. No import may mix `three` with `three/webgpu`.

- [ ] **Step 5: Implement clustered proxy views and uniform uploads**

Expose one stable lifecycle contract:

```typescript
export interface HumanoidResourceCounts {
  materials: number;
  geometries: number;
  textures: number;
  attachedClusters: number;
  detachedClusters: number;
  compileCalls: number;
}

export interface HumanoidView {
  readonly attachedGroup: THREE.Group;
  readonly detachedGroup: THREE.Group;
  readonly detachedVisible: boolean;
  readonly attachedCutMode: CutMode;
  readonly detachedCutMode: CutMode;
  setPose(state: HumanoidPoseState): void;
  setSoftness(value01: number): void;
  setTime(timeSec: number): void;
  setCut(state: SeverRenderState): void;
  setDetachedTransform(position: Vec3, quaternion: Quat): void;
  setVisible(visible: boolean): void;
  warmupObjects(): readonly THREE.Object3D[];
  resourceCounts(): HumanoidResourceCounts;
  dispose(): void;
}
```

`createHumanoidView` builds one proxy box per manifest cluster, expanded for its `sweepBounds` and maximum softness amplitude. Every attached cluster exists at load. A detached right-arm proxy, using the same distance/color textures and the same material graph, also exists but is hidden. Create materials before exposing the view; identical node graphs should hit Three's pipeline cache, but the view still reports the actual number of NodeMaterial instances created.

Use fixed typed arrays/data textures allocated once. `setPose` writes all bone transforms and marks one descriptor texture dirty. It must not replace textures, materials, geometries, arrays, or cluster objects. `setSoftness` and `setTime` only update uniforms.

- [ ] **Step 6: Run focused tests, typecheck, and a static WebGPU smoke**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts
npx tsc --noEmit
```

Create a temporary minimal bootstrap only if needed for this task's smoke; do not add the final HTML yet. Load the real asset in a headed WebGPU browser, render bind pose plus 0/50/100 degree elbow captures, and reject shader warnings, blank output, mirrored texture, elbow impalement, texture swimming, volume pumping, or proxy clipping. Save evidence under the existing spike dev-note directory.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike
git commit -m "feat(sdf-lab): render textured humanoid bone volumes"
```

---

### Task 6: Complementary cut surfaces, detached view, and prewarm gate

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-view.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-view.test.ts`
- Modify: `src/lab/sdf-zombie/humanoid-sever.ts`
- Modify: `src/lab/sdf-zombie/humanoid-sever.test.ts`

**Interfaces:**
- Consumes: Task 4 `SeverRenderState`/chunk transform and Task 5 `HumanoidView`.
- Produces: final `HumanoidView.setCut(renderState)`, `setDetachedChunk(chunk, frozenDistalBones)`, `prewarm(renderer, scene, camera): Promise<PrewarmReport>`, `PrewarmReport`, stable material/pipeline counters, matching layered caps; Task 7 calls these APIs without creating render resources.

- [ ] **Step 1: Add failing complementary-cut and cap tests**

Extend the CPU mirror across a deterministic 3D grid. For each point, require that intact occupancy equals the union of proximal and distal occupancy except inside a <=2-voxel analytic rim tolerance; require both masks to use the exact manifest plane and seed. Pin shader source references to one `cutNoise` function shared by both signs and explicit skin/rim/meat/deep material bands.

Add view tests proving:

```typescript
const before = view.resourceCounts();
view.setCut(detachedRenderState);
view.setDetachedChunk(chunk, frozenBones);
const after = view.resourceCounts();
expect(after).toEqual(before);
expect(view.detachedVisible).toBe(true);
expect(view.attachedCutMode).toBe('proximal');
expect(view.detachedCutMode).toBe('distal');
```

Test reset hides/re-parks without disposal/recreation and repeated sever/reset cycles leave counters constant.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts src/lab/sdf-zombie/humanoid-sever.test.ts`

- [ ] **Step 3: Implement complementary irregular masks and layered cap shading**

Evaluate the cut in `RightForeArm` bind-local space. Let `planeD` be the signed plane distance and `jagged` one deterministic low-frequency value from bind-local position plus manifest seed. Use one perturbed distance `q = planeD + jagged * irregularityM`:

- attached/proximal field: `max(bodyD, q)`;
- detached/distal field: `max(bodyD, -q)`.

The rim band is the intersection of the original flesh shell and `abs(q) < rimWidth`; it may add a small everted lip but cannot change the complementary ownership mask. The cap material uses distance from the original exterior plus radial depth to blend exterior skin edge -> wet red tissue -> dark centre. Baked exterior albedo is disabled only on the new cap.

Surface wobble and impact jiggle operate in the same forearm-local coordinates for both pieces at sever time. After detach, the distal coordinates remain frozen under the chunk root so texture and cut noise tumble with the piece.

- [ ] **Step 4: Implement detached transform uploads and prewarm**

`setDetachedChunk` composes the current `Chunk` root quaternion/position with Task 4's frozen distal bone poses, updates existing descriptor rows, and resizes only the existing proxy transform/bounds. It never rebuilds a shader or material.

`prewarm(renderer, scene, camera)` temporarily makes the detached proxy visible at an off-camera parked transform, calls `renderer.compileAsync` once for the attached group and once for the detached group, renders/fences at least one frame through the same draw path used after sever, restores hidden state, and returns:

```typescript
export interface PrewarmReport {
  materialCountBefore: number;
  materialCountAfter: number;
  compileCallsBefore: number;
  compileCallsAfter: number;
  renderedAttached: boolean;
  renderedDetached: boolean;
  elapsedMs: number;
}
```

Increment `HumanoidResourceCounts.compileCalls` only inside this prewarm method; no setter, sever, reset, or render-loop path may call `compileAsync`. The sever control remains disabled until the promise resolves. If it rejects, the page must show the error and never offer a freeze-prone sever button.

- [ ] **Step 5: Run GREEN and live first-use timing probe**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts src/lab/sdf-zombie/humanoid-sever.test.ts
npx tsc --noEmit
```

In the headed smoke, run at least ten reset/sever cycles. Record rAF frame intervals from 30 frames before through 60 after each press. Reject any deterministic first-sever-only spike, any resource count change, any mismatch between proximal/distal cut contours, hollow cap, dark seam, or detached texture swimming. The hard first-use allocation/compile gate is <=50 ms.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts src/lab/sdf-zombie/humanoid-sever.ts src/lab/sdf-zombie/humanoid-sever.test.ts
git commit -m "feat(sdf-lab): sever textured humanoid forearm"
```

---

### Task 7: Dedicated spike page, automation, and sever gate

> **Scope note (wound fold-in).** This task's gate is now the **sever** gate, not
> the final owner gate. It ships the page, the automation API and contact-sheet
> panels 1–10. Panels 11–17 and the final owner verdict belong to Task 10. Do
> **not** mark `X1.humanoid-sever-spike` complete in `TASKS.md` here; leave it in
> progress with "next: Task 8 (wound keying)" as the exact next action. This is
> also the second of the two owner review gates in the dispatch chain — the
> chain pauses here for review before Tasks 8–10 are released.

**Files:**
- Create: `humanoid-sdf-spike.html`
- Create: `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts`
- Create: `src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts`
- Create: `scripts/verify-humanoid-sdf-spike.mjs`
- Modify: `vite.config.ts`
- Modify: `TASKS.md`
- Modify: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/notes.md` (create if absent)
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/live-*.png`
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/live-contact-sheet.png`

**Interfaces:**
- Consumes: Task 3 loader, Task 4 pure state, Task 5/6 view and prewarm, `createLabRenderer`.
- Produces: `/humanoid-sdf-spike.html`; `window.__humanoidSdfSpike` automation API; deterministic verification report/captures; final owner-review evidence.

- [ ] **Step 1: Write failing page/controller tests**

Factor DOM-free controller state into exports from `humanoid-spike-main.ts` so Vitest can test without starting WebGPU. Pin this automation contract:

```typescript
export interface HumanoidSpikeStatus {
  phase: 'loading' | 'prewarming' | 'ready' | 'failed';
  severPhase: SeverPhase;
  elbowDeg: number;
  elbowTargetDeg: number;
  softness01: number;
  physicsPaused: boolean;
  error: string | null;
  prewarm: PrewarmReport | null;
}

export interface HumanoidSpikeApi {
  readonly backend: string;
  readonly ready: boolean;
  readonly severEnabled: boolean;
  setElbow(deg: number): void;
  setSoftness(value01: number): void;
  sever(): boolean;
  reset(): void;
  setPhysicsPaused(paused: boolean): void;
  step(dtSec: number): void;
  setCamera(yaw: number, pitch: number, distance: number): void;
  status(): HumanoidSpikeStatus;
  resourceCounts(): HumanoidResourceCounts;
  timing(): { median: number; p95: number; max: number; samples: number } | null;
}
```

Declare `Window.__humanoidSdfSpike?: HumanoidSpikeApi` in the same module's global augmentation. `status()` returns a fresh snapshot; `resourceCounts()` forwards the view's exact `HumanoidResourceCounts` without deriving counters from scene traversal.

Test controls clamp values, sever refuses before ready/prewarm, sever succeeds once per reset, pause/reset wiring, error state, and DOM button disabled state through the controller adapter.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts`

- [ ] **Step 3: Implement the isolated HTML and bootstrap**

Add `humanoidSdfSpike` to Vite's Rollup inputs. The page contains only `#app`, a compact panel, errors/status, elbow range 0–100, softness range 0–1, sever/reset buttons, and pause checkbox. It must not copy the full lab panel.

Bootstrap order is fixed:

1. create WebGPU renderer and reject a non-WebGPU backend;
2. load/validate real humanoid assets;
3. create attached and detached views and floor/reference lighting;
4. call/await `view.prewarm`;
5. expose enabled controls and `window.__humanoidSdfSpike`;
6. start the render/update loop.

Every rejection writes a visible `FAILED: ...` message and leaves sever disabled. Orbit controls match the small existing spike rather than importing the full lab.

- [ ] **Step 4: Implement the deterministic CDP verifier and screenshot grader**

Follow the no-dependency Node 22 native-WebSocket pattern in `verify-clip-smoke.mjs`. Accept `<vitePort> <outDir> <cdpPort>`. Use one fresh tab and close it at completion. Drive exact states and capture:

1. `live-bind.png`;
2. `live-elbow-0.png`;
3. `live-elbow-50.png`;
4. `live-elbow-100.png`;
5. `live-softness.png` after a scripted elbow impulse;
6. `live-pre-sever.png`;
7. `live-sever-frame.png` with paused physics;
8. `live-detached-flight.png`;
9. `live-impact.png`;
10. `live-settled.png`.

Decode PNGs using the existing zlib/unfilter helper. Add numeric checks for non-blank luma variance, textured color variance, warm-flesh connected-component continuity across the elbow, no interior straight cut edge before sever, both cap components present after sever, detached-component separation after flight, and stable landmark colors across 0/50/100 degree poses. Emit annotated masks/contours into `live-contact-sheet.png`. Numeric checks supplement owner review; they do not approve organic appearance.

During ten sever/reset cycles, capture frame intervals and resource counts. Require first and later sever counts identical, no material/pipeline counter changes, no filtered WebGPU/shader errors, and no first-use frame >50 ms.

- [ ] **Step 5: Run the full automated verification**

```bash
uv run scripts/test_bake_humanoid_sdf.py -v
uv run scripts/bake_humanoid_sdf.py --validate-only
npx vitest run src/lab/sdf-zombie/humanoid-pose.test.ts src/lab/sdf-zombie/humanoid-sever.test.ts src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Then start one lsof-verified Vite process and one headed Chrome/CDP process, run `node scripts/verify-humanoid-sdf-spike.mjs`, record exact commands/PIDs/ports, and close only those task-owned processes/windows afterward.

- [ ] **Step 6: Perform the mandatory visual gate and document honestly**

Inspect the ten captures/contact sheet. Reject and revise for any elbow impalement, dark/light joint crease, volume pumping, source texture seam/swimming, rigid moderate-softness motion, sever pop, mismatched cut profiles, hollow cap, physics piece still following skeleton, or first-use pause.

`notes.md` records source/hash, atlas sizes/dimensions, bake time, per-test counts, live backend, prewarm report, resource counts, frame timing, captures, visual verdict, and any remaining blocker. Update `TASKS.md` to mark the spike passed only after automated and visual gates both pass; otherwise leave it in progress with the exact next action.

- [ ] **Step 7: Commit Task 7**

```bash
git add humanoid-sdf-spike.html vite.config.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts scripts/verify-humanoid-sdf-spike.mjs docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike TASKS.md
git commit -m "feat(sdf-lab): add textured humanoid sever spike"
```

---

### Task 8: Pure bone-wound keying, cut partition, and slot budget

**Files:**
- Create: `src/lab/sdf-zombie/humanoid-damage.ts`
- Create: `src/lab/sdf-zombie/humanoid-damage.test.ts`

**Interfaces:**
- Consumes: Task 3 `HumanoidVolumeManifest`/`HumanoidBrickManifest`; Task 4 `HumanoidPoseState`, `HumanoidBonePose`, `poseMatrices`; Task 6 `SeverRenderState` and `distalIndices`; existing `WoundType`, `WOUND_PROFILES`, `pushWound` from `damage.ts`.
- Produces: `BoneWound`, `MAX_BONE_WOUNDS`, `MAX_WOUND_SLOTS`, `worldHitToBoneWound`, `boneWoundWorldPos`, `ownerBrickForHit`, `partitionWoundsByCut`, `woundSlotsForClusters`, `WoundUploadLists`, `WoundSlotBudget`; Tasks 9 and 10 import these exact names. **No renderer, no WebGPU, no DOM in this task.**

- [ ] **Step 1: Write the failing keying and invariance tests**

Every test runs against the real checked-in manifest, as Task 4's do.

```typescript
export interface BoneWound {
  /** Index into manifest.bones[] — the same index space as poseMatrices,
   *  HumanoidPoseState.bones, and humanoid-sever's distalIndices. */
  boneIdx: number;
  /** Hit position in that bone's BIND-LOCAL frame, metres. */
  local: Vec3;
  radius: number;
  type: WoundType;   // reused verbatim from damage.ts
  ageSec: number;
}

export const MAX_BONE_WOUNDS = 12;   // logical wounds in the ring
export const MAX_WOUND_SLOTS = 24;   // texture columns written and scanned
```

Pin these, each as its own test:

- **Round trip.** `boneWoundWorldPos(state, worldHitToBoneWound(state, hit))` returns `hit` to 1e-6 m at rest and at 100 degrees of elbow flexion.
- **Articulation invariance.** A wound stamped at 0 degrees has a bit-identical `local` when read at 50 and 100 degrees, and its world position tracks the flexed forearm.
- **Rigid inverse, not matrix inversion.** Assert the implementation uses `local = qConj(q) * (hitWorld - t)` against `HumanoidPoseState.bones[boneIdx]`. A test constructs a pose with a deliberately non-normalised quaternion and requires the function to reject or renormalise rather than silently skew.
- **`boneIdx` is array position, not `jointIndex`.** The real manifest reports `boneCount: 24` with `bones.length: 22` because `head_end` and `headfront` fold into `Head`. Assert `manifest.boneCount !== manifest.bones.length` on the real asset, and that a wound keyed to a bone after the first fold addresses the same anatomy in `poseMatrices` as in `bones[]`.
- **Owner selection.** A hit on the mid-forearm shaft keys to `RightForeArm`, not `RightArm` or `RightHand`. A hit inside the 30 mm elbow overlap band resolves deterministically and stably across the whole 0–100 sweep. Ties break on the lower `boneIdx`.
- **Bounds discipline.** A static test asserts no `humanoid-damage.ts` code path references `boundsMin`, `boundsMax`, or any owned-face extent — read the module source and fail on the identifier. Only `occupiedBoundsMin/Max` is permitted.
- **Never fails to wound.** A hit far outside every posed AABB still produces a wound, falling back to the nearest bone origin. This preserves `damage.ts`'s "a body that can be hit always takes the wound" guarantee.

- [ ] **Step 2: Write the failing cut-partition and slot-budget tests**

```typescript
// forearm-local signed distance to the cut plane
// s = dot(n, wound.local) + w
// s < 0                        -> attached list (proximal stump)
// s > 0                        -> detached list (distal forearm + hand)
// |s| <= radius + irregularityM -> BOTH lists
```

- Wounds either side of `manifest.rightArm.cutPlaneLocal` land in exactly **one** list; a wound within `radius + irregularityM` lands in **both**. The two lists' union minus duplicates equals the ring exactly.
- **Straddlers are duplicated, never assigned.** A test constructs a wound at `|s| < radius` and asserts it appears in both lists. Assigning it to one side leaves the other side's cut cap showing a bite on one face and not the other, which fails the spike's own complementary-mask gate and reads on screen as a gap.
- Wounds on any other bone route by ownership: everything in `distalIndices` is detached, everything else attached.
- **Reset idempotence.** `severForearm` -> `resetArm` -> `severForearm` produces identical lists, and the ring is bit-identical before and after a reset. `severForearm` and `resetArm` must never touch the ring — the lists are derived per frame, not migrated at the sever frame.
- **Detachment continuity.** After `severForearm`, a hand wound's world position is continuous across the sever frame (no pop) and thereafter follows `chunkRootPose ∘ frozenDistalBones[k]` using the identical `local -> world` formula.
- **Cluster ranges.** `woundSlotsForClusters` sorts wounds by cluster and emits `(start, count)` per cluster; the ranges partition the slot array with no gaps and no overlap except declared boundary duplicates.
- **Cluster-boundary duplication.** A wound within `radius + rimReach` of a neighbouring cluster's `sweepBoundsMin/Max` is written into both clusters' ranges. `rimReach` must be computed as `radius * woundCfg.w * rimOffsetScale + radius * woundCfg2.x` — the same quantity `applyWounds` uses to place the Gaussian ring — so the duplication test cannot drift from the geometry it protects. A test asserts the two agree.
- **Slot budget.** Duplication never writes past `MAX_WOUND_SLOTS`. On overflow, drop the **oldest duplicate copies first and never a primary entry**, so an old wound degrades to "visible from one cluster" rather than vanishing. The drop count is returned in `WoundSlotBudget` for the page readout.

- [ ] **Step 3: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/humanoid-damage.test.ts`

Expected: import fails or every new assertion fails for missing exports.

- [ ] **Step 4: Implement `humanoid-damage.ts`**

Owner-brick selection is two phases:

1. **Broad phase.** For each retained brick, push the eight corners of `occupiedBoundsMin/Max` through the bone's posed transform and keep bricks whose posed AABB is within `radius + margin` of the hit. This is the same posed-corner sweep `humanoid-sever.ts` already does in `distalRadius` — reuse it, do not write a second one.
2. **Narrow phase.** Map the hit into bind-local and score by point-to-AABB distance against `occupiedBoundsMin/Max`: zero inside, positive outside. Take the minimum; ties break on lower `boneIdx`.

Reuse `pushWound` for the ring with `MAX_BONE_WOUNDS` as the cap parameter. Do **not** store a `bone: string` field — it doubles the ring's footprint to defend against a hot-swapped manifest that the loader already rejects.

Do not port `frame()`, `basisFromAxis`, `qRotate`-on-`prim.orient`, the `bodyYaw` de-yaw/re-yaw threading, the stamp-yaw/read-yaw matching contract, or the `p.op === 'sub'` carve skip. A bone brick carries its full rotation in `q_i`, so the workaround those existed for has nothing left to fix; the yaw-matching contract was itself a silent drift source.

- [ ] **Step 5: Run GREEN and commit Task 8**

```bash
npx vitest run src/lab/sdf-zombie/humanoid-damage.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/humanoid-damage.ts src/lab/sdf-zombie/humanoid-damage.test.ts
git commit -m "feat(sdf-lab): key wounds to humanoid bone bricks"
```

---

### Task 9: Wound payload, per-cluster ranges, and the shared interior material

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-view.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-view.test.ts`

**Interfaces:**
- Consumes: Task 8 `WoundUploadLists`, `woundSlotsForClusters`, `MAX_WOUND_SLOTS`; Task 5/6 `HumanoidView`; existing `writeWounds()` from `zombie-gpu.ts` and the `APPLY_WOUNDS`/`WOUND_MASK`/`CHAR_MASK` WGSL.
- Produces: `ROW_WOUND_RANGE`, `HumanoidView.setWounds(lists)`, `interiorDepth` WGSL, and unchanged `resourceCounts()` across every wound update.

- [ ] **Step 1: Write the failing payload and range tests**

- `ROW_WOUND_RANGE = 10`. Rows 0–9 are taken (`ROW_PRIM_A`..`ROW_REST_B` in `march.wgsl.ts`), and row 10 mirrors the existing `ROW_CLUSTER_RANGE` convention (`x = start, y = count, zw = 0`) rather than inventing a second one. Assert the constant and the layout.
- `writeWounds()` is imported and reused **verbatim** — it already takes parallel world-position/radius/type/age/splay/offset arrays and returns the written count. Only its `n` clamp changes, from `MAX_WOUNDS` to a parameter. Assert `humanoid-view.ts` does not define its own texel writer.
- The three WGSL loop bounds become a template constant driven by `MAX_WOUND_SLOTS`; the literal `16`s are already inside template strings, so this is a parameter change, not a rewrite. Assert no literal `16` wound bound survives in the humanoid shader source.
- `applyWounds`, `woundMask` and `charMask` take the active cluster's `(start, count)` instead of `(0, woundCfg.x)`. `woundCfg.x` keeps its meaning as the total written count for the untouched non-clustered chunk/hands paths — assert those paths are not modified.
- `ROW_WOUND` / `ROW_WOUND_META` texel layout is unchanged (xyz+radius, then type/age/splay/offset), and `woundCfg`/`woundCfg2` vec4 semantics are unchanged including the `X1.21.2` shell-amp and relaxation channels.
- **Resource stability.** `view.setWounds(lists)` across 0, 6 and 12 logical wounds leaves `resourceCounts()` bit-identical. No pipeline, material or texture is created by taking a wound.

- [ ] **Step 2: Write the failing shared-material tests**

The wound interior and the sever cut cap share **one** interior-depth function and one ramp:

```
interiorDepth(p) = max(woundInterior(p), cutCapInterior(p))
```

- Assert the shader defines exactly one `interiorDepth` and that both the wound path and the cap path read it. Fail on a second, cap-shaped wetness producer.
- Drive one ramp off it: skin edge -> wet red tissue -> darker central depth. `charMask` stays **separate** — burns are a surface state, not a depth.
- **The everted rim is NOT shared.** `applyWounds` splays displaced flesh into a raised lip because a projectile peels flesh outward; a sever is a clean torn cross-section with a narrow analytic torn rim. Rim geometry stays wound-only, keyed by `rimSplayScale`/`rimOffsetScale` from `WOUND_PROFILES`. Summary: **shading layer shared, rim geometry not shared.**
- **Source-colour suppression is mandatory, not cosmetic.** The colour brick stores nearest-surface source colour extended through the sampling band, so voxels *inside* the flesh carry skin colour; sampling it normally inside a crater paints skin tone on the inside of a bullet hole. Assert colour is suppressed wherever `interiorDepth > eps`, for wounds and the cap alike, through **one** code path. Add a CPU-mirror test sampling a point inside a crater and requiring the baked albedo contribution to be zero.
- **No wetness white-out.** `X1.17` was two wetness terms stacking: wound wetness plus fresnel rim-light clipped whole patches to white, fixed by fading fresnel inside wounds. Assert the fresnel fade keys off the shared `interiorDepth`, so the cap picks it up for free and a crater meeting the cap cannot re-stack it. Add a CPU-mirror test at the crater/cap intersection requiring the shading term to stay below the clamp.

- [ ] **Step 3: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts`

- [ ] **Step 4: Implement the payload and the shared ramp**

Order of operations per marched point, per cluster, and it is not negotiable:

1. sample each member brick, apply the bone-local softness warp;
2. apply the brick's half-space cut mask (`smax` against the irregular plane);
3. union the bricks — `smin` inside declared overlap bands, hard `min` outside;
4. `applyWounds` on the **composed** result.

Wounds carve last, against the composed field, exactly as `mapBody` does today. Two consequences to preserve: a crater near the elbow correctly eats into both the upper arm and the forearm because it sees the union; and a crater overlapping the cut cap composes as two `smax` subtractions, keeping the cap's flat irregular profile except where the crater bit through it.

The detached piece keeps its own view with its own small ring (typically one to three wounds plus the torn-end blast the chunk path already parks there), using unmodified `writeWounds` and the existing single-cluster chunk shader.

**Known limitation to leave alone.** The softness warp is bone-local and applied inside the brick sample; a world-space wound sphere subtracted after the union does not wobble with it, so at maximum latex the crater lip can appear to slide by up to the warp amplitude — a few millimetres. The current procedural lab has exactly this behaviour, so it is not a regression. Do **not** pre-emptively implement either fix. If Task 10's visual gate flags it, the cheap mitigation (CPU-evaluate the owning bone's warp at the wound centre once per frame, <= 24 evaluations, and pre-displace the uploaded world position) comes first; bone-local carving inside each brick sample is explicitly deferred.

- [ ] **Step 5: Run GREEN and commit Task 9**

```bash
npx vitest run src/lab/sdf-zombie/webgpu
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts src/lab/sdf-zombie/webgpu/humanoid-view.ts src/lab/sdf-zombie/webgpu/humanoid-view.test.ts
git commit -m "feat(sdf-lab): carve bone-brick wounds with a shared interior ramp"
```

---

### Task 10: Click-to-shoot targeting, wound contact sheet, and the final owner gate

**Files:**
- Create: `src/lab/sdf-zombie/humanoid-target.ts`
- Create: `src/lab/sdf-zombie/humanoid-target.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts`
- Modify: `scripts/verify-humanoid-sdf-spike.mjs`
- Modify: `TASKS.md`
- Modify: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/notes.md`
- Create: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/live-wound-*.png`
- Modify: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/live-contact-sheet.png`

**Interfaces:**
- Consumes: Task 3 `HumanoidCoarseBricks`; Task 8 `worldHitToBoneWound`, `partitionWoundsByCut`; Task 9 `setWounds`; Task 7 page and automation API; existing `WOUND_PROFILES` calibres and `lab-main.ts`'s pointer->ray path.
- Produces: `traceHumanoidRay`, `HumanoidRayHit`, `shoot(x, y)` on the automation API, panels 11–17, and the final owner verdict.

- [ ] **Step 1: Write the failing targeting tests**

- **Sphere-trace the coarse brick, not the bounding box.** Ray-versus-posed-OBB alone lands the hit on a box, so craters float off thin limbs like forearms and fingers by centimetres. Broad phase is ray-versus each bone's posed occupied-bounds OBB giving the candidate set and an entry `t`; then sphere-trace that bone's coarse brick in bind-local from its entry point and take the nearest surface crossing. Add a test asserting a forearm hit lands within 5 mm of the true surface, not on the OBB face.
- **The minimal-field bone IS the owner.** No nearest-endpoint heuristic. Assert the returned `boneIdx` comes from the trace, and that a hit in the elbow band picks the bone whose coarse field is actually smaller.
- **Raycast the POSED body, never the bind pose.** Rays are tested against `poseMatrices`. Pin it: a flexed-elbow ray that WOULD hit the bind-pose forearm and MISSES the flexed one must miss. This is the same rule `X1.22` task 4 recorded for the procedural path.
- **Refinement.** A 16-cubed brick over a forearm is roughly a 20 mm pitch, so the raw trace lands within about a voxel; a short secondary refinement along the ray using the same field must converge to a few millimetres — well inside a 55 mm pellet crater. Assert the refined error bound.
- **The detached piece is a target too.** After a sever, include the distal chunk in the broad phase against `chunkRootPose ∘ frozenDistalBones` and route its hits to the detached ring. A severed arm that ignores gunfire while lying on the floor reads as a bug immediately. Assert a ray at the grounded chunk produces a wound on the detached ring.
- No GPU readback anywhere in this path.

- [ ] **Step 2: Run RED, implement, run GREEN**

```bash
npx vitest run src/lab/sdf-zombie/humanoid-target.test.ts
```

Plumb `shoot(x, y)` through the existing pointer->ray path and the existing `WOUND_PROFILES` calibres. `explosion-aoe.ts`'s blast fan-out needs no change beyond the new hit->bone mapping, but torso blasts and multi-wound clusters stay deferred.

- [ ] **Step 3: Extend the prewarm gate to the first shot**

The 50 ms first-use interaction gate now covers the first shot after page load: firing must not compile a pipeline or allocate a view for the first time. Extend `prewarm()` and assert `resourceCounts()` is unchanged across the first `shoot()`, exactly as Task 6 asserts it across the first `sever()`.

- [ ] **Step 4: Capture wound panels 11–17 and report performance**

Extend the existing contact sheet — do not start a second one:

11. three pellets across the mid-forearm, elbow at 0 degrees;
12. the same three at 100 degrees flexion (craters ride the flesh, no slide, no seam);
13. a pellet placed deliberately ON the cut plane, pre-sever;
14. the sever frame for that straddling wound — both halves show the bite;
15. the detached piece in flight, bullet holes intact;
16. a crater spanning the shoulder cluster boundary (no slicing at the seam);
17. a fresh crater beside the settled cut cap, for side-by-side comparison of the shared layered ramp.

Report the wound-scan cost as a delta against the spike's steady-state timing at **0, 6 and 12** logical wounds, and the click-to-shoot trace cost per hit. A nonzero slot-drop counter during the gate means the budget is wrong and must be RAISED, not silently tolerated — say so in `notes.md`.

**Harness note for whoever verifies in the browser pane:** the pane fires a real pointer click at the last cursor position on re-composite, which stealth-stamps pellets. Park verification reads early and treat wound-count growth *between* tool calls as harness noise, not as an input loop.

- [ ] **Step 5: Final owner gate**

Reject on any of: colour swimming or skin tone visible inside a crater; a wetness white-out where a crater meets the cap; a crater sliced at a cluster seam; a crater that drifts off its landmark under flexion; a straddling wound that bites only one half; a wound that survives on the stump but vanishes from the detached piece or the reverse.

Update `TASKS.md` to mark `X1.humanoid-sever-spike` passed **only after both the automated and the visual gates pass**; otherwise leave it in progress with the exact next action. A green headless report is not owner visual approval.

- [ ] **Step 6: Commit Task 10**

```bash
git add src/lab/sdf-zombie/humanoid-target.ts src/lab/sdf-zombie/humanoid-target.test.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts scripts/verify-humanoid-sdf-spike.mjs docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike TASKS.md
git commit -m "feat(sdf-lab): aim wounds at the baked humanoid"
```

## Final integration gate

Task 1 is complete and merged to `main` (`14d62dc`, plus the `_edge_adjacency` fix at `01fd701`). Tasks 2–10 form one serial chain; do not merge an intermediate task directly to `main`.

The chain has **two owner review gates**:

- **After Task 2** — the atlas everything downstream consumes. Review `bake-report.json`, `bind-textured-preview.png`, the coarse-brick pitches, and independently re-run the determinism comparison before releasing Tasks 3–7. A bad bake here wastes six tasks.
- **After Task 7** — this is the "after Task 6" gate in substance: it judges Tasks 5–6's marcher and cut surfaces, but the pause point is after Task 7, because Task 7 is what ships the page and panels 1–10 that make them viewable. You cannot review a marcher without a page. Tasks 8–10 are released only after this gate.

After Task 10 reports success, review the complete chained diff, rerun the final verification from a clean worktree, open `/humanoid-sdf-spike.html` for the owner, and use `superpowers:finishing-a-development-branch` to choose merge/PR/keep/discard. A green headless report is not the owner visual approval.
