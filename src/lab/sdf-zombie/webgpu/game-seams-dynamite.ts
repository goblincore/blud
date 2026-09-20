// src/lab/sdf-zombie/webgpu/game-seams-dynamite.ts
//
// Dynamite/explosion seams: the panel's tuning surface and the wound-only
// diagnostic detonation (the real `detonate`/`overcook` stay in
// game-main.ts's literal). Members moved VERBATIM out of
// game-seams-leftover.ts (leaves wave 1's ctx-only bucket, 2026-09-20
// split; see the 2026-09-20-seams-leftover-split notes).
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import type { GameContext } from './game-context';
import { type ExplosionBody, resolveExplosion } from '../explosion-aoe';
import { type DynamiteTuningValues } from './dynamite-panel';
import { applyDynamiteTuning, dynamiteTuningValues } from './game-dynamite-tuning';
import { spillVerdict } from './game-vfx-leaves';

export function createDynamiteSeams(ctx: GameContext) {
  return {
    /** THE PANEL'S OWN SETTER, from the console: the same keys the sliders use
     *  (see dynamite-panel.ts's table, which is the one source for both), plus
     *  the read-back. `__sdfGame.setDynamiteTuning({ maxchunks: 64 })`. */
    setDynamiteTuning(patch: Partial<DynamiteTuningValues>) {
      applyDynamiteTuning(ctx, patch);
      return dynamiteTuningValues(ctx);
    },
    dynamiteTuning: () => dynamiteTuningValues(ctx),

    /** Diagnostic detonation: one blast stamped through resolveExplosion
     *  (the SAME worldHitToWound path dynamite uses) with falloff-scaled
     *  blast calibre — wounds only, no shove/sever/gib, so captures are not
     *  displaced by their own impact. Returns what it did. */
    explode: (x: number, y: number, z: number) => {
      const bodies: ExplosionBody[] = ctx.world.actors.map(a => ({ id: String(a.id), body: a.posed(), bodyYaw: a.pose().yaw }));
      const fx = resolveExplosion([x, y, z], bodies);
      let totalWounds = 0;
      for (const pb of fx.perBody) {
        if (pb.wounds.length === 0) continue;
        const a = ctx.world.actors.find(q => String(q.id) === pb.bodyId);
        if (!a) continue;
        a.stampBlast(pb.wounds);
        // One decision PER stamped wound: the first cavity wound spawns,
        // the rest tear — a blast blows the gut out rather than growing
        // multiple ropes (shouldSpill's one-rope-per-body rule).
        for (const w of pb.wounds) spillVerdict(ctx, a, w);
        totalWounds += pb.wounds.length;
      }
      return { radiusM: fx.radiusM, bodiesHit: fx.perBody.length, totalWounds };
    },
  };
}
