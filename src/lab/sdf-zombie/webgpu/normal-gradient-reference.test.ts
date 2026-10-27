import { describe, expect, it } from 'vitest';
import { bendCtrl, qFromAxisAngle, qRotate } from '../vec';
import type { Primitive } from '../types';
import { sdPrimitive, sdShellWrap, sminChamfer, smax, smin } from '../validate';
import {
  capsuleGradient,
  chamferMinGradient,
  bentConeGradient,
  boxGradient,
  roundConeGradient,
  type BentInput,
  type BoxInput,
  shellGradient,
  type ConeInput,
  type ShellInput,
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

import { woundGradient, type WoundInput } from './normal-gradient-reference';

// Independent scalar transcription of applyWounds, deliberately does not call
// the gradient implementation. Inputs have already resolved burn/upload rows.
function woundOracle(base: number, p: V3, wounds: readonly WoundInput[]): number {
  let d = base;
  for (const w of wounds) {
    const v = p.map((x, i) => x - w.center[i]!);
    const r = Math.hypot(...v);
    d = smax(d, Math.min(w.depth-r, w.cap-v.reduce((s,x,i)=>s+x*w.inward[i]!,0)), w.blend);
    if (w.rimAmp === 0) continue;
    const u = Math.max(0,Math.min(1,(base+.3*w.rimAmp)/w.rimAmp));
    d -= Math.exp(-(((r-w.rimPosition)/w.rimWidth)**2))*w.rimAmp*(1-u*u*(3-2*u));
  }
  return d;
}
const wound: WoundInput = {center:[0,0,0],depth:.16,cap:.08,inward:[0,0,-1],blend:.018,rimPosition:.176,rimWidth:.025,rimAmp:.019};
describe('procedural wound gradients', () => {
  const baseAt = (p: V3): Dg => ({d:p[2]-.02,g:[0,0,1],reason:'ok'});
  it.each([
    ['sphere wall',[.14,.01,-.03], [wound]],
    ['slab floor',[.01,.015,-.10], [wound]],
    ['fresh rim',[.174,.02,.021], [wound]],
    ['overlap ordered',[.145,.016,.015], [wound,{...wound,center:[.04,.02,.01],depth:.12,rimAmp:.015}]],
    ['resolved burn',[.04,.01,.017], [{...wound,depth:.16*.35*.7,rimAmp:.16*.35*.7*.12*.25,rimPosition:.048,rimWidth:.006}]],
    ['zero amplitude',[.14,.01,-.03], [{...wound,rimAmp:0}]],
    ['outside rim gate',[.18,.03,.07], [wound]],
  ] as const)('%s matches scalar and finite differences at multiple epsilons', (_name, point, wounds) => {
    const p = point as V3;
    const actual = woundGradient(baseAt(p),p,wounds as readonly WoundInput[]);
    const scalar = (q:V3) => woundOracle(baseAt(q).d,q,wounds as readonly WoundInput[]);
    expect(actual.reason).toBe('ok');
    expect(actual.d).toBeCloseTo(scalar(p),11);
    const errors=[1e-4,5e-5,2.5e-5].map(e=>Math.hypot(...finiteGradient(scalar,p,e).map((v,i)=>v-actual.g[i]!)));
    expect(errors[2]).toBeLessThan(2e-5);
  });
  it('includes the flesh-gate derivative when the radial bump derivative is zero', () => {
    const p:V3=[wound.rimPosition,0,0];
    const base:Dg={d:0,g:[0,0,1],reason:'ok'};
    const actual=woundGradient(base,p,[wound]);
    const scalar=(q:V3)=>woundOracle(q[2],q,[wound]);
    expect(actual.g[2]).toBeGreaterThan(1.2);
    expectV3Close(actual.g,finiteGradient(scalar,p,1e-6),7);
  });
  it('preserves the original flesh gate throughout the ordered loop', () => {
    const p:V3=[.175,.006,.022];
    const list=[wound,{...wound,center:[.035,0,0]}] as const;
    const result=woundGradient(baseAt(p),p,list);
    expect(result.d).toBeCloseTo(woundOracle(baseAt(p).d,p,list),11);
    const wrong=woundGradient(woundGradient(baseAt(p),p,[list[0]]),p,[list[1]]);
    expect(Math.abs(result.d-wrong.d)).toBeGreaterThan(1e-4);
  });
  it('keeps radius degeneracy, cap corners and hard joins explicit', () => {
    expect(woundGradient({d:-.1,g:[0,0,1],reason:'ok'},[0,0,0],[wound]).reason).toBe('degenerate');
    const corner={...wound,depth:.2,cap:.1,inward:[0,0,1] as V3,rimAmp:0};
    expect(woundGradient({d:-.2,g:[0,1,0],reason:'ok'},[.1,0,0],[corner]).reason).toBe('hard-boundary');
    expect(woundGradient({d:.02,g:[0,1,0],reason:'ok'},[.14,0,0],[{...wound,blend:0,rimAmp:0,cap:1e5}]).reason).toBe('hard-boundary');
  });
});

import { NG_REASON_CODES, NG_REASON_SPLIT, ngCoverageClass } from './normal-gradient-reference';
describe('the reason codes a coverage reader meets', () => {
  it('the head split\'s code follows the eight of NgReason, and has its own bucket', () => {
    expect(NG_REASON_SPLIT).toBe(8);
    expect(NG_REASON_CODES).toBe(9);
  });
  it('a split-region pixel is counted apart: the closed body is the wrong oracle for it', () => {
    expect(ngCoverageClass(NG_REASON_SPLIT, 3)).toBe('split');
    for (let code = 0; code < NG_REASON_SPLIT; code++) expect(ngCoverageClass(code, 0)).toBe('body');
  });
  it('background, an unknown code and a pixel with no dominant prim are not counted', () => {
    expect(ngCoverageClass(-1, 0)).toBe('skip');
    expect(ngCoverageClass(NG_REASON_CODES, 0)).toBe('skip');
    expect(ngCoverageClass(NaN, 0)).toBe('skip');
    expect(ngCoverageClass(0, -1)).toBe('skip');
    expect(ngCoverageClass(NG_REASON_SPLIT, -1)).toBe('skip');
  });
});

describe('roundConeGradient', () => {
  const coneScalar = (p: V3, c: ConeInput): number => sdPrimitive(p, {
    a: c.a, b: c.b, radius: c.r, radiusB: c.r2, scale: c.scale, blendK: 0, limb: 'torso', cluster: 0,
  });
  // The zombie's foot bar (r 0.052 -> 0.046, wide 1.15), and a sharper anisotropic horn down to a point.
  const cones: readonly ConeInput[] = [
    { a: [0.1, 0.08, 0.02], b: [0.12, 0.05, 0.2], r: 0.052, r2: 0.046, scale: [1.15, 1, 1] },
    { a: [-0.2, 0.3, 0.1], b: [0.15, 0.55, -0.05], r: 0.07, r2: 0, scale: [1.3, 0.8, 1.1] },
  ];
  // Points in all three of coneCap's regions: past b, behind a, and beside the axis.
  const offsets: readonly V3[] = [[0.02, 0.01, 0.31], [0.05, -0.04, -0.12], [0.11, 0.02, 0.09], [-0.09, 0.07, 0.05]];

  it('matches the production scalar and its central derivative in every region', () => {
    for (const c of cones) {
      for (const o of offsets) {
        const p: V3 = [c.a[0] + o[0], c.a[1] + o[1], c.a[2] + o[2]];
        const x = roundConeGradient(p, c);
        expect(x.reason).toBe('ok');
        expect(x.d).toBeCloseTo(coneScalar(p, c), 12);
        expectV3Close(x.g, finiteGradient(q => coneScalar(q, c), p, 1e-6), 6);
      }
    }
  });

  it('reports a point on the axis as degenerate', () => {
    const c = cones[0]!;
    const mid: V3 = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];
    expect(roundConeGradient(mid, { ...c, scale: [1, 1, 1] }).reason).toBe('degenerate');
  });
});

