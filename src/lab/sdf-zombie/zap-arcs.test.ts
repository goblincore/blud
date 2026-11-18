// src/lab/sdf-zombie/zap-arcs.test.ts
import { describe, expect, it } from 'vitest';
import { ARC_POINTS } from './brain-arcs';
import { ZAP_ARCS, strikeZapArcs, zapPartsBox, type ZapArcPart } from './zap-arcs';

const ball = (c: [number, number, number], radius: number): ZapArcPart => ({ a: c, b: c, radius });
const MAN: ZapArcPart[] = [
  ball([0, 1.6, 0], 0.11), { a: [0, 1.0, 0], b: [0, 1.4, 0], radius: 0.16 },
  { a: [-0.2, 1.4, 0], b: [-0.6, 1.7, 0], radius: 0.05 }, { a: [0.2, 1.4, 0], b: [0.6, 1.7, 0], radius: 0.05 },
  { a: [-0.1, 0.9, 0], b: [-0.12, 0.1, 0], radius: 0.08 }, { a: [0.1, 0.9, 0], b: [0.12, 0.1, 0], radius: 0.08 },
];
const BALL: ZapArcPart[] = [ball([3, 1.45, -2], 0.6)];
/** Distance from `q` to a part's axis segment. */
const axisDist = (q: readonly number[], p: ZapArcPart) => {
  const ab = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]], aq = [q[0]! - p.a[0], q[1]! - p.a[1], q[2]! - p.a[2]];
  const l2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const u = l2 > 0 ? Math.min(1, Math.max(0, (aq[0]! * ab[0]! + aq[1]! * ab[1]! + aq[2]! * ab[2]!) / l2)) : 0;
  return Math.hypot(aq[0]! - ab[0]! * u, aq[1]! - ab[1]! * u, aq[2]! - ab[2]! * u);
};

describe('the zap crawl arcs', () => {
  it('strikes the asked number of arcs, each ARC_POINTS long, the same for the same seed', () => {
    const a = strikeZapArcs(11, MAN, 7);
    expect(a.length).toBe(7);
    for (const arc of a) expect(arc.length).toBe(ARC_POINTS);
    expect(strikeZapArcs(11, MAN, 7)).toEqual(a);
    expect(strikeZapArcs(12, MAN, 7)).not.toEqual(a);
  });

  it('strikes nothing with no parts or no count', () => {
    expect(strikeZapArcs(1, [], 5)).toEqual([]);
    expect(strikeZapArcs(1, MAN, 0)).toEqual([]);
  });

  it('every arc starts within its seat of a part, and stays near the body', () => {
    for (let seed = 0; seed < 40; seed++) for (const arc of strikeZapArcs(seed, MAN, 6)) {
      const p0 = arc[0]!;
      expect(MAN.some(p => axisDist(p0, p) <= p.radius * ZAP_ARCS.seat + 1e-6)).toBe(true);
      for (const q of arc) {
        const near = Math.min(...MAN.map(p => axisDist(q, p) - p.radius));
        expect(near).toBeLessThan(ZAP_ARCS.leapM[1] + 0.6);
      }
    }
  });

  it('a one-part body (a ball) gets crawls and leaps, never a bridge to nowhere', () => {
    let leaps = 0, total = 0;
    for (let seed = 0; seed < 60; seed++) for (const arc of strikeZapArcs(seed, BALL, 4)) {
      total++;
      const end = arc[ARC_POINTS - 1]!, r = Math.hypot(end[0] - 3, end[1] - 1.45, end[2] + 2);
      for (const q of arc) expect(Number.isFinite(q[0] + q[1] + q[2])).toBe(true);
      if (r > 0.6 * (ZAP_ARCS.seat + 0.1)) leaps++;
    }
    expect(leaps).toBeGreaterThan(total * 0.1);
    expect(leaps).toBeLessThan(total * 0.45);
  });

  it('boxes the parts', () => {
    expect(zapPartsBox([])).toBeNull();
    const b = zapPartsBox(BALL)!;
    expect(b.center).toEqual([3, 1.45, -2]);
    b.half.forEach(h => expect(h).toBeCloseTo(0.6, 9));
    const m = zapPartsBox(MAN)!;
    expect(m.half[1]).toBeCloseTo((1.75 - 0.02) / 2, 6);
  });
});
