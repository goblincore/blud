// src/lab/sdf-zombie/webgpu/game-hit-trace.ts
//
// Slug and melee hit tracing, ceiling and chunk collider queries, on-screen body count and level probe-room stamping.
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
import { levelCeilingM } from './game-level-rooms';
import { roomCeilingM } from './level-def';
import { type Chunk, type ChunkColliders } from '../gib-chunks';
import { convergedDir, muzzleWorld } from './game-weapon-rig';
import type { DebrisGround } from '../debris-ground';
import { clampSpawnInsideMap, seatBurstInsideMap, seatSpawnInsideMap, sectorDebrisGround } from './sector-debris';
import { WOUND_SPAWN_OFFSET } from '../blood-sim';
import { sectorSegmentHit, type SectorHit } from './sector-ray';
import type { SectorGround } from './sector-ground';

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
/** A VOLUME blood burst's spawn on a SECTOR level (plan 3b follow-up): `seatBloodSpawn`'s centre and body floor plus
 *  the per-drop clamp, as the `seat` blood-sim.ts burstVolume takes. Room levels: `{ pos: at, seat: undefined }`
 *  without reading the actor — the shipped burst. */
export function seatBurstSpawn(
  ctx: GameContext, a: { pose(): { pos: Vec3 } } | null, at: Vec3,
): { pos: Vec3; floorY: number | undefined; seat: { floorY?: number; clamp: (p: Vec3) => Vec3 } | undefined } {
  const map = sectorsOf(ctx);
  if (!map) return { pos: at, floorY: undefined, seat: undefined };
  const s = seatBurstInsideMap(map, ctx.world.level.ground as SectorGround, a ? actorSpawnCentre(ctx, a) : null, at,
    WOUND_SPAWN_OFFSET);
  return { pos: s.pos, floorY: s.floorY, seat: { ...(s.floorY === undefined ? {} : { floorY: s.floorY }), clamp: s.clamp } };
}

/** Where a slug fired RIGHT NOW would hit — the shared predictor.
 *  Lifted out of __sdfGame so aimAtNearestSurface can CONFIRM an aim
 *  with the same code the placement gate uses, rather than trusting a
 *  cluster centre. No state mutated. */
/** The ballistic slug march itself, parameterised by the firing ray. The
 *  grapeshot's wrapper below calls it from the muzzle; slot 5's flare calls
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

/** A STRAIGHT melee trace: the nearest body hit by the ray origin → origin + dir * reach (the rod's trace; the slug's
 *  ballistic march above is 240 gravity steps against every body within 20 m, and its hit sits a hair under the aim line at
 *  full reach). Same broad phase (a live cluster sphere near the segment) and the same narrow phase (traceProjectile on
 *  sdBody) as traceSlugHitFrom, in ONE segment per body. Level geometry does not block it (as the slug trace). No state
 *  mutated. */