describe('shellGradient', () => {
  const tube = { a: [0, 0, 0], b: [0, -0.4, 0.02], r: 0.07, scale: [1, 1, 1] } as const;
  const skirt: ShellInput = {
    thickness: 0.006, clipNormal: [0, -1, 0], clipOffset: 0.38, rim: 0.004,
    warpAmp: 0.008, warpFreq: [40, 0, 40], warpDrift: [0.03, 0, -0.01], bodyAnchor: [0.2, 0.7, -0.1],
  };
  const scalar = (p: V3, s: ShellInput): number => sdShellWrap(
    capsuleGradient(p, tube).d, p, s.thickness, s.clipNormal, s.clipOffset, s.rim,
    s.warpAmp, s.warpFreq, s.warpDrift, s.bodyAnchor);

  it.each([
    ['outside the sheet', [0.081, -0.2, 0.01]],
    ['inside the body, under the sheet', [0.055, -0.15, -0.02]],
    ['across the wrap', [-0.02, -0.1, 0.09]],
  ] as const)('matches sdShellWrap and its derivative %s', (_name, p) => {
    for (const s of [skirt, { ...skirt, warpAmp: 0 }]) {
      const x = shellGradient(capsuleGradient(p, tube), p, s);
      expect(x.reason).toBe('ok');
      expect(x.d).toBeCloseTo(scalar(p, s), 12);
      expectV3Close(x.g, finiteGradient(q => scalar(q, s), p, 1e-6), 5);
    }
  });

  it('differentiates the rounded rim at the hem', () => {
    // Both the sheet and the plane are 10 mm inside, within the 20 mm rim: the rounded corner's quarter circle.
    const s = { ...skirt, warpAmp: 0, thickness: 0.014, rim: 0.02 };
    const p: V3 = [0.074, -0.37, 0.0185];
    const x = shellGradient(capsuleGradient(p, tube), p, s);
    expect(x.reason).toBe('ok');
    expect(x.d).toBeCloseTo(scalar(p, s), 12);
    expectV3Close(x.g, finiteGradient(q => scalar(q, s), p, 1e-6), 5);
  });

  it('the rounded corner meets each face smoothly, and rounds the edge rather than grooving it', () => {
    // Just past the corner region on the sheet's side (plane + rim slightly negative): the face, with no kink flagged.
    const s = { ...skirt, warpAmp: 0, thickness: 0.014, rim: 0.02 };
    const p: V3 = [0.074, -0.355, 0.0185];
    const x = shellGradient(capsuleGradient(p, tube), p, s);
    expect(x.reason).toBe('ok');
    expect(x.d).toBeCloseTo(scalar(p, s), 12);
    expectV3Close(x.g, finiteGradient(q => scalar(q, s), p, 1e-6), 5);
  });

  it('refuses to certify a stencil that straddles the crease or the clip edge', () => {
    const mid: V3 = [0.07, -0.2, 0];
    expect(shellGradient(capsuleGradient(mid, tube), mid, { ...skirt, warpAmp: 0 }).reason).toBe('hard-boundary');
    const edge: V3 = [0.076, -0.38, 0];
    expect(shellGradient(capsuleGradient(edge, tube), edge, { ...skirt, warpAmp: 0, rim: 0 }).reason).toBe('hard-boundary');
  });
});

