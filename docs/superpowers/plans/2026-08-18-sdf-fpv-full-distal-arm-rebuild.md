# X1.hand-followups Full Distal FPV Arm Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to execute this plan task-by-task.
> Every implementation task follows RED → GREEN → focused verification → commit
> → code review. Do not advance through a failed visual gate.

**Goal:** Replace the rejected runtime wrist union and synthetic-forearm
reference with one Blender-fused hand+wrist+forearm SDF clip, join it only at
the humanoid elbow, and reproduce the original Blud low hold, lighter reach and
casual underhand toss without a floating hand or visible shoulder.

**Architecture:** The shared Blender 5.2 Geometry Nodes backend converts each
accepted X1.27 grip-hand pose, minimal bridge and aligned humanoid forearm to a
common SDF grid and unions them offline. It emits direct grid samples when the
shared OpenVDB route is qualified, otherwise Grid to Mesh at threshold zero and
adaptivity zero feeds the deterministic libigl sampler. Six continuous distal
fields share one R16F atlas and strict hash-bound manifest. The dedicated WebGPU
view samples that clip plus the existing humanoid `RightArm` brick and blends
only at the elbow. A Blud-derived two-hand choreography contract constrains the
right hold/underhand toss together with the existing left pinch/lighter hand.

**Tech stack:** Python 3.12 via `uv`, Blender 5.2 Geometry Nodes, OpenVDB when
qualified, NumPy, libigl fallback, TypeScript 5.6, Three.js 0.185 WebGPU/TSL,
WGSL, Vitest 2 and Vite 5.

**Spec:** `docs/superpowers/specs/2026-08-18-sdf-fpv-full-distal-arm-rebuild-design.md`

## Global constraints

- Complete and review
  `docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md` first. Use
  its selected route and canonical node contract without reimplementation or a
  silent route switch.
- Execute on a new `codex/fpv-full-distal-arm-rebuild` branch/worktree based on
  current main, selectively preserving the reviewed loader, arm solver, browser
  harness and rejection evidence. The rejected synthetic-forearm pose/motion is
  not a baseline.
- Never restore the rejected runtime wrist clip/taper/smooth-union path. The
  rebuilt shader has no separate hand and forearm samples.
- Preserve all six X1.27 grip labels/keys, the accepted `bakedDynamitePose`, prop
  GLB/seat, release marker (`0.15 s`) and flight physics.
- Preserve the checked-in timing/layer authority in `dynamite-idle.json`,
  `dynamite-lighter-ignite.json`, `dynamite-lighter-lower.json`, and
  `dynamite-throw.json`. Modest 3D offsets are allowed only inside the measured
  keyframe corridor; a football/overhand hold is forbidden.
- Include the existing left pinch/lighter hand in every held/lighting gate. Do
  not expand scope to a second full-arm bake unless that geometry separately
  fails owner review.
- Consume the canonical humanoid source/manifest by hash and keep its
  `RightForeArm` elbow boundary compatible with `RightArm`.
- Target a 1.5 mm common grid. Stop for review rather than silently lowering
  resolution or exceeding the explicit 128 MiB distal-atlas budget.
- The rebuilt distal mesh must be one closed connected component per frame,
  have zero boundary edges, preserve the grip contact region within 0.75 mm and
  keep adjacent 5 mm bridge slice-area jumps at or below 12%.
- At rest, keep shoulder and elbow outside the viewport and the arm uncropped.
  During toss the elbow may enter only the outer lower/right 15% for at most one
  quarter of the toss phase; the shoulder never enters.
- Shade both arm pieces with the X1.27 flesh material. Do not bind humanoid color
  bricks.
- Keep hand-only fallback operational on any rebuilt-asset load/validation
  failure.
- Run Vitest with `NODE_OPTIONS=--no-experimental-webstorage` under Node 25.
- Any WGSL change requires a real headed WebGPU smoke; string tests and Vite
  compilation are insufficient.
- Gate B owner approval is required before Task 5. Gate C two-hand lighting
  approval is required before the toss portion of Task 5. A failed gate stops
  the plan; no later motion tuning is authorized on a rejected asset/pose.
- Development-only extracted Blood assets remain untracked and never ship.

## File and interface map

### New files

- `scripts/bake_fpv_distal_arm.py` — source validation, anatomical alignment,
  bridge construction, qualified Blender grid union, six-frame SDF bake,
  manifest, reports and previews.
- `scripts/test_bake_fpv_distal_arm.py` — synthetic mesh/bridge/grid/hash tests
  and checked-in real-asset validation.
