import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { cloneKitScene, isSharedKitGeometry, kitShareOn, kitTemplate, kitTemplateKey } from './kit-template';

function kit(): { scene: THREE.Group; mesh: THREE.SkinnedMesh; other: THREE.SkinnedMesh } {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'spine';
  scene.add(bone);
  const material = new THREE.MeshStandardMaterial();
  material.name = 'cloth';
  const make = () => {
    const g = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
    const m = new THREE.SkinnedMesh(g, material);
    m.bind(new THREE.Skeleton([bone]));
    scene.add(m);
    return m;
  };
  return { scene, mesh: make(), other: make() };
}
const skinnedOf = (root: THREE.Object3D) => {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); });
  return out;
};

describe('kit templates', () => {
  it('shares geometry between bodies, never bones or materials', () => {
    const { scene, mesh } = kit();
    const [a, b] = [cloneKitScene(scene), cloneKitScene(scene)];
    const [ma, mb] = [skinnedOf(a)[0]!, skinnedOf(b)[0]!];
    expect(ma.geometry).toBe(mesh.geometry);
    expect(mb.geometry).toBe(mesh.geometry);
    expect(ma.material).not.toBe(mb.material);
    expect(ma.material).not.toBe(mesh.material);
    expect(ma.skeleton).not.toBe(mb.skeleton);
    expect(ma.skeleton.bones[0]).not.toBe(mb.skeleton.bones[0]);
    expect(ma.skeleton.bones[0]!.name).toBe('spine');
    expect(ma.skeleton.bones[0]!.parent).toBe(a);
  });

  it('keeps meshes that shared a material sharing it inside one body', () => {
    const [m0, m1] = skinnedOf(cloneKitScene(kit().scene));
    expect(m0!.material).toBe(m1!.material);
  });

  it('a body writing its material leaves the others alone', () => {
    const { scene } = kit();
    const [ma, mb] = [skinnedOf(cloneKitScene(scene))[0]!, skinnedOf(cloneKitScene(scene))[0]!];
    (ma.material as THREE.MeshStandardMaterial).emissiveIntensity = 7;
    expect((mb.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1);
  });

  it('loads once for bodies asking at the same time, and marks the geometry shared', async () => {
    const { scene, mesh } = kit();
    let loads = 0;
    const load = async () => { loads++; return scene; };
    const [a, b] = await Promise.all([kitTemplate('once', load), kitTemplate('once', load)]);
    expect(loads).toBe(1);
    expect(a).toBe(b);
    expect(isSharedKitGeometry(mesh.geometry)).toBe(true);
    expect(isSharedKitGeometry(mesh.geometry.clone())).toBe(false);
  });

  it('forgets a failed load so a later body retries', async () => {
    const good = kit().scene;
    let loads = 0;
    const load = async () => { if (++loads === 1) throw new Error('404'); return good; };
    await expect(kitTemplate('retry', load)).rejects.toThrow('404');
    await expect(kitTemplate('retry', load)).resolves.toBe(good);
    expect(loads).toBe(2);
  });

  it('keys a borrowed part apart from the whole kit, whatever the order', () => {
    expect(kitTemplateKey('a.gltf')).not.toBe(kitTemplateKey('a.gltf', ['tooth']));
    expect(kitTemplateKey('a.gltf', ['x', 'y'])).toBe(kitTemplateKey('a.gltf', ['y', 'x']));
  });

  it('is on unless ?kitshare=0', () => {
    expect(kitShareOn('')).toBe(true);
    expect(kitShareOn('?kitshare=1')).toBe(true);
    expect(kitShareOn('?kitshare=0')).toBe(false);
  });
});
