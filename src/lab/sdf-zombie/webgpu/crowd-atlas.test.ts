import { describe, it, expect } from 'vitest';
import { createCrowdPrimAtlas, bandRowOffset } from './crowd-atlas';
import { DATA_ROWS, ROW_PRIM_A, ROW_WOUND } from './march.wgsl';
import { BASE_PRIM_STRIDE } from '../validate';

describe('crowd prim atlas', () => {
  it('offsets rows by band', () => {
    expect(bandRowOffset(0)).toBe(0);
    expect(bandRowOffset(3)).toBe(3 * DATA_ROWS);
  });
  it('writes a band row at the banded texel offset and marks dirty', () => {
    const atlas = createCrowdPrimAtlas(4);
    expect(atlas.texture.image.height).toBe(4 * DATA_ROWS);
    const src = new Float32Array(BASE_PRIM_STRIDE * 4); src[0] = 42;
    const sink = atlas.sink(2);
    sink.writeRow(ROW_PRIM_A, src, BASE_PRIM_STRIDE);
    const o = ((2 * DATA_ROWS + ROW_PRIM_A) * BASE_PRIM_STRIDE) * 4;
    expect(atlas.texels[o]).toBe(42);
    expect(atlas.dirty).toBe(true);
    expect(sink.woundLayout.woundRow).toBe(2 * DATA_ROWS + ROW_WOUND);
    expect(sink.texels).toBe(atlas.texels);
  });
  it('a one-band atlas has the legacy single-body shape', () => {
    const atlas = createCrowdPrimAtlas(1);
    expect(atlas.texture.image.width).toBe(BASE_PRIM_STRIDE);
    expect(atlas.texture.image.height).toBe(DATA_ROWS);
  });
  it('takes a per-type width: rows, wound layout and uploads all use it', () => {
    const uploads: Array<{ rows: number; len: number }> = [];
    const atlas = createCrowdPrimAtlas(2, (rows, data) => uploads.push({ rows, len: data.length }), 192);
    expect(atlas.stride).toBe(192);
    expect(atlas.texture.image.width).toBe(192);
    const sink = atlas.sink(1);
    expect(sink.stride).toBe(192);
    expect(sink.woundLayout.stride).toBe(192);
    const src = new Float32Array(192 * 4); src[150 * 4] = 7;
    sink.writeRow(ROW_PRIM_A, src, 192);
    expect(atlas.texels[((DATA_ROWS + ROW_PRIM_A) * 192 + 150) * 4]).toBe(7);
    expect(atlas.flush()).toBe(2 * DATA_ROWS);
    expect(uploads).toEqual([{ rows: 2 * DATA_ROWS, len: 2 * DATA_ROWS * 192 * 4 }]);
  });
});
