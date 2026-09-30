// src/lab/sdf-zombie/webgpu/march/body/blocks/post/soldier-meat.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): soldier wound stain and meat detail (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

import { TORN, WET_LIP_LOOK } from '../../../../../torn-lips';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const SOLDIER_MEAT_BLOCK = /* wgsl */ `  // Soldier-only wet blood stain. This uses the existing character flag and
  // the one authoritative wound mask, so it affects head and torso lips while
  // leaving Zombie, panel overrides, carve depth and gameplay untouched.
  let soldierWound = faceGlowRedOnly * smoothstep(0.02, 0.62, wm);
  var gooRed = mix(vec3<f32>(0.52, 0.006, 0.009), vec3<f32>(0.16, 0.001, 0.003), smoothstep(surfCfg3.y, surfCfg3.z * 2.2, tissueDepth));
  // MEAT DETAIL (owner 2026-09-12: the revealed flesh "reads as a smooth blobby red"). The stain
  // above was ONE colour ramp; this breaks it into flesh. Everything keys off anchor (rest space,
  // so nothing swims) and is gated on soldierWound > 0 so unwounded pixels pay nothing — the fbm
  // must sit inside the gate, not just its result (the torn-fibre lesson). Deliberately STRONG:
  // the r2 torn-fibre pass was cut as "rather subtle" at its ceiling; a wound has to read at
  // 400x300 through the upscaler, which averages fine detail away.
  //   clot     high-frequency speckle: sparse near-black clots in the arterial red
  //   fibre    striation along the rest-space Y axis, muscle only (deeper tissue)
  //   crevice  darkening where the carve is deepest (tissueDepth) — the wound reads recessed
  //   glint    a second noise that BREAKS the wet highlight into glints (applied in SURFACE_PREP)
  // meatCfg (wound panel, MEAT group): x amp (0 = the old flat stain), y clot strength, z glint
  // range, w crevice darkening. All 1 = the shipped look.
  let meatAmp = meatCfg.x;
  var woundGlint = 1.0;
  // The smooth ramp before the meat detail: a torn LIP takes this (wet and glossy, no clot speckle).
  let gooRedSmooth = gooRed;
  // TORN LIPS (flail, spec §14.2, 2026-09-29): gWoundTear is WOUND_MASK's footprint over the
  // tear-flagged wounds only (flags.x bit 3), so tornWound is 0 on every other pixel and the
  // max() below is exactly soldierWound there. A torn wound takes the same meat detail and
  // the same gooRed family as a soldier's wound, on ANY character. Bone and organs keep their
  // own material (the bone must still read pale in the crater).
  // hitField.w is the PRE-wound field: > 0 on the everted lip (its height above the old skin), < 0
  // inside the tear. The red is strongest on real torn flesh (lip or inside); the untouched skin
  // under the footprint's fade keeps only a smear, so the colour edge is the tear's, not a halo.
  let tornLift = smoothstep(0.0, ${f(TORN.LIP_LIFT)}, hitField.w);
  let tornFlesh = max(tornLift, smoothstep(0.0, ${f(TORN.LIP_LIFT)}, -hitField.w));
  let tornWound = smoothstep(0.02, 0.62, gWoundTear) * mix(${f(TORN.SKIN_SMEAR)}, 1.0, tornFlesh) * select(1.0, 0.0, isBone || isOrgan);
  // WET LIP (gun craters, flags bit 4 without bit 3; plan Task 35): the share of this pixel's
  // torn-family shading owed to a wet-lip-only crater. 0 wherever no such crater reaches (every
  // torn and stock pixel), so the mixes below are exact identities there.
  let wetOnly = clamp(gWoundWetOnly / max(gWoundTear, 1e-4), 0.0, 1.0);
  if (max(soldierWound, tornWound) > 0.0 && meatAmp > 0.0) {
    let muscle = smoothstep(surfCfg3.y, surfCfg3.z * 2.2, tissueDepth);
    let crevice = smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
    let clot = fbm(anchor * 38.0) * 0.5 + 0.5;
    let clotDark = clamp(smoothstep(0.45, 0.75, clot) * meatAmp * meatCfg.y, 0.0, 1.0);
    let fibre = (fbm(anchor * vec3<f32>(9.0, 64.0, 9.0)) * 0.5 + 0.5) * meatAmp;
    let glintN = fbm(anchor * 57.0 + 3.0) * 0.5 + 0.5;
    // Arterial glaze on the lip (brighter, redder), clotted and striated further in.
    gooRed = gooRed + vec3<f32>(0.16, 0.006, 0.006) * (1.0 - muscle) * (1.0 - clot) * meatAmp;
    gooRed = gooRed * mix(1.0, 0.18, clotDark);
    gooRed = gooRed * mix(1.0, mix(0.55, 1.45, fibre), muscle);
    gooRed = gooRed * (1.0 - clamp(crevice * 0.65 * meatAmp * meatCfg.w, 0.0, 0.95));
    // Wet highlight shattered into glints: 0.25..2.1 of the wound wetness by a fine noise (owner:
    // overdo it), and dull on clots. (specPow itself is pinned to one shared definition, so the
    // tight-vs-broad difference is carried by wetness alone.)
    woundGlint = mix(1.0, mix(1.0 - 0.75 * meatCfg.z, 1.0 + 1.1 * meatCfg.z, smoothstep(0.35, 0.72, glintN)) * mix(1.0, 0.35, clotDark), meatAmp);
    // A crater's wet lip keeps one wet highlight, not shattered glints (WET_LIP_LOOK).
    woundGlint = mix(woundGlint, 1.0, wetOnly * ${f(WET_LIP_LOOK.GLINT_CALM)});
  }
  albedo = mix(albedo, gooRed, soldierWound * 0.72);
  // Torn: the lip goes wet red (gooRed's bright arterial end — tissueDepth is 0 on the everted
  // lip), the walls a glossy red, and the floor the clotted dark the meat detail's crevice term
  // leaves there, deepened toward deepColor's clot so the bottom of the tear reads as a hole.
  if (tornWound > 0.0) {
    let tornFloor = smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
    let tornWall = smoothstep(0.0, surfCfg3.y, tissueDepth);
    // The lip's crest is the bright arterial end, its foot darker: the petal reads as a raised roll.
    // A crater's walls (wet lip only) take most of the smooth arterial ramp: wet red, not speckle.
    let tornWallRed = mix(gooRed, gooRedSmooth, wetOnly * ${f(WET_LIP_LOOK.WALL_SMOOTH)});
    let tornMeat = mix(gooRedSmooth * mix(${f(TORN.LIP_FOOT)}, mix(1.15, ${f(WET_LIP_LOOK.LIP_CREST)}, wetOnly), tornLift), tornWallRed, tornWall);
    let tornRed = mix(tornMeat, min(tornMeat, deepColor * 0.35), tornFloor * ${f(TORN.FLOOR_CLOT)});
    albedo = mix(albedo, tornRed, tornWound * ${f(TORN.RED)});
  }`;
