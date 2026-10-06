// src/lab/sdf-zombie/webgpu/game-mesh-gibs.ts
//
// MESH GIBS (melee head damage, plan Task 11; spec §14 decision 3). A plain three mesh riding the SAME gib
// physics as the SDF chunks: a gib-chunks `Chunk` built with makeChunk, stepped with stepChunk against
// chunkCollidersAt in the chunk loop (game-main, next to the SDF chunk step), and posed from it every frame —
// position, rotation and the landing squash (squashFactors, world axes after the rotation, the chunkPoint
// transform). Used by the modelled brain and anatomical skull fragments.
//
// The list lives on ctx.gibs.meshGibs, with separate bounded pools for skull plates and other meshes.
// rebuildCast clears them all. Brain meshes share their owner's geometry/material; skull fragments own
// their geometry (including light rows) and dispose it on removal, while retaining the shared material.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { MeshGibOpts } from './game-state-boot';
import type { MeshGib } from './game-state-gibs';
import type { Vec3 } from '../types';
import { chunkSettled, makeChunk, squashFactors, stepChunk } from '../gib-chunks';
import { chunkCollidersAt } from './game-world-leaves';

export const MESH_GIB_CAP = 8;
/** A complete skull has fourteen plates; keep its pool separate from brains. */
export const SKULL_GIB_CAP = 32;

const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Pose the object from its chunk: T(pos) · S(squash, world axes) · R(quat). */
function pose(g: MeshGib): void {
  const c = g.state;
  _q.set(c.quat[0], c.quat[1], c.quat[2], c.quat[3]);
  _m.makeRotationFromQuaternion(_q);
  const { sx, sy, sz } = squashFactors(c);
  _m.premultiply(_s.makeScale(sx, sy, sz));
  _m.setPosition(c.pos[0], c.pos[1], c.pos[2]);
  g.object.matrix.copy(_m);
  g.object.matrixWorldNeedsUpdate = true;
}

function remove(ctx: GameContext, g: MeshGib): void {
  ctx.boot.deferredApi?.router.unregister(g.object);
  g.object.removeFromParent();
  if(g.tag==='skull')g.object.traverse(o=> {
    const mesh=o as THREE.Mesh;
    if(mesh.isMesh && mesh.geometry.userData.ownedSkullDebris)mesh.geometry.dispose();
  });
}

/** ctx.boot.spawnMeshGib: add `object` to the scene riding a new chunk. */
export function spawnMeshGib(
  ctx: GameContext, object: THREE.Object3D, pos: Vec3, vel: Vec3, angVel: Vec3, radius: number, opts?: MeshGibOpts,
): void {
  // A fixed rng: the tumble draw is overridden by `angVel`, and must not consume rngStreams.misc.
  const state = makeChunk('head', [...pos] as Vec3, [...vel] as Vec3, radius, opts?.longAxis ?? [0, 1, 0], () => 0.5, 'gob',
    { angVel: [...angVel] as Vec3 }, opts?.support);
  if (opts?.restitution !== undefined) state.restitution = opts.restitution;
  object.matrixAutoUpdate = false;
  ctx.boot.handle.scene.add(object);
  ctx.boot.deferredApi?.router.register(object, 'mesh', 'level-only');
  const g: MeshGib = { state, object, tag: opts?.tag ?? 'mesh' };
  pose(g);
  ctx.gibs.meshGibs.push(g);
  const cap = g.tag === 'skull' ? SKULL_GIB_CAP : MESH_GIB_CAP;
  const samePool = (q: MeshGib) => (q.tag === 'skull') === (g.tag === 'skull');
  while (ctx.gibs.meshGibs.filter(samePool).length > cap) {
    const index = ctx.gibs.meshGibs.findIndex(samePool);
    remove(ctx,ctx.gibs.meshGibs.splice(index,1)[0]!);
  }
}

/** One physics step for every mesh gib (a settled one is left alone: nothing about it can change). */
export function stepMeshGibs(ctx: GameContext, dt: number): void {
  for (const g of ctx.gibs.meshGibs) {
    if (chunkSettled(g.state)) continue;
    g.state = stepChunk(g.state, dt, chunkCollidersAt(ctx, g.state.pos));
    pose(g);
  }
}

/** Take every mesh gib out of the scene (a cast rebuild / level reset). */
export function clearMeshGibs(ctx: GameContext): void {
  for (const g of ctx.gibs.meshGibs) remove(ctx, g);
  ctx.gibs.meshGibs.length = 0;
}
