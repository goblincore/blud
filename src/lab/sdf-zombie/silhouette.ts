// Silhouette matching — scoring a character's OUTLINE against a reference
// image.
//
// WHY THIS EXISTS. validateBody and the fused/clear checks prove a body is
// closed, connected and non-interpenetrating. None of them can tell you it
// reads as the character, and the skill doc says so outright. The mouse is the
// worked example of the gap: the 2026-08-22 proportion pass hit every local
// target it was given — ring widths, ankle clearance, "the shoe must reach the
// floor" — and still came out with a narrow snout, a nose the reference does
// not have, ears half the size they should be and both shoes fused into one
// pod. Every one of those is visible in the OUTLINE and invisible to a check
// that measures one primitive at a time.
//
// So this reduces both the built body and the reference PNG to a binary mask,
// normalises each to its own subject bounding box, and compares them. That
// normalisation is the point: it is scale- and position-invariant, so the
// score is about PROPORTION and nothing else. A character rendered at half
// size or shifted across the frame scores identically.
//
// WHAT IT IS NOT. A silhouette score cannot see colour, features inside the
// outline (the mouse's sunglasses), or depth. A perfect score is necessary,
// not sufficient — keep looking at the render. It is meant to catch the class
// of error that a human spots in a thumbnail and a numeric check never does.
//
// POSE DOMINATES THE SCORE, AND THAT IS THE BIG CAVEAT. Reference plates are
// drawn in whatever pose the artist chose; a .blob rasterises in its authored
// REST pose. Arms are the whole problem: the mouse plate holds them out to the
// sides, the clown plate throws them out asymmetrically, and both our
// characters stand with arms down. Measured, on the day this was written:
//
//   mouse (REJECTED by the owner)  IoU 0.709   mean width error 0.074
//   clown (APPROVED by the owner)  IoU 0.640   mean width error 0.095
//
// The approved character scores WORSE. So the headline number is NOT a grade
// and must never be used as a pass/fail gate across characters — it would have
// told us to throw away the clown and keep the mouse.
//
// AND THE DEEPER REASON IS NOT POSE. The owner's own words on the clown: fine
// with how it turned out "despite not matching the reference", where the mouse
// "is a different case". Matching the plate is a per-character INTENT, not a
// universal goal — a plate is sometimes a brief to hit and sometimes a mood to
// depart from. A low score is a question ("did you mean to diverge here?"),
// never a verdict. Only the author answers it.
//
// What the tool is good for:
//
//   * the side-by-side picture, which shows the problem at a glance;
//   * per-band deltas in height ranges where the pose AGREES, which is why
//     `range` exists — the mouse's legs and shoes live at 0.75-1.0, below the
//     arms in both images, and there the bands correctly and loudly called the
//     shoes less than half the width they should be;
//   * tracking ONE character against ONE plate across an edit, where pose is
//     constant and the change in the numbers is real signal.
import { sdBody } from './validate';
import type { BuiltBody, Vec3 } from './types';

/** 1 = subject, 0 = background. Row 0 is the TOP of the image. */
export interface Mask {
  w: number;
  h: number;
  bits: Uint8Array;
}

/** Inclusive pixel bounds of the subject within a mask. */
export interface Bounds {
  x0: number; y0: number; x1: number; y1: number;
}

export interface RefMaskOpts {
  /**
   * How far a pixel must sit from the background colour, in 0-255 units summed
   * over RGB, to count as subject. The default clears the reference plates we
   * have by a wide margin: the mouse's lightest subject pixel is a shoe
   * highlight at 213 (42 from white) while the background sits at 254-255.
   */
  threshold?: number;
  /**
   * Background colour. Omitted means "sample it" — the median of the image's
   * border pixels, which is right for a plate on a flat backdrop and is what
   * every reference we have is.
   */
  background?: [number, number, number];
  /**
   * Keep only the largest connected blob. Drops watermarks, stray specks and a
   * DETACHED drop shadow. It cannot drop a shadow that touches the feet — for
   * that, raise `threshold`. On by default; the component count is reported so
   * a surprise is visible rather than silent.
   */
  largestComponentOnly?: boolean;
}

