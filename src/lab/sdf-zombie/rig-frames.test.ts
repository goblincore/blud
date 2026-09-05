// src/lab/sdf-zombie/rig-frames.test.ts
import { describe, it, expect } from 'vitest';
import { boneFrames, segmentQuat } from './rig-frames';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { bindRig } from './rig-bind';
import { qRotate, qFromAxisAngle, normalize, sub, len, add } from './vec';
import type { Vec3 } from './types';
import soldierSrc from './characters/soldier.blob?raw';

const near = (a: Vec3, b: Vec3, eps = 1e-6) => len(sub(a, b)) < eps;

describe('rig-frames', () => {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);

  it('at rest every bone frame is bind: head position, identity rotation', () => {
    const frames = boneFrames(body, bound, 0);
    expect(frames.size).toBe(body.bones.size);
    for (const [name, bone] of body.bones) {
      const f = frames.get(name)!;
      expect(near(f.pos, bone.head), name).toBe(true);
      expect(f.quat, name).toEqual([0, 0, 0, 1]);
    }
  });

  it('a yawed rest rig yields exactly the yaw quaternion on every bone', () => {
    const yaw = 1.1;
    const qYaw = qFromAxisAngle([0, 1, 0], yaw);
    const pivot = body.bones.get('pelvis')!.head;
    const points = bound.rig.points.map(p => {
      const rel = sub(p.pos, [pivot[0], 0, pivot[2]]);
      const r = qRotate(qYaw, rel);
      const pos: Vec3 = [r[0] + pivot[0], r[1], r[2] + pivot[2]];
      return { ...p, pos };
    });
    const frames = boneFrames(body, { ...bound, rig: { ...bound.rig, points } }, yaw);
    for (const [name, f] of frames) {
      for (let k = 0; k < 4; k++) expect(f.quat[k], `${name}[${k}]`).toBeCloseTo(qYaw[k]!, 6);
    }
  });

  it('a raised forearm rotates its frame so bind tail lands on the posed tail', () => {
    const fore = body.bones.get('forearm.r')!;
    const rest = bound.rig.restPose;
    const iH = rest.findIndex(p => near(p, fore.head, 1e-4));
    const iT = rest.findIndex(p => near(p, fore.tail, 1e-4));
    const newTail = add(fore.head, [0, 0, len(sub(fore.tail, fore.head))]); // forearm points +z
    const points = bound.rig.points.map((p, i) => i === iT ? { ...p, pos: newTail } : p);
    const f = boneFrames(body, { ...bound, rig: { ...bound.rig, points } }, 0).get('forearm.r')!;
    expect(near(add(f.pos, qRotate(f.quat, sub(fore.tail, fore.head))), newTail, 1e-6)).toBe(true);
    void iH;
  });

  it('segmentQuat composes yaw first, then the residual', () => {
    const rest: Vec3 = [0, 1, 0];
    const q = segmentQuat(rest, normalize([0, 1, 1]), Math.PI / 2);
    // rest yawed by 90° is still +y; the residual tilts it toward +z.
    expect(near(qRotate(q, rest), normalize([0, 1, 1]), 1e-9)).toBe(true);
  });
});
