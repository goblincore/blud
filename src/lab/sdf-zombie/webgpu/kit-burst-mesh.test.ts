import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PLANE_GROUND } from '../debris-ground';
import { createKitBurst, prepareKitBurst } from './kit-burst-mesh';
import { piecesOf } from './kit-damage';

/** Two boxes on bones[0], one on bones[1], of a three-bone skeleton; `smooth` blends box 3's verts across both bones. */
function kit(smooth = false) {
  const positions: number[] = [], skin: number[] = [], weight: number[] = [], index: number[] = [];
  const box = (cx: number, joint: number) => {
    const base = positions.length / 3;
    for (let i = 0; i < 8; i++) {
      positions.push(cx + (i & 1 ? .1 : -.1), 1 + (i & 2 ? .1 : -.1), i & 4 ? .1 : -.1);
      skin.push(joint, 1, 0, 0);
      weight.push(smooth ? .6 : 1, smooth ? .4 : 0, 0, 0);
    }
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 4, base + 5, base + 6, base + 5, base + 7, base + 6,
      base, base + 1, base + 4, base + 1, base + 5, base + 4);
  };
  box(-1, 0); box(0, 0); box(1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
  g.setIndex(index);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones.forEach((b, i) => { b.name = `b${i}`; b.position.set(i, 0, 0); b.updateMatrixWorld(true); });
  mesh.bind(new THREE.Skeleton(bones));
  for (const b of bones) { b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; }
  return { mesh, bones };
}

const opts = (mesh: THREE.SkinnedMesh) => ({
  launch: (key: string) => [3 + key.length + Number(key.slice(4)), 2, 0] as [number, number, number], rolls: () => [.3, .6, .1] as const, meshes: [mesh],
});
/** A vertex's world position through the real skinning chain. */
const world = (mesh: THREE.SkinnedMesh, v: number) => {
  const p = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute, v);
  mesh.applyBoneTransform(v, p);
  return p;
};

describe('createKitBurst', () => {
  it('islands: each gets a bone of its own, unmoved on the first frame, and rigid afterwards', () => {
    const { mesh } = kit();
    const before = world(mesh, 0).clone(), other = world(mesh, 8).clone();
    const burst = createKitBurst({ ...opts(mesh), islands: piecesOf(mesh) });
    expect(burst.report()).toHaveLength(3);
    expect(world(mesh, 0).distanceTo(before)).toBeLessThan(1e-5);
    expect(world(mesh, 8).distanceTo(other)).toBeLessThan(1e-5);
    const span = world(mesh, 0).distanceTo(world(mesh, 7));
    const sep = world(mesh, 0).distanceTo(world(mesh, 8));
    for (let i = 0; i < 20; i++) burst.step(1 / 60, PLANE_GROUND);
    expect(world(mesh, 0).distanceTo(world(mesh, 7))).toBeCloseTo(span, 4);   // the piece kept its shape
    expect(world(mesh, 0).distanceTo(before)).toBeGreaterThan(.2);            // and moved
    expect(world(mesh, 0).distanceTo(world(mesh, 8))).not.toBeCloseTo(sep, 2); // apart from the other
  });
  it('by bone: one piece per bone and no attribute writes for rigid weights', () => {
    const { mesh } = kit();
    const si = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
    const version = si.version;
    const burst = createKitBurst({ ...opts(mesh), islands: null });
    expect(burst.report()).toHaveLength(2);
    expect(si.version).toBe(version);
  });
  it('by bone, smooth weights: every vertex goes wholly to its heaviest bone', () => {
    const { mesh } = kit(true);
    createKitBurst({ ...opts(mesh), islands: null, byBone: prepareKitBurst([mesh]) });
    const sw = mesh.geometry.getAttribute('skinWeight');
    for (let v = 0; v < sw.count; v++) expect(sw.getX(v)).toBe(1);
    expect(mesh.geometry.index!.count).toBeGreaterThan(0);
    const idx = mesh.geometry.index!.array, si = mesh.geometry.getAttribute('skinIndex');
    for (let i = 0; i < idx.length; i += 3) expect(si.getX(idx[i]!)).toBe(si.getX(idx[i + 1]!));
  });
  it('pieces rest on the floor and the culling sphere covers them', () => {
    const { mesh } = kit();
    const burst = createKitBurst({ ...opts(mesh), islands: piecesOf(mesh) });
    for (let i = 0; i < 400 && burst.step(1 / 60, PLANE_GROUND); i++);
    for (const q of burst.report()) {
      expect(q.resting).toBe(true);
      expect(q.minY).toBeCloseTo(.01, 5);
      expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(...q.pos))).toBe(true);
    }
  });
  it('an empty kit is a no-op', () => {
    expect(createKitBurst({ meshes: [], islands: [], launch: () => [0, 0, 0], rolls: () => [0, 0, 0] }).step(1, PLANE_GROUND)).toBe(false);
  });
});
