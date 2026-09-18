// The panel's anti-drift contract, same as dynamite-panel.test.ts: a slider key
// the page setter ignores looks applied and is not. Both sides are pinned here.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { FLAME_KEYS, copyText } from './flame-panel';
import { BURN_TUNING, resolveBurnTuning } from './burn-profiles';

describe('flame panel', () => {
  it('every slider key is a real BurnTuning field', () => {
    const fields = new Set(Object.keys(BURN_TUNING));
    for (const k of FLAME_KEYS) {
      expect(fields.has(k.key), `slider "${k.key}" is not a BurnTuning field`).toBe(true);
    }
  });

  it('covers every tunable the spec asks to tune', () => {
    const keys = new Set(FLAME_KEYS.map(k => k.key));
    for (const field of Object.keys(BURN_TUNING)) {
      expect(keys.has(field as never), `BurnTuning.${field} has no slider`).toBe(true);
    }
  });

  it('slider ranges are the clamp bounds themselves, at both rails', () => {
    for (const k of FLAME_KEYS) {
      const lo = resolveBurnTuning({ [k.key]: k.min } as never);
      const hi = resolveBurnTuning({ [k.key]: k.max } as never);
      expect(lo[k.key], `${k.key} min`).toBeCloseTo(k.min, 6);
      expect(hi[k.key], `${k.key} max`).toBeCloseTo(k.max, 6);
    }
  });

  it('copies a setter call the game will understand', () => {
    const text = copyText(BURN_TUNING);
    expect(text.startsWith('__sdfGame.setBurnTuning({')).toBe(true);
    expect(text).toContain(`fireGain: ${BURN_TUNING.fireGain}`);
    expect(text.endsWith('})')).toBe(true);
  });
});
