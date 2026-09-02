# Hull-refine renderer — phase 0 spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone page that renders one walking, shootable SDF zombie (plus its severed chunks) through a per-frame GPU surface-nets hull with fragment band refinement, toggleable against the shipped march on the same scene, with the owner's three-item A/B look reel captured through the existing parity harness.

**Architecture:** One compute kernel per body extracts a conservative hull (the field at `iso = +band`) as a triangle soup into storage buffers every frame; a second one-thread kernel writes the indirect draw arguments. The soup is drawn front-faced with the SHIPPED march material, whose ray start and far bound are overridden per fragment so `marchBody` performs a short band walk and then runs its post-hit shading unchanged. `march.wgsl.ts` is not modified; `zombie-gpu.ts` gains two additive hooks.

**Tech Stack:** TypeScript, three.js 0.185 `three/webgpu` + `three/tsl` (`wgslFn`, `compute`, `storage`, `IndirectStorageBufferAttribute`, `workgroupId`/`localId`), vitest, CDP capture via `scripts/perf-r2-parity.mjs`.

**Spec:** [docs/superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md](../specs/2026-09-02-sdf-hull-refine-renderer-design.md)

---

## Deviations from the spec, decided while planning (all simplifications, none change the gate)

1. **Occupancy is a workgroup prologue, not a separate pass.** A zombie at 2 cm cells in 4-cell blocks is ~2k blocks. Every block gets a workgroup; thread 0 evaluates the field at the block centre and the block is skipped if `|f − band| > halfDiag·distort + cell`. Sound because the field is a lower bound on distance in both signs (the same Lipschitz property sphere tracing rests on), and the `+cell` margin covers the wound lip's known overstatement. No list, no indirect dispatch.
2. **Triangle soup, no index buffer.** Quads are written as six vertices. Costs ~6× vertex bytes (single-digit MB), avoids any question of storage-backed index buffers, and the vertex stage is trivial. `drawIndirect`, not `drawIndexedIndirect`.
3. **No vertex normals.** The march material computes `calcNormal` at the refined hit; the hull only needs positions.
4. **Blocks are 4³ cells, workgroup [4,4,4] = 64 threads.** WebGPU's default `maxComputeInvocationsPerWorkgroup` is 256, so 8³ is not portable.
5. **Phase 0 keeps the shipped `depthNode` and `discard`.** Early-Z is a phase-2 measurement, not a phase-0 claim. The cost report says so explicitly.
6. **Storage type is `array<f32>`, three floats per vertex,** read as an `itemSize 3` vertex attribute. `array<vec3<f32>>` has a 16-byte stride in WGSL and would not match a packed vertex layout.

## Sizes and knobs (all on the window seam)

| knob | default | sweep |
| --- | --- | --- |
| `cell` (m) | 0.02 | 0.015 / 0.02 / 0.03 |
| `band` (m) | 0.02 | 0.015 / 0.02 / 0.03 (must be ≥ cell·0.87, the corner-to-centre half diagonal, or a cell can straddle iso without its corners showing it) |
| `steps` | 4 | 4 / 8 / 12 |
| renderer | `march` | `hull` / `march` |

Capacities, fixed at boot: `MAX_DIM = 160` fine cells per axis (3.2 m at 2 cm), `MAX_BLOCKS = (160/4)³ = 64 000`, `MAX_CELL_VERTS = 65 536`, `MAX_SOUP_VERTS = 6 · 3 · MAX_CELL_VERTS` (each cell vertex touches at most three quads it owns) — 1.18 M floats · 3 = 14 MB per body. Overflow clamps and sets `meta[0] = 1`.

## File structure

| file | responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts` | **Create.** Pure TS reference of the extraction: grid fitting, block-live test, cell vertex, quad emission with winding. The kernel is a transliteration of this file, and the tests run against it. |
| `src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts` | **Create.** Conservativeness, band coverage, winding, block-skip soundness, grid fitting — all on `buildBody(compileBlob(parseBlob(zombie)))`. |
| `src/lab/sdf-zombie/webgpu/surface-nets.wgsl.ts` | **Create.** `HULL_FIELD`, `K_HULL_NETS`, `K_HULL_QUADS`, `K_HULL_ARGS` WGSL sources + row/bit constants shared with the CPU file. |
| `src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts` | **Create.** Parse contract (fn-anchored, no `word: word` in comments), argument-count contract against `MAP_BODY`, bit constants match the CPU file. |
| `src/lab/sdf-zombie/webgpu/surface-nets-compute.ts` | **Create.** Buffers, storage nodes, compute nodes, per-frame `extract()`, `readback()` for the parity check. |
| `src/lab/sdf-zombie/webgpu/surface-nets-compute.test.ts` | **Create.** Pure parts: capacity math, uniform packing, draw-arg layout. |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | **Modify.** (a) `createMarchMaterial` gains an optional `rays` override; (b) `ZombieGpuView` and `ChunkGpuView` expose `dataTexture`. Additive only. |
| `src/lab/sdf-zombie/webgpu/hull-refine-view.ts` | **Create.** Wraps a `ZombieGpuView` (and a `ChunkGpuView`) as a `HullRefineView`: same interface, plus the hull mesh, extraction on `update`, and `setRenderer`. |
| `src/lab/sdf-zombie/webgpu/hull-refine-view.test.ts` | **Create.** Delegation + toggle semantics against a fake inner view. |
| `sdf-hull-spike.html` | **Create.** Page shell, precedent `sdf-shell-spike.html`. |
| `src/lab/sdf-zombie/webgpu/hull-spike-main.ts` | **Create.** Renderer, one actor, chunks, click-to-shoot, sever/gib keys, knobs, `window.__hullSpike` seams. |
| `vite.config.ts` | **Modify.** Add `sdfHullSpike` input so `npm run build` type-checks the page. |
| `scripts/perf-r2-parity.mjs` | **Modify.** `--url` and `--seam` flags (default `/sdf-game.html`, `__sdfGame`) so the harness drives the spike page unchanged. |
| `scripts/hull-spike-reel.sh` | **Create.** The three reel items, A/B through the harness. |
| `docs/dev-notes/2026-09-02-hull-refine-spike/notes.md` | **Create.** Numbers, captures, the owner's verdict. |
| `TASKS.md` | **Modify.** Status row. |

---

### Task 1: CPU reference — grid fitting and the block-live test

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts`
- Test: `src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';
import src from '../characters/zombie.blob?raw';
import {
  BLOCK, fitHullGrid, blockLive, blockCentre, type HullGrid,
} from './surface-nets-cpu';

const zombie = () => buildBody(compileBlob(parseBlob(src)));

function bodyBounds(body: ReturnType<typeof zombie>): { centre: Vec3; half: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, c.center[i]! - c.radius);
      max[i] = Math.max(max[i]!, c.center[i]! + c.radius);
    }
  }
  return {
    centre: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2],
    half: [(max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2],
  };
}

describe('fitHullGrid', () => {
  it('pads by band + one cell and rounds dims up to whole blocks', () => {
    const g = fitHullGrid([0, 1, 0], [0.4, 0.9, 0.3], 0.02, 0.02);
    for (const d of g.dims) expect(d % BLOCK).toBe(0);
    // extent per axis must cover half*2 + 2*(band + cell)
    expect(g.dims[0] * g.cell).toBeGreaterThanOrEqual(0.8 + 0.08);
    expect(g.dims[1] * g.cell).toBeGreaterThanOrEqual(1.8 + 0.08);
    // centred: min + dims*cell/2 == centre
    for (let i = 0; i < 3; i++) {
      expect(g.min[i]! + (g.dims[i]! * g.cell) / 2).toBeCloseTo([0, 1, 0][i]!, 6);
    }
  });
  it('clamps to maxDim and reports it', () => {
    const g = fitHullGrid([0, 0, 0], [5, 5, 5], 0.02, 0.02, 160);
    expect(g.dims).toEqual([160, 160, 160]);
    expect(g.clamped).toBe(true);
  });
});

describe('blockLive', () => {
  it('never skips a block that contains a surface crossing (real zombie, 2 cm)', () => {
    const body = zombie();
    const { centre, half } = bodyBounds(body);
    const band = 0.02;
    const grid = fitHullGrid(centre, half, 0.02, band);
    const f = (p: Vec3) => sdBody(p, body) - band;
    const blocks = grid.dims.map(d => d / BLOCK) as [number, number, number];
    let live = 0, total = 0, missed = 0;
    for (let bz = 0; bz < blocks[2]; bz++) for (let by = 0; by < blocks[1]; by++) for (let bx = 0; bx < blocks[0]; bx++) {
      total++;
      const isLive = blockLive(f, grid, [bx, by, bz], 1.0);
      if (isLive) live++;
      // brute force: does any corner pair in this block straddle zero?
      let neg = false, pos = false;
      for (let k = 0; k <= BLOCK; k++) for (let j = 0; j <= BLOCK; j++) for (let i = 0; i <= BLOCK; i++) {
        const v = f([
          grid.min[0] + (bx * BLOCK + i) * grid.cell,
          grid.min[1] + (by * BLOCK + j) * grid.cell,
          grid.min[2] + (bz * BLOCK + k) * grid.cell,
        ]);
        if (v < 0) neg = true; else pos = true;
      }
      if (neg && pos && !isLive) missed++;
    }
    expect(missed).toBe(0);
    // and it actually culls: a standing zombie fills well under half its box
    expect(live / total).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts`
Expected: FAIL — cannot resolve `./surface-nets-cpu`.

- [ ] **Step 3: Implement grid fitting and the live test**

```ts
// src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts
//
// CPU REFERENCE for the surface-nets hull extraction (hull-refine spec §4).
// The WGSL kernels in surface-nets.wgsl.ts are a transliteration of this
// file; every constant they share is exported from here and pinned by
// surface-nets.wgsl.test.ts. Change one, change both, in the same commit.
//
// FIELD CONVENTION: field(p) < 0 is inside. The hull is the iso-surface of
// g(p) = field(p) - band, i.e. the flesh inflated outward by `band`, so the
// true surface lies INSIDE the hull and a fragment on the hull reaches it by
// walking inward at most ~2*band (spec §5).
import type { Vec3 } from '../types';

/** Fine cells per block edge. The kernel's workgroup is [BLOCK, BLOCK, BLOCK]. */
export const BLOCK = 4;
/** Sentinel in the cell->vertex grid: this cell owns no vertex. */
export const NO_VERT = 0xffffffff;
/** cellEdge bits. Edge e leaves corner 0 along +axis. */
export const EDGE_X_CROSS = 1, EDGE_X_IN2OUT = 2;
export const EDGE_Y_CROSS = 4, EDGE_Y_IN2OUT = 8;
export const EDGE_Z_CROSS = 16, EDGE_Z_IN2OUT = 32;

export interface HullGrid {
  /** World-space corner (0,0,0). */
  min: [number, number, number];
  cell: number;
  /** Fine cells per axis; each a multiple of BLOCK. */
  dims: [number, number, number];
  /** True when an axis hit maxDim — the hull may be cut off. */
  clamped: boolean;
}

/**
 * Grid that contains the body bounds plus band plus one cell of slack on
 * every side, rounded up to whole blocks and re-centred on `centre`.
 */
export function fitHullGrid(
  centre: Vec3, half: Vec3, cell: number, band: number, maxDim = 160,
): HullGrid {
  const dims: [number, number, number] = [0, 0, 0];
  let clamped = false;
  for (let i = 0; i < 3; i++) {
    const extent = half[i]! * 2 + 2 * (band + cell);
    let n = Math.ceil(extent / cell);
    n = Math.ceil(n / BLOCK) * BLOCK;
    if (n > maxDim) { n = maxDim; clamped = true; }
    dims[i] = Math.max(BLOCK, n);
  }
  const min: [number, number, number] = [
    centre[0] - (dims[0] * cell) / 2,
    centre[1] - (dims[1] * cell) / 2,
    centre[2] - (dims[2] * cell) / 2,
  ];
  return { min, cell, dims, clamped };
}

export function cornerPos(grid: HullGrid, i: number, j: number, k: number): Vec3 {
  return [grid.min[0] + i * grid.cell, grid.min[1] + j * grid.cell, grid.min[2] + k * grid.cell];
}

export function blockCentre(grid: HullGrid, b: readonly [number, number, number]): Vec3 {
  const h = (BLOCK * grid.cell) / 2;
  return [
    grid.min[0] + b[0] * BLOCK * grid.cell + h,
    grid.min[1] + b[1] * BLOCK * grid.cell + h,
    grid.min[2] + b[2] * BLOCK * grid.cell + h,
  ];
}

/**
 * Block-live test (plan deviation 1). `g` is the band-shifted field. A block
 * can contain a zero crossing only if |g(centre)| <= halfDiag, because g is a
 * lower bound on distance to its own zero set in both signs (|g| <= dist,
 * the sphere-tracing property), scaled by the group distortion factor.
 * The +cell margin covers the wound lip, where applyWounds' smax fillet is
 * known to overstate distance (see WOUND_SHADOW's note in march.wgsl.ts).
 */
export function blockLive(
  g: (p: Vec3) => number, grid: HullGrid, b: readonly [number, number, number], distort: number,
): boolean {
  const halfDiag = Math.sqrt(3) * (BLOCK * grid.cell) / 2;
  const v = g(blockCentre(grid, b));
  return Math.abs(v) <= halfDiag * distort + grid.cell;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts`
