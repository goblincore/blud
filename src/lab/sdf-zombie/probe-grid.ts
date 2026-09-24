/**
 * Static irradiance probe grid — the CPU gather and its L1 SH evaluator.
 *
 * WHY THIS FILE EXISTS. The lab's ambient (`../ambient.ts`) is analytic: six
 * walls treated as point-ish lights, evaluated per shaded pixel. That reads as
 * a hue but it has no directionality — a surface facing a red wall and one
 * facing away get the same tint. This spike replaces the flat fill with a
 * directional ambient read from a probe grid gathered ONCE on the CPU at room
 * setup, against the enclosure's six walls plus optional occluder AABBs and
 * point lights: no field evaluations. It is the P3 "irradiance volume lookup"
 * shape the spec reserved (`docs/superpowers/specs/2026-08-24-environment-lighting-design.md`).
 *
 * THE HOUSE PATTERN. The maths lives twice: here, where vitest can
 * property-test it, and in `webgpu/probe-grid.wgsl.ts`, where it runs on the
 * GPU. The WGSL is pinned by source-text and parse-contract tests so the two
 * cannot drift silently. Change one, change both.
 *
 * THE LIGHT MODEL, matching zombie-gpu.ts exactly: `dir` is a unit vector
 * TOWARD the directional key (default (0.45, 0.72, 0.53) normalised),
 * `keyColor` linear RGB, `keyIntensity` 2.4, `fillIntensity` 0.06. The
 * enclosure is an axis-aligned box with six linear-RGB wall albedos. Optional
 * `points` add accent lights with the same 1/(1+(d/POINT_REF_DIST)^2) falloff
 * `litWallAlbedo` uses (`power` ignored); optional `occluders` are furniture
 * AABBs that catch rays and shadow point lights.
 *
 * ZERO FIELD EVALUATIONS, enforced by test on the WGSL twin. Bounce is
 * analytic — a convex enclosure cannot self-shadow a directional light, so N.L
 * is the whole visibility story for the key; occluder boxes are the only
 * shadowers, and only for point lights. The grid is gathered on the CPU once,
 * not marched per pixel.
 */

import type { Box, EnclosureWalls } from './ambient';
import type { Vec3 } from './types';

export type { Box, EnclosureWalls, Vec3 };

/** `Vec3` is readonly; accumulators below are plain mutable triples. */
type Mut3 = [number, number, number];
/** Twelve L1 SH coefficients in the packed order `[L00.rgb, L1-1.rgb, L10.rgb, L11.rgb]`. */
type Mut12 = [
  number, number, number, number, number, number,
  number, number, number, number, number, number,
];

const SH_IDX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const AXES = [0, 1, 2] as const;

/** Wall keys indexed by axis, then by side (-1 first, +1 second). */
const WALL_KEYS = [
  ['negX', 'posX'],
  ['negY', 'posY'],
  ['negZ', 'posZ'],
] as const;

/**
 * The real SH basis constants. Exported so the WGSL pin test can assert the
 * exact literals in `PROBE_GRID_WGSL` — the one place the two copies of the
 * maths are allowed to share a number.
 */
export const SH_Y00 = 0.282095;
export const SH_Y1 = 0.488603;
export const SH_A0 = Math.PI;
export const SH_A1 = (2 * Math.PI) / 3;

/**
 * Fixed direction-set seed. Determinism is a hard requirement: the gather is a
 * one-off bake, so a re-run must reproduce the same grid bit for bit.
 */
const PROBE_SEED = 0.5;

export interface ProbeGridOptions {
  /** Probe counts per axis, x/y/z. */
  dims: [number, number, number];
  /** Directions gathered per probe. 128 is the spike default. */
  raysPerProbe: number;
  /** Extra bounce iterations after the direct gather. */
  bounces: number;
  /** Margin in metres probes sit inside the box, so none lies on a wall. */
  inset: number;
  /** Occluder AABBs INSIDE the enclosure (e.g. furniture). Default none. */
  occluders?: Box[];
  /** Linear-RGB albedo an occluder hit reflects. Default a dark crate. */
  occluderAlbedo?: Vec3;
  /** Open-sky room: see `ProbeSky`. Absent = the closed box, bit-identical to before. */
  sky?: ProbeSky;
}

