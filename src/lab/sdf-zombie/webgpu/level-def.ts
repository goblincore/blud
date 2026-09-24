// src/lab/sdf-zombie/webgpu/level-def.ts
//
// LEVEL FORMAT v1 — types and the generation rules.
// Spec: docs/superpowers/specs/2026-09-23-level-format-design.md (§4, §6).
//
// An authored level lists rooms, corridors, boxes and markers. Walls around
// each room, openings where a corridor meets a wall, headers above openings,
// corridor side walls and lintels are GENERATED here, by the rule in spec §6.
// The Rust port implements the same rule; the fixtures pin both.
//
// Pure: no three.js, no DOM.

import type { Box, EnclosureWalls } from '../ambient';
import type { Vec3 } from '../types';
import {
  litWallAlbedo, type Aabb, type BoxSpec, type FurnitureDef, type PlaneSpec,
  type RoomDef, type TunnelDef,
} from './game-level';
import type { EdgeStyle, GroundName, SkyName, SkylineName } from './outdoor-presets';

export const LEVEL_WALL_T = 0.3;
/** Spec §3: validation and opening-detection tolerance, metres. */
export const LEVEL_TOL = 0.02;
/** Windows are drawn this far inside the wall so they never z-fight it. */
const WINDOW_NUDGE = 0.01;

export interface LevelPalette { wall: Vec3; floor: Vec3; ceil: Vec3; tunnel: Vec3; solid: Vec3 }

/** The ring's dungeon stone, so an unpainted blockout matches the testbed. */
export const DEFAULT_PALETTE: LevelPalette = {
  wall: [0.21, 0.215, 0.225],
  floor: [0.135, 0.138, 0.142],
  ceil: [0.175, 0.18, 0.19],
  tunnel: [0.10, 0.104, 0.112],
  solid: [0.34, 0.33, 0.32],
};

export type Capability = 'multi-floor' | 'windows' | 'open-sky';
export type WallSide = 'n' | 's' | 'e' | 'w';
export type PickupItem = 'melee' | 'shotgun' | 'dynamite' | 'shells' | 'health' | 'cd';
export const PICKUP_ITEMS: readonly PickupItem[] = ['melee', 'shotgun', 'dynamite', 'shells', 'health', 'cd'];

/** Outdoor v1 §4.1: a strip of another ground laid over a room's floor. */
export interface PathDef { ground: GroundName; minX: number; maxX: number; minZ: number; maxZ: number }
/** Outdoor v1 §4.1: an open-sky room's visible edge. */
export interface EdgeDef { style: EdgeStyle; height: number }

export interface LevelRoom extends RoomDef {
  floor: number;
  /** Sky preset for an open-sky room, else null (spec §4.1; Outdoor v1 §4.1). */
  sky: SkyName | null;
  ground: GroundName;
  paths: PathDef[];
  edge: EdgeDef | null;
}
export interface LevelTunnel extends TunnelDef { floor: number }
export interface StairDef { id: string; up: '+x' | '-x' | '+z' | '-z'; box: Aabb }
export interface WindowDef { id: string; view: string; room: number; side: WallSide; box: Aabb }
export interface PickupDef { id: string; item: PickupItem; pos: Vec3 }
export interface SpawnDef { id: string; kind: 'zombie' | 'soldier'; pos: Vec3; yaw: number }
export interface GraveDef { id: string; wave: number; pos: Vec3; yaw: number }
export interface BellDef { id: string; pos: Vec3; radius: number }
export interface TriggerDef { id: string; event: string; once: boolean; box: Aabb }
export interface GateDef { id: string; opensOn: string; box: Aabb }

/** A parsed level, already filtered to one state (spec §7). */
export interface LevelDef {
  id: string;
  name: string;
  ammo: 'infinite' | 'finite';
  palette: LevelPalette;
  loadout: string[];
  completeOn: string;
  /** The state this LevelDef was filtered to, and every state the file declares. */
  state: string;
  states: string[];
  /** Derived by the parser (spec §8). */
  requires: Capability[];
  /** Outdoor v1 §4.1: backdrop preset beyond open-sky rooms' edges, or null. */
  skyline: SkylineName | null;
  rooms: LevelRoom[];
  tunnels: LevelTunnel[];
  stairs: StairDef[];
  furniture: FurnitureDef[];
  solids: Aabb[];
  gates: GateDef[];
  triggers: TriggerDef[];
  windows: WindowDef[];
  playerStart: { x: number; y: number; z: number; yaw: number; pitch: number };
  spawns: SpawnDef[];
  graves: GraveDef[];
  pickups: PickupDef[];
  bells: BellDef[];
}