- `public/assets/lab/fpv-distal-arm-r.r16f` — six depth-packed distal frames.
- `public/assets/lab/fpv-distal-arm-r.json` — strict version-1 asset contract.
- `src/lab/sdf-zombie/fpv-distal-arm.ts` — manifest validator/loader and
  cross-validation against hand/humanoid sources.
- `src/lab/sdf-zombie/fpv-distal-arm.test.ts` — acceptance and mutation tests.
- `src/lab/sdf-zombie/webgpu/fpv-distal-arm.wgsl.ts` — distal clip + upper-arm
  elbow field and marcher.
- `src/lab/sdf-zombie/webgpu/fpv-distal-arm.wgsl.test.ts` — CPU/WGSL contract,
  field split and elbow-bound tests.
- `src/lab/sdf-zombie/webgpu/fpv-distal-arm-view.ts` — texture bindings,
  uniforms, material, proxy and lifecycle.
- `src/lab/sdf-zombie/webgpu/fpv-distal-arm-view.test.ts` — binding, pose,
  proxy, output/depth and disposal tests.
- `scripts/verify-fpv-distal-arm.mjs` — real browser static/motion capture and
  diagnostic assertions.
- `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/bake-report.json`
- `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/bridge-preview.png`
- `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/firm-grip-preview.png`
- `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/verification.md`
- `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/choreography.json` — hashes,
  timing/layer landmarks and allowed screen-space/depth corridor for idle,
  lighter contact/withdrawal and underhand throw.
- `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/two-hand-reference.png`

### Existing files that change

- `src/lab/sdf-zombie/fpv-arm-motion.ts` — expose a rigid authored
  distal/hand frame, apply the approved Blud keyframe corridor and remove hybrid
  wrist correction from rebuilt mode.
- `src/lab/sdf-zombie/hand-grip-clip.ts` — retain its exact release marker while
  accepting the approved low-hold/underhand camera-local keys.
- `src/lab/sdf-zombie/fpv-mode.ts` — rebuilt load policy and safe fallback.
- `src/lab/sdf-zombie/webgpu/lab-main.ts` — create/drive rebuilt view and make
  the prop use its final authored hand transform.
- `TASKS.md` — status and owner gates.

### Stable interfaces

```ts
export interface FpvDistalArmManifest {
  version: 1;
  kind: 'fpv-distal-arm-sdf-clip';
  binary: string;
  encoding: 'r16f-le';
  order: 'x-fastest-y-z';
  dimensions: [number, number, number];
  atlasDimensions: [number, number, number];
  frameDepth: number;
  frameCount: 6;
  frames: readonly { label: string; key: number }[];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxelSize: [number, number, number];
  byteLength: number;
  sha256: { binary: string; handClip: string; humanoid: string; source: string };
  armUniformScale: number;
  distalFromHumanoidForearm: readonly number[];
  handFromDistal: readonly number[];
  elbow: { center: [number, number, number]; axis: [number, number, number]; overlapM: number };
  diagnostics: {
    connectedComponents: readonly number[];
    boundaryEdges: readonly number[];
    contactErrorM: number;
    maxBridgeSliceAreaJump: number;
    remeshPitchM: number;
    blenderVersion: string;
    sdfRoute: 'direct-vdb' | 'grid-to-mesh-libigl';
    nodeContractSha256: string;
  };
}

export interface LoadedFpvDistalArm {
  manifest: FpvDistalArmManifest;
  field: Uint16Array;
  upperArm: HumanoidBrickManifest;
  upperArmLengthM: number;
  forearmLengthM: number;
}

export function validateFpvDistalArmManifest(input: unknown): FpvDistalArmManifest;
export async function loadFpvDistalArm(url: string, sources: {
  hand: LoadedHandClip;
  humanoid: HumanoidVolumeManifest;
}): Promise<LoadedFpvDistalArm>;

export interface FpvDistalArmView {
  object: THREE.Object3D;
  setFrame(frame0: number, frame1: number, alpha: number): void;
  setPose(pose: FpvArmPose): void;
  setClay(on: boolean): void;
  setVisible(on: boolean): void;
  diagnostics(): FpvDistalArmViewDiagnostics;
  dispose(): void;
}
```

---

## Prerequisite P0: Qualify the shared Blender-native SDF backend

**Plan:** `docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md`

- [ ] Execute both shared tasks and review
  `docs/dev-notes/2026-08-18-blender-sdf-grid/qualification.json`.
- [ ] Require one selected route (`direct-vdb` or `grid-to-mesh-libigl`),
  passing sign/transform/union probes and byte-deterministic hand-crop output.
