import { describe, it, expect } from 'vitest';
import { releaseProp, stepDrop, DROP } from './prop-drop';
import type { DebrisGround } from './debris-ground';
import { add, qFromAxisAngle, qRotate } from './vec';
import type { Vec3 } from './types';

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
  it('a long gun meets the wall at its bounds CENTRE, not its grip root (the correction moves the root)', () => {
    const WALL_X = 1;
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (prev, next, vel, restitution, friction, radius = 0) => {
        if (!(prev[0] < WALL_X && next[0] + radius > WALL_X - 1e-12)) return null;
        return { pos: [WALL_X - Math.max(radius, 0.01), next[1], next[2]],
          vel: [vel[0] > 0 ? -vel[0] * restitution : vel[0], vel[1], vel[2] * friction], normal: [-1, 0, 0] };
      },
    };
    const centre: Vec3 = [0, 0, 0.5];                                   // the barrel reaches 0.5 m past the grip
    const facing = qFromAxisAngle([0, 1, 0], Math.PI / 2);              // local +z → world +x: facing the wall
    const run = (withCentre: boolean) => {
      let s = releaseProp([0.1, 1.0, 0], facing, [3, 0, 0], 3);
      if (withCentre) s = { ...s, centre };
      let maxCentre = -Infinity;
      for (let i = 0; i < 400 && !s.resting; i++) {
        s = stepDrop(s, 1 / 60, 0, wall);
        maxCentre = Math.max(maxCentre, add(s.pos, qRotate(s.quat, centre))[0]);
      }
      return { s, maxCentre };
    };
    const judged = run(true);
    expect(judged.s.resting).toBe(true);
    expect(judged.s.centre).toEqual(centre);                            // carried through every step
    expect(judged.maxCentre).toBeLessThan(WALL_X);                      // the barrel never pokes through
    expect(run(false).maxCentre).toBeGreaterThan(WALL_X + 0.1);         // judged at the root, it does
  });
  it('the floor is read under the bounds centre', () => {
    const LEDGE: DebrisGround = { floorAt: (x) => (x < 0 ? 1 : 0), bounce: () => null };
    let s = { ...releaseProp([0.2, 1.6, 0], [0, 0, 0, 1], [0, 0, 0], 3), centre: [-0.5, 0, 0] as Vec3, spinRate: 0 };
    for (let i = 0; i < 300 && !s.resting; i++) s = { ...stepDrop(s, 1 / 60, 0, LEDGE) } as typeof s;
    expect(s.pos[1]).toBeCloseTo(1 + DROP.floorPad, 6);                 // the root is over the low floor, the gun over the ledge
  });
  it('lying flat re-reads the floor under the flat centre (a gun swung over a step does not float or clip)', () => {
    const STEP: DebrisGround = { floorAt: (_x, z) => (z > 0.3 ? 0.4 : 0), bounce: () => null };
    const down = qFromAxisAngle([1, 0, 0], Math.PI / 2);             // local +z (the barrel) points straight down
    let s = { ...releaseProp([0, 0.031, 0], down, [0, 0, 0], 3), vel: [0, 0, 0] as Vec3, spinRate: 0,
      centre: [0, 0, 0.5] as Vec3 };
    s = stepDrop(s, 1 / 60, 0, STEP) as typeof s;
    expect(s.resting).toBe(true);
    expect(add(s.pos, qRotate(s.quat, s.centre))[2]).toBeCloseTo(0.5, 6); // flat: the barrel lies over the step
    expect(s.floorY).toBe(0.4);
    expect(s.pos[1]).toBeCloseTo(0.4 + DROP.floorPad, 9);
  });
  it('the ceiling is read over the bounds centre too', () => {
    const LOW: DebrisGround = { floorAt: () => 0, ceilAt: (_x, z) => (z > 0.3 ? 1.0 : Infinity), bounce: () => null };
    let s = { ...releaseProp([0, 0.9, 0], [0, 0, 0, 1], [0, 4, 0], 3), spinRate: 0, centre: [0, 0, 0.5] as Vec3 };
    let top = -Infinity;
    for (let i = 0; i < 60 && !s.resting; i++) { s = stepDrop(s, 1 / 60, 0, LOW) as typeof s; top = Math.max(top, s.pos[1]); }
    expect(top).toBeLessThanOrEqual(1.0 - DROP.floorPad + 1e-12);   // the root is under sky, the gun under the lintel
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
