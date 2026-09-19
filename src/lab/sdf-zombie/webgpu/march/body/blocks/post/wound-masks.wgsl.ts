// src/lab/sdf-zombie/webgpu/march/body/blocks/post/wound-masks.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): wound and char masks, micro-detail normal (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const WOUND_MASKS_BLOCK = /* wgsl */ `  gWoundShadePrim = select(-1.0, f32(hitBest), hitBest >= 0 && hitBest < i32(gInstCounts.x));
  let wmBoth = woundMask(p, n, data, woundCfg, woundCfg2);
  let wm = wmBoth.x;      // colouring / wet / cavity shading
  let wmRim = wmBoth.y;   // fresnel fade, covers the lip
  let wmCav = wmBoth.z;   // cavity-ness: only wounds whose flags row opened one
  let cm = charMask(p, data, woundCfg);
  let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));
  // Run 4: hand the anchor + gate to the output-res detail pass (MARCH_ANCHOR_READ).
  gMarchAnchor = vec4<f32>(anchor, detailAmp);
  if (detailAmp > 0.0) {
    let detailNoise = vec3<f32>(
      fbm(anchor * 22.0), fbm(anchor * 22.0 + 5.0), fbm(anchor * 22.0 + 11.0));
    // Reuse the existing samples: Soldier wounds amplify their response into
    // shallow pits without another noise call or global change.
    let soldierPit = faceGlowRedOnly * smoothstep(0.08, 0.72, wm);
    n = normalize(n + detailNoise * detailAmp * mix(1.0, 1.45, soldierPit));
  }`;
