// src/sim/thing.test.ts
import { describe, it, expect } from 'vitest';
import { type ThingState, stepThing, makeThing } from './thing';
import { buildArenaGeometry } from './geometry';
import { fpFromMeters, fpToMeters, metersPerSecToFp } from './fp';

const GEO = buildArenaGeometry();

describe('stepThing — deterministic MoveThing (gravity, floor/wall bounce)', () => {
  it('integrates velocity and applies gravity (falls)', () => {
    const t = makeThing(0, fpFromMeters(5), 0); // 5 m up, at rest
    const yetc = t.y;
    stepThing(t, GEO);
    expect(t.vy).toBeLessThan(0);     // gravity pulled down
    expect(t.y).toBeLessThan(yetc);   // moved down
  });

  it('bounces off the floor with the elastic coefficient, then comes to rest', () => {
    const t = makeThing(0, fpFromMeters(3), 0);
    let bounced = false;
    for (let i = 0; i < 600; i++) {
      const prevVy = t.vy;
      stepThing(t, GEO);
      if (prevVy < 0 && t.vy > 0) bounced = true; // a bounce happened
    }
    expect(bounced).toBe(true);
    expect(t.y).toBe(0);              // settled on floor
    expect(t.resting).toBe(true);
    expect(t.vy).toBe(0);
  });

  it('reports geometry contact the tic it hits the floor', () => {
    const t = makeThing(0, fpFromMeters(0.02), 0); // just above floor
    t.vy = -metersPerSecToFp(5);
    const hit = stepThing(t, GEO);
    expect(hit).toBe(true);
  });

  it('bounces off a perimeter wall (reflects horizontal velocity)', () => {
    // place near the -X wall (inner face at -19.75 m) close enough to hit in one tic
    // at 10 m/s the thing moves ~0.083 m/tic; start at -19.65 m so left edge (-19.73 m)
    // crosses the inner face (-19.75 m) in one step
    const t = makeThing(fpFromMeters(-19.65), fpFromMeters(1), 0);
    t.vx = -metersPerSecToFp(10);
    const hit = stepThing(t, GEO);
    expect(hit).toBe(true);
    expect(t.vx).toBeGreaterThan(0);  // reflected outward
  });

  it('is deterministic (same inputs → same state)', () => {
    const a = makeThing(0, fpFromMeters(2), 0); a.vx = metersPerSecToFp(7);
    const b = makeThing(0, fpFromMeters(2), 0); b.vx = metersPerSecToFp(7);
    for (let i = 0; i < 200; i++) { stepThing(a, GEO); stepThing(b, GEO); }
    expect(a).toEqual(b);
  });
});
