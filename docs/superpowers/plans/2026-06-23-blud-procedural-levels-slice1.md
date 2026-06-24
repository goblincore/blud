# Procedural Levels — Slice 1 (Generated Arena) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Blud's single hardcoded arena with one seeded, fully generated, single-floor multi-room map that every existing sim system (player clip, cultist LOS, pellets, dynamite/head bounce) runs on unchanged.

**Architecture:** A new firewall-safe module `src/sim/floorplan.ts` synthesizes a `Floorplan` from a seed (room-and-corridor on an integer grid, guaranteed-connected, guaranteed ≥1 large arena room) and bakes it to wall rectangles. Those rectangles feed BOTH the sim (`bakeSimGeometry → SimAABB[]`, fed to `SimRunner.geo`) and the cosmetic layer (`src/game/level/bake-cosmetic.ts` → Three meshes + Rapier colliders), making the `Floorplan` the single source of truth and killing the current hand-synced `buildArenaGeometry`/`arena.ts` duplication. Generation uses the sim's seeded RNG, so it is a pure function `seed → map` (determinism-ready).

**Tech Stack:** TypeScript, Vitest (sim unit tests, `src/sim/**`), Three.js + Rapier3D (cosmetic only, `src/game/**`). Spec: [docs/superpowers/specs/2026-06-23-blud-procedural-levels-design.md](../specs/2026-06-23-blud-procedural-levels-design.md).

**Determinism firewall (non-negotiable):** `src/sim/**` must NOT import `three`, Rapier, or `src/game/**`, and must NOT call `Math.random`, `Date.now`, or `performance.now`. `floorplan.ts` uses only `./fp`, `./rng`, `./geometry` types. The cosmetic baker lives in `src/game/**` and imports the plain-data `Floorplan` type from the sim (allowed — game depends on sim, never the reverse). A firewall test already enforces this; keep it green.

**Coordinate conventions (used throughout):**
- Grid cell `(cx, cz)`, `cx ∈ [0, gridW)`, `cz ∈ [0, gridH)`. `cellMeters = 2`, `gridW = gridH = 32` → a 64×64 m map.
- World mapping centers the map at the origin: `worldX = originX + (cx + 0.5)·cellMeters` where `originX = -(gridW·cellMeters)/2`; same for Z. This matches the existing arena being centered on `(0,0)`.
- Blood facing angle θ moves toward `(-sinθ, -cosθ)` (existing convention — see `src/main.ts:463`). To face from cell A toward cell B with delta `(dx, dz)` we need `(-sinθ,-cosθ) ∝ (dx,dz)`, i.e. `θ = atan2(-dx, -dz)`, mapped to `[0, 2048)`.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/sim/floorplan.ts` | Create | `Floorplan` type + constants; `generateFloorplan(seed)`; `bakeWallRectsMeters(fp)`; `bakeSimGeometry(fp)`; `cellToWorld(fp,cx,cz)`; `floorplanFingerprint(fp)`. Pure, firewall-safe. |
| `src/sim/floorplan.test.ts` | Create | Unit tests: room placement, connectivity flood-fill, arena guarantee, start/spawns, wall baking, fingerprint determinism. |
| `src/sim/runner.ts` | Modify | Own the floorplan; `geo` from the bake; expose `floorplan()`, `playerStartMeters()`, `spawnPointsMeters()`, `reroll(seed)`; player starts at the generated start cell facing the arena. |
| `src/sim/runner.test.ts` | Modify | Tests: runner exposes a non-empty geo + spawn points; reroll changes the map. |
| `src/sim/determinism.test.ts` | Modify | Add map-fingerprint determinism + "stepping is deterministic on a generated map". |
| `src/game/level/bake-cosmetic.ts` | Create | `bakeLevelCosmetic(fp, scene, world)` → meshes + Rapier wall colliders + floor + decal surfaces; returns a `{ rebuild, dispose }` controller. Replaces `buildArena`/`registerArenaSurfaces`. |
| `src/main.ts` | Modify | Create sim first; bake cosmetic from `sim.floorplan()`; spawn points + player start from the sim; dev reroll key `M`; drop `reset()` args. |

`src/sim/geometry.ts` keeps `buildArenaGeometry()` (still used by existing `geometry.test.ts`); the runner just stops calling it. Do not delete it.

---

## Task 1: Floorplan types, constants, and cell→world mapping

**Files:**
- Create: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/floorplan.test.ts
import { describe, it, expect } from 'vitest';
import { CELL_M, GRID_W, GRID_H, cellToWorld, type Floorplan } from './floorplan';

function emptyFloorplan(): Floorplan {
  return {
    seed: 0, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open: new Uint8Array(GRID_W * GRID_H), rooms: [], spawns: [],
    start: { cell: { cx: 0, cz: 0 }, angBlood: 0 }, arenaRoomId: 0,
  };
}

describe('cellToWorld', () => {
  it('centers the grid on the world origin', () => {
    const fp = emptyFloorplan();
    // The center-most cell boundary should straddle x=0. Cell (gridW/2) starts at x=0.
    const a = cellToWorld(fp, GRID_W / 2, GRID_H / 2);
    expect(a.x).toBeCloseTo(CELL_M / 2);
    expect(a.z).toBeCloseTo(CELL_M / 2);
  });

  it('maps cell 0 to the negative corner', () => {
    const fp = emptyFloorplan();
    const c = cellToWorld(fp, 0, 0);
    expect(c.x).toBeCloseTo(-(GRID_W * CELL_M) / 2 + CELL_M / 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: FAIL — cannot resolve `./floorplan` / exports not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sim/floorplan.ts
// Determinism firewall: plain data only — NO 'three', NO Rapier, NO src/game/**.
// Imports limited to sibling sim modules.
import { fpFromMeters } from './fp';
import type { SimAABB } from './geometry';

export const CELL_M = 2;    // meters per grid cell
export const GRID_W = 32;   // cells across (→ 64 m)
export const GRID_H = 32;   // cells deep   (→ 64 m)

export type RoomKind = 'arena' | 'room';

export interface Room {
  id: number;
  cx: number; cz: number;   // top-left cell (inclusive)
  w: number; h: number;     // size in cells
  kind: RoomKind;
}

export interface Cell { cx: number; cz: number; }

export interface SpawnPoint { cell: Cell; roomId: number; }

/** A generated single-floor map. Plain serializable data — no engine types.
 *  `open` is a gridW×gridH occupancy grid (1 = walkable floor, 0 = solid). */
export interface Floorplan {
  seed: number;
  gridW: number; gridH: number; cellMeters: number;
  open: Uint8Array;
  rooms: Room[];
  spawns: SpawnPoint[];
  start: { cell: Cell; angBlood: number };
  arenaRoomId: number;
}

/** World-space center of a grid cell, in meters. The grid is centered on the
 *  origin so the generated map drops into the existing (0,0)-centered world. */
export function cellToWorld(fp: Floorplan, cx: number, cz: number): { x: number; z: number } {
  const originX = -(fp.gridW * fp.cellMeters) / 2;
  const originZ = -(fp.gridH * fp.cellMeters) / 2;
  return { x: originX + (cx + 0.5) * fp.cellMeters, z: originZ + (cz + 0.5) * fp.cellMeters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): floorplan types + cell→world mapping (procgen levels slice 1)"
```

