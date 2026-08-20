# Humanoid Dynamics Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the baked humanoid react to a hit the way the procedural zombie does — fix the elbow so it folds instead of sweeping a cone, find out what the visible brick seams actually are, and give every hit a verlet recoil plus a local flesh wobble.

**Architecture:** Three independent defects, fixed in order of certainty. The elbow axis is derived at runtime from two bone origins, so no re-bake and no manifest change. The seams are diagnosed before they are fixed. Dynamics arrive as a verlet layer over the existing per-bone position/quaternion pose plus a wound-driven term in the existing surface warp; no soft-body physics and no new asset.

**Tech Stack:** TypeScript 5.6, Vitest, Three.js 0.185 WebGPU/TSL, WGSL, existing `humanoid-pose.ts` / `humanoid.wgsl.ts` / `humanoid-view.ts` / `humanoid-spike-main.ts`.

**Origin:** Owner gate on the sever spike (2026-08-20). The mechanical gates all passed — 29/29 verifier, 1738 tests — and the owner rejected the *feel*: "the elbow just kinda rotates backwards away from the body and isn't like bending", "the craters don't really read at all, it just reads as decals", "way less reactive than the primitive sdf model … it is like a big block of jelly … it's not just fluid or gibs".

**Predecessor:** `docs/superpowers/plans/2026-08-17-humanoid-sdf-sever-spike.md` (Tasks 1–10, complete). Base branch is that chain's tip, `dispatch/humanoid-sdf-spike-r2-task-10`.

## Global Constraints

- **No re-bake.** The atlases, coarse pack and manifest are byte-deterministic and reviewed. Nothing in this plan changes `scripts/bake_humanoid_sdf.py` or any file under `public/assets/lab/humanoid-sdf/`. Everything needed is already in the manifest.
- **`manifest.joints[].axisModel` is NOT wrong and must not be "fixed".** It is the joint *band* axis — the normal of the 30 mm planar overlap, which necessarily runs along the limb. Task 1 stops *reusing* it as a flexion axis; it does not redefine it.
- Do not add gibs, wound fluid, blood decals, particles, sound, walking, or soft-body physics. The owner established that the procedural zombie's plain-click impact does not come from those, so neither does the fix.
- WebGPU only. Missing WebGPU or invalid assets are blocking errors, not fallbacks.
- Preserve every existing gate: 29/29 in `scripts/verify-humanoid-sdf-spike.mjs`, and the 50 ms first-use budget for both the first sever and the first shot.
- Do not weaken, skip or delete a test. If a requirement is unreachable, stop, commit what is green, and write the blocker with its evidence into your report.

---

### Task 1: Make the elbow fold instead of sweeping a cone

**Files:**
- Modify: `src/lab/sdf-zombie/humanoid-pose.ts`
- Modify: `src/lab/sdf-zombie/humanoid-pose.test.ts`

**Interfaces:**
- Consumes: `HumanoidVolumeManifest`, its `bones[].bindToModel` (column-major 16-float), `joints[]`, `rightArm`.
- Produces: an unchanged public API. `HumanoidPoseState.elbowAxis` keeps its name and type and simply carries the correct axis.

**The defect, measured on the checked-in manifest.** `makeHumanoidPose` sets `elbowAxis` from `joint.axisModel`, and that vector *is* the upper-arm direction:

```
upper-arm direction (RightArm -> RightForeArm):  [-0.8338, -0.4397, -0.3338]
joints[].axisModel for RightForeArm:             [-0.8338, -0.4397, -0.3338]
|dot| = 1.0000
```

The rotation axis therefore runs through the shoulder *and* the elbow, so rotating the forearm about it is circumduction: the hand sweeps a cone and its distance to the shoulder cannot change. Measured:

| elbow° | `|hand − shoulder|` with `axisModel` | with a perpendicular axis |
| ---: | ---: | ---: |
| 0 | 0.4672 | 0.4672 |
| 50 | **0.4672** | 0.3538 |
| 100 | **0.4672** | 0.1743 |

The existing tests missed it because they assert the elbow joint stays fixed and the poses stay finite — both true of a cone sweep — and the browser gate's `elbow-motion-visible` only asserts that pixels moved.

- [ ] **Step 1: Write the failing fold test**

Add to `humanoid-pose.test.ts`, using the real manifest the other tests already load:

