// src/lab/sdf-zombie/head-burst.ts
//
// SLUG HEAD BURST — the pure half (spec docs/superpowers/specs/2026-10-02-slug-head-burst-design.md §4).
// A slug that lands on a head is classified by how CENTRED the shot is: the perpendicular distance from the head's
// centre to the shot line, as a fraction of the head's radius. Under centreFrac the head bursts (lethal); wider, it
// ruptures on the struck side (glancing). Everything here is plain data in, plain data out: the leaf
// (webgpu/game-head-damage.ts) turns the verdict into craters, deform, gore and flaps.
import { rotate } from './head-deform';
import type { HeadFrame, Quat } from './head-deform';
import { sdPrimitive } from './validate';
import type { Primitive, Vec3 } from './types';

export const BURST = {
  /** Offset (fraction of head radius) under which a slug bursts the head. Tuned at playtest. */
  centreFrac: 0.35,
  /** A hit point farther than this from the head centre in hs units (the head ellipsoid is 1) is a neck / shoulder hit. */
  maxHs: 1.35,
  /** Crater radii, m. Glancing scales by (0.7 + 0.3 · severity). */
  entryR: { lethal: 0.09, glancing: 0.07 },
  exitR: 0.11,
  /** Shards thrown (inclusive ranges, scaled by 0.5 + 0.5·severity and burstTuning.shardScale). */
  shards: { lethal: [14, 18], glancing: [6, 9] } as { lethal: readonly [number, number]; glancing: readonly [number, number] },
  /** Hinged scalp flaps (hard cap flapMax). */
  flaps: { lethal: 3, glancing: 2 },
  flapMax: 4,
  /** Brain lumps thrown (the lethal burst also launches the whole brain). */
  lumps: { lethal: 3, glancing: 2 },
  /** The blow's shove on the body, m/s along the shot. */
  shove: 2.5,
} as const;

/** Live tuning (debug seams): mutable on purpose, defaults from BURST. */
export const burstTuning = {
  /** false: slugs take the ordinary path. */
  on: true,
  centreFrac: BURST.centreFrac as number,
  /** Swell peak of the jelly rupture (head-deform BURST_DEFORM.swell). */
  swell: 0.32,
  shardScale: 1,
  /** -1: the plan's default count; otherwise forced (clamped to flapMax). */
  flapCount: -1,
};
export function setBurstTuning(p: Partial<typeof burstTuning>): typeof burstTuning {
  Object.assign(burstTuning, p);
  return { ...burstTuning };
}

export interface BurstVerdict {
  kind: 'lethal' | 'glancing';
  /** Perpendicular distance from the head centre to the shot line ÷ head radius. */
  offset: number;
  /** 1 − offset, clamped to [0, 1]. */
  severity: number;
  /** Head-local x sign of the line's closest approach to the centre (−1 left, +1 right). */
  side: -1 | 1;
  /** Where the slug hit (world). */
  entry: Vec3;
  /** Where it would leave the head ellipsoid (world). */
  exit: Vec3;
  /** The shot direction (world, unit) and head-local (unit). */
  dir: Vec3;
  axisLocal: Vec3;
}

export interface BurstPlan {
  shards: number;
  flaps: number;
  lumps: number;
  /** Where round the crater rim each flap hinges, radians. */
  flapAngles: number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** The head's radius for the offset fraction: the geometric mean of its (non-spherical) half-axes. */
export const headRadius = (axes: Vec3): number => Math.cbrt(axes[0] * axes[1] * axes[2]);

/** A world point in hs units: conj(quat)·(p − centre) ÷ axes (the head ellipsoid is |hs| = 1). */
export function hsOf(frame: HeadFrame, p: Vec3): Vec3 {
  const l = rotate(conj(frame.quat), sub(p, frame.centre));
  return [l[0] / frame.axes[0], l[1] / frame.axes[1], l[2] / frame.axes[2]];
}

/** True when `p` (a hit point on the surface) belongs to the head's flesh: its nearest solid prim is a head prim and
 *  it is within 3 cm of it. Bone, organ, sub, groove and dead prims never count. */
export function onHeadPrim(prims: readonly Primitive[], p: Vec3): boolean {
  let head = Infinity, other = Infinity;
  for (const q of prims) {
    if (q.dead || q.op === 'sub' || q.op === 'groove' || q.op === 'bone' || q.op === 'organ') continue;
    const d = sdPrimitive(p, q);
    if (q.limb === 'head') head = Math.min(head, d); else other = Math.min(other, d);
  }
  return head <= other && head < 0.03;
}

/** The far intersection of the shot line with the head ellipsoid; centre + dir · radius when the line misses. */
function exitPoint(p: Vec3, d: Vec3, f: HeadFrame): Vec3 {
  const q = conj(f.quat);
  const lp = rotate(q, sub(p, f.centre)), ld = rotate(q, d);
  const P: Vec3 = [lp[0] / f.axes[0], lp[1] / f.axes[1], lp[2] / f.axes[2]];
  const D: Vec3 = [ld[0] / f.axes[0], ld[1] / f.axes[1], ld[2] / f.axes[2]];
  const a = dot(D, D), b = 2 * dot(P, D), c = dot(P, P) - 1;
  const disc = b * b - 4 * a * c;
  if (disc > 0) {
    const t = (-b + Math.sqrt(disc)) / (2 * a);
    if (t > 0) return add(p, scale(d, t));
  }
  return add(f.centre, scale(d, headRadius(f.axes)));
}

/** Classify a slug: `hit.point` the impact (world), `hit.dir` the shot direction (world). */
export function classifyBurst(hit: { point: Vec3; dir: Vec3 }, frame: HeadFrame, centreFrac = burstTuning.centreFrac): BurstVerdict {
  const dir = unit(hit.dir);
  const t = dot(sub(frame.centre, hit.point), dir);
  const closest = add(hit.point, scale(dir, t));
  const perp = sub(closest, frame.centre);
  const offset = len(perp) / headRadius(frame.axes);
  const localPerp = rotate(conj(frame.quat), perp);
  return {
    kind: offset < centreFrac ? 'lethal' : 'glancing',
    offset,
    severity: Math.min(1, Math.max(0, 1 - offset)),
    side: localPerp[0] < 0 ? -1 : 1,
    entry: [hit.point[0], hit.point[1], hit.point[2]],
    exit: exitPoint(hit.point, dir, frame),
    dir,
    axisLocal: unit(rotate(conj(frame.quat), dir)),
  };
}

/** The seeded plan for one burst: how many shards, flaps and lumps, and where the flaps hinge. */
export function burstPlan(v: BurstVerdict, rand: () => number): BurstPlan {
  const lethal = v.kind === 'lethal';
  const [lo, hi] = lethal ? BURST.shards.lethal : BURST.shards.glancing;
  const sev = 0.5 + 0.5 * v.severity;
  const shards = Math.max(1, Math.round((lo + Math.floor(rand() * (hi - lo + 1))) * sev * burstTuning.shardScale));
  const want = burstTuning.flapCount >= 0 ? burstTuning.flapCount : (lethal ? BURST.flaps.lethal : BURST.flaps.glancing);
  const flaps = Math.min(BURST.flapMax, want);
  const base = rand() * Math.PI * 2;
  const flapAngles = Array.from({ length: flaps }, (_, i) => base + (i / Math.max(1, flaps)) * Math.PI * 2 + (rand() - 0.5) * 0.4);
  return { shards, flaps, lumps: lethal ? BURST.lumps.lethal : BURST.lumps.glancing, flapAngles };
}