export interface RefMaskResult {
  mask: Mask;
  /** Before any largest-component filtering. 1 is the healthy case. */
  components: number;
  /** Fraction of the image the subject covers, after filtering. */
  coverage: number;
  background: [number, number, number];
}

/**
 * Reference plate -> mask, by distance from the backdrop colour.
 *
 * Alpha is deliberately IGNORED. Every reference in docs/dev-notes/refs/ is
 * RGBA with alpha 255 everywhere — the white is painted, not transparent — so
 * keying on alpha yields a mask of the whole rectangle and a silhouette score
 * of "the character is a square", which looks like a catastrophic modelling
 * failure rather than a decode mistake.
 */
export function maskFromRgba(
  rgba: Uint8Array, w: number, h: number, opts: RefMaskOpts = {},
): RefMaskResult {
  const threshold = opts.threshold ?? 24;
  const bg = opts.background ?? sampleBackground(rgba, w, h);
  const bits = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; i += 4, p++) {
    const d = Math.abs(rgba[i]! - bg[0]) + Math.abs(rgba[i + 1]! - bg[1]) + Math.abs(rgba[i + 2]! - bg[2]);
    bits[p] = d > threshold ? 1 : 0;
  }
  const mask: Mask = { w, h, bits };
  const { components, kept } = opts.largestComponentOnly === false
    ? { components: countComponents(mask), kept: mask }
    : keepLargestComponent(mask);
  let on = 0;
  for (const b of kept.bits) on += b;
  return { mask: kept, components, coverage: on / (w * h), background: bg };
}

/** Median of the four border rows/columns. Median, not mean, so a subject that
 *  runs off the edge of the plate cannot drag the estimate. */
function sampleBackground(rgba: Uint8Array, w: number, h: number): [number, number, number] {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  const push = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    r.push(rgba[o]!); g.push(rgba[o + 1]!); b.push(rgba[o + 2]!);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]!; };
  return [med(r), med(g), med(b)];
}

/**
 * Orthographic silhouette of a built body, by sphere-tracing one ray per pixel.
 *
 * The ray is cast along the view axis and asks only "is the field ever
 * negative", so this is an occupancy test rather than a render: no normals, no
 * shading, no lights to disagree about. It reads the SAME sdBody the checks
 * use, which means it sees smooth-min blending, `sub` carves and grooves
 * exactly as the shader will.
 *
 * Cluster bounding spheres do the heavy lifting. Most pixels of a humanoid's
 * bounding box are empty, and a pixel whose ray misses every cluster sphere is
 * rejected without a single sdBody call.
 */
export interface BodyMaskOpts {
  /** 'front' looks down -z (the face); 'side' looks down -x. */
  view?: 'front' | 'side';
  /** Rows in the output. Columns follow from the body's aspect ratio. */
  heightPx?: number;
  /** Padding around the body bounds, as a fraction of its height. */
  pad?: number;
  /** Surface threshold. Rays stop when the field drops below this. */
  eps?: number;
  maxSteps?: number;
  /**
   * The character's POLYGON kit, as flat triangle vertices from
   * gltfTriangles(). Pass it whenever the character has one.
   *
   * WITHOUT THIS THE COMPARISON IS RIGGED. A reference plate shows a DRESSED
   * character; a .blob is bare flesh. Measured on the mouse: the shoes are
   * 0.132 of body height as flesh alone, 0.204 with the kit, against 0.345 on
   * the plate. Both readings say "too narrow", but the flesh-only one blames
   * the sculpt for bulk that was always the kit's job, and it does that
   * everywhere the kit adds volume — shoes, tee, shorts — so a rebuild driven
   * by it would thicken the body to compensate for clothes it cannot see.
   */
  kit?: Float32Array;
}

/**
 * World-space triangles out of a compiled kit glTF.
 *
 * Positions are taken from the POSITION accessors verbatim, in BIND space, and
 * that is correct here rather than a shortcut: the kit is authored in the same
 * metre space as the .blob (the glTF's own `pelvis` node sits at the .blob's
 * `root pelvis at` height) and the lab places it at the body root with no
 * scale. At the rest pose every joint's world matrix cancels its inverse bind
 * matrix, so skinning is the identity and bind space IS rest world space —
 * which is the only pose a silhouette is ever taken in.
 *
 * Buffers must be embedded as data URIs, which is what scripts/build-wam-kit.sh
 * emits; an external .bin would need a file read and this stays I/O-free so it
 * can run in the browser too.
 */
