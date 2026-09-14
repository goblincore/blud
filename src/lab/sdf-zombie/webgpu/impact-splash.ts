// Procedural, opt-in wound burst. Three curved membrane patches carry the
// liquid mass; deterministic holes grow through them and intersect the rim.
// A small number of thin ligaments end in rounded beads. Detached droplets
// carry the late motion. Membranes translate outward while tearing, rather
// than shrinking back into the wound.
//
// The event basis follows the outward wound normal; sag is world-space -Y.
// Seed/time fully determine geometry. Buffers are bounded for eight events.
// Alpha is explicitly supplied to opacityNode with alphaTest and depthWrite;
// the shipped Current slug simulation and Smooth reconstruction are separate.

import * as THREE from 'three/webgpu';
import { impactSplashProfiles, resolveImpactSplashProfile, type ImpactSplashProfile } from './impact-splash-profiles';
import { createImpactSplashSprites } from './impact-splash-sprites';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute, cameraPosition, clamp, cos, dot, faceDirection, float, max,
  mix, mx_noise_float, normalize, normalWorld, positionWorld, pow, sin,
  smoothstep, uniform, uv as surfaceUv, vec3, vec4,
} from 'three/tsl';
import { basisFromAxis } from '../vec';
import type { Vec3 } from '../types';

/** Hard structural caps. Exported so callers can size their own buffers and
 *  tests can pin the budget without re-deriving the grid. */
export const IMPACT_SPLASH_MAX_STRANDS = 48;
export const IMPACT_SPLASH_MAX_SHEETS = 6;
/** Core displaced sphere grid (latitude rings x azimuth sectors), fixed. */
export const IMPACT_SPLASH_CORE_RINGS = 12;
export const IMPACT_SPLASH_CORE_SECTORS = 16;
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
  /** Rapid-expansion window: the core and strand growth reach their cap
   *  roughly here. */
  expandSec: number;
  /** Tear window bookends (the strand stagger + dissolve ramp live between
   *  them; the page labels its phase readout from these). */
  tearStartSec: number;
  tearEndSec: number;
  /** Strand length cap, metres (the burst radius before sag). */
  radiusMax: number;
  /** World-space -Y sag begins after this many seconds. */
  droopStartSec: number;
  /** Sag gain: m of drop per (second past droopStart)^2, applied to tips. */
  gravityGain: number;
  /** Curl-back toward the axis: metres of local -w per (second past droop)^2. */
  curlGain: number;
  /** Strand bundle size (bounded by IMPACT_SPLASH_MAX_STRANDS). */
  strands: number;
  /** Tube resolution: rings along the strand, sides around it. */
  strandSegments: number;
  strandSides: number;
  /** Strand base radius range, metres. */
  strandRadiusMin: number;
  strandRadiusMax: number;
  /** Cone angle band (radians off the wound axis): inner jet cone to outer
   *  spray cone. */
  strandConeInner: number;
  strandConeOuter: number;
  /** Fraction of strands kept in the tight inner cone (the reference burst is
   *  dense near the axis with fewer wide outliers). */
  strandCoreFrac: number;
  /** Strand length range as a fraction of radiusMax. */
  strandLengthMin: number;
  strandLengthMax: number;
  /** Per-strand growth: tip reaches u=1 after growSec + its own delay. */
  strandGrowSec: number;
  strandDelaySec: number;
  /** Per-strand dissolve stagger (0 = all fragment together). */
  strandDissolveSpread: number;
  /** Sheet flakes (bounded by IMPACT_SPLASH_MAX_SHEETS). */
  sheets: number;
  /** Sheet flake band grid: band segments (inner->outer) x span segments
   *  (across the azimuth span). Shared names kept for the page/test contract. */
  radialSegments: number;
  angularSegments: number;
  /** Azimuth span range of a flake, radians (always < 2pi: partial, never a
   *  full revolution — that topology was the rejected petal fan). */
  sheetSpanMin: number;
  sheetSpanMax: number;
  /** Cone-angle placement band of a flake, radians off the axis. */
  sheetConeMin: number;
  sheetConeMax: number;
  /** Radial thickness of the band in cone-angle terms, radians. */
  sheetConeBand: number;
  /** Outer edge radius as a fraction of radiusMax. */
  sheetRadiusFrac: number;
  /** Flakes dissolve this much faster than the event dissolve. */
  sheetDissolveBoost: number;
  /** Core mouth radius, metres. */
  coreRadius: number;
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
  /** Long-axis stretch of a droplet instance along its velocity. Kept close
   *  to 1: the old 2.4 stretch read as glossy pills, not spray. */
  dropletStretch: number;
}

/** The shipped artistic timings and small-scale budgets. */
export const IMPACT_SPLASH_TUNING: ImpactSplashTuning = {
  lifetimeSec: 1.15,
  expandSec: 0.24,
  tearStartSec: 0.14,
  tearEndSec: 0.90,
  radiusMax: 0.50,
  droopStartSec: 0.32,
  gravityGain: 0.42,
  curlGain: 0.35,
  strands: 12,
  strandSegments: 22,
  strandSides: 7,
  strandRadiusMin: 0.003,
  strandRadiusMax: 0.010,
  strandConeInner: 0.10,
  strandConeOuter: 1.30,
  strandCoreFrac: 0.25,
  strandLengthMin: 0.45,
  strandLengthMax: 1.0,
  strandGrowSec: 0.14,
  strandDelaySec: 0.06,
  // (extension is driven by expandSec; strandGrowSec scales the delay fraction)
  strandDissolveSpread: 0.32,
  sheets: 6,
  radialSegments: 20,
  angularSegments: 36,
  sheetSpanMin: 0.55,
  sheetSpanMax: 1.20,
  sheetConeMin: 0.25,
  sheetConeMax: 0.65,
  sheetConeBand: 0.75,
  sheetRadiusFrac: 0.92,
  sheetDissolveBoost: 0.85,
  coreRadius: 0.040,
  dropletsMin: 100,
  dropletsMax: 150,
  dropletBirthStartSec: 0.10,
  dropletBirthEndSec: 0.85,
  dropletSpeedMin: 0.6,
  dropletSpeedMax: 1.8,
  dropletUpMin: 0.2,
  dropletUpMax: 0.9,
  /** Stylized: the reference fine spray LINGERS around the burst (it does not
   *  rain away at 9.8 m/s^2). Drag + this value keep the cloud bounded. */
  dropletGravity: 3.0,
  dropletSizeMin: 0.004,
  dropletSizeMax: 0.010,
  dropletStretch: 1.25,
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
  readonly profile?: ImpactSplashProfile;
  time: number;
}

