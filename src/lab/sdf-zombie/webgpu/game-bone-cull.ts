// src/lab/sdf-zombie/webgpu/game-bone-cull.ts
//
// Toggling bone culling, and re-stamping the level probes.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { applyBoneCullMode } from './game-render-controls'
import { stampLevelProbeRoom } from './game-hit-trace'


export function applyBoneCull(ctx: GameContext, on: boolean): void {
  applyBoneCullMode(ctx, on ? 'cluster' : 'off');
}

export function restampLevelProbes(ctx: GameContext) {
  for (const roomId of ctx.lighting.levelProbeNodes.keys()) stampLevelProbeRoom(ctx, roomId);
}
