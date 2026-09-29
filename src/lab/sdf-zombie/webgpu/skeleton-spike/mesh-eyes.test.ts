import { describe, expect, it } from 'vitest';
import {
  meshEyeImpactIndices, meshEyePlacements, meshEyeShading, meshEyeVessels, meshEyeVolume,
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
import { meshBoneSource } from './mesh-skull';
import { SegmentMeshCache } from './mesh';
import { createSegmentMeshRenderer } from './mesh-renderer';

it('parents eyes to the real head pose and removes them with sever/revision/clear', () => {
  const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
  const source = createSkeletonSources(body, bindRig(body), { character: 'zombie' }).find(s => s.segment === 'head')!;
  const cache = new SegmentMeshCache();
  const renderer = createSegmentMeshRenderer(cache);
  // Instanced (2026-09-26): the eyes are instances seated by the head's pose, not child meshes.
  const eyesDrawn = () => renderer.drawn.filter(d => d.eye);
  renderer.update([[source]]);
  expect(eyesDrawn()).toHaveLength(2);
  const seats = meshEyePlacements(meshBoneSource(source));
  renderer.update([[{ ...source, pose: () => ({ origin: [2, 3, 4], quat: [0, 1, 0, 0] }) }]]);
  const worlds = eyesDrawn().map(d => new Vector3().setFromMatrixPosition(d.matrix));
  seats.forEach((seat, i) => {
    expect(worlds[i]!.x).toBeCloseTo(2 - seat.center[0]);
    expect(worlds[i]!.y).toBeCloseTo(3 + seat.center[1]);
    expect(worlds[i]!.z).toBeCloseTo(4 - seat.center[2]);
  });
  renderer.update([[{ ...source, isLive: () => false }]]);
  expect(eyesDrawn()).toHaveLength(0);
  renderer.update([[{ ...source, revision: source.revision + '-eyes-test' }]]);
  expect(eyesDrawn()).toHaveLength(2);
  renderer.update([]);
  expect(renderer.drawn).toHaveLength(0);
  renderer.clear();
  expect(renderer.object.children).toHaveLength(0);
  renderer.dispose();
  cache.dispose();
});

describe('localized projectile eye shock', () => {
  const eyes = [{ center: [-0.07, 0, 0] as [number, number, number], radius: 0.02 }, { center: [0.07, 0, 0] as [number, number, number], radius: 0.02 }];
  it('a central shotgun skull hit can eject both eyes', () => {
    expect(meshEyeImpactIndices(eyes, [0, 0.04, 0.07], 'pellet')).toEqual([0, 1]);
  });
  it('a grazing lateral hit does not remove the far eye', () => {
    expect(meshEyeImpactIndices(eyes, [-0.16, 0, 0], 'pellet')).toEqual([0]);
  });
  it('torso and remote head hits do not eject eyes', () => {
    expect(meshEyeImpactIndices(eyes, [0, -0.5, 0], 'slug')).toEqual([]);
    expect(meshEyeImpactIndices(eyes, [0, 0, -0.3], 'pellet')).toEqual([]);
  });
});

it('persists owned eye loss through revision and actor reorder, and clears debris', () => {
  const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
  const source = createSkeletonSources(body, bindRig(body), { character: 'zombie' }).find(s => s.segment === 'head')!;
  const cache = new SegmentMeshCache(); const renderer = createSegmentMeshRenderer(cache);
  const a = {}, b = {};
  renderer.update([[source], [source]], [a, b]);
  const seat = meshEyePlacements(meshBoneSource(source))[0]!;
  const point = source.toWorld([seat.center[0], seat.center[1], seat.center[2]]);
  expect(renderer.impact(a, [source], point, [0, 0, -1], 'slug')).toBe(2);
  expect(renderer.impact(a, [source], point, [0, 0, -1], 'slug')).toBe(0);
  expect(renderer.eyeState(b).missing).toEqual([]);
  renderer.update([[source], [{ ...source, revision: source.revision + '-changed' }]], [b, a]);
  expect(new Set(renderer.drawn.filter(d => d.eye).map(d => d.owner))).toEqual(new Set([b]));
  expect(renderer.eyeState(a).missing).toEqual([0, 1]);
  const debris = renderer.object.children.find(m => m.name === 'skeleton-ejected-eye')!;
  const before = debris.position.clone(); renderer.stepDebris(0.05);
  expect(debris.position.distanceTo(before)).toBeGreaterThan(0);
  renderer.update([[source]], [b]);
  expect(renderer.eyeState(a).debris).toBe(0);
  renderer.clear(); expect(renderer.eyeState(a).missing).toEqual([]);
  renderer.dispose(); cache.dispose();
});
