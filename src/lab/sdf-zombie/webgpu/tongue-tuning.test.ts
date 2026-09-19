import { describe, it, expect } from 'vitest';
import {
  TONGUE_TECHNIQUES, TONGUE_TUNING, TONGUE_BOUNDS, resolveTongueTuning, isTongueTechnique,
} from './tongue-tuning';

describe('tongue tuning', () => {
  it('offers exactly the three techniques plus off', () => {
    expect(TONGUE_TECHNIQUES).toEqual(['none', 'screen', 'cards', 'volume']);
    expect(isTongueTechnique('cards')).toBe(true);
    expect(isTongueTechnique('sparkles')).toBe(false);
  });

  it('resolves to defaults and clamps every field at both rails', () => {
    expect(resolveTongueTuning()).toEqual(TONGUE_TUNING);
    for (const key of Object.keys(TONGUE_TUNING) as (keyof typeof TONGUE_TUNING)[]) {
      const [min, max] = TONGUE_BOUNDS[key];
      expect(resolveTongueTuning({ [key]: min - 1 })[key], `${key} min`).toBe(min);
      expect(resolveTongueTuning({ [key]: max + 1 })[key], `${key} max`).toBe(max);
      expect(resolveTongueTuning({ [key]: Number.NaN })[key], `${key} NaN`).toBe(TONGUE_TUNING[key]);
    }
  });
});
