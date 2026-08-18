# X1.28 FPV Articulated Baked Forearm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the accepted X1.27 baked hand and dynamite release while independently aiming the baked forearm toward an offscreen elbow, with a seamless articulated wrist during idle, shaking/cooking, throwing, and recovery.

**Architecture:** Reuse the accepted long-forearm clip atlas from `bfbe85c` as two clipped samples of the same texture: a hand-side field under the authoritative X1.27 pose and a forearm-side field under a pure wrist-pivoted pose. Smooth-union the overlapping samples at the authored wrist cut, refit the FPV proxy to both transformed clipped bounds, and keep the prop/handoff derived exclusively from the hand pose.

**Tech Stack:** TypeScript, Three.js r185 WebGPU/TSL, WGSL, Vitest, Vite, existing Blender/Python R16F bake pipeline only for validation.

**Spec:** `docs/superpowers/specs/2026-08-17-sdf-fpv-articulated-forearm-design.md`

## Global Constraints

- Execute in a fresh isolated `codex/` worktree created from current `main` via `superpowers:using-git-worktrees`.
- Port commit `bfbe85c` as the accepted long-forearm atlas/pipeline baseline.
- Do not port rejected commits `150a22a` (whole-volume reframe) or `be3a72f` (upper-arm-only patch).
- Preserve main commit `82deac5` and its debug-panel button/`H` shortcut.
- Keep the X1.27 animated hand pose, grip frames, wrist timing, dynamite GLB transform, release marker, release velocity, and flight/explosion behavior unchanged.
- Reuse `public/assets/lab/hand-sdf-dynamite-grip-r.r16f`; do not change its bytes, manifest hashes, dimensions, frame count, or attribution.
- Articulation applies only to `handFieldUi.field === 'clip'`. `prims` and static `baked` modes remain exact controls.
- The forearm sample receives no digit warp. The hand sample retains the existing `warpLocal` behavior.
- Defaults for all new uniforms disable articulation, preserving every non-clip march path.
- Every WGSL change requires a headed visible-page WebGPU smoke. String tests and TypeScript do not validate generated WGSL.
- Run Vitest under Node 25 as `NODE_OPTIONS=--no-experimental-webstorage npm test`; the unconfigured Node 25 built-in Web Storage object otherwise causes unrelated panel failures.
- Visual acceptance is owner-gated at the real browser viewport. Do not merge on automated geometry assertions alone.

---

## File and interface map

### New files

- `src/lab/sdf-zombie/forearm-pose.ts` — pure wrist-pivoted forearm solver and authoring constants.
- `src/lab/sdf-zombie/forearm-pose.test.ts` — authority, continuity, viewport-exit, and prop-isolation tests through the real grip controller.
- `scripts/verify-articulated-forearm.mjs` — headed browser phase capture, WebGPU-error collection, cap visibility assertions, handoff check, and GPU comparison.

### Existing files that change

- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — shared local sampler plus two-pose clipped/smooth-unioned articulation path.
- `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — generated WGSL signature, clipping, sample-count, and disabled-path assertions.
- `src/lab/sdf-zombie/webgpu/specialise.ts` and `specialise.test.ts` — forward the new forearm pose/config uniforms through specialised field bodies.
- `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` and `zombie-gpu.test.ts` — create and forward disabled-by-default articulation uniforms.
- `src/lab/sdf-zombie/webgpu/fpv-view.ts` and `fpv-view.test.ts` — expose `setForearmPose`, write uniforms, and fit a proxy around both clipped transforms.
- `src/lab/sdf-zombie/webgpu/lab-main.ts` — solve/set the forearm only in clip mode and expose diagnostics; the hand/prop path remains unchanged.
- `src/lab/sdf-zombie/fpv-mode.test.ts` — retain the accepted baseline framing assertions ported with `bfbe85c`.
- `docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md` — record captures, measurements, and owner verdict.
- `TASKS.md` — mark the follow-up complete only after owner approval.

### Interfaces

```ts
// src/lab/sdf-zombie/forearm-pose.ts
export const ARTICULATED_FOREARM = {
  wristSplitY: -0.035,
  overlapM: 0.018,
  blendK: 0.015,
  elbowTargetCamera: [0.32, -0.42, 0.02] as Vec3,
  capCentreLocal: [-0.0088, -0.225, 0.0029] as Vec3,
} as const;

