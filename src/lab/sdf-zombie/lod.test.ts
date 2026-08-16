// src/lab/sdf-zombie/lod.test.ts
import { describe, it, expect } from 'vitest';
import {
  LOD_LEVELS, LOD_HYSTERESIS, pickLod, pickLodSticky, screenHeightPx,
  type LodLevel,
} from './lod';

describe('LOD_LEVELS', () => {
  it('runs coarser as it goes, never finer', () => {
    // A table that got re-ordered would silently give distant bodies MORE work
    // than near ones, which is the exact opposite of the point and would not
    // look wrong on screen.
    for (let i = 1; i < LOD_LEVELS.length; i++) {
      const prev = LOD_LEVELS[i - 1]!, cur = LOD_LEVELS[i]!;
      expect(cur.minScreenPx).toBeLessThan(prev.minScreenPx);
      expect(cur.steps).toBeLessThanOrEqual(prev.steps);
      for (const k of ['silhouetteNoise', 'surfaceNoise', 'scatter', 'ao', 'face'] as const)
        expect(prev[k] || !cur[k]).toBe(true);
      // simplify is the one flag where true means CHEAPER, so it may only
      // switch on as the levels coarsen.
      expect(!prev.simplify || cur.simplify).toBe(true);
    }
  });

  it('reaches every size, however small', () => {
    expect(LOD_LEVELS[LOD_LEVELS.length - 1]!.minScreenPx).toBe(0);
  });

  it('keeps wounds at every level', () => {
    // A body healing its craters as it walks away reads as a bug; losing its
    // ambient occlusion does not. Cheap, too, while the wound count is low.
    for (const l of LOD_LEVELS) expect(l.wounds).toBe(true);
  });
});

describe('screenHeightPx', () => {
  it('halves as distance doubles', () => {
    const a = screenHeightPx(1.8, 5, 75, 540);
    const b = screenHeightPx(1.8, 10, 75, 540);
    expect(b).toBeCloseTo(a / 2, 6);
  });

  it('scales with viewport height, which is why it beats raw distance', () => {
    // The same body at the same metres deserves more detail at 1080p than at
    // 540p. A distance-keyed table cannot express that; this is the reason the
    // module keys on pixels.
    expect(screenHeightPx(1.8, 5, 75, 1080)).toBeCloseTo(screenHeightPx(1.8, 5, 75, 540) * 2, 6);
  });

  it('shrinks as the lens widens', () => {
    expect(screenHeightPx(1.8, 5, 90, 540)).toBeLessThan(screenHeightPx(1.8, 5, 60, 540));
  });

  it('matches a hand-computed projection', () => {
    // 1.8 m tall, 5 m away, 75 deg vertical fov, 540 px tall viewport.
    // span = 2 * 5 * tan(37.5 deg) = 7.6733 m; 1.8 / 7.6733 * 540 = 126.7 px.
    expect(screenHeightPx(1.8, 5, 75, 540)).toBeCloseTo(126.7, 1);
  });

  it('treats a body at or behind the eye as maximally large', () => {
    // Degrading the body you have walked inside of would be exactly wrong.
    expect(screenHeightPx(1.8, 0, 75, 540)).toBe(Infinity);
    expect(screenHeightPx(1.8, -3, 75, 540)).toBe(Infinity);
  });
});

describe('pickLod', () => {
  it.each([
    [1000, 0], [150, 0], [149, 1], [60, 1], [59, 2], [0, 2],
  ])('at %i px picks level %i', (px, want) => {
    expect(pickLod(px)).toBe(want);
  });

  it('gives an unmeasurable body the FINEST level, not the coarsest', () => {
    // A caller that could not work out a size is asking for a body to be drawn
    // properly. Degrading it would hide the caller's bug behind a body that
    // merely looks a bit cheap.
    expect(pickLod(NaN)).toBe(0);
  });

  it('clamps rather than running off a table that never reaches zero', () => {
    const table: LodLevel[] = LOD_LEVELS.map(l => ({ ...l, minScreenPx: Math.max(l.minScreenPx, 10) }));
    expect(pickLod(1, table)).toBe(table.length - 1);
  });

  it('rejects an empty table instead of returning a bad index', () => {
    expect(() => pickLod(100, [])).toThrow(/empty/);
  });
});

describe('pickLodSticky', () => {
  const boundary = LOD_LEVELS[0]!.minScreenPx;   // 150
  const band = boundary * LOD_HYSTERESIS;

  it('matches pickLod with no previous level', () => {
    expect(pickLodSticky(100, -1)).toBe(pickLod(100));
  });

  it('holds the finer level just below the boundary', () => {
    // Without this a body parked on the boundary flips level every frame as
    // the camera breathes, and the coarse swap is visible when it does.
    expect(pickLodSticky(boundary - band * 0.5, 0)).toBe(0);
  });

  it('gives way once clear of the band', () => {
    expect(pickLodSticky(boundary - band * 1.5, 0)).toBe(1);
  });

  it('holds the coarser level just above the boundary', () => {
    expect(pickLodSticky(boundary + band * 0.5, 1)).toBe(1);
  });

  it('promotes once clear of the band on the way up', () => {
    expect(pickLodSticky(boundary + band * 1.5, 1)).toBe(0);
  });

  it('does not stick against a zero boundary', () => {
    // The coarsest level's threshold is 0, so there is no band to measure.
    expect(pickLodSticky(1000, LOD_LEVELS.length - 1)).toBe(pickLod(1000));
  });

  it('ignores an out-of-range previous level', () => {
    expect(pickLodSticky(100, 99)).toBe(pickLod(100));
  });
});
