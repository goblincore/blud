// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-explode.test.ts
//
// A sculpted skull comes apart on a pop (mesh-renderer.ts explodeSkull with no anatomical kit): the head mesh that was
// being drawn is thrown as the named fragments of sculpt-fragments.ts, and the head stops being drawn at once. The
// real renderer and the real zombie head source; no device (the renderer builds node materials and never draws).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';
import { SegmentMeshCache } from './mesh';
import { SEGMENT_MATERIALS, createSegmentMeshRenderer } from './mesh-renderer';
import { SCULPT_FRAGMENT_IDS } from './sculpt-fragments';
import { SCULPT_FINE_CELL, sculptRecipe } from './sculpt-variant';
import { forcedSplit, headFrameOf, splitWarpOf } from '../../head-split';
import { headQuatOf } from '../../rig-bind';
import { applyRig } from '../../rig-bind';
import { headShape } from '../flame-anchors';
import type { Vec3 } from '../../types';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const head = createSkeletonSources(body, bound, { character: 'zombie' }).find(s => s.segment === 'head')!;

interface Thrown { object: THREE.Object3D; pos: Vec3; vel: Vec3; radius: number; support: readonly { c: Vec3; r: number }[] }
function setup(cache = new SegmentMeshCache()) {
  const thrown: Thrown[] = [];
  const renderer = createSegmentMeshRenderer(cache, 0, undefined, (object, pos, vel, _angular, radius, support) => { thrown.push({ object, pos, vel, radius, support }); });
  return { renderer, thrown, cache };
}
const bonesOf = (r: ReturnType<typeof createSegmentMeshRenderer>, owner: object) => r.drawn.filter(d => d.owner === owner && !d.eye);
const eyesOf = (r: ReturnType<typeof createSegmentMeshRenderer>, owner: object) => r.drawn.filter(d => d.owner === owner && d.eye);

