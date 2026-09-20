// src/lab/sdf-zombie/webgpu/game-bake-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type BakedChunkMaterial } from './baked-chunks';


/** Register a material instance to be lit by the frame's beam. Every
 *  `createBakedChunkMaterial` that is DRAWN must go through this — an
 *  unregistered instance is not merely dimmer, it is lit by a lamp that does
 *  not exist (see the block above). */
export function registerLitChunkMaterial<T extends BakedChunkMaterial>(ctx: GameContext, m: T): T {
  ctx.world.litChunkMaterials.push(m);
  return m;
}

/** WAIT FOR OUTSTANDING BAKE WORKERS (determinism, 2026-09-14). The gib
 *  swap is pinned to the frame after its submit and the corpse swap to the
 *  frame the reply arrives — both only if the reply HAS arrived. Two replays
 *  of the owner's 56 s recording diverged at one sample because one worker
 *  answered before a resolveGpu yield and the other after it. Every
 *  hand-stepped driver (replay, bench, scenario hash) awaits this before a
 *  step, so the reply is always in hand on the pinned frame. Live play never
 *  calls it. */
export async function awaitBakes(ctx: GameContext): Promise<void> {
  await ctx.bake.jobs.settled();
  if (ctx.world.soldierCorpses) await ctx.world.soldierCorpses.settled();
}