```typescript
const shoulderIdx = realManifest.bones.findIndex(b => b.bone === 'RightArm');
const handIdx = realManifest.bones.findIndex(b => b.bone === 'RightHand');

const handToShoulder = (deg: number): number => {
  const poses = poseMatrices(makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 }), realManifest);
  const s = [poses[shoulderIdx * 16 + 12]!, poses[shoulderIdx * 16 + 13]!, poses[shoulderIdx * 16 + 14]!];
  const h = [poses[handIdx * 16 + 12]!, poses[handIdx * 16 + 13]!, poses[handIdx * 16 + 14]!];
  return Math.hypot(h[0]! - s[0]!, h[1]! - s[1]!, h[2]! - s[2]!);
};

it('folds the arm: flexing brings the hand closer to the shoulder', () => {
  const d0 = handToShoulder(0);
  const d50 = handToShoulder(50);
  const d100 = handToShoulder(100);
  expect(d50).toBeLessThan(d0 - 0.05);
  expect(d100).toBeLessThan(d50 - 0.05);
  expect(d100).toBeLessThan(d0 * 0.5);
});

it('does not rotate about the upper-arm axis (that is a cone sweep, not a fold)', () => {
  const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
  const joint = realManifest.joints.find(j => j.child === realManifest.rightArm.forearm)!;
  const n = Math.hypot(joint.axisModel[0]!, joint.axisModel[1]!, joint.axisModel[2]!);
  const dot = Math.abs(
    state.elbowAxis[0] * joint.axisModel[0]! / n +
    state.elbowAxis[1] * joint.axisModel[1]! / n +
    state.elbowAxis[2] * joint.axisModel[2]! / n);
  expect(dot).toBeLessThan(0.2);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/humanoid-pose.test.ts`

Expected: the fold test fails with `d50` equal to `d0` (both ≈ 0.4672), and the axis test fails with `dot` ≈ 1.0.

- [ ] **Step 3: Derive the flexion axis at runtime**

In `humanoid-pose.ts`, replace the `elbowAxis` assignment in `makeHumanoidPose`. Keep reading `joint.axisModel` for nothing — delete that use. Add:

```typescript
/** Bind-pose model-space origin of a bone, from its column-major bindToModel. */
function boneOrigin(manifest: HumanoidVolumeManifest, name: string): Vec3 {
  const b = manifest.bones.find(x => x.bone === name);
  if (!b) throw new Error(`humanoid pose: manifest is missing the ${name} brick`);
  return [b.bindToModel[12]!, b.bindToModel[13]!, b.bindToModel[14]!];
}

/**
 * The elbow's FLEXION axis: perpendicular to both limb segments, so rotating
 * the forearm about it folds the arm.
 *
 * This is deliberately NOT `manifest.joints[].axisModel`. That vector is the
 * joint BAND normal — the 30 mm planar overlap runs across the limb, so its
 * normal runs ALONG the limb, and on the checked-in asset it is parallel to
 * the upper arm to within |dot| = 1.0000. Rotating about it sweeps a cone
 * through the shoulder and cannot change |hand - shoulder| at all.
 *
 * Falls back to the upper arm's own local X basis when the bind arm is
 * straight (the cross product degenerates). The checked-in asset is bent ~39
 * degrees, so the fallback is defensive, not the normal path.
 */
function flexionAxis(manifest: HumanoidVolumeManifest): Vec3 {
  const shoulder = boneOrigin(manifest, manifest.rightArm.upperArm);
  const elbow = boneOrigin(manifest, manifest.rightArm.forearm);
  const wrist = boneOrigin(manifest, manifest.rightArm.hand);
  const upper: Vec3 = [elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]];
  const fore: Vec3 = [wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]];
  const cross: Vec3 = [
    upper[1] * fore[2] - upper[2] * fore[1],
    upper[2] * fore[0] - upper[0] * fore[2],
    upper[0] * fore[1] - upper[1] * fore[0],
  ];
  const n = Math.hypot(cross[0], cross[1], cross[2]);
  if (n > 1e-4) return [cross[0] / n, cross[1] / n, cross[2] / n];
  const b = manifest.bones.find(x => x.bone === manifest.rightArm.upperArm)!;
  const xa: Vec3 = [b.bindToModel[0]!, b.bindToModel[1]!, b.bindToModel[2]!];
  const xn = Math.hypot(xa[0], xa[1], xa[2]);
  return [xa[0] / xn, xa[1] / xn, xa[2] / xn];
}
```

