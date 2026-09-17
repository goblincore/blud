// src/lab/sdf-zombie/webgpu/shutter-blur.ts
//
// EFFICIENT SHUTTER CANDIDATE (selective shutter blur, task 2).
//
// The sampled reference (task 1) is the quality oracle: it shades the selected
// blood SEPARATELY at N exposure times and averages premultiplied colour and
// coverage. It is correct but costs N full goo chains per frame. This module
// is the bounded, shipping-shaped candidate:
//
//   1. The CURRENT selected blood is shaded ONCE (goo-layer's renderLayer) into
//      a working-linear premultiplied colour+coverage target.
//   2. A CPU-built MOTION SEED field rasterizes each selected droplet's swept
//      segment (current position back to `pos - velocity * exposure`) into a
//      coarse density-resolution texture. Every texel on the sweep stores the
//      OWNER's current screen position, its buffer depth and a soft sweep
//      weight. Ownership is single-valued (max weight, nearest depth on a tie),
//      so two opposed streams never average into a stationary blob.
//   3. A single fullscreen resolve composites the clean scene with the owner's
//      colour/coverage wherever the sweep reaches, depth-tested against the
//      frozen scene depth. It reaches OUTSIDE the current silhouette because
//      the seed field marks the whole swept path, not just the live shape.
//
// The projection is object-only: BOTH endpoints go through the CURRENT camera,
// exactly as the plan requires. Motion is linear over the shutter interval
// (gravity is ignored across a sub-frame window); a droplet behind the eye is
// dropped rather than given a guessed vector.
//
// Units are explicit: screen positions are OUTPUT pixels with y DOWN (the same
// convention as shutter-reference's projectWorldToPixel); seed storage is
// DISPLAY-indexed (v = 0 is the top row of the displayed frame), which is the
// orientation task 1 measured for offscreen targets sampled by the canvas blit.
//
// No three import in the pure half: the seed planner and rasterizer are the
// testable heart and are shared by the page and its tests. The TSL half only
// creates the one fullscreen resolve material.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { texture, uv, uniform, vec4, wgslFn } from 'three/tsl';
import type { Droplet } from '../blood-sim';
import { projectWorldToPixel } from './shutter-reference';

// ---------------------------------------------------------------------------
// Bounds. Every one is a hard cap: the resolve never grows work on a hitch.
// ---------------------------------------------------------------------------

/**
 * Bounded directional gather taps in the resolve.
 *
 * TASK-3 FIX (evidence: 41-crop-crossing-cand-vs-sampled.png). At 8 uniform
 * taps a fast spray's streak read as a string of discrete beads against the
 * sampled oracle's continuous smear: 8 translates of the CURRENT discrete goo
 * surface leave gaps of ~streakPx/8. 24 taps (spacing <= ~1.3 px on a 30 px
 * streak) resolves the streak continuously, and each tap is stratified-jittered
 * so any residual regularity is noise rather than banding. This is still a hard
 * cap — the resolve never grows work on a hitch — and the measured GPU delta
 * for the ordinary case stays inside the ~1 ms target (TASK-3.md).
 */
export const SHUTTER_CANDIDATE_TAPS = 24;
/** Seed field dimensions are clamped into this band whatever the density res. */
export const SHUTTER_SEED_MIN = 16;
export const SHUTTER_SEED_MAX = 512;
/** Cross-section half-width of a sweep in seed texels (floor and ceiling). */
export const SWEEP_MIN_HALF_TEXELS = 0.75;
export const SWEEP_MAX_HALF_TEXELS = 48;
/** Below this sweep weight a seed texel is treated as empty (no work). */
export const DEFAULT_SEED_MIN_WEIGHT = 0.02;
/** Metres of depth slack before a sweep sample is treated as occluded. */
export const DEFAULT_DEPTH_BIAS_M = 0.02;

// ---------------------------------------------------------------------------
// Depth conventions. These are the exact inverses of goo-layer's surface pass:
//   depthBuf = far * (viewDepth - near) / (viewDepth * (far - near))
// so the CPU seed can store the same [0,1] buffer depth the hardware depth
// texture holds, and the resolve can compare the two in metric view metres.
// ---------------------------------------------------------------------------

