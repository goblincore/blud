import * as THREE from 'three/webgpu';
import type { ZombieActor } from './game-actor';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import { woundWorldPos, woundCarveNormal } from '../damage';
import { createChunkBakeJobs } from './chunk-bake-jobs';
import { unpackChunkBake } from './chunk-bake-buffers';
import type { ChunkBakeData } from './chunk-bake-geometry';

/** Keep the small, textured head on the exact SDF shader (face + red eyes).
 * The much larger torso/limb proxy becomes a static mesh. Array indices stay
 * intact, so wound ownership and rest-space projection cannot be scrambled. */
export function corpsePartition(body: BuildResult, head: boolean): BuildResult {
  return { ...body, clusters: body.clusters.map(c => ({ ...c, alive: c.alive && (c.limb === 'head') === head })),
    prims: body.prims.map(p => ({ ...p, dead: p.dead || (p.limb === 'head') !== head })),
    bonePrims: body.bonePrims?.filter(p => !p.dead && (p.limb === 'head') === head) };
}

export function soldierCorpseSnapshot(actor: ZombieActor): ChunkBakeData | null {
  const body = corpsePartition(actor.posed(), false);
  const active = body.prims.filter(p => !p.dead && p.op !== 'sub' && body.clusters.some(c => c.alive && c.id === p.cluster));
  if (!active.length) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of active) {
    const r = Math.max(p.radius, p.radiusB ?? 0) * Math.max(...p.scale) + p.blendK * 2 + .025 + Math.hypot(...(p.bend ?? [0,0,0]));
    for (let k=0;k<3;k++) { lo[k]=Math.min(lo[k]!,p.a[k]!-r,p.b[k]!-r); hi[k]=Math.max(hi[k]!,p.a[k]!+r,p.b[k]!+r); }
  }
  const centre = [0,1,2].map(k=>(lo[k]!+hi[k]!)/2) as unknown as Vec3;
  const halfExtent = [0,1,2].map(k=>(hi[k]!-lo[k]!)/2) as unknown as Vec3;
  const u = actor.view.uniforms;
  const col = (v: {r:number;g:number;b:number}): Vec3 => [v.r,v.g,v.b];
  return {
    body, flesh: body.prims, bones: body.bonePrims ?? [], centre, halfExtent,
    extent: Math.max(...halfExtent), cellSize: .015, quat: [0,0,0,1], gore: 0,
    carveK: u.woundCfg.value.y,
    torn: actor.wounds().filter(w => body.prims[w.primIdx]?.limb !== 'head').map(w => {
      const prim = body.prims[w.primIdx];
      const owner = body.clusters.find(c => c.id === prim?.cluster);
      return { at: woundWorldPos(body.prims,w,actor.pose().yaw), radius:w.radius,
        normal: woundCarveNormal(body.prims,w,actor.pose().yaw) ?? undefined, depth:w.carveDepth,
        owner: owner ? { prims:body.prims, clusters:[{...owner,alive:true}] } : undefined };
    }),
    look: { baseColor:col(u.baseColor.value),deepColor:col(u.deepColor.value),fatColor:col(u.fatColor.value),
      mottleColor:col(u.mottleColor.value),organColor:col(u.organColor.value),visceraColor:col(u.visceraColor.value),
      woundDepthAmp:u.surfCfg3.value.x,fatDepth:u.surfCfg3.value.y,muscleDepth:u.surfCfg3.value.z,
      visceraAmp:u.surfCfg3.value.w,visceraDepth:u.visceraDepth.value,mottleAmp:u.surfCfg2.value.z,
      mottleScale:u.surfCfg2.value.w,organAmp:u.organAmp.value,goreStrength:0 },
  };
}

/** One worker, one pending corpse; bounded by the current actor list.
 * Damage revisions invalidate both in-flight and completed snapshots. */
export function createSoldierCorpseBakes(scene: THREE.Scene, material: () => THREE.Material,
  factory = () => new Worker(new URL('./chunk-bake.worker.ts',import.meta.url),{type:'module'})) {
  const jobs = createChunkBakeJobs(factory);
  type Entry = { actor:ZombieActor; revision:number; mesh?:THREE.Mesh };
  const entries = new Map<number,Entry>();
  const quiet = new Map<number,{revision:number;seconds:number}>();
  const rejected = new Map<number,number>();
  let enabled = true;
  const restore = (entry:Entry) => {
    if (entry.mesh) { scene.remove(entry.mesh); entry.mesh.geometry.dispose(); }
    entry.actor.pauseForBake(false);
    entry.actor.view.update(entry.actor.posed(),entry.actor.body);
    entry.actor.view.object.visible = true;
    entry.actor.view.coneObject.visible = true;
    if (entry.actor.view.depthPreObject) entry.actor.view.depthPreObject.visible = true;
    entries.delete(entry.actor.id); quiet.delete(entry.actor.id);
  };
  const clear = () => { jobs.cancel(); for (const entry of [...entries.values()]) restore(entry); quiet.clear(); rejected.clear(); };
  return {
    update(actors:readonly ZombieActor[],dt:number) {
      for (const entry of [...entries.values()]) {
        if (!actors.includes(entry.actor) || entry.revision !== entry.actor.damageRevision() || !enabled) {
          if (jobs.pendingId === entry.actor.id) jobs.cancel();
          restore(entry);
        }
      }
      for (const id of quiet.keys()) if (!actors.some(a=>a.id===id)) quiet.delete(id);
      const done = jobs.takeCompleted();
      if (done) {
        const entry = entries.get(done.id);
        if (entry) {
          const baked = unpackChunkBake(done.result);
          if (baked.overflow || baked.droppedQuads || !baked.verts) { baked.geometry.dispose(); rejected.set(entry.actor.id,entry.revision); restore(entry); }
          else {
            entry.mesh = new THREE.Mesh(baked.geometry,material());
            scene.add(entry.mesh);
            const head = corpsePartition(entry.actor.posed(),true);
            const hasHead = head.clusters.some(c=>c.alive);
            if (hasHead) entry.actor.view.update(head,entry.actor.body);
            entry.actor.view.object.visible = hasHead;
            entry.actor.view.coneObject.visible = hasHead;
            if (entry.actor.view.depthPreObject) entry.actor.view.depthPreObject.visible = hasHead;
          }
        }
      }
      if (jobs.error) { for (const entry of [...entries.values()]) if (!entry.mesh) restore(entry); }
      if (!enabled || jobs.error) return;
      for (const actor of actors) {
        if (entries.has(actor.id) || rejected.get(actor.id) === actor.damageRevision()) continue;
        if (!actor.corpseBakeEligible()) { quiet.delete(actor.id); continue; }
        const revision = actor.damageRevision();
        const prior = quiet.get(actor.id);
        const seconds = (prior?.revision === revision ? prior.seconds : 0) + dt;
        quiet.set(actor.id,{revision,seconds});
        if (seconds < 1.5 || jobs.pendingId !== null) continue;
        const data = soldierCorpseSnapshot(actor);
        if (!data) rejected.set(actor.id,revision);
        if (data && jobs.submit(actor.id,data)) { actor.pauseForBake(true); entries.set(actor.id,{actor,revision}); }
      }
    },
    setEnabled(on:boolean) { enabled=on; if(!on) clear(); },
    stats: () => ({enabled,pending:jobs.pendingId,baked:[...entries.values()].filter(e=>e.mesh).map(e=>e.actor.id),error:jobs.error}),
    dispose: clear,
  };
}
