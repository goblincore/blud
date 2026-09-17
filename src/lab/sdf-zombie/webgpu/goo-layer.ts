// src/lab/sdf-zombie/webgpu/goo-layer.ts
//
// Screen-space metaball blood (gobs-and-goo spec §3): the viscous goo the
// billboard droplets could never sell. Two passes per frame:
//
//   DENSITY — every goo particle (droplets at/over the mist cutoff + all
//   scraps) billboards a soft radial-falloff quad into a half-res additive
//   float target. R accumulates density, G accumulates density * view depth,
//   B accumulates density again as the divisor that turns G into an average
//   depth. Overlapping blobs therefore SUM, which is the entire metaball
//   trick: density is a scalar field on screen, and thresholding it fuses
//   neighbours into ropey strands and sheets while sparse drops stay beads.
//
//   BLUR — the canonical grapes→sheets fix from screen-space fluid
//   rendering (reference: jeantimex/fluid's screen-space pipeline): every
//   splat resolves as its own density peak, so thresholding the RAW field
//   beads trails into pearls no matter how the size/overlap/threshold are
//   tuned. A separable 9-tap Gaussian (horizontal into one target, vertical
//   into the other, sigma = GOO_TUNING.blurPx density-target pixels) widens
//   each peak until neighbours fuse into ropes and sheets. ALL channels are
//   filtered with the same weights, so the g/b depth ratio recovers a depth
//   smoothed exactly as far as the density itself — downstream unchanged.
//   blurPx = 0 bypasses both passes entirely.
//
//   SURFACE — a fullscreen quad re-thresholds the density field per pixel,
//   derives a normal from the density gradient (central differences, 4
//   taps), shades deep-red blood with the march's own light rig, and writes
//   a fake depth reconstructed from the per-pixel average view depth so the
//   goo interleaves with flesh and floor in the canvas depth buffer. When
//   the blur ran, this reads the blurred buffer instead of the raw density.
//
// WHY HALF-FLOAT, not the FloatType the SDF targets use: the density pass
// BLENDS (additive), and WebGPU core only guarantees blending on 16-bit
// float targets — rgba32f blending needs the optional float32-blendable
// feature. Precision is not a concern at this range: density sums live in
// the tens, and the G/B depth ratio needs far less than half-float's ~0.05
// relative resolution.
//
// Render-target discipline copied from sdf-layer.ts: options, the explicit
// first clear after every (re)allocation (three otherwise lazily initialises
// the texture inside the same encoder as the pass that samples it, and
// WebGPU rejects the whole submit), clear-to-BLACK with restore (the
// renderer's clear colour is the scene background, and a non-zero R channel
// would read as density everywhere), and autoClear off for the canvas
// composite so it cannot wipe the frame it composites onto.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, texture, uv, vec2, vec3, vec4, uniform, float, max, dot, positionView,
  attribute, mul,
} from 'three/tsl';
import type { BloodSim, Droplet } from '../blood-sim';
import { setPassLabel } from './gpu-pass-timing';

/**
 * The goo feel knobs. Everything the panel does not expose is still a named
 * number here, because "blobby merged vs discrete beads" is a two-knob
 * family (threshold, blob size) and the rest only matter when re-tuning the
 * family itself.
 */
export const GOO_TUNING = {
  /** InstancedMesh cap for the density pass (droplets + scraps + splats). */
  maxParticles: 1000,
  /**
   * Droplets with sim size UNDER this stay billboard mist (blood-view-gpu);
   * at/over it they feed the density field. 0.05 sits inside the burst band
   * (0.03-0.06), so a gib's burst keeps some fine beads while every trail
   * droplet (BLOOD_TRAIL.size 0.22 ± jitter) goes goo — trails are what
   * strands are made of.
   */
  mistMaxSize: 0.05,
  /** Density target size as a fraction of the SDF layer's size. */
  densityScale: 0.5,
  /**
   * Quad edge, in particle-size units. The falloff reaches zero at the quad
   * EDGE (not corner), so a particle's effective blob radius is
   * size * quadScale / 2. 2.2 puts a trail droplet's radius near 0.24 world
   * units — about half the 20 Hz trail spacing of a fast chunk, which is
   * the minimum for neighbours to fuse into a strand.
   */
  quadScale: 3.2,
  /**
   * World-size multiplier applied to every particle before it splats into the
   * density field. The sim sizes are the game's BILLBOARD sprite sizes
   * (BLOOD_TRAIL.size 0.22 was tuned for game-camera sprites); used raw as
   * physical blob radii they built quarter-metre goo towers (playtest
   * 2026-08-16). Same reasoning as the billboard view's DROPLET_VIEW_SCALE.
   * 0.4 read as thick hose-water ropes once the blur landed; 0.15 broke the
   * air trails into disconnected beads. 0.22 is the owner's mix point: thin
   * CONNECTED liquid strands in the air, with the billboard sprites layered
   * on top carrying the density (owner playtest 2026-08-16).
   */
  sizeScale: 0.22,
  /**
   * Floor-pool radius multiplier on a sim splat's decal size. Splats are the
   * PERSISTENT blood record (they never age out — blood-sim keeps a 256 ring
   * buffer), so feeding them into the density field is what makes pools stay
   * after their droplets die (owner note 2026-08-16: pools vanished with the
   * droplets). Each splat is a billboarded blob at its floor point (flat
   * quads stripe near edge-on in the low-res buffer), elongated 1.4-2.6x
   * along its stamp yaw so pools merge into smears, not perfect circles.
   */
  splatGooScale: 0.25,
  /** Density above which a pixel is goo. A lone blob peaks near 1.0. */
  threshold: 0.4,
  /** Soft-edge band start, as a multiple of the threshold. */
  edge: 1.6,
  /** Density-gradient to normal strength (see GOO_SURFACE_WGSL). */
  bump: 2.5,
  /**
   * Gaussian blur sigma, in density-target pixels, applied separably (H
   * then V) between the density pass and the surface pass — see the BLUR
   * note in the file header. 0 bypasses both blur passes entirely.
   */
  blurPx: 2.5,
  /**
   * Beer-Lambert thickness strength (blood-viscosity spec §d). Multiplies
   * (density - threshold) before the absorption exponential, so it scales
   * how fast a mass darkens as it thickens. 0 flattens the body to a single
   * colour (no thickness falloff) — this is NOT the pre-viscosity look,
   * since the base colour literal changed in this same commit too (0.35,
   * 0.02, 0.05 → 0.62, 0.11, 0.10).
   * 0.55 is the 2D prototype's owner-selected value.
   */
  absorb: 0.55,
  /**
   * Cap on the velocity stretch applied to each density quad: a particle's
   * quad is elongated along its screen-space motion by 1 + min(speed * 0.18,
   * stretchMax). The lab wants this — it turns a slow trail into a strand.
   *
   * It is ACTIVELY WRONG for a gout. Impact droplets leave at up to 8 m/s, so
   * every one of them pins at the cap and points radially outward from the
   * hit, which renders as a starburst of needles rather than a fused mass
   * (owner, 2026-08-31: "reads distinctly as elongated ovals"). The 2D
   * prototype that set the target look had no velocity stretch at all.
   * 0 = round blobs, which is the reference-look setting.
   */
  stretchMax: 0.8,
  /** Specular strength — the wet glint that sells "shiny". */
  spec: 1.4,
  /** Specular exponent. LOW = broad wet sheen, HIGH = a pinpoint star. */
  gloss: 80,
  /** Fresnel rim strength, warm-tinted so edges do not read pink. */
  rim: 0.3,
  /**
   * Unlit deep-red floor added to every goo pixel, so neither heavy
   * absorption nor a grazing light angle can drive blood to black. 0 restores
   * the physically-pure (and, per the owner, wrong-looking) behaviour.
   */
  shadowRed: 0.12,
  /**
   * Reconstruct world-oriented surface normals from the field's own view
   * depth, instead of tilting a camera-facing base by the density gradient.
   * The gradient normal cannot respond to where a surface points in the
   * world, which is what made the goo read as pasted on even once it
   * occluded correctly (owner, 2026-08-31).
   */
  surfaceNormals: true,
} as const;

/**
 * Gate + documentation flag for the gut-mask channel assignment (organs r3):
 * the density target's BLUE channel carries gut-weighted density.
 *
 * NOT alpha, which is what this first tried. The density pass writes through
 * a node material's `colorNode`, and three FORCES that alpha to `opacity`
 * (see the density-pass comment below, which said so before this was
 * written). A custom alpha term is silently discarded, so `.a` accumulated a
 * constant 1 per overlapping quad — and `gutFrac = a/r` then came out >= 1
 * almost everywhere, painting every blood pixel with the organ colour. That
 * is what "the blood looks wrong" was.
 *
 * `.b` is genuinely free, and freeing it cost nothing: the pass wrote `fall`
 * into BOTH `.r` and `.b`, and view depth was reconstructed as `.g/.b`.
 * Dividing by `.r` instead is the same number — same value, same precision —
 * so `.b` was redundant, not spare-by-accident.
 *
 * If a future change needs `.b`, move this flag with the assignment and fix
 * the surface pass in the same commit; never let two meanings share a
 * channel silently.
 */
export const GOO_DENSITY_BLUE_IS_GUT_MASK = true;

// -------------------------------------------------------------------------
// PERF LEVERS (close-up task 4, 2026-09-04). Three sync-side seams plus one
// composite-side seam, every one DEFAULT-OFF: the shipped path must be
// pixel-identical, and the bench (scripts/goo-*.mjs) flips them per leg.
// The decision code is exported PURE so the off-state equivalence and the
// selection logic are testable without a GPU.
// -------------------------------------------------------------------------

/**
 * Projected radius of a world-space half-extent, in texels of a target
 * `targetH` texels tall, at view distance `viewDist`.
 *
 * This is the PROJECTED size test the sim's own size cannot make:
 * `mistMaxSize` routes small droplets to the billboard view, but a quad's
 * on-screen size also shrinks with DISTANCE — a trail droplet at 9 m is
 * sub-texel in the half-res density buffer no matter what its sim size is.
 * Below ~1 density texel a quad cannot fuse into a surface (the whole point
 * of the density field is overlap), so under the minTexel lever it is
 * skipped: fragment cost for nothing.
 */
export function projectedTexelRadius(
  worldHalfExtent: number, viewDist: number, tanHalfFovY: number, targetH: number,
): number {
  if (!(viewDist > 1e-6) || targetH < 1) return Infinity;
  const pxPerWorld = targetH / (2 * viewDist * tanHalfFovY);
  return worldHalfExtent * pxPerWorld;
}

/**
 * Splat fade weight for the DENSITY field (close-up task 4 item 3). Splats
 * are persistent BY DESIGN (256 ring, `push`+`shift`), so their density
 * contribution accumulates across a firefight forever. This fades the OLDEST
 * `fadeTail` ranks, and ONLY once the ring has actually accumulated past
 * them: while the ring holds no more than `fadeTail` splats nothing fades at
 * all (a young pool must not thin — the pools are a feature; it is the
 * ring-saturated ACCUMULATION that costs). The billboard splat itself is
 * untouched — the floor still reads bloody; only the goo density thins.
 * `fadeTail <= 0` = off, weight 1 everywhere (the shipped state).
 *
 * Ring POSITION stands in for age because `Splat` carries no timestamp and
 * blood-sim.ts is not ours to change: `shift()` makes index 0 the oldest,
 * so recency rank is derivable in the consumer for free.
 */
export function splatDensityWeight(
  rankFromNewest: number, total: number, fadeTail: number,
): number {
  if (fadeTail <= 0 || total <= fadeTail) return 1;
  const full = total - fadeTail; // newest ranks that stay full weight (> 0)
  if (rankFromNewest <= full) return 1;
  const t = (rankFromNewest - full) / fadeTail;
  return 1 - t * t * (3 - 2 * t); // 1 - smoothstep(0,1,t)
}

/**
 * Fill `out[0..count)` with candidate indices ordered by projected area,
 * largest first (ties broken by index ascending, so a deterministic scene
 * gives a deterministic frame). Returns `out`. This is the area-priority
 * lever's core: at the `maxParticles` cap the current fill order is droplet
 * insertion order, so a far-away trail can displace the burst in the
 * player's face — ranking by projected area keeps what actually covers
 * screen. Splats compete in the same pool, which also fixes their silent
 * starvation at the cap (they were filled AFTER droplets, so a full droplet
 * roster erased every pool from the density field).
 */
export function orderIndicesByAreaDesc(
  areas: ArrayLike<number>, count: number, out: number[],
): number[] {
  out.length = count;
  for (let i = 0; i < count; i++) out[i] = i;
  // Array#sort is stable, so equal areas keep collection order (index asc).
  return out.sort((a, b) => (areas[b]! - areas[a]!) || (a - b));
}

// -------------------------------------------------------------------------
// SMOOTH RECONSTRUCTION (blood-surface comparison task, 2026-09-13)
//
// The baseline surface pass floors the texture coordinate, reads ONE nearest
// texel and hard-discards below the threshold. That is exact and cheap, and
// it is also a block: the density target is half the SDF size (game
// densityScale 0.5), so one density texel is TWO output pixels and every
// silhouette lands on a 2-pixel staircase.
//
// The candidate reconstructs the field CONTINUOUSLY before it thresholds:
//
//   * BILINEAR FETCH at the continuous texel-centre coordinate, with the
//     density-weighted channels (g = density*viewDepth, b = gut-weighted
//     density) interpolated by the SAME weights. A linear combination of
//     density-weighted sums is itself a density-weighted mean, so g/r is a
//     coherent depth and b/r a coherent gut share. Nothing is mixed across
//     the empty background: density r rides in the denominator of every
//     ratio, so an empty neighbour contributes weight*r == 0 to it.
//   * SILHOUETTE COVERAGE from the FIELD GRADIENT. A bilinear fetch at +/-
//     one texel gives a smooth gradient, and the signed density distance
//     (dens - thresh) / |grad| is then measured IN TEXELS; a one-texel ramp
//     around the isocontour becomes the blend alpha. That is what removes
//     the staircase without growing the blobs or weakening the highlights.
//   * NORMALS from the interpolated field, with a density floor on the
//     neighbours (GOO_NEIGHBOR_MIN_FRACTION). The baseline's 1e-4 empty test
//     is meaningless once the field is interpolated: near a silhouette the
//     interpolated neighbour depth is a ratio of two small numbers. A
//     neighbour below a quarter of the threshold is rejected and the
//     min-difference fallback takes the other side, exactly as the baseline
//     does for a truly empty tap.
//
// Only the DEPTH composite changes shape: colour alpha = coverage, depth
// test ON, depthWrite OFF. A partially covered fringe must not stamp a depth
// that would then reject the opaque scene behind it, so the geometry write
// is disabled for the candidate; occluding walls and bodies are still
// respected by the hardware depth TEST against the scene buffer. The
// baseline depth material (alpha 1, depthWrite on) is untouched and stays the
// default. Combining this with the density-resolution perf seam is NOT
// supported: the candidate always composites at full output resolution (the
// low target's single alpha slot already carries depth in depth mode), and
// `densityDiagnostics.smoothForcesFullResComposite` reports that.
// -------------------------------------------------------------------------