/** A built frame: world-space geometry plus the detached droplets. Pure
 *  arrays, safe to discard; nothing here is retained between builds. */
export interface ImpactSplashFrame {
  positions: Float32Array;
  normals: Float32Array;
  /** Unit centreline tangent per vertex, for material-space micro-normal
   *  variation in the fragment shader. */
  tangents: Float32Array;
  /** Material-space UV per vertex. Strands: x = along (root->tip), y = around
   *  the tube (periodic). Sheets: x = band (inner->outer), y = across span
   *  (embedded on a circle in the shader so it wraps). Core: hashed cell.
   *  The tear noise keys off this, never world space. */
  uvs: Float32Array;
  /** Per-vertex [0,1] wetness mask, a smooth function of (cell, angle). */
  masks: Float32Array;
  /** Per-vertex cell seed in [0,1) — the material cells differ per strand /
   *  sheet / core so the noise never repeats cell to cell. */
  seeds: Float32Array;
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
 *  inputs: the same seed reproduces the same burst on every machine and every
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
/** Golden angle: the azimuthal stride that spreads strands evenly WITHOUT
 *  lining them up into visible spokes (the old flower failure). */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Monotonic dissolve control points [progress, dissolve]. The ramp is
 * back-loaded: the reference keeps a connected, mostly solid burst through
 * the crown window and only then loses continuity into fragments. Each
 * segment is a smoothstep, so the threshold that carves the material-space
 * holes moves continuously. Per-strand/per-sheet staggers multiply the
 * perceived fragmentation on top of this shared ramp.
 */
export const IMPACT_SPLASH_DISSOLVE_POINTS: readonly (readonly [number, number])[] = [
  [0.10, 0.00], [0.24, 0.10], [0.38, 0.22], [0.52, 0.40],
  [0.68, 0.62], [0.86, 0.94], [1.00, 1.00],
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

/** Normalised outward axis, degeneracy-guarded to straight up. Exported for
 *  the direction-transform tests. */
export function impactSplashBasis(direction: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const l = Math.hypot(direction[0], direction[1], direction[2]);
  const safe: Vec3 = l < 1e-9 ? [0, 1, 0] : [direction[0] / l, direction[1] / l, direction[2] / l];
  return basisFromAxis(safe);
}

export interface ImpactSplashEventOptions {
  /** Override the bounded lifetime (seconds). A non-finite/absent value falls
   *  back to the tuning default; a non-positive value creates an already-dead
   *  event (step returns false, the frame is null). */
  lifetime?: number;
  profile?: Partial<ImpactSplashProfile>;
}

export function createImpactSplashEvent(
  origin: Vec3, direction: Vec3, seed: number, options: ImpactSplashEventOptions = {},
): ImpactSplashEvent {
  const requested = options.lifetime;
  // A non-finite (or absent) lifetime falls back to the tuning default; an
  // explicitly non-positive one creates an ALREADY-DEAD event (step returns
  // false immediately and the frame builder yields null), never a full-life
  // event — a caller asking for zero lifetime must not get 1.15 s.
  const lifetime = (typeof requested === 'number' && Number.isFinite(requested))
    ? Math.max(0, requested)
    : IMPACT_SPLASH_TUNING.lifetimeSec;
  return { origin, direction, seed: seed | 0, lifetime, time: 0, profile: resolveImpactSplashProfile(options.profile ?? impactSplashProfiles.slug) };
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

interface Strand {
  azimuth: number;      // rad, full circle
  cone: number;         // rad off the wound axis
  length: number;       // m
  radius: number;       // base radius, m
  roll: number;         // rad, tube rotation phase
  bend: number;         // lateral bend magnitude, m
  bendAzimuth: number;  // rad, bend direction
  delay: number;        // s, growth delay
  dissolveOffset: number; // 0..spread stagger
  seed: number;         // per-strand material cell seed
  mask: number;         // per-strand wetness 0..1
}

interface SheetFlake {
  azimuth: number;      // rad, span centre
  span: number;         // rad, azimuthal width (< 2pi: partial by design)
  cone0: number;        // rad, inner cone angle
  cone1: number;        // rad, outer cone angle
  radius: number;       // m, outer edge radius
  seed: number;
  mask: number;
}

/** Deterministic strand/sheet layout inside the hard caps. Pure in
 *  (seed, tuning). Exported count helpers let tests pin the budget. */
export function impactSplashStrandCount(tuning: ImpactSplashTuning = IMPACT_SPLASH_TUNING): number {
  return Math.max(1, Math.min(IMPACT_SPLASH_MAX_STRANDS, Math.round(tuning.strands)));
}

export function impactSplashSheetCount(tuning: ImpactSplashTuning = IMPACT_SPLASH_TUNING): number {
  return Math.max(0, Math.min(IMPACT_SPLASH_MAX_SHEETS, Math.round(tuning.sheets)));
}

/** Worst-case vertices one event can emit (strands + sheets + core sphere).
 *  The layer sizes its preallocated buffers from this; the per-frame builder
 *  never exceeds it (same tuning). */
export function impactSplashMaxVerticesPerEvent(
  tuning: ImpactSplashTuning = IMPACT_SPLASH_TUNING,
): number {
  const nS = impactSplashStrandCount(tuning);
  const nF = impactSplashSheetCount(tuning);
  const rings = Math.max(2, Math.round(tuning.strandSegments)) + 1;
  const sides = Math.max(3, Math.round(tuning.strandSides)) + 1;
  const band = Math.max(2, Math.round(tuning.radialSegments)) + 1;
  const span = Math.max(3, Math.round(tuning.angularSegments)) + 1;
  const core = (IMPACT_SPLASH_CORE_RINGS + 1) * (IMPACT_SPLASH_CORE_SECTORS + 1);
  return nS * rings * sides + nF * band * span + core;
}

function buildStrands(seed: number, tuning: ImpactSplashTuning): Strand[] {
  const count = impactSplashStrandCount(tuning);
  const strands: Strand[] = [];
  for (let k = 0; k < count; k++) {
    const h = (n: number) => splashHash01(seed, k * 17 + n);
    const tight = h(1) < tuning.strandCoreFrac;
    // Bimodal cone placement: a dense inner jet cone plus wide outliers.
    const cone = tight
      ? lerp(tuning.strandConeInner, tuning.strandConeInner + 0.42, h(2))
      : lerp(tuning.strandConeInner + 0.42, tuning.strandConeOuter, h(2));
    // Golden-angle azimuth + jitter: even coverage, no visible spokes.
    const azimuth = k * GOLDEN_ANGLE + (h(3) - 0.5) * 0.9;
    const lenFrac = lerp(tuning.strandLengthMin, tuning.strandLengthMax, h(4));
    strands.push({
      azimuth,
      cone,
      length: tuning.radiusMax * lenFrac * (tight ? 1.0 : 0.72),
      radius: lerp(tuning.strandRadiusMin, tuning.strandRadiusMax, h(5)),
      roll: h(6) * TAU,
      bend: lerp(0.02, 0.11, h(7)),
      bendAzimuth: h(8) * TAU,
      delay: h(9) * tuning.strandDelaySec,
      dissolveOffset: h(10) * tuning.strandDissolveSpread,
      seed: splashHash01(seed, 7000 + k * 3),
      mask: clamp01(0.45 + 0.5 * h(11)),
    });
  }
  return strands;
}

function buildSheets(seed: number, tuning: ImpactSplashTuning): SheetFlake[] {
  const count = impactSplashSheetCount(tuning);
  const flakes: SheetFlake[] = [];
  for (let k = 0; k < count; k++) {
    const h = (n: number) => splashHash01(seed, 900 + k * 23 + n);
    const cone0 = lerp(tuning.sheetConeMin, tuning.sheetConeMax, h(1));
    flakes.push({
      azimuth: h(2) * TAU,
      span: lerp(tuning.sheetSpanMin, tuning.sheetSpanMax, h(3)),
      cone0,
      cone1: cone0 + tuning.sheetConeBand,
      radius: tuning.radiusMax * tuning.sheetRadiusFrac * lerp(0.75, 1.1, h(4)),
      seed: splashHash01(seed, 7100 + k * 3),
      mask: clamp01(0.4 + 0.5 * h(5)),
    });
  }
  return flakes;
}

/** Time-dependent burst scales, all pure functions of elapsed time. */
function burstScales(t: number, tuning: ImpactSplashTuning): {
  grow: number; curl: number; gravity: number; progress: number; dissolve: number;
} {
  const te = clamp01(t / Math.max(1e-6, tuning.expandSec));
  const grow = 1 - Math.pow(1 - te, 3); // ease-out: fast first, slowing into the cap
  const afterDroop = Math.max(0, t - tuning.droopStartSec);
  const curl = tuning.curlGain * afterDroop * afterDroop;
  const gravity = tuning.gravityGain * afterDroop * afterDroop;
  const progress = clamp01(t / Math.max(1e-6, tuning.lifetimeSec));
  const dissolve = impactSplashDissolveAt(progress);
  return { grow, curl, gravity, progress, dissolve };
}

/** Smooth 3D displacement field for the core lump: a pure function of the
 *  unit direction (so it is seamless on the sphere) and the seed. */
function coreDisplacement(x: number, y: number, z: number, seed: number): number {
  const a = splashHash01(seed, 501) * TAU;
  const b = splashHash01(seed, 502) * TAU;
  const c = splashHash01(seed, 503) * TAU;
  return 0.72 + 0.28 * (
    0.5 * Math.sin(3.1 * x + a) * Math.sin(2.3 * y - b) +
    0.3 * Math.sin(4.2 * y + c) * Math.sin(2.9 * z + a) +
    0.2 * Math.sin(5.3 * z - b) * Math.sin(3.7 * x + c)
  );
}

/** World point of a strand tube vertex. Local frame: w = wound axis, u/v the
 *  perpendicular basis. Returns LOCAL coords; the caller applies the basis
 *  and the world sag. */
function strandPoint(
  st: Strand, u: number, gamma: number,
  scales: { grow: number; curl: number }, tuning: ImpactSplashTuning,
  out: [number, number, number], outN: [number, number, number] | null,
  radiusScale = 1,
): void {
  // Centerline: decelerating arc along the cone direction + lateral bend +
  // curl-back toward the axis late (the reference fingers bend, not straight).
  const sinC = Math.sin(st.cone); const cosC = Math.cos(st.cone);
  const ax = Math.cos(st.azimuth) * sinC;
  const ay = Math.sin(st.azimuth) * sinC;
  const az = cosC;
  const L = st.length * scales.grow;
  const s = L * u * (1 - 0.30 * u); // decelerating arc: points cluster to the tip
  const bx = Math.cos(st.bendAzimuth); const by = Math.sin(st.bendAzimuth);
  const bend = st.bend * u * u;
  // Perpendicular part of the bend (projected off the cone axis).
  const dotB = bx * ax + by * ay + 0 * az;
  let px = (bx - ax * dotB); let py = (by - ay * dotB); let pz = -az * dotB;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const cx = ax * s + px * bend;
  const cy = ay * s + py * bend;
  const cz = az * s + pz * bend - scales.curl * u * u;
  // Radius profile: pinched root, clean taper, pinched tip. The growth gate
  // slides a soft window from the root to the tip so the strand EXTENDS.
  // A thin ligament ending in a rounded bead, rather than a conical spike.
  const taper = 0.42 * Math.pow(1 - u, 1.4)
    + 0.95 * Math.exp(-Math.pow((u - 0.88) / 0.085, 2));
  const root = smooth01(u / 0.10);
  const growGate = clamp01((growU(scales.grow, st, tuning) - u) / 0.10);
  const radius = st.radius * radiusScale * root * taper * growGate;
  // Tube frame: tangent from a finite difference of the centreline, then a
  // stable perpendicular pair rolled by the strand's roll phase.
  const u2 = Math.min(1, u + 0.02);
  const s2 = L * u2 * (1 - 0.30 * u2);
  const tx = ax * (s2 - s) + px * st.bend * (u2 * u2 - u * u);
  const ty = ay * (s2 - s) + py * st.bend * (u2 * u2 - u * u);
  const tz = az * (s2 - s) + pz * st.bend * (u2 * u2 - u * u);
  let tl = Math.hypot(tx, ty, tz);
  let Tx: number, Ty: number, Tz: number;
  if (tl > 1e-9) { Tx = tx / tl; Ty = ty / tl; Tz = tz / tl; }
  else { Tx = ax; Ty = ay; Tz = az; tl = 1; }
  // Reference perpendicular: whichever world axis is least aligned with T.
  let rx = 1, ry = 0, rz = 0;
  if (Math.abs(Tx) > 0.8) { rx = 0; ry = 1; }
  let nx = Ty * rz - Tz * ry, ny = Tz * rx - Tx * rz, nz = Tx * ry - Ty * rx;
  let nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const bx2 = Ty * nz - Tz * ny, by2 = Tz * nx - Tx * nz, bz2 = Tx * ny - Ty * nx;
  const cg = Math.cos(gamma + st.roll); const sg = Math.sin(gamma + st.roll);
  const ox = nx * cg + bx2 * sg; const oy = ny * cg + by2 * sg; const oz = nz * cg + bz2 * sg;
  out[0] = cx + ox * radius; out[1] = cy + oy * radius; out[2] = cz + oz * radius;
  if (outN) { outN[0] = ox; outN[1] = oy; outN[2] = oz; }
}

/** Growth gate for a strand: how far the tip has extended, 0..1, including
 *  the strand's own delay (a staggered, burst-like extension). */
function growU(grow: number, st: Strand, tuning: ImpactSplashTuning): number {
  const delayFrac = clamp01(st.delay / Math.max(1e-6, tuning.strandGrowSec));
  const span = Math.max(1e-6, 1 - delayFrac);
  return clamp01((grow - delayFrac) / span);
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

/** Rotate a local vector into world space (no translation, no sag). */
function rotateToWorld(
  basis: { u: Vec3; v: Vec3; w: Vec3 },
  lx: number, ly: number, lz: number,
): [number, number, number] {
  return [
    basis.u[0] * lx + basis.v[0] * ly + basis.w[0] * lz,
    basis.u[1] * lx + basis.v[1] * ly + basis.w[1] * lz,
    basis.u[2] * lx + basis.v[2] * ly + basis.w[2] * lz,
  ];
}

/** Per-cell dissolve with stagger: cells drop out piece by piece as the event
 *  dissolve rises, never all at once. `off` in [0, spread]. */
function cellDissolve(eventDissolve: number, off: number): number {
  return clamp01((eventDissolve - off) / Math.max(1e-6, 1 - off));
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
  const scales = burstScales(ev.time, tuning);
  const strands = buildStrands(ev.seed, tuning);
  const flakes = buildSheets(ev.seed, tuning);

  const seg = Math.max(2, Math.round(tuning.strandSegments));
  const sides = Math.max(3, Math.round(tuning.strandSides));
  const band = Math.max(2, Math.round(tuning.radialSegments));
  const spanN = Math.max(3, Math.round(tuning.angularSegments));
  const coreRings = IMPACT_SPLASH_CORE_RINGS;
  const coreSectors = IMPACT_SPLASH_CORE_SECTORS;

  const vertsStrands = strands.length * (seg + 1) * (sides + 1);
  const vertsSheets = flakes.length * (band + 1) * (spanN + 1);
  const vertsCore = (coreRings + 1) * (coreSectors + 1);
  const vertexCount = vertsStrands + vertsSheets + vertsCore;
  const triangleCount =
    strands.length * seg * sides * 2 + flakes.length * band * spanN * 2 + coreRings * coreSectors * 2;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const masks = new Float32Array(vertexCount);
  const seeds = new Float32Array(vertexCount);
  const indices = new Uint32Array(triangleCount * 3);

  const lp: [number, number, number] = [0, 0, 0];
  const ln: [number, number, number] = [0, 0, 0];
  let v = 0;
  let ii = 0;

  // ---- STRAND TUBES -------------------------------------------------------
  // World sag is applied to the POSITION after the basis rotation; the tube
  // normals rotate with the basis only (sag is a translation field, and its
  // gradient effect on a 0.4 m strand is second-order).
  for (const st of strands) {
    const base = v;
    const dLoc = cellDissolve(scales.dissolve, st.dissolveOffset);
    const thin = Math.pow(1 - dLoc, 0.8); // strands thin, then vanish, staggered
    const sagK = scales.gravity;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      // world sag grows toward the tip (u^1.5) and only past droopStart.
      const sag = sagK * Math.pow(u, 1.5);
      for (let j = 0; j <= sides; j++) {
        const gamma = (j / sides) * TAU;
        strandPoint(st, u, gamma, scales, tuning, lp, ln, thin);
        const p = worldFromLocal(ev.origin, basis, lp[0], lp[1], lp[2], sag);
        positions[v * 3] = p[0]; positions[v * 3 + 1] = p[1]; positions[v * 3 + 2] = p[2];
        const n = rotateToWorld(basis, ln[0], ln[1], ln[2]);
        normals[v * 3] = n[0]; normals[v * 3 + 1] = n[1]; normals[v * 3 + 2] = n[2];
        // Centreline tangent in world space (finite difference along u).
        const u1 = Math.min(1, u + 0.02);
        const u0 = Math.max(0, u - 0.02);
        strandPoint(st, u1, gamma, scales, tuning, lp, null, thin);
        const p1w = worldFromLocal(ev.origin, basis, lp[0], lp[1], lp[2], sagK * Math.pow(u1, 1.5));
        strandPoint(st, u0, gamma, scales, tuning, lp, null, thin);
        const p0w = worldFromLocal(ev.origin, basis, lp[0], lp[1], lp[2], sagK * Math.pow(u0, 1.5));
        let tx = p1w[0] - p0w[0], ty = p1w[1] - p0w[1], tz = p1w[2] - p0w[2];
        let tl = Math.hypot(tx, ty, tz);
        if (!(tl > 1e-9) || !Number.isFinite(tl)) {
          const rw = rotateToWorld(basis, Math.sin(st.cone) * Math.cos(st.azimuth), Math.sin(st.cone) * Math.sin(st.azimuth), Math.cos(st.cone));
          tx = rw[0]; ty = rw[1]; tz = rw[2]; tl = 1;
        }
        tangents[v * 3] = tx / tl; tangents[v * 3 + 1] = ty / tl; tangents[v * 3 + 2] = tz / tl;
        uvs[v * 2] = u; uvs[v * 2 + 1] = j / sides;
        masks[v] = clamp01(st.mask + 0.12 * (u - 0.5));
        seeds[v] = st.seed;
        v++;
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < sides; j++) {
        const p0 = base + i * (sides + 1) + j;
        const p1 = p0 + 1;
        const p2 = p0 + (sides + 1);
        const p3 = p2 + 1;
        indices[ii++] = p0; indices[ii++] = p2; indices[ii++] = p1;
        indices[ii++] = p1; indices[ii++] = p2; indices[ii++] = p3;
      }
    }
  }

  // ---- SHEET FLAKES -------------------------------------------------------
  // Small spherical-band patches at a cone band off the axis, partial in
  // azimuth. Normals are central differences of the drawn (world) surface,
  // oriented outward like the old shells did.
  for (const fl of flakes) {
    const base = v;

    const thin = 1;
    const sheetTime = Math.max(0, ev.time - fl.seed * 0.055);
    const sheetGrow = Math.max(1e-4, burstScales(sheetTime, tuning).grow);
    const coneSpan = Math.max(1e-6, fl.cone1 - fl.cone0);
    const surfaceR = (psi: number, tn: number): [number, number, number] => {
      const ph2 = fl.azimuth - fl.span / 2 + fl.span * tn;
      const wob = 0.14 * Math.sin(3.3 * ph2 + fl.seed * 91.0) + 0.035 * Math.sin(3.1 * tn * TAU + fl.seed * 57.0);
      const sN = clamp01((psi - fl.cone0) / coneSpan);
      const scallop = 0.055 * Math.sin(tn * 23 + fl.seed * 17)
        + 0.025 * Math.sin(tn * 47 + fl.seed * 39);
      const R2 = fl.radius * sheetGrow * (0.26 + 0.74 * sN)
        * (1 + wob + scallop * sN * sN) * thin;
      return [Math.cos(ph2) * Math.sin(psi) * R2, Math.sin(ph2) * Math.sin(psi) * R2, Math.cos(psi) * R2
        + 0.055 * scales.grow * Math.sin(tn * 14 + sN * 5 + fl.seed * 19) * sN
        + Math.max(0, ev.time - 0.22) * 0.20];
    };
    for (let i = 0; i <= band; i++) {
      const s = i / band;
      const psi = lerp(fl.cone0, fl.cone1, s);
      for (let j = 0; j <= spanN; j++) {
        const tn = j / spanN;
        const lp3 = surfaceR(psi, tn);
        const sag = scales.gravity * Math.pow(s, 1.4);
        const p = worldFromLocal(ev.origin, basis, lp3[0], lp3[1], lp3[2], sag);
        positions[v * 3] = p[0]; positions[v * 3 + 1] = p[1]; positions[v * 3 + 2] = p[2];
        // central differences over (psi, tn) in LOCAL space, rotated after
        const ds = 0.06; const dt = 0.06;
        const q1 = surfaceR(lerp(fl.cone0, fl.cone1, Math.min(1, s + ds)), tn);
        const q0 = surfaceR(lerp(fl.cone0, fl.cone1, Math.max(0, s - ds)), tn);
        const t1 = surfaceR(psi, Math.min(1, tn + dt));
        const t0 = surfaceR(psi, Math.max(0, tn - dt));
        const sxv = q1[0] - q0[0], syv = q1[1] - q0[1], szv = q1[2] - q0[2];
        const axv = t1[0] - t0[0], ayv = t1[1] - t0[1], azv = t1[2] - t0[2];
        let nx = ayv * szv - azv * syv;
        let ny = azv * sxv - axv * szv;
        let nz = axv * syv - ayv * sxv;
        let nl = Math.hypot(nx, ny, nz);
        if (!(nl > 1e-9) || !Number.isFinite(nl)) { nx = lp3[0]; ny = lp3[1]; nz = lp3[2]; nl = Math.hypot(nx, ny, nz) || 1; }
        nx /= nl; ny /= nl; nz /= nl;
        // orient outward: local radial is lp3 itself (a spherical-band patch
        // around the origin), so flip if pointing inward.
        if (nx * lp3[0] + ny * lp3[1] + nz * lp3[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nw = rotateToWorld(basis, nx, ny, nz);
        normals[v * 3] = nw[0]; normals[v * 3 + 1] = nw[1]; normals[v * 3 + 2] = nw[2];
        // unit tangent = local "across span" direction, rotated
        let tax = axv, tay = ayv, taz = azv;
        let tl2 = Math.hypot(tax, tay, taz);
        if (!(tl2 > 1e-9) || !Number.isFinite(tl2)) { tax = nx; tay = ny; taz = nz; tl2 = 1; }
        const tw = rotateToWorld(basis, tax / tl2, tay / tl2, taz / tl2);
        tangents[v * 3] = tw[0]; tangents[v * 3 + 1] = tw[1]; tangents[v * 3 + 2] = tw[2];
        uvs[v * 2] = s; uvs[v * 2 + 1] = tn;
        masks[v] = clamp01(fl.mask + 0.12 * (s - 0.5));
        seeds[v] = -fl.seed - 0.001; // Negative tags a translucent membrane.
        v++;
      }
    }
    for (let i = 0; i < band; i++) {
      for (let j = 0; j < spanN; j++) {
        // Holes open in material coordinates and expand into the rim.
        // Removing geometry makes holes visible from either side, without
        // relying on overlapping alpha-tested surfaces to suggest tearing.
        const su = (i + 0.5) / band;
        const tv = (j + 0.5) / spanN;
        let torn = false;
        for (let hole = 0; hole < 14; hole++) {
          const h = (n: number) => splashHash01(Math.floor(fl.seed * 100000), hole * 7 + n);
          const hu = 0.18 + h(1) * 0.90;
          const hv = h(2);
          const opening = 0.40 + 2.2 * smooth01((ev.time - 0.08 - h(5) * 0.14) / 0.70);
          const ru = (0.065 + h(3) * 0.12) * opening;
          const rv = (0.025 + h(4) * 0.07) * opening;
          if (((su - hu) / ru) ** 2 + ((tv - hv) / rv) ** 2 < 1) { torn = true; break; }
        }
        if (torn) continue;
        const p0 = base + i * (spanN + 1) + j;
        const p1 = p0 + 1;
        const p2 = p0 + (spanN + 1);
        const p3 = p2 + 1;
        indices[ii++] = p0; indices[ii++] = p2; indices[ii++] = p1;
        indices[ii++] = p1; indices[ii++] = p2; indices[ii++] = p3;
      }
    }
  }

  // ---- CORE (displaced UV sphere at the wound mouth) ----------------------
  {
    const base = v;
    const coreSeed = splashHash01(ev.seed, 4001);
    const coreDissolve = clamp01(scales.dissolve * 0.9);
    const coreScale = tuning.coreRadius * scales.grow * (1 - 0.55 * coreDissolve);
    const squashU = 0.85 + 0.4 * splashHash01(ev.seed, 4002);
    const squashV = 0.85 + 0.4 * splashHash01(ev.seed, 4003);
    for (let i = 0; i <= coreRings; i++) {
      const phiV = Math.PI * (i / coreRings); // 0..pi from +w pole
      const cw = Math.cos(phiV); const sw = Math.sin(phiV);
      for (let j = 0; j <= coreSectors; j++) {
        const theta = TAU * (j / coreSectors);
        const dx = sw * Math.cos(theta); const dyv = sw * Math.sin(theta); const dzv = cw;
        const disp = coreDisplacement(dx, dyv, dzv, ev.seed);
        const rr = coreScale * disp;
        // Local dir (u/v around, w along the axis) with an anisotropic squash.
        const lx = dx * rr * squashU; const ly = dyv * rr * squashV; const lz = dzv * rr;
        const p = worldFromLocal(ev.origin, basis, lx, ly, lz, 0);
        positions[v * 3] = p[0]; positions[v * 3 + 1] = p[1]; positions[v * 3 + 2] = p[2];
        const n = rotateToWorld(basis, dx, dyv, dzv);
        normals[v * 3] = n[0]; normals[v * 3 + 1] = n[1]; normals[v * 3 + 2] = n[2];
        tangents[v * 3] = n[0]; tangents[v * 3 + 1] = n[1]; tangents[v * 3 + 2] = n[2];
        uvs[v * 2] = i / coreRings; uvs[v * 2 + 1] = j / coreSectors;
        masks[v] = 0.28 + 0.3 * coreSeed; // the core is the dark wet centre
        seeds[v] = coreSeed;
        v++;
      }
    }
    for (let i = 0; i < coreRings; i++) {
      for (let j = 0; j < coreSectors; j++) {
        const p0 = base + i * (coreSectors + 1) + j;
        const p1 = p0 + 1;
        const p2 = p0 + (coreSectors + 1);
        const p3 = p2 + 1;
        indices[ii++] = p0; indices[ii++] = p2; indices[ii++] = p1;
        indices[ii++] = p1; indices[ii++] = p2; indices[ii++] = p3;
      }
    }
  }

  // DETACHED DROPLETS / FRAGMENTS. Born across the tear window along a
  // strand's direction, frozen at the birth position, then integrated
  // ballistically with real gravity. Nearly round (stretch ~1.25 in the
  // layer), small: fine spray, not pills.
  const dLo = Math.max(0, Math.min(tuning.dropletsMin, IMPACT_SPLASH_MAX_DROPLETS));
  const dHi = Math.max(dLo, Math.min(tuning.dropletsMax, IMPACT_SPLASH_MAX_DROPLETS));
  const dSpan = dHi - dLo + 1;
  const dCount = Math.max(1, dLo + Math.min(dSpan - 1, Math.floor(splashHash01(ev.seed, 91) * dSpan)));
  const droplets = new Float32Array(dCount * IMPACT_SPLASH_DROPLET_STRIDE);
  let live = 0;
  const birthStart = Math.min(tuning.dropletBirthStartSec, tuning.dropletBirthEndSec);
  const birthEnd = Math.max(tuning.dropletBirthStartSec, tuning.dropletBirthEndSec);
  const birthSpan = Math.max(1e-6, birthEnd - birthStart);
  const strandCount = strands.length;
  for (let k = 0; k < dCount; k++) {
    const bn = splashHash01(ev.seed, 100 + k * 9);
    const birth = birthStart + bn * birthSpan;
    if (ev.time < birth) continue;
    const st = strands[Math.min(strandCount - 1, Math.floor(splashHash01(ev.seed, 101 + k * 9) * strandCount))]!;
    // Launch position: the strand's surface near its tip (u 0.7..1.0) as it
    // stands at the BIRTH time (frozen-at-birth contract, as before).
    const birthScales = burstScales(birth, tuning);
    const uDetach = lerp(0.7, 1.0, splashHash01(ev.seed, 106 + k * 9));
    strandPoint(st, uDetach, splashHash01(ev.seed, 107 + k * 9) * TAU, birthScales, tuning, lp, null, 1);
    const rim = worldFromLocal(ev.origin, basis, lp[0], lp[1], lp[2], birthScales.gravity * Math.pow(uDetach, 1.5));
    // Launch along the strand's cone direction + an outward kick on the axis.
    const sinC = Math.sin(st.cone); const cosC = Math.cos(st.cone);
    const dxw = rotateToWorld(basis, Math.cos(st.azimuth) * sinC, Math.sin(st.azimuth) * sinC, cosC);
    const speed = lerp(tuning.dropletSpeedMin, tuning.dropletSpeedMax, splashHash01(ev.seed, 103 + k * 9));
    const up = lerp(tuning.dropletUpMin, tuning.dropletUpMax, splashHash01(ev.seed, 104 + k * 9));
    const late = clamp01((birth - birthStart) / birthSpan);
    const vx = dxw[0] * speed * (1 - 0.25 * late) + basis.w[0] * up;
    const vy = dxw[1] * speed * (1 - 0.25 * late) + basis.w[1] * up;
    const vz = dxw[2] * speed * (1 - 0.25 * late) + basis.w[2] * up;
    const age = ev.time - birth;
    // Linear aerodynamic drag: v(age) = v0 * e^(-k*age), so position along
    // the launch axis is rim + v0 * (1 - e^(-k*age)) / k. The fine spray
    // decelerates and hangs near the burst (reference look) instead of
    // flying metres away; gravity stays real world -Y.
    const drag = 1.15;
    const decay = Math.exp(-drag * age);
    const travel = (1 - decay) / drag;
    const px = rim[0] + vx * travel;
    const py = rim[1] + vy * travel - 0.5 * tuning.dropletGravity * age * age;
    const pz = rim[2] + vz * travel;
    const size = lerp(tuning.dropletSizeMin, tuning.dropletSizeMax, splashHash01(ev.seed, 105 + k * 9))
      * (1 - 0.35 * late);
    const o = live * IMPACT_SPLASH_DROPLET_STRIDE;
    droplets[o] = px; droplets[o + 1] = py; droplets[o + 2] = pz; droplets[o + 3] = size;
    droplets[o + 4] = vx; droplets[o + 5] = vy; droplets[o + 6] = vz;
    live++;
  }

  return {
    positions, normals, tangents, uvs, masks, seeds, indices,
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
 * Wet blood shading for the strands, sheets, core and droplets.
 *
 * ALPHA. `alpha` is returned separately from `rgb` and is wired to the
 * material's EXPLICIT `opacityNode` (see the module header). Holes come from a
 * 3-octave Perlin field in material (along, around) space, embedded on a
 * circle (`cos/sin` of the wrapped around-coordinate) so it has no seam. The
 * threshold is the per-event dissolve ramp, so holes grow continuously while
 * the per-cell staggers stagger the tearing.
 *
 * SHADING. The diffuse red dominates; specular is small, tinted and broken up
 * by a material-space gloss noise; the fresnel rim is weak. Ambient is kept
 * HIGH and the key is warm-neutral so shadowed blood still reads RED, never
 * black/brown (a standing owner requirement). All noise terms are functions
 * of the surface's own UV, so they move with the surface and never swim in
 * world space.
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
    specScale: number;
  },
) {
  const rigNodes = rig as unknown as {
    lightDir: any; keyColor: any; lightCfg: any;
  };
  const uv = inputs.uv;
  const mask = inputs.mask;
  const seed = inputs.seed.abs();
  const dissolve = inputs.dissolve;

  const u = uv.x;
  const v = uv.y;
  const tau = float(TAU);
  const angC = cos(v.mul(tau));
  const angS = sin(v.mul(tau));
  const seedPhase = seed.mul(53.0);
  // Periodic sample point: (cos 2pi v, sin 2pi v, along) scaled per octave.
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
  // Ragged edge + a thinning root, both in material space. The root uses the
  // SAFE smoothstep orientation (edge0 < edge1 is required by WGSL; an
  // inverted form is undefined, not merely reversed).
  const rimNoise = mx_noise_float(q(9.0, 31.0)).mul(0.5).add(0.5);
  const rimBias = smoothstep(0.80, 1.02, u).mul(rimNoise.mul(0.34).add(0.05));
  const rootBias = float(1.0).sub(smoothstep(0.0, 0.12, u)).mul(0.22);
  const cut = dissolve.mul(0.80).add(0.14);
  const alpha = smoothstep(cut.sub(0.07), cut.add(0.07), material.sub(rimBias).sub(rootBias));

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
    .mul(0.20 * inputs.specScale)
    .mul(wet.mul(0.55).add(0.45))
    .mul(glossNoise.mul(0.5).add(0.75));
  const fres = pow(float(1.0).sub(max(dot(nP, V), 0.0)), float(4.0)).mul(0.04 * inputs.specScale);
  // Saturated wet red. The old 0.34/0.013/0.020 with 0.20 ambient went dull
  // brown on grazing surfaces; brighter base + higher ambient keeps shadowed
  // blood RED (owner requirement), and the tube normals round the shading.
  const baseCol = vec3(0.46, 0.010, 0.016);
  const deepCol = vec3(0.085, 0.002, 0.005);
  const tissue = mix(deepCol, baseCol, wet.mul(0.65).add(0.35));
  const amb = float(0.32);
  const ndl = max(dot(nP, L), 0.0);
  const diffuse = tissue.mul(amb.add(rigNodes.lightCfg.x.mul(ndl))).mul(rigNodes.keyColor);
  const rgb = diffuse.add(rigNodes.keyColor.mul(shine.add(fres)));
  return { rgb, alpha };
}

export interface ImpactSplashLayer {
  /** Add to the scene. A Group holding the burst geometry and the droplets. */
  readonly object: THREE.Object3D;
  /** Live event count. */
  readonly eventCount: number;
  readonly vertexCount: number;
  readonly dropletCount: number;
  /** The burst material, exposed so a test/QA can pin the alpha plumbing
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
    keyColor: uniform(new THREE.Color(0xffe8d8)),
    lightCfg: uniform(new THREE.Vector2(1.05, 0.45)),
  };
}

/**
 * The renderer-side layer: one preallocated mesh (all strands/sheets/core of
 * every event share one BufferGeometry) plus a droplet instancer. The
 * geometry buffers are sized at the worst case
 * (`IMPACT_SPLASH_MAX_EVENTS` x `impactSplashMaxVerticesPerEvent()`) and only
 * the drawn range changes, so emitting cannot grow memory.
 */
export function createImpactSplashLayer(options: { rig?: ImpactSplashLightRig } = {}): ImpactSplashLayer {
  const rig = options.rig ?? defaultRig();

  const maxVertsPerEvent = impactSplashMaxVerticesPerEvent();
  const maxVerts = maxVertsPerEvent * IMPACT_SPLASH_MAX_EVENTS;
  const maxIndices = maxVertsPerEvent * 6 * IMPACT_SPLASH_MAX_EVENTS;

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
  // The burst is a world-space bounded region; skip per-frame frustum culling
  // so a large translated event can never be culled by a stale bounds sphere.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uvNode = attribute<'vec2'>('splashUv', 'vec2');
  const maskNode = attribute<'float'>('splashMask', 'float');
  const seedNode = attribute<'float'>('splashSeed', 'float');
  const tanNode = attribute<'vec3'>('splashTangent', 'vec3');
  const disNode = attribute<'float'>('splashDissolve', 'float');

  const sheetShade = buildWetShade(rig, {
    uv: uvNode, mask: maskNode, seed: seedNode, tangent: tanNode,
    dissolve: disNode, microAmount: 1, specScale: 1,
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

  // Separate translucent membranes from depth-writing core/ligaments.
  const membraneGeometry = new THREE.BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) {
    membraneGeometry.setAttribute(name, geometry.getAttribute(name));
  }
  const membraneIndex = new THREE.BufferAttribute(new Uint32Array(maxIndices), 1);
  membraneIndex.setUsage(THREE.DynamicDrawUsage);
  membraneGeometry.setIndex(membraneIndex);
  membraneGeometry.setDrawRange(0, 0);
  const membraneMaterial = new MeshBasicNodeMaterial();
  membraneMaterial.colorNode = vec4(sheetShade.rgb, 1) as never;
  // Thin edges transmit more light; thick patches and overlapping layers
  // build density. This is coverage, not simply a paler RGB value.
  const thickness = clamp(maskNode.mul(0.65).add(0.10), 0.15, 0.78);
  membraneMaterial.opacityNode = sheetShade.alpha.mul(thickness)
    .mul(float(1).sub(disNode.mul(0.5))) as never;
  membraneMaterial.transparent = true;
  membraneMaterial.depthWrite = false;
  membraneMaterial.depthTest = true;
  membraneMaterial.side = THREE.DoubleSide;
  membraneMaterial.forceSinglePass = true;
  membraneMaterial.fog = false;
  const membranes = new THREE.Mesh(membraneGeometry, membraneMaterial);
  membranes.frustumCulled = false;
  membranes.renderOrder = 2;

  const sheet = new THREE.Mesh(geometry, sheetMaterial);
  sheet.frustumCulled = false;
  sheet.renderOrder = 1;

  // Droplets share the same wet shading family with constants; their normals
  // come from the sphere geometry. The tangent is a constant unit vector and
  // microAmount is 0, so the micro-normal term is exactly zero (no NaN from
  // normalising a zero vector) while the material-space gloss noise still
  // varies per fragment. specScale 0.55: the old droplets read as glossy
  // pills; these are near-round matte-red spray with occasional glints.
  const dropletShade = buildWetShade(rig, {
    uv: float(0.5),
    mask: float(0.75),
    seed: float(0.0),
    tangent: vec3(0, 1, 0),
    dissolve: float(0.0),
    microAmount: 0,
    specScale: 0.55,
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

  // Fine atomized blood: soft coverage around a subset of flying drops.
  const mistMaterial = new MeshBasicNodeMaterial();
  const mistUv = surfaceUv().sub(0.5).mul(2);
  const feather = float(1).sub(smoothstep(0.1, 1.0, mistUv.length()));
  mistMaterial.colorNode = vec3(0.08, 0.001, 0.003) as never;
  mistMaterial.opacityNode = feather.mul(feather).mul(0.10) as never;
  mistMaterial.transparent = true;
  mistMaterial.depthWrite = false;
  mistMaterial.depthTest = true;
  mistMaterial.fog = false;
  const mistGeometry = new THREE.PlaneGeometry(1, 1);
  const mist = new THREE.InstancedMesh(mistGeometry, mistMaterial,
    IMPACT_SPLASH_MAX_DROPLETS * IMPACT_SPLASH_MAX_EVENTS);
  mist.frustumCulled = false;
  mist.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mist.count = 0;
  mist.renderOrder = 3;

  const sprites = createImpactSplashSprites(rig);
  const group = new THREE.Group();
  group.add(sprites.object);
  sheet.visible = false;
  membranes.visible = false;
  group.add(sheet);
  group.add(membranes);
  group.add(droplets);
  group.add(mist);
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
    sprites.sync(events, _camera);
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
    const transparentTriangles: { a: number; b: number; c: number; z: number }[] = [];
    const view = _camera.matrixWorldInverse.elements;
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
      sed.set(frame.seeds, vOff);
      // Per-event dissolve rides a vertex attribute, so several live events at
      // different ages each get their OWN dissolve (a single shared uniform
      // would apply the oldest event's dissolve to every burst).
      dis.fill(frame.dissolve, vOff, vOff + vCount);
      for (let k = 0; k < iCount; k += 3) {
        const a = frame.indices[k]! + vBase;
        const b = frame.indices[k + 1]! + vBase;
        const c = frame.indices[k + 2]! + vBase;
        if (sed[a]! < 0) {
          const x = (pos[a*3]! + pos[b*3]! + pos[c*3]!) / 3;
          const y = (pos[a*3+1]! + pos[b*3+1]! + pos[c*3+1]!) / 3;
          const z = (pos[a*3+2]! + pos[b*3+2]! + pos[c*3+2]!) / 3;
          transparentTriangles.push({a,b,c,z: view[2]! * x + view[6]! * y + view[10]! * z + view[14]!});
        } else { idx[iOff++] = a; idx[iOff++] = b; idx[iOff++] = c; }
      }
      vOff += vCount;

      vBase += vCount;
      // Droplets into the instance matrices. The loop bound is the BUFFER
      // capacity, never `droplets.count` (the previous frame's draw count,
      // which may be smaller and would silently drop this frame's droplets).
      const dCount = Math.min(frame.dropletCount, (ev.profile?.count ?? 32) * 2, IMPACT_SPLASH_MAX_DROPLETS);
      for (let k = 0; k < dCount && dOff < droplets.instanceMatrix.count; k++) {
        const o = k * IMPACT_SPLASH_DROPLET_STRIDE;
        p.set(frame.droplets[o]!, frame.droplets[o + 1]!, frame.droplets[o + 2]!);
        const effectScale = ev.profile?.scale ?? 1;
        p.set(ev.origin[0] + (p.x - ev.origin[0]) * effectScale, ev.origin[1] + (p.y - ev.origin[1]) * effectScale, ev.origin[2] + (p.z - ev.origin[2]) * effectScale);
        const sz = frame.droplets[o + 3]! * Math.sqrt(effectScale);
        vel.set(frame.droplets[o + 4]!, frame.droplets[o + 5]!, frame.droplets[o + 6]!);
        const speed = vel.length();
        if (speed > 1e-6) q.setFromUnitVectors(UP, vel.multiplyScalar(1 / speed));
        else q.identity();
        // Long axis along flight, but NEARLY ROUND: the old 2.4x stretch read
        // as glossy pills. Fine spray reads as slightly elongated beads.
        scl.set(sz * 0.85, sz * IMPACT_SPLASH_TUNING.dropletStretch, sz * 0.85);
        m.compose(p, q, scl);
        droplets.setMatrixAt(dOff, m);
        // Billboards use the camera orientation; all share one colour so
        // their mutual alpha overlap is independent of instance order.
        const cloudSize = sz * (14 + frame.dissolve * 18);
        scl.set(cloudSize, cloudSize, 1);
        m.compose(p, _camera.quaternion, scl);
        mist.setMatrixAt(dOff, m);
        dOff++;
      }
    }
    const dropletSlots = dOff;
    mist.count = dOff;
    mist.instanceMatrix.needsUpdate = true;
    while (dOff < droplets.instanceMatrix.count) { droplets.setMatrixAt(dOff, zero); dOff++; }
    droplets.instanceMatrix.needsUpdate = true;
    droplets.count = Math.max(0, Math.min(droplets.instanceMatrix.count, dropletSlots));
    // Sort all translucent triangles across events back-to-front. Sorting
    // just the mesh would fail for intersecting sheets or camera orbit.
    transparentTriangles.sort((a,b) => a.z - b.z);
    let ti = 0;
    for (const tri of transparentTriangles) {
      membraneIndex.array[ti++] = tri.a;
      membraneIndex.array[ti++] = tri.b;
      membraneIndex.array[ti++] = tri.c;
    }
    membraneIndex.needsUpdate = true;
    membraneGeometry.setDrawRange(0, ti);
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
      sprites.dispose();
      geometry.dispose();
      membraneGeometry.dispose();
      membraneMaterial.dispose();
      sheetMaterial.dispose();
      dropletGeom.dispose();
      dropletMaterial.dispose();
      mistGeometry.dispose();
      mistMaterial.dispose();
      mist.dispose();
      (droplets as unknown as { dispose(): void }).dispose?.();
    },
  };
}
