# X1.27 Baked-SDF Dynamite Grip and Underhand Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a six-frame baked-SDF right-hand clip that visibly closes around a licensed derived dynamite GLB and releases it continuously into the existing flight system during a Blood-style underhand toss.

**Architecture:** Author one final runtime prop first, then solve six hand poses against that exact geometry and bake them onto one common anatomical grid packed along 3D-texture depth. A version-2 clip loader and adjacent-slab WGSL sampler preserve the existing version-1 static hand; a pure grip controller drives finger progress and wrist swing, while clip mode alone defers the existing throw request until the authored release marker and seeds flight from the rendered prop transform.

**Tech Stack:** Blender 5.2 Python, PEP 723/uv, `libigl==2.6.2`, `numpy==2.5.2`, glTF/GLB, TypeScript, Three.js r185 WebGPU/TSL, WGSL, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md`

## Global Constraints

- Work only in `/Users/donny/Projects/blud/.claude/worktrees/gib-wound-bugs-b8c728` on `claude/gib-wound-bugs-b8c728`.
- Execution target after approval: Dispatch UI, `pi` harness, `GLM-5.3`, `xhigh` reasoning.
- The downloaded hand and dynamite sources stay outside the repository. Commit only the derived GLB, derived SDF clip, manifests, previews, attribution, code, tests, and notes.
- Use only DavidFischer's CC-BY-4.0 hand and DJMaesen/bumstrum's CC-BY-4.0 dynamite bundle. Do not open or derive from the unknown-license `free-fps-hands` pack.
- The final checked-in dynamite GLB, its grip anchor, and its contact hull are the exact inputs used to author every pose. Runtime corrective scale is forbidden.
- Reuse inverse-bind skinning and X1.26's local cut-ring cap. Do not use Blender's corrupted imported rest armature, global hole filling, or voxel remeshing.
- Keep six fields: `open`, `approach`, `first-contact`, `wrap`, `thumb-lock`, `firm-grip`; one common frame/grid; 1.5 mm target pitch; 12 mm margin; R16F little-endian; X-fastest/Y/Z order.
- Interpolate only adjacent pose fields. Never mix `open` directly with `firm-grip`.
- The prop is a separate GLB, never part of the hand SDF.
- Existing material, wound, lighting, clay, and distal-warp paths remain shared.
- Primitive mode and the X1.26 static baked mode remain available and behaviorally unchanged. Only clip mode defers throw spawn.
- Do not change deterministic fuse, impact, bounce, explosion, damage, or wider weapon behavior.
- Every WGSL-changing task must include a live visible-page WebGPU smoke; TypeScript and substring tests do not type-check generated WGSL.
- Reject benchmark samples with `hiddenSteps > 0`; investigate clip assets above 35 MiB or median GPU regression above 0.75 ms versus X1.26 static baked mode.
- Run and commit each dispatch task before its dependent task starts. Do not queue or execute this plan until the owner explicitly dispatches it.

---

## File and interface map

### New offline files

- `scripts/author_dynamite_grip.py` — import/normalize the licensed prop, solve six right-hand poses against its contact hull, export the derived GLB, pose soups, manifest input, diagnostics, and previews.
- `scripts/test_author_dynamite_grip.py` — pure transform, pose-key, contract, contact, and source-guard tests.
- `scripts/bake_hand_sdf_clip.py` — reuse X1.26 field functions, derive the union grid, bake six fields, depth-pack them, and write/validate the version-2 manifest.
- `scripts/test_bake_hand_sdf_clip.py` — atlas order, common-grid, frame validation, and version-2 round-trip tests.

### New runtime files

- `src/lab/sdf-zombie/webgpu/hand-volume-clip.ts` — strict version-2 manifest validator/loader and normalized adjacent-frame lookup.
- `src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts` — real checked-in clip plus malformed-manifest and loader tests.
- `src/lab/sdf-zombie/webgpu/dynamite-prop.ts` — hash-checked GLB parsing and the `hand | flight | gone` visual wrapper.
- `src/lab/sdf-zombie/webgpu/dynamite-prop.test.ts` — transform, hash, node, ownership, and disposal tests.
- `src/lab/sdf-zombie/hand-grip-clip.ts` — pure close/hold/underhand/release/follow-through controller.
- `src/lab/sdf-zombie/hand-grip-clip.test.ts` — timing, continuity, and exactly-once marker tests.

### Existing files that change

- `scripts/pose_measure_hands.py` — parameterize the existing measured grip solver by contact-hull radius without changing its current default.
- `scripts/bake_hand_sdf.py` — export the stable pose/extraction/cut helpers and texture-construction helpers used by the clip baker; static-v1 output remains byte-identical.
- `src/lab/sdf-zombie/webgpu/hand-volume.ts` — export shared hash and Data3DTexture helpers; retain strict version-1 behavior.
- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — sample two clamped atlas slabs and mix their distances before wounds.
- `src/lab/sdf-zombie/webgpu/specialise.ts` — forward the new clip uniform in specialised field bodies.
- `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` — add the default/static `volumeClip` uniform and forward it everywhere.
- `src/lab/sdf-zombie/webgpu/fpv-view.ts` — accept a static or clip volume and expose `setVolumeFrame(a,b,alpha)`.
- `src/lab/sdf-zombie/hand-volume-pose.ts` — compose camera-local wrist motion onto the baked volume and derive the exact GLB root transform from the manifest contract.
- `src/lab/sdf-zombie/fpv-mode.ts` — store an optional deferred throw and expose the exactly-once release function; default remains immediate.
- `src/lab/sdf-zombie/webgpu/lab-main.ts` — load/wire clip+GLB, drive close/toss, execute the release handoff, expose controls/automation, and capture evidence.

## Dispatch chain

| Task | Deliverable | Depends on | Reviewer stop condition |
|---|---|---|---|
| A | final derived GLB + six posed/capped hand soups + contact sheet | none | prop scale reads and all pose/contact diagnostics pass |
| B | depth-packed six-frame R16F clip + v2 manifest | A | all fields validate; adjacent midpoint previews retain digit separation |
| C | strict clip loading + adjacent-slab WGSL sampling | B | focused/full tests, build, and live WebGPU compile pass; v1 unchanged |
| D | hash-checked GLB runtime wrapper + exact hand transform | C | held/flight/gone and release orientation tests pass |
| E | pure grip controller + clip-only deferred throw release | D | default immediate throw unchanged; deferred release is exactly once |
| F | lab integration, captures, benchmark, notes, owner gate | E | evidence recorded and ready for owner verdict |

---

## Dispatch Task A — author the final prop and six contact-valid poses

### Task A1: Parameterize the trusted grip solver

**Files:**
- Modify: `scripts/pose_measure_hands.py:705-951`
- Create: `scripts/test_author_dynamite_grip.py`

**Interfaces:**
- Consumes: existing `Hand`, `build_grip`, `wrap_chain`, `first_contact`, inverse-bind helpers.
- Produces: `build_grip(hand, prop_radius=GRIP_PROP_R) -> tuple[dict, Vector, Vector, float]` with current callers unchanged.

- [ ] **Step 1: Write the failing signature/default regression**

```python
def test_build_grip_is_radius_parameterized_without_changing_default():
    sig = inspect.signature(pm.build_grip)
    assert sig.parameters["prop_radius"].default == pm.GRIP_PROP_R
    src = inspect.getsource(pm.build_grip)
    assert "prop_radius" in src
    assert "GRIP_PROP_R" not in src.replace("prop_radius=GRIP_PROP_R", "")
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `uv run scripts/test_author_dynamite_grip.py -v`

