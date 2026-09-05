import { describe, expect, it } from 'vitest';
import { qFromAxisAngle, qRotate } from '../vec';
import type { Primitive } from '../types';
import { sdPrimitive, smax, smin } from '../validate';
import {
  capsuleGradient,
  detailGradient,
  finiteGradient,
  smoothMaxGradient,
  smoothMinGradient,
  type CapsuleInput,
  type Dg,
  type V3,
} from './normal-gradient-reference';

const expectV3Close = (actual: V3, expected: V3, digits = 9): void => {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i]!, digits);
};

const capsuleScalar = (p: V3, shape: CapsuleInput): number => sdPrimitive(p, {
  a: shape.a,
  b: shape.b,
  radius: shape.r,
  scale: shape.scale,
  blendK: 0,
  limb: 'torso',
  cluster: 0,
});

describe('capsuleGradient', () => {
  it('returns the known unit-sphere value and outward gradient', () => {
    const s = { a: [0, 0, 0], b: [0, 0, 0], r: 1, scale: [1, 1, 1] } as const;
    const x = capsuleGradient([2, 0, 0], s);
    expect(x.d).toBeCloseTo(1, 12);
    expect(x.g).toEqual([1, 0, 0]);
    expect(x.reason).toBe('ok');
    expect(capsuleGradient([0, 0, 0], s).reason).toBe('degenerate');
  });

  it('matches the production scalar and its central derivative on an anisotropic capsule', () => {
    const s: CapsuleInput = {
      a: [-0.3, -0.1, 0.2], b: [0.5, 0.8, -0.1], r: 0.18, scale: [1.8, 0.65, 1.25],
    };
    const p: V3 = [0.41, 0.32, 0.37];
    const actual = capsuleGradient(p, s);
    expect(actual.d).toBeCloseTo(capsuleScalar(p, s), 12);
    expectV3Close(actual.g, finiteGradient(q => capsuleScalar(q, s), p, 1e-5), 7);
    expect(Math.hypot(...actual.g)).not.toBeCloseTo(1, 3);
  });

  it.each([
    ['interior', [0.2, 0.3, 0.4] as V3],
    ['a endcap', [-0.5, -0.2, 0.3] as V3],
    ['b endcap', [0.7, 1.0, -0.4] as V3],
  ])('matches the production scalar on the %s branch', (_name, p) => {
    const s: CapsuleInput = {
      a: [-0.2, 0, 0], b: [0.4, 0.7, 0], r: 0.13, scale: [0.8, 1.4, 1.1],
    };
    expect(capsuleGradient(p, s).d).toBeCloseTo(capsuleScalar(p, s), 12);
  });

  it('rejects invalid diagnostic inputs before they can produce NaN', () => {
    const valid = { a: [0, 0, 0], b: [0, 1, 0], r: 0.1, scale: [1, 1, 1] } as const;
    expect(() => capsuleGradient([Number.NaN, 0, 0], valid)).toThrow(/finite/i);
    expect(() => capsuleGradient([0, 0, 0], { ...valid, scale: [1, 0, 1] })).toThrow(/scale/i);
    expect(() => capsuleGradient([0, 0, 0], { ...valid, r: Number.POSITIVE_INFINITY })).toThrow(/finite/i);
  });
});

