// src/sim/hash.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { hashSimState } from './hash';
import { EMPTY_INPUT } from './types';
import { buildArenaGeometry } from './geometry';

const GEO = buildArenaGeometry();

describe('hashSimState', () => {
  it('is stable for identical states', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    expect(hashSimState(a)).toBe(hashSimState(b));
  });

  it('changes when the tic advances', () => {
    const s = createSimState(5);
    const before = hashSimState(s);
    stepSim(s, EMPTY_INPUT, GEO);
    expect(hashSimState(s)).not.toBe(before);
  });

  it('changes when a body position differs', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    a.bodies.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    b.bodies.push({ x: 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });

  it('changes when a body velocity differs', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    a.bodies.push({ x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0 });
    b.bodies.push({ x: 0, y: 0, z: 0, vx: 2, vy: 0, vz: 0 });
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSimState(createSimState(5));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('changes when the player position differs', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    b.player.x = 1234;
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });

  it('changes when a projectile differs', () => {
    const a = createSimState(5); const b = createSimState(5);
    b.projectiles.push({ x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0, radius: 1, elastic: 24576, resting: false, fuseTics: 1, fuseMaxTics: 1, impactMode: true, spawnTic: 0, spawnX: 1, spawnY: 2, spawnZ: 3 });
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });

  it('changes when player hp differs', () => {
    const a = createSimState(5); const b = createSimState(5); b.player.hp = 50;
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
});
