// src/lab/sdf-zombie/webgpu/kit-template.ts
//
// ONE PARSE PER KIT (2026-11-01): a kit file is fetched and parsed once; each body gets a clone of the parsed scene.
// Parsing per body cost MAP28 320 MB of array buffers (butcher 5.7, flayer 5.6, teratoma 9.4 MB a body), and a GPU copy
// of each. What a clone owns and shares:
//
//   - its own nodes, bones and skeletons: each body poses its kit by its own rig;
//   - its own materials (one clone per source material, so a kit's meshes that shared one still do): glow, the beam's
//     lightsNode and the look are written per body;
//   - the template's geometries and textures: NEVER mutate or dispose a shared geometry (isSharedKitGeometry). Whoever
//     must write to one replaces the mesh's geometry with a clone first, as kit-damage and KitOverlay.burst do. A clone
//     is not in the shared set, so it is disposed as usual.
//
// `?kitshare=0` parses per body again (the A/B).

import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const templates = new Map<string, Promise<THREE.Object3D>>();
const shared = new WeakSet<THREE.BufferGeometry>();

export function kitShareOn(search: string): boolean {
  return new URLSearchParams(search).get('kitshare') !== '0';
}

/** Which template a load uses: a kit borrowed for some of its materials drops the rest, so it is a template of its own. */
export function kitTemplateKey(url: string, only?: readonly string[]): string {
  return only ? `${url}|${[...only].sort().join(',')}` : url;
}

/** The parsed scene of `key`, loaded once however many bodies ask at once. A failed load is forgotten, so a later body retries. */
export function kitTemplate(key: string, load: () => Promise<THREE.Object3D>): Promise<THREE.Object3D> {
  let t = templates.get(key);
  if (!t) {
    t = load().then(scene => {
      scene.traverse(o => { const g = (o as THREE.Mesh).geometry; if (g) shared.add(g); });
      return scene;
    });
    t.catch(() => templates.delete(key));
    templates.set(key, t);
  }
  return t;
}

export function isSharedKitGeometry(g: THREE.BufferGeometry): boolean {
  return shared.has(g);
}

/** A body's copy of a template: own nodes, bones and materials; shared geometry and textures. */
export function cloneKitScene(template: THREE.Object3D): THREE.Object3D {
  const scene = cloneSkinned(template) as THREE.Object3D;
  const mine = new Map<THREE.Material, THREE.Material>();
  const own = (m: THREE.Material) => {
    let c = mine.get(m);
    if (!c) mine.set(m, c = m.clone());
    return c;
  };
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });
  return scene;
}