export function clipToViewDepth(clipZ: number, near: number, far: number): number {
  if (!Number.isFinite(clipZ) || !(far > near) || near <= 0) return Number.POSITIVE_INFINITY;
  const denom = far - clipZ * (far - near);
  if (!(denom > 1e-9)) return Number.POSITIVE_INFINITY;
  return (near * far) / denom;
}

export function viewToClipDepth(viewDepth: number, near: number, far: number): number {
  if (!Number.isFinite(viewDepth) || viewDepth <= 0 || !(far > near)) return 1;
  const v = Math.max(viewDepth, 1e-4);
  return Math.min(1, Math.max(0, (far * (v - near)) / (v * (far - near))));
}

/**
 * Projected pixel radius of a world half-extent at a metric view depth.
 * focalPx = (height / 2) / tanHalfFovY is the pinhole focal length in pixels.
 */
export function projectWorldRadiusToPixels(
  worldRadius: number, viewDepth: number, tanHalfFovY: number, outputHeight: number,
): number {
  if (!(worldRadius > 0) || !(viewDepth > 1e-6) || !(tanHalfFovY > 1e-6)) return 0;
  const focalPx = (outputHeight * 0.5) / tanHalfFovY;
  return (worldRadius * focalPx) / viewDepth;
}

/**
 * The depth-aware occlusion test, in metric view metres: a sweep sample is
 * occluded when the clean scene at the destination pixel is CLOSER than the
 * owner by more than `bias`. `sceneClipZ >= 1` is the cleared far plane (no
 * geometry), so nothing occludes there. This is the exact arithmetic the
 * resolve runs on the GPU; keeping a CPU twin makes it testable.
 */
export function sweepOccluded(
  ownerViewDepth: number, sceneClipZ: number, near: number, far: number, bias: number,
): boolean {
  if (!Number.isFinite(ownerViewDepth)) return false;
  if (!(sceneClipZ < 1)) return false;
  const sceneZ = clipToViewDepth(sceneClipZ, near, far);
  if (!Number.isFinite(sceneZ)) return false;
  return ownerViewDepth > sceneZ + bias;
}

/** Camera inputs the seed planner needs. Matrices are column-major (three). */
export interface ShutterProjection {
  /** world -> clip (camera.projectionMatrix * camera.matrixWorldInverse). */
  viewProj: readonly number[];
  /** world -> view (camera.matrixWorldInverse). */
  viewMatrix: readonly number[];
  width: number;
  height: number;
  near: number;
  far: number;
  tanHalfFovY: number;
}

export interface SweepStampOpts {
  /** Quality cap on the drawn streak in output pixels. */
  maxStreakPx: number;
  /** World half-extent per particle = size * sizeScale * quadScale / 2. */
  sizeScale: number;
  quadScale: number;
  /** goo-layer's own cutoff: non-scrap droplets below this are mist (billboards). */
  mistMaxSize: number;
  /** Skip droplets whose projected radius is below this many output pixels. */
  minRadiusPx?: number;
  /**
   * GAME INTEGRATION (2026-09-17): clamp the back-projected interval to the
   * droplet's own AGE. A bead born 3 ms ago cannot have been exposed for
   * 44.4 ms, so without this a newborn draws a streak backwards into its
   * emitter — the plan's "no pre-birth streaks". When true, a droplet with
   * age <= 0 gets no sweep at all (the resolve still composites its sharp
   * current shape through the layer's `base`, so nothing disappears). The
   * lab leaves this off so its fixture cadence is unchanged.
   *
   * The stored motion vector is still divided by the FULL exposure (not the
   * age-clamped one): `seed.xy * exposureSeconds` must reproduce the clamped
   * segment, which is exactly what the resolve's gather integrates over.
   */
  clampToAge?: boolean;
}

