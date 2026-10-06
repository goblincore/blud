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
import { headQuatOf } from '../../rig-bind';
import {
  HEAD_SPLIT, forcedSplit, headFrameOf, skullFollow, skullSplitOf, skullWarpPoint, splitWarpOf,
  type SplitPresetId, type SplitWarp,
} from '../../head-split';
import { headShape } from '../flame-anchors';
import { meshBoneSource } from './mesh-skull';
import { meshEyePlacements } from './mesh-eyes';
import { SPLIT_INSTANCE_ATTRS, SPLIT_INSTANCE_FLOATS, packSplitInstance } from './mesh-split';
import type { Vec3 } from '../../types';

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

describe('shared light list (plan 1, Task 11): iLights carries the owner\'s picks', () => {
  const lightsOf = (o: unknown) => {
    const bl = (o as { bodyLights?: number[] }).bodyLights;
    return bl ? new THREE.Vector4(...bl) : undefined;
  };
  const iLights = (r: ReturnType<typeof createSegmentMeshRenderer>, eye: boolean) => {
    const m = r.object.children.find(c => (c as THREE.InstancedMesh).isInstancedMesh && c.name === (eye ? 'skeleton-fleshy-eyes' : 'skeleton-segments')) as THREE.InstancedMesh;
    const a = m.geometry.getAttribute('iLights') as THREE.InstancedBufferAttribute;
    return { m, a };
  };
  it('writes the owner actor\'s pick into iLights for its segment and its eyes', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const actor = { id: 1, bodyLights: [0.9, -1, -1, -1] };
    renderer.update([[headSrc]], [actor]);
    renderer.syncLights(lightsOf);
    const seg = iLights(renderer, false);
    expect(seg.a.isInstancedBufferAttribute).toBe(true);
    expect(seg.a.itemSize).toBe(4);
    expect(Array.from(seg.a.array.slice(0, 4)).map(v => +v.toFixed(4))).toEqual([0.9, -1, -1, -1]);
    const eye = iLights(renderer, true);
    expect(eye.m.count).toBeGreaterThan(0);
    for (let i = 0; i < eye.m.count; i++) expect(eye.a.array[i * 4]).toBeCloseTo(0.9, 6);
    // no owner picks: the instance keeps the old key (-2)
    renderer.syncLights(() => undefined);
    expect(seg.a.array[0]).toBe(-2);
    expect(renderer.uniforms.lightListCfg.value.x).toBe(0);
    renderer.dispose();
    cache.dispose();
  });
  it('grows iLights in step with the batch, per-owner values intact', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owners = Array.from({ length: 40 }, (_, i) => ({ id: i, bodyLights: [i + 0.5, -1, -1, -1] }));
    renderer.update(owners.map(() => [headSrc]), owners);
    renderer.syncLights(lightsOf);
    const { m, a } = iLights(renderer, false);
    expect(m.count).toBe(40);
    expect(a.count).toBeGreaterThanOrEqual(m.instanceMatrix.count);
    for (let i = 0; i < 40; i++) expect(a.array[i * 4]).toBeCloseTo(i + 0.5, 5);
    renderer.dispose();
    cache.dispose();
  });
  const iFill = (r: ReturnType<typeof createSegmentMeshRenderer>, eye: boolean) => {
    const m = r.object.children.find(c => (c as THREE.InstancedMesh).isInstancedMesh && c.name === (eye ? 'skeleton-fleshy-eyes' : 'skeleton-segments')) as THREE.InstancedMesh;
    return { m, a: m.geometry.getAttribute('iFill') as THREE.InstancedBufferAttribute };
  };
  it('Task 11b: writes the owner\'s room fill into iFill, segment and eyes; no picks or no fillOf = 1', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const actor = { id: 1, bodyLights: [0.9, -1, -1, -1], fill: 0.3 };
    const fillOf = (o: unknown) => (o as { fill: number }).fill;
    renderer.update([[headSrc]], [actor]);
    renderer.syncLights(lightsOf, fillOf);
    const seg = iFill(renderer, false);
    expect(seg.a.isInstancedBufferAttribute).toBe(true);
    expect(seg.a.itemSize).toBe(1);
    expect(seg.a.array[0]).toBeCloseTo(0.3, 6);
    const eye = iFill(renderer, true);
    expect(eye.m.count).toBeGreaterThan(0);
    for (let i = 0; i < eye.m.count; i++) expect(eye.a.array[i]).toBeCloseTo(0.3, 6);
    expect(renderer.ownerFill(actor).every(f => Math.abs(f - 0.3) < 1e-6)).toBe(true);
    // M3: only the live instances upload
    expect(seg.a.updateRanges).toEqual([{ start: 0, count: 1 }]);
    expect(eye.a.updateRanges).toEqual([{ start: 0, count: eye.m.count }]);
    // the owner's room lights up again: the next sync follows
    actor.fill = 1;
    renderer.syncLights(lightsOf, fillOf);
    expect(seg.a.array[0]).toBeCloseTo(1, 6);
    // no fillOf, or no owner picks (the old key): 1
    actor.fill = 0.25;
    renderer.syncLights(lightsOf);
    expect(seg.a.array[0]).toBe(1);
    renderer.syncLights(() => undefined, fillOf);
    expect(seg.a.array[0]).toBe(1);
    renderer.dispose();
    cache.dispose();
  });
  it('Task 11b: grows iFill in step with the batch, per-owner values intact', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owners = Array.from({ length: 40 }, (_, i) => ({ id: i, bodyLights: [i + 0.5, -1, -1, -1], fill: 0.25 + i / 80 }));
    renderer.update(owners.map(() => [headSrc]), owners);
    renderer.syncLights(lightsOf, o => (o as { fill: number }).fill);
    const { m, a } = iFill(renderer, false);
    expect(m.count).toBe(40);
    expect(a.count).toBeGreaterThanOrEqual(m.instanceMatrix.count);
    for (let i = 0; i < 40; i++) expect(a.array[i]).toBeCloseTo(0.25 + i / 80, 5);
    renderer.dispose();
    cache.dispose();
  });
});

