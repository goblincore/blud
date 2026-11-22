// BRAIN ARCS: electricity crawling over the cerebrax's brain while it seizes (owner, 2026-11-09: "cool electricity
// effects ... coming out around the brain"). Pure path generation; webgpu/character-effects.ts createBrainArcs draws
// the paths as additive ribbons and re-strikes them every frame or two, so they flicker like real arcs.
//
// An arc is a jagged polyline between two points on the brain's surface (an ellipsoid round its centre), bowed OUT
// over the surface so it crawls across the folds rather than cutting through them; one in three instead LEAPS off
// the surface into the air and forks. Jaggedness is midpoint displacement: every halving kinks the line sideways
// by a share of its length, so it reads as lightning at any range.
import type { Vec3 } from './types';

export interface ArcDrive {
  /** Seizure strength 0..1 (motion.ts judderLevel): how many arcs, how bright. */
  level: number;
  /** The brain's centre (world). */
  centre: Vec3;
  /** The brain's semi-axes (world m), body-aligned x (side), y (up), z (front) before yaw. */
  radii: Vec3;
  /** Body yaw, so the semi-axes turn with it. */
  yaw: number;
  /** The brain's MEASURED surface (surfaceTable), body-local: arcs sit on it. Absent: the ellipsoid `radii`. */
  surface?: SurfaceTable;
}

/** The brain's surface distance from its centre by direction (body-local), on a lat/lon grid: the ellipsoid alone
 *  sits ~7% inside the lobes at the median, 16% at the 90th percentile, and buried the arcs in the flesh. */
export interface SurfaceTable { nLat: number; nLon: number; r: Float32Array }

/** March `sd` (body-local, centred on the brain) in from 2x the largest radius along each grid direction. */
export function surfaceTable(sd: (p: Vec3) => number, radii: Vec3, nLat = 12, nLon = 24): SurfaceTable {
  const r = new Float32Array(nLat * nLon), far = 2 * Math.max(radii[0], radii[1], radii[2]);
  for (let i = 0; i < nLat; i++) {
    const lat = -Math.PI / 2 + Math.PI * (i + 0.5) / nLat;
    for (let j = 0; j < nLon; j++) {
      const lon = 2 * Math.PI * j / nLon;
      const d: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      // Coarse steps in, then halve the bracket.
      let t = far, step = 0.02;
      while (t > 0 && sd(scale(d, t)) > 0) t -= step;
      let lo = Math.max(0, t), hi = t + step;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (sd(scale(d, m)) > 0) hi = m; else lo = m; }
      r[i * nLon + j] = (lo + hi) / 2;
    }
  }
  return { nLat, nLon, r };
}

/** The table's surface distance along unit direction `u` (body-local), bilinear. */
export function surfaceAt(t: SurfaceTable, u: Vec3): number {
  const lat = Math.asin(Math.max(-1, Math.min(1, u[1]))), lon = (Math.atan2(u[0], u[2]) + 2 * Math.PI) % (2 * Math.PI);
  const fi = Math.max(0, Math.min(t.nLat - 1.001, (lat + Math.PI / 2) / Math.PI * t.nLat - 0.5));
  const fj = lon / (2 * Math.PI) * t.nLon;
  const i0 = Math.floor(fi), j0 = Math.floor(fj) % t.nLon, j1 = (j0 + 1) % t.nLon, a = fi - i0, b = fj - Math.floor(fj);
  const g = (i: number, j: number) => t.r[Math.min(t.nLat - 1, i) * t.nLon + j]!;
  return g(i0, j0) * (1 - a) * (1 - b) + g(i0 + 1, j0) * a * (1 - b) + g(i0, j1) * (1 - a) * b + g(i0 + 1, j1) * a * b;
}

/** Points per arc (2^k + 1 for the midpoint displacement). */
export const ARC_POINTS = 17;

