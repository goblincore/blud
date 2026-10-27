// src/lab/sdf-zombie/webgpu/kit-occluder.ts
//
// KIT OCCLUSION (owner, 2026-10-26: "not render the flesh if clothes is over it, also a performance enhancer").
//
// Every opaque cloth, boot and leather mesh of a kit gets a TWIN: the same geometry (and, for a skinned kit, the same
// skeleton and bind) drawn with a material that writes the camera DISTANCE, on KIT_OCCLUDER_LAYER. Pass 1c of the SDF
// layer rasterises the twins into the occT target, and the march stops every ray there (ray-window block, tMaxOcc). A
// pixel of flesh under a trouser leg then costs a handful of steps from the outer hull to the cloth and no shading at
// all, where it used to march to the skin and shade it only for the cloth to win the depth test.
//
// WHY A TWIN AND NOT THE KIT MESH ITSELF on a second layer: the kit's material writes lit colour, and the pass needs
// the distance in the red channel. A per-pass material swap is the pipeline-rebuild trap SHELL_EXIT_LAYER documents.
//
// CORRECTNESS is the occluder's old argument turned inside out. The hull is INSIDE the flesh, so every true hit is
// nearer than it; cloth is OUTSIDE, so a hit behind it is real but hidden, and the real cloth's depth already hides
// it. Flesh poking through in front of the cloth is hit before tMax and still shows. Hence the eligibility rules:
//  - opaque only (no transparency, no alpha cut-outs), or the "hidden" flesh would show through and be missing;
//  - never kit flesh (kit-flesh.ts), glass or emissive parts: named cloth-like materials only, an allow-list, so a
//    new material is not an occluder until someone decides it covers flesh;
//  - FrontSide twins: the kit draws DoubleSide, so every front face the twin rasterises is a face the kit shows.
//
// A SHED PIECE LEAVES THE TARGET for free: kit-damage hides a piece by rewriting its source geometry's index (and the
// mesh's visibility when nothing is left), the twin draws that same geometry, and it is the source's CHILD, so a hidden
// source hides its twin. sync() re-points the twin if the source's geometry object is ever replaced.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, length, max, positionWorld, sub, uniform, vec4 } from 'three/tsl';
import { KIT_OCCLUDER_LAYER } from './sdf-layer';

/** Kit material names that are opaque and cover flesh (kit-overlay.ts LOOK). */
export const KIT_OCCLUDER_MATERIALS: ReadonlySet<string> = new Set(['cloth', 'boot', 'leather', 'tee', 'shorts', 'shoe']);

/** True when `mesh` may stand in front of flesh in the occT target. Pure: no renderer. */
export function kitOccluderEligible(mesh: THREE.Object3D): mesh is THREE.Mesh {
  const m = mesh as THREE.Mesh;
  if (!m.isMesh || Array.isArray(m.material) || !m.material) return false;
  if (m.userData['kitFlesh'] || m.userData['kitOccluderTwin']) return false;
  const mat = m.material as THREE.MeshStandardMaterial;
  if (!KIT_OCCLUDER_MATERIALS.has(mat.name)) return false;
  if (mat.transparent || mat.opacity < 1 || mat.alphaTest > 0 || mat.alphaMap || mat.side === THREE.BackSide) return false;
  return mat.visible && mat.colorWrite && mat.depthWrite && mat.depthTest;
}

/**
 * How far IN FRONT of the cloth the twin writes its distance (metres). The cloth lies on the flesh (a centimetre
 * or less off the skin), and the march accepts a hit within its footprint epsilon of the surface, so with the bound
 * AT the cloth almost every covered ray still lands its hit a few millimetres short of it: measured in the arena
 * (march debug, x-ray), under the trousers the accepted hits sat 0-5 mm and 5-20 mm in front of the cloth distance.
 * Those hits tie or lose the depth test to the cloth anyway, and they are the shading this exists to skip. The
 * price: flesh standing less than this in front of opaque cloth (a hand flat on a thigh) is cut where it is that
 * close, and the cloth shows there instead.
 */
export const KIT_OCCLUDER_INSET = 0.02;
const uInset = uniform(KIT_OCCLUDER_INSET);
/** Live A/B of the inset (metres, >= 0). Returns the value in force. */
export function setKitOccluderInset(m: number): number { uInset.value = Math.max(0, m); return uInset.value; }

let shared: MeshBasicNodeMaterial | null = null;

/** ONE distance material for every twin of every kit: one node build, and skinning variants share it. Never disposed
 *  by a kit (KitOccluders.dispose leaves it alone). */
function twinMaterial(): MeshBasicNodeMaterial {
  if (shared) return shared;
  const material = new MeshBasicNodeMaterial();
  material.name = 'kit-occluder';
  // The ray parameter the march compares against, as the inner hull writes it (occluder-hull.ts).
  // Minus the inset, floored above zero: zero is occFetch's "nothing here" sentinel.
  const dist = max(sub(length(sub(positionWorld, cameraPosition)), uInset), float(1e-3));
  material.colorNode = vec4(dist, dist, dist, 1);
  // FOG OFF, always: fog mixed into this number was the 2026-09 "distance decay" (shell-hull-outer.ts makeMaterial).
  material.fog = false;
  material.side = THREE.FrontSide;
  material.depthWrite = true;
  material.depthTest = true;
  shared = material;
  return material;
}

export interface KitOccluders {
  /** The twins, one per eligible kit mesh. */
  readonly twins: readonly THREE.Mesh[];
  /** Re-point twins whose source geometry object was replaced. Cheap; call once per pose. */
  sync(): void;
  /** Detach the twins. Leaves the shared geometry (the kit owns it) and the shared material alone. */
  dispose(): void;
}

/** Builds a twin for every eligible mesh under `root` (kitOccluderEligible), as a child of its source. */
export function addKitOccluders(root: THREE.Object3D): KitOccluders {
  const sources: THREE.Mesh[] = [];
  root.traverse(o => { if (kitOccluderEligible(o)) sources.push(o); });
  const material = twinMaterial();
  const twins = sources.map(src => {
    let twin: THREE.Mesh;
    const skinned = src as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(src.geometry, material);
      s.bindMode = skinned.bindMode;
      s.bind(skinned.skeleton, skinned.bindMatrix);
      twin = s;
    } else {
      twin = new THREE.Mesh(src.geometry, material);
    }
    twin.name = `${src.name || src.uuid}:occluder`;
    twin.userData['kitOccluderTwin'] = true;
    twin.layers.set(KIT_OCCLUDER_LAYER);
    twin.castShadow = false;
    twin.receiveShadow = false;
    // A skinned kit's culling sphere is refreshed in place every pose (kit-bounds.ts): sharing the object keeps the
    // twin's culling exact for free. Without one, never cull (three would skin every vertex on the CPU to make one).
    const sphere = (src as THREE.Mesh & { boundingSphere?: THREE.Sphere | null }).boundingSphere;
    if (skinned.isSkinnedMesh) {
      if (sphere) (twin as THREE.SkinnedMesh).boundingSphere = sphere;
      else twin.frustumCulled = false;
    } else {
      twin.frustumCulled = src.frustumCulled;
    }
    // A child at identity: the source's world matrix, and the source's visibility (three skips a hidden subtree).
    src.add(twin);
    return twin;
  });
  return {
    twins,
    sync() {
      for (let i = 0; i < twins.length; i++) {
        const g = sources[i]!.geometry;
        if (twins[i]!.geometry !== g) twins[i]!.geometry = g;
      }
    },
    dispose() {
      for (const t of twins) t.removeFromParent();
    },
  };
}
