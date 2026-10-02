//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md; plan
// docs/superpowers/plans/2026-10-02-body-grain.md). The face sheet's texture on the body, in two octaves of one
// grain: hard-edged noise cells cut in the hit's REST-space anchor, each an albedo multiply and a normal tilt matched
// to the face sheet's own grain at the same `grain` value (FleshMaterial.grain, a palette line). Fine cells are
// face-sized and show up close; coarse cells take over as the fine ones drop below about 1.5 pixels, so the body
// stays textured farther out and no octave is ever drawn below a pixel, where it would crawl.
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

/**
 * The coarse octave's cell edge, rest-space metres: a 3.4x step from the fine one. In the lab turntable
 * (k = 0.00203) it is full out to 1.48 m (so the owner's 1.35 m framing shows it at full strength, 2.3 px cells),
 * half at 1.97 m and gone beyond 2.96 m. 0.016 would reach 3.9 m with chunkier cells; tuned on the owner's frames.
 * Must stay at least GRAIN_FADE_PX.HI / LO times GRAIN_CELL_FINE, so it is at full weight wherever the fine fades.
 */
export const GRAIN_CELL_COARSE = 0.012;

/** Added to the coarse octave's cell index before hashing, so its cells read their own stretch of the hash lattice:
 *  within 2 m of the rest origin the fine indices stay inside +-572 and the coarse ones inside 833..1167. */
export const GRAIN_COARSE_LATTICE_OFFSET = 1000;

/** The face sheet's base tone: blob-face-sheet.ts draws plain skin as 0.46 + (hash - 0.5) x 2 x grain, and the
 *  face multiplies albedo by the texel over its level, so the relative swing is 2 x grain / 0.46. */
export const GRAIN_BASE_TONE = 0.46;

/** The face relief's gain at its default (DEFAULT_SHEET.texRelief, faceCfg.w). The body has no relief knob of its
 *  own: `grain` alone sets both the colour swing and the tilt, as it does on the face. */
export const GRAIN_RELIEF = 1.4;

/** The pixel-cone fade, in SDF pixels per cell: an octave is absent at or below LO and full at or above HI,
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

/** The two octaves' fades at hit distance t, before the masks: the fine one by its own pixel size, the coarse one
 *  by its pixel size times what the fine one has lost. Up close (fine 1) the coarse adds nothing. */
export function grainOctaveFades(t: number, pixelConeK: number): { fine: number; coarse: number } {
  const pix = grainPixelM(t, pixelConeK);
  const fine = smoothstep(GRAIN_FADE_PX.LO, GRAIN_FADE_PX.HI, GRAIN_CELL_FINE / pix);
  const coarse = (1 - fine) * smoothstep(GRAIN_FADE_PX.LO, GRAIN_FADE_PX.HI, GRAIN_CELL_COARSE / pix);
  return { fine, coarse };
}

/** Where an octave with cell edge cellM is at full weight (out to `full`), half (`half`) and gone (beyond `none`),
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

/** One drawn octave at a hit: its cell's hash h (0..1) and its weight w (fade x mask). */
export interface GrainOctaveSample {
  h: number;
  w: number;
}

/** The albedo multiplier: 1 + 2 x grain / 0.46 x sum over octaves of (h - 0.5) x w. The weights sum to at most 1,
 *  so it never swings further than one octave at full weight (+-21.7% at grain 0.10); its mean is 1. */
export function grainAlbedoScale(octaves: readonly GrainOctaveSample[], grain: number): number {
  let dev = 0;
  for (const o of octaves) dev += (o.h - 0.5) * o.w;
  return 1 + dev * 2 * grain / GRAIN_BASE_TONE;
}

/** The scale on the summed, weighted neighbour-hash gradient (each component at most 1 in size) that gives the
 *  normal tilt, before projection onto the tangent plane. 0.28 at grain 0.10, the face relief's most. */
export function grainTiltScale(grain: number): number {
  return 2 * grain * GRAIN_RELIEF;
}
