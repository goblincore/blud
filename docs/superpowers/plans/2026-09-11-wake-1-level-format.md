# The Wake 1: Level Format + Blender Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1–4 are pure and dispatchable; Tasks 5–6 edit `game-main.ts` and run the browser gate (session).

**Status:** planned 2026-09-11. Part 1 of 3 for level 0, The Wake.
**Brief:** [docs/game/levels/00-the-wake/implementation.md](../../game/levels/00-the-wake/implementation.md) (read §2 base branch and §3 decisions first).

**Goal:** Levels authored in Blender load into the SDF FPS via `?level=<id>`, and the Wake blockout is playable end to end as geometry.

**Architecture:** A level is a JSON file of boxes and markers. `level-def.ts` holds the types and *generic* generators (colliders, display planes, enclosure lookups) that turn rooms + tunnels into walls, mouths and lintels, the same way the hand-built ring level does. `level-json.ts` validates the JSON. A Blender script builds the Wake blockout `.blend`; a second exports any `.blend` to JSON. `game-main.ts` swaps its hard-coded level globals for "active level" accessors when `?level=` is present. No param keeps the ring level byte-for-byte.

**Tech Stack:** TypeScript, vitest (`happy-dom`), three r185 WebGPU, Blender 5.2 `bpy` (headless), no-deps CDP gate scripts.

---

## Facts pinned for the implementer (verified 2026-09-11)

- **The ring level** is `src/lab/sdf-zombie/webgpu/game-level.ts`: pure data + functions. Types to reuse: `Aabb {min,max}`, `RoomDef`, `TunnelDef`, `FurnitureDef`, `PlaneSpec`, `BoxSpec`, `AccentLight`; function `litWallAlbedo(paint, point, accents)`. Its `levelColliders()` is **hand-built for the ring** and is not generic. Do not change the ring's behaviour; its tests and gates pin it.
- **Coordinates:** metres, y up, floor at y = 0. Player forward is `[sin yaw, 0, -cos yaw]` (`game-player.ts`). Walls are `WALL_T = 0.3` thick.
- **Display planes** (`PlaneSpec`): a plane on axis 0 has `min[0] === max[0]` and spans **z** in index 2; a plane on axis 2 has `min[2] === max[2]` and spans **x** in index 0. Writing the span into the wrong component collapses the wall to an invisible line (a known past bug).
- **Player collision** is capsule vs a flat `Aabb[]` with a hard floor at y = 0 (`stepPlayer(s, input, dt, colliders)`).
- **Enemy navigation** is `createEncounterNavigation(rooms, tunnels, boxes)` (`webgpu/encounter-navigation.ts`): a 0.4 m grid over the rooms' bounding box. A point can be stood on if it is inside any room or tunnel rectangle and clear of boxes whose `min[1] < 1.8 && max[1] > 0.1` (inflated by 0.34 m).
- **Probe lighting** takes `createRoomProbes({ rooms, furniture, light })` (`webgpu/room-probes.ts`).
- **Tests** sit next to modules (`foo.test.ts`), `import { describe, expect, it } from 'vitest'`. Run one file with `npx vitest run <path>`; typecheck with `npx tsc --noEmit -p .`.
- **Blender** is `/opt/homebrew/bin/blender` (5.2). Headless: `blender --background --factory-startup --python <script> -- <args>`. Blender is Z-up; the game is Y-up. **game = (bx, bz, -by)**; game yaw = −(Blender rotation about Z).

## File structure

| File | Responsibility |
| --- | --- |
| Create `src/lab/sdf-zombie/webgpu/level-def.ts` | Level types; generic colliders, surfaces, enclosure lookup, room lookup |
| Create `src/lab/sdf-zombie/webgpu/level-def.test.ts` | Hand-worked layout tests |
| Create `src/lab/sdf-zombie/webgpu/level-json.ts` | `parseLevelJson(raw)`: validate the JSON, build a `LevelDef` |
| Create `src/lab/sdf-zombie/webgpu/level-json.test.ts` | Validation tests on inline fixtures |
| Create `scripts/levels/export_level.py` | `bpy`: `.blend` → level JSON |
| Create `scripts/levels/build_the_wake_blockout.py` | `bpy`: build the Wake blockout `.blend` from a layout table |
| Create `assets-source/levels/the-wake.blend` | Generated, committed; the owner edits it in Blender from here on |
| Create `public/assets/levels/the-wake.level.json` | Exported, committed |
| Create `src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts` | The committed Wake JSON parses, is fully routable, and the crypt gate blocks |
| Create `docs/game/levels/blender-conventions.md` | How to author a level in Blender |
| Modify `src/lab/sdf-zombie/webgpu/game-main.ts` | `?level=` loading and active-level accessors |
| Create `scripts/sdf-game-wake-gate.mjs`, `scripts/sdf-game-wake-gate.sh` | Headless gate |

---

### Task 1: `level-def.ts` — types and generic layout generators (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-def.ts`
- Create: `src/lab/sdf-zombie/webgpu/level-def.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/level-def.test.ts
//
// Hand-worked gates for the generic layout generators: two 8x8 rooms joined
// by a corridor along x. If walls, mouths or lintels are wrong, the walk test
// or the corridor-clear test fails before anything reaches the renderer.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import {
  DEFAULT_PALETTE, LEVEL_WALL_T, enclosureKeyIn, enclosureOfIn, gateColliders,
  layoutColliders, layoutSurfaces, roomAtPoint, roomMouths, type LevelDef,
} from './level-def';
import { stepPlayer, type PlayerState } from './game-player';

function twoRooms(): LevelDef {
  const P = DEFAULT_PALETTE;
  const room = (id: number, name: string, minX: number, maxX: number) => ({
    id, name, minX, maxX, minZ: 0, maxZ: 8, height: 3,
    wallColor: P.wall, floorColor: P.floor, ceilColor: P.ceil, accents: [], zombies: 0,
  });
  return {
    id: 'two', name: 'Two rooms', ammo: 'infinite', palette: P, loadout: [], completeOn: 'pickup.cd',
    rooms: [room(1, 'west', 0, 8), room(2, 'east', 9.6, 17.6)],
    tunnels: [{ name: 'tunnel-1-2', a: 1, b: 2, minX: 8, maxX: 9.6, minZ: 3.2, maxZ: 4.8,
      height: 2.2, color: P.tunnel, axis: 'x' }],
    furniture: [], solids: [],
    gates: [{ id: 'door', opensOn: 'open.door', box: { min: [8.6, 0, 3.2], max: [9.0, 2.2, 4.8] } }],
    triggers: [], playerStart: { x: 4, z: 4, yaw: Math.PI / 2, pitch: 0 },
    spawns: [], graves: [], pickups: [], bells: [],
  };
}

const hitsPoint = (boxes: readonly { min: Vec3; max: Vec3 }[], p: Vec3) =>
  boxes.some(b => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1]
    && p[2] > b.min[2] && p[2] < b.max[2]);

describe('roomMouths', () => {
  it('finds the corridor on the east wall of room 1 and the west wall of room 2 only', () => {
    const L = twoRooms();
    expect(roomMouths(L, L.rooms[0]!, 'e').map(m => [m.lo, m.hi])).toEqual([[3.2, 4.8]]);
    expect(roomMouths(L, L.rooms[0]!, 'w')).toEqual([]);
    expect(roomMouths(L, L.rooms[1]!, 'w').map(m => [m.lo, m.hi])).toEqual([[3.2, 4.8]]);
    expect(roomMouths(L, L.rooms[1]!, 'n')).toEqual([]);
  });
});

describe('layoutColliders', () => {
  it('leaves the corridor clear at walking height', () => {
    const boxes = layoutColliders(twoRooms());
    for (let x = 7.9; x <= 9.7; x += 0.1) expect(hitsPoint(boxes, [x, 1.0, 4.0])).toBe(false);
  });

  it('closes every other stretch of wall', () => {
    const boxes = layoutColliders(twoRooms());
    expect(hitsPoint(boxes, [8.15, 1.0, 1.0])).toBe(true);          // room 1 east wall, south of the mouth
    expect(hitsPoint(boxes, [4.0, 1.0, -0.15])).toBe(true);         // room 1 north wall
    expect(hitsPoint(boxes, [8.15, 2.6, 4.0])).toBe(true);          // header above the mouth
    expect(hitsPoint(boxes, [8.8, 1.0, 3.2 - LEVEL_WALL_T / 2])).toBe(true); // corridor side wall
  });

  it('lets the player walk from room 1 through the corridor into room 2', () => {
    const boxes = layoutColliders(twoRooms());
    const s: PlayerState = { pos: [4, 0, 4], vel: [0, 0, 0], yaw: Math.PI / 2, pitch: 0, grounded: true };
    for (let i = 0; i < 240; i++) stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, boxes);
    expect(s.pos[0]).toBeGreaterThan(10.5);
    expect(Math.abs(s.pos[2] - 4)).toBeLessThan(0.05);
  });

  it('stops the player at a solid wall', () => {
    const boxes = layoutColliders(twoRooms());
    const s: PlayerState = { pos: [4, 0, 4], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true };
    for (let i = 0; i < 240; i++) stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, boxes);
    expect(s.pos[2]).toBeGreaterThan(0.3); // yaw 0 walks toward -z, into the north wall at z = 0
  });
});

describe('gateColliders', () => {
  it('returns closed gates and drops opened ones', () => {
    const L = twoRooms();
    expect(gateColliders(L, new Set())).toHaveLength(1);
    expect(gateColliders(L, new Set(['door']))).toHaveLength(0);
  });
});

describe('layoutSurfaces', () => {
  it('gives each room a floor and a ceiling', () => {
    const { planes } = layoutSurfaces(twoRooms());
    expect(planes.filter(p => p.axis === 1 && p.facing === 1 && p.min[1] === 0)).toHaveLength(3); // 2 rooms + 1 corridor
    expect(planes.filter(p => p.axis === 1 && p.facing === -1)).toHaveLength(2);
  });

  it('puts a header plane over the mouth, and every wall plane has positive extent on its span axis', () => {
    const { planes } = layoutSurfaces(twoRooms());
    const header = planes.find(p => p.axis === 0 && p.min[0] === 8 && p.min[1] === 2.2);
    expect(header).toBeDefined();
    for (const p of planes) {
      if (p.axis === 0) expect(p.max[2] - p.min[2]).toBeGreaterThan(1e-3);
      if (p.axis === 2) expect(p.max[0] - p.min[0]).toBeGreaterThan(1e-3);
    }
  });

  it('returns gates separately so they can be hidden', () => {
    expect(layoutSurfaces(twoRooms()).gates.map(g => g.id)).toEqual(['door']);
  });
});

describe('enclosure lookups', () => {
  it('names the corridor, the rooms and the void', () => {
    const L = twoRooms();
    expect(enclosureKeyIn(L, 8.8, 4)).toBe('tunnel-1-2');
    expect(enclosureKeyIn(L, 2, 2)).toBe('west');
    expect(enclosureKeyIn(L, 30, 30)).toBe('void');
    expect(roomAtPoint(L, 12, 1)?.id).toBe(2);
    expect(roomAtPoint(L, 8.8, 4)).toBeNull();
  });

  it('builds bounce uniforms for a room and a tunnel', () => {
    const L = twoRooms();
    expect(enclosureOfIn(L, 'west')?.box).toEqual({ min: [0, 0, 0], max: [8, 3, 8] });
    expect(enclosureOfIn(L, 'tunnel-1-2')?.walls.negX).toEqual(DEFAULT_PALETTE.tunnel);
    expect(enclosureOfIn(L, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-def.test.ts`