export interface SweepStamp {
  stream: number;
  /** Owner's CURRENT output-pixel position (y down). */
  ownerX: number;
  ownerY: number;
  /** Owner's display UV (v = 0 at the top of the frame). */
  ownerU: number;
  ownerV: number;
  /** Owner's metric camera-forward depth, metres. */
  ownerViewDepth: number;
  /** Owner's [0,1] buffer depth (the value the layer's depthNode writes). */
  ownerClipZ: number;
  /** Swept segment endpoints in output pixels (y down). */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Cross-section half-width in output pixels. */
  radiusPx: number;
  /** CLAMPED streak length in output pixels (<= maxStreakPx). */
  streakPx: number;
  /** CLAMPED motion in display UV per second (the seed's stored vector). */
  velocityU: number;
  velocityV: number;
  velocityX: number;
  velocityY: number;
}

/**
 * Plan one swept stamp per selected droplet. Returns null for a droplet whose
 * projected motion is unusable (behind the eye, non-finite, zero exposure).
 *
 * The sweep segment is CLAMPED to `maxStreakPx`: the far endpoint is moved
 * toward the current position, so both the seed cost and the drawn streak stay
 * bounded no matter how fast the droplet is.
 */
export function planSweepStamp(
  d: Droplet, proj: ShutterProjection, exposureSeconds: number, opts: SweepStampOpts,
): SweepStamp | null {
  if (!(exposureSeconds > 0) || !Number.isFinite(exposureSeconds)) return null;
  if (d.kind === 'mist') return null;
  if (d.kind !== 'scrap' && d.size < opts.mistMaxSize) return null;
  if (!Number.isFinite(d.pos[0]) || !Number.isFinite(d.vel[0])) return null;

  // AGE CLAMP (game integration): never expose a droplet before it was born.
  let exposure = exposureSeconds;
  if (opts.clampToAge) {
    const age = Number.isFinite(d.age) ? Math.max(0, d.age) : 0;
    exposure = Math.min(exposureSeconds, age);
    if (!(exposure > 0)) return null;
  }

  const now = projectWorldToPixel(d.pos, proj.viewProj, proj.width, proj.height);
  if (!now) return null;
  const startWorld: [number, number, number] = [
    d.pos[0] - d.vel[0] * exposure,
    d.pos[1] - d.vel[1] * exposure,
    d.pos[2] - d.vel[2] * exposure,
  ];
  const start = projectWorldToPixel(startWorld, proj.viewProj, proj.width, proj.height);
  if (!start) return null;

  // Metric view depth of the owner (positive in front of the eye).
  const vm = proj.viewMatrix;
  const viewZ = -(vm[2]! * d.pos[0] + vm[6]! * d.pos[1] + vm[10]! * d.pos[2] + vm[14]!);
  if (!Number.isFinite(viewZ) || viewZ <= proj.near * 0.5) return null;

  const worldHalf = (d.size * opts.sizeScale * opts.quadScale) / 2;
  let radiusPx = projectWorldRadiusToPixels(worldHalf, viewZ, proj.tanHalfFovY, proj.height);
  if (!Number.isFinite(radiusPx)) radiusPx = 0;
  radiusPx = Math.max(0.5, Math.min(64, radiusPx));
  if (opts.minRadiusPx !== undefined && radiusPx < opts.minRadiusPx) return null;

  let fromX = start[0];
  let fromY = start[1];
  const toX = now[0];
  const toY = now[1];
  let streak = Math.hypot(toX - fromX, toY - fromY);
  if (!Number.isFinite(streak)) return null;
  if (streak > opts.maxStreakPx && streak > 1e-6) {
    const k = opts.maxStreakPx / streak;
    fromX = toX - (toX - fromX) * k;
    fromY = toY - (toY - fromY) * k;
    streak = opts.maxStreakPx;
  }

  return {
    stream: d.stream ?? -1,
    ownerX: toX,
    ownerY: toY,
    ownerU: toX / proj.width,
    ownerV: toY / proj.height,
    ownerViewDepth: viewZ,
    ownerClipZ: viewToClipDepth(viewZ, proj.near, proj.far),
    fromX,
    fromY,
    toX,
    toY,
    radiusPx,
    streakPx: streak,
    velocityU: (toX - fromX) / proj.width / exposureSeconds,
    velocityV: (toY - fromY) / proj.height / exposureSeconds,
    velocityX: (toX - fromX) / exposureSeconds,
    velocityY: (toY - fromY) / exposureSeconds,
  };
}

