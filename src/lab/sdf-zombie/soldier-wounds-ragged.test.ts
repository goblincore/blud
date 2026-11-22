import { afterEach, describe, expect, it } from 'vitest';
import type { Wound } from './damage';
import { RAGGED_AMOUNT, setRaggedCraters, soldierVisualWounds } from './soldier-wounds';

const wound = (type: Wound['type'], x = 0): Wound => ({
  primIdx: 3, local: [x, 0.1, 0.05], radius: 0.08, type, ageSec: 0, carveN: [0, 0, -1],
} as Wound);

describe('soldier ragged craters (option 3)', () => {
  afterEach(() => setRaggedCraters(true));

  it('ships ragged; the lobe path (off) uploads one wound as four rows', () => {
    setRaggedCraters(false);
    expect(soldierVisualWounds([wound('pellet')])).toHaveLength(4);
  });

  it('ragged (ship): one row per wound, carrying the ragged amount; burns stay round', () => {
    const rows = soldierVisualWounds([wound('pellet'), wound('blast', 0.2), wound('burn', 0.4)]);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.ragged).toBe(RAGGED_AMOUNT);
    expect(rows[1]!.ragged).toBe(RAGGED_AMOUNT);
    expect(rows[2]!.ragged).toBeUndefined();
  });

  it('keeps every ring wound up to the cap it is given (the crater grid holds 128, not 32)', () => {
    // 2026-11-22: the soldier's render list sliced to the newest MAX_WOUNDS (32) while the crater grid's ring holds
    // 128, so two pellet volleys pushed the earlier slug craters out of the drawn rows and they vanished.
    const ring = Array.from({ length: 40 }, (_, i) => wound('pellet', i * 0.01));
    const rows = soldierVisualWounds(ring, 128);
    expect(rows).toHaveLength(40);
    expect(rows[0]!.local).toEqual(ring[0]!.local);
    expect(soldierVisualWounds(ring)).toHaveLength(32);   // without the grid the cap is still MAX_WOUNDS
  });

  it('keeps the amount inside the type texel fraction (< 0.5)', () => {
    expect(RAGGED_AMOUNT).toBeGreaterThan(0);
    expect(RAGGED_AMOUNT).toBeLessThan(0.5);
  });
});
