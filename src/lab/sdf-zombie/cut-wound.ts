// src/lab/sdf-zombie/cut-wound.ts
//
// CUT WOUNDS (spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §3-4). Pure. A cut is a wound SHAPE beside the
// crater: a blade SLOT along a segment, deepest at its middle (a lens), its walls closing into a V, jagged and lipped on the
// GPU. It rides one prim exactly like a crater: `local` is its midpoint, `radius` its HALF-LENGTH (every sphere bound the
// wound pipeline keeps stays a superset), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its along-segment
// unit, `kerf` its half-width at the skin. `cutCarve` is the CPU mirror of the WGSL slot (applyWounds' cut branch) for tests
// and docs; keep the two identical apart from the GPU's noise.
import { WOUND_CARVE_DEPTH_FRAC, worldDirToWoundLocal, woundDirToWorld, woundWorldPos, worldHitToWound, type Wound } from './damage';
import { sdPrimitive } from './validate';
import { add, cross, dot, normalize, scale, sub } from './vec';
import type { Primitive, Vec3 } from './types';

export const CUT = {
  minLen: 0.03,
  maxLen: 0.35,
  maxPerSlash: 3,
  /** map-body.wgsl.ts gLimbSlack (0.2 m) assumes no carve deeper than 0.16 m. */
  maxDepth: 0.15,
  /** A cut may reach this share of the flesh measured behind its midpoint. */
  thickFrac: 0.8,
} as const;

/** The WGSL slot's look constants (interpolated into fields/wounds.wgsl.ts like torn-lips.ts's TORN). */
export const CUT_SHADE = {
  /** Jagged walls: noise frequency (1/m) and how much it widens or narrows the kerf. */
  jagFreq: 90,
  jagAmp: 0.35,
  /** Field scale for the slot (its walls are steep; < 1 keeps the march safe, the zero set unchanged). */
  carveK: 0.7,
  /** Lip: centre offset from the slot axis, width and height, all × kerf; height also × META.z (rim splay scale). */
  lipOffset: 1.5,
  lipWidth: 1.2,
  lipHeight: 0.9,
  /** The shading mask's soft edge, × kerf. */
  maskWidth: 2.2,
} as const;

export interface CutCalibre { depth: number; kerf: number; lip: number }
/** The rod stand-in's blade (tunable). */
export const ROD_CALIBRE: CutCalibre = { depth: 0.06, kerf: 0.01, lip: 1 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const unit = (v: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 => (Math.hypot(v[0], v[1], v[2]) > 1e-9 ? normalize(v) : fb);

/** The slot's inside-positive carve term at `p` (no noise): the CPU mirror of applyWounds' cut branch. */
export function cutCarve(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, jag = 0): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), s = dot(rel, inward), u = dot(rel, side);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const prof = 1 - tN * tN;
  const depthT = Math.max(depth * prof, 1e-4);
  const kerfT = kerf * (1 + jag) * (0.35 + 0.65 * Math.sqrt(prof));
  const vWall = kerfT * (1 - clamp(s, 0, depthT) / depthT) - Math.abs(u);
  return Math.min(vWall, depthT - s, halfLen - Math.abs(a)) * CUT_SHADE.carveK;
}

export interface SweepSample { point: Vec3; view: Vec3 }
export interface CutSeg { a: Vec3; b: Vec3; normal: Vec3 }

function nearestCluster(prims: readonly Primitive[], p: Vec3): number {
  let best = -1, bd = Infinity;
  for (const q of prims) {
    if (q.dead || q.op === 'sub' || q.op === 'groove' || q.op === 'bone' || q.op === 'organ') continue;
    const d = sdPrimitive(p, q);
    if (d < bd) { bd = d; best = q.cluster ?? 0; }
  }
  return best;
}

/** A blade's sweep (surface hits in order, with the view direction of each) → at most CUT.maxPerSlash segments, one per
 *  run of consecutive samples on the same cluster, clamped to CUT.maxLen about its midpoint; shorter than minLen: dropped. */
