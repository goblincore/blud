import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { KIT_MERGED_NAME, kitMergeOn, mergeKitMeshes } from './kit-merge';

function primitive(skeleton: THREE.Skeleton, name: string, color: [number, number, number], vertexColour: boolean): THREE.SkinnedMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  if (vertexColour) g.setAttribute('color', new THREE.Float32BufferAttribute([0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1], 3));
  g.setIndex([0, 1, 2]);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...color) });
  mat.name = name;
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

function kit(names: string[]): THREE.Group {
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const root = new THREE.Group();
  root.add(bone);
  names.forEach((n, i) => root.add(primitive(skeleton, n, [0.2 * (i + 1), 0.1, 0.1], i === 1)));
  return root;
}

const looks: Record<string, { metalness: number; roughness: number; envIntensity: number }> = {
  iron: { metalness: 0.7, roughness: 0.2, envIntensity: 1.1 },
  brass: { metalness: 0.8, roughness: 0.3, envIntensity: 1.2 },
};
const opts = { environment: new THREE.Texture(), look: (n: string) => looks[n] ?? null };

describe('kit merge', () => {
  it('is off unless the page asks', () => {
    expect(kitMergeOn('')).toBe(false);
    expect(kitMergeOn('?kitmerge')).toBe(true);
    expect(kitMergeOn('?kitmerge=0')).toBe(false);
  });

  it('joins the plain primitives into one skinned mesh and leaves the rest', () => {
    const root = kit(['iron', 'brass', 'led']);
    const r = mergeKitMeshes(root, opts);
    expect(r).toEqual({ merged: 2, into: 1 });
    const meshes = root.children.filter(c => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
    expect(meshes.map(m => (m.material as THREE.Material).name).sort()).toEqual([KIT_MERGED_NAME, 'led']);
    const g = meshes.find(m => (m.material as THREE.Material).name === KIT_MERGED_NAME)!.geometry;
    expect(g.getAttribute('position').count).toBe(6);
    expect([...g.index!.array]).toEqual([0, 1, 2, 3, 4, 5]);
    // Colour = base colour x vertex colour; the look rides beside it.
    const c = g.getAttribute('color'), l = g.getAttribute('_look');
    expect(c.getX(0)).toBeCloseTo(0.2); expect(c.getX(3)).toBeCloseTo(0.4 * 0.5); expect(c.getX(4)).toBeCloseTo(0.4);
    expect([l.getX(0), l.getY(0), l.getZ(0)].map(v => +v.toFixed(3))).toEqual([0.7, 0.2, 1.1]);
    expect([l.getX(5), l.getY(5), l.getZ(5)].map(v => +v.toFixed(3))).toEqual([0.8, 0.3, 1.2]);
  });

  it('leaves a kit with fewer than two plain primitives alone', () => {
    const root = kit(['iron', 'led']);
    expect(mergeKitMeshes(root, opts)).toEqual({ merged: 0, into: 0 });
    expect(root.children.filter(c => (c as THREE.SkinnedMesh).isSkinnedMesh)).toHaveLength(2);
  });

  it('does not merge a textured or transparent primitive', () => {
    const root = kit(['iron', 'brass', 'iron']);
    ((root.children[2] as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial).map = new THREE.Texture();
    ((root.children[3] as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial).transparent = true;
    expect(mergeKitMeshes(root, opts)).toEqual({ merged: 0, into: 0 });
  });
});
