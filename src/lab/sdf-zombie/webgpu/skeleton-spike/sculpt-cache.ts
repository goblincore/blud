// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-cache.ts
//
// The game's bone-mesh cache for a page's query string: the skull resolveSkull (sculpt-variant.ts) chooses, built.

import { loadAnatomicalSkull, type AnatomicalSkullKit } from './anatomical-skull';
import { SegmentMeshCache } from './mesh';
import { resolveSkull, sculptRecipe, SCULPT_DEFAULT_VARIANT } from './sculpt-variant';

/** Says a line about a query that was not honoured. The game's: the browser console, in a dev build only. */
export type SkullSay = (line: string) => void;
const devWarn: SkullSay = line => { if (import.meta.env.DEV) console.warn(`[skull] ${line}`); };

/** The game's bone-mesh cache for a page's query string. resolveSkull decides which skull: the sculpted one in a
 *  variant (the default: `full`), or with `?skull=anatomical` the anatomical one. Each of the resolver's notes is
 *  said once, here. The anatomical skull is an asset: when it does not load, the page draws the default sculpted
 *  skull and says so. `loadKit` loads it (the game's: loadAnatomicalSkull). */
export async function createBoneMeshCache(
  search: string, say: SkullSay = devWarn, loadKit: () => Promise<AnatomicalSkullKit> = loadAnatomicalSkull,
): Promise<SegmentMeshCache> {
  const choice = resolveSkull(search);
  for (const note of choice.notes) say(note);
  if (choice.skull === 'anatomical') {
    try { return new SegmentMeshCache(undefined, undefined, await loadKit(), choice.recipe); }
    catch (error) {
      say(`the anatomical skull did not load (${error instanceof Error ? error.message : String(error)}): the sculpted skull, ${SCULPT_DEFAULT_VARIANT}, is drawn`);
      return new SegmentMeshCache(undefined, undefined, null, sculptRecipe(SCULPT_DEFAULT_VARIANT));
    }
  }
  return new SegmentMeshCache(undefined, undefined, null, choice.recipe);
}
