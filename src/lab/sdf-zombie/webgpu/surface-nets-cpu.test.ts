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
