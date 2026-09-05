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

import { internalNormalLowerBound } from './normal-gradient-support';
import { sdPrimitive } from '../validate';
it('internal convex-hull bound is conservative for the actual scaled bent/tapered field throughout the noise ball', () => {
  const shapes:Primitive[]=[
    {...p,scale:[2,.45,1.3],bend:[.16,.03,-.09],radiusB:.035},
    {...p,scale:[.5,1.8,.8],radiusB:.06},
    {...p,a:[0,0,0],b:[0,0,0],radiusB:.12,scale:[2,.3,1]},
  ];
  for (const shape of shapes) for(let i=0;i<120;i++) {
    const point=[Math.sin(i*2.3)*.7,Math.cos(i*.7)*1.3,Math.sin(i*.9)*.5] as const;
    const lower=internalNormalLowerBound(point,shape);
    for(const delta of [[0,0,0],[1,-1,-1],[-1,-1,1],[-1,1,-1],[1,1,1]]) {
      const q=point.map((v,k)=>v+delta[k]!*.0015) as unknown as [number,number,number];
      // applyBones deliberately ignores orientation; use that production semantic.
      expect(lower).toBeLessThanOrEqual(sdPrimitive(q,{...shape,orient:undefined})+1e-10);
    }
  }
  expect(internalNormalLowerBound([1,0,0],{...p,strand:{count:4,wave:.1,cycles:2,fat:.5}})).toBe(-Infinity);
});

import { PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { normalHitPoint } from './normal-gradient-support';
it('unprojects the actual WebGPU clip-depth alpha rather than treating depth as ray distance', () => {
  const camera=new PerspectiveCamera(70,4/3,.1,100);
  camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.set(-4,1.62,-3);camera.lookAt(-4,1,-5);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  for(const [x,y] of [[0,0],[451,254],[400,300],[799,599]]) {
    const expected=new Vector3((x!+.5)/800*2-1,1-(y!+.5)/600*2,.92).unproject(camera);
    const clip=expected.clone().project(camera);
    const actual=normalHitPoint(x!,y!,800,600,clip.z,camera);
    for(let k=0;k<3;k++)expect(actual[k]).toBeCloseTo(expected.toArray()[k]!,10);
    expect(expected.distanceTo(camera.position)).not.toBeCloseTo(clip.z,2);
  }
});