---

## Task 2: Generate rooms (arena guarantee + non-overlapping placement)

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
import { generateFloorplan } from './floorplan';

describe('generateFloorplan — rooms', () => {
  it('is a pure function of the seed (same seed → identical grid + rooms)', () => {
    const a = generateFloorplan(2026);
    const b = generateFloorplan(2026);
    expect(Array.from(a.open)).toEqual(Array.from(b.open));
    expect(a.rooms).toEqual(b.rooms);
  });

  it('always contains exactly one arena room as room 0', () => {
    for (const seed of [1, 2, 7, 42, 2026, 99999]) {
      const fp = generateFloorplan(seed);
      expect(fp.rooms.length).toBeGreaterThanOrEqual(2);
      expect(fp.rooms[0]!.kind).toBe('arena');
      expect(fp.arenaRoomId).toBe(0);
      const arena = fp.rooms[0]!;
      expect(arena.w).toBeGreaterThanOrEqual(9);
      expect(arena.h).toBeGreaterThanOrEqual(9);
    }
  });

  it('keeps a solid 1-cell border (no open cell on the grid edge)', () => {
    const fp = generateFloorplan(2026);
    const open = (cx: number, cz: number) => fp.open[cz * fp.gridW + cx] === 1;
    for (let i = 0; i < fp.gridW; i++) {
      expect(open(i, 0)).toBe(false);
      expect(open(i, fp.gridH - 1)).toBe(false);
      expect(open(0, i)).toBe(false);
      expect(open(fp.gridW - 1, i)).toBe(false);
    }
  });

  it('never overlaps two rooms (open-cell count == sum of room areas before corridors)', () => {
    // Rooms are placed with a margin; corridors are carved in Task 3, so at this
    // point the open-cell count equals the total room area exactly.
    const fp = generateFloorplan(2026);
    const totalArea = fp.rooms.reduce((n, r) => n + r.w * r.h, 0);
    const openCount = fp.open.reduce((n, v) => n + v, 0);
    expect(openCount).toBe(totalArea);
  });
});
```

> NOTE: the last test only holds before corridor carving exists. Task 3 replaces it with a connectivity test; that's expected and called out there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: FAIL — `generateFloorplan` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/sim/floorplan.ts`:

```ts
import { createRng, randomInt, type SimRng } from './rng';

const ROOM_ATTEMPTS = 14;
const ROOM_MIN = 3;            // cells
const ROOM_MAX = 7;
const ARENA_MIN = 9;
const ARENA_MAX = 13;

const cellIndex = (gridW: number, cx: number, cz: number) => cz * gridW + cx;

/** Inclusive cell range a room occupies: [cx, cx+w) × [cz, cz+h). */
function carveRoom(open: Uint8Array, gridW: number, r: Room): void {
  for (let z = r.cz; z < r.cz + r.h; z++)
    for (let x = r.cx; x < r.cx + r.w; x++) open[cellIndex(gridW, x, z)] = 1;
}

function placeRooms(rng: SimRng, open: Uint8Array): Room[] {
  const rooms: Room[] = [];
  const lo = 1, hiX = GRID_W - 1, hiZ = GRID_H - 1; // keep a solid border ring

  const fits = (cx: number, cz: number, w: number, h: number): boolean => {
    if (cx < lo || cz < lo || cx + w > hiX || cz + h > hiZ) return false;
    for (const r of rooms) {
      // reject with a 1-cell margin so rooms never touch (walls stay between them)
      if (cx - 1 < r.cx + r.w && cx + w + 1 > r.cx &&
          cz - 1 < r.cz + r.h && cz + h + 1 > r.cz) return false;
    }
    return true;
  };

  const tryPlace = (kind: RoomKind, min: number, max: number, attempts: number): boolean => {
    for (let t = 0; t < attempts; t++) {
      const w = min + randomInt(rng, max - min + 1);
      const h = min + randomInt(rng, max - min + 1);
      const cx = lo + randomInt(rng, Math.max(1, hiX - lo - w + 1));
      const cz = lo + randomInt(rng, Math.max(1, hiZ - lo - h + 1));
      if (fits(cx, cz, w, h)) {
        const r: Room = { id: rooms.length, cx, cz, w, h, kind };
        rooms.push(r); carveRoom(open, GRID_W, r);
        return true;
      }
    }
    return false;
  };

  // 1) the guaranteed large arena (placed first → best chance of fitting)
  if (!tryPlace('arena', ARENA_MIN, ARENA_MAX, 40)) {
    // Fallback: force a centered arena so the invariant "room 0 is the arena" holds.
    const w = ARENA_MIN, h = ARENA_MIN;
    const cx = (GRID_W - w) >> 1, cz = (GRID_H - h) >> 1;
    const r: Room = { id: 0, cx, cz, w, h, kind: 'arena' };
    rooms.push(r); carveRoom(open, GRID_W, r);
  }

  // 2) smaller rooms
  for (let a = 0; a < ROOM_ATTEMPTS; a++) tryPlace('room', ROOM_MIN, ROOM_MAX, 1);

  return rooms;
}

export function generateFloorplan(seed: number): Floorplan {
  // Mix the seed so the map RNG stream is independent of the sim-step RNG
  // (which is seeded with the same raw seed in createSimState).
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const open = new Uint8Array(GRID_W * GRID_H);
  const rooms = placeRooms(rng, open);

  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms, spawns: [],
    start: { cell: { cx: rooms[0]!.cx, cz: rooms[0]!.cz }, angBlood: 0 },
    arenaRoomId: 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS (room tests green).

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): floorplan room placement (arena guarantee + non-overlap)"
```