describe('production smooth folds', () => {
  const a: Dg = { d: -0.04, g: [0.35, -0.8, 0.1], reason: 'ok' };
  const b: Dg = { d: 0.02, g: [-0.25, 0.2, 0.6], reason: 'ok' };

  it('matches production smooth min without normalizing branch gradients', () => {
    const actual = smoothMinGradient(a, b, 0.03);
    expect(actual.d).toBeCloseTo(smin(a.d, b.d, 0.03), 12);
    expectV3Close(actual.g, [0.2, -0.55, 0.225], 12);
  });

  it('matches production smooth max through the sign transformation', () => {
    const actual = smoothMaxGradient(a, b, 0.03);
    expect(actual.d).toBeCloseTo(smax(a.d, b.d, 0.03), 12);
    const oracle = finiteGradient(
      ([x, y, z]) => smax(
        a.d + a.g[0] * x + a.g[1] * y + a.g[2] * z,
        b.d + b.g[0] * x + b.g[1] * y + b.g[2] * z,
        0.03,
      ),
      [0, 0, 0],
      1e-6,
    );
    expectV3Close(actual.g, oracle, 7);
  });

  it('marks hard ties and preserves fold-order selection away from them', () => {
    const left: Dg = { d: 1, g: [1, 0, 0], reason: 'ok' };
    const right: Dg = { d: 1, g: [0, 1, 0], reason: 'ok' };
    expect(smoothMinGradient(left, right, 0).reason).toBe('hard-boundary');
    expect(smoothMinGradient({ ...left, d: 0.5 }, right, 0)).toEqual({ ...left, d: 0.5 });
  });

  it('propagates invalid reasons only from branches that contribute', () => {
    const unsupported: Dg = { d: 10, g: [9, 9, 9], reason: 'unsupported' };
    const valid: Dg = { d: 0, g: [0, 1, 0], reason: 'ok' };
    expect(smoothMinGradient(unsupported, valid, 0.1).reason).toBe('ok');
    expect(smoothMinGradient({ ...unsupported, d: 0.05 }, valid, 0.1).reason).toBe('unsupported');
  });
});

describe('orientation and nonunit gradients', () => {
  it('applies the production world-to-primitive transform and Jacobian transpose', () => {
    const orient = qFromAxisAngle([0.3, 0.8, -0.2], 0.73);
    const prim: Primitive = {
      a: [-0.15, 0.2, 0.1], b: [0.45, 0.7, -0.05], radius: 0.16,
      scale: [1.65, 0.7, 1.2], blendK: 0, limb: 'head', cluster: 0, orient,
    };
    const p: V3 = [0.52, 0.43, 0.31];
    const mid: V3 = [
      (prim.a[0] + prim.b[0]) / 2,
      (prim.a[1] + prim.b[1]) / 2,
      (prim.a[2] + prim.b[2]) / 2,
    ];
    const conjugate = [-orient[0], -orient[1], -orient[2], orient[3]] as typeof orient;
    const toLocal = (v: V3): V3 => {
      const rotated = qRotate(conjugate, [v[0] - mid[0], v[1] - mid[1], v[2] - mid[2]]);
      return [rotated[0] + mid[0], rotated[1] + mid[1], rotated[2] + mid[2]];
    };
    const local = capsuleGradient(toLocal(p), {
      a: toLocal(prim.a), b: toLocal(prim.b), r: prim.radius, scale: prim.scale,
    });
    const worldGradient = qRotate(orient, local.g);
    expect(local.d).toBeCloseTo(sdPrimitive(p, prim), 12);
    expectV3Close(worldGradient, finiteGradient(q => sdPrimitive(q, prim), p, 1e-5), 7);
  });

  it('keeps anisotropic gradient magnitudes until after smooth composition', () => {
    const p: V3 = [1, 0.5, 0];
    const sa = { a: [0, 0, 0], b: [0, 0, 0], r: 0.3, scale: [2, 1, 1] } as const;
    const sb = { a: [0.3, 0, 0], b: [0.3, 0, 0], r: 0.3, scale: [1, 2, 1] } as const;
    const aDg = capsuleGradient(p, sa);
    const bDg = capsuleGradient(p, sb);
    const actual = smoothMinGradient(aDg, bDg, 0.05);
    const scalar = (q: V3): number => smin(capsuleScalar(q, sa), capsuleScalar(q, sb), 0.05);
    expectV3Close(actual.g, finiteGradient(scalar, p, 1e-5), 6);

    const unit = (v: V3): V3 => {
      const n = Math.hypot(...v);
      return [v[0] / n, v[1] / n, v[2] / n];
    };
    const prematurelyNormalized = smoothMinGradient(
      { ...aDg, g: unit(aDg.g) }, { ...bDg, g: unit(bDg.g) }, 0.05,
    );
    expect(Math.hypot(
      prematurelyNormalized.g[0] - actual.g[0],
      prematurelyNormalized.g[1] - actual.g[1],
      prematurelyNormalized.g[2] - actual.g[2],
    )).toBeGreaterThan(0.05);
  });
});

