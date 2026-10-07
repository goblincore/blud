import { describe, expect, it } from 'vitest';
import {
  SCULPT_CLASSIC, SCULPT_DEFAULT_VARIANT, SCULPT_FINE_CELL, SCULPT_VARIANTS, SKULL_DEFAULT, SKULL_KINDS,
  resolveSkull, sculptRecipe, sculptVariantOf, type SculptVariant,
} from './sculpt-variant';

describe('the sculpted skull\'s variants', () => {
  it('each variant changes what its name says and nothing else', () => {
    expect([...SCULPT_VARIANTS]).toEqual(['classic', 'shape', 'shape-fine', 'paint', 'full-1cm', 'full']);
    expect(sculptRecipe('classic')).toEqual({ shape: 1, headCell: null, paint: 1 });
    expect(sculptRecipe('shape')).toEqual({ shape: 2, headCell: null, paint: 1 });
    expect(sculptRecipe('shape-fine')).toEqual({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 1 });
    expect(sculptRecipe('paint')).toEqual({ shape: 1, headCell: null, paint: 2 });
    expect(sculptRecipe('full-1cm')).toEqual({ shape: 2, headCell: null, paint: 2 });
    expect(sculptRecipe('full')).toEqual({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 2 });
    expect(SCULPT_FINE_CELL).toBe(0.005);
  });

  it('`classic` is the first sculpt at the cache\'s own cell under the first paint, and frozen', () => {
    expect(sculptRecipe('classic')).toBe(SCULPT_CLASSIC);
    for (const v of SCULPT_VARIANTS) expect(Object.isFrozen(sculptRecipe(v)), v).toBe(true);
  });

  it('a recipe names its variant, and no two variants share a recipe', () => {
    for (const v of SCULPT_VARIANTS) {
      expect(sculptVariantOf(sculptRecipe(v))).toBe(v);
      expect(sculptVariantOf({ ...sculptRecipe(v) })).toBe(v);
    }
    expect(sculptVariantOf({ shape: 1, headCell: SCULPT_FINE_CELL, paint: 2 })).toBeNull();
    expect(sculptVariantOf({ shape: 2, headCell: 0.0025, paint: 2 })).toBeNull();
  });
});