Expected: FAIL because `build_grip` has no `prop_radius` parameter and still reads the global throughout.

- [ ] **Step 3: Replace internal radius reads with the argument**

```python
def build_grip(hand, prop_radius=GRIP_PROP_R):
    """Return rotations and the measured cylindrical seat for this radius."""
    # Keep the existing solver body and make these four mechanical changes:
    # 1. origin = centre + hand.B * (palmar - prop_radius)
    # 2. pass origin, axis, prop_radius as wrap_chain's final three arguments
    # 3. every digit/thumb gap subtracts prop_radius
    # 4. shell = prop_radius + hand.radius[tip] + GRIP_THUMB_CLEAR
    # The existing final return becomes:
    return rots, origin, axis, prop_radius
```

- [ ] **Step 4: Run the existing hand measurement script in manifest mode**

Run: `python3 scripts/pose_measure_hands.py --manifest-only`

Expected: existing manifest output succeeds with the default 30 mm grip radius; no checked-in output changes.

### Task A2: Normalize and export the licensed runtime GLB

**Files:**
- Create: `scripts/author_dynamite_grip.py`
- Modify: `scripts/test_author_dynamite_grip.py`
- Create: `public/assets/lab/dynamite-bundle-grip.glb`
- Create: `public/assets/lab/dynamite-bundle-grip.json`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/prop-preview.png`
- Modify: `ATTRIBUTIONS.md`

**Interfaces:**
- Consumes source: `/Users/donny/Downloads/additional blud assets test/dynamite_bundle.glb`.
- Produces contract:

```python
@dataclass(frozen=True)
class PropContract:
    glb: str                         # "dynamite-bundle-grip.glb"
    sha256: str                      # 64 lowercase hex
    source_sha256: str
    dimensions_m: tuple[float, float, float]
    model_up: str                    # "+Y"
    model_grip_offset_m: float       # signed +Y from GLB origin
    contact_radius_m: float
    contact_below_m: float
    contact_above_m: float
    fuse_tip_node: str               # "FuseTip"
    flight_pivot_node: str           # "FlightPivot"
    attribution: str
```

- [ ] **Step 1: Add failing pure contract/source guards**

```python
def test_source_is_the_credited_djmaesen_asset():
    meta = read_glb_asset_extras(SOURCE)
    assert meta["author"].startswith("DJMaesen")
    assert meta["license"].startswith("CC-BY-4.0")
    assert meta["source"].endswith("dynamite-bundle-6d333be39e454b458d48ad86f8a78df4")

def test_runtime_contract_rejects_a_proxy_scale():
    c = valid_contract()
    bad = dataclasses.replace(c, dimensions_m=(0.01, 0.01, 0.01))
    try:
        validate_prop_contract(bad)
    except ValueError as exc:
        assert "derived dimensions" in str(exc)
    else:
        raise AssertionError("invalid proxy dimensions were accepted")
```

Define the complete fixture as:

```python
def valid_contract() -> PropContract:
    return PropContract(
        glb="dynamite-bundle-grip.glb",
        sha256="a" * 64,
        source_sha256="b" * 64,
        dimensions_m=(0.074, 0.32, 0.074),
        model_up="+Y",
        model_grip_offset_m=-0.015,
        contact_radius_m=0.037,
        contact_below_m=0.115,
        contact_above_m=0.135,
        fuse_tip_node="FuseTip",
        flight_pivot_node="FlightPivot",
        attribution="Dynamite Bundle by DJMaesen/bumstrum, CC-BY-4.0",
    )
```

- [ ] **Step 2: Implement GLB metadata parsing and contract validation without Blender**

Read the GLB header/JSON chunk with `struct.unpack_from`. Validate the embedded source extras and source SHA before launching Blender. The derived envelope is explicit:

```python
MIN_TRANSVERSE_M, MAX_TRANSVERSE_M = 0.065, 0.085
MIN_TOTAL_M, MAX_TOTAL_M = 0.30, 0.35
CONTACT_RADIUS_M = 0.037
CONTACT_BELOW_M = 0.115
CONTACT_ABOVE_M = 0.135
```

Serialize the dataclass to the checked-in JSON with these exact keys so Task B
does not guess between Python and manifest naming:

```python
def contract_json(c: PropContract) -> dict:
    return {
        "glb": c.glb, "sha256": c.sha256,
        "sourceSha256": c.source_sha256,
        "dimensionsM": list(c.dimensions_m), "modelUp": c.model_up,
        "modelGripOffsetM": c.model_grip_offset_m,
        "contactRadiusM": c.contact_radius_m,
        "contactBelowM": c.contact_below_m,
        "contactAboveM": c.contact_above_m,
        "fuseTipNode": c.fuse_tip_node,
        "flightPivotNode": c.flight_pivot_node,
        "attribution": c.attribution,
    }
