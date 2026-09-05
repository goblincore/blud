// src/lab/sdf-zombie/webgpu/goblin-skin.test.ts
import { describe, expect, it } from 'vitest';
import { GOBLIN_SKIN, goblinAlbedoPixels, goblinNormalPixels, goblinSkinSrgbHex, goblinWartField } from './goblin-skin';

describe('goblinSkinSrgbHex', () => {
  it('matches the goblin.blob palette, not the old orb colour', () => {
    // goblin.blob palette: baseColor 0.34 0.44 0.19 LINEAR.
    const hex = goblinSkinSrgbHex();
    expect(hex).not.toBe(0x5a8f3c);          // the orbs' historical wrong value
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    expect(g).toBeGreaterThan(r);            // green channel dominates
    expect(r).toBeGreaterThan(b);            // olive, not mint
    expect(g).toBeGreaterThan(150);          // pale, not the dark 0x8f
  });
});

describe('goblinNormalPixels', () => {
  it('is deterministic — same size, identical bytes', () => {
    const a = goblinNormalPixels(64);
    const b = goblinNormalPixels(64);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('returns RGBA for every texel', () => {
    expect(goblinNormalPixels(32).length).toBe(32 * 32 * 4);
  });
  it('encodes unit-ish normals — every texel near the unit sphere', () => {
    const px = goblinNormalPixels(32);
    for (let i = 0; i < px.length; i += 4) {
      const x = px[i]! / 127.5 - 1, y = px[i + 1]! / 127.5 - 1, z = px[i + 2]! / 127.5 - 1;
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.9);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.1);
    }
  });
  it('points mostly outward — z is the dominant channel', () => {
    const px = goblinNormalPixels(32);
    let zLow = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 2]! < 160) zLow++;
    expect(zLow).toBe(0);
  });
  it('is actually bumpy — x and y are not all flat', () => {
    const px = goblinNormalPixels(64);
    const xs = new Set<number>();
    for (let i = 0; i < px.length; i += 4) xs.add(px[i]!);
    expect(xs.size).toBeGreaterThan(20);
  });
  it('tiles — the left and right edge columns agree', () => {
    const n = 64, px = goblinNormalPixels(n);
    for (let y = 0; y < n; y++) {
      const l = (y * n) * 4, r = (y * n + n - 1) * 4;
      expect(Math.abs(px[l]! - px[r]!)).toBeLessThan(24);
    }
  });
});

describe('goblinAlbedoPixels', () => {
  const size = 64;
  const px = goblinAlbedoPixels(size);

  it('is deterministic — same size, identical bytes', () => {
    expect(goblinAlbedoPixels(size)).toEqual(px);
  });

  it('returns opaque RGBA for every texel', () => {
    expect(px.length).toBe(size * size * 4);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
  });

  it('averages to the goblin base colour, within 8% — mottle darkens, it does not recolour', () => {
    const base = goblinSkinSrgbHex();
    const want = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = c; i < px.length; i += 4) sum += px[i]!;
      const mean = sum / (size * size);
      expect(Math.abs(mean - want[c]!) / want[c]!, `channel ${c} mean ${mean} vs ${want[c]}`).toBeLessThan(0.08);
    }
  });

  it('is not flat — every channel varies by more than 6 byte-steps of standard deviation', () => {
    for (let c = 0; c < 3; c++) {
      let sum = 0, sq = 0;
      for (let i = c; i < px.length; i += 4) { sum += px[i]!; sq += px[i]! * px[i]!; }
      const n = size * size, mean = sum / n;
      const sd = Math.sqrt(sq / n - mean * mean);
      expect(sd, `channel ${c} sd`).toBeGreaterThan(6);
    }
  });

  it('tiles — opposite edge rows and columns agree within one step', () => {
    for (let y = 0; y < size; y++) {
      for (let c = 0; c < 3; c++) {
        const l = px[(y * size + 0) * 4 + c]!, r = px[(y * size + size - 1) * 4 + c]!;
        expect(Math.abs(l - r), `row ${y} ch ${c}`).toBeLessThanOrEqual(6);
      }
    }
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        const t = px[(0 * size + x) * 4 + c]!, b = px[((size - 1) * size + x) * 4 + c]!;
        expect(Math.abs(t - b), `col ${x} ch ${c}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('darkens where the normal map has a wart, so bumps and blotches agree', () => {
    // The wart layer is tileNoise(u*6, v*6, 6, seed 7) > 0.55 in height(). Find
    // the darkest texel and the brightest; the darkest must sit on a wart.
    let dark = Infinity, darkAt = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i]! + px[i + 1]! + px[i + 2]!;
      if (lum < dark) { dark = lum; darkAt = i / 4; }
    }
    const u = (darkAt % size) / size, v = Math.floor(darkAt / size) / size;
    expect(goblinWartField(u, v)).toBeGreaterThan(0.55);
  });
});

describe('GOBLIN_SKIN', () => {
  it('carries the goblin.blob roughness, not the orbs 0.85', () => {
    expect(GOBLIN_SKIN.roughness).toBeCloseTo(0.42, 2);
  });
  it('sizes the hand from goblin.blob, not the old 0.055', () => {
    expect(GOBLIN_SKIN.handRadius).toBeCloseTo(0.046, 4);
  });
});