export interface ForearmPose {
  centre: Vec3;
  quaternion: [number, number, number, number];
  wristWorld: Vec3;
  capWorld: Vec3;
  capCamera: Vec3;
  enabled: boolean;
}

export function articulatedForearmPose(
  hand: BakedHandPose,
  eye: Vec3,
  yaw: number,
  pitch: number,
): ForearmPose;

// src/lab/sdf-zombie/webgpu/fpv-view.ts
export interface ForearmVolumePoseIn {
  centre: Vec3;
  quaternion: [number, number, number, number];
  splitY: number;
  overlapM: number;
  blendK: number;
}

export interface HandsGpuView {
  // existing members stay unchanged
  setForearmPose(pose: ForearmVolumePoseIn | null): void;
}
```

---

### Task 1: Port and verify the accepted long-forearm baseline

**Files:**
- Port from commit: `bfbe85c`
- Preserve: `sdf-lab-webgpu.html`
- Preserve: `src/lab/sdf-zombie/panel.ts`
- Preserve: `src/lab/sdf-zombie/panel.test.ts`
- Resolve: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Verify: `public/assets/lab/hand-sdf-dynamite-grip-r.json`
- Verify: `public/assets/lab/hand-sdf-dynamite-grip-r.r16f`

**Interfaces:**
- Consumes: current `main` at or after `82deac5`.
- Produces: the accepted extended-forearm atlas and baseline framing without either rejected follow-up.

- [ ] **Step 1: Create the isolated execution worktree**

Invoke `superpowers:using-git-worktrees`, then create a branch named
`codex/sdf-fpv-articulated-forearm` from `main`. Confirm the new worktree is
clean before continuing.

- [ ] **Step 2: Port only the accepted forearm commit**

```bash
git cherry-pick bfbe85c
```

If `src/lab/sdf-zombie/webgpu/lab-main.ts` conflicts, retain both sets of
behavior:

```ts
// From main/82deac5 — must remain near panel setup and key handling.
let debugPanelHidden = false;
function setDebugPanelHidden(hidden: boolean) {
  debugPanelHidden = hidden;
  applyDebugPanelVisibility(panelEl, panelToggleEl, hidden);
}
function toggleDebugPanel() { setDebugPanelHidden(!debugPanelHidden); }

// From bfbe85c — retain its clip-as-default/forearm field policy changes.
// Do not take any hunk from 150a22a or be3a72f.
```

Continue the cherry-pick after the conflict is resolved. Do not amend the
imported commit; the later tasks should remain reviewable on top of its exact
provenance.

- [ ] **Step 3: Verify that the atlas is the accepted long-forearm asset**

Run:

```bash
node -e "const m=require('./public/assets/lab/hand-sdf-dynamite-grip-r.json'); console.log(m.dimensions,m.atlasDimensions,m.frameCount,m.byteLength,m.sha256.binary)"
wc -c public/assets/lab/hand-sdf-dynamite-grip-r.r16f
```

Expected: six frames; manifest byte length equals the binary byte count; the
binary is roughly 51 MiB. Record the exact dimensions/hash in the dev note.

- [ ] **Step 4: Run baseline verification**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run \
  src/lab/sdf-zombie/fpv-mode.test.ts \
  src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts \
  src/lab/sdf-zombie/panel.test.ts
npm run build
git diff --check
```

Expected: all focused tests pass, production build succeeds, and no whitespace
errors are reported.

---

### Task 2: Build the pure wrist-pivoted forearm solver

**Files:**
- Create: `src/lab/sdf-zombie/forearm-pose.ts`
- Create: `src/lab/sdf-zombie/forearm-pose.test.ts`

**Interfaces:**
- Consumes: `BakedHandPose`, `camBasis`, `Vec3`, and the real `GripMotionState` path.
- Produces: `ARTICULATED_FOREARM`, `ForearmPose`, and `articulatedForearmPose(...)` exactly as declared above.