```

The source's longest axis is aligned to model +Y. Scale that axis to 0.32 m total and scale both transverse axes uniformly until the larger is 0.074 m. These values enlarge/correct the old 0.21 m procedural silhouette while keeping the contact hull graspable.

- [ ] **Step 3: Implement the Blender export stage**

Run the same file inside Blender with `--blender-export`. It must:

1. import the credited source GLB;
2. collapse wrapper transforms and apply the deterministic axis/scale above;
3. place the GLB root at the physical mesh-bounds centre (`FlightPivot`);
4. create `GripAnchor` at `[0, model_grip_offset_m, 0]` and `FuseTip` at the distal fuse end;
5. resize embedded textures to at most 512×512, preserve the authored PBR material, and export one self-contained GLB;
6. reopen the exported GLB, measure its bounds/nodes, and only then write the JSON contract and SHA-256;
7. render a neutral 768×768 scale preview beside a 180 mm reference ruler.

Use argument-list `subprocess.run`, `tempfile.TemporaryDirectory`, and no shell strings.

- [ ] **Step 4: Generate and validate the derived asset**

Run:

```bash
uv run scripts/author_dynamite_grip.py --prop-only
uv run scripts/author_dynamite_grip.py --validate-only
```

Expected: derived GLB is 0.30–0.35 m long, 0.065–0.085 m across, has named grip/fuse/flight nodes, is under 3 MiB, and matches its hashes.

- [ ] **Step 5: Add the exact DJMaesen attribution**

Append an `ATTRIBUTIONS.md` section naming the source URL, author URL, CC-BY-4.0 URL, derived GLB/contract, permitted modifications, and the fact that the downloaded original is not redistributed.

### Task A3: Solve and export six poses against that exact prop

**Files:**
- Modify: `scripts/author_dynamite_grip.py`
- Modify: `scripts/test_author_dynamite_grip.py`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/pose-contact-sheet.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md`

**Interfaces:**
- Produces temporary `pose-00-open.npz` through `pose-05-firm-grip.npz`, each containing `vertices`, `faces`, `label`, `rotations`, `grip_local`, `axis_local`, topology/contact diagnostics, and both source hashes.
- Exposes `export_pose_soups(output_dir: Path) -> Path`; it writes those NPZ files plus `authoring.json` into the caller-owned directory. Task B calls it inside its own `TemporaryDirectory`, so no temporary soup is committed or assumed to survive across dispatch worktrees.

- [ ] **Step 1: Add failing pose-key and common-frame tests**

```python
LABELS = ("open", "approach", "first-contact", "wrap", "thumb-lock", "firm-grip")

def test_pose_labels_are_exact_and_ordered():
    assert grip_pose_labels() == LABELS

def test_every_pose_uses_one_wrist_origin_and_anatomical_basis():
    authored = load_exported_fixture_poses(FIXTURE_EXPORT_DIR)
    assert len({tuple(round(v, 9) for v in p.origin) for p in authored}) == 1
    assert len({tuple(round(v, 9) for row in p.basis for v in row) for p in authored}) == 1
```

The test setup creates `FIXTURE_EXPORT_DIR` with `tempfile.TemporaryDirectory`,
runs `export_pose_soups` once, and `load_exported_fixture_poses` reads the six
NPZ metadata records in numeric filename order.

- [ ] **Step 2: Build open and firm rotations from trusted code**

`open` uses X1.26's `RELAXED_POSE`. `firm-grip` calls `build_grip(hand, contract.contact_radius_m)` and transforms the returned prop origin/axis into the same anatomical frame used by the cut hand. Never eyeball a second prop seat.

Derive `modelRotationLocal` once at firm grip: model +Y maps to `axisLocal`,
model +Z maps to the closest orthogonal anatomical dorsal direction, and model
+X is recomputed as +Y×+Z to keep a proper rotation. Assert the quaternion is
unit length and that rotating model +Y reproduces `axisLocal` within `1e-6`.

- [ ] **Step 3: Derive the four intermediate keys deterministically**

Convert every bone's open/firm rotation matrix to a quaternion and slerp per bone. Solve `first_contact_t` by scanning then bisection for the first factor where any distal digit surface reaches within 1.5 mm of the contract cylinder without exceeding 5 mm penetration. Use:

```python
finger_t = {
    "open": 0.0,
    "approach": 0.60 * first_contact_t,
    "first-contact": first_contact_t,
    "wrap": first_contact_t + 0.65 * (1.0 - first_contact_t),
    "thumb-lock": 0.95,
    "firm-grip": 1.0,
}
thumb_t = {
    "open": 0.0, "approach": 0.0, "first-contact": 0.0,
    "wrap": 0.15, "thumb-lock": thumb_contact_t, "firm-grip": 1.0,
}
```

Solve `thumb_contact_t` as the first thumb factor after `wrap` that comes within 2 mm of the bundle/fingers while staying above −5 mm penetration.

- [ ] **Step 4: Reuse X1.26 extraction/cut/cap for every key**

Factor the stable extraction, inverse-bind skinning, anatomical-frame derivation, 35 mm wrist cut, cut-ring-only weld/cap, and NPZ export from `bake_hand_sdf.py` into importable helpers. Run exactly those helpers for all six rotations. Assert identical face count, cap plane, origin, and basis across all frames.

- [ ] **Step 5: Validate contacts and render the contact sheet**

For every pose record per-digit minimum gap to the contract cylinder, thumb-to-prop gap, digit-to-digit gap, boundary-edge count, and cap-plane drift. Hard failures:

```text
non-finite vertex or transform
cap-plane drift > 0.25 mm
topology/face count differs across frames
penetration below -5 mm
firm-grip fingertip gap above +3 mm
digit separation below -2 mm outside intended soft contact
```

Render all six poses with the **checked-in derived GLB** in one fixed camera/contact sheet. If any finger becomes a mitten silhouette or the bundle looks wrongly scaled, stop Task A and report the failing frame/diagnostic.

- [ ] **Step 6: Run all Task A verification**

```bash
uv run scripts/test_author_dynamite_grip.py -v
uv run scripts/author_dynamite_grip.py
uv run scripts/author_dynamite_grip.py --validate-only
git diff --check
```

- [ ] **Step 7: Commit Task A**

```bash
git add scripts/pose_measure_hands.py scripts/bake_hand_sdf.py \
  scripts/author_dynamite_grip.py scripts/test_author_dynamite_grip.py \
  public/assets/lab/dynamite-bundle-grip.glb \
  public/assets/lab/dynamite-bundle-grip.json \
  docs/dev-notes/2026-08-17-sdf-dynamite-grip ATTRIBUTIONS.md
git commit -m "feat(lab): author dynamite grip prop and hand poses"
```

---

## Dispatch Task B — bake and validate the six-frame depth atlas

### Task B1: Define the version-2 clip manifest and common-grid bake

**Files:**
- Create: `scripts/bake_hand_sdf_clip.py`
- Create: `scripts/test_bake_hand_sdf_clip.py`
- Modify: `scripts/bake_hand_sdf.py`

**Interfaces:**
- Consumes: Task A's `export_pose_soups(tempdir)`, six generated NPZ exports/`authoring.json`, `grid_spec`, `bake_field`, `validate_field`, and R16F helpers.
- Produces:

```python
@dataclass(frozen=True)
class ClipGrid:
    dimensions: tuple[int, int, int]       # per frame nx, ny, nz
    atlas_dimensions: tuple[int, int, int] # nx, ny, nz * 6
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]
    voxel_size: tuple[float, float, float]
```

