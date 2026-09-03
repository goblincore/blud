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
