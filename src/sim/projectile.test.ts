// src/sim/projectile.test.ts
import { describe, it, expect } from 'vitest';
import { throwVelocity, THROW, spawnProjectile } from './projectile';
import { metersPerSecToFp, fpToMeters, fpFromMeters } from './fp';
import { BANGLE_QUARTER } from './trig';
import { createSimState } from './state';
import { stepSim } from './step';
import { buildArenaGeometry } from './geometry';
import { EMPTY_INPUT } from './types';

const GEO = buildArenaGeometry();

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

describe('projectiles in the sim — fuse + detonation', () => {
  it('a fuse-mode projectile detonates when its fuse runs out, emitting one explosion event', () => {
    const s = createSimState(1);
    // drop straight down at center with a short fuse, impactMode off
    s.projectiles.push({
      x: 0, y: 5_000_000, z: 0, vx: 0, vy: 0, vz: 0,
      radius: 5242, elastic: 24576, resting: false,
      fuseTics: 3, fuseMaxTics: 3, impactMode: false, spawnTic: 0, spawnX: 0, spawnY: 5_000_000, spawnZ: 0,
    });
    const events: any[] = [];
    for (let i = 0; i < 5; i++) events.push(...stepSim(s, EMPTY_INPUT, GEO));
    const boom = events.filter((e) => e.kind === 'explosion');
    expect(boom).toHaveLength(1);
    expect(boom[0]).toHaveProperty('air');   // Task 4: event carries air/ground flag
    expect(s.projectiles).toHaveLength(0); // removed after detonation
  });

  it('an impact-mode projectile detonates on geometry contact after the grace window', () => {
    const s = createSimState(1);
    // spawn 2 m up so it travels > 0.7 m safe-distance before hitting the floor
    const startY = fpFromMeters(2);
    s.projectiles.push({
      x: 0, y: startY, z: 0, vx: 0, vy: -metersPerSecToFp(20), vz: 0,
      radius: 5242, elastic: 24576, resting: false,
      fuseTics: THROW.impactSafetyFuseTics, fuseMaxTics: THROW.impactSafetyFuseTics,
      impactMode: true, spawnTic: 0, spawnX: 0, spawnY: startY, spawnZ: 0,
    });
    let boom = 0;
    // advance past the grace window; it falls to the floor and detonates on contact
    for (let i = 0; i < 30; i++) boom += stepSim(s, EMPTY_INPUT, GEO).filter((e: any) => e.kind === 'explosion').length;
    expect(boom).toBe(1);
  });
});
