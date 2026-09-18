import { describe, it, expect } from 'vitest';
import { placeFlameCards, cardFrame, FLAME_CARD_SLOTS } from './flame-cards';

describe('flame cards', () => {
  it('places cards on the body, more of them as burn rises', () => {
    const few = placeFlameCards(0.3, 1234);
    const many = placeFlameCards(1, 1234);
    expect(few.length).toBeLessThan(many.length);
    expect(many.length).toBeLessThanOrEqual(FLAME_CARD_SLOTS.length);
    expect(placeFlameCards(0, 1234)).toEqual([]);
  });

  it('is deterministic for a seed and varied across cards', () => {
    expect(placeFlameCards(1, 7)).toEqual(placeFlameCards(1, 7));
    const a = placeFlameCards(1, 7);
    expect(new Set(a.map(c => c.phase)).size).toBeGreaterThan(1);
  });

  it('advances the flipbook and wraps', () => {
    expect(cardFrame(0, 0, 8, 15)).toBe(0);
    expect(cardFrame(1 / 15, 0, 8, 15)).toBe(1);
    expect(cardFrame(8 / 15, 0, 8, 15)).toBe(0);
  });
});