/** A small seeded RNG (mulberry32): the same seed strikes the same arcs. */
export function arcRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** A point on the brain's surface `out` x its radius along unit direction `d` (body-local), in world space. */
function onBrain(d: Vec3, drive: ArcDrive, out: number): Vec3 {
  const l = len(d) || 1;
  const u: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  // The ellipsoid's radius along u, then yaw into the world.
  const r = drive.surface ? surfaceAt(drive.surface, u) : 1 / Math.hypot(u[0] / drive.radii[0], u[1] / drive.radii[1], u[2] / drive.radii[2]);
  const c = Math.cos(drive.yaw), s = Math.sin(drive.yaw);
  const p: Vec3 = [u[0] * r * out, u[1] * r * out, u[2] * r * out];
  return [drive.centre[0] + p[0] * c + p[2] * s, drive.centre[1] + p[1], drive.centre[2] - p[0] * s + p[2] * c];
}

function randomDir(rng: () => number): Vec3 {
  const y = rng() * 1.6 - 0.6;               // mostly the upper and middle brain: the underside is in the harness
  const a = rng() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

/** Midpoint displacement between `a` and `b`, kinking each halving by `rough` x its span, over `base` (a polyline of
 *  ARC_POINTS points it bows along). */
function jag(base: Vec3[], rough: number, rng: () => number): Vec3[] {
  const pts = base.map(p => [...p] as Vec3);
  let step = (ARC_POINTS - 1) / 2;
  while (step >= 1) {
    for (let i = step; i < ARC_POINTS - 1; i += step * 2) {
      const span = len(sub(pts[i + step]!, pts[i - step]!));
      const k = rough * span;
      pts[i] = add(pts[i]!, [(rng() - 0.5) * k, (rng() - 0.5) * k, (rng() - 0.5) * k]);
    }
    step /= 2;
  }
  return pts;
}

/** The arcs to draw this strike: `count` x level of them (at least one while it seizes). */
export function strikeArcs(seed: number, drive: ArcDrive, count: number): Vec3[][] {
  if (!(drive.level > 0.02)) return [];
  const rng = arcRng(seed);
  const n = Math.max(1, Math.round(count * Math.min(1, drive.level) * (0.6 + 0.4 * rng())));
  const arcs: Vec3[][] = [];
  for (let k = 0; k < n; k++) {
    const d0 = randomDir(rng);
    const leap = rng() < 0.33;
    let base: Vec3[];
    if (leap) {
      // Off the surface into the air: out along the normal, drifting sideways, 25-55% of a radius.
      const side = randomDir(rng);
      const reach = 1.25 + 0.3 * rng();
      base = Array.from({ length: ARC_POINTS }, (_, i) => {
        const t = i / (ARC_POINTS - 1);
        return onBrain(add(d0, scale(side, 0.35 * t)), drive, 1.0 + (reach - 1.0) * t);
      });
    } else {
      // Across the surface: to a neighbour 25-70 deg away, bowed 4-12% proud of the folds.
      const d1 = add(d0, scale(randomDir(rng), 0.45 + 0.7 * rng()));
      const bow = 0.04 + 0.08 * rng();
      base = Array.from({ length: ARC_POINTS }, (_, i) => {
        const t = i / (ARC_POINTS - 1);
        const d = add(scale(d0, 1 - t), scale(d1, t));
        return onBrain(d, drive, 1.02 + bow * Math.sin(Math.PI * t));
      });
    }
    arcs.push(jag(base, leap ? 0.45 : 0.3, rng));
    // A leap forks once, from its middle.
    if (leap && arcs.length < count * 1.5) {
      const mid = arcs[arcs.length - 1]![Math.floor(ARC_POINTS / 2)]!;
      const tip = onBrain(add(d0, scale(randomDir(rng), 0.5)), drive, 1.3 + 0.2 * rng());
      const fork = Array.from({ length: ARC_POINTS }, (_, i) => add(scale(mid, 1 - i / (ARC_POINTS - 1)), scale(tip, i / (ARC_POINTS - 1))));
      arcs.push(jag(fork, 0.5, rng));
    }
  }
  return arcs;
}
