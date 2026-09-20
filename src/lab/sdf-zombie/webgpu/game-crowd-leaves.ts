// src/lab/sdf-zombie/webgpu/game-crowd-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { createCrowdType, type CrowdType } from './crowd-type';
import { DEPTH_PREPASS_LAYER, SDF_LAYER } from './sdf-layer';
import { blankFaceTexture, defaultUniforms } from './zombie-gpu';


/** Lazily create the ONE CrowdType a character registry name draws through
 *  (Task 5's createCrowdType). The material binds the same start/early-out
 *  sources as a per-body view (temporal start, prev, shell, depthPre,
 *  probeDyn) so a lone instance stays bit-identical; the per-TYPE uniform
 *  block is seeded by copyUniformValues from the first attached view.
 *  `?crowd=0` never calls this. */
export function crowdTypeFor(ctx: GameContext, name: string, roomId: number): CrowdType {
  // Keyed by character AND spawn room. The per-TYPE uniform block is seeded
  // from the first attached view, and that block carries the ROOM's
  // lighting environment (boxMin/boxMax, the six wall colours, the room
  // probe texture, probeMin/probeCfg) which spawnEnemy stamps per actor for
  // its spawn room and never changes afterwards. One type spanning rooms
  // lit every instance with the first room's walls and probes — the pale,
  // blotchy zombie (2026-09-14). A type per (character, room) keeps the
  // block honest; rooms are frustum-culled, so few types draw per frame.
  const key = `${name}@${roomId}`;
  const existing = ctx.crowd.types.get(key);
  if (existing) return existing;
  const t = createCrowdType(
    ctx.boot.handle.renderer, key, defaultUniforms(blankFaceTexture()),
    ctx.render.sdfLayer.maxWidth, ctx.render.sdfLayer.maxHeight,
    {
      occluder: ctx.render.sdfLayer.occluder,
      shell: {
        entry: ctx.render.sdfLayer.shellEntry.texture,
        exit: ctx.render.sdfLayer.shellExit.texture,
        uniforms: ctx.render.sdfLayer.shellEntry.uniforms,
      },
      prev: ctx.render.sdfLayer.prev,
      depthPre: ctx.render.sdfLayer.depthPre,
      lastFrame: ctx.render.sdfLayer.lastFrame,
      probeDyn: ctx.probes.gather ? { node: ctx.probes.gather.probeDynNode } : undefined,
    },
    { dispatch: ctx.crowd.dispatch, telemetry: ctx.telemetry.telemetry },
  );
  t.mesh.layers.set(SDF_LAYER);
  t.depthPreMesh.layers.set(DEPTH_PREPASS_LAYER);
  ctx.boot.handle.scene.add(t.mesh);
  ctx.boot.handle.scene.add(t.depthPreMesh);
  ctx.boot.deferredApi?.router.register(t.mesh, 'sdf');
  ctx.boot.deferredApi?.router.register(t.depthPreMesh, 'exclude');
  ctx.crowd.types.set(key, t);
  return t;
}
