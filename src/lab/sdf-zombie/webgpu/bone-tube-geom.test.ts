// src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts
import { describe, expect, it } from 'vitest';
import type { Primitive } from '../types';
import { sdPrimitive } from '../validate';
import { qFromAxisAngle } from '../vec';
import { boneInstanceOf, tubePoint, buildTubeGeometry, TUBE_RINGS, TUBE_SEGS } from './bone-tube-geom';

const base = (over: Partial<Primitive>): Primitive => ({
  a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0,
  limb: 'torso', cluster: 1, op: 'bone', ...over,
});

const CASES: [string, Primitive][] = [
  ['straight capsule', base({})],
  ['round cone (radiusB)', base({ radiusB: 0.008 })],
  ['bent rib', base({ b: [0.12, 0.05, 0.02], bend: [0.03, 0.0, 0.04] })],
  ['skull sphere (a == b)', base({ b: [0, 0, 0], radius: 0.06 })],
  ['scaled (wide/deep)', base({ scale: [1.4, 1, 0.7] })],
  ['oriented skull sphere', base({ b: [0, 0, 0], radius: 0.05, orient: qFromAxisAngle([0, 1, 0], 0.7) })],
  ['bent + tapered + scaled', base({ b: [0.1, 0.1, 0], bend: [0, 0.02, 0.03], radiusB: 0.01, scale: [1.2, 0.9, 1] })],
];

describe('tubePoint lies on the field zero level', () => {
  for (const [name, prim] of CASES) {
    it(name, () => {
      let worst = 0;
      for (let i = 0; i <= TUBE_RINGS; i++) for (let j = 0; j < TUBE_SEGS; j++) {
        const t = i / TUBE_RINGS, theta = (j / TUBE_SEGS) * Math.PI * 2;
        const p = tubePoint(prim, t, theta);
        worst = Math.max(worst, Math.abs(sdPrimitive(p, prim)));
      }
      // caps: pole and a mid-latitude ring at both ends
      for (const end of [0, 1]) for (const lat of [0.25, 0.5, 0.9]) for (let j = 0; j < TUBE_SEGS; j++) {
        const p = tubePoint(prim, end, (j / TUBE_SEGS) * Math.PI * 2, lat);
        worst = Math.max(worst, Math.abs(sdPrimitive(p, prim)));
      }
      expect(worst).toBeLessThan(0.001);
    });
  }
});

describe('boneInstanceOf', () => {
  it('fills c with the bend control point and r2 with radiusB, defaults otherwise', () => {
    const s = boneInstanceOf(base({ b: [0.1, 0, 0], bend: [0, 0.02, 0], radiusB: 0.01 }));
    expect(s.c).toEqual([0.05, 0.02, 0]);
    expect(s.r1).toBe(0.02); expect(s.r2).toBe(0.01);
    const d = boneInstanceOf(base({}));
    expect(d.c).toEqual([0, 0.1, 0]); expect(d.r2).toBe(0.02);
    expect(d.orient).toEqual([0, 0, 0, 1]);
  });
});

describe('buildTubeGeometry', () => {
  it('emits (rings+1)*segs body verts plus two caps, indexed, with t/theta/cap attributes', () => {
    const g = buildTubeGeometry();
    const n = g.getAttribute('position').count;
    expect(n).toBe((TUBE_RINGS + 1) * TUBE_SEGS + 2 * (4 * TUBE_SEGS + 1));
    expect(g.getAttribute('tubeT').count).toBe(n);
    expect(g.getAttribute('tubeTheta').count).toBe(n);
    expect(g.getAttribute('tubeLat').count).toBe(n);
    expect(g.index!.count % 3).toBe(0);
  });
});
