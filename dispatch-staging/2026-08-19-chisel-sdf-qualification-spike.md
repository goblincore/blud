---
title: "Chisel SDF Qualification Spike"
status: pending
project: /Users/donny/Projects/blud
model: zai/glm-5.3:max
api_key_env: ZAI_API_KEY
base_url: https://api.z.ai/api/paas/v4
branch: dispatch/chisel-sdf-qualification-spike
base_branch: dispatch/blender-sdf-grid-authoring-task-1
priority: 1
max_runtime: 90m
created: 2026-08-19
depends_on: []
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## Context

This is a bounded feasibility spike that compares the newly installed Chisel
4.0.1 mesh-SDF machinery with the already-qualified Blender/OpenVDB work on
base branch `dispatch/blender-sdf-grid-authoring-task-1` (`4019415`). Its output
is evidence and a recommendation, not a retained production implementation.

Read first:

- `AGENTS.md`
- `TASKS.md`
- `docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md`
- `docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md`
- `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`
- `scripts/blender_sdf_grid.py`
- `scripts/test_blender_sdf_grid.py`
- `/Users/donny/.claude/dispatch/reports/2026-08-18-blender-sdf-grid-authoring-task-1-20260818-200117.txt`

The stopped Task 2 branch is explicitly out of scope. Do not merge, cherry-pick,
or continue `dispatch/blender-sdf-grid-authoring-task-2`.

The installed add-on is at:

- `/Users/donny/Library/Application Support/Blender/5.2/extensions/user_default/chisel`
- native wheel site-packages:
  `/Users/donny/Library/Application Support/Blender/5.2/extensions/.local/lib/python3.13/site-packages`

Relevant primary documentation:

- <https://chisel.ezelar.com/v4/>
- <https://chisel.ezelar.com/v4/primitives/mesh>
- <https://chisel.ezelar.com/v4/operations/convert>
- <https://chisel.ezelar.com/v4/changelog>

## Hard scope and safety limits

- This is throwaway research. Do not integrate Chisel into
  `scripts/blender_sdf_grid.py`, downstream bakers, runtime code, or manifests.
- Do not modify `TASKS.md` or mark `X1.sdf-authoring` complete.
- Do not copy or vendor Chisel/add-on/native-wheel source or binaries into the
  repository. Record that it is an optional user-installed development tool.
- Put probe scripts and intermediate `.vdb`, `.blend`, dense grids, extracted
  meshes, and source assets in a task-owned temporary directory outside git.
- Never run an exhaustive Python `O(vertices * faces)` distance loop. Use
  Chisel's native vectorized APIs, OpenVDB, NumPy sampling, or bounded probe
  points. Abort any single diagnostic that exceeds 5 minutes without progress.
- Cap analytic inputs at longest-axis resolution 96 and real-source inputs at
  128. Do not allocate a dense grid above 256 cells on any axis or above
  12,000,000 voxels total.
- Use `normals=None` for the canonical Chisel geometric bake. A smooth-normal
  comparison may be reported separately but must not define the verdict.
- Use Blender `--background --factory-startup` and separate Blender processes
  for determinism checks.
- Chisel's documented `resolution` is longest-axis cells plus `padding`; it is
  not the same control as OpenVDB voxel size. Compare accuracy at shared
  metre-space probe points and compare each backend's bytes to its own repeated
  run. Do not require Chisel bytes to equal OpenVDB bytes.

## Qualification question

Can Chisel provide a deterministic, headless, metre-space mesh-to-dense-SDF
and boolean-composition backend suitable for the humanoid support-intersection
and FPV distal-arm union workflows, with a clean adapter to the existing R16F
contract? If only direct mesh baking qualifies, say so; do not promote boolean
composition by inference.

## Required work

### 1. Re-establish the OpenVDB control

- Run the existing focused suite and capability/analytic fixture commands from
  Task 1. Record exact command, pass count, selected route, fixture hashes, and
  timings.
- Confirm the Blender 5.2 `SDF Grid Boolean` defect remains captured and that
  the control route composes union/intersection through the qualified OpenVDB
  workaround. Do not change the control implementation.

### 2. Characterize the installed Chisel API headlessly

- Record Blender version, Chisel manifest version/license, `armesher` module
  path, callable signatures/docstrings for `bake_mesh_sdf`, `SDFEvaluator`,
  `MarchingCubes`, and `DualContouring`, plus a stable hash of the add-on
  manifest and installed native wheel file.
- Call `armesher.bake_mesh_sdf` directly from factory-startup Blender after
  adding the installed wheel directory to `sys.path`; do not drive the modal UI
  operator.