describe('the head split: the skull is drawn once per piece that owns part of it (head-split.ts skullSplitOf)', () => {
  type R = ReturnType<typeof createSegmentMeshRenderer>;
  const segs = (r: R, owner: unknown) => r.drawn.filter(d => d.owner === owner && !d.eye);
  const eyes = (r: R, owner: unknown) => r.drawn.filter(d => d.owner === owner && d.eye);
  const batch = (r: R, name: string) => r.object.children.find(c => c.name === name) as THREE.InstancedMesh | undefined;
  /** A split batch's records: the interleaved instance buffer behind its four iSplit* attributes. */
  const rowsOf = (m: THREE.InstancedMesh) => (m.geometry.getAttribute('iSplitN') as unknown as THREE.InterleavedBufferAttribute).data as THREE.InstancedInterleavedBuffer;
  /** The posed zombie's split, as the leaf makes it (game-head-split.ts skullOf). */
  const warpOf = (preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, frac: number): SplitWarp => {
    bodyYaw = 0;
    const posed = applyRig(body, bound, 0);
    return splitWarpOf(forcedSplit(preset, sides, offset, frac)!, headFrameOf(headShape(posed)!, headQuatOf(bound, 0) ?? [0, 0, 0, 1]))!;
  };
  const headOnly = (w: SplitWarp | null) => ({
    warp: (_o: object, segment: string) => (segment === 'head' ? w : null),
    seed: (o: object) => (o as { id: number }).id,
  });
  const at = (m: THREE.Matrix4, p: Vec3): Vec3 => new THREE.Vector3(...p).applyMatrix4(m).toArray() as Vec3;
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const make = () => { const cache = new SegmentMeshCache(); return { cache, renderer: createSegmentMeshRenderer(cache) }; };
  const LOCAL: Vec3[] = [[0.03, 0.15, 0.05], [-0.04, 0.12, -0.03], [0.06, 0.02, 0.08], [0, -0.05, 0]];

  it('a closed head draws exactly as without the split hook: the same instances, matrices and batches', () => {
    const plain = make(), hooked = make();
    const owners = [{ id: 1 }, { id: 2 }];
    plain.renderer.update([[headSrc], [headSrc]], owners);
    hooked.renderer.update([[headSrc], [headSrc]], owners, undefined, undefined, undefined, headOnly(null));
    expect(hooked.renderer.drawn).toHaveLength(plain.renderer.drawn.length);
    plain.renderer.drawn.forEach((d, i) => {
      const e = hooked.renderer.drawn[i]!;
      expect(e.owner).toBe(d.owner);
      expect(e.eye).toBe(d.eye);
      expect(e.piece).toBeNull();
      expect(e.matrix.elements).toEqual(d.matrix.elements);
    });
    expect(hooked.renderer.object.children.map(c => c.name).sort()).toEqual(plain.renderer.object.children.map(c => c.name).sort());
    expect(hooked.renderer.draws).toBe(2);
    for (const r of [plain, hooked]) { r.renderer.dispose(); r.cache.dispose(); }
  });

  it('a centred split: the rest and two turned copies of the skull, each eye with its own half; a closed neighbour is untouched', () => {
    const { cache, renderer } = make();
    const open = { id: 1 }, shut = { id: 2 };
    const w = warpOf('middle', 0, 0, 0.8), s = skullSplitOf(w)!;
    renderer.update([[headSrc], [headSrc]], [open, shut], undefined, undefined, undefined, { warp: (o, seg) => (o === open && seg === 'head' ? w : null) });
    const closedM = segs(renderer, shut)[0]!.matrix;
    expect(segs(renderer, shut).map(d => d.piece)).toEqual([null]);
    expect(eyes(renderer, shut).map(d => d.piece)).toEqual([null, null]);
    const head = segs(renderer, open);
    expect(head.map(d => d.piece)).toEqual([0, 1, 2]);
    expect(head[0]!.matrix.elements).toEqual(closedM.elements);
    // A copy puts a skull point where the rule turns it: about the hinge, by the piece's BONE angle.
    for (const l of LOCAL) {
      const q = at(closedM, l);
      for (const [d, angle] of [[head[1]!, s.angleP], [head[2]!, s.angleM]] as const) {
        const want = new THREE.Vector3(...q).sub(new THREE.Vector3(...w.h)).applyAxisAngle(new THREE.Vector3(...w.a), angle).add(new THREE.Vector3(...w.h));
        expect(dist(at(d.matrix, l), want.toArray() as Vec3)).toBeLessThan(1e-9);
      }
    }
    // The rule's own forward map agrees, on a point each half owns (the eye seats).
    for (const e of meshEyePlacements(meshBoneSource(headSrc))) {
      const q = headSrc.toWorld(e.center), moved = skullWarpPoint(s, q);
      expect(moved.piece).not.toBe(0);
      expect(dist(at(head[moved.piece]!.matrix, e.center as Vec3), moved.p)).toBeLessThan(1e-9);
    }
    expect(s.angleP).toBeCloseTo(w.thetaP * skullFollow(0.8), 12);
    // The bone lags its flesh: the copy's turn is the BONE angle, not the flesh's.
    const turn = new THREE.Quaternion().setFromRotationMatrix(head[1]!.matrix.clone().multiply(closedM.clone().invert()));
    expect(2 * Math.acos(Math.min(1, Math.abs(turn.w)))).toBeCloseTo(s.angleP, 9);
    // The eyes sit a socket's width off the plane: one copy each, on its own half.
    expect(eyes(renderer, open).map(d => d.piece).sort()).toEqual([1, 2]);
    // The clip data of the split batch's rows is the rule's record.
    const sb = batch(renderer, 'skeleton-segments-split')!;
    expect(sb.count).toBe(3);
    const rows = rowsOf(sb), want = new Float32Array(3 * SPLIT_INSTANCE_FLOATS);
    ([0, 1, 2] as const).forEach(piece => packSplitInstance(want, piece, s, piece));
    expect(Array.from(rows.array.slice(0, want.length))).toEqual(Array.from(want));
    // One interleaved INSTANCE buffer read as four vec4s (the pipeline's vertex buffer budget); only live rows upload.
    expect((rows as unknown as { isInstancedInterleavedBuffer: boolean }).isInstancedInterleavedBuffer).toBe(true);
    expect(rows.stride).toBe(16);
    expect(rows.updateRanges).toEqual([{ start: 0, count: 48 }]);
    SPLIT_INSTANCE_ATTRS.forEach((name, k) => {
      const a = sb.geometry.getAttribute(name) as unknown as THREE.InterleavedBufferAttribute;
      expect([a.data === rows, a.itemSize, a.offset], name).toEqual([true, 4, k * 4]);
    });
    // The closed neighbour is in the closed batch, alone; the split head is not there.
    expect(batch(renderer, 'skeleton-segments')!.count).toBe(1);
    expect(batch(renderer, 'skeleton-fleshy-eyes')!.count).toBe(2);
    expect(batch(renderer, 'skeleton-fleshy-eyes-split')!.count).toBe(2);
    renderer.dispose(); cache.dispose();
  });

  it('a one-sided split: the rest and ONE turned copy; an eye off the turning half stays a closed instance', () => {
    const { cache, renderer } = make();
    const owner = { id: 1 };
    const w = warpOf('middle', 1, 0.04, 1), s = skullSplitOf(w)!;
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
    expect(segs(renderer, owner).map(d => d.piece)).toEqual([0, 1]);
    expect(s.angleM).toBe(0);
    // The plane (4 cm off centre) passes through the + eye's socket: that eye is drawn for both pieces, clipped; the
    // other eye is the rest's alone and stays in the closed batch.
    const seats = meshEyePlacements(meshBoneSource(headSrc)).map(e => headSrc.toWorld(e.center));
    const side = seats.map(c => c[0] * w.n[0] + c[1] * w.n[1] + c[2] * w.n[2] - w.d0);
    expect(Math.min(...side.map(Math.abs))).toBeLessThan(0.0191);
    expect(eyes(renderer, owner).map(d => d.piece).sort()).toEqual([0, 1, null].sort());
    expect(batch(renderer, 'skeleton-fleshy-eyes')!.count).toBe(1);
    // The face preset is one-sided too.
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('face', 1, 0, 1)));
    expect(segs(renderer, owner).map(d => d.piece)).toEqual([0, 1]);
    // Both eyes sit in front of the face's plane, clear of it: one copy each, on the face piece.
    expect(eyes(renderer, owner).map(d => d.piece)).toEqual([1, 1]);
    expect(batch(renderer, 'skeleton-fleshy-eyes')!.count).toBe(0);
    renderer.dispose(); cache.dispose();
  });

  it('only the segment the hook answers for splits; the others draw as ever', () => {
    const { cache, renderer } = make();
    const owner = { id: 1 };
    const spine = sources.find(x => x.segment.startsWith('axial:'))!;
    const asked: string[] = [];
    renderer.update([[headSrc, spine]], [owner], undefined, undefined, undefined, { warp: (_o, seg) => { asked.push(seg); return seg === 'head' ? warpOf('middle', 0, 0, 1) : null; } });
    expect(asked.sort()).toEqual(['head', spine.segment].sort());
    expect(segs(renderer, owner).map(d => d.piece)).toEqual([0, 1, 2, null]);
    renderer.dispose(); cache.dispose();
  });

  it('lifecycle: a split that closes (the range cut-off, a tear, the owner gone) is the closed draw again, with nothing left over', () => {
    const { cache, renderer } = make();
    const owner = { id: 1 };
    renderer.update([[headSrc]], [owner]);
    const before = renderer.drawn.map(d => ({ eye: d.eye, m: d.matrix.elements.slice() }));
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('middle', 0, 0, 1)));
    expect(batch(renderer, 'skeleton-segments')!.visible).toBe(false);
    expect(batch(renderer, 'skeleton-segments-split')!.visible).toBe(true);
    // view.splitDrawn went null: the hook answers null.
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(null));
    expect(renderer.drawn.map(d => ({ eye: d.eye, m: d.matrix.elements.slice() }))).toEqual(before);
    expect(renderer.drawn.every(d => d.piece === null)).toBe(true);
    expect(batch(renderer, 'skeleton-segments-split')!.count).toBe(0);
    expect(batch(renderer, 'skeleton-segments-split')!.visible).toBe(false);
    expect(batch(renderer, 'skeleton-fleshy-eyes-split')!.visible).toBe(false);
    expect(batch(renderer, 'skeleton-segments')!.count).toBe(1);
    // The owner leaves while split: nothing is drawn for it.
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('middle', 0, 0, 1)));
    renderer.update([], []);
    expect(renderer.drawn).toHaveLength(0);
    expect(batch(renderer, 'skeleton-segments-split')!.count).toBe(0);
    // A split segment batch nobody draws is dropped like any stale batch, and its twin geometry (the renderer's own:
    // three holds a rendered geometry until it is disposed) with it. The skull's own geometry is the cache's.
    const disposed: string[] = [];
    const watch = (name: string) => batch(renderer, name)!.geometry.addEventListener('dispose', () => { disposed.push(name); });
    const base = batch(renderer, 'skeleton-segments')!.geometry, twin = batch(renderer, 'skeleton-segments-split')!.geometry;
    watch('skeleton-segments'); watch('skeleton-segments-split'); watch('skeleton-fleshy-eyes'); watch('skeleton-fleshy-eyes-split');
    for (let i = 0; i < 130; i++) renderer.update([[headSrc]], [owner]);
    expect(batch(renderer, 'skeleton-segments-split')).toBeUndefined();
    expect(disposed).toEqual(['skeleton-segments-split']);
    // The next split makes a NEW twin, on the same shared vertex data.
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('middle', 0, 0, 1)));
    const twin2 = batch(renderer, 'skeleton-segments-split')!.geometry;
    expect(twin2).not.toBe(twin);
    expect(twin2.getAttribute('position')).toBe(base.getAttribute('position'));
    expect(segs(renderer, owner).map(d => d.piece)).toEqual([0, 1, 2]);
    twin2.addEventListener('dispose', () => { disposed.push('twin2'); });
    // clear() (a cast rebuild) disposes every twin it holds, and no geometry that is not its own.
    renderer.clear();
    expect(renderer.object.children).toHaveLength(0);
    expect(disposed.sort()).toEqual(['skeleton-fleshy-eyes-split', 'skeleton-segments-split', 'twin2']);
    // And the renderer draws again after it: closed, then split.
    renderer.update([[headSrc]], [owner]);
    expect(renderer.drawn.map(d => d.piece)).toEqual([null, null, null]);
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('middle', 0, 0, 1)));
    expect(segs(renderer, owner).map(d => d.piece)).toEqual([0, 1, 2]);
    renderer.dispose(); cache.dispose();
  });

  it('capacity: forty split heads grow the split batch, every copy with its own record and its owner\'s lights', () => {
    const { cache, renderer } = make();
    const owners = Array.from({ length: 40 }, (_, i) => ({ id: i, bodyLights: [i + 0.5, -1, -1, -1], fill: 0.5 }));
    const w = warpOf('middle', 0, 0, 1);
    renderer.update(owners.map(() => [headSrc]), owners, undefined, undefined, undefined, headOnly(w));
    renderer.syncLights(o => new THREE.Vector4(...(o as { bodyLights: number[] }).bodyLights), o => (o as { fill: number }).fill);
    const sb = batch(renderer, 'skeleton-segments-split')!;
    expect(sb.count).toBe(120);
    for (const name of [...SPLIT_INSTANCE_ATTRS, 'iLights', 'iFill']) {
      expect((sb.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).count, name).toBeGreaterThanOrEqual(sb.instanceMatrix.count);
    }
    const K = 12;   // the K lane's offset in a row: (piece, + turns, - turns, seed)
    const l = (sb.geometry.getAttribute('iLights') as THREE.InstancedBufferAttribute).array;
    for (let i = 0; i < 120; i++) {
      expect(rowsOf(sb).array[i * 16 + K]).toBe(i % 3);
      expect(l[i * 4]).toBeCloseTo(Math.floor(i / 3) + 0.5, 5);
    }
    expect(renderer.ownerLights(owners[7]!)).toHaveLength(5);   // three skull copies, two eyes
    expect(renderer.ownerFill(owners[7]!)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    // Each head breaks along its own pattern: the seed the hook answers for its owner (the actor id), whatever
    // order heads split in. No seed hook: 0.
    expect(owners.map((_, i) => rowsOf(sb).array[i * 48 + K + 3])).toEqual(owners.map(o => o.id));
    renderer.update([[headSrc]], [owners[7]!], undefined, undefined, undefined, headOnly(w));
    expect(rowsOf(sb).array[K + 3]).toBe(7);
    renderer.update([[headSrc]], [owners[7]!], undefined, undefined, undefined, { warp: headOnly(w).warp });
    expect(rowsOf(sb).array[K + 3]).toBe(0);
    // The stats count what is drawn: three copies of the skull.
    const one = renderer.stats.tris;
    renderer.update([[headSrc]], [owners[7]!]);
    expect(one).toBe(3 * renderer.stats.tris);
    expect(renderer.stats.tris).toBeGreaterThan(0);
    renderer.dispose(); cache.dispose();
  });

  it('the split copies have their own two-sided material; the closed skull keeps its front-faced one', () => {
    const { cache, renderer } = make();
    const a = { id: 1 }, b = { id: 2 };
    renderer.update([[headSrc], [headSrc]], [a, b], undefined, undefined, undefined, { warp: (o, seg) => (o === a && seg === 'head' ? warpOf('middle', 0, 0, 1) : null) });
    const mat = (name: string) => batch(renderer, name)!.material as THREE.Material;
    expect(mat('skeleton-segments').side).toBe(THREE.FrontSide);
    expect(mat('skeleton-fleshy-eyes').side).toBe(THREE.FrontSide);
    expect(mat('skeleton-segments-split').side).toBe(THREE.DoubleSide);
    expect(mat('skeleton-fleshy-eyes-split').side).toBe(THREE.DoubleSide);
    expect(mat('skeleton-segments-split')).not.toBe(mat('skeleton-segments'));
    // The copies share the skull's vertex data and carry their own instance data.
    const base = batch(renderer, 'skeleton-segments')!.geometry, split = batch(renderer, 'skeleton-segments-split')!.geometry;
    expect(split).not.toBe(base);
    for (const name of ['position', 'normal', 'meshFeature']) expect(split.getAttribute(name), name).toBe(base.getAttribute(name));
    expect(split.index).toBe(base.index);
    expect(split.getAttribute('iLights')).not.toBe(base.getAttribute('iLights'));
    expect(base.getAttribute('iSplitN')).toBeUndefined();
    renderer.dispose(); cache.dispose();
  });

  it('diagnostics: show.bones / show.eyes hide a kind of batch, closed and split alike, from the next update', () => {
    const { cache, renderer } = make();
    const a = { id: 1 }, b = { id: 2 };
    const upd = () => renderer.update([[headSrc], [headSrc]], [a, b], undefined, undefined, undefined, { warp: (o, seg) => (o === a && seg === 'head' ? warpOf('middle', 0, 0, 1) : null) });
    const vis = () => ['skeleton-segments', 'skeleton-segments-split', 'skeleton-fleshy-eyes', 'skeleton-fleshy-eyes-split'].map(n => batch(renderer, n)!.visible);
    upd();
    expect(vis()).toEqual([true, true, true, true]);
    renderer.show.bones = false; upd();
    expect(vis()).toEqual([false, false, true, true]);
    renderer.show.bones = true; renderer.show.eyes = false; upd();
    expect(vis()).toEqual([true, true, false, false]);
    expect(renderer.drawn).toHaveLength(8);   // still posed: only the draw is off
    renderer.dispose(); cache.dispose();
  });

  it('the look seam: a follow set by hand (1 rides the flesh, 0 is the whole closed skull), and the fracture\'s shape', () => {
    const { cache, renderer } = make();
    const owner = { id: 1 };
    const w = warpOf('middle', 0, 0, 0.8);
    const j = HEAD_SPLIT.skull.jag;
    expect(renderer.splitLook.follow).toBeNull();
    expect(renderer.splitLook.jag.value.toArray()).toEqual([j.zigAmp, j.zigLen, j.chipAmp, j.chipLen]);
    expect(renderer.splitLook.inside.value.toArray().map(v => +v.toFixed(6))).toEqual([...HEAD_SPLIT.skull.inside]);
    expect(renderer.splitLook.jagShape.value.toArray()).toEqual([j.wobble, j.wobbleAlong, j.wobbleUp, j.upFreq]);
    expect(renderer.splitLook.rim.value.toArray()).toEqual([...HEAD_SPLIT.skull.rim.color, HEAD_SPLIT.skull.rim.width]);
    const angleOf = () => { const h = segs(renderer, owner); const t = new THREE.Quaternion().setFromRotationMatrix(h[1]!.matrix.clone().multiply(h[0]!.matrix.clone().invert())); return 2 * Math.acos(Math.min(1, Math.abs(t.w))); };
    renderer.splitLook.follow = 1;
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
    expect(angleOf()).toBeCloseTo(w.thetaP, 9);
    renderer.splitLook.follow = 0;
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
    expect(renderer.drawn.map(d => d.piece)).toEqual([null, null, null]);
    renderer.splitLook.follow = [[0.5, 0.6], [1, 0.6]];   // another table
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
    expect(angleOf()).toBeCloseTo(w.thetaP * 0.6, 9);
    renderer.splitLook.follow = null;
    renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
    expect(angleOf()).toBeCloseTo(w.thetaP * skullFollow(0.8), 9);
    renderer.dispose(); cache.dispose();
  });
});