export function planSweepStamps(
  droplets: readonly Droplet[], proj: ShutterProjection, exposureSeconds: number, opts: SweepStampOpts,
): SweepStamp[] {
  const out: SweepStamp[] = [];
  for (const d of droplets) {
    const s = planSweepStamp(d, proj, exposureSeconds, opts);
    if (s) out.push(s);
  }
  return out;
}

/** Optional per-texel ownership record used for the crossing-stream diagnostic. */
export interface SeedOwnership {
  stream: Int32Array;
  vx: Float32Array;
  vy: Float32Array;
}

export interface SweepSeedStats {
  /** Stamps offered (selected droplets that produced a usable sweep). */
  stamps: number;
  /** Texel writes performed (a texel can be written more than once). */
  texels: number;
  /** Distinct-owner collisions, i.e. where a second stream reached a texel. */
  conflicts: number;
  /** Collisions between motions that actually oppose (dot < 0). */
  oppositeConflicts: number;
  /** Overwrites decided by the nearer depth on a near-equal weight. */
  nearerWins: number;
  maxStreakPx: number;
  avgStreakPx: number;
}

export const EMPTY_SEED_STATS: Readonly<SweepSeedStats> = Object.freeze({
  stamps: 0, texels: 0, conflicts: 0, oppositeConflicts: 0, nearerWins: 0,
  maxStreakPx: 0, avgStreakPx: 0,
});

/** Seed dimensions for an output size: density-resolution by default, bounded. */
export function seedDimsForOutput(
  outputWidth: number, outputHeight: number, scale = 0.5,
): { width: number; height: number } {
  const srcW = Math.max(1, outputWidth) * scale;
  const srcH = Math.max(1, outputHeight) * scale;
  // ASPECT-PRESERVING MAX CLAMP (game integration, 2026-09-17). The original
  // clamped width and height INDEPENDENTLY, so a 960x540 density grid came
  // back 512x512 — a 1.78:1 sweep field stored into a square texture, which
  // stretches every streak vertically and desynchronises the seed from the
  // display. Scale BOTH axes by the single largest overshoot instead.
  const over = Math.max(srcW / SHUTTER_SEED_MAX, srcH / SHUTTER_SEED_MAX, 1);
  const w = srcW / over;
  const h = srcH / over;
  const clampDim = (v: number): number =>
    Math.max(SHUTTER_SEED_MIN, Math.min(SHUTTER_SEED_MAX, Math.round(v)));
  return { width: clampDim(w), height: clampDim(h) };
}

/** Squared distance from point p to segment ab (all in the same units). */
function distanceSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Rasterize the swept stamps into a DISPLAY-indexed RGBA float seed field:
 *   xy = owner CLAMPED motion in display UV per second, z = owner buffer
 *   depth, w = sweep weight.
 *
 * O(cap * stamp) with every stamp clamped: bbox is the segment plus the
 * cross-section radius, and the radius has a hard ceiling. `out` is cleared
 * only when there are stamps, so an empty frame can skip the resolve entirely.
 *
 * OWNERSHIP IS SINGLE-VALUED. A texel keeps one owner: the strongest sweep
 * weight, and the nearer depth when two weights tie within `tieEps`. Nothing
 * sums or averages two velocities, so opposed streams stay two sweeps. The
 * optional `ownership` buffers only record the winner for diagnostics.
 */
