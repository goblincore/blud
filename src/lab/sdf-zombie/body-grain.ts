//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md; plan
// docs/superpowers/plans/2026-10-02-body-grain.md). The face sheet's texture on the body: hard-edged noise cells
// cut in the hit's REST-space anchor, each a small albedo multiply and a normal tilt matched to the face sheet's own
// grain at the same `grain` value (FleshMaterial.grain, a palette line). Cells are face-sized and show up close, then
// fade out by the pixel cone as they drop below a pixel, so none is ever drawn smaller than a pixel, where it would
// crawl.
//
// ONE OCTAVE SINCE 2026-10-02 (owner, looking at lab turntable frames: "it looks like big pixels ... id rather just keep
// them small and if they disappear at distance that is fine, but it should be more like a bump map, like little
// pitted pores, which is what the ones on the face are like"). It used to be two octaves: the 3.5 mm cells, and a
// 12 mm coarse octave that took over as the fine cells dropped under ~1.5 pixels so the body stayed grainy at normal
// framings. At the usual 0.9-1.3 m the fine cells are already sub-pixel, so what the owner saw was the 12 mm coarse
// cells, hard-edged squares each swinging albedo by up to +-22%: "big pixels". The coarse octave is gone, and the
// albedo swing is now only GRAIN_ALBEDO_SHARE of the face's while the tilt (the relief) keeps the face's full strength,
// so it reads as pits, not as coloured squares. The body now has NO grain beyond ~0.9 m in the lab turntable (the
// fine cells' fade-out distance, see grainFadeDistances); that is the owner's stated preference.
//
// Pure data and arithmetic, no renderer. The WGSL block (webgpu/march/body/blocks/post/body-grain.wgsl.ts) names
// these constants in its text (its test pins that they agree) and does the same arithmetic per pixel; these
// functions are the reference the tests pin and the Rust port follows.
import type { Vec3 } from './types';

/**
 * The fine octave's cell edge, rest-space metres. The goblin's face texel is 3.1 x 3.7 mm: the face projection
 * normalises head space by the skull's semi-axes (0.118 x 0.76 = 0.0897 m wide, 0.118 x 1.161 = 0.137 m tall) and
 * maps it onto 64 texels at projScale 0.45 / 0.58, so a texel is 0.0897 / (64 x 0.45) = 3.11 mm by
 * 0.137 / (64 x 0.58) = 3.69 mm. 3.5 mm sits between, so face and body speckle at one scale up close.
 */
export const GRAIN_CELL_FINE = 0.0035;

/** The face sheet's base tone: blob-face-sheet.ts draws plain skin as 0.46 + (hash - 0.5) x 2 x grain, and the
 *  face multiplies albedo by the texel over its level, so the relative swing is 2 x grain / 0.46. */
export const GRAIN_BASE_TONE = 0.46;

/** The face relief's gain at its default (DEFAULT_SHEET.texRelief, faceCfg.w). The body has no relief knob of its
 *  own: `grain` alone sets both the colour swing and the tilt, as it does on the face. */
export const GRAIN_RELIEF = 1.4;

/** The pixel-cone fade, in SDF pixels per cell: the grain is absent at or below LO and full at or above HI,
 *  smoothstep between (midpoint 1.5 px, the spec's "about 1.5 pixels"). */
export const GRAIN_FADE_PX = { LO: 1.0, HI: 2.0 } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const s = clamp01((x - lo) / (hi - lo));
  return s * s * (3 - 2 * s);
};

/** The integer cell a rest-space point falls in, for a cell edge of cellM metres. */
export function grainCell(anchor: Vec3, cellM: number): Vec3 {
  return [Math.floor(anchor[0] / cellM), Math.floor(anchor[1] / cellM), Math.floor(anchor[2] / cellM)];
}

/** One SDF pixel at hit distance t, in metres. pixelConeK is aaCfg.x, tan(fovY / 2) / SDF height: one pixel's
 *  footprint RADIUS per metre, so a pixel spans 2 x t x k. Floored so t = 0 cannot divide by zero. */
export function grainPixelM(t: number, pixelConeK: number): number {
  return Math.max(2 * t * pixelConeK, 1e-6);
}

/** The grain's fade at hit distance t, before the mask: absent at or below one SDF pixel per cell, full at or above
 *  two, smoothstep between (midpoint 1.5 px, the spec's "about 1.5 pixels"). */
export function grainFade(t: number, pixelConeK: number): number {
  return smoothstep(GRAIN_FADE_PX.LO, GRAIN_FADE_PX.HI, GRAIN_CELL_FINE / grainPixelM(t, pixelConeK));
}

/** Where a grain with cell edge cellM is at full weight (out to `full`), half (`half`) and gone (beyond `none`),
 *  in metres of hit distance, for pixel cone k. */
export function grainFadeDistances(cellM: number, pixelConeK: number): { full: number; half: number; none: number } {
  const at = (px: number) => cellM / (2 * px * pixelConeK);
  return {
    full: at(GRAIN_FADE_PX.HI),
    half: at((GRAIN_FADE_PX.LO + GRAIN_FADE_PX.HI) / 2),
    none: at(GRAIN_FADE_PX.LO),
  };
}

/** Everything that turns the grain off at a hit, each 0..1 (BODY_GRAIN_BLOCK's grainMask). */
export interface GrainMasks {
  /** The face sheet's coverage at the hit: facing x alpha where the sheet is sampled, else 0. */
  faceSheetCover: number;
  gloss: number;
  metal: number;
  /** 1 on a painted (color=) prim, whose albedo the paint pass replaces anyway. OPTIONAL for the owner. */
  painted: number;
  /** The wound mask (wm): inside a wound the tissue ramp owns the colour. OPTIONAL for the owner. */
  wound: number;
}

export function grainMask(m: GrainMasks): number {
  return (1 - m.faceSheetCover) * (1 - Math.max(m.gloss, m.metal)) * (1 - m.painted) * clamp01(1 - m.wound);
}

/** The share of the face sheet's colour swing the body takes. The face varies albedo AND carries relief; the owner
 *  wants the body's grain to read as little pitted pores (relief), not coloured squares, so the colour swing is a
 *  third of the face's while the tilt below keeps the face's full strength. Eyeballed in the turntable. */
export const GRAIN_ALBEDO_SHARE = 0.35;

/** The albedo multiplier at a hit whose cell hash is h (0..1) and weight w (fade x mask):
 *  1 + (h - 0.5) x w x 2 x grain / 0.46 x GRAIN_ALBEDO_SHARE. Mean 1; at most +-7.6% at grain 0.10. */
export function grainAlbedoScale(h: number, w: number, grain: number): number {
  return 1 + (h - 0.5) * w * 2 * grain / GRAIN_BASE_TONE * GRAIN_ALBEDO_SHARE;
}

/** The scale on the weighted neighbour-hash gradient (each component at most 1 in size) that gives the
 *  normal tilt, before projection onto the tangent plane. 0.28 at grain 0.10, the face relief's most. */
export function grainTiltScale(grain: number): number {
  return 2 * grain * GRAIN_RELIEF;
}
