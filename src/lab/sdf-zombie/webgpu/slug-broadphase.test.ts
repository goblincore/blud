import { describe, expect, it } from 'vitest';
import { segmentNearAnySphere } from './game-world-leaves';
import type { Vec3 } from '../types';

const sphere = (center: Vec3, radius: number) => ({ center, radius });

describe('segmentNearAnySphere', () => {
  it('accepts a segment that passes through a sphere between its endpoints', () => {
    expect(segmentNearAnySphere([-5, 0, 0], [5, 0, 0], [sphere([0, 0.2, 0], 0.5)], 0)).toBe(true);
  });
  it('rejects a segment whose INFINITE line would hit but which stops short', () => {
    expect(segmentNearAnySphere([-5, 0, 0], [-2, 0, 0], [sphere([0, 0, 0], 0.5)], 0.15)).toBe(false);
  });
  it('measures from the nearest endpoint, and the margin widens the test', () => {
    const s = [sphere([0, 0, 0], 0.5)];
    expect(segmentNearAnySphere([-5, 0, 0], [-0.6, 0, 0], s, 0)).toBe(false);
    expect(segmentNearAnySphere([-5, 0, 0], [-0.6, 0, 0], s, 0.15)).toBe(true);
  });
  it('handles a zero-length segment and an empty sphere list', () => {
    expect(segmentNearAnySphere([0, 0, 0], [0, 0, 0], [sphere([0.3, 0, 0], 0.5)], 0)).toBe(true);
    expect(segmentNearAnySphere([0, 0, 0], [1, 0, 0], [], 1)).toBe(false);
  });
  it('never rejects a segment a brute-force sample finds inside a sphere', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 4 - 2;
    for (let n = 0; n < 2000; n++) {
      const a: Vec3 = [rnd(), rnd(), rnd()], b: Vec3 = [rnd(), rnd(), rnd()];
      const s = [sphere([rnd(), rnd(), rnd()], Math.abs(rnd()) * 0.4 + 0.05)];
      let inside = false;
      for (let i = 0; i <= 64 && !inside; i++) {
        const t = i / 64;
        const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        inside = Math.hypot(p[0] - s[0]!.center[0], p[1] - s[0]!.center[1], p[2] - s[0]!.center[2]) <= s[0]!.radius;
      }
      if (inside) expect(segmentNearAnySphere(a, b, s, 0)).toBe(true);
    }
  });
});
