// src/lab/sdf-zombie/webgpu/emergence-field.test.ts
import { describe, it, expect } from 'vitest';
import { paramsAt, DURATION, type EmergenceParams } from './emergence-timeline';
import {
  DESK_Y, EGG, EGG_REST, GLASS, SKIN, SAC_MAX, PICTURE_TABLE_N, eggCentre, eggFront, lipOpening, pictureTable, pictureUV, sacExtent, sacZ, sheetThickness, tearRadius,
} from './emergence-field';

const REST: EmergenceParams = paramsAt(0);
const at = (o: Partial<EmergenceParams>): EmergenceParams => ({ ...REST, ...o });

describe('emergence field', () => {
  it('the sheet is flat at rest and meets the lip at the opening', () => {
    expect(sacZ(REST, 0, 0)).toBeCloseTo(0, 12);
    expect(sacZ(REST, GLASS.hw, 0)).toBeCloseTo(0, 12);
    const p = at({ push: 1 });
    expect(sacZ(p, GLASS.hw * 1.0001, 0)).toBeCloseTo(lipOpening(p).z, 3);   // outside the (unbowed) lip it is the rim height
    expect(sacZ(p, 0, 0)).toBeGreaterThan(0.5);
  });

  it('the apex reaches most of a metre at full push (owner: "most of a metre is fine")', () => {
    expect(SAC_MAX).toBeGreaterThan(0.7);
    expect(SAC_MAX).toBeLessThan(0.8);
    expect(sacZ(at({ push: 1 }), 0, 0)).toBeGreaterThanOrEqual(SAC_MAX - 0.02);
  });

  it('the sac grows monotonically with push, at every sampled point', () => {
    for (const [x, y] of [[0, 0], [0.08, 0.03], [0.15, -0.05], [0, 0.12]] as const) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const z = sacZ(at({ push: i / 20 }), x, y); expect(z, `x=${x} y=${y} push=${i / 20}`).toBeGreaterThanOrEqual(prev - 1e-9); prev = z; }
    }
  });

  it('the sac wraps the egg: at every point inside the egg\'s silhouette the sheet is in front of the egg by at least the skin', () => {
    for (let i = 0; i <= 20; i++) {
      const p = at({ push: i / 20, lipBow: Math.min(1, (i / 20) * 1.5) });
      const c = eggCentre(p);
      for (let ix = -4; ix <= 4; ix++) for (let iy = -4; iy <= 4; iy++) {
        const x = (ix / 4) * EGG.rx * 0.95, y = c[1] + (iy / 4) * EGG.ry * 0.95;
        const f = eggFront(p, x, y);
        if (f === null) continue;
        expect(sacZ(p, x, y), `push=${i / 20} x=${x.toFixed(3)} y=${y.toFixed(3)}`).toBeGreaterThanOrEqual(f + SKIN - 1e-9);
      }
    }
  });

  it('the egg is bigger than the glass, so the lip has to give', () => {
    expect(2 * EGG.ry).toBeGreaterThan(2 * GLASS.hh);
    expect(lipOpening(at({ lipBow: 1 })).hh).toBeGreaterThanOrEqual(EGG.ry * 0.99);
    expect(lipOpening(REST).hh).toBe(GLASS.hh);
  });

  it('the egg slumps from the sac to the desk and stays there', () => {
    const inSac = eggCentre(at({ push: 1, slump: 0 }));
    const onDesk = eggCentre(at({ push: 1, slump: 1 }));
    expect(onDesk[1]).toBeLessThan(inSac[1]);
    expect(onDesk[2]).toBeLessThan(inSac[2]);
    expect(eggCentre(paramsAt(DURATION))).toEqual(onDesk);
  });

  it('the slumped egg rests on the desk top, in front of the glass and short of the goblin\'s knees', () => {
    expect(EGG_REST[1] - EGG.ry).toBeCloseTo(DESK_Y, 12);
    expect(EGG_REST[2] - EGG.rz).toBeGreaterThan(0);          // its back is in front of the glass plane
    expect(EGG_REST[2] + EGG.rz).toBeLessThan(0.36 + 1e-9);    // its front is on the lab's desk (front edge 0.36; the knees at about 0.38)
  });

  it('the sheet thins as it stretches and is never gone', () => {
    const t0 = sheetThickness(at({ push: 0 }), 0, 0);
    const t1 = sheetThickness(at({ push: 1, thin: 1 }), 0, 0);
    expect(t1).toBeLessThan(t0);
    expect(t1).toBeGreaterThan(0.0005);
  });

  it('the tear opens from the tip and never reverses, and is zero when closed', () => {
    for (const th of [0, 0.7, 1.9, 3.1, 5]) {
      expect(tearRadius(at({ tear: 0 }), th)).toBe(0);
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const r = tearRadius(at({ tear: i / 20 }), th); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
      expect(prev).toBeGreaterThan(0.1);
    }
  });

  it('the picture mapping is the identity at rest, runs 0..1 monotonically, and stretches when pushed', () => {
    const rest = pictureTable(REST);
    expect(rest).toHaveLength(PICTURE_TABLE_N);
    for (let i = 0; i < PICTURE_TABLE_N; i++) expect(rest[i]!).toBeCloseTo(i / (PICTURE_TABLE_N - 1), 9);
    const pushed = pictureTable(at({ push: 1 }));
    expect(pushed[0]).toBe(0);
    expect(pushed[PICTURE_TABLE_N - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < PICTURE_TABLE_N; i++) expect(pushed[i]!).toBeGreaterThan(pushed[i - 1]!);
    // the apex stretches: the picture's centre covers more sheet, so the first steps cover LESS picture than at rest
    expect(pushed[4]!).toBeLessThan(rest[4]!);
    expect(pictureUV(REST, 0.1, -0.05)).toEqual([0.1 / GLASS.hw, -0.05 / GLASS.hh]);
  });
});
