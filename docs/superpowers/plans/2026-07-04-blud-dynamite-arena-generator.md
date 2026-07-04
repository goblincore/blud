# Dynamite-First Arena Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Greenfield arena generator (`src/sim/arenagen/`) that produces dynamite-graded layouts — ring zoning, pocket clusters, guaranteed backpedal lane — behind the existing `Floorplan` contract.

**Architecture:** generate → grade → retry (8 attempts, best-candidate fallback), all inside the sim determinism firewall (plain data, no `three`/Rapier). `ArenaPlan` is a structural superset of `Floorplan`, so `src/sim/runner.ts` swaps generators without an adapter layer. Themes affect cosmetics only (props/materials), never geometry.

**Tech Stack:** TypeScript, vitest, existing sim modules (`src/sim/rng.ts` mulberry32 `SimRng`, `src/sim/floorplan.ts` grid conventions: 28×28 cells, 2 m/cell, origin-centered, border ring solid).

**Spec:** `docs/superpowers/specs/2026-07-04-blud-dynamite-arena-generator-design.md`

**Conventions for every task:**
- Determinism firewall: files under `src/sim/**` import ONLY sibling sim modules. No `three`, no Rapier, no `src/game/**`, no I/O.
- Test runner: `npx vitest run <file>` (matches `src/sim/floorplan.test.ts` style: `describe`/`it`/`expect`, seed sweeps).
- Known v1 caveat (accepted in spec migration step 1): cover cells are solid in `open`, so sim LOS treats low cover as full-height until the mixed-height-cover work merges. `grade.ts` does its own height-aware sightline scoring.

---

### Task 1: Types + ring zoning (`types.ts`, `rings.ts`)

**Files:**
- Create: `src/sim/arenagen/types.ts`
- Create: `src/sim/arenagen/rings.ts`
- Test: `src/sim/arenagen/rings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/arenagen/rings.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { ringOf, cellsInRing, CENTER_MAX, MID_MAX } from './rings';

describe('ringOf', () => {
  it('classifies border cells as wall', () => {
    expect(ringOf(0, 5)).toBe('wall');
    expect(ringOf(GRID_W - 1, 5)).toBe('wall');
    expect(ringOf(5, 0)).toBe('wall');
    expect(ringOf(5, GRID_H - 1)).toBe('wall');
  });

  it('classifies the exact grid middle as center', () => {
    expect(ringOf(GRID_W >> 1, GRID_H >> 1)).toBe('center');
  });

  it('classifies cells just inside the wall as perimeter (backpedal lane)', () => {
    expect(ringOf(1, GRID_H >> 1)).toBe('perimeter');
    expect(ringOf(2, GRID_H >> 1)).toBe('perimeter');
  });

  it('gives a perimeter lane at least 2 cells (4 m) wide on every side', () => {
    const mid = GRID_H >> 1;
    let width = 0;
    for (let cx = 1; ringOf(cx, mid) === 'perimeter'; cx++) width++;
    expect(width).toBeGreaterThanOrEqual(2);
  });

  it('partitions every interior cell into exactly one ring', () => {
    for (let cz = 1; cz < GRID_H - 1; cz++)
      for (let cx = 1; cx < GRID_W - 1; cx++)
        expect(['center', 'mid', 'perimeter']).toContain(ringOf(cx, cz));
    expect(CENTER_MAX).toBeLessThan(MID_MAX);
  });

  it('cellsInRing returns disjoint, complete cover of the grid', () => {
    const n = (['wall', 'center', 'mid', 'perimeter'] as const)
      .reduce((s, r) => s + cellsInRing(r).length, 0);
    expect(n).toBe(GRID_W * GRID_H);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/arenagen/rings.test.ts`
Expected: FAIL — cannot resolve `./rings`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sim/arenagen/types.ts
// Plain-data types for the greenfield generator. NO engine imports.
import type { Cell, Room, SpawnPoint } from '../floorplan';

export type Ring = 'wall' | 'center' | 'mid' | 'perimeter';
export type CoverHeight = 'low' | 'mid'; // low ≈ 1 m lob-over; mid = sightline breaker

export interface CoverPiece {
  cx: number; cz: number; w: number; h: number; // cells
  height: CoverHeight;
  clusterId: number; // -1 for center-stage pieces
}

/** Open cells behind a cluster (facing away from center) — the clump bait. */
export interface Pocket { clusterId: number; cells: Cell[]; }

export interface GradeReport {
  sightline: number;        // fraction of lane→center pairs with clear LOS
  pocketCount: number;
  pocketCells: number;
  laneConnected: boolean;   // perimeter lane forms one connected circuit
  lowMidRatioOk: boolean;   // 2–4 mid pieces AND low ≥ 2×mid
  centerClean: boolean;     // no mid-height cover in the center stage
  pass: boolean;
}

export interface ArenaProp { cell: Cell; kind: 'rubble' | 'prop'; }

/** Structural superset of Floorplan — assignable wherever a Floorplan is
 *  consumed (runner, bake paths) without an adapter. */
export interface ArenaPlan {
  seed: number;
  gridW: number; gridH: number; cellMeters: number;
  open: Uint8Array;         // 1 = walkable, 0 = solid (walls + ALL cover)
  rooms: Room[];
  spawns: SpawnPoint[];
  start: { cell: Cell; angBlood: number };
  arenaRoomId: number;
  cover: CoverPiece[];
  pockets: Pocket[];
  themeId: string;
  props: ArenaProp[];
  grade: GradeReport;
  attempt: number;          // which retry produced this plan (0-based)
}
```

```ts
// src/sim/arenagen/rings.ts
// Radial zoning via Chebyshev distance → square rings matching the square arena.
import { GRID_W, GRID_H, type Cell } from '../floorplan';
import type { Ring } from './types';

export const CENTER_MAX = 0.40; // r ≤ 0.40 → center stage
export const MID_MAX = 0.75;    // 0.40 < r ≤ 0.75 → mid ring; beyond → perimeter lane

export function ringOf(cx: number, cz: number): Ring {
  if (cx <= 0 || cz <= 0 || cx >= GRID_W - 1 || cz >= GRID_H - 1) return 'wall';
  const hx = (GRID_W - 1) / 2, hz = (GRID_H - 1) / 2; // 13.5 on the 28-grid
  const half = (GRID_W - 2) / 2;                       // 13 interior half-width
  const r = Math.max(Math.abs(cx - hx), Math.abs(cz - hz)) / half;
  return r <= CENTER_MAX ? 'center' : r <= MID_MAX ? 'mid' : 'perimeter';
}