describe('explodeSkull on a sculpted head', () => {
  it('throws the ten named fragments, once, and the head and its eyes stop being drawn in the same call', () => {
    const { renderer, thrown } = setup();
    const a = {}, b = {};
    renderer.update([[head], [head]], [a, b]);
    expect(bonesOf(renderer, a)).toHaveLength(1);
    expect(eyesOf(renderer, a).length).toBeGreaterThan(0);
    expect(renderer.explodeSkull(a, [head], [0, 0, -1])).toBe(SCULPT_FRAGMENT_IDS.length);
    expect(thrown.map(t => t.object.name)).toEqual(SCULPT_FRAGMENT_IDS.map(id => `skull-fragment:${id}`));
    // No frame with both: the batches as they stand no longer draw a's head or eyes; b's are untouched.
    expect(bonesOf(renderer, a)).toHaveLength(0);
    expect(eyesOf(renderer, a)).toHaveLength(0);
    expect(bonesOf(renderer, b)).toHaveLength(1);
    expect(eyesOf(renderer, b).length).toBeGreaterThan(0);
    const batch = renderer.object.children.find(c => (c as THREE.InstancedMesh).isInstancedMesh && c.name === 'skeleton-segments') as THREE.InstancedMesh;
    const scales = Array.from({ length: batch.count }, (_, i) => { const m = new THREE.Matrix4(); batch.getMatrixAt(i, m); return m.getMaxScaleOnAxis(); });
    expect(scales.filter(s => s === 0)).toHaveLength(1);
    expect(scales.filter(s => s > 0.9)).toHaveLength(1);
    // Nor on any later update, though the source still says it is live; and it is thrown only once.
    renderer.update([[head], [head]], [a, b]);
    expect(bonesOf(renderer, a)).toHaveLength(0);
    expect(eyesOf(renderer, a)).toHaveLength(0);
    expect(bonesOf(renderer, b)).toHaveLength(1);
    expect(renderer.explodeSkull(a, [head], [0, 0, -1])).toBe(0);
    expect(thrown).toHaveLength(SCULPT_FRAGMENT_IDS.length);
    renderer.dispose();
  });

  it('a fragment is a piece of the drawn mesh: its own geometry with the paint\'s attribute, two-sided on the split material, thrown from its pivot', () => {
    const { renderer, thrown, cache } = setup();
    const a = {};
    renderer.update([[head]], [a]);
    const whole = cache.get(head).geometry;
    renderer.explodeSkull(a, [head], [0, 0, -1]);
    let triangles = 0;
    for (const t of thrown) {
      const mesh = t.object.children[0] as THREE.Mesh;
      const g = mesh.geometry;
      expect(g).not.toBe(whole);
      expect(g.userData.ownedSkullDebris).toBe(true);
      expect(g.getAttribute('meshFeature').count).toBe(g.getAttribute('position').count);
      expect(g.getAttribute('normal').count).toBe(g.getAttribute('position').count);
      // Its own light row and a split record of zeros (which clips nothing).
      expect(g.getAttribute('iLights').count).toBe(1);
      expect(Array.from((g.getAttribute('iSplitK') as THREE.InterleavedBufferAttribute).data.array)).toEqual(new Array(16).fill(0));
      expect((mesh.material as THREE.Material).name).toBe(SEGMENT_MATERIALS.boneSplit);
      expect((mesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
      triangles += g.index!.count / 3;
      // Thrown from inside the head, outward from the head's middle or along the shot, on real support points.
      const c = head.toWorld([0, 1, 2].map(k => (head.bounds.min[k]! + head.bounds.max[k]!) / 2) as never);
      expect(Math.hypot(t.pos[0] - c[0], t.pos[1] - c[1], t.pos[2] - c[2])).toBeLessThan(0.16);
      expect(Math.hypot(...t.vel)).toBeGreaterThan(0.5);
      expect(t.support.length).toBeGreaterThan(5);
      expect(t.radius).toBeGreaterThan(0.012);
      // The mesh is hung so its pivot is the group's origin: the support points straddle it.
      const xs = t.support.map(s => s.c[0]);
      expect(Math.min(...xs)).toBeLessThan(0.001);
      expect(Math.max(...xs)).toBeGreaterThan(-0.001);
    }
    // Every triangle of the head went somewhere.
    expect(triangles).toBe(whole.index!.count / 3);
    renderer.dispose();
  });

  it('the cut is made once for a mesh and kept: a second head of the same mesh is thrown from the same prototypes', () => {
    const { renderer, thrown } = setup();
    const a = {}, b = {};
    renderer.update([[head], [head]], [a, b]);
    expect(renderer.fragmentStats()).toEqual({ meshes: 0, lastMs: 0 });
    renderer.explodeSkull(a, [head], [0, 0, -1]);
    const first = renderer.fragmentStats();
    expect(first.meshes).toBe(1);
    expect(first.lastMs).toBeGreaterThan(0);
    renderer.explodeSkull(b, [head], [1, 0, 0]);
    expect(renderer.fragmentStats()).toEqual(first);
    expect(thrown).toHaveLength(2 * SCULPT_FRAGMENT_IDS.length);
    // Each thrown fragment owns its geometry.
    const geos = new Set(thrown.map(t => (t.object.children[0] as THREE.Mesh).geometry));
    expect(geos.size).toBe(thrown.length);
    renderer.dispose();
  });

  it('the second sculpt at the fine cell is thrown the same way (the owner\'s `?sculpt=full`)', () => {
    const { renderer, thrown } = setup(new SegmentMeshCache(undefined, undefined, undefined, sculptRecipe('full')));
    const a = {};
    renderer.update([[head]], [a]);
    expect(renderer.explodeSkull(a, [head], [0, 0, -1])).toBe(SCULPT_FRAGMENT_IDS.length);
    expect(thrown).toHaveLength(SCULPT_FRAGMENT_IDS.length);
    expect(SCULPT_FINE_CELL).toBeLessThan(0.01);
    renderer.dispose();
  });

  it('on a split head a fragment of a turned half leaves from where that half is drawn', () => {
    const shape = headShape(applyRig(body, bound, 0))!;
    const frame = headFrameOf(shape, headQuatOf(bound, 0) ?? [0, 0, 0, 1]);
    const warp = splitWarpOf(forcedSplit('middle', 0, 0, 1)!, frame)!;
    const closed = setup(), open = setup();
    const a = {};
    closed.renderer.update([[head]], [a]);
    open.renderer.update([[head]], [a], undefined, undefined, undefined, { warp: () => warp, seed: () => 1 });
    closed.renderer.explodeSkull(a, [head], [0, 0, -1]);
    open.renderer.explodeSkull(a, [head], [0, 0, -1]);
    const moved = closed.thrown.map((t, i) => Math.hypot(t.pos[0] - open.thrown[i]!.pos[0], t.pos[1] - open.thrown[i]!.pos[1], t.pos[2] - open.thrown[i]!.pos[2]));
    const by = new Map(closed.thrown.map((t, i) => [t.object.name.replace('skull-fragment:', ''), moved[i]!]));
    // The two sides of the cranium ride the halves, apart; the lower jaw is under the hinge and stays.
    expect(by.get('parietal-l')!).toBeGreaterThan(0.01);
    expect(by.get('parietal-r')!).toBeGreaterThan(0.01);
    expect(by.get('mandible')!).toBeLessThan(1e-6);
    closed.renderer.dispose(); open.renderer.dispose();
  });
});