- Confirm and record grid flattening order, dimensions, origin, uniform
  spacing, sign convention, padding/exact-field behavior, content hash,
  `winding_confidence`, float dtype, and memory footprint.
- Inspect enough installed Python glue to understand the supported way to feed
  baked mesh grids into `SDFEvaluator`. Do not reproduce add-on source in the
  report; summarize interfaces and behavior.

### 3. Run analytic and transform gates

At modest resolution, evaluate:

- closed 0.1 m cube
- sphere
- overlapping two-mesh union
- source/support intersection
- translated cube
- rotated non-cubic box

For each applicable backend, record bounds, dimensions, spacing, centre/exterior
sign, zero-surface error at known metre-space points, winding confidence,
runtime, dense byte count, and a SHA-256 of little-endian R16F bytes.

Run every Chisel fixture twice in separate Blender processes. Require canonical
metadata equality and byte-identical R16F within Chisel. For transforms, prove
the selected basis and origin numerically; do not rely on a preview.

### 4. Qualify Chisel boolean composition separately

- Use Chisel's supported low-level evaluator/scene path to compose two baked
  mesh SDFs, if available headlessly. Prove union retains both inputs and
  intersection retains only overlap using analytic probe points and bounds.
- Sample the composed field onto one explicit common metre-space lattice and
  encode it to R16F twice across separate processes.
- Compare shared probe-point error and performance with Task 1's `direct-vdb`
  composition.
- Time-box low-level scene construction investigation to 20 minutes. If no
  supported, maintainable headless composition path is found, record the exact
  missing interface/error and classify boolean composition as unqualified.
  Do not patch or monkey-patch Chisel internals to force a pass.

### 5. Run bounded real-source smoke gates

- Firm-grip right hand: use the existing firm-grip source/manifest referenced
  by `public/assets/lab/hand-sdf-dynamite-grip-r.json`. Keep extraction and bake
  artifacts temporary.
- Humanoid forearm: extract only the required source from existing repository
  history if it is absent from the base branch; a known source is commit
  `02c074b:assets-source/humanoid-sdf/zombie-rigged.glb`. Keep it temporary and
  test only a bounded forearm crop/support volume, never the full atlas.
- For each, record topology/winding diagnostics, Chisel confidence, runtime,
  dimensions/memory, repeat hash, correct handedness/basis, and whether the
  exact-field margin is sufficient for the intended union/intersection.
- Generate compact central-slice previews for human inspection, but never use
  previews as substitutes for numeric gates.

### 6. Write the evidence and verdict

Create only:

- `docs/dev-notes/2026-08-19-chisel-sdf-qualification/notes.md`
- `docs/dev-notes/2026-08-19-chisel-sdf-qualification/qualification.json`
- up to three compact PNG previews in the same directory

The JSON must be deterministic, machine-readable, and contain commands,
versions/hashes, parameters, per-fixture metrics, repeat equality, failures,
and the final classification. The note must distinguish measured evidence,
documentation claims, and inference.

Choose exactly one final classification:

1. `qualified-optional-backend` — mesh bake, transforms, booleans,
   determinism, and both real-source smoke gates pass.
2. `qualified-mesh-bake-only` — deterministic mesh-to-SDF passes, but boolean
   composition or a composition-dependent real-source gate does not.
3. `interactive-preview-only` — headless determinism, sign/transform, or
   practical real-source use fails.
4. `rejected` — unsafe, unusable, or materially worse than the control.

State whether a follow-up production design is warranted. Do not implement it.

## Verification and completion

Before committing:

- Re-run the existing Task 1 focused tests unchanged.
- Validate `qualification.json` with Python's JSON parser.
- Verify every referenced preview exists and has non-zero dimensions.
- Run `git diff --check`.
- Confirm `git diff --name-only` contains only the allowed dev-note files.

Commit only the evidence with:

```bash
git add docs/dev-notes/2026-08-19-chisel-sdf-qualification
git commit -m "docs(sdf-tools): qualify Chisel mesh SDF backend"
```

In the final report, give the classification, decisive measurements, failed or
unproven gates, exact verification results, commit hash, and recommendation.

## Acceptance criteria

- The OpenVDB control is re-verified without modification.
- Chisel mesh baking is tested headlessly and twice across separate processes.
- Analytic sign, transform, surface, determinism, and bounded resource gates
  have measured results.
- Boolean qualification has direct evidence or an explicit time-boxed failure.
- Firm-grip hand and humanoid forearm smoke gates are bounded and measured.
- Only the allowed evidence files are committed; no production integration or
  task-board change is made.
