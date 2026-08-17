// src/lab/sdf-zombie/webgpu/hands-sheet.ts
//
// The hand-detail SHEET: a small greyscale height map per hand, projected onto
// the marched hand flesh so that geometry only has to carry the grip
// silhouette (hands.ts rule 3, which is face.ts's lesson applied to hands —
// smin smears any feature under ~1.5 cm, and every prim shares one albedo, so
// creases can only ever be texture).
//
// TWO SOURCES, in priority order:
//
//  1. The BAKED sheets — original art rendered by scripts/bake_hand_detail.py
//     (a hand built from primitives in headless Blender, orthographic
//     emission-as-height render from the back-of-hand direction). Loaded from
//     the manifest at MANIFEST_URL. This is the good one: a real posed hand is
//     in the correct perspective by construction, which hand-drawn blobs never
//     are.
//  2. A PROCEDURAL fallback drawn on a canvas, used when the manifest is
//     missing. Same role as createBurstLayer's procedural flipbook: the lab
//     stays runnable from a checkout where the bake has not been run, and the
//     renderer never has to branch on "no sheet".
//
// SHEET FRAME (both sources must agree, and the projection in hands.ts
// depends on it): the sheet is authored in the HAND's own frame —
//   u (image +x) → across the hand toward the THUMB,
//   v (image +y, i.e. UP the image) → along the hand toward the KNUCKLES,
//   viewed down the back-of-hand normal, so the wrist is at the image bottom.
// Luminance is HEIGHT (bright = nearer the eye). Alpha masks the hand: the
// march multiplies its detail and relief by tex.a, so alpha 0 means "no sheet
// here" and the flesh shades exactly as it did before.
import * as THREE from 'three/webgpu';

/** Which hand a sheet is for. 'grip' = the fist round the bundle, 'pinch' =
 *  the open hand holding the cigarette. */
export type HandSheetId = 'grip' | 'pinch';

export interface HandSheet {
  tex: THREE.Texture;
  /** Mean luminance of the sheet's OPAQUE pixels. The march divides the
   *  sampled colour by this, keeping the pattern and throwing away the level —
   *  so a wrong mean brightens or darkens the whole hand. */
  mean: number;
}

export type HandSheets = Record<HandSheetId, HandSheet>;

export const MANIFEST_URL = '/assets/lab/hand-detail.json';

interface SheetManifest {
  sheets: Record<string, { file: string; mean: number }>;
}

// ——— The procedural fallback, as DATA ———————————————————————————————————————

/**
 * A stroke in sheet space (0..1, origin at the image's bottom-left so it reads
 * in the same frame as the projection: +x toward the thumb, +y toward the
 * knuckles). `width` is in sheet units; `tone` is the height it paints, 0..1.
 */
export interface SheetStroke {
  from: [number, number];
  to: [number, number];
  width: number;
  tone: number;
}

/** Where the hand mass sits in the sheet, as an ellipse in sheet space. */
export interface SheetLayout {
  /** The flesh mask — everything outside is alpha 0. */
  mass: { cx: number; cy: number; rx: number; ry: number };
  /** Mid grey the mass is filled with before strokes. */
  base: number;
  strokes: readonly SheetStroke[];
}

/**
 * Fallback layouts. Not art — a legible stand-in with the features in
 * anatomically plausible places for each grip, so the projection can be
 * verified end to end without Blender: four knuckle mounds high on the sheet
 * (bright: they are the nearest flesh), the tendon lines running down from
 * them toward the wrist, finger creases across them, and nail hints at the
 * top edge where the fingertips curl over.
 */