describe('chamferMinGradient', () => {
  const plane = (n: V3, o: number): ((p: V3) => Dg) => p => ({ d: n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - o, g: n, reason: 'ok' });
  const fa = plane([1, 0, 0], 0);
  const fb = plane([0, Math.SQRT1_2, Math.SQRT1_2], 0.01);
  const k = 0.02;

  it.each([
    ['the bevel', [0.03, 0.04, 0.0]],
    ['face a', [-0.2, 0.3, 0.1]],
    ['face b', [0.4, -0.3, 0.05]],
  ] as const)('matches sminChamfer and its derivative on %s', (_name, p) => {
    const x = chamferMinGradient(fa(p), fb(p), k);
    expect(x.reason).toBe('ok');
    expect(x.d).toBeCloseTo(sminChamfer(fa(p).d, fb(p).d, k), 12);
    expectV3Close(x.g, finiteGradient(q => sminChamfer(fa(q).d, fb(q).d, k), p, 1e-6), 6);
  });

  it('refuses to certify a stencil on the bevel edge', () => {
    // On the bevel's edge with face a: a = (a - K + b) / sqrt 2.
    const b = 0.05;
    const a = (b - 4 * k) / (Math.SQRT2 - 1);
    const x = chamferMinGradient({ d: a, g: [1, 0, 0], reason: 'ok' }, { d: b, g: [0, 1, 0], reason: 'ok' }, k);
    expect(x.reason).toBe('hard-boundary');
  });
});

