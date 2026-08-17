import { describe, expect, it } from 'vitest';
import {
  MANIFEST_URL, SHEET_LAYOUTS, clampMean, layoutMean,
  type HandSheetId, type SheetLayout,
} from './hands-sheet';
import { HAND_SHEET_TUNING } from './fpv-view';

const ids: HandSheetId[] = ['grip', 'pinch'];

describe('hand-detail sheet layouts (the procedural fallback)', () => {
  it('has one layout per hand, and the two are different hands', () => {
    expect(Object.keys(SHEET_LAYOUTS).sort()).toEqual(['grip', 'pinch']);
    expect(SHEET_LAYOUTS.grip.strokes).not.toEqual(SHEET_LAYOUTS.pinch.strokes);
  });

  it('keeps every stroke inside the sheet and inside the flesh mask', () => {
    for (const id of ids) {
      const l: SheetLayout = SHEET_LAYOUTS[id];
      for (const v of [l.mass.cx, l.mass.cy, l.mass.rx, l.mass.ry]) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(l.strokes.length).toBeGreaterThanOrEqual(8);
      for (const s of l.strokes) {
        for (const p of [s.from, s.to]) {
          expect(p[0]).toBeGreaterThanOrEqual(0);
          expect(p[0]).toBeLessThanOrEqual(1);
          expect(p[1]).toBeGreaterThanOrEqual(0);
          expect(p[1]).toBeLessThanOrEqual(1);
          // Inside the mask ellipse (generously — round caps may kiss the rim).
          const dx = (p[0] - l.mass.cx) / l.mass.rx;
          const dy = (p[1] - l.mass.cy) / l.mass.ry;
          expect(Math.hypot(dx, dy), `${id} stroke`).toBeLessThan(1.25);
        }
        expect(s.width).toBeGreaterThan(0);
        expect(s.width).toBeLessThan(0.25);
        expect(s.tone).toBeGreaterThanOrEqual(0);
        expect(s.tone).toBeLessThanOrEqual(1);
      }
    }
  });

  it('puts the knuckle/nail highlights high in the sheet, creases dark', () => {
    for (const id of ids) {
      const l = SHEET_LAYOUTS[id];
      // The brightest strokes are HEIGHT peaks: nails and knuckles, which sit
      // toward the knuckle end (+y) of the sheet.
      const brightest = [...l.strokes].sort((a, b) => b.tone - a.tone)[0]!;
      expect(brightest.tone).toBeGreaterThan(0.85);
      expect(brightest.from[1]).toBeGreaterThan(0.6);
      // And the darkest are the inter-finger creases: thin.
      const darkest = [...l.strokes].sort((a, b) => a.tone - b.tone)[0]!;
      expect(darkest.tone).toBeLessThan(0.25);
      expect(darkest.width).toBeLessThan(0.05);
    }
  });

  it('reports a mean the shader can safely divide by', () => {
    for (const id of ids) {
      const m = layoutMean(SHEET_LAYOUTS[id]);
      expect(m).toBeGreaterThan(0.05);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe('clampMean', () => {
  it('guards the divisor — a 0 or a non-number would white out the hands', () => {
    expect(clampMean(0)).toBeGreaterThan(0);
    expect(clampMean(0.779)).toBeCloseTo(0.779, 12);
    expect(clampMean(5)).toBe(1);
    expect(clampMean(-2)).toBeGreaterThan(0);
    expect(clampMean(NaN)).toBe(0.5);
    expect(clampMean(undefined)).toBe(0.5);
    expect(clampMean('x')).toBe(0.5);
  });
});

describe('manifest url', () => {
  it('points at the baked sheets the Blender script writes', () => {
    expect(MANIFEST_URL).toBe('/assets/lab/hand-detail.json');
  });
});

// ——— The staining regression ————————————————————————————————————————————————

describe('hand sheet weights are RELIEF-ONLY', () => {
  it('contributes NOTHING to albedo — a height map is not an albedo map', () => {
    // The owner's round-2 playtest bug: at 0.55 the sheet's dark creases
    // painted onto the flesh ("looks like a bad tattoo") and the right hand
    // went brown, because the march's albedo term is `albedo * (tex.rgb/mean)`.
    // The shader weight is `facing * tex.a * faceCfg.y * (1 - faceGlow)`, so a
    // zero strength makes mix() return albedo EXACTLY: the flesh colour can no
    // longer be touched by the sheet's levels or its mean.
    expect(HAND_SHEET_TUNING.detailStrength).toBe(0);
  });

  it('drives relief — the sheet’s only channel, and the point of having one', () => {
    expect(HAND_SHEET_TUNING.relief).toBeGreaterThan(0);
    // The march rotates its bump into the projection frame as of 94b12ac, so
    // this is a real weight rather than the earlier low workaround. Bounded
    // only against a runaway value; the panel slider tops out at 3.
    expect(HAND_SHEET_TUNING.relief).toBeLessThanOrEqual(3);
    expect(HAND_SHEET_TUNING.relief).toBeGreaterThan(HAND_SHEET_TUNING.detailStrength);
  });

  it('cannot glow: a height map’s bright pixels are near flesh, not emission', () => {
    expect(HAND_SHEET_TUNING.glowThreshold).toBeGreaterThanOrEqual(0.98);
  });
});
