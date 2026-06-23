// src/sim/step.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { EMPTY_INPUT } from './types';
import { buildArenaGeometry } from './geometry';
import { spawnHead } from './head';
import { fpFromMeters } from './fp';

const GEO = buildArenaGeometry();

describe('createSimState', () => {
  it('starts at tic 0 with a seeded rng and no bodies', () => {
    const s = createSimState(42);
    expect(s.tic).toBe(0);
    expect(s.rng.a).toBe(42);
    expect(s.bodies).toEqual([]);
  });
});

describe('stepSim', () => {
  it('advances the tic counter by one', () => {
    const s = createSimState(1);
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.tic).toBe(1);
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.tic).toBe(2);
  });

  it('integrates each body by its velocity (BU/tic)', () => {
    const s = createSimState(1);
    s.bodies.push({ x: 0, y: 100, z: 0, vx: 3, vy: -2, vz: 5 });
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.bodies[0]).toEqual({ x: 3, y: 98, z: 5, vx: 3, vy: -2, vz: 5 });
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.bodies[0]).toEqual({ x: 6, y: 96, z: 10, vx: 3, vy: -2, vz: 5 });
  });

  it('returns an array of events (empty in the foundation)', () => {
    const s = createSimState(1);
    const events = stepSim(s, EMPTY_INPUT, GEO);
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('steps and kicks heads inside stepSim', () => {
    const s = createSimState(1);
    spawnHead(s.heads, fpFromMeters(0.3), 0, 0, 0, 0, 0, s.tic);
    // Facing comes from aimYaw (stepPlayer overwrites yaw from input every tic).
    // 1536 -> forward +X (x = -sin(1536) = +1 in the yaw frame).
    stepSim(s, { ...EMPTY_INPUT, aimYaw: 1536 }, GEO);
    expect(s.heads.length).toBe(1);
    expect(s.heads[0]!.vx).toBeGreaterThan(0); // kicked toward +X this tic
  });
});
