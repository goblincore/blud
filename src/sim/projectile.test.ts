// src/sim/projectile.test.ts
import { describe, it, expect } from 'vitest';
import { throwVelocity, THROW, spawnProjectile } from './projectile';
import { metersPerSecToFp, fpToMeters, fpFromMeters } from './fp';
import { BANGLE_QUARTER } from './trig';
import { createSimState } from './state';
import { stepSim } from './step';
import { buildArenaGeometry } from './geometry';
import { EMPTY_INPUT } from './types';
import { createPlayerState, stepPlayer } from './player';

const GEO = buildArenaGeometry();

/** The player's forward MOVE direction (unit) at a yaw — the working reference:
 *  W walks where you look, and the camera faces this way. The throw MUST match it. */
function playerForwardDir(yaw: number): { x: number; z: number } {
  const p = createPlayerState();
  stepPlayer(p, { ...EMPTY_INPUT, moveForward: 1, aimYaw: yaw }, []); // no geo → free move
  const len = Math.hypot(p.x, p.z) || 1;
  return { x: p.x / len, z: p.z / len };
}

describe('throwVelocity direction matches the player forward (regression: mirrored-X bug)', () => {
  it('throws where the player faces/moves, across the whole circle', () => {
    const speed = metersPerSecToFp(20);
    for (const yaw of [0, 256, 512, 900, 1024, 1500, 2000]) {
      const f = playerForwardDir(yaw);
      const v = throwVelocity(yaw, 0, speed);
      const len = Math.hypot(v.vx, v.vz) || 1;
      expect(v.vx / len).toBeCloseTo(f.x, 2); // same horizontal direction
      expect(v.vz / len).toBeCloseTo(f.z, 2);
    }
  });
});

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
