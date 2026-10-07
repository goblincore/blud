/** Offline skull mesh loading and rigid-head fitting. No per-frame extraction. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoneFieldSource } from './contract';
import type { SegmentMesh } from './mesh';
import { SegmentMeshCache } from './mesh';
import type { SkullPieceSurface } from '../../skull-fracture';
import type { Vec3 } from '../../types';
import { fitSkull, SKULL_FITS, type SkullFitResult } from './skull-fit';

export const ANATOMICAL_SKULL_URL = '/assets/lab/anatomical-skull.glb';
export const HUMANOID_SKULLS = new Set(['zombie', 'soldier', 'cultist', 'cultist-cowled', 'bride', 'female', 'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described', 'clown', 'clown-alt', 'juggernaut', 'bonewalker']);
export const SKULL_PIECES = ['frontal','parietal-left','parietal-right','occipital','temporal-left','temporal-right','zygomatic-left','zygomatic-right','maxilla-left','maxilla-right','upper-teeth','mandible','cranial-base','nasal-core'] as const;
/** The plates of the face: a fit to the flesh may move them less than the cranium's (skull-fit.ts facePull). */
export const SKULL_FACE_PIECES: ReadonlySet<string> = new Set(['zygomatic-left','zygomatic-right','maxilla-left','maxilla-right','upper-teeth','mandible','nasal-core']);
/** The asset's openings, in its own assembled frame (metres): a point inside each orbit and inside the nasal
 *  opening, about 10 mm in front of the cavity's back wall, on a line from the front that meets no bone
 *  (anatomical-skull.test.ts pins that on the asset). `left` is the skull's own left, +x. */
export const SKULL_OPENINGS = {
  orbitLeft: [0.0227, 0.0008, 0.046], orbitRight: [-0.0293, 0.0022, 0.045], nasal: [-0.0039, -0.0274, 0.044],
} as const satisfies Record<string, Vec3>;
/** The point midway between the asset's orbits: a fit to the flesh holds the skull by it (skull-fit.ts SkullFitHold).
 *  The middle of the asset's box is 3.4 mm to one side of it (the face sits off the cranium's middle in this asset). */
export const SKULL_EYE_POINT = {
  x: (SKULL_OPENINGS.orbitLeft[0] + SKULL_OPENINGS.orbitRight[0]) / 2, y: (SKULL_OPENINGS.orbitLeft[1] + SKULL_OPENINGS.orbitRight[1]) / 2,
} as const;
/** The height of a head's eyes in its bone envelope: where mesh-eyes.ts seats them (its 0.22, on -1..1). */
export const skullEyeLine = (bounds: BoneFieldSource['bounds']): number => bounds.min[1] + (0.22 + 1) * 0.5 * (bounds.max[1] - bounds.min[1]);
/** How a kit fits the skull to a head. 'envelope': skullFitMatrix, fixed fractions of the head's bone envelope. The
 *  others size it to the head's flesh (skull-fit.ts SKULL_FITS); a head whose source carries no flesh gets the
 *  envelope fit under any name. */
export const SKULL_FIT_NAMES = ['envelope','affine','mid','snug','tight'] as const;
export type SkullFitName = (typeof SKULL_FIT_NAMES)[number];

