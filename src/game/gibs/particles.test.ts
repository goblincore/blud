import { describe, it, expect, beforeEach } from 'vitest';
import { Particle, updateParticle, ParticlePool, BurstParams, TrailParams } from './particles';

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
    kind: 'default' as const,
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

describe('emitBurst', () => {
  it('allocates `count` alive particles at origin', async () => {
    const pool = new ParticlePool(null as any, 32, null as any);
    const origin = { x: 1, y: 2, z: 3 };
    const params: BurstParams = {
      tile: 2154,
      count: 8,
      speedMin: 3,
      speedMax: 5,
      gravity: 9.8,
      airdrag: 0.5,
      lifetimeSec: 4.0,
      size: 0.2,
    };
    pool.emitBurst(origin, params);
    expect(pool.aliveCount()).toBe(8);
  });

  it('distributes particle velocities in [speedMin, speedMax]', async () => {
    const pool = new ParticlePool(null as any, 32, null as any);
    const params: BurstParams = {
      tile: 2154, count: 16, speedMin: 3, speedMax: 5,
      gravity: 0, airdrag: 0, lifetimeSec: 4, size: 0.2,
    };
    pool.emitBurst({ x: 0, y: 0, z: 0 }, params);
    // After 1 second with zero gravity/drag, particles
    // should be between 3 and 5 meters from origin.
    pool.update(1.0, null);
    for (const p of (pool as any).particles) {
      if (!p.alive) continue;
      const d = Math.sqrt(p.pos.x*p.pos.x + p.pos.y*p.pos.y + p.pos.z*p.pos.z);
      expect(d).toBeGreaterThanOrEqual(3 * 0.99);
      expect(d).toBeLessThanOrEqual(5 * 1.01);
    }
  });
});

describe('emitTrail', () => {
  it('emits at configured Hz', async () => {
    const pool = new ParticlePool(null as any, 64, null as any);
    const source = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 10, y: 0, z: 0 } };
    const params: TrailParams = {
      tile: 733, hz: 20, velScale: 1 / 256,
      gravity: 9.8, airdrag: 0.5, lifetimeSec: 4.0, size: 0.15,
    };
    const handle = pool.emitTrail(source, params);
    // Advance 1 second; at 20 Hz we expect ~20 emissions.
    for (let t = 0; t < 1.0; t += 0.016) pool.update(0.016, null);
    const count = pool.aliveCount();
    expect(count).toBeGreaterThanOrEqual(18);
    expect(count).toBeLessThanOrEqual(22);
    handle.stop();
  });

  it('stop() halts further emission', async () => {
    const pool = new ParticlePool(null as any, 64, null as any);
    const source = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
    const params: TrailParams = {
      tile: 733, hz: 20, velScale: 1 / 256,
      gravity: 0, airdrag: 0, lifetimeSec: 10, size: 0.1,
    };
    const h = pool.emitTrail(source, params);
    for (let t = 0; t < 0.5; t += 0.016) pool.update(0.016, null);
    const before = pool.aliveCount();
    h.stop();
    for (let t = 0; t < 0.5; t += 0.016) pool.update(0.016, null);
    const after = pool.aliveCount();
    expect(after).toBe(before); // no new emissions after stop
  });

  it('inherits source velocity scaled by velScale', async () => {
    const pool = new ParticlePool(null as any, 16, null as any);
    const source = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 256, y: 0, z: 0 } };
    const params: TrailParams = {
      tile: 733, hz: 1000, velScale: 1 / 256,
      gravity: 0, airdrag: 0, lifetimeSec: 4, size: 0.1,
    };
    pool.emitTrail(source, params);
    pool.update(0.002, null); // 0.002s * 1000Hz = 2 emissions minimum
    // First alive particle should have vel.x ≈ 256 * (1/256) = 1 m/s
    const first = (pool as any).particles.find((p: any) => p.alive);
    expect(first.vel.x).toBeCloseTo(1.0, 3);
  });
});
