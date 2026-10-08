// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-variant.ts
//
// Which skull a page draws, character by character: resolveSkull reads `?skull=`, `?sculpt=` and `?skullfit=` and answers the sculpted skull's variant and recipe, and who draws the anatomical skull under which fit.
//
// The game's skull is the SCULPTED one (the character's own bone, carved and painted) in the variant `full`, for the
// characters whose head bone is a skull-sized mass. The eight humanoids whose head bone is a few balls draw the
// ANATOMICAL one (the modelled skull of 14 plates, anatomical-skull.ts), each fitted to its own flesh
// (skull-cast.ts BALL_HEADS). `?skull=anatomical` draws the plates on every humanoid, `?skull=sculpt` the sculpted
// bone on every one, `?sculpt=<name>` another variant of the sculpted skull, `?skullfit=<name>` another fit of the
// plates. resolveSkull is the one place that decides; the bone cache (sculpt-cache.ts), the renderer and the
// diagnostics all read its answer. Pure.
import { SKULL_FIT_NAMES, type SkullFitName, type SkullFitSpec } from './skull-fit';
import { BALL_HEADS, HUMANOIDS } from './skull-cast';

/** The sculpted skull's variants, by what each changes from `classic`:
 *   `classic`     the first sculpt at the bone cache's own cell under the first paint: the sculpted skull as it was
 *                 before the second sculpt and the second paint existed, byte for byte;
 *   `shape`       the second sculpt at the cache's cell, under the first paint;
 *   `shape-fine`  the second sculpt at SCULPT_FINE_CELL for the head, under the first paint;
 *   `paint`       the first sculpt under the second paint;
 *   `full-1cm`    the second sculpt at the cache's cell under the second paint;
 *   `full`        the second sculpt at SCULPT_FINE_CELL for the head under the second paint. The default. */
export const SCULPT_VARIANTS = ['classic', 'shape', 'shape-fine', 'paint', 'full-1cm', 'full'] as const;
export type SculptVariant = (typeof SCULPT_VARIANTS)[number];
/** The variant a page draws when its query names none. */
export const SCULPT_DEFAULT_VARIANT: SculptVariant = 'full';

/** Which sculpt carves the head's bone (mesh-skull.ts). */
export type SculptShape = 1 | 2;
/** Which paint shades it (1: mesh-appearance.ts; 2: sculpt-paint.ts). */
export type SculptPaint = 1 | 2;

export interface SculptRecipe {
  shape: SculptShape;
  /** The sculpted head's extraction cell (m). Null: the cache's own cell, as every other segment. */
  headCell: number | null;
  /** The paint of the characters the second paint is fitted to (sculptPaintOf); every other character is drawn
   *  under the first paint whatever this says. */
  paint: SculptPaint;
  /** True: the recipe's paint on every character, fitted or not (`?sculptheads=all`, for looking at a head the
   *  second paint is not fitted to). No variant has it. */
  everyHead?: boolean;
}

/** The fine variants' head cell (m): half the bone cache's 1 cm. */
export const SCULPT_FINE_CELL = 0.005;

/** `classic`'s recipe. It is also what a bone cache built with no recipe draws (mesh.ts), and what the anatomical
 *  skull's cache draws its other bones with. */
export const SCULPT_CLASSIC: Readonly<SculptRecipe> = Object.freeze({ shape: 1, headCell: null, paint: 1 });

const RECIPES: Readonly<Record<SculptVariant, Readonly<SculptRecipe>>> = Object.freeze({
  classic: SCULPT_CLASSIC,
  shape: Object.freeze({ shape: 2, headCell: null, paint: 1 }),
  'shape-fine': Object.freeze({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 1 }),
  paint: Object.freeze({ shape: 1, headCell: null, paint: 2 }),
  'full-1cm': Object.freeze({ shape: 2, headCell: null, paint: 2 }),
  full: Object.freeze({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 2 }),
});

/** The recipe of a variant. */
export function sculptRecipe(variant: SculptVariant): Readonly<SculptRecipe> {
  return RECIPES[variant];
}