export function cutsFromSweep(prims: readonly Primitive[], samples: readonly SweepSample[]): CutSeg[] {
  const runs: SweepSample[][] = [];
  let last = Number.NaN;
  for (const s of samples) {
    const c = nearestCluster(prims, s.point);
    if (c !== last || runs.length === 0) { runs.push([]); last = c; }
    runs[runs.length - 1]!.push(s);
  }
  const out: CutSeg[] = [];
  for (const run of runs) {
    if (out.length >= CUT.maxPerSlash || run.length < 2) continue;
    let a = run[0]!.point, b = run[run.length - 1]!.point;
    const d = sub(b, a), l = Math.hypot(d[0], d[1], d[2]);
    if (l < CUT.minLen) continue;
    if (l > CUT.maxLen) {
      const m = scale(add(a, b), 0.5), h = scale(d, CUT.maxLen / (2 * l));
      a = sub(m, h); b = add(m, h);
    }
    const view = unit(run.reduce((acc, s) => add(acc, s.view), [0, 0, 0] as Vec3), [0, 0, -1]);
    out.push({ a, b, normal: unit(cross(sub(b, a), view)) });
  }
  return out;
}

function grad(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = 1e-3;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ]);
}

/** Walk `p` onto the zero set along the field's gradient (the chord's midpoint sits inside a convex surface). */
function toSurface(field: (p: Vec3) => number, p: Vec3): Vec3 {
  let q = p;
  for (let i = 0; i < 12; i++) {
    const d = field(q);
    if (Math.abs(d) < 2e-4) break;
    q = sub(q, scale(grad(field, q), d));
  }
  return q;
}

/** One cut wound from a segment on the body (world space at `bodyYaw`). */
export function stampCut(prims: Primitive[], seg: CutSeg, calibre: CutCalibre, bodyYaw: number, field: (p: Vec3) => number): Wound {
  const d = sub(seg.b, seg.a);
  const len = Math.min(CUT.maxLen, Math.hypot(d[0], d[1], d[2]));
  const anchor = toSurface(field, scale(add(seg.a, seg.b), 0.5));
  const w = worldHitToWound(prims, anchor, len / 2, 'pellet', bodyYaw, field);
  if (!w.carveN) {
    w.carveN = worldDirToWoundLocal(prims, w, scale(grad(field, anchor), -1), bodyYaw);
    w.carveDepth = calibre.depth * WOUND_CARVE_DEPTH_FRAC;
  }
  const inward = unit(woundDirToWorld(prims, w, w.carveN, bodyYaw));
  const thick = (w.carveDepth ?? calibre.depth * WOUND_CARVE_DEPTH_FRAC) / WOUND_CARVE_DEPTH_FRAC;
  const alongW = unit(sub(d, scale(inward, dot(d, inward))));
  w.shape = 'cut';
  w.carveDepth = Math.min(calibre.depth, CUT.maxDepth, thick * CUT.thickFrac);
  w.cutDir = worldDirToWoundLocal(prims, w, alongW, bodyYaw);
  w.kerf = calibre.kerf;
  w.rimScale = (w.rimScale ?? 1) * calibre.lip;
  w.severRadius = 0;
  w.wetLip = 1;
  return w;
}

/** The sphere list the bone-exposure consumers read (they know only craters): a crater is itself; a cut is a chain of
 *  spheres along its slot, radius max(depth, 2 kerf), spaced by that radius. */
export function cutExposureSpheres(prims: Primitive[], w: Wound, bodyYaw: number): { pos: Vec3; radius: number }[] {
  const c = woundWorldPos(prims, w, bodyYaw);
  if (w.shape !== 'cut' || !w.cutDir) return [{ pos: c, radius: w.radius }];
  const along = unit(woundDirToWorld(prims, w, w.cutDir, bodyYaw));
  const r = Math.max(w.carveDepth ?? 0.03, 2 * (w.kerf ?? 0.01));
  const n = Math.max(2, Math.ceil((2 * w.radius) / r));
  const out: { pos: Vec3; radius: number }[] = [];
  for (let i = 0; i <= n; i++) out.push({ pos: add(c, scale(along, -w.radius + (2 * w.radius * i) / n)), radius: r });
  return out;
}
