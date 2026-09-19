// src/lab/sdf-zombie/webgpu/march/melt.ts
//
// Face-melt and melt-skin tuning constants — split out of march.wgsl.ts
// (phase 1, move-only). HEAD_EXTERIOR_GORE_KEEP is re-exported from
// gib-look-tuning so the barrel's export surface is unchanged.

import { HEAD_EXTERIOR_GORE_KEEP } from '../../gib-look-tuning';

// ——— Face melt (zombie melt task 8) ————————————————————————————————————
// meltCfg.x drives all three. Interpolated into MARCH_BODY below, so a WGSL
// reader sees numbers and a tuner sees these names. SAG slides the SAMPLED
// sheet V upward, which drags the features DOWN the skull: shader-sheet v
// increases up the face (the upload flip in lab-main keeps the face upright
// with a positive faceProj.y), so a surface point must sample HIGHER v to
// show what used to be above it. STRETCH narrows the sampled V window about
// the projection centre, so each feature covers MORE surface as it goes —
// the elongation is what reads as dripping rather than a sticker sliding.
// FADE_LO is where the facing fade's lower bound moves at full melt: a
// flattened head's surface turns away from the forward axis far sooner, and
// the standing-zombie 0.28 cutoff fades the face out before it has finished
// dripping.
export const FACE_MELT_SAG = 0.25;
export const FACE_MELT_STRETCH = 0.6;
export const FACE_MELT_FADE_LO = 0.05;
/** Fraction of a piece's gore a HEAD's non-face exterior keeps (0..1).
 *  A detached head was torn at the NECK; its exterior skin is intact, so at
 *  0.6 of the normal chunk gore it reads as a bloodied head rather than the
 *  generic mottled meat blob the owner reported (2026-09-16 follow-ups task 2).
 *  Setting it to 1 restores the pre-task-2 behaviour exactly. Shared with the
 *  CPU bake (gib-look-tuning.ts) so the two cannot drift. */
export { HEAD_EXTERIOR_GORE_KEEP };

/**
 * MELT SKIN PATCHES (owner review, 2026-09-03: "some of the pink would still
 * be there like the skin, so some parts are still pink mixed with the red").
 *
 * The first version lerped ALL flesh albedo toward the deep red on one global
 * progress, so every pixel crossed over together and the body took a uniform
 * stain. Skin does not do that — it SLOUGHS, in patches, exposing the meat
 * under it while other patches are still intact.
 *
 * So the crossover threshold is per-point, read off the same rest-space noise
 * anchor the mottle uses: each patch turns at its own progress. FREQ sets the
 * patch size (the mottle beside it runs at 6.0), SOFT the softness of each
 * patch's edge, and KEEP > 1 scales the threshold ABOVE full progress so the
 * highest patches never cross at all — that is what leaves pink skin on the
 * finished puddle instead of converging to one red at t = 1.
 */
export const MELT_SKIN_PATCH_FREQ = 5.0;
export const MELT_SKIN_PATCH_SOFT = 0.16;
export const MELT_SKIN_KEEP = 1.30;
/**
 * Spread of the patch field before it becomes a threshold.
 *
 * NEEDED because fbm does NOT fill 0..1 evenly — it clusters hard around its
 * midpoint, so `fbm * 0.5 + 0.5` puts almost every point near 0.5 and every
 * patch crosses at nearly the same progress. The first version of this had no
 * contrast term and the body still went uniformly red, which looked exactly
 * like the bug it was meant to fix. Multiplying the deviation from the
 * midpoint before the bias is what actually separates early patches from late
 * ones (measured against captures at t = 0.35, where the uncontrasted version
 * had no pink left at all).
 */
export const MELT_SKIN_CONTRAST = 2.8;