- [ ] Stop if the qualification is missing, failed, uses an unpinned Blender
  version, requires Chisel, or depends on an opaque manual `.blend`.

---

## Task 0: Pin the Blud two-hand choreography corridor

**Files:**
- Create: `scripts/fpv_dynamite_choreography.py`
- Create: `scripts/test_fpv_dynamite_choreography.py`
- Create: `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/choreography.json`
- Create: `docs/dev-notes/2026-08-18-sdf-fpv-distal-arm/two-hand-reference.png`
- Read only: `public/assets/animations/weapons/dynamite-idle.json`
- Read only: `public/assets/animations/weapons/dynamite-lighter-ignite.json`
- Read only: `public/assets/animations/weapons/dynamite-lighter-lower.json`
- Read only: `public/assets/animations/weapons/dynamite-throw.json`

**Interfaces:**
- Produces: a hash-bound `FpvDynamiteChoreography` contract containing source
  animation names/durations/layer offsets, semantic landmarks `low-hold`,
  `lighter-entry`, `fuse-contact`, `lighter-withdrawn`, `cook`, `release`, and
  `follow-through`, plus per-landmark right-hand/prop and left-pinch screen
  corridors consumed by Tasks 4–6.

- [ ] **Step 1: Write RED source/timeline tests**

```python
class ChoreographySourceTest(unittest.TestCase):
    def test_checked_in_animation_timing_is_the_authority(self):
        idle = CHOREO.load_qav("dynamite-idle.json")
        ignite = CHOREO.load_qav("dynamite-lighter-ignite.json")
        lower = CHOREO.load_qav("dynamite-lighter-lower.json")
        throw = CHOREO.load_qav("dynamite-throw.json")
        self.assertEqual((idle.n_frames, ignite.n_frames, lower.n_frames, throw.n_frames),
                         (6, 7, 6, 17))
        self.assertTrue(all(f.duration_ms == 42 for q in (idle, ignite, lower, throw)
                            for f in q.frames))
        self.assertEqual(CHOREO.first_frame_containing(throw, tile=3225), 4)
```

Also require every source JSON hash in the output, no embedded/extracted Blood
pixels, ordered semantic landmarks, fuse contact before lighter withdrawal,
withdrawal before release, and the existing release marker remaining `0.15 s`.

- [ ] **Step 2: Run RED**

Run: `uv run scripts/test_fpv_dynamite_choreography.py -v`

Expected: FAIL because the parser/contract and `choreography.json` do not exist.

- [ ] **Step 3: Build the metadata-only reference contract**

Parse the four checked-in animation JSON files and preserve frame durations,
tile identifiers, layer offsets and ordering as metadata. Derive normalized
screen-space reference centres from the QAV offsets using one documented
viewport mapping. Record tolerances rather than exact pixels:

- right-hand/bundle centre: ±6% viewport width/height at low hold and cook;
- left pinch/lighter centre: ±7% during entry/contact/withdrawal;
- fuse-contact separation: at most 4% of viewport diagonal;
- modest 3D depth adjustment: at most 60 mm from the accepted X1.27 camera-local
  hold unless owner review explicitly changes the contract; and
- throw silhouette ordering/release timing follows the 17-frame/42 ms source,
  while X1.27's `0.15 s` physics handoff remains exact.

These are initial review bounds, not automatic visual approval. Do not commit
source sprite pixels or use extracted Blood assets in runtime.

- [ ] **Step 4: Capture the accepted 3D baseline with both hands visible**

Use the current accepted X1.27 hand/prop and existing left pinch hand in the
real headed WebGPU page. Capture low hold, lighter contact, lighter withdrawal,
cook and underhand release at the deterministic camera. Compose only those
runtime captures plus metadata overlays into `two-hand-reference.png`; record
the exact browser command/viewport and current asset hashes.

- [ ] **Step 5: Verify and commit**

Run the focused Python test twice, compare `choreography.json`, run
`git diff --check`, inspect the contact/throw ordering and commit:

```bash
git add scripts/test_fpv_dynamite_choreography.py \
  scripts/fpv_dynamite_choreography.py \
  docs/dev-notes/2026-08-18-sdf-fpv-distal-arm
git commit -m "test(sdf-lab): pin Blud fpv dynamite choreography"
```

---

## Task 1: Bake one continuous six-frame distal arm asset

**Files:** create `scripts/bake_fpv_distal_arm.py`,
`scripts/test_bake_fpv_distal_arm.py`, the distal JSON/R16F outputs and the
bake report/previews.

