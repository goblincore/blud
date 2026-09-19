// src/lab/sdf-zombie/webgpu/game-player-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { moveAim } from './free-aim'
import { PLAYER } from './game-player'


/** The mouse delta's effect, extracted so the live handler and the replay
 *  apply the IDENTICAL maths. Free aim moves the reticle (the camera follows
 *  from the tick); otherwise it turns the camera directly. */
export function applyMouseDelta(ctx: GameContext, dx: number, dy: number): void {
  if (ctx.player.freeAimOn) {
    // The mouse moves the RETICLE, not the camera. Turning is a consequence
    // of shoving the reticle past the dead zone, handled in the tick.
    ctx.weapon.aim = moveAim(ctx.weapon.aim, dx, dy);
  } else {
    ctx.player.player.yaw += dx * 0.0022;
    ctx.player.player.pitch = Math.min(PLAYER.pitchLimit,
      Math.max(-PLAYER.pitchLimit, ctx.player.player.pitch - dy * 0.0022));
  }
}
