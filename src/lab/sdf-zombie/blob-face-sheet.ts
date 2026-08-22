// src/lab/sdf-zombie/blob-face-sheet.ts
//
// A procedurally generated greyscale face sheet.
//
// The head is ONE textured ellipsoid — face.ts's header records four rebuilds
// that established this: geometry carries silhouette, texture carries features,
// and a face built from carved sockets and a protruding nose never reads. So
// every character's face is a small greyscale image, and until now every
// character wore the same one (`/assets/lab/zombie-face.png`), because that was
// the only way to have a face at all.
//
// This generates one instead. Deliberately a PURE function over a byte array
// rather than anything canvas-backed: it runs in vitest with no DOM, it is
// deterministic for a given seed, and the caller decides how to get bytes onto
// the GPU. The lab wraps the result in a DataTexture; a test just reads pixels.
//
// The contract it has to satisfy is set by the existing sheet registry in
// lab-main.ts: pixels, a rect in top-left coordinates, and a MEAN. The mean is
// the level the shader divides out, so it must be measured off the pixels that
// were actually produced — a stale or assumed mean shifts the whole head's
// brightness, which is why the registry's hand-entered means are commented as
// "MEASURED off the file".
//
// The sheet does THREE jobs at once, and that dictates its tonal design:
//
//   * albedo MULTIPLIER — `albedo * (tex.rgb / mean)`, so a feature is
//     something DARKER than its surroundings, not a sprite pasted on;
//   * height/bump, via the same values;
//   * emissive mask — `smoothstep(threshold, 1, luma(tex.rgb))`, so BRIGHT
//     pixels glow.
//
// That last one is why the eyes are the brightest thing here and everything
// else is darker than the base. A first version had it backwards — dark eyes on
// a bright base — and the whole face lit up red, because every pixel cleared
// the glow threshold. `zombie-face.png` has a mean of 0.406 for the same
// reason: mostly dark, with small bright eyes.

export interface FaceSheetParams {
  /** Distance between the eyes, as a fraction of sheet width. */
  eyeGap: number;
  /** Eye radius, fraction of sheet width. */
  eyeSize: number;
  /** Eye brightness, 0..1. This is what keys the emissive glow. */
  eyeGlow: number;
  /**
   * Vertical squash. 1 is a round eye; above 1 narrows it into a slit or an
   * almond, below 1 makes it a tall oval. The old hardcoded 1.25 is the
   * default, so an unspecified eye is unchanged.
   */
  eyeSquash: number;
  /**
   * A dark pupil inside the bright eye, as a fraction of eye radius.
   *
   * **This fights the glow, and usually loses.** The shader's emissive mask is
   * `smoothstep(0.88, 1, luma)`, so only the brightest part of the eye lights
   * up — and a pupil darkens exactly those pixels. At 0.42 it pulled the eye's
   * centre to ~0.25 luma, well under the threshold, so instead of a pupil you
   * get a glowing ring with a hole in it, which at eye size just reads as a
   * smaller, dimmer eye. The glow is also scaled by how squarely the face
   * points at the camera, so a three-quarter view dims it further and the
   * hollow core is what disappears first.
   *
   * Left in because it is genuinely wanted on a non-glowing eye (drop eyeGlow
   * below the threshold and the pupil becomes the feature). Default 0.
   */
  eyePupil: number;
  /**
   * Brightness of a specular catchlight in each eye, 0..1. 0 = none.
   *
   * A dark eye with no glint reads as an empty socket (the clown's original
   * complaint). A small bright dot in the upper-outward corner turns it into a
   * painted cartoon eye. Drawn ON TOP of the eye (so it survives eyeGlow) but
   * kept below the shader's ~0.88 emissive threshold, so it reads as a glint,
   * not a second lamp.
   */
  eyeGlint: number;
  /** Catchlight radius as a fraction of eye radius. */
  eyeGlintSize: number;
  /** Vertical eye position, 0 = top of sheet, 1 = bottom. */
  eyeRise: number;
  /** Outer-corner lift in degrees. Positive scowls, negative droops. */
  eyeTilt: number;
  /** How dark the brow shadow sits above the eyes, 0 = none. */
  browHeavy: number;
  /** Brow slant in degrees. Positive angles the inner ends DOWN — a scowl. */
  browAngle: number;
  /** Mouth width, fraction of sheet width. */
  mouthWidth: number;
  /** Vertical mouth position. */
  mouthRise: number;
  /** Positive smiles, negative frowns. */
  mouthCurve: number;
  /** Mouth thickness. 0 removes it. */
  mouthOpen: number;
  /** Nostril darkness, 0 removes them. */
  nostril: number;
  /**
   * A shaded nose: a lit ridge down the centre with shadowed flanks.
   *
   * The sheet drives the normal as well as albedo, so a nose can be SHADED in
   * rather than built. That is the whole lesson in face.ts's header — geometry
   * carries silhouette, texture carries features, and a protruding geometric
   * nose both fails to read and breaks the planar projection. 0 removes it.
   */
  noseRidge: number;
  /** Nose ridge width, fraction of sheet width. */
  noseWide: number;
  /** How far the ridge runs down the face from the brow. */
  noseLong: number;
  /**
   * A dark band under the jaw. Without it the chin runs straight into the neck
   * and the head reads as fused to the shoulders — no-neck syndrome, which the
   * geometry alone cannot fix once smooth-min has joined skull to torso.
   */
  jawShade: number;
  /** Mottling amplitude. This is what stops a generated face reading as clip art. */
  grain: number;
  /** Seed for the grain. Integer. */
  seed: number;
}

