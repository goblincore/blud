// src/lab/sdf-zombie/webgpu/impact-splash.ts
//
// IMPACT SPLASH — an original procedural crown/web burst at a wound impact
// (reference-directed slug impact splash, 2026-09-13; geometry + material
// redesign after the parent's first WebGPU review, see
// docs/dev-notes/2026-09-13-impact-splash.md).
//
// WHY THIS EXISTS BESIDE THE SLUG GOUT. The shipped slug impact is a dense,
// nearly stationary pulse (IMPACT_GOUT.slug) that reads as a collapsing blob.
// The owner rejected that as "a blob that drops" and the earlier 8 m/s pulse
// as "needles". The reference (a blood Niagara breakdown) is a different
// SHAPE: a violent outward crown of connected torn sheets, webbed holes and
// many slender fingers that loses continuity into fine trailing droplets. This
// module adds that shape as a SUPPLEMENTARY, INDEPENDENTLY SELECTABLE effect.
// It does not touch IMPACT_GOUT, WOUND_BLEED, stepBlood, `spawnImpactGout` or
// any shared global — the existing slug remains the "Current" scenario.
//
// WHAT THE FIRST REVIEW REJECTED (and what changed here)
//   * "4-7 enormous angular pointed petals with large empty gaps" -> the crown
//     is no longer a handful of isolated azimuthal lobes. It is 3 CONTINUOUS
//     2*pi swept shells (no azimuthal seam, no gap between lobes) whose rims
//     carry many narrow finger peaks and deep notches; the shells overlap in
//     radius and height so they read as layered sheets, not a petal fan.
//   * "foil / shattered glass, planar metallic facets" -> a dense angular grid
//     (128 x 12) with smooth analytic normals from central differences on the
//     actual swept surface (including the world sag), plus a per-vertex radial
//     tangent so the fragment stage can add small-scale normal variation.
//   * "pale gray/pink broad highlights" -> the diffuse red is the dominant
//     term; specular is reduced ~4x and broken up by a material-space gloss
//     noise, and the fresnel rim is ~5x weaker. No flat emissive red: the
//     surface still shades through ndl.
//   * "tear pattern coarse, almost no holes at .30" -> the coarse
//     floor(uv*7x5) cell hash is gone. Holes come from a 3-octave periodic
//     Perlin field evaluated in (radial, angle) MATERIAL space (embedded on a
//     circle so it wraps seamlessly), thresholded by a monotonic dissolve
//     ramp. Holes are present through the crown window and grow continuously,
//     so the topology stays recognizable frame to frame.
//   * "handful of giant lobes, few droplets" -> 60-140 small droplets per
//     event, born across the tear window and stretched along their launch
//     direction, so the rim trails fine fragments/spray.
//
// COORDINATE CONTRACT. An event carries an explicit `origin`, an OUTWARD
// `direction` (the wound normal, i.e. the hemisphere the blood leaves the body
// into), a deterministic integer `seed`, a mutable `time` and a bounded
// `lifetime`. The basis is `basisFromAxis(direction)` (w = direction), so a
// floor impact with an upward normal sprays up while a wall/body impact sprays
// out of the wall — the effect is NOT hard-coded to world-up.
//
// GRAVITY CONTRACT. Gravity is a world-space -Y displacement applied AFTER the
// local crown is built, and it eases in only after the expansion window
// (`droopStartSec`): the crown rides out first, then sags and curls.
//
// ALPHA CONTRACT (validated against the installed three r185 source, not just
// the maths). The sheet material is an OPAQUE alpha-tested cutout:
// `transparent=false`, `alphaTest=0.5`, `depthWrite=true`. In
// `three/src/materials/nodes/NodeMaterial.js` `setupDiffuseColor()` builds
// `diffuseColor.a` from `colorNode.a * opacityNode`, runs the alpha-test
// `discard()` on that value, and only THEN, for an opaque material
// (`NodeBuilder.isOpaque()`: `transparent===false && blending===NormalBlending
// && alphaToCoverage===false`), forces `diffuseColor.a = 1.0`. The discard is
// therefore already applied to the real computed alpha; the later force only
// affects the (unused) blend alpha. The alpha is supplied through the
// EXPLICIT `opacityNode` (not only packed into `colorNode`) so there is a
// single, documented multiplication. `colorNode` is `vec4(rgb, 1.0)`, so no
// alpha is smuggled through a channel three might reinterpret.
//
// BUDGET. `IMPACT_SPLASH_MAX_SHELLS` x `(radialSegments+1) *
// (angularSegments+1)` vertices per event and `IMPACT_SPLASH_MAX_DROPLETS`
// instance slots. The layer preallocates those worst cases and only ever
// reduces the drawn range, so a long-lived page cannot grow the geometry.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute, cameraPosition, clamp, cos, dot, faceDirection, float, max,
  mix, mx_noise_float, normalize, normalWorld, positionWorld, pow, sin,
  smoothstep, uniform, vec3, vec4,
} from 'three/tsl';
import { basisFromAxis } from '../vec';
import type { Vec3 } from '../types';

/** Hard structural caps. Exported so callers can size their own buffers and
 *  tests can pin the budget without re-deriving the grid. */
export const IMPACT_SPLASH_MAX_SHELLS = 3;
export const IMPACT_SPLASH_MAX_DROPLETS = 160;
/** Hard cap on simultaneously live events the shared layer will pose. Extra
 *  emissions past this are dropped rather than queued (a wound burst is a
 *  sub-second event; a queue would outlive it). */
export const IMPACT_SPLASH_MAX_EVENTS = 8;
/** Floats per detached droplet: x, y, z, size, vx, vy, vz. The velocity lets
 *  the layer stretch each instance along its flight so late droplets read as
 *  fine fragments rather than beads. */
export const IMPACT_SPLASH_DROPLET_STRIDE = 7;

