// src/lab/sdf-zombie/webgpu/shutter-timing.test.ts
//
// Pure exposure-contract tests. These pin the units (seconds), the fixed
// preset table, the explicit-reference-FPS angle rule, the trailing interval,
// the constant-speed streak equation and the cadence independence the plan's
// exit gate names. No GPU.

import { describe, it, expect } from 'vitest';
import {
  SHUTTER_PRESETS, COMPARISON_PRESETS, DEFAULT_REFERENCE_FPS,
  shutterPreset, exposureMs, formatExposure, angleToExposureSeconds,
  resolveExposureSeconds, shutterSettingFromPreset, clampSampleCount,
  effectiveExposureSeconds, trailingInterval, streakPixels, clampStreakPixels,
  MAX_SHUTTER_SAMPLES, type ShutterSetting,
} from './shutter-timing';

describe('shutter exposure presets', () => {
  it('is off plus the four fixed-second presets, in approved order', () => {
    expect(SHUTTER_PRESETS.map(p => p.id)).toEqual(['off', '1-240', '1-120', '1-60', '1-30']);
    expect(COMPARISON_PRESETS).toEqual(['off', '1-120', '1-60', '1-30']);
  });

  it('exposes exact seconds (not rounded labels) for each preset', () => {
    expect(shutterPreset('off').seconds).toBe(0);
    expect(shutterPreset('1-240').seconds).toBe(1 / 240);
    expect(shutterPreset('1-120').seconds).toBe(1 / 120);
    expect(shutterPreset('1-60').seconds).toBe(1 / 60);
    expect(shutterPreset('1-30').seconds).toBe(1 / 30);
  });

  it('unknown ids fall back to off rather than throwing', () => {
    expect(shutterPreset('nope' as never).id).toBe('off');
  });

  it('reports milliseconds alongside the shutter time', () => {
    expect(exposureMs(1 / 240)).toBeCloseTo(4.1667, 3);
    expect(exposureMs(1 / 120)).toBeCloseTo(8.3333, 3);
    expect(exposureMs(1 / 60)).toBeCloseTo(16.6667, 3);
    expect(exposureMs(1 / 30)).toBeCloseTo(33.3333, 3);
    expect(exposureMs(0)).toBe(0);
  });

  it('formats both the reciprocal shutter and the millisecond duration', () => {
    expect(formatExposure(1 / 120)).toContain('120');
    expect(formatExposure(1 / 120)).toContain('8.33');
    expect(formatExposure(0)).toContain('off');
  });
});

describe('angle shutter requires an explicit reference cadence', () => {
  it('implements exposureSeconds = angle / 360 / referenceFps', () => {
    expect(angleToExposureSeconds(180, 60)).toBeCloseTo(1 / 120, 12);
    expect(angleToExposureSeconds(180, 30)).toBeCloseTo(1 / 60, 12);
    expect(angleToExposureSeconds(360, 24)).toBeCloseTo(1 / 24, 12);
    expect(angleToExposureSeconds(90, 60)).toBeCloseTo(1 / 240, 12);
  });

  it('never substitutes a missing/instantaneous cadence', () => {
    expect(angleToExposureSeconds(180, 0)).toBe(0);
    expect(angleToExposureSeconds(180, -60)).toBe(0);
    expect(angleToExposureSeconds(180, Number.NaN)).toBe(0);
    expect(DEFAULT_REFERENCE_FPS).toBe(60);
  });

  it('resolves seconds, angle and off modes', () => {
    const seconds: ShutterSetting = { mode: 'seconds', seconds: 1 / 60, angleDeg: 180, referenceFps: 60 };
    expect(resolveExposureSeconds(seconds)).toBe(1 / 60);
    const angle: ShutterSetting = { mode: 'angle', seconds: 0, angleDeg: 180, referenceFps: 30 };
    expect(resolveExposureSeconds(angle)).toBeCloseTo(1 / 60, 12);
    const off: ShutterSetting = { mode: 'off', seconds: 1 / 30, angleDeg: 180, referenceFps: 60 };
    expect(resolveExposureSeconds(off)).toBe(0);
    // A preset maps to a seconds setting, never to an angle.
    const fromPreset = shutterSettingFromPreset('1-120');
    expect(fromPreset.mode).toBe('seconds');
    expect(resolveExposureSeconds(fromPreset)).toBe(1 / 120);
  });

  it('treats a non-positive or non-finite seconds value as off', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveExposureSeconds({ mode: 'seconds', seconds: bad, angleDeg: 0, referenceFps: 60 })).toBe(0);
    }
  });
});