/** Empty sentinel for the reconstructed field — the same 1e-4 the baseline
 *  uses for an unoccupied neighbour. */
export const GOO_FIELD_EMPTY_EPS = 1e-4;

/** A neighbour below this fraction of the threshold is rejected by the
 *  normal reconstruction (see the smooth-reconstruction note). */
export const GOO_NEIGHBOR_MIN_FRACTION = 0.25;

/**
 * DEPTH-DISCONTINUITY TOLERANCE (defect fix, 2026-09-13). The bilinear fetch
 * mixes four texels with the same weights for every channel, so `g/r` is a
 * density-weighted mean depth. That is correct inside ONE blood mass, but at
 * a silhouette between a near layer and a far layer it invents a phantom
 * depth half-way between them, and the phantom then bridges two separate
 * blood bodies into one sheet.
 *
 * A neighbourhood is therefore treated as two separate layers when the
 * occupied corner depths span more than this FRACTION of the nearest layer's
 * depth (with an absolute floor so millimetre-near layers do not trip it).
 * The blend still supplies density, but the depth and gut ratios fall back to
 * the densest occupied corner — no interpolated bridge.
 */
export const GOO_FIELD_DEPTH_REL = 0.25;
/** Absolute floor for the depth-spread tolerance, in view metres. */
export const GOO_FIELD_DEPTH_MIN = 0.02;

/** One reconstructed field sample: density plus the two ratios the surface
 *  pass consumes, or an empty sample where density is below the sentinel. */
export interface GooFieldSample {
  density: number;
  /** g / r, 0 when the sample is empty (the ratio is meaningless there). */
  viewDepth: number;
  /** b / r clamped to [0,1], 0 when the sample is empty. */
  gutFrac: number;
  occupied: boolean;
  /** True when the occupied corners spanned more than the depth tolerance
   *  and the ratios were taken from the densest corner instead of the blend.
   *  See GOO_FIELD_DEPTH_REL. */
  discontinuous: boolean;
}

/**
 * PURE mirror of the smooth pass's bilinear fetch. `field` is the density
 * target's CPU image — interleaved RGBA, .r density, .g density*viewDepth,
 * .b gut-weighted density — of size width*height*4 floats. `u`/`v` are the
 * flipped texture coordinates the WGSL uses.
 *
 * The ratios are computed AFTER interpolation, not before: averaging
 * per-texel depths and then dividing would weight an empty texel's
 * meaningless ratio by its interpolation weight. Because g and r are
 * interpolated with the same kernel, g/r is the density-weighted mean depth
 * by construction, and an empty neighbour's weight*r contribution to the
 * denominator is zero.
 */
export function sampleGooField(
  field: ArrayLike<number>, width: number, height: number, u: number, v: number,
): GooFieldSample {
  const empty: GooFieldSample = {
    density: 0, viewDepth: 0, gutFrac: 0, occupied: false, discontinuous: false,
  };
  if (width < 1 || height < 1 || field.length < width * height * 4) return empty;
  const cx = u * width - 0.5;
  const cy = v * height - 0.5;
  const bx = Math.floor(cx);
  const by = Math.floor(cy);
  const fx = cx - bx;
  const fy = cy - by;
  const x0 = Math.min(width - 1, Math.max(0, bx));
  const y0 = Math.min(height - 1, Math.max(0, by));
  const x1 = Math.min(width - 1, Math.max(0, bx + 1));
  const y1 = Math.min(height - 1, Math.max(0, by + 1));
  const at = (x: number, y: number, c: number): number => field[(y * width + x) * 4 + c] ?? 0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const r = at(x0, y0, 0) * w00 + at(x1, y0, 0) * w10 + at(x0, y1, 0) * w01 + at(x1, y1, 0) * w11;
  if (!(r > GOO_FIELD_EMPTY_EPS)) return empty;
  const g = at(x0, y0, 1) * w00 + at(x1, y0, 1) * w10 + at(x0, y1, 1) * w01 + at(x1, y1, 1) * w11;
  const b = at(x0, y0, 2) * w00 + at(x1, y0, 2) * w10 + at(x0, y1, 2) * w01 + at(x1, y1, 2) * w11;

  // Occupied-corner depth bounds and the densest corner. Only corners that
  // actually carry density AND carry interpolation weight can define a layer:
  // an empty corner's g/r is 0, and a zero-weight corner is not part of this
  // sample at all (otherwise an exact texel centre would look discontinuous
  // because of a neighbour it did not fetch).
  const cornerR = [at(x0, y0, 0), at(x1, y0, 0), at(x0, y1, 0), at(x1, y1, 0)];
  const cornerG = [at(x0, y0, 1), at(x1, y0, 1), at(x0, y1, 1), at(x1, y1, 1)];
  const cornerB = [at(x0, y0, 2), at(x1, y0, 2), at(x0, y1, 2), at(x1, y1, 2)];
  const cornerW = [w00, w10, w01, w11];
  let dLo = Infinity; let dHi = -Infinity;
  let domIdx = -1; let domR = -Infinity;
  for (let i = 0; i < 4; i++) {
    const ri = cornerR[i]!;
    if (!(ri > GOO_FIELD_EMPTY_EPS) || !(cornerW[i]! > 1e-6)) continue;
    const di = cornerG[i]! / ri;
    dLo = Math.min(dLo, di); dHi = Math.max(dHi, di);
    if (ri > domR) { domR = ri; domIdx = i; }
  }
  if (domIdx < 0) return empty;

  const tol = GOO_FIELD_DEPTH_REL * Math.max(dLo, GOO_FIELD_DEPTH_MIN);
  const discontinuous = (dHi - dLo) > tol;
  return {
    density: r,
    // The ratios are computed AFTER interpolation, not before: averaging
    // per-texel depths and then dividing would weight an empty texel's
    // meaningless ratio by its interpolation weight. When the corner depths
    // are incompatible the blend IS the phantom, so fall back to the densest
    // occupied corner instead.
    viewDepth: discontinuous
      ? cornerG[domIdx]! / Math.max(cornerR[domIdx]!, GOO_FIELD_EMPTY_EPS)
      : g / Math.max(r, GOO_FIELD_EMPTY_EPS),
    gutFrac: Math.min(1, Math.max(0,
      discontinuous
        ? cornerB[domIdx]! / Math.max(cornerR[domIdx]!, GOO_FIELD_EMPTY_EPS)
        : b / Math.max(r, GOO_FIELD_EMPTY_EPS),
    )),
    occupied: true,
    discontinuous,
  };
}

/**
 * PURE mirror of the candidate silhouette coverage. `gradMag` is the
 * per-texel density gradient magnitude (see `gooFieldGradient`); the signed
 * density distance is converted to density texels, then to OUTPUT pixels
 * using `texelsPerOutputPixel` (= density target size / output size), so the
 * feather is one output pixel wide whatever the density-resolution slider
 * does. A half-pixel offset centres the ramp on the isocontour. A flat field
 * (gradMag 0) is the degenerate case: either wholly inside or wholly outside,
 * never partially covered.
 *
 * `texelsPerOutputPixel` defaults to 1, which reproduces the pre-footprint
 * behaviour exactly (ramp over one density texel).
 */
export function silhouetteCoverage(
  density: number, threshold: number, gradMag: number, texelsPerOutputPixel = 1,
): number {
  if (!(gradMag > 1e-6)) return density >= threshold ? 1 : 0;
  const texels = (density - threshold) / gradMag;
  const px = texels / Math.max(texelsPerOutputPixel, 1e-6);
  return Math.min(1, Math.max(0, px + 0.5));
}

/** Mean density texels per output pixel. The density target and the output
 *  share an aspect in both pages, so one scalar is enough to convert the
 *  isocontour distance into output pixels. Falls back to 1 on a degenerate
 *  size. */
export function densityTexelsPerOutputPixel(
  densityW: number, densityH: number, outputW: number, outputH: number,
): number {
  if (!(outputW > 0) || !(outputH > 0) || !(densityW > 0) || !(densityH > 0)) return 1;
  return 0.5 * (densityW / outputW + densityH / outputH);
}

/** Density gradient magnitude at the continuous coordinate, in density units
 *  per texel (central difference over two texels). PURE mirror of the WGSL. */
export function gooFieldGradient(
  field: ArrayLike<number>, width: number, height: number, u: number, v: number,
): { dx: number; dy: number; mag: number } {
  const du = width > 0 ? 1 / width : 0;
  const dv = height > 0 ? 1 / height : 0;
  const l = sampleGooField(field, width, height, u - du, v).density;
  const r = sampleGooField(field, width, height, u + du, v).density;
  const d = sampleGooField(field, width, height, u, v - dv).density;
  const up = sampleGooField(field, width, height, u, v + dv).density;
  const dx = r - l;
  const dy = up - d;
  return { dx, dy, mag: 0.5 * Math.hypot(dx, dy) };
}

/** Whether an interpolated neighbour may contribute a reconstructed depth.
 *  PURE mirror of the `minR` guard in the smooth WGSL. */
export function neighborDensityUsable(density: number, threshold: number): boolean {
  return density >= Math.max(threshold * GOO_NEIGHBOR_MIN_FRACTION, GOO_FIELD_EMPTY_EPS);
}

/** One bilinear density-field fetch, as WGSL, declaring the variable `out`.
 *  Inlined (rather than a WGSL helper fn) because three's wgslFn parses
 *  exactly one top-level function per source string; templating it into both
 *  smooth entry points is what keeps their sampling from drifting. */
function gooBilinearFetchWgsl(out: string, coord: string): string {
  return `
  let ${out}Coord = (${coord}) * dims - vec2<f32>(0.5);
  let ${out}Base = floor(${out}Coord);
  let ${out}Fr = ${out}Coord - ${out}Base;
  let ${out}Max = vec2<i32>(dims) - vec2<i32>(1, 1);
  let ${out}I0 = clamp(vec2<i32>(${out}Base), vec2<i32>(0, 0), ${out}Max);
  let ${out}I1 = clamp(vec2<i32>(${out}Base) + vec2<i32>(1, 1), vec2<i32>(0, 0), ${out}Max);
  let ${out}W00 = (1.0 - ${out}Fr.x) * (1.0 - ${out}Fr.y);
  let ${out}W10 = ${out}Fr.x * (1.0 - ${out}Fr.y);
  let ${out}W01 = (1.0 - ${out}Fr.x) * ${out}Fr.y;
  let ${out}W11 = ${out}Fr.x * ${out}Fr.y;
  let ${out}T0 = textureLoad(densTex, ${out}I0, 0);
  let ${out}T1 = textureLoad(densTex, vec2<i32>(${out}I1.x, ${out}I0.y), 0);
  let ${out}T2 = textureLoad(densTex, vec2<i32>(${out}I0.x, ${out}I1.y), 0);
  let ${out}T3 = textureLoad(densTex, ${out}I1, 0);
  let ${out} = ${out}T0 * ${out}W00 + ${out}T1 * ${out}W10
    + ${out}T2 * ${out}W01 + ${out}T3 * ${out}W11;
  let ${out}D0 = ${out}T0.g / max(${out}T0.r, 1e-4);
  let ${out}D1 = ${out}T1.g / max(${out}T1.r, 1e-4);
  let ${out}D2 = ${out}T2.g / max(${out}T2.r, 1e-4);
  let ${out}D3 = ${out}T3.g / max(${out}T3.r, 1e-4);
  var ${out}Lo: f32 = 1e30;
  var ${out}Hi: f32 = -1e30;
  if (${out}T0.r > 1e-4 && ${out}W00 > 1e-6) { ${out}Lo = min(${out}Lo, ${out}D0); ${out}Hi = max(${out}Hi, ${out}D0); }
  if (${out}T1.r > 1e-4 && ${out}W10 > 1e-6) { ${out}Lo = min(${out}Lo, ${out}D1); ${out}Hi = max(${out}Hi, ${out}D1); }
  if (${out}T2.r > 1e-4 && ${out}W01 > 1e-6) { ${out}Lo = min(${out}Lo, ${out}D2); ${out}Hi = max(${out}Hi, ${out}D2); }
  if (${out}T3.r > 1e-4 && ${out}W11 > 1e-6) { ${out}Lo = min(${out}Lo, ${out}D3); ${out}Hi = max(${out}Hi, ${out}D3); }
  let ${out}DomA = select(${out}T1, ${out}T0, ${out}T0.r >= ${out}T1.r);
  let ${out}DomB = select(${out}T3, ${out}T2, ${out}T2.r >= ${out}T3.r);
  let ${out}Dom = select(${out}DomB, ${out}DomA, ${out}DomA.r >= ${out}DomB.r);`;
}

/** Shared prefix of both smooth entry points: dims, flip, threshold, one
 *  texel, the five bilinear fetches, the depth-discontinuity guard, the
 *  gradient and the coverage. The same `cov` expression appears in both, so
 *  the shading pass and the overlay alpha pass cannot disagree about where
 *  the silhouette is (the baseline's duplicated discard has the same
 *  invariant). */