Expected: PASS (3 tests). The brute-force test walks ~2k blocks × 125 corners of `sdBody`; expect a few seconds.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts
git commit -m "hull: CPU reference — grid fitting and the sound block-live test"
```

---

### Task 2: CPU reference — cell vertices, edge bits, quad soup

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts`
- Test: `src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the test file)

```ts
import { extractHullSoup, gradientOf } from './surface-nets-cpu';
import { cross, dot, normalize, sub } from '../vec';

describe('extractHullSoup on the zombie', () => {
  const body = zombie();
  const band = 0.02;
  const { centre, half } = bodyBounds(body);
  const grid = fitHullGrid(centre, half, 0.02, band);
  const field = (p: Vec3) => sdBody(p, body);
  const soup = extractHullSoup(field, grid, band, 1.0);

  it('emits a hull of plausible size and no dropped quads', () => {
    expect(soup.cellVerts).toBeGreaterThan(3000);
    expect(soup.cellVerts).toBeLessThan(40000);
    expect(soup.vertCount % 3).toBe(0);
    expect(soup.droppedQuads).toBe(0);
    expect(soup.overflow).toBe(false);
  });

  it('every cell vertex sits on the band iso within one cell', () => {
    for (let v = 0; v < soup.cellVerts; v++) {
      const p: Vec3 = [soup.cellPositions[v * 3]!, soup.cellPositions[v * 3 + 1]!, soup.cellPositions[v * 3 + 2]!];
      expect(Math.abs(field(p) - band)).toBeLessThan(grid.cell);
    }
  });

  it('CONSERVATIVE: no true-surface sample lies outside the hull (200k sweep)', () => {
    // Sample the true surface by projecting random box points onto field==0
    // with a few Newton steps, then check the band-shifted field is negative
    // (inside the hull) with margin, AND that the sample's cell is one the
    // extraction marked as a surface cell or interior.
    let seed = 1234;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let outside = 0, samples = 0;
    for (let n = 0; n < 200000; n++) {
      let p: Vec3 = [
        centre[0] + (rnd() * 2 - 1) * half[0],
        centre[1] + (rnd() * 2 - 1) * half[1],
        centre[2] + (rnd() * 2 - 1) * half[2],
      ];
      let d = field(p);
      if (d > 0.15) continue;             // far from the body, skip cheaply
      for (let it = 0; it < 6; it++) {
        const g = gradientOf(field, p, 1e-3);
        p = [p[0] - d * g[0], p[1] - d * g[1], p[2] - d * g[2]];
        d = field(p);
        if (Math.abs(d) < 1e-4) break;
      }
      if (Math.abs(d) > 1e-3) continue;   // did not converge, not a surface sample
      samples++;
      // inside the hull means the band-shifted field is negative
      if (field(p) - band > -band * 0.5) outside++;
      // and the cell holding it must be a surface cell (owns a vertex) or
      // strictly interior (all 8 corners negative) — never a skipped block.
      const ci = Math.floor((p[0] - grid.min[0]) / grid.cell);
      const cj = Math.floor((p[1] - grid.min[1]) / grid.cell);
      const ck = Math.floor((p[2] - grid.min[2]) / grid.cell);
      expect(soup.cellKind(ci, cj, ck)).not.toBe('skipped');
    }
    expect(samples).toBeGreaterThan(20000);
    expect(outside).toBe(0);
  });

  it('BAND COVERAGE: from every cell vertex, walking inward <= 2*band reaches the flesh', () => {
    let fails = 0;
    for (let v = 0; v < soup.cellVerts; v++) {
      const p: Vec3 = [soup.cellPositions[v * 3]!, soup.cellPositions[v * 3 + 1]!, soup.cellPositions[v * 3 + 2]!];
      const g = gradientOf(field, p, 1e-3);
      const q: Vec3 = [p[0] - g[0] * 2 * band, p[1] - g[1] * 2 * band, p[2] - g[2] * 2 * band];
      if (field(q) > 0) fails++;
    }
    expect(fails / soup.cellVerts).toBeLessThan(0.01);
  });

  it('flags overflow when the cell-vertex cap is tiny, and never writes past it', () => {
    const tiny = extractHullSoup(field, grid, band, 1.0, 16);
    expect(tiny.overflow).toBe(true);
    expect(tiny.cellVerts).toBe(16);
  });

  it('WINDING: >= 99% of triangles face outward (normal · gradient > 0)', () => {
    let good = 0, tris = 0;
    for (let t = 0; t < soup.vertCount; t += 3) {
      const a: Vec3 = [soup.positions[t * 3]!, soup.positions[t * 3 + 1]!, soup.positions[t * 3 + 2]!];
      const b: Vec3 = [soup.positions[t * 3 + 3]!, soup.positions[t * 3 + 4]!, soup.positions[t * 3 + 5]!];
      const c: Vec3 = [soup.positions[t * 3 + 6]!, soup.positions[t * 3 + 7]!, soup.positions[t * 3 + 8]!];
      const n = cross(sub(b, a), sub(c, a));
      if (dot(n, n) < 1e-14) continue;     // degenerate, counted separately
      tris++;
      const cen: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (dot(normalize(n), gradientOf(field, cen, 1e-3)) > 0) good++;
    }
    expect(tris).toBeGreaterThan(0);
    expect(good / tris).toBeGreaterThan(0.99);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts`
Expected: FAIL — `extractHullSoup` / `gradientOf` not exported.

- [ ] **Step 3: Implement extraction** (append to `surface-nets-cpu.ts`)

```ts
export interface HullSoup {
  /** Triangle soup, 3 floats per vertex, world space. */
  positions: Float32Array;
  vertCount: number;
  /** One position per surface cell (the quad corners), for tests/parity. */
  cellPositions: Float32Array;
  cellVerts: number;
  blocksLive: number;
  blocksTotal: number;
  /** Quads whose four cells were not all surface cells (must be 0). */
  droppedQuads: number;
  overflow: boolean;
  cellKind(i: number, j: number, k: number): 'surface' | 'interior' | 'exterior' | 'skipped';
}

export function gradientOf(field: (p: Vec3) => number, p: Vec3, h: number): Vec3 {
  const g: [number, number, number] = [
    field([p[0] + h, p[1], p[2]]) - field([p[0] - h, p[1], p[2]]),
    field([p[0], p[1] + h, p[2]]) - field([p[0], p[1] - h, p[2]]),
    field([p[0], p[1], p[2] + h]) - field([p[0], p[1], p[2] - h]),
  ];
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

/** The 12 cube edges as corner-index pairs; corner bit order = x | y<<1 | z<<2. */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],   // along x
  [0, 2], [1, 3], [4, 6], [5, 7],   // along y
  [0, 4], [1, 5], [2, 6], [3, 7],   // along z
];

/**
 * Sparse surface nets over the band-shifted field. Two passes, exactly as the
 * kernels do it: (1) per live block, per cell: vertex + edge bits; dead
 * blocks write edge bits 0. (2) per cell with edge bits: one quad per
 * crossing +axis edge, linking the four cells around that edge.
 */
export function extractHullSoup(
  field: (p: Vec3) => number, grid: HullGrid, band: number, distort: number,
  maxCellVerts = 65536,
): HullSoup {
  const g = (p: Vec3) => field(p) - band;
  const [nx, ny, nz] = grid.dims;
  const cellCount = nx * ny * nz;
  const cellVert = new Uint32Array(cellCount).fill(NO_VERT);
  const cellEdge = new Uint8Array(cellCount);
  const kind = new Uint8Array(cellCount); // 0 skipped, 1 exterior, 2 interior, 3 surface
  const cellPositions = new Float32Array(maxCellVerts * 3);
  let cellVerts = 0;
  let overflow = false;

  // Corner cache: corners are shared by 8 cells; evaluate each once.
  const cx = nx + 1, cy = ny + 1;
  const corner = new Float32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(NaN);
  const cornerVal = (i: number, j: number, k: number) => {
    const idx = (k * cy + j) * cx + i;
    let v = corner[idx]!;
    if (Number.isNaN(v)) { v = g(cornerPos(grid, i, j, k)); corner[idx] = v; }
    return v;
  };
  const cellIndex = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  const blocks: [number, number, number] = [nx / BLOCK, ny / BLOCK, nz / BLOCK];
  let blocksLive = 0;
  const blocksTotal = blocks[0] * blocks[1] * blocks[2];

  // ---- pass 1: vertices + edge bits -------------------------------------
  for (let bz = 0; bz < blocks[2]; bz++) for (let by = 0; by < blocks[1]; by++) for (let bx = 0; bx < blocks[0]; bx++) {
    const live = blockLive(g, grid, [bx, by, bz], distort);
    if (live) blocksLive++;
    for (let lk = 0; lk < BLOCK; lk++) for (let lj = 0; lj < BLOCK; lj++) for (let li = 0; li < BLOCK; li++) {
      const i = bx * BLOCK + li, j = by * BLOCK + lj, k = bz * BLOCK + lk;
      const ci = cellIndex(i, j, k);
      if (!live) { cellEdge[ci] = 0; cellVert[ci] = NO_VERT; kind[ci] = 0; continue; }
      const v = [
        cornerVal(i, j, k),         cornerVal(i + 1, j, k),
        cornerVal(i, j + 1, k),     cornerVal(i + 1, j + 1, k),
        cornerVal(i, j, k + 1),     cornerVal(i + 1, j, k + 1),
        cornerVal(i, j + 1, k + 1), cornerVal(i + 1, j + 1, k + 1),
      ];
      let neg = 0;
      for (let c = 0; c < 8; c++) if (v[c]! < 0) neg |= 1 << c;
      let bits = 0;
      if (((neg >> 0) & 1) !== ((neg >> 1) & 1)) bits |= EDGE_X_CROSS | (v[0]! < 0 ? EDGE_X_IN2OUT : 0);
      if (((neg >> 0) & 1) !== ((neg >> 2) & 1)) bits |= EDGE_Y_CROSS | (v[0]! < 0 ? EDGE_Y_IN2OUT : 0);
      if (((neg >> 0) & 1) !== ((neg >> 4) & 1)) bits |= EDGE_Z_CROSS | (v[0]! < 0 ? EDGE_Z_IN2OUT : 0);
      cellEdge[ci] = bits;
      if (neg === 0 || neg === 0xff) {
        cellVert[ci] = NO_VERT; kind[ci] = neg === 0 ? 1 : 2; continue;
      }
      // mean of edge crossings
      let sx = 0, sy = 0, sz = 0, n = 0;
      const base = cornerPos(grid, i, j, k);
      for (const [a, b] of EDGES) {
        const va = v[a]!, vb = v[b]!;
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
        const bxx = b & 1, byy = (b >> 1) & 1, bzz = (b >> 2) & 1;
        sx += ax + (bxx - ax) * t; sy += ay + (byy - ay) * t; sz += az + (bzz - az) * t; n++;
      }
      if (cellVerts >= maxCellVerts) { overflow = true; cellVert[ci] = NO_VERT; kind[ci] = 3; continue; }
      const id = cellVerts++;
      cellPositions[id * 3] = base[0] + (sx / n) * grid.cell;
      cellPositions[id * 3 + 1] = base[1] + (sy / n) * grid.cell;
      cellPositions[id * 3 + 2] = base[2] + (sz / n) * grid.cell;
      cellVert[ci] = id; kind[ci] = 3;
    }
  }

  // ---- pass 2: quads ---------------------------------------------------------
  // Around the +x edge of cell (i,j,k) sit cells (i,j,k) (i,j-1,k) (i,j-1,k-1)
  // (i,j,k-1); that cyclic order has normal +x (right-hand, y toward z).
  // Cyclic symmetry gives y: (k,i) and z: (i,j) orderings.
  const positions = new Float32Array(maxCellVerts * 3 * 6 * 3);
  let vertCount = 0;
  let droppedQuads = 0;
  const pushV = (id: number) => {
    positions[vertCount * 3] = cellPositions[id * 3]!;
    positions[vertCount * 3 + 1] = cellPositions[id * 3 + 1]!;
    positions[vertCount * 3 + 2] = cellPositions[id * 3 + 2]!;
    vertCount++;
  };
  const emitQuad = (q: [number, number, number, number], flip: boolean) => {
    const [a, b, c, d] = flip ? [q[0], q[3], q[2], q[1]] : q;
    pushV(a); pushV(b); pushV(c);
    pushV(a); pushV(c); pushV(d);
  };
  const vertAt = (i: number, j: number, k: number) =>
    (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? NO_VERT : cellVert[cellIndex(i, j, k)]!;

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const bits = cellEdge[cellIndex(i, j, k)]!;
    if (bits === 0) continue;
    if (bits & EDGE_X_CROSS) {
      const q: [number, number, number, number] = [vertAt(i, j, k), vertAt(i, j - 1, k), vertAt(i, j - 1, k - 1), vertAt(i, j, k - 1)];
      if (q.includes(NO_VERT)) droppedQuads++; else emitQuad(q, (bits & EDGE_X_IN2OUT) === 0);
    }
    if (bits & EDGE_Y_CROSS) {
      const q: [number, number, number, number] = [vertAt(i, j, k), vertAt(i, j, k - 1), vertAt(i - 1, j, k - 1), vertAt(i - 1, j, k)];
      if (q.includes(NO_VERT)) droppedQuads++; else emitQuad(q, (bits & EDGE_Y_IN2OUT) === 0);
    }
    if (bits & EDGE_Z_CROSS) {
      const q: [number, number, number, number] = [vertAt(i, j, k), vertAt(i - 1, j, k), vertAt(i - 1, j - 1, k), vertAt(i, j - 1, k)];
      if (q.includes(NO_VERT)) droppedQuads++; else emitQuad(q, (bits & EDGE_Z_IN2OUT) === 0);
    }
  }

  return {
    positions: positions.subarray(0, vertCount * 3),
    vertCount,
    cellPositions: cellPositions.subarray(0, cellVerts * 3),
    cellVerts, blocksLive, blocksTotal, droppedQuads, overflow,
    cellKind(i, j, k) {
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 'skipped';
      return (['skipped', 'exterior', 'interior', 'surface'] as const)[kind[cellIndex(i, j, k)]!]!;
    },
  };
}
```

Winding note for the implementer: the flip condition is "corner 0 is OUTSIDE" (`IN2OUT` bit clear). With corner 0 inside and corner 1 outside, the surface normal along that edge points +x, which is the un-flipped order's normal. The WINDING test is the check; if it reports ~1% instead of ~99%, the flip sense is inverted — swap it, do not touch the orderings.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts`
Expected: PASS (9 tests). The sweep test is the slowest (~10 s). If `droppedQuads` is nonzero, the grid padding is too small — `fitHullGrid` must keep one cell of slack, which Task 1's test asserts.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/surface-nets-cpu.ts src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts
git commit -m "hull: CPU surface nets — vertices, edge bits, outward-wound quad soup, proven conservative on the zombie"
```

---

### Task 3: WGSL kernels + parse contract

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/surface-nets.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { MAP_BODY } from './march.wgsl';
import {
  HULL_FIELD, K_HULL_NETS, K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS, K_HULL_ARGS,
  HULL_NETS_CHAIN, HULL_QUADS_CHAIN, MAX_SOUP_VERTS,
} from './surface-nets.wgsl';
import { BLOCK, NO_VERT, EDGE_X_CROSS, EDGE_X_IN2OUT, EDGE_Y_CROSS, EDGE_Y_IN2OUT, EDGE_Z_CROSS, EDGE_Z_IN2OUT } from './surface-nets-cpu';

/** three's wgslFn parser: ^-anchored `fn`, and it scrapes `name: type` pairs
 *  out of the parameter list INCLUDING comments — a colon between two words
 *  inside the signature is a phantom parameter. */
function signature(src: string): string {
  const open = src.indexOf('(');
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}

describe('surface-nets WGSL parse contract', () => {
  for (const [name, src] of Object.entries({ HULL_FIELD, K_HULL_NETS, K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS, K_HULL_ARGS })) {
    it(`${name} starts with fn and has no colon-in-comment in its signature`, () => {
      expect(src.startsWith('fn ')).toBe(true);
      const sig = signature(src);
      for (const line of sig.split('\n')) {
        const c = line.indexOf('//');
        if (c >= 0) expect(line.slice(c)).not.toMatch(/\w\s*:\s*\w/);
      }
    });
  }
  it('HULL_FIELD passes mapBody exactly the arguments MAP_BODY declares', () => {
    const declared = signature(MAP_BODY).split(',').length;
    const call = HULL_FIELD.match(/mapBody\(([^;]*)\)\.x/)![1]!;
    // count top-level commas in the call
    let depth = 0, n = 1;
    for (const ch of call) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) n++; }
    expect(n).toBe(declared);
  });
  it('kernel constants match the CPU reference, each declared ONCE per chain', () => {
    expect(K_HULL_NETS).toContain(`const BLOCK: i32 = ${BLOCK};`);
    expect(K_HULL_NETS).toContain(`const NO_VERT: u32 = ${NO_VERT}u;`);
    expect(K_VERT_AT).toContain(`const NO_VERT: u32 = ${NO_VERT}u;`);
    expect(K_EMIT_QUAD).toContain(`const MAX_SOUP_VERTS: u32 = ${MAX_SOUP_VERTS}u;`);
    expect(K_HULL_ARGS).toContain(`const MAX_SOUP_VERTS: u32 = ${MAX_SOUP_VERTS}u;`);
    for (const [k, v] of Object.entries({ EDGE_X_CROSS, EDGE_X_IN2OUT, EDGE_Y_CROSS, EDGE_Y_IN2OUT, EDGE_Z_CROSS, EDGE_Z_IN2OUT })) {
      expect(K_HULL_NETS).toContain(`const ${k}: u32 = ${v}u;`);
      expect(K_HULL_QUADS).toContain(`const ${k}: u32 = ${v}u;`);
    }
    // A module-scope const declared twice in one chain is a WGSL error.
    const quadsModule = HULL_QUADS_CHAIN.join('\n');
    expect(quadsModule.match(/const NO_VERT:/g)!.length).toBe(1);
    expect(quadsModule.match(/const MAX_SOUP_VERTS:/g)!.length).toBe(1);
  });
  it('chains are in dependency order', () => {
    expect(HULL_NETS_CHAIN).toEqual([HULL_FIELD, K_HULL_NETS]);
    expect(HULL_QUADS_CHAIN).toEqual([K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the kernels**

Module-scope declarations (`const`, `var<workgroup>`) go at the TAIL of a source, after the closing brace, because three's parser is `^`-anchored on `fn` and re-emits the remainder verbatim at module scope (the `var<private>` precedent at `march.wgsl.ts` ~line 983). Every storage parameter in a COMPUTE kernel is `read_write`, even when only read (`tile-bin-compute.ts` access-mode note).

```ts
// src/lab/sdf-zombie/webgpu/surface-nets.wgsl.ts
//
// GPU surface-nets hull extraction (hull-refine spec §4; plan deviation 1
// folds occupancy into the kernel prologue). A transliteration of
// surface-nets-cpu.ts — read that file's comments first; this one only notes
// what differs on the GPU.
//
// gridCfg  = (cell, band, distort, blocksX)
// gridDims = (dimsX, dimsY, dimsZ, blocksY)      fine cells / blocks
// origin   = the hull mesh's world position; vertices are written RELATIVE
//            to it so positionWorld in the march material comes out right.

/** The band-shifted tracer field: mapBody at noiseAmp 0 (the march loop's
 *  own field — march.wgsl.ts ~1801 passes 0.0 too), minus band. */
export const HULL_FIELD = /* wgsl */ `fn hullField(p: vec3<f32>, band: f32, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>) -> f32 {
  return mapBody(p, data, counts, counts2, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg).x - band;
}`;

/**
 * Pass 1. One workgroup [4,4,4] per block; wid.x is the linear block index
 * (three dispatches ceil(count/64) workgroups along x). Thread 0 runs the
 * live test into shared memory; a barrier; dead blocks zero their edge bits
 * and leave. Live blocks fill a 5x5x5 corner tile (125 corners over 64
 * threads, two each), barrier, then each thread does its cell.
 */
export const K_HULL_NETS = /* wgsl */ `fn kHullNets(
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  perfCfg: vec4<f32>,
  gridMin: vec3<f32>,
  gridCfg: vec4<f32>,
  gridDims: vec4<f32>,
  origin: vec3<f32>,
  cellVert: ptr<storage, array<u32>, read_write>,
  cellEdge: ptr<storage, array<u32>, read_write>,
  cellPos: ptr<storage, array<f32>, read_write>,
  counters: ptr<storage, array<atomic<u32>>, read_write>,
  wid: vec3<u32>,
  lid: vec3<u32>
) -> void {
  let cell = gridCfg.x;
  let band = gridCfg.y;
  let distort = gridCfg.z;
  let blocksX = u32(gridCfg.w);
  let blocksY = u32(gridDims.w);
  let dims = vec3<i32>(i32(gridDims.x), i32(gridDims.y), i32(gridDims.z));
  let blockCount = blocksX * blocksY * u32(dims.z / BLOCK);
  let b = wid.x;
  if (b >= blockCount) { return; }
  let bx = i32(b % blocksX);
  let by = i32((b / blocksX) % blocksY);
  let bz = i32(b / (blocksX * blocksY));
  let blockOrigin = gridMin + vec3<f32>(f32(bx), f32(by), f32(bz)) * (f32(BLOCK) * cell);
  let lin = lid.x + lid.y * u32(BLOCK) + lid.z * u32(BLOCK) * u32(BLOCK);

  if (lin == 0u) {
    let halfDiag = sqrt(3.0) * f32(BLOCK) * cell * 0.5;
    let c = blockOrigin + vec3<f32>(f32(BLOCK) * cell * 0.5);
    let v = hullField(c, band, data, counts, counts2, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg);
    gBlockLive = select(0u, 1u, abs(v) <= halfDiag * distort + cell);
  }
  workgroupBarrier();

  let i = bx * BLOCK + i32(lid.x);
  let j = by * BLOCK + i32(lid.y);
  let k = bz * BLOCK + i32(lid.z);
  let ci = u32((k * dims.y + j) * dims.x + i);
  if (gBlockLive == 0u) {
    (*cellEdge)[ci] = 0u;
    (*cellVert)[ci] = NO_VERT;
    return;
  }

  // 125 corners, two per thread (64 threads cover 128 slots).
  for (var s = 0u; s < 2u; s = s + 1u) {
    let cidx = lin + s * 64u;
    if (cidx < 125u) {
      let cx = i32(cidx % 5u);
      let cy = i32((cidx / 5u) % 5u);
      let cz = i32(cidx / 25u);
      let p = blockOrigin + vec3<f32>(f32(cx), f32(cy), f32(cz)) * cell;
      gTile[cidx] = hullField(p, band, data, counts, counts2, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg);
    }
  }
  workgroupBarrier();

  let lx = i32(lid.x); let ly = i32(lid.y); let lz = i32(lid.z);
  var v: array<f32, 8>;
  for (var c = 0; c < 8; c = c + 1) {
    let ox = c & 1; let oy = (c >> 1) & 1; let oz = (c >> 2) & 1;
    v[c] = gTile[(lz + oz) * 25 + (ly + oy) * 5 + (lx + ox)];
  }
  var neg = 0u;
  for (var c = 0; c < 8; c = c + 1) { if (v[c] < 0.0) { neg = neg | (1u << u32(c)); } }
  var bits = 0u;
  let in0 = (neg & 1u) != 0u;
  if (in0 != ((neg & 2u) != 0u)) { bits = bits | EDGE_X_CROSS | select(0u, EDGE_X_IN2OUT, in0); }
  if (in0 != ((neg & 4u) != 0u)) { bits = bits | EDGE_Y_CROSS | select(0u, EDGE_Y_IN2OUT, in0); }
  if (in0 != ((neg & 16u) != 0u)) { bits = bits | EDGE_Z_CROSS | select(0u, EDGE_Z_IN2OUT, in0); }
  (*cellEdge)[ci] = bits;
  if (neg == 0u || neg == 255u) { (*cellVert)[ci] = NO_VERT; return; }

  // The 12 cube edges, derived arithmetically (no const-array runtime
  // indexing — some WGSL compilers reject it): edge e has axis e/4 and
  // lower corner a with that axis bit clear; b = a | axisBit.
  var sum = vec3<f32>(0.0);
  var n = 0.0;
  for (var e = 0; e < 12; e = e + 1) {
    let axis = e / 4;
    let w = e % 4;
    var a = 0;
    var axisBit = 1;
    if (axis == 0) { a = w << 1; axisBit = 1; }
    else if (axis == 1) { a = (w & 1) | ((w >> 1) << 2); axisBit = 2; }
    else { a = w; axisBit = 4; }
    let bb = a | axisBit;
    let va = v[a]; let vb = v[bb];
    if ((va < 0.0) == (vb < 0.0)) { continue; }
    let t = va / (va - vb);
    let pa = vec3<f32>(f32(a & 1), f32((a >> 1) & 1), f32((a >> 2) & 1));
    let pb = vec3<f32>(f32(bb & 1), f32((bb >> 1) & 1), f32((bb >> 2) & 1));
    sum = sum + mix(pa, pb, t);
    n = n + 1.0;
  }
  let id = atomicAdd(&(*counters)[0], 1u);
  if (id >= u32(MAX_CELL_VERTS)) {
    atomicStore(&(*counters)[2], 1u);
    (*cellVert)[ci] = NO_VERT;
    return;
  }
  let p = blockOrigin + vec3<f32>(f32(lx), f32(ly), f32(lz)) * cell + (sum / n) * cell - origin;
  (*cellPos)[id * 3u] = p.x;
  (*cellPos)[id * 3u + 1u] = p.y;
  (*cellPos)[id * 3u + 2u] = p.z;
  (*cellVert)[ci] = id;
}
const BLOCK: i32 = 4;
const NO_VERT: u32 = 4294967295u;
const MAX_CELL_VERTS: i32 = 65536;
const EDGE_X_CROSS: u32 = 1u;
const EDGE_X_IN2OUT: u32 = 2u;
const EDGE_Y_CROSS: u32 = 4u;
const EDGE_Y_IN2OUT: u32 = 8u;
const EDGE_Z_CROSS: u32 = 16u;
const EDGE_Z_IN2OUT: u32 = 32u;
var<workgroup> gBlockLive: u32;
var<workgroup> gTile: array<f32, 125>;`;

/** Pass-2 helpers, each its own chained source (the wgslFn parser is
 *  ^-anchored on ONE fn per source, so helpers cannot share a string with
 *  the kernel). Order: vertAt, putV, emitQuad, then the kernel. */
export const K_VERT_AT = /* wgsl */ `fn vertAt(i: i32, j: i32, k: i32, dims: vec3<i32>, cellVert: ptr<storage, array<u32>, read_write>) -> u32 {
  if (i < 0 || j < 0 || k < 0 || i >= dims.x || j >= dims.y || k >= dims.z) { return NO_VERT; }
  return (*cellVert)[u32((k * dims.y + j) * dims.x + i)];
}
const NO_VERT: u32 = 4294967295u;`;

export const K_PUT_V = /* wgsl */ `fn putV(id: u32, at: u32, cellPos: ptr<storage, array<f32>, read_write>, soup: ptr<storage, array<f32>, read_write>) -> void {
  (*soup)[at * 3u] = (*cellPos)[id * 3u];
  (*soup)[at * 3u + 1u] = (*cellPos)[id * 3u + 1u];
  (*soup)[at * 3u + 2u] = (*cellPos)[id * 3u + 2u];
}`;

export const K_EMIT_QUAD = /* wgsl */ `fn emitQuad(qIn: vec4<u32>, flip: bool, cellPos: ptr<storage, array<f32>, read_write>, soup: ptr<storage, array<f32>, read_write>, counters: ptr<storage, array<atomic<u32>>, read_write>) -> void {
  if (qIn.x == NO_VERT || qIn.y == NO_VERT || qIn.z == NO_VERT || qIn.w == NO_VERT) {
    atomicAdd(&(*counters)[3], 1u);
    return;
  }
  let q = select(qIn, vec4<u32>(qIn.x, qIn.w, qIn.z, qIn.y), flip);
  let base = atomicAdd(&(*counters)[1], 6u);
  if (base + 6u > MAX_SOUP_VERTS) { atomicStore(&(*counters)[2], 1u); return; }
  putV(q.x, base, cellPos, soup);      putV(q.y, base + 1u, cellPos, soup); putV(q.z, base + 2u, cellPos, soup);
  putV(q.x, base + 3u, cellPos, soup); putV(q.z, base + 4u, cellPos, soup); putV(q.w, base + 5u, cellPos, soup);
}
const MAX_SOUP_VERTS: u32 = 1179648u;`;

/**
 * Pass 2. One thread per cell (linear instanceIndex). Emits up to three
 * quads as six vertices each into the soup, reading neighbours' cell
 * vertices. Dead blocks wrote edge bits 0 in pass 1, so stale cellVert
 * entries are never read. Soup vertices are the cell positions copied —
 * the vertex stage needs nothing but a position.
 */
export const K_HULL_QUADS = /* wgsl */ `fn kHullQuads(
  gridDims: vec4<f32>,
  cellVert: ptr<storage, array<u32>, read_write>,
  cellEdge: ptr<storage, array<u32>, read_write>,
  cellPos: ptr<storage, array<f32>, read_write>,
  soup: ptr<storage, array<f32>, read_write>,
  counters: ptr<storage, array<atomic<u32>>, read_write>,
  gi: u32
) -> void {
  let dims = vec3<i32>(i32(gridDims.x), i32(gridDims.y), i32(gridDims.z));
  let cellCount = u32(dims.x * dims.y * dims.z);
  if (gi >= cellCount) { return; }
  let bits = (*cellEdge)[gi];
  if (bits == 0u) { return; }
  let i = i32(gi % u32(dims.x));
  let j = i32((gi / u32(dims.x)) % u32(dims.y));
  let k = i32(gi / u32(dims.x * dims.y));

  if ((bits & EDGE_X_CROSS) != 0u) {
    let q = vec4<u32>(vertAt(i, j, k, dims, cellVert), vertAt(i, j - 1, k, dims, cellVert), vertAt(i, j - 1, k - 1, dims, cellVert), vertAt(i, j, k - 1, dims, cellVert));
    emitQuad(q, (bits & EDGE_X_IN2OUT) == 0u, cellPos, soup, counters);
  }
  if ((bits & EDGE_Y_CROSS) != 0u) {
    let q = vec4<u32>(vertAt(i, j, k, dims, cellVert), vertAt(i, j, k - 1, dims, cellVert), vertAt(i - 1, j, k - 1, dims, cellVert), vertAt(i - 1, j, k, dims, cellVert));
    emitQuad(q, (bits & EDGE_Y_IN2OUT) == 0u, cellPos, soup, counters);
  }
  if ((bits & EDGE_Z_CROSS) != 0u) {
    let q = vec4<u32>(vertAt(i, j, k, dims, cellVert), vertAt(i - 1, j, k, dims, cellVert), vertAt(i - 1, j - 1, k, dims, cellVert), vertAt(i, j - 1, k, dims, cellVert));
    emitQuad(q, (bits & EDGE_Z_IN2OUT) == 0u, cellPos, soup, counters);
  }
}
const EDGE_X_CROSS: u32 = 1u;
const EDGE_X_IN2OUT: u32 = 2u;
const EDGE_Y_CROSS: u32 = 4u;
const EDGE_Y_IN2OUT: u32 = 8u;
const EDGE_Z_CROSS: u32 = 16u;
const EDGE_Z_IN2OUT: u32 = 32u;`;

/**
 * Pass 3, one thread. drawIndirect args = (vertexCount, instanceCount,
 * firstVertex, firstInstance). Clamped to capacity; overflow flag already
 * set by whichever kernel hit it. Also snapshots the counters into meta for
 * the page's stats readback.
 */
export const K_HULL_ARGS = /* wgsl */ `fn kHullArgs(
  counters: ptr<storage, array<atomic<u32>>, read_write>,
  args: ptr<storage, array<u32>, read_write>,
  meta: ptr<storage, array<u32>, read_write>
) -> void {
  let verts = min(atomicLoad(&(*counters)[1]), MAX_SOUP_VERTS);
  (*args)[0] = verts;
  (*args)[1] = 1u;
  (*args)[2] = 0u;
  (*args)[3] = 0u;
  (*meta)[0] = atomicLoad(&(*counters)[2]);
  (*meta)[1] = atomicLoad(&(*counters)[0]);
  (*meta)[2] = verts;
  (*meta)[3] = atomicLoad(&(*counters)[3]);
}
const MAX_SOUP_VERTS: u32 = 1179648u;`;

/** Chain for pass 1: the march HELPERS, then the field, then the kernel. */
export const HULL_NETS_CHAIN = [HULL_FIELD, K_HULL_NETS];
/** Chain for pass 2: the three helpers, then the kernel. Order load-bearing. */
export const HULL_QUADS_CHAIN = [K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS];

/** counters layout: 0 cell verts, 1 soup verts, 2 overflow flag, 3 dropped quads. */
export const COUNTER_CELL_VERTS = 0, COUNTER_SOUP_VERTS = 1, COUNTER_OVERFLOW = 2, COUNTER_DROPPED = 3;
export const MAX_CELL_VERTS = 65536;
export const MAX_SOUP_VERTS = MAX_CELL_VERTS * 3 * 6;
```

Implementer note: `1179648u` must equal `MAX_CELL_VERTS * 3 * 6`; the constants test pins it in both `K_EMIT_QUAD` and `K_HULL_ARGS`. Each kernel is its own shader module (its own compute node), so `NO_VERT` and the `EDGE_*` constants may appear once per chain but never twice within one chain — the test counts them.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/surface-nets.wgsl.ts src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts
git commit -m "hull: surface-nets WGSL kernels — nets, quads, indirect args — with the parse contract pinned"
```

---

### Task 4: `surface-nets-compute.ts` — buffers, nodes, dispatch, readback

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/surface-nets-compute.ts`
- Test: `src/lab/sdf-zombie/webgpu/surface-nets-compute.test.ts`

- [ ] **Step 1: Write the failing tests** (pure parts only; there is no WebGPU in vitest)

```ts
// src/lab/sdf-zombie/webgpu/surface-nets-compute.test.ts
import { describe, expect, it } from 'vitest';
import { hullCapacities, packGridUniforms, MAX_DIM } from './surface-nets-compute';
import { BLOCK, fitHullGrid } from './surface-nets-cpu';
import { MAX_CELL_VERTS, MAX_SOUP_VERTS } from './surface-nets.wgsl';

describe('hullCapacities', () => {
  it('sizes every buffer for the worst case and the soup for six verts per quad', () => {
    const c = hullCapacities();
    expect(c.cells).toBe(MAX_DIM ** 3);
    expect(c.blocks).toBe((MAX_DIM / BLOCK) ** 3);
    expect(c.cellVerts).toBe(MAX_CELL_VERTS);
    expect(c.soupVerts).toBe(MAX_SOUP_VERTS);
    expect(c.soupFloats).toBe(MAX_SOUP_VERTS * 3);
  });
});

describe('packGridUniforms', () => {
  it('writes cell/band/distort/blocksX and dims/blocksY the kernel expects', () => {
    const grid = fitHullGrid([0, 1, 0], [0.4, 0.9, 0.3], 0.02, 0.02);
    const out = packGridUniforms(grid, 0.02, 1.7);
    expect(out.gridCfg).toEqual([0.02, 0.02, 1.7, grid.dims[0] / BLOCK]);
    expect(out.gridDims).toEqual([grid.dims[0], grid.dims[1], grid.dims[2], grid.dims[1] / BLOCK]);
    expect(out.blockCount).toBe((grid.dims[0] / BLOCK) * (grid.dims[1] / BLOCK) * (grid.dims[2] / BLOCK));
    expect(out.cellCount).toBe(grid.dims[0] * grid.dims[1] * grid.dims[2]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-compute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/surface-nets-compute.ts
//
// GPU side of the hull extraction: buffers sized ONCE at the worst case,
// compute nodes built once, a per-frame extract() that moves only uniforms
// (the tile-bin-compute rule: grids come from uniforms, never from resource
// dimensions, so no pipeline churn). Consumers draw the soup through
// `soupAttribute` (a StorageBufferAttribute used as the geometry's position,
// itemSize 3) with `indirect` as the draw arguments.
import * as THREE from 'three/webgpu';
import { wgslFn, uniform, storage, instanceIndex, compute, workgroupId, localId, texture, texture3D } from 'three/tsl';
import { HELPERS } from './march.wgsl';
import type { MarchUniforms } from './zombie-gpu';
import { BLOCK, fitHullGrid, type HullGrid } from './surface-nets-cpu';
import {
  HULL_NETS_CHAIN, HULL_QUADS_CHAIN, K_HULL_ARGS,
  MAX_CELL_VERTS, MAX_SOUP_VERTS,
} from './surface-nets.wgsl';

export const MAX_DIM = 160;

export function hullCapacities() {
  return {
    cells: MAX_DIM ** 3,
    blocks: (MAX_DIM / BLOCK) ** 3,
    cellVerts: MAX_CELL_VERTS,
    soupVerts: MAX_SOUP_VERTS,
    soupFloats: MAX_SOUP_VERTS * 3,
  };
}

export function packGridUniforms(grid: HullGrid, band: number, distort: number) {
  const bx = grid.dims[0] / BLOCK, by = grid.dims[1] / BLOCK, bz = grid.dims[2] / BLOCK;
  return {
    gridCfg: [grid.cell, band, distort, bx] as [number, number, number, number],
    gridDims: [grid.dims[0], grid.dims[1], grid.dims[2], by] as [number, number, number, number],
    blockCount: bx * by * bz,
    cellCount: grid.dims[0] * grid.dims[1] * grid.dims[2],
  };
}

/** Kernel chain: the march HELPERS (one edge each — NOT acc.slice(), the
 *  quadratic form was a 57 s boot), then the hull sources on the end. */
function chainOf(sources: readonly string[]) {
  return sources.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
}
function buildKernels() {
  // Pass 1 needs the whole march field; pass 2 only its three helpers.
  const nets = chainOf([...HELPERS, ...HULL_NETS_CHAIN]).at(-1)!;
  const quads = chainOf(HULL_QUADS_CHAIN).at(-1)!;
  const args = wgslFn(K_HULL_ARGS);
  return { nets, quads, args };
}

export interface HullExtractStats {
  cellVerts: number; soupVerts: number; overflow: boolean; dropped: number;
  blockCount: number; cellCount: number; grid: HullGrid;
}

export interface SurfaceNetsCompute {
  /** Geometry position source (itemSize 3). */
  soupAttribute: THREE.StorageBufferAttribute;
  /** drawIndirect arguments (vertexCount, 1, 0, 0). */
  indirect: THREE.IndirectStorageBufferAttribute;
  /** Run the three kernels for one body. Call after the body's data texture
   *  has been uploaded for this frame. */
  extract(renderer: THREE.WebGPURenderer, centre: THREE.Vector3, half: THREE.Vector3, origin: THREE.Vector3,
          cell: number, band: number, distort: number): HullExtractStats;
  /** Test/parity only: meta + cell positions back to the CPU. */
  readback(renderer: THREE.WebGPURenderer): Promise<{ meta: Uint32Array; cellPos: Float32Array; soup: Float32Array }>;
  dispose(): void;
}

export function createSurfaceNetsCompute(
  dataTex: THREE.Texture, volumeTex: THREE.Texture, u: MarchUniforms,
): SurfaceNetsCompute {
  const cap = hullCapacities();
  const cellVertAttr = new THREE.StorageBufferAttribute(cap.cells, 1);
  const cellEdgeAttr = new THREE.StorageBufferAttribute(cap.cells, 1);
  const cellPosAttr = new THREE.StorageBufferAttribute(cap.cellVerts * 3, 1);
  const soupAttr = new THREE.StorageBufferAttribute(cap.soupVerts, 3);
  const countersAttr = new THREE.StorageBufferAttribute(4, 1);
  const metaAttr = new THREE.StorageBufferAttribute(4, 1);
  const indirect = new THREE.IndirectStorageBufferAttribute(4, 1);

  const cellVert = storage(cellVertAttr, 'uint', cap.cells);
  const cellEdge = storage(cellEdgeAttr, 'uint', cap.cells);
  const cellPos = storage(cellPosAttr, 'float', cap.cellVerts * 3);
  const soup = storage(soupAttr, 'float', cap.soupVerts * 3);
  const counters = storage(countersAttr, 'uint', 4).toAtomic();
  const meta = storage(metaAttr, 'uint', 4);
  const args = storage(indirect, 'uint', 4);

  const uGridMin = uniform(new THREE.Vector3());
  const uGridCfg = uniform(new THREE.Vector4());
  const uGridDims = uniform(new THREE.Vector4());
  const uOrigin = uniform(new THREE.Vector3());

  const k = buildKernels();
  // POSITIONAL against the WGSL signatures. Re-read the parameter list in
  // surface-nets.wgsl.ts before touching this call — a misordered slot dies
  // at pipeline creation with a bare type-mismatch.
  const netsCall = k.nets(
    texture(dataTex), texture3D(volumeTex),
    u.counts, u.counts2, u.woundCfg, u.woundCfg2,
    u.volumePose0, u.volumePose1, u.volumeMin, u.volumeInvExtent, u.volumeWarp, u.volumeClip, u.perfCfg,
    uGridMin, uGridCfg, uGridDims, uOrigin,
    cellVert, cellEdge, cellPos, counters,
    workgroupId, localId,
  );
  const quadsCall = k.quads(uGridDims, cellVert, cellEdge, cellPos, soup, counters, instanceIndex);
  const argsCall = k.args(counters, args, meta);

  // Worst-case dispatch counts; kernels early-out past the live grid.
  const netsNode = compute(netsCall, cap.blocks * BLOCK ** 3, [BLOCK, BLOCK, BLOCK]);
  const quadsNode = compute(quadsCall, cap.cells, [64]);
  const argsNode = compute(argsCall, 1, [1]);

  const cellVertsCounter = countersAttr.array as Uint32Array;
  let last: HullExtractStats | null = null;

  return {
    soupAttribute: soupAttr,
    indirect,
    extract(renderer, centre, half, origin, cell, band, distort) {
      const grid = fitHullGrid(
        [centre.x, centre.y, centre.z], [half.x, half.y, half.z], cell, band, MAX_DIM);
      const g = packGridUniforms(grid, band, distort);
      uGridMin.value.set(grid.min[0], grid.min[1], grid.min[2]);
      uGridCfg.value.set(...g.gridCfg);
      uGridDims.value.set(...g.gridDims);
      uOrigin.value.copy(origin);
      // Counters reset by upload: cheapest correct thing for 16 bytes.
      cellVertsCounter.fill(0);
      countersAttr.needsUpdate = true;
      renderer.compute([netsNode, quadsNode, argsNode]);
      last = { cellVerts: -1, soupVerts: -1, overflow: false, dropped: -1,
               blockCount: g.blockCount, cellCount: g.cellCount, grid };
      return last;
    },
    async readback(renderer) {
      const metaBuf = new Uint32Array(await renderer.getArrayBufferAsync(metaAttr));
      const cellPosBuf = new Float32Array(await renderer.getArrayBufferAsync(cellPosAttr));
      const soupBuf = new Float32Array(await renderer.getArrayBufferAsync(soupAttr));
      return { meta: metaBuf, cellPos: cellPosBuf.subarray(0, metaBuf[1]! * 3), soup: soupBuf.subarray(0, metaBuf[2]! * 3) };
    },
    dispose() {
      for (const a of [cellVertAttr, cellEdgeAttr, cellPosAttr, soupAttr, countersAttr, metaAttr, indirect]) {
        (a as unknown as { dispose?: () => void }).dispose?.();
      }
    },
  };
}
```

Implementer notes:
- `storage(countersAttr, 'uint', 4).toAtomic()` makes three emit `array<atomic<u32>>`, matching the `ptr<storage, array<atomic<u32>>, read_write>` parameters. If pipeline creation complains about the atomic pointer type, the fallback is to pass `counters` non-atomic and use `atomicAdd` on `&(*counters)[i]` only if three's builder accepts it; the compute agent report says atomics are supported through `toAtomic()`.
- `workgroupId`/`localId` are `uvec3` builtins from `three/tsl` (`ComputeBuiltinNode.js:203,218`).
- The `netsNode` count is *invocations*; three dispatches `ceil(count / 64)` workgroups along x (`WebGPUBackend.js:1650-1668`), so `workgroupId.x` is the linear block index the kernel expects. `MAX_DIM/BLOCK)^3 = 64 000 < 65 535`, under `maxComputeWorkgroupsPerDimension`.
- Stats fields at `-1` are "not read back"; the page's `stats()` seam calls `readback()` on demand.

- [ ] **Step 4: Run tests and tsc**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-compute.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests); tsc clean. If `getArrayBufferAsync` is not on the renderer type in 0.185.1, cast: `(renderer as unknown as { getArrayBufferAsync(a: THREE.BufferAttribute): Promise<ArrayBuffer> })` — `tile-bin-compute.ts:407-424` has the precedent.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/surface-nets-compute.ts src/lab/sdf-zombie/webgpu/surface-nets-compute.test.ts
git commit -m "hull: compute wrapper — worst-case buffers, three kernels, indirect args, readback"
```

---

### Task 5: `zombie-gpu.ts` hooks — ray override on the march material, `dataTexture` on the views

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`createMarchMaterial` ~676-878; `ZombieGpuView` interface ~41-104 and its return ~1245-1300; `ChunkGpuView` ~1342-1354 and its return)
- Test: existing `src/lab/sdf-zombie/webgpu/*.test.ts` stay green; add one test to `hull-refine-view.test.ts` in Task 6 that reads `dataTexture`.

- [ ] **Step 1: Add the `rays` override to `createMarchMaterial`**

Add a type above the function and a trailing parameter:

```ts
/** Hull-refine (phase 0): per-fragment ray overrides so the SHIPPED march
 *  does a short band walk from a rasterised hull instead of a proxy-box
 *  march. `worldPos` feeds tMaxBox = length(worldPos - camPos) — pass the
 *  hull point pushed 2*band along the ray to bound the walk; `startT` is
 *  the hull point's own distance; `marchCfg` a separate steps uniform so
 *  the inner view's 96 stays untouched; `side` FrontSide for a hull. */
export interface MarchRayOverride {
  worldPos: unknown;
  startT: unknown;
  marchCfg: unknown;
  side: THREE.Side;
}

export function createMarchMaterial(
  dataTex: THREE.Texture | ReturnType<typeof texture>,
  volumeTex: THREE.Texture | ReturnType<typeof texture3D>,
  u: MarchUniforms,
  march = marchBody,
  cone?: ConeSource, occluder?: OccluderSource,
  tiles?: { header: unknown; entries: unknown },
  shell?: ShellSource,
  prev?: PrevSource,
  levelShadow?: { light: THREE.SpotLight },
  rays?: MarchRayOverride,
) {
```

Then inside, change exactly three call-site lines and the side:

```ts
  const marched = march({
    worldPos: (rays?.worldPos ?? positionWorld) as never,
    ...
    marchCfg: (rays?.marchCfg ?? u.marchCfg) as never,
    ...
    startT: rays
      ? (rays.startT as never)
      : cone
        ? coneFetch({ coneTex: texture(cone.texture), screenUV: screenUV, enabled: cone.uniforms.enabled })
        : float(0),
```

and

```ts
  material.side = rays?.side ?? THREE.BackSide;
```

Everything else in the function is unchanged. `rayDir` stays `normalize(sub(positionWorld, cameraPosition))` — for a hull fragment `positionWorld` is the hull point, so the direction is the same ray; the depth reconstruction `hitPos = camPos + rayDir * marched.w` is therefore correct for the hull too.

- [ ] **Step 2: Expose `dataTexture` on both views**

In `ZombieGpuView` (interface ~41) add:

```ts
  /** The packed prim DataTexture this view uploads to — the hull extraction
   *  kernel reads the same texture the march does. */
  dataTexture: THREE.Texture;
```

In `createZombieGpuView`'s returned object add `dataTexture: dataTex,` next to `volumeTexture: volumeTex,`. Same two edits for `ChunkGpuView` / `createChunkGpuView` (its local is also named `dataTex`).

- [ ] **Step 3: Run the whole lab suite and tsc**

Run: `npx vitest run src/lab && npx tsc --noEmit`
Expected: all green (2736+ tests as of the gore merge); tsc clean. Nothing behavioural changed: without `rays` every default is the previous expression.

- [ ] **Step 4: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts
git commit -m "zombie-gpu: additive hooks for hull-refine — march ray override, dataTexture on views"
```

---

### Task 6: `hull-refine-view.ts` — the wrapper

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/hull-refine-view.ts`
- Test: `src/lab/sdf-zombie/webgpu/hull-refine-view.test.ts`

- [ ] **Step 1: Write the failing tests** (fake inner view, fake compute; no WebGPU)

```ts
// src/lab/sdf-zombie/webgpu/hull-refine-view.test.ts
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { wrapHullRefine, type HullRefineDeps } from './hull-refine-view';

function fakeInner() {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  object.position.set(1, 2, 3);
  return {
    object,
    uniforms: { bodyHalf: { value: new THREE.Vector3(0.4, 0.9, 0.3) }, counts: { value: new THREE.Vector4(0, 0, 0, 0.02) } },
    dataTexture: new THREE.Texture(),
    volumeTexture: new THREE.Texture(),
    update: vi.fn(),
    setWounds: vi.fn(),
    dispose: vi.fn(),
  };
}

function fakeDeps(): HullRefineDeps & { extract: ReturnType<typeof vi.fn> } {
  const extract = vi.fn(() => ({ cellVerts: 0, soupVerts: 0, overflow: false, dropped: 0, blockCount: 1, cellCount: 64, grid: { min: [0, 0, 0], cell: 0.02, dims: [4, 4, 4], clamped: false } }));
  return {
    extract,
    makeCompute: () => ({
      soupAttribute: new THREE.StorageBufferAttribute(6, 3),
      indirect: new THREE.IndirectStorageBufferAttribute(4, 1),
      extract,
      readback: async () => ({ meta: new Uint32Array(4), cellPos: new Float32Array(0), soup: new Float32Array(0) }),
      dispose: vi.fn(),
    }),
    makeMaterial: () => new THREE.MeshBasicNodeMaterial(),
    renderer: {} as THREE.WebGPURenderer,
  };
}

describe('wrapHullRefine', () => {
  it('starts on the march: inner visible, hull hidden', () => {
    const v = wrapHullRefine(fakeInner() as never, fakeDeps());
    expect(v.inner.object.visible).toBe(true);
    expect(v.hullObject.visible).toBe(false);
    expect(v.renderer).toBe('march');
  });
  it('setRenderer flips visibility both ways', () => {
    const v = wrapHullRefine(fakeInner() as never, fakeDeps());
    v.setRenderer('hull');
    expect(v.inner.object.visible).toBe(false);
    expect(v.hullObject.visible).toBe(true);
    v.setRenderer('march');
    expect(v.inner.object.visible).toBe(true);
    expect(v.hullObject.visible).toBe(false);
  });
  it('update delegates, then extracts ONLY when the hull is on, with the inner bounds', () => {
    const inner = fakeInner();
    const deps = fakeDeps();
    const v = wrapHullRefine(inner as never, deps);
    v.update({} as never);
    expect(inner.update).toHaveBeenCalledTimes(1);
    expect(deps.extract).not.toHaveBeenCalled();
    v.setRenderer('hull');
    v.update({} as never);
    expect(deps.extract).toHaveBeenCalledTimes(1);
    const [, centre, half, origin, cell, band] = deps.extract.mock.calls[0]!;
    expect((centre as THREE.Vector3).toArray()).toEqual([1, 2, 3]);
    expect((half as THREE.Vector3).toArray()).toEqual([0.4, 0.9, 0.3]);
    expect((origin as THREE.Vector3).toArray()).toEqual([1, 2, 3]);
    expect(cell).toBe(0.02); expect(band).toBe(0.02);
    expect(v.hullObject.position.toArray()).toEqual([1, 2, 3]);
  });
  it('setWounds passes straight through and knobs update the steps uniform', () => {
    const inner = fakeInner();
    const v = wrapHullRefine(inner as never, fakeDeps());
    v.setWounds([], [], [], []);
    expect(inner.setWounds).toHaveBeenCalledTimes(1);
    v.setKnobs({ steps: 8, band: 0.03, cell: 0.015 });
    expect(v.knobs()).toEqual({ steps: 8, band: 0.03, cell: 0.015 });
    expect(v.hullMarchCfg.value.x).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/hull-refine-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

```ts
// src/lab/sdf-zombie/webgpu/hull-refine-view.ts
//
// Wraps a shipped body/chunk view so it can be drawn EITHER through its own
// proxy-box march (unchanged) OR through a per-frame surface-nets hull whose
// fragments run the same march shader as a short band walk (spec §3, §5).
// Same interface as the inner view where the actor needs it, plus the
// renderer toggle and the three knobs. Zero changes to march.wgsl.ts: the
// hull material is createMarchMaterial with the `rays` override.
import * as THREE from 'three/webgpu';
import { cameraPosition, float, length, mul, normalize, positionWorld, sub, uniform, add } from 'three/tsl';
import type { Vec3 } from '../types';
import { createMarchMaterial, marchBody, type MarchUniforms } from './zombie-gpu';
import { createSurfaceNetsCompute, type SurfaceNetsCompute, type HullExtractStats } from './surface-nets-compute';

export type HullRenderer = 'march' | 'hull';
export interface HullKnobs { cell: number; band: number; steps: number }
export const DEFAULT_HULL_KNOBS: HullKnobs = { cell: 0.02, band: 0.02, steps: 4 };

/** The subset of ZombieGpuView / ChunkGpuView the wrapper relies on. */
export interface HullInnerView {
  object: THREE.Object3D;
  uniforms: MarchUniforms;
  dataTexture: THREE.Texture;
  volumeTexture: THREE.Texture;
  dispose(): void;
  update?(...args: never[]): void;
  setWounds?(...args: never[]): void;
}

export interface HullRefineDeps {
  renderer: THREE.WebGPURenderer;
  makeCompute?: (inner: HullInnerView) => SurfaceNetsCompute;
  makeMaterial?: (inner: HullInnerView, hullMarchCfg: ReturnType<typeof uniform>, band: ReturnType<typeof uniform>) => THREE.Material;
}

export interface HullRefineView<Inner extends HullInnerView = HullInnerView> {
  inner: Inner;
  hullObject: THREE.Mesh;
  hullMarchCfg: { value: THREE.Vector3 };
  readonly renderer: HullRenderer;
  setRenderer(r: HullRenderer): void;
  knobs(): HullKnobs;
  setKnobs(k: Partial<HullKnobs>): void;
  /** Delegates to inner.update, then (hull on) extracts this frame's hull. */
  update(...args: Parameters<NonNullable<Inner['update']>>): void;
  setWounds(...args: Parameters<NonNullable<Inner['setWounds']>>): void;
  lastExtract(): HullExtractStats | null;
  compute: SurfaceNetsCompute;
  dispose(): void;
}

function defaultMaterial(inner: HullInnerView, hullMarchCfg: ReturnType<typeof uniform>, band: ReturnType<typeof uniform>) {
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hullT = length(sub(positionWorld, cameraPosition));
  // tMaxBox = length(worldPos - camPos) inside marchBody, so a point pushed
  // 2*band down the ray bounds the walk to the band (spec §5).
  const farPoint = add(positionWorld, mul(rayDir, mul(band, float(2.0))));
  return createMarchMaterial(
    inner.dataTexture, inner.volumeTexture, inner.uniforms, marchBody,
    undefined, undefined, undefined, undefined, undefined, undefined,
    { worldPos: farPoint, startT: hullT, marchCfg: hullMarchCfg, side: THREE.FrontSide },
  );
}

export function wrapHullRefine<Inner extends HullInnerView>(
  inner: Inner, deps: HullRefineDeps,
): HullRefineView<Inner> {
  const knobs: HullKnobs = { ...DEFAULT_HULL_KNOBS };
  const src = inner.uniforms.marchCfg.value;
  const hullMarchCfg = uniform(new THREE.Vector3(knobs.steps, src.y, src.z));
  const uBand = uniform(knobs.band);
  const compute = (deps.makeCompute ?? ((i) => createSurfaceNetsCompute(i.dataTexture, i.volumeTexture, i.uniforms)))(inner);
  const material = (deps.makeMaterial ?? defaultMaterial)(inner, hullMarchCfg, uBand);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', compute.soupAttribute);
  geometry.setIndirect(compute.indirect);
  const hull = new THREE.Mesh(geometry, material);
  hull.frustumCulled = false;
  hull.visible = false;
  hull.layers.mask = inner.object.layers.mask;

  let renderer: HullRenderer = 'march';
  let last: HullExtractStats | null = null;
  const centre = new THREE.Vector3();
  // Group distortion factor for the block-live test (spec §4). packBody
  // stores it per group; the zombie's max is 1.0 (isotropic capsules). A
  // page rendering another cast sets it through setKnobs({ distort }).
  let distort = 1.0;

  function extractNow() {
    centre.copy(inner.object.position);
    hull.position.copy(centre);
    last = compute.extract(deps.renderer, centre, inner.uniforms.bodyHalf.value, centre,
      knobs.cell, knobs.band, distort);
  }

  return {
    inner,
    hullObject: hull,
    hullMarchCfg,
    get renderer() { return renderer; },
    setRenderer(r) {
      renderer = r;
      inner.object.visible = r === 'march';
      hull.visible = r === 'hull';
    },
    knobs() { return { ...knobs }; },
    setKnobs(k) {
      Object.assign(knobs, k);
      hullMarchCfg.value.x = knobs.steps;
      uBand.value = knobs.band;
      if ('distort' in k) distort = (k as { distort: number }).distort;
    },
    update(...args) {
      inner.update?.(...(args as never[]));
      if (renderer === 'hull') extractNow();
    },
    setWounds(...args) { inner.setWounds?.(...(args as never[])); },
    lastExtract() { return last; },
    compute,
    dispose() { compute.dispose(); geometry.dispose(); (material as THREE.Material).dispose(); inner.dispose(); },
  };
}
```

Implementer notes:
- `geometry.setIndirect` exists on `BufferGeometry` in 0.185 (`src/core/BufferGeometry.js:253`); three's WebGPU backend then issues `drawIndirect` (`WebGPUBackend.js:1840-1885`). The geometry has no index, so it is the non-indexed path and the args are `(vertexCount, instanceCount, firstVertex, firstInstance)` — what `K_HULL_ARGS` writes.
- The `distort` knob: `packBody` returns per-group distortion; the zombie's max is 1.0 (capsules, isotropic scale). The page reads `packed.groupRange[g*4+2]` max over groups and sets the knob once per character. Phase 0 is zombie-only; document, don't build.
- `hull.layers.mask` copies the inner's layer so a page that uses `SDF_LAYER` still draws it.

- [ ] **Step 4: Run tests and tsc**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/hull-refine-view.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/hull-refine-view.ts src/lab/sdf-zombie/webgpu/hull-refine-view.test.ts
git commit -m "hull: HullRefineView — same view interface, hull mesh drawn through the shipped march with ray overrides"
```

---

### Task 7: The spike page — renderer, actor, chunks, shooting, seams

**Files:**
- Create: `sdf-hull-spike.html`
- Create: `src/lab/sdf-zombie/webgpu/hull-spike-main.ts`
- Modify: `vite.config.ts:17-31` (add `sdfHullSpike: resolve(__dirname, 'sdf-hull-spike.html'),` after `humanoidSdfSpike`)

This is the only task with no unit test; its gate is the page booting on WebGPU and the parity readback in Step 4. Copy the structure of `game-main.ts` for the actor + chunk plumbing (lines ~699-900 for the actor, ~1144-1196 for chunks, ~1569 for `onSeverDispatch`, ~1809 for `stepChunk`) and of `shell-spike-main.ts` for the standalone renderer, but use `createLabRenderer` from `lab-renderer.ts` for the rAF loop, `step`, and `resolveGpu`.

- [ ] **Step 1: The HTML**

```html
<!-- sdf-hull-spike.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Blud — hull-refine spike</title>
  <style>
    html, body { margin: 0; background: #1a1116; color: #d8c8c0; font: 12px/1.4 ui-monospace, monospace; overflow: hidden; }
    #app { position: fixed; inset: 0; }
    #hud { position: fixed; left: 8px; top: 8px; white-space: pre; pointer-events: none; }
    #controls { position: fixed; left: 8px; bottom: 8px; opacity: .8; pointer-events: none; }
  </style>
</head>
<body>
  <div id="app"></div>
  <div id="hud">booting…</div>
  <div id="controls">click: pellet · right-click: slug · S: sever nearest arm · G: gib · H: hull/march · [ ]: steps · - =: band · , .: cell · F: freeze</div>
  <script type="module" src="/src/lab/sdf-zombie/webgpu/hull-spike-main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: The page module**

```ts
// src/lab/sdf-zombie/webgpu/hull-spike-main.ts
//
// Hull-refine phase 0 spike (spec §7). One walking zombie actor, shootable,
// severable, gibbable; drawn through the shipped march OR the surface-nets
// hull, toggled in-page. Exposes window.__hullSpike so
// scripts/perf-r2-parity.mjs --url /sdf-hull-spike.html --seam __hullSpike
// can freeze, stamp a wound, toggle, and capture.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createZombieGpuView, createChunkGpuView, type ZombieGpuView, type ChunkGpuView } from './zombie-gpu';
import { wrapHullRefine, type HullRefineView, type HullRenderer, type HullKnobs } from './hull-refine-view';
import { createZombieActor, type ZombieActor, type DetachedPiece } from './game-actor';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import { DEFAULT_FACE } from '../face';
import { makeChunk, stepChunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import zombieBlobSrc from '../characters/zombie.blob?raw';

const MAX_CHUNKS = 8;

async function main() {
  const mount = document.getElementById('app')!;
  const hud = document.getElementById('hud')!;
  const handle = await createLabRenderer(mount, { mode: 'fixed', width: 960, height: 540 });
  const { renderer, scene, camera } = handle;
  camera.position.set(0, 1.6, 3.2);
  camera.lookAt(0, 1.0, 0);

  // Floor so the reel has a ground contact to judge.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardNodeMaterial({ color: 0x2a2226 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ---- body + actor -----------------------------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = { ...DEFAULT_FACE, ...compileFace(doc) };
  const body = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
  const innerView = createZombieGpuView(body);
  const view: HullRefineView<ZombieGpuView> = wrapHullRefine(innerView, { renderer });
  scene.add(innerView.object);
  scene.add(view.hullObject);

  const pieces: DetachedPiece[] = [];
  const actor: ZombieActor = createZombieActor({
    id: 1, room: 0, body, view: view as unknown as ZombieGpuView,
    start: [0, 0, 0], seed: 7,
    bounds: { min: [-1.5, 0, -1.5], max: [1.5, 0, 1.5] } as never,
    furniture: [],
    onSever: (piece) => { pieces.push(piece); spawnChunk(piece); },
  });

  // ---- chunks -----------------------------------------------------------
  type Live = { state: ReturnType<typeof makeChunk>; view: HullRefineView<ChunkGpuView> };
  const live: Live[] = [];
  let seed = 1;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function spawnChunk(piece: DetachedPiece) {
    const vel: Vec3 = [(rng() - 0.5) * 4.5, 2.5 + rng() * 2.5, (rng() - 0.5) * 4.5];
    const state = makeChunk(piece.limb, piece.origin, vel, chunkExtent(piece.prims, piece.origin), [0, 1, 0], rng, 'limb');
    const oldest = live.length >= MAX_CHUNKS ? live.shift() : undefined;
    if (oldest) {
      oldest.view.inner.reset(state, piece.prims, piece.tornAt.length ? piece.tornAt : undefined, piece.bones);
      live.push({ state, view: oldest.view });
      return;
    }
    const inner = createChunkGpuView(state, piece.prims, innerView.uniforms,
      piece.tornAt.length ? piece.tornAt : undefined, innerView.volumeTexture, undefined, piece.bones);
    const wrapped = wrapHullRefine(inner, { renderer });
    wrapped.setRenderer(view.renderer);
    wrapped.setKnobs(view.knobs());
    scene.add(inner.object); scene.add(wrapped.hullObject);
    live.push({ state, view: wrapped });
  }

  // ---- shooting: ray vs the CPU field of the POSED body -----------------
  const raycaster = new THREE.Raycaster();
  function aimWorld(ndcX: number, ndcY: number): { hit: Vec3; dir: Vec3 } | null {
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    const posed = actor.posed();
    let t = 0;
    for (let i = 0; i < 128; i++) {
      const p: Vec3 = [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
      const f = sdBody(p, posed);
      if (f < 0.002) return { hit: p, dir: [d.x, d.y, d.z] };
      t += Math.max(f, 0.002);
      if (t > 20) break;
    }
    return null;
  }
  const canvas = handle.canvas;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect();
    const a = aimWorld(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    if (!a) return;
    if (e.button === 2) actor.hitSlug(a.hit, a.dir); else actor.hit(a.hit, a.dir);
  });

  // ---- knobs + keys -----------------------------------------------------
  let frozen = false;
  function setRenderer(r: HullRenderer) { view.setRenderer(r); for (const c of live) c.view.setRenderer(r); }
  function setKnobs(k: Partial<HullKnobs>) { view.setKnobs(k); for (const c of live) c.view.setKnobs(k); }
  window.addEventListener('keydown', e => {
    const k = view.knobs();
    if (e.key === 'h' || e.key === 'H') setRenderer(view.renderer === 'hull' ? 'march' : 'hull');
    if (e.key === '[') setKnobs({ steps: Math.max(1, k.steps - 1) });
    if (e.key === ']') setKnobs({ steps: k.steps + 1 });
    if (e.key === '-') setKnobs({ band: Math.max(0.005, k.band - 0.005) });
    if (e.key === '=') setKnobs({ band: k.band + 0.005 });
    if (e.key === ',') setKnobs({ cell: Math.max(0.01, k.cell - 0.005) });
    if (e.key === '.') setKnobs({ cell: k.cell + 0.005 });
    if (e.key === 'f' || e.key === 'F') frozen = !frozen;
    if (e.key === 's' || e.key === 'S') { const a = aimWorld(0, 0.2); if (a) actor.hitSlug(a.hit, a.dir); }
    if (e.key === 'g' || e.key === 'G') { for (let i = 0; i < 4; i++) { const a = aimWorld((rng() - 0.5) * 0.4, 0.1 + (rng() - 0.5) * 0.6); if (a) actor.hitSlug(a.hit, a.dir); } }
  });

  // ---- frame ------------------------------------------------------------
  let frameMs = 0, tPrev = performance.now();
  handle.setRenderCallback((dt) => {
    const now = performance.now(); frameMs = now - tPrev; tPrev = now;
    if (!frozen) {
      actor.step(dt);
      for (const c of live) { c.state = stepChunk(c.state, dt); c.view.update(c.state); }
    } else if (view.renderer === 'hull') {
      // Frozen: still re-extract so knob changes show without motion.
      view.update(actor.posed(), actor.body);
    }
    const k = view.knobs();
    const x = view.lastExtract();
    hud.textContent =
      `renderer ${view.renderer}  ${frameMs.toFixed(1)} ms\n` +
      `cell ${k.cell.toFixed(3)}  band ${k.band.toFixed(3)}  steps ${k.steps}\n` +
      (x ? `grid ${x.grid.dims.join('x')}  blocks ${x.blockCount}${x.grid.clamped ? '  CLAMPED' : ''}\n` : '') +
      `wounds ${actor.wounds().length}  chunks ${live.length}${frozen ? '  FROZEN' : ''}`;
  });

  // ---- seams (perf-r2-parity.mjs contract; unknown setters are no-ops) --
  (window as unknown as { __hullSpike: unknown }).__hullSpike = {
    backend: handle.backend,
    resolveGpu: () => handle.resolveGpu(),
    freeze: (on: boolean) => { frozen = on; },
    teleport: (_room: number) => {},
    setAdaptive: () => {}, setSdfScale: () => {}, setFxaa: () => {}, setSmear: () => {},
    setCone: () => {}, setOccluder: () => {},
    get shell() { return false; }, get occluder() { return false; }, get cone() { return false; },
    get fxaa() { return false; }, get relax() { return innerView.uniforms.woundCfg2.value.y; },
    get sdfScale() { return 1; }, get adaptive() { return { enabled: false }; }, get halfRate() { return false; },
    get sdfTarget() { return { w: 960, h: 540 }; },
    setRenderer, setKnobs, knobs: () => view.knobs(), get renderer() { return view.renderer; },
    aimSurface: () => aimWorld(0, 0.15),
    fireSlug: () => { const a = aimWorld(0, 0.15); if (a) actor.hitSlug(a.hit, a.dir); return !!a; },
    firePellet: () => { const a = aimWorld(0, 0.15); if (a) actor.hit(a.hit, a.dir); return !!a; },
    gib: () => { for (let i = 0; i < 4; i++) { const a = aimWorld((rng() - 0.5) * 0.4, 0.1 + (rng() - 0.5) * 0.6); if (a) actor.hitSlug(a.hit, a.dir); } },
    wounds: (): readonly Wound[] => actor.wounds(),
    async stats() {
      const r = await view.compute.readback(renderer);
      return { overflow: r.meta[0] === 1, cellVerts: r.meta[1], soupVerts: r.meta[2], dropped: r.meta[3], extract: view.lastExtract(), frameMs };
    },
    /** GPU-vs-CPU parity on the current posed, UNWOUNDED-field body: every
     *  GPU cell vertex must sit within one cell of iso+band by the CPU field. */
    async checkParity() {
      const r = await view.compute.readback(renderer);
      const posed = actor.posed();
      const k = view.knobs();
      const origin = view.hullObject.position;
      let bad = 0;
      for (let v = 0; v < r.meta[1]!; v++) {
        const p: Vec3 = [r.cellPos[v * 3]! + origin.x, r.cellPos[v * 3 + 1]! + origin.y, r.cellPos[v * 3 + 2]! + origin.z];
        if (Math.abs(sdBody(p, posed) - k.band) > k.cell) bad++;
      }
      return { cellVerts: r.meta[1], bad, badFrac: r.meta[1] ? bad / r.meta[1]! : 0, dropped: r.meta[3], overflow: r.meta[0] === 1 };
    },
  };
  hud.textContent = 'ready';
}

main().catch(e => { document.getElementById('hud')!.textContent = String(e?.stack ?? e); console.error(e); });
```

Implementer notes:
- `createZombieActor`'s `bounds`/`furniture` types are in `game-actor.ts:158`; use the real `WanderBounds` shape from `actor.ts` rather than the `as never` shown if it differs.
- `actor.posed()` after a slug hit reflects the sever; the actor calls `view.update(posed, current)` each step (`game-actor.ts:388-421`), which is where the wrapper extracts.
- `checkParity` runs on the CPU field WITHOUT wounds (`sdBody` has no wound mirror on this branch), so call it before shooting; the harness's `--pre` stamps wounds after the parity check.
- Vite serves any root-level html in dev; the `vite.config.ts` input entry is only so `npm run build` type-checks the page.

- [ ] **Step 3: Boot it**

Start the dev server and open the page:

```bash
npx vite --port 5340
```

Open `http://localhost:5340/sdf-hull-spike.html`. Expected: the zombie walking through the march (HUD `renderer march`). Press `H`: HUD `renderer hull`, the body still visible, grid line present, `CLAMPED` absent. Press `[`/`]` and watch the silhouette erode at 1–2 steps and fill in by 4. If the page shows a WGSL error in the HUD/console, the message names the kernel and the mismatched parameter — re-check the positional argument list in Task 4 against the signatures in Task 3.

If `renderer.compute` is rejected because `atomic` pointers are not accepted through `wgslFn`, the fallback (document it in the notes if used): declare `counters` as plain `array<u32>`, drop `.toAtomic()`, and replace `atomicAdd(&(*counters)[i], n)` with a two-kernel scan (per-cell flag then a single-thread prefix), the `tile-bin-compute.ts` scheme. Only do this if the atomic path actually fails.

- [ ] **Step 4: GPU/CPU parity readback**

In the devtools console on the hull renderer, before any shot:

```js
await __hullSpike.checkParity()
```

Expected: `badFrac < 0.01`, `dropped === 0`, `overflow === false`, and `cellVerts` in the 3k–40k range Task 2 pinned for the CPU version. Record the numbers in the notes (Task 9). A `badFrac` near 1.0 means the kernel's vertex is in the wrong space (origin subtraction) — compare `r.cellPos[0..2] + origin` against a CPU `extractHullSoup` vertex nearby.

- [ ] **Step 5: tsc + suite, then commit**

Run: `npx tsc --noEmit && npx vitest run src/lab`
Expected: clean, green.

```bash
git add sdf-hull-spike.html src/lab/sdf-zombie/webgpu/hull-spike-main.ts vite.config.ts
git commit -m "hull: the spike page — walking shootable zombie, chunks, knobs, parity seam"
```

---

### Task 8: Parity harness `--url`/`--seam` + the reel script

**Files:**
- Modify: `scripts/perf-r2-parity.mjs` (page constant ~line 216; the `__sdfGame` references throughout)
- Create: `scripts/hull-spike-reel.sh`

- [ ] **Step 1: Parameterise the harness**

At the argument parsing near the top of `scripts/perf-r2-parity.mjs`, add:

```js
const PAGE = arg('--url') ?? '/sdf-game.html';
const SEAM = arg('--seam') ?? '__sdfGame';
```

(where `arg(name)` is the existing flag reader; if the file reads flags inline, follow its pattern). Replace the hardcoded `/sdf-game.html` at ~216 with `PAGE`, and every `window.__sdfGame` / `__sdfGame.` in evaluated JS strings with a template on `SEAM`, e.g. `` `window.${SEAM}?.resolveGpu` ``. The `--on`/`--off`/`--pre` strings are user-supplied and unchanged. Behaviour with no flags is byte-identical to before.

- [ ] **Step 2: Verify the game path is unchanged**

Run: `scripts/perf-r2-parity.sh capture /tmp/hull-parity-smoke --room 3 --on "__sdfGame.setShell(true)" --off "__sdfGame.setShell(false)"`
Expected: runs to `summary.json` exactly as documented in `docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md` §Task 1b (noise floor ~0.002%).

- [ ] **Step 3: The reel script**

```bash
#!/usr/bin/env bash
# scripts/hull-spike-reel.sh — the owner's three-item A/B reel (spec §7).
# Each item: hull vs march on the SAME frozen scene, via perf-r2-parity.mjs.
# Usage: scripts/hull-spike-reel.sh <outDir> [cell band steps]
set -euo pipefail
OUT=${1:?outDir}; CELL=${2:-0.02}; BAND=${3:-0.02}; STEPS=${4:-4}
export LAB_VITE_PORT=${LAB_VITE_PORT:-5340} LAB_CDP_PORT=${LAB_CDP_PORT:-9340}
source scripts/lab-servers.sh; lab_servers_up; trap lab_servers_down EXIT
KNOBS="__hullSpike.setKnobs({cell:$CELL,band:$BAND,steps:$STEPS})"
ON="$KNOBS; __hullSpike.setRenderer('hull')"
OFF="__hullSpike.setRenderer('march')"
COMMON=(--url /sdf-hull-spike.html --seam __hullSpike --on "$ON" --off "$OFF")
# 1. wounded close-up: a pellet and a slug at FPV range
node scripts/perf-r2-parity.mjs capture "$OUT/1-wounded" "${COMMON[@]}" \
  --pre "__hullSpike.firePellet(); __hullSpike.fireSlug()"
# 2. walk cycle: NOT frozen — capture pairs at four gait phases via freeze/unfreeze
for ph in 0 1 2 3; do
  node scripts/perf-r2-parity.mjs capture "$OUT/2-walk-$ph" "${COMMON[@]}" \
    --pre "__hullSpike.freeze(false); await new Promise(r=>setTimeout(r, ${ph}00 + 350)); __hullSpike.freeze(true)"
done
# 3. sever + gib
node scripts/perf-r2-parity.mjs capture "$OUT/3-gib" "${COMMON[@]}" \
  --pre "__hullSpike.gib(); await new Promise(r=>setTimeout(r, 400))"
echo "reel in $OUT — read each summary.json; pixel diffs are a SIGNAL only, the owner's eye is the gate"
```

`chmod +x scripts/hull-spike-reel.sh`. If `perf-r2-parity.mjs` evaluates `--pre` with `Runtime.evaluate` without `awaitPromise`, the `await` forms above need `awaitPromise: true` added to that one call — check and add.

- [ ] **Step 4: Run the reel at the defaults**

Run: `scripts/hull-spike-reel.sh docs/dev-notes/2026-09-02-hull-refine-spike/reel-default`
Expected: six capture directories, each with `state-1/2.png`, `b-1/a-1/b-2/a-2.png` and `summary.json`. The noise floor pairs (`a-1 vs a-2`, `b-1 vs b-2`) must be near the ~0.002% the harness records on the game page; if the hull pairs differ from each other more than that, extraction is not deterministic frame to frame (atomic ordering does not affect positions, but a `dropped` count > 0 would) — check `__hullSpike.stats()`.

- [ ] **Step 5: Commit**

```bash
git add scripts/perf-r2-parity.mjs scripts/hull-spike-reel.sh
git commit -m "hull: parity harness takes --url/--seam; the three-item reel script"
```

---

### Task 9: Knob sweep, dev note, TASKS row, handoff to the owner

**Files:**
- Create: `docs/dev-notes/2026-09-02-hull-refine-spike/notes.md`
- Modify: `TASKS.md` (the HULL-REFINE row under Current focus)

- [ ] **Step 1: Sweep**

Run the reel at `cell/band/steps` = `0.02/0.02/4`, `0.015/0.015/4`, `0.03/0.03/4`, `0.02/0.02/8`, `0.02/0.02/12` into sibling `reel-<cell>-<band>-<steps>` directories. For each, also record `await __hullSpike.stats()` on the hull renderer (cell verts, soup verts, overflow, grid dims, blocks, frame ms) — via the harness's `--pre` returning JSON, or by hand in devtools.

- [ ] **Step 2: Write the note**

```markdown
# Hull-refine spike — phase 0 notes

**Date:** 2026-09-02 · **Spec:** ../../superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md
**Plan:** ../../superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md · **Branch:** <branch>

## What was built
<one paragraph: kernels, wrapper, page, seams; which plan deviations were exercised, incl. whether the atomic path or the scan fallback shipped>

## GPU/CPU parity (unwounded, frame N)
| cellVerts | bad | badFrac | dropped | overflow |
| --- | --- | --- | --- | --- |

## Knob sweep — hull renderer, one zombie, 960x540
| cell | band | steps | grid dims | blocks | cellVerts | soupVerts | frame ms hull | frame ms march |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## The reel (owner judges)
For each of 1-wounded, 2-walk-{0..3}, 3-gib at the settings the sweep lands on:
`a-1.png` (hull) vs `b-1.png` (march), the harness's changed-pixel % and hot-cell grid.
Note anything the eye catches: eroded grazing silhouettes (steps), missing lip detail (band), seams at chunk hulls.

## Verdict
<owner's words, date>

## Cost — ONLY if the look passed (reported, not gated)
<1/4/9-body legs would need the game page; phase 0 has the single-body page number only. Say so.>
```

- [ ] **Step 3: TASKS.md**

Replace the HULL-REFINE paragraph under Current focus with a status line: built, parity numbers, sweep done, **reel awaiting owner verdict**, note path, seams (`__hullSpike.setRenderer/setKnobs/stats/checkParity`), and the plan-deviation list. Keep the pointer to the spec.

- [ ] **Step 4: Commit and checkpoint**

```bash
git add docs/dev-notes/2026-09-02-hull-refine-spike TASKS.md
git commit -m "hull: phase 0 notes — parity, knob sweep, reel captured; awaiting owner look verdict"
```

Then:

```bash
source ~/.claude/hooks/dualmem-env.sh
~/go/bin/dualmem checkpoint --task "hull-refine renderer (tier 3 SDF perf)" --status in_progress \
  --files "src/lab/sdf-zombie/webgpu/surface-nets.wgsl.ts,src/lab/sdf-zombie/webgpu/surface-nets-compute.ts,src/lab/sdf-zombie/webgpu/hull-refine-view.ts,src/lab/sdf-zombie/webgpu/hull-spike-main.ts" \
  --done "phase 0 built; parity <numbers>; sweep in notes" --remaining "owner look verdict on the reel; then phase 1/2 planning or close"
```

- [ ] **Step 5: Stop.** The owner judges the reel. Do not start phase 1, the hybrid switch, or the crowd bench.

---

## Dispatch notes (owner: Kimi K3, not glm-5.3-flash)

- `model: kimi-oai/kimi-k3:xhigh`, `harness: pi`, `status: pending` (never `queued`), `base_branch: claude/sdf-raymarching-performance-3aabd2` (this plan and the spec are committed there), `allowed_tools: Edit,Write,Bash,Read,Glob,Grep`.
- **kimi-k3 is text-only.** Task 7 step 3 and Task 8 step 4 look at frames. The dispatched agent must use `python3 scripts/vision-ask.py <png> "<question>"` on `a-1.png`/`b-1.png` and quote the answers in the notes; it must not claim to have seen a frame. Questions to ask: "Is a humanoid figure fully visible with no holes or missing limbs?", "Compare A and B: list any region where the silhouette or the wound looks different."
- Split as five dispatch tasks chained with `depends_on`, strictly serial — each depends on the previous one's exports: (1) Tasks 1–2, (2) Tasks 3–4, (3) Tasks 5–6, (4) Task 7, (5) Tasks 8–9. Each ends with `npx tsc --noEmit && npx vitest run src/lab` green and a commit on its branch. `max_runtime: 120m` each; dispatch (4) is the one likely to need a second run, since WGSL binding errors only surface at pipeline creation.

## Self-review against the spec

- §3 three passes → Task 3 (nets + quads + args; occupancy folded in, deviation 1) and Task 6 (draw). ✔
- §4 grid, occupancy, surface nets, output, conservativeness, cost estimate → Tasks 1, 2, 3, 4; the cost number is Task 9's sweep table. ✔
- §5 front faces, 4 steps, 2×band cap, shipped shading, depth → Task 5's override + Task 6's material; depth kept as shipped (deviation 5). The "≤ 2×band distance cap" is realised by tMaxBox = hullT + 2·band. ✔
- §6 chunks own hulls → Task 7 `spawnChunk` wraps `createChunkGpuView`. Occlusion/early-Z and the hybrid explicitly deferred. ✔
- §7 standalone page, toggle, knobs, seams, reel via parity harness, look first, cost reported → Tasks 7, 8, 9. ✔
- §8 tests: CPU mirror on the real zombie, conservativeness sweep, band coverage, occupancy soundness (the block-live test), parse contract, overflow flag → Tasks 1–4. Overflow is exercised by the kernel flag + `stats()`; a unit test of overflow on the CPU side is `maxCellVerts` small in `extractHullSoup` — add `it('flags overflow when the cap is tiny')` with `extractHullSoup(field, grid, band, 1, 16)` expecting `overflow === true` to Task 2's file. ✔
