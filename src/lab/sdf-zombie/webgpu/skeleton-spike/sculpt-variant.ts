// The sculpted skull's look variants. `?sculpt=<name>` picks one and implies `?skull=sculpt`; with no `?sculpt=` the
// sculpted skull is the first revision, drawn exactly as it always was (SCULPT_DEFAULT). Pure: the cache, the renderer
// and the URL resolver all read the one recipe.

/** `shape`: the second sculpt at the bone cache's own cell. `shape-fine`: the same field at SCULPT_FINE_CELL for the
 *  head. `paint`: the first sculpt under the second paint. `full`: the fine second sculpt under the second paint. */
export const SCULPT_VARIANTS = ['shape', 'shape-fine', 'paint', 'full'] as const;
export type SculptVariant = (typeof SCULPT_VARIANTS)[number];

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

export const SCULPT_DEFAULT: Readonly<SculptRecipe> = Object.freeze({ shape: 1, headCell: null, paint: 1 });

const RECIPES: Readonly<Record<SculptVariant, Readonly<SculptRecipe>>> = Object.freeze({
  shape: Object.freeze({ shape: 2, headCell: null, paint: 1 }),
  'shape-fine': Object.freeze({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 1 }),
  paint: Object.freeze({ shape: 1, headCell: null, paint: 2 }),
  full: Object.freeze({ shape: 2, headCell: SCULPT_FINE_CELL, paint: 2 }),
});

/** The variant a page's query string asks for; null for none, or for a name that is not a variant. */
export function resolveSculptVariant(search: string): SculptVariant | null {
  const v = new URLSearchParams(search).get('sculpt');
  return (SCULPT_VARIANTS as readonly string[]).includes(v ?? '') ? (v as SculptVariant) : null;
}

/** The recipe of a variant; null (no variant) is the default sculpt. */
export function sculptRecipe(variant: SculptVariant | null): Readonly<SculptRecipe> {
  return variant ? RECIPES[variant] : SCULPT_DEFAULT;
}