- [ ] **Step 1: Write failing authority and pose tests**

Create fixtures that compose the real hand path:

```ts
const EYE: Vec3 = [0, 0, 4];
const YAW = 0;
const PITCH = -0.03;
const BASE: BakedHandPose = {
  centre: [0.12, -0.30, 3.72],
  quaternion: [0, 0, 0, 1],
  warpLocal: [0, 0, 0],
};

it('pivots at the authoritative hand origin and never changes the hand', () => {
  const before = structuredClone(BASE);
  const f = articulatedForearmPose(BASE, EYE, YAW, PITCH);
  expect(f.wristWorld).toEqual(BASE.centre);
  expect(f.centre).toEqual(BASE.centre);
  expect(BASE).toEqual(before);
  expect(Math.hypot(...f.quaternion)).toBeCloseTo(1, 9);
});

it('maps local proximal -Y toward the offscreen elbow target', () => {
  const f = articulatedForearmPose(BASE, EYE, YAW, PITCH);
  const proximal = rotateByQuat(f.quaternion, [0, -1, 0]);
  const { f: forward, r, u } = camBasis(YAW, PITCH);
  const t = ARTICULATED_FOREARM.elbowTargetCamera;
  const targetWorld: Vec3 = [
    EYE[0] + r[0] * t[0] + u[0] * t[1] + forward[0] * t[2],
    EYE[1] + r[1] * t[0] + u[1] * t[1] + forward[1] * t[2],
    EYE[2] + r[2] * t[0] + u[2] * t[1] + forward[2] * t[2],
  ];
  const wanted = norm3(sub3(targetWorld, BASE.centre));
  expect(dot3(proximal, wanted)).toBeGreaterThan(0.999999);
});
```

Also assert `ARTICULATED_FOREARM.wristSplitY === -0.035`, overlap is in
`[0.012, 0.025]`, blend is in `[0.008, 0.022]`, and the solver returns a
disabled finite pose when the target and wrist coincide.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
npx vitest run src/lab/sdf-zombie/forearm-pose.test.ts
```

Expected: FAIL because `forearm-pose.ts` does not exist.

- [ ] **Step 3: Implement the minimal solver**

Use `THREE.Matrix4`/`Quaternion` only to extract the final rotation; keep the
vector math pure and explicit:

```ts
import * as THREE from 'three/webgpu';
import { camBasis } from './fpv-mode';
import type { BakedHandPose } from './hand-volume-pose';
import type { Vec3 } from './types';

export const ARTICULATED_FOREARM = {
  wristSplitY: -0.035,
  overlapM: 0.018,
  blendK: 0.015,
  elbowTargetCamera: [0.32, -0.42, 0.02] as Vec3,
  capCentreLocal: [-0.0088, -0.225, 0.0029] as Vec3,
} as const;

