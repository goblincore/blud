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
import { levelCeilingM } from './game-level-leaves';
import { type ChunkBox } from '../gib-chunks';
import { convergedDir, muzzleWorld } from './game-weapon-leaves';

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
/** Slack over a cluster sphere before a slug segment is allowed to skip the
 *  body: covers the hit shell (GRAPESHOT.hitEps) and the smooth-union bulge
 *  between neighbouring prims, which a per-cluster sphere does not bound. */
export const SLUG_BROADPHASE_MARGIN = 0.15;

/** True when segment [a, b] passes within `margin` of any sphere. */
export function segmentNearAnySphere(
  a: Vec3, b: Vec3, spheres: readonly { center: Vec3; radius: number }[], margin: number,
): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  for (const s of spheres) {
    const cx = s.center[0] - a[0], cy = s.center[1] - a[1], cz = s.center[2] - a[2];
    const t = len2 > 0 ? Math.min(1, Math.max(0, (cx * dx + cy * dy + cz * dz) / len2)) : 0;
    const ex = cx - dx * t, ey = cy - dy * t, ez = cz - dz * t;
    const r = s.radius + margin;
    if (ex * ex + ey * ey + ez * ez <= r * r) return true;
  }
  return false;
}

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
      // BROAD PHASE (flare tick stall, 2026-09-20). Every segment used to run
      // a full sdBody trace against every actor within 20 m, hit or miss:
      // 61-71 ms per flare shot with 23 actors (a gameplay recording showed it
      // as 50-90 ms of unattributed tick). A segment that stays clear of every
      // live cluster sphere cannot be inside the flesh, so it is skipped; the
      // narrow phase is unchanged, so every hit point is the one it was.
      const spheres = posedA.clusters.filter(cc => cc.alive);
      pos[0] = origin[0]; pos[1] = origin[1]; pos[2] = origin[2];
      vel[0] = d0[0] * SLUG.speed; vel[1] = d0[1] * SLUG.speed; vel[2] = d0[2] * SLUG.speed;
      for (let i = 0; i < 240; i++) {
        const next: Vec3 = [
          pos[0] + vel[0] * dt,
          pos[1] + vel[1] * dt,
          pos[2] + vel[2] * dt,
        ];
        const vNext: Vec3 = [vel[0], vel[1] + SLUG.gravity * dt, vel[2]];
        const hp = segmentNearAnySphere(pos, next, spheres, SLUG_BROADPHASE_MARGIN)
          ? traceProjectile(pos, next, q => sdBody(q, posedA))
          : null;
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

/** The ceiling over a point, PER ENCLOSURE.
 *
 *  A single global plane stopped being correct the moment the arena added a
 *  6 m room to a level whose cells are 3 m: resolving to the TALLEST ceiling
 *  everywhere let a bundle sail out through the small rooms' roofs, and
 *  resolving to the smallest would have clipped the arena at half its height.
 *  Rooms and tunnels each carry their own height, so the plane is a lookup.
 *  `levelCeilingM` (the tallest room) remains the answer for a point inside neither (over a wall
 *  or through a door frame mid-flight), which is the generous case and the one
 *  the collider boxes are there to catch. */
export function ceilingAt(ctx: GameContext, x: number, z: number): number {
  for (const t of ctx.world.level.tunnels) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.height;
  }
  for (const r of ctx.world.level.rooms) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.height;
  }
  // Tallest ceiling in the level: levelColliders() carries no ceiling box for
  // the rooms, so without a ceiling plane a full-charge lob leaves through the
  // roof. Tunnel lintels ARE boxes, so ceiling + boxes reproduce the level.
  return levelCeilingM(ctx);
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

/** Where a slug fired RIGHT NOW would hit — the shared predictor.
 *  Lifted out of __sdfGame so aimAtNearestSurface can CONFIRM an aim
 *  with the same code the placement gate uses, rather than trusting a
 *  cluster centre. No state mutated. */
export function predictSlugHitNow(ctx: GameContext): { origin: Vec3; dir: Vec3; actorId: number; hit: Vec3 | null } {
    const origin = muzzleWorld(ctx);
    const dir = convergedDir(ctx, origin);
    return { origin, dir, ...traceSlugHitFrom(ctx, origin, dir) };
}

/** The silhouette-noise amplitude the hull must budget for (marchCfg.z).
 *  Read from the live uniform rather than a constant, so retuning the noise
 *  cannot silently under-size the hull — X1.21.2 was exactly that bug on the
 *  cone and occluder bounds. */
export function shellAmpOf(ctx: GameContext) {
  return ctx.world.actors[0]?.view.uniforms.marchCfg.value.z ?? 0;
}
