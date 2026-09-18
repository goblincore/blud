import { describe, it, expect } from 'vitest';
import { placeFlameCards, cardFrame, cardCellUv, FLAME_CARD_SLOTS } from './flame-cards';

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

  it('insets cell UVs so a frame cannot sample its neighbour', () => {
    const { u0, u1 } = cardCellUv(0, 8, 256);   // frame 0 of 8, 256px atlas
    const { u0: n0 } = cardCellUv(1, 8, 256);
    expect(u0).toBeGreaterThan(0);              // inset from the left edge
    expect(u1).toBeLessThan(1 / 8);             // inset from its own right edge
    expect(u1).toBeLessThan(n0);                // a gap exists between cells
  });

  it('skips the atlas gutter so the padding is never sampled', () => {
    // 8 frames of 30 content px with a 2 px gutter: atlas = 8 * 34 = 272.
    const a = cardCellUv(0, 8, 272, 2, 30);
    const b = cardCellUv(1, 8, 272, 2, 30);
    expect(a.u0).toBeGreaterThan(2 / 272);      // inside the left gutter
    expect(a.u1).toBeLessThan(32 / 272);        // inside the right gutter
    expect(b.u0).toBeGreaterThan(34 / 272);     // across the 4 px cell gap
    expect(a.u1).toBeLessThan(b.u0);            // and still no overlap
  });
});
