// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-cache.ts
//
// The game's bone-mesh cache for a page's query string: the skulls resolveSkull (sculpt-variant.ts) chooses, built.

import { ANATOMICAL_SKULL_URL, loadAnatomicalSkull, type AnatomicalSkullKit, type SkullFitPlan } from './anatomical-skull';
import { SegmentMeshCache } from './mesh';
import { anatomicalFitOf, resolveSkull, sculptRecipe, SCULPT_DEFAULT_VARIANT } from './sculpt-variant';

/** Says a line about a query that was not honoured, in a dev build's browser console; and, `always`, a line the
 *  page says in any build: the plates' asset did not load. */
export type SkullSay = (line: string, always?: boolean) => void;
const consoleWarn: SkullSay = (line, always) => { if (always || import.meta.env.DEV) console.warn(`[skull] ${line}`); };

/** How long the page waits for the plates' asset before it boots without it, milliseconds. The asset is 1.3 MB,
 *  served with the page; a load that has not ended by then is a stalled one. */
export const SKULL_ASSET_WAIT_MS = 8000;

/** Loads the plates' asset into a kit with `plan` (who draws them, under which fit). The game's: loadAnatomicalSkull. */
export type LoadSkullKit = (plan: SkullFitPlan) => Promise<AnatomicalSkullKit>;

/** The game's bone-mesh cache for a page's query string. resolveSkull decides, character by character: the sculpted
 *  skull in a variant (the default: `full`), and for the characters it names the anatomical one under a fit (by
 *  default the eight ball-headed humanoids; with `?skull=anatomical` every humanoid). Each of the resolver's notes
 *  is said once, here. The anatomical skull is an asset, asked for only by a page that may draw it. When it does not
 *  load (it fails, or `waitMs` pass), the boot goes on without it: every character draws its sculpted bone, in the
 *  default variant for a page that asked for the plates on everyone, and the page says so, once. */
export async function createBoneMeshCache(
  search: string, say: SkullSay = consoleWarn, loadKit: LoadSkullKit = plan => loadAnatomicalSkull(ANATOMICAL_SKULL_URL, plan),
  waitMs: number = SKULL_ASSET_WAIT_MS,
): Promise<SegmentMeshCache> {
  const choice = resolveSkull(search);
  for (const note of choice.notes) say(note);
  if (Object.keys(choice.anatomical).length === 0) return new SegmentMeshCache(undefined, undefined, null, choice.recipe);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${waitMs} ms`)), waitMs); });
    const kit = await Promise.race([loadKit(character => anatomicalFitOf(choice, character)), stalled]);
    return new SegmentMeshCache(undefined, undefined, kit, choice.recipe);
  } catch (error) {
    const variant = choice.skull === 'anatomical' ? SCULPT_DEFAULT_VARIANT : choice.variant;
    say(`the anatomical skull did not load (${error instanceof Error ? error.message : String(error)}): every character draws its sculpted bone (the sculpted skull, ${variant})`, true);
    return new SegmentMeshCache(undefined, undefined, null, choice.skull === 'anatomical' ? sculptRecipe(SCULPT_DEFAULT_VARIANT) : choice.recipe);
  } finally { clearTimeout(timer); }
}