const GOO_SMOOTH_FIELD_BLOCK = `
  let thresh = gooCfg.x;
  let texelUv = vec2<f32>(1.0, 1.0) / dims;${gooBilinearFetchWgsl('c', 'st')}${gooBilinearFetchWgsl('cL', 'st - vec2<f32>(texelUv.x, 0.0)')}${gooBilinearFetchWgsl('cR', 'st + vec2<f32>(texelUv.x, 0.0)')}${gooBilinearFetchWgsl('cD', 'st - vec2<f32>(0.0, texelUv.y)')}${gooBilinearFetchWgsl('cU', 'st + vec2<f32>(0.0, texelUv.y)')}
  let dens = c.r;
  // DEPTH-DISCONTINUITY GUARD. The four corner texels' occupied depths are
  // compared before their ratios are trusted: a foreground/background pair
  // would otherwise blend into a phantom depth between the two blood layers.
  // Out of tolerance, the depth and gut ratios come from the densest corner,
  // not the blend. Density itself still interpolates — it is additive and has
  // no layer ambiguity.
  let cDepthTol = ${GOO_FIELD_DEPTH_REL.toFixed(3)} * max(cLo, ${GOO_FIELD_DEPTH_MIN.toFixed(3)});
  let cDiscont = (cHi - cLo) > cDepthTol;
  let cDepth = select(c.g / max(c.r, 1e-4), cDom.g / max(cDom.r, 1e-4), cDiscont);
  let cGut = select(c.b / max(c.r, 1e-4), cDom.b / max(cDom.r, 1e-4), cDiscont);
  // Per-texel central differences. dR/dU stay in density units so the
  // gradient normal below keeps the baseline's bump strength.
  let dR = cR.r - cL.r;
  let dU = cU.r - cD.r;
  let gradMag = 0.5 * length(vec2<f32>(dR, dU));
  var cov = 0.0;
  if (gradMag > 1e-5) {
    // Convert the density-texel distance to OUTPUT pixels first, so the
    // feather is one output pixel wide at any density-resolution setting.
    cov = clamp((dens - thresh) / gradMag / max(coverageTexels, 1e-6) + 0.5, 0.0, 1.0);
  } else if (dens >= thresh) {
    cov = 1.0;
  }`;

/**
 * The SMOOTH surface pass: same signature and same shading family as
 * GOO_SURFACE_WGSL, over the continuously reconstructed field. Returns
 * vec4(lit colour, depth-buffer value); the coverage alpha the composite
 * blends with comes from GOO_COVERAGE_SMOOTH_WGSL.
 *
 * The shading body below is intentionally a copy of the baseline's, not a
 * refactor: the candidate must differ ONLY in reconstruction, so both
 * branches stay separately readable and the baseline stays bit-identical.
 */
export const GOO_SURFACE_SMOOTH_WGSL = /* wgsl */ `fn gooSurfaceSmooth(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  camWorld: mat4x4<f32>,
  camCfg: vec4<f32>,
  gooCfg: vec3<f32>,
  gooCfg2: vec4<f32>,
  organColor: vec3<f32>,
  shadowRed: f32,
  normalMode: f32,
  coverageTexels: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let specStr = gooCfg2.y;
  let glossPow = gooCfg2.z;
  let rimStr = gooCfg2.w;${GOO_SMOOTH_FIELD_BLOCK}
  if (cov <= 0.0) { discard; }

  // The scene-camera ray through this pixel, rebuilt from NDC (baseline).
  let ndc = st * 2.0 - 1.0;
  let rayCam = normalize(vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0));
  let ray = normalize((camWorld * vec4<f32>(rayCam, 0.0)).xyz);

  // Gradient normal over the SMOOTH field: the interpolated differences are
  // continuous, so a texel no longer flips the normal's direction.
  let grad = vec2<f32>(dR, dU) * ${GOO_TUNING.bump.toFixed(1)};
  let nGrad = normalize(vec3<f32>(-grad.x, -grad.y, 1.0));

  // Surface normal from the reconstructed view positions. One uv-texel and
  // one NDC-texel are different units: uv advances 1/dims per texel, NDC 2/dims.
  let texelNdc = vec2<f32>(2.0, 2.0) / dims;
  let minR = max(thresh * ${GOO_NEIGHBOR_MIN_FRACTION}, 1e-4);
  // The centre ratios come from the discontinuity guard (cDistance/cGut): a
  // foreground/background blend never reaches the normal reconstruction.
  let dC = cDepth;
  let dL = cL.g / max(cL.r, 1e-4);
  let dR2 = cR.g / max(cR.r, 1e-4);
  let dD = cD.g / max(cD.r, 1e-4);
  let dU2 = cU.g / max(cU.r, 1e-4);
  // A neighbour is unusable when it is under the density floor OR its depth
  // is on the far side of the layer tolerance — the same rule the centre
  // sample uses, so an interpolated neighbour can never drag a phantom depth
  // into the reconstructed surface.
  let depthTol = ${GOO_FIELD_DEPTH_REL.toFixed(3)} * max(dC, ${GOO_FIELD_DEPTH_MIN.toFixed(3)});
  let lBad = cL.r < minR || abs(dL - dC) > depthTol;
  let rBad = cR.r < minR || abs(dR2 - dC) > depthTol;
  let dBad = cD.r < minR || abs(dD - dC) > depthTol;
  let uBad = cU.r < minR || abs(dU2 - dC) > depthTol;
  let pC = vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0) * dC;
  let pL = vec3<f32>((ndc.x - texelNdc.x) * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0)
    * dL;
  let pR = vec3<f32>((ndc.x + texelNdc.x) * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0)
    * dR2;
  let pD = vec3<f32>(ndc.x * camCfg.x * camCfg.y, (ndc.y - texelNdc.y) * camCfg.x, -1.0)
    * dD;
  let pU = vec3<f32>(ndc.x * camCfg.x * camCfg.y, (ndc.y + texelNdc.y) * camCfg.x, -1.0)
    * dU2;

  // Min-difference with a DENSITY+depth floor, not the baseline's 1e-4. If
  // BOTH neighbours of an axis are rejected the difference is zeroed, so the
  // cross product degenerates and the gradient normal takes over rather than
  // a phantom surface.
  var ddx = pR - pC;
  let ddxB = pC - pL;
  var ddxOk = !rBad;
  if (rBad || abs(ddxB.z) < abs(ddx.z)) { ddx = ddxB; ddxOk = !lBad; }
  if (!ddxOk) { ddx = vec3<f32>(0.0); }
  var ddy = pU - pC;
  let ddyB = pC - pD;
  var ddyOk = !uBad;
  if (uBad || abs(ddyB.z) < abs(ddy.z)) { ddy = ddyB; ddyOk = !dBad; }
  if (!ddyOk) { ddy = vec3<f32>(0.0); }
  var nSurf = cross(ddx, ddy);
  let nSurfLen = length(nSurf);
  if (nSurfLen < 1e-8) {
    nSurf = nGrad;
  } else {
    nSurf = nSurf / nSurfLen;
    if (nSurf.z < 0.0) { nSurf = -nSurf; }
  }

  let nCam = select(nGrad, nSurf, normalMode > 0.5);
  let n = normalize((camWorld * vec4<f32>(nCam, 0.0)).xyz);

  let viewDepth = cDepth;
  let near = camCfg.z;
  let far = camCfg.w;
  let depthBuf = clamp(far * (viewDepth - near) / (max(viewDepth, 1e-4) * (far - near)), 0.0, 1.0);

  let L = normalize(lightDir);
  let Vv = -ray;
  let H = normalize(L + Vv);
  let diff = max(dot(n, L), 0.0);
  let softEdge = smoothstep(thresh, thresh * gooCfg.y, dens);

  let thick = max(dens - thresh, 0.0) * gooCfg2.x;
  let trans = exp(-thick * vec3<f32>(0.30, 2.40, 2.00));
  let lambert = lightCfg.y + diff * lightCfg.x;

  var gutFrac = cGut;
  gutFrac = clamp(gutFrac, 0.0, 1.0);
  let baseCol = mix(vec3<f32>(0.62, 0.11, 0.10), organColor, gutFrac);
  var lit = baseCol * trans * lambert * keyColor
    * mix(0.55, 1.0, softEdge);

  lit = lit + vec3<f32>(1.0, 0.055, 0.07) * shadowRed * softEdge;

  let glint = pow(max(dot(n, H), 0.0), glossPow);
  lit = lit + keyColor * glint * specStr * softEdge;
  let fres = pow(1.0 - max(dot(n, Vv), 0.0), 3.0);
  lit = lit + keyColor * vec3<f32>(0.85, 0.14, 0.12) * fres * rimStr * softEdge;

  if (gooCfg.z > 0.5) {
    let c2 = max(lit, vec3<f32>(0.0));
    let lo = c2 / 12.92;
    let hi = pow((c2 + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c2 <= vec3<f32>(0.04045));
  }

  return vec4<f32>(lit, depthBuf);
}`;

/**
 * The SMOOTH silhouette coverage, consumed as the composite's alpha in BOTH
 * modes. Shares GOO_SMOOTH_FIELD_BLOCK with the surface pass, so the two
 * cannot disagree about where the silhouette is — the same invariant
 * GOO_ALPHA_WGSL duplicates for the baseline.
 */
export const GOO_COVERAGE_SMOOTH_WGSL = /* wgsl */ `fn gooCoverageSmooth(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  gooCfg: vec3<f32>,
  coverageTexels: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }${GOO_SMOOTH_FIELD_BLOCK}
  if (cov <= 0.0) { discard; }
  return vec4<f32>(0.0, 0.0, 0.0, cov);
}`;

/**
 * The surface pass. Returns vec4(lit colour, depth-buffer value).
 *
 * No matrices are bound from the quad's own camera (that camera is an
 * orthographic trick at z=1): the SCENE camera's world matrix, position and
 * lens (tan half-fov, aspect, near, far) come in as uniforms, and the pixel
 * ray is rebuilt from NDC by hand. That keeps the pass a single wgslFn with
 * plain parameters — the same shape every other pass here takes — and it
 * sidesteps the alpha trap that forced the march into outputNode: colour
 * goes out through colorNode (so three applies the output sRGB encode),
 * depth through depthNode.
 */
