// src/lab/sdf-zombie/webgpu/game-seams-earlyz.ts
//
// EARLY-Z console/capture seam (spec 2026-10-01): plain data only.
import type { GameContext } from './game-context';
import { conservativeDepthPatchHits } from './earlyz/conservative-depth-patch';

export function createEarlyzSeams(ctx: GameContext) {
  return {
    earlyzInfo() {
      const batches: Record<string, { front: number; back: number; frontDisabled: string | null }> = {};
      for (const [key, t] of ctx.crowd.types) {
        const b = t.earlyzBatches();
        // frontDisabled: why the type's front batch was switched off (its front pipeline failed), or null.
        batches[key] = { front: b.front, back: b.back, frontDisabled: t.earlyzFrontDisabled() };
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