export const DEFAULT_SHEET: FaceSheetParams = {
  eyeGap: 0.34,
  eyeSize: 0.075,
  eyeGlow: 1.0,
  eyeSquash: 1.25,
  eyePupil: 0,
  eyeRise: 0.42,
  eyeTilt: 8,
  eyeGlint: 0,
  eyeGlintSize: 0.30,
  browHeavy: 0.55,
  browAngle: 14,
  mouthWidth: 0.40,
  mouthRise: 0.72,
  mouthCurve: -0.25,
  mouthOpen: 0.055,
  nostril: 0.35,
  noseRidge: 0.85,
  noseWide: 0.085,
  noseLong: 0.20,
  jawShade: 0.40,
  grain: 0.085,
  seed: 1,
};

/** Deterministic value noise. Not good noise — just stable, cheap and seeded. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Soft-edged step: 1 well inside, 0 well outside, smooth across `soft`. */
function falloff(d: number, r: number, soft: number): number {
  if (soft <= 0) return d <= r ? 1 : 0;
  const t = (r - d) / soft;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

export interface GeneratedSheet {
  /** Greyscale, one byte per texel, row-major from the TOP-LEFT. */
  pixels: Uint8Array;
  size: number;
  /** Mean of `pixels` in 0..1. Measured, never assumed — see the header. */
  mean: number;
}

/**
 * Draws a face into a `size` x `size` greyscale buffer.
 *
 * Everything is drawn as a soft darkening of a mid-grey base, because the sheet
 * is used as an albedo MULTIPLIER (and a height and emissive mask): a feature is
 * something darker than its surroundings, not an opaque sprite pasted on top.
 */
export function generateFaceSheet(
  p: FaceSheetParams = DEFAULT_SHEET,
  size = 64,
): GeneratedSheet {
  const pixels = new Uint8Array(size * size);
  const rad = Math.PI / 180;
  const soft = 1.5 / size; // roughly a texel and a half, in uv units

  const eyeY = p.eyeRise;
  const eyeDX = p.eyeGap / 2;
  const tilt = Math.tan(p.eyeTilt * rad);
  const browSlant = Math.tan(p.browAngle * rad);

  let total = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sample at texel centres so the face is symmetric about x = 0.5.
      const x = (px + 0.5) / size;
      const y = (py + 0.5) / size;
      const sx = Math.abs(x - 0.5); // mirrored: the face is symmetric

      // Base tone with grain. The grain is sampled unmirrored so the two sides
      // are not identical — a perfectly symmetric face reads as a mask.
      let v = 0.46 + (hash2(px, py, p.seed) - 0.5) * 2 * p.grain;

      // Brow: a slanted bar above the eye line. The CREASE under it does the
      // work, same lesson as face.ts's geometric brow.
      if (p.browHeavy > 0) {
        const browY = eyeY - 0.085 - (sx - eyeDX) * browSlant;
        const d = Math.abs(y - browY);
        const inSpan = falloff(Math.abs(sx - eyeDX * 0.95), 0.115, 0.05);
        v -= p.browHeavy * 0.30 * falloff(d, 0.030, 0.028) * inSpan;
      }

      // Eyes: the BRIGHT feature, because brightness is what the shader's
      // emissive mask keys off. Everything else on this sheet darkens; only
      // this lightens. Mixed toward eyeGlow rather than added, so a big eye
      // cannot push the surrounding tone past white and smear the glow.
      if (p.eyeSize > 0) {
        const ey = eyeY + (sx - eyeDX) * tilt;
        const d = Math.hypot(sx - eyeDX, (y - ey) * 1.25);
        // Soft edge scaled to the EYE, not to the texel grid. An absolute
        // `soft * 2.5` (~0.059 uv) is wider than a small eye's own radius, so
        // the eye is all edge and never reaches full brightness anywhere —
        // which puts it under the shader's 0.88 glow threshold and the eyes
        // simply do not light. Capping the edge at a third of the radius keeps
        // a solid core no matter how small the eye is authored.
        const k = falloff(d, p.eyeSize, Math.min(soft * 2.5, p.eyeSize * 0.33));
        v = v * (1 - k) + p.eyeGlow * k;
        // Catchlight: a small bright dot in the upper-outward corner, so the
        // eye reads as a painted ball rather than an empty socket. Mixed in
        // AFTER the eye so it survives a dim eyeGlow, and capped below the
        // shader's emissive threshold so it is a glint, not a light source.
        if (p.eyeGlint > 0) {
          const gx = eyeDX + p.eyeSize * 0.32;
          const gy = ey - p.eyeSize * 0.34;
          const dg = Math.hypot(sx - gx, (y - gy) * 1.25);
          const kg = falloff(dg, p.eyeSize * p.eyeGlintSize, p.eyeSize * 0.18);
          v = v * (1 - kg) + Math.min(p.eyeGlint, 0.82) * kg;
        }
      }

      // Nose: a lit ridge with shadowed flanks. Brightened, but deliberately
      // nowhere near the 0.88 glow threshold — this is relief, not an emitter.
      if (p.noseRidge > 0) {
        const top = eyeY - 0.030;
        const bot = top + p.noseLong;
        const span = falloff(Math.abs(y - (top + bot) / 2), (bot - top) / 2, 0.045);
        const w = Math.max(p.noseWide, 1e-4);
        v += p.noseRidge * 0.26 * falloff(sx, w * 0.40, w * 0.60) * span;
        // The shadow either side is what actually sells it; a bright stripe on
        // its own just looks like a highlight.
        const flank = falloff(Math.abs(sx - w * 1.15), w * 0.55, w * 0.60);
        v -= p.noseRidge * 0.30 * flank * span;
      }

      // Jaw shade: a dark band low on the face, separating chin from neck.
      if (p.jawShade > 0) {
        const band = falloff(Math.abs(y - (p.mouthRise + 0.135)), 0.055, 0.05);
        v -= p.jawShade * 0.34 * band * falloff(sx, 0.30, 0.10);
      }

      // Nostrils: two small dark dots, close in.
      if (p.nostril > 0) {
        const d = Math.hypot(sx - 0.055, (y - (eyeY + 0.165)) * 1.6);
        v -= p.nostril * 0.34 * falloff(d, 0.030, soft * 2);
      }

      // Mouth: a curved bar. mouthCurve bows it down at the centre for a frown.
      if (p.mouthOpen > 0) {
        const t = sx / Math.max(p.mouthWidth / 2, 1e-4); // 0 centre, 1 corner
        const my = p.mouthRise - p.mouthCurve * 0.09 * (1 - t * t);
        const d = Math.abs(y - my);
        v -= 0.38 * falloff(d, p.mouthOpen, soft * 2) * falloff(sx, p.mouthWidth / 2, 0.045);
      }

      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      pixels[py * size + px] = b;
      total += b;
    }
  }

  return { pixels, size, mean: total / (size * size * 255) };
}
