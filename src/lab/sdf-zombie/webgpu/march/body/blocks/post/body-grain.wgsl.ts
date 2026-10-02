// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md; plan
// docs/superpowers/plans/2026-10-02-body-grain.md): the face sheet's speckle on the rest of the body, in two
// octaves, post-hit. The constants and the arithmetic are body-grain.ts's (pure, tested); this is the same
// arithmetic per pixel, and body-grain.wgsl.test.ts pins that the named constants agree. Spliced into
// MARCH_TRACE_POST right after the face layer, so marchBody, refineBody and the deferred marchSurface all run it.
import {
  GRAIN_BASE_TONE, GRAIN_CELL_COARSE, GRAIN_CELL_FINE, GRAIN_COARSE_LATTICE_OFFSET, GRAIN_FADE_PX, GRAIN_RELIEF,
} from '../../../../../body-grain';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const BODY_GRAIN_BLOCK = /* wgsl */ `  // BODY GRAIN (body-grain.ts). The face sheet carries per-texel white
  // noise, nearest-filtered, so its grain is hard-edged cells about 3 mm
  // across; the body had only the smooth micro-detail fbm and read as
  // plastic beside it. This cuts the same kind of cell into the body, in TWO
  // OCTAVES of one grain:
  //   - fine cells the size of a face texel, at full strength up close, where
  //     they match the face;
  //   - coarse cells about 1.2 cm across, which take over as the fine cells
  //     drop below about 1.5 SDF pixels, so the body stays grainy at the usual
  //     framings and no octave is ever drawn below a pixel (where it would
  //     crawl as anything moves).
  // Every cell is cut in the REST-space anchor, like the mottle and the
  // micro-detail, so it rides its limb. Per cell, one hash gives an albedo
  // multiply in the sheet's own units (plain skin on the sheet is base +
  // (hash - 0.5) * 2 * grain, and the face divides by its level), and the six
  // neighbouring cells' hashes give a normal tilt, the 3D twin of the face
  // relief's neighbour-texel luma differences, at the face's default relief
  // gain.
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
    // Cell edges in rest-space metres: body-grain.ts GRAIN_CELL_FINE and
    // GRAIN_CELL_COARSE (body-grain.wgsl.test.ts pins that they agree).
    let grainCellFine = ${f(GRAIN_CELL_FINE)};
    let grainCellCoarse = ${f(GRAIN_CELL_COARSE)};
    // One SDF pixel at the hit, in metres: aaCfg.x is one pixel's footprint
    // radius per metre of distance.
    let grainPix = max(2.0 * t * aaCfg.x, 1e-6);
    // Each octave fades as its cell drops from 2 pixels to 1. The coarse one
    // is weighted by what the fine one has lost: up close the fine weight is
    // 1 and the coarse adds nothing. The coarse cell is at least twice the
    // fine one (a test pins it), so it is still at full weight wherever the
    // fine one fades, and the two sum to 1 until the coarse starts its own fade.
    let grainFadeF = smoothstep(${f(GRAIN_FADE_PX.LO)}, ${f(GRAIN_FADE_PX.HI)}, grainCellFine / grainPix);
    let grainFadeC = (1.0 - grainFadeF) * smoothstep(${f(GRAIN_FADE_PX.LO)}, ${f(GRAIN_FADE_PX.HI)}, grainCellCoarse / grainPix);
    let grainMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted) * clamp(1.0 - wm, 0.0, 1.0);
    let grainWF = grainFadeF * grainMask;
    let grainWC = grainFadeC * grainMask;
    // Summed over the octaves, each scaled by its weight: the cell's hash
    // deviation from 0.5, and its neighbour-hash gradient. The weights sum to
    // at most 1, so the colour never swings further than one octave at full
    // weight, and the tilt never further than the face relief's.
    var grainDev = 0.0;
    var grainGrad = vec3<f32>(0.0);
    // Each octave's hashes sit behind its own weight: 7 per drawn octave, 14
    // only where the two cross-fade, none beyond both fades.
    if (grainWF > 0.0) {
      let grainCF = floor(anchor / grainCellFine);
      grainDev = grainDev + (hash13(grainCF) - 0.5) * grainWF;
      grainGrad = grainGrad + grainWF * vec3<f32>(
        hash13(grainCF + vec3<f32>(1.0, 0.0, 0.0)) - hash13(grainCF - vec3<f32>(1.0, 0.0, 0.0)),
        hash13(grainCF + vec3<f32>(0.0, 1.0, 0.0)) - hash13(grainCF - vec3<f32>(0.0, 1.0, 0.0)),
        hash13(grainCF + vec3<f32>(0.0, 0.0, 1.0)) - hash13(grainCF - vec3<f32>(0.0, 0.0, 1.0)));
    }
    if (grainWC > 0.0) {
      // Offset onto its own stretch of the hash lattice, so a coarse cell
      // never shares a hash with a fine cell whose index coincides.
      let grainCC = floor(anchor / grainCellCoarse) + vec3<f32>(${f(GRAIN_COARSE_LATTICE_OFFSET)});
      grainDev = grainDev + (hash13(grainCC) - 0.5) * grainWC;
      grainGrad = grainGrad + grainWC * vec3<f32>(
        hash13(grainCC + vec3<f32>(1.0, 0.0, 0.0)) - hash13(grainCC - vec3<f32>(1.0, 0.0, 0.0)),
        hash13(grainCC + vec3<f32>(0.0, 1.0, 0.0)) - hash13(grainCC - vec3<f32>(0.0, 1.0, 0.0)),
        hash13(grainCC + vec3<f32>(0.0, 0.0, 1.0)) - hash13(grainCC - vec3<f32>(0.0, 0.0, 1.0)));
    }
    if (grainWF + grainWC > 0.0) {
      albedo = albedo * (1.0 + grainDev * 2.0 * grainAmt / ${f(GRAIN_BASE_TONE)});
      // Negated, as the face relief is: a normal tilts away from rising
      // ground. Projected onto the tangent plane, so the whole vector tilts
      // rather than part of it lengthening the normal. The vector is in rest
      // axes, like the micro-detail's: the cells stay glued, only each
      // facet's direction stays world-fixed as a limb turns.
      let grainTilt = -grainGrad * (2.0 * grainAmt * ${f(GRAIN_RELIEF)});
      n = normalize(n + grainTilt - n * dot(grainTilt, n));
    }
  }`;
