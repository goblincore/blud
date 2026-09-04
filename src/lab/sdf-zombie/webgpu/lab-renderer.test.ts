// src/lab/sdf-zombie/webgpu/lab-renderer.test.ts
//
// Pure gates for the render-cap machinery (the 4:3 retro rung). The renderer
// itself needs WebGPU, but the cap is plain arithmetic: 'fit' must reproduce
// the legacy 960x540 behaviour exactly (the lab's look is pinned by this),
// 'fixed' must return the buffer EXACTLY at any window size, and the CSS
// size must letterbox the buffer aspect inside the window.
import { describe, expect, it, afterEach } from 'vitest';
import {
  computeRenderSize, canvasCssSize, setRenderCap, getRenderCap,
  shouldPresent, estimateRefreshMs, REFRESH_MS_RANGE,
  type RenderCap,
} from './lab-renderer';

const FIT_LEGACY: RenderCap = { mode: 'fit', maxW: 960, maxH: 540 };

afterEach(() => setRenderCap(FIT_LEGACY));

describe('computeRenderSize — fit (legacy behaviour)', () => {
  it('clamps a wide window to 960 wide at window aspect', () => {
    setRenderCap(FIT_LEGACY);
    // 1920x1080 -> 16:9 capped at 960 wide.
    expect(computeRenderSize(1920, 1080)).toEqual({ width: 960, height: 540 });
    // Aspect must SURVIVE clamping: 1280x800 is 16:10, height hits the 540
    // cap first, width follows at window aspect -> 540*1.6 = 864. (This once
    // divided by the aspect instead and produced a portrait 338x540 buffer.)
    expect(computeRenderSize(1280, 800)).toEqual({ width: 864, height: 540 });
    // Ultra-wide: height clamps first, width follows aspect then clamps.
    const r = computeRenderSize(3440, 1440);
    expect(r.height).toBeLessThanOrEqual(540);
    expect(r.width).toBeLessThanOrEqual(960);
    expect(r.width / r.height).toBeCloseTo(3440 / 1440, 2);
  });

  it('a small window renders 1:1 (no upscaling)', () => {
    setRenderCap(FIT_LEGACY);
    expect(computeRenderSize(800, 500)).toEqual({ width: 800, height: 500 });
  });
});

describe('computeRenderSize — fixed (4:3 game rungs)', () => {
  it('returns the buffer exactly regardless of window', () => {
    setRenderCap({ mode: 'fixed', width: 800, height: 600 });
    expect(computeRenderSize(1920, 1080)).toEqual({ width: 800, height: 600 });
    expect(computeRenderSize(640, 1000)).toEqual({ width: 800, height: 600 });
    expect(computeRenderSize(300, 200)).toEqual({ width: 800, height: 600 });
  });

  it('640x480 rung likewise', () => {
    setRenderCap({ mode: 'fixed', width: 640, height: 480 });
    expect(computeRenderSize(1280, 800)).toEqual({ width: 640, height: 480 });
  });
});

describe('canvasCssSize — letterbox', () => {
  it('wide window pillarboxes a 4:3 buffer (bars left/right)', () => {
    setRenderCap({ mode: 'fixed', width: 800, height: 600 });
    const css = canvasCssSize(1280, 720);
    expect(css.height).toBe(720);
    expect(css.width).toBe(Math.round(720 * 4 / 3)); // 960
    expect(css.left).toBe((1280 - css.width) / 2);
    expect(css.top).toBe(0);
  });

  it('tall window letterboxes top/bottom', () => {
    setRenderCap({ mode: 'fixed', width: 800, height: 600 });
    const css = canvasCssSize(900, 1200);
    expect(css.width).toBe(900);
    expect(css.height).toBe(Math.round(900 * 3 / 4));
    expect(css.top).toBe(Math.round((1200 - css.height) / 2));
    expect(css.left).toBe(0);
  });

  it('fit mode stretches to the full window as before', () => {
    setRenderCap(FIT_LEGACY);
    expect(canvasCssSize(1280, 720)).toEqual({
      width: 1280, height: 720, left: 0, top: 0,
    });
  });

  it('CSS aspect always matches buffer aspect (no stretch)', () => {
    for (const [w, h] of [[800, 600], [640, 480]] as const) {
      setRenderCap({ mode: 'fixed', width: w, height: h });
      const css = canvasCssSize(1100, 850);
      expect(css.width / css.height).toBeCloseTo(w / h, 2);
    }
  });
});