describe('organs as mesh (2026-10-06): organ sources draw on their own batch, only where a wound reaches them', () => {
  const all = createSkeletonSources(body, bound, { character: 'zombie', organs: true, bodyYaw: () => bodyYaw });
  const organSrc = all.filter(s => s.kind === 'organ');
  const organsOf = (r: ReturnType<typeof createSegmentMeshRenderer>, owner: unknown) => r.drawn.filter(d => d.owner === owner && d.organ);
  const belly = [{ pos: [0, 1.03, 0.12] as const, radius: 0.08 }];
  const headShot = [{ pos: [0, 1.62, 0.1] as const, radius: 0.1 }];
  const organMeshes = (r: ReturnType<typeof createSegmentMeshRenderer>) => r.object.children.filter(c => c.name === 'skeleton-organs') as THREE.InstancedMesh[];

  it('organNeeded: exposed owner AND a reaching sphere; no reach list = no reach test', async () => {
    const { organNeeded } = await import('./mesh-renderer');
    const a = {}, b = {};
    expect(organNeeded(a, undefined, undefined, [0, 0, 0], 0.1)).toBe(true);
    expect(organNeeded(b, new Set([a]), undefined, [0, 0, 0], 0.1)).toBe(false);
    expect(organNeeded(a, new Set([a]), null, [0, 0, 0], 0.1)).toBe(false);
    expect(organNeeded(a, new Set([a]), [], [0, 0, 0], 0.1)).toBe(false);
    expect(organNeeded(a, new Set([a]), [{ pos: [0.1, 0, 0], radius: 0.05 }], [0, 0, 0], 0.1)).toBe(true);
    expect(organNeeded(a, new Set([a]), [{ pos: [1, 0, 0], radius: 0.05 }], [0, 0, 0], 0.1)).toBe(false);
  });

  it('a belly wound draws every organ segment once, on the organ material; a head wound and no wound draw none', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const gut = { id: 1 }, head = { id: 2 }, clean = { id: 3 };
    bodyYaw = 0;
    const reach = (o: object) => (o === gut ? belly : o === head ? headShot : null);
    renderer.update([all, all, all], [gut, head, clean], undefined, new Set([gut, head]), undefined, undefined, reach);
    expect(organSrc.length).toBeGreaterThan(0);
    expect(organsOf(renderer, gut)).toHaveLength(organSrc.length);
    expect(organsOf(renderer, head)).toHaveLength(0);
    expect(organsOf(renderer, clean)).toHaveLength(0);
    expect(renderer.stats.organs).toBe(organSrc.length);
    // Their own batches: not the bone material, never a split copy, no eye.
    const meshes = organMeshes(renderer);
    expect(meshes).toHaveLength(organSrc.length);
    const boneMesh = renderer.object.children.find(c => c.name === 'skeleton-segments') as THREE.InstancedMesh;
    for (const m of meshes) {
      expect(m.count).toBe(1);
      expect(m.visible).toBe(true);
      expect(m.material).not.toBe(boneMesh.material);
      expect((m.material as THREE.Material).depthWrite).toBe(true);
      expect(m.geometry.getAttribute('meshFeature')).toBeUndefined();
    }
    for (const d of organsOf(renderer, gut)) { expect(d.eye).toBe(false); expect(d.piece).toBeNull(); }
    // The bones of the exposed owners still draw (the organ branch took nothing from them).
    expect(renderer.drawn.filter(d => d.owner === head && !d.eye && !d.organ).length).toBeGreaterThan(3);
    renderer.dispose();
    cache.dispose();
  });

  it('the organ instance sits at its segment pose and follows the body yaw', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owner = { id: 1 };
    bodyYaw = 0;
    renderer.update([all], [owner], undefined, new Set([owner]), undefined, undefined, () => belly);
    const m0 = organsOf(renderer, owner).map(d => d.matrix.clone());
    organSrc.forEach((s, k) => {
      const p = s.pose();
      expect(new THREE.Vector3().setFromMatrixPosition(m0[k]!).distanceTo(new THREE.Vector3(...p.origin))).toBeLessThan(1e-9);
    });
    bodyYaw = 1.2;
    renderer.update([all], [owner], undefined, new Set([owner]), undefined, undefined, () => belly);
    const q = new THREE.Quaternion(); organsOf(renderer, owner)[0]!.matrix.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const q0 = new THREE.Quaternion(); m0[0]!.decompose(new THREE.Vector3(), q0, new THREE.Vector3());
    expect(q.angleTo(q0)).toBeCloseTo(1.2, 3);
    bodyYaw = 0;
    renderer.dispose();
    cache.dispose();
  });

  it('show.organs hides the organ batches and leaves the bones; a hidden (not shown) owner draws no organ', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owner = { id: 1 };
    renderer.show.organs = false;
    renderer.update([all], [owner], undefined, new Set([owner]), undefined, undefined, () => belly);
    for (const m of organMeshes(renderer)) expect(m.visible).toBe(false);
    expect((renderer.object.children.find(c => c.name === 'skeleton-segments') as THREE.InstancedMesh).visible).toBe(true);
    renderer.show.organs = true;
    renderer.update([all], [owner], new Set<unknown>(), new Set([owner]), undefined, undefined, () => belly);
    expect(organsOf(renderer, owner)).toHaveLength(0);
    renderer.dispose();
    cache.dispose();
  });

  it('a dead torso draws no organ; the bone-only source list draws none either', () => {
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const owner = { id: 1 };
    const torso = body.bonePrims.find(b => b.op === 'organ')!.cluster;
    const severed = { ...body, clusters: body.clusters.map((c, i) => (i === torso ? { ...c, alive: false } : c)) };
    const sev = createSkeletonSources(severed, bound, { character: 'zombie', organs: true });
    renderer.update([sev], [owner], undefined, new Set([owner]), undefined, undefined, () => belly);
    expect(organsOf(renderer, owner)).toHaveLength(0);
    renderer.update([sources], [owner], undefined, new Set([owner]), undefined, undefined, () => belly);
    expect(organsOf(renderer, owner)).toHaveLength(0);
    expect(renderer.stats.organs).toBe(0);
    renderer.dispose();
    cache.dispose();
  });

  it('setOrganLook takes a name or numbers and answers the values in force', async () => {
    const { ORGAN_LOOKS } = await import('./mesh-organ');
    const cache = new SegmentMeshCache();
    const renderer = createSegmentMeshRenderer(cache);
    const close = (v: readonly number[]) => v.map(x => expect.closeTo(x, 6));
    expect(renderer.setOrganLook('bloody')).toEqual({ cfg: close(ORGAN_LOOKS.bloody.cfg), gloss: close(ORGAN_LOOKS.bloody.gloss), occ: close(ORGAN_LOOKS.bloody.occ) });
    expect(renderer.organLook.cfg.value.x).toBe(ORGAN_LOOKS.bloody.cfg[0]);
    expect(renderer.setOrganLook({ cfg: [0.1, 0.2, 0.3, 0] }).cfg).toEqual([0.1, 0.2, 0.3, 0]);
    expect(renderer.setOrganLook({ occ: [0.5, 0.25, 0.125, 0] }).occ).toEqual([0.5, 0.25, 0.125, 0]);
    expect(renderer.setOrganLook().gloss).toEqual(close(ORGAN_LOOKS.bloody.gloss));
    renderer.dispose();
    cache.dispose();
  });
});
