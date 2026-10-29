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
//
// The meshes are POOLED (meat-pool.ts, `?meatpool=0` for a new mesh a chunk): kept for good by variant, size bucket
// and material, handed back out on the next throw, and pre-warmed (made and drawn once) in the play-step prewarm.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { GoreTuning } from '../gore-tuning';
import { FLESH_BITS } from '../flesh-bits';
import { shotFixEnabled } from '../body-field';
import { createKeyedPool, meatPoolEnabled, meatPoolKey, MEAT_WARM_PER_KEY } from '../meat-pool';

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
/** The drawn size bucket of a chunk thrown at SDF-bit radius `r`. */
export function meatSize(r: number): number {
  return Math.max(SIZE_STEP, Math.round(r * MEAT_LOOK.sizePerRadius / SIZE_STEP) * SIZE_STEP);
}
/** Every size bucket a body's gun craters can throw (flesh-bits.ts: radius FLESH_BITS.size x the kind's scale). */
export function meatSizesFor(gore: GoreTuning | null | undefined): number[] {
  const out = new Set<number>();
  for (const c of Object.values(gore?.chunks ?? {})) {
    if (!c) continue;
    const lo = meatSize(FLESH_BITS.size[0] * c.scale), hi = meatSize(FLESH_BITS.size[1] * c.scale);
    for (let s = lo; s <= hi + 1e-9; s += SIZE_STEP) out.add(meatSize(s / MEAT_LOOK.sizePerRadius));
  }
  return [...out];
}

export interface MeatGibLeaf {
  /** Throw one torn chunk from `pos` with `vel` and `angVel`, `r` the size an SDF bit would have had. False: the GLB
   *  is not ready. */
  /** `from`: SECTOR levels (plan 3b), the body centre the spawn is clamped inside the level from. */
  throw(pos: Vec3, vel: Vec3, angVel: Vec3, r: number, from?: Vec3 | null): boolean;
  ready(): boolean;
  /** The mesh pool (meat-pool.ts): meshes made, made in a throw (a pool miss: a new render object in the gore
   *  frame), handed back out. */
  poolStats(): { made: number; missed: number; reused: number };
  /** Draw the chunk material once (degenerate, far below the floor) for one live body's room light list that has
   *  not had it yet; take out the last step's warm mesh. Called every step. */
  prewarm(): void;
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

  // PRE-WARM (teratoma first-hit freeze, 2026-10-28): the first torn chunk in a room built its material's pipeline in
  // the frame of the hit. Each live body's room list is drawn once, one a step, as a point far below the floor.
  const warmedLists = new Set<THREE.LightsNode | null>();
  let warmMesh: THREE.Mesh | null = null;

  // THE MESH POOL (meat pool pass, 2026-10-29; meat-pool.ts): a chunk mesh is kept for good and handed back out by
  // (variant, size bucket, material), so its render object (three keys it by object + material) is built once. The
  // pre-warm makes and draws MEAT_WARM_PER_KEY of each key the live bodies can throw. `?meatpool=0`: a new mesh a
  // chunk, as before.
  const pool = createKeyedPool<THREE.Mesh>();
  let missed = 0, reused = 0;
  const matIds = new WeakMap<THREE.Material, number>();
  let nextMatId = 0;
  const matId = (m: THREE.Material): number => { let id = matIds.get(m); if (id === undefined) { id = nextMatId++; matIds.set(m, id); } return id; };
  const giveBack = (o: THREE.Object3D): void => { pool.give(o as THREE.Mesh); };
  /** A warm mesh drawn this step that goes on the free list next step (it was made for the pool). */
  let warmPooled = false;
  /** The light list each actor's keys were last all warmed for (an actor that changes room is warmed again). */
  const warmedFor = new WeakMap<object, THREE.LightsNode | null>();
  const meshFor = (v: number, size: number, mat: THREE.Material): { mesh: THREE.Mesh; key: string; fresh: boolean } => {
    const key = meatPoolKey(v, size, matId(mat));
    const old = pool.take(key);
    if (old) return { mesh: old, key, fresh: false };
    const mesh = new THREE.Mesh(scaled(v, size), mat);
    mesh.name = 'meat-gib';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    pool.adopt(key, mesh);
    return { mesh, key, fresh: true };
  };
  /** The pool's warm: one missing key a step, nearest body first; true when it drew one. */
  function warmPoolStep(): boolean {
    const eye = ctx.boot.handle.camera.position;
    const actors = ctx.world.actors.filter(a => {
      const list = ctx.boot.deferredMode ? null : deps.lightsAt(a.pose().pos);
      return !warmedFor.has(a) || warmedFor.get(a) !== list;
    });
    if (actors.length === 0) return false;
    const d2 = (a: (typeof actors)[number]) => { const p = a.pose().pos; return (p[0] - eye.x) ** 2 + (p[2] - eye.z) ** 2; };
    actors.sort((a, b) => d2(a) - d2(b));
    for (const a of actors) {
      const pos = a.pose().pos;
      const mat = materialFor(pos);
      for (const size of meatSizesFor(a.gore)) {
        for (let v = 0; v < variants.length; v++) {
          if (pool.made(meatPoolKey(v, size, matId(mat))) >= MEAT_WARM_PER_KEY) continue;
          const { mesh } = meshFor(v, size, mat);
          mesh.name = 'meat-warm';
          mesh.matrixAutoUpdate = true;
          mesh.position.set(0, -1000, 0);
          mesh.scale.setScalar(1e-6);
          mesh.frustumCulled = false;
          ctx.boot.handle.scene.add(mesh);
          ctx.boot.deferredApi?.router.register(mesh, 'mesh', 'level-only');
          warmMesh = mesh;
          warmPooled = true;
          return true;
        }
      }
      warmedFor.set(a, ctx.boot.deferredMode ? null : deps.lightsAt(pos));
    }
    return false;
  }

