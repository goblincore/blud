// src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-cache.ts
//
// The game's bone-mesh cache for a page's query string: the skulls resolveSkull (sculpt-variant.ts) chooses, built.

import { loadSkullAsset, type AnatomicalSkullKit, type SkullFitPlan } from './anatomical-skull';
import { SegmentMeshCache } from './mesh';
import { anatomicalFitOf, ownSkullFitOf, resolveSkull, sculptRecipe, SCULPT_DEFAULT_VARIANT, type SkullChoice } from './sculpt-variant';
import { ANATOMICAL_SKULL_ASSET, type SkullAsset } from './skull-cast';

/** Says a line on the browser's console. `always`: in any build, which is how this module says each of its lines,
 *  once: a word of the query that was not honoured (an unknown value, a value another overrules), and the plates'
 *  asset that did not load. Without it, a dev build's console only. */
export type SkullSay = (line: string, always?: boolean) => void;
const consoleWarn: SkullSay = (line, always) => { if (always || import.meta.env.DEV) console.warn(`[skull] ${line}`); };

/** How long the page waits for the plates' asset before it boots without it, milliseconds. The asset is 1.3 MB,
 *  served with the page; a load that has not ended by then is a stalled one. */
export const SKULL_ASSET_WAIT_MS = 8000;

/** Loads `asset` into a kit with `plan` (who draws it, under which fit). The game's: loadSkullAsset. */
export type LoadSkullKit = (plan: SkullFitPlan, asset: SkullAsset) => Promise<AnatomicalSkullKit>;

/** The assets `choice` draws, each with its plan: the human skull's first (where anybody draws it), then each own
 *  skull's, once. */
export function skullAssetPlans(choice: Pick<SkullChoice, 'anatomical' | 'own'>): { asset: SkullAsset; plan: SkullFitPlan }[] {
  const plans = Object.keys(choice.anatomical).length > 0 ? [{ asset: ANATOMICAL_SKULL_ASSET, plan: (c: string) => anatomicalFitOf(choice, c) }] : [];
  for (const own of Object.values(choice.own)) {
    if (plans.some(p => p.asset.name === own.asset.name)) continue;
    plans.push({ asset: own.asset, plan: c => { const mine = ownSkullFitOf(choice, c); return mine && mine.asset.name === own.asset.name ? mine.spec : null; } });
  }
  return plans;
}

/** The game's bone-mesh cache for a page's query string. resolveSkull decides, character by character: the sculpted
 *  skull in a variant (the default: `full`), and for the characters it names the anatomical one under a fit (by
 *  default the eight ball-headed humanoids; with `?skull=anatomical` every humanoid). Each of the resolver's notes
 *  is said once, here. The anatomical skull is an asset, asked for only by a page that may draw it. When it does not
 *  load (it fails, or `waitMs` pass), the boot goes on without it: every character draws its sculpted bone, in the
 *  default variant for a page that asked for the plates on everyone, and the page says so, once. A character's OWN
 *  skull (the imp's) is an asset of its own, loaded beside the plates: one that does not load leaves that character
 *  on its sculpted bone, says so once, and touches nobody else. */
export async function createBoneMeshCache(
  search: string, say: SkullSay = consoleWarn, loadKit: LoadSkullKit = (plan, asset) => loadSkullAsset(asset, plan),
  waitMs: number = SKULL_ASSET_WAIT_MS,
): Promise<SegmentMeshCache> {
  const choice = resolveSkull(search);
  for (const note of choice.notes) say(note, true);
  const plans = skullAssetPlans(choice);
  if (plans.length === 0) return new SegmentMeshCache(undefined, undefined, null, choice.recipe);
  const kits = await Promise.all(plans.map(async ({ asset, plan }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stalled = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${waitMs} ms`)), waitMs); });
      const began = performance.now();
      const kit = await Promise.race([loadKit(plan, asset), stalled]);
      kit.loadMs = performance.now() - began;
      return kit;
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (asset.name === ANATOMICAL_SKULL_ASSET.name) {
        const variant = choice.skull === 'anatomical' ? SCULPT_DEFAULT_VARIANT : choice.variant;
        say(`the anatomical skull did not load (${why}): every character draws its sculpted bone (the sculpted skull, ${variant})`, true);
      } else {
        const who = Object.keys(choice.own).filter(c => choice.own[c]!.asset.name === asset.name).join(', ');
        say(`the ${asset.name} skull (${asset.url}) did not load (${why}): ${who} draws its sculpted bone`, true);
      }
      return null;
    } finally { clearTimeout(timer); }
  }));
  const loaded = kits.filter((kit): kit is AnatomicalSkullKit => kit !== null);
  // Without the human plates, a page that asked for them on everyone draws its sculpted bones in the default variant.
  const plates = plans[0]!.asset.name === ANATOMICAL_SKULL_ASSET.name && kits[0] === null;
  const recipe = plates && choice.skull === 'anatomical' ? sculptRecipe(SCULPT_DEFAULT_VARIANT) : choice.recipe;
  return new SegmentMeshCache(undefined, undefined, loaded.length > 0 ? loaded : null, recipe);
}

/** THE BOOT'S CACHE, ASKED FOR EARLY. The plates' asset is a request and a parse the page need not stand still for:
 *  the boot starts the cache as its first act (`mayMesh`: the query does not rule the mesh skeleton out) and takes
 *  it where the skeleton is built, so the load runs beside everything between. take(false) is a boot that turned
 *  out not to draw the mesh skeleton (deferred mode): the cache that was started is disposed when it arrives, and
 *  the answer is null. take() also records how long the boot stood waiting on the kit (AnatomicalSkullKit.awaitedMs). */
export function startBoneMeshCache(
  search: string, mayMesh: boolean, make: (search: string) => Promise<SegmentMeshCache> = createBoneMeshCache,
): { take(mesh: boolean): Promise<SegmentMeshCache | null> } {
  const started = mayMesh ? make(search) : null;
  return {
    async take(mesh) {
      if (!mesh) { void started?.then(cache => cache.dispose()); return null; }
      const began = performance.now();
      const cache = await (started ?? make(search));
      for (const kit of cache.skullKits) kit.awaitedMs = performance.now() - began;
      return cache;
    },
  };
}