export interface FittedSkullPiece extends SkullPieceSurface {
  /** All actor meshes stay in the same head-local frame. */
  geometry: THREE.BufferGeometry;
  /** Shared geometry centered on this piece's pivot, for free debris. */
  debrisGeometry: THREE.BufferGeometry;
}
export interface FittedSkull {
  mesh: SegmentMesh;
  pieces: FittedSkullPiece[];
  /** A fit to the flesh: what it did, and the fitted skull's box in the head frame (such a skull may stand outside
   *  the head's bone envelope, which bounds the envelope fit). Null for the envelope fit. */
  fit: { name: SkullFitName; result: SkullFitResult; min: Vec3; max: Vec3 } | null;
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
  constructor(
    readonly source: readonly { id: string; geometry: THREE.BufferGeometry }[], readonly normalMap: THREE.Texture, readonly normalScale: THREE.Vector2,
    readonly fit: SkullFitName = 'envelope',
  ) {}
  get size(): number { return this.#fitted.size; }
  get totals(): { verts: number; tris: number } {
    let verts=0,tris=0;
    for(const h of this.#fitted.values()){verts+=h.mesh.verts;tris+=h.mesh.tris;}
    return {verts,tris};
  }
  supports(source: BoneFieldSource): boolean { return source.segment === 'head' && HUMANOID_SKULLS.has(source.character); }
  head(source: BoneFieldSource): FittedSkull | null {
    if (!this.supports(source)) return null;
    const fleshed = this.#fleshed(source);
    if (fleshed) return fleshed;
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
    head = { pieces, fit:null, mesh: { key:`${source.revision}:anatomical-skull-1`, geometry,
      verts:geometry.getAttribute('position').count, tris:geometry.getIndex()!.count/3,
      bakeMs:0, overflow:false, clamped:false, droppedQuads:0 } };
    this.#fitted.set(source.revision,head);
    return head;
  }
  /** The skull fitted to the head's flesh (skull-fit.ts), for a kit whose fit is not the envelope's and a head whose
   *  source carries its flesh; null otherwise, and head() gives the envelope fit. Both stages run over every plate at
   *  once, and everything a FittedSkull holds is made from that one result: each plate's geometry, its debris twin,
   *  its pivot and box, the triangles a shot is tested against, the merged skull, and the whole skull's box. The fit
   *  is the flesh's as much as the bone's (two bodies with one head bone and two faces are two fits), so it is kept
   *  under both revisions. */
  #fleshed(source: BoneFieldSource): FittedSkull | null {
    const name = this.fit, flesh = name === 'envelope' ? undefined : source.flesh;
    if (name === 'envelope' || !flesh) return null;
    const key = `${source.revision}|${flesh.revision}|${name}`;
    let head = this.#fitted.get(key);
    if (head) return head;
    const result = fitSkull(this.source.map(p => ({
      positions: p.geometry.getAttribute('position').array, normals: p.geometry.getAttribute('normal').array, face: SKULL_FACE_PIECES.has(p.id),
    })), p => flesh.distance(p), source.bounds, flesh.centre, SKULL_FITS[name], SKULL_FITS[name].eyes ? { ...SKULL_EYE_POINT, at: skullEyeLine(source.bounds) } : SKULL_EYE_POINT);
    const whole = new THREE.Box3();
    const pieces = this.source.map(({id,geometry:raw},index):FittedSkullPiece => {
      const geometry = raw.clone();
      geometry.setAttribute('position',new THREE.BufferAttribute(result.positions[index]!,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(result.normals[index]!,3));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      geometry.userData.anatomicalSkull = true;
      const box = geometry.boundingBox!, pivot = box.getCenter(new THREE.Vector3());
      whole.union(box);
      const debrisGeometry = geometry.clone().translate(-pivot.x,-pivot.y,-pivot.z);
      return { id, geometry, debrisGeometry, pivot:pivot.toArray() as Vec3,
        min:box.min.toArray() as Vec3, max:box.max.toArray() as Vec3,
        positions:geometry.getAttribute('position').array, indices:geometry.getIndex()!.array };
    });
    const geometry = mergeGeometries(pieces.map(p=>p.geometry),false)!;
    geometry.userData.anatomicalSkull = true;
    geometry.computeBoundingSphere();
    head = { pieces, fit:{ name, result, min:whole.min.toArray() as Vec3, max:whole.max.toArray() as Vec3 },
      mesh: { key:`${key}:anatomical-skull-1`, geometry,
        verts:geometry.getAttribute('position').count, tris:geometry.getIndex()!.count/3,
        bakeMs:result.ms, overflow:false, clamped:false, droppedQuads:0 } };
    this.#fitted.set(key,head);
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

export async function loadAnatomicalSkull(url = ANATOMICAL_SKULL_URL, fit: SkullFitName = 'envelope'): Promise<AnatomicalSkullKit> {
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
  return new AnatomicalSkullKit(source,first.normalMap,first.normalScale.clone(),fit);
}

/** The fit `?skullfit=` asks for (a dev seam for comparing them): one of SKULL_FIT_NAMES, else the envelope fit. */
export function skullFitOf(search: string): SkullFitName {
  const asked = new URLSearchParams(search).get('skullfit');
  if (asked === null || asked === 'envelope') return 'envelope';
  const name = SKULL_FIT_NAMES.find(n => n === asked);
  if (!name) console.warn(`[skull] skullfit=${asked} is not a fit (${SKULL_FIT_NAMES.join(', ')}); envelope retained`);
  return name ?? 'envelope';
}

export async function createSkullMeshCache(search: string): Promise<SegmentMeshCache> {
  const selected = new URLSearchParams(search).get('skull');
  if (selected === 'sculpt' || selected === 'procedural') return new SegmentMeshCache();
  try { return new SegmentMeshCache(undefined,await loadAnatomicalSkull(ANATOMICAL_SKULL_URL,skullFitOf(search))); }
  catch (error) {
    console.warn('[skull] anatomical asset failed; sculpted skull retained',error);
    return new SegmentMeshCache();
  }
}
