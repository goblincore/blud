// src/lab/sdf-zombie/rig-bind-trunk-roll.test.ts
//
// THE TRUNK ROLLS WITH ITS SHOULDERS (rig-bind.ts bindPrim / applyRig): a lying trunk prim turns with its bone AND the
// width line it rides, so a corpse rolled about its own spine keeps its shoulders in its chest flesh. The bone's
// shortest swing alone left the chest's wide axis where it was and the arms hung 8-13 cm outside it.
import { describe, expect, it } from 'vitest';
import { applyRig, bindRig } from './rig-bind';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { makeZombie } from './body';
import { sdPrimitive } from './validate';
import type { Vec3 } from './types';
import { len, sub } from './vec';

const body = buildBody(makeZombie(), DEFAULT_BUILD_OPTS);

describe('a lying trunk rolls with its shoulders', () => {
  it('a body turned about its own spine keeps its shoulders as deep in the chest as standing', () => {
    const bound = bindRig(body);
    const idx = (p: Vec3) => bound.rig.points.findIndex(q => len(sub(q.pos, p)) < 1e-6);
    const sh = [body.bones.get('upperArm.l')!.head, body.bones.get('upperArm.r')!.head].map(idx);
    const depth = (b: typeof bound) => {
      const torso = applyRig(body, b, 0).prims.filter(p => p.limb === 'torso' && (p.op === undefined || p.op === 'add'));
      return Math.max(...sh.map(i => Math.min(...torso.map(p => sdPrimitive(b.rig.points[i]!.pos, p)))));
    };
    // Down (headFollow 1: the trunk follows its bones), not yet moved.
    const down = { ...bound, rig: { ...bound.rig, headFollow: 1 } };
    const standing = depth(down);
    // Every point turned 90 deg about the vertical through the pelvis, the body's yaw left at 0: a roll about the spine.
    const c = bound.rig.points[idx(body.bones.get('pelvis')!.head)]!.pos;
    const turn = (p: Vec3): Vec3 => [c[0] + (p[2] - c[2]), p[1], c[2] - (p[0] - c[0])];
    const rolled = { ...down, rig: { ...down.rig, points: down.rig.points.map(p => ({ ...p, pos: turn(p.pos), prev: turn(p.prev) })) } };
    expect(depth(rolled)).toBeCloseTo(standing, 3);
  });
});
