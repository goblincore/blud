// src/lab/sdf-zombie/webgpu/bone-instancer.test.ts
import { describe, expect, it } from 'vitest';
import type { Primitive } from '../types';
import { packBoneInstances, INSTANCE_FLOATS, BONE_QROT_WGSL, BONE_VERTEX_WGSL, BONE_SHADE_WGSL, BONE_HASH_WGSL, BONE_NOISE_WGSL, boneInstanceArrays } from './bone-instancer';

const bone = (over: Partial<Primitive>): Primitive => ({
  a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0,
  limb: 'torso', cluster: 1, op: 'bone', ...over,
});

// Instance data lives in a Float32Array, so equality is to f32 precision,
// not literal (0.1 packs to 0.10000000149011612).
const closeArr = (actual: ArrayLike<number>, expected: readonly number[]) => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 6);
};

describe('packBoneInstances', () => {
  it('packs bones only: organs, dead prims and dead clusters are skipped', () => {
    const arrays = boneInstanceArrays(8);
    const alive = [true, true, false];
    const n = packBoneInstances([
      bone({}),
      bone({ op: 'organ' }),
      bone({ dead: true }),
      bone({ cluster: 2 }),               // dead cluster
      bone({ b: [0.1, 0, 0], bend: [0, 0.02, 0], radiusB: 0.01, scale: [1.2, 1, 1] }),
    ], alive, arrays, 8);
    expect(n).toBe(2);
    // second instance: a, b, c, r, scale
    const o = INSTANCE_FLOATS;
    closeArr(arrays.ab.subarray(o * 1, o * 1 + 6), [0, 0, 0, 0.1, 0, 0]);
    closeArr(arrays.ab.subarray(o * 1 + 6, o * 1 + 9), [0.05, 0.02, 0]);
    closeArr(arrays.ab.subarray(o * 1 + 9, o * 1 + 11), [0.02, 0.01]);
    closeArr(arrays.ab.subarray(o * 1 + 11, o * 1 + 14), [1.2, 1, 1]);
    closeArr(arrays.ab.subarray(o * 1 + 14, o * 1 + 18), [0, 0, 0, 1]);
  });
  it('clamps at capacity and reports overflow', () => {
    const arrays = boneInstanceArrays(2);
    const n = packBoneInstances([bone({}), bone({}), bone({})], [true, true], arrays, 2);
    expect(n).toBe(2);
    expect(arrays.overflowed).toBe(true);
  });
  it('a chunk bone list (cluster 0, no alive table) packs by passing alive undefined', () => {
    const arrays = boneInstanceArrays(4);
    expect(packBoneInstances([bone({ cluster: 0 })], undefined, arrays, 4)).toBe(1);
  });
});

describe('WGSL parse contract', () => {
  for (const [name, src] of Object.entries({ BONE_QROT_WGSL, BONE_VERTEX_WGSL, BONE_SHADE_WGSL, BONE_HASH_WGSL, BONE_NOISE_WGSL })) {
    it(`${name} starts with fn and has no colon-in-comment in its signature`, () => {
      expect(src.startsWith('fn ')).toBe(true);
      // ONE fn per string: wgslFn reads a second fn's parameters as the
      // node's inputs (a boneHash inside the shade string asked for an input
      // 'q' and the pipeline never built — 2026-09-03).
      expect((src.match(/^fn /gm) ?? []).length, `${name} declares more than one fn`).toBe(1);
      const sig = src.slice(src.indexOf('('), src.indexOf(') ->') + 1);
      for (const line of sig.split('\n')) {
        const c = line.indexOf('//');
        if (c >= 0) expect(line.slice(c)).not.toMatch(/\w\s*:\s*\w/);
      }
    });
  }
});
