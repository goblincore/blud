// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-variant.ts
//
// Which skull a page draws: resolveSkull reads `?skull=` and `?sculpt=` and answers the skull, the sculpted skull's variant and its recipe.
//
// The game's skull is the SCULPTED one (the character's own bone, carved and painted) in the variant `full`. The
// ANATOMICAL one (the modelled skull of 14 plates, anatomical-skull.ts) is drawn on request: `?skull=anatomical`.
// `?sculpt=<name>` picks another variant of the sculpted skull. resolveSkull is the one place that decides; the bone
// cache (sculpt-cache.ts), the renderer and the diagnostics all read its answer. Pure.

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
  paint: SculptPaint;
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

/** The variant a recipe is; null for a recipe that is none of them. */
export function sculptVariantOf(recipe: Readonly<SculptRecipe>): SculptVariant | null {
  return SCULPT_VARIANTS.find(v => RECIPES[v].shape === recipe.shape && RECIPES[v].headCell === recipe.headCell && RECIPES[v].paint === recipe.paint) ?? null;
}

/** The two skulls. */
export const SKULL_KINDS = ['sculpt', 'anatomical'] as const;
export type SkullKind = (typeof SKULL_KINDS)[number];
/** The skull a page draws when its query names none. */
export const SKULL_DEFAULT: SkullKind = 'sculpt';

export interface SkullChoice {
  skull: SkullKind;
  /** The sculpted skull's variant. Under the anatomical skull it is `classic`: every bone but the head is drawn as
   *  it was when the anatomical skull was the default. */
  variant: SculptVariant;
  recipe: Readonly<SculptRecipe>;
  /** One line for each thing the query asked for that was not understood, or was overruled. Empty for a query that
   *  names nothing, or only what it gets. */
  notes: readonly string[];
}

/** The skull a page's query string asks for.
 *   no `?skull=` and no `?sculpt=`     the sculpted skull, `full`;
 *   `?skull=sculpt`                    the same: `full` is the sculpted skull's look;
 *   `?skull=anatomical`                the anatomical skull;
 *   `?sculpt=<variant>`                the sculpted skull in that variant, whatever `?skull=` says.
 *  A value that is none of these is passed over, and the page draws what it would have without it: `notes` says so.
 *  An empty value is no value. `?skull=procedural` is an older name for `?skull=sculpt`. */
export function resolveSkull(search: string): SkullChoice {
  const params = new URLSearchParams(search), notes: string[] = [];
  const skullParam = params.get('skull') || null, sculptParam = params.get('sculpt') || null;
  let variant: SculptVariant | null = null;
  if (sculptParam !== null) {
    if ((SCULPT_VARIANTS as readonly string[]).includes(sculptParam)) variant = sculptParam as SculptVariant;
    else notes.push(`?sculpt=${sculptParam} is not a variant of the sculpted skull (${SCULPT_VARIANTS.join(', ')}): passed over`);
  }
  let skull: SkullKind = SKULL_DEFAULT;
  if (skullParam === 'anatomical') skull = 'anatomical';
  else if (skullParam !== null && skullParam !== 'sculpt' && skullParam !== 'procedural') {
    notes.push(`?skull=${skullParam} is not a skull (${SKULL_KINDS.join(', ')}): passed over`);
  }
  if (variant !== null && skull === 'anatomical') {
    notes.push(`?skull=anatomical is overruled by ?sculpt=${variant}, which asks for the sculpted skull`);
    skull = 'sculpt';
  }
  if (skull === 'anatomical') return { skull, variant: 'classic', recipe: SCULPT_CLASSIC, notes };
  variant ??= SCULPT_DEFAULT_VARIANT;
  return { skull, variant, recipe: RECIPES[variant], notes };
}
