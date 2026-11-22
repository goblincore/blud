// src/lab/sdf-zombie/webgpu/game-seams-blast-trace.ts
//
// READ-ONLY diagnostic seam for the blast -> damage -> gib frame-strip probe
// (2026-10-29, "the explosion and the gib do not feel connected"). One call
// returns everything a frame needs to be judged against the blast: each live
// body's drawn silhouette (world AABB of its drawn prims, rupture or not), its
// visibility and tear state; every live gib piece (sprite/asset/carve pieces
// with their DRAWN mesh bounds, marched chunks, mesh gibs); the blood
// droplets' centroid and mean velocity; and the explosion light ages.
//
// Mutates nothing. Not on any gameplay path.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';

const _box = new THREE.Box3();

type Box = { min: Vec3; max: Vec3 } | null;
function boxOf(obj: THREE.Object3D): Box {
  obj.updateWorldMatrix(true, true);
  _box.setFromObject(obj, true);
  if (_box.isEmpty()) return null;
  return { min: [_box.min.x, _box.min.y, _box.min.z], max: [_box.max.x, _box.max.y, _box.max.z] };
}

export function createBlastTraceSeams(ctx: GameContext) {
  return {
    blastTrace: () => {
      const actors = ctx.world.actors.map(a => {
        const body = a.drawnBody();
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const p of body.prims) {
          if (p.op === 'sub' || p.dead) continue;
          const r = Math.max(p.radius, p.radiusB ?? 0);
          for (const e of [p.a, p.b]) for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, e[k]! - r); hi[k] = Math.max(hi[k]!, e[k]! + r);
          }
        }
        const torso = body.clusters.find(c => c.limb === 'torso')?.center ?? null;
        const f = a.tearFrame();
        let maxOff = 0;
        if (f) for (const o of f.offsets) maxOff = Math.max(maxOff, Math.hypot(o[0], o[1], o[2]));
        const d = a.debug();
        return {
          id: a.id, pos: [...a.pose().pos] as Vec3, yaw: a.pose().yaw,
          phase: d.phase, meter: d.meter, visible: a.view.object.visible,
          tearing: a.tearing(), tearAge: a.tearAge(), tearMaxOffsetM: maxOff,
          torso: torso ? [torso[0], torso[1], torso[2]] as Vec3 : null,
          aabb: { min: lo, max: hi },
        };
      });
      const sp = ctx.vfx.spritePieces;
      const sprites = [...sp.live.map(p => ({ p, rest: false })), ...sp.rest.map(p => ({ p, rest: true }))].map(({ p, rest }) => ({
        id: p.id, limb: String(p.state.limb), kind: p.state.kind, render: p.render, rest,
        visible: p.mesh.visible && !sp.hidden,
        pos: [...p.state.pos] as Vec3, vel: [...p.state.vel] as Vec3,
        impulseDelay: p.impulseDelay, impulseVel: p.impulseVel ? [...p.impulseVel] as Vec3 : null,
        box: boxOf(p.mesh),
      }));
      const chunks = ctx.bake.liveChunks.map(c => ({
        id: c.id, limb: String(c.state.limb), kind: c.kind, visible: c.view.object.visible,
        pos: [...c.state.pos] as Vec3, vel: [...c.state.vel] as Vec3, radius: c.state.radius,
      }));
      const meshGibs = ctx.gibs.meshGibs.map(g => ({
        id: g.id ?? -1, tag: g.tag, visible: g.object.visible,
        pos: [...g.state.pos] as Vec3, vel: [...g.state.vel] as Vec3, box: boxOf(g.object),
      }));
      const drops = ctx.vfx.bloodSim.droplets.filter(d => d.kind !== 'gut');
      const n = drops.length;
      const c = [0, 0, 0], v = [0, 0, 0];
      for (const d of drops) for (let k = 0; k < 3; k++) { c[k]! += d.pos[k]! / n; v[k]! += d.vel[k]! / n; }
      return {
        actors, sprites, chunks, meshGibs,
        blood: {
          droplets: n, centroid: n ? c : null, meanVel: n ? v : null,
          sample: drops.slice(0, 400).map(d => [d.pos[0], d.pos[1], d.pos[2], d.vel[0], d.vel[1], d.vel[2]]),
          splats: ctx.vfx.bloodSim.splats.length,
        },
        lights: ctx.vfx.explosionLights.map(e => ({ pos: [...e.pos] as Vec3, age: e.age })),
        pendingGibImpulses: ctx.gibs.pendingGibImpulses.length,
        pendingGibs: ctx.gibs.pendingGibs.length,
        recoilPitch: ctx.weapon.recoilPitch,
        // The main camera's projection x view (column-major), so a probe can project the boxes above to pixels.
        projView: (() => {
          const cam = ctx.boot.handle.camera;
          cam.updateMatrixWorld();
          return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).toArray();
        })(),
      };
    },
  };
}
