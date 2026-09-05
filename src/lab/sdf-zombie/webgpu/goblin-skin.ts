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
  const [br, bg, bb] = GOBLIN_SKIN.baseLinear;
  const [mr, mg, mb] = GOBLIN_SKIN.mottleColorLinear;
  const base = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Mottle: two octaves, centred on 0 so the MEAN stays the base colour.
      let m = tileNoise(u * base, v * base, base, 1) * 0.65
            + tileNoise(u * base * 2, v * base * 2, base * 2, 2) * 0.35;
      m = (m - 0.5) * 2 * GOBLIN_SKIN.mottleAmp;          // -amp .. +amp
      // Only the dark half of the field mixes toward mottleColor, linearly
      // up to 80% at the field's extreme -- patches with soft edges, not a
      // saturated cliff. (The dispatched first pass used a x4.5 gain that
      // clipped half the map to full mottle colour and dragged the mean off
      // the base, which is what made its own mean test unsatisfiable.)
      const mix = Math.min(1, Math.max(0, m) / GOBLIN_SKIN.mottleAmp) * 0.80;
      // Warts: a soft SHADE, strongest at the wart's crown, multiplied on
      // after the mottle so a wart is darker than its surroundings whether
      // it sits on base green or on a full mottle patch. (Mixing it toward
      // mottleColor instead let saturated patches out-darken every wart,
      // which is what broke the bumps-and-blotches-agree test.)
      const shade = 1 - 0.55 * Math.pow(Math.max(0, goblinWartField(u, v) - 0.55) / 0.45, 1.5);
      const lin = [
        (br + (mr - br) * mix + Math.min(0, m) * 0.10 * br) * shade,
        (bg + (mg - bg) * mix + Math.min(0, m) * 0.10 * bg) * shade,
        (bb + (mb - bb) * mix + Math.min(0, m) * 0.10 * bb) * shade,
      ];
      const i = (y * size + x) * 4;
      px[i]     = linearToSrgbByte(lin[0]!);
      px[i + 1] = linearToSrgbByte(lin[1]!);
      px[i + 2] = linearToSrgbByte(lin[2]!);
      px[i + 3] = 255;
    }
  }
  return px;
}
