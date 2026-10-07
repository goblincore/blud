// src/lab/sdf-zombie/webgpu/game-crowd-queries.ts
//
// Crowd queries: the live body of a crowd type nearest the player, and the set of actors whose bone can show.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';


/** Owners whose bone can show (segmentNeeded): any carving wound, or a sever re-derive. */
/** The position of a crowd type's live body nearest the player, or null. */
export function nearestCrowdBody(ctx: GameContext, t: unknown): [number, number, number] | null {
  const pp = ctx.player.player.pos;
  let best: [number, number, number] | null = null, bd = Infinity;
  for (const a of ctx.render.visualActors) {
    if (ctx.crowd.typeOfView.get(a.view) !== t) continue;
    const p = a.pose().pos, d = (p[0] - pp[0]) ** 2 + (p[2] - pp[2]) ** 2;
    if (d < bd) { bd = d; best = [p[0], p[1], p[2]]; }
  }
  return best;
}

export function boneExposedActors(ctx: GameContext, c: typeof ctx): Set<unknown> {
  const out = new Set<unknown>();
  for (const a of c.render.visualActors) {
    if ((c.render.skeletonSources.get(a) as { severed?: boolean } | undefined)?.severed || a.visualWounds().some(w => !w.decal)) out.add(a);
  }
  return out;
}
