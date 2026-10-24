// src/lab/sdf-zombie/kit-eye.test.ts
import { describe, it, expect } from 'vitest';
import { danglingKitEye, hitsKitEye, kitEyeCentre, kitEyeForward, kitEyeSocket, type KitEyeSpec } from './kit-eye';
import { makeStalk, stepStalk } from './head-eye';
import { TERATOMA_PROFILE } from './motion-profile';
import type { Primitive, Vec3 } from './types';

const SPEC: KitEyeSpec = TERATOMA_PROFILE.eye!;
const core = (a: Vec3, orient?: [number, number, number, number]): Primitive =>
  ({ a, b: a, radius: 0.56, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, core: true, op: 'add', ...(orient ? { orient } : {}) }) as Primitive;

describe('kit-eye', () => {
  it('finds the eye from the core prim, turned by the yaw (or by a rigid core\'s orient)', () => {
    const c = kitEyeCentre([core([0, 1.45, 0])], SPEC, 0)!;
    expect(c[0]).toBeCloseTo(0); expect(c[1]).toBeCloseTo(1.625); expect(c[2]).toBeCloseTo(0.40);
    const turned = kitEyeCentre([core([0, 1.45, 0])], SPEC, Math.PI / 2)!;
    expect(turned[0]).toBeCloseTo(0.40); expect(turned[2]).toBeCloseTo(0);
    const q = Math.SQRT1_2;
    const oriented = kitEyeCentre([core([0, 1.45, 0], [0, q, 0, q])], SPEC, 0)!;
    expect(oriented[0]).toBeCloseTo(0.40);
    expect(kitEyeForward([core([0, 1.45, 0])], 0)).toEqual([0, 0, 1]);
  });

  // The round is traced against the flesh only, so a dead-centre shot at the eye stops on a lid in front of it: the
  // test is the shot's LINE through the eyeball, not where it stopped.
  it('pops on a shot whose line goes through the eyeball, wherever on that line it stopped', () => {
    const centre: Vec3 = [0, 1.625, 0.40];
    const dir: Vec3 = [0, 0, -1];
    expect(hitsKitEye([0, 1.6, 0.58], dir, centre, SPEC)).toBe(true);    // stopped on the lid, 0.18 in front
    expect(hitsKitEye([0.1, 1.68, 0.45], dir, centre, SPEC)).toBe(true); // off-centre, still inside the radius
    expect(hitsKitEye([0, 1.3, 0.55], dir, centre, SPEC)).toBe(false);   // the mouth
    expect(hitsKitEye([0, 1.625, 1.2], dir, centre, SPEC)).toBe(false);  // on the line but far out in front
  });

  it('hangs the popped eye from the eye\'s front, on a rope drawn stalkScale times longer, looking out of the face', () => {
    const socket = kitEyeSocket([0, 1.625, 0.40], [0, 0, 1], SPEC);
    expect(socket[2]).toBeGreaterThan(0.40 + SPEC.radius);
    let s = makeStalk(socket, [0, -1, 0.3], 1);
    for (let i = 0; i < 120; i++) s = stepStalk(s, socket, 1 / 60);
    const d = danglingKitEye(s, SPEC, [0, 0, 1]);
    expect(d.nodes[0]).toEqual(socket);
    // hangs below the socket by about the scaled rope
    expect(socket[1] - d.eye[1]).toBeGreaterThan(0.1);
    expect(d.look[2]).toBeGreaterThan(0.6);
  });
});