export const GOO_SURFACE_WGSL = /* wgsl */ `fn gooSurface(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  camWorld: mat4x4<f32>,
  camCfg: vec4<f32>,
  gooCfg: vec3<f32>,
  gooCfg2: vec4<f32>,
  organColor: vec3<f32>,
  shadowRed: f32,
  normalMode: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
  let c = textureLoad(densTex, px, 0);
  let dens = c.r;
  let thresh = gooCfg.x;
  let specStr = gooCfg2.y;
  let glossPow = gooCfg2.z;
  let rimStr = gooCfg2.w;
  if (dens < thresh) { discard; }

  // The scene-camera ray through this pixel, rebuilt from NDC: the camera
  // looks down -z and the view plane spans tan(halfFov) in y (times aspect
  // in x), so no inverse projection is needed. Computed HERE because the
  // surface-normal reconstruction below needs the same NDC.
  let ndc = st * 2.0 - 1.0;
  let rayCam = normalize(vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0));
  let ray = normalize((camWorld * vec4<f32>(rayCam, 0.0)).xyz);

  // Four neighbours, loaded WHOLE: .r is density (the gradient normal) and
  // g/b is the density-weighted view depth (the surface normal). One set of
  // taps feeds both paths, so the new normal costs no extra samples.
  let cl = textureLoad(densTex, clamp(px - vec2<i32>(1, 0), vec2<i32>(0, 0), maxP), 0);
  let cr = textureLoad(densTex, clamp(px + vec2<i32>(1, 0), vec2<i32>(0, 0), maxP), 0);
  let cd = textureLoad(densTex, clamp(px - vec2<i32>(0, 1), vec2<i32>(0, 0), maxP), 0);
  let cu = textureLoad(densTex, clamp(px + vec2<i32>(0, 1), vec2<i32>(0, 0), maxP), 0);

  // GRADIENT NORMAL (normalMode 0, the original). The gradient lies in the
  // image plane, so the camera-space normal tilts against it over a flat
  // CAMERA-FACING base. Scaled gently: the density target is low-res, so a
  // blob is only a few texels wide and a steep multiplier turns every texel
  // into a silhouette edge — which fires the fresnel rim across the whole
  // surface and washes the deep red out (measured: fringe G/R 0.68,
  // pink-gray, where the base is 0.25).
  //
  // Its limitation is STRUCTURAL, not tuning: the base is always +z in view
  // space, so every blob is lit as though facing the camera and the lighting
  // cannot respond to where the surface actually points in the world. That is
  // what made the goo read as pasted on even once it occluded correctly.
  let grad = vec2<f32>(cr.r - cl.r, cu.r - cd.r) * ${GOO_TUNING.bump.toFixed(1)};
  let nGrad = normalize(vec3<f32>(-grad.x, -grad.y, 1.0));

  // SURFACE NORMAL (normalMode 1). The standard screen-space fluid
  // reconstruction: turn each texel's view depth back into a view-space
  // POSITION, then cross the screen-space derivatives of that position. The
  // result is a real surface normal that responds to the shape of the blood
  // in 3D. The unnormalised ray with z = -1, scaled by view depth, IS the
  // view position — so this needs no inverse projection either.
  let texel = vec2<f32>(2.0, 2.0) / dims;
  let dC = c.g / max(c.r, 1e-4);
  let pC = vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0) * dC;
  let pL = vec3<f32>((ndc.x - texel.x) * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0)
    * (cl.g / max(cl.r, 1e-4));
  let pR = vec3<f32>((ndc.x + texel.x) * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0)
    * (cr.g / max(cr.r, 1e-4));
  let pD = vec3<f32>(ndc.x * camCfg.x * camCfg.y, (ndc.y - texel.y) * camCfg.x, -1.0)
    * (cd.g / max(cd.r, 1e-4));
  let pU = vec3<f32>(ndc.x * camCfg.x * camCfg.y, (ndc.y + texel.y) * camCfg.x, -1.0)
    * (cu.g / max(cu.r, 1e-4));

  // MIN-DIFFERENCE against silhouettes: at the edge of a blob one neighbour
  // sits on empty field, where g/b is a ratio of two near-zeros and the
  // reconstructed depth is meaningless. Using it would bend the normal hard
  // along every silhouette and ring each mass with a bright rim. Take
  // whichever of the forward/backward difference has the smaller depth jump,
  // and reject a neighbour outright when it carries no density at all.
  var ddx = pR - pC;
  let ddxB = pC - pL;
  if (cr.r < 1e-4 || abs(ddxB.z) < abs(ddx.z)) { ddx = ddxB; }
  var ddy = pU - pC;
  let ddyB = pC - pD;
  if (cu.r < 1e-4 || abs(ddyB.z) < abs(ddy.z)) { ddy = ddyB; }
  var nSurf = cross(ddx, ddy);
  let nSurfLen = length(nSurf);
  // Degenerate on an isolated texel (both differences empty): fall back to
  // the gradient normal rather than emitting a NaN that would blacken the px.
  if (nSurfLen < 1e-8) {
    nSurf = nGrad;
  } else {
    nSurf = nSurf / nSurfLen;
    // The camera looks down -z, so a surface facing it has a +z normal; the
    // cross product's winding depends on which differences survived above.
    if (nSurf.z < 0.0) { nSurf = -nSurf; }
  }

  let nCam = select(nGrad, nSurf, normalMode > 0.5);
  let n = normalize((camWorld * vec4<f32>(nCam, 0.0)).xyz);

  // Fake depth: the density-weighted average view depth accumulated in G/B.
  // Converted to the [0,1] depth-buffer value with the same mapping three's
  // WebGPU perspective matrix produces (Matrix4.makePerspective for the
  // WebGPU coordinate system): far * (d - near) / ((far - near) * d).
  let viewDepth = c.g / max(c.r, 1e-4);
  let near = camCfg.z;
  let far = camCfg.w;
  let depthBuf = clamp(far * (viewDepth - near) / (max(viewDepth, 1e-4) * (far - near)), 0.0, 1.0);

  // Shade with the march's rig, over a BEER-LAMBERT body (blood-viscosity
  // spec §d). The old flat base made every mass the same red whatever its
  // depth, which is exactly why the layer read as stickers rather than
  // fluid. Absorption over the field ABOVE the threshold does NOT make
  // brightness rise monotonically toward the edge: the softEdge mix below
  // dims the outermost sliver of the silhouette (strands taper into
  // darkness there — preserved from the pre-Beer-Lambert version), so the
  // profile is dark right at the edge, brightest orange-red just inside the
  // soft-edge band, then darkens again toward a near-black crimson core as
  // thickness accumulates. That non-monotonic profile IS the volume read,
  // and it is what the reference frames have that the shipped effect did
  // not. Red is absorbed lightly and green and blue hard, which is why
  // blood is red rather than grey at depth.
  let L = normalize(lightDir);
  let Vv = -ray;
  let H = normalize(L + Vv);
  let diff = max(dot(n, L), 0.0);
  let softEdge = smoothstep(thresh, thresh * gooCfg.y, dens);

  let thick = max(dens - thresh, 0.0) * gooCfg2.x;
  let trans = exp(-thick * vec3<f32>(0.30, 2.40, 2.00));
  let lambert = lightCfg.y + diff * lightCfg.x;

  // Guts take the organ colour; blood stays blood. Per-pixel by ratio rather
  // than a global switch, because a disembowelled body bleeds heavily in
  // exactly the pixels the rope occupies. .a accumulated gut-weighted density
  // (see the density pass's colorNode), so a/r IS the gut share of this
  // pixel's field — and it survives the blur, which filters all four
  // channels with the same normalised weights.
  var gutFrac = c.b / max(c.r, 1e-4);
  gutFrac = clamp(gutFrac, 0.0, 1.0);
  let baseCol = mix(vec3<f32>(0.62, 0.11, 0.10), organColor, gutFrac);
  var lit = baseCol * trans * lambert * keyColor
    * mix(0.55, 1.0, softEdge);

  // SHADOW FLOOR (owner, 2026-08-31: "get rid of black for the shadow areas
  // of the blood, i always want it to read red"). Two independent terms drive
  // this surface to zero: absorption at high thickness (trans -> 0 in the
  // core) and the diffuse term at grazing light (lambert -> ambient). Both
  // are correct as transport, and together they make the darkest blood
  // colourless — which reads as a hole in the frame rather than as blood.
  //
  // Rather than weaken either term, add an unlit floor that nothing can
  // subtract from: a deep saturated red standing in for the light that
  // scatters back out of a thick medium instead of being absorbed by it.
  // The result is that the darkest possible blood is DARK RED, never black.
  // Added, not maxed, so it lifts the shadows without flattening the
  // gradient the thickness term produces. Scaled by softEdge so the very
  // outer sliver still tapers out rather than ending on a lit fringe.
  lit = lit + vec3<f32>(1.0, 0.055, 0.07) * shadowRed * softEdge;

  // Highlights ride ON TOP of the absorbed body and are NOT absorbed — a
  // surface reflection never travelled through the blood, so neither term
  // below carries the trans factor. The glint is tight but NOT white: it
  // takes the key light's own colour (keyColor), same as the diffuse term.
  // The rim also rides keyColor (GooLightRig's own doc: one re-tune moves
  // both) but keeps its own warm tint on top, so a fringe cannot wash the
  // mass pink — a neutral rim did that at high bump values.
  let glint = pow(max(dot(n, H), 0.0), glossPow);
  lit = lit + keyColor * glint * specStr * softEdge;
  // Fresnel exponent 3.0 (was 4.0 pre-viscosity) — a slightly wider rim band.
  let fres = pow(1.0 - max(dot(n, Vv), 0.0), 3.0);
  lit = lit + keyColor * vec3<f32>(0.85, 0.14, 0.12) * fres * rimStr * softEdge;

  // Legacy display look (gooCfg.z) — the SAME decode marchBody applies (see
  // march.wgsl.ts): without it the flesh renders through the legacy chain
  // while the blood renders through the honest one, and the pools read
  // washed gray-pink next to the saturated flesh.
  if (gooCfg.z > 0.5) {
    let c = max(lit, vec3<f32>(0.0));
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c <= vec3<f32>(0.04045));
  }

  return vec4<f32>(lit, depthBuf);
}`;

/**
 * Overlay mode's alpha (blood-viscosity spec §c). `gooSurface` spends its w
 * on the reconstructed depth value, so the soft-edge band that overlay mode
 * blends with comes from here — one texel load, no gradient taps.
 *
 * The discard condition is duplicated deliberately and must stay identical
 * to the surface pass's: if the two disagreed on the cutoff, overlay would
 * blend a colour the surface never shaded.
 *
 * Returns a vec4 rather than a bare f32 so it swizzles through the same
 * `Swizzled` cast every other pass here uses.
 */
export const GOO_ALPHA_WGSL = /* wgsl */ `fn gooAlpha(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  gooCfg: vec3<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
  let dens = textureLoad(densTex, px, 0).r;
  let thresh = gooCfg.x;
  if (dens < thresh) { discard; }
  let a = smoothstep(thresh, thresh * gooCfg.y, dens);
  return vec4<f32>(0.0, 0.0, 0.0, a);
}`;

/**
 * One axis of the separable blur (the pass runs twice: dir = (1,0) then
 * (0,1)). Integer-coordinate textureLoad with edge clamping, the same fetch
 * shape the surface pass and coneFetch use — and NO flipY: target-to-target
 * fullscreen sampling is orientation-preserving on this backend (the cone
 * pre-pass proves it), the inversion only appears at the canvas boundary.
 *
 * The 9 weights are derived from sigma at runtime (the slider owns sigma)
 * and normalised, so the kernel preserves the field's total density and the
 * surface threshold stays calibrated at any setting. rgb all take the same
 * weights — g/b stays density*depth over density.
 */
export const GOO_BLUR_WGSL = /* wgsl */ `fn gooBlur(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  dir: vec2<f32>,
  sigma: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let base = vec2<i32>(floor(texCoord * dims));
  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i = -4; i <= 4; i = i + 1) {
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    let c = clamp(base + vec2<i32>(dir * f32(i)), vec2<i32>(0, 0), maxP);
    sum = sum + textureLoad(srcTex, c, 0) * w;
    wsum = wsum + w;
  }
  return sum / wsum;
}`;

/**
 * ITEM 1's upsample (close-up task 4): the final composite that runs when
 * setSurfaceAtDensityRes(true) — reads the density-resolution shaded target
 * and writes it out at output resolution.
 *
 * NO flipY, unlike gooSurface/gooAlpha: this is a target-to-target/canvas
 * blit and the inversion the uFlipY uniform compensates only appears at the
 * canvas boundary — the shading pass ALREADY paid it when it read the density
 * field (the blur passes carry the same no-flip rule; see their note).
 *
 * NEAREST on purpose (textureLoad, no sampler): the shipped full-resolution
 * pass also reads the density field nearest-texel, so the upsampled frame
 * carries the SAME field data — only the sub-texel ray variation (spec/rim
 * gradients inside a 2×2 texel block) is gone with the shading now at texel
 * centres. If a capture shows the silhouette or the glint paying for that,
 * the LinearFilter variant is the fallback, not the default.
 *
 * The discard is the empty-texel sentinel: the low target clears to black
 * with ALPHA 0 (its own explicit clear in render() — the same two reasons the
 * density target clears this way: a non-zero red channel is density, a
 * cleared alpha of 1 is a full-frame gut mask/depth of 1). A live texel's
 * .a is the depth-mode depth value in [0,1] or the overlay soft edge in
 * [0,1] — the only legitimately-zero value is goo exactly ON the near plane
 * (depth 0), one half-res texel at a range the camera cannot reach.
 */
export const GOO_UPSAMPLE_WGSL = /* wgsl */ `fn gooUpsample(
  lowTex: texture_2d<f32>,
  texCoord: vec2<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(lowTex, 0));
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(texCoord * dims)), vec2<i32>(0, 0), maxP);
  let c = textureLoad(lowTex, px, 0);
  if (c.a < 9.99e-5) { discard; }
  return vec4<f32>(c.rgb, c.a);
}`;

/** Uniform nodes the goo shares with the march, so one re-tune moves both. */
export interface GooLightRig {
  lightDir: ReturnType<typeof uniform>;
  keyColor: ReturnType<typeof uniform>;
  lightCfg: ReturnType<typeof uniform>;
}

/** three 0.185 types wgslFn's result as a plain Node; this keeps the swizzles honest. */
type Swizzled = { xyz: unknown; w: unknown };

/** Reconstruction strategy. 'original' is the shipped floored-nearest path and
 *  MUST stay the default; 'smooth' is the opt-in continuous candidate. */
export type GooReconstruction = 'original' | 'smooth';

/**
 * SELECTION SEAM (shutter game integration, 2026-09-17).
 *
 * A per-sync partition of the density input. `droplet(d)` decides which sim
 * droplets are posed; `splats`/`extras` gate the floor pools and the
 * connection blobs independently (they have no droplet of their own to test).
 * `null` (the shipped default) poses everything in one pass — bit-identical.
 *
 * The shutter layer syncs the goo layer TWICE per frame: once with the
 * sharp-remainder selection (pools, guts, leftover drops) and once with the
 * selected airborne partition, so airborne blood is shaded into its own
 * premultiplied layer exactly once and static blood stays sharp. This is the
 * same moving/static split the lab's quality oracle performs, but without
 * copying the sim into scratch arrays.
 */
export interface GooSelection {
  droplet(d: Droplet): boolean;
  splats: boolean;
  extras: boolean;
}

/**
 * One extra density quad — candidate-only geometry (blood connections) fed
 * into the SAME density pass as droplets and splats, so it is shaded by the
 * same wet surface pass rather than a second, flat material.
 *
 * `halfW`/`halfH` are world half-extents BEFORE the scene-camera billboard,
 * matching the droplets' `size * sizeScale * quadScale / 2` convention.
 * `roll` is the screen-space rotation applied after the billboard.
 */
export interface GooDensityBlob {
  x: number; y: number; z: number;
  halfW: number; halfH: number;
  roll: number;
  /** Density multiplier (splatDensityWeight's slot). Default 1. */
  weight?: number;
  /** Gut mask (organs r3). Default 0 (blood). */
  gut?: number;
}

/** Density-target resolution, reported independently of the output size so a
 *  comparison can name the actual reconstruction grid, the march/source grid
 *  and the composite destination separately. */
export interface GooDensityDiagnostics {
  densityWidth: number;
  densityHeight: number;
  /** The march/SDF grid handed to setSize() (game: 400x300). */
  sourceWidth: number;
  sourceHeight: number;
  /** The actual composite destination (game/canvas: 800x600). */
  outputWidth: number;
  outputHeight: number;
  densityScale: number;
  /** densityWidth / sourceWidth — density texels per SOURCE pixel. */
  texelsPerSourcePixelX: number;
  texelsPerSourcePixelY: number;
  /** densityWidth / outputWidth — density texels per OUTPUT pixel, the
   *  footprint the smooth coverage feather is scaled by. */
  texelsPerOutputPixelX: number;
  texelsPerOutputPixelY: number;
  /** True while 'smooth' is selected: the density-resolution perf seam is not
   *  combined with the candidate, so the composite always runs full-res. */
  smoothForcesFullResComposite: boolean;
}