export function rasterizeSweepSeed(
  stamps: readonly SweepStamp[],
  outputWidth: number,
  outputHeight: number,
  seedWidth: number,
  seedHeight: number,
  out: Float32Array,
  ownership?: SeedOwnership,
  tieEps = 1e-3,
): SweepSeedStats {
  if (stamps.length === 0) return { ...EMPTY_SEED_STATS };
  if (out.length < seedWidth * seedHeight * 4) throw new Error('rasterizeSweepSeed: seed buffer too small');
  out.fill(0);
  if (ownership) {
    ownership.stream.fill(-1);
    ownership.vx.fill(0);
    ownership.vy.fill(0);
  }

  const sx = seedWidth / outputWidth;
  const sy = seedHeight / outputHeight;
  let texels = 0;
  let conflicts = 0;
  let oppositeConflicts = 0;
  let nearerWins = 0;
  let maxStreakPx = 0;
  let sumStreakPx = 0;

  for (const s of stamps) {
    maxStreakPx = Math.max(maxStreakPx, s.streakPx);
    sumStreakPx += s.streakPx;
    const ax = s.fromX * sx;
    const ay = s.fromY * sy;
    const bx = s.toX * sx;
    const by = s.toY * sy;
    const half = Math.max(
      SWEEP_MIN_HALF_TEXELS,
      Math.min(SWEEP_MAX_HALF_TEXELS, s.radiusPx * sx),
    );
    const half2 = half * half;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - half));
    const maxX = Math.min(seedWidth - 1, Math.ceil(Math.max(ax, bx) + half));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - half));
    const maxY = Math.min(seedHeight - 1, Math.ceil(Math.max(ay, by) + half));

    for (let iy = minY; iy <= maxY; iy++) {
      const py = iy + 0.5;
      for (let ix = minX; ix <= maxX; ix++) {
        const px = ix + 0.5;
        const d2 = distanceSqToSegment(px, py, ax, ay, bx, by);
        if (d2 > half2) continue;
        const weight = 1 - d2 / half2;
        if (weight <= 0) continue;
        const idx = (iy * seedWidth + ix) * 4;
        const existing = out[idx + 3]!;
        const ownerIdx = iy * seedWidth + ix;

        let write = false;
        if (weight > existing + tieEps) {
          write = true;
        } else if (weight > existing - tieEps) {
          // Near-equal sweep weight: the NEARER owner wins. A single-valued,
          // depth-coherent choice — never an average.
          if (existing <= 0 || s.ownerClipZ < out[idx + 2]!) {
            if (existing > 0) nearerWins++;
            write = true;
          }
        }

        if (existing > 1e-4 && ownership) {
          const prevStream = ownership.stream[ownerIdx]!;
          if (prevStream !== -1 && prevStream !== s.stream) {
            conflicts++;
            const dot = ownership.vx[ownerIdx]! * s.velocityX + ownership.vy[ownerIdx]! * s.velocityY;
            if (dot < 0) oppositeConflicts++;
          }
        }

        if (!write) continue;
        out[idx] = s.velocityU;
        out[idx + 1] = s.velocityV;
        out[idx + 2] = s.ownerClipZ;
        out[idx + 3] = Math.min(1, weight);
        texels++;
        if (ownership) {
          ownership.stream[ownerIdx] = s.stream;
          ownership.vx[ownerIdx] = s.velocityX;
          ownership.vy[ownerIdx] = s.velocityY;
        }
      }
    }
  }

  return {
    stamps: stamps.length,
    texels,
    conflicts,
    oppositeConflicts,
    nearerWins,
    maxStreakPx,
    avgStreakPx: stamps.length > 0 ? sumStreakPx / stamps.length : 0,
  };
}

// ---------------------------------------------------------------------------
// The one fullscreen resolve.
//
// Display index `d = (uv.x, 1 - uv.y)`: the offscreen targets this pass reads
// are indexed top-down (task 1 measured this for the canvas blit path), and
// the seed field is built in the same display space, so one flip covers every
// sample. The pass writes `scene*(1-cov) + premultipliedRgb` in the scene's
// WORKING-LINEAR space; the canvas-bound sRGB encode is left to three exactly
// as the sampled composite leaves it.
// ---------------------------------------------------------------------------