Expected: FAIL — `Cannot find module './level-def'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/level-def.ts
//
// AUTHORED LEVELS. The ring level (game-level.ts) is hand-built: its colliders
// are written box by box for that one layout. An authored level is described
// only by rooms, tunnels, furniture, solids and markers, and everything else
// (walls around each room, openings where a tunnel meets a wall, the header
// above each opening, corridor walls and lintels) is GENERATED here.
//
// Pure: no three.js, no DOM. The renderer, the player, the navigation grid and
// the probes all ask these functions the same questions.
//
// Coordinates: metres, y up, floor at y = 0 (one floor height in v1).

import type { Box, EnclosureWalls } from '../ambient';
import type { Vec3 } from '../types';
import {
  litWallAlbedo, type Aabb, type BoxSpec, type FurnitureDef, type PlaneSpec,
  type RoomDef, type TunnelDef,
} from './game-level';

export const LEVEL_WALL_T = 0.3;

/** Openings are found by edge contact; the exporter rounds to millimetres. */
const MOUTH_TOL = 0.02;

export interface LevelPalette { wall: Vec3; floor: Vec3; ceil: Vec3; tunnel: Vec3; solid: Vec3 }

/** The ring's dungeon stone, so an unpainted blockout looks like the rest. */
export const DEFAULT_PALETTE: LevelPalette = {
  wall: [0.21, 0.215, 0.225],
  floor: [0.135, 0.138, 0.142],
  ceil: [0.175, 0.18, 0.19],
  tunnel: [0.10, 0.104, 0.112],
  solid: [0.34, 0.33, 0.32],
};

export type PickupItem = 'shotgun' | 'shells' | 'health' | 'cd' | 'melee';
export interface PickupDef { id: string; item: PickupItem; pos: Vec3 }
export interface SpawnDef { id: string; kind: 'zombie' | 'soldier'; pos: Vec3; yaw: number }
/** A grave that releases one zombie when its wave is called. */
export interface GraveDef { id: string; wave: number; pos: Vec3; yaw: number }
export interface BellDef { id: string; pos: Vec3; radius: number }
/** Fires `event` when the player's feet enter `box`. */
export interface TriggerDef { id: string; event: string; once: boolean; box: Aabb }
/** A solid box removed when `opensOn` fires. */
export interface GateDef { id: string; opensOn: string; box: Aabb }

export interface LevelDef {
  id: string;
  name: string;
  ammo: 'infinite' | 'finite';
  palette: LevelPalette;
  /** Weapons the player holds at the start, e.g. ['melee']. */
  loadout: string[];
  /** The event that completes the level, e.g. 'pickup.cd'. */
  completeOn: string;
  rooms: RoomDef[];
  tunnels: TunnelDef[];
  furniture: FurnitureDef[];
  solids: Aabb[];
  gates: GateDef[];
  triggers: TriggerDef[];
  playerStart: { x: number; z: number; yaw: number; pitch: number };
  spawns: SpawnDef[];
  graves: GraveDef[];
  pickups: PickupDef[];
  bells: BellDef[];
}

export type WallSide = 'n' | 's' | 'e' | 'w';
export interface Mouth { lo: number; hi: number; tunnel: TunnelDef }

/** Openings in one wall of a room, sorted along the wall. West/east walls
 *  (x = minX / maxX) meet x-axis corridors and span z; north/south walls
 *  (z = minZ / maxZ) meet z-axis corridors and span x. */
export function roomMouths(level: Pick<LevelDef, 'tunnels'>, room: RoomDef, side: WallSide): Mouth[] {
  const out: Mouth[] = [];
  for (const t of level.tunnels) {
    if (t.a !== room.id && t.b !== room.id) continue;
    if (t.axis === 'x') {
      if (side === 'w' && Math.abs(t.maxX - room.minX) <= MOUTH_TOL) out.push({ lo: t.minZ, hi: t.maxZ, tunnel: t });
      if (side === 'e' && Math.abs(t.minX - room.maxX) <= MOUTH_TOL) out.push({ lo: t.minZ, hi: t.maxZ, tunnel: t });
    } else {
      if (side === 'n' && Math.abs(t.maxZ - room.minZ) <= MOUTH_TOL) out.push({ lo: t.minX, hi: t.maxX, tunnel: t });
      if (side === 's' && Math.abs(t.minZ - room.maxZ) <= MOUTH_TOL) out.push({ lo: t.minX, hi: t.maxX, tunnel: t });
    }
  }
  return out.sort((a, b) => a.lo - b.lo);
}

/** Height a corridor's walls and lintel must reach: the taller joined room. */
function tunnelTop(level: LevelDef, t: TunnelDef): number {
  let top = t.height;
  for (const r of level.rooms) if (r.id === t.a || r.id === t.b) top = Math.max(top, r.height);
  return top;
}

/** Every static solid box: room walls split around openings, headers above
 *  openings, corridor side walls and lintels, furniture, solids. Gates are
 *  NOT included; see gateColliders. */
export function layoutColliders(level: LevelDef): Aabb[] {
  const T = LEVEL_WALL_T;
  const out: Aabb[] = [];
  const box = (min: Vec3, max: Vec3) => {
    if (max[0] - min[0] > 1e-3 && max[1] - min[1] > 1e-3 && max[2] - min[2] > 1e-3) out.push({ min, max });
  };

  for (const r of level.rooms) {
    const h = r.height;
    for (const side of ['w', 'e'] as const) {
      const x0 = side === 'w' ? r.minX - T : r.maxX;
      const x1 = side === 'w' ? r.minX : r.maxX + T;
      let cursor = r.minZ - T;
      for (const m of roomMouths(level, r, side)) {
        box([x0, 0, cursor], [x1, h, m.lo]);
        box([x0, m.tunnel.height, m.lo], [x1, h, m.hi]);
        cursor = m.hi;
      }
      box([x0, 0, cursor], [x1, h, r.maxZ + T]);
    }
    for (const side of ['n', 's'] as const) {
      const z0 = side === 'n' ? r.minZ - T : r.maxZ;
      const z1 = side === 'n' ? r.minZ : r.maxZ + T;
      let cursor = r.minX - T;
      for (const m of roomMouths(level, r, side)) {
        box([cursor, 0, z0], [m.lo, h, z1]);
        box([m.lo, m.tunnel.height, z0], [m.hi, h, z1]);
        cursor = m.hi;
      }
      box([cursor, 0, z0], [r.maxX + T, h, z1]);
    }
  }

  for (const t of level.tunnels) {
    const top = tunnelTop(level, t);
    if (t.axis === 'x') {
      box([t.minX, 0, t.minZ - T], [t.maxX, top, t.minZ]);
      box([t.minX, 0, t.maxZ], [t.maxX, top, t.maxZ + T]);
    } else {
      box([t.minX - T, 0, t.minZ], [t.minX, top, t.maxZ]);
      box([t.maxX, 0, t.minZ], [t.maxX + T, top, t.maxZ]);
    }
    box([t.minX, t.height, t.minZ], [t.maxX, top, t.maxZ]);
  }

  for (const f of level.furniture) box([f.minX, 0, f.minZ], [f.maxX, f.height, f.maxZ]);
  for (const s of level.solids) box(s.min, s.max);
  return out;
}

/** The boxes of gates that have not opened yet. */
export function gateColliders(level: LevelDef, open: ReadonlySet<string>): Aabb[] {
  return level.gates.filter(g => !open.has(g.id)).map(g => g.box);
}

/** Display geometry: inward planes per room and corridor, lintel boxes,
 *  furniture and solid boxes. Gates come back separately so the renderer can
 *  hide one when it opens. */
export function layoutSurfaces(level: LevelDef): {
  planes: PlaneSpec[];
  boxes: BoxSpec[];
  gates: { id: string; box: BoxSpec }[];
} {
  const P = level.palette;
  const planes: PlaneSpec[] = [];
  const boxes: BoxSpec[] = [];
  const plane = (min: Vec3, max: Vec3, axis: 0 | 1 | 2, facing: 1 | -1, color: Vec3) =>
    planes.push({ min, max, axis, facing, color });

  for (const r of level.rooms) {
    plane([r.minX, 0, r.minZ], [r.maxX, 0, r.maxZ], 1, 1, r.floorColor);
    plane([r.minX, r.height, r.minZ], [r.maxX, r.height, r.maxZ], 1, -1, r.ceilColor);
    // West/east walls: fixed x, span z (index 2).
    for (const [side, at, facing] of [['w', r.minX, 1], ['e', r.maxX, -1]] as const) {
      let cursor = r.minZ;
      for (const m of roomMouths(level, r, side)) {
        if (m.lo - cursor > 1e-3) plane([at, 0, cursor], [at, r.height, m.lo], 0, facing, r.wallColor);
        if (r.height - m.tunnel.height > 1e-3) plane([at, m.tunnel.height, m.lo], [at, r.height, m.hi], 0, facing, r.wallColor);
        cursor = m.hi;
      }
      if (r.maxZ - cursor > 1e-3) plane([at, 0, cursor], [at, r.height, r.maxZ], 0, facing, r.wallColor);
    }
    // North/south walls: fixed z, span x (index 0).
    for (const [side, at, facing] of [['n', r.minZ, 1], ['s', r.maxZ, -1]] as const) {
      let cursor = r.minX;
      for (const m of roomMouths(level, r, side)) {
        if (m.lo - cursor > 1e-3) plane([cursor, 0, at], [m.lo, r.height, at], 2, facing, r.wallColor);
        if (r.height - m.tunnel.height > 1e-3) plane([m.lo, m.tunnel.height, at], [m.hi, r.height, at], 2, facing, r.wallColor);
        cursor = m.hi;
      }
      if (r.maxX - cursor > 1e-3) plane([cursor, 0, at], [r.maxX, r.height, at], 2, facing, r.wallColor);
    }
  }

  for (const t of level.tunnels) {
    plane([t.minX, 0, t.minZ], [t.maxX, 0, t.maxZ], 1, 1, t.color);
    if (t.axis === 'x') {
      plane([t.minX, 0, t.minZ], [t.maxX, t.height, t.minZ], 2, 1, t.color);
      plane([t.minX, 0, t.maxZ], [t.maxX, t.height, t.maxZ], 2, -1, t.color);
    } else {
      plane([t.minX, 0, t.minZ], [t.minX, t.height, t.maxZ], 0, 1, t.color);
      plane([t.maxX, 0, t.minZ], [t.maxX, t.height, t.maxZ], 0, -1, t.color);
    }
    const top = tunnelTop(level, t);
    if (top - t.height > 1e-3) boxes.push({ min: [t.minX, t.height, t.minZ], max: [t.maxX, top, t.maxZ], color: t.color });
  }

  for (const f of level.furniture) {
    boxes.push({ min: [f.minX, 0, f.minZ], max: [f.maxX, f.height, f.maxZ], color: P.solid });
  }
  for (const s of level.solids) boxes.push({ min: s.min, max: s.max, color: P.solid });
  const gates = level.gates.map(g => ({ id: g.id, box: { min: g.box.min, max: g.box.max, color: P.solid } }));
  return { planes, boxes, gates };
}

/** The enclosure a point belongs to: a corridor first, then a room, else 'void'. */
export function enclosureKeyIn(level: LevelDef, x: number, z: number): string {
  for (const t of level.tunnels) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.name;
  }
  for (const r of level.rooms) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.name;
  }
  return 'void';
}

/** The room containing (x, z), or null (corridors and outside). */
export function roomAtPoint(level: Pick<LevelDef, 'rooms'>, x: number, z: number): RoomDef | null {
  return level.rooms.find(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ?? null;
}

function wallCentre(box: Box, axis: 0 | 1 | 2, side: -1 | 1): Vec3 {
  const c: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2,
  ];
  c[axis] = side < 0 ? box.min[axis] : box.max[axis];
  return c;
}

/** Bounce uniforms for one enclosure: same rule as game-level.ts enclosureOf
 *  (rooms use lit albedos, corridors use bare paint). */
export function enclosureOfIn(level: LevelDef, key: string): { box: Box; walls: EnclosureWalls } | null {
  const room = level.rooms.find(r => r.name === key);
  if (room) {
    const box: Box = { min: [room.minX, 0, room.minZ], max: [room.maxX, room.height, room.maxZ] };
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
      box: { min: [t.minX, 0, t.minZ], max: [t.maxX, t.height, t.maxZ] },
      walls: { negX: t.color, posX: t.color, negY: t.color, posY: t.color, negZ: t.color, posZ: t.color },
    };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-def.test.ts`
