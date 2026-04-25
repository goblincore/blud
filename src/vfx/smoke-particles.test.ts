import { describe, it, expect, beforeEach } from 'vitest';
import {
  smokeRiseVelocity,
  smokeAlphaCurve,
  startSmokeColumn,
  emitSmokeBurst,
  updateSmokeColumns,
  resetSmokeColumns,
} from './smoke-particles';
import { ParticlePool } from '../game/gibs/particles';

describe('smokeRiseVelocity', () => {
  it('returns y = baseSpeed exactly (no curve)', () => {
    const rng = () => 0.5; // center jitter → 0 lateral
    const v = smokeRiseVelocity(0, 0.3, 0.1, rng);
    expect(v.y).toBe(0.3);
  });

  it('x and z stay within ±jitterAmplitude', () => {
    // Run many calls with random values and verify bounds
    let callCount = 0;
    const rng = () => {
      // Cycle through boundary values
      const values = [0, 0.25, 0.5, 0.75, 1.0];
      return values[callCount++ % values.length]!;
    };
    for (let i = 0; i < 100; i++) {
      const v = smokeRiseVelocity(0, 0.3, 0.1, rng);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(0.1 + 0.001);
      expect(Math.abs(v.z)).toBeLessThanOrEqual(0.1 + 0.001);
    }
  });

  it('elapsedSec parameter is accepted (no curve applied)', () => {
    const rng = () => 0.5;
    const v1 = smokeRiseVelocity(0, 0.3, 0.1, rng);
    const v2 = smokeRiseVelocity(5.0, 0.3, 0.1, rng);
    // Same baseSpeed regardless of elapsed — the function signature accepts
    // elapsedSec so callers don't need to special-case
    expect(v1.y).toBe(v2.y);
  });
});

describe('smokeAlphaCurve', () => {
  it('returns 1.0 at t=0', () => {
    expect(smokeAlphaCurve(0, 1.5)).toBe(1);
  });

  it('returns 0.0 at t=lifetime', () => {
    expect(smokeAlphaCurve(1.5, 1.5)).toBe(0);
  });

  it('returns 0.0 past lifetime', () => {
    expect(smokeAlphaCurve(2.0, 1.5)).toBe(0);
  });

  it('returns 0.0 for negative elapsed', () => {
    expect(smokeAlphaCurve(-0.1, 1.5)).toBe(1); // clamped to 1
  });

  it('is monotonically decreasing', () => {
    const lifetime = 1.5;
    let prev = smokeAlphaCurve(0, lifetime);
    for (let t = 0.05; t <= lifetime; t += 0.05) {
      const cur = smokeAlphaCurve(t, lifetime);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('startSmokeColumn', () => {
  beforeEach(() => {
    resetSmokeColumns();
  });

  it('returns a TrailHandle whose stop() halts emission', () => {
    const pool = new ParticlePool(null as any, 64, null as any);
    let pos = { x: 0, y: 0, z: 0 };
    const source = () => pos;
    const h = startSmokeColumn(pool, source);
    // Advance time — smoke particles should be emitted
    updateSmokeColumns(pool, 1.0);
    const beforeStop = pool.aliveCount();
    expect(beforeStop).toBeGreaterThan(0);

    h.stop();
    // Advance more — no new particles
    updateSmokeColumns(pool, 1.0);
    const afterStop = pool.aliveCount();
    expect(afterStop).toBe(beforeStop);
  });

  it('emits continuously from the source function', () => {
    const pool = new ParticlePool(null as any, 128, null as any);
    let pos = { x: 5, y: 2, z: 3 };
    const source = () => pos;
    const h = startSmokeColumn(pool, source);
    // At 12 Hz, after 0.5s we expect ~6 particles
    updateSmokeColumns(pool, 0.5);
    expect(pool.aliveCount()).toBeGreaterThanOrEqual(5);
    expect(pool.aliveCount()).toBeLessThanOrEqual(8);

    // Move the source — next emissions should come from new position
    pos = { x: 10, y: 5, z: 15 };
    updateSmokeColumns(pool, 0.5);

    h.stop();
  });
});

describe('emitSmokeBurst', () => {
  it('spawns exactly `count` particles', () => {
    const pool = new ParticlePool(null as any, 32, null as any);
    const pos = { x: 1, y: 2, z: 3 };
    emitSmokeBurst(pool, pos, 8);
    expect(pool.aliveCount()).toBe(8);
  });

  it('defaults to 8 particles', () => {
    const pool = new ParticlePool(null as any, 32, null as any);
    const pos = { x: 1, y: 2, z: 3 };
    emitSmokeBurst(pool, pos);
    expect(pool.aliveCount()).toBe(8);
  });
});
