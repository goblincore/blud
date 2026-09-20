// src/lab/sdf-zombie/webgpu/game-seams-lighting-probes.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { withCtx } from './game-context';
import { applyHemi } from './game-lighting-leaves';
import { pushProbeWeight } from './game-probes-leaves';
import { restampLevelProbes } from './game-render-leaves2';

export function createLightingProbeSeams(ctx: GameContext) {
  return {
    setProbeWeight: withCtx(ctx, pushProbeWeight),
    /** LEVEL surfaces reading the probes (P3/P4 step 3): weight 0 = the
     *  pre-probe level (hemisphere at full, nodes add nothing); gain -1 =
     *  each room's hemisphere-matched level. The hemisphere fades with the
     *  weight so the flip does not brighten the room. */
    setLevelProbes: (weight: number, gain = -1) => {
      ctx.lighting.levelProbeWeight = Math.max(0, Math.min(1, weight)); ctx.lighting.levelProbeGain = gain;
      applyHemi(ctx); restampLevelProbes(ctx);
      return { weight: ctx.lighting.levelProbeWeight, gain: ctx.lighting.levelProbeGain };
    }
  };
}