Expected: PASS, 11 tests. If "walk through the corridor" stalls near x ≈ 7.7, a header or side wall is being generated at walking height: print `layoutColliders(twoRooms())` boxes whose `min[1] < 1.75` and whose x-range overlaps 7.5–10.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/level-def.ts src/lab/sdf-zombie/webgpu/level-def.test.ts
git commit -m "feat(level): level-def — authored-level types and generic walls/mouths/lintels"
```

---

### Task 2: `level-json.ts` — parse and validate level JSON (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-json.ts`
- Create: `src/lab/sdf-zombie/webgpu/level-json.test.ts`

The JSON (schema v1) is what the Blender exporter writes. Room and corridor
rectangles are 2-D (`[x, z]`); everything else is 3-D game space.

```json
{
  "version": 1, "id": "two", "name": "Two rooms", "ammo": "finite",
  "loadout": ["melee"], "completeOn": "pickup.cd",
  "rooms": [{ "id": 1, "name": "west", "min": [0, 0], "max": [8, 8], "height": 3 }],
  "tunnels": [{ "a": 1, "b": 2, "min": [8, 3.2], "max": [9.6, 4.8], "height": 2.2 }],
  "furniture": [{ "min": [1, 0, 1], "max": [2, 0.9, 2] }],
  "solids": [{ "min": [5, 0, 5], "max": [5.5, 2, 5.2] }],
  "gates": [{ "id": "door", "opensOn": "open.door", "min": [8.6, 0, 3.2], "max": [9, 2.2, 4.8] }],
  "triggers": [{ "id": "t1", "event": "wave.0", "once": true, "min": [2, 0, 2], "max": [3, 2, 3] }],
  "lights": [{ "pos": [1, 1.2, 7], "color": [1, 0.5, 0.2], "power": 9 }],
  "start": { "pos": [4, 0, 4], "yaw": 1.5708 },
  "spawns": [{ "id": "z1", "kind": "zombie", "pos": [14, 0, 4], "yaw": 0 }],
  "graves": [{ "id": "g1", "wave": 1, "pos": [12, 0, 6], "yaw": 3.1416 }],
  "pickups": [{ "id": "cd", "item": "cd", "pos": [16, 1, 4] }],
  "bells": [{ "id": "bell", "pos": [15, 2.5, 1.5], "radius": 0.8 }]
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/level-json.test.ts
import { describe, expect, it } from 'vitest';
import { parseLevelJson } from './level-json';

function fixture(): Record<string, unknown> {
  return {
    version: 1, id: 'two', name: 'Two rooms', ammo: 'finite', loadout: ['melee'], completeOn: 'pickup.cd',
    rooms: [
      { id: 1, name: 'west', min: [0, 0], max: [8, 8], height: 3 },
      { id: 2, name: 'east', min: [9.6, 0], max: [17.6, 8], height: 3 },
    ],
    tunnels: [{ a: 1, b: 2, min: [8, 3.2], max: [9.6, 4.8], height: 2.2 }],
    furniture: [{ min: [1, 0, 1], max: [2, 0.9, 2] }],
    solids: [{ min: [5, 0, 5], max: [5.5, 2, 5.2] }],
    gates: [{ id: 'door', opensOn: 'open.door', min: [8.6, 0, 3.2], max: [9, 2.2, 4.8] }],
    triggers: [{ id: 't1', event: 'wave.0', min: [2, 0, 2], max: [3, 2, 3] }],
    lights: [{ pos: [1, 1.2, 7], color: [1, 0.5, 0.2], power: 9 }],
    start: { pos: [4, 0, 4], yaw: Math.PI / 2 },
    spawns: [
      { id: 'z1', kind: 'zombie', pos: [14, 0, 4], yaw: 0 },
      { id: 's1', kind: 'soldier', pos: [15, 0, 6], yaw: 0 },
    ],
    graves: [{ id: 'g1', wave: 1, pos: [12, 0, 6], yaw: Math.PI }],
    pickups: [{ id: 'cd', item: 'cd', pos: [16, 1, 4] }, { id: 'sh', item: 'shells', pos: [8.8, 0.2, 4] }],
    bells: [{ id: 'bell', pos: [15, 2.5, 1.5], radius: 0.8 }],
  };
}

describe('parseLevelJson', () => {
  it('builds a LevelDef from a valid file', () => {
    const L = parseLevelJson(fixture());
    expect(L.id).toBe('two');
    expect(L.ammo).toBe('finite');
    expect(L.loadout).toEqual(['melee']);
    expect(L.rooms.map(r => [r.id, r.name, r.minX, r.maxX, r.minZ, r.maxZ, r.height]))
      .toEqual([[1, 'west', 0, 8, 0, 8, 3], [2, 'east', 9.6, 17.6, 0, 8, 3]]);
    expect(L.tunnels[0]).toMatchObject({ name: 'tunnel-1-2', axis: 'x', minX: 8, maxX: 9.6, height: 2.2 });
    expect(L.furniture[0]).toMatchObject({ room: 1, minX: 1, maxX: 2, height: 0.9 });
    expect(L.rooms[0]!.accents).toEqual([{ pos: [1, 1.2, 7], color: [1, 0.5, 0.2], power: 9 }]);
    expect(L.playerStart).toEqual({ x: 4, z: 4, yaw: Math.PI / 2, pitch: 0 });
    expect(L.triggers[0]!.once).toBe(true);
    expect(L.gates[0]!.box).toEqual({ min: [8.6, 0, 3.2], max: [9, 2.2, 4.8] });
  });

  it('counts spawns per room into zombies/soldiers', () => {
    const L = parseLevelJson(fixture());
    expect(L.rooms[1]).toMatchObject({ zombies: 2, soldiers: 1 });
    expect(L.rooms[0]).toMatchObject({ zombies: 0, soldiers: 0 });
  });

  it('infers a z-axis corridor', () => {
    const f = fixture();
    f.rooms = [
      { id: 1, name: 'south', min: [0, 9.6], max: [8, 17.6], height: 3 },
      { id: 2, name: 'north', min: [0, 0], max: [8, 8], height: 3 },
    ];
    f.tunnels = [{ a: 1, b: 2, min: [3.2, 8], max: [4.8, 9.6], height: 2.2 }];
    f.furniture = []; f.solids = []; f.gates = []; f.triggers = []; f.lights = [];
    f.start = { pos: [4, 0, 12], yaw: 0 };
    f.spawns = []; f.graves = []; f.bells = [];
    f.pickups = [{ id: 'cd', item: 'cd', pos: [4, 1, 2] }];
    expect(parseLevelJson(f).tunnels[0]!.axis).toBe('z');
  });

  it.each([
    ['a tunnel that does not touch its rooms', (f: any) => { f.tunnels[0].min = [8.5, 3.2]; }, 'tunnel-1-2'],
    ['a start outside every room', (f: any) => { f.start.pos = [30, 0, 30]; }, 'start'],
    ['a spawn in a corridor', (f: any) => { f.spawns[0].pos = [8.8, 0, 4]; }, 'spawn z1'],
    ['a duplicate marker id', (f: any) => { f.pickups[1].id = 'cd'; }, 'duplicate id cd'],
    ['a raised furniture box', (f: any) => { f.furniture[0].min = [1, 0.5, 1]; }, 'furniture'],
    ['an unknown pickup item', (f: any) => { f.pickups[0].item = 'rocket'; }, 'pickup cd'],
    ['a wrong version', (f: any) => { f.version = 2; }, 'version'],
    ['an inverted box', (f: any) => { f.solids[0].max = [4, 2, 5.2]; }, 'solids[0]'],
  ])('rejects %s', (_label, mutate, needle) => {
    const f = fixture();
    mutate(f);
    expect(() => parseLevelJson(f)).toThrow(needle);
  });

  it('reports every problem at once', () => {
    const f = fixture() as any;
    f.start.pos = [30, 0, 30];
    f.spawns[0].pos = [8.8, 0, 4];
    try { parseLevelJson(f); expect.unreachable(); } catch (e) {
      expect(String(e)).toContain('start');
      expect(String(e)).toContain('spawn z1');
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-json.test.ts`
Expected: FAIL — `Cannot find module './level-json'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/level-json.ts
//
// Level JSON (schema v1) -> LevelDef. Written by scripts/levels/export_level.py.
// Validation collects EVERY problem and throws once, so an author fixing a
// .blend sees the whole list, not one error per export.

import type { Vec3 } from '../types';
import type { Aabb, FurnitureDef, RoomDef, TunnelDef } from './game-level';
import {
  DEFAULT_PALETTE, type BellDef, type GateDef, type GraveDef, type LevelDef, type LevelPalette,
  type PickupDef, type PickupItem, type SpawnDef, type TriggerDef,
} from './level-def';

const TOL = 0.02;
const PICKUP_ITEMS: readonly PickupItem[] = ['shotgun', 'shells', 'health', 'cd', 'melee'];

type Json = Record<string, unknown>;

export function parseLevelJson(raw: unknown): LevelDef {
  const errors: string[] = [];
  const j = (raw ?? {}) as Json;

  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const num = (v: unknown, where: string, fallback = 0): number => {
    if (isNum(v)) return v;
    errors.push(`${where}: expected a number`);
    return fallback;
  };
  const str = (v: unknown, where: string, fallback = ''): string => {
    if (typeof v === 'string' && v.length > 0) return v;
    errors.push(`${where}: expected a non-empty string`);
    return fallback;
  };
  const vec = (v: unknown, n: 2 | 3, where: string): number[] => {
    if (Array.isArray(v) && v.length === n && v.every(isNum)) return v as number[];
    errors.push(`${where}: expected [${n} numbers]`);
    return new Array(n).fill(0);
  };
  const list = (v: unknown, where: string): Json[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v as Json[];
    errors.push(`${where}: expected an array`);
    return [];
  };
  const aabb = (o: Json, where: string): Aabb => {
    const min = vec(o.min, 3, `${where}.min`) as unknown as Vec3;
    const max = vec(o.max, 3, `${where}.max`) as unknown as Vec3;
    if (!(max[0] > min[0] && max[1] > min[1] && max[2] > min[2])) errors.push(`${where}: max must exceed min on every axis`);
    return { min, max };
  };

  if (j.version !== 1) errors.push(`version: expected 1, got ${String(j.version)}`);
  const id = str(j.id, 'id', 'unknown');
  const name = typeof j.name === 'string' && j.name ? j.name : id;
  const ammo = j.ammo === 'infinite' ? 'infinite' : 'finite';
  const loadout = list(j.loadout, 'loadout').map((w, i) => str(w, `loadout[${i}]`));
  const completeOn = typeof j.completeOn === 'string' && j.completeOn ? j.completeOn : 'pickup.cd';
  const pj = (j.palette ?? {}) as Json;
  const palette: LevelPalette = {
    wall: pj.wall ? (vec(pj.wall, 3, 'palette.wall') as unknown as Vec3) : DEFAULT_PALETTE.wall,
    floor: pj.floor ? (vec(pj.floor, 3, 'palette.floor') as unknown as Vec3) : DEFAULT_PALETTE.floor,
    ceil: pj.ceil ? (vec(pj.ceil, 3, 'palette.ceil') as unknown as Vec3) : DEFAULT_PALETTE.ceil,
    tunnel: pj.tunnel ? (vec(pj.tunnel, 3, 'palette.tunnel') as unknown as Vec3) : DEFAULT_PALETTE.tunnel,
    solid: pj.solid ? (vec(pj.solid, 3, 'palette.solid') as unknown as Vec3) : DEFAULT_PALETTE.solid,
  };

  // --- rooms ---------------------------------------------------------------
  const rooms: RoomDef[] = [];
  list(j.rooms, 'rooms').forEach((o, i) => {
    const where = `rooms[${i}]`;
    const rid = num(o.id, `${where}.id`);
    if (!Number.isInteger(rid) || rid < 1) errors.push(`${where}.id: expected an integer >= 1`);
    if (rooms.some(r => r.id === rid)) errors.push(`${where}.id: duplicate room id ${rid}`);
    const [minX, minZ] = vec(o.min, 2, `${where}.min`);
    const [maxX, maxZ] = vec(o.max, 2, `${where}.max`);
    const height = num(o.height, `${where}.height`, 3);
    if (!(maxX! > minX! && maxZ! > minZ! && height > 0)) errors.push(`${where}: empty room`);
    rooms.push({
      id: rid, name: str(o.name, `${where}.name`, `room${rid}`),
      minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ!, height,
      wallColor: palette.wall, floorColor: palette.floor, ceilColor: palette.ceil,
      accents: [], zombies: 0, soldiers: 0,
    });
  });
  if (rooms.length === 0) errors.push('rooms: a level needs at least one room');

  const inRoom = (x: number, z: number) =>
    rooms.find(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ?? null;

  // --- tunnels -------------------------------------------------------------
  const tunnels: TunnelDef[] = [];
  list(j.tunnels, 'tunnels').forEach((o, i) => {
    const a = num(o.a, `tunnels[${i}].a`);
    const b = num(o.b, `tunnels[${i}].b`);
    const tname = `tunnel-${a}-${b}`;
    const [minX, minZ] = vec(o.min, 2, `${tname}.min`);
    const [maxX, maxZ] = vec(o.max, 2, `${tname}.max`);
    const height = num(o.height, `${tname}.height`, 2.2);
    const ra = rooms.find(r => r.id === a);
    const rb = rooms.find(r => r.id === b);
    let axis: 'x' | 'z' | null = null;
    if (!ra || !rb || a === b) {
      errors.push(`${tname}: must join two different existing rooms`);
    } else {
      const t = { minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ! };
      const touchesX = (r: RoomDef) =>
        (Math.abs(t.maxX - r.minX) <= TOL || Math.abs(t.minX - r.maxX) <= TOL)
        && t.minZ >= r.minZ - TOL && t.maxZ <= r.maxZ + TOL;
      const touchesZ = (r: RoomDef) =>
        (Math.abs(t.maxZ - r.minZ) <= TOL || Math.abs(t.minZ - r.maxZ) <= TOL)
        && t.minX >= r.minX - TOL && t.maxX <= r.maxX + TOL;
      if (touchesX(ra) && touchesX(rb)) axis = 'x';
      else if (touchesZ(ra) && touchesZ(rb)) axis = 'z';
      else errors.push(`${tname}: its ends must sit flush against a wall of room ${a} and a wall of room ${b}`);
    }
    tunnels.push({
      name: tname, a, b, minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ!,
      height, color: palette.tunnel, axis: axis ?? 'x',
    });
  });

  const onFloor = (x: number, z: number) =>
    !!inRoom(x, z) || tunnels.some(t => x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ);

  // --- boxes ---------------------------------------------------------------
  const furniture: FurnitureDef[] = [];
  list(j.furniture, 'furniture').forEach((o, i) => {
    const where = `furniture[${i}]`;
    const box = aabb(o, where);
    if (Math.abs(box.min[1]) > TOL) errors.push(`${where}: furniture must sit on the floor (use solids for raised boxes)`);
    const room = inRoom((box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2);
    if (!room) errors.push(`${where}: furniture centre is outside every room`);
    furniture.push({
      room: room?.id ?? 0, minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2], height: box.max[1],
    });
  });
  const solids = list(j.solids, 'solids').map((o, i) => aabb(o, `solids[${i}]`));

  const ids = new Set<string>();
  const claim = (markerId: string) => {
    if (ids.has(markerId)) errors.push(`duplicate id ${markerId}`);
    ids.add(markerId);
  };

  const gates: GateDef[] = list(j.gates, 'gates').map((o, i) => {
    const gid = str(o.id, `gates[${i}].id`, `gate${i}`);
    claim(gid);
    return { id: gid, opensOn: str(o.opensOn, `gate ${gid}.opensOn`), box: aabb(o, `gate ${gid}`) };
  });
  const triggers: TriggerDef[] = list(j.triggers, 'triggers').map((o, i) => {
    const tid = str(o.id, `triggers[${i}].id`, `trigger${i}`);
    claim(tid);
    return { id: tid, event: str(o.event, `trigger ${tid}.event`), once: o.once !== false, box: aabb(o, `trigger ${tid}`) };
  });

  // --- lights -> room accents ------------------------------------------------
  list(j.lights, 'lights').forEach((o, i) => {
    const pos = vec(o.pos, 3, `lights[${i}].pos`) as unknown as Vec3;
    const color = vec(o.color, 3, `lights[${i}].color`) as unknown as Vec3;
    const power = num(o.power, `lights[${i}].power`, 9);
    const room = inRoom(pos[0], pos[2]);
    if (!room) errors.push(`lights[${i}]: outside every room`);
    else room.accents.push({ pos, color, power });
  });

  // --- markers ---------------------------------------------------------------
  const st = (j.start ?? {}) as Json;
  const startPos = vec(st.pos, 3, 'start.pos');
  const playerStart = { x: startPos[0]!, z: startPos[2]!, yaw: num(st.yaw, 'start.yaw'), pitch: 0 };
  if (!onFloor(playerStart.x, playerStart.z)) errors.push('start: outside every room and corridor');

  const spawns: SpawnDef[] = list(j.spawns, 'spawns').map((o, i) => {
    const sid = str(o.id, `spawns[${i}].id`, `spawn${i}`);
    claim(sid);
    const kind = o.kind === 'soldier' ? 'soldier' : o.kind === 'zombie' ? 'zombie' : null;
    if (!kind) errors.push(`spawn ${sid}: kind must be zombie or soldier`);
    const pos = vec(o.pos, 3, `spawn ${sid}.pos`) as unknown as Vec3;
    const room = inRoom(pos[0], pos[2]);
    if (!room) errors.push(`spawn ${sid}: must be inside a room (not a corridor)`);
    else {
      room.zombies += 1;
      if (kind === 'soldier') room.soldiers = (room.soldiers ?? 0) + 1;
    }
    return { id: sid, kind: kind ?? 'zombie', pos, yaw: isNum(o.yaw) ? o.yaw : 0 };
  });

  const graves: GraveDef[] = list(j.graves, 'graves').map((o, i) => {
    const gid = str(o.id, `graves[${i}].id`, `grave${i}`);
    claim(gid);
    const wave = num(o.wave, `grave ${gid}.wave`);
    if (!Number.isInteger(wave) || wave < 0) errors.push(`grave ${gid}: wave must be an integer >= 0`);
    const pos = vec(o.pos, 3, `grave ${gid}.pos`) as unknown as Vec3;
    if (!inRoom(pos[0], pos[2])) errors.push(`grave ${gid}: must be inside a room`);
    return { id: gid, wave, pos, yaw: isNum(o.yaw) ? o.yaw : 0 };
  });

  const pickups: PickupDef[] = list(j.pickups, 'pickups').map((o, i) => {
    const pid = str(o.id, `pickups[${i}].id`, `pickup${i}`);
    claim(pid);
    const item = PICKUP_ITEMS.find(p => p === o.item);
    if (!item) errors.push(`pickup ${pid}: item must be one of ${PICKUP_ITEMS.join(', ')}`);
    const pos = vec(o.pos, 3, `pickup ${pid}.pos`) as unknown as Vec3;
    if (!onFloor(pos[0], pos[2])) errors.push(`pickup ${pid}: outside every room and corridor`);
    return { id: pid, item: item ?? 'shells', pos };
  });

  const bells: BellDef[] = list(j.bells, 'bells').map((o, i) => {
    const bid = str(o.id, `bells[${i}].id`, `bell${i}`);
    claim(bid);
    const pos = vec(o.pos, 3, `bell ${bid}.pos`) as unknown as Vec3;
    const radius = num(o.radius, `bell ${bid}.radius`, 0.8);
    if (radius <= 0) errors.push(`bell ${bid}: radius must be > 0`);
    if (!inRoom(pos[0], pos[2])) errors.push(`bell ${bid}: must be inside a room`);
    return { id: bid, pos, radius };
  });

  if (errors.length > 0) throw new Error(`level ${id}: ${errors.join('; ')}`);

  return {
    id, name, ammo, palette, loadout, completeOn,
    rooms, tunnels, furniture, solids, gates, triggers,
    playerStart, spawns, graves, pickups, bells,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-json.test.ts`