export function gltfTriangles(gltf: {
  buffers: Array<{ uri?: string }>;
  bufferViews: Array<{ buffer: number; byteOffset?: number; byteStride?: number }>;
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number }>;
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; indices?: number }> }>;
}): Float32Array {
  const bufs = gltf.buffers.map((b) => {
    const uri = b.uri ?? '';
    const comma = uri.indexOf(',');
    if (!uri.startsWith('data:') || comma < 0)
      throw new Error('kit glTF buffer is not an embedded data URI');
    const bin = atob(uri.slice(comma + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  });

  const tris: number[] = [];
  for (const mesh of gltf.meshes)
    for (const prim of mesh.primitives) {
      const pa = gltf.accessors[prim.attributes.POSITION]!;
      const pv = gltf.bufferViews[pa.bufferView]!;
      const pbuf = bufs[pv.buffer]!;
      const pdv = new DataView(pbuf.buffer, pbuf.byteOffset + (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0));
      const pstride = pv.byteStride || 12;
      const pos = (i: number): [number, number, number] => [
        pdv.getFloat32(i * pstride, true),
        pdv.getFloat32(i * pstride + 4, true),
        pdv.getFloat32(i * pstride + 8, true),
      ];

      let index: (k: number) => number;
      let count: number;
      if (prim.indices === undefined) {
        count = pa.count;
        index = (k) => k;
      } else {
        const ia = gltf.accessors[prim.indices]!;
        const iv = gltf.bufferViews[ia.bufferView]!;
        const ibuf = bufs[iv.buffer]!;
        const idv = new DataView(ibuf.buffer, ibuf.byteOffset + (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0));
        // 5121 UNSIGNED_BYTE, 5123 UNSIGNED_SHORT, 5125 UNSIGNED_INT.
        const size = ia.componentType === 5125 ? 4 : ia.componentType === 5123 ? 2 : 1;
        count = ia.count;
        index = (k) => size === 4 ? idv.getUint32(k * 4, true)
          : size === 2 ? idv.getUint16(k * 2, true) : idv.getUint8(k);
      }
      for (let k = 0; k + 2 < count; k += 3)
        for (const v of [index(k), index(k + 1), index(k + 2)]) tris.push(...pos(v));
    }
  return new Float32Array(tris);
}

export function maskFromBody(body: BuiltBody, opts: BodyMaskOpts = {}): Mask {
  const view = opts.view ?? 'front';
  const heightPx = opts.heightPx ?? 256;
  const pad = opts.pad ?? 0.02;
  const eps = opts.eps ?? 1e-3;
  const maxSteps = opts.maxSteps ?? 96;

  const live = body.clusters.filter((c) => c.alive);
  if (!live.length) return { w: 1, h: 1, bits: new Uint8Array(1) };

  // Bounds from the cluster spheres — a superset of the surface, which is what
  // we want: the mask must not be cropped by its own framing.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of live) {
    minX = Math.min(minX, c.center[0] - c.radius); maxX = Math.max(maxX, c.center[0] + c.radius);
    minY = Math.min(minY, c.center[1] - c.radius); maxY = Math.max(maxY, c.center[1] + c.radius);
    minZ = Math.min(minZ, c.center[2] - c.radius); maxZ = Math.max(maxZ, c.center[2] + c.radius);
  }
  // The kit joins the BOUNDS as well as the raster. A hat or a heel that
  // reaches past the flesh has to widen the frame, or it would be cropped and
  // the silhouette would be missing exactly the part that sticks out.
  const kit = opts.kit;
  if (kit && kit.length) {
    for (let i = 0; i < kit.length; i += 3) {
      const x = kit[i]!, y = kit[i + 1]!, z = kit[i + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }

  const padY = (maxY - minY) * pad;
  minY -= padY; maxY += padY;

  // Screen axes. `u` runs left-to-right across the image, `d` is the view
  // direction the ray travels along.
  //   front: u = world x, depth = z. Screen x therefore INCREASES with world
  //          x, i.e. the image is what you see standing BEHIND the character.
  //          Characters are near-symmetric so this only matters for the
  //          centroid-offset readout, and it is documented rather than flipped
  //          so the mapping stays one obvious line.
  //   side:  u = world z, depth = x.
  const uMin = view === 'front' ? minX : minZ;
  const uMax = view === 'front' ? maxX : maxZ;
  const padU = (maxY - minY) * pad;
  const u0 = uMin - padU, u1 = uMax + padU;
  const dMin = view === 'front' ? minZ : minX;
  const dMax = view === 'front' ? maxZ : maxX;

  const h = heightPx;
  const spanY = maxY - minY;
  const spanU = u1 - u0;
  const w = Math.max(1, Math.round(h * (spanU / spanY)));
  const bits = new Uint8Array(w * h);

  const step = spanY / h; // world units per pixel, used as the march floor
  for (let py = 0; py < h; py++) {
    // Row 0 is the TOP of the image, so world y runs the other way.
    const wy = maxY - (py + 0.5) * (spanY / h);
    for (let px = 0; px < w; px++) {
      const wu = u0 + (px + 0.5) * (spanU / w);
      // Cheap reject: does this ray pass within any live cluster's sphere?
      let near = Infinity, far = -Infinity;
      for (const c of live) {
        const cu = view === 'front' ? c.center[0] : c.center[2];
        const cd = view === 'front' ? c.center[2] : c.center[0];
        const du = wu - cu, dy = wy - c.center[1];
        const off2 = du * du + dy * dy;
        const r2 = c.radius * c.radius;
        if (off2 >= r2) continue;
        const half = Math.sqrt(r2 - off2);
        near = Math.min(near, cd - half);
        far = Math.max(far, cd + half);
      }
      if (near > far) continue; // ray misses every cluster — no sdBody call

      let t = Math.max(near, dMin);
      const tEnd = Math.min(far, dMax);
      let hit = false;
      for (let s = 0; s < maxSteps && t <= tEnd; s++) {
        const p: Vec3 = view === 'front' ? [wu, wy, t] : [t, wy, wu];
        const d = sdBody(p, body);
        if (d < eps) { hit = true; break; }
        // Floor the step at a fraction of a pixel: a field that returns a tiny
        // positive distance forever (which smooth-min near a seam does) would
        // otherwise burn every step creeping and report a miss on solid flesh.
        t += Math.max(d, step * 0.25);
      }
      if (hit) bits[py * w + px] = 1;
    }
  }

  // The kit is UNIONED on top, filled as flat triangles. A silhouette only
  // asks "is anything here", so depth never has to be resolved between the
  // polygons and the field — which is the whole reason this can ignore the
  // depth-in-alpha compositing the real renderer needs.
  if (kit && kit.length) {
    const toPx = (i: number): [number, number] => [
      ((view === 'front' ? kit[i]! : kit[i + 2]!) - u0) / spanU * w,
      (maxY - kit[i + 1]!) / spanY * h,
    ];
    for (let i = 0; i + 8 < kit.length; i += 9)
      fillTriangle(bits, w, h, toPx(i), toPx(i + 3), toPx(i + 6));
  }
  return { w, h, bits };
}

/**
 * Half-open scanline fill of one projected triangle.
 *
 * Coverage is by pixel CENTRE, and every triangle of a closed mesh is filled
 * independently, so shared edges can leave a hairline of unset pixels where two
 * triangles meet at a shallow angle. That is invisible at the resolutions this
 * runs at — the mask is downsampled to a 128-square before anything is
 * measured — and a conservative fill would instead fatten every silhouette by
 * half a pixel, which is a bias rather than a speckle.
 */
function fillTriangle(
  bits: Uint8Array, w: number, h: number,
  a: [number, number], b: [number, number], c: [number, number],
): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  if (minX > maxX || minY > maxY) return;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (area === 0) return; // degenerate, and glTF kits carry a few
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      // Edge functions, normalised by the signed area so winding does not
      // matter — a kit has triangles of both windings once it is mirrored.
      const w0 = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) / area;
      const w1 = ((c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0])) / area;
      const w2 = ((a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0])) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) bits[y * w + x] = 1;
    }
}

