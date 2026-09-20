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
import { ROOMS, TUNNELS } from './game-level';
import { type ChunkBox } from '../gib-chunks';

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

/** Tallest ceiling in the level — the FALLBACK for a bundle outside every
 *  enclosure. levelColliders() carries no ceiling box for the rooms, so
 *  without a ceiling plane a full-charge lob leaves through the roof. Tunnel
 *  lintels ARE boxes (2.2 → 3.0 m), so ceiling + boxes together reproduce the
 *  level including its low mouths. */
export const BUNDLE_CEIL_M = Math.max(...ROOMS.map(r => r.height));

/** The ceiling over a point, PER ENCLOSURE.
 *
 *  A single global plane stopped being correct the moment the arena added a
 *  6 m room to a level whose cells are 3 m: resolving to the TALLEST ceiling
 *  everywhere let a bundle sail out through the small rooms' roofs, and
 *  resolving to the smallest would have clipped the arena at half its height.
 *  Rooms and tunnels each carry their own height, so the plane is a lookup.
 *  `BUNDLE_CEIL_M` remains the answer for a point inside neither (over a wall
 *  or through a door frame mid-flight), which is the generous case and the one
 *  the collider boxes are there to catch. */
export function ceilingAt(ctx: GameContext, x: number, z: number): number {
  for (const t of TUNNELS) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.height;
  }
  for (const r of ROOMS) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.height;
  }
  return BUNDLE_CEIL_M;
}

/**
 * WHAT A DETACHED PIECE COLLIDES WITH. The owner, playing: *"it seems the gibs
 * dont bounce off the walls/have collission"* — correct, and the reason was
 * that `stepChunk` only ever knew about a floor plane at y = radius, so a
 * piece thrown at a wall flew straight through it and out of the level.
 *
 * The boxes are `levelColliders()` — the SAME walls the player and the wander
 * clamp collide with, and they are split around every doorway and tunnel
 * mouth, so a gib sails out of an open door and bounces off the wall beside
 * it. That is why this is the level's collider list and not a box drawn around
 * each room: a room box would have sealed the doors.
 *
 * The ceiling is NOT one of those boxes (they end at WALL_H), so it comes in
 * separately through the page's existing per-enclosure `ceilingAt` — the same
 * lookup the bundle's flight already uses, which is why a piece cannot sail
 * out through the arena's 6 m roof while the 3 m rooms keep theirs.
 */
export function chunkCollidersAt(ctx: GameContext, pos: Vec3): { boxes: readonly ChunkBox[]; ceilingY: number } {
  return { boxes: ctx.world.colliders, ceilingY: ceilingAt(ctx, pos[0], pos[2]) };
}
