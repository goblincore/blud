// Depth diff — comparing the INSIDE of the outline: per-pixel surface depth
// of the compiled body against the reference mesh, where both agree the
// outline exists.
//
// WHY THIS EXISTS. blob:measure scores a silhouette and blob:rings fits a
// radial average per bone, and between them they own every check the
// minotaur passed before it was rejected on sight: nine test pins green,
// render-check exit 0, ring widths to 0.1 mm — and a torso that was a
// featureless blob, because a smooth cylinder and a heavily muscled torso of
// equal average girth are the same outline and the same radial average.
// Relief — pecs, lats, a waist — lives strictly INSIDE the outline, where
// neither of those tools looks. This one does: both rasters from
// silhouette.ts now carry the hit depth they always computed and threw away
// (depthFromBody, depthFromTriangles), and this file is the comparison.
//
// THE ONE RULE. Diff only where BOTH masks are occupied and BOTH depths are
// finite. A pixel occupied by one side only is a SILHOUETTE difference —
// blob:measure reports those, per band, and better. Counting them here as
// some depth-vs-nothing error would double-report every outline mistake and
// drown the relief signal this tool exists for, which is the pixels where
// the outlines AGREE and the surfaces do not. The both-finite half matters
// because a KIT-supplied pixel is occupied with NaN depth (a kit is a
// polygon overlay with no field behind it — see bodyRaster in silhouette.ts):
// NaN here means "no reading", never zero.

import { bandOwners, depthFromBody, depthFromTriangles } from './silhouette';
import type { Mask } from './silhouette';
import type { BuiltBody } from './types';

export interface DepthDiffOpts {
  /** 'front' looks down the depth axis world z; 'side', world x. */
  view?: 'front' | 'side';
  /** Rows of each SOURCE raster, before normalisation. */
  heightPx?: number;
  /** Height bands the error is reported over. */
  bands?: number;
  /** Side of the common square grid both subjects are normalised onto. */
  grid?: number;
}

export interface DepthDiffBand {
  /** Fraction of subject height, 0 = crown. */
  y0: number; y1: number;
  /** Mean |body - reference| depth over both-occupied pixels, in metres. */
  meanErr: number;
  /** Signed mean: positive = the body sits NEARER the camera than the mesh. */
  signedErr: number;
  /** Both-occupied pixel count. A band with few is not evidence. */
  samples: number;
  /**
   * The `.blob` line owning this band, via bandOwners. Absent for a band
   * with no samples (no error to own) and for a band whose outline is a TS
   * prim or kit geometry (no line to name).
   */
  owner?: { line: number; label: string };
}

export interface DepthDiffReport {
  /** Bands, WORST FIRST by meanErr, so the top of the list is the to-do. */
  bands: DepthDiffBand[];
  /** Mean |err| over every both-occupied pixel, metres. */
  meanErr: number;
  signedErr: number;
  samples: number;
}

/**
 * Resample a raster's SUBJECT BOX onto a common grid, carrying DEPTH.
 *
 * This is diffDepth's "normalise both to a common raster" step: each subject
 * is mapped to its own bounding box, so the comparison is about proportion,
 * never about where in frame the camera put it.
 *
 * The box walk is normalise's own, duplicated rather than shared — normalise
 * returns only bits, and the depth has to come out of the SAME boxes or the
 * depths and the mask they are read through disagree by up to a source
 * pixel. The duplication is pinned bit-for-bit by resampleDepth's test;
 * if normalise's mapping ever changes, that test fails before anything
 * downstream can quietly drift.
 *
 * Occupancy is normalise's majority rule so the two cannot disagree; a
 * source box that holds no FINITE depth (a kit-only box) yields NaN depth
 * under a possibly-occupied bit — diffDepth's both-finite rule skips it.
 */
export function resampleDepth(
  mask: Mask, depth: Float32Array, outW: number, outH: number,
): { mask: Mask; depth: Float32Array } {
  const bits = new Uint8Array(outW * outH);
  const out = new Float32Array(outW * outH).fill(NaN);
  const b = subjectBoundsOf(mask);
  if (!b) return { mask: { w: outW, h: outH, bits }, depth: out };
  const sw = b.x1 - b.x0 + 1, sh = b.y1 - b.y0 + 1;
  for (let y = 0; y < outH; y++) {
    const sy0 = b.y0 + Math.floor((y * sh) / outH);
    const sy1 = b.y0 + Math.max(Math.ceil(((y + 1) * sh) / outH), Math.floor((y * sh) / outH) + 1);
    for (let x = 0; x < outW; x++) {
      const sx0 = b.x0 + Math.floor((x * sw) / outW);
      const sx1 = b.x0 + Math.max(Math.ceil(((x + 1) * sw) / outW), Math.floor((x * sw) / outW) + 1);
      let on = 0, n = 0, sum = 0, cnt = 0;
      for (let sy = sy0; sy < Math.min(sy1, b.y1 + 1); sy++)
        for (let sx = sx0; sx < Math.min(sx1, b.x1 + 1); sx++) {
          const si = sy * mask.w + sx;
          on += mask.bits[si]!; n++;
          const d = depth[si]!;
          if (Number.isFinite(d)) { sum += d; cnt++; }
        }
      bits[y * outW + x] = n > 0 && on * 2 >= n ? 1 : 0;
      // NaN where unoccupied, matching the invariant both source rasters
      // uphold (depth NaN wherever the mask is 0): a background-majority box
      // can still contain occupied corners, and their mean must not leak
      // into pixels the mask says are background.
      if (n > 0 && on * 2 >= n) {
        if (cnt > 0) out[y * outW + x] = sum / cnt;
      } else {
        out[y * outW + x] = NaN;
      }
    }
  }
  return { mask: { w: outW, h: outH, bits }, depth: out };
}

