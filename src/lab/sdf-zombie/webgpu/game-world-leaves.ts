// src/lab/sdf-zombie/webgpu/game-world-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import { levelMatchedGain } from './probe-lighting-node';
import { type Vec3 } from '../types';
import { sdBody } from '../validate';
import { SLUG, traceProjectile } from './game-weapon';

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

export function bodiesOnScreen(ctx: GameContext): number { return ctx.world.cullCounts.visible; }

// __sdfGame — the deterministic driver surface. The grapeshot dispatch
// builds on this: zombies are addressable by id, the player pose is
// settable, frames are steppable, wanderers freezable.
// -----------------------------------------------------------------------
/** Where a slug fired RIGHT NOW would hit — the shared predictor.
 *  Lifted out of __sdfGame so aimAtNearestSurface can CONFIRM an aim
 *  with the same code the placement gate uses, rather than trusting a
 *  cluster centre. No state mutated. */
/** The ballistic slug march itself, parameterised by the firing ray. The
 *  grapeshot's wrapper below calls it from the muzzle; slot 3's flare calls
 *  it from the EYE, because its own gun is holstered when it fires. No state
 *  mutated. */
export function traceSlugHitFrom(ctx: GameContext, origin: Vec3, dir: Vec3): { actorId: number; hit: Vec3 | null } {
    let bestD = Infinity;
    let hitActorId = -1;
    let hitPoint: Vec3 | null = null;
    // Simulate the slug's ACTUAL flight (gravity, like stepProjectiles) —
    // a straight muzzle ray ignores the drop and reads ~4 cm high at 3 m,
    // which the placement gate duly failed (2026-08-27).
    const pos: [number, number, number] = [origin[0], origin[1], origin[2]];
    const d0: [number, number, number] = [dir[0], dir[1], dir[2]];
    const vel: [number, number, number] = [d0[0] * SLUG.speed, d0[1] * SLUG.speed, d0[2] * SLUG.speed];
    const dt = 1 / 120;
    for (const a of ctx.world.actors) {
      const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
      if (!c) continue;
      if (Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]) > 20) continue;
      const posedA = a.posed();
      // Per-actor arc: reset the integrator, march segment-wise for 2 s.
      pos[0] = origin[0]; pos[1] = origin[1]; pos[2] = origin[2];
      vel[0] = d0[0] * SLUG.speed; vel[1] = d0[1] * SLUG.speed; vel[2] = d0[2] * SLUG.speed;
      for (let i = 0; i < 240; i++) {
        const next: Vec3 = [
          pos[0] + vel[0] * dt,
          pos[1] + vel[1] * dt,
          pos[2] + vel[2] * dt,
        ];
        const vNext: Vec3 = [vel[0], vel[1] + SLUG.gravity * dt, vel[2]];
        const hp = traceProjectile(pos, next, q => sdBody(q, posedA));
        if (hp) {
          const d = Math.hypot(hp[0] - origin[0], hp[1] - origin[1], hp[2] - origin[2]);
          if (d < bestD) { bestD = d; hitActorId = a.id; hitPoint = hp; }
          break;
        }
        pos[0] = next[0]; pos[1] = next[1]; pos[2] = next[2];
        vel[0] = vNext[0]; vel[1] = vNext[1]; vel[2] = vNext[2];
      }
    }
    return { actorId: hitActorId, hit: hitPoint };
}
