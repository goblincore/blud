// src/lab/sdf-zombie/webgpu/game-dynamite-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type StickProp } from './fpv-view';


/** Take a prop for a bundle that is leaving the hand: the held one if it is
 *  there, else a spare, else the OLDEST flying bundle's (its state keeps
 *  flying — only the drawing of it is recycled, so the sim never desyncs). */
export function takePropForThrow(ctx: GameContext): StickProp | null {
  if (ctx.weapon.heldProp) {
    const p = ctx.weapon.heldProp;
    ctx.weapon.heldProp = null;
    ctx.bake.bundleRig.remove(p.object);
    ctx.boot.handle.scene.add(p.object);
    return p;
  }
  const spare = ctx.bake.spareBundles.pop();
  if (spare) return spare;
  const oldest = ctx.bake.liveBundles.find(b => b.prop);
  if (!oldest || !oldest.prop) return null;
  const p = oldest.prop;
  oldest.prop = null;
  return p;
}
