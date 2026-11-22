import { describe, expect, it } from 'vitest';
import { PROXY_TRIS, PROXY_VERTS, proxyIndices, writeProxyCone, type ProxyCone } from './cloth-proxy';
import type { Vec3 } from '../types';

/** The proxy's face planes (outward normal, offset), skipping the poles' degenerate triangles. */
function planes(c: ProxyCone) {
  const pos = new Float32Array(PROXY_VERTS * 3);
  writeProxyCone(c, pos, 0);
  const idx = proxyIndices();
  const v = (i: number): Vec3 => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
  const out: { n: Vec3; d: number }[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [p, q, r] = [v(idx[t]!), v(idx[t + 1]!), v(idx[t + 2]!)];
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n: Vec3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(...n);
    if (l < 1e-9) continue;
    const nn: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
    out.push({ n: nn, d: nn[0] * p[0] + nn[1] * p[1] + nn[2] * p[2] });
  }
  return { out, pos };
}
const side = (pl: { n: Vec3; d: number }, p: Vec3) => pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] - pl.d;

const CONES: [string, ProxyCone][] = [
  ['the robe skirt (0.15 -> 0.32, 0.82 long, tilted)', { a: [0, 0.9, 0], b: [0.05, 0.08, 0.1], ra: 0.17, rb: 0.34 }],
  ['the capelet (0.08 -> 0.285, short)', { a: [0, 1.5, 0], b: [0, 1.25, 0.02], ra: 0.10, rb: 0.30 }],
  ['a trouser tube (near uniform)', { a: [0.1, 0.9, 0], b: [0.1, 0.46, 0], ra: 0.11, rb: 0.105 }],
  ['a hood ball (a == b)', { a: [0, 1.6, 0], b: [0, 1.6, 0], ra: 0.2, rb: 0.2 }],
  ['one ball swallowing the other', { a: [0, 0, 0], b: [0, 0.05, 0], ra: 0.3, rb: 0.1 }],
];

describe('cloth proxy mesh', () => {
  it('has the counts the buffers are sized by', () => {
    expect(proxyIndices().length).toBe(PROXY_TRIS * 3);
  });

  it.each(CONES)('%s: closed, convex, wound outward', (_n, c) => {
    const { out, pos } = planes(c);
    expect(out.length).toBeGreaterThan(PROXY_TRIS * 0.8);
    // Every vertex on or inside every face plane: convex, and every normal points OUT (an inward-wound face would
    // have the whole mesh on its positive side).
    let worst = -Infinity;
    for (const pl of out) for (let i = 0; i < PROXY_VERTS; i++) worst = Math.max(worst, side(pl, [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]));
    expect(worst).toBeLessThan(1e-5);
  });

  it.each(CONES)('%s: CONTAINS the true round cone', (_n, c) => {
    const { out } = planes(c);
    // The round cone is the union of the balls B(c(t), r(t)); its surface points are on those balls.
    let worst = -Infinity;
    for (let ti = 0; ti <= 40; ti++) {
      const t = ti / 40;
      const ctr: Vec3 = [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t, c.a[2] + (c.b[2] - c.a[2]) * t];
      const r = c.ra + (c.rb - c.ra) * t;
      for (let i = 0; i < 400; i++) {
        const y = 1 - (i / 399) * 2, s = Math.sqrt(Math.max(0, 1 - y * y)), th = Math.PI * (3 - Math.sqrt(5)) * i;
        const p: Vec3 = [ctr[0] + r * Math.cos(th) * s, ctr[1] + r * y, ctr[2] + r * Math.sin(th) * s];
        for (const pl of out) worst = Math.max(worst, side(pl, p));
      }
    }
    expect(worst, `a point of the round cone is ${worst} m outside its proxy`).toBeLessThan(0);
  });
});
