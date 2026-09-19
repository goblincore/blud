// src/lab/sdf-zombie/webgpu/march/body/blocks/post/soldier-meat.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): soldier wound stain and meat detail (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

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
  if (soldierWound > 0.0 && meatAmp > 0.0) {
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
  }
  albedo = mix(albedo, gooRed, soldierWound * 0.72);`;