export const SHEET_LAYOUTS: Record<HandSheetId, SheetLayout> = {
  // A closed fist: compact, knuckles crowded high, deep creases between the
  // folded digits.
  grip: {
    mass: { cx: 0.50, cy: 0.46, rx: 0.42, ry: 0.46 },
    base: 0.52,
    strokes: [
      // Knuckle mounds (bright, near) — index at the thumb side.
      { from: [0.66, 0.74], to: [0.66, 0.80], width: 0.13, tone: 0.86 },
      { from: [0.50, 0.76], to: [0.50, 0.82], width: 0.13, tone: 0.90 },
      { from: [0.34, 0.74], to: [0.34, 0.80], width: 0.12, tone: 0.84 },
      { from: [0.21, 0.70], to: [0.21, 0.75], width: 0.11, tone: 0.78 },
      // Creases between the folded fingers (dark, deep).
      { from: [0.58, 0.62], to: [0.58, 0.88], width: 0.030, tone: 0.20 },
      { from: [0.42, 0.63], to: [0.42, 0.89], width: 0.030, tone: 0.18 },
      { from: [0.27, 0.61], to: [0.27, 0.86], width: 0.028, tone: 0.22 },
      // Tendons fanning down the back of the hand toward the wrist.
      { from: [0.62, 0.70], to: [0.55, 0.30], width: 0.045, tone: 0.66 },
      { from: [0.50, 0.72], to: [0.49, 0.30], width: 0.045, tone: 0.68 },
      { from: [0.36, 0.70], to: [0.43, 0.30], width: 0.042, tone: 0.64 },
      { from: [0.24, 0.66], to: [0.37, 0.30], width: 0.038, tone: 0.60 },
      // Thumb web + thenar swell on the thumb side.
      { from: [0.80, 0.46], to: [0.72, 0.62], width: 0.10, tone: 0.74 },
      // Wrist crease across the bottom.
      { from: [0.24, 0.16], to: [0.74, 0.18], width: 0.030, tone: 0.30 },
      // Nail hints where the fingertips curl over the top.
      { from: [0.64, 0.86], to: [0.64, 0.89], width: 0.055, tone: 0.94 },
      { from: [0.48, 0.88], to: [0.48, 0.91], width: 0.055, tone: 0.96 },
    ],
  },
  // An open, relaxed hand: longer, fingers separated, shallower creases.
  pinch: {
    mass: { cx: 0.48, cy: 0.44, rx: 0.40, ry: 0.50 },
    base: 0.50,
    strokes: [
      // Index and middle stand proud — they are the two doing the pinching.
      { from: [0.62, 0.60], to: [0.66, 0.92], width: 0.095, tone: 0.88 },
      { from: [0.48, 0.60], to: [0.48, 0.94], width: 0.095, tone: 0.84 },
      // Ring and little curled lower and darker (further from the eye).
      { from: [0.34, 0.58], to: [0.31, 0.82], width: 0.085, tone: 0.62 },
      { from: [0.22, 0.54], to: [0.19, 0.74], width: 0.075, tone: 0.54 },
      // Gaps between the separated fingers.
      { from: [0.56, 0.60], to: [0.58, 0.94], width: 0.026, tone: 0.16 },
      { from: [0.41, 0.58], to: [0.40, 0.92], width: 0.026, tone: 0.18 },
      { from: [0.28, 0.56], to: [0.25, 0.80], width: 0.024, tone: 0.22 },
      // Knuckle line across the base of the fingers.
      { from: [0.20, 0.58], to: [0.70, 0.62], width: 0.034, tone: 0.34 },
      // Tendons down the back of a relaxed hand — more visible than in a fist.
      { from: [0.64, 0.58], to: [0.56, 0.26], width: 0.040, tone: 0.66 },
      { from: [0.49, 0.58], to: [0.47, 0.26], width: 0.040, tone: 0.68 },
      { from: [0.34, 0.56], to: [0.39, 0.26], width: 0.036, tone: 0.62 },
      // Thumb web.
      { from: [0.78, 0.44], to: [0.70, 0.58], width: 0.10, tone: 0.72 },
      { from: [0.22, 0.14], to: [0.72, 0.16], width: 0.030, tone: 0.30 },
      // Nails on the two pinching fingers.
      { from: [0.66, 0.90], to: [0.66, 0.94], width: 0.050, tone: 0.96 },
      { from: [0.48, 0.92], to: [0.48, 0.96], width: 0.050, tone: 0.98 },
    ],
  },
};

/** Mean tone of a layout's mass, area-weighted over its strokes — the CPU-side
 *  answer to the `mean` the march divides by. Approximate on purpose: it only
 *  has to be close enough that the flesh does not shift brightness. */
