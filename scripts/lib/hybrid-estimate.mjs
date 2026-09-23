// scripts/lib/hybrid-estimate.mjs — hybrid march, timing step 0: what a SPARSE full-res pass over the
// hard pixels would cost, from buffers the melee bench already reads
// (docs/dev-notes/2026-09-22-cost-census/HYBRID-TIMING-PLAN.md).
//
// The hybrid: march coarse, then give only the HARD pixels a real full-resolution ray, and interpolate
// the rest. This module builds the hard mask from the COARSE march (as the engine would, since it
// has no truth), then prices that mask against the per-pixel cost census of a 1.0 march of the SAME
// frozen frame.
//
// DIVERGENCE IS PRICED PESSIMISTICALLY. Fragments run in warps (~8x4 pixels on Apple GPUs). A warp that
// holds even one hard pixel runs until its slowest lane is done, so it is charged
// `max lane cost x rasterised lanes`. The full 1.0 pass is priced the same way, so `fraction` is
// like-for-like: fraction x T(1.0) ≈ the sparse pass's march time. That is optimistic only about
// fixed per-pass overhead (setup, proxy raster), which the go/no-go margin covers.

/** Linear view depth from WebGPU [0, 1] clip depth. */
export const linearDepth = (d, near, far) => (near * far) / (far - d * (far - near));

/**
 * Hard mask at OUTPUT resolution, from the coarse march only. Mirrors scripts/upscale4x-splice.ts
 * `hardMask` (the mask the owner judged by eye), with DILATE = 0:
 *   silhouette — the coarse 3x3 mixes hit and miss;
 *   depth edge — the hit texels of the 3x3 span > depthEdgeM of linear depth;
 *   prim seam  — two hit texels carry different prims (mode-11 b = hitBest) AND the colour changes
 *                (tonemapped max-channel delta > seamColour; skin-to-skin joins do not count);
 *   face       — inside any head circle x faceGrow (circles in OUTPUT px, captureAnnotations).
 * coarse: { w, h, data } rgba, a = clip depth (>= 1 = miss). ids: same size, mode-11 read, or null.
 */
export function hardMask(coarse, ids, heads, outW, outH, { near, far, depthEdgeM = 0.08, seamColour = 0.08, faceGrow = 0.8 } = {}) {
  const { w, h, data } = coarse;
  const t = (v) => v / (1 + v);
  const hardC = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let anyHit = false, anyMiss = false, dMin = Infinity, dMax = -Infinity, first = -1, seam = false;
      const c0 = (y * w + x) * 4;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const xx = Math.min(Math.max(x + i, 0), w - 1), yy = Math.min(Math.max(y + j, 0), h - 1), k = yy * w + xx;
          const a = data[k * 4 + 3];
          if (a >= 1) { anyMiss = true; continue; }
          anyHit = true;
          const d = linearDepth(a, near, far);
          dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
          if (ids && !seam) {
            const prim = Math.round(ids.data[k * 4 + 2]);
            if (first < 0) first = prim;
            else if (prim !== first) {
              let dc = 0;
              for (let c = 0; c < 3; c++) dc = Math.max(dc, Math.abs(t(data[c0 + c]) - t(data[k * 4 + c])));
              if (dc > seamColour) seam = true;
            }
          }
        }
      }
      if (anyHit && (anyMiss || dMax - dMin > depthEdgeM || seam)) hardC[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(outW * outH);
  for (let Y = 0; Y < outH; Y++) {
    for (let X = 0; X < outW; X++) {
      const x = Math.min(w - 1, Math.floor(((X + 0.5) * w) / outW)), y = Math.min(h - 1, Math.floor(((Y + 0.5) * h) / outH));
      let hard = hardC[y * w + x] === 1;
      for (const c of heads) if (!hard && Math.hypot(X + 0.5 - c.x, Y + 0.5 - c.y) <= c.r * faceGrow) hard = true;
      out[Y * outW + X] = hard ? 1 : 0;
    }
  }
  return out;
}

/**
 * Per-pixel cost of the 1.0 march from the cost census: `total` is the mode-14 read (r = prims,
 * g = wound rows over the whole pixel); a pixel is RASTERISED when the mode-13 walk read's b >= 0.5
 * (costCensus's rule — a never-rasterised texel holds the clear colour). Cost unit = prims + rows / 7
 * (a wound row costs ~1/7 of a prim, measured this session). Returns Float32Array, -1 = not rasterised.
 */
export function pixelCost(walk, total, n) {
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    cost[i] = walk[o + 2] >= 0.5 ? total[o] + total[o + 1] / 7 : -1;
  }
  return cost;
}

/**
 * Warp-priced cost of the full pass vs the sparse pass restricted to `mask`.
 * A tile (tileW x tileH) costs max(rasterised lane cost) x rasterised lanes; the sparse pass pays only
 * tiles holding at least one RASTERISED hard pixel (a hard pixel the proxies do not cover never runs).
 */
export function sparseFraction(cost, mask, w, h, { tileW = 8, tileH = 4 } = {}) {
  let full = 0, sparse = 0, fullPx = 0, hardPx = 0, tiles = 0, hardTiles = 0, plainFull = 0, plainHard = 0;
  for (let ty = 0; ty < h; ty += tileH) {
    for (let tx = 0; tx < w; tx += tileW) {
      let mx = 0, lanes = 0, anyHard = false;
      for (let y = ty; y < Math.min(h, ty + tileH); y++) {
        for (let x = tx; x < Math.min(w, tx + tileW); x++) {
          const i = y * w + x, c = cost[i];
          if (c < 0) continue;
          lanes++; fullPx++; plainFull += c;
          if (c > mx) mx = c;
          if (mask[i]) { anyHard = true; hardPx++; plainHard += c; }
        }
      }
      if (!lanes) continue;
      tiles++;
      full += mx * lanes;
      if (anyHard) { hardTiles++; sparse += mx * lanes; }
    }
  }
  return {
    fraction: full ? sparse / full : 0,            // warp-priced: the number the estimate uses
    plainFraction: plainFull ? plainHard / plainFull : 0, // per-pixel, no divergence (lower bound)
    hardPxShare: fullPx ? hardPx / fullPx : 0,
    hardTileShare: tiles ? hardTiles / tiles : 0,
    fullPx, hardPx, tiles, hardTiles,
  };
}
