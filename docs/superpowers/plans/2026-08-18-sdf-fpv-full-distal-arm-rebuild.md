# X1.hand-followups Full Distal FPV Arm Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to execute this plan task-by-task.
> Every implementation task follows RED → GREEN → focused verification → commit
> → code review. Do not advance through a failed visual gate.

**Goal:** Replace the rejected runtime hand/forearm wrist union with one offline-
fused hand+wrist+forearm SDF clip, join it only at the humanoid elbow to the real
upper arm, and restore the compact toss without a floating hand or visible
shoulder.

**Architecture:** A deterministic Python/Blender baker fuses each accepted X1.27
grip-hand pose to one aligned humanoid forearm mesh and voxel-remeshes the result
as a single watertight distal surface. Six surfaces share one R16F atlas and a
strict hash-bound manifest. The dedicated WebGPU view samples that distal clip
plus the existing humanoid `RightArm` brick and blends only in the authored
elbow band. The reviewed two-bone chain drives upper and distal segments; the
hand and held prop derive from an authored rigid frame inside the distal asset.

**Tech stack:** Python 3.12 via `uv`, Blender 5.2, NumPy, libigl, TypeScript 5.6,
Three.js 0.185 WebGPU/TSL, WGSL, Vitest 2 and Vite 5.

**Spec:** `docs/superpowers/specs/2026-08-18-sdf-fpv-full-distal-arm-rebuild-design.md`

## Global constraints

- Execute on a new `codex/fpv-full-distal-arm-rebuild` branch/worktree based on
  the completed/rejected hybrid branch, preserving its reviewed loader, arm
  solver, compact motion, browser harness and rejection evidence.
- Never restore the rejected runtime wrist clip/taper/smooth-union path. The
  rebuilt shader has no separate hand and forearm samples.
- Preserve all six X1.27 grip labels/keys, the accepted `bakedDynamitePose`, prop
  GLB/seat, release marker (`0.15 s`) and flight physics.
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
- Gate B owner approval is required before Task 5. A failed neutral gate stops
  the plan; no motion tuning is authorized on a rejected static asset.
- Development-only extracted Blood assets remain untracked and never ship.

## File and interface map

### New files

- `scripts/bake_fpv_distal_arm.py` — source validation, anatomical alignment,
  bridge construction, remesh orchestration, six-frame SDF bake, manifest,
  reports and previews.
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

### Existing files that change

- `src/lab/sdf-zombie/fpv-arm-motion.ts` — expose a rigid authored
  distal/hand frame and remove hybrid wrist correction from rebuilt mode.
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

## Task 1: Bake one continuous six-frame distal arm asset

**Files:** create `scripts/bake_fpv_distal_arm.py`,
`scripts/test_bake_fpv_distal_arm.py`, the distal JSON/R16F outputs and the
bake report/previews.

- [ ] Write failing synthetic tests for proper rigid wrist-frame recovery,
  reflection rejection, loop correspondence, bridge winding, monotone slice
  interpolation, one-component/zero-boundary validation, common grid packing,
  deterministic canonical JSON and hash/truncation rejection.
- [ ] Run `uv run scripts/test_bake_fpv_distal_arm.py -v` and record RED because
  the baker module does not exist.
- [ ] Implement import-safe pure helpers first. Reuse the accepted hand clip's
  grid/field helpers and the humanoid baker's canonical source parsing rather
  than copying divergent decoders.
- [ ] Add a Blender inner stage that obtains all six accepted hand pose soups,
  extracts the `RightForeArm` source surface plus retained elbow band, aligns it
  once to the X1.27 wrist, constructs the 35 mm bridge and voxel-remeshes every
  combined frame at no coarser than 1.5 mm.
- [ ] Protect the hand contact region and elbow boundary during smoothing.
  Measure connected components, boundary edges, contact displacement and
  5 mm bridge slice areas from the remeshed surfaces.
- [ ] Bake all six surfaces on one common grid, depth-pack R16F bytes, emit the
  strict canonical manifest and render the bridge/firm-grip previews.
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
  seat transform.
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
  neutral held target, hide the old hand view, and derive the prop from
  `handFromDistal`.
- [ ] Add diagnostics for active renderer, source hashes, frame label, elbow/
  shoulder/wrist NDC, prop contact error, proxy intersection, texture identity,
  matrices and fallback reason.
- [ ] Add deterministic ON/OFF and clay capture controls that freeze unrelated
  animation while never making the old hand visible in rebuilt-off mode.
- [ ] Run focused tests, full `npm test`, `npm run build` and `git diff --check`.
- [ ] Start a disposable Vite server and run a real headed Chromium/WebGPU smoke.
  Assert zero page/GPU/shader errors, correct active view, distance-only binding,
  old hand hidden, shoulder/elbow outside, contact error at or below 0.75 mm,
  same-state repeat bound and strong prop-excluded ON/OFF ROI delta.
- [ ] Inspect the direct neutral capture at native size. If it shows any dark
  wrist gap, cuff, floating hand, scale jump, oversized/cropped limb or visible
  shoulder, write `Owner static wrist verdict: PENDING/REJECTED`, stop, and do
  not start Task 5.
- [ ] If and only if the candidate is genuinely owner-ready, leave the server
  running at a stable localhost URL, write `Owner static wrist verdict: PENDING`,
  commit `feat(sdf-lab): gate rebuilt fpv distal arm in browser`, and notify the
  owner that there is something new to inspect.

---

## Task 5: Restore compact grip, toss and exactly-once release

**Blocked by:** explicit owner approval of Task 4 Gate B.

**Files:** modify `fpv-arm-motion.ts`, `lab-main.ts`, verifier and tests.

- [ ] Write a 240 Hz RED sequence test over close, cook, toss, release,
  follow-through and recovery. Require fixed bone lengths, continuous upper/
  distal quaternions, exact handFromDistal authority, exactly one release and
  zero prop pose jump.
- [ ] Replace the pinned firm-grip frame with the accepted six-frame keys while
  keeping the whole distal field rigid. Remove rebuilt-mode calls to hybrid
  wrist swing/clamp/taper logic.
- [ ] Reuse the compact reach-valid target and shorten/reposition it only from
  measured browser evidence. Enforce shoulder/elbow visibility and screen-
  coverage bounds in tests.
- [ ] Run focused/full tests and build, then headed captures for all phases.
  Verify release velocity from the rendered hand frame and pointer cleanup.
- [ ] Commit `feat(sdf-lab): animate rebuilt fpv arm toss` only with automated
  evidence and owner-ready captures.

---

## Task 6: Final owner gate, cleanup and integration handoff

**Blocked by:** Task 5 owner approval.

- [ ] Run a clean checkout full suite/build and one final headed WebGPU smoke.
- [ ] Record Gate C metrics and owner verdict in `verification.md`.
- [ ] Delete/retire only the rejected hybrid runtime modules that are no longer
  referenced; preserve useful solver/tests and all rejection evidence.
- [ ] Update `TASKS.md` from in-progress to accepted only after explicit owner
  approval.
- [ ] Request final code review, address only verified findings, rerun all gates
  and prepare branch integration using `superpowers:finishing-a-development-branch`.
