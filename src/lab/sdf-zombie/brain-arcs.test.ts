// brain-arcs.ts: electricity over a seizing brain. Pins that nothing strikes at rest, that a harder seizure strikes
// more arcs, that the same seed strikes the same arcs (and a new seed new ones), and that the arcs hug the brain:
// every point between just inside its surface and well clear of it, never through its middle.
import { describe, it, expect } from 'vitest';
import { ARC_POINTS, strikeArcs, type ArcDrive } from './brain-arcs';

const drive = (level: number): ArcDrive => ({ level, centre: [0, 2, 0.4], radii: [0.7, 0.6, 0.8], yaw: 0.6 });

describe('strikeArcs', () => {
  it('is dark at rest and busier the harder it seizes', () => {
    expect(strikeArcs(1, drive(0), 10)).toEqual([]);
    const weak = strikeArcs(1, drive(0.15), 10).length, strong = strikeArcs(1, drive(1), 10).length;
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeGreaterThan(weak);
  });
  it('is deterministic per seed and flickers between seeds', () => {
    expect(strikeArcs(7, drive(1), 10)).toEqual(strikeArcs(7, drive(1), 10));
    expect(strikeArcs(8, drive(1), 10)).not.toEqual(strikeArcs(7, drive(1), 10));
  });
  it('hugs the brain: no arc cuts through its middle or flies off', () => {
    for (let seed = 1; seed < 40; seed++) {
      for (const arc of strikeArcs(seed, drive(1), 10)) {
        expect(arc.length).toBe(ARC_POINTS);
        for (const p of arc) {
          // Ellipsoid radius units, in the body frame (undo the yaw).
          const x = p[0] - 0, y = p[1] - 2, z = p[2] - 0.4, c = Math.cos(0.6), s = Math.sin(0.6);
          const bx = x * c - z * s, bz = x * s + z * c;
          const e = Math.hypot(bx / 0.7, y / 0.6, bz / 0.8);
          expect(e).toBeGreaterThan(0.7);
          expect(e).toBeLessThan(2.0);
        }
      }
    }
  });
});
