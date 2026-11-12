import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from './types';
import { MAX_WOUNDS } from './damage';
import {
  WG_CELL_MAX, WG_COLS, WG_MAX_INDICES, WG_MAX_WOUNDS, WG_ROW0, WG_ROWS, WG_TEXELS,
  woundGridLookup, woundGridReach, woundGridTexel, writeWoundGrid, type WoundGridLayout,
} from './wound-grid';

// A body's band under the switch: the 26 rows and the grid's, 128 texels wide.
const L: WoundGridLayout = { gridRow: WG_ROW0, stride: 128 };
const K = 0.015, OFF = 1.15, WIDTH = 0.42, SLACK = 0.03;
const fresh = () => new Float32Array((WG_ROW0 + WG_ROWS) * 128 * 4);

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

  it('sits in its own rows after the band of before, and the band grows by them only under the switch', async () => {
    const seen = new Set<number>();
    for (let t = 0; t < WG_TEXELS; t++) {
      const o = woundGridTexel(L, t) / 4, row = Math.floor(o / L.stride), col = o % L.stride;
      expect(row).toBeGreaterThanOrEqual(WG_ROW0);
      expect(row).toBeLessThan(WG_ROW0 + WG_ROWS);
      expect(col).toBeLessThan(WG_COLS);
      seen.add(o);
    }
    expect(seen.size).toBe(WG_TEXELS);
    expect((await import('./webgpu/march/layout')).DATA_ROWS).toBe(WG_ROW0);
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundgrid' });
    expect((await import('./webgpu/march/layout')).DATA_ROWS).toBe(WG_ROW0 + WG_ROWS);
  });

  it('lists at a sample every wound whose reach holds it, in rising order, and far fewer than all of them', () => {
    for (const n of [32, WG_MAX_WOUNDS]) {
      const { pos, rad } = wounds(n), texels = fresh();
      const stats = writeWoundGrid(texels, L, pos, rad, n, K, OFF, WIDTH, SLACK);
      expect(stats.live).toBe(true);
      expect(stats.indices).toBeLessThanOrEqual(WG_MAX_INDICES);
      expect(stats.maxCell).toBeLessThanOrEqual(WG_CELL_MAX);
      let seed = 99, walked = 0, samples = 0;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let s = 0; s < 3000; s++) {
        const p: Vec3 = [3 + (rnd() - 0.5) * 0.9, 0.7 + rnd() * 0.9, -2 + (rnd() - 0.5) * 0.6];
        const got = woundGridLookup(texels, L, p)!;
        expect(got).not.toBeNull();
        expect(got.length).toBeLessThanOrEqual(WG_CELL_MAX);
        expect([...got].sort((a, b) => a - b)).toEqual(got);
        const want: number[] = [];
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(p[0] - pos[i]![0], p[1] - pos[i]![1], p[2] - pos[i]![2]);
          if (d <= woundGridReach(rad[i]!, K, OFF, WIDTH, SLACK)) want.push(i);
        }
        // Every wound in reach is listed; where cells held more than they list, the newest in reach still is.
        if (stats.clipped === 0) for (const i of want) expect(got).toContain(i);
        else if (want.length) expect(got).toContain(want[want.length - 1]);
        if (got.length) { walked += got.length; samples++; }
      }
      // The point of it: a sample among the wounds walks a fraction of them.
      expect(samples).toBeGreaterThan(300);
      expect(walked / samples).toBeLessThan(n === 32 ? 16 : 48);
    }
  });

  it('a cell past its limit keeps its newest wounds', () => {
    // Eighty wounds on one spot: every cell they reach holds all eighty.
    const pos: Vec3[] = [], rad: number[] = [];
    for (let i = 0; i < 80; i++) { pos.push([1 + i * 1e-4, 1, 1]); rad.push(0.04); }
    const texels = fresh();
    const stats = writeWoundGrid(texels, L, pos, rad, 80, K, OFF, WIDTH, SLACK);
    expect(stats.live).toBe(true);
    expect(stats.clipped).toBeGreaterThan(0);
    const got = woundGridLookup(texels, L, [1, 1, 1])!;
    // The index rows hold fewer than WG_CELL_MAX a cell for a full table: the limit dropped, the newest stayed.
    expect(got.length).toBeGreaterThanOrEqual(30);
    expect(got.length).toBeLessThanOrEqual(WG_CELL_MAX);
    expect(got).toEqual(Array.from({ length: got.length }, (_, k) => 80 - got.length + k));
    expect(WG_CELL_MAX).toBeGreaterThanOrEqual(MAX_WOUNDS);
    expect(stats.indices).toBeLessThanOrEqual(WG_MAX_INDICES);
  });

  it('is not live without wounds or on a texture too narrow, and says so in its header', () => {
    const { pos, rad } = wounds(WG_MAX_WOUNDS);
    const a = fresh();
    expect(writeWoundGrid(a, L, pos, rad, 0, K, OFF, WIDTH, SLACK).live).toBe(false);
    expect(woundGridLookup(a, L, [3, 1, -2])).toBeNull();
    expect(writeWoundGrid(fresh(), { ...L, stride: 96 }, pos, rad, 32, K, OFF, WIDTH, SLACK).live).toBe(false);
    const b = fresh();
    writeWoundGrid(b, L, pos, rad, 32, K, OFF, WIDTH, SLACK);
    expect(woundGridLookup(b, L, [3, 1, -2])).not.toBeNull();
    // A slack as wide as the room puts every wound in every cell: still live, every cell at the dropped limit.
    const wide = writeWoundGrid(b, L, pos, rad, WG_MAX_WOUNDS, K, OFF, WIDTH, 5);
    expect(wide.live).toBe(true);
    expect(wide.indices).toBeLessThanOrEqual(WG_MAX_INDICES);
    expect(writeWoundGrid(b, L, pos, rad, 0, K, OFF, WIDTH, SLACK).live).toBe(false);
    expect(woundGridLookup(b, L, [3, 1, -2])).toBeNull();   // the header was cleared: the list is walked again
  });

  it('?woundgrid: off by default, a slack in centimetres when on, and it switches the baked wound volume off', async () => {
    const { woundGridSlack } = await import('./webgpu/march/wound-grid-flag');
    expect(woundGridSlack('')).toBe(-1);
    expect(woundGridSlack('?woundgrid=0')).toBe(-1);
    expect(woundGridSlack('?woundgrid')).toBe(0.03);
    expect(woundGridSlack('?woundgrid=1')).toBe(0.03);
    expect(woundGridSlack('?woundgrid=8')).toBeCloseTo(0.08, 9);
    const { woundVolumeVoxel } = await import('./webgpu/march/wound-volume-flag');
    expect(woundVolumeVoxel('?woundgrid')).toBe(0);
    expect(woundVolumeVoxel('?woundgrid=0')).toBe(0.02);
  });

  it('leaves the default text without a trace of the grid; on, every loop over the wounds takes the cell\'s', async () => {
    const off = await import('./webgpu/march.wgsl');
    const offAll = [...Object.values(off).filter((v): v is string => typeof v === 'string'), ...(off.HELPERS as string[])].join('\n');
    expect(offAll).not.toContain('wgBegin');
    expect(offAll).not.toContain('wgTexel');
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundgrid' });
    const { APPLY_WOUNDS, WOUND_MASK } = await import('./webgpu/march/fields/wounds.wgsl');
    const { NG_WOUNDS } = await import('./webgpu/normal-gradient.wgsl');
    const tissue = await import('./webgpu/march/fields/tissue.wgsl');
    const iLookup = APPLY_WOUNDS.indexOf('wgS = wgBegin(p, data, band);');
    const iLoop = APPLY_WOUNDS.indexOf('for (var k = 0;');
    const iNext = APPLY_WOUNDS.indexOf('if (k >= wgS.z) { break; }');
    expect(iLookup).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(iLookup);
    expect(iNext).toBeGreaterThan(iLoop);
    expect(APPLY_WOUNDS).toContain('fn wgBegin(p: vec3<f32>, data: texture_2d<f32>, band: i32) -> vec3<i32> {');
    expect(APPLY_WOUNDS).toContain('} else if (listOn) {');   // the list's own index source, behind the grid's
    expect(APPLY_WOUNDS).not.toContain('wvRead');             // the baked volume is off with it
    for (const src of [WOUND_MASK, NG_WOUNDS, Object.values(tissue).filter((v): v is string => typeof v === 'string').join('\n')]) {
      expect(src).toContain('let wgS = wgBegin(p, data, gBand);');
      expect(src).toContain('i = wgIndex(wgS.y + wgK, data, gBand);');
    }
  });
});
