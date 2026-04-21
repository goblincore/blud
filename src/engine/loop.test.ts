import { describe, it, expect, vi } from 'vitest';
import { createScheduler } from './loop';

describe('createScheduler', () => {
  it('fires one step when exactly one step of time passes', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick(1 / 60, step);
    expect(n).toBe(1);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('fires zero steps when less than one step passes', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick(1 / 120, step);
    expect(n).toBe(0);
    expect(step).toHaveBeenCalledTimes(0);
  });

  it('preserves the accumulator across ticks', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    scheduler.tick(1 / 120, step);
    const n = scheduler.tick(1 / 120, step);
    expect(n).toBe(1);
  });

  it('fires multiple steps when multiple steps of time pass', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick((1 / 60) * 3, step);
    expect(n).toBe(3);
  });

  it('caps the number of steps per tick to avoid spiral of death', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    const n = scheduler.tick((1 / 60) * 100, step);
    expect(n).toBe(5);
  });

  it('passes the fixed step duration to the callback', () => {
    const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
    const step = vi.fn();
    scheduler.tick(1 / 60, step);
    expect(step).toHaveBeenCalledWith(1 / 60);
  });
});
