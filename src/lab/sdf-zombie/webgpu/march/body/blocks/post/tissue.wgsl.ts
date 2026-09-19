// src/lab/sdf-zombie/webgpu/march/body/blocks/post/tissue.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): tissue-depth ramp and viscera (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const TISSUE_BLOCK = /* wgsl */ `  // Tissue depth rides mapBody's .w (the PRE-wound field). The ramp chooses
  // WHICH colour the wounded end of the lerp reaches for; wm remains the
  // sole authority on WHETHER this pixel is wounded. That composition is what
  // makes the ramp halo-safe by construction: at wm = 0 nothing it computes
  // can reach the albedo, so it has no edge to disagree with the mask's.
  //
  // surfCfg3 = (woundDepthAmp, fatDepth, muscleDepth, visceraAmp); the
  // select is the amplitude gate — woundDepthAmp 0 shades bit-for-bit as
  // before the ramp existed.
  //
  // Do NOT refactor this into a second mask. The 2026-08-23 crater pass split
  // one mask into three and cost two days to the resulting halo; the note above
  // WOUND_MASK is the record.
  let tissueDepth = max(0.0, -hitField.w) * surfCfg3.x;
  // Viscera (entrails): low-frequency fbm over the rest-space anchor lumps
  // the cavity colour so it reads as organs and not as noise. Lumped only
  // where it can be SEEN: inside a cavity wound, with the stop enabled. The
  // amplitude guard has to wrap the fbm, not just its result — guarding the
  // result leaves the cost on every pixel, which is the mistake that cost
  // the torn-fibre pass its life. 0 leaves the ramp shading bit-for-bit as
  // before entrails.
  var viscera = visceraColor;
  if (surfCfg3.w > 0.0 && wmCav > 0.0) {
    let lump = fbm(anchor * 2.5) * 0.5 + 0.5;
    viscera = visceraColor * mix(0.75, 1.25, lump);
  }
  let tissue = select(deepColor,
    tissueRamp(tissueDepth, baseColor, fatColor, deepColor, surfCfg3.y, surfCfg3.z,
      wmCav * surfCfg3.w, viscera, visceraDepth),
    surfCfg3.x > 0.0);
  var albedo = mix(baseColor, tissue, wm);`;