Both new scripts start with the same PEP 723 Python/dependency block as
`bake_hand_sdf.py` (`>=3.12,<3.15`, `libigl==2.6.2`, `numpy==2.5.2`) so their
test and validation commands are reproducible outside the workspace venv.

- [ ] **Step 1: Write failing common-grid and atlas-order tests**

```python
def test_union_grid_is_shared_by_every_frame():
    mesh_a = (np.array([[-0.01, 0, 0], [0, 0, 0], [0, 0.01, 0]], dtype=np.float64),
              np.array([[0, 1, 2]], dtype=np.int64))
    mesh_b = (np.array([[+0.02, 0, 0], [0, 0, 0], [0, 0.01, 0]], dtype=np.float64),
              np.array([[0, 1, 2]], dtype=np.int64))
    grid = clip_grid([mesh_a, mesh_b], 0.005, 0.012)
    assert grid.bounds_min[0] <= -0.022
    assert grid.bounds_max[0] >= +0.032

def test_depth_pack_is_frame_major_and_x_fastest_inside_each_slab():
    frames = [np.full((2, 2, 3), i, dtype=np.float32) for i in range(6)]
    atlas = pack_depth(frames)
    assert atlas.shape == (12, 2, 3)
    assert atlas[0, 0].tolist() == [0, 0, 0]
    assert atlas[2, 0].tolist() == [1, 1, 1]
```

- [ ] **Step 2: Implement the union-grid contract**

Load all six posed meshes, take the union AABB, add 12 mm once, and derive one endpoint-inclusive 1.5 mm lattice. `bake_field` receives that same `GridSpec` for every frame. Do not derive per-frame bounds.

- [ ] **Step 3: Bake, validate, and depth-pack**

For each label in exact order, run X1.26's unsigned-distance + fast-winding sign. Validate finite positive/negative samples and wholly positive AABB boundary. Stack with:

```python
atlas = np.concatenate(fields, axis=0)  # each field is [z, y, x]
raw = atlas.astype("<f2", copy=False).tobytes(order="C")
```

This makes physical texture dimensions `[nx, ny, nz * 6]` while retaining X-fastest order inside every frame slab.

### Task B2: Write the checked-in clip and verify every slab

**Files:**
- Create: `public/assets/lab/hand-sdf-dynamite-grip-r.r16f`
- Create: `public/assets/lab/hand-sdf-dynamite-grip-r.json`
- Modify: `scripts/test_bake_hand_sdf_clip.py`
- Modify: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md`
- Modify: `ATTRIBUTIONS.md`

**Interfaces:**
- Manifest version 2 uses:

```python
manifest = {
    "version": 2,
    "kind": "hand-sdf-clip",
    "binary": "hand-sdf-dynamite-grip-r.r16f",
    "encoding": "r16f-le",
    "order": "x-fastest-y-z",
    "axes": dict(AXIS_NAMES),
    "dimensions": list(grid.dimensions),
    "atlasDimensions": list(grid.atlas_dimensions),
    "frameDepth": grid.dimensions[2],
    "frameCount": 6,
    "frames": [
        {"label": label, "key": key}
        for label, key in zip(LABELS, (0.0, 0.2, 0.4, 0.6, 0.8, 1.0))
    ],
    "timing": {"closeSec": 0.22, "releaseSec": 0.12,
               "swingSec": 0.24, "releaseAtSec": 0.15},
    "boundsMin": list(grid.bounds_min),
    "boundsMax": list(grid.bounds_max),
    "voxelSize": list(grid.voxel_size),
    "isoValue": 0,
    "byteLength": len(raw),
    "sha256": {"binary": binary_sha256, "source": hand_source_sha256},
    "attribution": hand_attribution,
    "prop": {
        "url": prop_contract["glb"],
        "sha256": prop_contract["sha256"],
        "gripLocal": authoring["gripLocal"],
        "axisLocal": authoring["axisLocal"],
        "modelGripOffsetM": prop_contract["modelGripOffsetM"],
        "modelRotationLocal": authoring["modelRotationLocal"],
        "contactRadiusM": prop_contract["contactRadiusM"],
        "contactBelowM": prop_contract["contactBelowM"],
        "contactAboveM": prop_contract["contactAboveM"],
        "fuseTipNode": prop_contract["fuseTipNode"],
        "flightPivotNode": prop_contract["flightPivotNode"],
    },
}
```

- [ ] **Step 1: Add full manifest and per-slab validation tests**

Reject a wrong version/kind, frame count other than six, duplicate/out-of-order labels, keys not strictly increasing from 0 to 1, `atlasDepth != frameDepth * frameCount`, byte length mismatch, prop hash mismatch, non-unit axis/quaternion, missing attribution, and unsafe relative paths.

- [ ] **Step 2: Implement `--validate-only` without Blender or source downloads**

Decode the checked-in binary as `[frameCount * nz, ny, nx]`, slice every slab, run `validate_field` with the common `GridSpec`, and confirm both the clip SHA and derived GLB SHA.

- [ ] **Step 3: Bake and record measured output**

```bash
uv run scripts/test_bake_hand_sdf_clip.py -v
uv run scripts/bake_hand_sdf_clip.py
uv run scripts/bake_hand_sdf_clip.py --validate-only
ls -lh public/assets/lab/hand-sdf-dynamite-grip-r.r16f
```

Expected: approximately 24–30 MiB and six individually valid slabs. If the file exceeds 35 MiB, stop and report dimensions/pitch rather than silently lowering resolution.

- [ ] **Step 4: Render midpoint diagnostics**

For each adjacent pair, decode both fields, average at alpha 0.5, extract the zero isosurface for a neutral preview, and append five midpoint images to the contact sheet. Reject ghosted double digits, lost web spaces, or mitten bridges before runtime work.

- [ ] **Step 5: Extend the hand attribution**

Add the new clip binary/manifest/previews to DavidFischer's derivative-work list and copy the exact required credit into the v2 manifest.

- [ ] **Step 6: Commit Task B**

```bash
git add scripts/bake_hand_sdf.py scripts/bake_hand_sdf_clip.py \
  scripts/test_bake_hand_sdf_clip.py \
  public/assets/lab/hand-sdf-dynamite-grip-r.r16f \
  public/assets/lab/hand-sdf-dynamite-grip-r.json \
  docs/dev-notes/2026-08-17-sdf-dynamite-grip ATTRIBUTIONS.md