- [ ] Write failing synthetic tests for proper rigid wrist-frame recovery,
  reflection rejection, loop correspondence, bridge winding, monotone slice
  interpolation, one-component/zero-boundary validation, common grid packing,
  deterministic canonical JSON and hash/truncation rejection. Also reject a
  changed Blender version, selected SDF route, node-contract hash, voxel size,
  boolean operation, Grid-to-Mesh threshold or adaptivity.
- [ ] Run `uv run scripts/test_bake_fpv_distal_arm.py -v` and record RED because
  the baker module does not exist.
- [ ] Implement import-safe pure helpers first. Reuse the accepted hand clip's
  grid/field helpers and the humanoid baker's canonical source parsing rather
  than copying divergent decoders. Import P0's
  `bake_mesh_union_to_dense`, selected route and node-contract hash.
- [ ] Add a Blender inner stage that obtains all six accepted hand pose soups,
  extracts and closes the `RightForeArm` source surface plus retained elbow
  band, aligns it once to the X1.27 wrist, and constructs the minimal 35 mm
  bridge. For each frame, convert the hand/bridge/forearm inputs to one common
  1.5 mm grid with **Mesh to SDF Grid** and combine them with **SDF Grid
  Boolean: Union**.
- [ ] In direct mode consume the resulting signed grid. In fallback mode use
  **Grid to Mesh** at threshold `0.0` and adaptivity `0.0`, then the existing
  libigl baker on the approved final grid. Record the route in the manifest and
  forbid an unreported switch.
- [ ] Protect the hand contact region and elbow boundary from filtering. Measure
  connected components, boundary edges, contact displacement, 5 mm bridge slice
  areas and surface error against the original hand/forearm meshes. Fail if a
  clean wrist requires global smoothing that changes fingers or palm volume.
- [ ] Bake all six surfaces on one common grid, depth-pack R16F bytes, emit the
  strict canonical manifest including Blender/route/node-contract provenance,
  and render the bridge/firm-grip previews.
- [ ] Validate the checked-in bytes in a source-free `--validate-only` path.
- [ ] Run focused tests twice, compare output hashes, run `git diff --check`,
  inspect both previews and commit `feat(sdf-lab): bake continuous fpv distal arm`.

**Hard stop:** do not emit/commit an asset if any frame is open, disconnected,
over budget, above 0.75 mm contact error or above 12% bridge slice-area jump.

---

## Task 2: Load and cross-validate the distal asset contract

**Files:** create `src/lab/sdf-zombie/fpv-distal-arm.ts` and test.

- [ ] Write RED tests against the checked-in manifest plus one-field mutations:
  version/kind, labels/keys, dims, pitch, bounds, paths, matrices, elbow data,
  diagnostics, byte length/hash, hand source hash, humanoid source hash and prop
  seat transform, Blender version, SDF route and node-contract hash.
- [ ] Implement strict validation and asynchronous binary loading. Preserve a
  canonical hash-covered source section rather than reconstructing JSON.
- [ ] Cross-validate the six labels/keys against the accepted hand clip and the
  elbow centre/axis/overlap against the humanoid `RightForeArm`/`RightArm`
  contract. Reject any non-invertible transform or out-of-bounds elbow.
- [ ] Expose measured bone lengths and no writable source buffers.
- [ ] Run the focused suite, `npx tsc --noEmit`, `git diff --check`, then commit
  `feat(sdf-lab): validate fpv distal arm asset`.

---

## Task 3: Render the distal clip and upper arm with no wrist branch

**Files:** create the rebuilt WGSL/view modules and tests.

- [ ] Write RED tests that require exactly one distal sample and one upper-arm
  sample per field evaluation; forbid imports/references to the hybrid hand
  clip, wrist clip plane, wrist taper and humanoid color atlas.
- [ ] Implement depth-packed frame interpolation for the distal atlas and the
  exact humanoid brick transform for `RightArm`.
- [ ] Blend only inside the manifest elbow overlap. CPU mirrors must prove the
  blend cannot bridge outside the band and preserves negative interior through
  representative real-manifest points.
- [ ] Reuse the SDF compositor output contract with hit depth and non-opaque
  alpha. Use one flesh material and distance-only bindings.
- [ ] Fit a conservative proxy around every transformed distal/upper bound and
  elbow/normal margin. Test arbitrary rotations and all AABB corners.
- [ ] Test resource ownership/disposal and unchanged input buffers.
- [ ] Run focused suites, `npm run build`, `git diff --check`, then commit
  `feat(sdf-lab): render rebuilt fpv distal arm`.

---

## Task 4: Integrate a static firm-grip candidate and run Gate B