---

## Task 3: Carve corridors + guarantee connectivity

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the `'never overlaps two rooms ...'` test from Task 2 with a connectivity test (corridors now make open-count exceed room area):

```ts
// replace the open-count==area test with this in src/sim/floorplan.test.ts
describe('generateFloorplan — connectivity', () => {
  // Flood-fill the open grid from the player start; every room center must be reached.
  function reachableFromStart(fp: ReturnType<typeof generateFloorplan>): Set<number> {
    const seen = new Set<number>();
    const stack = [fp.start.cell.cx * 1 + 0, fp.start.cell.cz]; // placeholder
    const sx = fp.start.cell.cx, sz = fp.start.cell.cz;
    const key = (cx: number, cz: number) => cz * fp.gridW + cx;
    const open = (cx: number, cz: number) =>
      cx >= 0 && cz >= 0 && cx < fp.gridW && cz < fp.gridH && fp.open[key(cx, cz)] === 1;
    const work = [[sx, sz]];
    seen.add(key(sx, sz));
    while (work.length) {
      const [cx, cz] = work.pop()!;
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]] as const) {
        if (open(nx, nz) && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); work.push([nx, nz]); }
      }
    }
    void stack;
    return seen;
  }

  it('every room center is reachable from the player start', () => {
    for (const seed of [1, 2, 7, 42, 2026, 99999, 123456]) {
      const fp = generateFloorplan(seed);
      const seen = reachableFromStart(fp);
      for (const r of fp.rooms) {
        const ccx = r.cx + (r.w >> 1), ccz = r.cz + (r.h >> 1);
        expect(seen.has(ccz * fp.gridW + ccx)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: FAIL — disjoint rooms are unreachable (no corridors yet).

- [ ] **Step 3: Write minimal implementation**

Add corridor carving to `src/sim/floorplan.ts` and call it from `generateFloorplan` after `placeRooms`:

```ts
const EXTRA_LOOPS = 2;

function roomCenter(r: Room): Cell { return { cx: r.cx + (r.w >> 1), cz: r.cz + (r.h >> 1) }; }

/** Carve an L-shaped, 1-cell-wide corridor between two room centers. */
function carveCorridor(open: Uint8Array, gridW: number, a: Cell, b: Cell): void {
  let x = a.cx, z = a.cz;
  while (x !== b.cx) { open[cellIndex(gridW, x, z)] = 1; x += x < b.cx ? 1 : -1; }
  while (z !== b.cz) { open[cellIndex(gridW, x, z)] = 1; z += z < b.cz ? 1 : -1; }
  open[cellIndex(gridW, x, z)] = 1;
}

function connectRooms(rng: SimRng, open: Uint8Array, rooms: Room[]): void {
  if (rooms.length < 2) return;
  const centers = rooms.map(roomCenter);
  const dist2 = (a: number, b: number): number => {
    const dx = centers[a]!.cx - centers[b]!.cx, dz = centers[a]!.cz - centers[b]!.cz;
    return dx * dx + dz * dz;
  };
  // Prim-like MST from room 0 (the arena) → spanning tree guarantees reachability.
  const connected = new Set<number>([0]);
  while (connected.size < rooms.length) {
    let best = -1, from = -1, bestD = Infinity;
    for (const c of connected) {
      for (let r = 0; r < rooms.length; r++) {
        if (connected.has(r)) continue;
        const d = dist2(c, r);
        if (d < bestD) { bestD = d; best = r; from = c; }
      }
    }
    if (best < 0) break;
    carveCorridor(open, GRID_W, centers[from]!, centers[best]!);
    connected.add(best);
  }
  // A few extra loop edges for flanking (Blood maps are looped, not tree-like — spec §5.1).
  for (let e = 0; e < EXTRA_LOOPS && rooms.length > 2; e++) {
    const a = randomInt(rng, rooms.length);
    const b = randomInt(rng, rooms.length);
    if (a !== b) carveCorridor(open, GRID_W, centers[a]!, centers[b]!);
  }
}
```

Update `generateFloorplan` to call it and set the start to the arena center (refined in Task 4):

```ts
  const rooms = placeRooms(rng, open);
  connectRooms(rng, open, rooms);
  const ac = roomCenter(rooms[0]!);
  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms, spawns: [],
    start: { cell: { cx: ac.cx, cz: ac.cz }, angBlood: 0 },
    arenaRoomId: 0,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS — all room centers reachable for every seed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): floorplan corridors + guaranteed connectivity (MST + loops)"