export function cellsInRing(ring: Ring): Cell[] {
  const out: Cell[] = [];
  for (let cz = 0; cz < GRID_H; cz++)
    for (let cx = 0; cx < GRID_W; cx++)
      if (ringOf(cx, cz) === ring) out.push({ cx, cz });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/arenagen/rings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/arenagen/
git commit -m "feat(arenagen): ring zoning + ArenaPlan types"
```

---

### Task 2: Cover carving primitives + center-stage cover (`cover.ts`)

**Files:**
- Create: `src/sim/arenagen/cover.ts`
- Test: `src/sim/arenagen/cover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/arenagen/cover.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { createRng } from '../rng';
import { ringOf } from './rings';
import { maxRunAt, placeCenterCover, MAX_WALL_RUN } from './cover';

const openInterior = () => {
  const open = new Uint8Array(GRID_W * GRID_H);
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[z * GRID_W + x] = 1;
  return open;
};

describe('maxRunAt', () => {
  it('measures a horizontal solid run through a cell', () => {
    const open = openInterior();
    for (const cx of [10, 11, 12]) open[14 * GRID_W + cx] = 0;
    expect(maxRunAt(open, 11, 14)).toBe(3);
  });
});

describe('placeCenterCover', () => {
  it('places 1–3 low pieces, all inside the center stage', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      const pieces = placeCenterCover(createRng(seed), open);
      expect(pieces.length).toBeGreaterThanOrEqual(1);
      expect(pieces.length).toBeLessThanOrEqual(3);
      for (const p of pieces) {
        expect(p.height).toBe('low');
        for (let z = p.cz; z < p.cz + p.h; z++)
          for (let x = p.cx; x < p.cx + p.w; x++) {
            expect(ringOf(x, z)).toBe('center');
            expect(open[z * GRID_W + x]).toBe(0); // carved solid
          }
      }
    }
  });

  it('never creates a solid run longer than MAX_WALL_RUN', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      placeCenterCover(createRng(seed), open);
      for (let cz = 1; cz < GRID_H - 1; cz++)
        for (let cx = 1; cx < GRID_W - 1; cx++)
          if (open[cz * GRID_W + cx] === 0)
            expect(maxRunAt(open, cx, cz)).toBeLessThanOrEqual(MAX_WALL_RUN);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/arenagen/cover.test.ts`
Expected: FAIL — cannot resolve `./cover`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sim/arenagen/cover.ts
// Dynamite-graded cover placement. Mutates the occupancy grid (carves solids).
import { GRID_W, GRID_H, type Cell } from '../floorplan';
import { randomInt, type SimRng } from '../rng';
import { ringOf, cellsInRing } from './rings';
import type { CoverPiece, Pocket } from './types';

const idx = (cx: number, cz: number) => cz * GRID_W + cx;

/** 3 cells × 2 m = 6 m — the structural tall-wall/maze ban from the spec. */
export const MAX_WALL_RUN = 3;

/** Longest contiguous interior solid run through (cx,cz), row or column. */
export function maxRunAt(open: Uint8Array, cx: number, cz: number): number {
  let n = 0, m = 0;
  for (let x = cx - 1; x >= 1 && open[idx(x, cz)] === 0; x--) n++;
  for (let x = cx + 1; x <= GRID_W - 2 && open[idx(x, cz)] === 0; x++) m++;
  const row = 1 + n + m;
  n = 0; m = 0;
  for (let z = cz - 1; z >= 1 && open[idx(cx, z)] === 0; z--) n++;
  for (let z = cz + 1; z <= GRID_H - 2 && open[idx(cx, z)] === 0; z++) m++;
  return Math.max(row, 1 + n + m);
}

function pieceCells(cx: number, cz: number, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let z = cz; z < cz + h; z++) for (let x = cx; x < cx + w; x++) out.push({ cx: x, cz: z });
  return out;
}

/** No pre-existing interior solid within the 8-neighbourhood of any cell
 *  (border walls exempt) — keeps distinct cover pieces from fusing. */
function clearAround(open: Uint8Array, cells: Cell[]): boolean {
  const inSet = (x: number, z: number) => cells.some((c) => c.cx === x && c.cz === z);
  for (const c of cells)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.cx + dx, z = c.cz + dz;
        if (x < 1 || z < 1 || x > GRID_W - 2 || z > GRID_H - 2) continue;
        if (!inSet(x, z) && open[idx(x, z)] === 0) return false;
      }
  return true;
}

/** Carve cells solid iff all are open and no resulting run exceeds
 *  MAX_WALL_RUN; rolls back and returns false otherwise. */
function tryCarve(open: Uint8Array, cells: Cell[]): boolean {
  for (const c of cells) if (open[idx(c.cx, c.cz)] !== 1) return false;
  for (const c of cells) open[idx(c.cx, c.cz)] = 0;
  for (const c of cells)
    if (maxRunAt(open, c.cx, c.cz) > MAX_WALL_RUN) {
      for (const u of cells) open[idx(u.cx, u.cz)] = 1;
      return false;
    }
  return true;
}

/** Center stage: 1–3 LOW pieces only — nothing here breaks a dynamite arc. */
export function placeCenterCover(rng: SimRng, open: Uint8Array): CoverPiece[] {
  const anchors = cellsInRing('center');
  const target = 1 + randomInt(rng, 3);
  const placed: CoverPiece[] = [];
  for (let attempt = 0; placed.length < target && attempt < 60; attempt++) {
    const a = anchors[randomInt(rng, anchors.length)]!;
    const horiz = randomInt(rng, 2) === 0;
    const w = horiz ? 2 : 1, h = horiz ? 1 : 2;
    const cells = pieceCells(a.cx, a.cz, w, h);
    if (cells.some((c) => ringOf(c.cx, c.cz) !== 'center')) continue;
    if (placed.some((p) => Math.abs(p.cx - a.cx) <= 3 && Math.abs(p.cz - a.cz) <= 3)) continue;
    if (!clearAround(open, cells)) continue;
    if (!tryCarve(open, cells)) continue;
    placed.push({ cx: a.cx, cz: a.cz, w, h, height: 'low', clusterId: -1 });
  }
  return placed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/arenagen/cover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arenagen/cover.ts src/sim/arenagen/cover.test.ts
git commit -m "feat(arenagen): carving primitives + center-stage low cover"
```

---

### Task 3: Mid-ring clusters with pockets + mid-height assignment (`cover.ts`)

**Files:**
- Modify: `src/sim/arenagen/cover.ts` (append)
- Test: `src/sim/arenagen/cover.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append to cover.test.ts)**

```ts
import { placeMidClusters, assignMidHeights } from './cover';

describe('placeMidClusters', () => {
  it('places 4–6 clusters of 2–3 one-cell pieces, all in the mid ring, each with a 2–4 cell open pocket', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      const { pieces, pockets } = placeMidClusters(createRng(seed), open);
      const clusterIds = new Set(pieces.map((p) => p.clusterId));
      expect(clusterIds.size).toBeGreaterThanOrEqual(4);
      expect(clusterIds.size).toBeLessThanOrEqual(6);
      for (const p of pieces) expect(ringOf(p.cx, p.cz)).toBe('mid');
      for (const pk of pockets) {
        expect(pk.cells.length).toBeGreaterThanOrEqual(2);
        expect(pk.cells.length).toBeLessThanOrEqual(4);
        for (const c of pk.cells) expect(open[c.cz * GRID_W + c.cx]).toBe(1); // pockets stay open
      }
      expect(pockets.length).toBe(clusterIds.size); // one pocket per cluster
    }
  });

  it('pockets face away from the grid center (outward of their cluster anchor)', () => {
    const open = openInterior();
    const { pieces, pockets } = placeMidClusters(createRng(42), open);
    const hx = (GRID_W - 1) / 2, hz = (GRID_H - 1) / 2;
    for (const pk of pockets) {
      const anchor = pieces.find((p) => p.clusterId === pk.clusterId)!;
      const aDist = Math.max(Math.abs(anchor.cx - hx), Math.abs(anchor.cz - hz));
      for (const c of pk.cells) {
        const cDist = Math.max(Math.abs(c.cx - hx), Math.abs(c.cz - hz));
        expect(cDist).toBeGreaterThanOrEqual(aDist); // never closer to center than the cluster
      }
    }
  });
});