Expected: PASS, 12 tests (1 + 1 + 1 + 8 rejections + 1).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/level-json.ts src/lab/sdf-zombie/webgpu/level-json.test.ts
git commit -m "feat(level): level-json — validate authored level JSON into a LevelDef"
```

---

### Task 3: Blender exporter + authoring conventions (dispatchable, needs Blender)

**Files:**
- Create: `scripts/levels/export_level.py`
- Create: `docs/game/levels/blender-conventions.md`

- [ ] **Step 1: Write the conventions doc**

```markdown
# Authoring a level in Blender

**Exporter:** `scripts/levels/export_level.py` · **Format:** `src/lab/sdf-zombie/webgpu/level-json.ts`

## Space
- Metres. Blender is Z-up; the game is Y-up. The exporter converts:
  game (x, y, z) = Blender (x, z, −y). Game "north" (−z) is Blender +Y.
- **Every floor is at Blender z = 0** (one floor height in v1).
- Snap boxes to a 0.1 m grid. Corridor ends must sit *exactly* on a room wall.

## Collections (names are exact)

| Collection | Contains | Object name | Notes |
| --- | --- | --- | --- |
| `rooms` | Box meshes | `room:<id>:<name>` | Floor at z = 0; the box top is the ceiling height. `id` is an integer ≥ 1 |
| `tunnels` | Box meshes | `tunnel:<a>:<b>` | Joins rooms `a` and `b`; both ends flush with their walls. Top = lintel height |
| `furniture` | Box meshes | anything | Sits on the floor; counts as cover |
| `solids` | Box meshes | anything | Any other solid box: gate posts, headstones, pews, raised blocks |
| `gates` | Box meshes | `gate:<event>:<id>` | Solid until `<event>` fires, then removed |
| `triggers` | Box meshes | `trigger:<event>:<id>` | Fires `<event>` when the player walks in. Custom property `once` (default true) |
| `lights` | Point lights | anything | Become room accents. Custom property `power` (default energy ÷ 10) |
| `markers` | Empties | see below | Arrow empties; +Y is "forward" |

