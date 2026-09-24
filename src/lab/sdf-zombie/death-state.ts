// src/lab/sdf-zombie/death-state.ts
//
// LIFE-STATE PRIMS (cultist hood, owner playtest 2026-09-24): "it would just
// probably cause the cowl to go from the 'hood' position to the 'not hood'
// position (his head would be completely exposed)". A .blob prim tagged
// `when=alive` exists only while the character lives; `when=dead` is hidden
// (resolve.ts marks it `dead`, the same switch severing uses) until death.
// The swap is one pure body rewrite: no prim moves, no index changes, so
// wounds, clusters and the rig binding all stay valid.
import type { BuildResult } from './build-body';

/** True when the body has any life-state prim (the swap would change it). */
export function hasDeathState(body: BuildResult): boolean {
  return body.prims.some(p => p.when !== undefined);
}

/**
 * The body as it looks dead: `when=alive` prims go dead, `when=dead` prims
 * come alive — unless their cluster was already severed away (a hood-down
 * roll must not reappear on a shot-off torso). Returns `body` itself when it
 * has no life-state prims.
 */
export function applyDeathState(body: BuildResult): BuildResult {
  if (!hasDeathState(body)) return body;
  const clusterAlive = (i: number) =>
    body.clusters.find(c => i >= c.start && i < c.start + c.count)?.alive ?? true;
  // What the dead look REPLACES is gone (the head popped with its hood):
  // then there is nothing to fall back, so nothing appears.
  const replacedGone = body.prims.some((p, i) => p.when === 'alive' && !clusterAlive(i));
  return {
    ...body,
    prims: body.prims.map((p, i) => {
      if (p.when === 'alive' && !p.dead) return { ...p, dead: true };
      if (p.when === 'dead' && p.dead && clusterAlive(i) && !replacedGone) {
        const { dead: _dead, ...rest } = p;
        return rest;
      }
      return p;
    }),
  };
}
