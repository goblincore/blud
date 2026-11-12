// src/lab/sdf-zombie/webgpu/kit-merge.ts
//
// ONE DRAW FOR A KIT'S PLAIN MATERIALS (experiment, 2026-11-10; behind `?kitmerge`, off by default).
//
// A kit file is one glTF mesh with one primitive per material, and three draws each primitive as its own
// SkinnedMesh: a butcher is 8 draws, a flayer 9, per body, every frame. On MAP28's yellow-key closet (12 butchers,
// 3 flayers) that was 121 of the polygon pass's 290 draws, at about 0.045 ms of CPU each (dev build, busy M3).
//
// Most of a kit's materials differ only in numbers: a base colour, metalness, roughness, how bright the room
// reflection is. Those go to the vertices (`color`, and `_look` = metalness, roughness, environment gain), the
// primitives are joined into one geometry, and one node material reads them back. What does not fit that is left as
// its own mesh: anything textured, transparent, glowing or pulsed, and whatever the caller excludes by name.
//
// Done on the parsed scene, before kit-template.ts clones it, so every body shares the merged geometry.
import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, pmremTexture } from 'three/tsl';

export const KIT_MERGED_NAME = 'kitmerged';

export function kitMergeOn(search: string): boolean {
  const v = new URLSearchParams(search).get('kitmerge');
  return v !== null && v !== '0';
}

export interface KitMergeLook { metalness: number; roughness: number; envIntensity: number }

export interface KitMergeOpts {
  /** The look of a material name, or null when the material cannot be reduced to numbers (it glows, pulses, ...). */
  look(name: string): KitMergeLook | null;
  /** The kit's reflection environment (kit-overlay.ts kitEnvironment). */
  environment: THREE.Texture;
}

/** True when `mesh` is one plain skinned primitive: a single standard material with no texture and no blending. */
export function kitMergeable(mesh: THREE.Object3D, look: KitMergeOpts['look']): mesh is THREE.SkinnedMesh {
  const m = mesh as THREE.SkinnedMesh;
  if (!m.isSkinnedMesh || Array.isArray(m.material) || !m.material) return false;
  if (m.userData['kitFlesh'] || m.userData['kitOccluderTwin'] || !m.visible) return false;
  const mat = m.material as THREE.MeshStandardMaterial;
  if (!mat.isMeshStandardMaterial || !look(mat.name)) return false;
  if (mat.map || mat.normalMap || mat.emissiveMap || mat.roughnessMap || mat.metalnessMap || mat.alphaMap || mat.aoMap) return false;
  if (mat.transparent || mat.opacity < 1 || mat.alphaTest > 0) return false;
  const g = m.geometry;
  return !!(g.getAttribute('position') && g.getAttribute('normal') && g.getAttribute('skinIndex') && g.getAttribute('skinWeight'))
    && !g.getAttribute('_glow') && Object.keys(g.morphAttributes).length === 0;
}

/** One primitive's vertices in the merged layout. Colour = the material's base colour times the vertex colour. */
function appendPrimitive(mesh: THREE.SkinnedMesh, look: KitMergeLook, out: {
  position: number[]; normal: number[]; skinIndex: number[]; skinWeight: number[]; color: number[]; look: number[]; index: number[];
}): void {
  const g = mesh.geometry, base = out.position.length / 3;
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), col = g.getAttribute('color');
  const c = (mesh.material as THREE.MeshStandardMaterial).color;
  for (let i = 0; i < pos.count; i++) {
    out.position.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    out.normal.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    out.skinIndex.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i));
    out.skinWeight.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i));
    out.color.push(c.r * (col ? col.getX(i) : 1), c.g * (col ? col.getY(i) : 1), c.b * (col ? col.getZ(i) : 1));
    out.look.push(look.metalness, look.roughness, look.envIntensity);
  }
  if (g.index) for (let i = 0; i < g.index.count; i++) out.index.push(base + g.index.getX(i));
  else for (let i = 0; i < pos.count; i++) out.index.push(base + i);
}

/** The one material every merged kit mesh wears: its numbers come from the vertices. */
export function kitMergedMaterial(environment: THREE.Texture): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  mat.name = KIT_MERGED_NAME;
  mat.color.setRGB(1, 1, 1);
  mat.vertexColors = true;
  const look = attribute('_look', 'vec3');
  mat.metalnessNode = look.x;
  mat.roughnessNode = look.y;
  // The reflection's gain is per material in three (envMapIntensity, a uniform). Here it is per vertex, so the
  // environment node carries it and the uniform stays 1.
  mat.envNode = pmremTexture(environment).mul(look.z);
  mat.envMapIntensity = 1;
  return mat;
}

/**
 * Joins the mergeable skinned primitives under `root` that share a skeleton into one mesh per skeleton. Returns how
 * many primitives were merged away (0 = nothing changed). The merged meshes' old geometries and materials are disposed.
 */
export function mergeKitMeshes(root: THREE.Object3D, opts: KitMergeOpts): { merged: number; into: number } {
  const groups = new Map<THREE.Skeleton, THREE.SkinnedMesh[]>();
  root.traverse(o => {
    if (!kitMergeable(o, opts.look)) return;
    const list = groups.get(o.skeleton);
    if (list) list.push(o); else groups.set(o.skeleton, [o]);
  });
  let merged = 0, into = 0;
  for (const [skeleton, all] of groups) {
    // Same parent, same local transform, same bind matrix: one skinned draw can stand for them all.
    const first = all[0]!;
    const meshes = all.filter(m => m.parent === first.parent && m.matrix.equals(first.matrix) && m.bindMatrix.equals(first.bindMatrix)
      && m.bindMode === first.bindMode);
    if (meshes.length < 2) continue;
    const out = { position: [] as number[], normal: [] as number[], skinIndex: [] as number[], skinWeight: [] as number[],
      color: [] as number[], look: [] as number[], index: [] as number[] };
    for (const m of meshes) appendPrimitive(m, opts.look((m.material as THREE.Material).name)!, out);
    const count = out.position.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.skinWeight, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(out.color, 3));
    g.setAttribute('_look', new THREE.Float32BufferAttribute(out.look, 3));
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(out.index, 1) : new THREE.Uint16BufferAttribute(out.index, 1));
    const mesh = new THREE.SkinnedMesh(g, kitMergedMaterial(opts.environment));
    mesh.name = `${first.name || 'mesh'}-merged`;
    mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
    mesh.layers.mask = first.layers.mask;
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = first.frustumCulled; mesh.renderOrder = first.renderOrder;
    mesh.bindMode = first.bindMode;
    mesh.bind(skeleton, first.bindMatrix);
    first.parent!.add(mesh);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    merged += meshes.length; into++;
  }
  return { merged, into };
}
