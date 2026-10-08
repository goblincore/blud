// src/lab/sdf-zombie/webgpu/skeleton-spike/anatomical-skull.ts
//
// The anatomical skull: loading its 14 plates and fitting them to a head, per character, with the eyes seated in the fitted orbits.
//
// Offline skull mesh loading and rigid-head fitting. No per-frame extraction.
//
// WHO DRAWS IT AND HOW IT IS FITTED is the kit's plan (SkullFitPlan): for each character a fit (skull-fit.ts
// SkullFitSpec), or none, and that character keeps its sculpted bone. The game's plan comes from the one resolver
// (sculpt-variant.ts resolveSkull, built into a kit by sculpt-cache.ts). A fit is made once for each head revision
// and kept: head() makes it on the first ask, and the game asks at spawn (game-spawn.ts), not when the bone first
// shows.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoneFieldSource } from './contract';
import type { SegmentMesh } from './mesh';
import type { SkullPieceSurface } from '../../skull-fracture';
import type { Vec3 } from '../../types';
import { fitSkull, skullFitParams, SKULL_FIT_NAMES, type SkullFitName, type SkullFitResult, type SkullFitSpec } from './skull-fit';
import type { MeshEyePlacement } from './mesh-eyes';
import { HUMANOIDS } from './skull-cast';
import { frontDepth, orbitEyePlacements, orbitEyeRadius, skullOrbits, type SkullOrbit } from './skull-orbits';

export { SKULL_FIT_NAMES, type SkullFitName, type SkullFitSpec };

export const ANATOMICAL_SKULL_URL = '/assets/lab/anatomical-skull.glb';
/** The humanoids the skull can be fitted to (skull-cast.ts HUMANOIDS). */
export const HUMANOID_SKULLS: ReadonlySet<string> = new Set(HUMANOIDS);
export const SKULL_PIECES = ['frontal','parietal-left','parietal-right','occipital','temporal-left','temporal-right','zygomatic-left','zygomatic-right','maxilla-left','maxilla-right','upper-teeth','mandible','cranial-base','nasal-core'] as const;
/** The plates of the face: a fit to the flesh may move them less than the cranium's (skull-fit.ts facePull). */
export const SKULL_FACE_PIECES: ReadonlySet<string> = new Set(['zygomatic-left','zygomatic-right','maxilla-left','maxilla-right','upper-teeth','mandible','nasal-core']);
/** The asset's openings, in its own assembled frame (metres): a point inside each orbit and inside the nasal
 *  opening, about 10 mm in front of the cavity's back wall, on a line from the front that meets no bone
 *  (anatomical-skull-fit.test.ts pins that on the asset). `left` is the skull's own left, +x. */
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
/** A KIT'S PLAN: the fit of each character that draws the anatomical skull (skull-fit.ts SkullFitSpec: 'envelope' is
 *  skullFitMatrix, fixed fractions of the head's bone envelope; the others size the skull to the head's flesh, and a
 *  head whose source carries no flesh gets the envelope fit under any name). Null: this character does not draw it,
 *  and keeps its sculpted bone. */