export const DEFAULT_PROBE_OPTIONS: ProbeGridOptions = {
  dims: [8, 4, 8],
  raysPerProbe: 128,
  bounces: 2,
  inset: 0.15,
};

/**
 * Point-light falloff reference distance. Its twin is `ACCENT_ALBEDO_REF_DIST`
 * in `webgpu/game-level.ts` (2.2) — the falloff the walls already use through
 * `litWallAlbedo`. This file must NOT import from game-level.ts (it stays
 * dependency-free and worker-friendly); `probe-grid.test.ts` imports both and
 * pins them equal so bodies and walls agree about the room.
 */
export const POINT_REF_DIST = 2.2;

/** Occluder-hit albedo: a dark wooden crate, not a wall. */
export const DEFAULT_OCCLUDER_ALBEDO: Vec3 = [0.35, 0.33, 0.30];

export interface ProbeGrid {
  dims: [number, number, number];
  /** Inset box the probes span. */
  min: Vec3;
  max: Vec3;
  /** `nx*ny*nz*12` floats: `[L00.rgb, L1-1.rgb, L10.rgb, L11.rgb]` per probe. */
  sh: Float32Array;
}

/** One ray's exit from the enclosure. `normal` points INTO the room. */
export interface ProbeHit {
  t: number;
  wall: keyof EnclosureWalls;
  point: Vec3;
  normal: Vec3;
}

/** A coloured point light baked into the gather. `power` is deliberately
 *  absent: `litWallAlbedo` ignores it too — the mesh PointLight and the bounce
 *  are calibrated separately. */
export interface ProbePointLight {
  pos: Vec3;
  color: Vec3;
}

/** The subset of the lab's light uniforms the gather reads. */
export interface ProbeLight {
  dir: Vec3;
  keyColor: Vec3;
  keyIntensity: number;
  fillIntensity: number;
  /** Point lights baked into the gather. Default none. */
  points?: ProbePointLight[];
}

/** Outdoor v1 §7: an open room's sky. Rays leaving through the top face, or through a
 *  side wall above `above` (metres, absolute y), return `radiance` and do not bounce. */
export interface ProbeSky { radiance: Vec3; above: number }

export interface ShSample {
  dir: Vec3;
  radiance: Vec3;
}

/** Position of probe `(i,j,k)` — linear in the grid's inset box. */
export function probePosition(grid: ProbeGrid, i: number, j: number, k: number): Vec3 {
  const [nx, ny, nz] = grid.dims;
  return [
    axisPosition(grid.min[0], grid.max[0], nx, i),
    axisPosition(grid.min[1], grid.max[1], ny, j),
    axisPosition(grid.min[2], grid.max[2], nz, k),
  ];
}

function axisPosition(min: number, max: number, n: number, i: number): number {
  // A one-probe axis has no span; sit it at the centre so trilinear indexing
  // (which collapses to index 0) still lands on the probe.
  const t = n > 1 ? i / (n - 1) : 0.5;
  return min + (max - min) * t;
}

/** True when probe `(i,j,k)` sits inside any occluder AABB, boundaries included. */
export function probeInsideOccluder(
  grid: ProbeGrid,
  i: number,
  j: number,
  k: number,
  occluders: readonly Box[] = [],
): boolean {
  const p = probePosition(grid, i, j, k);
  for (const b of occluders) {
    if (
      p[0] >= b.min[0] && p[0] <= b.max[0] &&
      p[1] >= b.min[1] && p[1] <= b.max[1] &&
      p[2] >= b.min[2] && p[2] <= b.max[2]
    ) {
      return true;
    }
  }
  return false;
}

/**
 * `n` deterministic, roughly-uniform unit directions on the sphere.
 *
 * The Fibonacci lattice is the standard cheap choice: one `y` per band plus a
 * golden-angle turn. It is exact in `y` (the mean is 0) and only ~1/sqrt(n)
 * off in x/z, which is plenty for an L1 gather.
 */
