import { describe, it, expect } from 'vitest';
import {
  placeFlameCards, cardFrame, cardCellUv, cardCurlOffset, cardStandoff, cardAnchorDrop,
  FLAME_CARD_SLOTS,
} from './flame-cards';
import { buildCurlVolume } from './curl-volume';

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

  it('pushes cards out past a kit that covers the limb', () => {
    const bare = cardStandoff('shin', { kitRadius: 0 });
    const clad = cardStandoff('shin', { kitRadius: 0.06 });
    expect(clad).toBeGreaterThan(bare);
    expect(clad).toBeGreaterThanOrEqual(0.06);   // outside the armour
  });

  it('drops a kit-covered boot card toward the foot, and only that', () => {
    // The boot slot's fixed offset lands at the boot's TOP (measured: the
    // soldier's leg mean y 0.72 - 0.58 = 0.14); without the drop the flame
    // base stops above the boot and the boot stays green at any standoff.
    expect(cardAnchorDrop('bootL', { kitRadius: 0.14 })).toBeGreaterThan(0);
    expect(cardAnchorDrop('bootL', { kitRadius: 0 })).toBe(0);      // bare: no drop
    expect(cardAnchorDrop('shinL', { kitRadius: 0.14 })).toBe(0);   // shin unchanged
  });

  it('needs a larger standoff for the boot than the shin', () => {
    // The armoured boot's toe reaches further forward than the greave.
    expect(cardStandoff('bootL', { kitRadius: 0.14 }))
      .toBeGreaterThan(cardStandoff('shinL', { kitRadius: 0.14 }));
  });

  it('gives nearby anchors near-identical curl offsets (one shared flow)', () => {
    // The whole point of flameFlow (task 2): cards on one limb must move
    // together, not each flicker alone. A smooth field guarantees it.
    const data = buildCurlVolume(7);
    const a = cardCurlOffset(data, [0, 0.5, 0], 3, 1);
    const b = cardCurlOffset(data, [0.05, 0.5, 0], 3, 1);
    const spread = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(spread).toBeLessThan(0.05);          // 5 cm apart -> almost the same push
  }, 30_000);

  it('is inert at flameFlow 0 and scales with flow', () => {
    const data = buildCurlVolume(7);
    expect(cardCurlOffset(data, [0, 0.5, 0], 3, 0)).toEqual([0, 0, 0]);
    const half = cardCurlOffset(data, [0, 0.5, 0], 3, 0.5);
    const full = cardCurlOffset(data, [0, 0.5, 0], 3, 1);
    expect(Math.hypot(full[0], full[1], full[2]))
      .toBeCloseTo(2 * Math.hypot(half[0], half[1], half[2]), 6);
  }, 30_000);
});
