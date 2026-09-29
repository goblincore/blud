import { describe, it, expect } from 'vitest';
import { ROCKET, blastFalloff, blastPlayerDamage, spawnRocket, stepRockets, type RocketWorld } from './rockets';
import type { Vec3 } from './types';

const open: RocketWorld = { hitsWorld: () => false, hitsPlayer: () => false, hitsActor: () => false };
const run = (world: RocketWorld, dir: Vec3 = [0, 0, 1], owner = 7, secs = 5) => {
  let live = [spawnRocket([0, 1.7, 0], dir, owner)];
  for (let i = 0; i < secs * 60 && live.length; i++) {
    const r = stepRockets(live, 1 / 60, world);
    live = r.live;
    if (r.detonations.length) return { t: (i + 1) / 60, ...r.detonations[0]! };
  }
  return null;
};

describe('rockets', () => {
  it('flies at ROCKET.speed along its aim, whatever the aim vector length', () => {
    const r = spawnRocket([0, 0, 0], [0, 0, 5], 1);
    expect(Math.hypot(...r.vel)).toBeCloseTo(ROCKET.speed, 6);
    const s = stepRockets([r], 0.5, open).live[0]!;
    expect(s.pos[2]).toBeCloseTo(ROCKET.speed * 0.5, 6);
  });

  it('is slow enough to see: under a third of the pellet band, a room width in about a second', () => {
    expect(ROCKET.speed).toBeLessThan(12);
    expect(8 / ROCKET.speed).toBeGreaterThan(0.6);
  });

  it('detonates on the wall it reaches, at the last free point', () => {
    const wallZ = 4;
    const d = run({ ...open, hitsWorld: (a, b) => a[2] < wallZ && b[2] >= wallZ })!;
    expect(d.cause).toBe('world');
    expect(d.at[2]).toBeLessThan(wallZ);
    expect(d.at[2]).toBeGreaterThan(wallZ - ROCKET.speed / 60 - 1e-9);
    expect(d.t).toBeCloseTo(wallZ / ROCKET.speed, 1);
  });

  it('detonates on the player', () => {
    const d = run({ ...open, hitsPlayer: (a, b) => a[2] < 6 && b[2] >= 6 })!;
    expect(d.cause).toBe('player');
    expect(d.owner).toBe(7);
  });

  it('passes its firer unarmed for armSec, then arms; another actor detonates it', () => {
    const seen: boolean[] = [];
    run({ ...open, hitsActor: (_a, _b, _owner, armed) => { seen.push(armed); return false; } });
    const firstArmed = seen.indexOf(true);
    expect(firstArmed).toBeGreaterThan(0);
    expect(firstArmed / 60).toBeCloseTo(ROCKET.armSec, 1);
    const hit = run({ ...open, hitsActor: (a, b) => a[2] < 3 && b[2] >= 3 })!;
    expect(hit.cause).toBe('actor');
  });

  it('detonates at max range in the open', () => {
    const d = run(open, [0, 0, 1], 7, 5)!;
    expect(d.cause).toBe('range');
    expect(Math.hypot(d.at[0], d.at[1] - 1.7, d.at[2])).toBeCloseTo(ROCKET.maxRange, 0);
  });

  it('player blast: full at the epicentre, nothing at the radius, falling off in between', () => {
    expect(blastFalloff(0)).toBe(1);
    expect(blastFalloff(ROCKET.blastPlayerRadius)).toBe(0);
    expect(blastFalloff(ROCKET.blastPlayerRadius * 2)).toBe(0);
    expect(blastFalloff(1)).toBeGreaterThan(blastFalloff(2));
    expect(blastPlayerDamage(0)).toBe(ROCKET.blastPlayerDamage);
    // A direct hit does not one-shot a full-health player (100): two of the
    // volley's three must land.
    expect(blastPlayerDamage(0)).toBeLessThan(100);
    expect(blastPlayerDamage(0) * 3).toBeGreaterThan(100);
  });
});
