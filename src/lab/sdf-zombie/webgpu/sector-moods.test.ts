import { describe, expect, it } from 'vitest';
import type { LevelDef } from './level-def';
import { NEUTRAL_FILL, stripMoods } from './sector-moods';

describe('stripMoods', () => {
  it('clears sector tints and neutralises fill lights, leaving fire lights alone', () => {
    const def = { sectors: { sectors: [{ tint: [1, 0, 0] }, {}] },
      rooms: [{ accents: [{ fixture: 'none', color: [1, 0, 0] }, { fixture: 'none', mood: 'fire', color: [1, 0.3, 0] }, { fixture: 'tube', color: [0, 1, 0] }] }] } as unknown as LevelDef;
    stripMoods(def);
    expect(def.sectors!.sectors[0]!.tint).toBeUndefined();
    expect(def.rooms[0]!.accents[0]!.color).toEqual([...NEUTRAL_FILL]);
    expect(def.rooms[0]!.accents[1]!.color).toEqual([1, 0.3, 0]);
    expect(def.rooms[0]!.accents[2]!.color).toEqual([0, 1, 0]);
  });
});