export const SHUTTER_RESOLVE_WGSL = /* wgsl */ `fn shutterResolve(
  layerTex: texture_2d<f32>,
  sceneTex: texture_2d<f32>,
  seedTex: texture_2d<f32>,
  depthTex: texture_depth_2d,
  occluderTex: texture_depth_2d,
  texCoord: vec2<f32>,
  cfg: vec4<f32>,
  motion: vec2<f32>,
  seedDims: vec2<f32>,
  cfg2: vec2<f32>
) -> vec4<f32> {
  // cfg: x depth bias metres, y near, z far, w minimum seed weight.
  // motion: x exposure seconds, y unused.
  // cfg2: x occluder enabled (a second, nearer occluder depth), y unused.
  let d = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let outDims = vec2<f32>(textureDimensions(sceneTex, 0));
  let maxP = vec2<i32>(i32(outDims.x) - 1, i32(outDims.y) - 1);
  let pix = clamp(vec2<i32>(floor(d * outDims)), vec2<i32>(0, 0), maxP);
  let scene = textureLoad(sceneTex, pix, 0).rgb;
  let base = textureLoad(layerTex, pix, 0);

  // NEAREST-STYLE OWNERSHIP: keep the STRONGEST of the four neighbouring seed
  // texels instead of bilinearly blending them. A blend would average two
  // opposed stream velocities into a standstill at the crossing seam, exactly
  // what the plan forbids; one owner keeps the stored vector single-valued.
  let sc = d * seedDims - vec2<f32>(0.5);
  let i0 = floor(sc);
  let smax = vec2<i32>(i32(seedDims.x) - 1, i32(seedDims.y) - 1);
  let p00 = clamp(vec2<i32>(i0), vec2<i32>(0, 0), smax);
  let p10 = clamp(vec2<i32>(i0) + vec2<i32>(1, 0), vec2<i32>(0, 0), smax);
  let p01 = clamp(vec2<i32>(i0) + vec2<i32>(0, 1), vec2<i32>(0, 0), smax);
  let p11 = clamp(vec2<i32>(i0) + vec2<i32>(1, 1), vec2<i32>(0, 0), smax);
  var seed = textureLoad(seedTex, p00, 0);
  let s10 = textureLoad(seedTex, p10, 0);
  let s01 = textureLoad(seedTex, p01, 0);
  let s11 = textureLoad(seedTex, p11, 0);
  if (s10.w > seed.w) { seed = s10; }
  if (s01.w > seed.w) { seed = s01; }
  if (s11.w > seed.w) { seed = s11; }

  var cov = base.a;
  var rgb = base.rgb;

  if (seed.w > cfg.w) {
    // The owner's buffer depth -> metric view metres (the surface pass's
    // inverse). Compare against the frozen scene depth at THIS pixel, so a
    // droplet (and its sweep) behind a wall is dropped even though the same
    // emitter is visible somewhere else in frame.
    let ownerZ = (cfg.y * cfg.z) / (cfg.z - seed.z * (cfg.z - cfg.y));
    var occluded = false;
    // MUTUAL OCCLUSION (task 4). The blood pass runs AFTER the gib pass, so a
    // blurred gib lives only in the gib-resolved colour and its own depth — the
    // clean capture's depth does not contain it (the piece was lifted out of
    // the base scene). occluderTex is that gib-layer depth: the NEARER of the
    // two depths is the true first surface, so blood behind a blurred gib is
    // dropped instead of painted over it. cfg2.x = 0 (no gib occluder) keeps
    // the original single-depth behaviour for the lab and for gib-off frames.
    var occlusionClipZ = textureLoad(depthTex, pix, 0);
    if (cfg2.x > 0.5) {
      let occluderZ = textureLoad(occluderTex, pix, 0);
      if (occluderZ < occlusionClipZ) { occlusionClipZ = occluderZ; }
    }
    if (occlusionClipZ < 1.0) {
      let sceneZ = (cfg.y * cfg.z) / (cfg.z - occlusionClipZ * (cfg.z - cfg.y));
      occluded = ownerZ > sceneZ + cfg.x;
    }
    if (occluded) {
      // The resolve OWNS occlusion (the selected layer is not pre-culled), so
      // an occluded destination must DROP the blood rather than fall back to
      // the sharp layer. A translucent streak never writes depth itself.
      cov = 0.0;
      rgb = vec3<f32>(0.0);
    } else {
      // BOUNDED EXPOSURE GATHER. For destination P the exposure average is
      //   (1/E) * integral_0^E L(P + v*t) dt
      // because the selected layer at an earlier time is the CURRENT shaded
      // layer translated backwards along the owner's velocity. Averaging the
      // current layer along that segment fills the whole swept region and
      // gives the interior the right partial coverage, without ever
      // accumulating a density field across times.
      //
      // STRATIFIED JITTER: the tap lands at (i + hash(pix,i)) / N rather than
      // (i + 0.5) / N. The hash is a pure function of the destination pixel and
      // the tap index, so a frame is reproducible; it only breaks the regular
      // phase that made under-sampled streaks read as evenly spaced beads.
      var acc = vec4<f32>(0.0);
      for (var i = 0; i < ${SHUTTER_CANDIDATE_TAPS}; i = i + 1) {
        var h = (u32(pix.x) + u32(i) * 131u) * 374761393u
              + (u32(pix.y) + u32(i) * 977u) * 668265263u;
        h = (h ^ (h >> 13u)) * 1274126177u;
        let jitter = f32(h & 0x00ffffffu) * 5.9604645e-8; // 2^-24
        let t = motion.x * (f32(i) + jitter) / ${SHUTTER_CANDIDATE_TAPS.toFixed(1)};
        let s = d + seed.xy * t;
        let sp = clamp(vec2<i32>(floor(s * outDims)), vec2<i32>(0, 0), maxP);
        acc = acc + textureLoad(layerTex, sp, 0);
      }
      let avg = acc / ${SHUTTER_CANDIDATE_TAPS.toFixed(1)};
      // The exposure average REPLACES the sharp selected layer along the
      // sweep: that is exactly what a shutter does to a moving surface. The
      // static pools/guts and unselected mist live in the SHARP half, so they
      // are not touched here. The seed gate keeps the replacement inside the
      // stamped region and feathers the sweep's cross-section.
      let gate = clamp(seed.w / 0.25, 0.0, 1.0);
      cov = avg.a * gate;
      rgb = avg.rgb * gate;
    }
  }

  return vec4<f32>(scene * (1.0 - cov) + rgb, 1.0);
}`;

