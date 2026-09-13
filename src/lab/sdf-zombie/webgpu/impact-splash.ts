// src/lab/sdf-zombie/webgpu/impact-splash.ts
//
// IMPACT SPLASH — an original procedural crown/fan burst at a wound impact
// (reference-directed slug impact splash, 2026-09-13).
//
// WHY THIS EXISTS BESIDE THE SLUG GOUT. The shipped slug impact is a dense,
// nearly stationary pulse (IMPACT_GOUT.slug: 85 droplets at 0.2-0.5 m/s) that
// reads as a collapsing blob. The owner rejected that as "a blob that drops"
// and rejected the earlier 8 m/s pulse as "needles". The reference (a blood
// Niagara breakdown) is a different SHAPE: a violent outward/upward crown,
// torn sheets, long tapering fingers and detached droplets. This module adds
// that shape as a SUPPLEMENTARY, INDEPENDENTLY SELECTABLE effect. It does not
// touch IMPACT_GOUT, WOUND_BLEED, stepBlood or any shared global — the
// existing slug remains the "Current" scenario, bit-for-bit.
//
// WHAT IT IS. A bounded, deterministic procedural mesh: several unequal lobes
// form thin, curved surface patches fanned about the impact axis. Each patch
// is a genuine 2D parametric surface (radial x angular grid) with a domed
// cross-section, so it is a curved shell rather than a flat card, and its
// smooth normals are computed analytically. The patches expand fast then slow,
// curl, tear along seeded material-space cells and break into sparse detached
// droplets. No fluid sim, no baked FLIP mesh, no paid asset, no world-space
// noise: the holes/dissolve are a function of (lobe, material UV) so they move
// WITH the sheet and cannot swim.
//
// COORDINATE CONTRACT. An event carries an explicit `origin`, an OUTWARD
// `direction` (the wound normal, i.e. the hemisphere the blood leaves the
// body into), a deterministic integer `seed`, a mutable `time` and a bounded
// `lifetime`. The basis is `basisFromAxis(direction)` (w = direction), so a
// floor impact with an upward normal sprays up while a wall/body impact
// sprays out of the wall — the effect is NOT hard-coded to world-up.
//
// GRAVITY CONTRACT. Gravity is a world-space -Y displacement applied AFTER
// the local crown is built, and it eases in only after the expansion window
// (`droopStartSec`): the crown rides out first, then sags and curls. It is not
// an immediate clump fall along the axis.
//
// BUDGET. `IMPACT_SPLASH_MAX_LOBES` x `lobes * (radialSegments+1) *
// (angularSegments+1)` vertices per event and `maxDroplets` instance slots.
// The layer preallocates those worst cases and only ever reduces the drawn
// range, so a long-lived page cannot grow the geometry.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, attribute, cameraPosition, faceDirection, float, normalWorld,
  positionWorld, uniform, vec2, vec4,
} from 'three/tsl';
import { basisFromAxis } from '../vec';
import type { Vec3 } from '../types';

/** Hard structural caps. Exported so callers can size their own buffers and
 *  tests can pin the budget without re-deriving the grid. */
export const IMPACT_SPLASH_MAX_LOBES = 7;
export const IMPACT_SPLASH_MAX_DROPLETS = 48;
/** Hard cap on simultaneously live events the shared layer will pose. Extra
 *  emissions past this are dropped rather than queued (a wound burst is a
 *  sub-second event; a queue would outlive it). */
export const IMPACT_SPLASH_MAX_EVENTS = 8;

