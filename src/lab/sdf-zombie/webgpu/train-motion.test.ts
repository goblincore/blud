// src/lab/sdf-zombie/webgpu/train-motion.test.ts

import { describe, expect, it } from 'vitest';
import { RAIL_LENGTH_M, cameraSway, curtainSway, joltAt, lampSwing } from './train-motion';

describe('train motion', () => {
  it('camera sway is bounded and deterministic', () => {
    for (let t = 0; t < 60; t += 0.37) {
      const s = cameraSway(t, 20);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual((0.6 + 0.4) * Math.PI / 180);
      expect(Math.abs(s.bob)).toBeLessThanOrEqual(0.006 + 0.01);
      expect(cameraSway(t, 20)).toEqual(s);
    }
  });
  it('a jolt lands every rail length and decays in 0.25 s', () => {
    const period = RAIL_LENGTH_M / 20;
    expect(joltAt(0, 20)).toBeCloseTo(1);
    expect(joltAt(period, 20)).toBeCloseTo(1);
    expect(joltAt(0.3, 20)).toBe(0);
    expect(joltAt(period * 0.5, 20)).toBe(0);
  });
  it('no speed, no motion', () => {
    expect(cameraSway(5, 0)).toEqual({ roll: 0, bob: 0 });
    expect(lampSwing(5, 0, 0)).toBe(0);
  });
  it('lamps swing within 4 degrees; curtains within 0..1', () => {
    for (let t = 0; t < 30; t += 0.21) {
      expect(Math.abs(lampSwing(t, 20, 1.3))).toBeLessThanOrEqual(4 * Math.PI / 180);
      const c = curtainSway(t, 20, 0.7);
      expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('Boiler Room machinery', () => {
  it('the piston lifts slowly and slams fast, within 0..1', async () => {
    const { pistonStroke, PISTON_PERIOD_S } = await import('./train-motion');
    for (let t = 0; t < 5; t += 0.013) {
      const v = pistonStroke(t, 0.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(pistonStroke(0, 0)).toBeCloseTo(1, 6);
    expect(pistonStroke(PISTON_PERIOD_S * 0.8 - 1e-6, 0)).toBeCloseTo(0, 3);
    expect(pistonStroke(PISTON_PERIOD_S * 0.99, 0)).toBeGreaterThan(0.9);
  });
  it('the disco ball turns steadily', async () => {
    const { discoSpin } = await import('./train-motion');
    expect(discoSpin(2) - discoSpin(1)).toBeCloseTo(discoSpin(1) - discoSpin(0), 9);
  });
});
