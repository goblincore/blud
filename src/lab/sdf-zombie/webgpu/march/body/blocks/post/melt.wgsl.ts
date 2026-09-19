// src/lab/sdf-zombie/webgpu/march/body/blocks/post/melt.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): melt and bare-bone paling (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { MELT_SKIN_CONTRAST, MELT_SKIN_KEEP, MELT_SKIN_PATCH_FREQ, MELT_SKIN_PATCH_SOFT } from '../../../melt';

export const MELT_BLOCK = /* wgsl */ `  // MELT (2026-09-03, task 6) — the wet red, on flesh ONLY.
  //
  // The colour LEADS the sag: the reference goes red while the body is still
  // standing, before any height is visibly lost, so the ramp runs on
  // smoothstep(clamp(meltCfg.x * 2)) and is essentially complete by half
  // progress. That is the frame that reads as "melt" rather than "fall".
  //
  // A dominant BONE row does the opposite: it goes PALE (boneColor, the
  // wound pass's exposed-bone colour) and stays matte — the wetness boost
  // below skips it. Pale matte bones sitting in wet red goo is the contrast
  // this effect lives on, and before this branch a bone row winning the fold
  // shaded as plain meat (the old bone-albedo branch was deleted with the
  // bone-tubes pack flag), which would have reddened the very skeleton the
  // melt exists to reveal.
  //
  // meltCfg.x is 0 everywhere except a melting body and its released bone
  // chunks, so every other pixel shades bit-identical to before this existed.
  let meltU = smoothstep(0.0, 1.0, clamp(gInstMelt.x * 2.0, 0.0, 1.0));
  // BONE EXPOSURE (body-to-gib rupture). A live body whose procedural skeleton
  // is folded bare (counts2.y, set while the flesh is pulled off it) has bones
  // winning the fold with no wound and no melt anywhere near, so the paleness
  // cannot ride meltU — that would require meltCfg.x > 0 and drag the skin
  // reddening and face sag of an actual melt onto a body that is being TORN,
  // not liquefied. bareBoneU is the separate, monotone "this row is exposed
  // bone" flag; the flesh branch below still runs only for a real melt.
  let bareBoneU = select(0.0, 1.0, gInstCounts2.y > 0.5);
  let bonePaleU = max(bareBoneU, meltU);
  if (isBone && bonePaleU > 0.0) {
    albedo = mix(albedo, boneColor, bonePaleU * 0.9);
  } else if (meltU > 0.0) {
    // Patchy, not uniform: skin sloughs in pieces. Each point crosses over
    // at its OWN progress, read off the rest-space anchor, and the patches
    // scaled past 1.0 by MELT_SKIN_KEEP never cross at all — so pink skin
    // survives in the finished puddle instead of everything staining red
    // together. See the constants for the owner's brief.
    // NB 'patch' is a RESERVED KEYWORD in WGSL — naming this variable that
    // compiles fine in TypeScript and fails the shader at runtime, which
    // renders the body invisible rather than erroring anywhere a test looks.
    let skinPatch = clamp(fbm(anchor * ${MELT_SKIN_PATCH_FREQ}) * ${MELT_SKIN_CONTRAST} * 0.5 + 0.5, 0.0, 1.0);
    let thresh = skinPatch * ${MELT_SKIN_KEEP};
    let local = smoothstep(thresh - ${MELT_SKIN_PATCH_SOFT}, thresh + ${MELT_SKIN_PATCH_SOFT}, meltU);
    albedo = mix(albedo, deepColor * 0.8, local * 0.8);
  }`;
