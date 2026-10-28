import { describe, expect, it } from 'vitest';
import { gapTo, nearestSite, type WarmSite } from './prewarm-order';

describe('prewarm-order', () => {
  it('measures to the sphere surface, 0 inside', () => {
    const s: WarmSite = { x: 10, y: 0, z: 0, r: 4 };
    expect(gapTo(s, [0, 0, 0])).toBe(6);
    expect(gapTo(s, [9, 0, 1])).toBe(0);
  });

  it('picks the nearest surface, not the nearest centre', () => {
    const sites: WarmSite[] = [
      { x: 8, y: 0, z: 0, r: 0.5 },    // centre 8, surface 7.5
      { x: 0, y: 0, z: 20, r: 15 },   // centre 20, surface 5
    ];
    expect(nearestSite(sites, [0, 0, 0], () => false)).toBe(1);
  });

  it('honours skip, and returns -1 when everything is skipped', () => {
    const sites: WarmSite[] = [{ x: 1, y: 0, z: 0, r: 0 }, { x: 5, y: 0, z: 0, r: 0 }];
    expect(nearestSite(sites, [0, 0, 0], i => i === 0)).toBe(1);
    expect(nearestSite(sites, [0, 0, 0], () => true)).toBe(-1);
    expect(nearestSite([], [0, 0, 0], () => false)).toBe(-1);
  });

  it('breaks ties toward the lower index', () => {
    const sites: WarmSite[] = [{ x: 3, y: 0, z: 0, r: 0 }, { x: -3, y: 0, z: 0, r: 0 }];
    expect(nearestSite(sites, [0, 0, 0], () => false)).toBe(0);
  });

  it('follows the player', () => {
    const sites: WarmSite[] = [{ x: 0, y: 0, z: 0, r: 1 }, { x: 50, y: 0, z: 0, r: 1 }];
    expect(nearestSite(sites, [2, 0, 0], () => false)).toBe(0);
    expect(nearestSite(sites, [45, 0, 0], () => false)).toBe(1);
  });
});
