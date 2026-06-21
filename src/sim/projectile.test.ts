// src/sim/projectile.test.ts
import { describe, it, expect } from 'vitest';
import { throwVelocity, THROW } from './projectile';
import { metersPerSecToFp, fpToMeters } from './fp';
import { BANGLE_QUARTER } from './trig';

describe('throwVelocity — deterministic, aim-relative + upward lob', () => {
  const speed = metersPerSecToFp(20);

  it('aiming level + yaw 0 → arcs forward (-Z) and upward (+Y)', () => {
    const v = throwVelocity(0 /*yaw*/, 0 /*pitch*/, speed);
    expect(v.vz).toBeLessThan(0);            // forward is -Z at yaw 0
    expect(Math.abs(v.vx)).toBeLessThan(metersPerSecToFp(1)); // no sideways drift
    expect(v.vy).toBeGreaterThan(0);         // lob gives upward bias even level
  });

  it('yaw quarter rotates the throw into the X axis', () => {
    const v = throwVelocity(BANGLE_QUARTER, 0, speed);
    expect(Math.abs(v.vx)).toBeGreaterThan(Math.abs(v.vz));
  });

  it('aiming up increases the vertical component', () => {
    const level = throwVelocity(0, 0, speed);
    const up = throwVelocity(0, 200 /*pitch up*/, speed);
    expect(up.vy).toBeGreaterThan(level.vy);
  });

  it('is deterministic', () => {
    expect(throwVelocity(123, -45, speed)).toEqual(throwVelocity(123, -45, speed));
  });
});
