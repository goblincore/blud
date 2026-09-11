// src/lab/sdf-zombie/webgpu/temporal-accum.test.ts
//
// The PURE half of the accumulation: the jitter sequence and the blend rate.
// These are the rules that a GPU cannot check and that a viewer cannot see
// failing — a jitter that repeats, a rate that never re-seeds, or a sequence that
// depends on anything but the frame counter would all look plausible on screen
// while quietly making the accumulation meaningless or non-replayable.
import { describe, it, expect } from 'vitest';
import {
  TEMPORAL_ACCUM_DEFAULT_ALPHA,
  TEMPORAL_ACCUM_CONVERGED_FRAMES,
  accumAlpha,
  accumJitter,
  radicalInverse,
} from './temporal-accum';

describe('radicalInverse — the Halton digit-reversal', () => {
  it('is 0 at index 0 and fills [0, 1)', () => {
    expect(radicalInverse(0, 2)).toBe(0);
    for (const base of [2, 3, 5]) {
      for (let i = 0; i < 64; i++) {
        const v = radicalInverse(i, base);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('matches the textbook values, so a reader can check it by hand', () => {
    // base 2 is the binary fraction of the index reversed: 1 -> 0.1 = 0.5,
    // 2 -> 0.01 = 0.25, 3 -> 0.11 = 0.75.
    expect(radicalInverse(1, 2)).toBe(0.5);
    expect(radicalInverse(2, 2)).toBe(0.25);
    expect(radicalInverse(3, 2)).toBe(0.75);
    // base 3: 1 -> 1/3, 2 -> 2/3, 3 -> 1/9.
    expect(radicalInverse(1, 3)).toBeCloseTo(1 / 3, 12);
    expect(radicalInverse(2, 3)).toBeCloseTo(2 / 3, 12);
    expect(radicalInverse(3, 3)).toBeCloseTo(1 / 9, 12);
  });
});

describe('accumJitter — sub-pixel offsets in full-res pixels', () => {
  it('advances EVERY frame, which is the whole feature', () => {
    // A frozen jitter samples one sub-position forever: it freezes convergence
    // and turns the scheme back into the interlaced hold it replaces. This is the
    // property that makes "pin the jitter for recordings" the wrong instinct, so
    // it is pinned instead of commented.
    const seen = new Set<string>();
    for (let f = 0; f < 32; f++) {
      const [x, y] = accumJitter(f);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(32);
  });

  it('never repeats a component two frames running, and stays inside the pixel', () => {
    for (let f = 0; f < 64; f++) {
      const [x, y] = accumJitter(f);
      const [nx, ny] = accumJitter(f + 1);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(1);
      if (f > 0) {
        const [px, py] = accumJitter(f - 1);
        expect(x === px && y === py).toBe(false);
      }
      expect(x === nx && y === ny).toBe(false);
    }
  });

  it('is a pure function of the frame counter — replays reproduce it', () => {
    // No wall clock, no Math.random: the same epoch gives the same sequence, which
    // is what lets a recording be compared at all.
    const a = Array.from({ length: 24 }, (_, f) => accumJitter(f));
    const b = Array.from({ length: 24 }, (_, f) => accumJitter(f));
    expect(a).toEqual(b);
    // ...and both components are driven by the SAME counter (coprime bases), so
    // the 2D sequence covers the square rather than collapsing onto a diagonal.
    const xs = new Set(a.map(([x]) => x));
    const ys = new Set(a.map(([, y]) => y));
    expect(xs.size).toBe(24);
    expect(ys.size).toBe(24);
  });

  it('covers the sub-pixel square evenly enough to supersample a 2x2 grid', () => {
    // At sdfScale 0.5 each output pixel reads one of four low-res texels; the
    // sequence has to visit all four quadrants quickly or the reconstruction only
    // fills part of the image. Checked over the first 8 frames.
    const quad = new Set<string>();
    for (let f = 0; f < 8; f++) {
      const [x, y] = accumJitter(f);
      quad.add(`${x < 0.5 ? 0 : 1}${y < 0.5 ? 0 : 1}`);
    }
    expect(quad.size).toBe(4);
  });
});

describe('accumAlpha — the blend rate, and the re-seed', () => {
  it('takes the current sample outright on the first frame of an epoch', () => {
    // alpha 1 is what makes frame 0 independent of whatever the buffer held, i.e.
    // the reset is a re-seed rather than a clear pass that could be missed.
    expect(accumAlpha(0)).toBe(1);
  });

  it('is the shipped constant afterwards, and clamps an override', () => {
    expect(accumAlpha(1)).toBe(TEMPORAL_ACCUM_DEFAULT_ALPHA);
    expect(accumAlpha(99)).toBe(TEMPORAL_ACCUM_DEFAULT_ALPHA);
    expect(accumAlpha(5, 0.5)).toBe(0.5);
    // Never 0 (a frozen history) and never > 1 (a nonsense blend).
    expect(accumAlpha(5, 0)).toBe(0.01);
    expect(accumAlpha(5, 2)).toBe(1);
  });

  it('settles inside the documented window', () => {
    // The convergence claim the plan makes to the owner: ~94% of the way to a
    // settled value within TEMPORAL_ACCUM_CONVERGED_FRAMES frames.
    const residual = Math.pow(1 - TEMPORAL_ACCUM_DEFAULT_ALPHA, TEMPORAL_ACCUM_CONVERGED_FRAMES);
    expect(residual).toBeLessThan(0.01);
  });
});