export interface Mouth { lo: number; hi: number; tunnel: LevelTunnel }

/** Spec §6.1: openings in one wall of a room, sorted along the wall. */
export function roomMouths(level: Pick<LevelDef, 'tunnels'>, room: LevelRoom, side: WallSide): Mouth[] {
  const out: Mouth[] = [];
  for (const t of level.tunnels) {
    if (t.a !== room.id && t.b !== room.id) continue;
    if (Math.abs(t.floor - room.floor) > LEVEL_TOL) continue;
    if (t.axis === 'x') {
      if (side === 'w' && Math.abs(t.maxX - room.minX) <= LEVEL_TOL) out.push({ lo: t.minZ, hi: t.maxZ, tunnel: t });
      if (side === 'e' && Math.abs(t.minX - room.maxX) <= LEVEL_TOL) out.push({ lo: t.minZ, hi: t.maxZ, tunnel: t });
    } else {
      if (side === 'n' && Math.abs(t.maxZ - room.minZ) <= LEVEL_TOL) out.push({ lo: t.minX, hi: t.maxX, tunnel: t });
      if (side === 's' && Math.abs(t.minZ - room.maxZ) <= LEVEL_TOL) out.push({ lo: t.minX, hi: t.maxX, tunnel: t });
    }
  }
  return out.sort((a, b) => a.lo - b.lo);
}

/** Height above the floor a corridor's walls and lintel reach: the taller joined room. */
function tunnelTop(level: Pick<LevelDef, 'rooms'>, t: LevelTunnel): number {
  let top = t.height;
  for (const r of level.rooms) if (r.id === t.a || r.id === t.b) top = Math.max(top, r.height);
  return top;
}

/** Spec §6.2: every static solid box. Gates are separate (gateColliders). */
export function layoutColliders(level: LevelDef): Aabb[] {
  const T = LEVEL_WALL_T;
  const out: Aabb[] = [];
  const box = (min: Vec3, max: Vec3) => {
    if (max[0] - min[0] > 1e-3 && max[1] - min[1] > 1e-3 && max[2] - min[2] > 1e-3) out.push({ min, max });
  };

  for (const r of level.rooms) {
    const f = r.floor, top = r.floor + r.height;
    for (const side of ['w', 'e'] as const) {
      const x0 = side === 'w' ? r.minX - T : r.maxX;
      const x1 = side === 'w' ? r.minX : r.maxX + T;
      let cursor = r.minZ - T;
      for (const m of roomMouths(level, r, side)) {
        box([x0, f, cursor], [x1, top, m.lo]);
        box([x0, f + m.tunnel.height, m.lo], [x1, top, m.hi]);
        cursor = m.hi;
      }
      box([x0, f, cursor], [x1, top, r.maxZ + T]);
    }
    for (const side of ['n', 's'] as const) {
      const z0 = side === 'n' ? r.minZ - T : r.maxZ;
      const z1 = side === 'n' ? r.minZ : r.maxZ + T;
      let cursor = r.minX - T;
      for (const m of roomMouths(level, r, side)) {
        box([cursor, f, z0], [m.lo, top, z1]);
        box([m.lo, f + m.tunnel.height, z0], [m.hi, top, z1]);
        cursor = m.hi;
      }
      box([cursor, f, z0], [r.maxX + T, top, z1]);
    }
  }

  for (const t of level.tunnels) {
    const f = t.floor, top = t.floor + tunnelTop(level, t);
    if (t.axis === 'x') {
      box([t.minX, f, t.minZ - T], [t.maxX, top, t.minZ]);
      box([t.minX, f, t.maxZ], [t.maxX, top, t.maxZ + T]);
    } else {
      box([t.minX - T, f, t.minZ], [t.minX, top, t.maxZ]);
      box([t.maxX, f, t.minZ], [t.maxX + T, top, t.maxZ]);
    }
    box([t.minX, f + t.height, t.minZ], [t.maxX, top, t.maxZ]);
  }

  for (const fu of level.furniture) {
    const room = level.rooms.find(r => r.id === fu.room);
    const f = room?.floor ?? 0;
    box([fu.minX, f, fu.minZ], [fu.maxX, f + fu.height, fu.maxZ]);
  }
  for (const s of level.solids) box(s.min, s.max);
  return out;
}