Then set `const elbowAxis: Vec3 = flexionAxis(manifest);` and leave `elbowPivot`, `distalIndices` and `applyElbow` untouched — the pivot is already the forearm's bind origin, which is correct for a fold.

`manifest.rightArm` already carries the three bone names this needs — verified on the checked-in asset: `upperArm: "RightArm"`, `forearm: "RightForeArm"`, `hand: "RightHand"`. Use those; do not hardcode strings and do not add manifest fields.

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run src/lab/sdf-zombie/humanoid-pose.test.ts`

Expected: all pass, including the pre-existing "keeps the weight-derived elbow fixed" test — the pivot did not move, only the axis.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/humanoid-pose.ts src/lab/sdf-zombie/humanoid-pose.test.ts
git commit -m "fix(sdf-lab): flex the humanoid elbow about a perpendicular axis"
```

---

### Task 2: Diagnose the visible brick seams, then fix what you measured

**Files:**
- Create: `docs/dev-notes/2026-08-20-humanoid-dynamics/seam-diagnosis.md`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`

**Interfaces:**
- Consumes: `JOINT_BLEND_WEIGHT`, `HUMANOID_JOINT_SMIN_K`, `sampleBoneColor`, `mapHumanoidField`.
- Produces: whatever the diagnosis justifies, plus the written diagnosis itself.

**Do not skip to a fix.** The owner reports "highly visible seams" at wrists and upper arms. There are three candidate causes and they need different fixes:

1. **Distance discontinuity** — the smooth-min is too narrow, so the surface creases. `HUMANOID_JOINT_SMIN_K` is 0.01 m. Note this is *inside* the procedural zombie's own range (`body.ts` blendK: 0.007 on arms/neck, 0.014–0.02 on torso), so "it is obviously too small" is NOT established. The geometry differs though: the procedural body blends many heavily overlapping capsules, while the baked body blends two large bricks meeting at a 30 mm planar band.
2. **Colour discontinuity on a smooth surface.** The entry keeps the two dominant bones and blends their colours by the same joint weight. If the colour blend is narrower than the distance blend, you get a visible line with no shape change — which is what a "seam" that is not a crease looks like.
3. **Normal discontinuity.** `calcNormal` tetrahedron taps are `0.0015 m` apart; across a hard `min` seam the gradient flips over one tap and the shading breaks even where the surface is continuous.

- [ ] **Step 1: Write the CPU-mirror probe that tells them apart**

Extend the existing CPU mirror in `humanoid.wgsl.test.ts`. Walk a dense line of sample points straight across the `RightArm`/`RightForeArm` joint band in bind pose, and record for each point: the composed distance, the finite-difference normal, and the colour blend weight. Assert and report:

```typescript
it('reports which quantity is discontinuous across the joint band', () => {
  const samples = sampleAcrossJointBand(realManifest, 'RightArm', 'RightForeArm', 400);
  const maxDistJump = maxAbsDelta(samples.map(s => s.distance));
  const maxNormalJump = maxAngleDelta(samples.map(s => s.normal));
  const maxColorJump = maxAbsDelta(samples.map(s => s.colorWeight));
  // Distance must be C0: no step larger than the sampling pitch.
  expect(maxDistJump).toBeLessThan(samples[0]!.pitch * 1.5);
  // Normals must not swing more than 15 degrees between adjacent samples.
  expect(maxNormalJump).toBeLessThan(15 * Math.PI / 180);
  // The colour weight must not step; it must ramp.
  expect(maxColorJump).toBeLessThan(0.1);
});
```

- [ ] **Step 2: Run it and record the numbers**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`

Write all three measured maxima into `seam-diagnosis.md`, plus which assertion fails. **This file is a deliverable even if the test passes** — a passing probe means the seam is not in the field at all and is a lighting or texture artifact, which is itself the finding, and the task then stops and reports rather than changing constants.

- [ ] **Step 3: Fix only the quantity that failed**