export function layoutMean(layout: SheetLayout): number {
  let area = Math.PI * layout.mass.rx * layout.mass.ry;
  let sum = layout.base * area;
  for (const s of layout.strokes) {
    const len = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) + s.width;
    const a = len * s.width;
    // Strokes paint OVER the base, so swap that much area's contribution.
    sum += (s.tone - layout.base) * a;
    area += 0;
  }
  return Math.min(1, Math.max(0.05, sum / Math.max(area, 1e-6)));
}

/** Draw a layout into a 2D context of `size` px. Extracted so the drawing is
 *  one small function over pure data (the data is what the tests check). */
export function drawSheet(
  ctx: CanvasRenderingContext2D, layout: SheetLayout, size: number,
): void {
  const X = (u: number): number => u * size;
  // Sheet +y is UP, canvas +y is DOWN.
  const Y = (v: number): number => (1 - v) * size;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  // Mask: everything drawn from here on lands inside the flesh ellipse, so the
  // background keeps alpha 0 and the march leaves it alone.
  ctx.beginPath();
  ctx.ellipse(X(layout.mass.cx), Y(layout.mass.cy),
    layout.mass.rx * size, layout.mass.ry * size, 0, 0, Math.PI * 2);
  ctx.clip();
  const grey = (t: number): string => {
    const v = Math.round(Math.min(1, Math.max(0, t)) * 255);
    return `rgb(${v},${v},${v})`;
  };
  ctx.fillStyle = grey(layout.base);
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  for (const s of layout.strokes) {
    ctx.strokeStyle = grey(s.tone);
    ctx.lineWidth = s.width * size;
    ctx.beginPath();
    ctx.moveTo(X(s.from[0]), Y(s.from[1]));
    ctx.lineTo(X(s.to[0]), Y(s.to[1]));
    ctx.stroke();
  }
  ctx.restore();
}

function proceduralSheet(id: HandSheetId): HandSheet {
  const size = 256;
  const layout = SHEET_LAYOUTS[id];
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  drawSheet(ctx, layout, size);
  const tex = new THREE.CanvasTexture(c);
  // Raw, to match the baked sheets and layoutMean's tone arithmetic.
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, mean: layoutMean(layout) };
}

/** The procedural pair, available synchronously so the views never start
 *  sheet-less (and so a clean checkout looks the same as a baked one, only
 *  cruder). */
export function proceduralHandSheets(): HandSheets {
  return { grip: proceduralSheet('grip'), pinch: proceduralSheet('pinch') };
}

/**
 * Try the baked manifest. Resolves null when it is absent or malformed — the
 * caller keeps the procedural pair. Never throws.
 */
export async function loadBakedHandSheets(
  url = MANIFEST_URL,
): Promise<HandSheets | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const manifest = await res.json() as SheetManifest;
    const baseDir = url.replace(/\/[^/]*$/, '/');
    const loader = new THREE.TextureLoader();
    const one = (id: HandSheetId): Promise<HandSheet> => {
      const entry = manifest.sheets?.[id];
      if (!entry?.file) return Promise.reject(new Error(`no sheet ${id}`));
      return new Promise<HandSheet>((resolve, reject) => {
        loader.load(baseDir + entry.file, tex => {
          // NO colour-space decode: the bake measured `mean` on the STORED
          // 8-bit values and the march divides the sample by it, so a
          // sRGB→linear decode here would shift every hand's brightness. The
          // face sheet is sampled raw for the same reason (see the "not
          // linearised, deliberately" note in march.wgsl.ts).
          tex.colorSpace = THREE.NoColorSpace;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          resolve({ tex, mean: clampMean(entry.mean) });
        }, undefined, reject);
      });
    };
    const [grip, pinch] = await Promise.all([one('grip'), one('pinch')]);
    return { grip, pinch };
  } catch {
    return null;
  }
}

/** Guards a manifest mean into a usable divisor — a 0 would blow the shader's
 *  `tex.rgb / mean` up to infinity and white out the hands. */
export function clampMean(mean: unknown): number {
  const m = typeof mean === 'number' && Number.isFinite(mean) ? mean : 0.5;
  return Math.min(1, Math.max(0.05, m));
}