## Markers (empties in `markers`)

| Name | Meaning |
| --- | --- |
| `start` | Player start; its Z rotation is the facing. Exactly one |
| `spawn:<zombie\|soldier>:<id>` | An enemy present at level start |
| `grave:<wave>:<id>` | Releases one zombie when wave `<wave>` is called |
| `pickup:<shotgun\|shells\|health\|cd\|melee>:<id>` | A pickup |
| `bell:<id>` | A shootable bell. Custom property `radius` (default 0.8) |

Blender's duplicate suffix (`.001`) is ignored. Event names use dots, never colons
(`bell.toll.1`, `wave.0`, `alert.room.4`).

## Scene custom properties
`level_id` (required), `level_name`, `ammo` (`finite`|`infinite`, default finite),
`loadout` (comma-separated, e.g. `melee`), `complete_on` (default `pickup.cd`).

## Export
    blender --background assets-source/levels/<id>.blend \
      --python scripts/levels/export_level.py -- public/assets/levels/<id>.level.json

Then run `npx vitest run src/lab/sdf-zombie/webgpu/level-json.<id>.test.ts` if the level has one,
and open `/sdf-game.html?level=<id>`.

## Events the game understands
`wave.<n>` spawns grave wave n · `bell.toll.<n>` fires on the bell's nth toll (and
also calls `wave.<n>`) · `alert.room.<id>` turns every enemy in that room ·
`pickup.<item>` fires when an item is picked up · the level's `complete_on` event
ends the level.
```

- [ ] **Step 2: Write the exporter**

```python
# scripts/levels/export_level.py
"""Export a Blud level (.blend) to level JSON schema v1.

Runs INSIDE Blender:

    blender --background assets-source/levels/the-wake.blend \
        --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json

Conventions: docs/game/levels/blender-conventions.md
Validation lives in the game (src/lab/sdf-zombie/webgpu/level-json.ts); this
script only refuses names it cannot read and floors that are not at z = 0.
"""
import json
import re
import sys

import bpy
from mathutils import Vector

DIGITS = 3


def rnd(v):
    return round(float(v), DIGITS)


def out_path():
    argv = sys.argv
    if "--" not in argv or len(argv[argv.index("--") + 1:]) != 1:
        raise SystemExit("usage: blender --background X.blend --python export_level.py -- OUT.json")
    return argv[argv.index("--") + 1]


def to_game(v):
    """Blender Z-up (x, y, z) -> game Y-up (x, y, z)."""
    return [rnd(v[0]), rnd(v[2]), rnd(-v[1])]


