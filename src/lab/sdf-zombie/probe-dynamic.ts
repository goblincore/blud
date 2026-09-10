/**
 * Dynamic probe layer — the CPU twin of the per-frame GPU gather.
 *
 * WHY THIS FILE EXISTS. The static grid (`./probe-grid.ts`) is baked once and
 * holds only the level's ambient. This layer is gathered EVERY frame and holds
 * what moves: the muzzle flash's radiance (bodies shadow it) and a body
 * visibility term so a probe under a body darkens its neighbourhood. It shares
 * the static grid's inset box and dims, and its storage stride is four vec4 per
 * probe (three of radiance in the static packing, one of scalar visibility).
 *
 * THE HOUSE PATTERN. The per-ray maths lives twice: here, where vitest can
 * property-test it, and in `webgpu/probe-dynamic.wgsl.ts`, where it runs as a
 * compute kernel. The WGSL is pinned by source-text and parse tests so the two
 * cannot drift silently. Change one, change both. This file deliberately
 * imports NOTHING from the webgpu tree so it stays dependency-free and usable
 * from a worker.
 *
 * THE LIGHT MODEL. `radiance = albedo * sum_lights I * color * max(N.L, 0) /
 * d^2`, shadowed by body capsules and furniture boxes. That is deliberately
 * NOT the static gather's `1 + (d/REF)^2` falloff: a flash is a real point
 * light and the inverse square is the whole read. The enclosure box (kind 0,
 * the ray EXITS it) is the room the light is in, so it never shadows a light;
 * only capsules and occluder boxes (kind 1, the ray ENTERS) do.
 */

import type { Box } from './ambient';
import type { Vec3 } from './types';
import {
  fibonacciSphere,
  hitAabbEntry,
  hitEnclosure,
  irradianceL1,
  probePosition,
  projectL1,
  type ProbeGrid,
  type ShSample,
} from './probe-grid';

export type { Box, Vec3 };

/** `Vec3` is readonly; accumulators below are plain mutable triples. */
type Mut3 = [number, number, number];

/** Storage stride: four vec4 per probe. */
export const DYN_VEC4_PER_PROBE = 4;
/** Flat float stride per probe (four vec4). */
export const DYN_FLOATS_PER_PROBE = DYN_VEC4_PER_PROBE * 4;
/** The kernel's hard per-probe ray cap (`min(u32(cfg.y), 64u)`). */
export const DYN_RAY_CAP = 64;

/**
 * The Fibonacci lattice's golden angle and a full turn. Exported so the WGSL
 * pin test can assert the exact literals in `K_PROBE_GATHER` — the one place
 * the two copies of the ray set are allowed to share a number.
 */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const TWO_PI = Math.PI * 2;

/**
 * `bone-instancer.ts`'s `INSTANCE_FLOATS`. Pinned there by
 * `probe-dynamic.test.ts` (test-only import) so this file stays free of the
 * webgpu tree: a-b and b-c are the two capsules of one bent bone.
 */
export const BONE_INSTANCE_FLOATS = 18;

const ZERO: Vec3 = [0, 0, 0];
const NO_SH = new Float32Array(0);
/** Lift a shadow ray off the surface so it cannot re-enter its own box. */
const SHADOW_EPS = 1e-4;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalize3(v: Mut3): Mut3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}

// ---------------------------------------------------------------------------
// Ray-capsule
// ---------------------------------------------------------------------------

export interface CapsuleHit {
  t: number;
  point: Vec3;
  normal: Vec3;
}

/**
 * Nearest positive ENTRY of a ray into a capsule (swept sphere) from OUTSIDE.
 *
 * Standard quadratic against the infinite cylinder plus the two sphere caps;
 * the nearest valid candidate wins. A ray that starts inside or on the capsule
 * returns null: an occluder you are inside blocks nothing, so a body wrapping
 * a probe must not darken it from within.
 */
