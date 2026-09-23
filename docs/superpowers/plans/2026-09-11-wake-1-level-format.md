# The Wake 1: Level Format v1 + Blender Pipeline — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Tasks 1–5 are pure/offline and dispatchable; Tasks 6–7 edit the game and run a headless gate (session).

**Status:** revised 2026-09-23 (supersedes the 2026-09-11 draft). Part 1 of 3 for level 0, The Wake.

**Goal:** Levels are authored in Blender, stored as Level Format v1 JSON, and loaded into the SDF FPS with `?level=<id>`; the Wake blockout is playable as geometry; the testbed ring keeps working unchanged as the default.

**Spec:** `docs/superpowers/specs/2026-09-23-level-format-design.md` — read it first. It is the source of truth for the schema, validation, generation rules, states and capabilities. Where this plan and the spec disagree, the spec wins; fix the plan.

**Brief:** [docs/game/levels/00-the-wake/implementation.md](../../game/levels/00-the-wake/implementation.md).

**Architecture:** Three pure modules: `level-def.ts` (types + the spec §6 generators), `level-json.ts` (spec §4–§8: strict parse, validation, state filtering, derived capabilities) and `active-level.ts` (one `ActiveLevel` interface with two implementations: `ringLevel()` wrapping today's `game-level.ts` byte-for-byte, and `authoredLevel(def)`). The game stores the active level on `ctx.world.level`, and every place that read the ring's globals reads it instead. Two Blender scripts build and export levels.

**Tech Stack:** TypeScript, Vitest, three.js WebGPU, Blender 5.2 `bpy` (headless), no-deps CDP gate scripts.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production
  scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**
    (no `three` import; plain data in, plain data out). The renderer-facing
    code only reads that logic's output and writes objects.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module —
    never as new `main()` bindings (`npm test -- game-context`).
  - Keep the simulation deterministic and console/capture seams in plain data.
  - The **level JSON and its fixtures are the port's conformance suite**: the
    Rust loader will read `public/assets/levels/fixtures/*.level.json` too.
    Never make a test depend on a TypeScript-only behaviour the spec doesn't state.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is
  symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`.
  Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
  Capture scripts require `window.__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- **Boot time is a gate:** Task 6 reports cold-boot time for the ring against
  the base branch, and for `?level=the-wake`.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

---

## Facts pinned for the implementer (verified 2026-09-23 on `main`)

- **The ring level:** `src/lab/sdf-zombie/webgpu/game-level.ts` (600 lines): pure.
  Exports `Aabb`, `RoomDef`, `TunnelDef`, `FurnitureDef`, `PlaneSpec`, `BoxSpec`,
  `AccentLight`, `litWallAlbedo`, `ROOMS`, `TUNNELS`, `FURNITURE`,
  `levelColliders()`, `levelSurfaces()`, `enclosureKeyAt()`, `enclosureOf()`,
  `wanderBounds()`, `spawnPoints()`, `PLAYER_START`. `RoomDef` requires
  `zombies` (slot count) and optional `soldiers` (first N slots are soldiers).
  **Do not change this file's behaviour**; its tests and gates pin it.
- **Who reads the ring's globals** (all must move to `ctx.world.level` in Task 6):
  `game-main.ts` (imports at line ~92: `ROOMS, TUNNELS, FURNITURE, levelColliders,
  levelSurfaces, enclosureKeyAt, enclosureOf, wanderBounds, spawnPoints,
  PLAYER_START`), `game-player-leaves.ts`, `game-lighting-leaves.ts`,
  `game-demo-leaves.ts`, `game-panels-leaves.ts`, `game-seams-world.ts`,
  `game-seams-weapon-player.ts`, `game-seams-spawn-goo.ts`,
  `game-world-leaves.ts`, `game-weapon-leaves.ts`. Type-only importers
  (`Aabb`, `RoomDef`, …) stay as they are.
- **World state:** `game-state-world.ts` defines `WorldState` (`colliders: Aabb[]`,
  `encounterNav`, `surfaces`, `roomProbes`, …), `makeWorldState()` and
  `WORLD_BINDINGS`. Boot fills it in `game-main.ts`:
  `ctx.world.colliders = levelColliders();` then
  `ctx.world.encounterNav = createEncounterNavigation(ROOMS, TUNNELS, ctx.world.colliders);`
  then `ctx.world.surfaces = levelSurfaces();`.
- **Boot room select** in `game-main.ts`: `ctx.boot.roomParam` (`?room=`) and
  `ctx.boot.room` are resolved from `ROOMS`, and the player starts at
  `PLAYER_START` otherwise.
- **Player collision** (`game-player.ts`): capsule vs a flat `Aabb[]`, hard floor at
  y = 0. **Navigation** (`encounter-navigation.ts`):
  `createEncounterNavigation(rooms, tunnels, boxes)`, 0.4 m grid, 0.34 m inflation.
- **Seams:** `__sdfGame.setPose(x, z, yaw, pitch?, y?)`, `.pose()`, `.room()`,
  `.walkTo(x, z)` live in `game-seams-weapon-player.ts`; world seams in
  `game-seams-world.ts` (`createWorldSeams(ctx)`).
- **Tests:** co-located `*.test.ts`, `import { describe, expect, it } from 'vitest'`.
  Vitest runs from the repo root, so tests read fixtures with root-relative paths.
- **Blender:** `/opt/homebrew/bin/blender` (5.2).
  `blender --background --factory-startup --python <script> -- <args>`.

## File structure

| File | Responsibility |
| --- | --- |
| Create `src/lab/sdf-zombie/webgpu/level-def.ts` (+ test) | Types; spec §6 generators (openings, colliders, surfaces, windows), enclosure lookups |
| Create `src/lab/sdf-zombie/webgpu/level-json.ts` (+ test) | Spec §4–§8: strict parse, validation, states, capabilities |
| Create `public/assets/levels/fixtures/two-rooms.level.json` | Valid fixture using every v1 feature the web engine supports |
| Create `public/assets/levels/fixtures/two-floors.level.json` | Valid fixture needing `multi-floor` |
| Create `src/lab/sdf-zombie/webgpu/active-level.ts` (+ test) | `ActiveLevel`: `ringLevel()`, `authoredLevel()`, engine capabilities |
| Create `scripts/levels/export_level.py`, `docs/game/levels/blender-conventions.md` | Exporter + authoring rules |
| Create `scripts/levels/build_the_wake_blockout.py`, `assets-source/levels/the-wake.blend`, `public/assets/levels/the-wake.level.json`, `src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts` | The Wake blockout |
| Modify `game-state-world.ts`, `game-main.ts`, the ten readers listed above | Wire `ctx.world.level` |
| Create `scripts/sdf-game-wake-gate.mjs`, `scripts/sdf-game-wake-gate.sh` | Headless gate |

---

### Task 1: `level-def.ts` — types and spec §6 generators (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-def.ts`
- Create: `src/lab/sdf-zombie/webgpu/level-def.test.ts`

**Off-limits:** everything else.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/level-def.test.ts
//
// Hand-worked gates for spec §6: two 8x8 rooms joined by an x-axis corridor.
// If walls, openings or lintels are wrong, the walk test or the
// corridor-clear test fails before anything reaches the renderer.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import {
  DEFAULT_PALETTE, LEVEL_WALL_T, enclosureKeyIn, enclosureOfIn, gateColliders,
  layoutColliders, layoutSurfaces, roomAtPoint, roomMouths, type LevelDef, type LevelRoom,
} from './level-def';
import { stepPlayer, type PlayerState } from './game-player';

function twoRooms(): LevelDef {
  const P = DEFAULT_PALETTE;
  const room = (id: number, name: string, minX: number, maxX: number): LevelRoom => ({
    id, name, minX, maxX, minZ: 0, maxZ: 8, height: 3, floor: 0, sky: null,
    wallColor: P.wall, floorColor: P.floor, ceilColor: P.ceil, accents: [], zombies: 0, soldiers: 0,
  });
  return {
    id: 'two', name: 'Two rooms', ammo: 'infinite', palette: P, loadout: [], completeOn: 'pickup.cd',
    state: 'default', states: ['default'], requires: [],
    rooms: [room(1, 'west', 0, 8), room(2, 'east', 9.6, 17.6)],
    tunnels: [{ name: 'tunnel-1-2', a: 1, b: 2, minX: 8, maxX: 9.6, minZ: 3.2, maxZ: 4.8,
      height: 2.2, color: P.tunnel, axis: 'x', floor: 0 }],
    stairs: [], furniture: [], solids: [],
    gates: [{ id: 'door', opensOn: 'open.door', box: { min: [8.6, 0, 3.2], max: [9.0, 2.2, 4.8] } }],
    triggers: [],
    windows: [{ id: 'w1', view: 'night', room: 1, side: 'n', box: { min: [3, 1, -0.05], max: [5, 2, 0.05] } }],
    playerStart: { x: 4, y: 0, z: 4, yaw: Math.PI / 2, pitch: 0 },
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

  it('ignores a corridor on a different floor', () => {
    const L = twoRooms();
    L.tunnels[0]!.floor = 3;
    expect(roomMouths(L, L.rooms[0]!, 'e')).toEqual([]);
  });
});

