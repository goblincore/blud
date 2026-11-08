// src/lab/sdf-zombie/webgpu/body-lod-view.ts
//
// DISTANCE MESH LOD — the rendering half (spike, 2026-11-08). See ../body-lod.ts for the rule.
//
// PER TYPE: the first intact body of a character is baked ONCE in its REST pose through the corpse bake's worker
// (chunk-bake.worker.ts: the same surface, albedo, tissue and AO the baked corpses carry), then skin-weighted on the
// main thread to the rig's bones (body-lod.ts skinWeights). The geometry is shared by every body of that character.
// PER BODY: one THREE.SkinnedMesh on that geometry with its own Skeleton. Bones are never in the scene graph: their
// matrixWorld is written each frame from rig-frames boneFrames (head position + bind->posed rotation, world space —
// the frames that pose the kit), and boneInverse is the bone's REST head, so a rest vertex v lands at
// pos_b + q_b (v - head_b) blended over its four bones. A body's rest is a translated copy of the type's
// (build-body cache + translate), so the inverses are the type's own and hold for every body.
//
// The march is told by `meshed(id)`: game-main drops those bodies from the crowd's visible slots and hides their
// per-body proxies. Kits and held props are meshes already and are not touched.
import * as THREE from 'three/webgpu';
import type { ZombieActor } from './game-actor';
import type { ChunkBakeData } from './chunk-bake-geometry';
import { createChunkBakeJobs } from './chunk-bake-jobs';
import { unpackChunkBake } from './chunk-bake-buffers';
import { bakeLookOf } from './soldier-corpse-bake';
import { boneFrames } from '../rig-frames';
import {
  bodyLodEligible, inMeshBand, restBakeBounds, skinWeights, stickyRefine,
  type BodyLodConfig, type BodyLodFacts, type BodyLodLook,
} from '../body-lod';
import type { Vec3 } from '../types';

interface TypeMesh {
  key: string;
  look: BodyLodLook;
  status: 'pending' | 'ready' | 'failed';
  geometry?: THREE.BufferGeometry;
  bones: string[];
  inverses: THREE.Matrix4[];
  liveClusters: number;
  livePrims: number;
  bakeMs?: number;
  skinMs?: number;
  verts?: number;
  tris?: number;
  reason?: string;
}

interface Instance { mesh: THREE.SkinnedMesh; type: TypeMesh }

const typeKey = (a: ZombieActor, look: BodyLodLook) => `${a.characterName()}:${a.body.prims.length}:${look}`;

function restSnapshot(a: ZombieActor, cellSize: number, look: BodyLodLook): ChunkBakeData | null {
  const body = a.body;
  const box = restBakeBounds(body.prims);
  if (!box) return null;
  return {
    body, flesh: body.prims, bones: body.bonePrims ?? [], centre: box.centre, halfExtent: box.halfExtent,
    extent: Math.max(...box.halfExtent), cellSize, quat: [0, 0, 0, 1], gore: 0,
    carveK: a.view.uniforms.woundCfg.value.y, torn: [], look: bakeLookOf(a.view.uniforms),
    // 'flesh': the body's own surface response, as a gib chunk's bake carries it (zombie-gpu bakeData): the baked
    // shader then takes its flesh branch (legacy display gamma, wet spec) instead of the plain-mesh branch the
    // corpse bake gets. 'corpse': no response, exactly what a baked soldier corpse looks like today.
    ...(look === 'flesh' ? { surface: surfaceOf(a.view.uniforms) } : {}),
  };
}

const surfaceOf = (u: ZombieActor['view']['uniforms']) => ({
  legacyGamma: u.lodCfg.value.y, wetness: u.surfCfg2.value.x, roughness: u.surfCfg.value.y,
  specIntensity: u.surfCfg.value.x, noiseAmp: u.marchCfg.value.z, fresnel: u.surfCfg.value.z,
});

