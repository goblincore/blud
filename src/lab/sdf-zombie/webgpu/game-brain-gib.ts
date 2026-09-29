// src/lab/sdf-zombie/webgpu/game-brain-gib.ts
//
// THE BRAIN MESH (melee head damage, plan Task 11; spec §14 decision 3). The head damage's brain stage throws
// a modelled brain — public/assets/lab/brain.glb, made by scripts/model_brain.py: two hemispheres with
// reaction-diffusion gyri and sulci, a cerebellum with folia and a stem, 7.3k tris, its folds baked into a
// normal map and an albedo map (crowns pink-grey, sulci darker and redder) — riding the gib physics as a
// mesh (game-mesh-gibs.ts through ctx.boot.spawnMeshGib).
//
// This leaf owns loading the GLB ONCE (at boot, async) and cloning its mesh per throw; the clones share the
// geometry and one material per light list. THE MATERIAL: a wet MeshPhysicalNodeMaterial — the baked albedo
// and normal map, roughness 0.3, a clearcoat (the wet film) and a pink sheen (the soft tissue's velvet),
// lit by the scene like the level: in the forward path its lightsNode is the level's own list for the room
// the brain is thrown in (the room's lights + its probe lighting, game-main "LEVEL SURFACES"), and it joins
// ctx.world.levelNodeMaterials so refreshLevelLights rebuilds it with them. Deferred mode leaves lighting to
// the deferred stage (game-mesh-gibs registers the mesh with the router).
//
// Until the GLB has loaded (or if it failed), throw() returns false and the caller falls back to the SDF
// brain piece (head-crown brainPiece).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import { BRAIN_MESH } from '../head-crown';

export const BRAIN_GLB = '/assets/lab/brain.glb';

/** The wet material's numbers (spec §14: roughness ~0.3 plus a clearcoat or sheen; base in the
 *  #c98b8b-#b98a8f family, carried by the baked albedo). */
export const BRAIN_LOOK = {
  /** The material colour, multiplying the baked albedo. The scene's lights are calibrated for the SDF
   *  shading and the level's dark textures: under the torch a three material at the model's albedo (~0.58)
   *  rendered pure white — no folds, no colour (measured at 1, 0.15 and 0.05 on the floor in the beam; the
   *  flail hit the same wall, FLAIL_LOOK.flashFill). 0.13 read bubblegum pink; at 0.09 (a touch cool, to grey
   *  it) the brain reads pink-grey with its folds, beside the zombie's own flesh. */
  albedo: [0.09, 0.088, 0.095] as const,
  roughness: 0.3,
  clearcoat: 0.35,
  /** 0.12 sparkled: the baked folds are finer than a pixel at 1-2 m, and a sharp coat aliased on them. */
  clearcoatRoughness: 0.22,
  sheen: 0.25,
  sheenColor: 0xb89a9e,
  sheenRoughness: 0.5,
} as const;

export interface BrainGibDeps {
  /** The level's light list for the room at `pos` (forward path), or null (deferred / no level lists). */
  lightsAt(pos: Vec3): THREE.LightsNode | null;
}

export interface BrainGibLeaf {
  /** Throw one brain from `pos` (the mesh origin) with `vel` and `angVel`. False: the GLB is not ready. */
  throw(pos: Vec3, vel: Vec3, angVel: Vec3): boolean;
  /** True once the GLB has loaded. */
  ready(): boolean;
}

export function createBrainGib(ctx: GameContext, deps: BrainGibDeps): BrainGibLeaf {
  let source: THREE.Mesh | null = null;
  let base: THREE.MeshPhysicalNodeMaterial | null = null;
  const perList = new Map<THREE.LightsNode | null, THREE.MeshPhysicalNodeMaterial>();

  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(BRAIN_GLB);
      let found: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh && o.name === 'Brain') found = o as THREE.Mesh; });
      if (!found) throw new Error('brain.glb has no Brain mesh node');
      const mesh = found as THREE.Mesh;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const m = new THREE.MeshPhysicalNodeMaterial({
        color: new THREE.Color(...BRAIN_LOOK.albedo),
        map: src.map ?? null,
        normalMap: src.normalMap ?? null,
        roughness: BRAIN_LOOK.roughness,
        metalness: 0,
        clearcoat: BRAIN_LOOK.clearcoat,
        clearcoatRoughness: BRAIN_LOOK.clearcoatRoughness,
        sheen: BRAIN_LOOK.sheen,
        sheenColor: new THREE.Color(BRAIN_LOOK.sheenColor),
        sheenRoughness: BRAIN_LOOK.sheenRoughness,
        side: THREE.FrontSide,
      });
      // GLTFLoader flips normalScale.y for a mesh without tangents: keep its convention.
      if (src.normalScale) m.normalScale.copy(src.normalScale);
      m.name = 'brain-wet';
      base = m;
      mesh.geometry.computeBoundingSphere();
      source = mesh;
    } catch (e) {
      console.warn('[brain-gib] brain.glb absent or unreadable — the brain stage throws the SDF brain', e);
    }
  })();

  function materialFor(pos: Vec3): THREE.Material {
    const list = ctx.boot.deferredMode ? null : deps.lightsAt(pos);
    let m = perList.get(list);
    if (!m) {
      m = list ? base!.clone() as THREE.MeshPhysicalNodeMaterial : base!;
      if (list) {
        m.lightsNode = list;
        ctx.world.levelNodeMaterials.push(m);
      }
      perList.set(list, m);
    }
    return m;
  }

  return {
    ready: () => source !== null,
    throw(pos, vel, angVel) {
      if (!source || !ctx.boot.spawnMeshGib) return false;
      const mesh = new THREE.Mesh(source.geometry, materialFor(pos));
      mesh.name = 'brain-gib';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      ctx.boot.spawnMeshGib(mesh, pos, vel, angVel, BRAIN_MESH.radius,
        { support: BRAIN_MESH.support, longAxis: BRAIN_MESH.longAxis, restitution: BRAIN_MESH.restitution, tag: 'brain' });
      return true;
    },
  };
}
