// src/lab/sdf-zombie/webgpu/gib-motion-blur.ts
//
// FLYING-GIB SHUTTER BLUR — THE PURE HALF (2026-09-17, shutter game task 3).
//
// The blood integration (shutter-game-layer.ts) blurs each SELECTED droplet
// along ONE screen-space vector, because a droplet is a point. A gib is a RIGID
// BODY: translation alone is not enough, and a spinning piece whose centre is
// fixed must still blur at its edges. This module turns a `Chunk` — the exact
// physics state `stepChunk` integrates and the renderers pose from — into a
// bounded set of per-surface motion stamps the shared seed rasterizer can use.
//
// THE MAPPING IS THE CONTRACT. Every probe is a LOCAL point of the piece
// transformed by the SAME `chunkPoint` the marched and mesh renderers use, at
// the CURRENT and at a PRIOR rigid state derived from the piece's own
// velocity/angular velocity over a FIXED exposure. `now` and `prior` therefore
// refer to the same material/surface point; nothing is paired across unrelated
// primitive or vertex slots, and the renderer's squash is carried.
//
//   * Translation: every probe moves with `pos`.
//   * Rotation:    probes away from the centre get a tangential component
//                  (`omega x r`), so a fixed-centre spin blurs at its edges.
//   * Squash:      `squashFactors` is applied at both ends.
//
// Timing is a FIXED shutter interval in seconds. Nothing here reads frame
// delta, presented FPS, or wall clock, so 30/60/120 Hz all integrate the same
// exposure. History is rebuilt each frame from the live state, so a recycled
// pool slot cannot inherit a stale prior frame; the only history-dependent
// clamp is the piece AGE (a newborn cannot be exposed before it was born).
//
// No three import: this is the testable heart and it is shared by the page.

import { CHUNK_TUNING, chunkPoint, chunkSettled, squashFactors, type Chunk } from '../gib-chunks';
import { len, qFromAxisAngle, qMul, qNormalize, scale, type Quat } from '../vec';
import type { Vec3 } from '../types';
import {
  projectWorldRadiusToPixels, viewToClipDepth,
  type ShutterProjection, type SweepStamp,
} from './shutter-blur';
import { projectWorldToPixel } from './shutter-reference';

// ---------------------------------------------------------------------------
// Bounds. Every value is a hard cap: the seed never grows work on a hitch.
// ---------------------------------------------------------------------------

/** The THREE layer selected moving gibs are isolated on while blurred. Busy
 *  bits are 1..9 (sdf-layer), so 10 is the first free one. Gibs on this layer
 *  are invisible to the ordinary pass (the camera enables only layer 0 by
 *  default) and are drawn into the blur layer by the capture stage alone. */
export const GIB_BLUR_LAYER = 10;
/** Most pieces that may be blurred in one frame. A full-body gib is 19–20, a
 *  point-blank bundle into a crowd can be several bodies; 64 is the marched
 *  pool's own ceiling and keeps the seed/single-layer cost bounded. */
export const GIB_BLUR_MAX_PIECES = 64;
/** Below these the piece is treated as stationary and stays SHARP. This is the
 *  settle boundary made generous: a piece still sliding or spinning keeps its
 *  blur until it truly stops, and a millimetre-creep piece never pays for a
 *  layer it does not need. */
export const GIB_BLUR_MIN_SPEED_MPS = 0.12;
export const GIB_BLUR_MIN_ANGVEL_RADPS = 0.5;
/** Probe cross-section as a fraction of the piece's projected radius when the
 *  piece is ROTATING. Below 1 so centre and edge probes are distinguishable
 *  (ownership can pick the right velocity) while their union still covers the
 *  silhouette. A non-rotating piece uses one full-radius centre probe. */
export const GIB_BLUR_ROTATING_PROBE_SCALE = 0.62;
/** Hard cap on probes per piece (support ends + the six local axes). */
export const GIB_BLUR_MAX_PROBES = 9;
/** No stamp is worth drawing below this many output pixels of motion — the
 *  layer's `base` already draws the sharp current shape. */
export const GIB_BLUR_MIN_STREAK_PX = 0.5;

// ---------------------------------------------------------------------------
// Settings: gibs SHARE the blood exposure and max-trail controls (one slider
// drives both layers) and add only their own on/off switch.
// ---------------------------------------------------------------------------

export interface GibShutterSettings {
  enabled: boolean;
  exposureSeconds: number;
  maxStreakPx: number;
  seedScale: number;
  depthBiasM: number;
}

/** The gib switch ships ON on the feature branch; exposure/streak/seed/bias
 *  come from the SAME accepted blood contract (`shutter-game-layer`). */
export const GIB_SHUTTER_DEFAULT_ENABLED = true;

/**
 * Parse the gib query flags. `?gibblur=0|off` is the only gib-specific flag;
 * `?blurms`, `?blurmax`, `?blurseed` and `?blurbias` are the shared blood
 * controls and apply to both layers. Keeping the parsing here would duplicate
 * the blood clamps, so the caller passes the blood-parsed settings in and this
 * only interprets the gib switch; the helper below does both in one place.
 */
