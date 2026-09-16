import { describe, it, expect } from 'vitest';
import {
  GIB_LAUNCH, GIB_TABLE_SPREAD, gibLaunchVelocity, sourceSpreadMps,
} from './gib-launch';
import type { Vec3 } from './types';

const ZERO: Vec3 = [0, 0, 0];
const BASE = { seed: 7, bodyVel: ZERO, spread: GIB_TABLE_SPREAD } as const;

/** Unit direction of a velocity, or [0,1,0] when it is numerically zero. */
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l];
}

describe('sourceSpreadMps — the ported NotBlood unit chain', () => {
  it('converts the gibHuman atc/at10 fields to the ported port m/s', () => {
    // death-outcome.ts spread(): floor((field * 0x40000) / 120)
    //   atc 300 -> 655360 raw field
    //   at10 900 -> 1966080 raw field
    // outcome-adapter.ts: MoveThing integrates xvel >> 12, so /4096.
    //   -> 160 BU/tic and 480 BU/tic
    // tuning.ts buPerTicToMps: * 120 / 256.
    //   -> 75 m/s and 225 m/s (the raw source magnitude the port documents).
    expect(sourceSpreadMps(300)).toBeCloseTo(75, 6);
    expect(sourceSpreadMps(900)).toBeCloseTo(225, 6);
    expect(sourceSpreadMps(0)).toBe(0);
  });
});

describe('gibLaunchVelocity', () => {
  it('is deterministic for a key+seed and varies across keys', () => {
    const a = gibLaunchVelocity({ ...BASE, key: 'torso.chest#0' });
    const b = gibLaunchVelocity({ ...BASE, key: 'torso.chest#0' });
    const c = gibLaunchVelocity({ ...BASE, key: 'torso.chest#1' });
    expect(a).toEqual(b);
    // Independent pieces do not share a velocity vector.
    expect(a).not.toEqual(c);
    // A different global seed re-rolls the spread.
    const d = gibLaunchVelocity({ ...BASE, seed: 8, key: 'torso.chest#0' });
    expect(d).not.toEqual(a);
  });

  it('spreads NEARLY COINCIDENT pieces independently — no common spoke', () => {
    // 12 pieces nominally at the blast centre (the correlated case the owner
    // reported as "clustered"): with the old per-piece radial concussion they
    // all left along a near-identical direction. Directions must now be
    // genuinely independent.
    const dirs = Array.from({ length: 12 }, (_, i) =>
      unit(gibLaunchVelocity({ ...BASE, key: `part#${i}` })));
    let sum = 0, n = 0;
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const d = Math.abs(dirs[i]![0] * dirs[j]![0] + dirs[i]![1] * dirs[j]![1] + dirs[i]![2] * dirs[j]![2]);
        sum += d; n++;
      }
    }
    // Isotropic directions average |dot| = 0.5; a common spoke is ~1.0.
    expect(sum / n).toBeLessThan(0.75);
  });

  it('preserves the source 1:3 horizontal:vertical spread ratio', () => {
    const hMax = sourceSpreadMps(GIB_TABLE_SPREAD.atc) * GIB_LAUNCH.spreadScale;
    const vMax = sourceSpreadMps(GIB_TABLE_SPREAD.at10) * GIB_LAUNCH.spreadScale;
    expect(vMax / hMax).toBeCloseTo(GIB_TABLE_SPREAD.at10 / GIB_TABLE_SPREAD.atc, 6);
    // The envelope is the calibrated source envelope (within the speed clamp).
    expect(vMax).toBeLessThan(GIB_LAUNCH.maxSpeedMps);
    let maxH = 0, maxV = 0;
    for (let i = 0; i < 400; i++) {
      const v = gibLaunchVelocity({ ...BASE, key: `p#${i}` });
      maxH = Math.max(maxH, Math.abs(v[0]), Math.abs(v[2]));
      maxV = Math.max(maxV, v[1]);
    }
    expect(maxH).toBeLessThanOrEqual(hMax + 1e-9);
    expect(maxV).toBeLessThanOrEqual(vMax + 1e-9);
    // ...and the sample actually reaches a large fraction of it (not a no-op).
    expect(maxH).toBeGreaterThan(hMax * 0.8);
    expect(maxV).toBeGreaterThan(vMax * 0.8);
  });

  it('kicks UP in lab axes (+y) and never downward when the shove is zero', () => {
    // NotBlood's z branch is `zvel = -Random(...)` (Build -z = up), so in lab
    // axes every gib gets a non-negative +y kick and none gets a downward one.
    let sumUp = 0;
    for (let i = 0; i < 50; i++) {
      const v = gibLaunchVelocity({ ...BASE, key: `p#${i}` });
      expect(v[1]).toBeGreaterThanOrEqual(0);
      sumUp += v[1];
    }
    expect(sumUp / 50).toBeGreaterThan(0); // the kick is real, not all zeros
  });

  it('applies the shared coherent body velocity at coherentFrac', () => {
    const bodyVel: Vec3 = [3, 4, -2];
    const v = gibLaunchVelocity({
      key: 'k', seed: 1, bodyVel, spread: { atc: 0, at10: 0 },
    });
    expect(v[0]).toBeCloseTo(3 * GIB_LAUNCH.coherentFrac, 6);
    expect(v[1]).toBeCloseTo(4 * GIB_LAUNCH.coherentFrac, 6);
    expect(v[2]).toBeCloseTo(-2 * GIB_LAUNCH.coherentFrac, 6);
  });

  it('never exceeds maxSpeedMps even with a hot body velocity', () => {
    for (let i = 0; i < 50; i++) {
      const v = gibLaunchVelocity({ ...BASE, key: `p#${i}`, bodyVel: [40, 40, 40] });
      expect(Math.hypot(v[0], v[1], v[2])).toBeLessThanOrEqual(GIB_LAUNCH.maxSpeedMps + 1e-9);
    }
  });

  it('is finite and bounded for a zero spread and zero body velocity', () => {
    const v = gibLaunchVelocity({ key: 'k', seed: 0, bodyVel: ZERO, spread: { atc: 0, at10: 0 } });
    expect(v.every(Number.isFinite)).toBe(true);
    expect([...v]).toEqual([0, 0, 0]);
  });
});