export function fibonacciSphere(n: number, seed = 0): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) * 2) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * (i + seed);
    out.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return out;
}

/**
 * Nearest positive slab exit of a ray fired from INSIDE `box`.
 *
 * Pure slab arithmetic, no field. The returned normal points INTO the room
 * (opposite the outward ray), which is what `wallRadiance` wants as `N`.
 */
export function hitEnclosure(origin: Vec3, dir: Vec3, box: Box): ProbeHit | null {
  const o: Mut3 = [origin[0], origin[1], origin[2]];
  const d: Mut3 = [dir[0], dir[1], dir[2]];
  const lo: Mut3 = [box.min[0], box.min[1], box.min[2]];
  const hi: Mut3 = [box.max[0], box.max[1], box.max[2]];

  let tExit = Infinity;
  let exitAxis: 0 | 1 | 2 = 0;
  let exitSide: -1 | 1 = 1;

  for (const a of AXES) {
    if (Math.abs(d[a]) < 1e-12) {
      // Parallel to this slab: only a miss if the origin is outside it, which
      // an inside origin never is.
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    const t1 = (lo[a] - o[a]) / d[a];
    const t2 = (hi[a] - o[a]) / d[a];
    const tFar = Math.max(t1, t2);
    if (tFar < tExit) {
      tExit = tFar;
      exitAxis = a;
      // t1 > t2 means the exit is the min plane (side -1), else the max plane.
      exitSide = t1 > t2 ? -1 : 1;
    }
  }

  if (!Number.isFinite(tExit) || tExit <= 0) return null;

  const nrm: Mut3 = [0, 0, 0];
  nrm[exitAxis] = -exitSide;
  return {
    t: tExit,
    wall: WALL_KEYS[exitAxis][exitSide < 0 ? 0 : 1],
    point: [o[0] + d[0] * tExit, o[1] + d[1] * tExit, o[2] + d[2] * tExit],
    normal: [nrm[0], nrm[1], nrm[2]],
  };
}

/** One ray's ENTRY into an occluder AABB from outside. `normal` points OUT of
 *  the box, toward the ray origin — the surface normal the probe sees. */
export interface OccluderHit {
  t: number;
  point: Vec3;
  normal: Vec3;
}

/**
 * Nearest positive slab ENTRY of a ray into `box` from OUTSIDE.
 *
 * Returns null when the origin is inside the box (no entry exists), when the
 * box is entirely behind the ray, or when the ray misses. The returned normal
 * is the outward face normal, which points back toward the ray origin, matching
 * `ProbeHit.normal`'s toward-the-probe convention.
 */
export function hitAabbEntry(origin: Vec3, dir: Vec3, box: Box): OccluderHit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterAxis: 0 | 1 | 2 = 0;
  let enterSide: -1 | 1 = 1;

  for (const a of AXES) {
    const o = origin[a];
    const d = dir[a];
    const lo = box.min[a];
    const hi = box.max[a];
    if (Math.abs(d) < 1e-12) {
      // Parallel to this slab: a miss only if the origin is outside it.
      if (o < lo || o > hi) return null;
      continue;
    }
    let tNear = (lo - o) / d;
    let tFar = (hi - o) / d;
    // After the swap tNear is the near plane. If the swap happened, the near
    // plane is the max face, whose outward normal is +1.
    let side: -1 | 1 = -1;
    if (tNear > tFar) {
      const tmp = tNear;
      tNear = tFar;
      tFar = tmp;
      side = 1;
    }
    if (tNear > tEnter) {
      tEnter = tNear;
      enterAxis = a;
      enterSide = side;
    }
    if (tFar < tExit) tExit = tFar;
  }

  if (tEnter > tExit) return null; // slab intersection empty
  if (tExit <= 0) return null;     // box entirely behind the ray
  if (tEnter < 0) return null;     // origin inside the box: no entry

  const nrm: Mut3 = [0, 0, 0];
  nrm[enterAxis] = enterSide;
  const t = tEnter;
  return {
    t,
    point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t],
    normal: [nrm[0], nrm[1], nrm[2]],
  };
}

