import { describe, it, expect } from 'vitest';
import { stepBallistic, type BallisticMotion } from './ballistic';

const G = 18;

describe('stepBallistic', () => {
  it('moves along velocity and applies gravity', () => {
    const m: BallisticMotion = { vel: { x: 4, y: 6, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 0, z: 0 }, m, 0.1, G);
    expect(r.landed).toBe(false);
    expect(r.pos.x).toBeCloseTo(0.4, 5);
    expect(r.vel.y).toBeCloseTo(6 - G * 0.1, 5);   // gravity applied
    expect(r.pos.y).toBeCloseTo((6 - G * 0.1) * 0.1, 5); // semi-implicit Euler: NEW vy is used for position (not old vy)
  });

  it('does not land while ascending from ground level', () => {
    const m: BallisticMotion = { vel: { x: 0, y: 5, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 0, z: 0 }, m, 0.016, G);
    expect(r.landed).toBe(false);
    expect(r.pos.y).toBeGreaterThan(0);
  });

  it('lands clamped to groundY when falling through it', () => {
    const m: BallisticMotion = { vel: { x: 2, y: -10, z: 0 }, groundY: 1.0 };
    const r = stepBallistic({ x: 0, y: 1.05, z: 0 }, m, 0.1, G);
    expect(r.landed).toBe(true);
    expect(r.pos.y).toBe(1.0);
    expect(r.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('does not land when pos is at groundY but velocity is upward', () => {
    const m: BallisticMotion = { vel: { x: 0, y: 1, z: 0 }, groundY: 0.5 };
    const r = stepBallistic({ x: 0, y: 0.5, z: 0 }, m, 0.016, G);
    expect(r.landed).toBe(false);
  });

  it('does not tunnel at a large dt (120ms lag frame)', () => {
    const m: BallisticMotion = { vel: { x: 0, y: -20, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 1.0, z: 0 }, m, 0.12, G);
    expect(r.landed).toBe(true);
    expect(r.pos.y).toBe(0); // clamped, not negative
  });

  it('full flight eventually lands at groundY', () => {
    let pos = { x: 0, y: 0, z: 0 };
    const m: BallisticMotion = { vel: { x: 3, y: 8, z: 1 }, groundY: 0 };
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) {
      const r = stepBallistic(pos, m, 1 / 60, G);
      pos = r.pos;
      m.vel = r.vel;
      landed = r.landed;
    }
    expect(landed).toBe(true);
    expect(pos.y).toBe(0);
    expect(pos.x).toBeGreaterThan(1);   // travelled horizontally
  });
});

describe('stepBallistic wall bounce', () => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

  it('reflects off the +X wall with restitution', () => {
    const m: BallisticMotion = { vel: { x: 20, y: 5, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 9.5, y: 1, z: 0 }, m, 0.1, G, bounds, 0.5);
    expect(r.pos.x).toBe(10);            // clamped to the wall
    expect(r.vel.x).toBeCloseTo(-10, 5); // reflected at 0.5 restitution
    expect(r.landed).toBe(false);
  });

  it('reflects off the -Z wall', () => {
    const m: BallisticMotion = { vel: { x: 0, y: 5, z: -30 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 1, z: -9 }, m, 0.1, G, bounds, 0.5);
    expect(r.pos.z).toBe(-10);
    expect(r.vel.z).toBeCloseTo(15, 5);
  });

  it('no bounce when inside bounds', () => {
    const m: BallisticMotion = { vel: { x: 5, y: 5, z: 5 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 1, z: 0 }, m, 0.1, G, bounds, 0.5);
    expect(r.vel.x).toBe(5);
    expect(r.vel.z).toBe(5);
  });

  it('works without bounds (backwards compatible)', () => {
    const m: BallisticMotion = { vel: { x: 50, y: 5, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 9.5, y: 1, z: 0 }, m, 0.1, G);
    expect(r.pos.x).toBeCloseTo(14.5, 5); // sails right past where a wall would be
  });
});