git commit -m "feat(lab): bake dynamite grip hand clip"
```

---

## Dispatch Task C — load and interpolate adjacent SDF slabs

### Task C1: Add a strict v2 clip loader without weakening v1

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/hand-volume-clip.ts`
- Create: `src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/hand-volume.ts`
- Modify: `src/lab/sdf-zombie/webgpu/hand-volume.test.ts`

**Interfaces:**
- Produces:

```ts
export type GripFrameLabel =
  | 'open' | 'approach' | 'first-contact' | 'wrap' | 'thumb-lock' | 'firm-grip';

export interface HandClipVolume {
  manifest: HandClipManifest;
  texture: THREE.Data3DTexture;
  maxVoxelPitch: number;
  dispose(): void;
}

export interface HandClipManifest {
  version: 2;
  kind: 'hand-sdf-clip';
  binary: string;
  encoding: 'r16f-le';
  order: 'x-fastest-y-z';
  axes: { x: 'thumbward'; y: 'distal'; z: 'dorsal' };
  dimensions: [number, number, number];
  atlasDimensions: [number, number, number];
  frameDepth: number;
  frameCount: 6;
  frames: Array<{ label: GripFrameLabel; key: number }>;
  timing: { closeSec: number; releaseSec: number; swingSec: number; releaseAtSec: number };
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxelSize: [number, number, number];
  isoValue: 0;
  byteLength: number;
  sha256: { binary: string; source: string };
  attribution: string;
  prop: DynamitePropContract;
}

export interface DynamitePropContract {
  url: string;
  sha256: string;
  gripLocal: [number, number, number];
  axisLocal: [number, number, number];
  modelGripOffsetM: number;
  modelRotationLocal: [number, number, number, number];
  contactRadiusM: number;
  contactBelowM: number;
  contactAboveM: number;
  fuseTipNode: 'FuseTip';
  flightPivotNode: 'FlightPivot';
}

export interface GripFrameSample { frame0: number; frame1: number; alpha: number }
export function validateHandClipManifest(input: unknown): HandClipManifest;
export function gripFrameSample(manifest: HandClipManifest, grip01: number): GripFrameSample;
export async function loadHandClip(url: string): Promise<HandClipVolume>;
```

- [ ] **Step 1: Write failing tests against the real checked-in v2 asset**

Verify all manifest rejections from Task B, exact binary/GLB hashes, texture dimensions `[nx,ny,nz*6]`, idempotent disposal, and these normalized samples:

```ts
expect(gripFrameSample(m, 0)).toEqual({ frame0: 0, frame1: 0, alpha: 0 });
const mid = gripFrameSample(m, 0.3);
expect(mid.frame0).toBe(1); expect(mid.frame1).toBe(2);
expect(mid.alpha).toBeCloseTo(0.5, 12);
expect(gripFrameSample(m, 1)).toEqual({ frame0: 5, frame1: 5, alpha: 0 });
```

- [ ] **Step 2: Export shared byte helpers from v1**

Export `sha256Hex(buffer: ArrayBuffer): Promise<string>` and
`createR16fTexture(bits: Uint16Array, dimensions: readonly [number, number, number]): THREE.Data3DTexture`
from `hand-volume.ts`. Make `loadHandVolume` use them and confirm the existing
v1 tests and checked-in v1 texture remain unchanged.

- [ ] **Step 3: Implement strict v2 load and normalized lookup**

Resolve binary and prop paths relative to the manifest URL. Validate JSON before allocation, binary bytes/hash before texture creation, and expose no partially initialized object on failure.
Also assert that `modelRotationLocal` rotates model +Y onto normalized
`axisLocal`; this makes the redundant axis/quaternion fields an integrity check
rather than two competing orientation sources.

### Task C2: Add slab-local trilinear sampling and distance mixing

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/specialise.ts`
- Modify: `src/lab/sdf-zombie/webgpu/specialise.test.ts`

**Interfaces:**
- Adds `volumeClip: vec4<f32>` where `.x=frame0`, `.y=frame1`, `.z=alpha`, `.w=frameDepth`.

- [ ] **Step 1: Add failing WGSL structure tests**

Require a `sampleHandVolumeFrame` helper, exactly eight `textureLoad`s inside it, Z offset `frame * frameDepth`, Z clamps ending at `zOffset + frameDepth - 1`, two frame calls, one `mix`, and `volumeClip` forwarded through every `mapBody`/`calcNormal`/march/specialised call.

- [ ] **Step 2: Split spatial sampling from frame mixing**

Implement slab-local indices:

```wgsl
let atlasDims = vec3<i32>(textureDimensions(volumeTex, 0));
let depth = max(1, i32(volumeClip.w));
let dimsI = vec3<i32>(atlasDims.x, atlasDims.y, depth);
let frame = clamp(frameIndex, 0, atlasDims.z / depth - 1);
let zBase = frame * depth;
let i0 = vec3<i32>(floor(q));
let i1 = min(i0 + vec3<i32>(1), dimsI - vec3<i32>(1));
let a0 = vec3<i32>(i0.x, i0.y, i0.z + zBase);
let a1 = vec3<i32>(i1.x, i1.y, i1.z + zBase);
```

Compute world→local, warp, UV, and outside-box distance once. Sample frame0 and frame1 independently, then return `mix(d0, d1, clamp(volumeClip.z,0,1)) + outside`. Carves/wounds/noise remain after this result exactly as in X1.26.

- [ ] **Step 3: Keep static/fallback semantics explicit**

Static v1 views bind `volumeClip=[0,0,0,nz]`; fallback binds `[0,0,0,1]`. No `frameDepth=0` sentinel is allowed in WGSL.

### Task C3: Bind frame uniforms in all view paths

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/fpv-view.ts`
- Modify: `src/lab/sdf-zombie/webgpu/fpv-view.test.ts`

**Interfaces:**
- `HandsGpuView.setField('prims'|'volume', volume?: HandVolume | HandClipVolume): void`
- `HandsGpuView.setVolumeFrame(frame0: number, frame1: number, alpha: number): void`

- [ ] **Step 1: Add `volumeClip` to defaults and every binding**

Initialize `defaultUniforms().volumeClip` to `new THREE.Vector4(0,0,0,1)`. Forward it beside `volumeWarp` in generic and specialised materials. Existing body/chunk views remain fallback frame zero.

- [ ] **Step 2: Extend the hands view with union-safe volume access**

Both manifest types share `boundsMin`, `boundsMax`, `dimensions`, and `voxelSize`. On `setField`, bind texture/bounds and set `.w` to v1 `dimensions[2]` or v2 `frameDepth`. `setVolumeFrame` clamps indices to `[0,frameCount-1]`, clamps alpha to `[0,1]`, and forces static v1 to `[0,0,0,nz]`.

