// src/lab/sdf-zombie/webgpu/march/tile-ref.test.ts
//
// The tile reference list (tile-ref-flag.ts), on by default since 2026-11-10. Off (`?tileref=0`), the march's text
// and the entry records are what they were (the golden snapshot holds the text). On, no reader of the per-pixel
// tile arrays is left, the one array that replaces them is declared, and the packers put the group's index on the
// meta lane beside the body's.
import { afterEach, describe, expect, it, vi } from 'vitest';

const ARRAYS = ['gTileBounds', 'gTileGrp', 'gTileBand', 'gTileSlot', 'gPixSlot', 'gPixFirst', 'gPixEnd'];

async function load(search: string) {
  vi.resetModules();
  vi.stubGlobal('location', { search });
  const flag = await import('./tile-ref-flag');
  const groups = await import('./fields/groups.wgsl');
  const body = await import('./map-body.wgsl');
  const lean = await import('./lean-walk.wgsl');
  const preload = await import('./body/blocks/setup/tile-preload.wgsl');
  const ng = await import('../normal-gradient.wgsl');
  const cull = await import('../tile-cull');
  const bin = await import('../tile-bin-compute');
  const text = [groups.FOLD_GROUP, body.MAP_BODY, lean.MAP_LEAN, lean.LEAN_TEST_BLOCK, preload.TILE_PRELOAD_BLOCK, ng.NG_BODY].join('\n');
  return { flag, text, groups, cull, bin };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('the tile reference list', () => {
  it('is on without the parameter, and for any value but 0', async () => {
    for (const search of ['', '?level=arena', '?tileref', '?tileref=1']) {
      const { flag, text, groups } = await load(search);
      expect(flag.TILE_REF, search).toBe(true);
      for (const name of ARRAYS) expect(text, search).not.toContain(name);
      expect(groups.FOLD_GROUP, search).toContain('var<private> gTileRef: array<u32, 64>;');
    }
  });

  it('?tileref=0 is off: the arrays are declared and the meta lane is the body index', async () => {
    const { flag, groups, cull } = await load('?tileref=0');
    expect(flag.TILE_REF).toBe(false);
    for (const name of ARRAYS) expect(groups.FOLD_GROUP).toContain(`var<private> ${name}:`);
    expect(groups.FOLD_GROUP).not.toContain('gTileRef');
    const g = { bodyIndex: 3, groupIndex: 17, start: 0, count: 2, center: [0, 0, 0] as [number, number, number], radius: 1, distort: 1, flags: 0 };
    expect(cull.tileMetaX(g)).toBe(3);
  });

  it('?tileref: one array of references, and no reader of the copied arrays in any march source', async () => {
    const { flag, text, groups } = await load('?tileref');
    expect(flag.TILE_REF).toBe(true);
    for (const name of ARRAYS) expect(text).not.toContain(name);
    expect(groups.FOLD_GROUP).toContain('var<private> gTileRef: array<u32, 64>;');
    expect(text).toContain('fn tileRunEnd(first: i32) -> i32');
  });

  it('?tileref: both packers write slot + index / 256, exactly, and the readback gives the slot back', async () => {
    const { flag, cull, bin } = await load('?tileref');
    const g = { bodyIndex: 5, groupIndex: 37, start: 4, count: 2, center: [0, 0, 0] as [number, number, number], radius: 1, distort: 1, flags: 0 };
    const x = cull.tileMetaX(g);
    expect(Math.fround(x)).toBe(x);
    expect(Math.floor(x)).toBe(5);
    expect(Math.round((x - Math.floor(x)) * flag.TILE_REF_GROUPS)).toBe(37);
    const out = bin.packGroups([g], new Float32Array(bin.GROUP_RECORD_SCALARS * bin.MAX_TILE_GROUPS))!;
    expect(out[8]).toBe(x);
    expect(() => cull.tileMetaX({ ...g, groupIndex: 256 })).toThrow(/does not fit/);
    expect(cull.tileMetaX({ ...g, groupIndex: undefined })).toBe(5);
  });
});
