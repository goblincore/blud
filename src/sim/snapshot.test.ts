// src/sim/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { cloneSimState } from './snapshot';
import { hashSimState } from './hash';
import { EMPTY_INPUT } from './types';
import { buildArenaGeometry } from './geometry';
import { spawnHead } from './head';
import { spawnDude } from './dude';

const GEO = buildArenaGeometry();

describe('cloneSimState', () => {
  it('produces an equal-but-independent copy', () => {
    const s = createSimState(3);
    s.bodies.push({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6 });
    const c = cloneSimState(s);
    expect(hashSimState(c)).toBe(hashSimState(s));
    // Mutating the clone must NOT affect the original (deep copy).
    c.bodies[0]!.x = 999;
    c.rng.a = 777;
    expect(s.bodies[0]!.x).toBe(1);
    expect(s.rng.a).toBe(3);
  });

  it('clones heads independently', () => {
    const s = createSimState(1);
    spawnHead(s.heads, 1, 2, 3, 4, 5, 6, 0);
    const c = cloneSimState(s);
    c.heads[0]!.x = 999;
    expect(s.heads[0]!.x).toBe(1);
  });

  it('clones dudes independently', () => {
    const s = createSimState(1);
    spawnDude(s.dudes, 1000, 0, 0, 512);
    const c = cloneSimState(s);
    c.dudes[0]!.x = 999;
    expect(s.dudes[0]!.x).toBe(1000);
  });

  it('snapshot fidelity: clone then step both → identical hash', () => {
    const s = createSimState(11);
    s.bodies.push({ x: 0, y: 0, z: 0, vx: 7, vy: -3, vz: 2 });
    const c = cloneSimState(s);
    for (let i = 0; i < 50; i++) {
      stepSim(s, EMPTY_INPUT, GEO);
      stepSim(c, EMPTY_INPUT, GEO);
    }
    expect(hashSimState(c)).toBe(hashSimState(s));
  });
});