- [ ] **Step 3: Run focused and full verification**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/hand-volume.test.ts \
  src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/specialise.test.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts \
  src/lab/sdf-zombie/webgpu/fpv-view.test.ts
npm test
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Perform the mandatory live WGSL smoke**

Start the dev server on an unused port, open `/sdf-lab-webgpu.html` in a visible WebGPU browser, switch to X1.26 static baked mode, and confirm a rendered hand plus no `GPUValidationError`, shader compilation error, or blank canvas. Record port/browser/result in the dev note.

- [ ] **Step 5: Commit Task C**

```bash
git add src/lab/sdf-zombie/webgpu/hand-volume.ts \
  src/lab/sdf-zombie/webgpu/hand-volume.test.ts \
  src/lab/sdf-zombie/webgpu/hand-volume-clip.ts \
  src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/specialise.ts \
  src/lab/sdf-zombie/webgpu/specialise.test.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts \
  src/lab/sdf-zombie/webgpu/fpv-view.ts \
  src/lab/sdf-zombie/webgpu/fpv-view.test.ts \
  docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md
git commit -m "feat(lab): interpolate baked hand clip"
```

---

## Dispatch Task D — load and seat the real dynamite GLB

### Task D1: Build a hash-checked GLB wrapper

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/dynamite-prop.ts`
- Create: `src/lab/sdf-zombie/webgpu/dynamite-prop.test.ts`

**Interfaces:**

```ts
export type DynamitePose =
  | { mode: 'hand'; position: Vec3; quaternion: [number,number,number,number]; cooking: boolean }
  | { mode: 'flight'; position: Vec3; spin: number; fuseBurning: boolean; releaseQuaternion?: [number,number,number,number] }
  | { mode: 'gone' };

export interface DynamiteProp {
  object: THREE.Object3D;
  pose(p: DynamitePose): void;
  flicker(nowSec: number, cooking: boolean): void;
  dispose(): void;
}

export async function loadDynamiteProp(
  manifestUrl: string,
  contract: DynamitePropContract,
): Promise<DynamiteProp>;
```

- [ ] **Step 1: Write failing hash/node/pose tests**

Stub fetch with a tiny GLB fixture. Assert SHA mismatch rejects before parse; missing `FuseTip` or `FlightPivot` rejects; hand pose copies exact root position/quaternion; `gone` hides; the first flight pose preserves `releaseQuaternion`; later spin composes after that quaternion; disposal is idempotent and disposes unique geometries/materials/textures once.

- [ ] **Step 2: Fetch, hash, then parse once**

Use `sha256Hex` before `GLTFLoader.parseAsync(buffer, baseUrl)`. Resolve `contract.url` relative to the clip manifest URL. Do not call `GLTFLoader.loadAsync`, because it would hide the bytes needed for integrity checking.

- [ ] **Step 3: Preserve existing visual interface behavior**

Create/reuse a small emissive spark sphere parented to `FuseTip`; `flicker` may retain the existing lab-only pulse. Keep the old `createStickProp` exported for primitive mode. Clip mode uses only `loadDynamiteProp`.

### Task D2: Derive the exact held GLB root transform from the hand volume

**Files:**
- Modify: `src/lab/sdf-zombie/hand-volume-pose.ts`
- Modify: `src/lab/sdf-zombie/hand-volume-pose.test.ts`

**Interfaces:**

```ts
export interface BakedPropPose {
  position: Vec3; // GLB FlightPivot/root in world space
  quaternion: [number,number,number,number];
}

export function bakedDynamitePose(
  hand: BakedHandPose,
  prop: DynamitePropContract,
): BakedPropPose;
```

- [ ] **Step 1: Add transform invariants**

Identity hand pose must place the authored grip point exactly at `prop.gripLocal`; a 90° hand quaternion rotates both root position and axis; `modelGripOffsetM` moves the GLB root opposite model +Y from the world grip; `modelRotationLocal` determines roll; inputs remain immutable.

- [ ] **Step 2: Implement quaternion composition with one source of truth**

The hand quaternion maps anatomical local to world. Rotate `gripLocal` by it, add hand centre, compose hand quaternion with `modelRotationLocal`, then subtract the composed model +Y times `modelGripOffsetM` to obtain the GLB root/flight pivot. Do not use primitive `handPropPoses` or `PROP_MESH` in this function.

- [ ] **Step 3: Verify and commit Task D**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/dynamite-prop.test.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/dynamite-prop.ts \
  src/lab/sdf-zombie/webgpu/dynamite-prop.test.ts \
  src/lab/sdf-zombie/hand-volume-pose.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts
git commit -m "feat(lab): load authored dynamite prop"
```

---

## Dispatch Task E — coordinate close, underhand swing, and deferred release

### Task E1: Add the pure grip/toss controller

**Files:**
- Create: `src/lab/sdf-zombie/hand-grip-clip.ts`
- Create: `src/lab/sdf-zombie/hand-grip-clip.test.ts`

**Interfaces:**

```ts
export type GripMotionPhase = 'open' | 'closing' | 'held' | 'throwing' | 'follow-through';
export interface GripMotionState { phase: GripMotionPhase; elapsedSec: number; releaseEmitted: boolean }
export interface GripMotionInput { bundlePresented: boolean; throwRequested: boolean }
export interface GripMotionFrame {
  grip01: number;
  wristOffsetCamera: Vec3;
  wristQuaternionCamera: [number,number,number,number];
  releaseNow: boolean;
  propHeld: boolean;
}
export function makeGripMotion(bundlePresented?: boolean): GripMotionState;
export function stepGripMotion(
  state: GripMotionState, input: GripMotionInput, dt: number,
): { state: GripMotionState; frame: GripMotionFrame };
export function gripCameraQuaternion(
  yaw: number, pitch: number,
): [number,number,number,number];
```

- [ ] **Step 1: Write failing timing and continuity tests**

Pin: close reaches 1 at 0.22 s; held stays 1; throw starts from the current held frame; fingers begin opening at 0.10 s; `releaseNow` occurs once crossing 0.15 s; grip reaches 0 by 0.22 s; follow-through ends at 0.24 s; negative/NaN dt does not advance; a 0.25 s dt still emits exactly one release; all phase boundaries have position/quaternion continuity.

Before setting the keys, read `public/assets/animations/weapons/dynamite-throw.json`: it has 17 frames at 42 ms, and the open-hand tile 3225 first appears at frame index 4 (168 ms). The 150 ms marker and 240 ms swing intentionally match that early underhand release silhouette; no Blood pixels enter the implementation or captures.

