import { describe, expect, it } from 'vitest';
import type { Wound } from './damage';
import { MELT_TUNING, MELT_TUNING_BODY, applyMelt, meltInitBody, stepMelt } from './melt';
import { MELT_WOUND_CLOSE, meltWoundPoint, meltWoundRows } from './melt-wounds';
import type { Primitive, Vec3 } from './types';

const prim = (a: Vec3, b: Vec3, radius = 0.1): Primitive => ({
  op: 'add', shape: 'capsule', a, b, radius, scale: [1, 1, 1], blendK: 0.05, limb: 'torso',
} as unknown as Primitive);

const wound = (primIdx: number, radius = 0.06): Wound => ({
  primIdx, local: [0, 0.05, 0.1], radius, type: 'blast', ageSec: 0, carveN: [0, 0, -1],
} as Wound);

describe('craters through a melt (melt-wounds.ts)', () => {
  it('keeps a crater whole before its prim melts, and closes it by MELT_WOUND_CLOSE of the prim\'s own melt', () => {
    const prims = [prim([0, 0.2, 0], [0, 0.6, 0]), prim([0, 1.2, 0], [0, 1.6, 0])];
    const ws = [wound(0), wound(1)];
    let s = meltInitBody(prims, 0, MELT_TUNING);
    expect(meltWoundRows(ws, s)).toEqual(ws);                       // t = 0: untouched
    // Feet first: the low prim's crater shrinks (and then goes) while the high one is still whole.
    let sawLowShrunk = false;
    for (let i = 0; i < 400 && s.t < 1; i++) {
      s = stepMelt(s, 1 / 120);
      const rows = meltWoundRows(ws, s);
      const low = rows.find(w => w.primIdx === 0), high = rows.find(w => w.primIdx === 1);
      if (low && low.radius < ws[0]!.radius * 0.9 && high?.radius === ws[1]!.radius) sawLowShrunk = true;
      for (const w of rows) {
        expect(w.radius).toBeLessThanOrEqual(ws[0]!.radius);
        expect(w.radius).toBeGreaterThan(0);
      }
    }
    expect(sawLowShrunk).toBe(true);
    expect(meltWoundRows(ws, s)).toEqual([]);                        // pooled: every crater has closed
    expect(MELT_WOUND_CLOSE).toBeGreaterThan(0);
    expect(MELT_WOUND_CLOSE).toBeLessThan(1);
  });

  it('never mutates the wounds it is given', () => {
    const prims = [prim([0, 0.2, 0], [0, 0.6, 0])];
    const ws = [wound(0)];
    const before = JSON.stringify(ws);
    let s = meltInitBody(prims, 0, MELT_TUNING);
    for (let i = 0; i < 40; i++) s = stepMelt(s, 1 / 60);
    meltWoundRows(ws, s);
    expect(JSON.stringify(ws)).toBe(before);
  });

  it('carries a point on the flesh onto the melted prim: same place along it, the offset scaled with its section', () => {
    const from = prim([0, 1, 0], [0, 2, 0], 0.1);
    // Halfway along, 0.1 m out in x (on the surface).
    const v: Vec3 = [0.1, 1.5, 0];
    // Moved down and fattened 2x across.
    const to: Primitive = { ...from, a: [1, 0, 0], b: [1, 0.5, 0], radius: 0.2 };
    const p = meltWoundPoint(v, from, to);
    expect(p[0]).toBeCloseTo(1.2, 6);
    expect(p[1]).toBeCloseTo(0.25, 6);
    expect(p[2]).toBeCloseTo(0, 6);
    // An unmelted prim maps a point onto itself.
    const q = meltWoundPoint(v, from, from);
    expect(q).toEqual(v.map(c => expect.closeTo(c, 9)));
  });

  it('follows the real applyMelt: a surface point stays near the melted prim\'s surface', () => {
    const prims = [prim([0, 0.3, 0], [0, 1.1, 0], 0.12)];
    let s = meltInitBody(prims, 0, MELT_TUNING);
    for (let i = 0; i < 50; i++) s = stepMelt(s, 1 / 60);
    const melted = applyMelt(prims, s, MELT_TUNING_BODY)[0]!;
    const v: Vec3 = [0.12, 0.7, 0];
    const p = meltWoundPoint(v, prims[0]!, melted);
    // Distance from the melted capsule's axis, against its x section.
    const ab: Vec3 = [melted.b[0] - melted.a[0], melted.b[1] - melted.a[1], melted.b[2] - melted.a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = Math.max(0, Math.min(1, ((p[0] - melted.a[0]) * ab[0] + (p[1] - melted.a[1]) * ab[1] + (p[2] - melted.a[2]) * ab[2]) / (l2 || 1)));
    const c: Vec3 = [melted.a[0] + ab[0] * t, melted.a[1] + ab[1] * t, melted.a[2] + ab[2] * t];
    const r = Math.hypot(p[0] - c[0], p[2] - c[2]);
    expect(r).toBeCloseTo(melted.radius * melted.scale[0], 2);
  });
});