export interface GooLayer {
  /**
   * The frame: density pass, then the separable blur (unless blurPx is 0),
   * then the caller's middle (the whole sdf/cone/occluder/composite flow —
   * see how lab-main installs this over sdfLayer.render), then the surface
   * pass composited onto the canvas.
   */
  render(camera: THREE.PerspectiveCamera, between: () => void): void;
  /**
   * REFERENCE-ONLY (selective shutter blur, task 1): run the density + blur
   * passes, then composite the reconstructed goo surface into `target` as
   * WORKING-LINEAR PREMULTIPLIED colour+coverage, summed with One/One
   * blending. No scene is drawn and `between` is never invoked. The caller
   * owns the target's DEPTH: pre-load the frozen scene depth with colour
   * writes off, because the layer depth-tests but never depth-writes.
   *
   * Used by blood-compare-main's sampled shutter reference to shade N
   * exposure samples SEPARATELY (never accumulating density across times) and
   * divide once. Returns false when the surface pass is gated off, matching
   * render()'s diagnostic-only gate.
   */
  renderLayer(camera: THREE.PerspectiveCamera, target: THREE.RenderTarget): boolean;
  /**
   * PIPELINE WARM-UP: compileAsync every goo scene graph once at boot so the
   * first gout does not compile pipelines mid-firefight. Await-and-forget.
   */
  precompile(camera: THREE.PerspectiveCamera): Promise<void>;
  /**
   * Redirects the surface composite (normally canvas-bound) into this
   * target; null restores the canvas. post-aa captures the frame this way.
   * The target MUST carry a depth buffer — the surface depth-tests against
   * what the sdf composite left behind.
   */
  setOutputTarget(t: THREE.RenderTarget | null): void;
  /** Re-pose the density quads from sim state; call once per frame, before render. */
  sync(sim: BloodSim, camera: THREE.Camera): void;
  /** Density target = densityScale * the SDF layer's size. */
  setSize(sdfWidth: number, sdfHeight: number): void;
  /** Whether the density target comes back inverted relative to the canvas. */
  setFlipY(on: boolean): void;
  setThreshold(v: number): void;
  setEdge(v: number): void;
  /** Gaussian sigma in density-target pixels; 0 bypasses the blur passes. */
  setBlurPx(v: number): void;
  /** World-size multiplier per particle (GOO_TUNING.sizeScale). Bigger blobs
   *  overlap more, which is what turns beads into ropes and sheets — the
   *  file's own tuning note: 0.15 breaks trails into disconnected beads,
   *  0.22 gives thin connected strands, 0.4 reads as thick hose-water ropes. */
  setSizeScale(v: number): void;
  /** Beer-Lambert thickness strength — 0 flattens the body to a single
   *  colour; NOT the pre-viscosity look, since the base colour literal
   *  changed in the same commit that added this. */
  setAbsorb(v: number): void;
  /** Specular strength (the wet glint). */
  setSpec(v: number): void;
  /** Specular exponent — low is a broad sheen, high is a pinpoint. */
  setGloss(v: number): void;
  /** Fresnel rim strength. */
  setRim(v: number): void;
  /** Velocity-stretch cap (GOO_TUNING.stretchMax). 0 = round blobs. */
  setStretch(v: number): void;
  /** Deep-red floor so blood never reads black. 0 = off. */
  setShadowRed(v: number): void;
  /** true = world-oriented surface normals reconstructed from depth;
   *  false = the original screen-space density-gradient normals. */
  setSurfaceNormals(on: boolean): void;
  /**
   * CANDIDATE (blood-surface comparison): 'original' is the shipped
   * floored-nearest surface and is the default; 'smooth' switches the surface
   * composite (both modes) to the continuous reconstruction with antialiased
   * silhouette coverage. Only the material the composite draws with changes —
   * the density and blur passes, every tuning uniform and the whole simulation
   * are shared. Smooth forces the full-resolution composite (see
   * GooDensityDiagnostics.smoothForcesFullResComposite).
   */
  setReconstruction(m: GooReconstruction): void;
  readonly reconstruction: GooReconstruction;
  /**
   * CANDIDATE (blood connections): extra density quads posed by the next
   * sync(), sharing the same particle cap as droplets and splats. Empty by
   * default — the shipped frame is bit-identical with no blobs set.
   */
  setExtraBlobs(blobs: readonly GooDensityBlob[]): void;
  /**
   * SELECTION SEAM — see GooSelection. Applied by the NEXT sync(); null
   * restores the shipped one-pass pose. Does not touch any tuning.
   */
  setSelection(sel: GooSelection | null): void;
  /**
   * PIPELINE WARM-UP for the reference layer materials
   * (renderLayer's makeLayerMat graphs). Compiles them off the capture path so
   * the first shutter frame does not hitch on a mid-firefight compile.
   */
  precompileLayer(): Promise<void>;
  /** How many extra blobs the last setExtraBlobs accepted (capped). */
  readonly extraBlobCount: number;
  /** Density-target resolution, independent of the canvas/output size. */
  readonly densityDiagnostics: GooDensityDiagnostics;
  /**
   * ITEM 1 (close-up task 4): run the surface shading at DENSITY resolution
   * into an intermediate target, then composite it with a cheap upsample.
   * Every input the surface pass reads is at densityScale × the SDF scale
   * (nearest-texel: four canvas pixels already repeat one texel), so the
   * per-canvas-pixel shading pays 5 texture loads + Beer-Lambert + spec/rim
   * to shade what is informationally a half-res field. Default OFF = the
   * exact shipped full-resolution composite.
   */
  setSurfaceAtDensityRes(on: boolean): void;
  readonly surfaceAtDensityRes: boolean;
  /**
   * ITEM 2a: skip density quads whose projected blob radius is under this
   * many density texels (projectedTexelRadius). They cannot fuse into the
   * surface — additive blending means every skipped fragment was pure
   * overdraw. 0 = off (the shipped state).
   */
  setMinTexelRadius(v: number): void;
  readonly minTexelRadius: number;
  /**
   * ITEM 2b: at the maxParticles cap, fill the density instancer by
   * PROJECTED AREA (largest first, splats and droplets in one pool) instead
   * of droplet-then-splat insertion order. Off = the shipped fill order.
   */
  setAreaPriority(on: boolean): void;
  readonly areaPriority: boolean;
  /**
   * ITEM 3: fade the DENSITY contribution of the oldest `v` splat ranks
   * (splatDensityWeight). 0 = off (the shipped state: every splat full
   * weight forever). The billboard splats never fade.
   */
  setSplatFadeTail(v: number): void;
  readonly splatFadeTail: number;
  /**
   * DIAGNOSTIC ONLY (Phase-0 attribution, never a ship lever): skip
   * individual passes of the chain so a bench can time them apart. All-true
   * by default; anything else produces a WRONG FRAME on purpose.
   */
  setPassGate(g: { density?: boolean; blur?: boolean; surface?: boolean }): void;
  readonly passGate: { density: boolean; blur: boolean; surface: boolean };
  /**
   * PERF LEVER (2026-09-07 pass attribution): density target size as a
   * fraction of the SDF layer's, overriding GOO_TUNING.densityScale at
   * runtime. The density pass is FILL-BOUND — up to a thousand large
   * additive quads into the target — so its cost scales with this squared.
   * Reallocates the targets on change (same first-clear discipline as
   * setSize). Lower is blurrier by construction; the surface pass already
   * upsamples nearest.
   */
  setDensityScale(v: number): void;
  readonly densityScale: number;
  /**
   * PERF LEVER: cap on density quads posed per frame, under
   * GOO_TUNING.maxParticles. With areaPriority on the largest survive;
   * otherwise insertion order (droplets, then splats).
   */
  setParticleCap(n: number): void;
  readonly particleCap: number;
  /** 'overlay' (default) composites the goo over the finished frame with no
   * depth involvement. 'depth' restores the original reconstructed-depth
   * interleaving — kept as the escape hatch if the overlay reads wrong
   * against walls in play.
   */
  setMode(m: 'overlay' | 'depth'): void;
  readonly mode: 'overlay' | 'depth';
  readonly sizeScale: number;
  /** Mirror of the march's legacy-gamma flag — keep both on one switch. */
  setLegacyGamma(on: boolean): void;
  readonly threshold: number;
  readonly edge: number;
  readonly blurPx: number;
  readonly absorb: number;
  readonly spec: number;
  readonly gloss: number;
  readonly rim: number;
  readonly stretch: number;
  readonly shadowRed: number;
  readonly surfaceNormals: boolean;
  readonly targetSize: { width: number; height: number };
  /** DIAGNOSTIC: how many density quads the last sync() posed. 0 while blood
   *  is on screen means the mist/size cutoff rejected everything. */
  /** DIAGNOSTIC: the density targets, for console/headless readback. Reading
   *  these is how you tell "the field is empty" apart from "the field is full
   *  and the surface is not drawing it" — the two look identical on screen. */
  readonly debugTargets: { density: THREE.RenderTarget; blurred: THREE.RenderTarget };
  readonly liveCount: number;
  /** DIAGNOSTIC: how many times sync() has been called. STAYS 0 if the host
   *  page never wired it — the failure that hid this layer entirely on the
   *  game page, and which no amount of tuning could have revealed. */
  readonly syncCalls: number;
  dispose(): void;
}