- [ ] **Step 2: Implement deterministic curves**

Use clamped smoothstep interpolation between these camera-local keys:

```ts
export const GRIP_MOTION = {
  closeSec: 0.22,
  swingSec: 0.24,
  openAtSec: 0.10,
  releaseAtSec: 0.15,
  releaseSec: 0.12,
  startOffset: [0, -0.025, -0.015] as Vec3,
  releaseOffset: [0.020, 0.085, 0.095] as Vec3,
  followOffset: [0.035, 0.120, 0.150] as Vec3,
  startEuler: [0.10, 0, -0.08] as Vec3,
  releaseEuler: [-0.25, 0.05, 0.16] as Vec3,
  followEuler: [-0.38, 0.08, 0.20] as Vec3,
} as const;
```

Convert Euler keys to normalized quaternions and slerp. A newly presented bundle plays open→held; held does not breathe through the clip. A throw request is consumed only from held and sets `releaseEmitted=false`.

`gripCameraQuaternion` builds the same right/up/forward orientation as
`fpv-mode.ts`'s `camBasis(yaw,pitch)`. Test yaw 0/pitch 0 and a 90° yaw. The lab
uses this current-frame value for wrist offsets; it must not reuse
`camera.quaternion`, which is updated later in the frame and includes camera
kick/roll rather than the hand-placement basis.

### Task E2: Compose wrist motion onto the baked hand

**Files:**
- Modify: `src/lab/sdf-zombie/hand-volume-pose.ts`
- Modify: `src/lab/sdf-zombie/hand-volume-pose.test.ts`

**Interfaces:**

```ts
export function applyGripMotion(
  base: BakedHandPose,
  frame: GripMotionFrame,
  cameraQuaternion: [number,number,number,number],
): BakedHandPose;
```

- [ ] **Step 1: Test camera-space composition**

Identity camera copies the frame offset; a 90° camera yaw rotates it; the output quaternion is `camera * wristCamera * inverse(camera) * base`; warp remains in anatomical local coordinates and unchanged; inputs are immutable.

- [ ] **Step 2: Implement the composition and normalize the output quaternion**

This function moves the entire volume and therefore the prop derived from it. Do not put the underhand arc into `volumeWarp`; warp remains secondary distal lag only.

### Task E3: Add clip-only deferred throw ownership

**Files:**
- Modify: `src/lab/sdf-zombie/fpv-mode.ts`
- Modify: `src/lab/sdf-zombie/fpv-mode.test.ts`

**Interfaces:**

```ts
export type ThrowReleaseMode = 'immediate' | 'deferred';
export interface PendingThrow { direction: Vec3; speedMps: number }

// Added to FpvModeState:
pendingThrow: PendingThrow | null;

export function releasePendingThrow(
  state: FpvModeState,
  position: Vec3,
  handVelocity: Vec3,
): FpvModeState;
```

Add final optional `releaseMode: ThrowReleaseMode = 'immediate'` to `stepFpvMode` and `forceThrow`.

- [ ] **Step 1: Pin current behavior before refactoring**

Add a test that default `stepFpvMode` still spawns `flight` on the input release frame at the current `throwOrigin`, with no `pendingThrow`. This must pass before changing implementation.

- [ ] **Step 2: Add failing deferred-mode tests**

In deferred mode the throw signal sets `pendingThrow` and no flight; subsequent frames do not duplicate it; `releasePendingThrow` spawns at the exact passed position, clears pending, and adds a hand-velocity vector capped to 2.5 m/s to the stored aim-direction impulse; a second release call is identity; the new flight does not integrate until the next `stepFpvMode`; overcook still detonates immediately.

- [ ] **Step 3: Implement pending ownership without changing physics**

Store a copy of direction/speed when the cook controller emits `throw`. `releasePendingThrow` calls existing `makeFlight` once. Do not add a second flight integrator or alter `makeFlight`, fuse, impact, or detonation logic.

- [ ] **Step 4: Run and commit Task E**

```bash
npx vitest run src/lab/sdf-zombie/hand-grip-clip.test.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts \
  src/lab/sdf-zombie/fpv-mode.test.ts \
  src/lab/sdf-zombie/dynamite-flight.test.ts
npm test
npx tsc --noEmit
git add src/lab/sdf-zombie/hand-grip-clip.ts \
  src/lab/sdf-zombie/hand-grip-clip.test.ts \
  src/lab/sdf-zombie/hand-volume-pose.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts \
  src/lab/sdf-zombie/fpv-mode.ts src/lab/sdf-zombie/fpv-mode.test.ts
git commit -m "feat(lab): coordinate underhand grip release"
```

---

## Dispatch Task F — wire the lab and run the owner gate

### Task F1: Extend pure hand-field UI policy to clip mode

**Files:**
- Modify: `src/lab/sdf-zombie/fpv-mode.ts`
- Modify: `src/lab/sdf-zombie/fpv-mode.test.ts`

**Interfaces:**

```ts
export type HandFieldMode = 'prims' | 'baked' | 'clip';
export interface HandFieldUi {
  field: HandFieldMode;
  warp: boolean;
  clay: boolean;
  staticLoad: HandVolumeLoadState;
  clipLoad: HandVolumeLoadState;
  clipError: string;
}
export interface HandFieldFramePolicy {
  leftHand: boolean;
  rightHand: boolean;
  primitiveProps: boolean;
  clipStick: boolean;
}
export function settleHandClip(
  ui: HandFieldUi, ok: boolean, error?: string,
): HandFieldUi;
```

- [ ] **Step 1: Add failing policy transitions**

Fresh state is prims with both loads pending; `baked` requires static ready; `clip` requires both clip and GLB ready; clip load failure forces `baked` when static is ready and otherwise prims; clip mode shows only the right hand plus clip stick; switching to prims restores both hands and primitive props.

- [ ] **Step 2: Implement explicit load settlement**

Replace the single ambiguous `settleHandVolume` with `settleStaticHandVolume` and `settleHandClip`. Keep compatibility wrappers only if existing tests/public calls require them; new code must read the named states.

