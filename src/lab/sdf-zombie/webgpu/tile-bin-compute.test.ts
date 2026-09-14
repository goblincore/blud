// src/lab/sdf-zombie/webgpu/tile-bin-compute.test.ts
//
// Unit pins for the GPU tile binner. The REAL gate is the in-browser A/B
// against the CPU binner (__sdfLab.tileAB / scripts/tile-ab.mjs) — these
// tests pin everything that can be checked without a GPU: the structural
// cap argument, the sizing maths, the group-record packing, and the kernel
// sources' load-bearing shape (the WGSL template-literal trap has bitten
// before, so the shipped text itself is under test).

import { describe, expect, it } from 'vitest';
import {
  GROUP_RECORD_SCALARS,
  K_TILE_COUNTS,
  K_TILE_RANGE,
  K_TILE_SCAN,
  K_TILE_WRITE,
  MAX_TILE_GROUPS,
  packGroups,
  worstCaseEntries,
  worstCaseTiles,
} from './tile-bin-compute';
import {
  TILE_MAX_ENTRIES,
  TILE_SIZE_PX,
  type TileGroupInput,
} from './tile-cull';

describe('tile-bin-compute structural caps', () => {
  it('MAX_TILE_GROUPS is the crowd type capacity — 64 instances x 32 groups', () => {
    // Shared by one crowd type's binding; the PER-TILE cap stays
    // TILE_MAX_ENTRIES and is enforced inside the kernels (kTileCounts) and
    // by kTileWrite. Raise this only with a matching groups-buffer allocation.
    expect(MAX_TILE_GROUPS).toBe(2048);
  });

  it('group records are three vec4s, matching the entry-stream stride', () => {
    expect(GROUP_RECORD_SCALARS).toBe(12);
  });
});

describe('worst-case sizing', () => {
  it('tiles from pixels round UP per axis', () => {
    expect(worstCaseTiles(960, 540)).toEqual({
      tilesX: Math.ceil(960 / TILE_SIZE_PX),
      tilesY: Math.ceil(540 / TILE_SIZE_PX),
    });
    expect(worstCaseTiles(1, 1)).toEqual({ tilesX: 1, tilesY: 1 });
    // A partial edge tile still gets its own column/row.
    const { tilesX } = worstCaseTiles(TILE_SIZE_PX + 1, TILE_SIZE_PX);
    expect(tilesX).toBe(2);
  });

  it('entry capacity covers every (tile, group) pair', () => {
    const { tilesX, tilesY } = worstCaseTiles(672, 378);
    expect(worstCaseEntries(tilesX, tilesY))
      .toBe(tilesX * tilesY * TILE_MAX_ENTRIES);
  });
});

describe('packGroups', () => {
  const g = (over: Partial<TileGroupInput> = {}): TileGroupInput => ({
    bodyIndex: 0, start: 7, count: 3,
    center: [1, 2, 3], radius: 0.5,
    distort: 2.25, flags: 3,
    ...over,
  });

  it('writes bounds, the ROW_GROUP_RANGE pack, and bodyIndex in order', () => {
    const out = new Float32Array(MAX_TILE_GROUPS * GROUP_RECORD_SCALARS);
    packGroups([g({ bodyIndex: 4 })], out);
    expect(out[0]).toBe(1);   // centre.x
    expect(out[1]).toBe(2);   // centre.y
    expect(out[2]).toBe(3);   // centre.z
    expect(out[3]).toBe(0.5); // radius
    expect(out[4]).toBe(7);   // start
    expect(out[5]).toBe(3);   // count
    expect(out[6]).toBe(2.25);// distort
    expect(out[7]).toBe(3);   // flags
    expect(out[8]).toBe(4);   // bodyIndex
  });

  it('zeroes slots past the live groups so stale records cannot leak', () => {
    const out = new Float32Array(MAX_TILE_GROUPS * GROUP_RECORD_SCALARS);
    out.fill(42);
    packGroups([g()], out);
    // Second record onwards must be zero.
    for (let i = GROUP_RECORD_SCALARS; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });

  it('returns null past MAX_TILE_GROUPS — callers fall back, never truncate', () => {
    const out = new Float32Array(MAX_TILE_GROUPS * GROUP_RECORD_SCALARS);
    const many = Array.from({ length: MAX_TILE_GROUPS + 1 }, (_, i) =>
      g({ start: i }));
    expect(packGroups(many, out)).toBeNull();
  });
});

describe('kernel sources', () => {
  it('all four kernels satisfy wgslFn’s ^fn parse contract', () => {
    for (const src of [K_TILE_RANGE, K_TILE_COUNTS, K_TILE_SCAN, K_TILE_WRITE]) {
      expect(src.trimStart().startsWith('fn ')).toBe(true);
    }
  });

  it('the projection block carries the deliberate Y flip', () => {
    // Getting this wrong mirrors the grid vertically and makes the body
    // vanish — it already happened once on the CPU path.
    expect(K_TILE_RANGE).toContain('Y IS FLIPPED HERE ON PURPOSE');
    expect(K_TILE_RANGE).toContain('(0.5 - ndcY * 0.5) * dims.y');
  });

  it('mirrors the CPU binner’s behind-camera cover-everything rule, widened', () => {
    // The 1e-6 guard (not 0) keeps eye-plane-grazing spheres out of the
    // projection branch, where f32-vs-f64 rounding could drop a boundary tile.
    expect(K_TILE_RANGE).toContain('nearDist <= 1e-6 || clip.w <= 0.0');
    expect(K_TILE_RANGE).toContain('i32(cfg.z) - 1');
    expect(K_TILE_RANGE).toContain('i32(cfg.w) - 1');
  });

  it('pads the AABB edges sub-tile — GPU lists must SUPERSET the CPU’s', () => {
    // f32-vs-f64 boundary rounding flips floors at tile edges; the pad makes
    // the GPU conservative in the only safe direction. Missing entries are
    // holes; extras are fold work the per-step sphere cull eats.
    expect(K_TILE_RANGE).toContain('let pad = rpix * 1e-5 + 0.01;');
    expect(K_TILE_RANGE).toContain('cx - rpix - pad');
  });

  it('rejects off-screen spheres instead of clamping them inward', () => {
    expect(K_TILE_RANGE).toContain('cx - rpix - pad >= dims.x');
  });

  it('kTileWrite walks groups ascending — bit-parity with the CPU order', () => {
    // Smooth-min is not commutative in float arithmetic, so the ORDER of a
    // tile's list is part of the contract with the CPU reference.
    expect(K_TILE_WRITE).toContain('var slot = base;');
    expect(K_TILE_WRITE).toContain('for (var g = 0u; g < u32(cfg.x); g++)');
  });

  it('no kernel infers anything from resource dimensions', () => {
    // textureDimensions-based inference is exactly what broke under adaptive
    // resolution on the DataTexture path.
    for (const src of [K_TILE_RANGE, K_TILE_COUNTS, K_TILE_SCAN, K_TILE_WRITE]) {
      expect(src).not.toContain('textureDimensions');
    }
  });
});
