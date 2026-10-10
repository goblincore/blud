// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-seams-weapon-aim.test.ts
//
// slugFrom: a slug of the gun's own, put in flight on a line a gate lays.
import { describe, expect, it } from 'vitest';
import type { GameContext } from './game-context';
import { createWeaponAimSeams } from './game-seams-weapon-aim';
import { SLUG, type Projectile } from './game-weapon';

describe('__sdfGame.slugFrom', () => {
  it('adds one slug to the projectiles in flight, at the point, at the gun\'s speed along the direction made unit', () => {
    const pellets: Projectile[] = [];
    const seams = createWeaponAimSeams({ weapon: { pellets } } as unknown as GameContext);
    expect(seams.slugFrom([1, 1.6, 2], [0, 3, -4])).toBe(true);
    expect(pellets).toHaveLength(1);
    const p = pellets[0]!;
    expect(p).toMatchObject({ pos: [1, 1.6, 2], ageSec: 0, radius: SLUG.radius, kind: 'slug' });
    expect(p.vel[0]).toBe(0);
    expect(p.vel[1]).toBeCloseTo(0.6 * SLUG.speed, 12);
    expect(p.vel[2]).toBeCloseTo(-0.8 * SLUG.speed, 12);
    expect(p.skulls).toBeUndefined();
    // No crosshair laid it: its recorded aim is its own line from its own start.
    expect(p.shot).toMatchObject({ weapon: 'slug', aim: { eye: [1, 1.6, 2] } });
    const dir = (p.shot as unknown as { aim: { dir: number[] } }).aim.dir;
    expect(dir[0]).toBe(0); expect(dir[1]).toBeCloseTo(0.6, 12); expect(dir[2]).toBeCloseTo(-0.8, 12);
  });
  it('refuses what is not a point and a direction of some length: false, and nothing in flight', () => {
    const pellets: Projectile[] = [];
    const seams = createWeaponAimSeams({ weapon: { pellets } } as unknown as GameContext);
    for (const bad of [[[1, 2], [0, 0, -1]], [[1, 2, NaN], [0, 0, -1]], [[1, 2, 3], [0, 0, 0]], [[1, 2, 3], '0,0,-1'], [[1, 2, 3]]]) {
      expect((seams.slugFrom as (...args: unknown[]) => unknown)(...bad), JSON.stringify(bad)).toBe(false);
    }
    expect(pellets).toHaveLength(0);
  });
});