describe('layoutColliders', () => {
  it('leaves the corridor clear at walking height', () => {
    const boxes = layoutColliders(twoRooms());
    for (let x = 7.9; x <= 9.7; x += 0.1) expect(hitsPoint(boxes, [x, 1.0, 4.0])).toBe(false);
  });

  it('closes every other stretch of wall', () => {
    const boxes = layoutColliders(twoRooms());
    expect(hitsPoint(boxes, [8.15, 1.0, 1.0])).toBe(true);
    expect(hitsPoint(boxes, [4.0, 1.0, -0.15])).toBe(true);
    expect(hitsPoint(boxes, [8.15, 2.6, 4.0])).toBe(true);
    expect(hitsPoint(boxes, [8.8, 1.0, 3.2 - LEVEL_WALL_T / 2])).toBe(true);
  });

  it('raises walls with the room floor', () => {
    const L = twoRooms();
    L.rooms[0]!.floor = 2;
    L.tunnels = [];
    const boxes = layoutColliders(L);
    expect(hitsPoint(boxes, [4.0, 4.5, -0.15])).toBe(true);   // floor 2 + 2.5
    expect(hitsPoint(boxes, [4.0, 5.5, -0.15])).toBe(false);  // above floor 2 + height 3
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
    expect(s.pos[2]).toBeGreaterThan(0.3);
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
  it('gives each room a floor and a ceiling, and a sky room no ceiling', () => {
    const L = twoRooms();
    expect(layoutSurfaces(L).planes.filter(p => p.axis === 1 && p.facing === -1)).toHaveLength(2);
    L.rooms[1]!.sky = 'stars';
    expect(layoutSurfaces(L).planes.filter(p => p.axis === 1 && p.facing === -1)).toHaveLength(1);
  });

  it('puts a header over the opening; every wall plane has extent on its span axis', () => {
    const { planes } = layoutSurfaces(twoRooms());
    expect(planes.find(p => p.axis === 0 && p.min[0] === 8 && p.min[1] === 2.2)).toBeDefined();
    for (const p of planes) {
      if (p.axis === 0) expect(p.max[2] - p.min[2]).toBeGreaterThan(1e-3);
      if (p.axis === 2) expect(p.max[0] - p.min[0]).toBeGreaterThan(1e-3);
    }
  });

  it('returns gates and windows separately', () => {
    const s = layoutSurfaces(twoRooms());
    expect(s.gates.map(g => g.id)).toEqual(['door']);
    expect(s.windows).toHaveLength(1);
    const w = s.windows[0]!;
    expect(w).toMatchObject({ id: 'w1', view: 'night' });
    expect(w.plane).toMatchObject({ axis: 2, facing: 1 });
    expect(w.plane.min[0]).toBe(3);
    expect(w.plane.max[0]).toBe(5);
    expect(w.plane.min[2]).toBeGreaterThan(0);          // nudged inward off the wall
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

Run: `npm test -- level-def`
Expected: FAIL — `Cannot find module './level-def'`.

- [ ] **Step 3: Write the module**

```ts
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

export interface LevelRoom extends RoomDef { floor: number; sky: string | null }
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- level-def`
Expected: PASS, 13 tests. If the walk test stalls near x ≈ 7.7, a header or
side wall was generated at walking height: print boxes with `min[1] < 1.75`
whose x-range overlaps 7.5–10.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/level-def.ts src/lab/sdf-zombie/webgpu/level-def.test.ts
git commit -m "feat(level): level-def — Level Format v1 types and generation rules (spec §6)"
```

---

### Task 2: `level-json.ts` + shared fixtures (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-json.ts`
- Create: `src/lab/sdf-zombie/webgpu/level-json.test.ts`
- Create: `public/assets/levels/fixtures/two-rooms.level.json`
- Create: `public/assets/levels/fixtures/two-floors.level.json`

**Off-limits:** `level-def.ts` (Task 1 owns it; if a type is missing, stop and report).

- [ ] **Step 1: Write the fixtures**

`public/assets/levels/fixtures/two-rooms.level.json` is exactly the example in
spec §4.2 (copy it verbatim).

`public/assets/levels/fixtures/two-floors.level.json`:

```json
{
  "version": 1, "id": "two-floors",
  "rooms": [
    { "id": 1, "name": "low", "min": [0, 0], "max": [8, 8], "height": 5 },
    { "id": 2, "name": "high", "min": [0, -8], "max": [8, -1.6], "floor": 2.5, "height": 3 }
  ],
  "stairs": [{ "id": "steps", "up": "-z", "min": [3, 0, 0.5], "max": [5, 2.5, 5] }],
  "start": { "pos": [4, 0, 6], "yaw": 0 },
  "pickups": [{ "id": "cd", "item": "cd", "pos": [4, 3.5, -4] }]
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/level-json.test.ts
//
// Spec §4–§8. Valid cases read the shared fixtures (the Rust loader will read
// the same files); invalid cases mutate a copy.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevelJson } from './level-json';

const fixture = (name: string): any =>
  JSON.parse(readFileSync(`public/assets/levels/fixtures/${name}.level.json`, 'utf8'));

describe('parseLevelJson: two-rooms fixture', () => {
  it('builds a LevelDef in its default state', () => {
    const L = parseLevelJson(fixture('two-rooms'));
    expect(L).toMatchObject({ id: 'two-rooms', ammo: 'finite', loadout: ['melee'], state: 'combat',
      states: ['combat', 'quiet'] });
    expect(L.rooms.map(r => [r.id, r.name, r.minX, r.maxX, r.minZ, r.maxZ, r.floor, r.height]))
      .toEqual([[1, 'west', 0, 8, 0, 8, 0, 3], [2, 'east', 9.6, 17.6, 0, 8, 0, 3]]);
    expect(L.tunnels[0]).toMatchObject({ name: 'tunnel-1-2', axis: 'x', minX: 8, maxX: 9.6, floor: 0 });
    expect(L.furniture[0]).toMatchObject({ room: 1, minX: 1, maxX: 2, height: 0.9 });
    expect(L.rooms[0]!.accents).toEqual([{ pos: [1, 1.2, 7], color: [1, 0.5, 0.2], power: 9 }]);
    expect(L.playerStart).toEqual({ x: 4, y: 0, z: 4, yaw: 1.5708, pitch: 0 });
    expect(L.triggers[0]!.once).toBe(true);
    expect(L.windows[0]).toMatchObject({ id: 'w1', view: 'night-fields', room: 1, side: 'n' });
    expect(L.requires).toEqual(['windows']);
    expect(L.spawns.map(s => s.id)).toEqual(['z1']);
    expect(L.rooms[1]).toMatchObject({ zombies: 1, soldiers: 0 });
  });

  it('filters to another state', () => {
    const L = parseLevelJson(fixture('two-rooms'), { state: 'quiet' });
    expect(L.state).toBe('quiet');
    expect(L.spawns).toEqual([]);
    expect(L.rooms[1]).toMatchObject({ zombies: 0 });
  });

  it('rejects an unknown state', () => {
    expect(() => parseLevelJson(fixture('two-rooms'), { state: 'party' })).toThrow('state party');
  });
});

describe('parseLevelJson: two-floors fixture', () => {
  it('reads floor heights and stairs, and derives multi-floor', () => {
    const L = parseLevelJson(fixture('two-floors'));
    expect(L.rooms[1]).toMatchObject({ floor: 2.5, height: 3 });
    expect(L.stairs).toEqual([{ id: 'steps', up: '-z', box: { min: [3, 0, 0.5], max: [5, 2.5, 5] } }]);
    expect(L.requires).toEqual(['multi-floor']);
    expect(L.states).toEqual(['default']);
    expect(L.playerStart.y).toBe(0);
  });
});

describe('parseLevelJson: rejections', () => {
  it.each([
    ['a tunnel that does not touch its rooms', (f: any) => { f.tunnels[0].min = [8.5, 3.2]; }, 'tunnel-1-2'],
    ['a tunnel narrower than 1.4 m', (f: any) => { f.tunnels[0].min = [8, 3.5]; f.tunnels[0].max = [9.6, 4.5]; }, 'narrower than 1.4'],
    ['a start outside every room', (f: any) => { f.start.pos = [30, 0, 30]; }, 'start'],
    ['a spawn in a corridor', (f: any) => { f.spawns[0].pos = [8.8, 0, 4]; }, 'spawn z1'],
    ['a duplicate marker id', (f: any) => { f.graves[0].id = 'cd'; }, 'duplicate id cd'],
    ['a raised furniture box', (f: any) => { f.furniture[0].min = [1, 0.5, 1]; }, 'furniture'],
    ['an unknown pickup item', (f: any) => { f.pickups[0].item = 'rocket'; }, 'pickup cd'],
    ['a wrong version', (f: any) => { f.version = 2; }, 'version'],
    ['an inverted box', (f: any) => { f.gates[0].max = [8, 2.2, 4.8]; }, 'gate door'],
    ['an unknown key', (f: any) => { f.rooms[0].colour = 'red'; }, 'unknown key colour'],
    ['an undeclared state on an element', (f: any) => { f.spawns[0].states = ['party']; }, 'spawn z1'],
    ['a window off every wall', (f: any) => { f.windows[0].min = [3, 1, 3]; f.windows[0].max = [5, 2, 3.1]; }, 'window w1'],
  ])('rejects %s', (_label, mutate, needle) => {
    const f = fixture('two-rooms');
    mutate(f);
    expect(() => parseLevelJson(f)).toThrow(needle);
  });

  it('reports every problem at once', () => {
    const f = fixture('two-rooms');
    f.start.pos = [30, 0, 30];
    f.spawns[0].pos = [8.8, 0, 4];
    expect(() => parseLevelJson(f)).toThrow(/start.*spawn z1/s);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- level-json`
Expected: FAIL — `Cannot find module './level-json'`.

- [ ] **Step 4: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/level-json.ts
//
// LEVEL FORMAT v1 — parse, validate, filter to one state, derive capabilities.
// Spec: docs/superpowers/specs/2026-09-23-level-format-design.md §4, §5, §7, §8.
// Written by scripts/levels/export_level.py. Collects EVERY problem and throws
// once, so an author fixing a .blend sees the whole list.

import type { Vec3 } from '../types';
import type { Aabb, FurnitureDef } from './game-level';
import {
  DEFAULT_PALETTE, LEVEL_TOL, PICKUP_ITEMS, type BellDef, type Capability, type GateDef,
  type GraveDef, type LevelDef, type LevelPalette, type LevelRoom, type LevelTunnel,
  type PickupDef, type PickupItem, type SpawnDef, type StairDef, type TriggerDef,
  type WallSide, type WindowDef,
} from './level-def';

type Json = Record<string, unknown>;

const MIN_TUNNEL_WIDTH = 1.4;
const MAX_STAIR_RISE = 3;

/** Allowed keys per element (spec §4). `states` is allowed on every element. */
const KEYS: Record<string, readonly string[]> = {
  top: ['version', 'id', 'name', 'ammo', 'loadout', 'completeOn', 'palette', 'states', 'rooms', 'tunnels',
    'stairs', 'furniture', 'solids', 'gates', 'triggers', 'windows', 'lights', 'start', 'spawns', 'graves',
    'pickups', 'bells'],
  palette: ['wall', 'floor', 'ceil', 'tunnel', 'solid'],
  room: ['id', 'name', 'min', 'max', 'floor', 'height', 'sky', 'states'],
  tunnel: ['a', 'b', 'min', 'max', 'height', 'states'],
  stair: ['id', 'up', 'min', 'max', 'states'],
  box: ['min', 'max', 'states'],
  gate: ['id', 'opensOn', 'min', 'max', 'states'],
  trigger: ['id', 'event', 'once', 'min', 'max', 'states'],
  window: ['id', 'view', 'min', 'max', 'states'],
  light: ['pos', 'color', 'power', 'states'],
  start: ['pos', 'yaw'],
  spawn: ['id', 'kind', 'pos', 'yaw', 'states'],
  grave: ['id', 'wave', 'pos', 'yaw', 'states'],
  pickup: ['id', 'item', 'pos', 'states'],
  bell: ['id', 'pos', 'radius', 'states'],
};

export interface ParseOptions {
  /** State to filter to (spec §7). Default: the file's first state. */
  state?: string;
}

export function parseLevelJson(raw: unknown, opts: ParseOptions = {}): LevelDef {
  const errors: string[] = [];
  const j = (raw ?? {}) as Json;

  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const keys = (o: Json, kind: keyof typeof KEYS, where: string) => {
    for (const k of Object.keys(o)) if (!KEYS[kind]!.includes(k)) errors.push(`${where}: unknown key ${k}`);
  };
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
    if (Array.isArray(v) && v.every(x => typeof x === 'object' && x !== null && !Array.isArray(x))) return v as Json[];
    errors.push(`${where}: expected an array of objects`);
    return [];
  };
  const aabb = (o: Json, where: string): Aabb => {
    const min = vec(o.min, 3, `${where}.min`) as unknown as Vec3;
    const max = vec(o.max, 3, `${where}.max`) as unknown as Vec3;
    if (!(max[0] > min[0] && max[1] > min[1] && max[2] > min[2])) errors.push(`${where}: max must exceed min on every axis`);
    return { min, max };
  };

  keys(j, 'top', 'level');
  if (j.version !== 1) errors.push(`version: expected 1, got ${String(j.version)}`);
  const id = str(j.id, 'id', 'unknown');
  if (!/^[a-z0-9-]+$/.test(id)) errors.push(`id: must match [a-z0-9-]+`);
  const name = typeof j.name === 'string' && j.name ? j.name : id;
  const ammo = j.ammo === 'infinite' ? 'infinite' : 'finite';
  if (j.ammo !== undefined && j.ammo !== 'infinite' && j.ammo !== 'finite') errors.push('ammo: finite or infinite');
  const loadout = j.loadout === undefined ? [] : (Array.isArray(j.loadout) ? j.loadout : []).map((w, i) => str(w, `loadout[${i}]`));
  const completeOn = typeof j.completeOn === 'string' && j.completeOn ? j.completeOn : 'pickup.cd';

  const pj = (j.palette ?? {}) as Json;
  keys(pj, 'palette', 'palette');
  const colour = (k: keyof LevelPalette): Vec3 =>
    pj[k] === undefined ? DEFAULT_PALETTE[k] : (vec(pj[k], 3, `palette.${k}`) as unknown as Vec3);
  const palette: LevelPalette = { wall: colour('wall'), floor: colour('floor'), ceil: colour('ceil'),
    tunnel: colour('tunnel'), solid: colour('solid') };

  // --- states (spec §7) --------------------------------------------------------
  const states = j.states === undefined ? ['default']
    : (Array.isArray(j.states) && j.states.length > 0 ? j.states.map((s, i) => str(s, `states[${i}]`)) : (errors.push('states: a non-empty array'), ['default']));
  const state = opts.state ?? states[0]!;
  if (!states.includes(state)) errors.push(`state ${state}: not declared in states`);
  /** Is this element present in the chosen state? Validates its `states` too. */
  const present = (o: Json, where: string): boolean => {
    if (o.states === undefined) return true;
    if (!Array.isArray(o.states)) { errors.push(`${where}.states: expected an array`); return true; }
    for (const s of o.states) if (!states.includes(s as string)) errors.push(`${where}: state ${String(s)} not declared`);
    return (o.states as string[]).includes(state);
  };

  // --- rooms -------------------------------------------------------------------
  const rooms: LevelRoom[] = [];
  list(j.rooms, 'rooms').forEach((o, i) => {
    const where = `rooms[${i}]`;
    keys(o, 'room', where);
    const keep = present(o, where);
    const rid = num(o.id, `${where}.id`);
    if (!Number.isInteger(rid) || rid < 1) errors.push(`${where}.id: expected an integer >= 1`);
    const rname = str(o.name, `${where}.name`, `room${rid}`);
    const [minX, minZ] = vec(o.min, 2, `${where}.min`);
    const [maxX, maxZ] = vec(o.max, 2, `${where}.max`);
    const floor = o.floor === undefined ? 0 : num(o.floor, `${where}.floor`);
    const height = num(o.height, `${where}.height`, 3);
    if (!(maxX! > minX! && maxZ! > minZ! && height > 0)) errors.push(`${where}: empty room`);
    const sky = o.sky === undefined ? null : str(o.sky, `${where}.sky`);
    if (!keep) return;
    if (rooms.some(r => r.id === rid)) errors.push(`${where}.id: duplicate room id ${rid}`);
    if (rooms.some(r => r.name === rname)) errors.push(`${where}.name: duplicate room name ${rname}`);
    rooms.push({
      id: rid, name: rname, minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ!, floor, height, sky,
      wallColor: palette.wall, floorColor: palette.floor, ceilColor: palette.ceil,
      accents: [], zombies: 0, soldiers: 0,
    });
  });
  if (rooms.length === 0) errors.push('rooms: a level needs at least one room');

  const inRoom = (x: number, z: number) =>
    rooms.find(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ?? null;

  // --- tunnels -----------------------------------------------------------------
  const tunnels: LevelTunnel[] = [];
  list(j.tunnels, 'tunnels').forEach((o, i) => {
    keys(o, 'tunnel', `tunnels[${i}]`);
    const a = num(o.a, `tunnels[${i}].a`);
    const b = num(o.b, `tunnels[${i}].b`);
    const tname = `tunnel-${a}-${b}`;
    const keep = present(o, tname);
    const [minX, minZ] = vec(o.min, 2, `${tname}.min`);
    const [maxX, maxZ] = vec(o.max, 2, `${tname}.max`);
    const height = num(o.height, `${tname}.height`, 2.2);
    if (!keep) return;
    const ra = rooms.find(r => r.id === a);
    const rb = rooms.find(r => r.id === b);
    const t = { minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ! };
    let axis: 'x' | 'z' = 'x';
    let floor = 0;
    if (!ra || !rb || a === b) {
      errors.push(`${tname}: must join two different existing rooms`);
    } else {
      floor = ra.floor;
      if (Math.abs(ra.floor - rb.floor) > LEVEL_TOL) errors.push(`${tname}: rooms ${a} and ${b} are on different floors (use stairs inside a room)`);
      const touchesX = (r: LevelRoom) =>
        (Math.abs(t.maxX - r.minX) <= LEVEL_TOL || Math.abs(t.minX - r.maxX) <= LEVEL_TOL)
        && t.minZ >= r.minZ - LEVEL_TOL && t.maxZ <= r.maxZ + LEVEL_TOL;
      const touchesZ = (r: LevelRoom) =>
        (Math.abs(t.maxZ - r.minZ) <= LEVEL_TOL || Math.abs(t.minZ - r.maxZ) <= LEVEL_TOL)
        && t.minX >= r.minX - LEVEL_TOL && t.maxX <= r.maxX + LEVEL_TOL;
      if (touchesX(ra) && touchesX(rb)) axis = 'x';
      else if (touchesZ(ra) && touchesZ(rb)) axis = 'z';
      else errors.push(`${tname}: its ends must sit flush against a wall of room ${a} and a wall of room ${b}`);
      const width = axis === 'x' ? t.maxZ - t.minZ : t.maxX - t.minX;
      if (width < MIN_TUNNEL_WIDTH - LEVEL_TOL) errors.push(`${tname}: ${width.toFixed(2)} m wide, narrower than 1.4 m`);
    }
    tunnels.push({ name: tname, a, b, ...t, height, color: palette.tunnel, axis, floor });
  });

  const onFloor = (x: number, z: number) =>
    !!inRoom(x, z) || tunnels.some(t => x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ);

  // --- stairs, boxes -----------------------------------------------------------
  const ids = new Set<string>();
  const claim = (markerId: string) => {
    if (ids.has(markerId)) errors.push(`duplicate id ${markerId}`);
    ids.add(markerId);
  };

  const stairs: StairDef[] = [];
  list(j.stairs, 'stairs').forEach((o, i) => {
    const sid = str(o.id, `stairs[${i}].id`, `stair${i}`);
    keys(o, 'stair', `stair ${sid}`);
    const keep = present(o, `stair ${sid}`);
    claim(sid);
    const up = o.up;
    if (up !== '+x' && up !== '-x' && up !== '+z' && up !== '-z') errors.push(`stair ${sid}: up must be +x, -x, +z or -z`);
    const box = aabb(o, `stair ${sid}`);
    if (box.max[1] - box.min[1] > MAX_STAIR_RISE) errors.push(`stair ${sid}: rises more than 3 m`);
    if (!onFloor((box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2)) errors.push(`stair ${sid}: outside every room and corridor`);
    if (keep) stairs.push({ id: sid, up: (up as StairDef['up']) ?? '+z', box });
  });

  const furniture: FurnitureDef[] = [];
  list(j.furniture, 'furniture').forEach((o, i) => {
    const where = `furniture[${i}]`;
    keys(o, 'box', where);
    const keep = present(o, where);
    const box = aabb(o, where);
    const room = inRoom((box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2);
    if (!room) errors.push(`${where}: furniture centre is outside every room`);
    else if (Math.abs(box.min[1] - room.floor) > LEVEL_TOL) errors.push(`${where}: furniture must sit on its room's floor (use solids for raised boxes)`);
    if (keep) furniture.push({ room: room?.id ?? 0, minX: box.min[0], maxX: box.max[0], minZ: box.min[2],
      maxZ: box.max[2], height: box.max[1] - box.min[1] });
  });
  const solids: Aabb[] = [];
  list(j.solids, 'solids').forEach((o, i) => {
    keys(o, 'box', `solids[${i}]`);
    const keep = present(o, `solids[${i}]`);
    const box = aabb(o, `solids[${i}]`);
    if (keep) solids.push(box);
  });

  const gates: GateDef[] = [];
  list(j.gates, 'gates').forEach((o, i) => {
    const gid = str(o.id, `gates[${i}].id`, `gate${i}`);
    keys(o, 'gate', `gate ${gid}`);
    const keep = present(o, `gate ${gid}`);
    claim(gid);
    const g = { id: gid, opensOn: str(o.opensOn, `gate ${gid}.opensOn`), box: aabb(o, `gate ${gid}`) };
    if (keep) gates.push(g);
  });
  const triggers: TriggerDef[] = [];
  list(j.triggers, 'triggers').forEach((o, i) => {
    const tid = str(o.id, `triggers[${i}].id`, `trigger${i}`);
    keys(o, 'trigger', `trigger ${tid}`);
    const keep = present(o, `trigger ${tid}`);
    claim(tid);
    const t = { id: tid, event: str(o.event, `trigger ${tid}.event`), once: o.once !== false, box: aabb(o, `trigger ${tid}`) };
    if (keep) triggers.push(t);
  });

  // --- windows: find the one wall each lies on ---------------------------------
  const windows: WindowDef[] = [];
  list(j.windows, 'windows').forEach((o, i) => {
    const wid = str(o.id, `windows[${i}].id`, `window${i}`);
    keys(o, 'window', `window ${wid}`);
    const keep = present(o, `window ${wid}`);
    claim(wid);
    const view = str(o.view, `window ${wid}.view`, 'none');
    const box = aabb(o, `window ${wid}`);
    let found: { room: number; side: WallSide } | null = null;
    for (const r of rooms) {
      const inY = box.min[1] >= r.floor - LEVEL_TOL && box.max[1] <= r.floor + r.height + LEVEL_TOL;
      const inX = box.min[0] >= r.minX - LEVEL_TOL && box.max[0] <= r.maxX + LEVEL_TOL;
      const inZ = box.min[2] >= r.minZ - LEVEL_TOL && box.max[2] <= r.maxZ + LEVEL_TOL;
      const straddles = (lo: number, hi: number, at: number) => lo <= at + LEVEL_TOL && hi >= at - LEVEL_TOL;
      if (!inY) continue;
      if (inZ && straddles(box.min[0], box.max[0], r.minX)) found = { room: r.id, side: 'w' };
      else if (inZ && straddles(box.min[0], box.max[0], r.maxX)) found = { room: r.id, side: 'e' };
      else if (inX && straddles(box.min[2], box.max[2], r.minZ)) found = { room: r.id, side: 'n' };
      else if (inX && straddles(box.min[2], box.max[2], r.maxZ)) found = { room: r.id, side: 's' };
      if (found) break;
    }
    if (!found) errors.push(`window ${wid}: must lie on one room wall, inside its span and height`);
    else if (keep) windows.push({ id: wid, view, ...found, box });
  });

  // --- lights -> room accents --------------------------------------------------
  list(j.lights, 'lights').forEach((o, i) => {
    keys(o, 'light', `lights[${i}]`);
    const keep = present(o, `lights[${i}]`);
    const pos = vec(o.pos, 3, `lights[${i}].pos`) as unknown as Vec3;
    const color = vec(o.color, 3, `lights[${i}].color`) as unknown as Vec3;
    const power = num(o.power, `lights[${i}].power`, 9);
    const room = inRoom(pos[0], pos[2]);
    if (!room) errors.push(`lights[${i}]: outside every room`);
    else if (keep) room.accents.push({ pos, color, power });
  });

  // --- markers -----------------------------------------------------------------
  const st = (j.start ?? {}) as Json;
  keys(st, 'start', 'start');
  const startPos = vec(st.pos, 3, 'start.pos');
  const playerStart = { x: startPos[0]!, y: startPos[1]!, z: startPos[2]!, yaw: num(st.yaw, 'start.yaw'), pitch: 0 };
  if (!onFloor(playerStart.x, playerStart.z)) errors.push('start: outside every room and corridor');

  const spawns: SpawnDef[] = [];
  list(j.spawns, 'spawns').forEach((o, i) => {
    const sid = str(o.id, `spawns[${i}].id`, `spawn${i}`);
    keys(o, 'spawn', `spawn ${sid}`);
    const keep = present(o, `spawn ${sid}`);
    claim(sid);
    const kind = o.kind === 'soldier' ? 'soldier' : o.kind === 'zombie' ? 'zombie' : null;
    if (!kind) errors.push(`spawn ${sid}: kind must be zombie or soldier`);
    const pos = vec(o.pos, 3, `spawn ${sid}.pos`) as unknown as Vec3;
    const room = inRoom(pos[0], pos[2]);
    if (!room) errors.push(`spawn ${sid}: must be inside a room (not a corridor)`);
    if (!keep) return;
    if (room) {
      room.zombies += 1;
      if (kind === 'soldier') room.soldiers = (room.soldiers ?? 0) + 1;
    }
    spawns.push({ id: sid, kind: kind ?? 'zombie', pos, yaw: isNum(o.yaw) ? o.yaw : 0 });
  });

  const graves: GraveDef[] = [];
  list(j.graves, 'graves').forEach((o, i) => {
    const gid = str(o.id, `graves[${i}].id`, `grave${i}`);
    keys(o, 'grave', `grave ${gid}`);
    const keep = present(o, `grave ${gid}`);
    claim(gid);
    const wave = num(o.wave, `grave ${gid}.wave`);
    if (!Number.isInteger(wave) || wave < 0) errors.push(`grave ${gid}: wave must be an integer >= 0`);
    const pos = vec(o.pos, 3, `grave ${gid}.pos`) as unknown as Vec3;
    if (!inRoom(pos[0], pos[2])) errors.push(`grave ${gid}: must be inside a room`);
    if (keep) graves.push({ id: gid, wave, pos, yaw: isNum(o.yaw) ? o.yaw : 0 });
  });

  const pickups: PickupDef[] = [];
  list(j.pickups, 'pickups').forEach((o, i) => {
    const pid = str(o.id, `pickups[${i}].id`, `pickup${i}`);
    keys(o, 'pickup', `pickup ${pid}`);
    const keep = present(o, `pickup ${pid}`);
    claim(pid);
    const item = PICKUP_ITEMS.find(p => p === o.item);
    if (!item) errors.push(`pickup ${pid}: item must be one of ${PICKUP_ITEMS.join(', ')}`);
    const pos = vec(o.pos, 3, `pickup ${pid}.pos`) as unknown as Vec3;
    if (!onFloor(pos[0], pos[2])) errors.push(`pickup ${pid}: outside every room and corridor`);
    if (keep) pickups.push({ id: pid, item: (item ?? 'shells') as PickupItem, pos });
  });

  const bells: BellDef[] = [];
  list(j.bells, 'bells').forEach((o, i) => {
    const bid = str(o.id, `bells[${i}].id`, `bell${i}`);
    keys(o, 'bell', `bell ${bid}`);
    const keep = present(o, `bell ${bid}`);
    claim(bid);
    const pos = vec(o.pos, 3, `bell ${bid}.pos`) as unknown as Vec3;
    const radius = o.radius === undefined ? 0.8 : num(o.radius, `bell ${bid}.radius`, 0.8);
    if (radius <= 0) errors.push(`bell ${bid}: radius must be > 0`);
    if (!inRoom(pos[0], pos[2])) errors.push(`bell ${bid}: must be inside a room`);
    if (keep) bells.push({ id: bid, pos, radius });
  });

  if (errors.length > 0) throw new Error(`level ${id}: ${errors.join('; ')}`);

  // --- capabilities (spec §8), in a fixed order ---------------------------------
  const requires: Capability[] = [];
  if (rooms.some(r => Math.abs(r.floor) > LEVEL_TOL) || stairs.length > 0) requires.push('multi-floor');
  if (windows.length > 0) requires.push('windows');
  if (rooms.some(r => r.sky !== null)) requires.push('open-sky');

  return {
    id, name, ammo, palette, loadout, completeOn, state, states, requires,
    rooms, tunnels, stairs, furniture, solids, gates, triggers, windows,
    playerStart, spawns, graves, pickups, bells,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- level-json`
Expected: PASS, 17 tests (4 + 12 rejections + 1).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/level-json.ts src/lab/sdf-zombie/webgpu/level-json.test.ts public/assets/levels/fixtures
git commit -m "feat(level): level-json — strict v1 parse, states, capabilities; shared fixtures"
```

---

### Task 3: `active-level.ts` — one interface for the ring and authored levels (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/active-level.ts`
- Create: `src/lab/sdf-zombie/webgpu/active-level.test.ts`

**Off-limits:** `game-level.ts`, `level-def.ts`, `level-json.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/active-level.test.ts
//
// The ring adapter must be byte-for-byte the testbed (every gate depends on
// it); the authored adapter must answer the same questions from a LevelDef.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, authoredLevel, missingCapabilities, ringLevel } from './active-level';
import {
  FURNITURE, PLAYER_START, ROOMS, TUNNELS, enclosureKeyAt, enclosureOf, levelColliders, levelSurfaces, spawnPoints,
} from './game-level';
import { parseLevelJson } from './level-json';

const two = () => parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/two-rooms.level.json', 'utf8')));
const floors = () => parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/two-floors.level.json', 'utf8')));

describe('ringLevel', () => {
  const L = ringLevel();
  it('is the testbed exactly', () => {
    expect(L.id).toBe('ring');
    expect(L.def).toBeNull();
    expect(L.rooms).toBe(ROOMS);
    expect(L.tunnels).toBe(TUNNELS);
    expect(L.furniture).toBe(FURNITURE);
    expect(L.staticColliders).toEqual(levelColliders());
    expect({ planes: L.surfaces.planes, boxes: L.surfaces.boxes }).toEqual(levelSurfaces());
    expect(L.surfaces.gates).toEqual([]);
    expect(L.surfaces.windows).toEqual([]);
    expect(L.playerStart).toEqual({ ...PLAYER_START, y: 0 });
    expect(L.keyAt(-4, -4)).toBe(enclosureKeyAt(-4, -4));
    expect(L.enclosureFor('room1')).toEqual(enclosureOf('room1'));
    expect(L.gateColliders(new Set())).toEqual([]);
  });

  it('lists spawns in spawnAll order: per room, soldiers first', () => {
    const expected = ROOMS.flatMap(room => spawnPoints(room).map((pos, index) => ({
      kind: index < (room.soldiers ?? 0) ? 'soldier' : 'zombie', roomId: room.id, pos,
    })));
    expect(L.spawnList().map(s => ({ kind: s.kind, roomId: s.room.id, pos: s.pos }))).toEqual(expected);
  });
});

describe('authoredLevel', () => {
  it('answers from the LevelDef', () => {
    const L = authoredLevel(two());
    expect(L.id).toBe('two-rooms');
    expect(L.rooms.map(r => r.name)).toEqual(['west', 'east']);
    expect(L.keyAt(8.8, 4)).toBe('tunnel-1-2');
    expect(L.gateColliders(new Set())).toHaveLength(1);
    expect(L.gateColliders(new Set(['door']))).toHaveLength(0);
    expect(L.surfaces.windows).toHaveLength(1);
    expect(L.spawnList().map(s => [s.kind, s.room.name])).toEqual([['zombie', 'east']]);
    expect(L.playerStart).toMatchObject({ x: 4, z: 4 });
  });
});

describe('capabilities', () => {
  it('web engine v1 supports windows and open sky, not multi-floor', () => {
    expect([...ENGINE_CAPABILITIES].sort()).toEqual(['open-sky', 'windows']);
    expect(missingCapabilities(two(), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(floors(), ENGINE_CAPABILITIES)).toEqual(['multi-floor']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- active-level`
Expected: FAIL — `Cannot find module './active-level'`.

- [ ] **Step 3: Write the module**

```ts
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
    surfaces: { planes: s.planes, boxes: s.boxes, gates: [], windows: [] },
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- active-level`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: clean.

```bash
git add src/lab/sdf-zombie/webgpu/active-level.ts src/lab/sdf-zombie/webgpu/active-level.test.ts
git commit -m "feat(level): active-level — ring and authored levels behind one interface"
```

---

### Task 4: Blender exporter + authoring conventions (dispatchable, needs Blender)

**Files:**
- Create: `scripts/levels/export_level.py`
- Create: `docs/game/levels/blender-conventions.md`

- [ ] **Step 1: Write the conventions doc**

```markdown
# Authoring a level in Blender

**Spec:** `docs/superpowers/specs/2026-09-23-level-format-design.md` (the source of truth)
**Exporter:** `scripts/levels/export_level.py`

## Space
- Metres. Blender is Z-up; the game is Y-up. game (x, y, z) = Blender (x, z, −y).
  Game "north" (−z) is Blender +Y.
- Snap to a 0.1 m grid. Corridor ends must sit *exactly* on a room wall.
- A room's floor is the bottom of its box. Floors other than z = 0 need the
  engine's `multi-floor` support (spec §8); the level still exports.

## Collections (names exact)

| Collection | Contains | Object name | Notes |
| --- | --- | --- | --- |
| `rooms` | box meshes | `room:<id>:<name>` | Box bottom = floor, top = ceiling. Custom property `sky` (a view name) makes it open-air |
| `tunnels` | box meshes | `tunnel:<a>:<b>` | Both ends flush with their rooms' walls; same floor as both rooms; ≥ 1.4 m wide |
| `stairs` | box meshes | `stair:<up>:<id>` | `<up>` is `+x`, `-x`, `+z` or `-z` in **game** axes |
| `furniture` | box meshes | any | Sits on its room's floor |
| `solids` | box meshes | any | Any other solid box |
| `gates` | box meshes | `gate:<event>:<id>` | Solid until `<event>` fires |
| `triggers` | box meshes | `trigger:<event>:<id>` | Custom property `once` (default true) |
| `windows` | thin box meshes | `window:<view>:<id>` | Straddles exactly one room wall |
| `lights` | point lights | any | Custom property `power` (default energy ÷ 10) |
| `markers` | empties | see below | +Y arrow is "forward" |

## Markers
`start` (exactly one; Z rotation = facing) · `spawn:<zombie|soldier>:<id>` ·
`grave:<wave>:<id>` · `pickup:<melee|shotgun|dynamite|shells|health|cd>:<id>` ·
`bell:<id>` (custom property `radius`, default 0.8).

## States
Scene custom property `states` = comma-separated names (first is the default).
Any object's custom property `states` = comma-separated names it exists in.

## Scene custom properties
`level_id` (required), `level_name`, `ammo` (`finite`|`infinite`), `loadout`
(comma-separated), `complete_on` (default `pickup.cd`), `states`.

Blender's duplicate suffix (`.001`) is ignored. Event names use dots, never
colons.

## Export
    blender --background assets-source/levels/<id>.blend \
      --python scripts/levels/export_level.py -- public/assets/levels/<id>.level.json

Then run the level's test (`npm test -- level-json.<id>`) and open
`/sdf-game.html?level=<id>` (add `&state=<name>` for another state).
```

- [ ] **Step 2: Write the exporter**

```python
# scripts/levels/export_level.py
"""Export a Blud level (.blend) to Level Format v1 JSON.

Runs INSIDE Blender:

    blender --background assets-source/levels/the-wake.blend \
        --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json

Spec: docs/superpowers/specs/2026-09-23-level-format-design.md
Conventions: docs/game/levels/blender-conventions.md
Validation lives in the game (level-json.ts); this script only refuses names it
cannot read.
"""
import json
import re
import sys

import bpy
from mathutils import Vector

DIGITS = 3


def rnd(v):
    r = round(float(v), DIGITS)
    return 0.0 if r == 0 else r


def out_path():
    argv = sys.argv
    if "--" not in argv or len(argv[argv.index("--") + 1:]) != 1:
        raise SystemExit("usage: blender --background X.blend --python export_level.py -- OUT.json")
    return argv[argv.index("--") + 1]


def to_game(v):
    return [rnd(v[0]), rnd(v[2]), rnd(-v[1])]


def world_aabb(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    return [rnd(min(xs)), rnd(min(zs)), rnd(-max(ys))], [rnd(max(xs)), rnd(max(zs)), rnd(-min(ys))]


def objects(name):
    coll = bpy.data.collections.get(name)
    return [] if coll is None else sorted(coll.all_objects, key=lambda o: o.name)


def base_name(obj):
    return re.sub(r"\.\d{3}$", "", obj.name)


def fields(obj, prefix, count):
    bits = base_name(obj).split(":")
    if bits[0] != prefix or len(bits) != count:
        raise SystemExit(f"bad name {obj.name!r}: expected {prefix} with {count} ':'-separated parts")
    return bits


def csv(value):
    return [s.strip() for s in str(value).split(",") if s.strip()]


def with_states(obj, item):
    if "states" in obj.keys():
        item["states"] = csv(obj["states"])
    return item


def yaw_of(obj):
    return rnd(-obj.matrix_world.to_euler("XYZ").z)


def main():
    scene = bpy.context.scene
    level_id = scene.get("level_id")
    if not level_id:
        raise SystemExit("scene custom property level_id is required")
    doc = {"version": 1, "id": level_id}
    if scene.get("level_name"):
        doc["name"] = scene["level_name"]
    if scene.get("ammo"):
        doc["ammo"] = scene["ammo"]
    if scene.get("loadout"):
        doc["loadout"] = csv(scene["loadout"])
    if scene.get("complete_on"):
        doc["completeOn"] = scene["complete_on"]
    if scene.get("states"):
        doc["states"] = csv(scene["states"])
    for key in ("rooms", "tunnels", "stairs", "furniture", "solids", "gates", "triggers", "windows",
                "lights", "spawns", "graves", "pickups", "bells"):
        doc[key] = []

    for o in objects("rooms"):
        _, rid, name = fields(o, "room", 3)
        gmin, gmax = world_aabb(o)
        room = {"id": int(rid), "name": name, "min": [gmin[0], gmin[2]], "max": [gmax[0], gmax[2]],
                "height": rnd(gmax[1] - gmin[1])}
        if gmin[1] != 0:
            room["floor"] = gmin[1]
        if o.get("sky"):
            room["sky"] = str(o["sky"])
        doc["rooms"].append(with_states(o, room))

    for o in objects("tunnels"):
        _, a, b = fields(o, "tunnel", 3)
        gmin, gmax = world_aabb(o)
        doc["tunnels"].append(with_states(o, {"a": int(a), "b": int(b), "min": [gmin[0], gmin[2]],
                                              "max": [gmax[0], gmax[2]], "height": rnd(gmax[1] - gmin[1])}))

    for o in objects("stairs"):
        _, up, sid = fields(o, "stair", 3)
        gmin, gmax = world_aabb(o)
        doc["stairs"].append(with_states(o, {"id": sid, "up": up, "min": gmin, "max": gmax}))

    for coll in ("furniture", "solids"):
        for o in objects(coll):
            if o.type == "MESH":
                gmin, gmax = world_aabb(o)
                doc[coll].append(with_states(o, {"min": gmin, "max": gmax}))

    for o in objects("gates"):
        _, event, gid = fields(o, "gate", 3)
        gmin, gmax = world_aabb(o)
        doc["gates"].append(with_states(o, {"id": gid, "opensOn": event, "min": gmin, "max": gmax}))

    for o in objects("triggers"):
        _, event, tid = fields(o, "trigger", 3)
        gmin, gmax = world_aabb(o)
        item = {"id": tid, "event": event, "min": gmin, "max": gmax}
        if "once" in o.keys():
            item["once"] = bool(o["once"])
        doc["triggers"].append(with_states(o, item))

    for o in objects("windows"):
        _, view, wid = fields(o, "window", 3)
        gmin, gmax = world_aabb(o)
        doc["windows"].append(with_states(o, {"id": wid, "view": view, "min": gmin, "max": gmax}))

    for o in objects("lights"):
        if o.type != "LIGHT" or o.data.type != "POINT":
            continue
        c = o.data.color
        doc["lights"].append(with_states(o, {"pos": to_game(o.matrix_world.translation),
                                             "color": [rnd(c[0]), rnd(c[1]), rnd(c[2])],
                                             "power": rnd(o.get("power", o.data.energy / 10.0))}))

    start = None
    for o in objects("markers"):
        if o.type != "EMPTY":
            continue
        name = base_name(o)
        pos = to_game(o.matrix_world.translation)
        kind = name.split(":")[0]
        if name == "start":
            if start is not None:
                raise SystemExit("more than one start marker")
            start = {"pos": pos, "yaw": yaw_of(o)}
        elif kind == "spawn":
            _, what, sid = fields(o, "spawn", 3)
            doc["spawns"].append(with_states(o, {"id": sid, "kind": what, "pos": pos, "yaw": yaw_of(o)}))
        elif kind == "grave":
            _, wave, gid = fields(o, "grave", 3)
            doc["graves"].append(with_states(o, {"id": gid, "wave": int(wave), "pos": pos, "yaw": yaw_of(o)}))
        elif kind == "pickup":
            _, item, pid = fields(o, "pickup", 3)
            doc["pickups"].append(with_states(o, {"id": pid, "item": item, "pos": pos}))
        elif kind == "bell":
            _, bid = fields(o, "bell", 2)
            doc["bells"].append(with_states(o, {"id": bid, "pos": pos, "radius": rnd(o.get("radius", 0.8))}))
        else:
            raise SystemExit(f"unknown marker {o.name!r}")
    if start is None:
        raise SystemExit("no start marker")
    doc["start"] = start

    for key in [k for k, v in doc.items() if v == []]:
        del doc[key]

    path = out_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print(f"exported {level_id}: {len(doc.get('rooms', []))} rooms, {len(doc.get('tunnels', []))} tunnels -> {path}")


main()
```

- [ ] **Step 3: Round-trip the two-rooms fixture through Blender**

The exporter must reproduce what the parser accepts. Build a scene matching
`fixtures/two-rooms.level.json` (rooms, tunnel, one furniture box, the gate,
the window, start, the zombie spawn with `states = "combat"`, one grave, the
CD, the bell, the light; scene `states = "combat,quiet"`), export it, and parse it:

```bash
mkdir -p .lab-tmp
cat > .lab-tmp/roundtrip_two_rooms.py <<'PY'
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc["level_id"] = "two-rooms"; sc["ammo"] = "finite"; sc["loadout"] = "melee"; sc["states"] = "combat,quiet"
C = {}
def coll(n):
    if n not in C:
        c = bpy.data.collections.new(n); sc.collection.children.link(c); C[n] = c
    return C[n]
def gbox(cn, name, gmin, gmax):
    bmin = (gmin[0], -gmax[2], gmin[1]); bmax = (gmax[0], -gmin[2], gmax[1])
    m = bpy.data.meshes.new(name)
    v = [(x, y, z) for x in (bmin[0], bmax[0]) for y in (bmin[1], bmax[1]) for z in (bmin[2], bmax[2])]
    m.from_pydata(v, [], [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)])
    o = bpy.data.objects.new(name, m); coll(cn).objects.link(o); return o
def gempty(name, pos, yaw=0.0, **props):
    o = bpy.data.objects.new(name, None); o.location = (pos[0], -pos[2], pos[1])
    o.rotation_euler = (0.0, 0.0, -yaw)
    for k, v in props.items(): o[k] = v
    coll("markers").objects.link(o)
gbox("rooms", "room:1:west", (0, 0, 0), (8, 3, 8))
gbox("rooms", "room:2:east", (9.6, 0, 0), (17.6, 3, 8))
gbox("tunnels", "tunnel:1:2", (8, 0, 3.2), (9.6, 2.2, 4.8))
gbox("furniture", "crate", (1, 0, 1), (2, 0.9, 2))
gbox("gates", "gate:open.door:door", (8.6, 0, 3.2), (9, 2.2, 4.8))
gbox("triggers", "trigger:wave.0:t1", (2, 0, 2), (3, 2, 3))
gbox("windows", "window:night-fields:w1", (3, 1, -0.05), (5, 2, 0.05))
ld = bpy.data.lights.new("l", "POINT"); ld.color = (1, 0.5, 0.2); lo = bpy.data.objects.new("l", ld)
lo.location = (1, -7, 1.2); lo["power"] = 9; coll("lights").objects.link(lo)
gempty("start", (4, 0, 4), 1.5708)
gempty("spawn:zombie:z1", (14, 0, 4), states="combat")
gempty("grave:0:g1", (12, 0, 6))
gempty("pickup:cd:cd", (16, 1, 4))
gempty("bell:bell", (15, 2.5, 1.5), radius=0.8)
PY
blender --background --factory-startup --python .lab-tmp/roundtrip_two_rooms.py \
  --python scripts/levels/export_level.py -- "$PWD/.lab-tmp/two-rooms.roundtrip.json"
```

Then check the result with a throwaway Vitest file:

```bash
cat > .lab-tmp/roundtrip.test.ts <<'TS'
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseLevelJson } from '../src/lab/sdf-zombie/webgpu/level-json';
it('exporter output parses like the fixture', () => {
  const a = parseLevelJson(JSON.parse(readFileSync('.lab-tmp/two-rooms.roundtrip.json', 'utf8')));
  const b = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/two-rooms.level.json', 'utf8')));
  expect({ ...a, name: '' }).toEqual({ ...b, name: '' });
});
TS
npx vitest run --dir . .lab-tmp/roundtrip.test.ts
```

Expected: PASS. (The fixture's `name` and `completeOn` may differ from the
scene's defaults; the comparison clears `name`. If `completeOn` differs, set
`sc["complete_on"] = "pickup.cd"` in the scene script.) If vitest refuses to
run a file outside `include`, temporarily copy it next to `level-json.test.ts`,
run it, and delete it. **Do not commit the round-trip test or `.lab-tmp`.**

- [ ] **Step 4: Commit**

```bash
git add scripts/levels/export_level.py docs/game/levels/blender-conventions.md
git commit -m "feat(level): Blender exporter for Level Format v1 + authoring conventions"
```

---

### Task 5: The Wake blockout (dispatchable, needs Blender)

**Files:**
- Create: `scripts/levels/build_the_wake_blockout.py`
- Create: `assets-source/levels/the-wake.blend` (generated)
- Create: `public/assets/levels/the-wake.level.json` (generated)
- Create: `src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts`

Layout follows [the Wake design](../../game/levels/00-the-wake/design.md) §4, in
**game space** (the player walks toward −z). After this task the owner edits
the `.blend` by hand; the script is only the first draft. v1 is one floor
height (the crypt is at grade).

| Room | id | x | z | Height | Holds |
| --- | --- | --- | --- | --- | --- |
| gates | 1 | −6…6 | −12…0 | 6.0 | start, gate posts, gatehouse, 2 zombies |
| graveyard | 2 | −14…14 | −44…−16 | 8.0 | open grave + shotgun, headstones, mausoleum, bell tower, 5 zombies, graves for waves 0–3 |
| crypt | 3 | −8…8 | −60…−48 | 2.8 | sarcophagi, 4 zombies, **the dynamite** |
| parlour | 4 | −9…9 | −84…−64 | 4.5 | pews, organ, coffin, CD, 6 mourners, the "turn" trigger, **the train window** |
| secret | 5 | 15…19 | −33…−28 | 2.5 | health, shells |

| Corridor | x | z | Height | Notes |
| --- | --- | --- | --- | --- |
| 1 → 2 (the lane) | −1…1 | −16…−12 | 3.2 | |
| 2 → 3 (crypt stairs) | −1.2…1.2 | −48…−44 | 2.6 | gate `crypt-slab`, opens on `bell.toll.1` |
| 3 → 4 | −1…1 | −64…−60 | 2.4 | |
| 2 → 5 (fence gap) | 14…15 | −31.4…−30.0 | 2.0 | 1.4 m: the minimum the navigation grid routes |

- [ ] **Step 1: Write the build script**

```python
# scripts/levels/build_the_wake_blockout.py
"""First-draft blockout of level 0, The Wake, as a .blend.

    blender --background --factory-startup \
        --python scripts/levels/build_the_wake_blockout.py -- assets-source/levels/the-wake.blend

Tables are GAME space (x, y, z), y up, player walks toward -z.
Blender gets (x, -z, y). Design: docs/game/levels/00-the-wake/design.md
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

S = []
S += [((-2.6, 0, -0.6), (-1.8, 3, -0.1)), ((1.8, 0, -0.6), (2.6, 3, -0.1)), ((3, 0, -9), (5.5, 3, -5))]
S += [((-1.1, 0, -20.4), (-0.8, 0.35, -18.0)), ((0.8, 0, -20.4), (1.1, 0.35, -18.0)),
      ((-0.5, 0, -20.8), (0.5, 1.0, -20.5))]
for cx, cz in [(-7, -20), (-4, -22.5), (5, -21), (9, -25), (-9, -27), (-2, -27), (3, -29),
               (-6, -32), (7, -32), (-11, -34), (2, -36), (10, -38), (-3, -40), (7, -43)]:
    S.append(((cx - 0.35, 0, cz - 0.1), (cx + 0.35, 0.9, cz + 0.1)))
S.append(((8, 0, -22), (12, 3.5, -18)))
S.append(((-12, 0, -43), (-8, 4, -39)))
for px, pz in [(-12, -43), (-8.3, -43), (-12, -39.3), (-8.3, -39.3)]:
    S.append(((px, 4, pz), (px + 0.3, 6.5, pz + 0.3)))
S.append(((-12.2, 6.5, -43.2), (-7.8, 6.9, -38.8)))
S += [((13.6, 0, -32.0), (14, 1.4, -31.4)), ((13.6, 0, -30.0), (14, 1.4, -29.4))]
S += [((-6, 0, -53), (-4, 0.8, -52)), ((4, 0, -55), (6, 0.8, -54)), ((-6, 0, -58), (-4, 0.8, -57))]
for z in (-69, -72, -75):
    S += [((-7.5, 0, z - 0.25), (-1.5, 0.9, z + 0.25)), ((1.5, 0, z - 0.25), (7.5, 0.9, z + 0.25))]
S += [((-1, 0, -81), (1, 0.9, -79)), ((5, 0, -84), (8.5, 2.5, -82))]
for i, (mn, mx) in enumerate(S):
    gbox("solids", f"solid.{i:03d}", mn, mx)

gbox("gates", "gate:bell.toll.1:crypt-slab", (-1.2, 0, -45), (1.2, 2.6, -44.4))
gbox("triggers", "trigger:wave.0:grave-rise", (-2, 0, -20.2), (2, 2, -17.6), wire=True)
gbox("triggers", "trigger:alert.room.4:parlour-turn", (-9, 0, -67.5), (9, 3, -65.5), wire=True)
# The glimpse (design §1): a tall window in the parlour's back (north) wall,
# looking out at the waiting train. v1 draws it as a placeholder plane.
gbox("windows", "window:train-waiting:parlour-window", (-2, 1.0, -84.05), (2, 3.8, -83.95))

glight("lamp.gates", (-4, 2.5, -6), (0.9, 0.55, 0.25), 10)
glight("moon.graveyard", (8, 2.5, -20), (0.35, 0.45, 0.9), 12)
glight("fire.belltower", (-10, 1.5, -37.5), (1.0, 0.4, 0.15), 10)
glight("glow.crypt", (0, 1.2, -54), (0.3, 0.9, 0.35), 7)
glight("candles.organ", (6, 1.3, -81), (1.0, 0.5, 0.2), 10)
glight("candles.door", (-6, 1.3, -66), (1.0, 0.5, 0.2), 8)
glight("red.secret", (17, 1.0, -30), (0.9, 0.2, 0.1), 6)

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
    gempty(f"spawn:zombie:{sid}", pos, 0.0)

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
    ("dynamite", "crypt-dynamite", (-6.5, 0.2, -49.5)),
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

argv = sys.argv
out = argv[argv.index("--") + 1] if "--" in argv else "assets-source/levels/the-wake.blend"
bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(out))
print(f"saved {out}")
```

- [ ] **Step 2: Build and export**

```bash
mkdir -p assets-source/levels public/assets/levels
blender --background --factory-startup --python scripts/levels/build_the_wake_blockout.py -- "$PWD/assets-source/levels/the-wake.blend"
blender --background "$PWD/assets-source/levels/the-wake.blend" --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json
```
Expected: `saved …`, then `exported the-wake: 5 rooms, 4 tunnels -> …`.

- [ ] **Step 3: Write the Wake test**

```ts
// src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts
//
// The committed Wake: it parses, the web engine can load it, every beat is
// reachable through the enemy navigation grid, and the crypt stays shut until
// its gate opens.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
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
    for (const item of ['cd', 'shotgun', 'dynamite'] as const) {
      expect(wake.pickups.filter(p => p.item === item), item).toHaveLength(1);
    }
    expect(roomAtPoint(wake, -6.5, -49.5)?.name).toBe('crypt');
    expect(wake.windows).toEqual([expect.objectContaining({ id: 'parlour-window', view: 'train-waiting', room: 4, side: 'n' })]);
    expect(wake.spawns).toHaveLength(17);
  });

  it('loads in the web engine (flat floor; windows only)', () => {
    expect(wake.requires).toEqual(['windows']);
    expect(missingCapabilities(wake, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('routes from the start to the CD with the gate open', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    const start: Vec3 = [wake.playerStart.x, 0, wake.playerStart.z];
    expect(nav.canStand(start)).toBe(true);
    expect(nav.route(start, [0, 0, -78.2]).length).toBeGreaterThan(0);
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

  it('keeps every spawn and grave standable', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    for (const m of [...wake.spawns, ...wake.graves]) expect(nav.canStand([m.pos[0], 0, m.pos[2]]), m.id).toBe(true);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npm test -- level-json.the-wake`
Expected: PASS, 6 tests (several seconds: the grid is ~17,000 cells). If a
spawn fails the standable test, move it in the **build script** table, rebuild,
re-export (Step 2), and rerun.

- [ ] **Step 5: Commit**

```bash
git add scripts/levels/build_the_wake_blockout.py assets-source/levels/the-wake.blend \
  public/assets/levels/the-wake.level.json src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts
git commit -m "feat(level): The Wake blockout — build script, .blend, v1 JSON, routing test"
```

---

### Task 6: Wire `ctx.world.level` into the game (session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-state-world.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `game-player-leaves.ts`, `game-lighting-leaves.ts`, `game-demo-leaves.ts`,
  `game-panels-leaves.ts`, `game-seams-world.ts`, `game-seams-weapon-player.ts`,
  `game-seams-spawn-goo.ts`, `game-world-leaves.ts`, `game-weapon-leaves.ts`
  (all in `src/lab/sdf-zombie/webgpu/`)

`main` moves fast: find each site by the quoted code, not by line number.
The ring must stay bit-identical when there is no `?level=`.

- [ ] **Step 1: Add the level to the world slice**

In `game-state-world.ts`: import `type ActiveLevel` from `./active-level`; add to
`WorldState`:

```ts
  /** The loaded level (the ring testbed, or ?level=<id>). Every reader of
   *  rooms, corridors, furniture, start, colliders and surfaces goes through it. */
  level: ActiveLevel;
  /** Gates opened so far (authored levels). */
  openGates: Set<string>;
```

In `makeWorldState()`: `level: unbuilt<ActiveLevel>(), openGates: new Set<string>(),`.
Run `npm test -- game-context`; if it requires a `WORLD_BINDINGS` entry for
every field, add `level: 'world.level', openGates: 'world.openGates'`.

- [ ] **Step 2: Load the level at boot**

In `game-main.ts`, replace `ctx.world.colliders = levelColliders();` with:

```ts
  // --- ACTIVE LEVEL (Level Format v1 — spec 2026-09-23). ?level=<id> loads
  // public/assets/levels/<id>.level.json (&state=<name> picks a state); no
  // param is the ring testbed, bit-identical to before.
  {
    const q = new URLSearchParams(location.search);
    const levelParam = q.get('level');
    if (levelParam) {
      const res = await fetch(`/assets/levels/${levelParam}.level.json`);
      if (!res.ok) throw new Error(`level ${levelParam}: HTTP ${res.status}`);
      const def = parseLevelJson(await res.json(), { state: q.get('state') ?? undefined });
      const missing = missingCapabilities(def, ENGINE_CAPABILITIES);
      if (missing.length > 0) throw new Error(`level ${def.id} needs engine support for: ${missing.join(', ')}`);
      ctx.world.level = authoredLevel(def);
    } else {
      ctx.world.level = ringLevel();
    }
  }
  ctx.world.colliders = [...ctx.world.level.staticColliders, ...ctx.world.level.gateColliders(ctx.world.openGates)];
```

Imports: `ENGINE_CAPABILITIES, authoredLevel, missingCapabilities, ringLevel` from
`./active-level`; `parseLevelJson` from `./level-json`. `main()` is already
`async`; the thrown error lands in `#errors` like any boot failure.

**`ctx.world.colliders` must stay the same array object** for the session
(movers hold the reference). Add, near it:

```ts
  function refreshGateColliders(): void {
    ctx.world.colliders.length = 0;
    ctx.world.colliders.push(...ctx.world.level.staticColliders, ...ctx.world.level.gateColliders(ctx.world.openGates));
  }
  function openGate(id: string): boolean {
    const def = ctx.world.level.def;
    if (!def || ctx.world.openGates.has(id) || !def.gates.some(g => g.id === id)) return false;
    ctx.world.openGates.add(id);
    refreshGateColliders();
    const mesh = gateMeshes.get(id);
    if (mesh) mesh.visible = false;
    return true;
  }
```

(If new `main()` functions are refused by `game-context-coverage`, put these
two on a small `level-runtime.ts` leaf taking `ctx`, following the existing
`game-*-leaves.ts` pattern.)

- [ ] **Step 3: Replace every read of the ring's globals**

Run from `src/lab/sdf-zombie/webgpu`:
`grep -n "ROOMS\b\|TUNNELS\b\|FURNITURE\b\|PLAYER_START\|levelColliders()\|levelSurfaces()\|enclosureKeyAt(\|enclosureOf(\|spawnPoints(" game-main.ts game-*-leaves.ts game-seams-*.ts`

| Old | New |
| --- | --- |
| `ROOMS` | `ctx.world.level.rooms` |
| `TUNNELS` | `ctx.world.level.tunnels` |
| `FURNITURE` | `ctx.world.level.furniture` |
| `PLAYER_START` | `ctx.world.level.playerStart` |
| `enclosureKeyAt(x, z)` | `ctx.world.level.keyAt(x, z)` |
| `enclosureOf(key)` | `ctx.world.level.enclosureFor(key)` |
| `levelSurfaces()` | `ctx.world.level.surfaces` |
| `createEncounterNavigation(ROOMS, TUNNELS, ctx.world.colliders)` | `createEncounterNavigation(ctx.world.level.rooms, ctx.world.level.tunnels, ctx.world.level.staticColliders)` (**static**: enemies route with gates open; spec §6.4) |
| `spawnAll`'s `for (const room of ROOMS) … spawnPoints(room) …` | `for (const s of ctx.world.level.spawnList()) actors.push(spawnEnemy(s.kind, s.room, s.pos, errs));` |

Leave `wanderBounds(room)` calls (they take a room). Remove now-unused imports
from `game-level`. `ctx.world.surfaces` keeps its type (the ring's
`{ planes, boxes }` shape); set it from `ctx.world.level.surfaces`.

- [ ] **Step 4: Render gates and windows**

After the loop that builds meshes from `ctx.world.surfaces.boxes`, build the
gate boxes the **same** way (extract the per-box body into a local
`addBoxMesh(spec): THREE.Mesh` if it's inline) and keep them in
`const gateMeshes = new Map<string, THREE.Object3D>()`. For windows, add one
unlit plane per `ctx.world.level.surfaces.windows` entry, built with the same
plane code path as walls but with a `MeshBasicNodeMaterial` of a flat colour
(v1 placeholder, spec §8: `train-waiting` a dim warm orange `#6a3a1a`; any
other view a dark blue `#101828`). Register both with the deferred router the
way the level's other meshes are registered.

For rooms with `sky` (none in the Wake), the surfaces already omit the ceiling;
nothing else is needed in v1.

- [ ] **Step 5: Boot room select**

`ctx.boot.room` is resolved from `ROOMS` by `?room=`; it now reads
`ctx.world.level.rooms`. The player start falls back to
`ctx.world.level.playerStart` (x, z, yaw).

- [ ] **Step 6: Seams**

In `game-seams-world.ts`:

```ts
    /** The active level: id, state, rooms, gate state, capabilities. */
    level: () => ({
      id: ctx.world.level.id,
      state: ctx.world.level.def?.state ?? null,
      rooms: ctx.world.level.rooms.map(r => r.name),
      colliders: ctx.world.colliders.length,
      openGates: [...ctx.world.openGates],
      requires: ctx.world.level.def?.requires ?? [],
      windows: ctx.world.level.surfaces.windows.map(w => w.id),
    }),
    openGate: (id: string) => openGate(id),
```

(`openGate` comes from wherever Step 2 put it.)

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm test -- level-def level-json active-level game-level game-context encounter`
Expected: clean, all pass.

Run the ring's existing gate: `LAB_TMP=.lab-tmp scripts/sdf-game-shorty-gate.sh`
Expected: PASS (the ring is unchanged).

**Boot time (gate):** measure cold-boot to `__warmGate.phase === 'ready'` for
`/sdf-game.html` on this branch and on the base branch, and for
`/sdf-game.html?level=the-wake`, each with a fresh profile. Record the three
numbers in the commit message. The ring must be within noise of base. The
Wake's big graveyard probe grid is the known risk; if it's much slower, note it
and continue (not a blocker).

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-state-world.ts src/lab/sdf-zombie/webgpu/game-main.ts \
  src/lab/sdf-zombie/webgpu/game-*-leaves.ts src/lab/sdf-zombie/webgpu/game-seams-*.ts
git commit -m "feat(level): ctx.world.level — ?level=<id> loads Level Format v1; ring unchanged (boot: ring X s / base Y s / wake Z s)"
```

---

### Task 7: Headless Wake gate (session)

**Files:**
- Create: `scripts/sdf-game-wake-gate.mjs`
- Create: `scripts/sdf-game-wake-gate.sh`

Plans 2 and 3 extend this gate; keep each check a named block.

- [ ] **Step 1: Write the driver**

```js
// scripts/sdf-game-wake-gate.mjs — headless gate for level 0, The Wake.
// No-deps CDP, same plumbing as scripts/sdf-game-shorty-gate.mjs.
//
//   1. BOOT: webgpu, warm gate ready, no console errors, level 'the-wake'.
//   2. LAYOUT: five rooms, start in 'gates', the parlour window exists.
//   3. GATE: the crypt slab blocks the player until opened, then lets them through.
//   4. CAPABILITY: the two-floors fixture is refused with a clear message.
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
let consoleEvents = [];
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
async function boot(query) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}` });
  for (let i = 0; i < 360; i++) {
    await sleep(500);
    const phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null);
    if (phase === 'ready') return true;
    const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
    if (errs.length) return false;
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });

// 1. BOOT
if (!(await boot('level=the-wake&frozen'))) { console.error(consoleEvents.slice(-8)); fail('the-wake did not boot to ready'); }
if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
const level = await evaluate('__sdfGame.level()');
if (level.id !== 'the-wake') fail(`level ${level.id}, expected the-wake`);
pass('boot: webgpu, warm gate ready, no errors, the-wake active');

// 2. LAYOUT
if (JSON.stringify(level.rooms) !== JSON.stringify(['gates', 'graveyard', 'crypt', 'parlour', 'secret'])) {
  fail(`rooms ${JSON.stringify(level.rooms)}`);
}
if ((await evaluate('__sdfGame.room()')) !== 'gates') fail('start room is not gates');
if (!level.windows.includes('parlour-window')) fail('parlour window missing');
pass('layout: five rooms, start in gates, parlour window present');

// 3. GATE — stand south of the slab, walk north, check z did not cross it.
async function walkNorthFrom(x, z, ms) {
  await evaluate(`__sdfGame.setPose(${x}, ${z}, 0, 0)`);
  await evaluate(`__sdfGame.walkTo(${x}, -47)`);
  await sleep(ms);
  await evaluate('__sdfGame.walkCancel()');
  return evaluate('__sdfGame.pose().pos[2]');
}
await evaluate('__sdfGame.freeze(true)');
const blockedZ = await walkNorthFrom(0, -42.5, 2500);
if (blockedZ < -44.4) fail(`walked through the closed crypt slab (z ${blockedZ})`);
if (!(await evaluate('__sdfGame.openGate("crypt-slab")'))) fail('openGate returned false');
const openZ = await walkNorthFrom(0, -42.5, 3500);
if (openZ > -45.5) fail(`gate open but the player stopped at z ${openZ}`);
pass(`gate: blocked at z ${blockedZ.toFixed(2)}, through to z ${openZ.toFixed(2)} once open`);

// 4. CAPABILITY — a level needing multi-floor is refused by name.
await boot('level=fixtures/two-floors');
const refused = consoleEvents.some((e) => /needs engine support for: multi-floor/.test(e.text))
  || /multi-floor/.test(await evaluate('document.getElementById("errors")?.textContent ?? ""'));
if (!refused) fail('two-floors fixture was not refused with a multi-floor message');
pass('capability: multi-floor level refused by name');

console.log('PASS sdf-game-wake-gate');
process.exit(0);
```

If `__sdfGame.freeze` isn't the right seam to stop enemies wandering into the
test lane, use whatever `game-seams-misc.ts` offers (`freeze` exists there as of
2026-09-23).

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
Expected: four `ok` lines and `PASS sdf-game-wake-gate`.

- [ ] **Step 4: Commit**

```bash
git add scripts/sdf-game-wake-gate.mjs scripts/sdf-game-wake-gate.sh
git commit -m "test(level): headless Wake gate — boot, layout, crypt slab, capability refusal"
```

---

### Risks

- **Probe cost on big rooms.** The graveyard is 28 × 28 × 8 m; its probe grid's
  boot and per-frame cost are unmeasured. Task 6 records boot time. Fallback: `?probes=0`.
- **`game-main.ts` churn.** `main` moves fast; Task 6 locates sites by code, and
  the ring gate is the regression check.
- **Multi-floor is format-only.** Levels can describe floors and stairs; the
  engine refuses them until production scope §4.7 lands. Night Train's roof
  route waits on that.
- **Gates vs. enemies.** Navigation is built with gates open, so an enemy can
  path into a closed gate and stand against it. Acceptable in the blockout.