  return {
    ready: () => variants.length > 0 && base !== null,
    poolStats: () => ({ made: pool.size, missed, reused }),
    prewarm() {
      if (warmMesh) {
        ctx.boot.deferredApi?.router.unregister(warmMesh);
        warmMesh.removeFromParent();
        if (warmPooled) {
          // Into the pool as a throw would have made it (spawnMeshGib poses it by its matrix).
          warmMesh.name = 'meat-gib';
          warmMesh.frustumCulled = true;
          warmMesh.position.set(0, 0, 0);
          warmMesh.scale.setScalar(1);
          pool.give(warmMesh);
          warmPooled = false;
        }
        warmMesh = null;
      }
      if (variants.length === 0 || !base) return;
      // THE SCALED COPIES TOO (shot frame pass, 2026-10-29): each new size bucket cloned and scaled its variant's
      // geometry and uploaded the buffers in the frame of the hit (~1.7 ms for one E1M1 soldier volley). Once every
      // room list is warm, one missing copy a step is built and drawn here (below). `?shotfix=0` leaves them to the hit.
      for (const a of ctx.world.actors) {
        const pos = a.pose().pos;
        const list = ctx.boot.deferredMode ? null : deps.lightsAt(pos);
        if (warmedLists.has(list)) continue;
        warmedLists.add(list);
        const m = new THREE.Mesh(variants[0]!, materialFor(pos));
        m.name = 'meat-warm';
        m.position.set(0, -1000, 0);
        m.scale.setScalar(1e-6);
        m.frustumCulled = false;
        m.castShadow = false; m.receiveShadow = false;
        ctx.boot.handle.scene.add(m);
        ctx.boot.deferredApi?.router.register(m, 'mesh', 'level-only');
        warmMesh = m;
        return;
      }
      if (meatPoolEnabled()) { warmPoolStep(); return; }
      if (!shotFixEnabled()) return;
      for (const a of ctx.world.actors) {
        for (const size of meatSizesFor(a.gore)) {
          for (let v = 0; v < variants.length; v++) {
            if (scaledCache.has(`${v}:${size.toFixed(3)}`)) continue;
            const pos = a.pose().pos;
            const m = new THREE.Mesh(scaled(v, size), materialFor(pos));
            m.name = 'meat-warm';
            m.position.set(0, -1000, 0);
            m.scale.setScalar(1e-6);
            m.frustumCulled = false;
            m.castShadow = false; m.receiveShadow = false;
            ctx.boot.handle.scene.add(m);
            ctx.boot.deferredApi?.router.register(m, 'mesh', 'level-only');
            warmMesh = m;
            return;
          }
        }
      }
    },
    throw(pos, vel, angVel, r, from) {
      if (variants.length === 0 || !base || !ctx.boot.spawnMeshGib) return false;
      // Round-robin through the variants, so a burst of chunks never repeats one shape side by side.
      const v = next++ % variants.length;
      // The SIZE is baked into the geometry: spawnMeshGib writes the object's whole matrix (position, squash,
      // rotation; no scale) and the deferred router registers the object itself as a mesh, so neither a scaled mesh
      // nor a scaling parent survives. Sizes snap to SIZE_STEP buckets so the scaled copies stay few and shared.
      const size = meatSize(r);
      const pooled = meatPoolEnabled();
      let mesh: THREE.Mesh;
      if (pooled) {
        const got = meshFor(v, size, materialFor(pos));
        mesh = got.mesh;
        if (got.fresh) missed++; else reused++;
      }
      else {
        mesh = new THREE.Mesh(scaled(v, size), materialFor(pos));
        mesh.name = 'meat-gib';
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
      // For the seams (__sdfGame.meatChunks): the bucket, the shape and where and when it left the body.
      mesh.userData.meatSize = size;
      mesh.userData.meatVariant = v;
      mesh.userData.thrownFrom = [pos[0], pos[1], pos[2]];
      mesh.userData.thrownFrame = ctx.demo.simFrame;
      ctx.boot.spawnMeshGib(mesh, pos, vel, angVel, size * MEAT_LOOK.physicsRadius,
        { longAxis: [1, 0, 0], restitution: MEAT_LOOK.restitution, tag: 'meat', from, onRemove: pooled ? giveBack : undefined });
      return true;
    },
  };
}
