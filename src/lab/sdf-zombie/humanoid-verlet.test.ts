// src/lab/sdf-zombie/humanoid-verlet.test.ts
//
// Task 3 Step 1 — the verlet recoil layer, pinned against the REAL checked-in
// manifest. The four tests are the plan's template verbatim: hold bind pose
// when nothing hits; nearest-bone displacement + spring-back; propagation to
// the child so the limb lags; and determinism.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { validateHumanoidVolumeManifest } from './webgpu/humanoid-volume';
import {
  makeHumanoidVerlet, stepHumanoidVerlet, impulseAtBone, verletBonePositions,
} from './humanoid-verlet';

const realManifest = validateHumanoidVolumeManifest(JSON.parse(
  readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
));

describe('humanoid verlet recoil', () => {
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
});