export function subjectBounds(mask: Mask): Bounds | null {
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

/**
 * Resample a mask's SUBJECT BOX onto a canonical grid.
 *
 * This is where scale and position invariance come from, and it is the whole
 * reason two images of wildly different sizes can be compared at all: the
 * reference plate is 1024x1024 and the body mask is a few hundred pixels of
 * whatever aspect the character happens to have.
 *
 * Box-filtered rather than nearest-sampled — a thin limb one source pixel wide
 * disappears entirely under nearest sampling at these downscale factors, and
 * a vanished arm reads as a modelling error.
 */
export function normalise(mask: Mask, outW: number, outH: number): Mask {
  const b = subjectBounds(mask);
  const bits = new Uint8Array(outW * outH);
  if (!b) return { w: outW, h: outH, bits };
  const sw = b.x1 - b.x0 + 1, sh = b.y1 - b.y0 + 1;
  for (let y = 0; y < outH; y++) {
    const sy0 = b.y0 + Math.floor((y * sh) / outH);
    const sy1 = b.y0 + Math.max(Math.ceil(((y + 1) * sh) / outH), Math.floor((y * sh) / outH) + 1);
    for (let x = 0; x < outW; x++) {
      const sx0 = b.x0 + Math.floor((x * sw) / outW);
      const sx1 = b.x0 + Math.max(Math.ceil(((x + 1) * sw) / outW), Math.floor((x * sw) / outW) + 1);
      let on = 0, n = 0;
      for (let sy = sy0; sy < Math.min(sy1, b.y1 + 1); sy++)
        for (let sx = sx0; sx < Math.min(sx1, b.x1 + 1); sx++) { on += mask.bits[sy * mask.w + sx]!; n++; }
      bits[y * outW + x] = n > 0 && on * 2 >= n ? 1 : 0;
    }
  }
  return { w: outW, h: outH, bits };
}

/** One horizontal band of the comparison. */
export interface BandReport {
  /** 0 at the top of the subject, 1 at the bottom. */
  at: number;
  /** Subject width in that band, as a fraction of subject HEIGHT. */
  refWidth: number;
  gotWidth: number;
  /** gotWidth - refWidth. Negative means ours is too narrow. */
  delta: number;
}

export interface SilhouetteReport {
  /** Intersection over union of the two normalised masks. 1 is identical. */
  iou: number;
  /** Mean |delta| over the bands, in fractions of subject height. */
  meanWidthError: number;
  /** The bands, worst-first, for reading as a to-do list. */
  worst: BandReport[];
  bands: BandReport[];
  /** Subject aspect (width/height) of each, before normalisation. */
  refAspect: number;
  gotAspect: number;
}

/**
 * Compare two masks by outline.
 *
 * Two numbers, because they fail in different ways and a single score hides
 * it. IoU catches overall shape agreement but is dominated by the big masses —
 * a torso that matches can carry a completely wrong pair of ears. The band
 * width profile is the opposite: it is per-height, so "the ears are half as
 * wide as they should be at 0.9" survives as its own line even though the ears
 * are a small fraction of the total area.
 */
export function compareSilhouette(
  ref: Mask, got: Mask,
  opts: { bands?: number; grid?: number; range?: [number, number] } = {},
): SilhouetteReport {
  const bands = opts.bands ?? 16;
  const g = opts.grid ?? 128;
  // Height window, 0 at the crown to 1 at the soles. Both the IoU and the band
  // profile are confined to it. This is how you get a number worth trusting
  // out of two different poses: score only where the poses agree.
  const [lo, hi] = opts.range ?? [0, 1];
  const rowLo = Math.max(0, Math.min(g - 1, Math.floor(lo * g)));
  const rowHi = Math.max(rowLo + 1, Math.min(g, Math.ceil(hi * g)));
  const rb = subjectBounds(ref), gb = subjectBounds(got);
  const refAspect = rb ? (rb.x1 - rb.x0 + 1) / (rb.y1 - rb.y0 + 1) : 0;
  const gotAspect = gb ? (gb.x1 - gb.x0 + 1) / (gb.y1 - gb.y0 + 1) : 0;

  // Normalised to a SQUARE grid, so a column of the grid is the same fraction
  // of subject height in both — which is what makes the widths comparable.
  const rn = normalise(ref, g, g), gn = normalise(got, g, g);

  let inter = 0, union = 0;
  for (let y = rowLo; y < rowHi; y++)
    for (let x = 0; x < g; x++) {
      const i = y * g + x;
      const a = rn.bits[i]!, b = gn.bits[i]!;
      if (a & b) inter++;
      if (a | b) union++;
    }

  // Width is measured as the EXTENT (rightmost minus leftmost occupied), not
  // the count of set pixels. The two differ exactly where a band contains a
  // gap — between the legs, or between two splayed shoes — and extent is the
  // one that matches what the eye calls "how wide is it here".
  const out: BandReport[] = [];
  const span = rowHi - rowLo;
  for (let bnd = 0; bnd < bands; bnd++) {
    const y0 = rowLo + Math.floor((bnd * span) / bands);
    const y1 = rowLo + Math.max(Math.floor(((bnd + 1) * span) / bands), Math.floor((bnd * span) / bands) + 1);
    // extent() is measured on the NORMALISED grid, where the subject fills the
    // full width — so extent/g is a fraction of the subject's own WIDTH.
    // Multiplying by its aspect converts that to a fraction of subject HEIGHT,
    // which is the unit both sides are reported in.
    out.push({
      // Reported in WHOLE-SUBJECT coordinates, not window-relative ones, so a
      // band means the same height whatever range was scored.
      at: (rowLo + ((bnd + 0.5) * span) / bands) / g,
      refWidth: (extent(rn, y0, y1) / g) * refAspect,
      gotWidth: (extent(gn, y0, y1) / g) * gotAspect,
      delta: 0,
    });
  }
  for (const b of out) b.delta = +(b.gotWidth - b.refWidth).toFixed(4);
  const meanWidthError = out.reduce((s, b) => s + Math.abs(b.delta), 0) / out.length;
  return {
    iou: union ? inter / union : 0,
    meanWidthError,
    worst: [...out].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    bands: out,
    refAspect,
    gotAspect,
  };
}

/** Widths are reported against subject HEIGHT, so the normalised grid's width
 *  has to be converted back through the subject's original aspect. */
function aspectScale(b: Bounds | null): number {
  return b ? (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1) : 0;
}

function extent(m: Mask, y0: number, y1: number): number {
  let lo = m.w, hi = -1;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < m.w; x++)
      if (m.bits[y * m.w + x]) { if (x < lo) lo = x; if (x > hi) hi = x; }
  return hi < 0 ? 0 : hi - lo + 1;
}

