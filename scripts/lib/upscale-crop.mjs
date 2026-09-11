// scripts/lib/upscale-crop.mjs — crops, masks and region transforms for capture v2
// (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1).

/** [x0, y0, x1, y1) of texels with alpha < 1 in a w*h RGBA float frame, or null. */
export function fleshBox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 1) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** [x0, y0, x1, y1) of pixels with coverage >= minFrac in a w*h coverage array, or null. */
export function coverageBox(cov, w, h, minFrac = 0.5) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cov[y * w + x] >= minFrac) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** Fraction of texels that are flesh (alpha < 1). */
export function fleshFraction(data, w, h) {
  let n = 0;
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] < 1) n++;
  return n / (w * h);
}

/** IoU of the flesh masks of two same-size RGBA frames (1 when both are empty). */
export function maskIoU(a, b, w, h) {
  let inter = 0, union = 0;
  for (let p = 0; p < w * h; p++) {
    const fa = a[p * 4 + 3] < 1, fb = b[p * 4 + 3] < 1;
    if (fa && fb) inter++;
    if (fa || fb) union++;
  }
  return union === 0 ? 1 : inter / union;
}

/**
 * The pair crop in INPUT px: the input flesh box unioned with the target coverage box (halved
 * outward), padded by `pad` and clamped to the input frame. The output crop is exactly 2x.
 * Null when neither frame has flesh.
 */
export function pairCrop(inData, inW, inH, tgCov, tgW, tgH, pad = 8) {
  const a = fleshBox(inData, inW, inH);
  const b = coverageBox(tgCov, tgW, tgH);
  if (!a && !b) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (a) { x0 = a[0]; y0 = a[1]; x1 = a[2]; y1 = a[3]; }
  if (b) {
    x0 = Math.min(x0, Math.floor(b[0] / 2));
    y0 = Math.min(y0, Math.floor(b[1] / 2));
    x1 = Math.max(x1, Math.ceil(b[2] / 2));
    y1 = Math.max(y1, Math.ceil(b[3] / 2));
  }
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(inW, x1 + pad);
  y1 = Math.min(inH, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Copy the (x, y, w, h) window of a W*H*C float frame. */
export function cropFrame(data, W, H, C, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > W || y + h > H) throw new Error(`cropFrame: window ${x},${y} ${w}x${h} outside ${W}x${H}`);
  const out = new Float32Array(w * h * C);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * W + x) * C;
    out.set(data.subarray(src, src + w * C), row * w * C);
  }
  return out;
}

/**
 * Full-frame annotations (output px) -> crop-local output px for a pair crop (given in input px).
 * Keeps circles whose disc overlaps the crop.
 */
export function toLocalRegions(annotations, crop) {
  const ox = crop.x * 2, oy = crop.y * 2, ow = crop.w * 2, oh = crop.h * 2;
  const overlaps = (c) => c.x + c.r > ox && c.x - c.r < ox + ow && c.y + c.r > oy && c.y - c.r < oy + oh;
  const heads = [];
  const wounds = [];
  for (const a of annotations) {
    if (a.head && overlaps(a.head)) heads.push({ x: a.head.x - ox, y: a.head.y - oy, r: a.head.r, actorId: a.actorId });
    for (const w of a.wounds) if (overlaps(w)) wounds.push({ x: w.x - ox, y: w.y - oy, r: w.r, type: w.type, actorId: a.actorId });
  }
  return { heads, wounds };
}
