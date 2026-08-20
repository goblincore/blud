// src/lab/sdf-zombie/humanoid-pose.test.ts
//
// Task 4 — the pure right-elbow pose model. These tests pin the plan's
// articulation contract against the REAL checked-in manifest (never a
// hand-written fixture): finite transforms at 0/50/100 degrees, the
// weight-derived elbow staying fixed while the forearm+hand rotate about it,
// a critically damped softness spring that never overshoots, and the
// hierarchy rule that only the RightForeArm subtree moves.
//
// NOTE on the plan's template: `expect(poses).toHaveLength(bones.length)` is
// unsatisfiable for a 16-float column-major matrix per bone — a Float32Array
// length is the element count (16 * 22, not 22) — so the length assertion is
// the strictly stronger `bones.length * 16` and the finiteness assertion is
// kept verbatim. That is a correction, not a weakening.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { validateHumanoidVolumeManifest } from './webgpu/humanoid-volume';
import {
  makeHumanoidPose, stepHumanoidPose, poseMatrices, jointWorldPosition,
  distalBoneIndices,
  HUMANOID_SPRING_DT_CLAMP_S,
} from './humanoid-pose';
import {
  makeHumanoidVerlet, stepHumanoidVerlet, impulseAtBone, verletBonePositions,
} from './humanoid-verlet';

const realManifest = validateHumanoidVolumeManifest(JSON.parse(
  readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
));

const faIdx = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
const handIdx = realManifest.bones.findIndex(b => b.bone === 'RightHand');
const shoulderIdx = realManifest.bones.findIndex(b => b.bone === 'RightArm');
const elbowJoint = realManifest.joints.find(j => j.child === 'RightForeArm');
if (faIdx < 0 || handIdx < 0 || shoulderIdx < 0 || !elbowJoint) {
  throw new Error('checked-in manifest is missing the right-arm chain');
}

const handToShoulder = (deg: number): number => {
  const poses = poseMatrices(makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 }), realManifest);
  const s = [poses[shoulderIdx * 16 + 12]!, poses[shoulderIdx * 16 + 13]!, poses[shoulderIdx * 16 + 14]!];
  const h = [poses[handIdx * 16 + 12]!, poses[handIdx * 16 + 13]!, poses[handIdx * 16 + 14]!];
  return Math.hypot(h[0]! - s[0]!, h[1]! - s[1]!, h[2]! - s[2]!);
};

const matrices = (elbowDeg: number, softness01 = 0): Float32Array =>
  poseMatrices(makeHumanoidPose(realManifest, { elbowDeg, softness01 }), realManifest);

const matrixAt = (m: Float32Array, idx: number): number[] =>
  [...m.subarray(idx * 16, idx * 16 + 16)];

