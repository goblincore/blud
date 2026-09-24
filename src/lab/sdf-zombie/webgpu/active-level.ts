// src/lab/sdf-zombie/webgpu/active-level.ts
//
// THE ACTIVE LEVEL. Everything in the game that used to read the ring's
// globals (ROOMS, TUNNELS, FURNITURE, PLAYER_START, levelColliders(), ...)
// reads one of these instead, from ctx.world.level. Two implementations:
//   ringLevel()      — the testbed, delegating to game-level.ts unchanged
//   authoredLevel()  — a parsed Level Format v1 file
// Pure: no three.js.

import type { Box, EnclosureWalls } from '../ambient';
import type { Vec3 } from '../types';
import {
  FURNITURE, PLAYER_START, ROOMS, TUNNELS, enclosureKeyAt, enclosureOf, levelColliders, levelSurfaces,
  spawnPoints, type Aabb, type FurnitureDef, type RoomDef, type TunnelDef,
} from './game-level';
import {
  enclosureKeyIn, enclosureOfIn, gateColliders, layoutColliders, layoutSurfaces,
  roomAtPoint, type Capability, type LevelDef, type LevelSurfaceSet,
} from './level-def';

/** Capabilities the web engine can load today (spec §8). */
export const ENGINE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(['windows', 'open-sky']);

export function missingCapabilities(def: LevelDef, supported: ReadonlySet<Capability>): Capability[] {
  return def.requires.filter(c => !supported.has(c));
}

export interface LevelSpawn { id: string; kind: 'zombie' | 'soldier'; room: RoomDef; pos: Vec3 }

export interface ActiveLevel {
  /** 'ring' for the testbed, else the authored level id. */
  id: string;
  /** The parsed level, or null for the ring. */
  def: LevelDef | null;
  rooms: readonly RoomDef[];
  tunnels: readonly TunnelDef[];
  furniture: readonly FurnitureDef[];
  playerStart: { x: number; y: number; z: number; yaw: number; pitch: number };
  /** Walls, headers, lintels, furniture, solids: never changes after load. */
  staticColliders: Aabb[];
  surfaces: LevelSurfaceSet;
  keyAt(x: number, z: number): string;
  enclosureFor(key: string): { box: Box; walls: EnclosureWalls } | null;
  gateColliders(open: ReadonlySet<string>): Aabb[];
  /** Enemies to spawn at load, in spawn order. */
  spawnList(): LevelSpawn[];
}

export function ringLevel(): ActiveLevel {
  const s = levelSurfaces();
  return {
    id: 'ring',
    def: null,
    rooms: ROOMS,
    tunnels: TUNNELS,
    furniture: FURNITURE,
    playerStart: { ...PLAYER_START, y: 0 },
    staticColliders: levelColliders(),
    surfaces: { planes: s.planes, boxes: s.boxes, gates: [], windows: [], skyline: null },
    keyAt: enclosureKeyAt,
    enclosureFor: enclosureOf,
    gateColliders: () => [],
    spawnList: () => ROOMS.flatMap(room => spawnPoints(room).map((pos, index) => ({
      id: `ring-${room.id}-${index}`,
      kind: index < (room.soldiers ?? 0) ? 'soldier' as const : 'zombie' as const,
      room,
      pos,
    }))),
  };
}

export function authoredLevel(def: LevelDef): ActiveLevel {
  return {
    id: def.id,
    def,
    rooms: def.rooms,
    tunnels: def.tunnels,
    furniture: def.furniture,
    playerStart: { ...def.playerStart },
    staticColliders: layoutColliders(def),
    surfaces: layoutSurfaces(def),
    keyAt: (x, z) => enclosureKeyIn(def, x, z),
    enclosureFor: key => enclosureOfIn(def, key),
    gateColliders: open => gateColliders(def, open),
    spawnList: () => def.spawns.flatMap(s => {
      const room = roomAtPoint(def, s.pos[0], s.pos[2]);
      return room ? [{ id: s.id, kind: s.kind, room, pos: s.pos }] : [];
    }),
  };
}
