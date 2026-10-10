// src/lab/sdf-zombie/webgpu/game-skull-shots.ts
//
// A PROJECTILE AT BONE WITH NO FLESH IN FRONT OF IT. The projectile loop (game-tick.ts) finds a hit by tracing the
// FLESH field, and the skull is cast from that hit (mesh-renderer.ts impact). A head whose split is drawn has bone
// the eye sees and no flesh covers: the skull opens less than its flesh, and stands in the gap between the halves. A
// pellet or slug on a line through that bone meets no flesh of the actor on its step, or meets it only behind the
// bone.
//
// This leaf is the first half of the answer: after the loop's flesh trace, each actor the projectile did NOT stop in
// and whose split is drawn has the step cast at its skull (the renderer's skullPass: the anatomical skull only, a
// sphere first, then the plates where they are drawn). A plate the step meets is damaged; the projectile carries on,
// stamps no wound and does no damage to the body. The second half is the loop's own impact call, which hands the
// renderer the step's start, so bone in front of the flesh hit counts. The rule is skeleton-spike/skull-split-hit.ts
// skullShotCast; the projectile remembers the skulls it has damaged (Projectile.skulls), one plate of each at most.
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Projectile } from './game-weapon';

/** The step `from`..p.pos of projectile `p`, at every open skull it did not stop in. `stopped` and `at`: the actor
 *  whose flesh stopped it on this step and where (null: none; the step ran its length). Returns the plates released. */
export function skullPasses(ctx: GameContext, p: Projectile, from: Vec3, stopped: ZombieActor | null, at: Vec3 | null): number {
  const renderer = ctx.render.segMeshRenderer;
  if (!renderer) return 0;
  let released = 0, direction: Vec3 | null = null;
  for (const a of ctx.world.actors) {
    if (a === stopped || !a.view.splitDrawn) continue;
    const sources = ctx.render.skeletonSources.get(a)?.sources;
    if (!sources) continue;
    if (!direction) { const l = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) || 1; direction = [p.vel[0] / l, p.vel[1] / l, p.vel[2] / l]; }
    released += renderer.skullPass(a, sources, from, stopped && at ? at : p.pos, direction, p.kind, p);
  }
  return released;
}