def world_aabb(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    gmin = [rnd(min(xs)), rnd(min(zs)), rnd(-max(ys))]
    gmax = [rnd(max(xs)), rnd(max(zs)), rnd(-min(ys))]
    return gmin, gmax


def objects(name):
    coll = bpy.data.collections.get(name)
    return [] if coll is None else sorted(coll.all_objects, key=lambda o: o.name)


def fields(obj, prefix, count):
    base = re.sub(r"\.\d{3}$", "", obj.name)
    bits = base.split(":")
    if bits[0] != prefix or len(bits) != count:
        raise SystemExit(f"bad name {obj.name!r}: expected {prefix} with {count} ':'-separated parts")
    return bits


def yaw_of(obj):
    return rnd(-obj.matrix_world.to_euler("XYZ").z)


def main():
    scene = bpy.context.scene
    level_id = scene.get("level_id")
    if not level_id:
        raise SystemExit("scene custom property level_id is required")
    loadout = [w.strip() for w in str(scene.get("loadout", "")).split(",") if w.strip()]
    doc = {
        "version": 1,
        "id": level_id,
        "name": scene.get("level_name", level_id),
        "ammo": scene.get("ammo", "finite"),
        "loadout": loadout,
        "completeOn": scene.get("complete_on", "pickup.cd"),
        "rooms": [], "tunnels": [], "furniture": [], "solids": [], "gates": [],
        "triggers": [], "lights": [], "spawns": [], "graves": [], "pickups": [], "bells": [],
    }

    for o in objects("rooms"):
        _, rid, name = fields(o, "room", 3)
        gmin, gmax = world_aabb(o)
        if abs(gmin[1]) > 0.01:
            raise SystemExit(f"{o.name}: room floor must be at z = 0 (is {gmin[1]})")
        doc["rooms"].append({"id": int(rid), "name": name, "min": [gmin[0], gmin[2]],
                             "max": [gmax[0], gmax[2]], "height": gmax[1]})

    for o in objects("tunnels"):
        _, a, b = fields(o, "tunnel", 3)
        gmin, gmax = world_aabb(o)
        if abs(gmin[1]) > 0.01:
            raise SystemExit(f"{o.name}: tunnel floor must be at z = 0")
        doc["tunnels"].append({"a": int(a), "b": int(b), "min": [gmin[0], gmin[2]],
                               "max": [gmax[0], gmax[2]], "height": gmax[1]})

    for coll in ("furniture", "solids"):
        for o in objects(coll):
            if o.type != "MESH":
                continue
            gmin, gmax = world_aabb(o)
            doc[coll].append({"min": gmin, "max": gmax})

    for o in objects("gates"):
        _, event, gid = fields(o, "gate", 3)
        gmin, gmax = world_aabb(o)
        doc["gates"].append({"id": gid, "opensOn": event, "min": gmin, "max": gmax})

    for o in objects("triggers"):
        _, event, tid = fields(o, "trigger", 3)
        gmin, gmax = world_aabb(o)
        doc["triggers"].append({"id": tid, "event": event, "once": bool(o.get("once", True)),
                                "min": gmin, "max": gmax})

    for o in objects("lights"):
        if o.type != "LIGHT" or o.data.type != "POINT":
            continue
        c = o.data.color
        doc["lights"].append({"pos": to_game(o.matrix_world.translation),
                              "color": [rnd(c[0]), rnd(c[1]), rnd(c[2])],
                              "power": rnd(o.get("power", o.data.energy / 10.0))})

    start = None
    for o in objects("markers"):
        if o.type != "EMPTY":
            continue
        base = re.sub(r"\.\d{3}$", "", o.name)
        pos = to_game(o.matrix_world.translation)
        kind = base.split(":")[0]
        if base == "start":
            if start is not None:
                raise SystemExit("more than one start marker")
            start = {"pos": pos, "yaw": yaw_of(o)}
        elif kind == "spawn":
            _, what, sid = fields(o, "spawn", 3)
            doc["spawns"].append({"id": sid, "kind": what, "pos": pos, "yaw": yaw_of(o)})
        elif kind == "grave":
            _, wave, gid = fields(o, "grave", 3)
            doc["graves"].append({"id": gid, "wave": int(wave), "pos": pos, "yaw": yaw_of(o)})
        elif kind == "pickup":
            _, item, pid = fields(o, "pickup", 3)
            doc["pickups"].append({"id": pid, "item": item, "pos": pos})
        elif kind == "bell":
            _, bid = fields(o, "bell", 2)
            doc["bells"].append({"id": bid, "pos": pos, "radius": rnd(o.get("radius", 0.8))})
        else:
            raise SystemExit(f"unknown marker {o.name!r}")
    if start is None:
        raise SystemExit("no start marker")
    doc["start"] = start

    path = out_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print(f"exported {level_id}: {len(doc['rooms'])} rooms, {len(doc['tunnels'])} tunnels -> {path}")


main()
```

- [ ] **Step 3: Smoke-test the exporter on a throwaway scene**

Run:
```bash
mkdir -p .lab-tmp
cat > .lab-tmp/smoke_level.py <<'PY'
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc["level_id"] = "smoke"
def coll(n):
    c = bpy.data.collections.new(n); sc.collection.children.link(c); return c
def cube(c, name, bmin, bmax):
    m = bpy.data.meshes.new(name)
    v = [(x, y, z) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    m.from_pydata(v, [], [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)])
    o = bpy.data.objects.new(name, m); c.objects.link(o)
rooms = coll("rooms"); markers = coll("markers")
cube(rooms, "room:1:only", (0, -8, 0), (8, 0, 3))
e = bpy.data.objects.new("start", None); e.location = (4, -4, 0); markers.objects.link(e)
PY
blender --background --factory-startup --python .lab-tmp/smoke_level.py --python scripts/levels/export_level.py -- .lab-tmp/smoke.level.json
cat .lab-tmp/smoke.level.json
```
Expected: prints `exported smoke: 1 rooms, 0 tunnels`, and the JSON has one
room `only` with `min` [0, 0], `max` [8, 8], `height` 3, and a start at
pos [4, 0, 4] (zeros may print as `-0.0`; that's fine). Blender −y becomes game
+z, so Blender y ∈ [−8, 0] is game z ∈ [0, 8].

- [ ] **Step 4: Commit**

```bash
git add scripts/levels/export_level.py docs/game/levels/blender-conventions.md
git commit -m "feat(level): Blender level exporter + authoring conventions"
```

---

### Task 4: The Wake blockout — build script, `.blend`, JSON, and a routing test (dispatchable, needs Blender)

**Files:**
- Create: `scripts/levels/build_the_wake_blockout.py`
- Create: `assets-source/levels/the-wake.blend` (generated)
- Create: `public/assets/levels/the-wake.level.json` (generated)
- Create: `src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts`

The layout follows [the Wake design](../../game/levels/00-the-wake/design.md) §4.
Coordinates below are **game space** (x, z; the player walks toward −z). The
script converts to Blender. After this task the owner edits the `.blend` by
hand; the script is only the first draft.

| Room | id | x | z | Height | Holds |
| --- | --- | --- | --- | --- | --- |
| gates | 1 | −6…6 | −12…0 | 6.0 | start, gate posts, gatehouse, 2 zombies |
| graveyard | 2 | −14…14 | −44…−16 | 8.0 | open grave + shotgun, headstones, mausoleum, bell tower, 5 zombies, graves for waves 0–3 |
| crypt | 3 | −8…8 | −60…−48 | 2.8 | sarcophagi, 4 zombies (at grade in v1) |
| parlour | 4 | −9…9 | −84…−64 | 4.5 | pews, organ, coffin, CD, 6 mourners, the "turn" trigger |
| secret | 5 | 15…19 | −33…−28 | 2.5 | health, shells |

| Corridor | x | z | Height | Notes |
| --- | --- | --- | --- | --- |
| 1 → 2 (the lane) | −1…1 | −16…−12 | 3.2 | |
| 2 → 3 (crypt stairs) | −1.2…1.2 | −48…−44 | 2.6 | gate `crypt-slab`, opens on `bell.toll.1` |
| 3 → 4 | −1…1 | −64…−60 | 2.4 | |
| 2 → 5 (fence gap) | 14…15 | −31.4…−30.0 | 2.0 | 1.4 m wide: narrower and the enemy navigation grid (0.4 m cells, 0.34 m inflation) cannot route through it |

- [ ] **Step 1: Write the build script**

```python
# scripts/levels/build_the_wake_blockout.py
"""Build the first-draft blockout of level 0, The Wake, as a .blend.

    blender --background --factory-startup \
        --python scripts/levels/build_the_wake_blockout.py -- assets-source/levels/the-wake.blend

All coordinates in the tables are GAME space (x, y, z), y up, player walks
toward -z. Blender gets (x, -z, y). Design: docs/game/levels/00-the-wake/design.md
After the first run the .blend is the source of truth; edit it in Blender.
"""
import math
import sys

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC["level_id"] = "the-wake"
SC["level_name"] = "The Wake"
SC["ammo"] = "finite"
SC["loadout"] = "melee"
SC["complete_on"] = "pickup.cd"

COLLS = {}


def coll(name):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        SC.collection.children.link(c)
        COLLS[name] = c
    return COLLS[name]


def gbox(collection, name, gmin, gmax, wire=False):
    """Game-space AABB -> Blender box mesh."""
    bmin = (gmin[0], -gmax[2], gmin[1])
    bmax = (gmax[0], -gmin[2], gmax[1])
    mesh = bpy.data.meshes.new(name)
    verts = [(x, y, z) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    if wire:
        obj.display_type = "WIRE"
    coll(collection).objects.link(obj)
    return obj


def gempty(name, pos, yaw=0.0, **props):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "ARROWS"
    obj.location = (pos[0], -pos[2], pos[1])
    obj.rotation_euler = (0.0, 0.0, -yaw)
    for k, v in props.items():
        obj[k] = v
    coll("markers").objects.link(obj)
    return obj


def glight(name, pos, color, power):
    data = bpy.data.lights.new(name, "POINT")
    data.color = color
    data.energy = power * 10.0
    obj = bpy.data.objects.new(name, data)
    obj.location = (pos[0], -pos[2], pos[1])
    obj["power"] = power
    coll("lights").objects.link(obj)


FACE_SOUTH = math.pi  # facing +z, toward the approaching player

# --- rooms and corridors ---------------------------------------------------------
ROOMS = [
    (1, "gates", (-6, -12), (6, 0), 6.0),
    (2, "graveyard", (-14, -44), (14, -16), 8.0),
    (3, "crypt", (-8, -60), (8, -48), 2.8),
    (4, "parlour", (-9, -84), (9, -64), 4.5),
    (5, "secret", (15, -33), (19, -28), 2.5),
]
for rid, name, (x0, z0), (x1, z1), h in ROOMS:
    gbox("rooms", f"room:{rid}:{name}", (x0, 0, z0), (x1, h, z1), wire=True)

TUNNELS = [
    (1, 2, (-1, -16), (1, -12), 3.2),
    (2, 3, (-1.2, -48), (1.2, -44), 2.6),
    (3, 4, (-1, -64), (1, -60), 2.4),
    (2, 5, (14, -31.4), (15, -30.0), 2.0),
]
for a, b, (x0, z0), (x1, z1), h in TUNNELS:
    gbox("tunnels", f"tunnel:{a}:{b}", (x0, 0, z0), (x1, h, z1), wire=True)

# --- solids ------------------------------------------------------------------------
S = []
# Gates (behind the start) and the gatehouse.
S += [((-2.6, 0, -0.6), (-1.8, 3, -0.1)), ((1.8, 0, -0.6), (2.6, 3, -0.1)), ((3, 0, -9), (5.5, 3, -5))]
# The open grave: two low mounds and its headstone.
S += [((-1.1, 0, -20.4), (-0.8, 0.35, -18.0)), ((0.8, 0, -20.4), (1.1, 0.35, -18.0)),
      ((-0.5, 0, -20.8), (0.5, 1.0, -20.5))]
# Headstones.
for cx, cz in [(-7, -20), (-4, -22.5), (5, -21), (9, -25), (-9, -27), (-2, -27), (3, -29),
               (-6, -32), (7, -32), (-11, -34), (2, -36), (10, -38), (-3, -40), (7, -43)]:
    S.append(((cx - 0.35, 0, cz - 0.1), (cx + 0.35, 0.9, cz + 0.1)))
# Mausoleum.
S.append(((8, 0, -22), (12, 3.5, -18)))
# Bell tower: base, four belfry posts, roof.
S.append(((-12, 0, -43), (-8, 4, -39)))
for px, pz in [(-12, -43), (-8.3, -43), (-12, -39.3), (-8.3, -39.3)]:
    S.append(((px, 4, pz), (px + 0.3, 6.5, pz + 0.3)))
S.append(((-12.2, 6.5, -43.2), (-7.8, 6.9, -38.8)))
# Fence posts either side of the gap to the secret.
S += [((13.6, 0, -32.0), (14, 1.4, -31.4)), ((13.6, 0, -30.0), (14, 1.4, -29.4))]
# Crypt sarcophagi.
S += [((-6, 0, -53), (-4, 0.8, -52)), ((4, 0, -55), (6, 0.8, -54)), ((-6, 0, -58), (-4, 0.8, -57))]
# Parlour: three rows of pews either side of the aisle, the coffin stand, the organ.
for z in (-69, -72, -75):
    S += [((-7.5, 0, z - 0.25), (-1.5, 0.9, z + 0.25)), ((1.5, 0, z - 0.25), (7.5, 0.9, z + 0.25))]
S += [((-1, 0, -81), (1, 0.9, -79)), ((5, 0, -84), (8.5, 2.5, -82))]
for i, (mn, mx) in enumerate(S):
    gbox("solids", f"solid.{i:03d}", mn, mx)

# --- gates and triggers --------------------------------------------------------------
gbox("gates", "gate:bell.toll.1:crypt-slab", (-1.2, 0, -45), (1.2, 2.6, -44.4))
gbox("triggers", "trigger:wave.0:grave-rise", (-2, 0, -20.2), (2, 2, -17.6), wire=True)
gbox("triggers", "trigger:alert.room.4:parlour-turn", (-9, 0, -67.5), (9, 3, -65.5), wire=True)

# --- lights ----------------------------------------------------------------------------
glight("lamp.gates", (-4, 2.5, -6), (0.9, 0.55, 0.25), 10)
glight("moon.graveyard", (8, 2.5, -20), (0.35, 0.45, 0.9), 12)
glight("fire.belltower", (-10, 1.5, -37.5), (1.0, 0.4, 0.15), 10)
glight("glow.crypt", (0, 1.2, -54), (0.3, 0.9, 0.35), 7)
glight("candles.organ", (6, 1.3, -81), (1.0, 0.5, 0.2), 10)
glight("candles.door", (-6, 1.3, -66), (1.0, 0.5, 0.2), 8)
glight("red.secret", (17, 1.0, -30), (0.9, 0.2, 0.1), 6)

# --- markers --------------------------------------------------------------------------
gempty("start", (0, 0, -1.5), 0.0)
for sid, pos in [("gates-1", (0, 0, -8)), ("gates-2", (-3, 0, -10.5))]:
    gempty(f"spawn:zombie:{sid}", pos, FACE_SOUTH)
for sid, pos in [("yard-1", (-10, 0, -22)), ("yard-2", (10, 0, -30)), ("yard-3", (-5, 0, -29)),
                 ("yard-4", (5, 0, -36.5)), ("yard-5", (-1, 0, -33))]:
    gempty(f"spawn:zombie:{sid}", pos, FACE_SOUTH)
for sid, pos in [("crypt-1", (-5, 0, -50.5)), ("crypt-2", (5, 0, -52)), ("crypt-3", (-3, 0, -56)),
                 ("crypt-4", (4, 0, -58))]:
    gempty(f"spawn:zombie:{sid}", pos, FACE_SOUTH)
for sid, pos in [("mourner-1", (-4, 0, -70.5)), ("mourner-2", (4, 0, -70.5)), ("mourner-3", (-5, 0, -73.5)),
                 ("mourner-4", (5, 0, -73.5)), ("mourner-5", (-3, 0, -76.5)), ("mourner-6", (3, 0, -76.5))]:
    gempty(f"spawn:zombie:{sid}", pos, 0.0)  # facing the coffin, backs to the player

GRAVES = {
    0: [(-2.5, -22), (2.5, -22.5)],
    1: [(-6, -24), (6, -24), (-8, -30)],
    2: [(-4, -34), (4, -34), (10, -28), (-10, -36.5)],
    3: [(0, -40), (-6, -41), (6, -41), (12, -36), (-12, -26)],
}
for wave, points in GRAVES.items():
    for i, (x, z) in enumerate(points):
        gempty(f"grave:{wave}:w{wave}-{i + 1}", (x, 0, z), FACE_SOUTH)

PICKUPS = [
    ("shotgun", "sawn-off", (0, 0.3, -19)),
    ("shells", "shells-yard-1", (-10, 0.2, -20)), ("shells", "shells-yard-2", (9, 0.2, -35)),
    ("shells", "shells-crypt", (0, 0.2, -53)), ("shells", "shells-parlour", (-8, 0.2, -66)),
    ("shells", "shells-secret", (18, 0.2, -29.5)),
    ("health", "health-crypt", (6, 0.2, -50)), ("health", "health-secret", (17, 0.2, -31)),
    ("health", "health-parlour", (-8, 0.2, -82)),
    ("cd", "the-wake-cd", (0, 1.0, -78.4)),
]
for item, pid, pos in PICKUPS:
    gempty(f"pickup:{item}:{pid}", pos)

gempty("bell:funeral-bell", (-10, 5.2, -41), radius=0.8)

# --- save ------------------------------------------------------------------------------
argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else "assets-source/levels/the-wake.blend"
bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(out))
print(f"saved {out}")
```

- [ ] **Step 2: Build the `.blend` and export the JSON**

Run:
```bash
mkdir -p assets-source/levels public/assets/levels
blender --background --factory-startup --python scripts/levels/build_the_wake_blockout.py -- "$PWD/assets-source/levels/the-wake.blend"
blender --background "$PWD/assets-source/levels/the-wake.blend" --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json
```
Expected: `saved …/the-wake.blend`, then `exported the-wake: 5 rooms, 4 tunnels -> public/assets/levels/the-wake.level.json`.

- [ ] **Step 3: Write the Wake test**

```ts
// src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts
//
// The committed Wake JSON: it parses, every beat is reachable on foot through
// the enemy navigation grid, and the crypt stays shut until its gate opens.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { createEncounterNavigation } from './encounter-navigation';
import { gateColliders, layoutColliders, roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const wake = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/the-wake.level.json', 'utf8')));

describe('the-wake.level.json', () => {
  it('has the rooms, corridors and markers the design calls for', () => {
    expect(wake.rooms.map(r => r.name)).toEqual(['gates', 'graveyard', 'crypt', 'parlour', 'secret']);
    expect(wake.tunnels).toHaveLength(4);
    expect(wake.loadout).toEqual(['melee']);
    expect(wake.ammo).toBe('finite');
    expect(roomAtPoint(wake, wake.playerStart.x, wake.playerStart.z)?.name).toBe('gates');
    expect(wake.bells).toHaveLength(1);
    expect(wake.gates).toEqual([expect.objectContaining({ id: 'crypt-slab', opensOn: 'bell.toll.1' })]);
    const waves = new Map<number, number>();
    for (const g of wake.graves) waves.set(g.wave, (waves.get(g.wave) ?? 0) + 1);
    expect([...waves.entries()].sort()).toEqual([[0, 2], [1, 3], [2, 4], [3, 5]]);
    expect(wake.pickups.filter(p => p.item === 'cd')).toHaveLength(1);
    expect(wake.pickups.filter(p => p.item === 'shotgun')).toHaveLength(1);
    expect(wake.spawns).toHaveLength(17);
  });

  it('routes from the start to the CD with the gate open', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    const start: Vec3 = [wake.playerStart.x, 0, wake.playerStart.z];
    const nearCd: Vec3 = [0, 0, -78.2];
    expect(nav.canStand(start)).toBe(true);
    expect(nav.canStand(nearCd)).toBe(true);
    expect(nav.route(start, nearCd).length).toBeGreaterThan(0);
  });

  it('reaches the secret room through the fence gap', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    expect(nav.route([0, 0, -20], [17, 0, -30]).length).toBeGreaterThan(0);
  });

  it('cannot reach the crypt while the crypt slab is closed', () => {
    const closed = [...layoutColliders(wake), ...gateColliders(wake, new Set())];
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, closed);
    expect(nav.route([0, 0, -30], [0, 0, -54])).toEqual([]);
  });

  it('keeps every spawn, grave and pickup standable', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    for (const m of [...wake.spawns, ...wake.graves]) expect(nav.canStand([m.pos[0], 0, m.pos[2]]), m.id).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts`
Expected: PASS, 5 tests. It may take several seconds (the navigation grid is
about 17,000 cells). If "keeps every spawn standable" fails, the failing id is
printed: move that marker in the **build script table** (not only the JSON),
rebuild and re-export (Step 2), rerun.

- [ ] **Step 5: Commit**

```bash
git add scripts/levels/build_the_wake_blockout.py assets-source/levels/the-wake.blend \
  public/assets/levels/the-wake.level.json src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts
git commit -m "feat(level): The Wake blockout — build script, .blend, exported JSON, routing test"
```

---

### Task 5: Load `?level=` in the game (session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

Base branch per the brief §2. Line numbers below are from `claude/game-design-narrative-abd0df`
(before the dynamite merge) and **will have shifted**: find each site by the
quoted code, not by number.

- [ ] **Step 1: Import the new modules**

Next to the existing `game-level` import (`import { … } from './game-level'`):

```ts
import {
  enclosureKeyIn, enclosureOfIn, gateColliders, layoutColliders, layoutSurfaces, roomAtPoint,
  type LevelDef,
} from './level-def';
import { parseLevelJson } from './level-json';
```

- [ ] **Step 2: Load the level and add active-level accessors**

Replace the line `const colliders = levelColliders();` (inside `async function main()`) with:

```ts
  // --- ACTIVE LEVEL. ?level=<id> loads public/assets/levels/<id>.level.json;
  // no param is the ring, byte-for-byte. Everything that used to read the ring's
  // globals reads these accessors instead.
  const levelParam = new URLSearchParams(location.search).get('level');
  const authored: LevelDef | null = levelParam
    ? parseLevelJson(await (await fetch(`/assets/levels/${levelParam}.level.json`)).json())
    : null;
  const activeRooms: readonly RoomDef[] = authored ? authored.rooms : ROOMS;
  const activeTunnels: readonly TunnelDef[] = authored ? authored.tunnels : TUNNELS;
  const activeFurniture: readonly FurnitureDef[] = authored ? authored.furniture : FURNITURE;
  const activeStart = authored ? authored.playerStart : PLAYER_START;
  const keyAt = (x: number, z: number) => (authored ? enclosureKeyIn(authored, x, z) : enclosureKeyAt(x, z));
  const enclosureFor = (key: string) => (authored ? enclosureOfIn(authored, key) : enclosureOf(key));
  /** Gates opened so far (authored levels only). */
  const openGates = new Set<string>();
  const staticColliders: Aabb[] = authored ? layoutColliders(authored) : levelColliders();
  /** Live collider list. The SAME array object for the whole session: the
   *  player, pellets and culls hold this reference, so gates edit it in place. */
  const colliders: Aabb[] = [...staticColliders, ...(authored ? gateColliders(authored, openGates) : [])];
  function refreshGateColliders(): void {
    colliders.length = 0;
    colliders.push(...staticColliders, ...(authored ? gateColliders(authored, openGates) : []));
  }
```

Add `RoomDef, TunnelDef, FurnitureDef` to the `game-level` type imports if they are not there.

- [ ] **Step 3: Replace every read of the ring globals**

Run: `grep -n "ROOMS\b\|TUNNELS\b\|FURNITURE\b\|PLAYER_START\|levelSurfaces()\|enclosureKeyAt(\|enclosureOf(\|spawnPoints(" src/lab/sdf-zombie/webgpu/game-main.ts`

Change each hit (except the new accessor block itself):

| Code | Becomes |
| --- | --- |
| `createEncounterNavigation(ROOMS, TUNNELS, colliders)` | `createEncounterNavigation(activeRooms, activeTunnels, staticColliders)` (**static**: enemies route with gates open; brief §3) |
| `createEncounterDirector(encounterNav, colliders)` | unchanged (it takes the live array) |
| `const surfaces = levelSurfaces()` | `const surfaces = authored ? layoutSurfaces(authored) : { ...levelSurfaces(), gates: [] }` |
| `for (const r of ROOMS) for (const a of r.accents)` | `for (const r of activeRooms) for (const a of r.accents)` |
| `createRoomProbes({ rooms: ROOMS, furniture: FURNITURE, …` | `createRoomProbes({ rooms: activeRooms, furniture: activeFurniture, …` |
| `enclosureKeyAt(…)` / `enclosureOf(…)` | `keyAt(…)` / `enclosureFor(…)` |
| `FURNITURE` in `spawnEnemy` | `activeFurniture` |
| `roomIdAt`, `accentRoomsFor`, `ROOM_ID_BY_NAME`, `__sdfGame.rooms/tunnels/furniture/accents`, `teleport(roomId)` | `activeRooms` / `activeTunnels` / `activeFurniture` |
| player init from `PLAYER_START` | `activeStart` |
| the dynamite branch's `ceilingAt` and `?room=` lookups over `ROOMS` | `activeRooms` |

- [ ] **Step 4: Render gates so they can be hidden**

Right after the loop that builds meshes for `surfaces.boxes`, build the gate
boxes with the **same** code path and keep them by id:

```ts
  /** Gate meshes by gate id; opening a gate hides its mesh. */
  const gateMeshes = new Map<string, THREE.Object3D>();
  for (const g of surfaces.gates) {
    // Reuse whatever the surfaces.boxes loop does for one BoxSpec (extract it to
    // a local `addBoxMesh(spec): THREE.Mesh` if it is inline) so gates get the
    // same material and deferred-router registration as every other box.
    gateMeshes.set(g.id, addBoxMesh(g.box));
  }
  function openGate(id: string): boolean {
    if (!authored || openGates.has(id) || !authored.gates.some(g => g.id === id)) return false;
    openGates.add(id);
    refreshGateColliders();
    const mesh = gateMeshes.get(id);
    if (mesh) mesh.visible = false;
    return true;
  }
```

- [ ] **Step 5: Spawn authored enemies**

At the top of `function spawnAll(errs: string[]): void {` add:

```ts
    if (authored) {
      for (const s of authored.spawns) {
        const room = roomAtPoint(authored, s.pos[0], s.pos[2]);
        if (!room) { errs.push(`spawn ${s.id}: outside every room`); continue; }
        actors.push(spawnEnemy(s.kind, room, s.pos, errs));
      }
      return;
    }
```

Enemy facing from `s.yaw` is not supported by `createZombieActor` (its heading
comes from the seed). Leave a `// TODO(level): honour SpawnDef.yaw` comment.

- [ ] **Step 6: Add the seams**

In the `__sdfGame` object literal:

```ts
    /** The active level: 'ring' or an authored id, plus live gate state. */
    level: () => ({
      id: authored?.id ?? 'ring',
      rooms: activeRooms.map(r => r.name),
      tunnels: activeTunnels.length,
      colliders: colliders.length,
      openGates: [...openGates],
      spawns: authored?.spawns.length ?? null,
    }),
    openGate: (id: string) => openGate(id),
```

- [ ] **Step 7: Check the ring is untouched and the Wake boots**

Run: `npx tsc --noEmit -p . && npx vitest run src/lab/sdf-zombie/webgpu`
Expected: clean, all tests pass.

Run the existing gate, which boots the ring: `LAB_TMP=.lab-tmp scripts/sdf-game-shorty-gate.sh`
Expected: PASS (ring unchanged).

Then open `/sdf-game.html?level=the-wake` in a browser (`npm run dev`): the
player stands at the gates facing north, walls and corridors render, the
graveyard is open and tall, the crypt corridor is blocked by the slab, and
`__sdfGame.openGate('crypt-slab')` makes it passable. Probe boot time on the
28 × 28 m graveyard is the thing to watch: if boot takes longer than ~10 s,
note the time in the commit and continue (it's a known risk, not a blocker).

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(level): ?level=<id> loads authored levels (walls, gates, spawns, probes); ring unchanged"
```

---

### Task 6: Headless Wake gate (session)

**Files:**
- Create: `scripts/sdf-game-wake-gate.mjs`
- Create: `scripts/sdf-game-wake-gate.sh`

Plans 2 and 3 extend this gate; keep each check a named block.

- [ ] **Step 1: Write the gate driver**

```js
// scripts/sdf-game-wake-gate.mjs — headless gate for level 0, The Wake.
// No-deps CDP, the same plumbing as scripts/sdf-game-shorty-gate.mjs.
//
//   1. BOOT: webgpu backend, no console errors, level 'the-wake' is active.
//   2. LAYOUT: five rooms, the player starts in 'gates'.
//   3. GATE: the crypt slab blocks the player until opened, then lets them through.
//
// Usage: LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 node scripts/sdf-game-wake-gate.mjs
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9291);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {} });

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=the-wake&frozen` });

let backend = null;
for (let i = 0; i < 240 && !backend; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
}
if (!backend) { console.error(consoleEvents.slice(-8)); fail('page never booted (__sdfGame absent)'); }

// 1. BOOT
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors at boot: ${JSON.stringify(errs.slice(0, 3))}`);
const level = await evaluate('__sdfGame.level()');
if (level.id !== 'the-wake') fail(`level ${level.id}, expected the-wake`);
pass('boot: webgpu, no errors, the-wake active');

// 2. LAYOUT
if (JSON.stringify(level.rooms) !== JSON.stringify(['gates', 'graveyard', 'crypt', 'parlour', 'secret'])) {
  fail(`rooms ${JSON.stringify(level.rooms)}`);
}
if ((await evaluate('__sdfGame.room()')) !== 'gates') fail(`start room ${await evaluate('__sdfGame.room()')}`);
pass('layout: five rooms, start in gates');

// 3. GATE — stand south of the slab, walk north for 2 s, check z did not cross it.
async function walkNorthFrom(x, z, seconds) {
  await evaluate(`__sdfGame.setPose(${x}, ${z}, 0, 0)`);
  await evaluate(`__sdfGame.walkTo(${x}, -47)`);
  await evaluate(`__sdfGame.step(${Math.round(seconds * 60)}, 1/60)`);
  return evaluate('__sdfGame.pose().pos[2]');
}
const blockedZ = await walkNorthFrom(0, -42.5, 2);
if (blockedZ < -44.4) fail(`walked through the closed crypt slab (z ${blockedZ})`);
if (!(await evaluate('__sdfGame.openGate("crypt-slab")'))) fail('openGate returned false');
const openZ = await walkNorthFrom(0, -42.5, 3);
if (openZ > -45.5) fail(`gate open but player stopped at z ${openZ}`);
pass(`gate: blocked at z ${blockedZ.toFixed(2)}, through to z ${openZ.toFixed(2)} once open`);

console.log('PASS sdf-game-wake-gate');
process.exit(0);
```

Before running, confirm the seams the gate uses exist on your base branch:
`grep -n "setPose:\|walkTo\|step:\|pose:\|room:" src/lab/sdf-zombie/webgpu/game-main.ts`.
If there is no `walkTo`, find the headless autopilot seam (it sets the
`autopilot` variable) and use its real name in `walkNorthFrom`; do not add a
second autopilot.

- [ ] **Step 2: Write the wrapper**

```bash
#!/usr/bin/env bash
# Headless gate for level 0, The Wake. Owns its own vite + Chrome via the
# shared lifecycle, on its own port pair.
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# In a sandbox, export LAB_TMP=.lab-tmp or Chrome produces no frames.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5291}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9291}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-wake-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

- [ ] **Step 3: Run it**

Run: `chmod +x scripts/sdf-game-wake-gate.sh && LAB_TMP=.lab-tmp scripts/sdf-game-wake-gate.sh`
Expected: three `ok` lines and `PASS sdf-game-wake-gate`.

- [ ] **Step 4: Commit**

```bash
git add scripts/sdf-game-wake-gate.mjs scripts/sdf-game-wake-gate.sh
git commit -m "test(level): headless Wake gate — boot, layout, crypt slab"
```

---

### Risks

- **Probe cost on big rooms.** Probe grids are per room; the graveyard is 28 × 28 × 8 m. Boot time and per-frame gather cost are unmeasured. Fallback: `?probes=0`.
- **Navigation grid size.** ~17k cells for the Wake; built once at boot. Fine in tests; watch boot time.
- **Actors assume y = 0.** Any future multi-height level needs actor, player and navigation work first.
- **Gate vs. enemies.** Navigation is built with gates open, so an enemy can path into a closed gate and stand against it. Acceptable in the blockout; revisit if it reads badly.
