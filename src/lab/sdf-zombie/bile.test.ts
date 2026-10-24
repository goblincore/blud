import { describe, it, expect } from 'vitest';
import { BILE, lobVelocity, spawnBile, stepBile } from './bile';
import type { Vec3 } from './types';

/** Fly a glob until it comes back down to the target's height; where is it? */
function landing(origin: Vec3, target: Vec3): Vec3 {
  let g = [spawnBile(origin, target, 1)];
  let last: Vec3 = origin;
  for (let i = 0; i < 600 && g.length; i++) {
    const from = g[0]!.pos;
    let hit: Vec3 | null = null;
    const s = stepBile(g, 1 / 120, {
      // descending through the target's height: interpolate the crossing
      hitsWorld: (f, to) => {
        if (!(to[1] < target[1] && to[1] < f[1])) return false;
        const k = (f[1] - target[1]) / (f[1] - to[1]);
        hit = [f[0] + (to[0] - f[0]) * k, target[1], f[2] + (to[2] - f[2]) * k];
        return true;
      },
      hitsPlayer: () => false,
    });
    if (s.splashes.length) return hit ?? from;
    g = s.live; last = g[0]?.pos ?? last;
  }
  return last;
}

describe('bile — the gibbet\'s lobbed glob', () => {
  it('lobs onto a target in range (the low arc), within a glob\'s width', () => {
    for (const target of [[0, 1.25, 4], [3, 1.25, 6], [-5, 1.25, 5]] as Vec3[]) {
      const at = landing([0, 0.3, 0], target);
      expect(Math.hypot(at[0] - target[0], at[2] - target[2])).toBeLessThan(0.15);
    }
  });

  it('throws at 45 degrees toward a target out of range (falls short, never sideways)', () => {
    const v = lobVelocity([0, 0.3, 0], [0, 1.25, 40]);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(v[2], 6);
    expect(Math.hypot(...v)).toBeCloseTo(BILE.speed, 6);
  });

  it('cannot hit anything until armed, then splashes on the player', () => {
    const g = [spawnBile([0, 1, 0], [0, 1.25, 3], 1)];
    expect(stepBile(g, 0.01, { hitsWorld: () => true, hitsPlayer: () => true }).splashes).toEqual([]);
    const later = [{ ...g[0]!, ageSec: BILE.armSec }];
    expect(stepBile(later, 0.01, { hitsWorld: () => false, hitsPlayer: () => true }).splashes[0]!.cause).toBe('player');
  });
});
