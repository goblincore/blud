// src/sim/explosion.test.ts
import { describe, it, expect } from 'vitest';
import { isAirBurstFp, applyExplosionToPlayer } from './explosion';
import { buildArenaGeometry } from './geometry';
import { createPlayerState } from './player';
import { fpFromMeters } from './fp';
import { createRng } from './rng';

const GEO = buildArenaGeometry();

describe('explosion air/ground (integer floor query)', () => {
  it('a blast on the floor is a ground burst', () => {
    expect(isAirBurstFp(fpFromMeters(2), 0, fpFromMeters(2), GEO)).toBe(false);
  });
  it('a blast high in the air is an air burst', () => {
    expect(isAirBurstFp(fpFromMeters(2), fpFromMeters(3), fpFromMeters(2), GEO)).toBe(true);
  });
});

describe('explosion-vs-player damage (deterministic)', () => {
  it('damages the player within radius, falling off with distance', () => {
    const near = createPlayerState(); near.x = fpFromMeters(1);
    const far = createPlayerState(); far.x = fpFromMeters(4);
    const rng = createRng(1);
    applyExplosionToPlayer(near, fpFromMeters(0), 0, fpFromMeters(0), rng);
    applyExplosionToPlayer(far, fpFromMeters(0), 0, fpFromMeters(0), createRng(1));
    expect(near.hp).toBeLessThan(100);
    expect(far.hp).toBeGreaterThan(near.hp); // less damage farther out
  });
  it('no damage beyond the radius', () => {
    const p = createPlayerState(); p.x = fpFromMeters(50);
    applyExplosionToPlayer(p, 0, 0, 0, createRng(1));
    expect(p.hp).toBe(100);
  });
});