/** 4-connected component count, and the mask reduced to its biggest one. */
function keepLargestComponent(mask: Mask): { components: number; kept: Mask } {
  const { w, h, bits } = mask;
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!bits[s] || label[s] !== -1) continue;
    const id = sizes.length;
    const visit = (q: number) => {
      if (bits[q] && label[q] === -1) { label[q] = id; stack.push(q); }
    };
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return { components: sizes.length, kept: mask };
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i]! > sizes[best]!) best = i;
  const kept = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (label[p] === best) kept[p] = 1;
  return { components: sizes.length, kept: { w, h, bits: kept } };
}

function countComponents(mask: Mask): number {
  return keepLargestComponent(mask).components;
}

/**
 * ASCII rendering, for putting a silhouette in a terminal or a dev note.
 *
 * PASS `rows` WHEN PRINTING TWO OF THESE SIDE BY SIDE. Left to itself each
 * mask picks a row count from its OWN aspect, so two figures printed next to
 * each other end up at different vertical scales and their rows do not
 * correspond — it still looks like a comparison, which is worse than not
 * printing one. That is not hypothetical: it made the mouse's splayed shoes
 * look absent from a figure whose shoe band measured 0.346 against the
 * plate's 0.345.
 */
export function renderMask(mask: Mask, cols = 48, rowsOverride?: number): string {
  // Terminal cells are about twice as tall as they are wide.
  const rows = rowsOverride ?? Math.max(1, Math.round(cols * (mask.h / mask.w) * 0.5));
  const small = normalise(mask, cols, rows);
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) s += small.bits[y * cols + x] ? '#' : '.';
    lines.push(s);
  }
  return lines.join('\n');
}