**Files:** modify `fpv-mode.ts`, `lab-main.ts`, create verifier/verification
evidence, and update `TASKS.md` only with measured status.

- [ ] Write RED policy tests: a valid rebuilt asset selects the rebuilt view;
  any rebuilt failure hides it and preserves the accepted hand-only clip.
- [ ] Integrate the rebuilt view behind a diagnostic/static-gate mode. At this
  stage pin the distal atlas to `firm-grip`, use the reviewed two-bone pose at a
  neutral **low held** target inside Task 0's corridor, hide the old right-hand
  view, keep the existing left pinch/lighter hand visible, and derive the prop
  from `handFromDistal`.
- [ ] Add diagnostics for active renderer, source hashes, frame label, elbow/
  shoulder/wrist NDC, prop contact error, proxy intersection, texture identity,
  matrices, Task 0 corridor error, lighter-to-fuse distance and fallback reason.
- [ ] Add deterministic ON/OFF and clay capture controls that freeze unrelated
  animation while never making the old hand visible in rebuilt-off mode.
- [ ] Run focused tests, full `npm test`, `npm run build` and `git diff --check`.
- [ ] Start a disposable Vite server and run a real headed Chromium/WebGPU smoke.
  Assert zero page/GPU/shader errors, correct active view, distance-only binding,
  old hand hidden, shoulder/elbow outside, contact error at or below 0.75 mm,
  same-state repeat bound and strong prop-excluded ON/OFF ROI delta.
- [ ] Inspect the direct neutral capture at native size. If it shows any dark
  wrist gap, cuff, floating hand, scale jump, oversized/cropped limb or visible
  shoulder, football/overhand hold, or an implausibly large lighter reach, write
  `Owner static wrist verdict: PENDING/REJECTED`, stop, and do not start Task 5.
- [ ] If and only if the candidate is genuinely owner-ready, leave the server
  running at a stable localhost URL, write `Owner static wrist verdict: PENDING`,
  commit `feat(sdf-lab): gate rebuilt fpv distal arm in browser`, and notify the
  owner that there is something new to inspect.

---

## Task 5: Restore the paired lighting performance and underhand release

**Blocked by:** explicit owner approval of Task 4 Gate B.

**Files:** modify `fpv-arm-motion.ts`, `lab-main.ts`, verifier and tests.

- [ ] Write a 240 Hz RED sequence test over low hold, lighter entry, fuse
  contact/ignition, lighter withdrawal, cook, toss, release, follow-through and
  recovery. Require fixed bone lengths, continuous upper/distal quaternions,
  Task 0 corridor bounds, short lighter-to-fuse reach, exact handFromDistal
  authority, exactly one release and zero prop pose jump.
- [ ] Replace the pinned firm-grip frame with the accepted six-frame keys while
  keeping the whole distal field rigid. Remove rebuilt-mode calls to hybrid
  wrist swing/clamp/taper logic.
- [ ] Drive the existing left pinch/lighter hand through Task 0's entry,
  `FuseTip` contact, ignition and withdrawal landmarks while the right
  hand/bundle stays in the low hold. Do not move the bundle to solve the reach.
- [ ] Run focused/full tests and build, then a headed Gate C capture containing
  low hold, lighter entry, contact/ignition, withdrawal and cook. Stop for
  explicit owner approval before enabling/tuning the toss portion.
- [ ] After Gate C approval, fit the right arm's modest 3D keys inside Task 0's
  17-frame underhand corridor. The shoulder stays out; the elbow follows the
  visibility limit; the distal field remains rigid; release remains exactly at
  the accepted marker.
- [ ] Run headed Gate D captures for cook, pre-release, release,
  follow-through and recovery. Verify release velocity from the rendered hand
  frame and pointer cleanup.
- [ ] Commit `feat(sdf-lab): animate rebuilt fpv arm toss` only with automated
  evidence plus owner-approved Gate C and owner-ready Gate D captures.

---

## Task 6: Final owner gate, cleanup and integration handoff

**Blocked by:** Task 5 Gate D owner approval.

- [ ] Run a clean checkout full suite/build and one final headed WebGPU smoke.
- [ ] Record Gate B, Gate C and Gate D metrics and owner verdicts in
  `verification.md`.
- [ ] Delete/retire only the rejected hybrid runtime modules that are no longer
  referenced; preserve useful solver/tests and all rejection evidence.
- [ ] Update `TASKS.md` from in-progress to accepted only after explicit owner
  approval.
- [ ] Request final code review, address only verified findings, rerun all gates
  and prepare branch integration using `superpowers:finishing-a-development-branch`.
