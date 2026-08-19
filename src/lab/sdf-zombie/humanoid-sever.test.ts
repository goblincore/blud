// src/lab/sdf-zombie/humanoid-sever.test.ts
//
// Task 4 — the pure sever ownership state layered over the existing
// deterministic gib-chunks.ts stepper. Pins: exactly-once transfer with the
// distal root at the posed cut-plane centre and inherited velocities, the
// frozen hand-to-forearm relationship riding the chunk root, pause physics,
// bounded impact-excited jiggle with exponential decay, the finite fallback,
// and the proximal skeleton staying live after detach.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { validateHumanoidVolumeManifest } from './webgpu/humanoid-volume';
import {
  makeHumanoidPose, stepHumanoidPose, poseMatrices, jointWorldPosition,
  type HumanoidPoseState,
} from './humanoid-pose';
import {
  makeHumanoidSever, severForearm, stepHumanoidSever, resetHumanoidSever,
  chunkBoneWorldPose,
  SEVER_JIGGLE_MAX, SEVER_JIGGLE_DECAY_PER_S,
  type HumanoidSeverState, type ReleaseVelocity,
} from './humanoid-sever';
import { add, qMul, qRotate, type Quat } from './vec';
import type { Vec3 } from './types';

const realManifest = validateHumanoidVolumeManifest(JSON.parse(
  readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
));

const faIdx = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
const handIdx = realManifest.bones.findIndex(b => b.bone === 'RightHand');
if (faIdx < 0 || handIdx < 0) {
  throw new Error('checked-in manifest is missing the right-arm chain');
}

const zeroVelocity = (): ReleaseVelocity => ({ linear: [0, 0, 0], angular: [0, 0, 0] });
const posedAt = (elbowDeg: number, softness01: number): HumanoidPoseState =>
  makeHumanoidPose(realManifest, { elbowDeg, softness01 });

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

const expectVecClose = (a: Vec3, b: Vec3, digits: number): void => {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
};

