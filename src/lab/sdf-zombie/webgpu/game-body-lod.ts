// src/lab/sdf-zombie/webgpu/game-body-lod.ts
//
// DISTANCE MESH LOD, the game's half (spike 2026-11-08): the config from the URL, the per-frame step after the cull,
// the march's question (bodyLodMeshed), and the __sdfGame seams. Rule and band: ../body-lod.ts; drawing:
// body-lod-view.ts.
//
//   ?bodylod=0            today: every body marched (the A/B "off")
//   ?bodylodm=10          switch distance, metres from the camera to the torso centre
//   ?bodylodh=1           hysteresis band width, metres
//   ?bodylodwound=keep    the "show nothing until near" A/B (default 'refine': the first wound sends it back to SDF)
//   ?bodylodlook=flesh    bake WITH the body's surface response, as gib chunks do (darker; default 'corpse', as baked corpses)
//
//   __sdfGame.bodyLod()                    tier info (meshed ids, refined ids, per-type bake stats, config)
//   __sdfGame.setBodyLod({ on, switchM, hysteresisM, wound, look })   (a new look bakes each type again)
//   __sdfGame.bodyLodStage(name, rows)     line-up for sheets: rows of [x, z] spawn points (arena only)
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { createBodyLodView, type BodyLodView } from './body-lod-view';
import { bodyLodConfigFrom, type BodyLodConfig } from '../body-lod';
import { spawnEnemy } from './game-spawn';
import { sdPrimitive } from '../validate';

let view: BodyLodView | null = null;
let cfg: BodyLodConfig = bodyLodConfigFrom('');

export function installBodyLod(ctx: GameContext, material: () => THREE.Material): void {
  cfg = bodyLodConfigFrom(location.search);
  const group = new THREE.Group();
  group.name = 'body-lod';
  ctx.boot.handle.scene.add(group);
  ctx.boot.deferredApi?.router.register(group, 'mesh', 'level-only');
  view = createBodyLodView(group, material, a => ctx.vfx.burning?.registry.has(a) ?? false);
  const dispose = () => view?.clear();
  window.addEventListener('pagehide', dispose);
  import.meta.hot?.dispose(() => { dispose(); window.removeEventListener('pagehide', dispose); });
}

/** Is this body drawn by its type mesh this frame (so the march must skip it)? */
export function bodyLodMeshed(id: number): boolean {
  return view !== null && view.meshed(id);
}

const showProxy = (a: ZombieActor, on: boolean) => {
  if (a.crowd) return;     // a crowd member's proxy belongs to the crowd path (game-main's vis set)
  a.view.object.visible = on;
  a.view.coneObject.visible = on;
  if (a.view.depthPreObject) a.view.depthPreObject.visible = on;
  if (!on && a.view.refineObject) a.view.refineObject.visible = false;
};

/** After updateVisibleActors: tiers, bakes, poses; hide the meshed bodies' per-body proxies, show the restored. */
export function stepBodyLod(ctx: GameContext): void {
  if (!view) return;
  const eye = ctx.world.sightA as unknown as Vec3;
  view.update(ctx.world.actors, new Set(ctx.render.visibleActors), [eye[0], eye[1], eye[2]], cfg);
  for (const a of view.takeRestored()) showProxy(a, true);
  for (const a of ctx.world.actors) if (view.meshed(a.id)) showProxy(a, false);
}

export function createBodyLodSeams(ctx: GameContext) {
  return {
    bodyLod: () => ({ config: { ...cfg }, ...(view?.info() ?? {}) }),
    /** Debug: skin every vertex of body `id`'s mesh on the CPU and measure it against the posed SDF body; the worst few. */
    bodyLodProbe: (id: number) => {
      const mesh = view?.instance(id);
      const a = ctx.world.actors.find(q => q.id === id);
      if (!mesh || !a) return null;
      const pos = mesh.geometry.getAttribute('position');
      const si = mesh.geometry.getAttribute('skinIndex'), sw = mesh.geometry.getAttribute('skinWeight');
      mesh.skeleton.update();
      const v = new THREE.Vector3();
      const prims = a.posed().prims.filter(p => !p.dead && p.op !== 'sub');
      const worst: { i: number; err: number; at: number[]; bones: string[]; w: number[] }[] = [];
      const names = (mesh.userData.boneNames as string[] | undefined) ?? [];
      for (let i = 0; i < pos.count; i += 7) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        let err = Infinity;
        for (const p of prims) err = Math.min(err, sdPrimitive([v.x, v.y, v.z], p));
        worst.push({ i, err, at: [v.x, v.y, v.z].map(x => +x.toFixed(2)), bones: [0, 1, 2, 3].map(k => names[si.getComponent(i, k)] ?? String(si.getComponent(i, k))),
          w: [0, 1, 2, 3].map(k => +sw.getComponent(i, k).toFixed(2)) });
      }
      worst.sort((x, y) => y.err - x.err);
      const errs = worst.map(w => w.err).sort((x, y) => x - y);
      return { p50: errs[errs.length >> 1], p95: errs[Math.floor(errs.length * 0.95)], worst: worst.slice(0, 6) };
    },
    setBodyLod: (patch: Partial<BodyLodConfig>) => { cfg = { ...cfg, ...patch }; return { ...cfg }; },
    /** A line-up for the A/B sheets (arena): spawn `name` at each [x, z] (the arena's room), return their ids. */
    bodyLodStage: (name: string, rows: [number, number][]) => {
      const room = ctx.world.level.rooms[0]!;
      const errs: string[] = [];
      const ids: number[] = [];
      for (const [x, z] of rows) {
        const a = spawnEnemy(ctx, name, room, [x, 0, z], errs);
        ctx.world.actors.push(a);
        ids.push(a.id);
      }
      return { ids, errs };
    },
  };
}
