// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.test.ts
//
// Visual-actor cull (plan 2026-09-20, task 2): the renderer's `shown` set.
// The renderer itself is constructible under vitest (it builds node
// materials but never touches a device — mesh.test.ts already does this),
// so these drive the REAL update() against the REAL zombie head source and
// pin the three claims the plan asks for: a hidden owner's meshes are
// invisible and receive no pose write; re-showing the owner restores
// visibility AND the current pose in one update; stats.hidden counts them.
// `segmentDrawn` — the pure per-segment decision the loop calls — is pinned
// separately so the owner test cannot drift from the live/sever rule.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig, applyRig } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';
import { SegmentMeshCache } from './mesh';
import { createSegmentMeshRenderer, segmentDrawn } from './mesh-renderer';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
// The sources read bodyYaw through the opts getter (yawNow), so the test can
// re-pose the head for real — the same knob the game's per-frame pose drives.
let bodyYaw = 0;
const sources = createSkeletonSources(body, bound, { character: 'zombie', bodyYaw: () => bodyYaw });
const headSrc = sources.find(s => s.segment === 'head')!;

describe('segmentDrawn — the pure owner/live decision', () => {
  it('draws a live segment when shown is omitted (pre-cull behaviour)', () => {
    expect(segmentDrawn(true, {})).toBe(true);
    expect(segmentDrawn(false, {})).toBe(false);
  });

  it('an owner in shown draws iff the segment is live', () => {
    const owner = { id: 1 };
    const shown = new Set([owner]);
    expect(segmentDrawn(true, owner, shown)).toBe(true);
    expect(segmentDrawn(false, owner, shown)).toBe(false);
  });

  it('an owner outside shown is not drawn, even when live', () => {
    const shown = new Set([{ id: 1 }]);
    expect(segmentDrawn(true, { id: 2 }, shown)).toBe(false);
  });

  it('a severed segment stays hidden whatever the owner test says', () => {
    const owner = { id: 3 };
    expect(segmentDrawn(false, owner, undefined)).toBe(false);
    expect(segmentDrawn(false, owner, new Set([owner]))).toBe(false);
  });
});

describe('SegmentMeshRenderer update(…, shown) — instanced draws', () => {
  const segs = (r: ReturnType<typeof createSegmentMeshRenderer>, owner: unknown) =>
    r.drawn.filter(d => d.owner === owner && !d.eye);
  const eyes = (r: ReturnType<typeof createSegmentMeshRenderer>, owner: unknown) =>
    r.drawn.filter(d => d.owner === owner && d.eye);
  const quatOf = (m: THREE.Matrix4) => { const q = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q; };

  it('a non-shown owner draws nothing, and re-showing draws it at the CURRENT pose in one update', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const ownerA = { id: 1 };
    const ownerB = { id: 2 };
    const entries = [[headSrc], [headSrc]] as const;

    bodyYaw = 0;
    applyRig(body, bound, 0);
    renderer.update([...entries], [ownerA, ownerB]);
    expect(segs(renderer, ownerA)).toHaveLength(1);
    expect(segs(renderer, ownerB)).toHaveLength(1);
    expect(renderer.stats.hidden).toBe(0);
    const q0 = quatOf(segs(renderer, ownerB)[0]!.matrix);

    bodyYaw = 0.9;
    applyRig(body, bound, bodyYaw);
    renderer.update([...entries], [ownerA, ownerB], new Set([ownerA]));
    expect(segs(renderer, ownerA)).toHaveLength(1);
    expect(segs(renderer, ownerB)).toHaveLength(0);
    expect(renderer.stats.hidden).toBe(1);
    expect(quatOf(segs(renderer, ownerA)[0]!.matrix).angleTo(q0)).toBeGreaterThan(0.05);

    renderer.update([...entries], [ownerA, ownerB], new Set([ownerA, ownerB]));
    expect(renderer.stats.hidden).toBe(0);
    const a = segs(renderer, ownerA)[0]!.matrix, b = segs(renderer, ownerB)[0]!.matrix;
    expect(quatOf(b).angleTo(quatOf(a))).toBeLessThan(1e-6);
    expect(new THREE.Vector3().setFromMatrixPosition(b).distanceTo(new THREE.Vector3().setFromMatrixPosition(a))).toBeLessThan(1e-6);

    // Instancing: two actors' heads are ONE draw (plus one for their eyes).
    expect(renderer.draws).toBe(2);
    renderer.dispose();
    cache.dispose();
  });

  it('the head carries its seated eyes, drawn and hidden with it', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owner = { id: 7 };
    renderer.update([[headSrc]], [owner]);
    expect(eyes(renderer, owner).length).toBeGreaterThan(0);
    // Each eye sits inside the head: near the head's origin, scaled to its radius.
    const head = new THREE.Vector3().setFromMatrixPosition(segs(renderer, owner)[0]!.matrix);
    for (const e of eyes(renderer, owner)) expect(new THREE.Vector3().setFromMatrixPosition(e.matrix).distanceTo(head)).toBeLessThan(0.4);
    renderer.update([[headSrc]], [owner], new Set<unknown>());
    expect(eyes(renderer, owner)).toHaveLength(0);
    renderer.dispose();
    cache.dispose();
  });

  it('omitting shown draws every owner (the pre-cull path)', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const ownerA = { id: 1 };
    const ownerB = { id: 2 };
    renderer.update([[headSrc], [headSrc]], [ownerA, ownerB]);
    expect(segs(renderer, ownerA)).toHaveLength(1);
    expect(segs(renderer, ownerB)).toHaveLength(1);
    expect(renderer.stats.hidden).toBe(0);
    renderer.dispose();
    cache.dispose();
  });

  it('grows an instanced batch past its first capacity', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owners = Array.from({ length: 40 }, (_, i) => ({ id: i }));
    renderer.update(owners.map(() => [headSrc]), owners);
    expect(renderer.drawn.filter(d => !d.eye)).toHaveLength(40);
    renderer.dispose();
    cache.dispose();
  });
});

describe('segmentNeeded (bone exposure cull)', () => {
  it('draws everything without an exposed set; else only exposed owners, plus eye-carrying segments', async () => {
    const { segmentNeeded } = await import('./mesh-renderer');
    const a = {}, b = {};
    expect(segmentNeeded(a, false)).toBe(true);
    expect(segmentNeeded(a, false, new Set([a]))).toBe(true);
    expect(segmentNeeded(b, false, new Set([a]))).toBe(false);
    expect(segmentNeeded(b, true, new Set([a]))).toBe(true);
  });
});
