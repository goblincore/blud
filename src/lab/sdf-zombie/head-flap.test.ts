// src/lab/sdf-zombie/head-flap.test.ts
import { describe, expect, it } from 'vitest';
import { FLAP, flapPrims, makeFlap, stepFlap, type FlapState } from './head-flap';
import type { Vec3 } from './types';

const hinge: Vec3 = [0, 1.7, 0.1];
const rest: Vec3 = [0, 0.6, 0.8];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const run = (s: FlapState, h: Vec3, r: Vec3, secs: number): FlapState => {
  let st = s;
  for (let t = 0; t < secs; t += 1 / 60) st = stepFlap(st, h, r, 1 / 60);
  return st;
};
const unitOf = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

describe('flap chain', () => {
  it('makeFlap lays FLAP.nodes nodes along the direction at the link length, node 0 on the hinge', () => {
    const s = makeFlap(hinge, rest, [0, 0, -1], 0);
    expect(s.p).toHaveLength(FLAP.nodes);
    expect(s.p[0]).toEqual(hinge);
    const link = FLAP.len / (FLAP.nodes - 1);
    expect(dist(s.p[0]!, s.p[1]!)).toBeCloseTo(link, 9);
  });
  it('stays pinned at the hinge and keeps its link lengths', () => {
    const s = run(makeFlap(hinge, rest, [0, 0, -1], FLAP.kickSpeed), hinge, rest, 1);
    expect(s.p[0]).toEqual(hinge);
    const link = FLAP.len / (FLAP.nodes - 1);
    for (let k = 0; k < FLAP.nodes - 1; k++) expect(dist(s.p[k]!, s.p[k + 1]!)).toBeCloseTo(link, 6);
  });
  it('settles hanging open near its rest pose (tip within 5 cm of the rest tip) and stops moving', () => {
    const s = run(makeFlap(hinge, rest, [0, 0, -1], FLAP.kickSpeed), hinge, rest, 3);
    const u = unitOf(rest);
    const target: Vec3 = [hinge[0] + u[0] * FLAP.len, hinge[1] + u[1] * FLAP.len, hinge[2] + u[2] * FLAP.len];
    expect(dist(s.p[FLAP.nodes - 1]!, target)).toBeLessThan(0.05);
    expect(dist(s.p[FLAP.nodes - 1]!, s.prev[FLAP.nodes - 1]!)).toBeLessThan(1e-3);
  });
  it('follows a moving hinge (the head wobbles and falls)', () => {
    const s0 = run(makeFlap(hinge, rest, [0, 0, 0], 0), hinge, rest, 2);
    const moved: Vec3 = [hinge[0] + 0.05, hinge[1], hinge[2]];
    const s1 = run(s0, moved, rest, 1);
    expect(s1.p[FLAP.nodes - 1]![0] - s0.p[FLAP.nodes - 1]![0]).toBeGreaterThan(0.03);
  });
  it('is deterministic', () => {
    const a = run(makeFlap(hinge, rest, [0, 0, -1], 1), hinge, rest, 0.5);
    const b = run(makeFlap(hinge, rest, [0, 0, -1], 1), hinge, rest, 0.5);
    expect(a).toEqual(b);
  });
});

describe('flapPrims', () => {
  it('is 3 prims per flap, additive, and the count never changes with the pose', () => {
    const kicked = makeFlap(hinge, rest, [0, 0, -1], FLAP.kickSpeed);
    const settled = run(kicked, hinge, rest, 2);
    const a = flapPrims(kicked, [0, 0, -1]), b = flapPrims(settled, [0, 0, -1]);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.every(p => p.op === 'add')).toBe(true);
  });
});
