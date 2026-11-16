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
// 2026-11-14 (owner, in the game: "shimmery pixely patches"): FREQ 5 to 3.2 and SOFT 0.16 to 0.3, bigger and
// softer-edged, and the field is stretched along the body (STREAK) so the red comes in as runs, not blotches.
export const MELT_SKIN_PATCH_FREQ = 3.2;
export const MELT_SKIN_PATCH_SOFT = 0.3;
/** The patch field's frequency along the body's rest height, as a share of FREQ: below 1 stretches it into streaks. */
export const MELT_SKIN_STREAK = 0.22;
/** A prim's own melt progress (0..1) at which its red ramp is complete. The red starts as the part starts to sag
 *  and is full when it is this far gone, so it spreads up the body with the melt front. */
export const MELT_RED_FULL_U = 0.45;
/** The most the body-wide creep contributes to a point's red ramp (0..1): the share of streaks that can open
 *  before the part itself starts to melt. */
export const MELT_RED_CREEP = 0.35;
// 1.08, not 1.30 (owner, 2026-11-14, in the game: "too white and not really fleshy"). At 1.30 about a fifth of
// the surface never crossed, and on the game's pale zombie under its brighter lights that fifth read as most of it.
export const MELT_SKIN_KEEP = 1.08;
/** How far a crossed patch goes to the deep red (the mix weight). 0.8 left a fifth of the skin's own pale colour
 *  in the reddest flesh; same owner note. */
export const MELT_SKIN_RED = 0.92;
/**
 * THE RED A CROSSED PATCH GOES TO: deepColor scaled by (DEPTH, PURITY, PURITY).
 *
 * Measured in the game (debug stop 34, 2026-11-14): the old deepColor * 0.8 albedo was right, about 80% of the body
 * red by a third of the melt, and the lit frame was tan and white. The arena's flashlight and light list light a body
 * around ten times over; the red channel clips and green and blue catch it up, so a mid red goes orange, tan, white
 * (the same thing turns the zombie's salmon skin white there). A red with almost no green or blue in it has nothing
 * to catch up with: it stays red however hard it is lit, and in dim light it is dark raw meat.
 */
export const MELT_RED_DEPTH = 0.75;
export const MELT_RED_PURITY = 0.12;
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

/**
 * THE MELT WAVE (owner, 2026-11-16: "some kind of sinusoidal wave distortion into the flesh so you don't get straight
 * tubes"). A limb's flesh is one capsule and a capsule is straight however it is moved, so the straightness is taken
 * out in the FIELD: mapBody reads a melting instance at a point pushed sideways (and a little up and down) by three
 * sines of its position, and every capsule, drip and pool edge of that body comes out wavy.
 *  - AMP: metres of push at full strength.
 *  - FREQ: radians per metre (20 is a 31 cm wave: about one bend along a forearm).
 *  - FULL_T: the body's melt progress by which the wave is at full strength (it eases in from 0, so the first frame
 *    of a melt is the body as it was).
 *  - STEP: the instance's distance is scaled by this while it melts. The push stretches the field by up to
 *    1 + AMP * FREQ * ~1.5, and a march stepping the unscaled value would tunnel through thin flesh.
 * THE PHASE READS x AND z ONLY, never y: flesh falling straight down keeps its place in the wave. On a phase that
 * read y the flesh fell THROUGH the wave and the surface swam (owner, 2026-11-16).
 * mapLean has no wave, so the lean walk stands down for a pixel with a melting slot (lean-walk.wgsl.ts).
 */
// 0.008, not 0.022 (owner, 2026-11-16: "a bit maybe too intense", and wanted less of it on the body): the limbs now
// get their straightness taken out per prim (melt.ts curlArm / curlLeg), and this is only a light lumpiness.
export const MELT_WAVE_AMP = 0.008;
export const MELT_WAVE_FREQ = 20;
export const MELT_WAVE_FULL_T = 0.3;
export const MELT_WAVE_STEP = 0.8;
