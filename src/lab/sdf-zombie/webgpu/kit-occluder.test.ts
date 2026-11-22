import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { addKitOccluders, kitOccluderEligible, KIT_OCCLUDER_INSET, setKitOccluderInset } from './kit-occluder';
import { KIT_OCCLUDER_LAYER, OCCLUDER_LAYER } from './sdf-layer';

function mat(name: string, opts: Partial<THREE.MeshStandardMaterial> = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  m.side = THREE.DoubleSide;
  Object.assign(m, opts);
  return m;
}

function skinnedKit(names: string[]): { root: THREE.Group; meshes: THREE.SkinnedMesh[] } {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  root.add(bone);
  const skeleton = new THREE.Skeleton([bone]);
  const meshes = names.map(n => {
    const g = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const count = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const m = new THREE.SkinnedMesh(g, mat(n));
    m.bind(skeleton);
    root.add(m);
    return m;
  });
  return { root, meshes };
}

describe('kit occluder eligibility', () => {
  const mesh = (m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(), m);
  it('admits opaque cloth, boots and leather', () => {
    for (const n of ['cloth', 'boot', 'leather', 'tee', 'shorts', 'shoe']) expect(kitOccluderEligible(mesh(mat(n)))).toBe(true);
  });
  it('never glass, emissive, metal plate or kit flesh', () => {
    for (const n of ['glass', 'lens', 'led', 'core', 'eyeglow', 'rustplate', 'zombieskin', 'goblinskin', 'zombienail']) {
      expect(kitOccluderEligible(mesh(mat(n)))).toBe(false);
    }
    const flesh = mesh(mat('cloth'));
    flesh.userData['kitFlesh'] = true;
    expect(kitOccluderEligible(flesh)).toBe(false);
  });
  it('never anything see-through, even when named cloth', () => {
    expect(kitOccluderEligible(mesh(mat('cloth', { transparent: true })))).toBe(false);
    expect(kitOccluderEligible(mesh(mat('cloth', { opacity: 0.9 })))).toBe(false);
    expect(kitOccluderEligible(mesh(mat('cloth', { alphaTest: 0.5 })))).toBe(false);
    expect(kitOccluderEligible(mesh(mat('cloth', { side: THREE.BackSide })))).toBe(false);
    expect(kitOccluderEligible(mesh(mat('cloth', { depthWrite: false })))).toBe(false);
  });
});

describe('addKitOccluders', () => {
  it('twins exactly the eligible meshes, skinned on the same skeleton, on the kit occluder layer only', () => {
    const { root, meshes } = skinnedKit(['cloth', 'boot', 'zombieskin', 'rustplate']);
    const occ = addKitOccluders(root);
    expect(occ.twins.length).toBe(2);
    for (const [i, twin] of occ.twins.entries()) {
      const src = meshes[i]!;
      expect(twin.parent).toBe(src);
      expect(twin.geometry).toBe(src.geometry);
      expect((twin as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
      expect((twin as THREE.SkinnedMesh).skeleton).toBe(src.skeleton);
      expect((twin as THREE.SkinnedMesh).bindMatrix.equals(src.bindMatrix)).toBe(true);
      expect(twin.layers.isEnabled(KIT_OCCLUDER_LAYER)).toBe(true);
      expect(twin.layers.isEnabled(0)).toBe(false);
      expect(twin.layers.isEnabled(OCCLUDER_LAYER)).toBe(false);
      expect(twin.castShadow).toBe(false);
      const m = twin.material as THREE.MeshBasicMaterial;
      expect(m.fog).toBe(false);
      expect(m.side).toBe(THREE.FrontSide);
    }
    // One material for every twin of every kit.
    const again = addKitOccluders(skinnedKit(['cloth']).root);
    expect(again.twins[0]!.material).toBe(occ.twins[0]!.material);
  });

  it('does not twin its own twins when run twice', () => {
    const { root } = skinnedKit(['cloth']);
    addKitOccluders(root);
    expect(addKitOccluders(root).twins.length).toBe(1);
  });

  it('a shed piece leaves the target: the twin draws the rewritten index and hides with its source', () => {
    const { root, meshes } = skinnedKit(['cloth']);
    const occ = addKitOccluders(root);
    const src = meshes[0]!, twin = occ.twins[0]!;
    // kit-damage.ts: a shed piece rewrites the source geometry's index; the last piece hides the mesh.
    src.geometry.setIndex([0, 1, 2]);
    expect(twin.geometry.index!.count).toBe(3);
    src.visible = false;
    const drawn: THREE.Object3D[] = [];
    root.traverseVisible(o => drawn.push(o));
    expect(drawn).not.toContain(twin);
    // A REPLACED geometry object is re-pointed on the next pose.
    src.geometry = src.geometry.clone();
    occ.sync();
    expect(twin.geometry).toBe(src.geometry);
  });

  it('dispose detaches every twin', () => {
    const { root } = skinnedKit(['cloth', 'leather']);
    const occ = addKitOccluders(root);
    occ.dispose();
    for (const t of occ.twins) expect(t.parent).toBeNull();
  });
});

describe('kit occluder inset', () => {
  it('ships a couple of centimetres and never goes negative', () => {
    expect(KIT_OCCLUDER_INSET).toBeGreaterThan(0);
    expect(KIT_OCCLUDER_INSET).toBeLessThanOrEqual(0.03);
    expect(setKitOccluderInset(-1)).toBe(0);
    expect(setKitOccluderInset(KIT_OCCLUDER_INSET)).toBe(KIT_OCCLUDER_INSET);
  });
});
