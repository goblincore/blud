import { describe, expect, it } from 'vitest';
import {
  SCULPT_CLASSIC, SCULPT_DEFAULT_VARIANT, SCULPT_FINE_CELL, SCULPT_VARIANTS, SECOND_PAINT_CHARACTERS, SKULL_DEFAULT, SKULL_KINDS,
  SKULL_FIT_DEFAULT, anatomicalFitOf, resolveSkull, sculptPaintOf, sculptRecipe, sculptVariantOf, type SculptVariant, type SkullChoice,
} from './sculpt-variant';
import { BALL_HEADS, HUMANOIDS } from './skull-cast';
import { SKULL_FIT_NAMES } from './skull-fit';

/** A choice without its per-character part (who draws the anatomical skull has tests of its own, below). */
const core = ({ skull, variant, recipe, notes }: SkullChoice) => ({ skull, variant, recipe, notes });

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
    expect(core(resolveSkull(search))).toEqual({ ...FULL, notes: [] });
    expect(resolveSkull(search).recipe).toBe(sculptRecipe('full'));
  });

  it('?skull=sculpt with no ?sculpt= is the sculpted skull\'s default look: full', () => {
    for (const search of ['?skull=sculpt', '?seed=1&skull=sculpt&vhs=off', '?skull=sculpt&sculpt=']) {
      expect(core(resolveSkull(search)), search).toEqual({ ...FULL, notes: [] });
    }
  });

  it('?skull=anatomical is the anatomical skull, its other bones under `classic`', () => {
    for (const search of ['?skull=anatomical', '?level=night-train&skull=anatomical', '?skull=anatomical&sculpt=']) {
      const choice = resolveSkull(search);
      expect(core(choice), search).toEqual({ ...ANATOMICAL, notes: [] });
      expect(choice.recipe).toBe(SCULPT_CLASSIC);
    }
  });

  it.each(SCULPT_VARIANTS)('?sculpt=%s is the sculpted skull in that variant', (variant) => {
    const want = { skull: 'sculpt', variant, recipe: sculptRecipe(variant), notes: [] };
    for (const search of [`?sculpt=${variant}`, `?skull=sculpt&sculpt=${variant}`, `?seed=1&sculpt=${variant}&vhs=off`]) {
      const choice = resolveSkull(search);
      expect(core(choice), search).toEqual(want);
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
    expect(core(resolveSkull('?sculpt=classic'))).toEqual({ skull: 'sculpt', variant: 'classic', recipe: SCULPT_CLASSIC, notes: [] });
  });

  it('?skull=procedural is an older name for ?skull=sculpt', () => {
    expect(core(resolveSkull('?skull=procedural'))).toEqual({ ...FULL, notes: [] });
    expect(core(resolveSkull('?skull=procedural&sculpt=paint'))).toEqual({ skull: 'sculpt', variant: 'paint', recipe: sculptRecipe('paint'), notes: [] });
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

describe('sculptPaintOf: the paint a character\'s bones are drawn with', () => {
  // The thirteen humanoids (anatomical-skull.ts HUMANOID_SKULLS), by what the cast sheet showed.
  const FITTED = ['zombie', 'soldier', 'juggernaut', 'clown', 'clown-alt'];
  const NOT_FITTED = ['cultist', 'cultist-cowled', 'bride', 'female', 'schoolgirl', 'schoolgirl-alt', 'schoolgirl-described', 'bonewalker'];
  const OTHERS = ['goblin', 'ogre', 'warbull', 'mouse', 'a-character-added-tomorrow', '', 'Zombie'];
  const SECOND: SculptVariant[] = ['paint', 'full-1cm', 'full'], FIRST: SculptVariant[] = ['classic', 'shape', 'shape-fine'];

  it('the second paint is fitted to exactly the five reviewed characters', () => {
    expect([...SECOND_PAINT_CHARACTERS].sort()).toEqual([...FITTED].sort());
    expect(FITTED.length + NOT_FITTED.length).toBe(13);
  });

  it('under a second-paint recipe: the second paint for a fitted character, the first for every other', () => {
    for (const variant of SECOND) {
      for (const c of FITTED) expect(sculptPaintOf(sculptRecipe(variant), c), `${variant} ${c}`).toBe(2);
      for (const c of [...NOT_FITTED, ...OTHERS]) expect(sculptPaintOf(sculptRecipe(variant), c), `${variant} ${c}`).toBe(1);
    }
  });

  it('under a first-paint recipe: the first paint for everyone', () => {
    for (const variant of FIRST) {
      for (const c of [...FITTED, ...NOT_FITTED, ...OTHERS]) expect(sculptPaintOf(sculptRecipe(variant), c), `${variant} ${c}`).toBe(1);
    }
  });

  it('a recipe that says every head: its paint for everyone', () => {
    for (const c of [...FITTED, ...NOT_FITTED, ...OTHERS]) {
      expect(sculptPaintOf({ ...sculptRecipe('full'), everyHead: true }, c), c).toBe(2);
      expect(sculptPaintOf({ ...sculptRecipe('classic'), everyHead: true }, c), c).toBe(1);
    }
  });

  it('the default page: the zombie, the soldier, the juggernaut and the clowns under the second paint, the other eight humanoids under the first', () => {
    const recipe = resolveSkull('').recipe;
    expect(FITTED.map(c => sculptPaintOf(recipe, c))).toEqual([2, 2, 2, 2, 2]);
    expect(NOT_FITTED.map(c => sculptPaintOf(recipe, c))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    // The anatomical skull's page and the first look: the first paint for every bone.
    for (const search of ['?skull=anatomical', '?sculpt=classic']) {
      for (const c of [...FITTED, ...NOT_FITTED]) expect(sculptPaintOf(resolveSkull(search).recipe, c), `${search} ${c}`).toBe(1);
    }
  });
});

describe('resolveSkull: ?sculptheads=all', () => {
  it('a second-paint variant\'s recipe with every head, frozen; the variant keeps its name', () => {
    for (const search of ['?sculptheads=all', '?sculpt=full&sculptheads=all', '?skull=sculpt&sculptheads=all']) {
      const choice = resolveSkull(search);
      expect(core(choice), search).toEqual({ skull: 'sculpt', variant: 'full', recipe: { ...sculptRecipe('full'), everyHead: true }, notes: [] });
      expect(Object.isFrozen(choice.recipe)).toBe(true);
      expect(sculptVariantOf(choice.recipe)).toBe('full');
      // The variant's own recipe is not touched.
      expect(sculptRecipe('full').everyHead).toBeUndefined();
    }
    expect(resolveSkull('?sculpt=paint&sculptheads=all').recipe).toEqual({ ...sculptRecipe('paint'), everyHead: true });
    expect(resolveSkull('?sculpt=full-1cm&sculptheads=all').recipe).toEqual({ ...sculptRecipe('full-1cm'), everyHead: true });
  });

  it('nothing to a first-paint variant, nor to the anatomical skull', () => {
    for (const variant of ['classic', 'shape', 'shape-fine'] as const) expect(resolveSkull(`?sculpt=${variant}&sculptheads=all`).recipe).toBe(sculptRecipe(variant));
    expect(core(resolveSkull('?skull=anatomical&sculptheads=all'))).toEqual({ skull: 'anatomical', variant: 'classic', recipe: SCULPT_CLASSIC, notes: [] });
  });

  it('any other value is passed over and said', () => {
    for (const value of ['1', 'true', 'ALL', 'none', 'zombie']) {
      const choice = resolveSkull(`?sculptheads=${value}`);
      expect(choice.recipe, value).toBe(sculptRecipe('full'));
      expect(choice.notes).toEqual([expect.stringContaining(`?sculptheads=${value}`)]);
    }
    expect(resolveSkull('?sculptheads=').notes).toEqual([]);
  });
});

describe('resolveSkull: who draws the anatomical skull, and under which fit', () => {
  const EIGHT = Object.keys(BALL_HEADS), FIVE = HUMANOIDS.filter(name => !EIGHT.includes(name));
  const fitsOf = (search: string) => Object.fromEntries(Object.entries(resolveSkull(search).anatomical).map(([name, spec]) => [name, spec.fit]));

  it('by default the eight ball-headed humanoids, each under its own fit; the zombie, the soldier, the juggernaut and the clowns draw their sculpted bone', () => {
    for (const search of ['', '?level=night-train', '?seed=1&frozen=1', '?sculptheads=all', '?skull=nonsense', '?sculpt=nonsense']) {
      const choice = resolveSkull(search);
      expect(Object.keys(choice.anatomical), search).toEqual(EIGHT);
      for (const name of EIGHT) { expect(choice.anatomical[name]).toBe(BALL_HEADS[name]!.spec); expect(anatomicalFitOf(choice, name)).toBe(BALL_HEADS[name]!.spec); }
      for (const name of [...FIVE, 'ogre', 'goblin', 'constructor', 'toString']) expect(anatomicalFitOf(choice, name), name).toBeNull();
      expect(choice.skull).toBe('sculpt');
      expect(choice.variant).toBe('full');
    }
    expect(FIVE).toEqual(['zombie', 'soldier', 'clown', 'clown-alt', 'juggernaut']);
  });

  it('?skull=sculpt, and every ?sculpt=<variant>, is the sculpted bone on EVERY character: the eight show their balls', () => {
    for (const search of ['?skull=sculpt', '?skull=procedural', ...SCULPT_VARIANTS.map(v => `?sculpt=${v}`), ...SCULPT_VARIANTS.map(v => `?skull=anatomical&sculpt=${v}`), '?skull=sculpt&sculptheads=all']) {
      const choice = resolveSkull(search);
      expect(choice.anatomical, search).toEqual({});
      for (const name of HUMANOIDS) expect(anatomicalFitOf(choice, name)).toBeNull();
    }
  });

  it('?skull=anatomical is the anatomical skull on every humanoid, under the envelope fit, as it was', () => {
    expect(SKULL_FIT_DEFAULT).toBe('envelope');
    for (const search of ['?skull=anatomical', '?skull=anatomical&sculptheads=all', '?skull=anatomical&sculpt=nonsense', '?skull=anatomical&skullfit=', '?skull=anatomical&skullfit=envelope']) {
      const choice = resolveSkull(search);
      expect(Object.keys(choice.anatomical), search).toEqual([...HUMANOIDS]);
      for (const name of HUMANOIDS) expect(choice.anatomical[name]).toEqual({ fit: 'envelope' });
      expect(anatomicalFitOf(choice, 'ogre')).toBeNull();
    }
  });

  it.each(SKULL_FIT_NAMES)('?skullfit=%s is that fit, plain, for whoever draws the anatomical skull', (fit) => {
    // The eight by default: the named fit as it is, with none of a character's own values.
    const byDefault = resolveSkull(`?skullfit=${fit}`);
    expect(Object.keys(byDefault.anatomical)).toEqual(EIGHT);
    for (const name of EIGHT) expect(byDefault.anatomical[name]).toEqual({ fit });
    expect(byDefault.notes).toEqual([]);
    expect(core(byDefault)).toEqual(core(resolveSkull('')));
    // Every humanoid under ?skull=anatomical.
    const every = resolveSkull(`?skull=anatomical&skullfit=${fit}`);
    expect(fitsOf(`?skull=anatomical&skullfit=${fit}`)).toEqual(Object.fromEntries(HUMANOIDS.map(name => [name, fit])));
    expect(every.notes).toEqual([]);
    // Nobody under the sculpted skull: said, and passed over.
    for (const search of [`?skull=sculpt&skullfit=${fit}`, `?sculpt=classic&skullfit=${fit}`, `?skull=anatomical&sculpt=paint&skullfit=${fit}`]) {
      const none = resolveSkull(search);
      expect(none.anatomical, search).toEqual({});
      expect(none.notes.filter(n => n.includes(`?skullfit=${fit}`)), search).toHaveLength(1);
    }
  });

  it('an unknown ?skullfit= is passed over with one note, and the fits stay as they were', () => {
    for (const value of ['huge', 'Snug', 'SNUG', '1', 'sculpt']) {
      for (const [search, want] of [[`?skullfit=${value}`, fitsOf('')], [`?skull=anatomical&skullfit=${value}`, fitsOf('?skull=anatomical')], [`?skull=sculpt&skullfit=${value}`, {}]] as const) {
        const choice = resolveSkull(search);
        expect(fitsOf(search), search).toEqual(want);
        expect(choice.notes, search).toEqual([expect.stringContaining(`?skullfit=${value}`)]);
        expect(choice.notes[0]).toContain(SKULL_FIT_NAMES.join(', '));
      }
    }
  });

  it('every combination of ?skull=, ?sculpt= and ?skullfit=: who draws the plates follows from the skull and the variant alone, the fit from ?skullfit=', () => {
    const skulls = [null, '', 'sculpt', 'anatomical', 'procedural', 'nonsense'], sculpts = [null, '', 'classic', 'full', 'nonsense'], fits = [null, '', 'envelope', 'snug', 'nonsense'];
    for (const skull of skulls) for (const sculpt of sculpts) for (const fit of fits) {
      const search = '?' + [skull === null ? '' : `skull=${skull}`, sculpt === null ? '' : `sculpt=${sculpt}`, fit === null ? '' : `skullfit=${fit}`].filter(Boolean).join('&');
      const choice = resolveSkull(search);
      const known = sculpt === 'classic' || sculpt === 'full', named = fit === 'envelope' || fit === 'snug';
      const who = known || skull === 'sculpt' || skull === 'procedural' ? [] : skull === 'anatomical' ? [...HUMANOIDS] : EIGHT;
      expect(Object.keys(choice.anatomical), search).toEqual(who);
      for (const name of who) {
        const want = named ? { fit } : skull === 'anatomical' ? { fit: 'envelope' } : BALL_HEADS[name]!.spec;
        expect(choice.anatomical[name], `${search} ${name}`).toEqual(want);
      }
      // The page's skull is 'anatomical' exactly when every humanoid draws the plates.
      expect(choice.skull, search).toBe(who.length === HUMANOIDS.length ? 'anatomical' : 'sculpt');
    }
  });
});
