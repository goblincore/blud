// src/lab/sdf-zombie/webgpu/muzzle-flash.test.ts
import { describe, expect, it } from 'vitest';
import {
  MUZZLE_FLASH, bloomAlpha, bloomScale, coreAlpha, coreScale, jetFlameSides, sparkAlpha, sparkOffset,
  tongueAlpha, tongueLength, tongueWidth,
} from './muzzle-flash';
import { flamePixels } from './flash-sprite';
import { FLASH } from './game-viewmodel';

const W = MUZZLE_FLASH.windowSec;

describe('the flame jet timeline', () => {
  it('is dark before the shot and once the window has passed', () => {
    for (const f of [coreAlpha, tongueAlpha, bloomAlpha, tongueLength, tongueWidth]) {
      expect(f(-0.01)).toBe(0);
      expect(f(W + 0.001)).toBe(0);
    }
  });

  it('the core is at full brightness at the instant of the shot, then only decays', () => {
    expect(coreAlpha(0)).toBeCloseTo(1, 5);
    let prev = Infinity;
    for (let t = 0; t <= W; t += 0.005) { const v = coreAlpha(t); expect(v).toBeLessThanOrEqual(prev + 1e-9); prev = v; }
  });

  it('the tongue SHOOTS out: it is long within a couple of frames, then dies back', () => {
    const peak = Math.max(...Array.from({ length: 40 }, (_, i) => tongueLength((i / 39) * W)));
    expect(peak).toBeGreaterThan(0.25);                       // metres: a visible jet, not a spark
    expect(tongueLength(0.03)).toBeGreaterThan(peak * 0.8);   // most of it by ~2 frames
    expect(tongueLength(W * 0.95)).toBeLessThan(peak * 0.25); // and nearly gone at the end
  });

  it('the fireball only grows, and ends well wider than the barrel', () => {
    expect(bloomScale(W * 0.9)).toBeGreaterThan(bloomScale(0.01));
    expect(bloomScale(W * 0.9)).toBeGreaterThan(0.25);
    expect(coreScale(0.05)).toBeGreaterThan(coreScale(0));
  });

  it('is brighter and bigger than the single star it replaces (visible for >= 0.1 s)', () => {
    expect(W).toBeGreaterThanOrEqual(0.1);
  });
});

describe('sparks', () => {
  const dir = [0, 0, -1] as const;
  it('start at the muzzle and travel along their direction', () => {
    expect(sparkOffset(0, dir, 6)).toEqual([0, 0, 0]);
    const p = sparkOffset(0.05, dir, 6);
    expect(p[2]).toBeLessThan(-0.1);
  });
  it('drag slows them: the second 50 ms goes less far than the first', () => {
    const a = -sparkOffset(0.05, dir, 6)[2], b = -sparkOffset(0.1, dir, 6)[2] - a;
    expect(b).toBeLessThan(a);
  });
  it('gravity pulls them down', () => {
    expect(sparkOffset(0.15, dir, 6)[1]).toBeLessThan(0);
  });
  it('fade out by the end of their life', () => {
    expect(sparkAlpha(0)).toBeGreaterThan(0.9);
    expect(sparkAlpha(MUZZLE_FLASH.sparkLifeSec + 0.001)).toBe(0);
  });
});

describe('which barrels flame', () => {
  it('both on a double shot', () => {
    expect(jetFlameSides(2, 0)).toEqual([true, true]);
    expect(jetFlameSides(2, 1)).toEqual([true, true]);
  });
  it('one on a single shot, alternating so the shots do not all come from one bore', () => {
    expect(jetFlameSides(1, 0)).toEqual([true, false]);
    expect(jetFlameSides(1, 1)).toEqual([false, true]);
    expect(jetFlameSides(1, 2)).toEqual([true, false]);
  });
});

describe('flamePixels', () => {
  const N = 64;
  const px = flamePixels(N, 3);
  const a = (u: number, v: number) => px[(Math.floor(v * (N - 1)) * N + Math.floor(u * (N - 1))) * 4 + 3]!;
  it('is solid at the base and fades to nothing at the tip', () => {
    expect(a(0.5, 0.05)).toBeGreaterThan(180);
    expect(a(0.5, 0.99)).toBeLessThan(40);
  });
  it('is a tongue, not a card: the corners are empty', () => {
    expect(a(0.02, 0.5)).toBe(0);
    expect(a(0.98, 0.9)).toBe(0);
  });
  it('is hotter (whiter) at the base than at the tip', () => {
    const rgb = (u: number, v: number) => { const i = (Math.floor(v * (N - 1)) * N + Math.floor(u * (N - 1))) * 4; return [px[i]!, px[i + 1]!, px[i + 2]!]; };
    expect(rgb(0.5, 0.1)[2]!).toBeGreaterThan(rgb(0.5, 0.8)[2]!);
  });
});

describe('the light and the fire end together', () => {
  it('the muzzle light window equals the flame window', () => {
    expect(FLASH.windowSec).toBe(MUZZLE_FLASH.windowSec);
  });
});