export interface ImpactSplashTuning {
  /** Bounded lifetime, seconds. The frame is null at/after this. */
  lifetimeSec: number;
  /** Rapid-expansion window: radius/rise reach their cap roughly here. */
  expandSec: number;
  /** Drop/tear window: fingers thin, holes open, droplets detach. */
  tearStartSec: number;
  tearEndSec: number;
  /** Crown radius cap, metres. Small on purpose: a wound burst, not a
   *  room-filling explosion. */
  radiusMax: number;
  /** Crown lip height above the impact plane, metres. */
  riseMax: number;
  /** World-space -Y sag begins after this many seconds. */
  droopStartSec: number;
  /** Sag gain: m of drop per (second past droopStart)^2, applied to the rim. */
  gravityGain: number;
  /** Curl-back toward the axis: metres of local -w per (second past droop)^2. */
  curlGain: number;
  /** Lobes: count is rolled in [lobesMin, lobesMax]. */
  lobesMin: number;
  lobesMax: number;
  /** Lobe angular half-width band, radians. */
  angularSpreadMin: number;
  angularSpreadMax: number;
  /** Parameteric grid resolution per lobe. */
  radialSegments: number;
  angularSegments: number;
  /** Radial finger modulation at the rim (fraction of the base radius). */
  fingerAmp: number;
  /** Fingers per lobe. */
  fingerFreq: number;
  /** Lobe azimuth twist along the radius, radians. */
  twist: number;
  /** Cross-section bow along the angular direction (metres), which is what
   *  keeps a patch a curved shell rather than a flat sail. */
  bowAmp: number;
  /** Normalized lifetime at which dissolve starts / completes. */
  dissolveStart: number;
  dissolveEnd: number;
  /** Detached droplets rolled per event. */
  dropletsMin: number;
  dropletsMax: number;
  dropletSpeedMin: number;
  dropletSpeedMax: number;
  dropletUpMin: number;
  dropletUpMax: number;
  dropletGravity: number;
  dropletSizeMin: number;
  dropletSizeMax: number;
}

/** The shipped artistic timings (owner brief: .1-.25 s expansion, .2-.6 s
 *  tear/drop) and the small-scale budgets. */
