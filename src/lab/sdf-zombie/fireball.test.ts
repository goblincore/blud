// src/lab/sdf-zombie/fireball.test.ts
//
// The imp's fireball (fireball.ts) and its throwing mind (enemy-mind.ts makeImpMind).
import { describe, it, expect } from 'vitest';
import { FIREBALL, IMP_TUNING, burstPlayerDamage, fireballVelocity, spawnFireball, stepFireballs, throwFires, type Fireball } from './fireball';
import { makeImpMind, type MindInput } from './webgpu/enemy-mind';
import { armArc } from './attack';
import type { Vec3 } from './types';

const input = (dist: number, over: Partial<MindInput> = {}): MindInput => ({
  dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
  alerted: true, hasToken: true, drift: 0, roll: 0.2, rollDrift: 0.5, ...over,
});
const OPEN = { hitsWorld: () => false, hitsPlayer: () => false };

describe('fireball flight', () => {
  it('flies at FIREBALL.speed and lands on its target under its droop (exact at any frame rate)', () => {
    const from: Vec3 = [0, 1.9, 0], to: Vec3 = [0.5, 1.2, 9];
    const v = fireballVelocity(from, to);
    expect(Math.hypot(...v)).toBeCloseTo(FIREBALL.speed, 6);
    for (const dt of [1 / 30, 1 / 144]) {
      let balls: Fireball[] = [spawnFireball(from, to, 7)];
      let best = Infinity;
      for (let i = 0; i < 400 && balls.length; i++) {
        balls = stepFireballs(balls, dt, OPEN).live;
        const p = balls[0]?.pos;
        if (p) best = Math.min(best, Math.hypot(p[0] - to[0], p[1] - to[1], p[2] - to[2]));
      }
      expect(best, `dt ${dt}`).toBeLessThan(FIREBALL.speed * dt);
    }
  });

  it('cannot hit anything until armed, then bursts at the last free point on the first thing it touches', () => {
    const b = spawnFireball([0, 1.5, 0], [0, 1.5, 10], 3);
    const early = stepFireballs([b], FIREBALL.armSec / 2, { hitsWorld: () => true, hitsPlayer: () => true });
    expect(early.bursts).toEqual([]);
    const later = stepFireballs(early.live, FIREBALL.armSec, { hitsWorld: () => false, hitsPlayer: () => true });
    expect(later.bursts).toHaveLength(1);
    expect(later.bursts[0]!.cause).toBe('player');
    expect(later.bursts[0]!.at).toEqual(early.live[0]!.pos);
    expect(later.bursts[0]!.owner).toBe(3);
  });

  it('expires after maxAge', () => {
    let balls: Fireball[] = [spawnFireball([0, 50, 0], [0, 50, 100], 1)];
    let cause = '';
    for (let t = 0; t < FIREBALL.maxAge + 0.5 && balls.length; t += 0.05) {
      const s = stepFireballs(balls, 0.05, OPEN); balls = s.live; if (s.bursts[0]) cause = s.bursts[0].cause;
    }
    expect(cause).toBe('age');
  });

  it('hurts the player on a hit, singes on a near miss, and nothing further off', () => {
    const mid: Vec3 = [0, 0.9, 0];
    expect(burstPlayerDamage({ at: [0, 0.9, 0.3], cause: 'player', owner: 1 }, mid)).toBe(FIREBALL.playerDamage);
    expect(burstPlayerDamage({ at: [0, 0.9, FIREBALL.splashRadius * 0.8], cause: 'world', owner: 1 }, mid)).toBe(FIREBALL.splashDamage);
    expect(burstPlayerDamage({ at: [0, 0.9, FIREBALL.splashRadius * 1.5], cause: 'world', owner: 1 }, mid)).toBe(0);
  });
});

describe('the throw', () => {
  it('releases once, as the overhand arc carries the arm forward past the vertical', () => {
    let n = 0;
    for (let i = 1; i <= 100; i++) if (throwFires((i - 1) / 100, i / 100)) n++;
    expect(n).toBe(1);
    const cocked = armArc(0.25, 'throw'), release = armArc(IMP_TUNING.fireAt, 'throw');
    expect(cocked.pitch, 'cocked up and back past the vertical').toBeGreaterThan(Math.PI / 2);
    expect(release.pitch, 'coming forward at the release').toBeLessThan(cocked.pitch);
  });
});

describe('makeImpMind', () => {
  it('throws at a player out of reach: halts, faces, one fireball per throw, right arm, then cools down', () => {
    const mind = makeImpMind();
    let fired = 0, throws = 0, was = false;
    const secs = IMP_TUNING.first + 2 * IMP_TUNING.throwSec + IMP_TUNING.cooldown + 0.4;
    for (let i = 0; i < secs * 60; i++) {
      const out = mind.step(input(7));
      const throwing = out.attack?.variant === 'throw';
      if (throwing) {
        expect(out.halt).toBe(true);
        expect(out.attack!.side).toBe('R');
        expect(out.faceHeading).toBeCloseTo(0, 6);
      }
      if (throwing && !was) throws++;
      was = throwing;
      if (out.fire) fired++;
    }
    expect(throws).toBe(2);
    expect(fired).toBe(2);
  });

  it('never throws without its throwing arm, nor inside the claw band', () => {
    for (const [dist, over] of [[7, { missing: { armL: false, armR: true, legL: false, legR: false } }], [1.2, {}]] as const) {
      const mind = makeImpMind();
      let fired = 0;
      for (let i = 0; i < 6 * 60; i++) { const out = mind.step(input(dist, over)); if (out.fire) fired++; expect(out.attack?.variant).not.toBe('throw'); }
      expect(fired).toBe(0);
    }
  });
});
