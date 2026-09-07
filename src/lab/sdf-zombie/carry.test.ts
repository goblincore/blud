// src/lab/sdf-zombie/carry.test.ts
import { describe, it, expect } from 'vitest';
import shotgunSource from '../../../public/assets/lab/soldier-shotgun.glb?raw';
import {
  CARRIES, GUN_GRIP, armPivot, gunPoseFromArm, lookQuat, gunPoint,
} from './carry';
import { add, len, normalize, qRotate, sub } from './vec';
import type { Vec3 } from './types';

const near = (a: Vec3, b: Vec3, eps = 1e-6) => len(sub(a, b)) < eps;

describe('carry maths', () => {
  it('scales the whole gun while keeping the grip seated and the other locators aligned', () => {
    const hand: Vec3 = [-.2, 1.6, .3];
    const pose = gunPoseFromArm([-.2, 1.4, 0], hand, [1, 0, 0], .4, 1.2);
    expect(near(gunPoint(pose, GUN_GRIP.gripHand), hand, 1e-9)).toBe(true);
    for (const point of [GUN_GRIP.foreHand, GUN_GRIP.muzzle]) {
      expect(len(sub(gunPoint(pose, point), hand)))
        .toBeCloseTo(len(sub(point, GUN_GRIP.gripHand)) * 1.2, 9);
    }
  });
  it('lookQuat maps +z onto fwd and keeps +x near the requested right', () => {
    const fwd = normalize([0, 0.3, 1]);
    const q = lookQuat(fwd, [0, 1, 0]);
    expect(near(qRotate(q, [0, 0, 1]), fwd, 1e-9)).toBe(true);
    const x = qRotate(q, [1, 0, 0]);
    expect(x[1]).toBeCloseTo(0, 9); // no roll: gun-right stays level
    expect(x[0]).toBeGreaterThan(0.99);
  });

  it('gunPoseFromArm seats Grip_Hand exactly on the hand point', () => {
    const elbow: Vec3 = [-0.2, 1.1, 0], hand: Vec3 = [-0.2, 1.1, 0.24];
    const pose = gunPoseFromArm(elbow, hand, [1, 0, 0], 0);
    expect(near(gunPoint(pose, GUN_GRIP.gripHand), hand, 1e-9)).toBe(true);
    // gunPitch 0: the muzzle points along the forearm
    const m = gunPoint(pose, GUN_GRIP.muzzle);
    expect(near(normalize(sub(m, gunPoint(pose, [0, 0, 0]))), [0, 0, 1], 1e-9)).toBe(true);
  });

  it('positive gunPitch raises the muzzle', () => {
    const elbow: Vec3 = [-0.2, 1.1, 0], hand: Vec3 = [-0.2, 1.1, 0.24];
    const up = gunPoseFromArm(elbow, hand, [1, 0, 0], 0.4);
    expect(gunPoint(up, GUN_GRIP.muzzle)[1]).toBeGreaterThan(gunPoint(up, [0, 0, 0])[1] + 0.1);
  });

  it('armPivot keeps both segment lengths and folds the forearm forward', () => {
    const shoulder: Vec3 = [-0.14, 1.36, 0];
    const s1: Vec3 = [-0.02, -0.26, 0.01], s2: Vec3 = [0, -0.24, 0.03];
    const r = armPivot(shoulder, s1, s2, CARRIES.hip.right, [1, 0, 0], 1, 1);
    expect(len(sub(r.elbow, shoulder))).toBeCloseTo(len(s1), 9);
    expect(len(sub(r.hand, r.elbow))).toBeCloseTo(len(s2), 9);
    expect(r.hand[2]).toBeGreaterThan(r.elbow[2]); // forearm points forward
  });

  it('every carry has a reachable fore-end for a 0.5 m arm from the soldier shoulders', () => {
    const shoulderR: Vec3 = [-0.14, 1.36, 0], shoulderL: Vec3 = [0.14, 1.36, 0];
    const s1: Vec3 = [-0.02, -0.26, 0.01], s2: Vec3 = [0, -0.24, 0.03];
    for (const name of ['low', 'chest', 'hip'] as const) {
      const c = CARRIES[name];
      // presence 1: the full carry pose (the plan's 0 was a typo — at
      // presence 0 every angle is zero, so no carry tuning can move the
      // fore-end, and a hanging-arm fore-end is ~0.78 m from the shoulder).
      const r = armPivot(shoulderR, s1, s2, c.right, [1, 0, 0], 1, 1);
      const pose = gunPoseFromArm(r.elbow, r.hand, [1, 0, 0], c.gunPitch);
      const fore = gunPoint(pose, GUN_GRIP.foreHand);
      expect(len(sub(fore, shoulderL)), name).toBeLessThan(0.48);
      expect(len(sub(fore, shoulderL)), name).toBeGreaterThan(0.15);
    }
  });
});


describe('soldier shotgun asset attachments', () => {
  it('keeps hand spacing compact while the exaggerated muzzle extends beyond the support hand', () => {
    expect(len(sub(GUN_GRIP.foreHand, GUN_GRIP.gripHand))).toBeLessThan(0.24);
    expect(len(sub(GUN_GRIP.muzzle, GUN_GRIP.gripHand))).toBeGreaterThan(0.47);
  });

  it('runtime grip and shot origins match the exported model locators', () => {
    // GLB metadata is UTF-8 JSON before the binary chunk; the binary payload
    // is irrelevant to the attachment contract and is never decoded here.
    const binaryChunk = shotgunSource.indexOf('BIN\0');
    const model = JSON.parse(shotgunSource.slice(shotgunSource.indexOf('{'), shotgunSource.lastIndexOf('}', binaryChunk) + 1));
    const nodes = new Map<string, { translation: number[] }>(model.nodes.map((node: { name: string; translation: number[] }) => [node.name, node]));
    for (const [name, expected] of [
      ['Grip_Hand', GUN_GRIP.gripHand], ['Fore_Hand', GUN_GRIP.foreHand], ['Muzzle', GUN_GRIP.muzzle],
    ] as const) {
      const actual = nodes.get(name)!.translation;
      expected.forEach((value, i) => expect(actual[i], name).toBeCloseTo(value, 6));
    }
  });
});
