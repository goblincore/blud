import { describe, expect, it } from 'vitest';
import { classifyNormalSupport, stableNormalOwner } from './normal-gradient-support';
import type { Body } from '../validate';
import type { Primitive } from '../types';
const p: Primitive = { a: [0,0,0], b: [0,1,0], radius: .2, scale: [1,1,1], blendK: .03, limb: 'torso', cluster: 0 };
const body = (prims: Primitive[], bonePrims: Primitive[] = []): Body => ({ prims, bonePrims, clusters: [{ id:0, limb:'torso', start:0, count:prims.length, center:[0,0,0], radius:2, alive:true }] });
describe('normal support summary and stencil ownership', () => {
  it('recognizes common flesh without globally rejecting curved internal ribs', () => {
    expect(classifyNormalSupport(body([p], [{ ...p, op:'bone', bend:[.1,0,0], radiusB:.1 }]))).toEqual({ commonFlesh:true, reasons:[] });
  });
  it('reports wholly unsupported actors and inactive actors', () => {
    expect(classifyNormalSupport(body([{ ...p, box:{ round:.1 } }]))).toEqual({ commonFlesh:false, reasons:['unsupported'] });
    expect(classifyNormalSupport(body([{ ...p, dead:true }]))).toEqual({ commonFlesh:false, reasons:['inactive'] });
  });
  it('retains intact eligibility in a mixed supported/unsupported body', () => {
    expect(classifyNormalSupport(body([p, { ...p, bend:[.1,0,0] }]))).toEqual({ commonFlesh:true, reasons:['unsupported'] });
  });
  it('certifies only competitors beyond both Lipschitz neighborhoods', () => {
    const r = Math.sqrt(3) * .0015;
    expect(stableNormalOwner(.01, .01+2*r+1e-6, Infinity)).toBe(true);
    expect(stableNormalOwner(.01, .01+2*r-1e-6, Infinity)).toBe(false);
    expect(stableNormalOwner(.01, Infinity, .01+r+1e-6)).toBe(true);
    expect(stableNormalOwner(.01, Infinity, .01+r-1e-6)).toBe(false);
  });
});

it('proves the scaled-capsule Lipschitz bound used by the owner gap', async () => {
  const { capsuleGradient } = await import('./normal-gradient-reference');
  for (const scale of [[1,1,1],[1.8,.65,1.25],[.13,2,.5]] as const) {
    for (let i=1; i<=24; i++) {
      const dg = capsuleGradient([Math.sin(i)*.4,Math.cos(i)*.6,.31], { a:[-.1,0,0],b:[.2,1,0],r:.15,scale });
      expect(dg.reason).toBe('ok');
      expect(Math.hypot(...dg.g)).toBeLessThanOrEqual(1+1e-12);
    }
  }
});