/**
 * Point-light contribution to a surface's outgoing radiance:
 *
 *   albedo * color * max(dot(normal, toLight), 0) / (1 + (d/POINT_REF_DIST)^2)
 *
 * summed over every light VISIBLE from `point`: a segment that enters an
 * occluder is shadowed. `power` is ignored, exactly as `litWallAlbedo` ignores
 * it — the mesh PointLight and the bounce are calibrated separately.
 */
export function pointLightRadiance(
  albedo: Vec3,
  point: Vec3,
  normal: Vec3,
  points: readonly ProbePointLight[],
  occluders: readonly Box[] = [],
): Vec3 {
  const out: Mut3 = [0, 0, 0];
  for (const p of points) {
    const dx = p.pos[0] - point[0];
    const dy = p.pos[1] - point[1];
    const dz = p.pos[2] - point[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-12) continue;
    const inv = 1 / d;
    const lx = dx * inv, ly = dy * inv, lz = dz * inv;
    const ndl = normal[0] * lx + normal[1] * ly + normal[2] * lz;
    if (ndl <= 0) continue;

    let blocked = false;
    for (const occ of occluders) {
      const hit = hitAabbEntry(point, [lx, ly, lz], occ);
      if (hit !== null && hit.t < d) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const t = d / POINT_REF_DIST;
    const f = ndl / (1 + t * t);
    out[0] += albedo[0] * p.color[0] * f;
    out[1] += albedo[1] * p.color[1] * f;
    out[2] += albedo[2] * p.color[2] * f;
  }
  return [out[0], out[1], out[2]];
}

/**
 * Radiance leaving a surface toward the probe: key + fill + bounce, plus any
 * point lights visible from `point`. Shared by walls and occluders so both use
 * one light model.
 */
function surfaceRadiance(
  albedo: Vec3,
  normal: Vec3,
  light: ProbeLight,
  bounce: Vec3,
  point?: Vec3,
  occluders: readonly Box[] = [],
): Vec3 {
  const ndl = Math.max(normal[0] * light.dir[0] + normal[1] * light.dir[1] + normal[2] * light.dir[2], 0);
  const key = light.keyIntensity * ndl;
  const fill = light.fillIntensity;
  const out: Mut3 = [
    albedo[0] * (key * light.keyColor[0] + fill * light.keyColor[0] + bounce[0]),
    albedo[1] * (key * light.keyColor[1] + fill * light.keyColor[1] + bounce[1]),
    albedo[2] * (key * light.keyColor[2] + fill * light.keyColor[2] + bounce[2]),
  ];
  if (point !== undefined && light.points !== undefined && light.points.length > 0) {
    const add = pointLightRadiance(albedo, point, normal, light.points, occluders);
    out[0] += add[0];
    out[1] += add[1];
    out[2] += add[2];
  }
  return [out[0], out[1], out[2]];
}

/**
 * Radiance leaving a wall toward the probe.
 *
 *   albedo * (keyIntensity*keyColor*max(N.L,0) + fillIntensity*keyColor + bounce)
 *          + point lights visible from `point`
 *
 * `bounce` is the incoming RADIANCE from the previous iteration (see
 * `buildProbeGrid`), so the wall term is a Lambertian reflection of it. No
 * shadowing term: a convex box cannot occlude a directional light from itself.
 * `wall` names which of the six it is — kept for call-site clarity and future
 * per-wall overrides; the arithmetic is albedo-driven. `point`/`occluders` are
 * optional so the original five-argument call shape is unchanged.
 */
export function wallRadiance(
  wall: keyof EnclosureWalls,
  albedo: Vec3,
  normal: Vec3,
  light: ProbeLight,
  bounce: Vec3,
  point?: Vec3,
  occluders: readonly Box[] = [],
): Vec3 {
  void wall;
  return surfaceRadiance(albedo, normal, light, bounce, point, occluders);
}

/**
 * Project radiance samples into the four real-SH L1 bands.
 *
 *   L_lm = (4pi / N) * sum_i radiance_i * Y_lm(d_i)
 *
 * with `Y00 = 0.282095`, `Y1-1 = 0.488603*y`, `Y10 = 0.488603*z`,
 * `Y11 = 0.488603*x`. The returned 12 floats are packed
 * `[L00.rgb, L1-1.rgb, L10.rgb, L11.rgb]`.
 */
export function projectL1(samples: readonly ShSample[]): number[] {
  const out: Mut12 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const n = samples.length;
  if (n === 0) return out;

  for (const s of samples) {
    const d = s.dir;
    const r = s.radiance;
    const ym1 = SH_Y1 * d[1];
    const y10 = SH_Y1 * d[2];
    const y11 = SH_Y1 * d[0];
    out[0] += r[0] * SH_Y00; out[1] += r[1] * SH_Y00; out[2] += r[2] * SH_Y00;
    out[3] += r[0] * ym1; out[4] += r[1] * ym1; out[5] += r[2] * ym1;
    out[6] += r[0] * y10; out[7] += r[1] * y10; out[8] += r[2] * y10;
    out[9] += r[0] * y11; out[10] += r[1] * y11; out[11] += r[2] * y11;
  }

  const w = (4 * Math.PI) / n;
  return out.map((v) => v * w);
}

function shAt(sh: ArrayLike<number>, i: number): number {
  const v = sh[i];
  return v === undefined ? 0 : v;
}

/**
 * Irradiance from one probe's L1 SH, cosine-convolved:
 *
 *   E = A0*Y00*L00 + A1*(Y1-1(n)*L1-1 + Y10(n)*L10 + Y11(n)*L11)
 *
 * with `A0 = pi`, `A1 = 2pi/3`. Negative lobes are clamped to 0: an L1
 * reconstruction can undershoot, and a negative irradiance is not a colour.
 */
export function irradianceL1(sh: ArrayLike<number>, offset: number, n: Vec3): Vec3 {
  const l00r = shAt(sh, offset + 0), l00g = shAt(sh, offset + 1), l00b = shAt(sh, offset + 2);
  const lm1r = shAt(sh, offset + 3), lm1g = shAt(sh, offset + 4), lm1b = shAt(sh, offset + 5);
  const l10r = shAt(sh, offset + 6), l10g = shAt(sh, offset + 7), l10b = shAt(sh, offset + 8);
  const l11r = shAt(sh, offset + 9), l11g = shAt(sh, offset + 10), l11b = shAt(sh, offset + 11);

  const y00 = SH_Y00;
  const ym1 = SH_Y1 * n[1];
  const y10 = SH_Y1 * n[2];
  const y11 = SH_Y1 * n[0];

  return [
    Math.max(SH_A0 * y00 * l00r + SH_A1 * (ym1 * lm1r + y10 * l10r + y11 * l11r), 0),
    Math.max(SH_A0 * y00 * l00g + SH_A1 * (ym1 * lm1g + y10 * l10g + y11 * l11g), 0),
    Math.max(SH_A0 * y00 * l00b + SH_A1 * (ym1 * lm1b + y10 * l10b + y11 * l11b), 0),
  ];
}

function clampAxis(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fracIndex(v: number, lo: number, hi: number, n: number): number {
  if (n <= 1 || hi === lo) return 0;
  return ((v - lo) / (hi - lo)) * (n - 1);
}

/**
 * Trilinear-blend the 12 SH coefficients of the 8 probes surrounding `p`.
 *
 * Coefficients are blended BEFORE any evaluation — blending irradiances would
 * bake the clamp into the interior of a cell and break linearity.
 */
function blendProbeSh(grid: ProbeGrid, p: Vec3): Mut12 {
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

  const out: Mut12 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const [ix, iy, iz, w] of corners) {
    const base = (ix + nx * (iy + ny * iz)) * 12;
    for (const c of SH_IDX) out[c] += shAt(grid.sh, base + c) * w;
  }
  return out;
}

/** Irradiance at `p` for normal `n`, trilinearly sampled from the grid. */
export function sampleProbeGrid(grid: ProbeGrid, p: Vec3, n: Vec3): Vec3 {
  return irradianceL1(blendProbeSh(grid, p), 0, n);
}

/**
 * Gather the whole grid: `bounces + 1` passes over every probe and direction.
 *
 * Pass 0 projects the direct wall radiance (`bounce` zero). Each later pass
 * replaces `bounce` with the previous pass's probe grid sampled at the hit
 * point, converted from irradiance to the incident radiance a Lambertian wall
 * reflects (`E / pi`). That `1/pi` is the BRDF, and it is what makes the
 * grey-room series converge at albedo 0.5 instead of diverging.
 *
 * Fully deterministic: a fixed Fibonacci direction set per probe.
 */
/** A ray's nearest surface: an enclosure wall (`wall` set) or an occluder
 *  entry (`wall` null). `normal` always points back toward the probe. */
interface GatherHit {
  t: number;
  wall: keyof EnclosureWalls | null;
  point: Vec3;
  normal: Vec3;
}

/** Nearest of the enclosure exit and every occluder entry along one ray. */
function nearestHit(
  origin: Vec3,
  dir: Vec3,
  box: Box,
  occluders: readonly Box[],
): GatherHit | null {
  const enc = hitEnclosure(origin, dir, box);
  let best: GatherHit | null =
    enc === null ? null : { t: enc.t, wall: enc.wall, point: enc.point, normal: enc.normal };
  for (const occ of occluders) {
    const oh = hitAabbEntry(origin, dir, occ);
    if (oh !== null && (best === null || oh.t < best.t)) {
      best = { t: oh.t, wall: null, point: oh.point, normal: oh.normal };
    }
  }
  return best;
}

/** The six axis neighbours, used by the inside-occluder repair. */
const AXIS_NEIGHBOURS = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
] as const;