/**
 * Where the two subjects' surfaces disagree, in metres, per height band.
 *
 * `body` is the compiled .blob; `ref` is normally the reference MESH as a
 * triangle soup (parseGlb + gltfTriangles), but a second BuiltBody is
 * accepted too — which is how the self-comparison test gets identical
 * geometry on both sides, since a body cannot be triangulated back exactly.
 *
 * DEPTH NORMALISATION, and why raw metres are not compared directly: the two
 * rasters live in different world frames — a GLB's z origin is whatever the
 * exporter chose, and the mask comparison (normalise) has already thrown
 * absolute position away. Comparing raw depths would report every band a
 * constant fake offset equal to wherever the mesh happened to be exported.
 * So each subject's depths are re-zeroed at the MIDPOINT of the depth range
 * its own raster recorded — the depth analogue of normalise mapping a mask
 * to its own box. Midpoint rather than front-most crest or a min-max
 * rescale, for two measured reasons: a crest offset flips the sign of every
 * shape difference (the slab/dome case reads backwards), and a min-max
 * rescale divides by the subject's own depth span, making a uniformly
 * too-shallow body score zero — exactly the error this tool exists to catch.
 * Midpoint also needs no division, so a perfectly flat subject (a slab, a
 * disc) cannot NaN the report.
 *
 * READING signedErr: positive means the body's front surface sits nearer the
 * camera — relative to each subject's own depth midpoint — than the mesh's:
 * at that height the body sticks out further than the mesh does. Negative
 * means the mesh has depth the body lacks: the missing pecs, the waist the
 * cylinder ignored. Per band, worst first, each named with the `.blob` line
 * bandOwners blames for that height.
 */
export function diffDepth(
  body: BuiltBody, ref: BuiltBody | Float32Array, opts: DepthDiffOpts = {},
): DepthDiffReport {
  const view = opts.view ?? 'front';
  const heightPx = opts.heightPx ?? 256;
  const bands = opts.bands ?? 16;
  const g = opts.grid ?? 128;

  const a = depthFromBody(body, { view, heightPx });
  const r = ref instanceof Float32Array
    ? depthFromTriangles(ref, { view, heightPx })
    : depthFromBody(ref, { view, heightPx });

  const an = resampleDepth(a.mask, a.depth, g, g);
  const rn = resampleDepth(r.mask, r.depth, g, g);

  // Each side's own depth midpoint, from the RESAMPLED grids — the values
  // the diff actually runs on, so both sides are offset by the same kind of
  // quantity. A subject with no finite depth (empty, or kit-only) gets 0,
  // which cannot matter: such a band has no samples to weight.
  const mid = (depth: Float32Array): number => {
    let min = Infinity, max = -Infinity;
    for (const d of depth) if (Number.isFinite(d)) {
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return min <= max ? (min + max) / 2 : 0;
  };
  const aMid = mid(an.depth), rMid = mid(rn.depth);

  const sumAbs = new Float64Array(bands), sum = new Float64Array(bands);
  const count = new Float64Array(bands);
  let totalAbs = 0, total = 0, totalN = 0;
  for (let y = 0; y < g; y++) {
    // Clamp for float safety at the last row: y/g is strictly < 1, but a
    // bands value larger than g would otherwise index out of the arrays.
    const bi = Math.min(bands - 1, Math.floor((y / g) * bands));
    for (let x = 0; x < g; x++) {
      const i = y * g + x;
      if (!an.mask.bits[i] || !rn.mask.bits[i]) continue;
      const ad = an.depth[i]!, rd = rn.depth[i]!;
      if (!Number.isFinite(ad) || !Number.isFinite(rd)) continue;
      // Positive = the body's surface is nearer the camera than the mesh's.
      const e = (rd - rMid) - (ad - aMid);
      sumAbs[bi] = sumAbs[bi]! + Math.abs(e);
      sum[bi] = sum[bi]! + e;
      count[bi] = count[bi]! + 1;
      totalAbs += Math.abs(e); total += e; totalN++;
    }
  }

  // Attribution rides on bandOwners, whose band i is the SAME height span
  // [i/bands, (i+1)/bands] of subject height — it derives its band centres
  // from the subject box exactly as y0/y1 are derived here, so a band index
  // means the same height in both. (This is the same alignment contract
  // bandOwners documents against compareSilhouette.)
  const owners = bandOwners(body, { view, bands });

  const out: DepthDiffBand[] = [];
  for (let i = 0; i < bands; i++) {
    const n = count[i]!;
    const o = owners[i];
    out.push({
      y0: i / bands, y1: (i + 1) / bands,
      meanErr: n ? sumAbs[i]! / n : 0,
      signedErr: n ? sum[i]! / n : 0,
      samples: n,
      ...(n && o && o.line !== null
        ? { owner: { line: o.line, label: `${o.limb} on ${o.bone}` } }
        : {}),
    });
  }
  out.sort((p, q) => q.meanErr - p.meanErr);
  return {
    bands: out,
    meanErr: totalN ? totalAbs / totalN : 0,
    signedErr: totalN ? total / totalN : 0,
    samples: totalN,
  };
}

/** The subject-box lookup resampleDepth shares with normalise — kept local
 *  so the depth path does not import silhouette's private internals beyond
 *  its public surface. */
function subjectBoundsOf(mask: Mask): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = mask.w, y0 = mask.h, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.h; y++)
    for (let x = 0; x < mask.w; x++)
      if (mask.bits[y * mask.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
