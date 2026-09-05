import { describe, it, expect } from 'vitest';
import {
  makeChunk, stepChunk, chunkPoint, squashFactors, chunkSettled, toppleAngleToFlat,
  type Chunk,
} from './gib-chunks';
import { qRotate, qFromAxisAngle } from './vec';
import type { Vec3 } from './types';

const rng = () => 0.5; // deterministic spawn

function settle(c: Chunk, seconds: number): Chunk {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) c = stepChunk(c, dt);
  return c;
}

describe('makeChunk', () => {
  it('spawns with a unit quaternion and bounded tumble', () => {
    const c = makeChunk('armL', [0, 1, 0], [2, 3, 1], 0.2, [0, 1, 0], rng);
    expect(Math.hypot(...c.quat)).toBeCloseTo(1, 6);
    for (const w of c.angVel) expect(Math.abs(w)).toBeLessThanOrEqual(9);
  });
});

describe('stepChunk', () => {
  it('integrates orientation from angular velocity', () => {
    const c = makeChunk('armL', [0, 5, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c2 = { ...c, angVel: [0, Math.PI, 0] as Vec3 };
    const after = stepChunk(c2, 0.5); // half a half-turn about y
    const v = qRotate(after.quat, [1, 0, 0]);
    // Rotated ~90deg from where quat started; just assert it moved substantially.
    const before = qRotate(c2.quat, [1, 0, 0]);
    expect(Math.abs(v[0] - before[0]) + Math.abs(v[2] - before[2])).toBeGreaterThan(0.5);
  });

  it('bounces with the game restitution', () => {
    let c = makeChunk('armL', [0, 0.5, 0], [0, -4, 0], 0.2, [0, 1, 0], rng);
    // Drop until first bounce.
    let bounced: Chunk | null = null;
    for (let i = 0; i < 300; i++) {
      const next = stepChunk(c, 1 / 60);
      if (next.vel[1] > 0 && c.vel[1] < 0) { bounced = next; break; }
      c = next;
    }
    expect(bounced).not.toBeNull();
    // restitution 0.55 of impact speed, within integration slop
    expect(bounced!.vel[1]).toBeGreaterThan(0.3);
  });

  it('topples: a vertical limb ends lying flat', () => {
    // Long axis local y, spawned upright, at rest on the floor.
    let c = makeChunk('legL', [0, 0.2, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    c = settle(c, 3);
    const worldLong = qRotate(c.quat, c.longAxis);
    // Lying flat = long axis within ~15deg of horizontal.
    expect(Math.abs(worldLong[1])).toBeLessThan(0.26);
  });

  it('does not topple while still flying', () => {
    let c = makeChunk('legL', [0, 8, 0], [0, 4, 0], 0.2, [0, 1, 0], rng);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    const after = stepChunk(c, 1 / 60);
    const before = qRotate(c.quat, c.longAxis);
    const now = qRotate(after.quat, c.longAxis);
    expect(now[1]).toBeCloseTo(before[1], 5);
  });

  it('recovers from non-finite state', () => {
    const c = makeChunk('armL', [0, 1, 0], [NaN, 0, 0], 0.2, [0, 1, 0], rng);
    const after = stepChunk(c, 1 / 60);
    expect(after.vel.every(Number.isFinite)).toBe(true);
  });
});

describe('chunkPoint / squashFactors', () => {
  it('rotates locals by the chunk quat then squashes in world axes', () => {
    const base = makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c: Chunk = { ...base, quat: qFromAxisAngle([0, 1, 0], Math.PI / 2), squash: 0 };
    const { sx, sy, sz } = squashFactors(c);
    expect([sx, sy, sz]).toEqual([1, 1, 1]);
    const p = chunkPoint(c, [1, 0, 0], sx, sy, sz);
    expect(p[0]).toBeCloseTo(1, 5);
    expect(p[1]).toBeCloseTo(2, 5);
    expect(p[2]).toBeCloseTo(3 - 1, 5);
  });

  it('squash flattens y and bulges xz', () => {
    const base = makeChunk('armL', [0, 0, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c: Chunk = { ...base, squash: 1 };
    const { sx, sy, sz } = squashFactors(c);
    expect(sx).toBeCloseTo(1.35, 5);
    expect(sy).toBeCloseTo(0.5, 5);
    expect(sz).toBeCloseTo(1.35, 5);
  });
});

describe('chunkSettled (close-up task 5 bake predicate)', () => {
  it('a chunk stepped to rest becomes settled and STAYS settled', () => {
    let c = makeChunk('armL', [0.3, 1.5, -0.2], [1.4, 0.5, 0.9], 0.09, [0.3, 1, 0.1], rng);
    for (let i = 0; i < 60 * 6; i++) c = stepChunk(c, 1 / 60);
    expect(chunkSettled(c)).toBe(true);
    // Idempotent: a settled chunk re-judged is still settled (nothing steps it).
    expect(chunkSettled(c)).toBe(true);
  });

  it('is never settled while airborne', () => {
    const c = makeChunk('armL', [0, 3, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const still = { ...c, vel: [0, 0, 0] as Vec3, angVel: [0, 0, 0] as Vec3 };
    expect(chunkSettled(still)).toBe(false); // y = 3 >> radius: in the air
  });

  it('is never settled while sliding fast on the floor', () => {
    // Grounded (y == radius) but moving at 3 m/s: a slide, not a rest.
    const c = makeChunk('armL', [0, 0.15, 0], [3, 0, 0], 0.15, [1, 0, 0], rng, 'gob');
    const sliding: Chunk = { ...c, pos: [0, c.radius, 0], angVel: [0, 0, 0] as Vec3 };
    expect(chunkSettled(sliding)).toBe(false);
  });

  it('is never settled mid-topple even when slow and grounded', () => {
    // Slow, grounded, angVel zeroed, squash done — but the long axis still
    // pointing straight UP, 90deg from flat. The topple has not finished.
    const c = makeChunk('legL', [0, 0.2, 0], [0.01, 0, 0], 0.2, [0, 1, 0], rng);
    const poised: Chunk = { ...c, angVel: [0, 0, 0] as Vec3, squash: 0 };
    expect(toppleAngleToFlat(poised)).toBeGreaterThan(0.011);
    expect(chunkSettled(poised)).toBe(false);
  });

  it('is never settled while the squash is still relaxing', () => {
    const c = makeChunk('armL', [0, 0.2, 0], [0, 0, 0], 0.2, [1, 0, 0], rng);
    const wet: Chunk = { ...c, angVel: [0, 0, 0] as Vec3, squash: 0.4 };
    expect(chunkSettled(wet)).toBe(false);
  });

  it('settle time from a hot spawn is bounded (~2s) — the bake must not wait forever', () => {
    let c = makeChunk('armL', [0.3, 1.5, -0.2], [2.5, 3.5, 1.9], 0.09, [0.3, 1, 0.1], rng);
    let settledAt = -1;
    for (let i = 0; i < 60 * 10 && settledAt < 0; i++) {
      c = stepChunk(c, 1 / 60);
      if (chunkSettled(c)) settledAt = i;
    }
    expect(settledAt).toBeGreaterThan(0);
    expect(settledAt).toBeLessThan(60 * 4);
  });
});
