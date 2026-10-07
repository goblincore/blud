import { describe, expect, it } from 'vitest';
import { SCULPT_DEFAULT, SCULPT_FINE_CELL, SCULPT_VARIANTS, resolveSculptVariant, sculptRecipe } from './sculpt-variant';

describe('the sculpted skull\'s variants', () => {
  it('reads ?sculpt= and nothing else', () => {
    for (const v of SCULPT_VARIANTS) {
      expect(resolveSculptVariant(`?sculpt=${v}`)).toBe(v);
      expect(resolveSculptVariant(`?skull=anatomical&seed=1&sculpt=${v}&vhs=off`)).toBe(v);
    }
    for (const search of ['', '?skull=sculpt', '?sculpt=', '?sculpt=1', '?sculpt=Shape', '?sculpt=bake', '?skull=shape']) {
      expect(resolveSculptVariant(search), search).toBeNull();
    }
  });

  it('no variant is the first sculpt at the cache\'s own cell under the first paint', () => {
    expect(sculptRecipe(null)).toBe(SCULPT_DEFAULT);
    expect(SCULPT_DEFAULT).toEqual({ shape: 1, headCell: null, paint: 1 });
    expect(Object.isFrozen(SCULPT_DEFAULT)).toBe(true);
  });

  it('each variant changes what its name says and nothing else', () => {
    expect(sculptRecipe('shape')).toEqual({ shape: 2, headCell: null, paint: 1 });
    expect(sculptRecipe('shape-fine')).toEqual({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 1 });
    expect(sculptRecipe('paint')).toEqual({ shape: 1, headCell: null, paint: 2 });
    expect(sculptRecipe('full')).toEqual({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 2 });
    expect(SCULPT_FINE_CELL).toBe(0.005);
  });
});