describe('getRenderCap round-trips', () => {
  it('returns what was set', () => {
    const cap: RenderCap = { mode: 'fixed', width: 640, height: 480 };
    setRenderCap(cap);
    expect(getRenderCap()).toBe(cap);
  });
});


// ---------------------------------------------------------------------------
// FRAME PACING
// ---------------------------------------------------------------------------
//
// rAF presents whenever the display refreshes, so a 30 fps target reached by
// "work happens to take ~33 ms" is really an alternation between vsync slots:
// 33, 50, 33, 50. The mean reads a healthy 38 and the owner feels a stagger.
// Pacing takes the deadline back — present on a chosen cadence, and a missed
// slot becomes a thing we can name instead of a thing we infer.
//
// The slack is HALF A REFRESH, not a constant: the whole scheme is "has the
// next slot arrived", and a slot is a refresh interval wide. Hardcoding 8.3 ms
// silently becomes wrong the moment the display is not 60 Hz, which is exactly
// the class of bug the spike detector already shipped.

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;
const CAP30 = 1000 / 30;

describe('shouldPresent — the paced cadence', () => {
  it('is a no-op when uncapped: every rAF tick presents', () => {
    for (const elapsed of [0, 1, 8, 16.7, 100]) {
      expect(shouldPresent(elapsed, 0, HZ60)).toBe(true);
    }
  });

  it('presents every 2nd vsync at 60 Hz for a 30 fps cap', () => {
    // Ticks land on refresh multiples. Only the 2nd should draw.
    expect(shouldPresent(HZ60, CAP30, HZ60)).toBe(false);
    expect(shouldPresent(2 * HZ60, CAP30, HZ60)).toBe(true);
  });

  it('presents every 4th vsync at 120 Hz for a 30 fps cap', () => {
    // The reason the slack is refresh-relative: a fixed 8.3 ms slack would
    // fire at the 3rd tick here (25 ms) and pace to 40 fps, not 30.
    expect(shouldPresent(HZ120, CAP30, HZ120)).toBe(false);
    expect(shouldPresent(2 * HZ120, CAP30, HZ120)).toBe(false);
    expect(shouldPresent(3 * HZ120, CAP30, HZ120)).toBe(false);
    expect(shouldPresent(4 * HZ120, CAP30, HZ120)).toBe(true);
  });

  it('does not accumulate drift after a long frame', () => {
    // Work overran into the 3rd slot. The next tick is late but valid, and
    // the cadence resumes from THERE rather than trying to catch up.
    expect(shouldPresent(3 * HZ60, CAP30, HZ60)).toBe(true);
    expect(shouldPresent(HZ60, CAP30, HZ60)).toBe(false);
  });

  it('treats a nonsense refresh as 60 Hz rather than pacing wildly', () => {
    expect(shouldPresent(2 * HZ60, CAP30, 0)).toBe(true);
    expect(shouldPresent(HZ60, CAP30, Number.NaN)).toBe(false);
  });
});

describe('estimateRefreshMs — measured, never assumed', () => {
  it('takes the minimum: a delta can only ever be a refresh or a multiple', () => {
    // Paced frames make most deltas 2x refresh; the skipped ticks are 1x.
    expect(estimateRefreshMs([HZ60, 2 * HZ60, HZ60, 4 * HZ60])).toBeCloseTo(HZ60, 6);
  });

  it('finds 120 Hz without being told', () => {
    expect(estimateRefreshMs([HZ120, HZ120 * 2, HZ120])).toBeCloseTo(HZ120, 6);
  });

  it('clamps jitter and garbage into a sane range', () => {
    const [lo, hi] = REFRESH_MS_RANGE;
    expect(estimateRefreshMs([0, 0.0001])).toBe(lo);
    expect(estimateRefreshMs([9999])).toBe(hi);
    expect(estimateRefreshMs([Number.NaN, HZ60])).toBeCloseTo(HZ60, 6);
  });

  it('falls back to 60 Hz with nothing to go on', () => {
    expect(estimateRefreshMs([])).toBeCloseTo(HZ60, 6);
    expect(estimateRefreshMs([Number.NaN])).toBeCloseTo(HZ60, 6);
  });
});