describe('independent numerical gradients', () => {
  it('central differences recover a linear gradient', () => {
    expectV3Close(finiteGradient(([x, y, z]) => 2 * x - 3 * y + 4 * z, [0.3, -0.2, 0.7], 1e-4), [2, -3, 4], 10);
  });

  it('the four-sample detail stencil recovers a linear gradient', () => {
    expectV3Close(detailGradient(([x, y, z]) => 2 * x - 3 * y + 4 * z, [0.3, -0.2, 0.7], 1e-4), [2, -3, 4], 10);
  });

  it('converges at deterministic smooth capsule points across three epsilon values', () => {
    const s: CapsuleInput = {
      a: [-0.25, -0.1, 0], b: [0.35, 0.65, 0.1], r: 0.14, scale: [1.5, 0.75, 1.2],
    };
    const epsilons = [1e-3, 5e-4, 2.5e-4];
    for (const [name, p] of [
      ['interior', [0.31, 0.22, 0.28] as V3],
      ['endcap', [0.65, 0.86, -0.18] as V3],
    ] as const) {
      const analytic = capsuleGradient(p, s);
      const errors = epsilons.map(eps => {
        const numeric = finiteGradient(q => capsuleScalar(q, s), p, eps);
        return Math.hypot(
          numeric[0] - analytic.g[0], numeric[1] - analytic.g[1], numeric[2] - analytic.g[2],
        );
      });
      expect(errors[2], `${name} finest-epsilon gradient error`).toBeLessThan(2e-6);
      expect(errors[2], `${name} convergence`).toBeLessThan(errors[0]!);
      expect(analytic.d, `${name} scalar parity`).toBeCloseTo(capsuleScalar(p, s), 12);
    }
  });

  it.each([
    ['just outside the endpoint join', [0.2, -5e-4, 0.15] as V3, 1e-6, 1e-8],
    ['just inside the endpoint join', [0.2, 5e-4, 0.15] as V3, 1e-6, 1e-8],
    ['near the capsule axis', [1e-4, 0.4, -2e-4] as V3, 1e-6, 5e-5],
  ])('matches the scalar oracle and finite gradient %s', (_name, p, eps, tolerance) => {
    const s: CapsuleInput = {
      a: [0, 0, 0], b: [0, 1, 0], r: 0.2, scale: [1.3, 0.8, 1.1],
    };
    const analytic = capsuleGradient(p, s);
    const numeric = finiteGradient(q => capsuleScalar(q, s), p, eps);
    expect(analytic.reason).toBe('ok');
    expect(analytic.d).toBeCloseTo(capsuleScalar(p, s), 12);
    expect(Math.hypot(
      numeric[0] - analytic.g[0], numeric[1] - analytic.g[1], numeric[2] - analytic.g[2],
    )).toBeLessThan(tolerance);
  });

  it('keeps named singular cases instead of inventing a normalized direction', () => {
    const s = { a: [0, -1, 0], b: [0, 1, 0], r: 0.2, scale: [1, 1, 1] } as const;
    expect(capsuleGradient([0, 0, 0], s)).toEqual({ d: -0.2, g: [0, 0, 0], reason: 'degenerate' });
    expect(smoothMaxGradient(
      { d: 0, g: [1, 0, 0], reason: 'ok' },
      { d: 0, g: [0, 1, 0], reason: 'ok' },
      0,
    ).reason).toBe('hard-boundary');
  });
});
