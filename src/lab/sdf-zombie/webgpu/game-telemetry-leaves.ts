// src/lab/sdf-zombie/webgpu/game-telemetry-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { describeRecordedWound } from './game-demo-leaves';


export function captureTelemetryScene(ctx: GameContext, name: string) {
  if (!ctx.telemetry.telemetry.active) return;
  const started = performance.now();
  ctx.telemetry.telemetry.snapshot(name, {
    camera: { position: ctx.boot.handle.camera.position.toArray(), quaternion: ctx.boot.handle.camera.quaternion.toArray(), projection: ctx.boot.handle.camera.projectionMatrix.toArray(), fov: ctx.boot.handle.camera.fov },
    player: { position: ctx.player.player.pos, yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch },
    settings: { tiles: ctx.boot.gameTiles.diagnostics(), sdfScale: ctx.render.sdfScale, adaptive: ctx.render.adaptiveEnabled, frameCap: ctx.boot.handle.frameCap,
      width: ctx.render.sdfLayer.targetSize.width, height: ctx.render.sdfLayer.targetSize.height, woundTuning: ctx.vfx.woundTuning, normalGradientMode: ctx.telemetry.normalGradientMode },
    actors: ctx.world.actors.map(a => {
      const body = a.posed();
      // Already-posed CPU data: no ray queries, GPU fence or texture readback.
      return { id: a.id, model: 'zombie', room: a.room, pose: a.pose(),
        prims: body.prims, clusters: body.clusters, bonePrims: body.bonePrims,
        wounds: a.wounds().map(w => describeRecordedWound(ctx, a, w)),
        uniforms: Object.fromEntries(Object.entries(a.view.uniforms).flatMap<[string, number | boolean | number[]]>(([key, u]) => {
          const v = (u as { value: unknown }).value;
          if (typeof v === 'number' || typeof v === 'boolean') return [[key, v]];
          if (v instanceof THREE.Vector2 || v instanceof THREE.Vector3 || v instanceof THREE.Vector4 || v instanceof THREE.Matrix4) return [[key, (v as { toArray(): number[] }).toArray()]];
          return [];
        })),
      };
    }),
    chunks: ctx.bake.liveChunks.map(c => ({ id: c.id, state: c.state, pendingBake: ctx.bake.jobs.pendingId === c.id })),
    bakedChunks: ctx.bake.chunks.map(c => ({ id: c.id, centre: c.centre, radius: c.radius })),
    purpose: 'Frozen actor geometry for diagnosis; not deterministic whole-game replay. No pixel/ray eligibility counters.',
  });
  ctx.telemetry.telemetry.event('snapshot-cost', { name, cpuMs: performance.now() - started });
}
