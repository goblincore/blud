import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from './types';
import {
  WG_MAX_INDICES, WG_TEXELS, woundGridLookup, woundGridReach, woundGridTexel, writeWoundGrid, type WoundGridLayout,
} from './wound-grid';

// A body's band as the game lays it out: 26 rows of 128, the wound rows where layout.ts puts them.
const L: WoundGridLayout = { woundRow: 5, metaRow: 6, capRow: 18, flagsRow: 19, cutRow: 25, stride: 128 };
const K = 0.015, OFF = 1.15, WIDTH = 0.42, SLACK = 0.03;
const fresh = () => new Float32Array(26 * 128 * 4);

/** Wounds over a torso's front: a 40 x 50 cm sheet, seeded. */
function wounds(n: number): { pos: Vec3[]; rad: number[] } {
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pos: Vec3[] = [], rad: number[] = [];
  for (let i = 0; i < n; i++) { pos.push([3 + (rnd() - 0.5) * 0.4, 0.9 + rnd() * 0.5, -2 + (rnd() - 0.5) * 0.08]); rad.push(0.03 + rnd() * 0.025); }
  return { pos, rad };
}

describe('the crater grid', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('keeps to the free columns of the wound rows', () => {
    const seen = new Set<number>();
    for (let t = 0; t < WG_TEXELS; t++) {
      const o = woundGridTexel(L, t) / 4, row = Math.floor(o / L.stride), col = o % L.stride;
      expect([L.woundRow, L.metaRow, L.capRow, L.flagsRow, L.cutRow]).toContain(row);
      // Past the wounds (0..31) everywhere, and past the baked volume's table (32..55) in the four rows that hold it.
      expect(col).toBeGreaterThanOrEqual(row === L.cutRow ? 32 : 56);
      expect(col).toBeLessThan(128);
      seen.add(o);
    }
    expect(seen.size).toBe(WG_TEXELS);
  });

  it('lists at a sample every wound whose reach holds it, in rising order, and far fewer than all of them', () => {
    const { pos, rad } = wounds(32), texels = fresh();
    const stats = writeWoundGrid(texels, L, pos, rad, 32, K, OFF, WIDTH, SLACK);
    expect(stats.live).toBe(true);
    expect(stats.indices).toBeLessThanOrEqual(WG_MAX_INDICES);
    let seed = 99, walked = 0, samples = 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let s = 0; s < 3000; s++) {
      const p: Vec3 = [3 + (rnd() - 0.5) * 0.9, 0.7 + rnd() * 0.9, -2 + (rnd() - 0.5) * 0.6];
      const got = woundGridLookup(texels, L, p)!;
      expect(got).not.toBeNull();
      expect([...got].sort((a, b) => a - b)).toEqual(got);
      for (let i = 0; i < 32; i++) {
        const d = Math.hypot(p[0] - pos[i]![0], p[1] - pos[i]![1], p[2] - pos[i]![2]);
        if (d <= woundGridReach(rad[i]!, K, OFF, WIDTH, SLACK)) expect(got).toContain(i);
      }
      if (got.length) { walked += got.length; samples++; }
    }
    // The point of it: a sample among the wounds walks a fraction of the list.
    expect(samples).toBeGreaterThan(300);
    expect(walked / samples).toBeLessThan(16);
    expect(stats.maxCell).toBeLessThanOrEqual(32);
  });

  it('is not live without wounds, on a texture too narrow, or when the cells need more indices than it holds', () => {
    const { pos, rad } = wounds(32);
    const a = fresh();
    expect(writeWoundGrid(a, L, pos, rad, 0, K, OFF, WIDTH, SLACK).live).toBe(false);
    expect(woundGridLookup(a, L, [3, 1, -2])).toBeNull();
    expect(writeWoundGrid(fresh(), { ...L, stride: 96 }, pos, rad, 32, K, OFF, WIDTH, SLACK).live).toBe(false);
    // A slack as wide as the list's own bound puts every wound in nearly every cell.
    const b = fresh();
    writeWoundGrid(b, L, pos, rad, 32, K, OFF, WIDTH, SLACK);
    expect(woundGridLookup(b, L, [3, 1, -2])).not.toBeNull();
    expect(writeWoundGrid(b, L, pos, rad, 32, K, OFF, WIDTH, 2).live).toBe(false);
    expect(woundGridLookup(b, L, [3, 1, -2])).toBeNull();   // the header was cleared: the list is walked again
  });

  it('?woundgrid: off by default, a slack in centimetres when on', async () => {
    const { woundGridSlack } = await import('./webgpu/march/wound-grid-flag');
    expect(woundGridSlack('')).toBe(-1);
    expect(woundGridSlack('?woundgrid=0')).toBe(-1);
    expect(woundGridSlack('?woundgrid')).toBe(0.03);
    expect(woundGridSlack('?woundgrid=1')).toBe(0.03);
    expect(woundGridSlack('?woundgrid=8')).toBeCloseTo(0.08, 9);
  });

  it('leaves the default text without a trace of the grid, and splices the lookup before the loop when on', async () => {
    const off = (await import('./webgpu/march/fields/wounds.wgsl')).APPLY_WOUNDS;
    expect(off).not.toContain('wgTexel');
    expect(off).not.toContain('wgOn');
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundgrid' });
    const on = (await import('./webgpu/march/fields/wounds.wgsl')).APPLY_WOUNDS;
    const iLookup = on.indexOf('let wgH1 = textureLoad(data, wgTexel(1, band), 0);');
    const iLoop = on.indexOf('for (var k = 0;');
    const iNext = on.indexOf('if (k >= wgCnt) { break; }');
    expect(iLookup).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(iLookup);
    expect(iNext).toBeGreaterThan(iLoop);
    expect(on).toContain('fn wgTexel(t: i32, band: i32) -> vec2<i32> {');
    // The list's own index source is still there, behind the grid's.
    expect(on).toContain('} else if (listOn) {');
  });
});
