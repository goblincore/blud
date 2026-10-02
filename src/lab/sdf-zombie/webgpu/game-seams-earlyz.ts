// src/lab/sdf-zombie/webgpu/game-seams-earlyz.ts
//
// EARLY-Z console/capture seam (spec 2026-10-01): plain data only.
import type { GameContext } from './game-context';
import { conservativeDepthPatchHits } from './earlyz/conservative-depth-patch';

export function createEarlyzSeams(ctx: GameContext) {
  return {
    earlyzInfo() {
      const batches: Record<string, { front: number; back: number }> = {};
      for (const [key, t] of ctx.crowd.types) {
        const b = t.earlyzBatches();
        batches[key] = { front: b.front, back: b.back };
      }
      return {
        ...ctx.crowd.earlyz,
        gpuErrors: [...ctx.crowd.earlyz.gpuErrors],
        patchHits: conservativeDepthPatchHits(),
        seed: ctx.render.sdfLayer.earlyzSeedInfo(),
        batches,
      };
    },
  };
}