describe('bentConeGradient', () => {
  const bent = (a: V3, b: V3, bend: V3, r: number, r2: number, scale: V3): { s: BentInput; prim: Primitive } => ({
    s: { a, b, c: bendCtrl(a, b, bend) as V3, r, r2, scale },
    prim: { a, b, bend, radius: r, radiusB: r2, scale, blendK: 0, limb: 'torso', cluster: 0 },
  });
  // A soldier-ish bent forearm (tapered, anisotropic) and a strong untapered arc.
  const arm = bent([0, 0, 0], [0.02, -0.4, 0.05], [0.08, 0, 0.03], 0.05, 0.04, [1.1, 1, 0.95]);
  const arc = bent([-0.2, 0, 0], [0.2, 0, 0], [0, 0.3, 0], 0.03, 0.03, [1, 1, 1]);

  it.each([
    ['the outer side', arm, [0.14, -0.2, 0.06]],
    ['the inner side', arm, [0.0, -0.2, 0.0]],
    ['past b', arm, [0.03, -0.48, 0.07]],
    ['behind a', arm, [-0.01, 0.07, 0.0]],
    ['above the arc', arc, [0.05, 0.22, 0.02]],
  ] as const)('matches the production scalar and its central derivative on %s', (_name, c, p) => {
    const x = bentConeGradient(p, c.s);
    expect(x.reason).toBe('ok');
    expect(x.d).toBeCloseTo(sdPrimitive(p, c.prim), 9);
    expectV3Close(x.g, finiteGradient(q => sdPrimitive(q, c.prim), p, 1e-5), 5);
  });

  it('refuses to certify the medial crease inside a bend', () => {
    // Below the arc's centre of curvature on its symmetry plane, two arms of the curve are equally near.
    expect(bentConeGradient([0, -0.01, 0], arc.s).reason).toBe('hard-boundary');
  });
});

describe('boxGradient', () => {
  // A machined plate swept along a diagonal (so the projector matters), anisotropic.
  const s: BoxInput = { a: [0, 0, 0], b: [0.05, 0.3, 0.02], r: 0.06, round: 0.2, scale: [1.1, 1, 0.9] };
  const prim: Primitive = { a: s.a, b: s.b, radius: s.r, scale: s.scale, box: { round: s.round }, blendK: 0, limb: 'torso', cluster: 0 };

  it.each([
    ['a face mid-sweep', [0.1, 0.15, 0.01]],
    ['a rounded edge', [0.095, 0.12, 0.07]],
    ['past b', [0.06, 0.4, 0.03]],
    ['behind a', [0.01, -0.09, -0.01]],
    ['inside, near a face', [0.075, 0.16, 0.0]],
  ] as const)('matches the production scalar and its central derivative on %s', (_name, p) => {
    const x = boxGradient(p, s);
    expect(x.reason).toBe('ok');
    expect(x.d).toBeCloseTo(sdPrimitive(p, prim), 12);
    expectV3Close(x.g, finiteGradient(q => sdPrimitive(q, prim), p, 1e-6), 6);
  });

  it('refuses to certify two tied faces and the plane at either end', () => {
    const straight: BoxInput = { ...s, b: [0, 0.3, 0], scale: [1, 1, 1] };
    expect(boxGradient([0.03, 0.15, 0.03], straight).reason).toBe('hard-boundary');
    // On the swept box's end plane at b, beside it: the box's x face has an axial part along the diagonal.
    const atB: V3 = [0.05 + 0.069, 0.3 - 0.0115, 0.02];
    expect(boxGradient(atB, { ...s, scale: [1, 1, 1] }).reason).toBe('hard-boundary');
  });
});