export interface ShutterResolveInputs {
  /** Premultiplied selected blood at the current time (working-linear). */
  layerTex: THREE.Texture;
  /** Clean scene without selected blood (working-linear). */
  sceneTex: THREE.Texture;
  /** Clean scene depth (the target's sampleable DepthTexture). */
  depthTex: THREE.DepthTexture;
  /** CPU-built motion seed (display-indexed RGBA float). */
  seedTex: THREE.DataTexture;
  /**
   * OPTIONAL second occluder depth (task 4). The game's blood resolve runs
   * after the gib resolve, and a blurred gib is absent from the clean capture
   * and its depth; passing the gib layer's depth here lets the blood pass drop
   * a droplet that is behind a blurred gib instead of painting it over one.
   * Omitted = single-depth behaviour, unchanged.
   */
  occluderDepthTex?: THREE.DepthTexture;
}

export interface ShutterResolveHandle {
  readonly material: MeshBasicNodeMaterial;
  readonly scene: THREE.Scene;
  readonly taps: number;
  setNearFar(near: number, far: number): void;
  setDepthBias(metres: number): void;
  setMinSeedWeight(w: number): void;
  /** Exposure length in seconds for the bounded gather. */
  setExposure(seconds: number): void;
  setSeedDims(width: number, height: number): void;
  /**
   * Rebind the scene texture this resolve composites over. The game's capture
   * stage chains the gib resolve before the blood resolve, so the blood pass
   * must read the gib-resolved target rather than the raw capture. The texture
   * node is updated in place (the same `src.value = tex` seam post-aa uses for
   * its own stages), so no material is rebuilt per frame.
   */
  setSceneTexture(tex: THREE.Texture): void;
  /**
   * Rebind the OPTIONAL second occluder depth (the blurred-gib layer's own
   * depth). Pass the gib layer's DepthTexture to make the blood resolve drop
   * droplets behind a blurred gib; pass null to restore single-depth
   * behaviour. The node and the enable flag are updated in place, so no
   * material is rebuilt per frame.
   */
  setOccluderDepth(tex: THREE.DepthTexture | null): void;
  /** Render the resolve. `target` null is the canvas. */
  render(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget | null): void;
  dispose(): void;
}

