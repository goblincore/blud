// src/lab/sdf-zombie/webgpu/game-probes-leaves.ts
//
// Clamped setter for the global probe-lighting weight on the game context.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';


export function pushProbeWeight(ctx: GameContext, v: number) {
  ctx.probes.weight = Math.min(1, Math.max(0, v));
  for (const a of ctx.world.actors) a.view.uniforms.bounceCfg.value.x = ctx.probes.weight;
}