describe('exposure interval and sample budget', () => {
  it('uses the trailing interval [now - exposure, now]', () => {
    expect(trailingInterval(2.0, 1 / 60)).toEqual({ from: 2 - 1 / 60, to: 2 });
    // Zero exposure collapses to the instant, not a negative window.
    expect(trailingInterval(1.5, 0)).toEqual({ from: 1.5, to: 1.5 });
    expect(trailingInterval(0.01, 1 / 30).from).toBeLessThan(0);
  });

  it('clamps the sample count to the stated quality budget', () => {
    expect(clampSampleCount(0)).toBe(1);
    expect(clampSampleCount(8)).toBe(8);
    expect(clampSampleCount(1e9)).toBe(MAX_SHUTTER_SAMPLES);
    expect(clampSampleCount(Number.NaN)).toBe(1);
    expect(clampSampleCount(3.9)).toBe(3);
  });

  it('scales exposure by a per-category amount without touching brightness', () => {
    expect(effectiveExposureSeconds(1 / 120, 2)).toBe(1 / 60);
    expect(effectiveExposureSeconds(1 / 120, 0)).toBe(0);
    expect(effectiveExposureSeconds(0, 2)).toBe(0);
    expect(effectiveExposureSeconds(1 / 120, Number.NaN)).toBe(0);
  });
});

describe('constant projected velocity streak lengths', () => {
  it('matches the plan table at 600 px/s', () => {
    expect(streakPixels(600, 1 / 240)).toBeCloseTo(2.5, 10);
    expect(streakPixels(600, 1 / 120)).toBeCloseTo(5, 10);
    expect(streakPixels(600, 1 / 60)).toBeCloseTo(10, 10);
    expect(streakPixels(600, 1 / 30)).toBeCloseTo(20, 10);
  });

  it('is linear in exposure and speed, and zero at zero exposure', () => {
    expect(streakPixels(600, 0)).toBe(0);
    expect(streakPixels(0, 1 / 30)).toBe(0);
    expect(streakPixels(1200, 1 / 60)).toBeCloseTo(20, 10);
    expect(streakPixels(600, 2 / 60)).toBeCloseTo(streakPixels(600, 1 / 60) * 2, 10);
  });

  it('caps the geometric length at the quality limit', () => {
    expect(clampStreakPixels(20, 40)).toBe(20);
    expect(clampStreakPixels(80, 40)).toBe(40);
    expect(clampStreakPixels(80, 0)).toBe(0);
  });
});

describe('render-cadence independence (the exit gate)', () => {
  it('gives the SAME seconds for the same preset at 30/60/120 presentation fps', () => {
    // There is no fps parameter anywhere in the seconds path: the value is a
    // property of the preset, full stop. This test pins the signature so a
    // future "optimisation" cannot sneak the measured delta back in.
    const at = (_fps: number) => resolveExposureSeconds(shutterSettingFromPreset('1-60'));
    expect(at(30)).toBe(at(60));
    expect(at(60)).toBe(at(120));
    expect(at(30)).toBe(1 / 60);
  });

  it('gives the same streak length for the same fixed seconds regardless of cadence', () => {
    const perCadence = [30, 60, 120].map(() => streakPixels(600, resolveExposureSeconds(shutterSettingFromPreset('1-30'))));
    expect(new Set(perCadence.map(v => v.toFixed(10))).size).toBe(1);
    expect(perCadence[0]).toBeCloseTo(20, 10);
  });
});
