// src/lab/sdf-zombie/webgpu/march/body/blocks/post/melt.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): melt and bare-bone paling (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { MELT_RED_CREEP, MELT_RED_DEPTH, MELT_RED_FULL_U, MELT_RED_PURITY, MELT_SKIN_CONTRAST, MELT_SKIN_KEEP, MELT_SKIN_PATCH_FREQ, MELT_SKIN_PATCH_SOFT, MELT_SKIN_RED, MELT_SKIN_STREAK } from '../../../melt';
import { MELT_TUNING_BODY } from '../../../../../melt';
import { ROW_PRIM_A, ROW_REST_A } from '../../../layout';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${+v.toFixed(5)}`);

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
  // this effect lives on. (This branch was written while the organ block's
  // bone albedo was deleted; that albedo is back, 2026-09-28, and this pulls
  // the bone the rest of the way to the unstained boneColor.)
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
  // How far THIS point has gone over to the red (0 on intact skin, on bone and off a melt). The wet block reads it:
  // only the sloughed patches glisten. The whole body going glossy at once washed the intact skin white under the
  // game's lights (owner, 2026-11-14: "it should just look like the normal flesh" with red patches appearing).
  var meltRed = 0.0;
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
    // WHERE IT IS RED FOLLOWS WHERE IT IS MELTING (owner, 2026-11-14: the old ramp ran on the body's progress at
    // twice the sag rate, so the whole body broke into patches before anything moved, "a weird shimmery pixely
    // effect happening before the melt"). The hit prim's own melt is readable with no new lane: applyMelt
    // (melt.ts) swells its radius by shrink^-swell and the rest row keeps the radius it had, so the ratio gives
    // back shrink, and shrink is lerp(1, crush, u). A pixel with no dominant prim keeps the body's progress.
    var primU = meltU;
    if (hitBest >= 0) {
      let restR = textureLoad(data, vec2<i32>(hitBest, ${ROW_REST_A} + gBand), 0).w;
      let nowR = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_A} + gBand), 0).w;
      if (restR > 0.0 && nowR > 0.0) {
        let shrink = pow(clamp(restR / nowR, 0.0, 1.0), ${f(1 / MELT_TUNING_BODY.swell)});
        primU = clamp((1.0 - shrink) / ${f(1 - MELT_TUNING_BODY.crush)}, 0.0, 1.0);
      }
    }
    // ...plus a slow creep on the body's progress, capped at CREEP: a few streaks open all over while the feet
    // go, and each part goes fully red only as it starts to run.
    let redU = max(smoothstep(0.0, ${MELT_RED_FULL_U}, primU), clamp(gInstMelt.x * ${f(MELT_RED_CREEP * 1.3)}, 0.0, ${MELT_RED_CREEP}));
    // STREAKS, not blotches: the patch field is stretched along the body's rest height, so what crosses over
    // first is runs down the flesh. The anchor is the UNMELTED rest point (the melt uploads the rest rows as they
    // were), so the streaks are pinned to the flesh and ride it down; on melted rest rows they swam.
    let skinPatch = clamp(fbm(anchor * vec3<f32>(${MELT_SKIN_PATCH_FREQ}, ${f(MELT_SKIN_PATCH_FREQ * MELT_SKIN_STREAK)}, ${MELT_SKIN_PATCH_FREQ})) * ${MELT_SKIN_CONTRAST} * 0.5 + 0.5, 0.0, 1.0);
    let thresh = skinPatch * ${MELT_SKIN_KEEP};
    // The soft edge sits wholly ABOVE the threshold, and the ramp is scaled to still clear it: centred on the
    // threshold, the lowest patches were already half red at ramp 0, so the body blotched on the first frame.
    let local = smoothstep(thresh, thresh + ${f(2 * MELT_SKIN_PATCH_SOFT)}, redU * ${f(1 + 2 * MELT_SKIN_PATCH_SOFT)});
    albedo = mix(albedo, deepColor * vec3<f32>(${MELT_RED_DEPTH}, ${MELT_RED_PURITY}, ${MELT_RED_PURITY}), local * ${MELT_SKIN_RED});
    meltRed = local;
  }`;