- If **distance** failed: widen `HUMANOID_JOINT_SMIN_K`, sweeping 0.010 / 0.015 / 0.020 / 0.030 and recording the measured discontinuity at each. Take the smallest value that clears the assertion — do not take the largest, because an over-wide smooth-min inflates the limb at the joint. Record the sweep in the notes.
- If **colour** failed: widen the colour blend to match the distance blend exactly, reusing the same `jointBlendWeight` call rather than a second parallel weight, so the two cannot drift.
- If **normal** failed: widen the `calcNormal` epsilon to at least half the joint smin k and re-measure.

- [ ] **Step 4: Re-run and commit**

```bash
npx vitest run src/lab/sdf-zombie/webgpu
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts docs/dev-notes/2026-08-20-humanoid-dynamics/seam-diagnosis.md
git commit -m "fix(sdf-lab): close the measured humanoid brick seam"
```

---

### Task 3: Verlet recoil so every hit moves the body

**Files:**
- Create: `src/lab/sdf-zombie/humanoid-verlet.ts`
- Create: `src/lab/sdf-zombie/humanoid-verlet.test.ts`
- Modify: `src/lab/sdf-zombie/humanoid-pose.ts`
- Modify: `src/lab/sdf-zombie/humanoid-pose.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts`

**Interfaces:**
- Consumes: `HumanoidPoseState`, `HumanoidBonePose` (`{position, quaternion}`), `HumanoidVolumeManifest`, `shootRay`.
- Produces: `HumanoidVerletState`, `makeHumanoidVerlet(manifest)`, `stepHumanoidVerlet(state, dt)`, `impulseAtBone(state, worldPoint, delta)`, `verletBonePositions(state)`; `stepHumanoidPose` applies them.

**What the procedural zombie does on a plain click**, which is the behaviour being ported — `src/lab/sdf-zombie/webgpu/lab-main.ts:902`:

```typescript
const push = type === 'blast' ? 0.16 : type === 'pellet' ? 0.06 : 0.04;
bound = impulseAt(bound, hit, [d.x * push, d.y * push, d.z * push]);
```

`impulseAt` (`rig-bind.ts:260`) finds the nearest **unpinned** verlet point and displaces it; the rest-pose spring pulls it back, so the limb recoils and lags. Those three constants were tuned in the motion-polish pass — the comment records that 0.04/0.10 was "sub-perceptual at god-cam distance". **Reuse these exact values.** Do not invent new ones.

- [ ] **Step 1: Write the failing verlet tests**

```typescript
it('holds the bind pose when nothing hits it', () => {
  let v = makeHumanoidVerlet(realManifest);
  const before = verletBonePositions(v);
  for (let i = 0; i < 120; i++) v = stepHumanoidVerlet(v, 1 / 60);
  const after = verletBonePositions(v);
  after.forEach((p, i) => expect(Math.hypot(
    p[0] - before[i]![0], p[1] - before[i]![1], p[2] - before[i]![2])).toBeLessThan(1e-4));
});

it('displaces the nearest bone on impulse and springs back', () => {
  const v0 = makeHumanoidVerlet(realManifest);
  const idx = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
  const at = verletBonePositions(v0)[idx]!;
  let v = impulseAtBone(v0, at, [0.06, 0, 0]);
  const peak = verletBonePositions(v)[idx]!;
  expect(peak[0] - at[0]).toBeGreaterThan(0.03);
  for (let i = 0; i < 240; i++) v = stepHumanoidVerlet(v, 1 / 60);
  const settled = verletBonePositions(v)[idx]!;
  expect(Math.abs(settled[0] - at[0])).toBeLessThan(0.002);
});

it('propagates to the child bone, so the limb lags rather than teleporting', () => {
  const v0 = makeHumanoidVerlet(realManifest);
  const fa = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
  const hand = realManifest.bones.findIndex(b => b.bone === 'RightHand');
  const at = verletBonePositions(v0)[fa]!;
  let v = impulseAtBone(v0, at, [0.06, 0, 0]);
  for (let i = 0; i < 8; i++) v = stepHumanoidVerlet(v, 1 / 60);
  const before = verletBonePositions(v0)[hand]!;
  const after = verletBonePositions(v)[hand]!;
  expect(Math.abs(after[0] - before[0])).toBeGreaterThan(0.001);
});

it('is deterministic: identical impulses give identical state', () => {
  const run = () => {
    let v = impulseAtBone(makeHumanoidVerlet(realManifest), verletBonePositions(makeHumanoidVerlet(realManifest))[0]!, [0.06, 0.01, -0.02]);
    for (let i = 0; i < 60; i++) v = stepHumanoidVerlet(v, 1 / 60);
    return verletBonePositions(v);
  };
  expect(run()).toEqual(run());
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/humanoid-verlet.test.ts`

