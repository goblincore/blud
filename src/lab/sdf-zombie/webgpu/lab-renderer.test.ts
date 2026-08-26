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
  type RenderCap,
} from './lab-renderer';

const FIT_LEGACY: RenderCap = { mode: 'fit', maxW: 960, maxH: 540 };

afterEach(() => setRenderCap(FIT_LEGACY));

describe('computeRenderSize — fit (legacy behaviour)', () => {
  it('clamps a wide window to 960 wide at window aspect', () => {
    setRenderCap(FIT_LEGACY);
    // 1920x1080 -> 16:9 capped at 960 wide.
    expect(computeRenderSize(1920, 1080)).toEqual({ width: 960, height: 540 });
    // Ultra-wide: height clamps first, width follows aspect then clamps.
    const r = computeRenderSize(3440, 1440);
    expect(r.height).toBeLessThanOrEqual(540);
    expect(r.width).toBeLessThanOrEqual(960);
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