describe('humanoid pose articulation', () => {
  it.each([0, 50, 100])('produces finite right-arm poses at %s degrees', deg => {
    const s = makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 });
    const poses = poseMatrices(s, realManifest);
    expect(poses).toHaveLength(realManifest.bones.length * 16);
    expect([...poses].every(Number.isFinite)).toBe(true);
  });

  it('keeps the weight-derived elbow fixed while the forearm rotates 0..100', () => {
    const p0 = matrices(0);
    const p100 = matrices(100);
    const elbow0 = jointWorldPosition(p0, realManifest, 'RightForeArm');
    const elbow100 = jointWorldPosition(p100, realManifest, 'RightForeArm');
    elbow0.forEach((v, i) => expect(v).toBeCloseTo(elbow100[i]!, 6));
    const hand0 = jointWorldPosition(p0, realManifest, 'RightHand');
    const hand100 = jointWorldPosition(p100, realManifest, 'RightHand');
    expect(Math.hypot(...hand0.map((v, i) => v - hand100[i]!))).toBeGreaterThan(0.001);
  });

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
      state.elbowAxis[0]! * joint.axisModel[0]! / n +
      state.elbowAxis[1]! * joint.axisModel[1]! / n +
      state.elbowAxis[2]! * joint.axisModel[2]! / n);
    expect(dot).toBeLessThan(0.2);
  });

  it('derives the elbow axis and pivot from the manifest right-arm chain', () => {
    const s = makeHumanoidPose(realManifest, { elbowDeg: 40, softness01: 0 });
    expect(s.elbowPivot).toEqual([
      realManifest.bones[faIdx]!.bindToModel[12],
      realManifest.bones[faIdx]!.bindToModel[13],
      realManifest.bones[faIdx]!.bindToModel[14],
    ]);
    // The flexion axis is the cross product of the limb segments: unit length
    // and perpendicular to the band normal `axisModel` (which runs along the
    // limb). It must NOT equal axisModel — rotating about that is a cone sweep.
    expect(Math.hypot(...s.elbowAxis)).toBeCloseTo(1, 6);
    const n = Math.hypot(elbowJoint.axisModel[0]!, elbowJoint.axisModel[1]!, elbowJoint.axisModel[2]!);
    const dot = Math.abs(
      s.elbowAxis[0]! * elbowJoint.axisModel[0]! / n +
      s.elbowAxis[1]! * elbowJoint.axisModel[1]! / n +
      s.elbowAxis[2]! * elbowJoint.axisModel[2]! / n);
    expect(dot).toBeLessThan(0.2);
    expect(s.distalIndices).toEqual(distalBoneIndices(realManifest, 'RightForeArm'));
    expect(s.distalIndices).toContain(faIdx);
    expect(s.distalIndices).toContain(handIdx);
  });

  it('reproduces the exact bind pose at 0 degrees', () => {
    const m = matrices(0);
    realManifest.bones.forEach((b, i) => {
      const got = matrixAt(m, i);
      b.bindToModel.forEach((want, k) => expect(got[k]!).toBeCloseTo(want, 4));
    });
  });

  it('leaves non-right-arm bones in bind pose while the forearm rotates', () => {
    const m100 = matrices(100);
    const distal = new Set(distalBoneIndices(realManifest, 'RightForeArm'));
    realManifest.bones.forEach((b, i) => {
      if (distal.has(i)) return;
      const got = matrixAt(m100, i);
      b.bindToModel.forEach((want, k) => expect(got[k]!).toBeCloseTo(want, 4));
    });
    // the elbow parent itself does not rotate either
    const armIdx = realManifest.bones.findIndex(x => x.bone === 'RightArm');
    const gotArm = matrixAt(m100, armIdx);
    realManifest.bones[armIdx]!.bindToModel.forEach((want, k) => expect(gotArm[k]!).toBeCloseTo(want, 4));
  });

  it('keeps every bone quaternion unit length across articulation and spring steps', () => {
    for (const deg of [0, 50, 100]) {
      const s = makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0.35 });
      for (const bone of s.bones) expect(Math.hypot(...bone.quaternion)).toBeCloseTo(1, 6);
    }
    let s = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0.5 });
    for (let i = 0; i < 30; i++) s = stepHumanoidPose(s, { elbowTargetDeg: 100, softness01: 0.5 }, 1 / 60);
    for (const bone of s.bones) expect(Math.hypot(...bone.quaternion)).toBeCloseTo(1, 6);
  });

  it('clamps the elbow angle to the 0..100 scrubber range', () => {
    const lo = makeHumanoidPose(realManifest, { elbowDeg: -20, softness01: 0 });
    expect(lo.elbowDeg).toBe(0);
    const hi = makeHumanoidPose(realManifest, { elbowDeg: 130, softness01: 0 });
    expect(hi.elbowDeg).toBe(100);
    const stepped = stepHumanoidPose(hi, { elbowTargetDeg: 999, softness01: 0 }, 1 / 60);
    expect(stepped.elbowTargetDeg).toBe(100);
    expect(stepped.elbowDeg).toBe(100);
  });
});