/**
 * Build the single bounded resolve material. Created on demand (the page only
 * constructs it when the candidate is actually in use), and it never allocates
 * per frame.
 */
export function createShutterResolve(
  inputs: ShutterResolveInputs,
  opts: { near?: number; far?: number; depthBias?: number; minSeedWeight?: number } = {},
): ShutterResolveHandle {
  const uCfg = uniform(new THREE.Vector4(
    opts.depthBias ?? DEFAULT_DEPTH_BIAS_M,
    opts.near ?? 0.1,
    opts.far ?? 200,
    opts.minSeedWeight ?? DEFAULT_SEED_MIN_WEIGHT,
  ));
  const uSeedDims = uniform(new THREE.Vector2(1, 1));
  const uMotion = uniform(new THREE.Vector2(0, 0));
  // cfg2.x = occluder enable. Default OFF: a 1x1 depth texture is still bound
  // (WebGPU requires the binding to exist) but never sampled.
  const uCfg2 = uniform(new THREE.Vector2(0, 0));
  const farDepth = new THREE.DepthTexture(1, 1);
  const sceneNode = texture(inputs.sceneTex);
  const occluderNode = texture(inputs.occluderDepthTex ?? farDepth);
  if (inputs.occluderDepthTex) uCfg2.value.set(1, 0);
  const out = wgslFn(SHUTTER_RESOLVE_WGSL)({
    layerTex: texture(inputs.layerTex),
    sceneTex: sceneNode,
    seedTex: texture(inputs.seedTex),
    depthTex: texture(inputs.depthTex),
    occluderTex: occluderNode,
    texCoord: uv(),
    cfg: uCfg,
    motion: uMotion,
    seedDims: uSeedDims,
    cfg2: uCfg2,
  }) as unknown as { xyz: unknown; w: unknown };

  const material = new MeshBasicNodeMaterial();
  material.name = 'shutter:candidate-resolve';
  material.colorNode = vec4(out.xyz as never, 1.0) as never;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  cam.position.z = 1;

  return {
    material,
    scene,
    taps: SHUTTER_CANDIDATE_TAPS,
    setNearFar(near, far) { uCfg.value.set(uCfg.value.x, near, far, uCfg.value.w); },
    setDepthBias(metres) { uCfg.value.set(metres, uCfg.value.y, uCfg.value.z, uCfg.value.w); },
    setMinSeedWeight(w) { uCfg.value.set(uCfg.value.x, uCfg.value.y, uCfg.value.z, w); },
    setExposure(seconds) { uMotion.value.set(Number.isFinite(seconds) && seconds > 0 ? seconds : 0, 0); },
    setSeedDims(width, height) { uSeedDims.value.set(width, height); },
    setSceneTexture(tex) { sceneNode.value = tex; },
    setOccluderDepth(tex) {
      occluderNode.value = tex ?? farDepth;
      uCfg2.value.set(tex ? 1 : 0, 0);
    },
    render(renderer, target) {
      const outW = target ? target.width : renderer.domElement.width;
      const outH = target ? target.height : renderer.domElement.height;
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, outW, outH);
      void renderer.render(scene, cam);
      renderer.autoClear = prevAutoClear;
    },
    dispose() {
      quad.geometry.dispose();
      material.dispose();
      farDepth.dispose();
    },
  };
}
