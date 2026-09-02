import type { Wound } from './damage';

/** NOT `as const`: the wound panel's spillChance knob overrides `slug` live
 *  (game-main's setWoundTuning), the same mutate-the-shared-table pattern as
 *  IMPACT_GOUT. blast stays pinned at 1.0 — a blast to a torso ALWAYS spills. */
export const SPILL_CHANCE = { slug: 0.35, blast: 1.0 };

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
