import { describe, it, expect } from 'vitest';
import { releaseProp, stepDrop, DROP } from './prop-drop';
import type { DebrisGround } from './debris-ground';

describe('prop drop', () => {
  it('falls under gravity, lands on the floor pad, and stops', () => {
    let s = releaseProp([0, 1.0, 0], [0, 0, 0, 1], [0.5, 1.0, 0], 3);
    for (let i = 0; i < 240; i++) s = stepDrop(s, 1 / 60, 0);
    expect(s.pos[1]).toBeCloseTo(DROP.floorPad, 6);
    expect(s.resting).toBe(true);
    expect(s.pos[0]).toBeGreaterThan(0.05); // it travelled
  });
  it('tumbles while airborne and stops spinning at rest', () => {
    let s = releaseProp([0, 1.0, 0], [0, 0, 0, 1], [0, 1, 0], 3);
    const q0 = s.quat;
    s = stepDrop(s, 1 / 60, 0);
    expect(s.quat).not.toEqual(q0);
    for (let i = 0; i < 300; i++) s = stepDrop(s, 1 / 60, 0);
    const qRest = s.quat;
    expect(stepDrop(s, 1 / 60, 0).quat).toEqual(qRest);
  });
  it('is deterministic in the seed', () => {
    const a = releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 1, 0], 9);
    const b = releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 1, 0], 9);
    expect(a).toEqual(b);
  });
});

describe('prop drop on a debris ground (sector levels, plan 3b)', () => {
  const LEDGE: DebrisGround = { floorAt: (x) => (x < 0 ? 1 : 0), bounce: () => null };
  it('a released gun rests on the floor under it and falls off a ledge', () => {
    let s = releaseProp([-0.2, 1.6, 0], [0, 0, 0, 1], [1.2, 0, 0], 3);
    for (let i = 0; i < 300 && !s.resting; i++) s = stepDrop(s, 1 / 60, 0, LEDGE);
    expect(s.resting).toBe(true);
    expect(s.pos[0]).toBeGreaterThan(0);
    expect(s.pos[1]).toBeCloseTo(DROP.floorPad, 6);
    expect(s.floorY).toBe(0);
  });
  it('a gun dropped on the ledge rests on it', () => {
    let s = releaseProp([-0.6, 1.6, 0], [0, 0, 0, 1], [0, 0, 0], 3);
    for (let i = 0; i < 300 && !s.resting; i++) s = stepDrop(s, 1 / 60, 0, LEDGE);
    expect(s.pos[1]).toBeCloseTo(1 + DROP.floorPad, 6);
  });
  it('without a ground: no floorY key', () => {
    const s = stepDrop(releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 0, 0], 3), 1 / 60, 0);
    expect('floorY' in s).toBe(false);
  });
  it('a wall bounce replaces the step (the radius is the gun half-extent)', () => {
    let seen = -1;
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (_p, next, vel, _r, _f, radius) => { seen = radius ?? -1; return { pos: [0.5, next[1], 0], vel: [-vel[0] * 0.25, vel[1], vel[2]], normal: [-1, 0, 0] }; },
    };
    const s = stepDrop(releaseProp([0.4, 1, 0], [0, 0, 0, 1], [3, 0, 0], 3), 1 / 60, 0, wall);
    expect(seen).toBe(DROP.radius);
    expect(s.pos[0]).toBe(0.5);
    expect(s.vel[0]).toBeLessThan(0);
  });
  it('never flies above a ceiling; sky (Infinity) and off the map (NaN) do not clamp', () => {
    const low: DebrisGround = { floorAt: () => 0, ceilAt: () => 1.2, bounce: () => null };
    let s = releaseProp([0, 1.1, 0], [0, 0, 0, 1], [0, 4, 0], 3);
    let top = -Infinity;
    for (let i = 0; i < 300 && !s.resting; i++) { s = stepDrop(s, 1 / 60, 0, low); top = Math.max(top, s.pos[1]); }
    expect(top).toBeLessThanOrEqual(1.2 - DROP.floorPad + 1e-12);
    expect(s.resting).toBe(true);
    for (const c of [Infinity, NaN]) {
      const open: DebrisGround = { floorAt: () => 0, ceilAt: () => c, bounce: () => null };
      const a = stepDrop(releaseProp([0, 1.1, 0], [0, 0, 0, 1], [0, 4, 0], 3), 1 / 60, 0, open);
      expect(a.pos[1]).toBeGreaterThan(1.1);
    }
  });
});