describe('humanoid softness spring', () => {
  it('critically damps toward the target and never overshoots at moderate softness', () => {
    let s = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0.5 });
    const samples: number[] = [];
    for (let i = 0; i < 180; i++) {
      s = stepHumanoidPose(s, { elbowTargetDeg: 100, softness01: 0.5 }, 1 / 60);
      samples.push(s.elbowDeg);
    }
    expect(Math.max(...samples)).toBeLessThanOrEqual(100 + 1e-6);
    expect(samples.at(-1)).toBeCloseTo(100, 1);
  });

  it('interpolates the critical frequency 18 Hz at rigid-near to 3 Hz at max softness', () => {
    // softness 0 snaps (covered elsewhere); the spring range is (0, 1]
    for (const [soft, hz] of [[0.5, 10.5], [1, 3]] as const) {
      const s = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: soft });
      const one = stepHumanoidPose(s, { elbowTargetDeg: 100, softness01: soft }, 1 / 60);
      const omega = 2 * Math.PI * hz;
      const dt = 1 / 60;
      const a = -100;
      const b = omega * a;
      const e = Math.exp(-omega * dt);
      expect(one.elbowDeg).toBeCloseTo(100 + e * (a + b * dt), 6);
    }
  });

  it('snaps directly at softness 0 and clamps softness to 0..1', () => {
    const lo = makeHumanoidPose(realManifest, { elbowDeg: 10, softness01: -0.5 });
    expect(lo.softness01).toBe(0);
    const hi = makeHumanoidPose(realManifest, { elbowDeg: 10, softness01: 1.5 });
    expect(hi.softness01).toBe(1);
    const snap = stepHumanoidPose(hi, { elbowTargetDeg: 100, softness01: 0 }, 1 / 60);
    expect(snap.elbowDeg).toBe(100);
    expect(snap.elbowVelocityDeg).toBe(0);
  });

  it('no-ops on dt <= 0 or non-finite dt', () => {
    const s = makeHumanoidPose(realManifest, { elbowDeg: 30, softness01: 0.6 });
    for (const dt of [0, -1, NaN, Infinity]) {
      expect(stepHumanoidPose(s, { elbowTargetDeg: 100, softness01: 0.6 }, dt)).toBe(s);
    }
  });

  it('clamps the spring integration dt to 1/30 s', () => {
    const base = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0.5 });
    const at = (dt: number) => stepHumanoidPose(base, { elbowTargetDeg: 100, softness01: 0.5 }, dt);
    expect(at(1).elbowDeg).toBeCloseTo(at(HUMANOID_SPRING_DT_CLAMP_S).elbowDeg, 9);
    expect(at(0.25).elbowDeg).toBeCloseTo(at(HUMANOID_SPRING_DT_CLAMP_S).elbowDeg, 9);
    // wall-clock time advances by the raw dt
    expect(at(1).timeSec).toBeCloseTo(1, 9);
    expect(at(0.25).timeSec).toBeCloseTo(0.25, 9);
  });

  it('is deterministic for identical input sequences', () => {
    const run = () => {
      let s = makeHumanoidPose(realManifest, { elbowDeg: 10, softness01: 0.4 });
      for (let i = 0; i < 90; i++) {
        s = stepHumanoidPose(s, { elbowTargetDeg: 75, softness01: 0.4 }, 1 / 60);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(a.elbowDeg).toBe(b.elbowDeg);
    expect(a.elbowVelocityDeg).toBe(b.elbowVelocityDeg);
    expect(a.timeSec).toBe(b.timeSec);
    expect(a.bones).toEqual(b.bones);
  });

  it('throws for an unknown bone name', () => {
    expect(() => jointWorldPosition(matrices(0), realManifest, 'NoSuchBone')).toThrow();
  });
});

describe('humanoid verlet offset application', () => {
  it('stepHumanoidPose offsets each bone by the verlet translation, leaving quaternions alone', () => {
    const idx = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
    const state = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    let verlet = makeHumanoidVerlet(realManifest);
    const at = verletBonePositions(verlet)[idx]!;
    verlet = impulseAtBone(verlet, at, [0.06, 0, 0]);
    verlet = stepHumanoidVerlet(verlet, 1 / 60);

    const posed = stepHumanoidPose(state, { elbowTargetDeg: 0, softness01: 0 }, 1 / 60, verlet);

    // The forearm brick moved along +X with the recoil (translation only)…
    const bindX = realManifest.bones[idx]!.bindToModel[12]!;
    expect(posed.bones[idx]!.position[0]).toBeGreaterThan(bindX + 0.01);
    // …and its rotation is untouched.
    expect(posed.bones[idx]!.quaternion).toEqual(state.bones[idx]!.quaternion);
    // The stored offset matches the verlet displacement exactly.
    expect(posed.verletOffset![idx]![0]).toBeCloseTo(
      verlet.positions[idx]![0] - verlet.bindOrigins[idx]![0], 9);
  });

  it('without a verlet layer the pose is bit-identical to the pre-task elbow pose', () => {
    let s = makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 });
    for (let i = 0; i < 60; i++) s = stepHumanoidPose(s, { elbowTargetDeg: 80, softness01: 0.5 }, 1 / 60);
    expect(s.verletOffset!.every(o => o[0] === 0 && o[1] === 0 && o[2] === 0)).toBe(true);
  });
});
