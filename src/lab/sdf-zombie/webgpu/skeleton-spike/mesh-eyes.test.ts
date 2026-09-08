import { describe, expect, it } from 'vitest';
import { meshEyePlacements } from './mesh-eyes';
import type { BoneFieldSource } from './contract';

const head = {
  segment: 'head',
  bounds: { min: [-0.1, -0.14, -0.1], max: [0.1, 0.14, 0.1] },
  distance: (p: readonly number[]) => Math.hypot(p[0]! / 0.1, p[1]! / 0.14, p[2]! / 0.1) * 0.1 - 0.1,
} satisfies Pick<BoneFieldSource, 'segment' | 'bounds' | 'distance'>;

describe('meshEyePlacements', () => {
  it('seats a symmetric pair in the frontal socket regions, partly inside bone', () => {
    const eyes = meshEyePlacements(head);
    expect(eyes).toHaveLength(2);
    expect(eyes[0]!.center[0]).toBeCloseTo(-eyes[1]!.center[0]);
    for (const { center, radius } of eyes) {
      expect(center[1]).toBeCloseTo(0.14 * 0.22);
      expect(center[2]).toBeGreaterThan(0);
      expect(head.distance(center)).toBeLessThan(0);
      expect(head.distance([center[0], center[1], center[2] + radius])).toBeGreaterThan(0);
      expect(radius).toBeLessThan(0.027);
    }
  });
  it('does not attach eyes to non-head segments or missing socket surfaces', () => {
    expect(meshEyePlacements({ ...head, segment: 'limb:arm' })).toEqual([]);
    expect(meshEyePlacements({ ...head, distance: () => 1 })).toEqual([]);
  });
});

import { Vector3 } from 'three/webgpu';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';
import { SegmentMeshCache } from './mesh';
import { createSegmentMeshRenderer } from './mesh-renderer';

it('parents eyes to the real head pose and removes them with sever/revision/clear', () => {
  const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
  const source = createSkeletonSources(body, bindRig(body), { character: 'zombie' }).find(s => s.segment === 'head')!;
  const cache = new SegmentMeshCache();
  const renderer = createSegmentMeshRenderer(cache);
  renderer.update([[source]]);
  const mesh = renderer.object.children[0]!;
  expect(mesh.children).toHaveLength(2);
  const original = mesh.children[0]!;
  renderer.update([[{ ...source, pose: () => ({ origin: [2, 3, 4], quat: [0, 1, 0, 0] }) }]]);
  renderer.object.updateMatrixWorld(true);
  const world = original.getWorldPosition(new Vector3());
  expect(world.x).toBeCloseTo(2 - original.position.x);
  expect(world.y).toBeCloseTo(3 + original.position.y);
  expect(world.z).toBeCloseTo(4 - original.position.z);
  renderer.update([[{ ...source, isLive: () => false }]]);
  expect(mesh.visible).toBe(false);
  renderer.update([[{ ...source, revision: source.revision + '-eyes-test' }]]);
  expect(mesh.children).toHaveLength(2);
  expect(mesh.children[0]).not.toBe(original);
  expect(original.parent).toBeNull();
  renderer.update([]);
  expect(mesh.visible).toBe(false);
  renderer.clear();
  expect(renderer.object.children).toHaveLength(0);
  renderer.dispose();
  cache.dispose();
});
