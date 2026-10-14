// src/lab/sdf-zombie/expression.test.ts
import { describe, it, expect } from 'vitest';
import {
  REST_CHANNELS, expressionAt, blinkLid, withBlink, actuate, sheetKey,
  type ExpressionClip, type ExpressionTuning,
} from './expression';
import { DEFAULT_SHEET } from './blob-face-sheet';

const TUNING: ExpressionTuning = {
  maxGape: 0.6, smileCurve: 1, smileWiden: 0.25, curlCurve: 0.8, curlNarrow: 0.25,
  browAngle: 10, browHeavy: 0.2, gapeMouthOpen: -0.02, smileMouthOpen: 0.01,
};
const GRIN: ExpressionClip = { name: 'grin', keys: [{ t: 0, channels: {} }, { t: 1, channels: { gape: 0.4, smile: 1 } }] };

describe('expressionAt', () => {
  it('holds the first key before the clip and the last key after it', () => {
    expect(expressionAt(GRIN, -5)).toEqual(REST_CHANNELS);
    expect(expressionAt(GRIN, 9)).toEqual({ ...REST_CHANNELS, gape: 0.4, smile: 1 });
  });

  it('a channel a key does not mention takes its rest value 0', () => {
    expect(expressionAt(GRIN, 0.5).browDown).toBe(0);
    expect(expressionAt(GRIN, 0).gape).toBe(0);
  });

  it('interpolates linearly per channel, and smoothly when the key says so', () => {
    expect(expressionAt(GRIN, 0.5).gape).toBeCloseTo(0.2, 9);
    const smooth: ExpressionClip = { name: 's', keys: [{ t: 0, channels: {} }, { t: 1, channels: { gape: 1 }, ease: 'smooth' }] };
    expect(expressionAt(smooth, 0.25).gape).toBeCloseTo(0.15625, 9); // smoothstep(0.25)
    expect(expressionAt(smooth, 0.5).gape).toBeCloseTo(0.5, 9);
  });

  it('a one-key clip is a held expression', () => {
    const held: ExpressionClip = { name: 'h', keys: [{ t: 0, channels: { lipCurl: 0.7 } }] };
    expect(expressionAt(held, 123).lipCurl).toBe(0.7);
  });

  it('throws on an empty clip', () => {
    expect(() => expressionAt({ name: 'e', keys: [] }, 0)).toThrow(/no keys/);
  });
});

describe('blink', () => {
  it('closes then opens over its duration, and is 0 outside it', () => {
    expect(blinkLid(0.9, 1, 0.2)).toBe(0);
    expect(blinkLid(1.0, 1, 0.2)).toBe(0);
    expect(blinkLid(1.08, 1, 0.2)).toBeCloseTo(1, 9); // the 40% mark: fully shut
    expect(blinkLid(1.14, 1, 0.2)).toBeGreaterThan(0);
    expect(blinkLid(1.14, 1, 0.2)).toBeLessThan(1);
    expect(blinkLid(1.2, 1, 0.2)).toBeCloseTo(0, 9); // float: (1.2 - 1) / 0.2 is 0.9999999999999996, just inside
  });

  it('composes with any base expression: the lid is the larger of the two', () => {
    expect(withBlink({ ...REST_CHANNELS, lid: 0.3 }, 0.8).lid).toBe(0.8);
    expect(withBlink({ ...REST_CHANNELS, lid: 0.9 }, 0.2).lid).toBe(0.9);
    expect(withBlink({ ...REST_CHANNELS, gape: 0.5 }, 1).gape).toBe(0.5);
  });
});

describe('actuate', () => {
  it('rest channels give the authored sheet and no gape', () => {
    const a = actuate(REST_CHANNELS, DEFAULT_SHEET, TUNING);
    expect(a.jawGape).toBe(0);
    expect(a.sheet).toEqual({ ...DEFAULT_SHEET, eyeLid: 0 });
    expect(sheetKey(a.sheet)).toBe(sheetKey(DEFAULT_SHEET));
  });

  it('gape scales to radians and is clamped to 0..1 of the tuning', () => {
    expect(actuate({ ...REST_CHANNELS, gape: 0.5 }, DEFAULT_SHEET, TUNING).jawGape).toBeCloseTo(0.3, 9);
    expect(actuate({ ...REST_CHANNELS, gape: 7 }, DEFAULT_SHEET, TUNING).jawGape).toBeCloseTo(0.6, 9);
    expect(actuate({ ...REST_CHANNELS, gape: -1 }, DEFAULT_SHEET, TUNING).jawGape).toBe(0);
  });

  it('smile pulls the mouth arc toward a smile (NEGATIVE mouthCurve in the sheet) and widens it', () => {
    const s = actuate({ ...REST_CHANNELS, smile: 1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(s.mouthCurve).toBeLessThan(DEFAULT_SHEET.mouthCurve); // sheet sign: positive is a frown
    expect(s.mouthWidth).toBeGreaterThan(DEFAULT_SHEET.mouthWidth);
  });

  it('a negative smile and lipCurl frown the arc and narrow the mouth', () => {
    const f = actuate({ ...REST_CHANNELS, smile: -1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(f.mouthCurve).toBeGreaterThan(DEFAULT_SHEET.mouthCurve);
    const c = actuate({ ...REST_CHANNELS, lipCurl: 1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(c.mouthCurve).toBeGreaterThan(DEFAULT_SHEET.mouthCurve);
    expect(c.mouthWidth).toBeLessThan(DEFAULT_SHEET.mouthWidth);
  });

  it('browDown steepens the brow (positive angle is a scowl) and darkens it, within bounds', () => {
    const b = actuate({ ...REST_CHANNELS, browDown: 1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(b.browAngle).toBeCloseTo(DEFAULT_SHEET.browAngle + 10, 9);
    expect(b.browHeavy).toBeGreaterThan(DEFAULT_SHEET.browHeavy);
    expect(actuate({ ...REST_CHANNELS, browDown: 99 }, DEFAULT_SHEET, TUNING).sheet.browHeavy).toBeLessThanOrEqual(1.2);
  });

  it('lid writes eyeLid, never below the authored one', () => {
    expect(actuate({ ...REST_CHANNELS, lid: 0.6 }, DEFAULT_SHEET, TUNING).sheet.eyeLid).toBeCloseTo(0.6, 9);
  });

  it('never touches what it does not animate', () => {
    const s = actuate({ ...REST_CHANNELS, smile: 1, gape: 1, browDown: 1, lid: 1 }, DEFAULT_SHEET, TUNING).sheet;
    for (const k of ['eyeGap', 'eyeSize', 'grain', 'seed', 'nostril', 'jawShade'] as const) expect(s[k]).toBe(DEFAULT_SHEET[k]);
  });
});

describe('sheetKey', () => {
  it('changes when an animated param moves by more than the quantum and not for float dust', () => {
    const a = sheetKey(DEFAULT_SHEET);
    expect(sheetKey({ ...DEFAULT_SHEET, mouthCurve: DEFAULT_SHEET.mouthCurve + 1e-6 })).toBe(a);
    expect(sheetKey({ ...DEFAULT_SHEET, mouthCurve: DEFAULT_SHEET.mouthCurve + 0.02 })).not.toBe(a);
    expect(sheetKey({ ...DEFAULT_SHEET, eyeLid: 0.5 })).not.toBe(a);
  });
});