/** Boxes of gates that have not opened yet. */
export function gateColliders(level: Pick<LevelDef, 'gates'>, open: ReadonlySet<string>): Aabb[] {
  return level.gates.filter(g => !open.has(g.id)).map(g => g.box);
}

export interface LevelSurfaceSet {
  planes: PlaneSpec[];
  boxes: BoxSpec[];
  gates: { id: string; box: BoxSpec }[];
  windows: { id: string; view: string; plane: PlaneSpec }[];
}

/** Spec §6.3: display geometry. */
export function layoutSurfaces(level: LevelDef): LevelSurfaceSet {
  const P = level.palette;
  const planes: PlaneSpec[] = [];
  const boxes: BoxSpec[] = [];
  const plane = (min: Vec3, max: Vec3, axis: 0 | 1 | 2, facing: 1 | -1, color: Vec3): PlaneSpec => {
    const p = { min, max, axis, facing, color };
    return p;
  };

  for (const r of level.rooms) {
    const f = r.floor, top = r.floor + r.height;
    planes.push(plane([r.minX, f, r.minZ], [r.maxX, f, r.maxZ], 1, 1, r.floorColor));
    if (r.sky === null) planes.push(plane([r.minX, top, r.minZ], [r.maxX, top, r.maxZ], 1, -1, r.ceilColor));
    // West/east walls: fixed x, span z (index 2).
    for (const [side, at, facing] of [['w', r.minX, 1], ['e', r.maxX, -1]] as const) {
      let cursor = r.minZ;
      for (const m of roomMouths(level, r, side)) {
        if (m.lo - cursor > 1e-3) planes.push(plane([at, f, cursor], [at, top, m.lo], 0, facing, r.wallColor));
        if (r.height - m.tunnel.height > 1e-3) planes.push(plane([at, f + m.tunnel.height, m.lo], [at, top, m.hi], 0, facing, r.wallColor));
        cursor = m.hi;
      }
      if (r.maxZ - cursor > 1e-3) planes.push(plane([at, f, cursor], [at, top, r.maxZ], 0, facing, r.wallColor));
    }
    // North/south walls: fixed z, span x (index 0).
    for (const [side, at, facing] of [['n', r.minZ, 1], ['s', r.maxZ, -1]] as const) {
      let cursor = r.minX;
      for (const m of roomMouths(level, r, side)) {
        if (m.lo - cursor > 1e-3) planes.push(plane([cursor, f, at], [m.lo, top, at], 2, facing, r.wallColor));
        if (r.height - m.tunnel.height > 1e-3) planes.push(plane([m.lo, f + m.tunnel.height, at], [m.hi, top, at], 2, facing, r.wallColor));
        cursor = m.hi;
      }
      if (r.maxX - cursor > 1e-3) planes.push(plane([cursor, f, at], [r.maxX, top, at], 2, facing, r.wallColor));
    }
  }

  for (const t of level.tunnels) {
    const f = t.floor;
    planes.push(plane([t.minX, f, t.minZ], [t.maxX, f, t.maxZ], 1, 1, t.color));
    if (t.axis === 'x') {
      planes.push(plane([t.minX, f, t.minZ], [t.maxX, f + t.height, t.minZ], 2, 1, t.color));
      planes.push(plane([t.minX, f, t.maxZ], [t.maxX, f + t.height, t.maxZ], 2, -1, t.color));
    } else {
      planes.push(plane([t.minX, f, t.minZ], [t.minX, f + t.height, t.maxZ], 0, 1, t.color));
      planes.push(plane([t.maxX, f, t.minZ], [t.maxX, f + t.height, t.maxZ], 0, -1, t.color));
    }
    const top = tunnelTop(level, t);
    if (top - t.height > 1e-3) boxes.push({ min: [t.minX, f + t.height, t.minZ], max: [t.maxX, f + top, t.maxZ], color: t.color });
  }

  for (const fu of level.furniture) {
    const f = level.rooms.find(r => r.id === fu.room)?.floor ?? 0;
    boxes.push({ min: [fu.minX, f, fu.minZ], max: [fu.maxX, f + fu.height, fu.maxZ], color: P.solid });
  }
  for (const s of level.solids) boxes.push({ min: s.min, max: s.max, color: P.solid });
  for (const st of level.stairs) boxes.push({ min: st.box.min, max: st.box.max, color: P.solid });

  const gates = level.gates.map(g => ({ id: g.id, box: { min: g.box.min, max: g.box.max, color: P.solid } }));

  const windows = level.windows.map(w => {
    const r = level.rooms.find(rr => rr.id === w.room)!;
    const b = w.box;
    const color: Vec3 = [1, 1, 1];
    let p: PlaneSpec;
    if (w.side === 'w') p = plane([r.minX + WINDOW_NUDGE, b.min[1], b.min[2]], [r.minX + WINDOW_NUDGE, b.max[1], b.max[2]], 0, 1, color);
    else if (w.side === 'e') p = plane([r.maxX - WINDOW_NUDGE, b.min[1], b.min[2]], [r.maxX - WINDOW_NUDGE, b.max[1], b.max[2]], 0, -1, color);
    else if (w.side === 'n') p = plane([b.min[0], b.min[1], r.minZ + WINDOW_NUDGE], [b.max[0], b.max[1], r.minZ + WINDOW_NUDGE], 2, 1, color);
    else p = plane([b.min[0], b.min[1], r.maxZ - WINDOW_NUDGE], [b.max[0], b.max[1], r.maxZ - WINDOW_NUDGE], 2, -1, color);
    return { id: w.id, view: w.view, plane: p };
  });

  return { planes, boxes, gates, windows };
}

