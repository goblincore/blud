import type { Wound } from './damage';

/**
 * OFF BY DEFAULT (owner, 2026-09-02).
 *
 * The spilled rope was judged unreadable in play: "a dark red oblong oval
 * thing... hard to tell what it is meant to be", not pink even after sweeping
 * the sliders. The owner's call was to keep the REVEALED coil in the abdomen —
 * which reads well — and drop the thing that comes out.
 *
 * The machinery is kept rather than deleted, because it is not dead weight the
 * way the torn-fibre pass was: the owner also said the spring "does seem to
 * spring out sometimes which is cool". The failure is legibility (colour and
 * silhouette), not mechanism, and task 6 measured the cause — at goo
 * `absorb 1.6`, exp(-thick * (0.30, 2.40, 2.00)) turns even pale salmon
 * red-dominant through the goo's own thickness. Turning `spill chance` up on
 * the wound panel brings it back for anyone who wants to attack that.
 *
 * NOT `as const`: the wound panel's spillChance knob overrides `slug` live.
 */
export const SPILL_CHANCE = { slug: 0, blast: 0 };

/**
 * Should this wound spill a gut rope?
 *
 * Requires a cavity wound (torso, slug or blast — see humanoid-damage) and one
 * rope per body at most: a second qualifying hit TEARS THE EXISTING ROPE FREE
 * rather than growing a second, which is what bounds both the sim and the goo
 * particle count regardless of how a fight goes.
 */
export function shouldSpill(
  wound: Wound, hasRope: boolean, rng: () => number,
): 'spawn' | 'tear' | 'none' {
  if (!wound.cavity) return 'none';
  if (hasRope) return 'tear';
  // Roll by the STAMP-TIME calibre, not by `type`: the slug stamps type
  // 'blast' (it uses the blast crater profile), so keying on type sent every
  // slug to the blast pin and left SPILL_CHANCE.slug dead (task-8 finding).
  const chance = wound.spillCalibre === 'slug' ? SPILL_CHANCE.slug : SPILL_CHANCE.blast;
  return rng() < chance ? 'spawn' : 'none';
}

/**
 * GOO gut size — the sim `size` of each `kind: 'gut'` droplet a rope
 * contributes. The goo pass (goo-layer) draws droplets ABOVE
 * `GOO_TUNING.mistMaxSize` (0.05) as density blobs, and fuses overlapping
 * blobs into one surface, so the size IS the rope's thickness: 0.3 at the
 * chain's 0.55 m length reads as a fused rope, not beads. Wired: game-main
 * seeds its panel record from this at boot, and the wound panel's gutSize
 * knob overrides it for every rope spawned after the drag.
 */
export const GUT_DROPLET_SIZE = 0.3;
