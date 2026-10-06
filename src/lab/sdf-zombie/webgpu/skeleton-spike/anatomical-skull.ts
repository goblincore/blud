/** Offline skull mesh loading and rigid-head fitting. No per-frame extraction. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoneFieldSource } from './contract';
import type { SegmentMesh } from './mesh';
import { SegmentMeshCache } from './mesh';
import type { SkullPieceSurface } from '../../skull-fracture';
import type { Vec3 } from '../../types';

export const ANATOMICAL_SKULL_URL = '/assets/lab/anatomical-skull.glb';
export const HUMANOID_SKULLS = new Set(['zombie', 'soldier', 'cultist', 'cultist-cowled', 'bride', 'female', 'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described', 'clown', 'clown-alt', 'juggernaut', 'bonewalker']);
export const SKULL_PIECES = ['frontal','parietal-left','parietal-right','occipital','temporal-left','temporal-right','zygomatic-left','zygomatic-right','maxilla-left','maxilla-right','upper-teeth','mandible','cranial-base','nasal-core'] as const;

export interface FittedSkullPiece extends SkullPieceSurface {
  /** All actor meshes stay in the same head-local frame. */
  geometry: THREE.BufferGeometry;
  /** Shared geometry centered on this piece's pivot, for free debris. */
  debrisGeometry: THREE.BufferGeometry;
}
export interface FittedSkull {
  mesh: SegmentMesh;
  pieces: FittedSkullPiece[];
}

/** Shape-preserving affine fit within the authored bone envelope. The narrower
 * face and full cavities come from the source, not a field projection that
 * would erase them. Intact-flesh containment is verified against real bodies. */
export function skullFitMatrix(bounds: BoneFieldSource['bounds'], raw: THREE.Box3, character = ''): THREE.Matrix4 {
  const size = raw.getSize(new THREE.Vector3());
  const centre = raw.getCenter(new THREE.Vector3());
  const span = bounds.max.map((v,i) => v-bounds.min[i]!);
  // The zombie's narrow crown and female's short crown need their own
  // envelope fractions; real flesh-clearance tests pin these exceptions.
  const width = character === 'zombie' ? .70 : .78;
  const height = character === 'female' ? .65 : .78;
  const scale = new THREE.Vector3(span[0]!*width/size.x,span[1]!*height/size.y,span[2]!*.75/size.z);
  const target = new THREE.Vector3(
    (bounds.min[0]+bounds.max[0])*.5,
    bounds.min[1]+span[1]!*(character === 'female' ? .53 : .58),
    (bounds.min[2]+bounds.max[2])*.5,
  );
  return new THREE.Matrix4().makeScale(scale.x,scale.y,scale.z).setPosition(target.sub(centre.multiply(scale)));
}

export class AnatomicalSkullKit {
  readonly #fitted = new Map<string,FittedSkull>();
  constructor(readonly source: readonly { id: string; geometry: THREE.BufferGeometry }[], readonly normalMap: THREE.Texture, readonly normalScale: THREE.Vector2) {}
  get size(): number { return this.#fitted.size; }
  get totals(): { verts: number; tris: number } {
    let verts=0,tris=0;
    for(const h of this.#fitted.values()){verts+=h.mesh.verts;tris+=h.mesh.tris;}
    return {verts,tris};
  }
  supports(source: BoneFieldSource): boolean { return source.segment === 'head' && HUMANOID_SKULLS.has(source.character); }
  head(source: BoneFieldSource): FittedSkull | null {
    if (!this.supports(source)) return null;
    let head = this.#fitted.get(source.revision);
    if (head) return head;
    const envelope = new THREE.Box3();
    for (const p of this.source) { p.geometry.computeBoundingBox(); envelope.union(p.geometry.boundingBox!); }
    const fit = skullFitMatrix(source.bounds,envelope,source.character);
    const pieces = this.source.map(({id,geometry:raw}):FittedSkullPiece => {
      const geometry = raw.clone().applyMatrix4(fit);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      geometry.userData.anatomicalSkull = true;
      const box = geometry.boundingBox!, pivot = box.getCenter(new THREE.Vector3());
      const debrisGeometry = geometry.clone().translate(-pivot.x,-pivot.y,-pivot.z);
      return { id, geometry, debrisGeometry, pivot:pivot.toArray() as Vec3,
        min:box.min.toArray() as Vec3, max:box.max.toArray() as Vec3,
        positions:geometry.getAttribute('position').array, indices:geometry.getIndex()!.array };
    });
    const geometry = mergeGeometries(pieces.map(p=>p.geometry),false)!;
    geometry.userData.anatomicalSkull = true;
    geometry.computeBoundingSphere();
    head = { pieces, mesh: { key:`${source.revision}:anatomical-skull-1`, geometry,
      verts:geometry.getAttribute('position').count, tris:geometry.getIndex()!.count/3,
      bakeMs:0, overflow:false, clamped:false, droppedQuads:0 } };
    this.#fitted.set(source.revision,head);
    return head;
  }
  dispose(): void {
    for (const h of this.#fitted.values()) {
      h.mesh.geometry.dispose();
      for (const p of h.pieces) { p.geometry.dispose(); p.debrisGeometry.dispose(); }
    }
    this.#fitted.clear();
    for (const p of this.source) p.geometry.dispose();
    this.normalMap.dispose();
  }
}

export async function loadAnatomicalSkull(url = ANATOMICAL_SKULL_URL): Promise<AnatomicalSkullKit> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const found = new Map<string,THREE.Mesh>();
  gltf.scene.traverse(o=> { if ((o as THREE.Mesh).isMesh) found.set(o.name,o as THREE.Mesh); });
  if (found.size !== SKULL_PIECES.length || SKULL_PIECES.some(id=>!found.has(id))) throw new Error('anatomical skull piece contract mismatch');
  const first = found.get(SKULL_PIECES[0])!.material as THREE.MeshStandardMaterial;
  if (!first.normalMap) throw new Error('anatomical skull has no baked normal atlas');
  const source = SKULL_PIECES.map(id=> {
    const mesh = found.get(id)!;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!geometry.index || !geometry.getAttribute('normal') || !geometry.getAttribute('uv')) throw new Error(`skull ${id} attributes missing`);
    // Tangents are optional and the derivative normal path does not need them.
    for (const name of Object.keys(geometry.attributes)) if (!['position','normal','uv'].includes(name)) geometry.deleteAttribute(name);
    return { id, geometry };
  });
  const triangles = source.reduce((n,p)=>n+p.geometry.index!.count/3,0);
  if (triangles > 10000) throw new Error(`skull triangle budget exceeded: ${triangles}`);
  for (const mesh of found.values()) mesh.geometry.dispose();
  for (const m of new Set([...found.values()].flatMap(m=>Array.isArray(m.material)?m.material:[m.material]))) m.dispose();
  return new AnatomicalSkullKit(source,first.normalMap,first.normalScale.clone());
}

export async function createSkullMeshCache(search: string): Promise<SegmentMeshCache> {
  const selected = new URLSearchParams(search).get('skull');
  if (selected === 'sculpt' || selected === 'procedural') return new SegmentMeshCache();
  try { return new SegmentMeshCache(undefined,await loadAnatomicalSkull()); }
  catch (error) {
    console.warn('[skull] anatomical asset failed; sculpted skull retained',error);
    return new SegmentMeshCache();
  }
}
