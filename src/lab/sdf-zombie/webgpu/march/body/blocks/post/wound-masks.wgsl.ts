// src/lab/sdf-zombie/webgpu/march/body/blocks/post/wound-masks.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): wound and char masks, micro-detail normal (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const WOUND_MASKS_BLOCK = /* wgsl */ `  gWoundShadePrim = select(-1.0, f32(hitBest), hitBest >= 0 && hitBest < i32(gInstCounts.x));
  // The cut mask's back-facing gate takes the SMOOTH normal (nSmooth, SKIN_NORMAL): pore noise in n speckled its edge.
  // THE HEAD SPLIT: the wounds are stamped on the closed head, so the masks are read at the hit piece's un-warped
  // point pS with that normal turned into the piece's frame (split-hit.wgsl.ts; p and nSmooth off a turned half).
  var nSmoothS = nSmooth;
  if (splitTheta != 0.0) { nSmoothS = qRot(vec4<f32>(-splitQ.xyz, splitQ.w), nSmooth); }
  let wmBoth = woundMask(pS, nSmoothS, data, woundCfg, woundCfg2);
  var wm = wmBoth.x;      // colouring / wet / cavity shading
  var wmRim = wmBoth.y;   // fresnel fade, covers the lip
  var wmCav = wmBoth.z;   // cavity-ness: only wounds whose flags row opened one
  var cm = charMask(pS, data, woundCfg);
  // A CUT FACE (cutFace, split-hit.wgsl.ts) is the inside of the closed body laid open: wound interior all over, so
  // the one mask is raised to it (the tissue ramp, the wet boost and the fresnel fade follow, as in any wound). What
  // the masks found at pS is not on this surface: the footprints the closed body's wounds and burns throw THROUGH the
  // solid (a cavity's viscera, a tear's red, a cloth mark, char) are dropped.
  if (cutFace > 0.0) {
    wm = max(wm, cutFace);
    wmRim = max(wmRim, cutFace);
    wmCav = wmCav * (1.0 - cutFace);
    cm = cm * (1.0 - cutFace);
    gWoundTear = gWoundTear * (1.0 - cutFace);
    gWoundWetOnly = gWoundWetOnly * (1.0 - cutFace);
    gWoundHole = gWoundHole * (1.0 - cutFace);
    gClothMark = gClothMark * (1.0 - cutFace);
    gClothStain = gClothStain * (1.0 - cutFace);
  }
  let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));
  // Run 4: hand the anchor + gate to the output-res detail pass (MARCH_ANCHOR_READ).
  // The detail is skin pores, so there is none on a cut face, in that pass or here.
  gMarchAnchor = vec4<f32>(anchor, select(detailAmp, 0.0, cutFace >= 0.5));
  if (detailAmp > 0.0 && cutFace < 0.5) {
    let detailNoise = vec3<f32>(
      fbm(anchor * 22.0), fbm(anchor * 22.0 + 5.0), fbm(anchor * 22.0 + 11.0));
    // Reuse the existing samples: Soldier wounds amplify their response into
    // shallow pits without another noise call or global change.
    let soldierPit = faceGlowRedOnly * smoothstep(0.08, 0.72, wm);
    n = normalize(n + detailNoise * detailAmp * mix(1.0, 1.45, soldierPit));
  }`;