/** THE CHARACTERS THE SECOND PAINT IS DRAWN ON. The second paint draws a face (orbits, a nasal aperture, two rows of
 *  teeth, hollows, cracks) at fixed places of the head bone's box: the places the second sculpt carves them on the
 *  zombie and the soldier. Every other character's head is its plain authored bone, with its own proportions, and the
 *  painted face sits on some and not on others (the cast sheet of 2026-10-07,
 *  docs/dev-notes/2026-10-07-sculpt-skull-2/look/cast-bare-heads.jpg):
 *   - the juggernaut's bone is the soldier's, larger and not carved: a ball 170 mm wide over a jaw. The orbits ring
 *     the eyes and the two tooth rows lie either side of the crease between the ball and the jaw;
 *   - the clown's and the clown-alt's is one round mass 176 mm wide: the face is whole on it, the orbits round the
 *     eyes.
 *  The cultist's, the cowled cultist's, the bride's, the female's, the three schoolgirls' and the bonewalker's head
 *  bones are not one skull-sized mass: a ball 48 to 112 mm wide over a jaw ball or a nub, or a column of beads (the
 *  zombie's is 166 mm wide). Either paint's face falls across the pieces, and the second gains nothing over the first
 *  there. They are not listed, and so keep the first paint, as they had it before the second paint existed.
 *  A character is listed here once its head has been looked at under the second paint and the face sits on the
 *  bone. One that is not listed, a new character among them, is drawn under the first paint. */
export const SECOND_PAINT_CHARACTERS: ReadonlySet<string> = new Set(['zombie', 'soldier', 'juggernaut', 'clown', 'clown-alt']);

/** The paint `character`'s bones are drawn with under `recipe`: the recipe's for a character the second paint is
 *  fitted to (or for every character, when the recipe says every head), else the first. */
export function sculptPaintOf(recipe: Readonly<SculptRecipe>, character: string): SculptPaint {
  return recipe.paint === 2 && (recipe.everyHead === true || SECOND_PAINT_CHARACTERS.has(character)) ? 2 : 1;
}

/** The variant a recipe is, whatever it says of every head; null for a recipe that is none of them. */
export function sculptVariantOf(recipe: Readonly<SculptRecipe>): SculptVariant | null {
  return SCULPT_VARIANTS.find(v => RECIPES[v].shape === recipe.shape && RECIPES[v].headCell === recipe.headCell && RECIPES[v].paint === recipe.paint) ?? null;
}

/** The two skulls. */
export const SKULL_KINDS = ['sculpt', 'anatomical'] as const;
export type SkullKind = (typeof SKULL_KINDS)[number];
/** The skull a page draws when its query names none: the sculpted one, but for the characters `anatomical` names. */
export const SKULL_DEFAULT: SkullKind = 'sculpt';

/** The fit `?skull=anatomical` gives every humanoid when `?skullfit=` names none: fixed fractions of the head's bone
 *  envelope, the anatomical skull as it was when it was every humanoid's. */
export const SKULL_FIT_DEFAULT: SkullFitName = 'envelope';

export interface SkullChoice {
  /** The page's skull: 'anatomical' when `?skull=anatomical` asks for the plates on every humanoid, else 'sculpt'
   *  (the default, where the characters `anatomical` names still draw the plates). */
  skull: SkullKind;
  /** The sculpted skull's variant. Under the anatomical skull it is `classic`: every bone but the head is drawn as
   *  it was when the anatomical skull was the default. */
  variant: SculptVariant;
  recipe: Readonly<SculptRecipe>;
  /** WHO DRAWS THE ANATOMICAL SKULL, and how it is fitted to each: character to fit. A character it does not name
   *  draws its sculpted bone. Empty: nobody does, and the page has no use for the plates' asset. */
  anatomical: Readonly<Record<string, Readonly<SkullFitSpec>>>;
  /** One line for each thing the query asked for that was not understood, or was overruled. Empty for a query that
   *  names nothing, or only what it gets. */
  notes: readonly string[];
}

/** The skull `character` draws under `choice`: the anatomical one under a fit, or its sculpted bone (null). */
export function anatomicalFitOf(choice: Pick<SkullChoice, 'anatomical'>, character: string): Readonly<SkullFitSpec> | null {
  return Object.hasOwn(choice.anatomical, character) ? choice.anatomical[character]! : null;
}