export function createGooLayer(
  renderer: THREE.WebGPURenderer,
  rig: GooLightRig,
): GooLayer {
  // ---------------------------------------------------------------
  // Density target. Half-float for blendability (file header), no depth
  // (nothing in the accumulation ever depth-tests), nearest because every
  // fetch is an integer textureLoad.
  // ---------------------------------------------------------------
  const target = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  // The blur ping-pong pair: horizontal reads the density target and writes
  // blurA, vertical reads blurA and writes blurB, the surface reads blurB.
  // Never sampled with blending and never read while written, so they take
  // the density target's own options verbatim (half-float, nearest, no
  // depth) and live at its exact size — one blur texel is one density texel.
  const blurOpts = {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  } as const;
  const blurA = new THREE.RenderTarget(1, 1, blurOpts);
  const blurB = new THREE.RenderTarget(1, 1, blurOpts);

  // Same backend property sdf-layer pinned: render targets come back
  // y-inverted relative to the canvas, flipped on with a uniform so a future
  // three can be corrected from the console rather than the source.
  const uFlipY = uniform(1);
  const uThresh = uniform(GOO_TUNING.threshold);
  /** Runtime sizeScale — see setSizeScale. */
  let sizeScale: number = GOO_TUNING.sizeScale;
  // Matches the march's lodCfg.y default (legacy gamma ON) — lab-main's
  // setLegacyGamma drives both together.
  const uLegacy = uniform(1);
  const uEdge = uniform(GOO_TUNING.edge);
  const uBlurPx = uniform(GOO_TUNING.blurPx);
  const uAbsorb = uniform(GOO_TUNING.absorb);
  const uSpec = uniform(GOO_TUNING.spec);
  const uGloss = uniform(GOO_TUNING.gloss);
  const uRim = uniform(GOO_TUNING.rim);
  const uShadowRed = uniform(GOO_TUNING.shadowRed);
  // The organ colour the gut fraction lerps toward (organs r3) — the same
  // pale salmon the flesh presets carry as organColor, so the spilled rope
  // and the cavity viscera read as one material.
  const uOrganColor = uniform(new THREE.Vector3(0.72, 0.32, 0.30));
  const uNormalMode = uniform(GOO_TUNING.surfaceNormals ? 1 : 0);
  const uCamWorld = uniform(new THREE.Matrix4());
  // x tan(halfFovY), y aspect, z near, w far.
  const uCamCfg = uniform(new THREE.Vector4(1, 1, 0.1, 200));
  // Density texels per OUTPUT pixel. The smooth coverage ramp is divided by
  // this so the silhouette feather is one output pixel wide at any
  // density-resolution setting; the original path never reads it.
  const uCoverageTexels = uniform(1);

  // ---------------------------------------------------------------
  // Density pass: one InstancedMesh of unit quads, additively blending a
  // radial falloff. premultipliedAlpha + AdditiveBlending is the One/One
  // blend pair on the WebGPU backend, so the accumulated sum is never
  // modulated by an alpha the node pipeline never lets us set anyway
  // (DiffuseColor.a is forced to opacity, and opacity is 1).
  // ---------------------------------------------------------------
  const fallQ = uv().sub(0.5).mul(2);              // [-1,1]^2 across the quad
  const fall = max(float(0), dot(fallQ, fallQ).oneMinus());  // max(0, 1 - r*r)
  // View depth of the billboarded quad centre, per fragment: the quads face
  // the camera, so this is constant across each instance.
  const viewDepth = positionView.z.negate();
  // Per-instance gut flag (organs r3): 1 on a gut rope's droplets, 0 on
  // blood. Read as a vertex attribute; the fragment stage gets it through a
  // varying, the standard path for geometry attributes in a colorNode.
  const gutMask = attribute<'float'>('gutMask', 'float');
  const densMat = new MeshBasicNodeMaterial();
  // ALPHA IS THE GUT MASK (organs r3). It was a constant 1 and never read —
  // .r is density and .g/.b reconstruct view depth, all consumed — so this is
  // the one free channel. Writing fall * gutMask makes .a accumulate
  // gut-weighted density, and a/r is then the per-pixel gut fraction the
  // surface pass lerps by (gutFrac in GOO_SURFACE_WGSL).
  //
  // Additive blending with premultipliedAlpha blends RGB as ONE,ONE, and the
  // alpha term the same, so carrying a mask in .a cannot perturb the colour
  // channels. The gate for that: the density target must CLEAR its alpha to
  // 0 (three's setClearColor defaults to 1 — pinned in render()).
  // Per-instance density weight (close-up task 4 item 3): 1.0 on every
  // droplet, splatDensityWeight() on floor splats. Multiplies ALL THREE
  // accumulated channels equally, so the g/r depth ratio and the b/r gut
  // ratio are untouched — the same invariant the blur's uniform weights
  // preserve. The attribute rides ALWAYS: ×1.0 is IEEE-exact, so the seam-off
  // state (every entry 1.0) is bit-identical to the pre-attribute shader.
  const fallMask = attribute<'float'>('fallMask', 'float');
  const weightedFall = fall.mul(fallMask);
  densMat.colorNode = vec4(weightedFall, weightedFall.mul(viewDepth), weightedFall.mul(gutMask), 1);
  densMat.blending = THREE.AdditiveBlending;
  densMat.premultipliedAlpha = true;
  densMat.transparent = true;
  densMat.depthWrite = false;
  densMat.depthTest = false;
  densMat.fog = false;

  const quads = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), densMat, GOO_TUNING.maxParticles,
  );
  quads.frustumCulled = false;
  // The gut flag's storage (organs r3): one float per instance, written in
  // sync() alongside the instance matrices. InstancedBufferAttribute so the
  // vertex buffer steps per instance, not per vertex.
  const gutAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(GOO_TUNING.maxParticles), 1,
  );
  quads.geometry.setAttribute('gutMask', gutAttr);
  const gutArr = gutAttr.array as Float32Array;
  // The density weight's storage — same shape as the gut flag's.
  const fallAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(GOO_TUNING.maxParticles), 1,
  );
  quads.geometry.setAttribute('fallMask', fallAttr);
  const fallArr = fallAttr.array as Float32Array;
  const gooScene = new THREE.Scene();
  gooScene.add(quads);

  // ---------------------------------------------------------------
  // Surface pass: the same fullscreen-quad composite shape sdf-layer uses.
  // Colour through colorNode (three applies the output sRGB encode), fake
  // depth through depthNode, so the hardware interleaves the goo with the
  // flesh and floor already in the canvas depth buffer.
  //
  // TWO instantiations of the same fn, identical except which texture
  // densTex binds: the blurred buffer when the blur ran, the raw density
  // target when it was bypassed. They share every uniform NODE, so slider
  // state cannot drift between them; render() picks per frame by swapping
  // the quad's material, because a texture binding is baked into the node
  // graph at construction.
  // ---------------------------------------------------------------
  const surface = wgslFn(GOO_SURFACE_WGSL);
  const alphaFn = wgslFn(GOO_ALPHA_WGSL);

  /** The shaded colour, shared by both modes. */
  function shadeOf(densTexture: THREE.Texture): Swizzled {
    return surface({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      lightDir: rig.lightDir,
      keyColor: rig.keyColor,
      lightCfg: rig.lightCfg,
      camWorld: uCamWorld,
      camCfg: uCamCfg,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
      gooCfg2: vec4(uAbsorb, uSpec, uGloss, uRim),
      organColor: uOrganColor,
      shadowRed: uShadowRed,
      normalMode: uNormalMode,
    }) as unknown as Swizzled;
  }

  /**
   * OVERLAY (default). No depth at all: the goo composites over the finished
   * frame. This DELETES the depth blocker rather than fixing it — the
   * reconstruction from the density field's average view depth rejected
   * near-body blood, so goo appeared only against distant background. The
   * accepted cost is that a burst behind a pillar still paints over it,
   * which for a sub-second event centred on the thing you just shot is close
   * to theoretical.
   */
  function makeOverlayMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const a = alphaFn({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, a.w as never);
    m.depthWrite = false;
    m.depthTest = false;
    m.transparent = true;
    m.fog = false;
    return m;
  }

  /** DEPTH (the escape hatch). The original behaviour, kept intact. */
  function makeDepthMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, 1.0);
    m.depthNode = shaded.w as never;
    m.depthWrite = true;
    m.depthTest = true;
    m.fog = false;
    return m;
  }

  const surfMats = {
    overlay: { raw: makeOverlayMat(target.texture), blur: makeOverlayMat(blurB.texture) },
    depth: { raw: makeDepthMat(target.texture), blur: makeDepthMat(blurB.texture) },
  };
  let mode: 'overlay' | 'depth' = 'overlay';

  // ---------------------------------------------------------------
  // SMOOTH reconstruction materials (candidate). Same modes, same uniform
  // NODES, same shading family as surfMats — only the field reconstruction
  // and the coverage alpha differ. OVERLAY keeps depth test/write off (its
  // whole contract); DEPTH alpha-blends the coverage and keeps depth TEST on
  // but turns depth WRITE off, so a partially covered fringe cannot stamp a
  // depth that rejects the scene behind it. There is deliberately no
  // density-resolution smooth variant: surfaceLow's single alpha slot already
  // carries depth in depth mode, and the candidate reports the full-res
  // composite instead of sharing a channel silently.
  // ---------------------------------------------------------------
  const surfaceSmoothFn = wgslFn(GOO_SURFACE_SMOOTH_WGSL);
  const coverageSmoothFn = wgslFn(GOO_COVERAGE_SMOOTH_WGSL);

  function shadeSmoothOf(densTexture: THREE.Texture): Swizzled {
    return surfaceSmoothFn({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      lightDir: rig.lightDir,
      keyColor: rig.keyColor,
      lightCfg: rig.lightCfg,
      camWorld: uCamWorld,
      camCfg: uCamCfg,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
      gooCfg2: vec4(uAbsorb, uSpec, uGloss, uRim),
      organColor: uOrganColor,
      shadowRed: uShadowRed,
      normalMode: uNormalMode,
      coverageTexels: uCoverageTexels,
    }) as unknown as Swizzled;
  }

  function coverageSmoothOf(densTexture: THREE.Texture): Swizzled {
    return coverageSmoothFn({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
      coverageTexels: uCoverageTexels,
    }) as unknown as Swizzled;
  }

  function makeSmoothOverlayMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeSmoothOf(densTexture);
    const cov = coverageSmoothOf(densTexture);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, cov.w as never);
    m.depthWrite = false;
    m.depthTest = false;
    m.transparent = true;
    m.fog = false;
    return m;
  }

  function makeSmoothDepthMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeSmoothOf(densTexture);
    const cov = coverageSmoothOf(densTexture);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, cov.w as never);
    m.depthNode = shaded.w as never;
    // depthWrite OFF on purpose: coverage is partial at the silhouette, and a
    // fringe depth write would occlude the scene behind it. The depth TEST is
    // what preserves occlusion against walls and bodies.
    m.depthWrite = false;
    m.depthTest = true;
    m.transparent = true;
    m.fog = false;
    return m;
  }

  const smoothSurfMats = {
    overlay: { raw: makeSmoothOverlayMat(target.texture), blur: makeSmoothOverlayMat(blurB.texture) },
    depth: { raw: makeSmoothDepthMat(target.texture), blur: makeSmoothDepthMat(blurB.texture) },
  };
  let reconstruction: GooReconstruction = 'original';

  // ---------------------------------------------------------------
  // REFERENCE-ONLY LAYER MATERIALS (selective shutter blur, task 1).
  //
  // Same shading graphs as the surface materials, but the fragment writes
  // WORKING-LINEAR PREMULTIPLIED colour + coverage and blends One/One, so a
  // caller can accumulate N exposure samples into a half-float target and
  // divide once. depthNode routes the reconstructed depth into the hardware
  // depth test against the FROZEN scene depth the caller pre-loaded; depth
  // WRITE stays off so a translucent streak never stamps an opaque depth.
  //
  // This is deliberately NOT reachable from the shipped render() path: it is
  // a quality oracle for the lab, not a shipping frame cost.
  // ---------------------------------------------------------------
  function makeLayerMat(densTexture: THREE.Texture, smooth: boolean): MeshBasicNodeMaterial {
    const m = new MeshBasicNodeMaterial();
    if (smooth) {
      const shaded = shadeSmoothOf(densTexture);
      const cov = coverageSmoothOf(densTexture);
      m.colorNode = vec4(mul(shaded.xyz as never, cov.w as never) as never, cov.w as never);
      m.depthNode = shaded.w as never;
    } else {
      const shaded = shadeOf(densTexture);
      const a = alphaFn({
        densTex: texture(densTexture),
        texCoord: uv(),
        flipY: uFlipY,
        gooCfg: vec3(uThresh, uEdge, uLegacy),
      }) as unknown as Swizzled;
      m.colorNode = vec4(mul(shaded.xyz as never, a.w as never) as never, a.w as never);
      m.depthNode = shaded.w as never;
    }
    m.depthWrite = false;
    m.depthTest = true;
    m.transparent = true;
    m.blending = THREE.AdditiveBlending;
    m.premultipliedAlpha = true;
    m.fog = false;
    return m;
  }

  const layerMats = {
    original: { raw: makeLayerMat(target.texture, false), blur: makeLayerMat(blurB.texture, false) },
    smooth: { raw: makeLayerMat(target.texture, true), blur: makeLayerMat(blurB.texture, true) },
  };


  // ---------------------------------------------------------------
  // ITEM 1 (close-up task 4): the density-resolution surface path.
  // surfaceLow carries the SHADED result at density resolution; the
  // composite then only upsamples. NO depth attachment: the shading pass
  // must not depth-test (its own buffer would be empty — the scene depth
  // lives on the output target and the hardware tests against it in the
  // upsample, per full-res pixel, exactly as the shipped composite does).
  // Half-float like the density targets; no blending runs into it.
  //
  // OVERLAY packs the soft edge in .a (the same alpha makeOverlayMat
  // composites with); DEPTH packs the reconstructed depth buffer value in
  // .a (which the shipped material instead routes through depthNode — that
  // attachment does not exist here). Both live in [0,1] so cleared alpha 0
  // is the empty sentinel the upsample discards on.
  //
  // The shading WGSL itself is UNCHANGED — shadeOf()/makeOverlayMat() are
  // resolution-independent fullscreen-quad graphs; only the render target
  // under them differs. Same uniform NODES, so slider state cannot drift
  // between the two paths.
  // ---------------------------------------------------------------
  const surfaceLow = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  /** DEPTH mode, low-res variant: depth packed into .a instead of depthNode,
   *  and no depth test/write — see the surfaceLow note above. */
  function makeLowDepthMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, shaded.w as never);
    m.depthWrite = false;
    m.depthTest = false;
    m.fog = false;
    return m;
  }

  const lowMats = {
    // Overlay's node graph is exactly makeOverlayMat's (colour + soft-edge
    // alpha) — only the destination differs. Fresh materials, shared uniform
    // nodes: a separate pipeline for the RGBA16F target, no cross-target
    // reuse for the backend to re-specialise.
    overlay: { raw: makeOverlayMat(target.texture), blur: makeOverlayMat(blurB.texture) },
    depth: { raw: makeLowDepthMat(target.texture), blur: makeLowDepthMat(blurB.texture) },
  };

  const upsampleFn = wgslFn(GOO_UPSAMPLE_WGSL);
  function makeUpsampleMat(depth: boolean): MeshBasicNodeMaterial {
    const c = upsampleFn({
      lowTex: texture(surfaceLow.texture),
      texCoord: uv(),
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    if (depth) {
      m.colorNode = vec4(c.xyz as never, 1.0);
      m.depthNode = c.w as never;
      m.depthWrite = true;
      m.depthTest = true;
    } else {
      m.colorNode = vec4(c.xyz as never, c.w as never);
      m.depthWrite = false;
      m.depthTest = false;
      m.transparent = true;
    }
    m.fog = false;
    return m;
  }
  const upMats = { overlay: makeUpsampleMat(false), depth: makeUpsampleMat(true) };

  // The low-res shading quad: its own fullscreen scene, same pattern as the
  // blur pair (swapping materials on a shared quad every frame would dirty
  // three's render lists for nothing).
  const lowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lowMats.overlay.raw);
  lowQuad.frustumCulled = false;
  const lowScene = new THREE.Scene();
  lowScene.add(lowQuad);

  // PERF SEAM STATE — all OFF/shipped by default; see the interface docs.
  let surfaceAtDensityRes = false;
  let minTexelRadius = 0;
  let areaPriority = false;
  let splatFadeTail = 0;
  let densityScale: number = GOO_TUNING.densityScale;
  let particleCap: number = GOO_TUNING.maxParticles;
  let lastSdfW = 0;
  let lastSdfH = 0;
  // The actual composite destination (canvas backing size or the output
  // target), tracked for the coverage footprint and the diagnostics.
  let lastOutputW = 0;
  let lastOutputH = 0;
  const passGate = { density: true, blur: true, surface: true };
  // SELECTION SEAM state (shutter game integration). null = pose everything.
  let selection: GooSelection | null = null;
  // Area-priority scratch: candidate world positions/extents, collected once
  // per sync, reused across frames (never reallocated in steady state).
  const candCap = GOO_TUNING.maxParticles + 1024;
  const candX = new Float32Array(candCap);
  const candY = new Float32Array(candCap);
  const candZ = new Float32Array(candCap);
  const candHalfW = new Float32Array(candCap);
  const candHalfH = new Float32Array(candCap);
  const candRoll = new Float32Array(candCap);
  const candGut = new Float32Array(candCap);
  const candArea = new Float32Array(candCap);
  const candOrder: number[] = [];

  // CONNECTION BLOBS (candidate). Stored in flat scratch arrays copied on
  // setExtraBlobs, so sync() never allocates. The capacity is small on
  // purpose: connections are meant to be sparse additions derived from the
  // existing stream, not a second particle population. They share the
  // particle cap with droplets/splats (never exceed it) and are dropped past
  // it, which the caller's own budget makes rare.
  const EXTRA_BLOB_CAP = 512;
  const extraX = new Float32Array(EXTRA_BLOB_CAP);
  const extraY = new Float32Array(EXTRA_BLOB_CAP);
  const extraZ = new Float32Array(EXTRA_BLOB_CAP);
  const extraHalfW = new Float32Array(EXTRA_BLOB_CAP);
  const extraHalfH = new Float32Array(EXTRA_BLOB_CAP);
  const extraRoll = new Float32Array(EXTRA_BLOB_CAP);
  const extraWeight = new Float32Array(EXTRA_BLOB_CAP);
  const extraGut = new Float32Array(EXTRA_BLOB_CAP);
  let extraCount = 0;

  // DIAGNOSTIC counters — see the note where they are assigned in sync().
  let stretchMax: number = GOO_TUNING.stretchMax;
  let syncCalls = 0;
  let liveCount = 0;

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), surfMats.overlay.raw);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  // z = 1 so the plane at z = 0 sits inside the [0,1] depth range rather
  // than exactly on the near plane, which is degenerate. (sdf-layer's trap.)
  // Shared by the blur quads below — an ortho camera is scene-independent.
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  quadCam.position.z = 1;

  // ---------------------------------------------------------------
  // Blur passes: one fullscreen quad PER DIRECTION (swapping materials on a
  // shared quad every frame would dirty three's render lists for nothing),
  // horizontal density→blurA then vertical blurA→blurB. Opaque full-viewport
  // writes: no blending, nothing depends on the clear colour. The filtered
  // .w IS written back (organs r3): the gut mask rides the field's .a and
  // must survive the blur, which filters all four channels with the same
  // weights — a constant 1 here would repaint every blurred pixel as full
  // gut. No premultiplied-alpha concern: these materials are opaque, so the
  // fragment output lands in the target unblended.
  // ---------------------------------------------------------------
  const blur = wgslFn(GOO_BLUR_WGSL);
  function makeBlurMat(
    srcTexture: THREE.Texture, dirX: number, dirY: number,
  ): MeshBasicNodeMaterial {
    const blurred = blur({
      srcTex: texture(srcTexture),
      texCoord: uv(),
      dir: vec2(dirX, dirY),
      sigma: uBlurPx,
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(blurred.xyz as never, 1.0);
    m.depthWrite = false;
    m.depthTest = false;
    m.fog = false;
    return m;
  }
  const blurHMat = makeBlurMat(target.texture, 1, 0);
  const blurVMat = makeBlurMat(blurA.texture, 0, 1);

  /** A fullscreen quad scene for a blur direction (or the composite). */
  function fullscreenScene(mat: MeshBasicNodeMaterial): {
    scene: THREE.Scene; quad: THREE.Mesh;
  } {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(q);
    return { scene: s, quad: q };
  }
  const blurH = fullscreenScene(blurHMat);
  const blurV = fullscreenScene(blurVMat);

  /** Explicit first clear after every (re)allocation — see file header. */
  let targetsNeedInit = true;
  const emptyScene = new THREE.Scene();
  const clearColorScratch = new THREE.Color();

  /** Where the surface composite draws — null is the canvas. See setOutputTarget. */
  let outputTarget: THREE.RenderTarget | null = null;

  // Scratch for sync — the same matrix compose blood-view-gpu uses,
  // including the velocity stretch: stretched blobs overlap along their
  // motion, which is what fuses a trail into a strand.
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const camInv = new THREE.Quaternion();
  const vCam = new THREE.Vector3();

  return {
    /** PIPELINE WARM-UP (spike program): the goo materials otherwise compile
     *  on the first gout — mid-firefight. compileAsync on each scene graph
     *  the render path uses; the density pass is gated per frame so its
     *  materials compile here instead. */
    async precompile(camera: THREE.PerspectiveCamera) {
      try {
        await renderer.compileAsync(gooScene, camera);
        await renderer.compileAsync(quadScene, quadCam);
        await renderer.compileAsync(blurH.scene, quadCam);
        await renderer.compileAsync(blurV.scene, quadCam);
      } catch (err) {
        console.error('[goo] precompile failed', err);
      }
    },
    render(camera, between) {
      // The scene camera's lens and pose, as uniforms — the surface pass
      // rebuilds its pixel rays from these (see GOO_SURFACE_WGSL).
      // updateMatrixWorld first: this runs in the drawFn, after the render
      // callback moved the camera but before any render call has refreshed
      // its matrixWorld — without it the goo would lag a frame behind the
      // flesh on every camera move.
      camera.updateMatrixWorld();
      uCamWorld.value.copy(camera.matrixWorld);
      uCamCfg.value.set(
        Math.tan((camera.fov * Math.PI) / 360),
        camera.aspect,
        camera.near,
        camera.far,
      );
      // The composite's real destination: the caller's target when one is
      // bound (post-aa capture), otherwise the canvas backing store. The
      // smooth coverage ramp is scaled by density-texels-per-output-pixel so
      // its feather is one output pixel wide regardless of densityScale.
      lastOutputW = outputTarget ? outputTarget.width : renderer.domElement.width;
      lastOutputH = outputTarget ? outputTarget.height : renderer.domElement.height;
      uCoverageTexels.value = densityTexelsPerOutputPixel(
        target.width, target.height, lastOutputW, lastOutputH,
      );

      if (targetsNeedInit) {
        targetsNeedInit = false;
        setPassLabel('init');
        // All four targets — the blur pair AND the low-res surface target
        // need the same explicit first clear as the density target itself:
        // setSize reallocates the backing texture, and a lazily-initialised
        // texture inside the same encoder as the pass that samples it gets
        // the whole submit rejected. The clear colour is irrelevant here (see
        // sdf-layer's note); what matters is that each texture exists before
        // anything samples it. surfaceLow's PER-FRAME clear (alpha 0 sentinel)
        // is explicit at its pass below.
        for (const t of [target, blurA, blurB, surfaceLow]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, camera);
        }
      }

      // Pass A — density. Cleared BLACK: the renderer's clear colour is the
      // scene background (0x1a1116), whose red channel would read as a
      // uniform 0.1 density across the whole screen and threshold into a
      // full-frame goo sheet. (Same trap as the occluder pass's clear.)
      // passGate is DIAGNOSTIC ONLY — a skipped pass renders a wrong frame on
      // purpose so a bench can time the chain apart (Phase 0 attribution).
      const restore = camera.layers.mask;
      const prevClear = renderer.getClearColor(clearColorScratch).getHex();
      // ALPHA 0, explicitly: setClearColor's alpha parameter defaults to 1,
      // and a cleared-to-1 alpha is a gut mask of 1 in every EMPTY pixel —
      // a/r would clamp to full gut across the whole layer (organs r3).
      renderer.setClearColor(0x000000);
      setPassLabel('goo:density');
      renderer.setRenderTarget(target);
      if (passGate.density) void renderer.render(gooScene, camera);
      renderer.setClearColor(prevClear);
      camera.layers.mask = restore;

      // Pass A2 — the separable blur, horizontal then vertical, each a
      // fullscreen quad at the density target's own resolution. Bypassed
      // ENTIRELY at blurPx = 0: not even a degenerate copy pass runs, and
      // the surface reads the raw density target below.
      const blurred = uBlurPx.value > 0;
      if (blurred && passGate.blur) {
        setPassLabel('goo:blur');
        renderer.setRenderTarget(blurA);
        void renderer.render(blurH.scene, quadCam);
        renderer.setRenderTarget(blurB);
        void renderer.render(blurV.scene, quadCam);
      }

      // The middle of the frame belongs to whoever composed us — the whole
      // polygon/sdf/cone/occluder/composite flow. Density already sits in
      // its target, so the surface pass can run after it for free.
      between();

      // Pass B — composite the goo surface onto the canvas. autoClear off,
      // or this wipes the frame it is composited onto. The material is picked
      // per frame from BOTH live axes — mode (overlay/depth) and blurred-vs-raw
      // density — and reassigned only when the pick actually differs from what
      // the quad already holds, so a steady frame mutates nothing while
      // setMode() still takes effect on the very next frame rather than
      // waiting for a blurPx = 0 crossing.
      if (!passGate.surface) return;
      setPassLabel('goo:surface');
      if (reconstruction === 'smooth') {
        // CANDIDATE path: continuous field reconstruction + antialiased
        // silhouette coverage, always at full output resolution (the
        // density-resolution perf seam is not combined with the candidate —
        // see densityDiagnostics.smoothForcesFullResComposite). The material
        // swap keeps a steady frame from mutating anything while
        // setReconstruction still takes effect on the very next frame.
        const wantSmooth = smoothSurfMats[mode][blurred ? 'blur' : 'raw'];
        if (quad.material !== wantSmooth) quad.material = wantSmooth;
        renderer.setRenderTarget(outputTarget);
        const prevAutoClearSmooth = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(quadScene, quadCam);
        renderer.autoClear = prevAutoClearSmooth;
        return;
      }
      if (surfaceAtDensityRes) {
        // ITEM 1 path. Stage 1: the SAME shading graphs (makeOverlayMat /
        // makeLowDepthMat over the same density texture and uniform nodes)
        // render into surfaceLow at density resolution. The low target must
        // clear to BLACK WITH ALPHA 0 every frame — cleared alpha is the
        // upsample's empty sentinel (and would otherwise be a depth of 1 or a
        // gut-masked, opaque sludge in every unshaded texel), and the restored
        // scene clear is the background colour with alpha 1.
        const wantLow = lowMats[mode][blurred ? 'blur' : 'raw'];
        if (lowQuad.material !== wantLow) lowQuad.material = wantLow;
        const prevClearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(surfaceLow);
        void renderer.render(lowScene, quadCam);
        renderer.setClearColor(prevClear, prevClearAlpha);
        // Stage 2: the upsample onto the output. Hardware depth test/write
        // against the scene's depth happens HERE, per output pixel, from the
        // value the shading pass packed into .a (depth mode) — the
        // interleaving contract is unchanged; only the shading resolution
        // moved.
        const wantUp = upMats[mode];
        if (quad.material !== wantUp) quad.material = wantUp;
        renderer.setRenderTarget(outputTarget);
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(quadScene, quadCam);
        renderer.autoClear = prevAutoClear;
        return;
      }
      const wantMat = surfMats[mode][blurred ? 'blur' : 'raw'];
      if (quad.material !== wantMat) quad.material = wantMat;
      renderer.setRenderTarget(outputTarget);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(quadScene, quadCam);
      renderer.autoClear = prevAutoClear;
    },

    renderLayer(camera, layerTarget) {
      camera.updateMatrixWorld();
      uCamWorld.value.copy(camera.matrixWorld);
      uCamCfg.value.set(
        Math.tan((camera.fov * Math.PI) / 360),
        camera.aspect,
        camera.near,
        camera.far,
      );
      lastOutputW = layerTarget.width;
      lastOutputH = layerTarget.height;
      uCoverageTexels.value = densityTexelsPerOutputPixel(
        target.width, target.height, lastOutputW, lastOutputH,
      );

      if (targetsNeedInit) {
        targetsNeedInit = false;
        setPassLabel('init');
        for (const t of [target, blurA, blurB, surfaceLow]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, camera);
        }
      }

      const restore = camera.layers.mask;
      const prevClear = renderer.getClearColor(clearColorScratch).getHex();
      renderer.setClearColor(0x000000);
      setPassLabel('goo:density');
      renderer.setRenderTarget(target);
      if (passGate.density) void renderer.render(gooScene, camera);
      renderer.setClearColor(prevClear);
      camera.layers.mask = restore;

      const blurred = uBlurPx.value > 0;
      if (blurred && passGate.blur) {
        setPassLabel('goo:blur');
        renderer.setRenderTarget(blurA);
        void renderer.render(blurH.scene, quadCam);
        renderer.setRenderTarget(blurB);
        void renderer.render(blurV.scene, quadCam);
      }

      if (!passGate.surface) return false;
      setPassLabel('goo:layer');
      // 'smooth' is the game default; original stays available for an A/B of
      // the reconstruction family without changing the averaging contract.
      const want = reconstruction === 'smooth'
        ? layerMats.smooth[blurred ? 'blur' : 'raw']
        : layerMats.original[blurred ? 'blur' : 'raw'];
      if (quad.material !== want) quad.material = want;
      renderer.setRenderTarget(layerTarget);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(quadScene, quadCam);
      renderer.autoClear = prevAutoClear;
      return true;
    },

    sync(sim, camera) {
      camInv.copy(camera.quaternion).invert();
      const perspCam = camera as THREE.PerspectiveCamera;
      // ITEM 2a inputs: lens + density texel height turn a world half-extent
      // and a view distance into a projected texel radius (projectedTexelRadius).
      // sync() runs after the camera's updateMatrixWorld (game-main's comment
      // on the call site), so camera.position is world-current.
      const tanHalfFovY = Math.tan((perspCam.fov * Math.PI) / 360);
      const densityH = target.height;
      const camPos = camera.position;
      // The sub-texel skip: a quad whose projected blob radius cannot reach
      // one density texel can never fuse into the surface — under additive
      // blending every fragment it would shade is pure overdraw. Seam-off
      // (minTexelRadius 0) never skips.
      const tooSmall = (worldHalfH: number, x: number, y: number, z: number): boolean => {
        if (minTexelRadius <= 0) return false;
        const dist = Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
        return projectedTexelRadius(worldHalfH, dist, tanHalfFovY, densityH) < minTexelRadius;
      };
      let n = 0;
      if (areaPriority) {
        // ITEM 2b path: collect every qualifying candidate with its projected
        // area, order by area (largest first), fill the cap. Splats compete
        // in the SAME pool — at the cap they were previously filled AFTER
        // droplets and could be erased entirely by a full droplet roster.
        let count = 0;
        for (let i = 0; i < sim.droplets.length; i++) {
          const d = sim.droplets[i]!;
          if (d.kind === 'mist') continue;
          if (d.kind !== 'scrap' && d.size < GOO_TUNING.mistMaxSize) continue;
          // SELECTION SEAM: partition the density input across two syncs.
          if (selection && !selection.droplet(d)) continue;
          if (count >= candCap) break;
          const gs = d.size * sizeScale;
          const halfH = (gs * GOO_TUNING.quadScale) / 2;
          const x = d.pos[0], y = d.pos[1], z = d.pos[2];
          if (tooSmall(halfH, x, y, z)) continue;
          vCam.set(d.vel[0], d.vel[1], d.vel[2]).applyQuaternion(camInv);
          const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
          const stretch = 1 + Math.min(speed * 0.18, stretchMax);
          candX[count] = x; candY[count] = y; candZ[count] = z;
          const halfW = (gs * stretch * GOO_TUNING.quadScale) / 2;
          candHalfW[count] = halfW;
          candHalfH[count] = halfH;
          candRoll[count] = Math.atan2(vCam.y, vCam.x);
          candGut[count] = d.kind === 'gut' ? 1 : 0;
          const dist = Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
          const ax = projectedTexelRadius(halfW, dist, tanHalfFovY, densityH);
          const ay = projectedTexelRadius(halfH, dist, tanHalfFovY, densityH);
          candArea[count] = 4 * ax * ay;
          count++;
        }
        const dropletCount = count;
        const splatCount = selection === null || selection.splats ? sim.splats.length : 0;
        for (let i = 0; i < splatCount; i++) {
          const sp = sim.splats[i]!;
          if (count >= candCap) break;
          const gr = sp.size * GOO_TUNING.splatGooScale * 2; // quad edge = 2x radius
          const halfH = gr / 2;
          const x = sp.pos[0], y = 0.02, z = sp.pos[2];
          if (tooSmall(halfH, x, y, z)) continue;
          const h = Math.sin(sp.yaw * 78.233) * 43758.5453;
          const ecc = 1.4 + (h - Math.floor(h)) * 1.2;
          candX[count] = x; candY[count] = y; candZ[count] = z;
          const halfW = (gr * ecc) / 2;
          candHalfW[count] = halfW;
          candHalfH[count] = halfH;
          candRoll[count] = sp.yaw;
          candGut[count] = 0; // floor pools are blood, never gut
          const dist = Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
          const ax = projectedTexelRadius(halfW, dist, tanHalfFovY, densityH);
          const ay = projectedTexelRadius(halfH, dist, tanHalfFovY, densityH);
          candArea[count] = 4 * ax * ay;
          count++;
        }
        orderIndicesByAreaDesc(candArea, count, candOrder);
        const fill = Math.min(count, particleCap);
        for (let k = 0; k < fill; k++) {
          const c = candOrder[k]!;
          p.set(candX[c]!, candY[c]!, candZ[c]!);
          roll.setFromAxisAngle(zAxis, candRoll[c]!);
          q.copy(perspCam.quaternion).multiply(roll);
          s.set(candHalfW[c]! * 2, candHalfH[c]! * 2, 1);
          m.compose(p, q, s);
          gutArr[n] = candGut[c]!;
          fallArr[n] = c >= dropletCount
            ? splatDensityWeight(sim.splats.length - 1 - (c - dropletCount), sim.splats.length, splatFadeTail)
            : 1;
          quads.setMatrixAt(n++, m);
        }
      } else {
        for (let i = 0; i < sim.droplets.length && n < particleCap; i++) {
          const d = sim.droplets[i]!;
          // Mist cutoff: the fine beads stay in the billboard view; everything
          // else feeds the density field. Scraps always go.
          //
          // The explicit 'mist' kind (bleeding-wounds, 2026-08-31) is haze by
          // construction and NEVER feeds density, whatever its size — some
          // stump mist rolls above mistMaxSize, and letting it in fogs the
          // field instead of thickening the stream. No-op for the lab, which
          // has no mist particles.
          if (d.kind === 'mist') continue;
          if (d.kind !== 'scrap' && d.size < GOO_TUNING.mistMaxSize) continue;
          // SELECTION SEAM: see the area-priority branch above.
          if (selection && !selection.droplet(d)) continue;
          // ITEM 2a: skip what distance has made sub-texel (see tooSmall).
          const gs = d.size * sizeScale;
          if (tooSmall((gs * GOO_TUNING.quadScale) / 2, d.pos[0], d.pos[1], d.pos[2])) continue;
          p.set(d.pos[0], d.pos[1], d.pos[2]);
          // Billboard, then roll in screen space so the stretch follows velocity.
          vCam.set(d.vel[0], d.vel[1], d.vel[2]).applyQuaternion(camInv);
          const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
          const stretch = 1 + Math.min(speed * 0.18, stretchMax);
          roll.setFromAxisAngle(zAxis, Math.atan2(vCam.y, vCam.x));
          q.copy(camera.quaternion).multiply(roll);
          s.set(gs * stretch * GOO_TUNING.quadScale, gs * GOO_TUNING.quadScale, 1);
          m.compose(p, q, s);
          gutArr[n] = d.kind === 'gut' ? 1 : 0;
          fallArr[n] = 1;
          quads.setMatrixAt(n++, m);
        }
        // Floor pools: every splat becomes an elongated density blob at its
        // floor point (see the splatGooScale note). BILLBOARDED, not laid
        // flat: a flat quad viewed near edge-on covers only a few rows of the
        // low-res density buffer and stripes. The blob is rolled in screen
        // space by the stamp yaw so pools still smear directionally. Droplets
        // take the budget first — they are the flying action — but the splat
        // ring is capped at 256 so both fit.
        const splatLimit = selection === null || selection.splats ? sim.splats.length : 0;
        for (let i = 0; i < splatLimit && n < particleCap; i++) {
          const sp = sim.splats[i]!;
          const gr = sp.size * GOO_TUNING.splatGooScale * 2; // quad edge = 2x radius
          if (tooSmall(gr / 2, sp.pos[0], 0.02, sp.pos[2])) continue;
          p.set(sp.pos[0], 0.02, sp.pos[2]);
          roll.setFromAxisAngle(zAxis, sp.yaw);
          q.copy(perspCam.quaternion).multiply(roll);
          // Deterministic per-splat eccentricity hashed from the stamp yaw.
          const h = Math.sin(sp.yaw * 78.233) * 43758.5453;
          const ecc = 1.4 + (h - Math.floor(h)) * 1.2;
          s.set(gr * ecc, gr, 1);
          m.compose(p, q, s);
          gutArr[n] = 0; // floor pools are blood, never gut
          // ITEM 3: the oldest ranks fade (ring position IS recency — Splat
          // carries no timestamp and blood-sim.ts is not ours to change).
          fallArr[n] = splatDensityWeight(
            sim.splats.length - 1 - i, sim.splats.length, splatFadeTail,
          );
          quads.setMatrixAt(n++, m);
        }
      }
      // CONNECTIONS — extra density quads, posed AFTER the sim's own
      // droplets/splats and inside the same cap. They are added last on
      // purpose: the sim's particles are the primary read, and a busy frame
      // drops connections rather than droplets. Gut mask and density weight
      // ride the same per-instance attributes, so the same surface pass
      // shades them (there is no second, flat material for strands).
      const extraBudget = selection !== null && !selection.extras
        ? 0
        : Math.min(extraCount, Math.max(0, particleCap - n));
      for (let e = 0; e < extraBudget; e++) {
        p.set(extraX[e]!, extraY[e]!, extraZ[e]!);
        roll.setFromAxisAngle(zAxis, extraRoll[e]!);
        q.copy(perspCam.quaternion).multiply(roll);
        s.set(extraHalfW[e]! * 2, extraHalfH[e]! * 2, 1);
        m.compose(p, q, s);
        gutArr[n] = extraGut[e]!;
        fallArr[n] = extraWeight[e]!;
        quads.setMatrixAt(n++, m);
      }
      for (let i = n; i < GOO_TUNING.maxParticles; i++) {
        m.makeScale(0, 0, 0);
        quads.setMatrixAt(i, m);
        gutArr[i] = 0;
        fallArr[i] = 1;
      }
      quads.instanceMatrix.needsUpdate = true;
      gutAttr.needsUpdate = true;
      fallAttr.needsUpdate = true;
      // Draw only the live instances. At 0 the pass still runs (and clears),
      // which the first-clear discipline depends on.
      quads.count = n;
      // DIAGNOSTIC (blood-viscosity): the two numbers that tell you whether
      // this layer is being fed at all. syncCalls proves sync() is wired into
      // the host page's frame at all — it shipped MISSING on the game page,
      // which made the density field empty forever and every threshold sweep
      // unwinnable. liveCount is how many quads the last sync actually posed:
      // 0 with blood visible on screen means the cutoff rejected everything,
      // non-zero means the field has input and any remaining problem is
      // downstream in the density/surface passes.
      syncCalls++;
      liveCount = n;
    },

    setSize(sdfWidth, sdfHeight) {
      lastSdfW = sdfWidth;
      lastSdfH = sdfHeight;
      const w = Math.max(1, Math.round(sdfWidth * densityScale));
      const h = Math.max(1, Math.round(sdfHeight * densityScale));
      target.setSize(w, h);
      blurA.setSize(w, h);
      blurB.setSize(w, h);
      // ITEM 1's target lives at the density resolution by definition — it is
      // the surface pass running at density res.
      surfaceLow.setSize(w, h);
      // setSize reallocates the backing texture — the lazy-init conflict
      // would return on the next frame without a fresh explicit clear.
      targetsNeedInit = true;
    },
    setOutputTarget(t) { outputTarget = t; },
    setFlipY(on) { uFlipY.value = on ? 1 : 0; },
    // CEILING RAISED TO 4 (2026-08-31). It was 0.95, and the file's own note
    // says "a lone blob peaks near 1.0" — so no threshold in the old range
    // could ever REJECT a single droplet, and the field rendered every
    // isolated bead as its own oval blob no matter how it was tuned. Owner
    // read that as "little oval drops" three rounds running. Above 1 the
    // threshold starts demanding genuine overlap, which is the whole point
    // of a metaball: 2 blobs to cross ~1.5, 3 to cross ~2.5. The lab keeps
    // its 0.4 default, so nothing there moves.
    setThreshold(v) { uThresh.value = Math.max(0.05, Math.min(4, v)); },
    setEdge(v) { uEdge.value = Math.max(1.01, Math.min(4, v)); },
    // Ceiling 5 -> 16: wider blur is how neighbouring peaks merge before the
    // threshold sees them. (5.5 was being silently clamped to 5.)
    setBlurPx(v) { uBlurPx.value = Math.max(0, Math.min(16, v)); },
    setSizeScale(v) { sizeScale = Math.max(0.05, Math.min(1.5, v)); },
    // CLAMP RANGES are checked against what the shader actually produces, not
    // guessed — see the setThreshold note above for what guessing cost.
    // absorb: 0 flattens the body to one colour (not the pre-viscosity look
    // — the base literal changed too, see GOO_TUNING.absorb above). Ceiling
    // kept at 3: it is the CORE that saturates, not the fringe — the fringe
    // band (dens - thresh <= ~0.24 at default threshold/edge) still
    // transmits ~81% red at absorb 3, but past absorb ~2.5 a core of dens
    // ~2 is already down to ~24% red survival (and near-zero green/blue),
    // so a higher ceiling would only push the fringe darker, not recover
    // any usable range in the core.
    setAbsorb(v) { uAbsorb.value = Math.max(0, Math.min(3, v)); },
    setSpec(v) { uSpec.value = Math.max(0, Math.min(4, v)); },
    // gloss FLOOR of 8, not 1: below ~8 the lobe is wider than the blob and
    // the whole surface reads as flat white, which looks like a broken pass.
    setGloss(v) { uGloss.value = Math.max(8, Math.min(400, v)); },
    setRim(v) { uRim.value = Math.max(0, Math.min(1, v)); },
    // CEILING RAISED 4 -> 8 (2026-08-31): the owner's chosen value landed
    // exactly ON the old ceiling, which is the signature of a clamp that is
    // silently capping intent rather than guarding a range. Same reason the
    // gloss ceiling went 220 -> 400. Both were guesses; neither was measured.
    // Ceiling 4, not 0.8: the old hard-coded 0.8 was a floor-to-ceiling range
    // of exactly one value, and the knob is only interesting BELOW it anyway.
    setStretch(v) { stretchMax = Math.max(0, Math.min(8, v)); },
    setShadowRed(v) { uShadowRed.value = Math.max(0, Math.min(0.6, v)); },
    setSurfaceNormals(on) { uNormalMode.value = on ? 1 : 0; },
    setMode(m: 'overlay' | 'depth') { mode = m; },
    setReconstruction(m: GooReconstruction) { reconstruction = m; },
    setExtraBlobs(blobs: readonly GooDensityBlob[]) {
      const count = Math.min(blobs.length, EXTRA_BLOB_CAP);
      for (let i = 0; i < count; i++) {
        const b = blobs[i]!;
        extraX[i] = b.x; extraY[i] = b.y; extraZ[i] = b.z;
        extraHalfW[i] = b.halfW; extraHalfH[i] = b.halfH; extraRoll[i] = b.roll;
        extraWeight[i] = b.weight ?? 1;
        extraGut[i] = b.gut ?? 0;
      }
      extraCount = count;
    },
    // SELECTION SEAM (shutter game integration): see GooSelection.
    setSelection(sel) { selection = sel; },
    async precompileLayer() {
      // Compile the reference layer graphs in the SAME scene/target shape
      // renderLayer draws, so the first shutter frame does not pay a
      // mid-firefight pipeline compile. The material is restored afterwards:
      // this is a warm-up, not a pose.
      try {
        const prev = quad.material;
        for (const m of [layerMats.smooth.raw, layerMats.smooth.blur,
          layerMats.original.raw, layerMats.original.blur]) {
          quad.material = m;
          await renderer.compileAsync(quadScene, quadCam);
        }
        quad.material = prev;
      } catch (err) {
        console.error('[goo] precompileLayer failed', err);
      }
    },
    // PERF SEAMS (close-up task 4) — every default is the shipped state.
    setSurfaceAtDensityRes(on) { surfaceAtDensityRes = on; },
    setMinTexelRadius(v) { minTexelRadius = Math.max(0, Math.min(16, v)); },
    setAreaPriority(on) { areaPriority = on; },
    setSplatFadeTail(v) { splatFadeTail = Math.max(0, Math.min(GOO_TUNING.maxParticles, Math.round(v))); },
    setDensityScale(v) {
      const next = Math.max(0.05, Math.min(1, v));
      if (next === densityScale) return;
      densityScale = next;
      if (lastSdfW > 0 && lastSdfH > 0) this.setSize(lastSdfW, lastSdfH);
    },
    get densityScale() { return densityScale; },
    setParticleCap(n) { particleCap = Math.max(0, Math.min(GOO_TUNING.maxParticles, Math.floor(n))); },
    get particleCap() { return particleCap; },
    setPassGate(g) {
      if (g.density !== undefined) passGate.density = g.density;
      if (g.blur !== undefined) passGate.blur = g.blur;
      if (g.surface !== undefined) passGate.surface = g.surface;
    },
    get mode() { return mode; },
    get debugTargets() { return { density: target, blurred: blurB }; },
    get liveCount() { return liveCount; },
    get syncCalls() { return syncCalls; },
    setLegacyGamma(on) { uLegacy.value = on ? 1 : 0; },
    get threshold() { return uThresh.value; },
    get sizeScale() { return sizeScale; },
    get edge() { return uEdge.value; },
    get blurPx() { return uBlurPx.value; },
    get absorb() { return uAbsorb.value; },
    get spec() { return uSpec.value; },
    get gloss() { return uGloss.value; },
    get rim() { return uRim.value; },
    get stretch() { return stretchMax; },
    get shadowRed() { return uShadowRed.value; },
    get surfaceNormals() { return uNormalMode.value > 0.5; },
    get surfaceAtDensityRes() { return surfaceAtDensityRes; },
    get minTexelRadius() { return minTexelRadius; },
    get areaPriority() { return areaPriority; },
    get splatFadeTail() { return splatFadeTail; },
    get passGate() { return { ...passGate }; },
    get targetSize() { return { width: target.width, height: target.height }; },
    get reconstruction() { return reconstruction; },
    get extraBlobCount() { return extraCount; },
    get densityDiagnostics(): GooDensityDiagnostics {
      return {
        densityWidth: target.width,
        densityHeight: target.height,
        sourceWidth: lastSdfW,
        sourceHeight: lastSdfH,
        outputWidth: lastOutputW,
        outputHeight: lastOutputH,
        densityScale,
        texelsPerSourcePixelX: lastSdfW > 0 ? target.width / lastSdfW : 0,
        texelsPerSourcePixelY: lastSdfH > 0 ? target.height / lastSdfH : 0,
        texelsPerOutputPixelX: lastOutputW > 0 ? target.width / lastOutputW : 0,
        texelsPerOutputPixelY: lastOutputH > 0 ? target.height / lastOutputH : 0,
        smoothForcesFullResComposite: reconstruction === 'smooth',
      };
    },
    dispose() {
      target.dispose();
      blurA.dispose();
      blurB.dispose();
      surfaceLow.dispose();
      quads.geometry.dispose();
      densMat.dispose();
      quad.geometry.dispose();
      lowQuad.geometry.dispose();
      for (const byMode of Object.values(surfMats)) {
        for (const m of Object.values(byMode)) m.dispose();
      }
      for (const byMode of Object.values(smoothSurfMats)) {
        for (const m of Object.values(byMode)) m.dispose();
      }
      for (const byMode of Object.values(lowMats)) {
        for (const m of Object.values(byMode)) m.dispose();
      }
      upMats.overlay.dispose();
      upMats.depth.dispose();
      blurH.quad.geometry.dispose();
      blurV.quad.geometry.dispose();
      blurHMat.dispose();
      blurVMat.dispose();
    },
  };
}
