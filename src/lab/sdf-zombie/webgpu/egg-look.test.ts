// src/lab/sdf-zombie/webgpu/egg-look.test.ts

import { describe, expect, it } from 'vitest';
import {
  EGG, FIGURE, advancePhase, blurFor, coreEmission, eggBeat, eggProximity, eggPulse, eggResolve,
  figureTau, gaussLine, innerCentre, innerTransmit, rayEllipsoid, spotDirection, spotRadius, type Vec3,
} from './egg-look';

const C: Vec3 = [0, 1.6, -136.7];

describe('rayEllipsoid', () => {
  it('hits a sphere along its axis at -r and +r', () => {
    const h = rayEllipsoid([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1])!;
    expect(h[0]).toBeCloseTo(4, 6);
    expect(h[1]).toBeCloseTo(6, 6);
  });
  it('scales per axis', () => {
    const h = rayEllipsoid([0, 5, 0], [0, -1, 0], [0, 0, 0], [0.95, 1.3, 0.95])!;
    expect(h[0]).toBeCloseTo(3.7, 6);
    expect(h[1]).toBeCloseTo(6.3, 6);
  });
  it('misses a ray that passes by, and one that points away', () => {
    expect(rayEllipsoid([2, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1])).toBeNull();
    expect(rayEllipsoid([0, 0, 5], [0, 0, 1], [0, 0, 0], [1, 1, 1])).toBeNull();
  });
});

describe('gaussLine', () => {
  it('equals the numeric line integral of exp(-|(p-c)/s|^2)', () => {
    const o: Vec3 = [0.2, 0.1, 4], d: Vec3 = [0.02, 0.01, -1], c: Vec3 = [0, 0, 0], s: Vec3 = [0.3, 0.5, 0.18];
    const len = Math.hypot(...d);
    const dn: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
    let sum = 0;
    for (let t = 0; t < 8; t += 0.0005) {
      const p = [o[0] + dn[0] * t, o[1] + dn[1] * t, o[2] + dn[2] * t];
      sum += Math.exp(-((p[0]! / s[0]) ** 2 + (p[1]! / s[1]) ** 2 + (p[2]! / s[2]) ** 2)) * 0.0005;
    }
    expect(gaussLine(o, dn, c, s).value).toBeCloseTo(sum, 3);
  });
  it('reports the parameter of closest approach', () => {
    const g = gaussLine([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1]);
    expect(g.t).toBeCloseTo(5, 6);
  });
});

describe('spots', () => {
  it('directions are unit length and well separated', () => {
    const dirs = Array.from({ length: EGG.spots }, (_, i) => spotDirection(i));
    for (const d of dirs) expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    let min = Infinity;
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
      const a = dirs[i]!, b = dirs[j]!;
      min = Math.min(min, Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    }
    expect(min).toBeGreaterThan(0.3);
  });
  it('radii are 0.10 to 0.31 rad and vary', () => {
    const r = Array.from({ length: EGG.spots }, (_, i) => spotRadius(i));
    expect(Math.min(...r)).toBeCloseTo(0.1, 6);
    expect(Math.max(...r)).toBeLessThanOrEqual(0.31 + 1e-9);
    expect(new Set(r.map(v => v.toFixed(3))).size).toBeGreaterThan(3);
  });
});

describe('the figure and the core', () => {
  const o: Vec3 = [0, C[1] + EGG.innerDy, C[2] + 4];   // in front of the egg (the door side), at the inner egg's height
  const d: Vec3 = [0, 0, -1];
  it('a ray through the figure is more absorbed than one that misses it', () => {
    const through = figureTau(o, d, C, 0.5);
    const miss = figureTau([1.2, o[1], o[2]], d, C, 0.5);
    expect(through).toBeGreaterThan(0.5);
    expect(miss).toBeLessThan(0.05);
  });
  it('only the figure in front of the core darkens the glow (looking from behind, the glow wins)', () => {
    const tCore = coreEmission(o, d, C).t;
    const front = figureTau(o, d, C, 0.5, tCore);
    expect(front).toBeGreaterThan(0.3);                       // from the door, the figure is in front of the core
    const back: Vec3 = [0, o[1], C[2] - 4];
    const tCoreBack = coreEmission(back, [0, 0, 1], C).t;
    expect(figureTau(back, [0, 0, 1], C, 0.5, tCoreBack)).toBeLessThan(0.5 * front);   // from behind, the core is in front
  });
  it('blur spreads the figure and conserves a single blob\'s total absorption (its peak falls as 1/blur^2)', () => {
    const b = FIGURE[0]!;
    const ci = innerCentre(C);
    const k = EGG.innerScale / 0.6;
    const bc: Vec3 = [ci[0] + (EGG.figureOffset[0] + b.pos[0]) * k, ci[1] + (EGG.figureOffset[1] + b.pos[1]) * k, ci[2] + (EGG.figureOffset[2] + b.pos[2]) * k];
    const through = (blur: number) => (EGG.figureStrength / (blur * blur * blur)) * gaussLine([bc[0], bc[1], bc[2] + 3], [0, 0, -1], bc, [b.sc[0] * k * blur, b.sc[1] * k * blur, b.sc[2] * k * blur]).value;
    expect(through(1.7) * 1.7 * 1.7).toBeCloseTo(through(1.0), 6);
    expect(blurFor(0)).toBeCloseTo(EGG.blurFar, 6);
    expect(blurFor(1)).toBeCloseTo(EGG.blurNear, 6);
  });
  it('the milk thins towards the edge of the inner egg', () => {
    expect(innerTransmit(1.14)).toBeLessThan(innerTransmit(0.3));
    expect(innerTransmit(0)).toBe(1);
  });
});

describe('pulse, proximity and resolve', () => {
  it('the beat peaks at the start of a cycle and the pulse stays in 0.55..1', () => {
    expect(eggBeat(0)).toBeGreaterThan(0.95);
    expect(eggBeat(0.15)).toBeLessThan(0.3);
    for (let p = 0; p < 1; p += 0.01) {
      expect(eggPulse(p)).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(eggPulse(p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
  it('the phase advances faster when you are close, and wraps into 0..1', () => {
    const slow = advancePhase(0, 0.1, 0), fast = advancePhase(0, 0.1, 1);
    expect(fast).toBeGreaterThan(slow);
    expect(advancePhase(0.95, 0.2, 0)).toBeLessThan(1);
    expect(advancePhase(0.95, 0.2, 0)).toBeGreaterThanOrEqual(0);
  });
  it('proximity is 0 beyond 6 m and 1 within 1.8 m', () => {
    expect(eggProximity(10)).toBe(0);
    expect(eggProximity(1.0)).toBe(1);
    expect(eggProximity(3.5)).toBeGreaterThan(eggProximity(5));
  });
  it('resolve: 0 at range or with the setting 0; the setting at point blank', () => {
    expect(eggResolve(10, 0.5)).toBe(0);
    expect(eggResolve(1.0, 0.5)).toBeCloseTo(0.5, 6);
    expect(eggResolve(1.0, 0)).toBe(0);
    expect(eggResolve(1.0, 1)).toBe(1);
  });
});