Expected: import fails — the module does not exist.

- [ ] **Step 3: Implement the verlet layer**

One point per entry in `manifest.bones[]`, seeded at that bone's bind origin. One distance constraint per parent/child pair at its bind length. Pin the root (`Hips`) so the body does not drift. Standard Verlet:

```typescript
const HUMANOID_VERLET_DAMPING = 0.86;
const HUMANOID_VERLET_STIFFNESS = 0.5;   // rest-pose pull per step
const HUMANOID_VERLET_ITERATIONS = 4;    // constraint relaxation passes
```

Each step: integrate `pos += (pos − prev) * damping`, pull toward the bind origin by `stiffness * dt * 60`, then relax the distance constraints `HUMANOID_VERLET_ITERATIONS` times holding pinned points fixed. `impulseAtBone` mirrors `rig-bind.ts:260` exactly: nearest unpinned point, add the delta to `pos` only — never to `prev`, because the gap between them *is* the velocity.

Feed it into the pose by offsetting each bone's `position` by `verletPos − bindOrigin` inside `stepHumanoidPose`, leaving quaternions alone. Rotation stays with the elbow model; this task supplies translation only.

- [ ] **Step 4: Wire the hit**

In `humanoid-spike-main.ts`'s `shootRay`, after the wound is appended, apply the impulse at the hit point along the ray direction with the ported constants:

```typescript
const push = type === 'blast' ? 0.16 : type === 'pellet' ? 0.06 : 0.04;
this.verlet = impulseAtBone(this.verlet, hit.world, [dir[0] * push, dir[1] * push, dir[2] * push]);
```

Add a controller test asserting a `shootWorld` call moves at least one bone position and that `resourceCounts()` is unchanged across it.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run src/lab/sdf-zombie
npx tsc --noEmit
git add src/lab/sdf-zombie/humanoid-verlet.ts src/lab/sdf-zombie/humanoid-verlet.test.ts src/lab/sdf-zombie/humanoid-pose.ts src/lab/sdf-zombie/humanoid-pose.test.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts
git commit -m "feat(sdf-lab): recoil the humanoid on every hit"
```

---

### Task 4: Impact-driven flesh wobble, and the owner gate

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`
- Modify: `scripts/verify-humanoid-sdf-spike.mjs`
- Modify: `docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/notes.md`
- Create: `docs/dev-notes/2026-08-20-humanoid-dynamics/live-*.png`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: `SURFACE_WARP`, `ROW_WOUND` (xyz + radius), `ROW_WOUND_META` (type, age, splay, offset), the per-cluster `ROW_WOUND_RANGE`.
- Produces: a wound-driven term inside `surfaceWarp`, new verifier gates, owner captures.

**Why this is separate from Task 3.** Bone verlet moves rigid bricks, which buys limb recoil but no flesh deformation. The wobble has to come from the warp. Everything needed is already uploaded: each wound carries a world position, a radius, and an **age** — the age is what makes the wobble decay.

- [ ] **Step 1: Write the failing warp tests**

`surfaceWarp` today is `surfaceWarp(local, timeSec, softness01, baseD)` with `amp = softness01 * HUMANOID_SURFACE_WARP_AMP`, gated to `abs(baseD) < amp * 4`. Pin the new behaviour:

```typescript
it('adds a decaying local amplitude around a young wound', () => {
  expect(MARCH_HUMANOID).toContain('woundWarpAmp');
  const fresh = cpuSurfaceWarpAmp({ distToWound: 0.0, woundRadius: 0.055, ageSec: 0.0, softness01: 0 });
  const old = cpuSurfaceWarpAmp({ distToWound: 0.0, woundRadius: 0.055, ageSec: 2.0, softness01: 0 });
  const far = cpuSurfaceWarpAmp({ distToWound: 0.5, woundRadius: 0.055, ageSec: 0.0, softness01: 0 });
  expect(fresh).toBeGreaterThan(0.004);
  expect(old).toBeLessThan(fresh * 0.2);
  expect(far).toBe(0);
});

it('leaves the undisplaced field bit-identical with no wounds and softness 0', () => {
  expect(cpuSurfaceWarpAmp({ distToWound: Infinity, woundRadius: 0, ageSec: 0, softness01: 0 })).toBe(0);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts`