### Task F2: Load and drive clip + GLB in the WebGPU lab

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/fpv-mode.test.ts`

**Interfaces:**
- Loads `/assets/lab/hand-sdf-dynamite-grip-r.json`, then loads the contract's relative GLB with `loadDynamiteProp`.
- Public automation adds:

```ts
setHandField(field: 'prims'|'baked'|'clip'): void;
setGripPlayback(mode: 'pause'|'play'|'loop'): void;
setGripProgress(grip01: number): void;
setGripSpeed(multiplier: number): void;
playGripThrow(charge?: number): void;
```

- [ ] **Step 1: Load coherently and dispose exactly once**

Start the static load independently. For the clip path, load and validate the v2
manifest/texture first, then load its relative hash-matched GLB; call
`settleHandClip(handFieldUi, true)` only after both objects are ready. On either failure,
store one `clipError` and fall back to X1.26 static baked mode; never pair the
clip with the procedural prop. Dispose static texture, clip texture, and GLB
resources on `pagehide` exactly once.

- [ ] **Step 2: Drive adjacent frames and the animated hand pose**

Each frame in clip mode:

1. call `stepFpvMode(fpvMode, fpvInput, dt, fpvNow, fpvWorld, gorePort, FPV_FLOOR_BOUNDS, 'deferred')`;
2. feed `pendingThrow !== null` as the controller's `throwRequested` edge;
3. step `GripMotionState` from frame `dt`;
4. call `gripFrameSample(manifest, grip01)` and `handViews.right.setVolumeFrame`;
5. derive X1.26 base pose, then call `applyGripMotion(base, motion, gripCameraQuaternion(ff.yaw, ff.pitch))`;
6. set the volume pose and derive `bakedDynamitePose` from that exact animated pose;
7. while `propHeld`, send that root transform to the GLB.

Primitive mode continues calling `stepFpvMode` with its default immediate behavior. Static baked mode remains the X1.26 isolated hand.

- [ ] **Step 3: Perform the release on the marker frame**

Keep the previous rendered GLB root position. When `releaseNow` is true, compute `(currentRoot - previousRoot) / max(dt, 1/240)`, call `releasePendingThrow(fpvMode, currentRoot, velocity)`, and on that same render frame pose the GLB from the new `flight.pos` with `releaseQuaternion=currentRootQuaternion`. Afterward flight exclusively owns it. Confirm the root position before/after transfer differs by less than 0.1 mm.

- [ ] **Step 4: Present the next bundle only at recovery**

`bundlePresented` is true when there is no flight, no pending throw, and the existing hand phase is `idle | light | cook`. A new presentation restarts open→firm-grip. While `idle | light | cook`, a completed close remains at grip 1.

### Task F3: Add compact lab controls and non-gameplay scrub

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`

- [ ] **Step 1: Add panel controls**

Add `hand field: prims | baked | clip`, `grip: play/pause/loop`, `grip progress`, `grip speed`, `hand warp`, `hand clay`, and `contact debug`. Show clip/GLB load errors inline.

- [ ] **Step 2: Keep scrub purely visual**

Manual `setGripProgress` changes only the frame sample and held prop pose. It must not create `pendingThrow`, flight, fuse activity, or an explosion. Only pointer-release/`playGripThrow` enters the deferred throw flow.

- [ ] **Step 3: Add fixed automation state**

Expose current phase, `grip01`, frame0/frame1/alpha, release count, prop owner, GLB root position, flight position, static/clip/GLB load state, and last error under `window.__sdfLab.fpv` for deterministic capture assertions.

### Task F4: Verify, capture, benchmark, and document the owner gate

**Files:**
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/open.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/first-contact.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/wrap.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/thumb-lock.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/firm-grip.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/release-marker.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/bundle-clear.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/follow-through.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/grip-release-loop.webm`
- Modify: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Run the complete automated verification**

```bash
uv run scripts/test_author_dynamite_grip.py -v
uv run scripts/author_dynamite_grip.py --validate-only
uv run scripts/test_bake_hand_sdf.py -v
uv run scripts/bake_hand_sdf.py --validate-only
uv run scripts/test_bake_hand_sdf_clip.py -v
uv run scripts/bake_hand_sdf_clip.py --validate-only
npm test
npx tsc --noEmit
npm run build
```

- [ ] **Step 2: Run the mandatory live WebGPU sequence**

On a visible page, enter FPV, select clip, confirm open→close, cook, throw, marker handoff, flight, detonation, recovery, and next close. Console must contain no shader/pipeline/GLB/unhandled-rejection error.

- [ ] **Step 3: Capture the eight fixed views and two loops**

Pin eye/yaw/pitch, material, light, SDF scale, wounds, and jiggle. Capture the eight named states with jiggle off, then a normal-speed loop with jiggle off and one with jiggle on. Record a numerical handoff assertion: held GLB root at marker equals initial flight position within 0.1 mm.

- [ ] **Step 4: Apply the owner checklist**

Record with `Owner verdict: PENDING`:

```text
[ ] closure is visible and continuous at normal speed
[ ] five fingers and web spaces survive every midpoint
[ ] thumb lock visibly secures the bundle
[ ] prop scale/silhouette reads as a dynamite bundle
[ ] no distracting hand/prop penetration or floating contact
[ ] wrist arc reads as an underhand toss
[ ] fingers open late rather than before the swing
[ ] bundle visibly continues out of the palm
[ ] held→flight position/orientation has no visible jump
[ ] follow-through and replacement close read cleanly
```

- [ ] **Step 5: Benchmark against X1.26 static baked mode**

Alternate static 1, clip 1, clip 2, static 2 on a visible page with identical settings and 240 samples each. Record median/p05/p95, `hiddenSteps`, GLB bytes, clip bytes, texture dimensions, and estimated GPU R16F bytes. Investigate above 35 MiB or +0.75 ms median; do not waive the visual gate for performance.

- [ ] **Step 6: Update status but leave the owner gate pending**

Update X1.27 in `TASKS.md` to `owner visual gate pending`, linking design, plan, notes, loop, and benchmark. Do not mark complete until the owner watches the loop and explicitly passes it.

- [ ] **Step 7: Commit Task F**

```bash
git add src/lab/sdf-zombie/fpv-mode.ts src/lab/sdf-zombie/fpv-mode.test.ts \
  src/lab/sdf-zombie/webgpu/lab-main.ts \
  docs/dev-notes/2026-08-17-sdf-dynamite-grip TASKS.md
git commit -m "feat(lab): add baked dynamite grip release gate"
```

## Owner decision after dispatch

- **PASS:** mark X1.27 complete; preserve captures/benchmark; next design may use this grip/prop infrastructure for the cigarette-to-fuse performance.
- **FAIL — prop/pose:** revise Task A's final derived GLB/contact solve, then rebake and repeat downstream evidence. Do not runtime-scale the GLB.
- **FAIL — midpoint field artifact:** add or reposition an authored intermediate frame or investigate a local warp. Do not hide the defect with faster playback.
- **FAIL — release discontinuity:** fix the shared rendered-root handoff and velocity derivation. Do not conceal it with fuse particles or motion blur.
