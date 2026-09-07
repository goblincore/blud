import { expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import src from './characters/soldier.blob?raw';
import { severDistal, severLimb } from './sever';
import { posedDetachedChunk } from './detached-pose';
import { rotateYaw } from './gait';
import { add } from './vec';
import { applyRigidYaw, fitRestToPose } from './webgpu/game-weapon';
import type { Vec3 } from './types';

const b = buildBody(compileBlob(parseBlob(src)));
const place = (p: Vec3) => add(rotateYaw(p, 0.8), [3, 0.2, -2]);
const posed = { ...b,
  prims: b.prims.map(p => ({ ...p, a: place(p.a), b: place(p.b) })),
  bonePrims: b.bonePrims.map(p => ({ ...p, a: place(p.a), b: place(p.b) })),
};

it('places copied distal flesh and split bone endpoints at their current pose', () => {
  const index = b.prims.findIndex(p => p.bone === 'forearm.r');
  const chunk = severDistal(b, { limb: 'armR', fromPrim: index }).chunk;
  expect(b.prims.includes(chunk.prims[0]!)).toBe(false);
  const result = posedDetachedChunk(b, posed, chunk, 0.8);
  expect(result.prims[0]!.a).toEqual(posed.prims[index]!.a);
  for (let i = 0; i < result.bones.length; i++) {
    for (const end of ['a', 'b'] as const) {
      const expected = place(chunk.bones[i]![end]);
      result.bones[i]![end].forEach((v, axis) => expect(v).toBeCloseTo(expected[axis]!, 8));
    }
  }
  result.tornAt[0]!.forEach((v, axis) => expect(v).toBeCloseTo(place(chunk.tornAt[0]!)[axis]!, 8));
});

it('retains the old whole-limb yaw fit exactly for zombie callers', () => {
  const chunk = severLimb(b, 'armL').chunk;
  const rp: Vec3[] = [], pp: Vec3[] = [];
  for (const p of chunk.prims) {
    const i = b.prims.indexOf(p);
    rp.push(p.a, p.b); pp.push(posed.prims[i]!.a, posed.prims[i]!.b);
  }
  const transform = fitRestToPose(rp, pp);
  const result = posedDetachedChunk(b, posed, chunk, 0.8, true);
  expect(result.origin).toEqual(applyRigidYaw(transform, chunk.origin));
  expect(result.prims).toEqual(chunk.prims.map(p => ({ ...p, a: applyRigidYaw(transform, p.a), b: applyRigidYaw(transform, p.b) })));
});