export interface ForearmPose {
  centre: Vec3;
  quaternion: [number, number, number, number];
  wristWorld: Vec3;
  capWorld: Vec3;
  capCamera: Vec3;
  enabled: boolean;
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const vx = new THREE.Vector3();
const vy = new THREE.Vector3();
const vz = new THREE.Vector3();
const hq = new THREE.Quaternion();

export function articulatedForearmPose(
  hand: BakedHandPose, eye: Vec3, yaw: number, pitch: number,
): ForearmPose {
  const { f, r, u } = camBasis(yaw, pitch);
  const t = ARTICULATED_FOREARM.elbowTargetCamera;
  const target: Vec3 = [
    eye[0] + r[0] * t[0] + u[0] * t[1] + f[0] * t[2],
    eye[1] + r[1] * t[0] + u[1] * t[1] + f[1] * t[2],
    eye[2] + r[2] * t[0] + u[2] * t[1] + f[2] * t[2],
  ];
  const proximal = new THREE.Vector3(
    target[0] - hand.centre[0], target[1] - hand.centre[1], target[2] - hand.centre[2]);
  const enabled = proximal.lengthSq() > 1e-12 && Number.isFinite(proximal.lengthSq());
  if (!enabled) {
    return {
      centre: [...hand.centre] as Vec3, wristWorld: [...hand.centre] as Vec3,
      quaternion: [0, 0, 0, 1], capWorld: [...hand.centre] as Vec3,
      capCamera: [0, 0, 0], enabled: false,
    };
  }
  proximal.normalize();
  vy.copy(proximal).negate(); // volume +Y is distal: elbow -> wrist/hand
  hq.set(...hand.quaternion);
  vx.set(1, 0, 0).applyQuaternion(hq);
  vx.addScaledVector(vy, -vx.dot(vy));
  if (vx.lengthSq() < 1e-8) {
    vx.set(r[0], r[1], r[2]);
    const cameraRightProjection = vx.dot(vy);
    vx.addScaledVector(vy, -cameraRightProjection);
  }
  vx.normalize();
  vz.crossVectors(vx, vy).normalize();
  m.makeBasis(vx, vy, vz);
  q.setFromRotationMatrix(m).normalize();
  const cap = new THREE.Vector3(...ARTICULATED_FOREARM.capCentreLocal).applyQuaternion(q);
  const capWorld: Vec3 = [hand.centre[0] + cap.x, hand.centre[1] + cap.y, hand.centre[2] + cap.z];
  const rel: Vec3 = [capWorld[0] - eye[0], capWorld[1] - eye[1], capWorld[2] - eye[2]];
  return {
    centre: [...hand.centre] as Vec3,
    wristWorld: [...hand.centre] as Vec3,
    quaternion: [q.x, q.y, q.z, q.w],
    capWorld,
    capCamera: [dot3(rel, r), dot3(rel, u), dot3(rel, f)],
    enabled: true,
  };
}
```

Define a local `dot3(a,b)` helper above the function.

- [ ] **Step 4: Add the real-animation continuity and isolation tests**

Drive `makeGripMotion`/`stepGripMotion` at `1/240 s`, compose each frame with
`applyGripMotion`, and solve the forearm. Assert for every frame:

```ts
const beforeHand = structuredClone(hand);
const propBefore = bakedDynamitePose(hand, PROP_FIXTURE);
expect(f.enabled).toBe(true);
expect(f.centre).toEqual(hand.centre);
expect(f.capCamera.every(Number.isFinite)).toBe(true);
expect(Math.hypot(...f.quaternion)).toBeCloseTo(1, 8);
const capOutside = f.capCamera[2] <= 0 ||
  Math.abs(f.capCamera[0]) > f.capCamera[2] * Math.tan(75 * Math.PI / 360) * (16 / 9) ||
  Math.abs(f.capCamera[1]) > f.capCamera[2] * Math.tan(75 * Math.PI / 360);
expect(capOutside).toBe(true);
expect(hand).toEqual(beforeHand);
expect(bakedDynamitePose(hand, PROP_FIXTURE)).toEqual(propBefore);
```

For consecutive frames require `Math.abs(dotQuat(a,b)) > 0.995` and cap motion
below `0.02 m` per 240 Hz step. The prop assertion must use the hand pose, never
the forearm pose.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run \
  src/lab/sdf-zombie/forearm-pose.test.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts \
  src/lab/sdf-zombie/hand-grip-clip.test.ts
git add src/lab/sdf-zombie/forearm-pose.ts src/lab/sdf-zombie/forearm-pose.test.ts
git commit -m "feat(sdf-lab): solve wrist-pivoted fpv forearm pose"
```

Expected: all focused suites pass.

---

### Task 3: Add the two-pose clipped atlas field

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/specialise.ts`
- Modify: `src/lab/sdf-zombie/webgpu/specialise.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`

**Interfaces:**
- Consumes: the existing `volumeTex`, hand pose, atlas frame pair, bounds, and warp.
- Produces: `volumeForearm0`, `volumeForearm1`, and `volumeJointCfg` uniforms threaded through every march entry point.

- [ ] **Step 1: Write failing uniform and generated-WGSL tests**

Add these expectations:

```ts
const u = defaultUniforms(blankFaceTexture());
expect(u.volumeForearm0.value.toArray()).toEqual([0, 0, 0, 0]);
expect(u.volumeForearm1.value.toArray()).toEqual([0, 0, 0, 1]);
expect(u.volumeJointCfg.value.toArray()).toEqual([-0.035, 0.018, 0.015, 0]);

expect(MAP_BODY).toContain('volumeForearm0: vec4<f32>');
expect(MAP_BODY).toContain('volumeForearm1: vec4<f32>');
expect(MAP_BODY).toContain('volumeJointCfg: vec4<f32>');
expect(SAMPLE_VOLUME).toContain('fn sampleArticulatedHandVolume');
expect(SAMPLE_VOLUME).toContain('max(dHand, handCut)');
expect(SAMPLE_VOLUME).toContain('max(dForearm, forearmCut)');
expect(SAMPLE_VOLUME).toContain('smin(dHandClipped, dForearmClipped, volumeJointCfg.z)');
```

Update specialised-body tests to require the same three arguments in the
generated signature and call.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx vitest run \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/specialise.test.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
```

Expected: FAIL on missing uniforms/functions.

- [ ] **Step 3: Refactor sampling into reusable local/pose helpers**

In `SAMPLE_VOLUME`, keep `sampleHandVolumeFrame` unchanged and split the old
`sampleHandVolume` into:

```wgsl
fn volumeWorldToLocal(pWorld: vec3<f32>, pose0: vec4<f32>, pose1: vec4<f32>) -> vec3<f32> {
  let pl = pWorld - pose0.xyz;
  let cq = vec4<f32>(-pose1.xyz, pose1.w);
  let tq = 2.0 * cross(cq.xyz, pl);
  return pl + tq * cq.w + cross(cq.xyz, tq);
}

fn sampleHandVolumeLocal(
  local: vec3<f32>, warp: vec3<f32>, volumeTex: texture_3d<f32>,
  volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeClip: vec4<f32>,
) -> f32 {
  let extent = vec3<f32>(1.0) / volumeInvExtent;
  let uv0 = (local - volumeMin) * volumeInvExtent;
  let warped = local - warp * smoothstep(0.15, 0.9, uv0.y);
  let uv = (warped - volumeMin) * volumeInvExtent;
  let outside = length(max(max(volumeMin - warped, warped - (volumeMin + extent)), vec3<f32>(0.0)));
  let atlasDims = vec3<i32>(textureDimensions(volumeTex, 0));
  let depth = max(1, i32(volumeClip.w));
  let dimsF = vec3<f32>(f32(atlasDims.x), f32(atlasDims.y), f32(depth));
  let q = clamp(uv * (dimsF - vec3<f32>(1.0)), vec3<f32>(0.0), dimsF - vec3<f32>(1.0));
  let d0 = sampleHandVolumeFrame(q, i32(volumeClip.x), volumeTex, volumeClip);
  let d1 = sampleHandVolumeFrame(q, i32(volumeClip.y), volumeTex, volumeClip);
  return mix(d0, d1, clamp(volumeClip.z, 0.0, 1.0)) + outside;
}
```

Rebuild the existing single-pose function from these helpers and confirm its
formula and warp semantics remain unchanged.

- [ ] **Step 4: Implement the articulated sampler and mapBody branch**

```wgsl
fn sampleArticulatedHandVolume(
  pWorld: vec3<f32>, volumeTex: texture_3d<f32>,
  hand0: vec4<f32>, hand1: vec4<f32>, forearm0: vec4<f32>, forearm1: vec4<f32>,
  volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>, volumeJointCfg: vec4<f32>,
) -> f32 {
  let handLocal = volumeWorldToLocal(pWorld, hand0, hand1);
  let forearmLocal = volumeWorldToLocal(pWorld, forearm0, forearm1);
  let dHand = sampleHandVolumeLocal(
    handLocal, volumeWarp.xyz, volumeTex, volumeMin, volumeInvExtent, volumeClip);
  let dForearm = sampleHandVolumeLocal(
    forearmLocal, vec3<f32>(0.0), volumeTex, volumeMin, volumeInvExtent, volumeClip);
  let splitY = volumeJointCfg.x;
  let overlap = volumeJointCfg.y;
  let handCut = (splitY - overlap) - handLocal.y;       // keep y >= split-overlap
  let forearmCut = forearmLocal.y - (splitY + overlap); // keep y <= split+overlap
  let dHandClipped = max(dHand, handCut);
  let dForearmClipped = max(dForearm, forearmCut);
  return smin(dHandClipped, dForearmClipped, volumeJointCfg.z);
}
```

Inside the volume branch:

```wgsl
if (volumeForearm0.w > 0.5) {
  d = sampleArticulatedHandVolume(
    p, volumeTex, volumePose0, volumePose1, volumeForearm0, volumeForearm1,
    volumeMin, volumeInvExtent, volumeWarp, volumeClip, volumeJointCfg);
} else {
  d = sampleHandVolume(
    p, volumeTex, volumePose0, volumePose1,
    volumeMin, volumeInvExtent, volumeWarp, volumeClip);
}
```

Thread all three uniforms through `mapBody`, `calcNormal`, `coneMarch`,
`marchBody`, AO/translucency calls, and `specialise.ts`. Do not create a second
texture node.

- [ ] **Step 5: Add disabled defaults and material bindings**

In `defaultUniforms`:

```ts
volumeForearm0: uniform(new THREE.Vector4(0, 0, 0, 0)),
volumeForearm1: uniform(new THREE.Vector4(0, 0, 0, 1)),
volumeJointCfg: uniform(new THREE.Vector4(-0.035, 0.018, 0.015, 0)),
```

Forward them in every `marchBody`/`marchChunk` call object next to
`volumePose0/1`. The `.w` of `volumeForearm0` is the sole enable flag.

- [ ] **Step 6: Run focused tests and a production shader build**

```bash
npx vitest run \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/specialise.test.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
npm run build
git diff --check
```

Expected: focused tests and build pass. This is not yet live WebGPU evidence.

- [ ] **Step 7: Commit**

```bash
git add \
  src/lab/sdf-zombie/webgpu/march.wgsl.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/specialise.ts \
  src/lab/sdf-zombie/webgpu/specialise.test.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.ts \
  src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
git commit -m "feat(sdf-lab): march articulated hand and forearm fields"
```

---

### Task 4: Wire articulation into the FPV view and preserve the prop path

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/fpv-view.ts`
- Modify: `src/lab/sdf-zombie/webgpu/fpv-view.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/hand-volume-pose.test.ts`

**Interfaces:**
- Consumes: `ForearmPose`, articulation constants, and the Task 3 uniforms.
- Produces: `HandsGpuView.setForearmPose(...)`; clip-mode diagnostics under `window.__sdfLab.fpv.forearm`.

- [ ] **Step 1: Write failing view API and proxy tests**

Extend the hands-view fixture and assert:

```ts
view.setForearmPose({
  centre: [1, 2, 3], quaternion: [0, 0, 0, 1],
  splitY: -0.035, overlapM: 0.018, blendK: 0.015,
});
expect(view.uniforms.volumeForearm0.value.toArray()).toEqual([1, 2, 3, 1]);
expect(view.uniforms.volumeForearm1.value.toArray()).toEqual([0, 0, 0, 1]);
expect(view.uniforms.volumeJointCfg.value.toArray()).toEqual([-0.035, 0.018, 0.015, 0]);
view.setForearmPose(null);
expect(view.uniforms.volumeForearm0.value.w).toBe(0);
```

With a synthetic manifest AABB and two rotated poses, independently transform
the eight corners of the hand-clipped and forearm-clipped bounds; assert every
corner lies inside the mesh proxy after `setVolumePose` + `setForearmPose`.

- [ ] **Step 2: Run the focused view test and confirm RED**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/fpv-view.test.ts
```

Expected: FAIL because `setForearmPose` does not exist.

- [ ] **Step 3: Implement `setForearmPose` and union proxy fitting**

Keep separate scratch transforms for hand and forearm. Refactor proxy fitting
around this helper:

```ts
function includeTransformedBox(
  mn: readonly number[], mx: readonly number[],
  centre: THREE.Vector3, quat: THREE.Quaternion,
) {
  for (let c = 0; c < 8; c++) {
    corner.set(
      (c & 1) ? mx[0]! : mn[0]!,
      (c & 2) ? mx[1]! : mn[1]!,
      (c & 4) ? mx[2]! : mn[2]!);
    corner.applyQuaternion(quat).add(centre);
    minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
  }
}
```

For the hand box use
`handMinY = max(boundsMin.y, splitY - overlapM - blendK*4)`; for the forearm
box use `forearmMaxY = min(boundsMax.y, splitY + overlapM + blendK*4)`.
Include only the hand box when articulation is disabled. Preserve the existing
voxel/wound/warp padding after unioning the boxes.

Implement the setter:

```ts
setForearmPose(p) {
  if (!p) {
    u.volumeForearm0.value.w = 0;
    fitVolumeProxy();
    return;
  }
  forearmCentre.set(...p.centre);
  forearmQuat.set(...p.quaternion).normalize();
  u.volumeForearm0.value.set(p.centre[0], p.centre[1], p.centre[2], 1);
  u.volumeForearm1.value.set(
    forearmQuat.x, forearmQuat.y, forearmQuat.z, forearmQuat.w);
  u.volumeJointCfg.value.set(p.splitY, p.overlapM, p.blendK, 0);
  fitVolumeProxy();
}
```

`setField('prims')` and `setField('volume', staticV1)` must disable the forearm
pose. Disabling/re-enabling must not rebind or dispose the texture.

- [ ] **Step 4: Wire only clip mode in `lab-main.ts`**

Import the solver/constants. Immediately after computing `animated`:

```ts
handViews.right.setVolumePose({ ...animated, warpEnabled: handFieldUi.warp });
const forearm = articulatedForearmPose(animated, ff.eye, ff.yaw, ff.pitch);
handViews.right.setForearmPose(forearm.enabled ? {
  centre: forearm.centre,
  quaternion: forearm.quaternion,
  splitY: ARTICULATED_FOREARM.wristSplitY,
  overlapM: ARTICULATED_FOREARM.overlapM,
  blendK: ARTICULATED_FOREARM.blendK,
} : null);

// This line remains exactly hand-derived; never pass `forearm` here.
clipPropPose = bakedDynamitePose(animated, handClip.manifest.prop);
```

In static `baked`, `prims`, clip-load failure, and when hands are hidden, call
`handViews.right.setForearmPose(null)`. Store the latest solved pose only for
diagnostics:

```ts
forearm: latestForearm ? {
  on: latestForearm.enabled,
  wristWorld: latestForearm.wristWorld.map(v => +v.toFixed(4)),
  capCamera: latestForearm.capCamera.map(v => +v.toFixed(4)),
} : null,
```

Do not alter `applyGripMotion`, `bakedDynamitePose`, `clipReleaseNow`,
`releasePendingThrow`, or `handReleaseVelocity`.

- [ ] **Step 5: Add the prop isolation regression**

In `hand-volume-pose.test.ts`, create two different forearm poses from one hand
pose and assert the prop is identical because it consumes only the hand:

```ts
const expected = bakedDynamitePose(animatedHand, PROP);
const a = articulatedForearmPose(animatedHand, EYE, 0, 0);
const b = articulatedForearmPose(animatedHand, EYE, 0.4, -0.2);
expect(a.quaternion).not.toEqual(b.quaternion);
expect(bakedDynamitePose(animatedHand, PROP)).toEqual(expected);
```

- [ ] **Step 6: Run focused and full tests**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run \
  src/lab/sdf-zombie/forearm-pose.test.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts \
  src/lab/sdf-zombie/webgpu/fpv-view.test.ts \
  src/lab/sdf-zombie/fpv-mode.test.ts
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
git diff --check
```

Expected: all focused tests, the complete suite, build, and diff check pass.

- [ ] **Step 7: Commit**

```bash
git add \
  src/lab/sdf-zombie/webgpu/fpv-view.ts \
  src/lab/sdf-zombie/webgpu/fpv-view.test.ts \
  src/lab/sdf-zombie/webgpu/lab-main.ts \
  src/lab/sdf-zombie/hand-volume-pose.test.ts
git commit -m "feat(sdf-lab): articulate baked forearm at the wrist"
```

---

### Task 5: Run the live WebGPU and owner visual gates

**Files:**
- Create: `scripts/verify-articulated-forearm.mjs`
- Modify: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md`
- Modify: `TASKS.md`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/articulated-held.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/articulated-shake.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/articulated-release.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/articulated-follow-through.png`
- Create: `docs/dev-notes/2026-08-17-sdf-dynamite-grip/articulated-recover.png`

**Interfaces:**
- Consumes: `window.__sdfLab` controls/diagnostics and browser screenshots.
- Produces: reproducible visual/compile/performance evidence plus the explicit owner verdict.

- [ ] **Step 1: Write the headed verification script**

Follow the existing `scripts/verify-forearm-followup.mjs` connection pattern.
At the real visible page:

```js
await lab.setHandField('clip');
await lab.setGripPlayback('pause');
for (const [name, grip01] of [
  ['held', 1.0],
  ['shake', 0.72],
  ['release', 0.62],
  ['follow-through', 0.18],
  ['recover', 0.0],
]) {
  await lab.setGripProgress(grip01);
  await nextFrames(3);
  const state = await readLabState();
  if (!state.fpv.forearm?.on) throw new Error(`${name}: forearm disabled`);
  const [x, y, z] = state.fpv.forearm.capCamera;
  const tanV = Math.tan(75 * Math.PI / 360);
  const outside = z <= 0 || Math.abs(x) > z * tanV * (16 / 9) || Math.abs(y) > z * tanV;
  if (!outside) throw new Error(`${name}: proximal cap entered the 16:9 frustum`);
  await screenshot(`articulated-${name}.png`);
}
```

Then play a real throw and require `releaseCount` increments once and
`handoffErrorM < 0.0001`. Collect console messages and fail on
`GPUValidationError`, shader compilation errors, uncaught exceptions, or a
blank-canvas luma check.

- [ ] **Step 2: Run a fresh visible-page WebGPU smoke**

Start a fresh Vite server on an unused port, verify it with `lsof`, and run the
headed script against that exact port. Do not reuse a stale bundle. Expected:

- backend reports WebGPU;
- clip and GLB reach ready;
- five phase captures are written;
- cap stays outside the frustum;
- release is exactly once with handoff below 0.1 mm;
- no GPU/shader/page errors occur.

- [ ] **Step 3: Record the GPU comparison**

Using the existing visible-page `benchGpu` path, capture at least 240 samples
for:

1. articulation disabled but the same long-forearm clip loaded;
2. articulation enabled.

Require `hiddenSteps === 0` for both. Record median/p05/p95 and the articulated
minus rigid median. Investigate if the median regression exceeds `1.0 ms`; do
not change the accepted visual solution merely to hit a speculative number.

- [ ] **Step 4: Present the five captures for owner review**

The owner checks the actual animated page, especially shake/cook and maximum
throw. Pass only after the owner confirms:

- the hand/dynamite framing still looks like X1.27;
- the wrist has no crack, double surface, or swollen ball;
- the forearm leads naturally offscreen instead of sweeping as one rigid tube;
- no flat proximal cap appears;
- release remains visually continuous.

If rejected, leave `TASKS.md` as `[~]`, record the exact failing phase, and do
not merge.

- [ ] **Step 5: Run final verification after the owner-approved tuning**

```bash
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
git diff --check
git status --short
```

Expected: all tests pass, build succeeds, diff check is clean, and status lists
only this task's intended tracked changes plus any pre-existing user files.

- [ ] **Step 6: Record evidence, update status, and commit**

Append the exact commands/results, atlas hash, five captures, GPU comparison,
and owner verdict to the dev note. Only after approval, change the task row to
`[x]` and include the final commit ID.

```bash
git add \
  scripts/verify-articulated-forearm.mjs \
  docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md \
  docs/dev-notes/2026-08-17-sdf-dynamite-grip/articulated-*.png \
  TASKS.md
git commit -m "test(sdf-lab): verify articulated fpv forearm"
```

Stop the task-owned Vite/browser processes after the owner gate so they do not
continue consuming GPU/CPU.
