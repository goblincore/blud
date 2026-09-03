import { describe, expect, it } from 'vitest';
import { flashPixels, smokePixels } from './flash-sprite';

const alphaAt = (px: Uint8Array, size: number, x: number, y: number) =>
  px[(y * size + x) * 4 + 3] ?? 0;

describe('flashPixels', () => {
  it('is deterministic for a seed and varies between seeds', () => {
    expect(Array.from(flashPixels(32, 1))).toEqual(Array.from(flashPixels(32, 1)));
    expect(Array.from(flashPixels(32, 1))).not.toEqual(Array.from(flashPixels(32, 2)));
  });
  it('is hot in the middle and empty at the corners', () => {
    const n = 64, px = flashPixels(n, 5);
    expect(alphaAt(px, n, n / 2, n / 2)).toBeGreaterThan(240);
    expect(alphaAt(px, n, 0, 0)).toBe(0);
    expect(alphaAt(px, n, n - 1, n - 1)).toBe(0);
  });
  it('is NOT a rectangle — alpha falls off with radius', () => {
    const n = 64, px = flashPixels(n, 5), c = n / 2;
    const mid = alphaAt(px, n, c, c);
    const edge = alphaAt(px, n, c, 2);
    expect(edge).toBeLessThan(mid * 0.35);
  });
  it('is ragged — the radius where alpha dies varies with angle', () => {
    const n = 96, px = flashPixels(n, 11), c = n / 2;
    const reach: number[] = [];
    for (let k = 0; k < 12; k++) {
      const th = (k / 12) * Math.PI * 2;
      let last = 0;
      for (let r = 1; r < c - 1; r++) {
        const x = Math.round(c + Math.cos(th) * r), y = Math.round(c + Math.sin(th) * r);
        if (alphaAt(px, n, x, y) > 12) last = r;
      }
      reach.push(last);
    }
    // A disc would give the same reach at every angle; a star must not.
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(3);
  });
  it('keeps a round hot core rather than a spiky hole', () => {
    const n = 64, px = flashPixels(n, 7), c = n / 2;
    for (const [dx, dy] of [[0, 0], [3, 0], [0, 3], [-3, 0], [0, -3]]) {
      expect(alphaAt(px, n, c + dx!, c + dy!)).toBeGreaterThan(200);
    }
  });
});

describe('smokePixels', () => {
  it('is deterministic and RGBA-complete', () => {
    expect(Array.from(smokePixels(32))).toEqual(Array.from(smokePixels(32)));
    expect(smokePixels(16).length).toBe(16 * 16 * 4);
  });
  it('is grey and soft-edged, with nothing in the corners', () => {
    const n = 64, px = smokePixels(n);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(alphaAt(px, n, 0, 0)).toBe(0);
    expect(alphaAt(px, n, n / 2, n / 2)).toBeGreaterThan(60);
  });
  it('is lumpy — not a perfect disc', () => {
    const n = 96, px = smokePixels(n), c = n / 2;
    const reach: number[] = [];
    for (let k = 0; k < 10; k++) {
      const th = (k / 10) * Math.PI * 2;
      let last = 0;
      for (let r = 1; r < c - 1; r++) {
        const x = Math.round(c + Math.cos(th) * r), y = Math.round(c + Math.sin(th) * r);
        if (alphaAt(px, n, x, y) > 8) last = r;
      }
      reach.push(last);
    }
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(2);
  });
});
