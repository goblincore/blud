// src/lab/sdf-zombie/webgpu/march/body/blocks/post/wound-masks.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): wound and char masks, micro-detail normal (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { SPLIT_SHADE } from '../../../../../head-split';

export const WOUND_MASKS_BLOCK = /* wgsl */ `  gWoundShadePrim = select(-1.0, f32(hitBest), hitBest >= 0 && hitBest < i32(gInstCounts.x));
  // The cut mask's back-facing gate takes the SMOOTH normal (nSmooth, SKIN_NORMAL): pore noise in n speckled its edge.
  // THE HEAD SPLIT: the wounds are stamped on the closed head, so the masks are read at the hit piece's un-warped
  // point pS with that normal turned into the piece's frame (split-hit.wgsl.ts; p and nSmooth off a turned half).
  var nSmoothS = nSmooth;
  if (splitTheta != 0.0) { nSmoothS = qRot(vec4<f32>(-splitQ.xyz, splitQ.w), nSmooth); }
  var wmBoth = woundMask(pS, nSmoothS, data, woundCfg, woundCfg2);
  var cm = charMask(pS, data, woundCfg);
  // A CUT FACE (cutFace, split-hit.wgsl.ts) is the inside of the closed body laid open: wound interior all over, so
  // the one mask is raised to it (.xy; the tissue ramp, the wet boost and the fresnel fade follow, as in any wound),
  // and the cavity share a wound of the closed body throws THROUGH the solid at pS is dropped (.z). The vector is
  // edited before it is taken apart, so each mask below is still assigned once and keeps the sinks it had.
  // The rest of a cut face's look is one block after the tissue ramp: cut-face.wgsl.ts.
  if (cutFace > 0.0) {
    wmBoth = vec3<f32>(max(wmBoth.xy, vec2<f32>(cutFace)), wmBoth.z * (1.0 - cutFace));
  }
  let wm = wmBoth.x;      // colouring / wet / cavity shading
  let wmRim = wmBoth.y;   // fresnel fade, covers the lip
  let wmCav = wmBoth.z;   // cavity-ness: only wounds whose flags row opened one
  let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));
  // Run 4: hand the anchor + gate to the output-res detail pass (MARCH_ANCHOR_READ).
  // The detail is skin pores, so there is none on a cut face (SPLIT_SHADE.poreCut), in that pass or here.
  gMarchAnchor = vec4<f32>(anchor, select(detailAmp, 0.0, cutFace >= ${SPLIT_SHADE.poreCut}));
  if (detailAmp > 0.0 && cutFace < ${SPLIT_SHADE.poreCut}) {
    let detailNoise = vec3<f32>(
      fbm(anchor * 22.0), fbm(anchor * 22.0 + 5.0), fbm(anchor * 22.0 + 11.0));
    // Reuse the existing samples: Soldier wounds amplify their response into
    // shallow pits without another noise call or global change.
    let soldierPit = faceGlowRedOnly * smoothstep(0.08, 0.72, wm);
    n = normalize(n + detailNoise * detailAmp * mix(1.0, 1.45, soldierPit));
  }`;