export type SkullFitPlan = (character: string) => Readonly<SkullFitSpec> | null;

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
  /** A skull fitted to the flesh: its own orbits, head-local, found on its plates as fitted (skull-orbits.ts), the
   *  one at -x first. Empty for the envelope fit. */
  orbits: SkullOrbit[];
  /** A skull fitted to the flesh: its eye seats, head-local, one in each orbit and sized from them. Null for the
   *  envelope fit, whose eyes stay where the sculpted skull seats them (mesh-eyes.ts), as they were before any skull
   *  was fitted to the flesh. */
  eyes: MeshEyePlacement[] | null;
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
  /** Every fitted skull this kit has made, in order: whose, under which fit, and the wall time it took to make
   *  (the fit, its geometry, its orbits), milliseconds. One entry per head revision: a census of what a boot paid. */
  readonly made: { character: string; fit: SkullFitName; ms: number }[] = [];
  /** One fit's name when the kit fits every humanoid alike; null for a kit with a plan of its own. */
  readonly fit: SkullFitName | null;
  readonly #plan: SkullFitPlan;
  /** `fit`: a fit's name (every humanoid of HUMANOID_SKULLS draws the skull, fitted that way), or a plan. */
  constructor(
    readonly source: readonly { id: string; geometry: THREE.BufferGeometry }[], readonly normalMap: THREE.Texture, readonly normalScale: THREE.Vector2,
    fit: SkullFitName | SkullFitPlan = 'envelope',
  ) {
    if (typeof fit === 'function') { this.fit = null; this.#plan = fit; }
    else { const spec = Object.freeze({ fit }); this.fit = fit; this.#plan = () => spec; }
  }
  /** How `character`'s skull is fitted; null for a character that does not draw the anatomical skull. */
  fitOf(character: string): Readonly<SkullFitSpec> | null { return HUMANOID_SKULLS.has(character) ? this.#plan(character) : null; }
  get size(): number { return this.#fitted.size; }
  get totals(): { verts: number; tris: number } {
    let verts=0,tris=0;
    for(const h of this.#fitted.values()){verts+=h.mesh.verts;tris+=h.mesh.tris;}
    return {verts,tris};
  }
  supports(source: BoneFieldSource): boolean { return source.segment === 'head' && this.fitOf(source.character) !== null; }
  head(source: BoneFieldSource): FittedSkull | null {
    if (!this.supports(source)) return null;
    const fleshed = this.#fleshed(source);
    if (fleshed) return fleshed;
    let head = this.#fitted.get(source.revision);
    if (head) return head;
    const began = performance.now();
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
    head = { pieces, fit:null, orbits:[], eyes:null, mesh: { key:`${source.revision}:anatomical-skull-1`, geometry, mesher:'asset',
      verts:geometry.getAttribute('position').count, tris:geometry.getIndex()!.count/3,
      bakeMs:0, overflow:false, clamped:false, droppedQuads:0 } };
    this.#fitted.set(source.revision,head);
    this.made.push({ character: source.character, fit: 'envelope', ms: performance.now() - began });
    return head;
  }
  /** The skull fitted to the head's flesh (skull-fit.ts), for a character whose fit is not the envelope's and a head
   *  whose source carries its flesh; null otherwise, and head() gives the envelope fit. Both stages run over every
   *  plate at once, and everything a FittedSkull holds is made from that one result: each plate's geometry, its debris
   *  twin, its pivot and box, the triangles a shot is tested against, the merged skull, the whole skull's box, and
   *  the orbits and eye seats, which are found on the fitted plates. The fit is the flesh's as much as the bone's
   *  (two bodies with one head bone and two faces are two fits), so it is kept under both revisions, and under the
   *  fit's own values where a character changes the named fit's. */
  #fleshed(source: BoneFieldSource): FittedSkull | null {
    const spec = this.fitOf(source.character), params = spec && skullFitParams(spec);
    const head = params ? source.flesh : undefined;
    if (!spec || !params || !head) return null;
    // The flesh the skull is fitted to: the head's, or its skin alone where the character asks.
    const flesh = spec.skin && head.skin ? head.skin : head;
    const name = spec.fit, own = spec.params || spec.eyeHs !== undefined || spec.skin ? `:${JSON.stringify([spec.params ?? null, spec.eyeHs ?? null, !!spec.skin])}` : '';
    const key = `${source.revision}|${flesh.revision}|${name}${own}`;
    let fitted = this.#fitted.get(key);
    if (fitted) return fitted;
    const began = performance.now();
    // The eye line the orbits are held on: the painted eyes' height in the face sheet's frame where the character
    // says it, else the bone envelope's.
    const eyeLine = spec.eyeHs !== undefined && head.sheet ? head.sheet.centre[1] + spec.eyeHs * head.sheet.axes[1] : skullEyeLine(source.bounds);
    const result = fitSkull(this.source.map(p => ({
      positions: p.geometry.getAttribute('position').array, normals: p.geometry.getAttribute('normal').array, face: SKULL_FACE_PIECES.has(p.id),
    })), p => flesh.distance(p), source.bounds, flesh.centre, params, params.eyes ? { ...SKULL_EYE_POINT, at: eyeLine } : SKULL_EYE_POINT);
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
    // The eyes sit in the orbits of the plates as fitted, and are sized from them: they follow whatever the fit did.
    const front = frontDepth(pieces), orbits = skullOrbits(front);
    fitted = { pieces, fit:{ name, result, min:whole.min.toArray() as Vec3, max:whole.max.toArray() as Vec3 },
      orbits, eyes: orbitEyePlacements(front, orbits, orbitEyeRadius(orbits)),
      mesh: { key:`${key}:anatomical-skull-1`, geometry, mesher:'asset',
        verts:geometry.getAttribute('position').count, tris:geometry.getIndex()!.count/3,
        bakeMs:performance.now()-began, overflow:false, clamped:false, droppedQuads:0 } };
    this.#fitted.set(key,fitted);
    this.made.push({ character: source.character, fit: name, ms: fitted.mesh.bakeMs });
    return fitted;
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

export async function loadAnatomicalSkull(url = ANATOMICAL_SKULL_URL, fit: SkullFitName | SkullFitPlan = 'envelope'): Promise<AnatomicalSkullKit> {
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
