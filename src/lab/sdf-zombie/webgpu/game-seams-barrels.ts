// src/lab/sdf-zombie/webgpu/game-seams-barrels.ts
//
// Barrel seams (plan docs/superpowers/plans/2026-10-25-sector-levels-3b-debris-and-barrels.md Task 13): the level's
// barrels as plain data, a hit by kind (the gate's way to set one off), the detonation log the chain checks read and
// (Task 14) every hit that counted, by kind and drum point.
// Empty / null on levels without barrels.
import type { GameContext } from './game-context';
import type { BarrelHitKind } from './barrel-state';

export function createBarrelSeams(ctx: GameContext) {
  return {
    barrels: () => ctx.world.barrels?.states.map(b => ({ id: b.id, pos: [...b.pos], hp: b.hp, phase: b.phase, fuse: b.fuse })) ?? [],
    damageBarrel: (id: string, kind: BarrelHitKind = 'slug') => {
      ctx.world.barrels?.hit(id, kind);
      return ctx.world.barrels?.states.find(b => b.id === id)?.phase ?? null;
    },
    barrelLog: () => ctx.world.barrels
      ? { clock: ctx.world.barrels.clock, log: [...ctx.world.barrels.log], hits: ctx.world.barrels.hits.map(h => ({ ...h })), materials: ctx.world.barrels.materialCount() }
      : null,
    /** Render cost census (plan 3b boot check): the barrels' materials and the renderer's compiled-pipeline,
     *  shader-program and node-build cache sizes (three r186 internals, read defensively; -1 when absent). */
    barrelRender: () => {
      const r = ctx.boot.handle.renderer as unknown as {
        _pipelines?: { caches?: Map<unknown, unknown>; programs?: { vertex?: Map<unknown, unknown>; fragment?: Map<unknown, unknown> } };
        _nodes?: { nodeBuilderCache?: Map<unknown, unknown> };
      };
      return {
        materials: ctx.world.barrels?.materialCount() ?? 0,
        pipelines: r._pipelines?.caches?.size ?? -1,
        vertexPrograms: r._pipelines?.programs?.vertex?.size ?? -1,
        fragmentPrograms: r._pipelines?.programs?.fragment?.size ?? -1,
        nodeBuilds: r._nodes?.nodeBuilderCache?.size ?? -1,
      };
    },
  };
}