describe('humanoid sever ownership', () => {
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

  it('starts intact with the sever control parked', () => {
    const s = makeHumanoidSever(realManifest);
    expect(s.phase).toBe('intact');
    expect(s.releaseCount).toBe(0);
    expect(s.chunk).toBeNull();
    expect(s.frozenDistalBones).toEqual([]);
    expect(s.render.attachedCutMode).toBe('none');
    expect(s.render.detachedCutMode).toBe('none');
    expect(s.render.detachedVisible).toBe(false);
    expect(s.render.jiggleImpulse).toBe(0);
    expect(s.render.cutPlaneLocal).toEqual(realManifest.rightArm.cutPlaneLocal);
    // stepping an intact state is a no-op
    expect(stepHumanoidSever(s, 1 / 60, false)).toBe(s);
  });

  it('inherits the supplied linear and angular velocity onto the chunk', () => {
    const cut = severForearm(
      makeHumanoidSever(realManifest), posedAt(50, 0.5),
      { linear: [0.2, 0.1, 0], angular: [0, 0, 1.4] },
    );
    expect(cut.chunk!.vel).toEqual([0.2, 0.1, 0]);
    expect(cut.chunk!.angVel).toEqual([0, 0, 1.4]);
    expect(cut.chunk!.kind).toBe('limb');
    expect(cut.chunk!.limb).toBe('armR');
  });

  it('places the distal root at the posed cut-plane centre', () => {
    const pose = posedAt(63, 0.55);
    const cut = severForearm(makeHumanoidSever(realManifest), pose, zeroVelocity());
    const [nx, ny, nz, w] = realManifest.rightArm.cutPlaneLocal;
    // nearest point on the plane to the forearm bind origin, posed into world
    const planePoint: Vec3 = [-w * nx, -w * ny, -w * nz];
    const posed = pose.bones[faIdx]!;
    const want = add(posed.position, qRotate(posed.quaternion, planePoint));
    cut.chunk!.pos.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
    // the chunk's long axis follows the posed forearm direction
    const wantAxis = qRotate(posed.quaternion, [0, 1, 0]);
    const len = Math.hypot(...wantAxis);
    cut.chunk!.longAxis.forEach((v, i) => expect(v).toBeCloseTo(wantAxis[i]! / len, 6));
  });

  it('freezes the hand-to-forearm relationship relative to the detached root', () => {
    const pose = posedAt(63, 0.55);
    const faPose = pose.bones[faIdx]!;
    const handPose = pose.bones[handIdx]!;
    const posedOffset = sub(handPose.position, faPose.position);
    const relQuatAtSever = qMul(qConj(faPose.quaternion), handPose.quaternion);

    let cut = severForearm(makeHumanoidSever(realManifest), pose, zeroVelocity());
    // at release the recomposed world poses equal the severed poses
    {
      const root = cut.chunk!;
      const [fa, hand] = cut.frozenDistalBones;
      const faWorld = add(root.pos, qRotate(root.quat, fa!.position));
      const handWorld = add(root.pos, qRotate(root.quat, hand!.position));
      expectVecClose(faWorld, faPose.position, 9);
      expectVecClose(handWorld, handPose.position, 9);
    }
    // through the tumble the offset and relative orientation stay rigid
    for (let i = 0; i < 40; i++) {
      cut = stepHumanoidSever(cut, 1 / 60, false);
      const root = cut.chunk!;
      const [fa, hand] = cut.frozenDistalBones;
      const faWorld = add(root.pos, qRotate(root.quat, fa!.position));
      const handWorld = add(root.pos, qRotate(root.quat, hand!.position));
      expectVecClose(sub(handWorld, faWorld), posedOffset, 8);
      const relQuat = qMul(qConj(fa!.quaternion), hand!.quaternion);
      relQuat.forEach((v, k) => expect(v).toBeCloseTo(relQuatAtSever[k]!, 9));
    }
  });

  it('chunkBoneWorldPose recomposes the severed piece exactly (root ⊕ frozen)', () => {
    const pose = posedAt(63, 0.55);
    const cut = severForearm(makeHumanoidSever(realManifest), pose, zeroVelocity());
    const root = cut.chunk!;
    // At release, the recomposed world poses equal the severed poses.
    const faWorld = chunkBoneWorldPose(root, cut.frozenDistalBones[0]!);
    const handWorld = chunkBoneWorldPose(root, cut.frozenDistalBones[1]!);
    expectVecClose(faWorld.position, pose.bones[faIdx]!.position, 9);
    expectVecClose(handWorld.position, pose.bones[handIdx]!.position, 9);
    // The helper is the SAME composition the view uses, so it must match the
    // inline root ⊕ frozen formula to the last ulp.
    const inlineFa = add(root.pos, qRotate(root.quat, cut.frozenDistalBones[0]!.position));
    faWorld.position.forEach((v, k) => expect(v).toBeCloseTo(inlineFa[k]!, 12));
  });

  it('pauses physics while keeping the render pose', () => {
    const cut = severForearm(
      makeHumanoidSever(realManifest), posedAt(50, 0.5),
      { linear: [0, -3, 0], angular: [0.5, 0, 0] },
    );
    const before = cut.chunk!;
    const paused = stepHumanoidSever(cut, 1 / 60, true);
    expect(paused.chunk!.pos).toEqual(before.pos);
    expect(paused.chunk!.vel).toEqual(before.vel);
    expect(paused.chunk!.quat).toEqual(before.quat);
    expect(paused.render.jiggleImpulse).toBe(cut.render.jiggleImpulse);
    // unpaused stepping still works afterwards
    const running = stepHumanoidSever(paused, 1 / 60, false);
    expect(running.chunk!.pos[1]).toBeLessThan(before.pos[1]);
  });

  it('excites a bounded jiggle impulse on floor impact and decays it exponentially', () => {
    let s = severForearm(
      makeHumanoidSever(realManifest), posedAt(50, 0.5),
      { linear: [0, -8, 0], angular: [0, 0, 0] },
    );
    // step until the first floor impact excites the jiggle
    for (let i = 0; i < 600 && s.render.jiggleImpulse === 0; i++) {
      s = stepHumanoidSever(s, 1 / 60, false);
    }
    expect(s.render.jiggleImpulse).toBeGreaterThan(0);
    expect(s.render.jiggleImpulse).toBeLessThanOrEqual(SEVER_JIGGLE_MAX);

    // ground it and stop it so decay is pure
    const rest: HumanoidSeverState = {
      ...s,
      chunk: {
        ...s.chunk!, pos: [s.chunk!.pos[0]!, s.chunk!.radius, s.chunk!.pos[2]!],
        vel: [0, 0, 0], angVel: [0, 0, 0],
      },
    };
    const dt = 1 / 60;
    const j0 = rest.render.jiggleImpulse;
    const r1 = stepHumanoidSever(rest, dt, false);
    expect(r1.render.jiggleImpulse / j0).toBeCloseTo(Math.exp(-SEVER_JIGGLE_DECAY_PER_S * dt), 6);
    // monotonic decay toward zero
    let prev = r1.render.jiggleImpulse;
    let decaying = r1;
    for (let i = 0; i < 300; i++) {
      decaying = stepHumanoidSever(decaying, dt, false);
      expect(decaying.render.jiggleImpulse).toBeLessThan(prev);
      prev = decaying.render.jiggleImpulse;
    }
    expect(decaying.render.jiggleImpulse).toBeLessThan(1e-3);
  });

  it('falls back to a finite physics state when the chunk is non-finite', () => {
    const cut = severForearm(makeHumanoidSever(realManifest), posedAt(50, 0.5), zeroVelocity());
    const broken: HumanoidSeverState = {
      ...cut,
      chunk: { ...cut.chunk!, vel: [NaN, 0, 0], angVel: [Infinity, 0, 0] },
    };
    const stepped = stepHumanoidSever(broken, 1 / 60, false);
    const c = stepped.chunk!;
    expect([...c.vel, ...c.angVel].every(Number.isFinite)).toBe(true);
    expect(c.vel).toEqual([0, 0, 0]);
    expect(c.angVel).toEqual([0, 0, 0]);
    expect([...c.pos, ...c.quat].every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(stepped.render.jiggleImpulse)).toBe(true);
  });

  it('keeps the proximal skeleton live and the input pose untouched after detach', () => {
    const pose = posedAt(63, 0.55);
    const poseSnapshot = JSON.parse(JSON.stringify(pose.bones));
    const cut = severForearm(makeHumanoidSever(realManifest), pose, zeroVelocity());
    // severing does not mutate the input pose
    expect(pose.bones).toEqual(poseSnapshot);
    // the attached arm keeps articulating: a fresh 0-degree pose returns to bind
    const back = poseMatrices(makeHumanoidPose(realManifest, { elbowDeg: 0, softness01: 0 }), realManifest);
    const elbowBack = jointWorldPosition(back, realManifest, 'RightForeArm');
    expectVecClose(elbowBack, [
      realManifest.bones[faIdx]!.bindToModel[12]!,
      realManifest.bones[faIdx]!.bindToModel[13]!,
      realManifest.bones[faIdx]!.bindToModel[14]!,
    ], 6);
    const hand0 = jointWorldPosition(back, realManifest, 'RightHand');
    const hand100 = jointWorldPosition(
      poseMatrices(makeHumanoidPose(realManifest, { elbowDeg: 100, softness01: 0 }), realManifest),
      realManifest, 'RightHand',
    );
    expect(Math.hypot(...hand0.map((v, i) => v - hand100[i]!))).toBeGreaterThan(0.001);
    // the severed state is a snapshot: stepping a new pose does not change it
    const frozenBeforeSnapshot = JSON.parse(JSON.stringify(cut.frozenDistalBones));
    stepHumanoidPose(pose, { elbowTargetDeg: 0, softness01: 0 }, 1 / 60);
    expect(JSON.parse(JSON.stringify(cut.frozenDistalBones))).toEqual(frozenBeforeSnapshot);
  });
});
