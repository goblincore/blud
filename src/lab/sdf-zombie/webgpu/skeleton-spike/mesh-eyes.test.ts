import { describe, expect, it } from 'vitest';
import {
  meshEyePlacements, meshEyeShading, meshEyeVessels, meshEyeVolume,
  MESH_EYE_GLOW_PUPIL,
} from './mesh-eyes';
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

const luminance = (c: readonly [number, number, number]) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;

describe('meshEyeShading glow', () => {
  it('puts a restrained red glow on the pupil and iris, none on the sclera', () => {
    const pupil = meshEyeShading([0, 0, 1]);
    const iris = meshEyeShading([0.32, 0, 1]);
    const sclera = meshEyeShading([0.7, 0, 0.5]);
    // Restrained: bright enough to read in darkness, far below a light.
    expect(pupil.emission[0]).toBeGreaterThan(0.3);
    expect(pupil.emission[0]).toBeLessThanOrEqual(MESH_EYE_GLOW_PUPIL);
    expect(pupil.emission[0]).toBeGreaterThan(iris.emission[0]);
    expect(iris.emission[0]).toBeGreaterThan(0);
    expect(iris.emission[0]).toBeLessThan(0.12);
    expect(luminance(sclera.emission)).toBe(0);
    // Blood-red, not white: red dominates by a wide margin.
    expect(pupil.emission[0]).toBeGreaterThan(pupil.emission[1] * 8);
    expect(pupil.emission[0]).toBeGreaterThan(pupil.emission[2] * 8);
  });

  it('confines the glow to the front of the eyeball', () => {
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      for (const z of [-1, -0.6, -0.2, 0.1, 0.3]) {
        const e = meshEyeShading([Math.cos(a) * 0.5, Math.sin(a) * 0.5, z]).emission;
        expect(Math.max(e[0], e[1], e[2])).toBe(0);
      }
    }
  });

  it('keeps a fleshy, volume-shaded eyeball: dark pupil and iris under rose sclera', () => {
    const pupil = meshEyeShading([0, 0, 1]).albedo;
    const iris = meshEyeShading([0.32, 0, 1]).albedo;
    const sclera = meshEyeShading([0.75, 0, 0.66]).albedo;
    expect(luminance(sclera)).toBeGreaterThan(luminance(iris));
    expect(luminance(iris)).toBeGreaterThan(luminance(pupil));
    expect(sclera[0]).toBeGreaterThan(sclera[1]);
    expect(sclera[0]).toBeGreaterThan(sclera[2]);
  });
});

describe('meshEyeVolume', () => {
  it('is a bounded monotone limbal falloff, not a flat disc', () => {
    expect(meshEyeVolume(0)).toBeCloseTo(0.72, 6);
    expect(meshEyeVolume(1)).toBeCloseTo(1, 6);
    let prev = -1;
    for (let r = 0; r <= 1.0001; r += 0.02) {
      const v = meshEyeVolume(r);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0.72);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe('meshEyeVessels', () => {
  const sample = () => {
    let on = 0, n = 0, min = 1, max = 0, edges = 0;
    for (let i = 0; i < 90; i++) for (let j = 0; j < 60; j++) {
      const x = -0.98 + i / 89 * 1.96, y = -0.98 + j / 59 * 1.96;
      if (x * x + y * y > 0.96) continue;
      const v = meshEyeVessels([x, y, 0.8]);
      n++;
      if (v > 0.5) on++;
      if (v > 0.2 && v < 0.8) edges++;
      min = Math.min(min, v); max = Math.max(max, v);
    }
    return { on, n, min, max, edges };
  };

  it('paints irregular branching vessels: some coverage, real edges, not a stencil', () => {
    const s = sample();
    const coverage = s.on / s.n;
    expect(coverage).toBeGreaterThan(0.03);
    expect(coverage).toBeLessThan(0.5);
    expect(s.max).toBeGreaterThan(0.6);
    expect(s.min).toBeLessThan(0.05);
    // A binary stencil would have almost no partial values; branching filaments
    // spend a real share of the sclera on their soft edges.
    expect(s.edges).toBeGreaterThan(0.02 * s.n);
  });

  it('keeps vessels off the iris/pupil and off the back of the eyeball', () => {
    expect(meshEyeVessels([0, 0, 1])).toBe(0);
    expect(meshEyeVessels([0.15, 0, 1])).toBe(0);
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2;
      expect(meshEyeVessels([Math.cos(a) * 0.7, Math.sin(a) * 0.7, -0.5])).toBe(0);
    }
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