- [ ] **Step 3: Implement the wound-driven amplitude**

Add a `woundWarpAmp` helper that scans the active cluster's wound range and returns the maximum of, per wound, a radial falloff times an exponential age decay:

```wgsl
fn woundWarpAmp(p: vec3<f32>, data: texture_2d<f32>, start: i32, count: i32) -> f32 {
  var amp = 0.0;
  for (var i = 0; i < count; i = i + 1) {
    let w = textureLoad(data, vec2<i32>(start + i, ROW_WOUND), 0);
    let m = textureLoad(data, vec2<i32>(start + i, ROW_WOUND_META), 0);
    let reach = w.w * 2.5;
    let d = length(p - w.xyz);
    if (d >= reach) { continue; }
    let radial = 1.0 - smoothstep(0.0, reach, d);
    let decay = exp(-m.y * 3.0);              // m.y is ageSec
    amp = max(amp, radial * decay);
  }
  return amp;
}
```

Then in `surfaceWarp`, take `amp = max(softness01, woundWarpAmp(...) ) * HUMANOID_SURFACE_WARP_AMP * WOUND_WARP_GAIN` with `WOUND_WARP_GAIN = 2.0`, so a fresh hit wobbles harder than the softness slider ever does and settles in roughly a second. Keep the existing `abs(baseD) >= amp * 4.0` early-out, recomputed against the new amp, so a zero amp is still bit-identical to today.

`surfaceWarp` needs the extra arguments threaded through its callers; keep it one function, do not fork a second warp.

- [ ] **Step 4: Add the live gates**

Extend `verify-humanoid-sdf-spike.mjs` with three gates, keeping all 29 existing ones:

- `elbow-folds` — the hand's screen-space distance to the shoulder at 100° is under 70% of its distance at 0°. This is the browser-side mirror of Task 1's unit test and it is what the old `elbow-motion-visible` gate should have been.
- `hit-moves-body` — capture one frame immediately after `shootWorld` and one 1.5 s later with physics running; require ≥ 300 changed pixels between them outside the crater region, proving the body recoiled and settled rather than only being carved.
- `no-seam-line` — along a scanline crossing the elbow band, no luma step larger than the largest step found elsewhere on the same limb.

Capture `live-elbow-fold-0.png`, `live-elbow-fold-100.png`, `live-hit-recoil.png`, `live-hit-settled.png` into `docs/dev-notes/2026-08-20-humanoid-dynamics/`.

- [ ] **Step 5: Report and hand to the owner**

Record in `notes.md`: the measured hand-to-shoulder ratio at 0/50/100°, the seam diagnosis outcome from Task 2, the recoil peak displacement and settle time, the wound-warp amplitude at age 0 and 2 s, and the steady-state frame cost delta versus the Task 10 baseline (median 16.70 ms). Update `TASKS.md`.

**The gate is the owner's, and it is a comparison, not a checklist**: side by side with `/sdf-lab-webgpu.html`, does a plain click on the baked humanoid now land with comparable weight to the primitive zombie? Do not mark the spike passed on green gates alone — that is exactly what happened at the Task 10 gate.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts scripts/verify-humanoid-sdf-spike.mjs docs/dev-notes/2026-08-20-humanoid-dynamics docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike/notes.md TASKS.md
git commit -m "feat(sdf-lab): wobble humanoid flesh where the shot landed"
```

## Final integration gate

Four tasks, serial. Task 1 is independent; Task 2 is independent of 1 but shares the shader with 4; Tasks 3 and 4 build on 1. After Task 4, review the chained diff, re-run the verifier from a clean worktree, and put `/humanoid-sdf-spike.html` next to `/sdf-lab-webgpu.html` for the owner.

**What a fair verdict looks like.** If plain-click impact is now comparable, the baked path is worth continuing. If it still is not, the remaining suspect is that rigid bricks cannot deform locally the way smin-blended blobs do, and that is a representation limit rather than a missing feature — record it as the spike's answer and stop, rather than starting a fifth task.