describe('resolveSkull: the skull a page\'s query asks for', () => {
  const FULL = { skull: 'sculpt', variant: 'full', recipe: sculptRecipe('full') } as const;
  const ANATOMICAL = { skull: 'anatomical', variant: 'classic', recipe: SCULPT_CLASSIC } as const;

  it('the defaults: the sculpted skull, `full`', () => {
    expect(SKULL_DEFAULT).toBe('sculpt');
    expect(SCULPT_DEFAULT_VARIANT).toBe('full');
    expect([...SKULL_KINDS]).toEqual(['sculpt', 'anatomical']);
  });

  it.each(['', '?', '?level=night-train', '?seed=1&frozen=1&vhs=off&loader=0', '?spawn=soldier&skeleton=mesh'])('no skull parameter (%j): the sculpted skull, full, and nothing to say', (search) => {
    expect(resolveSkull(search)).toEqual({ ...FULL, notes: [] });
    expect(resolveSkull(search).recipe).toBe(sculptRecipe('full'));
  });

  it('?skull=sculpt with no ?sculpt= is the sculpted skull\'s default look: full', () => {
    for (const search of ['?skull=sculpt', '?seed=1&skull=sculpt&vhs=off', '?skull=sculpt&sculpt=']) {
      expect(resolveSkull(search), search).toEqual({ ...FULL, notes: [] });
    }
  });

  it('?skull=anatomical is the anatomical skull, its other bones under `classic`', () => {
    for (const search of ['?skull=anatomical', '?level=night-train&skull=anatomical', '?skull=anatomical&sculpt=']) {
      const choice = resolveSkull(search);
      expect(choice, search).toEqual({ ...ANATOMICAL, notes: [] });
      expect(choice.recipe).toBe(SCULPT_CLASSIC);
    }
  });

  it.each(SCULPT_VARIANTS)('?sculpt=%s is the sculpted skull in that variant', (variant) => {
    const want = { skull: 'sculpt', variant, recipe: sculptRecipe(variant), notes: [] };
    for (const search of [`?sculpt=${variant}`, `?skull=sculpt&sculpt=${variant}`, `?seed=1&sculpt=${variant}&vhs=off`]) {
      const choice = resolveSkull(search);
      expect(choice, search).toEqual(want);
      expect(choice.recipe).toBe(sculptRecipe(variant));
    }
  });

  it.each(SCULPT_VARIANTS)('?sculpt=%s overrules ?skull=anatomical, and says so', (variant) => {
    for (const search of [`?skull=anatomical&sculpt=${variant}`, `?sculpt=${variant}&skull=anatomical`]) {
      const choice = resolveSkull(search);
      expect({ skull: choice.skull, variant: choice.variant, recipe: choice.recipe }, search).toEqual({ skull: 'sculpt', variant, recipe: sculptRecipe(variant) });
      expect(choice.notes).toHaveLength(1);
      expect(choice.notes[0]).toContain('?skull=anatomical is overruled');
      expect(choice.notes[0]).toContain(`?sculpt=${variant}`);
    }
  });

  it('the first look is the variant `classic`', () => {
    expect(resolveSkull('?sculpt=classic')).toEqual({ skull: 'sculpt', variant: 'classic', recipe: SCULPT_CLASSIC, notes: [] });
  });

  it('?skull=procedural is an older name for ?skull=sculpt', () => {
    expect(resolveSkull('?skull=procedural')).toEqual({ ...FULL, notes: [] });
    expect(resolveSkull('?skull=procedural&sculpt=paint')).toEqual({ skull: 'sculpt', variant: 'paint', recipe: sculptRecipe('paint'), notes: [] });
  });

  it.each(['plates', 'Anatomical', 'ANATOMICAL', 'sculpted', 'full', 'classic', '1', 'true', 'none'])('an unknown ?skull=%s is passed over: the default, with one note naming it', (value) => {
    const choice = resolveSkull(`?skull=${value}`);
    expect({ skull: choice.skull, variant: choice.variant, recipe: choice.recipe }).toEqual(FULL);
    expect(choice.notes).toHaveLength(1);
    expect(choice.notes[0]).toContain(`?skull=${value}`);
    expect(choice.notes[0]).toContain('sculpt, anatomical');
  });

  it.each(['bake', 'Full', 'FULL', 'shape_fine', 'full-5mm', '1', 'anatomical', 'sculpt', 'default'])('an unknown ?sculpt=%s is passed over: the skull ?skull= chooses, with one note naming it', (value) => {
    const alone = resolveSkull(`?sculpt=${value}`);
    expect({ skull: alone.skull, variant: alone.variant, recipe: alone.recipe }).toEqual(FULL);
    expect(alone.notes).toHaveLength(1);
    expect(alone.notes[0]).toContain(`?sculpt=${value}`);
    for (const v of SCULPT_VARIANTS) expect(alone.notes[0]).toContain(v);

    const sculpt = resolveSkull(`?skull=sculpt&sculpt=${value}`);
    expect({ skull: sculpt.skull, variant: sculpt.variant }).toEqual({ skull: 'sculpt', variant: 'full' });
    expect(sculpt.notes).toHaveLength(1);

    // An unknown variant does not overrule the anatomical skull.
    const anatomical = resolveSkull(`?skull=anatomical&sculpt=${value}`);
    expect({ skull: anatomical.skull, variant: anatomical.variant, recipe: anatomical.recipe }).toEqual(ANATOMICAL);
    expect(anatomical.notes).toHaveLength(1);
    expect(anatomical.notes[0]).toContain(`?sculpt=${value}`);
  });

  it('two unknown values: the default, and a note for each', () => {
    const choice = resolveSkull('?skull=bone&sculpt=shiny');
    expect({ skull: choice.skull, variant: choice.variant, recipe: choice.recipe }).toEqual(FULL);
    expect(choice.notes).toHaveLength(2);
    expect(choice.notes.some(n => n.includes('?sculpt=shiny'))).toBe(true);
    expect(choice.notes.some(n => n.includes('?skull=bone'))).toBe(true);
  });

  it('an unknown ?skull= beside a known ?sculpt=: that variant, and a note for the skull', () => {
    const choice = resolveSkull('?skull=bone&sculpt=shape');
    expect({ skull: choice.skull, variant: choice.variant, recipe: choice.recipe }).toEqual({ skull: 'sculpt', variant: 'shape', recipe: sculptRecipe('shape') });
    expect(choice.notes).toEqual([expect.stringContaining('?skull=bone')]);
  });

  it('a repeated parameter is read once: its first value', () => {
    expect(resolveSkull('?skull=anatomical&skull=sculpt').skull).toBe('anatomical');
    expect(resolveSkull('?sculpt=paint&sculpt=shape').variant).toBe('paint');
  });

  it('every combination of a skull value and a variant value resolves to one of the two skulls and a variant\'s own recipe', () => {
    const skulls = [null, '', 'sculpt', 'anatomical', 'procedural', 'nonsense'];
    const sculpts: (string | null)[] = [null, '', ...SCULPT_VARIANTS, 'nonsense'];
    for (const skull of skulls) for (const sculpt of sculpts) {
      const search = '?' + [skull === null ? '' : `skull=${skull}`, sculpt === null ? '' : `sculpt=${sculpt}`].filter(Boolean).join('&');
      const choice = resolveSkull(search);
      const known = (SCULPT_VARIANTS as readonly string[]).includes(sculpt ?? '');
      const wantSkull = skull === 'anatomical' && !known ? 'anatomical' : 'sculpt';
      const wantVariant: SculptVariant = known ? (sculpt as SculptVariant) : wantSkull === 'anatomical' ? 'classic' : 'full';
      expect({ skull: choice.skull, variant: choice.variant }, search).toEqual({ skull: wantSkull, variant: wantVariant });
      expect(choice.recipe, search).toBe(sculptRecipe(wantVariant));
      const wantNotes = (skull === 'nonsense' ? 1 : 0) + (sculpt === 'nonsense' ? 1 : 0) + (skull === 'anatomical' && known ? 1 : 0);
      expect(choice.notes, search).toHaveLength(wantNotes);
    }
  });
});
