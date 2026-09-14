import { describe, it, expect } from 'vitest';
import { createCrowdPrimAtlas, bandRowOffset } from './crowd-atlas';
import { DATA_ROWS, ROW_PRIM_A, ROW_WOUND } from './march.wgsl';
import { MAX_PRIMS } from '../validate';

describe('crowd prim atlas', () => {
  it('offsets rows by band', () => {
    expect(bandRowOffset(0)).toBe(0);
    expect(bandRowOffset(3)).toBe(3 * DATA_ROWS);
  });
  it('writes a band row at the banded texel offset and marks dirty', () => {
    const atlas = createCrowdPrimAtlas(4);
    expect(atlas.texture.image.height).toBe(4 * DATA_ROWS);
    const src = new Float32Array(MAX_PRIMS * 4); src[0] = 42;
    const sink = atlas.sink(2);
    sink.writeRow(ROW_PRIM_A, src, MAX_PRIMS);
    const o = ((2 * DATA_ROWS + ROW_PRIM_A) * MAX_PRIMS) * 4;
    expect(atlas.texels[o]).toBe(42);
    expect(atlas.dirty).toBe(true);
    expect(sink.woundLayout.woundRow).toBe(2 * DATA_ROWS + ROW_WOUND);
    expect(sink.texels).toBe(atlas.texels);
  });
  it('a one-band atlas has the legacy single-body shape', () => {
    const atlas = createCrowdPrimAtlas(1);
    expect(atlas.texture.image.width).toBe(MAX_PRIMS);
    expect(atlas.texture.image.height).toBe(DATA_ROWS);
  });
});
