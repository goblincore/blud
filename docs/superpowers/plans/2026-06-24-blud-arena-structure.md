# Arena Structure (Layouts + Arches + Ruined Walls) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated arena structurally interesting and readable as outdoor ruins — nested-ring layouts, enemies emerging from arched gateways, crumbling ramparts you can see and shoot over — while fixing that enemies currently walk through walls.

**Architecture:** Add a per-box height (`SimAABB.top`) and make the sim's line tests (LOS + pellet occlusion) height-aware so sightlines/shots pass over low walls and cover; **player movement physics is unchanged** (everything still blocks you; you can't mount anything yet — that's the separate mixed-height iteration). The generator (`floorplan.ts`) gains a per-cell height grid, a layout-motif choice (open-arena | nested-ring), spawn-arch niches, and ruined/varied wall heights. `moveDude` gains collision. The cosmetic baker renders real per-rect heights + arch frames.

**Tech Stack:** TypeScript, Vitest (sim, `src/sim/**`), Three.js + Rapier (cosmetic, `src/game/**`). Spec: [docs/superpowers/specs/2026-06-24-blud-arena-structure-design.md](../specs/2026-06-24-blud-arena-structure-design.md).

**Determinism firewall (non-negotiable):** `src/sim/**` imports no `three`/Rapier/`src/game/**` and no `Math.random`/`Date.now`. Verify with `grep -rnE "from '(three|@dimforge|\.\./game|\.\./\.\./game)" src/sim/` (must be empty). Generation randomness flows through the seeded `SimRng` only.

**Height conventions:** floor is `y = 0`; a box is solid from `0` to `top` (fp). `WALL_TOP = fpFromMeters(1000)` is the finite "full height" sentinel (never `Infinity`). Low cover ≈ `fpFromMeters(1.2)`, low rampart ≈ `fpFromMeters(1.5)`. A box blocks a segment iff the segment crosses its XZ footprint AND dips to `≤ top` within that crossing (Y is linear in the slab parameter, so the min is at a clamped endpoint).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/sim/geometry.ts` | `SimAABB.top` + `WALL_TOP`; height-aware `segmentEnterTH` + `losClear`; `clipMoveXZ`/`segmentEnterT`/`segmentHitsAABB` stay XZ-only. |
| `src/sim/floorplan.ts` | per-cell `tier` height grid; tier→top table; height-aware `bakeWallRectsMeters`/`bakeSimGeometry`; cover height tiers; ruined perimeter heights; layout motif (open/nested-ring); spawn-arch niches; fingerprint folds heights. |
| `src/sim/dude.ts` | `moveDude` gains `clipMoveXZ`; `rayHitsPlayer` geometry occlusion uses `segmentEnterTH`; player hit-box gets `top`. |
| `src/game/level/bake-cosmetic.ts` | per-rect real heights + matching colliders; arch frames + recess; nested-ring inner wall. |
| `src/sim/{geometry,floorplan,dude,determinism}.test.ts` | unit + harness coverage. |

---

## Task 1: Add `SimAABB.top` + `WALL_TOP` (foundational, no behavior change)

**Files:**
- Modify: `src/sim/geometry.ts`
- Modify: `src/sim/floorplan.ts` (`MeterRect`, `bakeWallRectsMeters`, `bakeSimGeometry`)
- Modify: `src/sim/dude.ts` (`rayHitsPlayer` player box)
- Test: `src/sim/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/geometry.test.ts
import { WALL_TOP, buildArenaGeometry } from './geometry';