/**
 * A probe buried in an occluder gathered garbage: its rays start inside the box
 * and never enter it, so they read the far walls as if the crate were not
 * there. Replace each such probe with the mean SH of its free axis neighbours;
 * a probe with no free neighbour is zeroed.
 */
function repairInsideOccluders(grid: ProbeGrid, occluders: readonly Box[]): void {
  const [nx, ny, nz] = grid.dims;
  const src = new Float32Array(grid.sh);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!probeInsideOccluder(grid, i, j, k, occluders)) continue;
        const base = (i + nx * (j + ny * k)) * 12;
        const sum: Mut12 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let n = 0;
        for (const [di, dj, dk] of AXIS_NEIGHBOURS) {
          const ni = i + di, nj = j + dj, nk = k + dk;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny || nk < 0 || nk >= nz) continue;
          if (probeInsideOccluder(grid, ni, nj, nk, occluders)) continue;
          const nbase = (ni + nx * (nj + ny * nk)) * 12;
          for (const c of SH_IDX) sum[c] += src[nbase + c] ?? 0;
          n++;
        }
        for (const c of SH_IDX) grid.sh[base + c] = n === 0 ? 0 : sum[c] / n;
      }
    }
  }
}

/**
 * Gather the whole grid: `bounces + 1` passes over every probe and direction.
 *
 * Pass 0 projects the direct surface radiance (`bounce` zero). Each later pass
 * replaces `bounce` with the previous pass's probe grid sampled at the hit
 * point, converted from irradiance to the incident radiance a Lambertian
 * surface reflects (`E / pi`). That `1/pi` is the BRDF, and it is what makes
 * the grey-room series converge at albedo 0.5 instead of diverging.
 *
 * A ray's hit is the nearest of the enclosure exit and every occluder entry;
 * an occluder hit reflects `occluderAlbedo` and shadows point lights it sits
 * between. Probes inside an occluder are repaired after the gather.
 *
 * Fully deterministic: a fixed Fibonacci direction set per probe.
 */
