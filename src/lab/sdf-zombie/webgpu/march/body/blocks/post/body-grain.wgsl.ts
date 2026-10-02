// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md; plan
// docs/superpowers/plans/2026-10-02-body-grain.md): the face sheet's speckle on the rest of the body, in two
// octaves, post-hit. The constants and the arithmetic are body-grain.ts's (pure, tested); this is the same
// arithmetic per pixel, and body-grain.wgsl.test.ts pins that the named constants agree. Spliced into
// MARCH_TRACE_POST right after the face layer, so marchBody, refineBody and the deferred marchSurface all run it.
import {
  GRAIN_ALBEDO_SHARE, GRAIN_BASE_TONE, GRAIN_CELL_FINE, GRAIN_FADE_PX, GRAIN_RELIEF,
} from '../../../../../body-grain';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const BODY_GRAIN_BLOCK = /* wgsl */ `  // BODY GRAIN (body-grain.ts). The face sheet carries per-texel white
  // noise, nearest-filtered, so its grain is hard-edged cells about 3 mm
  // across; the body had only the smooth micro-detail fbm and read as
  // plastic beside it. This cuts the same kind of cell into the body: ONE
  // octave, face-sized, at full strength up close and faded out by the pixel
  // cone as the cell drops below about 1.5 SDF pixels, so it is never drawn
  // smaller than a pixel (where it would crawl as anything moves). There used
  // to be a coarse 1.2 cm octave behind it; the owner (2026-10-02) found that
  // it read as big pixels at the usual framings and wants small pitted pores
  // that simply disappear at distance, so it is gone (see body-grain.ts).
  // Every cell is cut in the REST-space anchor, like the mottle and the
  // micro-detail, so it rides its limb. Per cell, one hash gives an albedo
  // multiply, a fraction of the sheet's own swing (GRAIN_ALBEDO_SHARE: the
  // grain should read as relief, not as coloured squares), and the six
  // neighbouring cells' hashes give a normal tilt, the 3D twin of the face
  // relief's neighbour-texel luma differences, at the face's FULL relief gain.
  // Masked out where the face sheet covers the head (faceSheetCover, left by
  // the face layer above, so the face is not grained twice), on gloss and
  // metal as the micro-detail is, on painted prims (their colour is replaced
  // below anyway) and inside wounds (the tissue ramp owns the colour).
  // Rides gInstMelt.w, the per-instance record lane that applyMaterial fills
  // from the palette. 0, as in every preset, skips the block, so a body that
  // does not opt in shades exactly as it did before this existed. Post-hit
  // only, never in the walk or the field.
  let grainAmt = gInstMelt.w;
  if (grainAmt > 0.0) {
    // Cell edge in rest-space metres: body-grain.ts GRAIN_CELL_FINE
    // (body-grain.wgsl.test.ts pins that they agree).
    let grainCellFine = ${f(GRAIN_CELL_FINE)};
    // One SDF pixel at the hit, in metres: aaCfg.x is one pixel's footprint
    // radius per metre of distance.
    let grainPix = max(2.0 * t * aaCfg.x, 1e-6);
    // The cell fades from 2 pixels to 1.
    let grainFadeF = smoothstep(${f(GRAIN_FADE_PX.LO)}, ${f(GRAIN_FADE_PX.HI)}, grainCellFine / grainPix);
    let grainMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted) * clamp(1.0 - wm, 0.0, 1.0);
    let grainWF = grainFadeF * grainMask;
    // Seven hashes, none where the cell has faded out.
    if (grainWF > 0.0) {
      let grainCF = floor(anchor / grainCellFine);
      let grainDev = (hash13(grainCF) - 0.5) * grainWF;
      let grainGrad = grainWF * vec3<f32>(
        hash13(grainCF + vec3<f32>(1.0, 0.0, 0.0)) - hash13(grainCF - vec3<f32>(1.0, 0.0, 0.0)),
        hash13(grainCF + vec3<f32>(0.0, 1.0, 0.0)) - hash13(grainCF - vec3<f32>(0.0, 1.0, 0.0)),
        hash13(grainCF + vec3<f32>(0.0, 0.0, 1.0)) - hash13(grainCF - vec3<f32>(0.0, 0.0, 1.0)));
      albedo = albedo * (1.0 + grainDev * 2.0 * grainAmt * ${f(GRAIN_ALBEDO_SHARE)} / ${f(GRAIN_BASE_TONE)});
      // Negated, as the face relief is: a normal tilts away from rising
      // ground. Projected onto the tangent plane, so the whole vector tilts
      // rather than part of it lengthening the normal. The vector is in rest
      // axes, like the micro-detail's: the cells stay glued, only each
      // facet's direction stays world-fixed as a limb turns.
      let grainTilt = -grainGrad * (2.0 * grainAmt * ${f(GRAIN_RELIEF)});
      n = normalize(n + grainTilt - n * dot(grainTilt, n));
    }
  }`;
