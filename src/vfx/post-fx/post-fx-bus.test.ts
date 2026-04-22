import { describe, it, expect } from 'vitest';
import { PostFxBus } from './post-fx-bus';

describe('PostFxBus', () => {
  it('currentCAIntensity returns baseline when no pulse active', () => {
    const bus = new PostFxBus(0.05);
    expect(bus.currentCAIntensity(0)).toBeCloseTo(0.05, 5);
    expect(bus.currentCAIntensity(100)).toBeCloseTo(0.05, 5);
  });

  it('triggerDamagePulse raises intensity immediately', () => {
    const bus = new PostFxBus(0.05);
    bus.triggerDamagePulse(0.8, 0.5, 0);
    expect(bus.currentCAIntensity(0)).toBeCloseTo(0.8, 5);
  });

  it('pulse decays linearly toward baseline over duration', () => {
    const bus = new PostFxBus(0.0);
    bus.triggerDamagePulse(1.0, 1.0, 0);
    expect(bus.currentCAIntensity(0.5)).toBeCloseTo(0.5, 3);
    expect(bus.currentCAIntensity(1.0)).toBeCloseTo(0.0, 3);
    expect(bus.currentCAIntensity(1.5)).toBeCloseTo(0.0, 3);
  });

  it('new pulse overrides decaying one', () => {
    const bus = new PostFxBus(0.0);
    bus.triggerDamagePulse(0.4, 1.0, 0);
    bus.triggerDamagePulse(0.9, 1.0, 0.2);
    expect(bus.currentCAIntensity(0.2)).toBeCloseTo(0.9, 3);
  });
});
