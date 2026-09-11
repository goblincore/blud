import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as npy.test.ts).
import { registerHalfRes } from './upscale-registration.mjs';

type Img = { w: number; h: number; data: Float32Array };

/** A smooth colour field, evaluated at continuous output-pixel coordinates. */
const field = (u: number, v: number, c: number) =>
  0.5 + 0.2 * Math.sin(0.21 * u + 0.13 * v + c) + 0.15 * Math.cos(0.17 * v - 0.09 * u + 2 * c);

/** The native march: one ray per output pixel centre, all flesh. */
function native(w: number, h: number): Img {
  const img = { w, h, data: new Float32Array(w * h * 4) };
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      const p = (Y * w + X) * 4;
      for (let c = 0; c < 3; c++) img.data[p + c] = field(X + 0.5, Y + 0.5, c);
      img.data[p + 3] = 0.5;
    }
  }
  return img;
}

/** A half-res march whose ray for texel (x, y) lands at output px (2x + 1 + sx, 2y + 1 + sy). */
function halfRes(w: number, h: number, sx: number, sy: number): Img {
  const img = { w, h, data: new Float32Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) img.data[p + c] = field(2 * x + 1 + sx, 2 * y + 1 + sy, c);
      img.data[p + 3] = 0.5;
    }
  }
  return img;
}

describe('registerHalfRes', () => {
  const hr = native(160, 120);

  it('finds no shift for an aligned half-res march', () => {
    const r = registerHalfRes(halfRes(80, 60, 0, 0), hr);
    expect(r.argmin).toEqual({ ox: 0, oy: 0 });
    expect(Math.abs(r.subpixel.x)).toBeLessThan(0.05);
    expect(Math.abs(r.subpixel.y)).toBeLessThan(0.05);
    expect(r.texels).toBeGreaterThan(1000);
  });

  it('finds a whole output-pixel shift, in the right direction', () => {
    expect(registerHalfRes(halfRes(80, 60, 1, 0), hr).argmin).toEqual({ ox: 1, oy: 0 });
    expect(registerHalfRes(halfRes(80, 60, 0, -1), hr).argmin).toEqual({ ox: 0, oy: -1 });
  });

  it('estimates a half output-pixel shift (the misregistration a centroid cannot see)', () => {
    const r = registerHalfRes(halfRes(80, 60, 0, 0.5), hr);
    expect(r.subpixel.y).toBeGreaterThan(0.35);
    expect(r.subpixel.y).toBeLessThan(0.65);
    expect(Math.abs(r.subpixel.x)).toBeLessThan(0.05);
  });

  it('ignores silhouette disagreement: a ragged hole in the native march only does not move it', () => {
    const cut = native(160, 120);
    for (let Y = 40; Y < 80; Y++) {
      for (let X = 60 + (Y % 3); X < 100; X++) cut.data[(Y * 160 + X) * 4 + 3] = 1;
    }
    const r = registerHalfRes(halfRes(80, 60, 0, 0), cut);
    expect(r.argmin).toEqual({ ox: 0, oy: 0 });
    expect(Math.abs(r.subpixel.x)).toBeLessThan(0.05);
    expect(Math.abs(r.subpixel.y)).toBeLessThan(0.05);
  });

  it('rejects a pair that is not exactly 2x', () => {
    expect(() => registerHalfRes(halfRes(80, 60, 0, 0), native(150, 120))).toThrow(/not 2x/);
  });
});