export interface BodyLodView {
  /** Per frame, after the cull: decide each body's tier, bake what is missing, pose the meshed ones. */
  update(actors: readonly ZombieActor[], kept: ReadonlySet<ZombieActor>, eye: Vec3, cfg: BodyLodConfig): void;
  meshed(id: number): boolean;
  /** Debug: the body's skinned mesh, if it has one. */
  instance(id: number): THREE.SkinnedMesh | null;
  /** Bodies that left the mesh tier this frame: their proxies are owed a show. */
  takeRestored(): ZombieActor[];
  info(): object;
  clear(): void;
}

export function createBodyLodView(parent: THREE.Object3D, material: () => THREE.Material,
  /** Alight, or charred by a fire (game-burning's registry: what draws the flames and the char). */
  burning: (a: ZombieActor) => boolean,
  factory = () => new Worker(new URL('./chunk-bake.worker.ts', import.meta.url), { type: 'module' })): BodyLodView {
  const jobs = createChunkBakeJobs(factory);
  const types = new Map<string, TypeMesh>();
  const pendingBake = new Map<number, { type: TypeMesh; actor: ZombieActor; cellSize: number }>();
  let jobId = 1;
  const instances = new Map<number, Instance>();
  const refined = new Set<number>();          // sticky 'refine': damaged once, marched for good
  let restored: ZombieActor[] = [];
  const missing = new Set<string>();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);

  const facts = (a: ZombieActor, t: TypeMesh | undefined): BodyLodFacts => ({
    standing: a.refineEligible(),
    burning: burning(a),
    tearing: a.tearFrame() !== null,
    wounded: a.wounds().length > 0,
    // The LIVE body (sever replaces it): a cluster switched off, or prims dropped inside one (a partial sever).
    severed: t ? a.body.clusters.filter(c => c.alive).length < t.liveClusters
      || a.body.prims.filter(p => !p.dead).length < t.livePrims : false,
  });

  const submit = (t: TypeMesh, a: ZombieActor, cellSize: number) => {
    const data = restSnapshot(a, cellSize, t.look);
    if (!data) { t.status = 'failed'; t.reason = 'no live prims'; return; }
    const id = jobId++;
    if (!jobs.submit(id, data)) return;
    pendingBake.set(id, { type: t, actor: a, cellSize });
    t.bakeMs = performance.now();
  };

  const finish = () => {
    const done = jobs.takeCompleted();
    if (!done) return;
    const p = pendingBake.get(done.id);
    pendingBake.delete(done.id);
    if (!p) return;
    const t = p.type;
    const baked = unpackChunkBake(done.result);
    t.bakeMs = +(performance.now() - (t.bakeMs ?? 0)).toFixed(1);
    if (baked.overflow || baked.droppedQuads || !baked.verts) {
      baked.geometry.dispose();
      if (p.cellSize < 0.03) { t.status = 'pending'; submit(t, p.actor, p.cellSize * 1.4); return; }
      t.status = 'failed'; t.reason = 'bake overflow'; return;
    }
    // The skeleton: every bone the rig gives a frame for, the torso's first (the unclaimed-vertex fallback).
    const body = p.actor.body;
    const frames = boneFrames(body, p.actor.boundRig(), p.actor.pose().yaw);
    const torsoBone = body.prims.find(q => q.limb === 'torso' && q.bone && frames.has(q.bone))?.bone;
    const names = [...body.bones.keys()].filter(n => frames.has(n));
    if (torsoBone) names.sort((x, y) => (y === torsoBone ? 1 : 0) - (x === torsoBone ? 1 : 0));
    const s0 = performance.now();
    const posAttr = baked.geometry.getAttribute('position') as THREE.BufferAttribute;
    const { index, weight } = skinWeights(posAttr.array as Float32Array, body.prims, names);
    t.skinMs = +(performance.now() - s0).toFixed(1);
    baked.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    baked.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    t.bones = names;
    t.inverses = names.map(n => { const h = body.bones.get(n)!.head; return new THREE.Matrix4().makeTranslation(-h[0], -h[1], -h[2]); });
    t.geometry = baked.geometry;
    t.verts = baked.verts; t.tris = baked.tris;
    t.status = 'ready';
  };

  const makeInstance = (t: TypeMesh): Instance => {
    const bones = t.bones.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
    const skeleton = new THREE.Skeleton(bones, t.inverses.map(m => m.clone()));
    const mesh = new THREE.SkinnedMesh(t.geometry!, material());
    mesh.name = 'body-lod';
    mesh.userData.boneNames = t.bones;
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(skeleton, new THREE.Matrix4());
    // The geometry's bounds are the REST pose at the bake actor's spawn; the body walks away from them.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return { mesh, type: t };
  };

  const drop = (id: number, a: ZombieActor | null) => {
    const inst = instances.get(id);
    if (!inst) return;
    parent.remove(inst.mesh);
    inst.mesh.skeleton.dispose();
    instances.delete(id);
    if (a) restored.push(a);
  };

  const pose = (a: ZombieActor, inst: Instance) => {
    const frames = boneFrames(a.body, a.boundRig(), a.pose().yaw);
    const bones = inst.mesh.skeleton.bones;
    inst.type.bones.forEach((n, i) => {
      const f = frames.get(n);
      if (!f) { missing.add(n); return; }      // keep last frame's matrix
      pos.set(f.pos[0], f.pos[1], f.pos[2]);
      quat.set(f.quat[0], f.quat[1], f.quat[2], f.quat[3]);
      bones[i]!.matrixWorld.compose(pos, quat, one);
    });
  };

  return {
    update(actors, kept, eye, cfg) {
      finish();
      for (const id of [...instances.keys()]) if (!actors.some(a => a.id === id)) drop(id, null);
      if (!cfg.on) { for (const a of actors) if (instances.has(a.id)) drop(a.id, a); return; }
      for (const a of actors) {
        const key = typeKey(a, cfg.look);
        let t = types.get(key);
        const f = facts(a, t);
        if (stickyRefine(cfg.wound, f)) refined.add(a.id);
        const torso = a.posed().clusters.find(c => c.limb === 'torso');
        const d = torso ? Math.hypot(torso.center[0] - eye[0], torso.center[1] - eye[1], torso.center[2] - eye[2]) : 0;
        const want = !!torso && !refined.has(a.id) && bodyLodEligible(f, cfg.wound)
          && inMeshBand(instances.has(a.id), d, cfg);
        if (want && !t && jobs.pendingId === null && !jobs.error && !f.wounded) {
          t = { key, look: cfg.look, status: 'pending', bones: [], inverses: [], liveClusters: a.body.clusters.filter(c => c.alive).length,
            livePrims: a.body.prims.filter(p => !p.dead).length };
          types.set(key, t);
          submit(t, a, 0.015);
        }
        const on = want && t?.status === 'ready' && kept.has(a);
        if (!on) { if (instances.has(a.id)) drop(a.id, a); continue; }
        let inst = instances.get(a.id);
        if (!inst) { inst = makeInstance(t!); instances.set(a.id, inst); }
        inst.mesh.visible = true;
        pose(a, inst);
      }
    },
    meshed: (id) => instances.has(id),
    instance: (id) => instances.get(id)?.mesh ?? null,
    takeRestored() { const r = restored; restored = []; return r; },
    info: () => ({
      meshed: [...instances.keys()],
      missingFrames: [...missing],
      refined: [...refined],
      pendingJob: jobs.pendingId, error: jobs.error,
      types: [...types.values()].map(t => ({ key: t.key, status: t.status, reason: t.reason, bones: t.bones.length,
        verts: t.verts, tris: t.tris, bakeMs: t.bakeMs, skinMs: t.skinMs })),
    }),
    clear() {
      jobs.cancel(); pendingBake.clear();
      for (const id of [...instances.keys()]) drop(id, null);
      for (const t of types.values()) t.geometry?.dispose();
      types.clear(); refined.clear(); restored = [];
    },
  };
}