export const IMPACT_SPLASH_TUNING: ImpactSplashTuning = {
  lifetimeSec: 1.15,
  expandSec: 0.22,
  tearStartSec: 0.20,
  tearEndSec: 0.60,
  radiusMax: 0.46,
  riseMax: 0.30,
  droopStartSec: 0.26,
  gravityGain: 1.9,
  curlGain: 0.85,
  lobesMin: 4,
  lobesMax: IMPACT_SPLASH_MAX_LOBES,
  angularSpreadMin: 0.34,
  angularSpreadMax: 0.82,
  radialSegments: 9,
  angularSegments: 7,
  fingerAmp: 0.34,
  fingerFreq: 3.1,
  twist: 0.22,
  bowAmp: 0.085,
  dissolveStart: 0.26,
  dissolveEnd: 0.72,
  dropletsMin: 12,
  dropletsMax: 26,
  dropletSpeedMin: 0.9,
  dropletSpeedMax: 2.7,
  dropletUpMin: 0.4,
  dropletUpMax: 1.5,
  dropletGravity: 9.8,
  dropletSizeMin: 0.012,
  dropletSizeMax: 0.03,
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
  /** Material-space UV per vertex: x = radial 0..1 (root -> rim),
   *  y = angular 0..1. The tear cells key off this, never world space. */
  uvs: Float32Array;
  /** Per-vertex [0,1] wetness/dissolve mask, seeded by (lobe, grid cell). */
  masks: Float32Array;
  /** Per-vertex lobe seed in [0,1) — the material cells differ per lobe. */
  lobeSeeds: Float32Array;
  indices: Uint32Array;
  /** xyz + size per detached droplet (4 floats each). */
  droplets: Float32Array;
  dropletCount: number;
  vertexCount: number;
  triangleCount: number;
  /** 0..1 lifetime progress. */
  progress: number;
  /** 0..1 dissolve threshold fed to the material. */
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

interface Lobe {
  azimuth: number;
  halfWidth: number;
  radiusScale: number;
  riseScale: number;
  fingerPhase: number;
  seed: number;
}

/** Deterministic lobe count for a seed, inside the tuning's [min, max] band.
 *  Exported so tests can pin the "several unequal lobes" contract without
 *  reaching into the geometry, and `buildLobes` derives from the SAME value
 *  so the two cannot drift. */
export function impactSplashLobeCount(seed: number, tuning: ImpactSplashTuning = IMPACT_SPLASH_TUNING): number {
  const hi = Math.max(tuning.lobesMin, Math.min(tuning.lobesMax, IMPACT_SPLASH_MAX_LOBES));
  const lo = Math.max(1, Math.min(tuning.lobesMin, hi));
  const span = hi - lo + 1;
  return lo + Math.min(span - 1, Math.floor(splashHash01(seed, 1) * span));
}

/** Deterministic lobe layout: jittered, sorted azimuths so the crown has
 *  UNEQUAL lobes with no fixed seam. Pure in (seed, count). */
function buildLobes(seed: number, tuning: ImpactSplashTuning): Lobe[] {
  const count = impactSplashLobeCount(seed, tuning);
  const tau = Math.PI * 2;
  const azimuths: { a: number; l: number }[] = [];
  for (let l = 0; l < count; l++) {
    const base = ((l + 0.5) / count) * tau;
    const jitter = (splashHash01(seed, 2 + l * 7) - 0.5) * (tau / count) * 0.85;
    azimuths.push({ a: base + jitter, l });
  }
  azimuths.sort((p, q) => p.a - q.a);
  return azimuths.map(({ a, l }) => ({
    azimuth: a,
    halfWidth: lerp(tuning.angularSpreadMin, tuning.angularSpreadMax, splashHash01(seed, 3 + l * 7)),
    radiusScale: lerp(0.70, 1.18, splashHash01(seed, 4 + l * 7)),
    riseScale: lerp(0.72, 1.22, splashHash01(seed, 5 + l * 7)),
    fingerPhase: splashHash01(seed, 6 + l * 7) * tau,
    seed: splashHash01(seed, 7 + l * 7),
  }));
}

/** Time-dependent crown scales, all pure functions of elapsed time. */
function crownScales(t: number, tuning: ImpactSplashTuning): {
  radius: number; rise: number; curl: number; gravity: number; progress: number; dissolve: number;
} {
  const te = clamp01(t / Math.max(1e-6, tuning.expandSec));
  // Ease-out cubic: fast at first, slowing into the cap — the expansion
  // envelope the brief asks for, not linear growth.
  const expand = 1 - Math.pow(1 - te, 3);
  const radius = tuning.radiusMax * (0.06 + 0.94 * expand);
  const rise = tuning.riseMax * (1 - Math.pow(1 - te, 2));
  const afterDroop = Math.max(0, t - tuning.droopStartSec);
  const curl = tuning.curlGain * afterDroop * afterDroop;
  const gravity = tuning.gravityGain * afterDroop * afterDroop;
  const progress = clamp01(t / Math.max(1e-6, tuning.lifetimeSec));
  const dissolve = smooth01((progress - tuning.dissolveStart) / Math.max(1e-6, tuning.dissolveEnd - tuning.dissolveStart));
  return { radius, rise, curl, gravity, progress, dissolve };
}

/**
 * Local crown point for a lobe at (s radial 0..1, a angular -1..1), before the
 * world transform. Exported shape maths is kept internal; tests assert the
 * transformed world result instead.
 */
function localPoint(
  lobe: Lobe, s: number, a: number, radius: number, rise: number, curl: number,
  tuning: ImpactSplashTuning,
): [number, number, number] {
  // Narrow at the root, broad at the rim: a fan, not a rectangle.
  const width = 0.32 + 0.68 * s;
  const azimuth = lobe.azimuth + a * lobe.halfWidth * width + tuning.twist * s;
  const finger = 1 + tuning.fingerAmp
    * Math.sin(a * tuning.fingerFreq * Math.PI + lobe.fingerPhase + s * 1.3);
  const r = radius * lobe.radiusScale * finger * Math.pow(s, 0.82);
  const lip = rise * lobe.riseScale * Math.pow(s, 0.7);
  // Domed cross-section: the shell bows along the angular direction.
  const bow = tuning.bowAmp * s * (1 - a * a) * (0.55 + 0.45 * lobe.seed);
  return [Math.cos(azimuth) * r, Math.sin(azimuth) * r, lip + bow - curl * s * s];
}

function worldFromLocal(origin: Vec3, basis: { u: Vec3; v: Vec3; w: Vec3 }, lx: number, ly: number, lz: number, sag: number): [number, number, number] {
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
  const { radius, rise, curl, gravity, progress, dissolve } = crownScales(ev.time, tuning);
  const lobes = buildLobes(ev.seed, tuning);
  const rs = Math.max(2, Math.round(tuning.radialSegments));
  const as = Math.max(2, Math.round(tuning.angularSegments));
  const vertsPerLobe = (rs + 1) * (as + 1);
  const vertexCount = lobes.length * vertsPerLobe;
  const triangleCount = lobes.length * rs * as * 2;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const masks = new Float32Array(vertexCount);
  const lobeSeeds = new Float32Array(vertexCount);
  const indices = new Uint32Array(triangleCount * 3);

  // World point helper including the world-space gravity sag (rim sags most).
  const pointAt = (lobe: Lobe, s: number, a: number): [number, number, number] => {
    const l = localPoint(lobe, s, a, radius, rise, curl, tuning);
    return worldFromLocal(ev.origin, basis, l[0], l[1], l[2], gravity * s * s);
  };

  let v = 0;
  let ii = 0;
  for (let li = 0; li < lobes.length; li++) {
    const lobe = lobes[li]!;
    const base = v;
    for (let i = 0; i <= rs; i++) {
      const s = i / rs;
      for (let j = 0; j <= as; j++) {
        const a = -1 + (2 * j) / as;
        const p = pointAt(lobe, s, a);
        positions[v * 3] = p[0]; positions[v * 3 + 1] = p[1]; positions[v * 3 + 2] = p[2];
        // Smooth analytic normal by finite differences on the SAME surface,
        // guarded so a degenerate tangent pair falls back to the crown axis
        // (never NaN). The outward sign is chosen once; DoubleSide +
        // faceDirection handles the back face in the shader.
        const eps = 0.045;
        const s1 = Math.min(1, s + eps); const s0 = Math.max(0, s - eps);
        const a1 = Math.min(1, a + eps); const a0 = Math.max(-1, a - eps);
        const ps = pointAt(lobe, s1, a);
        const ps0 = pointAt(lobe, s0, a);
        const pa = pointAt(lobe, s, a1);
        const pa0 = pointAt(lobe, s, a0);
        const tsx = ps[0] - ps0[0]; const tsy = ps[1] - ps0[1]; const tsz = ps[2] - ps0[2];
        const tax = pa[0] - pa0[0]; const tay = pa[1] - pa0[1]; const taz = pa[2] - pa0[2];
        let nx = tsy * taz - tsz * tay;
        let ny = tsz * tax - tsx * taz;
        let nz = tsx * tay - tsy * tax;
        let nl = Math.hypot(nx, ny, nz);
        if (!(nl > 1e-9) || !Number.isFinite(nl)) { nx = basis.w[0]; ny = basis.w[1]; nz = basis.w[2]; nl = 1; }
        nx /= nl; ny /= nl; nz /= nl;
        if (nx * basis.w[0] + ny * basis.w[1] + nz * basis.w[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
        normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;
        uvs[v * 2] = s; uvs[v * 2 + 1] = (a + 1) / 2;
        // Seeded material-space mask: a function of (lobe, grid cell), so it
        // is identical for a given seed and cannot swim as the blood moves.
        masks[v] = 0.45 + 0.55 * splashHash01(ev.seed ^ 0x5bd1e995, li * 131 + i * 17 + j);
        lobeSeeds[v] = lobe.seed;
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

  // DETACHED DROPLETS. Each is born in the tear window at a rim point, then
  // integrates ballistically with real gravity. Sparse by budget.
  const dLo = Math.max(0, Math.min(tuning.dropletsMin, IMPACT_SPLASH_MAX_DROPLETS));
  const dHi = Math.max(dLo, Math.min(tuning.dropletsMax, IMPACT_SPLASH_MAX_DROPLETS));
  const dSpan = dHi - dLo + 1;
  const dCount = dLo + Math.min(dSpan - 1, Math.floor(splashHash01(ev.seed, 91) * dSpan));
  const droplets = new Float32Array(dCount * 4);
  let live = 0;
  const tearStart = Math.min(tuning.tearStartSec, tuning.tearEndSec);
  const tearEnd = Math.max(tuning.tearStartSec, tuning.tearEndSec);
  for (let k = 0; k < dCount; k++) {
    const birth = tearStart + splashHash01(ev.seed, 100 + k * 9) * (tearEnd - tearStart);
    if (ev.time < birth) continue;
    const lobe = lobes[Math.min(lobes.length - 1, Math.floor(splashHash01(ev.seed, 101 + k * 9) * lobes.length))]!;
    const a = -1 + 2 * splashHash01(ev.seed, 102 + k * 9);
    // LAUNCH POINT IS FROZEN AT BIRTH. The rim is evaluated with the crown
    // scales of `birth`, not the current time: a droplet detaches from where
    // the rim WAS and then flies ballistically. Evaluating the rim at the
    // current time would make droplets ride the expanding crown instead of
    // leaving it — the "detached" part of the brief.
    const birthScales = crownScales(birth, tuning);
    const birthLocal = localPoint(lobe, 1, a, birthScales.radius, birthScales.rise, birthScales.curl, tuning);
    const rim = worldFromLocal(ev.origin, basis, birthLocal[0], birthLocal[1], birthLocal[2], birthScales.gravity);
    // Radial-away launch in the crown's own frame, plus an outward up-kick
    // along the impact axis; gravity is the same real 9.8 the sim uses.
    let rx = rim[0] - ev.origin[0]; let ry = rim[1] - ev.origin[1]; let rz = rim[2] - ev.origin[2];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const speed = lerp(tuning.dropletSpeedMin, tuning.dropletSpeedMax, splashHash01(ev.seed, 103 + k * 9));
    const up = lerp(tuning.dropletUpMin, tuning.dropletUpMax, splashHash01(ev.seed, 104 + k * 9));
    const vx = rx * speed + basis.w[0] * up;
    const vy = ry * speed + basis.w[1] * up;
    const vz = rz * speed + basis.w[2] * up;
    const age = ev.time - birth;
    const px = rim[0] + vx * age;
    const py = rim[1] + vy * age - 0.5 * tuning.dropletGravity * age * age;
    const pz = rim[2] + vz * age;
    const size = lerp(tuning.dropletSizeMin, tuning.dropletSizeMax, splashHash01(ev.seed, 105 + k * 9));
    droplets[live * 4] = px; droplets[live * 4 + 1] = py; droplets[live * 4 + 2] = pz; droplets[live * 4 + 3] = size;
    live++;
  }

  return {
    positions, normals, uvs, masks, lobeSeeds, indices,
    droplets, dropletCount: live,
    vertexCount, triangleCount,
    progress, dissolve, basis,
  };
}

// -------------------------------------------------------------------------
// Material
// -------------------------------------------------------------------------

/**
 * Wet blood shading for the crown shell. `uvIn` is the sheet's own material
 * grid, so the tear cells and the ragged rim are attached to the material —
 * NOT to a world coordinate — and cannot swim as the effect moves. `maskIn`
 * carries the seeded per-vertex mask; `dissolve` opens the holes over the
 * back half of the event. The alpha is cut out by `alphaTest`, so torn edges
 * are crisp and write depth.
 *
 * wgslFn hygiene (the r185 traps pinned in this repo): ONE fn per source
 * string, the string starts at `fn`, and there are no parens or colons in
 * any leading comment.
 */
export const SPLASH_SHADE_WGSL = /* wgsl */ `fn splashShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, uvIn: vec2<f32>, lobeSeed: f32, maskIn: f32, dissolve: f32, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>) -> vec4<f32> {
  let cells = floor(uvIn * vec2<f32>(7.0, 5.0) + vec2<f32>(lobeSeed * 13.7, lobeSeed * 7.3));
  let h = fract(sin(dot(cells, vec2<f32>(12.9898, 78.233)) + lobeSeed * 17.0) * 43758.5453);
  let edge = 1.0 - smoothstep(0.70, 1.02, uvIn.x + (h - 0.5) * 0.34);
  let cut = 0.06 + dissolve * 1.20;
  let x = maskIn * 0.55 + h * 0.45;
  let holes = 1.0 - smoothstep(cut - 0.10, cut + 0.10, x);
  let alpha = clamp(edge * (1.0 - holes), 0.0, 1.0);
  let V = normalize(camPos - p);
  let L = normalize(lightDir);
  let ndl = max(dot(n, L), 0.0);
  let H = normalize(L + V);
  let wet = clamp(maskIn, 0.0, 1.0);
  let shine = pow(max(dot(n, H), 0.0), 96.0);
  let fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  let base = vec3<f32>(0.46, 0.025, 0.04);
  let deep = vec3<f32>(0.14, 0.004, 0.008);
  let diffuse = mix(deep, base, 0.30 + 0.70 * wet) * (0.10 + lightCfg.x * ndl) * keyColor;
  let spec = keyColor * (shine * (0.9 + 1.7 * wet) + fres * 0.30);
  return vec4<f32>(diffuse + spec, alpha);
}`;

type SplashUniform = ReturnType<typeof uniform>;

export interface ImpactSplashLightRig {
  lightDir: SplashUniform;
  keyColor: SplashUniform;
  lightCfg: SplashUniform;
}

export interface ImpactSplashLayer {
  /** Add to the scene. A Group holding the crown sheet and the droplets. */
  readonly object: THREE.Object3D;
  /** Live event count. */
  readonly eventCount: number;
  readonly vertexCount: number;
  readonly dropletCount: number;
  /** Production event API: emit one impact. `direction` is the OUTWARD wound
   *  normal. Returns the event so a caller can hold and inspect it. */
  emit(origin: Vec3, direction: Vec3, seed: number, options?: ImpactSplashEventOptions): ImpactSplashEvent;
  /** Advance every live event; dead events are removed. */
  step(dt: number): void;
  /** Drop every live event (e.g. before re-emitting on a seed change). */
  clear(): void;
  /** Rebuild the geometry from the current event list. Call once per frame,
   *  after the camera is final. `camera` is accepted for parity with the
   *  other views and reserved for future billboard work; geometry is
   *  world-space and does not currently depend on it. */
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
 * The renderer-side layer: one preallocated crown sheet plus a droplet
 * instancer, both shaded by the same wet node material. The geometry buffers
 * are sized at the worst case (`IMPACT_SPLASH_MAX_EVENTS` x the max grid) and
 * only the drawn range changes, so emitting cannot grow memory.
 */
export function createImpactSplashLayer(options: { rig?: ImpactSplashLightRig } = {}): ImpactSplashLayer {
  const rig = options.rig ?? defaultRig();
  const uDissolve = uniform(0);

  const maxVertsPerEvent = IMPACT_SPLASH_MAX_LOBES
    * (Math.max(2, IMPACT_SPLASH_TUNING.radialSegments) + 1)
    * (Math.max(2, IMPACT_SPLASH_TUNING.angularSegments) + 1);
  const maxVerts = maxVertsPerEvent * IMPACT_SPLASH_MAX_EVENTS;
  const maxIndices = IMPACT_SPLASH_MAX_EVENTS * IMPACT_SPLASH_MAX_LOBES
    * Math.max(2, IMPACT_SPLASH_TUNING.radialSegments)
    * Math.max(2, IMPACT_SPLASH_TUNING.angularSegments) * 6;

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
  const nrmAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
  const uvAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 2), 2);
  const maskAttr = new THREE.BufferAttribute(new Float32Array(maxVerts), 1);
  const seedAttr = new THREE.BufferAttribute(new Float32Array(maxVerts), 1);
  const idxAttr = new THREE.BufferAttribute(new Uint32Array(maxIndices), 1);
  for (const a of [posAttr, nrmAttr, uvAttr, maskAttr, seedAttr, idxAttr]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', nrmAttr);
  geometry.setAttribute('splashUv', uvAttr);
  geometry.setAttribute('splashMask', maskAttr);
  geometry.setAttribute('splashSeed', seedAttr);
  geometry.setIndex(idxAttr);
  geometry.setDrawRange(0, 0);
  // The crown is a world-space bounded region; skip per-frame frustum culling
  // so a large translated event can never be culled by a stale bounds sphere.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const shadeFn = wgslFn(SPLASH_SHADE_WGSL);
  const sheetMaterial = new MeshBasicNodeMaterial();
  const sheetShaded = shadeFn({
    p: positionWorld,
    n: normalWorld.mul(faceDirection),
    camPos: cameraPosition,
    uvIn: attribute('splashUv', 'vec2'),
    lobeSeed: attribute('splashSeed', 'float'),
    maskIn: attribute('splashMask', 'float'),
    dissolve: uDissolve,
    lightDir: rig.lightDir,
    keyColor: rig.keyColor,
    lightCfg: rig.lightCfg,
  }) as unknown as { xyz: unknown; w: unknown };
  sheetMaterial.colorNode = vec4(sheetShaded.xyz as never, sheetShaded.w as never) as never;
  sheetMaterial.side = THREE.DoubleSide;
  sheetMaterial.alphaTest = 0.5;
  sheetMaterial.depthWrite = true;
  sheetMaterial.depthTest = true;
  sheetMaterial.transparent = false;
  sheetMaterial.fog = false;

  const sheet = new THREE.Mesh(geometry, sheetMaterial);
  sheet.frustumCulled = false;
  sheet.renderOrder = 1;

  // Droplets share the same wet shading family with constants so they need no
  // splash attributes; their normals come from the sphere geometry.
  const dropletShaded = shadeFn({
    p: positionWorld,
    n: normalWorld.mul(faceDirection),
    camPos: cameraPosition,
    uvIn: vec2(0.5, 0.5),
    lobeSeed: float(0.0),
    maskIn: float(1.0),
    dissolve: float(0.0),
    lightDir: rig.lightDir,
    keyColor: rig.keyColor,
    lightCfg: rig.lightCfg,
  }) as unknown as { xyz: unknown; w: unknown };
  const dropletMaterial = new MeshBasicNodeMaterial();
  dropletMaterial.colorNode = vec4(dropletShaded.xyz as never, dropletShaded.w as never) as never;
  dropletMaterial.side = THREE.FrontSide;
  dropletMaterial.alphaTest = 0.5;
  dropletMaterial.depthWrite = true;
  dropletMaterial.depthTest = true;
  dropletMaterial.transparent = false;
  dropletMaterial.fog = false;

  const dropletGeom = new THREE.IcosahedronGeometry(1, 1);
  const droplets = new THREE.InstancedMesh(dropletGeom, dropletMaterial, IMPACT_SPLASH_MAX_DROPLETS * IMPACT_SPLASH_MAX_EVENTS);
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
  const s = new THREE.Vector3();

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
    const uv = uvAttr.array as Float32Array;
    const msk = maskAttr.array as Float32Array;
    const sed = seedAttr.array as Float32Array;
    const idx = idxAttr.array as Uint32Array;
    let vOff = 0;
    let iOff = 0;
    let vBase = 0;
    let dOff = 0;
    let maxDissolve = 0;
    for (const ev of events) {
      const frame = buildImpactSplashFrame(ev);
      if (!frame) continue;
      const vCount = frame.vertexCount;
      const iCount = frame.indices.length;
      if (vOff + vCount > maxVerts || iOff + iCount > maxIndices) break;
      pos.set(frame.positions, vOff * 3);
      nrm.set(frame.normals, vOff * 3);
      uv.set(frame.uvs, vOff * 2);
      msk.set(frame.masks, vOff);
      sed.set(frame.lobeSeeds, vOff);
      for (let k = 0; k < iCount; k++) idx[iOff + k] = frame.indices[k]! + vBase;
      vOff += vCount;
      iOff += iCount;
      vBase += vCount;
      // Droplets into the instance matrices. The loop bound is the BUFFER
      // capacity, never `droplets.count` (the previous frame's draw count,
      // which may be smaller and would silently drop this frame's droplets).
      const dCount = Math.min(frame.dropletCount, IMPACT_SPLASH_MAX_DROPLETS);
      for (let k = 0; k < dCount && dOff < droplets.instanceMatrix.count; k++) {
        p.set(frame.droplets[k * 4]!, frame.droplets[k * 4 + 1]!, frame.droplets[k * 4 + 2]!);
        const sz = frame.droplets[k * 4 + 3]!;
        s.set(sz, sz, sz);
        m.compose(p, q, s);
        droplets.setMatrixAt(dOff, m);
        dOff++;
      }
      maxDissolve = Math.max(maxDissolve, frame.dissolve);
    }
    const dropletSlots = dOff;
    while (dOff < droplets.instanceMatrix.count) { droplets.setMatrixAt(dOff, zero); dOff++; }
    droplets.instanceMatrix.needsUpdate = true;
    droplets.count = Math.max(0, Math.min(droplets.instanceMatrix.count, dropletSlots));
    geometry.setDrawRange(0, iOff);
    posAttr.needsUpdate = true; nrmAttr.needsUpdate = true; uvAttr.needsUpdate = true;
    maskAttr.needsUpdate = true; seedAttr.needsUpdate = true; idxAttr.needsUpdate = true;
    uDissolve.value = maxDissolve;
    lastVertexCount = vOff;
  }

  return {
    object: group,
    get eventCount() { return events.length; },
    get vertexCount() { return lastVertexCount; },
    get dropletCount() { return droplets.count; },
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
