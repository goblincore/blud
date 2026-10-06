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
import type { MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { getCurrentStack, setCurrentStack, stack } from 'three/tsl';
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
  HEAD_SPLIT, forcedSplit, headFrameOf, rotAxis, skullFollow, skullSplitOf, skullWarpPoint, splitWarpOf,
  type SkullSplit, type SplitPresetId, type SplitWarp,
} from '../../head-split';
import { headShape } from '../flame-anchors';
import { meshBoneSource } from './mesh-skull';
import { meshEyePlacements } from './mesh-eyes';
import { SPLIT_INSTANCE_ATTRS, SPLIT_INSTANCE_FLOATS, packSplitInstance, skullJagAt } from './mesh-split';
import { AnatomicalSkullKit, SKULL_PIECES } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { skullSplitRayHit } from './skull-split-hit';
import { intactSkull } from '../../skull-fracture';
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

  describe('on the anatomical skull (anatomical-skull.ts): a split plate keeps its own surface and normal map', () => {
    /** A renderer on the real asset's kit, as the game's default cache has it. */
    type Fragment = { name: string; pos: Vec3; vel: Vec3; angular: Vec3; radius: number; supports: number; matrix: THREE.Matrix4 };
    const makeAnatomical = () => {
      const normalMap = new THREE.Texture();
      const kit = new AnatomicalSkullKit(anatomicalSkullSource(), normalMap, new THREE.Vector2(1, 1));
      const cache = new SegmentMeshCache(undefined, kit);
      // Every fragment the renderer hands the gib pool: where, how fast, and the fragment mesh's own matrix.
      const fragments: Fragment[] = [];
      const renderer = createSegmentMeshRenderer(cache, 0, undefined, (object, pos, vel, angular, radius, support) => {
        fragments.push({ name: object.name.replace('skull-fragment:', ''), pos, vel, angular, radius, supports: support.length, matrix: (object.children[0] as THREE.Mesh).matrix.clone() });
      });
      return { cache, kit, normalMap, renderer, fragments };
    };
    // The same head under a name the kit does not fit: it keeps the extracted bone, in the same renderer.
    const otherHead = createSkeletonSources(body, bound, { character: 'ghoul' }).find(s => s.segment === 'head')!;
    type Drawn = R['drawn'][number];
    const matOf = (r: R, d: Drawn) => (r.object.children.find(c => (c as THREE.InstancedMesh).geometry === d.geometry) as THREE.InstancedMesh).material as MeshBasicNodeMaterial;
    type Graph = Node & { functionNode?: { code: string }; isTextureNode?: boolean; isVarNode?: boolean; intent?: boolean; value?: unknown; node?: Node; ifNode?: unknown };
    /** Every node `roots` reach, not looking behind a node of `stop`. */
    const reach = (roots: readonly Node[], stop: ReadonlySet<Node> = new Set()): Graph[] => {
      const seen = new Set<Node>(), todo = [...roots];
      while (todo.length) {
        const n = todo.pop()!;
        if (seen.has(n) || stop.has(n)) continue;
        seen.add(n);
        for (const c of n.getChildren()) todo.push(c as Node);
      }
      return [...seen] as Graph[];
    };
    /** The WGSL functions a graph calls, by name. */
    const calls = (nodes: readonly Graph[]) => new Set(nodes.flatMap(n => (n.functionNode ? [/\bfn (\w+)/.exec(n.functionNode.code)![1]!] : [])));
    const samples = (nodes: readonly Graph[], map: THREE.Texture) => nodes.some(n => n.isTextureNode === true && n.value === map);
    /** A split material's colour as three builds it: the function's body run on a stack of its own. `held` are the
     *  values declared ahead of the branch on the clip (real variables: an intent is written where it is first read),
     *  `branch` what the branch stacks. */
    const colourOf = (m: MeshBasicNodeMaterial) => {
      const body = (m.colorNode as unknown as { node: { shaderNode: { jsFunc(): unknown } } }).node.shaderNode;
      const was = getCurrentStack(), outer = stack();
      try {
        setCurrentStack(outer); body.jsFunc();
        const nodes = outer.nodes as Graph[], at = nodes.findIndex(n => n.ifNode !== undefined);
        expect(at).toBeGreaterThan(0);
        const inner = stack();
        setCurrentStack(inner); (nodes[at]!.ifNode as { jsFunc(): unknown }).jsFunc();
        return { held: nodes.slice(0, at).filter(n => n.isVarNode === true && n.intent !== true), branch: inner.nodes as Graph[], rest: nodes.slice(at + 1) };
      } finally { setCurrentStack(was); }
    };
    const allCalls = (m: MeshBasicNodeMaterial) => { const c = colourOf(m); return calls(reach([...c.held, ...c.branch])); };

    it('the split copies are on the plates\' split material; a head the kit does not fit and every closed head keep theirs', () => {
      const { cache, renderer } = makeAnatomical();
      const open = { id: 1 }, shut = { id: 2 }, otherOpen = { id: 3 }, otherShut = { id: 4 };
      const w = warpOf('middle', 0, 0, 1);
      renderer.update([[headSrc], [headSrc], [otherHead], [otherHead]], [open, shut, otherOpen, otherShut], undefined, undefined, undefined,
        { warp: (o, seg) => ((o === open || o === otherOpen) && seg === 'head' ? w : null) });
      expect(segs(renderer, open).map(d => d.piece)).toEqual([0, 1, 2]);
      expect(segs(renderer, shut).map(d => d.piece)).toEqual([null]);
      expect(segs(renderer, otherOpen).map(d => d.piece)).toEqual([0, 1, 2]);
      expect(segs(renderer, otherShut).map(d => d.piece)).toEqual([null]);
      const mats = [open, shut, otherOpen, otherShut].map(o => { const m = new Set(segs(renderer, o).map(d => matOf(renderer, d))); expect(m.size).toBe(1); return [...m][0]!; });
      const [plateSplit, plate, boneSplit, bone] = mats as [MeshBasicNodeMaterial, MeshBasicNodeMaterial, MeshBasicNodeMaterial, MeshBasicNodeMaterial];
      expect(new Set(mats).size).toBe(4);
      // Sidedness: the closed plates are two-sided already (they have thickness); so are their split copies. The clip
      // is the split materials' alone.
      expect(mats.map(m => m.side)).toEqual([THREE.DoubleSide, THREE.DoubleSide, THREE.DoubleSide, THREE.FrontSide]);
      expect(mats.map(m => m.maskNode != null)).toEqual([true, false, true, false]);
      // What each one paints with. The plates: their own surface and normal map, the cut-bone rim, no inner wall.
      // The rim reads the fracture's own distance: the extracted bone and the eyes do not call it.
      expect([...allCalls(plateSplit)].sort()).toEqual(['anatomicalSkullNormal', 'anatomicalSkullSurface', 'boneShade', 'meshSplitClip', 'meshSplitCutBone', 'meshSplitFracture']);
      expect([...calls(reach([plate.colorNode!]))].sort()).toEqual(['anatomicalSkullNormal', 'anatomicalSkullSurface', 'boneShade']);
      // The extracted bone: the painted surface, and the dark wall on its back faces.
      expect([...allCalls(boneSplit)].sort()).toEqual(['boneShade', 'meshBoneSurface', 'meshBoneWet', 'meshSplitClip', 'meshSplitInside']);
      expect([...calls(reach([bone.colorNode!]))].sort()).toEqual(['boneShade', 'meshBoneSurface', 'meshBoneWet']);
      // The seated eyes are closed spheres: theirs is the eye split material, wall and all.
      const eyeCopies = eyes(renderer, open);
      expect(eyeCopies.map(d => d.piece).sort()).toEqual([1, 2]);
      const eyeMats = new Set(eyeCopies.map(d => matOf(renderer, d)));
      expect(eyeMats.size).toBe(1);
      expect([...allCalls([...eyeMats][0]!)].sort()).toEqual(['boneShade', 'meshEyeEmission', 'meshEyeSurface', 'meshSplitClip', 'meshSplitInside']);
      renderer.dispose(); cache.dispose();
    });

    it('without the kit (?skull=sculpt) the zombie\'s split skull is the sculpt\'s: its painted surface outside, the wall inside', () => {
      const { cache, renderer } = make();
      const owner = { id: 1 };
      renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('middle', 0, 0, 1)));
      const m = matOf(renderer, segs(renderer, owner)[0]!);
      expect(m).toBe(batch(renderer, 'skeleton-segments-split')!.material);
      expect([...allCalls(m)].sort()).toEqual(['boneShade', 'meshBoneSurface', 'meshBoneWet', 'meshSplitClip', 'meshSplitInside']);
      // Nothing of it needs to be ahead of the branch: no derivative, no sampled texture.
      expect(colourOf(m).held.every(v => calls(reach([v.node!])).size === 0)).toBe(true);
      renderer.dispose(); cache.dispose();
    });

    it('a skull with a plate missing: every surviving plate\'s copies are on the same split material, a plate the rest owns alone on the closed one', () => {
      const { cache, renderer } = makeAnatomical();
      const whole = { id: 1 }, struck = { id: 2 }, shut = { id: 3 };
      let w = warpOf('middle', 0, 0, 1);
      const hook = { warp: (o: object, seg: string) => (o !== shut && seg === 'head' ? w : null) };
      const y = headSrc.bounds.min[1] + (headSrc.bounds.max[1] - headSrc.bounds.min[1]) * 0.75;
      renderer.impact(struck, [headSrc], headSrc.toWorld([0, y, headSrc.bounds.max[2] + 0.03]), [0, 0, -1], 'slug');
      expect(renderer.skullState(struck).pieces).toHaveLength(1);
      renderer.update([[headSrc], [headSrc], [headSrc]], [whole, struck, shut], undefined, undefined, undefined, hook);
      const plateSplit = matOf(renderer, segs(renderer, whole)[1]!), plate = matOf(renderer, segs(renderer, shut)[0]!);
      expect(plateSplit).not.toBe(plate);
      const plates = segs(renderer, struck);
      // Thirteen plates are left, each drawn through one geometry: its own (closed), or its split twin.
      expect(new Set(plates.map(d => d.geometry)).size).toBe(13);
      for (const piece of [0, 1, 2]) expect(plates.filter(d => d.piece === piece).length, `piece ${piece}`).toBeGreaterThan(0);
      for (const d of plates.filter(q => q.piece !== null)) {
        expect(matOf(renderer, d)).toBe(plateSplit);
        expect(d.geometry.userData.anatomicalSkull).toBe(true);
        expect(d.geometry.getAttribute('uv')).toBeDefined();
      }
      // An off-centre split turns one side only: a plate of the far side is the rest's alone, one closed instance on
      // the closed plates' material, as on a closed head.
      w = warpOf('middle', 1, 0.04, 1);
      renderer.update([[headSrc], [headSrc], [headSrc]], [whole, struck, shut], undefined, undefined, undefined, hook);
      const oneSided = segs(renderer, struck), closed = oneSided.filter(d => d.piece === null);
      expect(new Set(oneSided.map(d => d.geometry)).size).toBe(13);
      expect(closed.length).toBeGreaterThan(0);
      expect(oneSided.filter(d => d.piece === 1).length).toBeGreaterThan(0);
      for (const d of oneSided) expect(matOf(renderer, d)).toBe(d.piece === null ? plate : plateSplit);
      renderer.dispose(); cache.dispose();
    });

    it('the twin of a plate geometry shares its uv and says it is anatomical; an extracted bone\'s twin has neither', () => {
      const { cache, renderer } = makeAnatomical();
      const open = { id: 1 }, shut = { id: 2 }, otherOpen = { id: 3 };
      const w = warpOf('middle', 0, 0, 1);
      renderer.update([[headSrc], [headSrc], [otherHead]], [open, shut, otherOpen], undefined, undefined, undefined, { warp: (o, seg) => (o !== shut && seg === 'head' ? w : null) });
      const base = segs(renderer, shut)[0]!.geometry, twin = segs(renderer, open)[0]!.geometry;
      expect(twin).not.toBe(base);
      expect(base.userData.anatomicalSkull).toBe(true);
      expect(twin.userData.anatomicalSkull).toBe(true);
      for (const name of ['position', 'normal', 'uv']) {
        expect(base.getAttribute(name), name).toBeDefined();
        expect(twin.getAttribute(name), name).toBe(base.getAttribute(name));
      }
      expect(twin.index).toBe(base.index);
      expect(twin.getAttribute('iSplitN')).toBeDefined();
      expect(base.getAttribute('iSplitN')).toBeUndefined();
      const otherTwin = segs(renderer, otherOpen)[0]!.geometry;
      expect(otherTwin.userData.anatomicalSkull).toBeUndefined();
      expect(otherTwin.getAttribute('uv')).toBeUndefined();
      renderer.dispose(); cache.dispose();
    });

    it('the normal map and its normal are taken ahead of the branch on the clip (a derivative or a sample inside it does not compile)', () => {
      const { cache, normalMap, renderer } = makeAnatomical();
      const owner = { id: 1 };
      renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(warpOf('middle', 0, 0, 1)));
      const { held, branch, rest } = colourOf(matOf(renderer, segs(renderer, owner)[0]!));
      // Declared before the branch: the atlas sample, and the normal function (it takes dpdx / dpdy).
      const ahead = reach(held.map(v => v.node!));
      expect(samples(ahead, normalMap)).toBe(true);
      expect(calls(ahead).has('anatomicalSkullNormal')).toBe(true);
      // The branch reaches both only through those declared values; everything else of the colour is inside it.
      const inside = reach(branch, new Set<Node>(held));
      expect(samples(inside, normalMap)).toBe(false);
      expect(calls(inside).has('anatomicalSkullNormal')).toBe(false);
      for (const fn of ['anatomicalSkullSurface', 'meshSplitFracture', 'meshSplitCutBone', 'boneShade']) expect(calls(inside).has(fn), fn).toBe(true);
      // And nothing is stacked after the branch.
      expect(rest).toHaveLength(0);
      renderer.dispose(); cache.dispose();
    });

    describe('shots and pops (skull-split-hit.ts): a split skull breaks where it is drawn', () => {
      const plateOf = (id: (typeof SKULL_PIECES)[number]) => SKULL_PIECES.indexOf(id);
      const turnOf = (s: SkullSplit, piece: 0 | 1 | 2) => (piece === 1 ? s.angleP : piece === 2 ? s.angleM : 0);
      /** A world point / direction of the closed head turned with `piece` of `s`. */
      const turned = (s: SkullSplit, piece: 0 | 1 | 2, q: Vec3): Vec3 => { const h = s.frame.w.h, r = rotAxis([q[0] - h[0], q[1] - h[1], q[2] - h[2]], s.frame.w.a, turnOf(s, piece)); return [h[0] + r[0], h[1] + r[1], h[2] + r[2]]; };
      const turnedDir = (s: SkullSplit, piece: 0 | 1 | 2, v: Vec3, back = false): Vec3 => rotAxis(v, s.frame.w.a, (back ? -1 : 1) * turnOf(s, piece));
      const pivotOf = (kit: AnatomicalSkullKit, index: number): Vec3 => headSrc.toWorld(kit.head(headSrc)!.pieces[index]!.pivot) as Vec3;
      /** A shot at plate `index` from outside: 8 cm out from its pivot, away from the middle of the skull, aimed back in. */
      const shotAt = (kit: AnatomicalSkullKit, index: number): { from: Vec3; dir: Vec3 } => {
        const c = headSrc.toWorld(kit.head(headSrc)!.mesh.geometry.boundingSphere!.center.toArray() as Vec3), p = pivotOf(kit, index);
        const l = dist(p, c), out: Vec3 = [(p[0] - c[0]) / l, (p[1] - c[1]) / l, (p[2] - c[2]) / l];
        return { from: [p[0] + out[0] * 0.08, p[1] + out[1] * 0.08, p[2] + out[2] * 0.08], dir: [-out[0], -out[1], -out[2]] };
      };
      // A slug and a pop on a CLOSED head, at the commit before the split hit path (185013b9): the fragments' numbers.
      const SHOT = { at: [0.012, 0.75, 0.03] as const, dir: [0.1, -0.05, -1] as Vec3, pop: [0.3, 1, -0.2] as Vec3 };
      const shotFrom = (): Vec3 => headSrc.toWorld([SHOT.at[0], headSrc.bounds.min[1] + (headSrc.bounds.max[1] - headSrc.bounds.min[1]) * SHOT.at[1], headSrc.bounds.max[2] + SHOT.at[2]]) as Vec3;
      const CLOSED_HIT = {
        name: 'frontal', pos: [-0.0017678514122962952, 1.6761581829266294, 0.15752368401636704],
        vel: [0.18120214504298876, 2.219178579293895, -1.2372771863729517], angular: [-4, -5, -3], radius: 0.0820559321012967, supports: 21,
      };
      // The same on a head the deform has squashed and sheared (update's `extra`): the frame is not a rigid one.
      const DEFORM = [1.04, 0, 0.0306, 0, 0, 0.93, 0, 0, 0.020800000000000003, 0, 1.02, 0, 0.002057998848876153, 0.10240168238186409, 0.000132691200842458, 1];
      const DEFORMED_HIT = {
        name: 'frontal', pos: [0.003495926007628441, 1.6612287925036295, 0.16075275264432057],
        vel: [0.2130932842725212, 2.161517723867944, -1.3155943194326063], angular: [-4, -5, -3], radius: 0.08537510076547648, supports: 20,
      };
      const CLOSED_POP: [string, ...number[]][] = [
        ['parietal-left', 0.034127441700547934, 1.680029430098985, 0.09428518246759995, 1.3534224041452743, 4.49522920009565, -0.8092684409141958],
        ['parietal-right', -0.030553863383829594, 1.68049867511556, 0.09391405787219628, -0.048302747299369904, 4.528400429497599, -0.8254375560948451],
        ['occipital', -0.0004677381366491318, 1.6427766668127521, 0.07854263652016744, 0.6033612503917037, 3.938303872707028, -1.693078282534083],
        ['temporal-left', 0.038460231851786375, 1.6227990394906744, 0.10479984879394397, 1.9821276191478876, 3.200064064246558, -0.6936594838298211],
        ['temporal-right', -0.042321838438510895, 1.629318675629948, 0.10504708699782714, -0.7556483495626023, 3.4258556502724167, -0.6629454054215106],
        ['zygomatic-left', 0.03869788534939289, 1.6152027888672098, 0.15773712452401742, 1.5140844451751596, 3.083700840580665, 0.6255288218086192],
        ['zygomatic-right', -0.047856830060482025, 1.6171956496761783, 0.15552216749539002, -0.40906763073245195, 3.1459148163244706, 0.5075966954459501],
        ['maxilla-left', 0.018792094429954886, 1.5998500461207374, 0.1621944157396756, 1.061078361519395, 2.7198126831587834, 0.7454000455420053],
        ['maxilla-right', -0.028177830507047474, 1.6024326604308232, 0.1618136575435601, -0.015844033605028843, 2.8011493507147462, 0.6957979909491157],
        ['upper-teeth', -0.005672627128660679, 1.5744850618282005, 0.16326006483187303, 0.5128844648394382, 2.358639040202178, 0.5485402470380567],
        ['mandible', -0.003372941166162491, 1.5718738181965097, 0.14409159198304042, 0.547135212637904, 2.1515267088896466, 0.27230006576121213],
        ['cranial-base', -0.004300858825445175, 1.621132238440369, 0.13525700177898034, 0.36841829905357265, 2.9905996813475664, 0.9099539075331177],
        ['nasal-core', -0.004722462967038155, 1.616156349562262, 0.16032654214551076, 0.48650525055925836, 3.044297485245297, 0.9411223018728531],
      ];
      const numbersOf = (f: Fragment) => ({ name: f.name, pos: f.pos, vel: f.vel, angular: f.angular, radius: f.radius, supports: f.supports });

      it('a closed head is shot and popped exactly as before: the same plate, and the fragments\' numbers to the bit, with or without the split hook', () => {
        for (const hook of [undefined, headOnly(null)]) {
          const { cache, renderer, fragments } = makeAnatomical();
          const owner = { id: 1 };
          warpOf('middle', 0, 0, 1);   // the pose the other tests use: yaw 0
          renderer.update([[headSrc]], [owner], undefined, undefined, undefined, hook);
          expect(renderer.fractureSkull(owner, [headSrc], shotFrom(), SHOT.dir, 'slug')).toBe(1);
          expect(renderer.skullState(owner).pieces).toEqual(['frontal']);
          expect(fragments.map(numbersOf)).toEqual([CLOSED_HIT]);
          expect(fragments[0]!.matrix.elements).toEqual(new THREE.Matrix4().elements);
          fragments.length = 0;
          expect(renderer.explodeSkull(owner, [headSrc], SHOT.pop)).toBe(13);
          expect(fragments.map(f => [f.name, ...f.pos, ...f.vel])).toEqual(CLOSED_POP);
          // The deformed head: the ray goes into the squashed frame, the fragment comes out of it.
          renderer.clear(); fragments.length = 0;
          renderer.update([[headSrc]], [owner], undefined, undefined, (_o, seg) => (seg === 'head' ? DEFORM : null), hook);
          expect(renderer.fractureSkull(owner, [headSrc], shotFrom(), SHOT.dir, 'slug')).toBe(1);
          expect(fragments.map(numbersOf)).toEqual([DEFORMED_HIT]);
          renderer.dispose(); cache.dispose();
        }
      });

      it('a slug at a turned plate releases THAT plate, from its turned pivot, turned and launched with its piece', () => {
        for (const [id, piece] of [['parietal-left', 1], ['temporal-right', 2]] as const) {
          const { cache, kit, renderer, fragments } = makeAnatomical();
          const owner = { id: 4 }, w = warpOf('middle', 0, 0, 1), s = skullSplitOf(w, null, owner.id)!;
          renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
          const index = plateOf(id), q = pivotOf(kit, index);
          // The plate's pivot is the half's own, and the half has carried it centimetres from where the closed head has it.
          const moved = skullWarpPoint(s, q, skullJagAt(s, q));
          expect(moved.piece).toBe(piece);
          expect(dist(moved.p, q)).toBeGreaterThan(0.03);
          // The shot: at the plate where its copy is DRAWN (the closed shot, turned with the half).
          const closedShot = shotAt(kit, index);
          const from = turned(s, piece, closedShot.from), dir = turnedDir(s, piece, closedShot.dir);
          expect(renderer.fractureSkull(owner, [headSrc], from, dir, 'slug')).toBe(1);
          expect(renderer.skullState(owner).pieces).toEqual([id]);
          expect(fragments.map(f => f.name)).toEqual([id]);
          const f = fragments[0]!;
          // Its position: the turned pivot (the brief's 1 mm; it is the same arithmetic, so far tighter).
          expect(dist(f.pos, moved.p)).toBeLessThan(1e-9);
          // Where the copy of that piece was drawn: the drawn copy's matrix puts the pivot there too.
          const copy = segs(renderer, owner).find(d => d.piece === piece)!;
          expect(dist(f.pos, at(copy.matrix, kit.head(headSrc)!.pieces[index]!.pivot))).toBeLessThan(1e-9);
          // Its orientation: the copy's (the fragment mesh carries the matrix without its translation).
          expect(f.matrix.elements.map(v => +v.toFixed(12))).toEqual(copy.matrix.clone().setPosition(0, 0, 0).elements.map(v => +v.toFixed(12)));
          // Its launch: the closed head's launch for the un-turned shot, turned with the piece. A second renderer
          // shoots the closed head with the closed shot.
          const shut = makeAnatomical(), other = { id: 4 };
          shut.renderer.update([[headSrc]], [other]);
          expect(shut.renderer.fractureSkull(other, [headSrc], closedShot.from, closedShot.dir, 'slug')).toBe(1);
          const g = shut.fragments[0]!;
          expect(g.name).toBe(id);
          expect(dist(f.pos, turned(s, piece, g.pos))).toBeLessThan(1e-9);
          expect(dist(f.vel, turnedDir(s, piece, g.vel))).toBeLessThan(1e-9);
          expect(f.angular).toEqual(g.angular);
          expect(f.radius).toBeCloseTo(g.radius, 12);
          // (Its support points are the turned fragment's extremes along the world's axes: another set of vertices.)
          expect(f.supports).toBeGreaterThan(8);
          // The closed head's own test of the split head's shot, the frame the hit path used to work in: that ray does
          // not break this plate there. The bone it was aimed at has moved.
          const stale = makeAnatomical();
          stale.renderer.update([[headSrc]], [other]);
          stale.renderer.fractureSkull(other, [headSrc], from, dir, 'slug');
          expect(stale.fragments.map(x => x.name)).not.toContain(id);
          for (const r of [shut, stale]) { r.renderer.dispose(); r.cache.dispose(); }
          // The next update draws the split skull without the plate.
          renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
          expect(new Set(segs(renderer, owner).map(d => d.geometry)).size).toBe(13);
          renderer.dispose(); cache.dispose();
        }
      });

      it('pellets on a turned plate add up on that plate: the third releases it, from the turned pivot', () => {
        const { cache, kit, renderer, fragments } = makeAnatomical();
        const owner = { id: 2 }, w = warpOf('middle', 0, 0, 1), s = skullSplitOf(w, null, owner.id)!;
        renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
        const index = plateOf('parietal-right'), closedShot = shotAt(kit, index);
        const from = turned(s, 2, closedShot.from), dir = turnedDir(s, 2, closedShot.dir);
        expect(renderer.fractureSkull(owner, [headSrc], from, dir, 'pellet')).toBe(0);
        expect(renderer.fractureSkull(owner, [headSrc], from, dir, 'pellet')).toBe(0);
        expect(fragments).toHaveLength(0);
        expect(renderer.fractureSkull(owner, [headSrc], from, dir, 'pellet')).toBe(1);
        expect(fragments.map(f => f.name)).toEqual(['parietal-right']);
        expect(dist(fragments[0]!.pos, turned(s, 2, pivotOf(kit, index)))).toBeLessThan(1e-9);
        // Through the hole the same ray goes on to what is drawn behind it, or to nothing: never the missing plate.
        renderer.fractureSkull(owner, [headSrc], from, dir, 'slug');
        expect(fragments.slice(1).map(f => f.name)).not.toContain('parietal-right');
        renderer.dispose(); cache.dispose();
      });

      it('a pop on a split head releases every surviving plate from its turned pivot, each with the piece that owns that pivot', () => {
        const { cache, kit, renderer, fragments } = makeAnatomical();
        const owner = { id: 4 }, w = warpOf('middle', 0, 0, 1), s = skullSplitOf(w, null, owner.id)!;
        renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
        // One plate is shot off first: the pop releases the other thirteen.
        const lost = plateOf('temporal-left'), shot = shotAt(kit, lost);
        expect(renderer.fractureSkull(owner, [headSrc], turned(s, 1, shot.from), turnedDir(s, 1, shot.dir), 'slug')).toBe(1);
        fragments.length = 0;
        expect(renderer.explodeSkull(owner, [headSrc], SHOT.pop)).toBe(13);
        expect(fragments.map(f => f.name)).toEqual(SKULL_PIECES.filter((_, i) => i !== lost));
        // The closed head's pop, for each piece's un-turned direction: a fragment of a half is that pop's, turned.
        const closedPop = ([0, 1, 2] as const).map(piece => {
          const shut = makeAnatomical(), other = { id: 4 };
          shut.renderer.update([[headSrc]], [other]);
          shut.renderer.explodeSkull(other, [headSrc], turnedDir(s, piece, SHOT.pop, true));
          shut.renderer.dispose(); shut.cache.dispose();
          return shut.fragments;
        });
        const owners = [0, 0, 0];
        for (const f of fragments) {
          const index = plateOf(f.name as (typeof SKULL_PIECES)[number]), q = pivotOf(kit, index), moved = skullWarpPoint(s, q, skullJagAt(s, q));
          owners[moved.piece]!++;
          expect(dist(f.pos, moved.p), f.name).toBeLessThan(1e-9);
          const g = closedPop[moved.piece]!.find(x => x.name === f.name)!;
          expect(dist(f.pos, turned(s, moved.piece, g.pos)), f.name).toBeLessThan(1e-9);
          expect(dist(f.vel, turnedDir(s, moved.piece, g.vel)), f.name).toBeLessThan(1e-9);
          expect(f.matrix.elements.map(v => +v.toFixed(12)), f.name).toEqual(
            new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...s.frame.w.a), turnOf(s, moved.piece)).multiply(g.matrix).elements.map(v => +v.toFixed(12)));
        }
        // At the kill's opening every plate's pivot is above the hinge plane: each goes with a half.
        expect(owners[0]).toBe(0);
        expect(owners[1]!).toBeGreaterThanOrEqual(3);
        expect(owners[2]!).toBeGreaterThanOrEqual(3);
        expect(renderer.explodeSkull(owner, [headSrc], SHOT.pop)).toBe(0);
        renderer.dispose(); cache.dispose();
      });

      it('a one-sided split: the plates of the side that stays pop from the closed head\'s frame, to the bit; the turning side\'s from the turn', () => {
        const { cache, kit, renderer, fragments } = makeAnatomical();
        const owner = { id: 4 }, w = warpOf('middle', 1, 0.03, 1), s = skullSplitOf(w, null, owner.id)!;
        expect(s.angleM).toBe(0);
        renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
        expect(renderer.explodeSkull(owner, [headSrc], SHOT.pop)).toBe(14);
        const stays: string[] = [], turns: string[] = [];
        for (const f of fragments) {
          const q = pivotOf(kit, plateOf(f.name as (typeof SKULL_PIECES)[number])), moved = skullWarpPoint(s, q, skullJagAt(s, q));
          expect(dist(f.pos, moved.p), f.name).toBeLessThan(1e-9);
          (moved.piece === 0 ? stays : turns).push(f.name);
          const closed = CLOSED_POP.find(row => row[0] === f.name);
          if (moved.piece === 0 && closed) expect([f.name, ...f.pos, ...f.vel]).toEqual(closed);
          if (moved.piece === 1) expect(dist(f.pos, q)).toBeGreaterThan(0.01);
        }
        expect(stays).toContain('parietal-right');
        expect(stays).toContain('mandible');
        expect(turns).toContain('temporal-left');
        expect(turns).toContain('zygomatic-left');
        renderer.dispose(); cache.dispose();
      });

      it('the fracture is the live one (splitLook.jag / jagShape): what the tuning seam sets is what a shot and a pop go by', () => {
        const { cache, kit, renderer, fragments } = makeAnatomical();
        const owner = { id: 4 }, w = warpOf('middle', 0, 0, 1), s = skullSplitOf(w, null, owner.id)!;
        const wide = { ...HEAD_SPLIT.skull.jag, zigAmp: 0.012, wobble: 0.9 };
        renderer.splitLook.jag.value.x = wide.zigAmp;
        renderer.splitLook.jagShape.value.x = wide.wobble;
        renderer.update([[headSrc]], [owner], undefined, undefined, undefined, headOnly(w));
        const skull = kit.head(headSrc)!, whole = intactSkull(skull.pieces.length);
        const frame = {
          toLocal: (p: Vec3) => headSrc.toLocal(p) as Vec3, toWorld: (p: Vec3) => headSrc.toWorld(p) as Vec3,
          dirToLocal: (v: Vec3): Vec3 => { const a = headSrc.toLocal(v), o = headSrc.toLocal([0, 0, 0]); return [a[0] - o[0], a[1] - o[1], a[2] - o[2]]; },
        };
        // Shots down onto the crown's edge where the + half's copy draws it: within a centimetre of the old plane,
        // the band the wide fracture wanders over.
        const { h, a, n } = s.frame.w, u = s.frame.u;
        let moved = 0, broke = 0;
        for (let i = 0; i < 60; i++) {
          const al = -0.03 - (i % 20) * 0.004, off = -0.009 + Math.floor(i / 20) * 0.009;
          const along = (k: 0 | 1 | 2) => h[k] + a[k] * al + n[k] * off + u[k] * 0.16;
          const q: Vec3 = [along(0), along(1), along(2)];
          const up = turnedDir(s, 1, u), p = turned(s, 1, q);
          const from: Vec3 = [p[0] + up[0] * 0.06, p[1] + up[1] * 0.06, p[2] + up[2] * 0.06], dir: Vec3 = [-up[0], -up[1], -up[2]];
          const want = skullSplitRayHit(skull.pieces, whole, s, frame, from, dir, wide);
          const plain = skullSplitRayHit(skull.pieces, whole, s, frame, from, dir);
          if (want?.plate !== plain?.plate || want?.piece !== plain?.piece) moved++;
          // A fresh skull each shot: the hook seeds by id, so this owner breaks along the same fracture.
          const fresh = { id: 4 };
          fragments.length = 0;
          expect(renderer.fractureSkull(fresh, [headSrc], from, dir, 'slug'), `shot ${i}`).toBe(want ? 1 : 0);
          if (!want) continue;
          broke++;
          expect(fragments.map(f => f.name), `shot ${i}`).toEqual([SKULL_PIECES[want.plate]]);
          expect(dist(fragments[0]!.pos, turned(s, want.piece, pivotOf(kit, want.plate))), `shot ${i}`).toBeLessThan(1e-9);
        }
        expect(broke).toBeGreaterThan(20);
        // The default fracture would have answered otherwise for some of them.
        expect(moved).toBeGreaterThan(3);
        // The pop: each plate goes with the piece that owns its pivot by the wide fracture; some change halves for it.
        fragments.length = 0;
        expect(renderer.explodeSkull(owner, [headSrc], SHOT.pop)).toBe(14);
        let swapped = 0;
        for (const f of fragments) {
          const q = pivotOf(kit, plateOf(f.name as (typeof SKULL_PIECES)[number]));
          const byWide = skullWarpPoint(s, q, skullJagAt(s, q, wide)), byDefault = skullWarpPoint(s, q, skullJagAt(s, q));
          expect(dist(f.pos, byWide.p), f.name).toBeLessThan(1e-9);
          if (byWide.piece !== byDefault.piece) swapped++;
        }
        expect(swapped).toBeGreaterThan(0);
        renderer.dispose(); cache.dispose();
      });
    });
  });
});