export function hitCapsule(
  origin: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  r: number,
  tMax = Infinity,
): CapsuleHit | null {
  const ba: Mut3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pa: Mut3 = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const baba = dot(ba, ba);

  // BOUNDING-SPHERE REJECT FIRST (2026-09-10). The capsule is contained in the
  // sphere centred on the segment midpoint with radius |ba|/2 + r, so a ray
  // that misses that sphere CANNOT hit the capsule, and one whose sphere exit
  // is behind the origin cannot have a positive entry either. Both are exact
  // miss conditions, and they cost one dot, one dot and at most one sqrt —
  // against the ~15 operations plus three sqrts the full quadratic below pays.
  //
  // This is where the sweep's cost actually goes: the gather walks up to 1024
  // capsules per shadow ray and most of them are nowhere near the ray, so the
  // reject fires on the large majority and the exact maths is never reached.
  // `tMax` additionally lets a caller with a running best (or a light
  // distance) retire a capsule it could not beat.
  {
    const mx = a[0] + ba[0] * 0.5, my = a[1] + ba[1] * 0.5, mz = a[2] + ba[2] * 0.5;
    const R = 0.5 * Math.sqrt(baba) + r;
    const ocx = origin[0] - mx, ocy = origin[1] - my, ocz = origin[2] - mz;
    const bq = ocx * dir[0] + ocy * dir[1] + ocz * dir[2];
    const cq = ocx * ocx + ocy * ocy + ocz * ocz - R * R;
    const disc = bq * bq - cq;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    if (sq - bq < 0) return null;          // the whole sphere is behind the origin
    if (-bq - sq > tMax) return null;      // entered only beyond the caller's bound
  }

  // Inside/on test: distance from the origin to the segment a-b.
  const s = baba > 1e-18 ? clamp(dot(pa, ba) / baba, 0, 1) : 0;
  const cx = origin[0] - (a[0] + ba[0] * s);
  const cy = origin[1] - (a[1] + ba[1] * s);
  const cz = origin[2] - (a[2] + ba[2] * s);
  if (cx * cx + cy * cy + cz * cz < r * r) return null;

  let bestT = Infinity;
  let bestPoint: Mut3 | null = null;
  let bestNormal: Mut3 | null = null;

  if (baba > 1e-18) {
    const bard = dot(ba, dir);
    const baoa = dot(ba, pa);
    const rdoa = dot(dir, pa);
    const oaoa = dot(pa, pa);
    const qa = baba - bard * bard;
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - r * r * baba;
    if (qa > 1e-18) {
      const h = qb * qb - qa * qc;
      if (h >= 0) {
        const t = (-qb - Math.sqrt(h)) / qa;
        const y = baoa + t * bard;
        if (t > 0 && t < tMax && y >= 0 && y <= baba) {
          const p: Mut3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
          const sa = y / baba;
          const n = normalize3([
            p[0] - (a[0] + ba[0] * sa),
            p[1] - (a[1] + ba[1] * sa),
            p[2] - (a[2] + ba[2] * sa),
          ]);
          bestT = t; bestPoint = p; bestNormal = n;
        }
      }
    }
  }

  // Sphere caps. The nearest cap entry can beat the cylinder on a diagonal.
  for (const c of [a, b]) {
    const oc: Mut3 = [origin[0] - c[0], origin[1] - c[1], origin[2] - c[2]];
    const bq = dot(oc, dir);
    const cq = dot(oc, oc) - r * r;
    const disc = bq * bq - cq;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t <= 0 || t >= bestT || t >= tMax) continue;
    const p: Mut3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    bestT = t;
    bestPoint = p;
    bestNormal = normalize3([p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  }

  if (bestPoint === null || bestNormal === null) return null;
  return { t: bestT, point: bestPoint, normal: bestNormal };
}

/**
 * ANY-HIT within `dist` — the shadow-ray question, and all it is.
 *
 * `hitCapsule` answers "where is the nearest entry", so it must scan every
 * capsule to prove none is nearer. A shadow ray does not care where: it cares
 * only whether SOMETHING blocks before the light, so it can return on the first
 * blocker and retire every capsule it passes. `dist` doubles as the bound, so
 * capsules whose entry lies beyond the light are rejected without the
 * quadratic — the same `tMax` reject `hitCapsule` now applies.
 *
 * Same entry semantics as `hitCapsule` (a ray starting inside a capsule is not
 * blocked by it), so the answer is identical; only the work differs.
 */
export function capsuleBlocks(
  origin: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  r: number,
  dist: number,
): boolean {
  const ba: Mut3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const pa: Mut3 = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const baba = dot(ba, ba);

  // Bounding-sphere reject, bounded by the light distance — see hitCapsule.
  {
    const mx = a[0] + ba[0] * 0.5, my = a[1] + ba[1] * 0.5, mz = a[2] + ba[2] * 0.5;
    const R = 0.5 * Math.sqrt(baba) + r;
    const ocx = origin[0] - mx, ocy = origin[1] - my, ocz = origin[2] - mz;
    const bq = ocx * dir[0] + ocy * dir[1] + ocz * dir[2];
    const cq = ocx * ocx + ocy * ocy + ocz * ocz - R * R;
    const disc = bq * bq - cq;
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    if (sq - bq < 0) return false;
    if (-bq - sq > dist) return false;
  }

  const s = baba > 1e-18 ? clamp(dot(pa, ba) / baba, 0, 1) : 0;
  const cx = origin[0] - (a[0] + ba[0] * s);
  const cy = origin[1] - (a[1] + ba[1] * s);
  const cz = origin[2] - (a[2] + ba[2] * s);
  if (cx * cx + cy * cy + cz * cz < r * r) return false;

  if (baba > 1e-18) {
    const bard = dot(ba, dir);
    const baoa = dot(ba, pa);
    const rdoa = dot(dir, pa);
    const oaoa = dot(pa, pa);
    const qa = baba - bard * bard;
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - r * r * baba;
    if (qa > 1e-18) {
      const h = qb * qb - qa * qc;
      if (h >= 0) {
        const t = (-qb - Math.sqrt(h)) / qa;
        const y = baoa + t * bard;
        if (t > 0 && t < dist && y >= 0 && y <= baba) return true;
      }
    }
  }

  for (const c of [a, b]) {
    const oc: Mut3 = [origin[0] - c[0], origin[1] - c[1], origin[2] - c[2]];
    const bq = dot(oc, dir);
    const cq = dot(oc, oc) - r * r;
    const disc = bq * bq - cq;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < dist) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CPU-side packing
// ---------------------------------------------------------------------------

/**
 * Pack the scene boxes. Layout: `[count,0,0,0]`, then three vec4 per box —
 * `min.xyz, kind` (0 = enclosure, the ray exits it; 1 = occluder, the ray
 * enters), `max.xyz, 0`, `albedo.rgb, 0`. The enclosure is always index 0.
 */
export function packBoxes(
  enclosure: Box,
  wallAlbedo: Vec3,
  occluders: { box: Box; albedo: Vec3 }[],
  out: Float32Array,
): number {
  const count = 1 + occluders.length;
  const needed = 4 + count * 12;
  if (out.length < needed) {
    throw new Error(`packBoxes: capacity ${out.length} floats < ${needed}`);
  }
  out[0] = count;
  let o = 4;
  const write = (box: Box, albedo: Vec3, kind: number): void => {
    out[o + 0] = box.min[0]; out[o + 1] = box.min[1]; out[o + 2] = box.min[2]; out[o + 3] = kind;
    out[o + 4] = box.max[0]; out[o + 5] = box.max[1]; out[o + 6] = box.max[2]; out[o + 7] = 0;
    out[o + 8] = albedo[0]; out[o + 9] = albedo[1]; out[o + 10] = albedo[2]; out[o + 11] = 0;
    o += 12;
  };
  write(enclosure, wallAlbedo, 0);
  for (const occ of occluders) write(occ.box, occ.albedo, 1);
  return count;
}

function writeCapsule(out: Float32Array, o: number, a: Vec3, b: Vec3, r: number): number {
  out[o + 0] = a[0]; out[o + 1] = a[1]; out[o + 2] = a[2]; out[o + 3] = r;
  out[o + 4] = b[0]; out[o + 5] = b[1]; out[o + 6] = b[2]; out[o + 7] = 0;
  return o + 8;
}

/**
 * Turn the bone instancer's packed rows into capsules: per instance two
 * capsules a-b and b-c, each with `r = max(r1, r2) * max(scale) + margin`.
 * The flesh margin is what makes a bone read as a body, not a stick.
 * Layout: `[count,0,0,0]`, then two vec4 per capsule — `a.xyz, r`, `b.xyz, 0`.
 */
export function packCapsulesFromBoneInstances(
  ab: Float32Array,
  count: number,
  margin: number,
  out: Float32Array,
  max: number,
): number {
  const n = count * 2;
  if (n > max) {
    throw new Error(`packCapsulesFromBoneInstances: ${n} capsules exceed max ${max}`);
  }
  if (out.length < 4 + n * 8) {
    throw new Error(`packCapsulesFromBoneInstances: capacity ${out.length} floats < ${4 + n * 8}`);
  }
  out[0] = n;
  let o = 4;
  for (let i = 0; i < count; i++) {
    const base = i * BONE_INSTANCE_FLOATS;
    const a: Vec3 = [ab[base + 0]!, ab[base + 1]!, ab[base + 2]!];
    const b: Vec3 = [ab[base + 3]!, ab[base + 4]!, ab[base + 5]!];
    const c: Vec3 = [ab[base + 6]!, ab[base + 7]!, ab[base + 8]!];
    const r1 = ab[base + 9]!;
    const r2 = ab[base + 10]!;
    const scale = Math.max(ab[base + 11]!, ab[base + 12]!, ab[base + 13]!);
    const r = Math.max(r1, r2) * scale + margin;
    o = writeCapsule(out, o, a, b, r);
    o = writeCapsule(out, o, b, c, r);
  }
  return n;
}

/** Floats per packed light: three vec4. */
export const LIGHT_FLOATS = 12;
/** cosOuter value that marks a POINT light (no cone). Any cosine is > -1. */
export const LIGHT_NO_CONE = -2;

export interface DynLightInput {
  pos: Vec3; color: Vec3; intensity: number;
  /** SPOT lights: unit beam axis pointing away from the lamp, plus the cone
   *  cosines the analytic beam uses (inner >= outer). Omit for a point light. */
  axis?: Vec3; cosInner?: number; cosOuter?: number;
}

/**
 * Pack the frame's lights. Layout: `[count,0,0,0]`, then THREE vec4 per
 * light — `pos.xyz, intensity`, `color.rgb, cosOuter`, `axis.xyz, cosInner`.
 * A point light writes cosOuter = LIGHT_NO_CONE and a zero axis; the gather
 * then applies no cone falloff. A spot applies the analytic beam's
 * `coneFall^2` (see MARCH_BODY_LIGHT) on top of the inverse square.
 */
export function packLights(
  lights: DynLightInput[],
  out: Float32Array,
): number {
  const count = lights.length;
  const needed = 4 + count * LIGHT_FLOATS;
  if (out.length < needed) {
    throw new Error(`packLights: capacity ${out.length} floats < ${needed}`);
  }
  out[0] = count;
  let o = 4;
  for (const l of lights) {
    const spot = l.axis !== undefined && l.cosOuter !== undefined && l.cosInner !== undefined;
    out[o + 0] = l.pos[0]; out[o + 1] = l.pos[1]; out[o + 2] = l.pos[2]; out[o + 3] = l.intensity;
    out[o + 4] = l.color[0]; out[o + 5] = l.color[1]; out[o + 6] = l.color[2];
    out[o + 7] = spot ? l.cosOuter! : LIGHT_NO_CONE;
    out[o + 8] = spot ? l.axis![0] : 0; out[o + 9] = spot ? l.axis![1] : 0; out[o + 10] = spot ? l.axis![2] : 0;
    out[o + 11] = spot ? l.cosInner! : LIGHT_NO_CONE;
    o += LIGHT_FLOATS;
  }
  return count;
}

/** Per-float lerp of the new gather into the previous frame's buffer. */
export function blendDynamic(prev: Float32Array, next: Float32Array, blend: number, out: Float32Array): void {
  const n = Math.min(prev.length, next.length, out.length);
  for (let i = 0; i < n; i++) out[i] = prev[i]! * (1 - blend) + next[i]! * blend;
}

/**
 * The kernel's AFTERGLOW blend, per probe (16 floats): the radiance record
 * (floats 0-11) rises at `rise` when its L00 luminance increases and falls at
 * `fall` otherwise; visibility (12-15) always blends at `rise`. A 0.14 s
 * muzzle flash blended symmetrically was a two-frame flicker on a body.
 */
export function blendDynamicAfterglow(
  prev: Float32Array, next: Float32Array, rise: number, fall: number, out: Float32Array,
): void {
  const probes = Math.floor(Math.min(prev.length, next.length, out.length) / 16);
  for (let p = 0; p < probes; p++) {
    const o = p * 16;
    const lumNew = 0.2126 * next[o]! + 0.7152 * next[o + 1]! + 0.0722 * next[o + 2]!;
    const lumPrev = 0.2126 * prev[o]! + 0.7152 * prev[o + 1]! + 0.0722 * prev[o + 2]!;
    const rate = lumNew > lumPrev ? rise : fall;
    for (let i = 0; i < 12; i++) out[o + i] = prev[o + i]! * (1 - rate) + next[o + i]! * rate;
    for (let i = 12; i < 16; i++) out[o + i] = prev[o + i]! * (1 - rise) + next[o + i]! * rise;
  }
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

export interface DynGrid {
  dims: [number, number, number];
  min: Vec3;
  max: Vec3;
}

export interface DynScene {
  /** `packBoxes` layout. */
  boxes: Float32Array;
  /** `packCapsulesFromBoneInstances` layout. */
  capsules: Float32Array;
  /** `packLights` layout. */
  lights: Float32Array;
}

export interface DynGatherConfig {
  /** Directions per probe; capped at `DYN_RAY_CAP` exactly like the kernel. */
  raysPerProbe: number;
  /** 0..1, rotates the ray set about +Y by `frameSeed * 2pi`. */
  frameSeed: number;
}

export interface DynProbe {
  /** Twelve L1 coefficients, static packing `[L00.rgb, L1-1.rgb, L10.rgb, L11.rgb]`. */
  radiance: number[];
  /** `[V00, V1-1, V10, V11]` for the scalar visibility field. */
  visibility: number[];
}

function countOf(buf: Float32Array): number {
  return buf.length >= 4 ? Math.max(0, buf[0]! | 0) : 0;
}

/**
 * The per-frame Fibonacci set, rotated about +Y by `frameSeed * 2pi` so the
 * estimate does not strobe as the seed walks. Mirrors the WGSL `kdFibonacci`
 * bit for bit: `theta = golden * i + seed * 2pi`.
 */
function dynRaySet(n: number, frameSeed: number): Vec3[] {
  const base = fibonacciSphere(n, 0);
  const angle = frameSeed * TWO_PI;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return base.map(([x, y, z]) => [x * c - z * s, y, x * s + z * c]);
}

interface DynHit {
  t: number;
  point: Vec3;
  normal: Vec3;
  albedo: Vec3;
  isCapsule: boolean;
}

/** Nearest of the enclosure exit, every occluder entry and every capsule. */
function nearestDynHit(
  origin: Vec3,
  dir: Vec3,
  boxes: Float32Array,
  nBoxes: number,
  capsules: Float32Array,
  nCaps: number,
): DynHit | null {
  let best: DynHit | null = null;
  for (let b = 0; b < nBoxes; b++) {
    const base = 4 + b * 12;
    const kind = boxes[base + 3]!;
    const box: Box = {
      min: [boxes[base + 0]!, boxes[base + 1]!, boxes[base + 2]!],
      max: [boxes[base + 4]!, boxes[base + 5]!, boxes[base + 6]!],
    };
    const albedo: Vec3 = [boxes[base + 8]!, boxes[base + 9]!, boxes[base + 10]!];
    const h = kind < 0.5 ? hitEnclosure(origin, dir, box) : hitAabbEntry(origin, dir, box);
    if (h !== null && (best === null || h.t < best.t)) {
      best = { t: h.t, point: h.point, normal: h.normal, albedo, isCapsule: false };
    }
  }
  for (let c = 0; c < nCaps; c++) {
    const base = 4 + c * 8;
    const a: Vec3 = [capsules[base + 0]!, capsules[base + 1]!, capsules[base + 2]!];
    const r = capsules[base + 3]!;
    const b: Vec3 = [capsules[base + 4]!, capsules[base + 5]!, capsules[base + 6]!];
    const h = hitCapsule(origin, dir, a, b, r);
    if (h !== null && (best === null || h.t < best.t)) {
      best = { t: h.t, point: h.point, normal: h.normal, albedo: ZERO, isCapsule: true };
    }
  }
  return best;
}

/** True when a body capsule or a furniture box blocks the segment to a light. */
function dynShadowed(
  origin: Vec3,
  dir: Vec3,
  dist: number,
  capsules: Float32Array,
  nCaps: number,
  boxes: Float32Array,
  nBoxes: number,
): boolean {
  for (let c = 0; c < nCaps; c++) {
    const base = 4 + c * 8;
    const a: Vec3 = [capsules[base + 0]!, capsules[base + 1]!, capsules[base + 2]!];
    const r = capsules[base + 3]!;
    const b: Vec3 = [capsules[base + 4]!, capsules[base + 5]!, capsules[base + 6]!];
    // ANY-HIT, bounded by the light distance (2026-09-10) — not a nearest
    // search. Returning on the first blocker retires the rest of the list, and
    // the bound rejects capsules entered beyond the light without the
    // quadratic. The answer is identical to `hitCapsule(...) !== null &&
    // h.t < dist`; only the work differs. This is the gather's hottest path:
    // it runs once per LIGHT per ray, so up to 8 times per ray.
    if (capsuleBlocks(origin, dir, a, b, r, dist)) return true;
  }
  for (let b = 0; b < nBoxes; b++) {
    const base = 4 + b * 12;
    if (boxes[base + 3]! < 0.5) continue; // the enclosure is the light's own room
    const box: Box = {
      min: [boxes[base + 0]!, boxes[base + 1]!, boxes[base + 2]!],
      max: [boxes[base + 4]!, boxes[base + 5]!, boxes[base + 6]!],
    };
    const h = hitAabbEntry(origin, dir, box);
    if (h !== null && h.t < dist) return true;
  }
  return false;
}

/** `albedo * sum_lights I * color * max(N.L, 0) / d^2`, shadowed. */
function dynSurfaceRadiance(
  albedo: Vec3,
  point: Vec3,
  normal: Vec3,
  lights: Float32Array,
  capsules: Float32Array,
  nCaps: number,
  boxes: Float32Array,
  nBoxes: number,
): Vec3 {
  const out: Mut3 = [0, 0, 0];
  const nLights = countOf(lights);
  const ox = point[0] + normal[0] * SHADOW_EPS;
  const oy = point[1] + normal[1] * SHADOW_EPS;
  const oz = point[2] + normal[2] * SHADOW_EPS;
  for (let l = 0; l < nLights; l++) {
    const base = 4 + l * LIGHT_FLOATS;
    const px = lights[base + 0]!;
    const py = lights[base + 1]!;
    const pz = lights[base + 2]!;
    const intensity = lights[base + 3]!;
    const dx = px - point[0];
    const dy = py - point[1];
    const dz = pz - point[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-12) continue;
    const d = Math.sqrt(d2);
    const inv = 1 / d;
    const lx = dx * inv;
    const ly = dy * inv;
    const lz = dz * inv;
    const ndl = normal[0] * lx + normal[1] * ly + normal[2] * lz;
    if (ndl <= 0) continue;
    if (dynShadowed([ox, oy, oz], [lx, ly, lz], d, capsules, nCaps, boxes, nBoxes)) continue;
    // Spot cone, mirroring the analytic beam: cos between the beam axis and
    // the direction lamp -> point (which is -l), squared falloff between the
    // outer and inner cosines. A point light has cosOuter = LIGHT_NO_CONE.
    let cone = 1;
    const cosOuter = lights[base + 7]!;
    if (cosOuter > -1.5) {
      const cosInner = lights[base + 11]!;
      const c = -(lx * lights[base + 8]! + ly * lights[base + 9]! + lz * lights[base + 10]!);
      const t = Math.min(1, Math.max(0, (c - cosOuter) / Math.max(cosInner - cosOuter, 1e-4)));
      cone = t * t;
      if (cone <= 0) continue;
    }
    const f = (intensity * ndl * cone) / d2;
    out[0] += albedo[0] * lights[base + 4]! * f;
    out[1] += albedo[1] * lights[base + 5]! * f;
    out[2] += albedo[2] * lights[base + 6]! * f;
  }
  return [out[0], out[1], out[2]];
}

/**
 * Gather one probe: the spec's per-ray rule, projected to L1. A capsule hit is
 * visibility 0 and radiance 0; a box hit is visibility 1 and the shadowed
 * light sum at the hit surface. Rays that hit nothing contribute nothing, so
 * the projection divides by the hit count — exactly as the kernel does.
 */
export function gatherProbeDynamic(
  probeIndex: number,
  grid: DynGrid,
  scene: DynScene,
  cfg: DynGatherConfig,
): DynProbe {
  const [nx, ny] = grid.dims;
  const ix = probeIndex % nx;
  const iy = Math.floor(probeIndex / nx) % ny;
  const iz = Math.floor(probeIndex / (nx * ny));
  const origin = probePosition(
    { dims: grid.dims, min: grid.min, max: grid.max, sh: NO_SH } as ProbeGrid,
    ix, iy, iz,
  );

  const rays = Math.min(Math.max(0, Math.floor(cfg.raysPerProbe)), DYN_RAY_CAP);
  const dirs = dynRaySet(rays, cfg.frameSeed);
  const nBoxes = countOf(scene.boxes);
  const nCaps = countOf(scene.capsules);

  const radianceSamples: ShSample[] = [];
  const visibilitySamples: ShSample[] = [];
  for (const dir of dirs) {
    const hit = nearestDynHit(origin, dir, scene.boxes, nBoxes, scene.capsules, nCaps);
    if (hit === null) continue;
    const v = hit.isCapsule ? 0 : 1;
    visibilitySamples.push({ dir, radiance: [v, v, v] });
    radianceSamples.push({
      dir,
      radiance: hit.isCapsule
        ? ZERO
        : dynSurfaceRadiance(hit.albedo, hit.point, hit.normal, scene.lights, scene.capsules, nCaps, scene.boxes, nBoxes),
    });
  }

  const radiance = projectL1(radianceSamples);
  const vis = projectL1(visibilitySamples);
  return {
    radiance,
    visibility: [vis[0]!, vis[3]!, vis[6]!, vis[9]!],
  };
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function clampAxis(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fracIndex(v: number, lo: number, hi: number, n: number): number {
  if (n <= 1 || hi === lo) return 0;
  return ((v - lo) / (hi - lo)) * (n - 1);
}

/**
 * Trilinear-blend the 8 probes surrounding `p` on the packed 4-vec4 layout,
 * then evaluate. Coefficients blend BEFORE evaluation — blending results would
 * bake the non-negative clamp into a cell's interior and break linearity.
 */
export function sampleProbeDynamic(
  dyn: Float32Array,
  grid: DynGrid,
  p: Vec3,
  n: Vec3,
): { radiance: Vec3; visibility: number } {
  const [nx, ny, nz] = grid.dims;
  const cx = clampAxis(p[0], grid.min[0], grid.max[0]);
  const cy = clampAxis(p[1], grid.min[1], grid.max[1]);
  const cz = clampAxis(p[2], grid.min[2], grid.max[2]);
  const fx = fracIndex(cx, grid.min[0], grid.max[0], nx);
  const fy = fracIndex(cy, grid.min[1], grid.max[1], ny);
  const fz = fracIndex(cz, grid.min[2], grid.max[2], nz);

  const i0x = Math.floor(fx), i0y = Math.floor(fy), i0z = Math.floor(fz);
  const i1x = Math.min(i0x + 1, nx - 1);
  const i1y = Math.min(i0y + 1, ny - 1);
  const i1z = Math.min(i0z + 1, nz - 1);
  const tx = fx - i0x, ty = fy - i0y, tz = fz - i0z;

  const corners: [number, number, number, number][] = [
    [i0x, i0y, i0z, (1 - tx) * (1 - ty) * (1 - tz)],
    [i1x, i0y, i0z, tx * (1 - ty) * (1 - tz)],
    [i0x, i1y, i0z, (1 - tx) * ty * (1 - tz)],
    [i1x, i1y, i0z, tx * ty * (1 - tz)],
    [i0x, i0y, i1z, (1 - tx) * (1 - ty) * tz],
    [i1x, i0y, i1z, tx * (1 - ty) * tz],
    [i0x, i1y, i1z, (1 - tx) * ty * tz],
    [i1x, i1y, i1z, tx * ty * tz],
  ];

  const c = new Array<number>(DYN_FLOATS_PER_PROBE).fill(0);
  for (const [ix, iy, iz, w] of corners) {
    const base = (ix + nx * (iy + ny * iz)) * DYN_FLOATS_PER_PROBE;
    for (let k = 0; k < DYN_FLOATS_PER_PROBE; k++) {
      c[k]! += (dyn[base + k] ?? 0) * w;
    }
  }

  const radiance = irradianceL1(c, 0, n);
  const visSh = [
    c[12]!, 0, 0,
    c[13]!, 0, 0,
    c[14]!, 0, 0,
    c[15]!, 0, 0,
  ];
  const e = irradianceL1(visSh, 0, n)[0]!;
  return { radiance, visibility: Math.max(0, Math.min(1, e / Math.PI)) };
}