export interface ImpactSplashTuning {
  /** Bounded lifetime, seconds. The frame is null at/after this. */
  lifetimeSec: number;
  /** Rapid-expansion window: radius/rise reach their cap roughly here. */
  expandSec: number;
  /** Droplet birth window; the sheet's own dissolve window is the exported
   *  `IMPACT_SPLASH_DISSOLVE_POINTS` progress ramp. */
  tearStartSec: number;
  tearEndSec: number;
  /** Crown radius cap, metres (before the shell/irregularity multipliers). */
  radiusMax: number;
  /** Crown lip height above the impact plane, metres. */
  riseMax: number;
  /** World-space -Y sag begins after this many seconds. */
  droopStartSec: number;
  /** Sag gain: m of drop per (second past droopStart)^2, applied to the rim. */
  gravityGain: number;
  /** Curl-back toward the axis: metres of local -w per (second past droop)^2. */
  curlGain: number;
  /** Number of overlapping swept shells (bounded by IMPACT_SPLASH_MAX_SHELLS). */
  shells: number;
  /** Parametric grid resolution, shared by every shell. */
  radialSegments: number;
  angularSegments: number;
  /** Per-shell multipliers (index 0 is the outer shell). */
  shellRadiusScale: readonly number[];
  shellRiseScale: readonly number[];
  shellAngleOffset: readonly number[];
  shellAxialOffset: readonly number[];
  /** Smooth low-frequency rim harmonics (irregular, not a circle). */
  radialNoiseHarmonics: number;
  heightNoiseHarmonics: number;
  /** How much the smooth harmonics move the rim radius / height. */
  radiusNoiseAmp: number;
  heightNoiseAmp: number;
  /** Floor of the rim-height multiplier: deep notches between fingers. */
  heightFloor: number;
  /** Narrow finger count rolled per shell (radius fingers and height fingers
   *  are independent, so tips do not coincide with rim bulges). */
  fingerCountMin: number;
  fingerCountMax: number;
  fingerSigmaMin: number;
  fingerSigmaMax: number;
  /** Finger amplitude on the rim radius / height. */
  fingerRadiusAmp: number;
  fingerHeightAmp: number;
  /** Radial coordinate of the sheet foot as a fraction of the rim radius. */
  footRadiusFrac: number;
  /** Per-angle exponent bands for the radial and height profiles. A larger
   *  radial exponent keeps a finger slender until it flares at the tip. */
  radialPowMin: number;
  radialPowMax: number;
  heightPowMin: number;
  heightPowMax: number;
  /** Detached droplets rolled per event (bounded by MAX_DROPLETS). */
  dropletsMin: number;
  dropletsMax: number;
  dropletBirthStartSec: number;
  dropletBirthEndSec: number;
  dropletSpeedMin: number;
  dropletSpeedMax: number;
  dropletUpMin: number;
  dropletUpMax: number;
  dropletGravity: number;
  dropletSizeMin: number;
  dropletSizeMax: number;
  /** Long-axis stretch of a droplet instance along its velocity. */
  dropletStretch: number;
}

/** The shipped artistic timings and small-scale budgets. */
export const IMPACT_SPLASH_TUNING: ImpactSplashTuning = {
  lifetimeSec: 1.15,
  expandSec: 0.26,
  tearStartSec: 0.16,
  tearEndSec: 0.95,
  radiusMax: 0.42,
  riseMax: 0.40,
  droopStartSec: 0.30,
  gravityGain: 0.55,
  curlGain: 0.50,
  shells: IMPACT_SPLASH_MAX_SHELLS,
  radialSegments: 12,
  angularSegments: 192,
  shellRadiusScale: [1.0, 0.78, 0.55],
  shellRiseScale: [0.92, 1.14, 0.72],
  shellAngleOffset: [0.0, 1.9, 3.7],
  shellAxialOffset: [0.0, 0.03, -0.02],
  radialNoiseHarmonics: 6,
  heightNoiseHarmonics: 5,
  radiusNoiseAmp: 0.18,
  heightNoiseAmp: 0.24,
  heightFloor: 0.30,
  fingerCountMin: 10,
  fingerCountMax: 20,
  fingerSigmaMin: 0.060,
  fingerSigmaMax: 0.150,
  fingerRadiusAmp: 0.47,
  fingerHeightAmp: 0.85,
  footRadiusFrac: 0.16,
  radialPowMin: 0.60,
  radialPowMax: 1.50,
  heightPowMin: 0.55,
  heightPowMax: 1.15,
  dropletsMin: 60,
  dropletsMax: 140,
  dropletBirthStartSec: 0.16,
  dropletBirthEndSec: 0.98,
  dropletSpeedMin: 0.8,
  dropletSpeedMax: 3.4,
  dropletUpMin: 0.3,
  dropletUpMax: 1.6,
  dropletGravity: 9.8,
  dropletSizeMin: 0.005,
  dropletSizeMax: 0.018,
  dropletStretch: 2.4,
};

/**
 * One impact event. `direction` is the OUTWARD surface normal at the wound
 * (the side the blood leaves); it is normalised when the frame is built, so
 * callers may hand in an unnormalised direction. `time` is advanced by
 * `stepImpactSplashEvent`, never read from the wall clock, so hand-stepped
 * captures and CPU tests are deterministic.
 */
export interface ImpactSplashEvent {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly seed: number;
  readonly lifetime: number;
  time: number;
}

/** A built frame: world-space geometry plus the detached droplets. Pure
 *  arrays, safe to discard; nothing here is retained between builds. */
export interface ImpactSplashFrame {
  positions: Float32Array;
  normals: Float32Array;
  /** Unit radial tangent (dP/ds) per vertex, for material-space micro-normal
   *  variation in the fragment shader. */
  tangents: Float32Array;
  /** Material-space UV per vertex: x = radial 0..1 (root -> rim),
   *  y = angle/2pi 0..1. The tear noise keys off this, never world space. */
  uvs: Float32Array;
  /** Per-vertex [0,1] wetness mask, a smooth function of (shell, angle). */
  masks: Float32Array;
  /** Per-vertex shell seed in [0,1) — the material cells differ per shell. */
  shellSeeds: Float32Array;
  indices: Uint32Array;
  /** xyz + size + vx,vy,vz per detached droplet (IMPACT_SPLASH_DROPLET_STRIDE
   *  floats each). */
  droplets: Float32Array;
  dropletCount: number;
  vertexCount: number;
  triangleCount: number;
  /** 0..1 lifetime progress. */
  progress: number;
  /** 0..1 monotonic dissolve ramp fed to the material (per event). */
  dissolve: number;
  /** Unit basis actually used (w = normalised outward direction). */
  basis: { u: Vec3; v: Vec3; w: Vec3 };
}

// -------------------------------------------------------------------------
// Deterministic hashing (NO Math.random in this module)
// -------------------------------------------------------------------------

/** Stable 32-bit hash of (seed, draw index) in [0,1). A pure function of its
 *  inputs: the same seed reproduces the same crown on every machine and every
 *  build, and nothing accumulates hidden RNG state between frames. */
