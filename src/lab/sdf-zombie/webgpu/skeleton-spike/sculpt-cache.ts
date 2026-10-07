import { createSkullMeshCache } from './anatomical-skull';
import { SegmentMeshCache } from './mesh';
import { resolveSculptVariant, sculptRecipe } from './sculpt-variant';

/** The game's bone-mesh cache for a page's query string. `?sculpt=<variant>` (sculpt-variant.ts) is the sculpted
 *  skull in that variant, whatever `?skull=` says. Without it the choice is createSkullMeshCache's, untouched: the
 *  anatomical skull, or with `?skull=sculpt` the sculpted one as it always was. */
export async function createBoneMeshCache(search: string): Promise<SegmentMeshCache> {
  const variant = resolveSculptVariant(search);
  return variant ? new SegmentMeshCache(undefined, null, sculptRecipe(variant)) : createSkullMeshCache(search);
}