export function readGibShutterEnabled(search: string): boolean {
  const raw = new URLSearchParams(search).get('gibblur');
  if (raw === null) return GIB_SHUTTER_DEFAULT_ENABLED;
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'on' || v === 'true' || v === 'yes') return true;
  return GIB_SHUTTER_DEFAULT_ENABLED;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function gibLinearSpeed(state: Chunk): number {
  return Math.hypot(state.vel[0], state.vel[1], state.vel[2]);
}

export function gibAngularSpeed(state: Chunk): number {
  return Math.hypot(state.angVel[0], state.angVel[1], state.angVel[2]);
}

/**
 * TRUE when a flying piece should be blurred THIS frame.
 *
 * Settled pieces are excluded by the integrator's own predicate — a piece that
 * `chunkSettled` accepts has already stopped and will never move again, so it
 * must return to the sharp/baked path. Everything else is selected on motion:
 * EITHER linear speed OR angular speed above the threshold, which is what makes
 * a pure spin (fixed centre) blur.
 */
export function isGibSelectedForBlur(
  state: Chunk,
  opts: { minSpeed?: number; minAngVel?: number } = {},
): boolean {
  if (!Number.isFinite(state.pos[0]) || !Number.isFinite(state.vel[0])) return false;
  if (chunkSettled(state)) return false;
  const minSpeed = opts.minSpeed ?? GIB_BLUR_MIN_SPEED_MPS;
  const minAngVel = opts.minAngVel ?? GIB_BLUR_MIN_ANGVEL_RADPS;
  return gibLinearSpeed(state) >= minSpeed || gibAngularSpeed(state) >= minAngVel;
}

// ---------------------------------------------------------------------------
// Prior rigid state — the exposure integration
// ---------------------------------------------------------------------------

function qDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function qNegate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], -q[3]];
}

/**
 * The piece's rigid state `exposureSeconds` BEFORE now, from its own current
 * velocity and angular velocity. Linear position is exact for a sub-frame
 * interval (gravity's contribution over <= 200 ms is bounded and harmless for
 * a shutter streak); rotation is the same exponential-map step `stepChunk`
 * integrates, run backwards:
 *
 *   quat_prior = axisAngle(-w * E) * quat_now
 *
 * The result is sign-normalised into the same hemisphere as `quat_now`
 * (shortest arc), so a caller that interpolates or compares quaternions can
 * never take the long way round.
 */
export function gibPriorState(state: Chunk, exposureSeconds: number): Chunk {
  const e = Number.isFinite(exposureSeconds) && exposureSeconds > 0 ? exposureSeconds : 0;
  if (!(e > 0)) return state;
  const pos: Vec3 = [
    state.pos[0] - state.vel[0] * e,
    state.pos[1] - state.vel[1] * e,
    state.pos[2] - state.vel[2] * e,
  ];
  let quat: Quat = [state.quat[0], state.quat[1], state.quat[2], state.quat[3]];
  const w = len(state.angVel);
  if (w > 1e-6) {
    const axis = scale(state.angVel, 1 / w);
    const step = qFromAxisAngle(axis, -w * e);
    quat = qNormalize(qMul(step, quat));
    if (qDot(quat, state.quat) < 0) quat = qNegate(quat);
  }
  // Squash relaxes toward zero at a fixed rate; clamp at the same floor the
  // integrator uses so a prior shape is never more squashed than physics allows.
  const squash = Math.max(0, state.squash - CHUNK_TUNING.squashRelax * e);
  return { ...state, pos, quat, squash };
}

/**
 * Bounded rigid EXPOSURE SAMPLES from now back to now-exposure, oldest-last.
 * The renderer does not consume these directly (it uses the per-surface seed),
 * but they are the pure, testable statement of the motion: sample `i` sits at
 * `-E * i/(N-1)`. They make a fixed-centre spin verifiable by inspection.
 */
