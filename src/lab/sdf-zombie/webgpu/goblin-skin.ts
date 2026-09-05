// src/lab/sdf-zombie/webgpu/goblin-skin.ts
//
// The player is the goblin, so its hands must be the goblin's colour and
// texture. Every value here is lifted from characters/goblin.blob's palette
// block rather than picked by eye -- the shipped orbs were 0x5a8f3c at
// roughness 0.85, which is much darker and more saturated than the creature
// has ever been, and 0.055 radius against the .blob's 0.046.
//
// The maps are GENERATED, not baked, for the same reason hands-sheet.ts keeps a
// procedural fallback: deterministic, testable by pixel comparison, live
// tunable, and no load path to fail. Promotable to a baked PNG later.

/** goblin.blob palette + `blob arm on hand at=0.55 r=0.046`. */
export const GOBLIN_SKIN = {
  /** LINEAR rgb, exactly `baseColor 0.34 0.44 0.19`. */
  baseLinear: [0.34, 0.44, 0.19] as const,
  /** `specRoughness 0.42` -- clammy, not the orbs' matte 0.85. */
  roughness: 0.42,
  /** `blob arm on hand at=0.55 r=0.046`. */
  handRadius: 0.046,
  /** Forearm: `bar arm on forearm ... r=0.028`, elbow blob `r=0.038`,
   *  `bone forearm ... len=0.235`. */
  forearmRadius: 0.028,
  forearmElbowRadius: 0.038,
  forearmLength: 0.235,
  /** `mottleScale 1.6` -- "patches a hand-span across, not freckles". The
   *  shader's fbm multiplies its own input by 4 and 9, so this is about a
   *  quarter of the frequency it reads like; matched here by eye to that. */
  mottleScale: 1.6,
  /** `mottleAmp 0.65`. */
  mottleAmp: 0.65,
  /** `mottleColor 0.21 0.19 0.06` -- the patch colour, LINEAR rgb. */
  mottleColorLinear: [0.21, 0.19, 0.06] as const,
  /** `charColor 0.06 0.07 0.05` -- the darkest flesh tone; the FPV fleck
   *  layer mixes toward it. */
  charColorLinear: [0.06, 0.07, 0.05] as const,
  /** FPV TONE. The marched goblin (its own shader: specIntensity 0.52,
   *  wetness 0.55, a hard key) reads as a SATURATED, contrasty green with a
   *  wet sheen; a PBR material handed the raw palette under the gun's room
   *  environment read pale and washed (the owner's first look), and a plain
   *  darkening read as matte olive (the second). So the FPV albedo is the
   *  palette pushed AWAY from grey by fpvSaturation and scaled by
   *  fpvExposure -- matched by eye to the character render, not derived. */
  fpvExposure: 0.86,
  fpvSaturation: 1.35,
  /** FPV finish: close to the blob's specRoughness 0.42 -- the goblin is
   *  wet-shiny, and that sheen is most of what "looks like the face" means.
   *  (0.68 was tried for "rougher" and read as dull olive rubber.) */
  fpvRoughness: 0.46,
  /** Fraction of the gun's envMapIntensity the skin takes. At the gun's full
   *  1.1 the sheen went white and flattened the colour. */
  fpvEnvShare: 0.55,
  /** Normal-map strength in FPV: pushed so warts and mottle read as texture
   *  at arm's length. */
  fpvNormalScale: 2.0,
  /** THE SPECKLE the face has: sparse, fine dark flecks. Lattice cells per
   *  tile (a fleck is about a cell wide: 60 mm / 24 = 2.5 mm), the noise
   *  threshold above which a texel is a fleck, and how far a fleck mixes
   *  toward charColor. Tuned so flecks cover ~8-12% of the skin. */
  fleckCells: 24,
  fleckThreshold: 0.80,
  fleckMix: 0.70,
  /** How far the warts push the normal. Tuned so the silhouette stays smooth
   *  AND every texel's blue byte stays >= 160 with the seams agreeing -- the
   *  plan's contingency for the normal-map tests (lower until z dominates). */
  bumpStrength: 0.42,
} as const;

function linearToSrgbByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** The goblin's skin as a packed sRGB hex, for a THREE material `color`. */
export function goblinSkinSrgbHex(): number {
  const [r, g, b] = GOBLIN_SKIN.baseLinear;
  return (linearToSrgbByte(r) << 16) | (linearToSrgbByte(g) << 8) | linearToSrgbByte(b);
}

/** The FPV tone curve applied to a LINEAR palette colour: saturation pushed
 *  away from luminance, then exposure. Shared by the albedo generator and
 *  the hex the albedo's mean is tested against. */
export function fpvTone(c: readonly [number, number, number]): [number, number, number] {
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const s = GOBLIN_SKIN.fpvSaturation, e = GOBLIN_SKIN.fpvExposure;
  return [
    Math.max(0, (lum + (c[0] - lum) * s) * e),
    Math.max(0, (lum + (c[1] - lum) * s) * e),
    Math.max(0, (lum + (c[2] - lum) * s) * e),
  ];
}

/** The FPV skin's base, sRGB hex: the palette under fpvTone. This is what
 *  the albedo map averages to (see its test). */
export function goblinFpvSkinSrgbHex(): number {
  const [r, g, b] = fpvTone(GOBLIN_SKIN.baseLinear);
  return (linearToSrgbByte(r) << 16) | (linearToSrgbByte(g) << 8) | linearToSrgbByte(b);
}

/** Integer hash -> [0,1). Deterministic and dependency-free, so the same
 *  texture comes out in the browser, in node and in CI. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a TILING lattice of `period` cells. Wrapping the lattice
 *  coordinates is what lets the texture repeat without a visible seam. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number, m: number) => ((a % m) + m) % m;
  const n = (a: number, b: number) => hash2(w(a, period), w(b, period), seed);
  return (n(xi, yi) * (1 - u) + n(xi + 1, yi) * u) * (1 - v)
       + (n(xi, yi + 1) * (1 - u) + n(xi + 1, yi + 1) * u) * v;
}

/**
 * Height field: two octaves of mottle plus a sparser, sharper wart layer.
 *
 * The lattice is COARSE on purpose: `goblinNormalPixels` differentiates this
 * field with a +-1 texel stencil, so noise finer than ~8 px/cell at the 64px
 * map is undersampled -- its texel-to-texel slope swings past 200 byte-steps,
 * which breaks both the tiling test (edge columns must agree) and z-dominance
 * (blue must stay >= 160). 3 base cells and a 6-cell wart layer keep every
 * octave >= 10 px/cell at 64, while 0.65+ wart amplitude keeps the warts
 * reading as warts (normals tilt up to ~60 deg, then z-softening caps them).
 */
function height(u: number, v: number): number {
  const base = 3;                       // lattice cells across the texture
  let h = 0;
  h += tileNoise(u * base, v * base, base, 1) * 0.6;
  h += tileNoise(u * base * 2, v * base * 2, base * 2, 2) * 0.3;
  const wart = tileNoise(u * base * 2, v * base * 2, base * 2, 7);
  h += Math.pow(Math.max(0, wart - 0.55) / 0.45, 2) * 0.70;
  return h;
}

/**
 * A tiling tangent-space normal map, RGBA, `size` x `size`.
 *
 * Central differences on the height field, then encode to [0,255]. Z stays
 * dominant (>= 160) so the map perturbs the surface rather than replacing it --
 * a normal map that swings past that reads as noise on a sphere.
 */