describe('assignMidHeights', () => {
  it('flags 2–4 pieces as mid, never within Chebyshev 2 of each other', () => {
    for (const seed of [1, 7, 42, 2026, 99999]) {
      const open = openInterior();
      const { pieces } = placeMidClusters(createRng(seed), open);
      assignMidHeights(createRng(seed ^ 0xbeef), pieces);
      const mids = pieces.filter((p) => p.height === 'mid');
      expect(mids.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < mids.length; i++)
        for (let j = i + 1; j < mids.length; j++) {
          const d = Math.max(Math.abs(mids[i]!.cx - mids[j]!.cx), Math.abs(mids[i]!.cz - mids[j]!.cz));
          expect(d).toBeGreaterThan(2);
        }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/sim/arenagen/cover.test.ts`
Expected: FAIL — `placeMidClusters` not exported.

- [ ] **Step 3: Write the implementation (append to cover.ts)**

```ts
/** Mid ring: 4–6 clusters of 2–3 pieces, each with a shared open pocket on the
 *  outward side. Enemy pathing funnels into pockets → dynamite payoff; the
 *  player reads pockets as throw targets while backpedaling to the lane. */
export function placeMidClusters(
  rng: SimRng, open: Uint8Array,
): { pieces: CoverPiece[]; pockets: Pocket[] } {
  const anchors = cellsInRing('mid');
  const hx = (GRID_W - 1) / 2, hz = (GRID_H - 1) / 2;
  const target = 4 + randomInt(rng, 3); // 4–6 clusters
  const pieces: CoverPiece[] = [];
  const pockets: Pocket[] = [];
  const reserved = new Set<number>(); // pocket cells no later cluster may carve
  let clusterId = 0;
  for (let attempt = 0; clusterId < target && attempt < 160; attempt++) {
    const a = anchors[randomInt(rng, anchors.length)]!;
    // Outward = dominant axis away from grid center; perpendicular spreads the cluster.
    const ox = a.cx - hx, oz = a.cz - hz;
    const dir = Math.abs(ox) >= Math.abs(oz)
      ? { dx: Math.sign(ox) || 1, dz: 0 }
      : { dx: 0, dz: Math.sign(oz) || 1 };
    const perp = { dx: dir.dz, dz: dir.dx };
    const n = 2 + randomInt(rng, 2); // 2–3 pieces
    const cells: Cell[] = [
      { cx: a.cx, cz: a.cz },
      { cx: a.cx + perp.dx, cz: a.cz + perp.dz },
    ];
    if (n === 3) cells.push({ cx: a.cx - perp.dx, cz: a.cz - perp.dz });
    if (cells.some((c) => ringOf(c.cx, c.cz) !== 'mid')) continue;
    if (cells.some((c) => reserved.has(c.cz * GRID_W + c.cx))) continue;
    // Pocket candidates: the far (outward) side of the cluster.
    const pocketCand: Cell[] = [
      { cx: a.cx + dir.dx, cz: a.cz + dir.dz },
      { cx: a.cx + dir.dx + perp.dx, cz: a.cz + dir.dz + perp.dz },
      { cx: a.cx + dir.dx - perp.dx, cz: a.cz + dir.dz - perp.dz },
      { cx: a.cx + 2 * dir.dx, cz: a.cz + 2 * dir.dz },
    ].filter((c) => ringOf(c.cx, c.cz) === 'mid' && open[c.cz * GRID_W + c.cx] === 1);
    if (pocketCand.length < 2) continue;
    if (!clearAround(open, cells)) continue;
    if (!tryCarve(open, cells)) continue;
    for (const c of cells)
      pieces.push({ cx: c.cx, cz: c.cz, w: 1, h: 1, height: 'low', clusterId });
    const size = Math.min(pocketCand.length, 2 + randomInt(rng, 3)); // 2–4 cells
    const pocketCells = pocketCand.slice(0, size);
    for (const c of pocketCells) reserved.add(c.cz * GRID_W + c.cx);
    pockets.push({ clusterId, cells: pocketCells });
    clusterId++;
  }
  return { pieces, pockets };
}

/** Promote 2–4 mid-ring pieces to sightline breakers, never adjacent
 *  (Chebyshev > 2 apart). Everything else stays lob-over low. */
export function assignMidHeights(rng: SimRng, pieces: CoverPiece[]): void {
  if (pieces.length === 0) return;
  const target = 2 + randomInt(rng, 3); // 2–4
  const chosen: CoverPiece[] = [];
  for (let attempt = 0; chosen.length < target && attempt < 60; attempt++) {
    const p = pieces[randomInt(rng, pieces.length)]!;
    if (p.height === 'mid') continue;
    if (chosen.some((q) => Math.abs(q.cx - p.cx) <= 2 && Math.abs(q.cz - p.cz) <= 2)) continue;
    p.height = 'mid';
    chosen.push(p);
  }
}
```

- [ ] **Step 4: Run the full cover suite**

Run: `npx vitest run src/sim/arenagen/cover.test.ts`
Expected: PASS (all Task 2 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/arenagen/cover.ts src/sim/arenagen/cover.test.ts
git commit -m "feat(arenagen): mid-ring pocket clusters + mid-height assignment"
```

---

### Task 4: Dynamite grading (`grade.ts`)

**Files:**
- Create: `src/sim/arenagen/grade.ts`
- Test: `src/sim/arenagen/grade.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/arenagen/grade.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { createRng } from '../rng';
import { placeCenterCover, placeMidClusters, assignMidHeights } from './cover';
import { gradePlan, gridLosClear, sightBlockers } from './grade';

const openInterior = () => {
  const open = new Uint8Array(GRID_W * GRID_H);
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[z * GRID_W + x] = 1;
  return open;
};

describe('gridLosClear', () => {
  it('sees across an empty grid but not through a blocking cell', () => {
    const block = new Uint8Array(GRID_W * GRID_H);
    expect(gridLosClear(block, { cx: 2, cz: 14 }, { cx: 25, cz: 14 })).toBe(true);
    block[14 * GRID_W + 13] = 1;
    expect(gridLosClear(block, { cx: 2, cz: 14 }, { cx: 25, cz: 14 })).toBe(false);
  });
});

describe('sightBlockers', () => {
  it('excludes low cover from the blocking grid, includes mid cover and walls', () => {
    const open = openInterior();
    open[14 * GRID_W + 10] = 0; // will be low cover
    open[14 * GRID_W + 16] = 0; // will be mid cover
    const block = sightBlockers(open, [
      { cx: 10, cz: 14, w: 1, h: 1, height: 'low', clusterId: 0 },
      { cx: 16, cz: 14, w: 1, h: 1, height: 'mid', clusterId: 1 },
    ]);
    expect(block[14 * GRID_W + 10]).toBe(0); // low: see over it
    expect(block[14 * GRID_W + 16]).toBe(1); // mid: blocks
    expect(block[0]).toBe(1);                // border wall blocks
  });
});

describe('gradePlan', () => {
  it('passes a well-formed generated layout (seed sweep, most seeds)', () => {
    let passes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const open = openInterior();
      const rng = createRng(seed);
      const center = placeCenterCover(rng, open);
      const { pieces, pockets } = placeMidClusters(rng, open);
      assignMidHeights(rng, pieces);
      const report = gradePlan(open, [...center, ...pieces], pockets);
      expect(report.laneConnected).toBe(true); // cover never touches the lane
      expect(report.centerClean).toBe(true);
      if (report.pass) passes++;
    }
    expect(passes).toBeGreaterThanOrEqual(10); // grading is a filter, not a wall
  });

  it('fails an empty layout (no pockets, no cover ratio)', () => {
    const report = gradePlan(openInterior(), [], []);
    expect(report.pass).toBe(false);
    expect(report.pocketCount).toBe(0);
    expect(report.lowMidRatioOk).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/arenagen/grade.test.ts`
Expected: FAIL — cannot resolve `./grade`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sim/arenagen/grade.ts
// Dynamite scoring: verifies emergent properties placement can't guarantee.
import { GRID_W, GRID_H, type Cell } from '../floorplan';
import { ringOf, cellsInRing } from './rings';
import type { CoverPiece, Pocket, GradeReport } from './types';

const idx = (cx: number, cz: number) => cz * GRID_W + cx;

export const SIGHTLINE_MIN = 0.55;
export const POCKET_MIN = 2;
export const POCKET_CELLS_MIN = 6;

/** Blocking grid for sightlines: solids minus LOW cover — a 1 m lob-over
 *  piece doesn't break eye-height LOS; mid cover and walls do. */
export function sightBlockers(open: Uint8Array, cover: CoverPiece[]): Uint8Array {
  const block = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < open.length; i++) block[i] = open[i] === 0 ? 1 : 0;
  for (const p of cover)
    if (p.height === 'low')
      for (let z = p.cz; z < p.cz + p.h; z++)
        for (let x = p.cx; x < p.cx + p.w; x++) block[idx(x, z)] = 0;
  return block;
}

/** Cell-center ray march (half-cell steps); true if no blocking cell crossed. */
export function gridLosClear(block: Uint8Array, a: Cell, b: Cell): boolean {
  const x0 = a.cx + 0.5, z0 = a.cz + 0.5, x1 = b.cx + 0.5, z1 = b.cz + 0.5;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + (x1 - x0) * t), cz = Math.floor(z0 + (z1 - z0) * t);
    if (block[cz * GRID_W + cx] === 1) return false;
  }
  return true;
}

export function gradePlan(
  open: Uint8Array, cover: CoverPiece[], pockets: Pocket[],
): GradeReport {
  // Backpedal: the perimeter lane must be one connected open circuit.
  const laneCells = cellsInRing('perimeter').filter((c) => open[idx(c.cx, c.cz)] === 1);
  const laneSet = new Set(laneCells.map((c) => idx(c.cx, c.cz)));
  let laneConnected = laneSet.size === cellsInRing('perimeter').length && laneSet.size > 0;
  if (laneConnected) {
    const seen = new Set<number>([idx(laneCells[0]!.cx, laneCells[0]!.cz)]);
    const q: Cell[] = [laneCells[0]!];
    while (q.length > 0) {
      const c = q.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = idx(c.cx + dx, c.cz + dz);
        if (laneSet.has(k) && !seen.has(k)) { seen.add(k); q.push({ cx: c.cx + dx, cz: c.cz + dz }); }
      }
    }
    laneConnected = seen.size === laneSet.size;
  }

  // Sightlines: sampled lane cells → sampled open center cells, height-aware.
  const block = sightBlockers(open, cover);
  const sources = laneCells.filter((_, i) => i % 3 === 0);
  const targets = cellsInRing('center')
    .filter((c) => open[idx(c.cx, c.cz)] === 1 && (c.cx + c.cz) % 2 === 0);
  let clear = 0, total = 0;
  for (const s of sources) for (const t of targets) { total++; if (gridLosClear(block, s, t)) clear++; }
  const sightline = total === 0 ? 0 : clear / total;

  const midCount = cover.filter((p) => p.height === 'mid').length;
  const lowCount = cover.length - midCount;
  const pocketCells = pockets.reduce((s, p) => s + p.cells.length, 0);
  const lowMidRatioOk = midCount >= 2 && midCount <= 4 && lowCount >= 2 * midCount;
  const centerClean = !cover.some(
    (p) => p.height === 'mid' && ringOf(p.cx, p.cz) === 'center',
  );

  return {
    sightline,
    pocketCount: pockets.length,
    pocketCells,
    laneConnected,
    lowMidRatioOk,
    centerClean,
    pass: sightline >= SIGHTLINE_MIN && pockets.length >= POCKET_MIN &&
      pocketCells >= POCKET_CELLS_MIN && laneConnected && lowMidRatioOk && centerClean,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/arenagen/grade.test.ts`
Expected: PASS. If the "most seeds" assertion lands below 10/20, do NOT loosen the test — inspect which criterion fails (log the reports) and tune `SIGHTLINE_MIN` (0.45–0.60 band) or cluster count first.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arenagen/grade.ts src/sim/arenagen/grade.test.ts
git commit -m "feat(arenagen): height-aware dynamite grading"
```

---

### Task 5: Generator entry — retry loop, start, spawns (`index.ts`)

**Files:**
- Create: `src/sim/arenagen/index.ts`
- Test: `src/sim/arenagen/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/arenagen/index.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H, bakeSimGeometry, floorplanFingerprint } from '../floorplan';
import { cellsInRing } from './rings';
import { maxRunAt, MAX_WALL_RUN } from './cover';
import { generateArena, MAX_ATTEMPTS } from './index';

describe('generateArena — determinism', () => {
  it('same seed → identical plan (grid, cover, pockets, spawns, start)', () => {
    const a = generateArena(2026), b = generateArena(2026);
    expect(Array.from(a.open)).toEqual(Array.from(b.open));
    expect(a.cover).toEqual(b.cover);
    expect(a.pockets).toEqual(b.pockets);
    expect(a.spawns).toEqual(b.spawns);
    expect(a.start).toEqual(b.start);
    expect(a.attempt).toBe(b.attempt);
  });

  it('is Floorplan-compatible: fingerprint + sim geometry bake work unchanged', () => {
    const plan = generateArena(42);
    expect(floorplanFingerprint(plan)).toBe(floorplanFingerprint(generateArena(42)));
    expect(bakeSimGeometry(plan).length).toBeGreaterThan(0);
  });
});

describe('generateArena — 100-seed hard-constraint sweep', () => {
  it('holds every structural guarantee on every seed', () => {
    let passes = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const p = generateArena(seed);
      // Backpedal lane: every perimeter cell open (cover never placed there).
      for (const c of cellsInRing('perimeter'))
        expect(p.open[c.cz * GRID_W + c.cx]).toBe(1);
      // Tall-wall ban.
      for (let cz = 1; cz < GRID_H - 1; cz++)
        for (let cx = 1; cx < GRID_W - 1; cx++)
          if (p.open[cz * GRID_W + cx] === 0)
            expect(maxRunAt(p.open, cx, cz)).toBeLessThanOrEqual(MAX_WALL_RUN);
      // Pockets recorded and open; ≥2 on passing plans.
      for (const pk of p.pockets)
        for (const c of pk.cells) expect(p.open[c.cz * GRID_W + c.cx]).toBe(1);
      // Mid cap; center clean.
      expect(p.cover.filter((q) => q.height === 'mid').length).toBeLessThanOrEqual(4);
      expect(p.grade.centerClean).toBe(true);
      expect(p.attempt).toBeLessThan(MAX_ATTEMPTS);
      expect(p.spawns.length).toBeGreaterThanOrEqual(6);
      if (p.grade.pass) passes++;
    }
    // Retry loop should rescue most seeds; fallback-to-best is the exception.
    expect(passes).toBeGreaterThanOrEqual(85);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/arenagen/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sim/arenagen/index.ts
// Greenfield dynamite-first arena generator: generate → grade → retry.
// Determinism firewall: plain data only. Geometry derives from seed ONLY.
import {
  GRID_W, GRID_H, CELL_M,
  type Cell, type Room, type SpawnPoint,
} from '../floorplan';
import { createRng, randomInt, type SimRng } from '../rng';
import { placeCenterCover, placeMidClusters, assignMidHeights } from './cover';
import { gradePlan } from './grade';
import type { ArenaPlan, GradeReport } from './types';

export type { ArenaPlan } from './types';

export const MAX_ATTEMPTS = 8;
const ENEMY_SPAWNS = 8;
const SPAWN_CLEAR = 4; // cells kept between player start and enemy spawns

const idx = (cx: number, cz: number) => cz * GRID_W + cx;

/** Blood facing angle (0..2047) pointing from cell A toward cell B.
 *  (Local copy — floorplan.ts retires once arenagen is proven.) */
function bloodAngleToward(from: Cell, to: Cell): number {
  const dx = to.cx - from.cx, dz = to.cz - from.cz;
  const theta = Math.atan2(-dx, -dz);
  return Math.round((((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 2048 / (Math.PI * 2)) % 2048;
}

/** Player start: midpoint of a random edge, inside the perimeter lane,
 *  facing the center stage. */
function chooseStart(rng: SimRng): { cell: Cell; angBlood: number } {
  const ccx = GRID_W >> 1, ccz = GRID_H >> 1;
  const edge = randomInt(rng, 4);
  const cell: Cell =
    edge === 0 ? { cx: ccx, cz: 2 } :
    edge === 1 ? { cx: ccx, cz: GRID_H - 3 } :
    edge === 2 ? { cx: 2, cz: ccz } :
                 { cx: GRID_W - 3, cz: ccz };
  return { cell, angBlood: bloodAngleToward(cell, { cx: ccx, cz: ccz }) };
}

/** Enemy spawns on open floor, away from the player start. */
function placeSpawns(rng: SimRng, open: Uint8Array, start: Cell): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (let attempt = 0; spawns.length < ENEMY_SPAWNS && attempt < ENEMY_SPAWNS * 30; attempt++) {
    const cx = 2 + randomInt(rng, GRID_W - 4);
    const cz = 2 + randomInt(rng, GRID_H - 4);
    if (open[idx(cx, cz)] !== 1) continue;
    if (Math.abs(cx - start.cx) + Math.abs(cz - start.cz) < SPAWN_CLEAR + 2) continue;
    spawns.push({ cell: { cx, cz }, roomId: 0 });
  }
  return spawns;
}

function buildCandidate(seed: number, attempt: number): ArenaPlan {
  // Geometry stream: seed + attempt ONLY — never theme. XOR-mixed away from
  // both the sim-step stream and floorplan.ts's stream.
  const rng = createRng((seed ^ 0x51ed270b ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0);
  const open = new Uint8Array(GRID_W * GRID_H);
  for (let z = 1; z < GRID_H - 1; z++)
    for (let x = 1; x < GRID_W - 1; x++) open[idx(x, z)] = 1;

  const arena: Room = { id: 0, cx: 1, cz: 1, w: GRID_W - 2, h: GRID_H - 2, kind: 'arena' };
  const start = chooseStart(rng);
  const centerPieces = placeCenterCover(rng, open);
  const { pieces, pockets } = placeMidClusters(rng, open);
  assignMidHeights(rng, pieces);
  const cover = [...centerPieces, ...pieces];
  open[idx(start.cell.cx, start.cell.cz)] = 1; // guarantee the start cell
  const spawns = placeSpawns(rng, open, start.cell);
  const grade = gradePlan(open, cover, pockets);

  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms: [arena], spawns, start, arenaRoomId: 0,
    cover, pockets, themeId: 'default', props: [], grade, attempt,
  };
}

/** Comparable scalar for fallback-to-best when no attempt passes. */
function gradeScore(g: GradeReport): number {
  return g.sightline
    + Math.min(g.pocketCount, 4) * 0.25
    + (g.laneConnected ? 1 : 0)
    + (g.lowMidRatioOk ? 1 : 0)
    + (g.centerClean ? 1 : 0);
}

/** Generation is total: every seed yields a plan (best candidate if none pass).
 *  Deterministic: retry index folds into the RNG stream. */
export function generateArena(seed: number): ArenaPlan {
  let best: ArenaPlan | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = buildCandidate(seed, attempt);
    if (plan.grade.pass) return plan;
    if (!best || gradeScore(plan.grade) > gradeScore(best.grade)) best = plan;
  }
  return best!;
}
```

- [ ] **Step 4: Run the full arenagen + floorplan suites**

Run: `npx vitest run src/sim/arenagen/ src/sim/floorplan.test.ts`
Expected: PASS. If the ≥85 pass-rate assertion fails, log per-seed `grade` reports, find the dominant failing criterion, and tune placement constants (cluster target, `SIGHTLINE_MIN`) — do not weaken the hard constraints.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arenagen/index.ts src/sim/arenagen/index.test.ts
git commit -m "feat(arenagen): generate→grade→retry entry with fallback-to-best"
```

---

### Task 6: Theme distillation script + theme data (`scripts/distill-theme-data.mjs`, `theme-data.ts`, `themes.ts`)

**Files:**
- Create: `scripts/distill-theme-data.mjs`
- Create: `src/sim/arenagen/theme-data.ts` (generated, checked in)
- Create: `src/sim/arenagen/themes.ts`
- Test: `src/sim/arenagen/themes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/arenagen/themes.test.ts
import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, getTheme, themeIds } from './themes';

describe('theme data (distilled from patterns.json, checked in)', () => {
  it('has at least 2 themes with sane densities', () => {
    const ids = themeIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      const t = getTheme(id);
      expect(t.sourceMaps.length).toBeGreaterThan(0);
      expect(t.propPer100Cells).toBeGreaterThanOrEqual(2);
      expect(t.propPer100Cells).toBeLessThanOrEqual(12);
      expect(t.rubblePer100Cells).toBeGreaterThanOrEqual(1);
      expect(t.rubblePer100Cells).toBeLessThanOrEqual(6);
      expect(t.materialSetId).toBe(id);
    }
  });

  it('DEFAULT_THEME is a valid theme with a stable index per theme', () => {
    expect(themeIds()).toContain(DEFAULT_THEME);
    const indices = themeIds().map((id) => getTheme(id).index);
    expect(new Set(indices).size).toBe(indices.length); // unique fork indices
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/arenagen/themes.test.ts`
Expected: FAIL — cannot resolve `./themes`.

- [ ] **Step 3: Write the distillation script**

```js
// scripts/distill-theme-data.mjs
// Distills public/assets/map-research/patterns.json (39 Blood maps) into the
// checked-in src/sim/arenagen/theme-data.ts. Clusters maps by name prefix
// (episode: DWE1Mx → 'e1', ...; DWBBx → 'bb'). Run after regenerating
// patterns.json: node scripts/distill-theme-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'public/assets/map-research/patterns.json';
const OUT = 'src/sim/arenagen/theme-data.ts';

const data = JSON.parse(readFileSync(SRC, 'utf8'));
if (!data.perMap || typeof data.perMap !== 'object') {
  throw new Error(`${SRC}: missing perMap — regenerate patterns.json first`);
}

const clusterOf = (name) => {
  const m = /^DW(E\d)M\d+/i.exec(name);
  return m ? m[1].toLowerCase() : 'bb';
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const groups = new Map();
for (const [name, m] of Object.entries(data.perMap)) {
  const k = clusterOf(name);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({ name, m });
}

const themes = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, entries], index) => {
    const sps = entries.reduce((s, e) => s + e.m.numSprites / e.m.numSectors, 0) / entries.length;
    return {
      id,
      name: `Blood ${id.toUpperCase()}`,
      index,
      sourceMaps: entries.map((e) => e.name),
      propPer100Cells: clamp(Math.round(sps * 4), 2, 12),
      rubblePer100Cells: clamp(Math.round(sps * 2), 1, 6),
      materialSetId: id,
    };
  });

const body = themes
  .map((t) => `  ${JSON.stringify(t.id)}: ${JSON.stringify(t, null, 2).replace(/\n/g, '\n  ')},`)
  .join('\n');

writeFileSync(OUT, `// GENERATED by scripts/distill-theme-data.mjs — do not edit by hand.
// Source: ${SRC} (${Object.keys(data.perMap).length} maps, ${data.campaignSummary.totalSectors} sectors).

export interface ThemeRecord {
  id: string;
  name: string;
  index: number;            // stable cosmetic-RNG fork index
  sourceMaps: string[];
  propPer100Cells: number;  // props per 100 open cells
  rubblePer100Cells: number;
  materialSetId: string;
}

export const THEMES: Record<string, ThemeRecord> = {
${body}
};

export type ThemeId = keyof typeof THEMES & string;
export const DEFAULT_THEME: ThemeId = ${JSON.stringify(themes[0].id)};
`);
console.log(`wrote ${OUT}: ${themes.map((t) => t.id).join(', ')}`);
```

- [ ] **Step 4: Generate theme-data.ts and write themes.ts**

Run: `node scripts/distill-theme-data.mjs`
Expected: `wrote src/sim/arenagen/theme-data.ts: bb, e1, e2, ...` (exact cluster ids depend on the 39 map names). Inspect the generated file — every theme must have non-empty `sourceMaps` and densities inside the clamps.

```ts
// src/sim/arenagen/themes.ts
// Typed access to the distilled theme records. Data is generated + checked in;
// the sim firewall never parses JSON at runtime.
import { THEMES, DEFAULT_THEME, type ThemeId, type ThemeRecord } from './theme-data';

export { THEMES, DEFAULT_THEME };
export type { ThemeId, ThemeRecord };

export function getTheme(id: ThemeId): ThemeRecord {
  const t = THEMES[id];
  if (!t) throw new Error(`unknown theme '${id}'`);
  return t;
}

export function themeIds(): ThemeId[] {
  return Object.keys(THEMES);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/sim/arenagen/themes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/distill-theme-data.mjs src/sim/arenagen/theme-data.ts src/sim/arenagen/themes.ts src/sim/arenagen/themes.test.ts
git commit -m "feat(arenagen): theme records distilled from patterns.json"
```

---

### Task 7: Cosmetic fork — theme param + prop scatter (`index.ts`)

**Files:**
- Modify: `src/sim/arenagen/index.ts`
- Test: `src/sim/arenagen/index.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append to index.test.ts)**

```ts
import { themeIds, DEFAULT_THEME } from './themes';

describe('generateArena — theme × seed independence', () => {
  it('geometry is identical across every theme for the same seed', () => {
    const base = generateArena(2026, DEFAULT_THEME);
    for (const id of themeIds()) {
      const p = generateArena(2026, id);
      expect(Array.from(p.open)).toEqual(Array.from(base.open));
      expect(p.cover).toEqual(base.cover);
      expect(p.pockets).toEqual(base.pockets);
      expect(p.spawns).toEqual(base.spawns);
      expect(p.themeId).toBe(id);
    }
  });

  it('scatters props on open floor per theme density, deterministically', () => {
    const a = generateArena(7, DEFAULT_THEME), b = generateArena(7, DEFAULT_THEME);
    expect(a.props).toEqual(b.props);
    expect(a.props.length).toBeGreaterThan(0);
    for (const pr of a.props)
      expect(a.open[pr.cell.cz * a.gridW + pr.cell.cx]).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/sim/arenagen/index.test.ts`
Expected: FAIL — `generateArena(2026, DEFAULT_THEME)` (extra argument / `themeId` stays `'default'` / empty props).

- [ ] **Step 3: Extend index.ts**

Add imports:

```ts
import { getTheme, DEFAULT_THEME, type ThemeId, type ThemeRecord } from './themes';
import type { ArenaProp } from './types';
```

Add the scatter helper (after `placeSpawns`):

```ts
/** Cosmetic prop scatter — separate RNG stream forked by theme index so theme
 *  choice NEVER perturbs geometry, spawns, or the sim-step stream. */
function scatterProps(crng: SimRng, open: Uint8Array, theme: ThemeRecord): ArenaProp[] {
  let openCount = 0;
  for (let i = 0; i < open.length; i++) if (open[i] === 1) openCount++;
  const nProps = Math.round((openCount * theme.propPer100Cells) / 100);
  const nRubble = Math.round((openCount * theme.rubblePer100Cells) / 100);
  const props: ArenaProp[] = [];
  const taken = new Set<number>();
  const place = (kind: ArenaProp['kind'], n: number) => {
    for (let attempt = 0; props.filter((p) => p.kind === kind).length < n && attempt < n * 20; attempt++) {
      const cx = 1 + randomInt(crng, GRID_W - 2);
      const cz = 1 + randomInt(crng, GRID_H - 2);
      const k = idx(cx, cz);
      if (open[k] !== 1 || taken.has(k)) continue;
      taken.add(k);
      props.push({ cell: { cx, cz }, kind });
    }
  };
  place('prop', nProps);
  place('rubble', nRubble);
  return props;
}
```

Change the signatures — `buildCandidate` gains the theme, `generateArena` gains an optional param (geometry stream untouched):

```ts
function buildCandidate(seed: number, attempt: number, themeId: ThemeId): ArenaPlan {
```

…and replace the return-object tail (`themeId: 'default', props: [],`) with:

```ts
  const theme = getTheme(themeId);
  const crng = createRng((seed ^ Math.imul(theme.index + 1, 0x85ebca6b)) >>> 0);
  const props = scatterProps(crng, open, theme);

  return {
    seed, gridW: GRID_W, gridH: GRID_H, cellMeters: CELL_M,
    open, rooms: [arena], spawns, start, arenaRoomId: 0,
    cover, pockets, themeId, props, grade, attempt,
  };
```

```ts
export function generateArena(seed: number, themeId: ThemeId = DEFAULT_THEME): ArenaPlan {
  let best: ArenaPlan | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = buildCandidate(seed, attempt, themeId);
    if (plan.grade.pass) return plan;
    if (!best || gradeScore(plan.grade) > gradeScore(best.grade)) best = plan;
  }
  return best!;
}
```

- [ ] **Step 4: Run the arenagen suite**

Run: `npx vitest run src/sim/arenagen/`
Expected: PASS — including the Task 5 determinism tests, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arenagen/index.ts src/sim/arenagen/index.test.ts
git commit -m "feat(arenagen): theme param + cosmetic prop fork (geometry untouched)"
```

---

### Task 8: ThemeMaterialSet seam (`src/game/level/theme-material-set.ts`)

**Files:**
- Create: `src/game/level/theme-material-set.ts`
- Test: `src/game/level/theme-material-set.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/game/level/theme-material-set.test.ts
import { describe, it, expect } from 'vitest';
import { resolveRole, type ThemeMaterialSet, type SurfaceRole } from './theme-material-set';

const mat = (name: string) => ({ name }) as unknown as import('three').Material;

describe('resolveRole', () => {
  const set: ThemeMaterialSet = {
    floor: mat('floor'), wall: mat('wall'),
    coverLow: mat('coverLow'), coverMid: mat('coverMid'),
    perimeterAccent: mat('accent'),
  };

  it('maps every required role to its material', () => {
    for (const role of ['floor', 'wall', 'coverLow', 'coverMid', 'perimeterAccent'] as SurfaceRole[])
      expect((resolveRole(set, role) as { name?: string }).name).toBe(
        role === 'perimeterAccent' ? 'accent' : role,
      );
  });

  it('falls back pocketFloor → floor when the optional slot is absent', () => {
    expect(resolveRole(set, 'pocketFloor')).toBe(set.floor);
    const withPocket = { ...set, pocketFloor: mat('pocket') };
    expect((resolveRole(withPocket, 'pocketFloor') as { name?: string }).name).toBe('pocket');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/level/theme-material-set.test.ts`
Expected: FAIL — cannot resolve `./theme-material-set`.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/level/theme-material-set.ts
// Role → material seam (spec §3). The sim emits role tags; the render layer
// resolves them here. Blood tile art is the FIRST implementation of this
// interface, not a dependency of it. Promoted from src/dev/theme-preview.ts.
import * as THREE from 'three';

export type SurfaceRole =
  | 'floor' | 'wall' | 'coverLow' | 'coverMid' | 'perimeterAccent' | 'pocketFloor';

export interface ThemeMaterialSet {
  floor: THREE.Material;
  wall: THREE.Material;
  coverLow: THREE.Material;   // ~1 m lob-over pieces
  coverMid: THREE.Material;   // sightline breakers
  perimeterAccent: THREE.Material;
  pocketFloor?: THREE.Material; // optional readability affordance (v1: = floor)
}

export function resolveRole(set: ThemeMaterialSet, role: SurfaceRole): THREE.Material {
  if (role === 'pocketFloor') return set.pocketFloor ?? set.floor;
  return set[role];
}

/** Untextured default set — used until Blood tile sets are wired in. */
export function defaultMaterialSet(): ThemeMaterialSet {
  return {
    floor: new THREE.MeshStandardMaterial({ color: 0x3a3734, roughness: 1.0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.95 }),
    coverLow: new THREE.MeshStandardMaterial({ color: 0x6b5f52, roughness: 0.9 }),
    coverMid: new THREE.MeshStandardMaterial({ color: 0x4f463c, roughness: 0.9 }),
    perimeterAccent: new THREE.MeshStandardMaterial({ color: 0x5c5044, roughness: 0.9 }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/level/theme-material-set.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/level/theme-material-set.ts src/game/level/theme-material-set.test.ts
git commit -m "feat(level): ThemeMaterialSet role→material seam"
```

---

### Task 9: Wire-in — runner swap + height-aware cover rendering

**Files:**
- Modify: `src/sim/runner.ts:7,33,62`
- Modify: `src/game/level/bake-cosmetic.ts` (build function, ~lines 45–88)

- [ ] **Step 1: Swap the generator in runner.ts**

At `src/sim/runner.ts:7`, keep the floorplan imports for the bakes and add arenagen:

```ts
import { bakeSimGeometry, cellToWorld, type Floorplan } from './floorplan';
import { generateArena } from './arenagen';
```

At lines 33 and 62 replace `this.fp = generateFloorplan(seed);` with:

```ts
this.fp = generateArena(seed);
```

`ArenaPlan` is a structural superset of `Floorplan` — no other changes needed.

- [ ] **Step 2: Run the full suite; repair determinism goldens if present**

Run: `npx vitest run`
Expected: arenagen/floorplan/geometry suites PASS. `src/sim/runner.test.ts` or `src/sim/determinism.test.ts` MAY fail if they assert golden fingerprints/hashes captured from `generateFloorplan` output. If so: the new values printed in the failure diff are the new goldens — update the constants in those test files (this is a legitimate regeneration: the map changed by design, determinism itself is still asserted by same-seed equality tests).

- [ ] **Step 3: Height-aware cover rendering in bake-cosmetic**

In `src/game/level/bake-cosmetic.ts`, the `build(plan: Floorplan)` function (starts ~line 45) currently renders every wall rect from `bakeWallRectsMeters(plan)` at full height — which would render low cover as full walls. Make it cover-aware. Add imports at the top:

```ts
import { cellToWorld } from '../../sim/floorplan';
import type { ArenaPlan } from '../../sim/arenagen/types';
import { defaultMaterialSet, resolveRole } from './theme-material-set';
```

Inside `build(plan)`, before the existing `bakeWallRectsMeters` loop (~line 62), re-open cover cells on a copy so the wall pass skips them, then add cover boxes:

```ts
    const arenaPlan = plan as Partial<ArenaPlan> & Floorplan;
    let wallPlan: Floorplan = plan;
    if (arenaPlan.cover && arenaPlan.cover.length > 0) {
      const open = new Uint8Array(plan.open);
      for (const p of arenaPlan.cover)
        for (let z = p.cz; z < p.cz + p.h; z++)
          for (let x = p.cx; x < p.cx + p.w; x++) open[z * plan.gridW + x] = 1;
      wallPlan = { ...plan, open };

      const mats = defaultMaterialSet();
      const LOW_H = 1.0, MID_H = 2.2; // meters; low = lob-over, mid = sightline breaker
      for (const p of arenaPlan.cover) {
        const h = p.height === 'low' ? LOW_H : MID_H;
        const geo = new THREE.BoxGeometry(p.w * plan.cellMeters, h, p.h * plan.cellMeters);
        const mesh = new THREE.Mesh(
          geo, resolveRole(mats, p.height === 'low' ? 'coverLow' : 'coverMid'),
        );
        const c = cellToWorld(plan, p.cx + (p.w - 1) / 2, p.cz + (p.h - 1) / 2);
        mesh.position.set(c.x, h / 2, c.z);
        // Register with the same scene/teardown bookkeeping the wall meshes use
        // (add to the same parent + disposal list as the loop below).
        scene.add(mesh);
        cosmeticMeshes.push(mesh); // ← use the actual teardown list variable in this file
      }
    }
```

…and change the existing wall loop source from `bakeWallRectsMeters(plan)` to `bakeWallRectsMeters(wallPlan)`. Match the file's actual mesh-registration/teardown variable names (read the surrounding `build`/`teardown` code — wall meshes are already tracked for disposal; cover meshes must join the same list so `rebuild()` doesn't leak).

Note: Rapier colliders and sim geometry still treat cover as full-height solids (`open` untouched for `bakeSimGeometry`) — movement blocking is correct; over-cover LOS/arcs land with the mixed-height-cover work (spec caveat, migration step 2).

- [ ] **Step 4: Typecheck + full suite + manual smoke**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.
Run: `npm run dev` — load the arena and verify by eye: open center with 1–3 knee-high blocks, clustered cover with open pockets behind them in the mid band, an unbroken walkable lane along the walls, 2–4 taller blocks, no long walls anywhere. Walk the perimeter full circle; lob dynamite over a low piece into a pocket.

- [ ] **Step 5: Commit**

```bash
git add src/sim/runner.ts src/game/level/bake-cosmetic.ts
git commit -m "feat(arena): wire arenagen into runner + height-aware cover rendering"
```

---

### Task 10: Retirement guard — floorplan.ts marked superseded

**Files:**
- Modify: `src/sim/floorplan.ts:1-8` (header comment only)

- [ ] **Step 1: Mark the old generator superseded (do NOT delete yet — spec migration step 3 retires it only after the new path is proven in play sessions)**

Add below the existing header comment at the top of `src/sim/floorplan.ts`:

```ts
// SUPERSEDED (2026-07-04): generateFloorplan is no longer called by runner.ts —
// src/sim/arenagen/ (dynamite-first generator) replaced it. This module still
// owns the shared Floorplan type + grid/bake utilities. Delete generateFloorplan,
// chooseStart, scatterCover, placeSpawns + their tests once arenagen is proven
// in-game (spec: 2026-07-04-blud-dynamite-arena-generator-design.md, §Migration).
```

- [ ] **Step 2: Full suite one last time**

Run: `npx vitest run`
Expected: PASS across the board.

- [ ] **Step 3: Commit**

```bash
git add src/sim/floorplan.ts
git commit -m "docs(floorplan): mark scatter generator superseded by arenagen"
```

---

## Out of scope (tracked separately)

The three ride-alongs from the brainstorm are **deliberately not tasks in this plan** — they touch unrelated systems and this plan must stand alone as working software:

1. **Zombie wall-ghosting fix** — `src/game/enemy/axe-zombie.ts:116,240` (kinematic body, AI-driven `setNextKinematicTranslation` without static clipping; mirror whatever `shotgun-cultist.ts:284` does post-fix).
2. **Wave auto-start** — `src/game/encounter/wave-runner.ts`.
3. **Fog removal** — `src/game/arena.ts:172-176` + skybox tie-in at `src/main.ts:146`.

Plan them as a small follow-up once this plan lands (or fold into the play-testing session).