const NOBODY: SkullChoice['anatomical'] = Object.freeze({});
/** The eight, each under its own fit (skull-cast.ts). */
const BALL_HEAD_FITS: SkullChoice['anatomical'] = Object.freeze(Object.fromEntries(Object.entries(BALL_HEADS).map(([name, head]) => [name, head.spec])));
/** `who`, each under the plain named fit. */
const everyOne = (who: readonly string[], fit: SkullFitName): SkullChoice['anatomical'] => {
  const spec = Object.freeze({ fit });
  return Object.freeze(Object.fromEntries(who.map(name => [name, spec])));
};

/** The skull a page's query string asks for.
 *   no `?skull=` and no `?sculpt=`     the sculpted skull, `full`; the eight humanoids of skull-cast.ts BALL_HEADS
 *                                      draw the anatomical skull, each under its own fit;
 *   `?skull=sculpt`                    the sculpted skull, `full`, on EVERY character: the eight show their balls;
 *   `?skull=anatomical`                the anatomical skull on every humanoid, under the envelope fit;
 *   `?sculpt=<variant>`                the sculpted skull in that variant on every character, whatever `?skull=`
 *                                      says;
 *   `?skullfit=<name>`                 that fit, plain, for every character that draws the anatomical skull (the
 *                                      eight by default, every humanoid under `?skull=anatomical`). Nothing where
 *                                      nobody draws it;
 *   `?sculptheads=all`                 that variant's paint on every character's bones (the recipe's `everyHead`),
 *                                      for looking at a head the second paint is not fitted to. Nothing under the
 *                                      anatomical skull.
 *  A value that is none of these is passed over, and the page draws what it would have without it: `notes` says so.
 *  An empty value is no value. `?skull=procedural` is an older name for `?skull=sculpt`. */
export function resolveSkull(search: string): SkullChoice {
  const params = new URLSearchParams(search), notes: string[] = [];
  const skullParam = params.get('skull') || null, sculptParam = params.get('sculpt') || null, fitParam = params.get('skullfit') || null;
  let variant: SculptVariant | null = null;
  if (sculptParam !== null) {
    if ((SCULPT_VARIANTS as readonly string[]).includes(sculptParam)) variant = sculptParam as SculptVariant;
    else notes.push(`?sculpt=${sculptParam} is not a variant of the sculpted skull (${SCULPT_VARIANTS.join(', ')}): passed over`);
  }
  let skull: SkullKind = SKULL_DEFAULT;
  // The sculpted bone on every character: asked for by name, or by a variant of it.
  let everySculpt = skullParam === 'sculpt' || skullParam === 'procedural';
  if (skullParam === 'anatomical') skull = 'anatomical';
  else if (skullParam !== null && !everySculpt) {
    notes.push(`?skull=${skullParam} is not a skull (${SKULL_KINDS.join(', ')}): passed over`);
  }
  if (variant !== null && skull === 'anatomical') {
    notes.push(`?skull=anatomical is overruled by ?sculpt=${variant}, which asks for the sculpted skull`);
    skull = 'sculpt';
  }
  if (variant !== null) everySculpt = true;
  let fit: SkullFitName | null = null;
  if (fitParam !== null) {
    if ((SKULL_FIT_NAMES as readonly string[]).includes(fitParam)) fit = fitParam as SkullFitName;
    else notes.push(`?skullfit=${fitParam} is not a fit of the anatomical skull (${SKULL_FIT_NAMES.join(', ')}): passed over`);
  }
  const headsParam = params.get('sculptheads') || null;
  if (headsParam !== null && headsParam !== 'all') notes.push(`?sculptheads=${headsParam} is not understood (all): passed over`);
  if (skull === 'anatomical') return { skull, variant: 'classic', recipe: SCULPT_CLASSIC, anatomical: everyOne(HUMANOIDS, fit ?? SKULL_FIT_DEFAULT), notes };
  if (fit !== null && everySculpt) notes.push(`?skullfit=${fit} has no skull to fit: every character draws its sculpted bone. Passed over`);
  variant ??= SCULPT_DEFAULT_VARIANT;
  const recipe = RECIPES[variant];
  return {
    skull, variant, recipe: headsParam === 'all' && recipe.paint === 2 ? Object.freeze({ ...recipe, everyHead: true }) : recipe,
    anatomical: everySculpt ? NOBODY : fit !== null ? everyOne(Object.keys(BALL_HEADS), fit) : BALL_HEAD_FITS, notes,
  };
}
