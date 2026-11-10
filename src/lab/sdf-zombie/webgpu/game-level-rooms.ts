// src/lab/sdf-zombie/webgpu/game-level-rooms.ts
//
// Runtime helpers for the active level (Level Format v1 — spec
// docs/superpowers/specs/2026-09-23-level-format-design.md). Each takes the
// GameContext explicitly, like the other game-*-leaves.ts modules.

import type { Vec3 } from '../types';
import { type GameContext } from './game-context';
import type { Aabb, RoomDef } from './game-level';
import { doorCollider } from './doors';

/** Rebuild the collider list in place from the level's static boxes, its
 *  closed gates and what is left of each door in its doorway. In place: movers
 *  and the encounter director's sight hold the array reference for the session. */
export function refreshGateColliders(ctx: GameContext): void {
  const w = ctx.world;
  w.colliders.length = 0;
  w.colliders.push(...w.level.staticColliders, ...w.level.gateColliders(w.openGates));
  const shut = closedDoors(ctx);
  w.colliders.push(...shut);
  // Enemies avoid furniture, not the collider list: each one's list gets the closed doors too.
  for (const b of w.actorBlockers) { b.live.length = 0; b.live.push(...b.base, ...shut); }
}

/** What blocks each door's doorway right now (doors.ts), for the colliders and the enemies. */
export function closedDoors(ctx: GameContext): Aabb[] {
  const def = ctx.world.level.def, doors = ctx.world.loop?.doors;
  const out: Aabb[] = [];
  if (def && doors) def.doors.forEach((d, i) => { const c = doorCollider(d, doors[i]!); if (c) out.push(c); });
  return out;
}

/** Open an authored level's gate by id: it stops colliding and its mesh hides.
 *  False for the ring, an unknown id, or a gate already open. */
export function openGate(ctx: GameContext, id: string): boolean {
  const w = ctx.world;
  const def = w.level.def;
  if (!def || w.openGates.has(id) || !def.gates.some(g => g.id === id)) return false;
  w.openGates.add(id);
  refreshGateColliders(ctx);
  const mesh = w.gateMeshes.get(id);
  if (mesh) mesh.visible = false;
  return true;
}

/** The level's room id at the player, or -1 in a tunnel / the void. */
export function roomIdAt(ctx: GameContext, x: number, z: number): number {
  const key = ctx.world.level.keyAt(x, z);
  return ctx.world.level.rooms.find(r => r.name === key)?.id ?? -1;
}

/** Tallest room ceiling in the level: the bundle/gib ceiling fallback for a
 *  point inside no enclosure. */
export function levelCeilingM(ctx: GameContext): number {
  return Math.max(...ctx.world.level.rooms.map(r => r.height));
}

/** A room's spawn positions in the active level, in spawn order. Not the
 *  ring's `spawnPoints(room)`: that reads the ring's own table by room id, and
 *  authored levels reuse ids 1, 2, … for different rooms. */
export function roomSpawnPoints(ctx: GameContext, room: RoomDef): Vec3[] {
  return ctx.world.level.spawnList().filter(s => s.room.id === room.id).map(s => [...s.pos] as Vec3);
}