describe('SimAABB.top', () => {
  it('WALL_TOP is a large finite sentinel', () => {
    expect(Number.isFinite(WALL_TOP)).toBe(true);
    expect(WALL_TOP).toBeGreaterThan(fpFromMeters(100));
  });
  it('arena geometry boxes are full-height (top = WALL_TOP)', () => {
    for (const a of buildArenaGeometry()) expect(a.top).toBe(WALL_TOP);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/geometry.test.ts`
Expected: FAIL — `WALL_TOP` not exported / `a.top` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/geometry.ts`, add `top` to the interface and export `WALL_TOP`:

```ts
import { fpFromMeters } from './fp';

/** "Full height" sentinel — finite (never Infinity, to keep fp arithmetic safe). */
export const WALL_TOP = fpFromMeters(1000);

/** XZ-plane axis-aligned box in fp units, solid from the floor (y=0) up to `top`. */
export interface SimAABB {
  minX: number; maxX: number; minZ: number; maxZ: number;
  top: number;
}
```

In `buildArenaGeometry` (the `boxFromCenter` helper), set `top: WALL_TOP`:

```ts
  const boxFromCenter = (cx: number, cz: number, sx: number, sz: number): SimAABB => ({
    minX: fpFromMeters(cx - sx / 2), maxX: fpFromMeters(cx + sx / 2),
    minZ: fpFromMeters(cz - sz / 2), maxZ: fpFromMeters(cz + sz / 2),
    top: WALL_TOP,
  });
```

In `src/sim/floorplan.ts`, give `MeterRect` a `top` (meters) and set it in the bakers (all `WALL_TOP`-equivalent for now — real tiers come in Task 5):

```ts
export interface MeterRect { minX: number; maxX: number; minZ: number; maxZ: number; topMeters: number; }
```

In `bakeWallRectsMeters`, add `topMeters: 1000` to each pushed rect. In `bakeSimGeometry`, map it:

```ts
export function bakeSimGeometry(fp: Floorplan): SimAABB[] {
  return bakeWallRectsMeters(fp).map((r) => ({
    minX: fpFromMeters(r.minX), maxX: fpFromMeters(r.maxX),
    minZ: fpFromMeters(r.minZ), maxZ: fpFromMeters(r.maxZ),
    top: fpFromMeters(r.topMeters),
  }));
}
```

In `src/sim/dude.ts` `rayHitsPlayer`, the player hit box needs `top` (a target, not an occluder — use `WALL_TOP`; import it):

```ts
import { losClear, segmentEnterT, WALL_TOP, type SimAABB } from './geometry';
// ...
  const box: SimAABB = {
    minX: player.x - PLAYER_HIT_RADIUS, maxX: player.x + PLAYER_HIT_RADIUS,
    minZ: player.z - PLAYER_HIT_RADIUS, maxZ: player.z + PLAYER_HIT_RADIUS,
    top: WALL_TOP,
  };
```

Update the test helper `wallAt` in `geometry.test.ts` to include `top: WALL_TOP`, and the floorplan test wall-rect sampling (which reads `r.minX` etc.) still works.

- [ ] **Step 4: Run the full sim suite**

Run: `npx vitest run src/sim`
Expected: PASS (everything compiles with the new required field; behavior unchanged — all tops are WALL_TOP).

- [ ] **Step 5: Commit**

```bash
git add src/sim/geometry.ts src/sim/floorplan.ts src/sim/dude.ts src/sim/geometry.test.ts
git commit -m "feat(sim): add SimAABB.top + WALL_TOP (full-height default, no behavior change)"
```

---

## Task 2: Height-aware LOS (`segmentEnterTH` + `losClear`)

**Files:**
- Modify: `src/sim/geometry.ts`
- Test: `src/sim/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/geometry.test.ts
describe('losClear — height-aware', () => {
  const y = (m: number) => fpFromMeters(m);
  // a LOW box at x∈[5,6], top = 1.2 m
  const lowBox = { ...wallAt(5, 6, -10, 10), top: fpFromMeters(1.2) };
  const tallBox = { ...wallAt(5, 6, -10, 10), top: WALL_TOP };

  it('blocks a low sightline through a low box', () => {
    // eye + target at 0.5 m → below the 1.2 m box top → blocked
    expect(losClear(y(0), y(0.5), y(0), y(10), y(0.5), y(0), [lowBox])).toBe(false);
  });
  it('clears a high sightline over a low box', () => {
    // eye + target at 1.8 m → above the 1.2 m box → not blocked
    expect(losClear(y(0), y(1.8), y(0), y(10), y(1.8), y(0), [lowBox])).toBe(true);
  });
  it('a tall box (WALL_TOP) still blocks any height', () => {
    expect(losClear(y(0), y(1.8), y(0), y(10), y(1.8), y(0), [tallBox])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/geometry.test.ts -t height-aware`
Expected: FAIL — `losClear` ignores Y (the "clears over" case returns false).

- [ ] **Step 3: Write minimal implementation**

In `src/sim/geometry.ts`, add a height-aware entry-parameter function and rewrite `losClear` on top of it. Keep `segmentHitsAABB`/`segmentEnterT` (XZ) as-is for back-compat:

```ts
/**
 * Height-aware companion to segmentEnterT. Returns the entry parameter t∈[0,1]
 * at which the segment (x0,y0,z0)→(x1,y1,z1) is blocked by `aabb` (solid 0..top),
 * or Infinity if it is not blocked. Blocked iff the segment crosses the XZ
 * footprint AND dips to ≤ aabb.top within that crossing. Y is linear in t, so the
 * lowest point over the crossing interval is at a clamped endpoint.
 */
export function segmentEnterTH(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, aabb: SimAABB,
): number {
  const dx = x1 - x0, dz = z1 - z0;
  let txmin: number, txmax: number;
  if (dx === 0) {
    if (x0 < aabb.minX || x0 > aabb.maxX) return Infinity;
    txmin = -Infinity; txmax = Infinity;
  } else {
    const t1 = (aabb.minX - x0) / dx, t2 = (aabb.maxX - x0) / dx;
    txmin = Math.min(t1, t2); txmax = Math.max(t1, t2);
  }
  let tzmin: number, tzmax: number;
  if (dz === 0) {
    if (z0 < aabb.minZ || z0 > aabb.maxZ) return Infinity;
    tzmin = -Infinity; tzmax = Infinity;
  } else {
    const t1 = (aabb.minZ - z0) / dz, t2 = (aabb.maxZ - z0) / dz;
    tzmin = Math.min(t1, t2); tzmax = Math.max(t1, t2);
  }
  const tEnter = Math.max(txmin, tzmin, 0);
  const tExit = Math.min(txmax, tzmax, 1);
  if (tEnter > tExit) return Infinity;                 // no XZ overlap on [0,1]
  const yEnter = y0 + (y1 - y0) * tEnter;
  const yExit = y0 + (y1 - y0) * tExit;
  if (Math.min(yEnter, yExit) > aabb.top) return Infinity; // passes entirely over the box
  return tEnter;
}

export function losClear(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, geo: SimAABB[],
): boolean {
  for (const a of geo) {
    if (segmentEnterTH(x0, y0, z0, x1, y1, z1, a) !== Infinity) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/geometry.test.ts`
Expected: PASS (height-aware + the original full-height LOS tests both green).

- [ ] **Step 5: Commit**

```bash
git add src/sim/geometry.ts src/sim/geometry.test.ts
git commit -m "feat(sim): height-aware LOS (segmentEnterTH) — see over low walls"
```

---

## Task 3: Height-aware pellet occlusion (`rayHitsPlayer`)

**Files:**
- Modify: `src/sim/dude.ts`
- Test: `src/sim/dude.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that a cultist pellet passes *over* a low box between dude and player (find the existing `dude.test.ts` setup conventions — it spawns a dude + player + geo). Minimal direct test of the occlusion via a fire scenario, or if `rayHitsPlayer` is not exported, test through `stepDudes` firing. Export `rayHitsPlayer` for a focused unit test:

```ts
// add to src/sim/dude.test.ts
import { rayHitsPlayer } from './dude';
import { WALL_TOP, type SimAABB } from './geometry';
import { fpFromMeters } from './fp';
import { createPlayerState } from './player';

describe('rayHitsPlayer — height-aware geometry occlusion', () => {
  const p = createPlayerState();
  p.x = fpFromMeters(10); p.z = 0; p.y = 0;
  const eyeY = fpFromMeters(1.2);
  const lowBox: SimAABB = {
    minX: fpFromMeters(5), maxX: fpFromMeters(6), minZ: fpFromMeters(-2), maxZ: fpFromMeters(2),
    top: fpFromMeters(0.5),
  };
  const tallBox: SimAABB = { ...lowBox, top: WALL_TOP };

  it('a pellet fired level passes OVER a 0.5 m box and can hit the player', () => {
    // eye 1.2 m → player feet..eye; level shot stays at ~1.2 m > 0.5 m box → not occluded
    expect(rayHitsPlayer(0, eyeY, 0, p.x, eyeY, 0, p, [lowBox])).toBe(true);
  });
  it('a tall box occludes the same shot', () => {
    expect(rayHitsPlayer(0, eyeY, 0, p.x, eyeY, 0, p, [tallBox])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/dude.test.ts -t height-aware`
Expected: FAIL — `rayHitsPlayer` not exported and/or occlusion uses XZ `segmentEnterT` (low box wrongly blocks).

- [ ] **Step 3: Write minimal implementation**

In `src/sim/dude.ts`: export `rayHitsPlayer`, import `segmentEnterTH`, and switch the geometry-occlusion loop to it (keep the player-box `segmentEnterT` as XZ — the player isn't height-gated by a `top`; its vertical gate stays):

```ts
import { losClear, segmentEnterT, segmentEnterTH, WALL_TOP, type SimAABB } from './geometry';
// ...
export function rayHitsPlayer(
  eyeX: number, eyeY: number, eyeZ: number,
  endX: number, endY: number, endZ: number,
  player: PlayerState, geo: SimAABB[],
): boolean {
  const box: SimAABB = {
    minX: player.x - PLAYER_HIT_RADIUS, maxX: player.x + PLAYER_HIT_RADIUS,
    minZ: player.z - PLAYER_HIT_RADIUS, maxZ: player.z + PLAYER_HIT_RADIUS,
    top: WALL_TOP,
  };
  const tPlayer = segmentEnterT(eyeX, eyeZ, endX, endZ, box);
  if (tPlayer === Infinity) return false;
  for (const a of geo) {
    const tg = segmentEnterTH(eyeX, eyeY, eyeZ, endX, endY, endZ, a); // height-aware
    if (tg < tPlayer) return false;
  }
  const yAt = eyeY + (endY - eyeY) * tPlayer;
  return yAt >= player.y && yAt <= player.y + CULTIST.eyeHeight;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/dude.test.ts`
Expected: PASS (new occlusion tests + all existing cultist tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/dude.ts src/sim/dude.test.ts
git commit -m "feat(sim): cultist pellets occlude height-aware (shoot over low cover)"
```

---

## Task 4: Per-cell height grid + height-aware bake

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
import { TIER_OPEN, TIER_LOW, TIER_WALL, tierTopMeters } from './floorplan';

describe('height grid + bake', () => {
  it('exposes a tier grid parallel to open (0 = open floor)', () => {
    const fp = generateFloorplan(2026);
    expect(fp.tier.length).toBe(fp.open.length);
    for (let i = 0; i < fp.open.length; i++) {
      if (fp.open[i] === 1) expect(fp.tier[i]).toBe(TIER_OPEN);
      else expect(fp.tier[i]).toBeGreaterThan(TIER_OPEN);
    }
  });
  it('bakes per-rect heights from tiers (a low-tier cell yields a low top)', () => {
    const fp = generateFloorplan(2026);
    // force one interior border-adjacent cell to low tier and re-bake
    // (white-box: find a wall cell, set it low, confirm a rect with that top)
    const rects = bakeWallRectsMeters(fp);
    expect(rects.every(r => r.topMeters > 0)).toBe(true);
    expect(tierTopMeters(TIER_LOW)).toBeLessThan(tierTopMeters(TIER_WALL));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts -t "height grid"`
Expected: FAIL — `tier`, `TIER_*`, `tierTopMeters` don't exist.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/floorplan.ts`, add tier codes + a top table, a `tier` grid on `Floorplan`, populate it wherever cells are made solid/open, and make `bakeWallRectsMeters` merge by equal tier and emit `topMeters`.

```ts
// tier codes: 0 = open floor; solids carry a height tier.
export const TIER_OPEN = 0;
export const TIER_LOW = 1;   // low cover / crumbled rampart
export const TIER_MID = 2;   // reserved (waist-high+); unused until tuning
export const TIER_WALL = 3;  // full wall

const TIER_TOP_M = [0, 1.5, 2.4, 1000]; // meters per tier; WALL → 1000 (→ WALL_TOP)
export function tierTopMeters(tier: number): number { return TIER_TOP_M[tier] ?? 1000; }
```

Add `tier: Uint8Array` to the `Floorplan` interface. In `generateFloorplan`, allocate `const tier = new Uint8Array(GRID_W * GRID_H)` and keep it in sync: when opening interior cells leave `tier = TIER_OPEN`; the solid border ring is `TIER_WALL`; cover cells set `tier = TIER_WALL` for now (real tiers in Task 5). Set border tiers explicitly:

```ts
  const tier = new Uint8Array(GRID_W * GRID_H); // 0 everywhere = open
  // border ring solid → TIER_WALL
  for (let x = 0; x < GRID_W; x++) { tier[cellIndex(GRID_W, x, 0)] = TIER_WALL; tier[cellIndex(GRID_W, x, GRID_H - 1)] = TIER_WALL; }
  for (let z = 0; z < GRID_H; z++) { tier[cellIndex(GRID_W, 0, z)] = TIER_WALL; tier[cellIndex(GRID_W, GRID_W - 1, z)] = TIER_WALL; }
```

Update `scatterCover` to also set `tier[cell] = TIER_WALL` for each cover cell it makes solid (signature gains `tier`). Include `tier` in the returned `Floorplan`.

Rewrite `bakeWallRectsMeters` to merge runs of equal tier and emit `topMeters`:

```ts
export function bakeWallRectsMeters(fp: Floorplan): MeterRect[] {
  const { open, tier, gridW, gridH, cellMeters } = fp;
  const originX = -(gridW * cellMeters) / 2, originZ = -(gridH * cellMeters) / 2;
  const isOpen = (cx: number, cz: number) =>
    cx >= 0 && cz >= 0 && cx < gridW && cz < gridH && open[cz * gridW + cx] === 1;
  const wallTier = (cx: number, cz: number): number => {
    if (open[cz * gridW + cx] === 1) return 0;
    const border = isOpen(cx - 1, cz) || isOpen(cx + 1, cz) || isOpen(cx, cz - 1) || isOpen(cx, cz + 1);
    return border ? tier[cz * gridW + cx] : 0; // only border-facing solids are walls
  };
  const rects: MeterRect[] = [];
  for (let cz = 0; cz < gridH; cz++) {
    let runStart = -1, runTier = 0;
    for (let cx = 0; cx <= gridW; cx++) {
      const t = cx < gridW ? wallTier(cx, cz) : 0;
      if (t !== runTier) {
        if (runTier > 0) rects.push({
          minX: originX + runStart * cellMeters, maxX: originX + cx * cellMeters,
          minZ: originZ + cz * cellMeters, maxZ: originZ + (cz + 1) * cellMeters,
          topMeters: tierTopMeters(runTier),
        });
        runStart = cx; runTier = t;
      }
    }
  }
  return rects;
}
```

Fold `tier` into `floorplanFingerprint` (mix each `tier[i]` alongside `open[i]`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS. Then `npx vitest run src/sim` — all green (tops still effectively full wall, so LOS/geo unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): per-cell tier height grid + height-aware wall bake"
```

---

## Task 5: Ruined/varied wall + cover heights

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
describe('ruined heights', () => {
  it('some perimeter is crumbled-low and some cover is low (mixed heights)', () => {
    let sawLowWall = false, sawLowCover = false;
    for (const seed of [1, 2, 7, 42, 2026, 99999, 123456, 555]) {
      const fp = generateFloorplan(seed);
      for (let i = 0; i < fp.tier.length; i++) {
        if (fp.tier[i] === TIER_LOW) {
          // classify by position: border ring vs interior
          const cx = i % fp.gridW, cz = Math.floor(i / fp.gridW);
          const onBorder = cx === 0 || cz === 0 || cx === fp.gridW - 1 || cz === fp.gridH - 1;
          if (onBorder) sawLowWall = true; else sawLowCover = true;
        }
      }
    }
    expect(sawLowWall).toBe(true);
    expect(sawLowCover).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts -t "ruined heights"`
Expected: FAIL — everything is `TIER_WALL`; no `TIER_LOW` produced.

- [ ] **Step 3: Write minimal implementation**

In `src/sim/floorplan.ts`: (a) when assigning cover cells, roll a tier (bias to low); (b) after the border ring is set, crumble a fraction of perimeter cells to `TIER_LOW`. Constants + logic:

```ts
const COVER_LOW_CHANCE = 0.55;   // fraction of cover islands that are low (shoot-over)
const RAMPART_LOW_CHANCE = 0.30; // fraction of perimeter cells crumbled low
```

In `scatterCover`, choose a per-island tier and stamp it:

```ts
    const islandTier = (randomInt(rng, 100) < COVER_LOW_CHANCE * 100) ? TIER_LOW : TIER_WALL;
    placed.push({ cx, cz, w, h });
    for (let z = cz; z < cz + h; z++)
      for (let x = cx; x < cx + w; x++) {
        open[cellIndex(GRID_W, x, z)] = 0;
        tier[cellIndex(GRID_W, x, z)] = islandTier;
      }
```

After setting the solid border ring to `TIER_WALL` in `generateFloorplan`, crumble some of it (skip corners for structural sanity):

```ts
  const crumble = (cx: number, cz: number) => {
    if (randomInt(rng, 100) < RAMPART_LOW_CHANCE * 100) tier[cellIndex(GRID_W, cx, cz)] = TIER_LOW;
  };
  for (let x = 1; x < GRID_W - 1; x++) { crumble(x, 0); crumble(x, GRID_H - 1); }
  for (let z = 1; z < GRID_H - 1; z++) { crumble(0, z); crumble(GRID_W - 1, z); }
```

(Order: open interior → set border TIER_WALL → crumble border → `chooseStart` → `scatterCover` (now tiers cover) → spawns. Keep the start-cell-open guard.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS (mixed heights present; same seed still deterministic).

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): ruined/varied wall + cover heights (crumbled ramparts, low cover)"
```

---

## Task 6: Layout motif — nested-ring (Doom donut)

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
describe('layout motifs', () => {
  it('produces both open-arena and nested-ring across seeds', () => {
    const motifs = new Set<string>();
    for (let s = 1; s <= 40; s++) motifs.add(generateFloorplan(s).motif);
    expect(motifs.has('open')).toBe(true);
    expect(motifs.has('nested-ring')).toBe(true);
  });

  it('nested-ring has an inner wall with gaps reaching the inner arena from the hallway', () => {
    // find a nested-ring seed
    let fp = generateFloorplan(1);
    for (let s = 1; s <= 60 && fp.motif !== 'nested-ring'; s++) fp = generateFloorplan(s);
    expect(fp.motif).toBe('nested-ring');
    // flood-fill from start must reach the geometric center (inner arena) — i.e. gaps exist
    const key = (cx: number, cz: number) => cz * fp.gridW + cx;
    const open = (cx: number, cz: number) =>
      cx >= 0 && cz >= 0 && cx < fp.gridW && cz < fp.gridH && fp.open[key(cx, cz)] === 1;
    const seen = new Set<number>([key(fp.start.cell.cx, fp.start.cell.cz)]);
    const work = [[fp.start.cell.cx, fp.start.cell.cz]];
    while (work.length) {
      const [cx, cz] = work.pop()!;
      for (const [nx, nz] of [[cx-1,cz],[cx+1,cz],[cx,cz-1],[cx,cz+1]] as const)
        if (open(nx, nz) && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); work.push([nx, nz]); }
    }
    expect(seen.has(key(fp.gridW >> 1, fp.gridH >> 1))).toBe(true); // inner arena reachable
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts -t "layout motifs"`
Expected: FAIL — no `motif` field; no nested-ring.

- [ ] **Step 3: Write minimal implementation**

Add `motif: 'open' | 'nested-ring'` to `Floorplan`. Pick it from the seed and, for nested-ring, stamp a gapped inner wall after opening the interior (before cover):

```ts
export type Motif = 'open' | 'nested-ring';
const RING_INSET = 4;     // cells from the playable interior edge to the inner wall
const RING_GAPS = 3;      // openings in the inner wall

function carveNestedRing(rng: SimRng, open: Uint8Array, tier: Uint8Array): void {
  const lo = 1 + RING_INSET, hiX = GRID_W - 2 - RING_INSET, hiZ = GRID_H - 2 - RING_INSET;
  if (hiX - lo < 4 || hiZ - lo < 4) return; // grid too small; leave open
  const set = (cx: number, cz: number) => { open[cellIndex(GRID_W, cx, cz)] = 0; tier[cellIndex(GRID_W, cx, cz)] = TIER_WALL; };
  for (let x = lo; x <= hiX; x++) { set(x, lo); set(x, hiZ); }
  for (let z = lo; z <= hiZ; z++) { set(lo, z); set(hiX, z); }
  // punch gaps so the inner arena connects to the hallway
  const open2 = (cx: number, cz: number) => { open[cellIndex(GRID_W, cx, cz)] = 1; tier[cellIndex(GRID_W, cx, cz)] = TIER_OPEN; };
  for (let g = 0; g < RING_GAPS; g++) {
    const side = randomInt(rng, 4);
    if (side === 0) { const x = lo + 1 + randomInt(rng, Math.max(1, hiX - lo - 1)); open2(x, lo); open2(x, lo + 1); }
    else if (side === 1) { const x = lo + 1 + randomInt(rng, Math.max(1, hiX - lo - 1)); open2(x, hiZ); open2(x, hiZ - 1); }
    else if (side === 2) { const z = lo + 1 + randomInt(rng, Math.max(1, hiZ - lo - 1)); open2(lo, z); open2(lo + 1, z); }
    else { const z = lo + 1 + randomInt(rng, Math.max(1, hiZ - lo - 1)); open2(hiX, z); open2(hiX - 1, z); }
  }
}
```

In `generateFloorplan`, after opening the interior + border + crumble, choose the motif and apply it. For nested-ring, set the player start in the **hallway** (so you fight inward), not the inner arena:

```ts
  const motif: Motif = randomInt(rng, 2) === 0 ? 'nested-ring' : 'open';
  if (motif === 'nested-ring') carveNestedRing(rng, open, tier);
  const start = chooseStart(rng); // edge cell = hallway for nested-ring, fine for open
  // guarantee start open (it may land on the inner wall in nested-ring — clear it + a step in)
  open[cellIndex(GRID_W, start.cell.cx, start.cell.cz)] = 1;
  tier[cellIndex(GRID_W, start.cell.cx, start.cell.cz)] = TIER_OPEN;
```

Add `motif` to the returned object and fold it into the fingerprint. `scatterCover` runs after the ring (it already only writes cells; the `placeSpawns` "open floor only" filter keeps spawns off the ring).

> NOTE: `chooseStart` puts the player at an edge cell (cz=2 etc.) — that's in the hallway for nested-ring (inset 4), good. The flood-fill connectivity test (Task 6 Step 1) guards that the inner arena stays reachable; if a seed's gaps fail to connect, increase `RING_GAPS` or widen gaps until the test passes for the battery of seeds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS (both motifs; nested-ring connected). Run `npx vitest run src/sim` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): nested-ring layout motif (inner arena + gapped hallway)"
```

---

## Task 7: Spawn arches — perimeter niches

**Files:**
- Modify: `src/sim/floorplan.ts`
- Test: `src/sim/floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/floorplan.test.ts
describe('spawn arches', () => {
  it('records arches and puts all enemy spawns inside open niche cells', () => {
    for (const seed of [1, 2, 7, 42, 2026]) {
      const fp = generateFloorplan(seed);
      expect(fp.arches.length).toBeGreaterThanOrEqual(2);
      // every arch mouth cell is open (enemies can walk out)
      for (const a of fp.arches) expect(fp.open[a.mouth.cz * fp.gridW + a.mouth.cx]).toBe(1);
      // every spawn sits in an open cell that belongs to a niche (near the border band)
      for (const sp of fp.spawns) expect(fp.open[sp.cell.cz * fp.gridW + sp.cell.cx]).toBe(1);
      expect(fp.spawns.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/floorplan.test.ts -t "spawn arches"`
Expected: FAIL — no `arches` field.

- [ ] **Step 3: Write minimal implementation**

Thicken the border to a band and carve niches. Add a 1-cell extra solid band by growing the grid margin, or (simpler, no grid resize) carve niches **inward** from the border into the interior at the edge, walling them off except the mouth. Implement niches as small enclosed pockets just inside the border, opening to the playfield:

```ts
export interface Arch { mouth: Cell; niche: Cell[]; edge: 'N' | 'S' | 'E' | 'W'; }
const N_ARCHES = 3;
const NICHE_W = 3, NICHE_D = 2;

function carveArches(rng: SimRng, open: Uint8Array, tier: Uint8Array, startCell: Cell): Arch[] {
  const arches: Arch[] = [];
  const edges: Array<'N' | 'S' | 'E' | 'W'> = ['N', 'S', 'E', 'W'];
  for (let i = 0; i < N_ARCHES; i++) {
    const edge = edges[randomInt(rng, edges.length)]!;
    // pocket origin just inside the border on the chosen edge
    let nx: number, nz: number;
    if (edge === 'N') { nx = 2 + randomInt(rng, GRID_W - 4 - NICHE_W); nz = 1; }
    else if (edge === 'S') { nx = 2 + randomInt(rng, GRID_W - 4 - NICHE_W); nz = GRID_H - 1 - NICHE_D; }
    else if (edge === 'W') { nx = 1; nz = 2 + randomInt(rng, GRID_H - 4 - NICHE_W); }
    else { nx = GRID_W - 1 - NICHE_D; nz = 2 + randomInt(rng, GRID_H - 4 - NICHE_W); }
    const horiz = edge === 'N' || edge === 'S';
    const w = horiz ? NICHE_W : NICHE_D, h = horiz ? NICHE_D : NICHE_W;
    if (nx + w >= GRID_W - 1 || nz + h >= GRID_H - 1 || nx < 1 || nz < 1) continue;
    const niche: Cell[] = [];
    for (let z = nz; z < nz + h; z++)
      for (let x = nx; x < nx + w; x++) { open[cellIndex(GRID_W, x, z)] = 1; tier[cellIndex(GRID_W, x, z)] = TIER_OPEN; niche.push({ cx: x, cz: z }); }
    // mouth = the niche cell nearest the arena center (where enemies emerge)
    const mouth = niche.reduce((best, c) => {
      const dc = Math.abs(c.cx - (GRID_W >> 1)) + Math.abs(c.cz - (GRID_H >> 1));
      const db = Math.abs(best.cx - (GRID_W >> 1)) + Math.abs(best.cz - (GRID_H >> 1));
      return dc < db ? c : best;
    }, niche[0]!);
    arches.push({ mouth, niche, edge });
  }
  void startCell;
  return arches;
}

function spawnsFromArches(arches: Arch[]): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  for (const a of arches) for (const c of a.niche) spawns.push({ cell: c, roomId: 0 });
  return spawns;
}
```

In `generateFloorplan`: after motif + crumble, `const arches = carveArches(rng, open, tier, start.cell);` then `scatterCover(...)` then **replace** `placeSpawns(...)` with `const spawns = spawnsFromArches(arches);`. Add `arches` to the returned `Floorplan` and fold arch mouth cells into the fingerprint. Keep the old `placeSpawns` only if `arches` is empty (fallback).

> NOTE: niches carve into the interior at the edge; `scatterCover` must not fill them — it already biases away from the spawn-clear zone, but add a guard so cover skips cells already open in a niche if overlap shows up in playtest.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/floorplan.test.ts`
Expected: PASS. Run `npx vitest run src/sim` — green.

- [ ] **Step 5: Commit**

```bash
git add src/sim/floorplan.ts src/sim/floorplan.test.ts
git commit -m "feat(sim): spawn arches — enemies emerge from perimeter niches"
```

---

## Task 8: Enemy wall collision (`moveDude`)

**Files:**
- Modify: `src/sim/dude.ts`
- Test: `src/sim/dude.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/dude.test.ts
import { moveDude, spawnDude } from './dude';
import { clipMoveXZ } from './geometry'; // for reference
describe('moveDude — wall collision', () => {
  it('does not advance through a wall directly ahead', () => {
    const dudes: any[] = [];
    spawnDude(dudes, fpFromMeters(0), fpFromMeters(0), 0, 0);
    const d = dudes[0];
    d.vx = fpFromMeters(2); d.vz = 0; // driving +X hard
    const wall = { minX: fpFromMeters(0.5), maxX: fpFromMeters(1.5),
                   minZ: fpFromMeters(-5), maxZ: fpFromMeters(5), top: WALL_TOP };
    moveDude(d, [wall]);
    expect(d.x).toBeLessThanOrEqual(fpFromMeters(0.5)); // stopped at the wall (minus radius)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/dude.test.ts -t "wall collision"`
Expected: FAIL — `moveDude` takes no `geo` and ghosts through (`d.x` ≈ 2 m).

- [ ] **Step 3: Write minimal implementation**

In `src/sim/dude.ts`, give `moveDude` the geometry and clip horizontally (CULTIST.radius already exists). Update its one caller in `stepDudes`:

```ts
import { clipMoveXZ, losClear, segmentEnterT, segmentEnterTH, WALL_TOP, type SimAABB } from './geometry';
// ...
export function moveDude(d: DudeState, geo: SimAABB[]): void {
  const moved = clipMoveXZ({ x: d.x, z: d.z }, d.vx, d.vz, CULTIST.radius, geo);
  d.x = moved.x; d.z = moved.z;
  d.y = 0; // ground-only
  applyDudeFriction(d);
}
```

Find the `moveDude(d)` call inside `stepDudes` and pass `geo`: `moveDude(d, geo);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/dude.test.ts`
Expected: PASS (collision test + all existing cultist AI tests — they run in the open arena geo, so clipping is a no-op there).

- [ ] **Step 5: Commit**

```bash
git add src/sim/dude.ts src/sim/dude.test.ts
git commit -m "fix(sim): cultists collide with walls (moveDude clipMoveXZ) — no more ghosting"
```

---

## Task 9: Cosmetic — real heights + arch frames + nested-ring wall

**Files:**
- Modify: `src/game/level/bake-cosmetic.ts`

- [ ] **Step 1: Render per-rect heights + arch frames (no unit test — Three/Rapier; verified in playtest)**

Replace the flat `WALL_HEIGHT` wall loop so each rect uses its own height, and draw an arch frame at each `fp.arches` mouth. The wall rects already carry `topMeters` (Task 4); cap the `WALL_TOP` sentinel to the visual wall height.

```ts
import { bakeWallRectsMeters, cellToWorld, type Floorplan } from '../../sim/floorplan';
// ...
const WALL_HEIGHT = 4;        // visual height for full walls (WALL_TOP sentinel)
const ARCH_THICK = 0.4;

function rectHeight(topMeters: number): number { return Math.min(topMeters, WALL_HEIGHT); }

// inside build(plan):
for (const r of bakeWallRectsMeters(plan)) {
  const sx = r.maxX - r.minX, sz = r.maxZ - r.minZ;
  const px = (r.minX + r.maxX) / 2, pz = (r.minZ + r.maxZ) / 2;
  const hy = rectHeight(r.topMeters);
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, hy, sz), wallMat);
  m.position.set(px, hy / 2, pz);
  group.add(m);
  colliders.push(world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx / 2, hy / 2, sz / 2).setTranslation(px, hy / 2, pz),
  ));
}

// arch frames — a lintel beam over each niche mouth (cosmetic only)
for (const a of plan.arches) {
  const w = cellToWorld(plan, a.mouth.cx, a.mouth.cz);
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(plan.cellMeters * 2.2, ARCH_THICK, plan.cellMeters * 2.2),
    wallMat,
  );
  lintel.position.set(w.x, WALL_HEIGHT - ARCH_THICK / 2, w.z);
  group.add(lintel);
}
```

> NOTE: `nested-ring` inner wall is just more solid cells, so `bakeWallRectsMeters` already emits its rects — no extra code. Confirm the lintel reads as an arch in playtest; if the mouth spans 2 cells, widen the lintel `BoxGeometry` to match. A dim recess material for niches is a nice-to-have — skip unless it looks flat.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/game/level/bake-cosmetic.ts
git commit -m "feat(level): cosmetic per-rect wall heights + arch-frame lintels"
```

---

## Task 10: Determinism harness + integration verify

**Files:**
- Modify: `src/sim/determinism.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/sim/determinism.test.ts
import { generateFloorplan, bakeSimGeometry, floorplanFingerprint } from './floorplan';

describe('determinism — arena structure', () => {
  it('same seed → identical map fingerprint (heights + motif + arches)', () => {
    expect(floorplanFingerprint(generateFloorplan(2026)))
      .toBe(floorplanFingerprint(generateFloorplan(2026)));
  });
  it('stepping stays deterministic on a height-tiered, motif-varied map', () => {
    const geo = bakeSimGeometry(generateFloorplan(2026));
    const inputs = recordedInputs(200);
    const a = seededState(2026), b = seededState(2026);
    for (let t = 0; t < inputs.length; t++) {
      stepSim(a, inputs[t]!, geo); stepSim(b, inputs[t]!, geo);
      expect(hashSimState(a)).toBe(hashSimState(b));
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/sim/determinism.test.ts`
Expected: PASS (if the stepping test fails, a non-deterministic path slipped into generation/collision — debug with superpowers:systematic-debugging before continuing).

- [ ] **Step 3: Full integration verify**

```bash
npx tsc --noEmit
npx vitest run src/sim
npm run build
grep -rnE "from '(three|@dimforge|\.\./game|\.\./\.\./game)" src/sim/   # must be empty
```
Expected: tsc clean; all sim tests pass; build green; firewall grep empty.

- [ ] **Step 4: Commit**

```bash
git add src/sim/determinism.test.ts
git commit -m "test(sim): determinism harness covers height-tiered, motif-varied maps"
```

- [ ] **Step 5: Manual playtest gate**

Symlink worktree assets if needed, then `npm run dev` and verify against spec §9:
1. Reroll (`M`) a dozen maps — a mix of **open-arena** and **nested-ring** (Doom-donut) layouts appear; all walkable.
2. **Nested-ring** plays: flank around the outer hallway, push through the inner-wall gaps into the central arena.
3. Enemies (`T`) **emerge from arched niches** and **path around walls** (no ghosting through them).
4. You can **see and shoot over** crumbled-low ramparts (to the tree-line) and over low cover; tall walls block sight + movement.
5. Nothing falls out of world; no crash.

Then update `TASKS.md` and commit.

---

## Self-Review

**1. Spec coverage:**
- §3 height model (`SimAABB.top`, height-aware LOS, movement unchanged) → Tasks 1–3. ✓
- §4.1 layout motif (open + nested-ring) → Task 6. ✓
- §4.2 spawn arches → Task 7. ✓
- §4.3 ruined/varied heights → Task 5. ✓
- §4.4 start/spawns/fingerprint → Tasks 5–7 (start in hallway, spawns in niches, fingerprint folds tier+motif+arches). ✓
- §5 sim collision + LOS (`moveDude` clip, `rayHitsPlayer` height-aware, `buildArenaGeometry` top) → Tasks 1, 3, 8. ✓
- §6 cosmetic per-rect heights + arch frames + nested-ring wall → Task 9. ✓
- §7 determinism → Task 10. ✓
- Non-goals (player vertical collision, multi-floor, props/materials) → correctly absent. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases". The three `NOTE:` callouts flag real playtest-tuning checks (ring-gap connectivity, niche/cover overlap, lintel width), each with a concrete action. Acceptable.

**3. Type consistency:** `SimAABB.top`, `WALL_TOP`, `MeterRect.topMeters`, `segmentEnterTH`, `TIER_OPEN/LOW/MID/WALL`, `tierTopMeters`, `tier`, `motif`, `Arch`/`arches` are defined before use and named consistently across tasks. `moveDude(d, geo)` signature change (Task 8) updates its `stepDudes` caller. `rayHitsPlayer` exported (Task 3) and used by the same module. `bakeWallRectsMeters` returns `topMeters`; `bakeSimGeometry` maps it to `top`; `bake-cosmetic` consumes `topMeters` — consistent.
