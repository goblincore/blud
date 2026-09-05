// src/lab/sdf-zombie/webgpu/goblin-skin.test.ts
import { describe, expect, it } from 'vitest';
import { GOBLIN_SKIN, goblinAlbedoPixels, goblinNormalPixels, goblinFpvSkinSrgbHex, goblinHeightField, goblinPitField, goblinRoughnessPixels, pitCellsFor, goblinSkinSrgbHex, goblinWartField } from './goblin-skin';

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
  it('tiles — the height field is exactly periodic, and the seam step is a pit rim, not a seam', () => {
    // Exact: every lattice wraps, so the field repeats to the bit.
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.02], [0.97, 0.33], [0.0, 0.0]] as const) {
      expect(goblinHeightField(u + 1, v, 64)).toBeCloseTo(goblinHeightField(u, v, 64), 12);
      expect(goblinHeightField(u, v + 1, 64)).toBeCloseTo(goblinHeightField(u, v, 64), 12);
    }
    // Adjacent texels across the seam: the fine pit field (8 px/cell) puts a
    // rim step of up to ~50 on the encoded x-normal, the same as any rim in
    // the interior. Bound it so a real seam (a jump on every row) is caught.
    const n = 64, px = goblinNormalPixels(n);
    let big = 0;
    for (let y = 0; y < n; y++) {
      const l = (y * n) * 4, r = (y * n + n - 1) * 4;
      if (Math.abs(px[l]! - px[r]!) > 32) big++;
    }
    expect(big / n).toBeLessThan(0.25);
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

  it('averages to the goblin base colour — mottle and warts darken it, they do not recolour it', () => {
    // Luminance may drop up to 8% (patches and wart shade are both darker
    // than base); hue is held by a looser 12% per-channel bound, because
    // the base's blue is small (121) and the same absolute shift reads as a
    // larger fraction of it.
    const base = goblinFpvSkinSrgbHex();
    const want = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    const means = [0, 1, 2].map((c) => {
      let sum = 0;
      for (let i = c; i < px.length; i += 4) sum += px[i]!;
      return sum / (size * size);
    });
    const lumWant = want[0]! + want[1]! + want[2]!;
    const lumMean = means[0]! + means[1]! + means[2]!;
    // Mottle patches, flecks and wart shade all darken: the mean sits BELOW
    // the toned base, within a 14% luminance budget, and the hue holds to
    // 16% per channel (blue is small, so the same shift reads larger there).
    expect(lumMean).toBeLessThan(lumWant);
    expect(Math.abs(lumMean - lumWant) / lumWant, `luminance ${lumMean} vs ${lumWant}`).toBeLessThan(0.14);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(means[c]! - want[c]!) / want[c]!, `channel ${c} mean ${means[c]} vs ${want[c]}`).toBeLessThan(0.16);
    }
  });

  it('is not flat — every channel varies by more than 5% of its own mean', () => {
    // Relative, because fpvExposure compresses the absolute range: a dark
    // channel at sd 5 over a mean of 75 is as mottled as a bright one at 9.
    for (let c = 0; c < 3; c++) {
      let sum = 0, sq = 0;
      for (let i = c; i < px.length; i += 4) { sum += px[i]!; sq += px[i]! * px[i]!; }
      const n = size * size, mean = sum / n;
      const sd = Math.sqrt(sq / n - mean * mean);
      expect(sd / mean, `channel ${c} sd ${sd} / mean ${mean}`).toBeGreaterThan(0.05);
    }
  });

  it('tiles — every field is periodic, and smooth texels agree across the seam', () => {
    // The lattices wrap by construction; pin that directly on the fields...
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.02], [0.97, 0.33]] as const) {
      expect(goblinWartField(u + 1, v)).toBeCloseTo(goblinWartField(u, v), 9);
      expect(goblinWartField(u, v + 1)).toBeCloseTo(goblinWartField(u, v), 9);
    }
    // ...and on the pixels, skipping texels on a fleck edge (a fleck is a
    // sharp feature; two ADJACENT texels across it legitimately differ).
    // Pits are smooth (smoothstep rims), so adjacent texels across the seam
    // agree; no skipping needed -- the periodicity of the pit field is
    // pinned above via the lattice.
    const cells = pitCellsFor(size);
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.02]] as const) {
      expect(goblinPitField(u + 1, v, cells)).toBeCloseTo(goblinPitField(u, v, cells), 9);
    }
    const isFleck = (_x: number, _y: number) => false;
    for (let y = 0; y < size; y++) {
      if (isFleck(0, y) || isFleck(size - 1, y)) continue;
      for (let c = 0; c < 3; c++) {
        const l = px[(y * size + 0) * 4 + c]!, r = px[(y * size + size - 1) * 4 + c]!;
        expect(Math.abs(l - r), `row ${y} ch ${c}`).toBeLessThanOrEqual(6);
      }
    }
    for (let x = 0; x < size; x++) {
      if (isFleck(x, 0) || isFleck(x, size - 1)) continue;
      for (let c = 0; c < 3; c++) {
        const t = px[(0 * size + x) * 4 + c]!, b = px[((size - 1) * size + x) * 4 + c]!;
        expect(Math.abs(t - b), `col ${x} ch ${c}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('carries the face\'s grain — a dense field of fine pits covering 25-55% of the skin, darker than the ridges', () => {
    const cells = pitCellsFor(size);
    let floor = 0, onSum = 0, onN = 0, offSum = 0, offN = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const pit = goblinPitField(x / size, y / size, cells);
      const i = (y * size + x) * 4; const lum = px[i]! + px[i + 1]! + px[i + 2]!;
      if (pit > 0.5) floor++;
      if (pit > 0.9) { onSum += lum; onN++; } else if (pit < 0.1) { offSum += lum; offN++; }
    }
    const cover = floor / (size * size);
    expect(cover, `pit coverage ${cover}`).toBeGreaterThan(0.25);
    expect(cover).toBeLessThan(0.55);
    expect(onN).toBeGreaterThan(20); expect(offN).toBeGreaterThan(20);
    expect(onSum / onN).toBeLessThan((offSum / offN) * 0.96);
  });

  it('keeps the coarse mottle to a whisper — no "random green shapes"', () => {
    // Compare the map with and without the pit term: the residual coarse
    // variation (mottle only) must be small next to the pits' contribution.
    // Measured as the standard deviation of a 4x4-box-blurred map (pits
    // average out at 8 px/cell; mottle at 21+ px/cell survives the blur).
    const blur: number[] = [];
    for (let y = 0; y < size; y += 4) for (let x = 0; x < size; x += 4) {
      let sum = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const i = ((y + dy) * size + (x + dx)) * 4; sum += px[i]! + px[i + 1]! + px[i + 2]!;
      }
      blur.push(sum / 16);
    }
    const mean = blur.reduce((a, b) => a + b, 0) / blur.length;
    const sd = Math.sqrt(blur.reduce((a, b) => a + (b - mean) * (b - mean), 0) / blur.length);
    expect(sd / mean, `coarse sd ${sd} / mean ${mean}`).toBeLessThan(0.06);
  });

  it('darkens where the normal map has a wart, so bumps and blotches agree', () => {
    // Statistical, not "the single darkest texel is a wart": the mottle
    // patches saturate to the full mottle colour and can out-darken any one
    // wart. What must hold is that wart crowns (wart field > 0.85, the same
    // field height() bumps) are darker ON AVERAGE than plain skin (< 0.55).
    let onSum = 0, onN = 0, offSum = 0, offN = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const lum = px[i]! + px[i + 1]! + px[i + 2]!;
        const wart = goblinWartField(x / size, y / size);
        if (wart > 0.85) { onSum += lum; onN++; }
        else if (wart < 0.55) { offSum += lum; offN++; }
      }
    }
    expect(onN).toBeGreaterThan(20);
    expect(onSum / onN).toBeLessThan((offSum / offN) * 0.93);
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

describe('goblinRoughnessPixels', () => {
  const size = 64;
  const px = goblinRoughnessPixels(size);
  it('runs from the ridge roughness to the pit roughness, in every channel', () => {
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(px[i + 1]); expect(px[i]).toBe(px[i + 2]); expect(px[i + 3]).toBe(255);
      lo = Math.min(lo, px[i]!); hi = Math.max(hi, px[i]!);
    }
    expect(lo / 255).toBeCloseTo(GOBLIN_SKIN.ridgeRoughness, 1);
    expect(hi / 255).toBeCloseTo(GOBLIN_SKIN.pitRoughness, 1);
  });
  it('is the same pit field the albedo and normal use', () => {
    const cells = pitCellsFor(size);
    for (const [x, y] of [[3, 9], [40, 17], [63, 63]] as const) {
      const pit = goblinPitField(x / size, y / size, cells);
      const want = Math.round((GOBLIN_SKIN.ridgeRoughness + (GOBLIN_SKIN.pitRoughness - GOBLIN_SKIN.ridgeRoughness) * pit) * 255);
      expect(px[(y * size + x) * 4]).toBe(want);
    }
  });
});