```

---

## Task 4: Player start + enemy spawn points

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
describe('generateFloorplan — start + spawns', () => {
  it('starts the player in a room far from the arena, facing toward it', () => {
    const fp = generateFloorplan(2026);
    // start cell is walkable
    expect(fp.open[fp.start.cell.cz * fp.gridW + fp.start.cell.cx]).toBe(1);
    // facing vector (-sinθ,-cosθ) should point roughly toward the arena center
    const theta = (fp.start.angBlood / 2048) * Math.PI * 2;
    const fx = -Math.sin(theta), fz = -Math.cos(theta);
    const arena = fp.rooms[0]!;
    const dx = (arena.cx + (arena.w >> 1)) - fp.start.cell.cx;
    const dz = (arena.cz + (arena.h >> 1)) - fp.start.cell.cz;
    expect(fx * dx + fz * dz).toBeGreaterThan(0); // dot product positive → faces arena
  });

  it('emits spawn points (weighted toward the arena), none on the start cell', () => {
    const fp = generateFloorplan(2026);
    expect(fp.spawns.length).toBeGreaterThan(0);
    const arenaSpawns = fp.spawns.filter(s => s.roomId === fp.arenaRoomId).length;
    expect(arenaSpawns).toBeGreaterThanOrEqual(3); // arena is the main fight space
    for (const s of fp.spawns) {
      expect(fp.open[s.cell.cz * fp.gridW + s.cell.cx]).toBe(1); // walkable
      expect(s.cell.cx === fp.start.cell.cx && s.cell.cz === fp.start.cell.cz).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: FAIL — `spawns` is empty and `start.angBlood` is 0.

- [ ] **Step 3: Write minimal implementation**

Add to `src/sim/floorplan.ts`:

```ts
const ARENA_SPAWNS = 5;
const ROOM_SPAWNS_MAX = 3; // 0..2

