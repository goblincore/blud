import { describe, it, expect, beforeEach } from 'vitest';
import { Particle, updateParticle } from './particles';

function makeP(overrides: Partial<Particle> = {}): Particle {
  return {
    alive: true,
    pos: { x: 0, y: 10, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    gravity: 9.8,
    airdrag: 0.1,
    lifetimeSec: 4.0,
    age: 0,
    size: 1.0,
    tile: 0,
    ...overrides,
  };
}

describe('updateParticle', () => {
  it('advances position by velocity * dt', () => {
    const p = makeP({ vel: { x: 5, y: 0, z: 0 } });
    updateParticle(p, 0.1);
    expect(p.pos.x).toBeCloseTo(0.5, 5);
  });

  it('applies gravity to y-velocity', () => {
    const p = makeP({ vel: { x: 0, y: 10, z: 0 }, gravity: 9.8, airdrag: 0 });
    updateParticle(p, 1.0);
    // vel.y += -gravity * dt = -9.8 * 1.0 = -9.8; so 10 → 0.2
    expect(p.vel.y).toBeCloseTo(0.2, 5);
  });

  it('applies airdrag to velocity', () => {
    const p = makeP({ vel: { x: 10, y: 0, z: 0 }, airdrag: 1.0, gravity: 0 });
    updateParticle(p, 1.0);
    // vel.x *= max(0, 1 - airdrag*dt) = max(0, 1 - 1.0) = 0
    expect(p.vel.x).toBeCloseTo(0, 5);
  });

  it('increments age by dt', () => {
    const p = makeP();
    updateParticle(p, 0.5);
    expect(p.age).toBeCloseTo(0.5, 5);
  });

  it('marks particle dead when age > lifetime', () => {
    const p = makeP({ lifetimeSec: 0.3 });
    updateParticle(p, 0.5);
    expect(p.alive).toBe(false);
  });

  it('does not update dead particles', () => {
    const p = makeP({ alive: false, vel: { x: 100, y: 0, z: 0 } });
    updateParticle(p, 1.0);
    expect(p.pos.x).toBe(0);
  });
});

describe('ParticlePool allocation (unit — without Three.js)', () => {
  // We test the pool allocation logic without instantiating Three.js by
  // mocking scene/atlas as any. Rendering is manually verified.
  it('allocates up to capacity', async () => {
    const { ParticlePool } = await import('./particles');
    const pool = new ParticlePool(null as any, 4, null as any);
    const a = pool.allocate(); const b = pool.allocate();
    const c = pool.allocate(); const d = pool.allocate();
    expect([a, b, c, d].every((p) => p.alive)).toBe(true);
  });

  it('at capacity, FIFO-evicts the oldest', async () => {
    const { ParticlePool } = await import('./particles');
    const pool = new ParticlePool(null as any, 2, null as any);
    const a = pool.allocate();
    const b = pool.allocate();
    // Pool is now full (2/2). Verify aliveCount.
    expect(pool.aliveCount()).toBe(2);
    // Allocate a third — FIFO-evicts slot of `a`, then gives that slot to `c`.
    // Note: `a` and `c` are the same Particle object (pool reuses slots),
    // so `a.alive` will be true again. The eviction is observable via aliveCount
    // staying at capacity (not growing to 3).
    const c = pool.allocate();
    expect(pool.aliveCount()).toBe(2);
    expect(b.alive).toBe(true);
    expect(c.alive).toBe(true);
  });
});