export function splashHash01(seed: number, i: number): number {
  let h = (seed | 0) ^ Math.imul(i | 0, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth01(t: number): number { const c = clamp01(t); return c * c * (3 - 2 * c); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
const TAU = Math.PI * 2;

/** Wrapped angular distance in [-pi, pi]. */
function wrapAngle(d: number): number {
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** Smooth periodic noise in [-1,1]: a seeded sum of low harmonics. Used for
 *  the irregular-but-continuous rim, so the crown is neither a circle nor a
 *  set of independent lobes. Exported for the continuity tests. */
export function splashRimNoise(seed: number, harmonics: number, theta: number): number {
  let v = 0;
  let norm = 0;
  const k = Math.max(1, Math.round(harmonics));
  for (let i = 1; i <= k; i++) {
    const a = 0.35 + 0.65 * splashHash01(seed, i * 13 + 1);
    const ph = splashHash01(seed, i * 29 + 2) * TAU;
    v += a * Math.sin(i * theta + ph);
    norm += a;
  }
  return norm > 0 ? v / norm : 0;
}

/** Narrow positive finger bumps (sum of wrapped Gaussians), in [0, ~1.3]. */
function splashFingerField(
  seed: number, count: number, sigmaMin: number, sigmaMax: number, theta: number,
): number {
  let v = 0;
  const n = Math.max(1, Math.round(count));
  for (let f = 0; f < n; f++) {
    const th = splashHash01(seed, f * 7 + 3) * TAU;
    const sig = lerp(sigmaMin, sigmaMax, splashHash01(seed, f * 11 + 5));
    const amp = 0.35 + 0.65 * splashHash01(seed, f * 5 + 7);
    const d = wrapAngle(theta - th) / Math.max(1e-4, sig);
    v += amp * Math.exp(-0.5 * d * d);
  }
  return v;
}

/** Normalised outward axis, degeneracy-guarded to straight up. Exported for
 *  the direction-transform tests. */
export function impactSplashBasis(direction: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const l = Math.hypot(direction[0], direction[1], direction[2]);
  const safe: Vec3 = l < 1e-9 ? [0, 1, 0] : [direction[0] / l, direction[1] / l, direction[2] / l];
  return basisFromAxis(safe);
}

export interface ImpactSplashEventOptions {
  /** Override the bounded lifetime (seconds). Clamped to a positive value;
   *  a non-finite/<=0 value falls back to the tuning default. */
  lifetime?: number;
}

export function createImpactSplashEvent(
  origin: Vec3, direction: Vec3, seed: number, options: ImpactSplashEventOptions = {},
): ImpactSplashEvent {
  const requested = options.lifetime;
  const lifetime = (typeof requested === 'number' && Number.isFinite(requested) && requested > 0)
    ? requested
    : IMPACT_SPLASH_TUNING.lifetimeSec;
  return { origin, direction, seed: seed | 0, lifetime, time: 0 };
}

/** Advance one event; returns false once it is at/over its lifetime (the
 *  caller should then drop it, which is the only cleanup path). `dt` is
 *  clamped to the remaining life so a huge step can never overshoot the
 *  bound; the event itself owns `time`, so hand-stepped captures stay exact. */
export function stepImpactSplashEvent(ev: ImpactSplashEvent, dt: number): boolean {
  if (!(ev.lifetime > 0)) return false;
  if (dt > 0) ev.time = Math.min(ev.lifetime, ev.time + dt);
  return ev.time < ev.lifetime;
}

interface Shell {
  radiusScale: number;
  riseScale: number;
  angleOffset: number;
  axialOffset: number;
  radiusSeed: number;
  heightSeed: number;
  radiusFingerSeed: number;
  heightFingerSeed: number;
  maskSeed: number;
  fingerCountR: number;
  fingerCountH: number;
  seed: number;
}

/** Deterministic shell count inside [1, IMPACT_SPLASH_MAX_SHELLS]. Exported so
 *  tests can pin the "several overlapping shells" contract. */
export function impactSplashShellCount(tuning: ImpactSplashTuning = IMPACT_SPLASH_TUNING): number {
  return Math.max(1, Math.min(IMPACT_SPLASH_MAX_SHELLS, Math.round(tuning.shells)));
}

/** Deterministic shell layout: unequal radius/height/phase per shell, so the
 *  layered sheets never line up into a regular onion. Pure in (seed, tuning). */
function buildShells(seed: number, tuning: ImpactSplashTuning): Shell[] {
  const count = impactSplashShellCount(tuning);
  const pick = (arr: readonly number[], i: number, fallback: number): number =>
    (Array.isArray(arr) && i < arr.length && Number.isFinite(arr[i])) ? arr[i]! : fallback;
  const shells: Shell[] = [];
  for (let i = 0; i < count; i++) {
    shells.push({
      radiusScale: pick(tuning.shellRadiusScale, i, 1 - i * 0.22),
      riseScale: pick(tuning.shellRiseScale, i, 1.0),
      angleOffset: pick(tuning.shellAngleOffset, i, i * 1.9),
      axialOffset: pick(tuning.shellAxialOffset, i, 0),
      radiusSeed: (seed ^ (0x9e37 + i * 101)) | 0,
      heightSeed: (seed ^ (0x85eb + i * 211)) | 0,
      radiusFingerSeed: (seed ^ (0xc2b2 + i * 307)) | 0,
      heightFingerSeed: (seed ^ (0x27d4 + i * 401)) | 0,
      maskSeed: (seed ^ (0x1656 + i * 503)) | 0,
      fingerCountR: Math.round(lerp(
        tuning.fingerCountMin, tuning.fingerCountMax, splashHash01(seed, 11 + i * 3),
      )),
      fingerCountH: Math.round(lerp(
        tuning.fingerCountMin, tuning.fingerCountMax, splashHash01(seed, 13 + i * 3),
      )),
      seed: splashHash01(seed, 17 + i * 3),
    });
  }
  return shells;
}

/**
 * Monotonic dissolve control points [progress, dissolve]. The ramp is deliberately
 * BACK-LOADED: the reference keeps a connected, mostly solid mass through the
 * crown window and only then loses continuity into fragments. Each segment is
 * a smoothstep, so the threshold that carves the material-space holes moves
 * continuously and the topology stays recognizable frame to frame.
 *
 * The points were chosen so the resulting hole fraction (measured on the CPU
 * against the same field maths, see docs/dev-notes/2026-09-13-impact-splash.md)
 * tracks the reference contact sheet: ~15% at the crown moment, ~45% at
 * mid-tear, ~80% by 0.8 s and gone by the end.
 */
export const IMPACT_SPLASH_DISSOLVE_POINTS: readonly (readonly [number, number])[] = [
  [0.12, 0.00], [0.26, 0.12], [0.39, 0.20], [0.52, 0.34],
  [0.70, 0.58], [0.87, 0.95], [1.00, 1.00],
];

/** Smooth, monotonic dissolve ramp for a normalized lifetime progress. */
export function impactSplashDissolveAt(progress: number): number {
  const p = clamp01(progress);
  const pts = IMPACT_SPLASH_DISSOLVE_POINTS;
  if (p <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!; const p1 = pts[i]!;
    if (p <= p1[0]) {
      const u = clamp01((p - p0[0]) / Math.max(1e-6, p1[0] - p0[0]));
      return p0[1] + (p1[1] - p0[1]) * smooth01(u);
    }
  }
  return pts[pts.length - 1]![1];
}

/** Time-dependent crown scales, all pure functions of elapsed time. */
function crownScales(t: number, tuning: ImpactSplashTuning): {
  radius: number; rise: number; curl: number; gravity: number; progress: number; dissolve: number;
} {
  const te = clamp01(t / Math.max(1e-6, tuning.expandSec));
  // Ease-out cubic: fast at first, slowing into the cap.
  const expand = 1 - Math.pow(1 - te, 3);
  const radius = tuning.radiusMax * (0.06 + 0.94 * expand);
  const rise = tuning.riseMax * (1 - Math.pow(1 - te, 2));
  const afterDroop = Math.max(0, t - tuning.droopStartSec);
  const curl = tuning.curlGain * afterDroop * afterDroop;
  const gravity = tuning.gravityGain * afterDroop * afterDroop;
  const progress = clamp01(t / Math.max(1e-6, tuning.lifetimeSec));
  const dissolve = impactSplashDissolveAt(progress);
  return { radius, rise, curl, gravity, progress, dissolve };
}

/**
 * The angular profile of a shell at a fixed angle: everything that does NOT
 * depend on the radial coordinate. Precomputed once per angular sample per
 * frame, so the finite-difference normals reuse it instead of re-evaluating
 * the finger fields five times per vertex.
 */
interface RimProfile {
  rMul: number;
  hMul: number;
  p: number;
  q: number;
  mask: number;
}

/** Angular profile of `shell` at absolute angle `theta`. */
function shellProfile(shell: Shell, theta: number, tuning: ImpactSplashTuning): RimProfile {
  const lowR = splashRimNoise(shell.radiusSeed, tuning.radialNoiseHarmonics, theta);
  const lowH = splashRimNoise(shell.heightSeed, tuning.heightNoiseHarmonics, theta);
  const fR = splashFingerField(
    shell.radiusFingerSeed, shell.fingerCountR, tuning.fingerSigmaMin, tuning.fingerSigmaMax, theta,
  );
  const fH = splashFingerField(
    shell.heightFingerSeed, shell.fingerCountH, tuning.fingerSigmaMin, tuning.fingerSigmaMax, theta,
  );
  // Continuity: both multipliers are strictly positive and periodic in theta,
  // so every shell is one closed swept sheet. The finger term only pushes the
  // rim out/up; it never detaches a lobe.
  const rMul = 0.70 + tuning.radiusNoiseAmp * lowR
    + tuning.fingerRadiusAmp * Math.min(fR, 1.0);
  const hMul = tuning.heightFloor + tuning.heightNoiseAmp * lowH
    + tuning.fingerHeightAmp * Math.min(fH, 1.0);
  const p = lerp(tuning.radialPowMin, tuning.radialPowMax, clamp01(0.5 + 0.5 * lowR));
  const q = lerp(tuning.heightPowMin, tuning.heightPowMax, clamp01(0.5 + 0.5 * lowH));
  const wetN = splashRimNoise(shell.maskSeed, 4, theta);
  return { rMul, hMul, p, q, mask: clamp01(0.48 + 0.42 * wetN) };
}

/** Local point at radial `s` for a precomputed angular profile. */
function localFromProfile(
  shell: Shell, prof: RimProfile, s: number, theta: number,
  scales: { radius: number; rise: number; curl: number },
  tuning: ImpactSplashTuning,
): [number, number, number] {
  const R = Math.max(0.02, scales.radius * shell.radiusScale * prof.rMul);
  const H = Math.max(0, scales.rise * shell.riseScale * prof.hMul);
  const r = R * (tuning.footRadiusFrac + (1 - tuning.footRadiusFrac) * Math.pow(s, prof.p));
  const h = H * Math.pow(s, prof.q) + shell.axialOffset;
  const z = h - scales.curl * s * s;
  const ang = theta + shell.angleOffset;
  return [Math.cos(ang) * r, Math.sin(ang) * r, z];
}

/** One-off local point at an arbitrary (s, theta), for the droplets. */
function shellSurface(
  shell: Shell, s: number, theta: number,
  scales: { radius: number; rise: number; curl: number },
  tuning: ImpactSplashTuning,
): [number, number, number] {
  return localFromProfile(shell, shellProfile(shell, theta, tuning), s, theta, scales, tuning);
}

function worldFromLocal(
  origin: Vec3, basis: { u: Vec3; v: Vec3; w: Vec3 },
  lx: number, ly: number, lz: number, sag: number,
): [number, number, number] {
  return [
    origin[0] + basis.u[0] * lx + basis.v[0] * ly + basis.w[0] * lz,
    origin[1] + basis.u[1] * lx + basis.v[1] * ly + basis.w[1] * lz - sag,
    origin[2] + basis.u[2] * lx + basis.v[2] * ly + basis.w[2] * lz,
  ];
}

/**
 * Build one event's geometry. PURE and total: no mutation, no RNG state, no
 * GPU. Returns null once the event is at/over its bounded lifetime, which is
 * the frame-side half of the cleanup contract.
 */
export function buildImpactSplashFrame(
  ev: ImpactSplashEvent, tuning: ImpactSplashTuning = IMPACT_SPLASH_TUNING,
): ImpactSplashFrame | null {
  if (!(ev.lifetime > 0) || ev.time < 0 || ev.time >= ev.lifetime) return null;
  const basis = impactSplashBasis(ev.direction);
  const scales = crownScales(ev.time, tuning);
  const shells = buildShells(ev.seed, tuning);
  const rs = Math.max(2, Math.round(tuning.radialSegments));
  const as = Math.max(8, Math.round(tuning.angularSegments));
  const vertsPerShell = (rs + 1) * (as + 1);
  const vertexCount = shells.length * vertsPerShell;
  const triangleCount = shells.length * rs * as * 2;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const masks = new Float32Array(vertexCount);
  const shellSeeds = new Float32Array(vertexCount);
  const indices = new Uint32Array(triangleCount * 3);

  const shellScales = { radius: scales.radius, rise: scales.rise, curl: scales.curl };

  // World point of the ACTUAL surface including the world-space sag; the
  // normals/tangents are central differences of this same function, so they
  // describe the surface that is drawn (no analytic/flat mismatch).
  const worldAt = (shell: Shell, prof: RimProfile, s: number, theta: number): [number, number, number] => {
    const l = localFromProfile(shell, prof, s, theta, shellScales, tuning);
    return worldFromLocal(ev.origin, basis, l[0], l[1], l[2], scales.gravity * s * s);
  };

  const dTheta = TAU / as;
  let v = 0;
  let ii = 0;
  for (const shell of shells) {
    const base = v;
    // Precompute the angular profile of this shell ONCE. The
    // finite-difference normals/tangents reuse it, so the finger fields are
    // evaluated O(angularSegments) times per shell instead of several times
    // per vertex. profiles[as] is the seam sample, identical to j=0.
    const profiles: RimProfile[] = new Array(as + 1);
    for (let j = 0; j < as; j++) profiles[j] = shellProfile(shell, j * dTheta, tuning);
    profiles[as] = profiles[0]!;

    for (let i = 0; i <= rs; i++) {
      const s = i / rs;
      const ds = 0.045;
      const s1 = Math.min(1, s + ds); const s0 = Math.max(0, s - ds);
      for (let j = 0; j <= as; j++) {
        const theta = j * dTheta;
        const prof = profiles[j]!;
        const p = worldAt(shell, prof, s, theta);
        positions[v * 3] = p[0]; positions[v * 3 + 1] = p[1]; positions[v * 3 + 2] = p[2];

        // Central differences on the drawn surface. theta is WRAPPED (so the
        // seam at j=0 / j=as gets the same neighbourhood), s is clamped.
        const jm = (j + as - 1) % as;
        const jp = (j + 1) % as;
        const ps = worldAt(shell, prof, s1, theta);
        const ps0 = worldAt(shell, prof, s0, theta);
        const pa = worldAt(shell, profiles[jp]!, s, jp * dTheta);
        const pa0 = worldAt(shell, profiles[jm]!, s, jm * dTheta);
        // dP/ds
        let tx = ps[0] - ps0[0]; let ty = ps[1] - ps0[1]; let tz = ps[2] - ps0[2];
        // dP/dtheta
        const ax = pa[0] - pa0[0]; const ay = pa[1] - pa0[1]; const az = pa[2] - pa0[2];
        // Outward radial direction in world space, used to orient the normal
        // consistently across the whole shell (DoubleSide + faceDirection
        // handles the back face in the shader).
        const ang = theta + shell.angleOffset;
        const rx = Math.cos(ang) * basis.u[0] + Math.sin(ang) * basis.v[0];
        const ry = Math.cos(ang) * basis.u[1] + Math.sin(ang) * basis.v[1];
        const rz = Math.cos(ang) * basis.u[2] + Math.sin(ang) * basis.v[2];
        let nx = ay * tz - az * ty;
        let ny = az * tx - ax * tz;
        let nz = ax * ty - ay * tx;
        let nl = Math.hypot(nx, ny, nz);
        if (!(nl > 1e-9) || !Number.isFinite(nl)) { nx = rx; ny = ry; nz = rz; nl = 1; }
        nx /= nl; ny /= nl; nz /= nl;
        if (nx * rx + ny * ry + nz * rz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;

        // Unit radial tangent with a finite fallback, so the fragment-stage
        // micro-normal can never normalise a zero vector.
        let tl = Math.hypot(tx, ty, tz);
        if (!(tl > 1e-9) || !Number.isFinite(tl)) {
          // Fall back to the tangential direction (guaranteed non-degenerate
          // on a swept sheet) then to the outward radial.
          tx = ax; ty = ay; tz = az;
          tl = Math.hypot(tx, ty, tz);
        }
        if (!(tl > 1e-9) || !Number.isFinite(tl)) { tx = rx; ty = ry; tz = rz; tl = 1; }
        tangents[v * 3] = tx / tl; tangents[v * 3 + 1] = ty / tl; tangents[v * 3 + 2] = tz / tl;

        uvs[v * 2] = s; uvs[v * 2 + 1] = j / as;
        // Smooth material-space wetness: identical for a seed and independent
        // of the world origin (it is a function of shell + angle only).
        masks[v] = clamp01(prof.mask + 0.10 * (s - 0.5));
        shellSeeds[v] = shell.seed;
        v++;
      }
    }
    for (let i = 0; i < rs; i++) {
      for (let j = 0; j < as; j++) {
        const p0 = base + i * (as + 1) + j;
        const p1 = p0 + 1;
        const p2 = p0 + (as + 1);
        const p3 = p2 + 1;
        indices[ii++] = p0; indices[ii++] = p2; indices[ii++] = p1;
        indices[ii++] = p1; indices[ii++] = p2; indices[ii++] = p3;
      }
    }
  }

  // DETACHED DROPLETS / FRAGMENTS. Born across the tear window at a rim point,
  // frozen at the birth rim, then integrated ballistically with real gravity.
  const dLo = Math.max(0, Math.min(tuning.dropletsMin, IMPACT_SPLASH_MAX_DROPLETS));
  const dHi = Math.max(dLo, Math.min(tuning.dropletsMax, IMPACT_SPLASH_MAX_DROPLETS));
  const dSpan = dHi - dLo + 1;
  const dCount = Math.max(1, dLo + Math.min(dSpan - 1, Math.floor(splashHash01(ev.seed, 91) * dSpan)));
  const droplets = new Float32Array(dCount * IMPACT_SPLASH_DROPLET_STRIDE);
  let live = 0;
  const birthStart = Math.min(tuning.dropletBirthStartSec, tuning.dropletBirthEndSec);
  const birthEnd = Math.max(tuning.dropletBirthStartSec, tuning.dropletBirthEndSec);
  const birthSpan = Math.max(1e-6, birthEnd - birthStart);
  for (let k = 0; k < dCount; k++) {
    const bn = splashHash01(ev.seed, 100 + k * 9);
    const birth = birthStart + bn * birthSpan;
    if (ev.time < birth) continue;
    const shell = shells[Math.min(shells.length - 1, Math.floor(splashHash01(ev.seed, 101 + k * 9) * shells.length))]!;
    const theta = splashHash01(ev.seed, 102 + k * 9) * TAU;
    // LAUNCH POINT IS FROZEN AT BIRTH (see the first implementation's note):
    // a droplet detaches from where the rim WAS and then flies ballistically.
    const birthScales = crownScales(birth, tuning);
    const birthLocal = shellSurface(shell, 1, theta, birthScales, tuning);
    const rim = worldFromLocal(ev.origin, basis, birthLocal[0], birthLocal[1], birthLocal[2], birthScales.gravity);
    // Radial-away launch in the crown's own frame plus an outward up-kick
    // along the impact axis; gravity is real 9.8 m/s^2 on world -Y.
    const ang = theta + shell.angleOffset;
    const rx = Math.cos(ang) * basis.u[0] + Math.sin(ang) * basis.v[0];
    const ry = Math.cos(ang) * basis.u[1] + Math.sin(ang) * basis.v[1];
    const rz = Math.cos(ang) * basis.u[2] + Math.sin(ang) * basis.v[2];
    const speed = lerp(tuning.dropletSpeedMin, tuning.dropletSpeedMax, splashHash01(ev.seed, 103 + k * 9));
    const up = lerp(tuning.dropletUpMin, tuning.dropletUpMax, splashHash01(ev.seed, 104 + k * 9));
    // Later droplets are finer and leave slightly slower -> a trailing spray.
    const late = clamp01((birth - birthStart) / birthSpan);
    const vx = rx * speed * (1 - 0.25 * late) + basis.w[0] * up;
    const vy = ry * speed * (1 - 0.25 * late) + basis.w[1] * up;
    const vz = rz * speed * (1 - 0.25 * late) + basis.w[2] * up;
    const age = ev.time - birth;
    const px = rim[0] + vx * age;
    const py = rim[1] + vy * age - 0.5 * tuning.dropletGravity * age * age;
    const pz = rim[2] + vz * age;
    const size = lerp(tuning.dropletSizeMin, tuning.dropletSizeMax, splashHash01(ev.seed, 105 + k * 9))
      * (1 - 0.35 * late);
    const o = live * IMPACT_SPLASH_DROPLET_STRIDE;
    droplets[o] = px; droplets[o + 1] = py; droplets[o + 2] = pz; droplets[o + 3] = size;
    droplets[o + 4] = vx; droplets[o + 5] = vy; droplets[o + 6] = vz;
    live++;
  }

  return {
    positions, normals, tangents, uvs, masks, shellSeeds, indices,
    // Trim to the live droplets so the array LENGTH is the documented
    // stride * count contract (a subarray view shares the same buffer).
    droplets: live > 0 ? droplets.subarray(0, live * IMPACT_SPLASH_DROPLET_STRIDE) : droplets.subarray(0, 0),
    dropletCount: live,
    vertexCount, triangleCount,
    progress: scales.progress, dissolve: scales.dissolve, basis,
  };
}

// -------------------------------------------------------------------------
// Material
// -------------------------------------------------------------------------

/**
 * Wet blood shading for the crown shells and the droplets.
 *
 * ALPHA. `alpha` is returned separately from `rgb` and is wired to the
 * material's EXPLICIT `opacityNode` (see the module header). Holes come from a
 * 3-octave Perlin field in material (radial, angle) space, embedded on a
 * circle (`cos/sin` of the wrapped angle) so it has no azimuthal seam. The
 * threshold is the per-event dissolve ramp, so holes grow continuously and
 * the surviving material stays connected as long as the geometry allows.
 *
 * SHADING. The diffuse red dominates; the specular lobe is small, tinted and
 * broken up by a material-space gloss noise; the fresnel rim is weak. All
 * noise terms are functions of the sheet's own UV, so they move with the
 * sheet and never swim in world space.
 */
export interface ImpactSplashLightRig {
  lightDir: ReturnType<typeof uniform>;
  keyColor: ReturnType<typeof uniform>;
  lightCfg: ReturnType<typeof uniform>;
}

/**
 * The shade graph is built with three's TSL nodes. The explicit `any` inputs
 * are deliberate: the public rig type uses `ReturnType<typeof uniform>`, which
 * ERASES the node value type, so a hand-written node annotation here would
 * either fail to expose `.x`/`.y` or collapse an intersection to `never`. The
 * runtime objects are real TSL nodes; the emitter consumes them by value.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function buildWetShade(
  rig: ImpactSplashLightRig,
  inputs: {
    uv: any;
    mask: any;
    seed: any;
    tangent: any;
    dissolve: any;
    microAmount: number;
  },
) {
  const rigNodes = rig as unknown as {
    lightDir: any; keyColor: any; lightCfg: any;
  };
  const uv = inputs.uv;
  const mask = inputs.mask;
  const seed = inputs.seed;
  const dissolve = inputs.dissolve;

  const u = uv.x;
  const v = uv.y;
  const tau = float(TAU);
  const angC = cos(v.mul(tau));
  const angS = sin(v.mul(tau));
  const seedPhase = seed.mul(53.0);
  // Periodic sample point: (cos 2pi v, sin 2pi v, radial) scaled per octave.
  const q = (k: number, o: number) => vec3(
    angC.mul(k).add(o).add(seedPhase),
    angS.mul(k).add(o * 1.7),
    u.mul(k * 0.75).add(o * 0.31),
  );
  const n1 = mx_noise_float(q(2.6, 0.0));
  const n2 = mx_noise_float(q(6.1, 11.0));
  const n3 = mx_noise_float(q(13.5, 23.0));
  const field = clamp(
    float(0.5).add(n1.mul(0.50)).add(n2.mul(0.28)).add(n3.mul(0.14)),
    0.0, 1.0,
  );
  const wet = clamp(mask, 0.0, 1.0);
  const material = field.mul(0.85).add(wet.mul(0.15));
  // Ragged rim + a thinning foot, both in material space. The foot uses the
  // SAFE smoothstep orientation (edge0 < edge1 is required by WGSL; an
  // inverted form is undefined, not merely reversed).
  const rimNoise = mx_noise_float(q(9.0, 31.0)).mul(0.5).add(0.5);
  const rimBias = smoothstep(0.80, 1.02, u).mul(rimNoise.mul(0.34).add(0.05));
  const footBias = float(1.0).sub(smoothstep(0.0, 0.12, u)).mul(0.22);
  const cut = dissolve.mul(0.80).add(0.16);
  const alpha = smoothstep(cut.sub(0.07), cut.add(0.07), material.sub(rimBias).sub(footBias));

  const n = normalWorld.mul(faceDirection);
  const microN = mx_noise_float(q(24.0, 47.0));
  const tan = normalize(inputs.tangent);
  const nP = normalize(n.add(tan.mul(microN.mul(inputs.microAmount * 0.20))));
  const L = normalize(rigNodes.lightDir);
  const V = normalize(cameraPosition.sub(positionWorld));
  const Hv = normalize(L.add(V));
  const glossNoise = mx_noise_float(q(16.0, 59.0)).mul(0.5).add(0.5);
  const gloss = mix(float(34.0), float(96.0), wet).mul(glossNoise.mul(0.35).add(0.85));
  const shine = pow(max(dot(nP, Hv), 0.0), gloss)
    .mul(0.26)
    .mul(wet.mul(0.55).add(0.45))
    .mul(glossNoise.mul(0.5).add(0.75));
  const fres = pow(float(1.0).sub(max(dot(nP, V), 0.0)), float(4.0)).mul(0.055);
  const baseCol = vec3(0.34, 0.013, 0.020);
  const deepCol = vec3(0.05, 0.0016, 0.0045);
  const tissue = mix(deepCol, baseCol, wet.mul(0.65).add(0.35));
  const amb = float(0.20);
  const ndl = max(dot(nP, L), 0.0);
  const diffuse = tissue.mul(amb.add(rigNodes.lightCfg.x.mul(ndl))).mul(rigNodes.keyColor);
  const rgb = diffuse.add(rigNodes.keyColor.mul(shine.add(fres)));
  return { rgb, alpha };
}

export interface ImpactSplashLayer {
  /** Add to the scene. A Group holding the crown sheets and the droplets. */
  readonly object: THREE.Object3D;
  /** Live event count. */
  readonly eventCount: number;
  readonly vertexCount: number;
  readonly dropletCount: number;
  /** The sheet material, exposed so a test/QA can pin the alpha plumbing
   *  (opacityNode + alphaTest) without a GPU. */
  readonly sheetMaterial: MeshBasicNodeMaterial;
  /** Production event API: emit one impact. `direction` is the OUTWARD wound
   *  normal. Returns the event so a caller can hold and inspect it. */
  emit(origin: Vec3, direction: Vec3, seed: number, options?: ImpactSplashEventOptions): ImpactSplashEvent;
  /** Advance every live event; dead events are removed. */
  step(dt: number): void;
  /** Drop every live event (e.g. before re-emitting on a seed change). */
  clear(): void;
  /** Rebuild the geometry from the current event list. Call once per frame,
   *  after the camera is final. */
  sync(camera: THREE.Camera): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

function defaultRig(): ImpactSplashLightRig {
  return {
    lightDir: uniform(new THREE.Vector3(4, 10, 6).normalize()),
    keyColor: uniform(new THREE.Color(0xffeccd)),
    lightCfg: uniform(new THREE.Vector2(1.1, 0.45)),
  };
}

/**
 * The renderer-side layer: one preallocated sheet mesh (all shells share one
 * BufferGeometry) plus a droplet instancer. The geometry buffers are sized at
 * the worst case (`IMPACT_SPLASH_MAX_EVENTS` x the max grid) and only the
 * drawn range changes, so emitting cannot grow memory.
 */
export function createImpactSplashLayer(options: { rig?: ImpactSplashLightRig } = {}): ImpactSplashLayer {
  const rig = options.rig ?? defaultRig();

  const rs = Math.max(2, IMPACT_SPLASH_TUNING.radialSegments);
  const as = Math.max(8, IMPACT_SPLASH_TUNING.angularSegments);
  const maxVertsPerEvent = IMPACT_SPLASH_MAX_SHELLS * (rs + 1) * (as + 1);
  const maxVerts = maxVertsPerEvent * IMPACT_SPLASH_MAX_EVENTS;
  const maxIndices = IMPACT_SPLASH_MAX_EVENTS * IMPACT_SPLASH_MAX_SHELLS * rs * as * 6;

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
  const nrmAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
  const tanAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
  const uvAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 2), 2);
  const maskAttr = new THREE.BufferAttribute(new Float32Array(maxVerts), 1);
  const seedAttr = new THREE.BufferAttribute(new Float32Array(maxVerts), 1);
  const disAttr = new THREE.BufferAttribute(new Float32Array(maxVerts), 1);
  const idxAttr = new THREE.BufferAttribute(new Uint32Array(maxIndices), 1);
  for (const a of [posAttr, nrmAttr, tanAttr, uvAttr, maskAttr, seedAttr, disAttr, idxAttr]) {
    a.setUsage(THREE.DynamicDrawUsage);
  }
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', nrmAttr);
  geometry.setAttribute('splashTangent', tanAttr);
  geometry.setAttribute('splashUv', uvAttr);
  geometry.setAttribute('splashMask', maskAttr);
  geometry.setAttribute('splashSeed', seedAttr);
  geometry.setAttribute('splashDissolve', disAttr);
  geometry.setIndex(idxAttr);
  geometry.setDrawRange(0, 0);
  // The crown is a world-space bounded region; skip per-frame frustum culling
  // so a large translated event can never be culled by a stale bounds sphere.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uvNode = attribute<'vec2'>('splashUv', 'vec2');
  const maskNode = attribute<'float'>('splashMask', 'float');
  const seedNode = attribute<'float'>('splashSeed', 'float');
  const tanNode = attribute<'vec3'>('splashTangent', 'vec3');
  const disNode = attribute<'float'>('splashDissolve', 'float');

  const sheetShade = buildWetShade(rig, {
    uv: uvNode, mask: maskNode, seed: seedNode, tangent: tanNode,
    dissolve: disNode, microAmount: 1,
  });
  const sheetMaterial = new MeshBasicNodeMaterial();
  // Colour is vec4(rgb, 1): alpha is NOT smuggled through colorNode.a.
  sheetMaterial.colorNode = vec4(sheetShade.rgb, 1.0) as never;
  // ALPHA goes through the explicit opacityNode; NodeMaterial multiplies it
  // into diffuseColor.a and alpha-tests that value (three r185
  // NodeMaterial.setupDiffuseColor). Opaque cutout: crisp torn edges that
  // write depth, so transparent holes never depth-occlude what is behind.
  sheetMaterial.opacityNode = sheetShade.alpha as never;
  sheetMaterial.alphaTest = 0.5;
  sheetMaterial.side = THREE.DoubleSide;
  sheetMaterial.depthWrite = true;
  sheetMaterial.depthTest = true;
  sheetMaterial.transparent = false;
  sheetMaterial.fog = false;

  const sheet = new THREE.Mesh(geometry, sheetMaterial);
  sheet.frustumCulled = false;
  sheet.renderOrder = 1;

  // Droplets share the same wet shading family with constants; their normals
  // come from the sphere geometry. The tangent is a constant unit vector and
  // microAmount is 0, so the micro-normal term is exactly zero (no NaN from
  // normalising a zero vector) while the material-space gloss noise still
  // varies per fragment.
  const dropletShade = buildWetShade(rig, {
    uv: float(0.5),
    mask: float(0.9),
    seed: float(0.0),
    tangent: vec3(0, 1, 0),
    dissolve: float(0.0),
    microAmount: 0,
  });
  const dropletMaterial = new MeshBasicNodeMaterial();
  dropletMaterial.colorNode = vec4(dropletShade.rgb, 1.0) as never;
  dropletMaterial.opacityNode = float(1.0) as never;
  dropletMaterial.alphaTest = 0.5;
  dropletMaterial.side = THREE.FrontSide;
  dropletMaterial.depthWrite = true;
  dropletMaterial.depthTest = true;
  dropletMaterial.transparent = false;
  dropletMaterial.fog = false;

  const dropletGeom = new THREE.IcosahedronGeometry(1, 1);
  const droplets = new THREE.InstancedMesh(
    dropletGeom, dropletMaterial, IMPACT_SPLASH_MAX_DROPLETS * IMPACT_SPLASH_MAX_EVENTS,
  );
  droplets.frustumCulled = false;
  droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < droplets.count; i++) droplets.setMatrixAt(i, zero);
  droplets.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(sheet);
  group.add(droplets);
  group.visible = true;

  const events: ImpactSplashEvent[] = [];
  let lastVertexCount = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function emit(origin: Vec3, direction: Vec3, seed: number, opts?: ImpactSplashEventOptions): ImpactSplashEvent {
    const ev = createImpactSplashEvent(origin, direction, seed, opts);
    events.push(ev);
    while (events.length > IMPACT_SPLASH_MAX_EVENTS) events.shift();
    return ev;
  }

  function step(dt: number): void {
    for (let i = events.length - 1; i >= 0; i--) {
      if (!stepImpactSplashEvent(events[i]!, dt)) events.splice(i, 1);
    }
  }

  function clear(): void { events.length = 0; }

  function sync(_camera: THREE.Camera): void {
    const pos = posAttr.array as Float32Array;
    const nrm = nrmAttr.array as Float32Array;
    const tan = tanAttr.array as Float32Array;
    const uv = uvAttr.array as Float32Array;
    const msk = maskAttr.array as Float32Array;
    const sed = seedAttr.array as Float32Array;
    const dis = disAttr.array as Float32Array;
    const idx = idxAttr.array as Uint32Array;
    let vOff = 0;
    let iOff = 0;
    let vBase = 0;
    let dOff = 0;
    for (const ev of events) {
      const frame = buildImpactSplashFrame(ev);
      if (!frame) continue;
      const vCount = frame.vertexCount;
      const iCount = frame.indices.length;
      if (vOff + vCount > maxVerts || iOff + iCount > maxIndices) break;
      pos.set(frame.positions, vOff * 3);
      nrm.set(frame.normals, vOff * 3);
      tan.set(frame.tangents, vOff * 3);
      uv.set(frame.uvs, vOff * 2);
      msk.set(frame.masks, vOff);
      sed.set(frame.shellSeeds, vOff);
      // Per-event dissolve rides a vertex attribute, so several live events at
      // different ages each get their OWN dissolve (a single shared uniform
      // would apply the oldest event's dissolve to every crown).
      dis.fill(frame.dissolve, vOff, vOff + vCount);
      for (let k = 0; k < iCount; k++) idx[iOff + k] = frame.indices[k]! + vBase;
      vOff += vCount;
      iOff += iCount;
      vBase += vCount;
      // Droplets into the instance matrices. The loop bound is the BUFFER
      // capacity, never `droplets.count` (the previous frame's draw count,
      // which may be smaller and would silently drop this frame's droplets).
      const dCount = Math.min(frame.dropletCount, IMPACT_SPLASH_MAX_DROPLETS);
      for (let k = 0; k < dCount && dOff < droplets.instanceMatrix.count; k++) {
        const o = k * IMPACT_SPLASH_DROPLET_STRIDE;
        p.set(frame.droplets[o]!, frame.droplets[o + 1]!, frame.droplets[o + 2]!);
        const sz = frame.droplets[o + 3]!;
        vel.set(frame.droplets[o + 4]!, frame.droplets[o + 5]!, frame.droplets[o + 6]!);
        const speed = vel.length();
        if (speed > 1e-6) q.setFromUnitVectors(UP, vel.multiplyScalar(1 / speed));
        else q.identity();
        // Long axis along flight: a bead early, a streak fragment late.
        scl.set(sz * 0.7, sz * IMPACT_SPLASH_TUNING.dropletStretch, sz * 0.7);
        m.compose(p, q, scl);
        droplets.setMatrixAt(dOff, m);
        dOff++;
      }
    }
    const dropletSlots = dOff;
    while (dOff < droplets.instanceMatrix.count) { droplets.setMatrixAt(dOff, zero); dOff++; }
    droplets.instanceMatrix.needsUpdate = true;
    droplets.count = Math.max(0, Math.min(droplets.instanceMatrix.count, dropletSlots));
    geometry.setDrawRange(0, iOff);
    posAttr.needsUpdate = true; nrmAttr.needsUpdate = true; tanAttr.needsUpdate = true;
    uvAttr.needsUpdate = true; maskAttr.needsUpdate = true; seedAttr.needsUpdate = true;
    disAttr.needsUpdate = true; idxAttr.needsUpdate = true;
    lastVertexCount = vOff;
  }

  return {
    object: group,
    get eventCount() { return events.length; },
    get vertexCount() { return lastVertexCount; },
    get dropletCount() { return droplets.count; },
    get sheetMaterial() { return sheetMaterial; },
    emit,
    step,
    clear,
    sync,
    setVisible(v: boolean) { group.visible = v; },
    dispose() {
      geometry.dispose();
      sheetMaterial.dispose();
      dropletGeom.dispose();
      dropletMaterial.dispose();
      (droplets as unknown as { dispose(): void }).dispose?.();
    },
  };
}