export function traceMeleeHitFrom(
  ctx: GameContext, origin: Vec3, dir: Vec3, reach: number,
): { actorId: number; hit: Vec3 | null } {
  const end: Vec3 = [origin[0] + dir[0] * reach, origin[1] + dir[1] * reach, origin[2] + dir[2] * reach];
  let bestD = Infinity;
  let hitActorId = -1;
  let hitPoint: Vec3 | null = null;
  for (const a of ctx.world.actors) {
    const posedA = a.posed();
    if (!segmentNearAnySphere(origin, end, posedA.clusters.filter(cc => cc.alive), SLUG_BROADPHASE_MARGIN)) continue;
    const hp = traceProjectile(origin, end, q => sdBody(q, posedA));
    if (!hp) continue;
    const d = Math.hypot(hp[0] - origin[0], hp[1] - origin[1], hp[2] - origin[2]);
    if (d < bestD) { bestD = d; hitActorId = a.id; hitPoint = hp; }
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
  // Sector levels: the sector's ceiling over the point; sky (Infinity) or off the map (NaN) falls back
  // to the level's tallest ceiling, like a point inside no room.
  if (ctx.world.level.def?.sectors) {
    const c = ctx.world.level.ground.ceilAt(x, z);
    return Number.isFinite(c) ? c : levelCeilingM(ctx);
  }
  for (const t of ctx.world.level.tunnels) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.height;
  }
  for (const r of ctx.world.level.rooms) {
    // roomCeilingM: an open-sky room has no ceiling for a lob (Outdoor v1 §7).
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return roomCeilingM(r);
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
export function chunkCollidersAt(ctx: GameContext, pos: Vec3): ChunkColliders {
  // Sector levels (plan 3b) add the debris ground: the floor under the chunk now and the sector walls. Room levels
  // get the same two fields as before, so stepChunk runs its y = 0 path unchanged.
  const ground = debrisGround(ctx);
  const boxes = ctx.world.colliders, ceilingY = ceilingAt(ctx, pos[0], pos[2]);
  return ground ? { boxes, ceilingY, ground } : { boxes, ceilingY };
}

/** The debris ground on a SECTOR level (plan 3b), or null on a room level — where every debris stepper keeps its
 *  y = 0 plane exactly. Cached per map inside sector-debris.ts, so this is a WeakMap lookup per call. */
export function debrisGround(ctx: GameContext): DebrisGround | null {
  const map = ctx.world.level.def?.sectors;
  return map ? sectorDebrisGround(map, ctx.world.level.ground as SectorGround) : null;
}

/** Where a → b first meets sector geometry, or null (always null on room levels). */
export function sectorHitBetween(ctx: GameContext, a: Vec3, b: Vec3): SectorHit | null {
  const map = ctx.world.level.def?.sectors;
  return map ? sectorSegmentHit(map, ctx.world.level.ground as SectorGround, a, b) : null;
}

/** The level's sector map, or undefined on a room level — optional all the way down, because the spawn helpers below
 *  run inside spawners that tests drive with a bare stub context. */
function sectorsOf(ctx: GameContext) {
  return ctx.world?.level?.def?.sectors;
}

/** SPAWNS START INSIDE THE LEVEL (plan 3b): `to` pulled back toward the body centre `from` if from → to meets sector
 *  geometry (sector-debris.ts clampSpawnInsideMap). Room levels: `to` itself, untouched. */
export function clampSpawnInside(ctx: GameContext, from: Vec3, to: Vec3, radius = 0): Vec3 {
  const map = sectorsOf(ctx);
  return map ? clampSpawnInsideMap(map, ctx.world.level.ground as SectorGround, from, to, radius) : to;
}

/** How high over an actor's feet its spawn-clamp centre sits, metres (mid torso; under every E1M1 ceiling). */
export const SPAWN_CENTRE_M = 0.9;
/** The body centre debris spawns are clamped from: `SPAWN_CENTRE_M` over the actor's feet, kept 5 cm under the
 *  sector's ceiling. Null on room levels (nothing to clamp against). */
export function spawnCentreOf(ctx: GameContext, feet: Vec3): Vec3 | null {
  if (!sectorsOf(ctx)) return null;
  const ceil = ctx.world.level.ground.ceilAt(feet[0], feet[2]);
  const y = feet[1] + SPAWN_CENTRE_M;
  return [feet[0], Number.isFinite(ceil) ? Math.max(feet[1], Math.min(y, ceil - 0.05)) : y, feet[2]];
}

/** `spawnCentreOf` an actor's feet; null on room levels without reading the actor. */
export function actorSpawnCentre(ctx: GameContext, a: { pose(): { pos: Vec3 } }): Vec3 | null {
  return sectorsOf(ctx) ? spawnCentreOf(ctx, a.pose().pos) : null;
}

/** A new chunk on a SECTOR level: its position clamped inside the level from the body centre `from` (when the caller
 *  knows the body) and its `floorY` seeded with the body's floor (else the floor under the piece), so it never starts
 *  inside a wall or a column and keeps a floor if it spawns over a hole. Returns a NEW chunk (a view that recentred
 *  its prims on the old object keeps it); room levels return `c` itself, untouched. */
export function seatChunkSpawn(ctx: GameContext, c: Chunk, from?: Vec3 | null): Chunk {
  const map = sectorsOf(ctx);
  if (!map) return c;
  const ground = ctx.world.level.ground;
  const pos = from ? clampSpawnInside(ctx, from, c.pos, c.radius) : c.pos;
  const bodyFloor = from ? ground.floorAt(from[0], from[2]) : NaN;
  const ownFloor = ground.floorAt(pos[0], pos[2]);
  const floorY = Number.isFinite(bodyFloor) ? bodyFloor : Number.isFinite(ownFloor) ? ownFloor : c.floorY;
  return { ...c, pos: [pos[0], pos[1], pos[2]], ...(floorY === undefined ? {} : { floorY }) };
}

/** A BLOOD spawn point on a SECTOR level (plan 3b): `at` (a wound anchor, a gout centre) clamped inside the level from
 *  the body's spawn centre (`actorSpawnCentre`; a limb poking through a wall bleeds on this side of it) by the drops'
 *  spawn offset, and the body's floor to seed the drops' `floorY` with (blood-sim.ts spawnImpactGout /
 *  spawnWoundDroplets). Room levels: `{ pos: at, floorY: undefined }` without reading the actor — the shipped spawn. */
export function seatBloodSpawn(
  ctx: GameContext, a: { pose(): { pos: Vec3 } } | null, at: Vec3,
): { pos: Vec3; floorY: number | undefined } {
  const map = sectorsOf(ctx);
  if (!map) return { pos: at, floorY: undefined };
  return seatSpawnInsideMap(map, ctx.world.level.ground as SectorGround, a ? actorSpawnCentre(ctx, a) : null, at,
    WOUND_SPAWN_OFFSET);
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