/** Blood facing angle (0..2047) that points from cell A toward cell B. */
function bloodAngleToward(from: Cell, to: Cell): number {
  const dx = to.cx - from.cx, dz = to.cz - from.cz;
  const theta = Math.atan2(-dx, -dz); // facing (-sinθ,-cosθ) ∝ (dx,dz)
  return Math.round((((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 2048 / (Math.PI * 2)) % 2048;
}

function chooseStart(rooms: Room[]): { cell: Cell; angBlood: number; roomId: number } {
  const ac = roomCenter(rooms[0]!);
  let startRoom = 0, far = -1;
  for (let r = 1; r < rooms.length; r++) {
    const c = roomCenter(rooms[r]!);
    const d = (c.cx - ac.cx) ** 2 + (c.cz - ac.cz) ** 2;
    if (d > far) { far = d; startRoom = r; }
  }
  const sc = roomCenter(rooms[startRoom]!);
  return { cell: sc, angBlood: bloodAngleToward(sc, ac), roomId: startRoom };
}

function placeSpawns(rng: SimRng, rooms: Room[], startRoomId: number): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (const r of rooms) {
    if (r.id === startRoomId) continue; // keep the player's start room clear
    const n = r.kind === 'arena' ? ARENA_SPAWNS : randomInt(rng, ROOM_SPAWNS_MAX);
    for (let i = 0; i < n; i++) {
      const cx = r.cx + 1 + randomInt(rng, Math.max(1, r.w - 2));
      const cz = r.cz + 1 + randomInt(rng, Math.max(1, r.h - 2));
      spawns.push({ cell: { cx, cz }, roomId: r.id });
    }
  }
  return spawns;
}
```

Update `generateFloorplan`'s return block:

```ts
  const rooms = placeRooms(rng, open);
  connectRooms(rng, open, rooms);
  const start = chooseStart(rooms);
  const spawns = placeSpawns(rng, rooms, start.roomId);
  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms, spawns,
    start: { cell: start.cell, angBlood: start.angBlood },
    arenaRoomId: 0,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): floorplan player start + weighted enemy spawn points"
```

---

## Task 5: Bake wall rectangles → SimAABB[] (with greedy horizontal merge)

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
import { bakeWallRectsMeters, bakeSimGeometry } from './floorplan';
import { losClear } from './geometry';
import { fpFromMeters } from './fp';

describe('bakeSimGeometry — walls', () => {
  it('produces SimAABBs and a smaller, non-empty merged set', () => {
    const fp = generateFloorplan(2026);
    const geo = bakeSimGeometry(fp);
    expect(geo.length).toBeGreaterThan(0);
    // merge must beat the naive 1-box-per-wall-cell count
    let wallCells = 0;
    const open = (cx: number, cz: number) =>
      cx >= 0 && cz >= 0 && cx < fp.gridW && cz < fp.gridH && fp.open[cz * fp.gridW + cx] === 1;
    for (let cz = 0; cz < fp.gridH; cz++)
      for (let cx = 0; cx < fp.gridW; cx++)
        if (fp.open[cz * fp.gridW + cx] === 0 &&
            (open(cx - 1, cz) || open(cx + 1, cz) || open(cx, cz - 1) || open(cx, cz + 1))) wallCells++;
    expect(geo.length).toBeLessThan(wallCells);
  });

  it('every wall rect sits on a solid cell, never inside an open cell', () => {
    const fp = generateFloorplan(2026);
    for (const r of bakeWallRectsMeters(fp)) {
      // sample the rect center, convert back to a cell, assert it is solid
      const cx = Math.floor((r.minX + (fp.gridW * fp.cellMeters) / 2) / fp.cellMeters);
      const cz = Math.floor((r.minZ + (fp.gridH * fp.cellMeters) / 2) / fp.cellMeters);
      expect(fp.open[cz * fp.gridW + cx]).toBe(0);
    }
  });

  it('walls block line-of-sight from a room out through the solid border', () => {
    const fp = generateFloorplan(2026);
    const geo = bakeSimGeometry(fp);
    const s = fp.start.cell;
    const y = fpFromMeters(1.2);
    // from the start cell straight out past the grid edge → must cross a wall
    const half = (fp.gridW * fp.cellMeters) / 2;
    const sxWorld = -half + (s.cx + 0.5) * fp.cellMeters;
    const szWorld = -half + (s.cz + 0.5) * fp.cellMeters;
    expect(
      losClear(fpFromMeters(sxWorld), y, fpFromMeters(szWorld),
               fpFromMeters(sxWorld), y, fpFromMeters(-half - 10), geo),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: FAIL — `bakeWallRectsMeters` / `bakeSimGeometry` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/sim/floorplan.ts`:

```ts
/** Axis-aligned rectangle in world meters (XZ footprint). */
export interface MeterRect { minX: number; maxX: number; minZ: number; maxZ: number; }

/** Bake the occupancy grid into merged wall rectangles (world meters). A solid
 *  cell is a wall iff it borders an open cell (4-neighbourhood); consecutive
 *  wall cells in a row are fused into one rect (greedy horizontal merge) to keep
 *  the AABB count low (clip + LOS iterate this set every tic). */
export function bakeWallRectsMeters(fp: Floorplan): MeterRect[] {
  const { open, gridW, gridH, cellMeters } = fp;
  const originX = -(gridW * cellMeters) / 2;
  const originZ = -(gridH * cellMeters) / 2;
  const isOpen = (cx: number, cz: number) =>
    cx >= 0 && cz >= 0 && cx < gridW && cz < gridH && open[cz * gridW + cx] === 1;
  const isWall = (cx: number, cz: number) =>
    open[cz * gridW + cx] === 0 &&
    (isOpen(cx - 1, cz) || isOpen(cx + 1, cz) || isOpen(cx, cz - 1) || isOpen(cx, cz + 1));

  const rects: MeterRect[] = [];
  for (let cz = 0; cz < gridH; cz++) {
    let run = -1;
    for (let cx = 0; cx <= gridW; cx++) {
      const wall = cx < gridW && isWall(cx, cz);
      if (wall && run < 0) run = cx;
      else if (!wall && run >= 0) {
        rects.push({
          minX: originX + run * cellMeters,
          maxX: originX + cx * cellMeters,
          minZ: originZ + cz * cellMeters,
          maxZ: originZ + (cz + 1) * cellMeters,
        });
        run = -1;
      }
    }
  }
  return rects;
}

/** Sim collision geometry (fp units) — the array fed to stepSim/clipMoveXZ/losClear. */
export function bakeSimGeometry(fp: Floorplan): SimAABB[] {
  return bakeWallRectsMeters(fp).map((r) => ({
    minX: fpFromMeters(r.minX), maxX: fpFromMeters(r.maxX),
    minZ: fpFromMeters(r.minZ), maxZ: fpFromMeters(r.maxZ),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): bake floorplan to merged wall AABBs (sim + meter rects)"
```

---

## Task 6: Floorplan fingerprint (determinism hook)

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
import { floorplanFingerprint } from './floorplan';

describe('floorplanFingerprint', () => {
  it('is identical for the same seed', () => {
    expect(floorplanFingerprint(generateFloorplan(2026)))
      .toBe(floorplanFingerprint(generateFloorplan(2026)));
  });
  it('differs across seeds', () => {
    expect(floorplanFingerprint(generateFloorplan(1)))
      .not.toBe(floorplanFingerprint(generateFloorplan(2)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: FAIL — `floorplanFingerprint` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/sim/floorplan.ts`:

```ts
/** FNV-1a hash over the occupancy grid + room rects — a stable map fingerprint
 *  for the determinism harness (same seed → same number on every client). */
export function floorplanFingerprint(fp: Floorplan): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; };
  for (let i = 0; i < fp.open.length; i++) mix(fp.open[i]!);
  for (const r of fp.rooms) { mix(r.cx); mix(r.cz); mix(r.w); mix(r.h); mix(r.kind === 'arena' ? 1 : 0); }
  return h >>> 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): floorplan fingerprint for determinism harness"
```

---

## Task 7: SimRunner consumes the floorplan

**Files:**
- Modify: `src/sim/runner.ts`
- Test: `src/sim/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/runner.test.ts
import { describe, it, expect } from 'vitest';
import { SimRunner } from './runner';

describe('SimRunner — generated level', () => {
  it('exposes a floorplan, a non-empty geometry, and spawn points', () => {
    const sim = new SimRunner(0xb1d);
    expect(sim.floorplan().rooms[0]!.kind).toBe('arena');
    expect(sim.spawnPointsMeters().length).toBeGreaterThan(0);
    const start = sim.playerStartMeters();
    expect(Number.isFinite(start.x)).toBe(true);
    expect(Number.isFinite(start.z)).toBe(true);
  });

  it('places the player at the generated start (not the origin)', () => {
    const sim = new SimRunner(0xb1d);
    const r = sim.playerRender();
    const start = sim.playerStartMeters();
    expect(r.xMeters).toBeCloseTo(start.x, 2);
    expect(r.zMeters).toBeCloseTo(start.z, 2);
  });

  it('reroll changes the map fingerprint', () => {
    const sim = new SimRunner(1);
    const before = sim.floorplan();
    sim.reroll(2);
    expect(sim.floorplan().seed).toBe(2);
    expect(sim.floorplan()).not.toBe(before);
  });
});
```

> NOTE: `PlayerRender` fields are `xMeters`/`zMeters`/`eyeYMeters`/`yawRad`/`pitchRad` (verified in `src/sim/render.ts:11`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/runner.test.ts`
Expected: FAIL — `SimRunner` constructor still requires 3 args; `floorplan`/`spawnPointsMeters`/`playerStartMeters`/`reroll` don't exist.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/runner.ts`:

1. Replace the geometry import + field. Change:

```ts
import { buildArenaGeometry } from './geometry';
```
to:
```ts
import { generateFloorplan, bakeSimGeometry, cellToWorld, type Floorplan } from './floorplan';
import type { SimAABB } from './geometry';
```

2. Replace the `private geo = buildArenaGeometry();` field with floorplan-owned state and rewrite the constructor + reset:

```ts
  private fp: Floorplan;
  private geo: SimAABB[];

  constructor(seed: number) {
    this.fp = generateFloorplan(seed);
    this.geo = bakeSimGeometry(this.fp);
    this.state = createSimState(seed);
    this.applyStart();
    this.prev = cloneSimState(this.state);
  }

  /** Place the sim player at the floorplan's start cell. (Facing is driven by
   *  main.ts's aimYaw accumulator — stepPlayer overwrites player.yaw from input
   *  every tic — so main.ts seeds aimYaw from playerStartMeters().angBlood; we
   *  set player.yaw here too so the very first pre-input render frame faces right.) */
  private applyStart(): void {
    const s = cellToWorld(this.fp, this.fp.start.cell.cx, this.fp.start.cell.cz);
    this.state.player.x = fpFromMeters(s.x);
    this.state.player.z = fpFromMeters(s.z);
    this.state.player.yaw = this.fp.start.angBlood;
  }

  /** Reset to the current floorplan's start (e.g. on death/restart). */
  reset(): void {
    this.state = createSimState(this.fp.seed);
    this.applyStart();
    this.prev = cloneSimState(this.state);
    this.accumulator = 0;
    this.events = [];
  }

  /** Regenerate the whole map from a new seed and reset to its start. */
  reroll(seed: number): void {
    this.fp = generateFloorplan(seed);
    this.geo = bakeSimGeometry(this.fp);
    this.reset();
  }

  /** The generated map (read-only) — the cosmetic baker derives meshes from it. */
  floorplan(): Floorplan { return this.fp; }

  /** Player start in world meters + Blood facing angle. */
  playerStartMeters(): { x: number; z: number; angBlood: number } {
    const s = cellToWorld(this.fp, this.fp.start.cell.cx, this.fp.start.cell.cz);
    return { x: s.x, z: s.z, angBlood: this.fp.start.angBlood };
  }

  /** Enemy spawn points in world meters. */
  spawnPointsMeters(): { x: number; z: number }[] {
    return this.fp.spawns.map((sp) => cellToWorld(this.fp, sp.cell.cx, sp.cell.cz));
  }
```

(Keep all existing methods — `advance`, `spawnDude`, `dudeRenders`, etc. — unchanged; they already use `this.geo`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/runner.test.ts`
Expected: PASS. Then `npx vitest run src/sim` to confirm no sibling sim test regressed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/runner.ts src/sim/runner.test.ts
git commit -m "feat(sim): SimRunner owns the generated floorplan + reroll"
```

---

## Task 8: Determinism harness — map fingerprint + generated-geo stepping

**Files:**
- Modify: `src/sim/determinism.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/sim/determinism.test.ts` (keep the existing `GEO = buildArenaGeometry()` tests as-is):

```ts
import { generateFloorplan, bakeSimGeometry, floorplanFingerprint } from './floorplan';

describe('determinism — generated map', () => {
  it('same seed → identical map fingerprint', () => {
    expect(floorplanFingerprint(generateFloorplan(2026)))
      .toBe(floorplanFingerprint(generateFloorplan(2026)));
  });

  it('stepping is deterministic on a generated map (two states hash-match every tic)', () => {
    const geo = bakeSimGeometry(generateFloorplan(2026));
    const inputs = recordedInputs(200);
    const a = seededState(2026);
    const b = seededState(2026);
    for (let t = 0; t < inputs.length; t++) {
      stepSim(a, inputs[t]!, geo);
      stepSim(b, inputs[t]!, geo);
      expect(hashSimState(a)).toBe(hashSimState(b));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/determinism.test.ts`
Expected: FAIL initially only if imports are missing; once added it should PASS. (If it passes immediately, that's fine — this task is a guard test, not a red-then-green feature. Confirm it runs.)

- [ ] **Step 3: (no implementation needed)**

The feature already exists (Tasks 1–6). This task only adds harness coverage. If the "stepping deterministic on generated geo" test fails, that's a real determinism bug — investigate with superpowers:systematic-debugging before proceeding.

- [ ] **Step 4: Run the full sim suite**

Run: `npx vitest run src/sim`
Expected: PASS (all sim tests, including the new harness coverage).

- [ ] **Step 5: Commit**

```bash
git add src/sim/determinism.test.ts
git commit -m "test(sim): determinism harness covers generated-map fingerprint + stepping"
```

---

## Task 9: Cosmetic baker — meshes + Rapier colliders from the floorplan

**Files:**
- Create: `src/game/level/bake-cosmetic.ts`

- [ ] **Step 1: Write the baker (no unit test — Three/Rapier need a browser; verified in Task 10 playtest)**

This module is the cosmetic twin of `bakeSimGeometry`: it consumes the SAME `bakeWallRectsMeters(fp)` so visuals exactly match collision. It replaces `buildArena` + `registerArenaSurfaces` in `src/game/arena.ts` (leave those functions in place for now; main.ts stops calling them in Task 10).

```ts
// src/game/level/bake-cosmetic.ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { bakeWallRectsMeters, type Floorplan } from '../../sim/floorplan';
import type { StaticSurface } from '../gibs/particles';
import { setArenaSurfaces } from '../gibs/particles';
import { loadTexture } from '../../engine/asset-loader';

const WALL_HEIGHT = 4;
const TEX_METERS_PER_REPEAT = 2;

/** A built level's cosmetic resources — disposable + rebuildable on reroll. */
export interface LevelCosmetic {
  group: THREE.Group;
  rebuild(fp: Floorplan): void;
  dispose(): void;
}

export function bakeLevelCosmetic(
  fp: Floorplan, scene: THREE.Scene, world: RAPIER.World,
): LevelCosmetic {
  const group = new THREE.Group();
  scene.add(group);
  let colliders: RAPIER.Collider[] = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a3a36 });
  loadTexture('/assets/arena-placeholder/449.png').then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const ft = t.clone(); ft.needsUpdate = true;
    ft.repeat.set(fp.gridW * fp.cellMeters / TEX_METERS_PER_REPEAT, fp.gridH * fp.cellMeters / TEX_METERS_PER_REPEAT);
    floorMat.map = ft; floorMat.color.set(0xffffff); floorMat.needsUpdate = true;
  }).catch(() => { /* keep solid color */ });
  loadTexture('/assets/arena-placeholder/458.png').then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    wallMat.map = t; wallMat.color.set(0xffffff); wallMat.needsUpdate = true;
  }).catch(() => { /* keep solid color */ });

  function build(plan: Floorplan): void {
    const w = plan.gridW * plan.cellMeters;
    const d = plan.gridH * plan.cellMeters;

    // floor: one slab over the whole footprint (solid areas are hidden by walls)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), floorMat);
    floor.position.y = -0.25;
    group.add(floor);
    colliders.push(world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, 0.25, d / 2).setTranslation(0, -0.25, 0),
    ));

    // walls: one mesh + one collider per merged wall rect (visuals == sim collision)
    const surfaces: StaticSurface[] = [{
      min: { x: -w / 2, y: -0.5, z: -d / 2 }, max: { x: w / 2, y: 0, z: d / 2 },
      normal: { x: 0, y: 1, z: 0 }, // floor decals
    }];
    for (const r of bakeWallRectsMeters(plan)) {
      const sx = r.maxX - r.minX, sz = r.maxZ - r.minZ;
      const px = (r.minX + r.maxX) / 2, pz = (r.minZ + r.maxZ) / 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), wallMat);
      m.position.set(px, WALL_HEIGHT / 2, pz);
      group.add(m);
      colliders.push(world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, WALL_HEIGHT / 2, sz / 2).setTranslation(px, WALL_HEIGHT / 2, pz),
      ));
    }
    setArenaSurfaces(surfaces);
  }

  function teardown(): void {
    for (const c of colliders) world.removeCollider(c, false);
    colliders = [];
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
  }

  build(fp);

  return {
    group,
    rebuild(next: Floorplan): void { teardown(); build(next); },
    dispose(): void { teardown(); scene.remove(group); },
  };
}
```

> NOTE: confirm `world.removeCollider(collider, false)` is the correct Rapier API in this project's `@dimforge/rapier3d-compat` version (grep existing collider removals). If the project never removes colliders, check the Rapier docs version pinned in `package.json` and adjust. Floor + wall decal surfaces beyond the floor are deferred (spec §8 theming).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors in the new module).

- [ ] **Step 3: Commit**

```bash
git add src/game/level/bake-cosmetic.ts
git commit -m "feat(level): cosmetic baker — meshes + colliders from floorplan"
```

---

## Task 10: Wire main.ts to the generated level + dev reroll key

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Reorder init — create the sim before baking cosmetic**

In `src/main.ts`, remove the early arena build (currently `src/main.ts:152-153`):

```ts
  // DELETE these two lines:
  buildArena(scene, physics.world);
  registerArenaSurfaces();
```

Change the sim construction (currently `src/main.ts:163`) to drop the spawn args and bake the cosmetic level from its floorplan immediately after:

```ts
  const sim = new SimRunner(0xb1d);
  const level = bakeLevelCosmetic(sim.floorplan(), scene, physics.world);
```

Add the import near the other game imports:

```ts
import { bakeLevelCosmetic } from './game/level/bake-cosmetic';
```

Remove `buildArena` / `registerArenaSurfaces` from the `./game/arena` import (keep the rest: `installSkybox`, `ZombieCluster`, `GameOverOverlay`).

- [ ] **Step 2: Spawn enemies at generated spawn points**

Replace the `pickSpawnPos` body in the wave runner (currently `src/main.ts:478-487`) so spawns come from the floorplan instead of 4 hardcoded perimeter points:

```ts
    pickSpawnPos: () => {
      const pts = sim.spawnPointsMeters();
      if (pts.length === 0) return { x: 0, y: 1, z: 0 };
      const p = pts[Math.floor(Math.random() * pts.length)]!;
      return { x: p.x, y: 1, z: p.z };
    },
```

- [ ] **Step 3: Seed the camera facing from the generated start**

main.ts owns the `aimYaw` accumulator that actually drives camera/player facing (`stepPlayer` overwrites `player.yaw` from input every tic, so the sim's start yaw alone won't hold). Find `let aimYaw = 0;` (currently `src/main.ts:171`) and seed it from the floorplan start right after `sim` + `level` are created:

```ts
  // Face the player toward the arena at spawn (the floorplan start angle).
  aimYaw = sim.playerStartMeters().angBlood;
```

(Place this assignment after the `let aimYaw = 0;` / `let aimPitch = 0;` declarations so it overrides the initial 0. `aimYaw` is already in Blood-angle units, same as `angBlood`.)

- [ ] **Step 4: Fix the `reset()` call site (now zero-arg)**

`SimRunner.reset` no longer takes spawn coordinates. There is exactly one call site (`src/main.ts:342`): change `sim.reset(0, 0);` to `sim.reset();`. Restart keeps the SAME map (deterministic) — the level meshes are unchanged, so no cosmetic rebuild is needed here.

Run: `grep -n "sim.reset(" src/main.ts` (confirm only the one site).

- [ ] **Step 5: Add the dev reroll key `m`**

The keydown handlers in main.ts use `e.key` (e.g. `e.key === '1'`, `e.key === 'F9'`). Add an `m` case to the debug handler (grep for the god-mode `g` / spawn `t` cases to find the right one) that rerolls the map, rebuilds cosmetic, clears enemies, and re-seeds the facing:

Run: `grep -n "e.key === 'g'\|e.key === 't'\|addEventListener('keydown'" src/main.ts`

In that handler add:

```ts
      if (e.key === 'm') {
        const seed = Math.floor(Math.random() * 0x7fffffff) >>> 0;
        sim.reroll(seed);
        level.rebuild(sim.floorplan());
        sim.clearDudes();
        aimYaw = sim.playerStartMeters().angBlood;
        console.info('[blud] rerolled map, seed', seed);
      }
```

> NOTE: `Math.random` here is fine — this is a client-side dev aid OUTSIDE the sim (like the existing god-mode toggle), not sim logic. Confirm `g`/`t`/`r` aren't already bound to `m`'s neighbours in a conflicting handler.

- [ ] **Step 6: Type-check + build + run the sim suite + firewall grep**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run src/sim`
Expected: PASS (all sim tests).

Run: `npm run build`
Expected: PASS (vite build green).

Firewall check (there is no automated firewall test — this is the manual grep the project uses). The new `src/sim/floorplan.ts` must import nothing from Three/Rapier/game:
Run: `grep -rnE "from '(three|@dimforge|\.\./game|\.\./\.\./game)" src/sim/`
Expected: NO output (empty) — `src/sim/**` stays engine-free.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(level): drive main.ts from the generated floorplan + dev reroll (M)"
```

- [ ] **Step 8: Manual playtest gate (the real success criterion)**

Symlink worktree assets if needed (see project memory), then:

Run: `npm run dev`

In the browser, verify against spec §2:
1. The level loads as a multi-room map (not the old 40×40 box); the player spawns inside a room, facing toward a large open arena.
2. Walk the whole map — every room is reachable; you can't walk through walls; you can't escape the outer border.
3. There is at least one clearly large arena space.
4. Press **T** (or wave spawn) — cultists appear at generated spawn points, chase you through the generated corridors, lose LOS behind walls and search, and their pellets/your dynamite collide with the generated walls.
5. Press **M** repeatedly — each reroll produces a visibly different, fully walkable map; enemies clear; no crash; no geometry falls out of world.

If anything fails, debug with superpowers:systematic-debugging before declaring done. Then update `TASKS.md` (mark the slice landed) and commit.

---

## Self-Review

**1. Spec coverage:**
- §3 pipeline `seed → Floorplan → SimAABB[] + cosmetic + spawns` → Tasks 1–6 (floorplan + sim bake), 9 (cosmetic), 4 (spawns). ✓
- §4 `Floorplan` data model → Task 1 (types) + Tasks 2–5 populate it. ✓ (Used an occupancy grid + `rooms[]` rather than explicit `links[]`; corridors are carved into the grid and connectivity is asserted by flood-fill — a faithful concretization, noted in the plan.)
- §5 room-and-corridor synthesis, guaranteed connectivity, ≥1 large arena → Tasks 2–3. ✓
- §5.1 tuning (looped via MST + extra loops; arena guarantee; spawns weighted to arena) → Tasks 3–4. ✓ (Connectivity ratios/density are starting constants; feel-tuned in playtest.)
- §6 bake to SimAABB[] (single source) + cosmetic meshes/colliders/decal surfaces → Tasks 5, 9. ✓
- §7 determinism: geo reconstructed from seed, map fingerprint in harness, generation uses seeded RNG (separate stream) → Tasks 6, 8; mixed seed in Task 2. ✓
- §8 scope: reroll key (Task 10), `buildArenaGeometry` replaced in runner (Task 7), duplication killed (cosmetic derives from floorplan, Task 9). ✓ Deferred items (templates, run structure, themes, verticality) correctly NOT in any task.
- §10 verification: unit (Tasks 1–6), determinism harness (Task 8), integration tsc/vitest/build/firewall (Task 10 step 5), playtest (Task 10 step 7). ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". The three `NOTE:` callouts point to real verification actions (render field names, Rapier removeCollider API, keydown style) the engineer must confirm against the codebase — each names exactly what to check. Acceptable.

**3. Type consistency:** `Floorplan`, `Room`, `Cell`, `SpawnPoint`, `MeterRect` defined in Task 1/5 and used consistently. `bakeWallRectsMeters` / `bakeSimGeometry` / `cellToWorld` / `floorplanFingerprint` / `generateFloorplan` names match across tasks and the file-structure table. `SimRunner` API (`floorplan()`, `playerStartMeters()`, `spawnPointsMeters()`, `reroll(seed)`, `reset()`) consistent between Task 7 and Task 10. Constructor changed `(seed, x, z)` → `(seed)` everywhere it's called (Task 10 step 1). `bakeLevelCosmetic` / `LevelCosmetic.{rebuild,dispose}` consistent between Tasks 9 and 10.
