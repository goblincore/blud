// src/lab/sdf-zombie/webgpu/game-meat-gib.ts
//
// TORN MEAT CHUNKS as mesh gibs (owner, 2026-10-24: the SDF flesh bits off the teratoma's gun craters "tend to form
// round globules rather than the more ragged chunks I'm looking for"). An SDF bit is a blend of rounded prims and can
// only ever be a globule; these are sculpted torn chunks (public/assets/lab/meat-chunks.glb, made by
// assets-source/meat-chunks/make_meat_chunks.py: lobed slabs with flat torn faces, fibre grain, frayed rims, a skin
// side, raw undersides with fat, limp strands), riding the gib physics as mesh gibs (game-mesh-gibs.ts through
// ctx.boot.spawnMeshGib, the 'meat' pool).
//
// The brain mesh (game-brain-gib.ts) is the template: the GLB loads ONCE at boot; each throw is a new Mesh sharing a
// variant's geometry and one wet material per light list (the level's list for the room it is thrown in, in the
// forward path; joined to ctx.world.levelNodeMaterials so refreshLevelLights rebuilds it). Until the GLB has loaded
// (or if it failed), throw() returns false and the caller throws the SDF flesh bits instead.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';

export const MEAT_GLB = '/assets/lab/meat-chunks.glb';

/** The wet meat material. The scene's lights are calibrated for the SDF shading: a three material at its full
 *  albedo renders white under the torch (game-brain-gib.ts BRAIN_LOOK), so `color` darkens the vertex colours.
 *  Glossy and coated: torn meat is wet. */
export const MEAT_LOOK = {
  // 0.32 rendered the chunks pale pink-grey in the lit arena (first look, 2026-10-24); 0.2 read too dark (owner).
  color: [0.27, 0.2, 0.2] as const,
  roughness: 0.34,
  clearcoat: 0.5,
  clearcoatRoughness: 0.25,
  /** A chunk's mesh is ~1 unit across; a thrown piece of size r (the SDF bit's radius) is drawn r x this across. */
  // 4.4 (was 3.2): the owner's playtest asked for the chunks "a bit larger" (2026-10-24).
  sizePerRadius: 4.4,
  /** Physics radius as a fraction of the drawn size (the chunks are slabs: they rest low). */
  physicsRadius: 0.3,
  restitution: 0.15,
} as const;

/** Size buckets (m) for the baked-scale geometry copies. */
const SIZE_STEP = 0.02;

export interface MeatGibLeaf {
  /** Throw one torn chunk from `pos` with `vel` and `angVel`, `r` the size an SDF bit would have had. False: the GLB
   *  is not ready. */
  throw(pos: Vec3, vel: Vec3, angVel: Vec3, r: number): boolean;
  ready(): boolean;
}

export interface MeatGibDeps {
  /** The level's light list for the room at `pos` (forward path), or null (deferred / no level lists). */
  lightsAt(pos: Vec3): THREE.LightsNode | null;
}

export function createMeatGib(ctx: GameContext, deps: MeatGibDeps): MeatGibLeaf {
  const variants: THREE.BufferGeometry[] = [];
  let base: THREE.MeshPhysicalNodeMaterial | null = null;
  const perList = new Map<THREE.LightsNode | null, THREE.MeshPhysicalNodeMaterial>();
  let next = 0;
  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(MEAT_GLB);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.name.startsWith('Meat')) { m.geometry.computeBoundingSphere(); variants.push(m.geometry); }
      });
      if (variants.length === 0) throw new Error('meat-chunks.glb has no Meat* meshes');
      const m = new THREE.MeshPhysicalNodeMaterial({
        color: new THREE.Color(...MEAT_LOOK.color),
        vertexColors: true,
        roughness: MEAT_LOOK.roughness,
        metalness: 0,
        clearcoat: MEAT_LOOK.clearcoat,
        clearcoatRoughness: MEAT_LOOK.clearcoatRoughness,
        side: THREE.FrontSide,
      });
      m.name = 'meat-wet';
      base = m;
    } catch (e) {
      variants.length = 0;
      console.warn('[meat-gib] meat-chunks.glb absent or unreadable: gun craters throw the SDF flesh bits', e);
    }
  })();

  /** Scaled copies of each variant, by size bucket: shared by every chunk of that variant and size. */
  const scaledCache = new Map<string, THREE.BufferGeometry>();
  function scaled(v: number, size: number): THREE.BufferGeometry {
    const key = `${v}:${size.toFixed(3)}`;
    let g = scaledCache.get(key);
    if (!g) { g = variants[v]!.clone().scale(size, size, size); g.computeBoundingSphere(); scaledCache.set(key, g); }
    return g;
  }

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
    ready: () => variants.length > 0 && base !== null,
    throw(pos, vel, angVel, r) {
      if (variants.length === 0 || !base || !ctx.boot.spawnMeshGib) return false;
      // Round-robin through the variants, so a burst of chunks never repeats one shape side by side.
      const v = next++ % variants.length;
      // The SIZE is baked into the geometry: spawnMeshGib writes the object's whole matrix (position, squash,
      // rotation; no scale) and the deferred router registers the object itself as a mesh, so neither a scaled mesh
      // nor a scaling parent survives. Sizes snap to SIZE_STEP buckets so the scaled copies stay few and shared.
      const size = Math.max(SIZE_STEP, Math.round(r * MEAT_LOOK.sizePerRadius / SIZE_STEP) * SIZE_STEP);
      const mesh = new THREE.Mesh(scaled(v, size), materialFor(pos));
      mesh.name = 'meat-gib';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      ctx.boot.spawnMeshGib(mesh, pos, vel, angVel, size * MEAT_LOOK.physicsRadius,
        { longAxis: [1, 0, 0], restitution: MEAT_LOOK.restitution, tag: 'meat' });
      return true;
    },
  };
}
