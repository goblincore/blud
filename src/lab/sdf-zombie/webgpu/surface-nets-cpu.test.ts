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
import { extractHullSoup, gradientOf } from './surface-nets-cpu';
import { cross, dot, normalize, sub } from '../vec';

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
    // 1.5%, was 1%: half-strength blends (3662c1ca, owner-accepted) leave
    // sharper creases between clusters, where the gradient walk inward can exit
    // the far wall (measured 2026-09-22: 1.19%).
    expect(fails / soup.cellVerts).toBeLessThan(0.015);
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