export function gibExposureSampleStates(
  state: Chunk, exposureSeconds: number, samples: number,
): Chunk[] {
  const n = Math.max(2, Math.min(64, Math.round(samples)));
  const e = Number.isFinite(exposureSeconds) && exposureSeconds > 0 ? exposureSeconds : 0;
  const out: Chunk[] = [];
  for (let i = 0; i < n; i++) {
    out.push(gibPriorState(state, e * (i / (n - 1))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Probes — local surface points whose motion spans the rigid field
// ---------------------------------------------------------------------------

function localDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Local probe points for a piece. The piece's OWN support spheres come first
 * (a capsule contributes its two ends, so a tumbling limb's ends get their own
 * velocity); when the support shape is a single sphere the six local axes are
 * added so the tangential motion of a spin is represented. Deduplicated and
 * capped, so the seed cost is bounded and probe pairing is stable.
 */
export function gibProbeLocals(state: Chunk, maxProbes = GIB_BLUR_MAX_PROBES): Vec3[] {
  const out: Vec3[] = [];
  const r = Math.max(1e-4, state.radius);
  const push = (p: Vec3): void => {
    if (out.length >= maxProbes) return;
    for (const q of out) if (localDistance(q, p) < r * 0.08) return;
    out.push([p[0], p[1], p[2]]);
  };
  for (const s of state.support) push(s.c);
  const axes: Vec3[] = [
    [r, 0, 0], [-r, 0, 0],
    [0, r, 0], [0, -r, 0],
    [0, 0, r], [0, 0, -r],
  ];
  for (const a of axes) push(a);
  return out;
}

function viewDepthOf(world: Vec3, proj: ShutterProjection): number {
  const vm = proj.viewMatrix;
  return -(vm[2]! * world[0] + vm[6]! * world[1] + vm[10]! * world[2] + vm[14]!);
}

export interface GibStampOpts {
  /** Hard cap on the drawn streak in output pixels (shared with blood). */
  maxStreakPx: number;
  /** The piece's age in seconds, if known. Clamps the exposure so a newborn
   *  never draws a streak into its own emitter. */
  ageSeconds?: number;
  /** Force the full-rotation probe set even for a slow spin (tests). */
  forceProbes?: boolean;
  /** Minimum output-pixel streak below which no stamp is emitted. */
  minStreakPx?: number;
}

/**
 * Plan the bounded per-surface motion stamps for ONE piece: one stamp per
 * probe, each carrying that probe's own screen velocity and the piece's centre
 * depth. The shared `rasterizeSweepSeed` owns texel ownership (strongest
 * weight, nearest depth on a tie), so probes of one piece never average into a
 * standstill and probes of different pieces stay separate streams.
 *
 * Returns [] when the motion is unusable (behind the eye, non-finite, younger
 * than a frame, or below the streak floor). The caller then clears the seed and
 * the resolve composites the sharp current shape through the layer's base, so a
 * selected piece is never lost.
 */
export function planGibMotionStamps(
  state: Chunk,
  streamId: number,
  proj: ShutterProjection,
  exposureSeconds: number,
  opts: GibStampOpts,
): SweepStamp[] {
  if (!(exposureSeconds > 0) || !Number.isFinite(exposureSeconds)) return [];
  if (!Number.isFinite(state.pos[0]) || !Number.isFinite(state.quat[3])) return [];

  // AGE CLAMP: never expose a piece before it was born. `Infinity` means
  // "presented before, so fully exposed"; only a finite age clamps, and a NaN
  // (unknown) is treated as newborn rather than silently full.
  let exposure = exposureSeconds;
  if (opts.ageSeconds !== undefined) {
    const raw = opts.ageSeconds;
    const age = Number.isFinite(raw) ? Math.max(0, raw)
      : Number.isNaN(raw) ? 0 : Number.POSITIVE_INFINITY;
    exposure = Math.min(exposure, age);
  }
  if (!(exposure > 0)) return [];

  const prior = gibPriorState(state, exposure);
  const nowScale = squashFactors(state);
  const priorScale = squashFactors(prior);
  const rotating = opts.forceProbes === true || gibAngularSpeed(state) >= GIB_BLUR_MIN_ANGVEL_RADPS;
  const locals = rotating ? gibProbeLocals(state) : [[0, 0, 0] as Vec3];
  const probeScale = rotating ? GIB_BLUR_ROTATING_PROBE_SCALE : 1;
  const minStreak = opts.minStreakPx ?? GIB_BLUR_MIN_STREAK_PX;

  const stamps: SweepStamp[] = [];
  for (const local of locals) {
    const wNow = chunkPoint(state, local, nowScale.sx, nowScale.sy, nowScale.sz);
    const wPrior = chunkPoint(prior, local, priorScale.sx, priorScale.sy, priorScale.sz);
    const depth = viewDepthOf(wNow, proj);
    if (!Number.isFinite(depth) || depth <= proj.near * 0.5) continue;
    const now = projectWorldToPixel(wNow, proj.viewProj, proj.width, proj.height);
    const start = projectWorldToPixel(wPrior, proj.viewProj, proj.width, proj.height);
    if (!now || !start) continue;

    let fromX = start[0];
    let fromY = start[1];
    const toX = now[0];
    const toY = now[1];
    let streak = Math.hypot(toX - fromX, toY - fromY);
    if (!Number.isFinite(streak)) continue;
    if (streak < minStreak) continue;
    if (streak > opts.maxStreakPx && streak > 1e-6) {
      const k = opts.maxStreakPx / streak;
      fromX = toX - (toX - fromX) * k;
      fromY = toY - (toY - fromY) * k;
      streak = opts.maxStreakPx;
    }

    const pieceRadiusPx = projectWorldRadiusToPixels(state.radius, depth, proj.tanHalfFovY, proj.height);
    let radiusPx = pieceRadiusPx * probeScale;
    if (!Number.isFinite(radiusPx)) radiusPx = 0;
    radiusPx = Math.max(0.5, Math.min(64, radiusPx));

    stamps.push({
      stream: streamId,
      ownerX: toX,
      ownerY: toY,
      ownerU: toX / proj.width,
      ownerV: toY / proj.height,
      ownerViewDepth: depth,
      ownerClipZ: viewToClipDepth(depth, proj.near, proj.far),
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
    });
  }
  return stamps;
}