/** A corridor first, then a room, else 'void'. */
export function enclosureKeyIn(level: Pick<LevelDef, 'rooms' | 'tunnels'>, x: number, z: number): string {
  for (const t of level.tunnels) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.name;
  }
  for (const r of level.rooms) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.name;
  }
  return 'void';
}

export function roomAtPoint<R extends RoomDef>(level: { rooms: readonly R[] }, x: number, z: number): R | null {
  return level.rooms.find(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ?? null;
}

function wallCentre(box: Box, axis: 0 | 1 | 2, side: -1 | 1): Vec3 {
  const c: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2,
  ];
  c[axis] = side < 0 ? box.min[axis] : box.max[axis];
  return c;
}

/** Bounce uniforms, same rule as game-level.ts enclosureOf. */
export function enclosureOfIn(level: Pick<LevelDef, 'rooms' | 'tunnels'>, key: string): { box: Box; walls: EnclosureWalls } | null {
  const room = level.rooms.find(r => r.name === key);
  if (room) {
    const box: Box = { min: [room.minX, room.floor, room.minZ], max: [room.maxX, room.floor + room.height, room.maxZ] };
    const lit = (axis: 0 | 1 | 2, side: -1 | 1, paint: Vec3): Vec3 =>
      litWallAlbedo(paint, wallCentre(box, axis, side), room.accents);
    return {
      box,
      walls: {
        negX: lit(0, -1, room.wallColor), posX: lit(0, 1, room.wallColor),
        negY: lit(1, -1, room.floorColor), posY: lit(1, 1, room.ceilColor),
        negZ: lit(2, -1, room.wallColor), posZ: lit(2, 1, room.wallColor),
      },
    };
  }
  const t = level.tunnels.find(tt => tt.name === key);
  if (t) {
    return {
      box: { min: [t.minX, t.floor, t.minZ], max: [t.maxX, t.floor + t.height, t.maxZ] },
      walls: { negX: t.color, posX: t.color, negY: t.color, posY: t.color, negZ: t.color, posZ: t.color },
    };
  }
  return null;
}