export function buildProbeGrid(
  box: Box,
  walls: EnclosureWalls,
  light: ProbeLight,
  opts: Partial<ProbeGridOptions> = {},
): ProbeGrid {
  const o: ProbeGridOptions = { ...DEFAULT_PROBE_OPTIONS, ...opts };
  const dims = o.dims;
  const [nx, ny, nz] = dims;
  const occluders = o.occluders ?? [];
  const occluderAlbedo = o.occluderAlbedo ?? DEFAULT_OCCLUDER_ALBEDO;
  const sky = o.sky;

  const min: Vec3 = [box.min[0] + o.inset, box.min[1] + o.inset, box.min[2] + o.inset];
  const max: Vec3 = [box.max[0] - o.inset, box.max[1] - o.inset, box.max[2] - o.inset];
  const count = nx * ny * nz;
  const dirs = fibonacciSphere(o.raysPerProbe, PROBE_SEED);

  let grid: ProbeGrid = { dims, min, max, sh: new Float32Array(count * 12) };
  for (let iter = 0; iter <= o.bounces; iter++) {
    const prev = iter === 0 ? null : grid;
    const sh = new Float32Array(count * 12);
    const next: ProbeGrid = { dims, min, max, sh };

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const origin = probePosition(next, i, j, k);
          const samples: ShSample[] = [];
          for (const dir of dirs) {
            const hit = nearestHit(origin, dir, box, occluders);
            if (hit === null) continue;
            if (sky !== undefined && hit.wall !== null && hit.wall !== 'negY'
              && (hit.wall === 'posY' || hit.point[1] > sky.above)) {
              samples.push({ dir, radiance: [sky.radiance[0], sky.radiance[1], sky.radiance[2]] });
              continue;
            }
            const albedo = hit.wall === null ? occluderAlbedo : walls[hit.wall];
            let bounce: Vec3 = [0, 0, 0];
            if (prev !== null) {
              const e = sampleProbeGrid(prev, hit.point, hit.normal);
              bounce = [e[0] / Math.PI, e[1] / Math.PI, e[2] / Math.PI];
            }
            samples.push({
              dir,
              radiance: surfaceRadiance(albedo, hit.normal, light, bounce, hit.point, occluders),
            });
          }
          const proj = projectL1(samples);
          const base = (i + nx * (j + ny * k)) * 12;
          for (const c of SH_IDX) sh[base + c] = proj[c] ?? 0;
        }
      }
    }
    grid = next;
  }

  if (occluders.length > 0) repairInsideOccluders(grid, occluders);

  return grid;
}

