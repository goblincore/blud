// src/lab/sdf-zombie/webgpu/game-world-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { levelMatchedGain } from './probe-lighting-node'


/** The room's level cfg: weight, and the gain that puts the probe level at
 *  the hemisphere's (or the owner's override). 0/0 until the bake lands. */
export function stampLevelProbeRoom(ctx: GameContext, roomId: number) {
  const node = ctx.lighting.levelProbeNodes.get(roomId);
  if (!node) return;
  const grid = ctx.world.roomProbes.gridOf(roomId);
  let gain = 0;
  if (grid) {
    gain = ctx.lighting.levelProbeGain >= 0 ? ctx.lighting.levelProbeGain : levelMatchedGain(grid, {
      sky: [ctx.lighting.hemi.color.r, ctx.lighting.hemi.color.g, ctx.lighting.hemi.color.b],
      ground: [ctx.lighting.hemi.groundColor.r, ctx.lighting.hemi.groundColor.g, ctx.lighting.hemi.groundColor.b],
      intensity: ctx.lighting.hemiBase,
    });
  }
  node.slots.probeCfg.value.set(ctx.lighting.levelProbeWeight, gain, 0, 0);
}
