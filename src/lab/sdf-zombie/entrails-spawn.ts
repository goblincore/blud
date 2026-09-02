import type { Wound } from './damage';

export const SPILL_CHANCE = { slug: 0.35, blast: 1.0 } as const;

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
  const chance = wound.type === 'blast' ? SPILL_CHANCE.blast : SPILL_CHANCE.slug;
  return rng() < chance ? 'spawn' : 'none';
}

/**
 * GOO gut size — the sim `size` of each `kind: 'gut'` droplet a rope
 * contributes. The goo pass (goo-layer) draws droplets ABOVE
 * `GOO_TUNING.mistMaxSize` (0.05) as density blobs, and fuses overlapping
 * blobs into one surface, so the size IS the rope's thickness: 0.3 at the
 * chain's 0.55 m length reads as a fused rope, not beads. Tuning knob — the
 * wound panel wires this up in the next task.
 */
export const GUT_DROPLET_SIZE = 0.3;