export function goblinNormalPixels(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const d = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const hx = height(u + d, v) - height(u - d, v);
      const hy = height(u, v + d) - height(u, v - d);
      let nx = -hx * GOBLIN_SKIN.bumpStrength * size * d * 8;
      let ny = -hy * GOBLIN_SKIN.bumpStrength * size * d * 8;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const i = (y * size + x) * 4;
      px[i]     = Math.round((nx + 1) * 127.5);
      px[i + 1] = Math.round((ny + 1) * 127.5);
      px[i + 2] = Math.round((nz / len + 1) * 127.5);
      px[i + 3] = 255;
    }
  }
  return px;
}

/** The fleck lattice on its own, 0..1: a texel is a fleck above
 *  GOBLIN_SKIN.fleckThreshold. Exported for the coverage test. */
export function goblinFleckField(u: number, v: number): number {
  const n = GOBLIN_SKIN.fleckCells;
  return tileNoise(u * n, v * n, n, 11);
}

/** The wart layer of the height field on its own, 0..1, on the same lattice
 *  and seed `height()` uses -- so the colour map can darken exactly where the
 *  normal map bumps. Exported for the test that pins that agreement. */
export function goblinWartField(u: number, v: number): number {
  const base = 3;
  return tileNoise(u * base * 2, v * base * 2, base * 2, 7);
}

/**
 * A tiling sRGB colour map, RGBA, `size` x `size`: the goblin's base green
 * with the blob's mottle patches mixed in, and a soft dark ring on each wart.
 *
 * WHY A COLOUR MAP. With only a normal map the hand was one flat green that
 * a 0.30 emissive then washed out completely (the owner's "thin green
 * tubes"). Colour variation at mottleScale is what the marched goblin has
 * and what reads at arm's length; the normal map alone reads only in
 * specular. Same lattice and seeds as the height field, so the two agree.
 */
export function goblinAlbedoPixels(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const [br, bg, bb] = fpvTone(GOBLIN_SKIN.baseLinear);
  const [mr, mg, mb] = fpvTone(GOBLIN_SKIN.mottleColorLinear);
  const [cr, cg, cb] = fpvTone(GOBLIN_SKIN.charColorLinear);
  const base = 3;
  const { fleckCells, fleckThreshold, fleckMix, mottleAmp } = GOBLIN_SKIN;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // MOTTLE, the marched shader's recipe: two octaves summed 0.6/0.3,
      // centred, then smoothstep-REMAPPED over the range the noise actually
      // occupies (its tails are rare) so the result is patches with light
      // flesh between them rather than a uniform half-tint. march.wgsl.ts's
      // colour-mottle block explains why the obvious linear remap fails.
      const f = (tileNoise(u * base, v * base, base, 1) - 0.5) * 0.6
              + (tileNoise(u * base * 2, v * base * 2, base * 2, 2) - 0.5) * 0.3;
      const t = Math.min(1, Math.max(0, (f + 0.22) / 0.44));
      const mottle = t * t * (3 - 2 * t) * mottleAmp;
      // SPECKLE, what the face has: sparse fine dark flecks on a fine lattice.
      const fl = tileNoise(u * fleckCells, v * fleckCells, fleckCells, 11);
      const fleck = fl > fleckThreshold ? Math.min(1, (fl - fleckThreshold) / 0.06) * fleckMix : 0;
      // WARTS: a multiplicative shade, strongest at the crown, applied after
      // the mixes so a wart is darker than its surroundings on any ground.
      const shade = 1 - 0.55 * Math.pow(Math.max(0, goblinWartField(u, v) - 0.55) / 0.45, 1.5);
      let r = br + (mr - br) * mottle, g = bg + (mg - bg) * mottle, b = bb + (mb - bb) * mottle;
      r += (cr - r) * fleck; g += (cg - g) * fleck; b += (cb - b) * fleck;
      const i = (y * size + x) * 4;
      px[i]     = linearToSrgbByte(r * shade);
      px[i + 1] = linearToSrgbByte(g * shade);
      px[i + 2] = linearToSrgbByte(b * shade);
      px[i + 3] = 255;
    }
  }
  return px;
}
