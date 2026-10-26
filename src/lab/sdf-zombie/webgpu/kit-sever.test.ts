import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { cutKitBone, kitTakenBy, trianglesOnJoint } from './kit-sever';
import { createZombieActor, type DetachedPiece } from './game-actor';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import type { Primitive } from '../types';

describe('trianglesOnJoint', () => {
  it('takes a triangle only when all three vertices ride the joint', () => {
    const skin = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];   // vertex 0 on joint 0, vertices 1-3 on joint 1
    expect(trianglesOnJoint([1, 2, 3, 0, 1, 2], skin, 1)).toEqual({ take: [0], keep: [3] });
  });
});

describe('kitTakenBy', () => {
  const prim = (bone: string, a: number[], b: number[]) => ({ bone, a, b }) as unknown as Primitive;
  const hand = new Set(['zombieskin', 'zombienail']);
  it('a piece with a SEGMENT of a bone takes all of that bone’s kit (the forearm takes the hand and the shackle)', () => {
    expect(kitTakenBy([prim('foreArm.l', [0, 1, 0], [0, 0.8, 0]), prim('foreArm.l', [0, 0.8, 0], [0, 0.8, 0])], hand))
      .toEqual([{ bone: 'foreArm.l' }]);
  });
  it('a piece with only the bone’s end KNOB takes only the hand (a wrist cut leaves the shackle on the stump)', () => {
    expect(kitTakenBy([prim('foreArm.r', [0, 0.8, 0], [0, 0.8, 0])], hand)).toEqual([{ bone: 'foreArm.r', materials: hand }]);
  });
  it('without hands declared, a knob takes everything on its bone', () => {
    expect(kitTakenBy([prim('foreArm.r', [0, 0.8, 0], [0, 0.8, 0])], null)).toEqual([{ bone: 'foreArm.r' }]);
  });
});

describe('cutKitBone', () => {
  /** A two-bone skinned kit: one triangle on each bone; bone 1 posed 1 m up. */
  function kit() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(18).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(24).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    g.setIndex([0, 1, 2, 3, 4, 5]);
    const b0 = new THREE.Bone(), b1 = new THREE.Bone();
    b0.name = 'thighl'; b1.name = 'foreArml';   // kitBoneKey's sanitised names
    const mat = new THREE.MeshStandardMaterial(); mat.name = 'cloth';
    const mesh = new THREE.SkinnedMesh(g, mat);
    mesh.add(b0, b1);
    mesh.bind(new THREE.Skeleton([b0, b1]));
    const root = new THREE.Group(); root.add(mesh);
    root.updateMatrixWorld(true);
    b1.position.set(0, 1, 0);
    root.updateMatrixWorld(true);
    return { root, mesh };
  }
  it('lifts the bone’s triangles out, posed in world space less the origin, and hides them on the kit', () => {
    const { root, mesh } = kit();
    const group = cutKitBone(root, 'foreArm.l', [0, 0.5, 0])!;
    expect(group.children).toHaveLength(1);
    const rider = group.children[0] as THREE.Mesh;
    expect(rider.geometry.index!.count).toBe(3);
    expect(rider.geometry.getAttribute('skinIndex')).toBeUndefined();
    // vertex 3 (0, 0, 1) on bone 1, posed 1 m up, less the origin's 0.5
    expect([...rider.geometry.getAttribute('position').array.slice(0, 3)]).toEqual([0, 0.5, 1]);
    expect(mesh.geometry.index!.count).toBe(3);
    expect([...mesh.geometry.index!.array]).toEqual([0, 1, 2]);
  });
  it('is null when nothing rides the bone, or the material is not asked for', () => {
    expect(cutKitBone(kit().root, 'skull', [0, 0, 0])).toBeNull();
    expect(cutKitBone(kit().root, 'foreArm.l', [0, 0, 0], new Set(['zombieskin']))).toBeNull();
  });
});

describe('severHand', () => {
  function actor(pieces: DetachedPiece[]) {
    const body = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
    const view = { update() {}, setRootShift() {}, setHeadRotation() {}, setTime() {}, setWounds() {} };
    const character = { entry: { kitHands: { bones: ['foreArm.l', 'foreArm.r'], materials: ['zombieskin'], drop: 0.075, radius: 0.08 } } };
    return createZombieActor({ id: 1, room: 0, body, view: view as never, start: [0, 0, 0], seed: 3,
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [], character: character as never,
      onSever: p => { pieces.push(p as DetachedPiece); } });
  }
  it('a palm hangs below each wrist knob, and shooting it cuts at the wrist: the knob alone leaves, once', () => {
    const pieces: DetachedPiece[] = [];
    const a = actor(pieces);
    const hands = a.handSpheres();
    expect(hands.map(h => h.bone).sort()).toEqual(['foreArm.l', 'foreArm.r']);
    for (const h of hands) expect(h.centre[1]).toBeLessThan(0.82);   // below the wrist (y ~0.81 at rest)
    expect(a.severHand('foreArm.r')).toBe(true);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.prims.map(p => p.bone)).toEqual(['foreArm.r']);
    expect(kitTakenBy(pieces[0]!.prims, new Set(['zombieskin']))).toEqual([{ bone: 'foreArm.r', materials: new Set(['zombieskin']) }]);
    expect(a.handSpheres().map(h => h.bone)).toEqual(['foreArm.l']);
    expect(a.severHand('foreArm.r')).toBe(false);
    // the arm is still on: the forearm's flesh stays
    expect(a.posed().prims.some(p => p.bone === 'foreArm.r' && !p.dead && Math.hypot(p.b[1] - p.a[1]) > 0.05)).toBe(true);
  });
});
