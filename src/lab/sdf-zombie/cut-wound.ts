// src/lab/sdf-zombie/cut-wound.ts
//
// CUT WOUNDS (spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §3-4). Pure. A cut is a wound SHAPE beside the
// crater: a blade SLOT along a segment, deepest at its middle (a lens), its walls closing into a V, jagged and lipped on the
// GPU. It rides one prim exactly like a crater: `local` is its midpoint, `radius` its HALF-LENGTH (every sphere bound the
// wound pipeline keeps stays a superset), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its along-segment
// unit, `kerf` its half-width at the skin. `cutCarve` is the CPU mirror of the WGSL slot (applyWounds' cut branch) for tests
// and docs; keep the two identical apart from the GPU's noise.
//
// A cut is tagged type 'pellet' for profile purposes (the rim / upload paths treat it as a pellet-sized wound) and is always
// wetLip: both are deliberate for now, not an oversight.
import { fleshBehind, worldDirToWoundLocal, woundDirToWorld, woundWorldPos, worldHitToWound, type Wound } from './damage';
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
  /** Field scale for the slot (the zero set is unchanged). MEASURED, not argued: with this scale cutCarve's max |grad| over
   *  a dense grid is <= 2.2 (measured 1.21, 1.67, 1.80 for 0.1, 0.05, 0.015 m half-lengths; the test logs them), i.e. near the stock
   *  crater's bound (~2.06, layout.ts) rather than under it; the step multiplier decision there applies unchanged. */
  carveK: 0.7,
  /** A slot's depth never exceeds this x its half-length: the lens floor's slope is ~2 depth / halfLen, so a deep, very short
   *  slot (0.06 deep over 0.015 half-length measured |grad| 4.96) would be a wall the march steps through. */
  maxDepthPerHalfLen: 1.6,
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

/** The slot's inside-positive carve term at `p` (no noise): the CPU mirror of applyWounds' cut branch. `below`, when given,
 *  is the depth of `p` below the ACTUAL (pre-wound) skin and replaces the straight-inward coordinate in the floor and V-wall
 *  terms, so the slot follows curved skin (the WGSL passes `-dIn`); the along and across coordinates come from the frame. */
export function cutCarve(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, jag = 0, below?: number): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), u = dot(rel, side);
  const s = below ?? dot(rel, inward);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const prof = 1 - tN * tN;
  depth = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  // Floors at one kerf so the tips never close to a point (that made the field's slope blow up at short slots).
  const depthT = Math.max(depth * prof, kerf);
  const kerfT = kerf * (1 + jag) * (0.35 + 0.65 * prof);
  const vWall = kerfT * (1 - clamp(s, 0, depthT) / depthT) - Math.abs(u);
  return Math.min(vWall, depthT - s, halfLen - Math.abs(a)) * CUT_SHADE.carveK;
}

export interface SweepSample { point: Vec3; view: Vec3 }
/** `view` is the averaged view direction of the run's samples (camera to scene). The slot's thin axis is along × inward,
 *  normal to the skin, by design, so no separate cut normal is kept. */
export interface CutSeg { a: Vec3; b: Vec3; view: Vec3 }

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
 *  run of consecutive samples on the same cluster, clamped to CUT.maxLen about its midpoint; shorter than minLen: dropped.
 *  A lone sample whose two neighbours share a cluster is relabelled to it (jitter at a seam must not split a cut), and
 *  when more than maxPerSlash candidates exist the LONGEST are kept (returned in sweep order). */
export function cutsFromSweep(prims: readonly Primitive[], samples: readonly SweepSample[]): CutSeg[] {
  const raw = samples.map(s => nearestCluster(prims, s.point));
  const labels = raw.slice();
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i] !== raw[i - 1] && raw[i] !== raw[i + 1] && raw[i - 1] === raw[i + 1]) labels[i] = raw[i - 1]!;
  }
  const runs: SweepSample[][] = [];
  for (let i = 0; i < samples.length; i++) {
    if (i === 0 || labels[i] !== labels[i - 1]) runs.push([]);
    runs[runs.length - 1]!.push(samples[i]!);
  }
  const cands: { seg: CutSeg; len: number; order: number }[] = [];
  runs.forEach((run, order) => {
    if (run.length < 2) return;
    let a = run[0]!.point, b = run[run.length - 1]!.point;
    const d = sub(b, a), l = Math.hypot(d[0], d[1], d[2]);
    if (l < CUT.minLen) return;
    let len = l;
    if (l > CUT.maxLen) {
      const m = scale(add(a, b), 0.5), h = scale(d, CUT.maxLen / (2 * l));
      a = sub(m, h); b = add(m, h);
      len = CUT.maxLen;
    }
    const view = unit(run.reduce((acc, s) => add(acc, s.view), [0, 0, 0] as Vec3), [0, 0, -1]);
    cands.push({ seg: { a, b, view }, len, order });
  });
  return cands
    .sort((x, y) => y.len - x.len)
    .slice(0, CUT.maxPerSlash)
    .sort((x, y) => x.order - y.order)
    .map(c => c.seg);
}

function grad(field: (p: Vec3) => number, p: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 {
  const e = 1e-3;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ], fb);
}