/** Plain-data request for a worker bake. No closures, no class instances. */
export interface ProbeGridRequest {
  box: Box;
  walls: EnclosureWalls;
  light: ProbeLight;
  options?: Partial<ProbeGridOptions>;
}

/**
 * Worker-friendly entry: a plain-data wrapper over `buildProbeGrid`. Both the
 * request and the returned `ProbeGrid` (dims/min/max/Float32Array) survive
 * `structuredClone`/`postMessage`, so a module worker can bake a room grid and
 * transfer the buffer back.
 */
export function buildProbeGridRequest(req: ProbeGridRequest): ProbeGrid {
  return buildProbeGrid(req.box, req.walls, req.light, req.options ?? {});
}

/**
 * Pack the grid as a RGBA32F texture, three texels per probe.
 *
 * Layout (documented because the WGSL `probeLoadSh` is its other half):
 *   texel 0 = (L00.r, L00.g, L00.b, L1-1.r)
 *   texel 1 = (L1-1.g, L1-1.b, L10.r, L10.g)
 *   texel 2 = (L10.b, L11.r, L11.g, L11.b)
 *
 * i.e. `texel(probe*3 + c)` holds `sh[probe*12 + c*4 .. +3]` — colour stays
 * with its own coefficient, never split across channels of different bands.
 */
export function packProbeTexture(grid: ProbeGrid): { data: Float32Array; width: number; height: 1 } {
  const [nx, ny, nz] = grid.dims;
  return { data: new Float32Array(grid.sh), width: nx * ny * nz * 3, height: 1 };
}

/** Inverse of `packProbeTexture` — the round-trip used to pin the layout. */
export function unpackProbeTexture(data: Float32Array, probeCount: number): Float32Array {
  return new Float32Array(data.subarray(0, probeCount * 12));
}
