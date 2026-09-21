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

describe('SegmentMeshRenderer update(…, shown)', () => {
  it('hides a non-shown owner without pose writes, then re-shows it at the CURRENT pose in one update', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const ownerA = { id: 1 };
    const ownerB = { id: 2 };
    const entries = [[headSrc], [headSrc]] as const;

    // Both visible: both meshes exist, posed, counted as drawn.
    applyRig(body, bound, 0);
    renderer.update([...entries], [ownerA, ownerB]);
    const meshA = renderer.object.children[0]!;
    const meshB = renderer.object.children[1]!;
    expect(meshA.visible).toBe(true);
    expect(meshB.visible).toBe(true);
    expect(renderer.stats.hidden).toBe(0);
    const posB0 = meshB.position.clone();
    const quatB0 = meshB.quaternion.clone();

    // Turn the head (a real re-pose — body yaw rotates the head FRAME; its
    // origin rides the yaw axis, so orientation is the signal here), then
    // update with only A shown.
    bodyYaw = 0.9;
    applyRig(body, bound, bodyYaw);
    renderer.update([...entries], [ownerA, ownerB], new Set([ownerA]));
    expect(meshA.visible).toBe(true);
    expect(meshB.visible).toBe(false);
    expect(renderer.stats.hidden).toBe(1);
    // B received NO pose write: it still sits at the first update's pose.
    expect(meshB.position.distanceTo(posB0)).toBeLessThan(1e-6);
    expect(meshB.quaternion.angleTo(quatB0)).toBeLessThan(1e-6);
    // A keeps following the live pose — visibly rotated away from B's.
    expect(meshA.quaternion.angleTo(quatB0)).toBeGreaterThan(0.05);

    // Re-show BOTH: one update restores B's visibility and writes the
    // CURRENT (yaw-0.9) pose — the same numbers A's mesh just got.
    renderer.update([...entries], [ownerA, ownerB], new Set([ownerA, ownerB]));
    expect(meshB.visible).toBe(true);
    expect(renderer.stats.hidden).toBe(0);
    expect(meshB.position.distanceTo(meshA.position)).toBeLessThan(1e-6);
    expect(meshB.quaternion.angleTo(meshA.quaternion)).toBeLessThan(1e-6);

    renderer.dispose();
    cache.dispose();
  });

  it('the head segment mesh carries the eyes as children, hidden with it', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owner = { id: 7 };
    renderer.update([[headSrc]], [owner]);
    const mesh = renderer.object.children[0]!;
    expect(mesh.children.length).toBeGreaterThan(0); // the seated eyes
    for (const eye of mesh.children) expect(eye.visible).toBe(true);
    renderer.update([[headSrc]], [owner], new Set<unknown>());
    expect(mesh.visible).toBe(false); // the eyes hide WITH the parent
    for (const eye of mesh.children) expect(eye.visible).toBe(true);
    renderer.dispose();
    cache.dispose();
  });

  it('omitting shown draws every owner (the pre-cull path byte-for-byte)', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const ownerA = { id: 1 };
    const ownerB = { id: 2 };
    renderer.update([[headSrc], [headSrc]], [ownerA, ownerB]);
    expect(renderer.object.children[0]!.visible).toBe(true);
    expect(renderer.object.children[1]!.visible).toBe(true);
    expect(renderer.stats.hidden).toBe(0);
    renderer.dispose();
    cache.dispose();
  });
});