/** Find the skin the viewer sees at the chord midpoint `mid`: march along -view (toward the viewer) from inside the body, or
 *  along +view from outside it, until the field changes sign, bisect to the zero set, then refine with a few gradient steps.
 *  The total walk from `mid` is capped at `maxWalk`. A silhouette-to-silhouette chord has its midpoint on the limb's axis,
 *  where the gradient is meaningless; the view march is what finds the skin there. A zero gradient falls back to -view. */
function toSurface(field: (p: Vec3) => number, mid: Vec3, view: Vec3, maxWalk: number): Vec3 {
  const f0 = field(mid);
  if (Math.abs(f0) < 2e-4) return mid;
  const inside = f0 <= 0;
  const dir = inside ? scale(view, -1) : view;
  const STEP = 0.005;
  let q = mid;
  let lo = 0, hi = -1;
  for (let t = STEP; t <= maxWalk + 1e-9; t += STEP) {
    if ((field(add(mid, scale(dir, t))) <= 0) !== inside) { hi = t; break; }
    lo = t;
  }
  if (hi > 0) {
    for (let i = 0; i < 24; i++) {
      const m = 0.5 * (lo + hi);
      if ((field(add(mid, scale(dir, m))) <= 0) === inside) lo = m; else hi = m;
    }
    q = add(mid, scale(dir, 0.5 * (lo + hi)));
  }
  const out = scale(view, -1);   // the outward direction when the gradient is degenerate
  for (let i = 0; i < 4; i++) {
    const d = field(q);
    if (Math.abs(d) < 2e-4) break;
    const next = sub(q, scale(grad(field, q, out), d));
    const off = sub(next, mid), n = Math.hypot(off[0], off[1], off[2]);
    q = n > maxWalk ? add(mid, scale(off, maxWalk / n)) : next;
  }
  return q;
}

/** Any unit vector perpendicular to `n`. */
function perp(n: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, axis));
}

/** One cut wound from a segment on the body (world space at `bodyYaw`). */
export function stampCut(prims: Primitive[], seg: CutSeg, calibre: CutCalibre, bodyYaw: number, field: (p: Vec3) => number): Wound {
  const d = sub(seg.b, seg.a);
  const half = Math.min(CUT.maxLen, Math.hypot(d[0], d[1], d[2])) / 2;
  const view = unit(seg.view, [0, 0, -1]);
  const anchor = toSurface(field, scale(add(seg.a, seg.b), 0.5), view, half + 0.05);
  // No field: the cut sizes its own depth and rim below (a crater's probe caps are the wrong ones for it).
  const w = worldHitToWound(prims, anchor, half, 'pellet', bodyYaw);
  const wantDepth = Math.min(calibre.depth, CUT.maxDepth);
  const flesh = fleshBehind(field, anchor, prims[w.primIdx]!, wantDepth / CUT.thickFrac);
  const inward = flesh.inward ?? unit(scale(grad(field, anchor, scale(view, -1)), -1));
  const thick = flesh.inward ? flesh.thick : wantDepth / CUT.thickFrac;   // on the prim's axis: assume enough flesh
  const t = sub(d, scale(inward, dot(d, inward)));
  const c = cross(inward, view);
  const alongW = Math.hypot(t[0], t[1], t[2]) > 1e-9 ? unit(t) : Math.hypot(c[0], c[1], c[2]) > 1e-9 ? unit(c) : perp(inward);
  w.shape = 'cut';
  w.carveN = worldDirToWoundLocal(prims, w, inward, bodyYaw);
  w.carveDepth = Math.min(wantDepth, thick * CUT.thickFrac);
  w.cutDir = worldDirToWoundLocal(prims, w, alongW, bodyYaw);
  w.kerf = calibre.kerf;
  w.rimScale = calibre.lip;
  w.severRadius = 0;
  w.wetLip = 1;
  return w;
}

/** The sphere list the bone-exposure consumers read (they know only craters): a crater is itself; a cut is a chain of
 *  spheres along its slot following the lens, each of radius max(2 kerf, depth x profile) and, at interior stations, pushed
 *  inward by half its radius (the slot is cut into the flesh, not on its skin). Stations are spaced by max(depth, 2 kerf). */
export function cutExposureSpheres(prims: Primitive[], w: Wound, bodyYaw: number): { pos: Vec3; radius: number }[] {
  const c = woundWorldPos(prims, w, bodyYaw);
  if (w.shape !== 'cut' || !w.cutDir) return [{ pos: c, radius: w.radius }];
  const along = unit(woundDirToWorld(prims, w, w.cutDir, bodyYaw));
  const inward = w.carveN ? unit(woundDirToWorld(prims, w, w.carveN, bodyYaw)) : null;
  const depth = w.carveDepth ?? 0.03, kerf = w.kerf ?? 0.01;
  const n = Math.max(2, Math.ceil((2 * w.radius) / Math.max(depth, 2 * kerf)));
  const out: { pos: Vec3; radius: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const radius = Math.max(2 * kerf, depth * (1 - t * t));
    let pos = add(c, scale(along, t * w.radius));
    if (inward && i > 0 && i < n) pos = add(pos, scale(inward, radius / 2));
    out.push({ pos, radius });
  }
  return out;
}
