// src/lab/sdf-zombie/cut-wound.ts
//
// CUT WOUNDS (spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §3-4). Pure. A cut is a wound SHAPE beside the
// crater: a blade SLOT along a segment, deepest at its middle (a lens), its walls closing into a V, jagged and lipped on the
// GPU. It rides one prim exactly like a crater: `local` is its midpoint, `radius` its HALF-LENGTH (every sphere bound the
// wound pipeline keeps stays a superset), `carveN`/`carveDepth` its inward direction and depth, `cutDir` its along-segment
// unit, `kerf` its half-width at the skin. `cutCarve` is the CPU mirror of the WGSL slot (applyWounds' cut branch) for tests
// and docs; keep the two identical apart from the GPU's noise.
// The sweep grouping fixes single-sample jitter only: two-sample jitter or a lone end sample can still split a run (acceptable
// for v1).
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
  /** Half-width at the skin (m) when a cut wound carries no kerf of its own. */
  defaultKerf: 0.01,
} as const;

/** The WGSL slot's look constants (interpolated into fields/wounds.wgsl.ts like torn-lips.ts's TORN). */
export const CUT_SHADE = {
  /** Jagged walls: noise frequency (1/m) and how much it widens or narrows the kerf. */
  jagFreq: 90,
  jagAmp: 0.35,
  /** Field scale for the slot (the zero set is unchanged). MEASURED, not argued: with this scale cutCarve's max |grad| over
   *  a dense grid, WGSL-shaped call included (dIn from the curved fixture body, sag from stampCut), is <= 2.2 over half-lengths
   *  0.015-0.175, depths 0.03-0.15 and kerfs 0.006-0.015: measured max 2.075 (the test logs it), i.e. near the stock
   *  crater's bound (~2.06, layout.ts) rather than under it; the step multiplier decision there applies unchanged. */
  carveK: 0.7,
  /** A slot's depth never exceeds this x its half-length: the lens floor's slope is ~2 depth / halfLen, so a deep, very short
   *  slot (0.06 deep over 0.015 half-length measured |grad| 4.96) would be a wall the march steps through. 1.4 bounds the
   *  floor term at 0.7 x sqrt(1 + 2.8^2) ~ 2.08. */
  maxDepthPerHalfLen: 1.4,
  /** Lip: centre offset from the slot axis, width and height, all × kerf; height also × META.z (rim splay scale). */
  lipOffset: 1.5,
  lipWidth: 1.2,
  lipHeight: 0.9,
  /** The cut lip's scale (META.z = pellet rimSplayScale 0.8 x calibre lip) is clamped to this, and the whole-field
   *  Lipschitz test runs at it as well as at the rod's 0.8. MEASURED: max |grad| stays at the carve's own 2.075 up to
   *  1.1; at 1.333 it reached 2.275 (the lip's along-slot slope at the tip of a 0.015 half-length, kerf-0.015 cut). */
  maxLipScale: 1.1,
  /** The shading mask's soft edge, × kerf. */
  maskWidth: 2.2,
  /** The lid's slack above the anchor's tangent plane, × halfLen (on top of one kerf): room for a concave crease's skin
   *  to rise above that plane without the lid closing the slot (cutCarve). */
  lidSlack: 0.25,
} as const;

export interface CutCalibre { depth: number; kerf: number; lip: number }
/** The rod stand-in's blade (tunable). */
export const ROD_CALIBRE: CutCalibre = { depth: 0.06, kerf: 0.01, lip: 1 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const unit = (v: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 => (Math.hypot(v[0], v[1], v[2]) > 1e-9 ? normalize(v) : fb);

/** The slot's inside-positive carve term at `p` (no noise): the CPU mirror of applyWounds' cut branch, one path only.
 *  `mid` is the wound's anchor on the skin; `dIn` is the PRE-WOUND body field at `p` (after carves, before ANY wound: the
 *  WGSL passes applyWounds' `dIn`, never the running `d`); `sag` is the wound's stored chord sag. The slot's depth
 *  coordinate is `s = max(-dIn, along-inward distance - sag)`: the depth below the real skin where that is the deeper
 *  reading (it follows curved skin) but never shallower than the slot's own plane, so a cut can not open the far skin of a
 *  thin limb (`-dIn` alone is depth below the NEAREST skin, which is the far side behind the middle of an arm). The lip
 *  is `cutLip` below (subtracted after the carve's smax). */
export function cutCarve(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, dIn: number, sag: number, jag = 0, lid = true): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), u = dot(rel, side);
  const s = Math.max(-dIn, dot(rel, inward) - sag);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const prof = 1 - tN * tN;
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  // Floors at one kerf so the tips never close to a point (that made the field's slope blow up at short slots).
  const depthT = Math.max(dEff * prof, Math.max(kerf, 1e-4));
  const kerfT = kerf * (1 + jag) * (0.35 + 0.65 * prof);
  const vWall = kerfT * (1 - clamp(s, 0, depthT) / depthT) - Math.abs(u);
  // The LID (plane + kerf + lidSlack x halfLen): the slot is closed that far outward of the anchor's tangent plane (the
  // RAW plane, not the skin-relative `s`). It stops the carve slicing a FOREIGN limb lying across the channel above the
  // cut: inside that limb dIn < 0, so `s` (>= -dIn) reads the depth below the FOREIGN skin and no `s`-based term closes
  // the slot there. On convex skin the owner's flesh under the slot lies inward of the anchor's tangent plane, so
  // `plane + kerf` alone changes no owner surface; in a concave crease (an armpit) the skin rises above that plane, and
  // the slack keeps the lid above it (measured, cut-wound.test.ts: 0 owner sign flips on every convex fixture with no
  // slack; the three crease fixtures flipped ~70k of 4.4M near-surface samples with none, and 1863 with 0.25 h, all
  // on the oblique armpit cut). A flip can only REMOVE carve (the lid lowers the carve): the cut stops short of a wall that rises
  // steeply above the anchor, it never opens flesh. The term's gradient is 1 x carveK, like the others.
  // `lid = false` is a test seam only (the zero-set test compares the two); the WGSL always has the lid.
  return Math.min(vWall, depthT - s, halfLen - Math.abs(a), lid ? dot(rel, inward) + kerf + CUT_SHADE.lidSlack * halfLen : Infinity) * CUT_SHADE.carveK;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** How much the cut's LIPS lower the field at `p` (>= 0; subtract it from the carved field): the CPU mirror of the lip in
 *  applyWounds' cut branch, term for term. Two everted ridges along the slot's edges, as high as the lens is deep
 *  (`prof`) and scaled by `lipScale` (META.z). Three gates keep it where a lip belongs:
 *  - `rim`: only near the PRE-WOUND skin (`dIn`), as the crater's rim is. Its band is the WOUND's scale, `rimB` = max(peak
 *    lip height, lip width), constant along the slot: the crater's form (a band of the local height, amp) has a slope x
 *    height of 1.5 whatever the scale, which added 1.5 to the body's own |grad| 1 (measured 2.51 on a 0.015 half-length
 *    cut) and, as amp shrinks toward the tips, a steep along-slot term too. With rimB the rim's contribution is at most
 *    1.5 x amp / rimB <= 1.5 x 0.6 at the rod's lip scale (measured whole-field max: the Lipschitz test);
 *  - `offKerf`: zero inside the slot's own kerf, so the lip never refills the slot it borders;
 *  - `nearSkin`: zero once the slot's depth coordinate `s` (cutCarve's) is two lip widths deep, so the lip lives at the
 *    near skin only and never bulges the far skin behind the cut (where `dIn` is again ~0). */
export function cutLip(p: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, kerf: number, dIn: number, sag: number, lipScale: number, jag = 0): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = dot(rel, along), u = Math.abs(dot(rel, side));
  const s = Math.max(-dIn, dot(rel, inward) - sag);
  const tN = clamp(a / Math.max(halfLen, 1e-4), -1, 1);
  const prof = 1 - tN * tN;
  const kerfT = kerf * (1 + jag) * (0.35 + 0.65 * prof);
  const lipW = Math.max(kerf * CUT_SHADE.lipWidth, 1e-4);
  // The lip scale is clamped (maxLipScale): the measured slope bound holds up to it, not for any calibre's lip.
  const amp0 = kerf * CUT_SHADE.lipHeight * Math.min(lipScale, CUT_SHADE.maxLipScale);
  const amp = amp0 * prof;
  const lx = (u - kerf * CUT_SHADE.lipOffset) / lipW;
  const rimB = Math.max(amp0, lipW);
  const rim = 1 - smoothstep(-0.3 * rimB, 0.7 * rimB, dIn);
  const offKerf = smoothstep(kerfT, kerfT + lipW, u);
  const nearSkin = 1 - smoothstep(0, 2 * lipW, s);
  return amp * Math.exp(-lx * lx) * rim * offKerf * nearSkin;
}

/** The cut's surface-shading footprint at `p` with outward surface normal `nrm`, 0..1: the CPU mirror of woundMask's cut
 *  branch, term for term. A band either side of the slot (kerf to maskWidth x kerf), fading out past the tips, gated off
 *  surfaces that face along the slot's inward axis (`back`: the far skin of the cut limb, dot(nrm, inward) ~ +1; the slot's
 *  walls (~0), floor and lips (~-1) keep the band), and, as a second guard, fading out beyond the slot's floor measured
 *  from its own chord plane (`far`). `far` alone left a stripe on thin limbs: the floor sits only 0.2 x thick above the
 *  back skin, inside the 2-kerf fade whenever 0.2 thick < 2 kerf (a 0.03 m arm: 0.76 rod, 1.0 kerf 0.015). No `dIn`:
 *  the mask runs on shaded surface points. */
export function cutMask(p: Vec3, nrm: Vec3, mid: Vec3, halfLen: number, along: Vec3, inward: Vec3, depth: number, kerf: number, sag: number): number {
  const rel = sub(p, mid);
  const side = cross(along, inward);
  const a = Math.abs(dot(rel, along)), u = Math.abs(dot(rel, side));
  const plane = dot(rel, inward) - sag;
  const k = Math.max(kerf, 1e-4);   // WGSL leaves smoothstep(e, e, x) undefined: a zero kerf must not reach it
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * halfLen);
  const band = 1 - smoothstep(k, k * CUT_SHADE.maskWidth, u);
  const ends = 1 - smoothstep(halfLen * 0.85, halfLen * 1.15, a);
  const far = 1 - smoothstep(dEff + k, dEff + 2 * k, plane);
  const back = 1 - smoothstep(0.25, 0.6, dot(nrm, inward));
  return band * ends * far * back;
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
  // The inward direction first (a short probe is enough to find it), then the sag, then the flesh: the slot's floor sits
  // at sag + depth below the anchor along `inward`, so the flesh that bounds the depth is measured to that point.
  const dir = fleshBehind(field, anchor, prims[w.primIdx]!, 0);
  const inward = dir.inward ?? unit(scale(grad(field, anchor, scale(view, -1)), -1));
  // Only the drop along the inward direction is skin fall-off; the straight-line distance would also count the anchor's
  // sideways shift under an oblique view and reopen the far skin.
  const sag = Math.max(0, dot(sub(scale(add(seg.a, seg.b), 0.5), anchor), inward));
  const flesh = fleshBehind(field, anchor, prims[w.primIdx]!, (sag + wantDepth) / CUT.thickFrac);
  // On the prim's axis (no inward from the probe): assume enough flesh.
  const thick = flesh.inward ? flesh.thick : (sag + wantDepth) / CUT.thickFrac;
  const t = sub(d, scale(inward, dot(d, inward)));
  const c = cross(inward, view);
  const alongW = Math.hypot(t[0], t[1], t[2]) > 1e-9 ? unit(t) : Math.hypot(c[0], c[1], c[2]) > 1e-9 ? unit(c) : perp(inward);
  w.shape = 'cut';
  w.carveN = worldDirToWoundLocal(prims, w, inward, bodyYaw);
  // A slash across a thin limb's silhouette has its chord on the limb's axis (sag = the radius): the depth left is what
  // fits between the chord and thickFrac of the flesh, floored at one kerf (the slot's own floor: cutCarve's depthT).
  w.carveDepth = Math.max(calibre.kerf, Math.min(wantDepth, CUT.thickFrac * thick - sag, CUT_SHADE.maxDepthPerHalfLen * half));
  w.cutDir = worldDirToWoundLocal(prims, w, alongW, bodyYaw);
  w.kerf = calibre.kerf;
  w.sag = sag;
  w.rimScale = calibre.lip;
  w.severRadius = 0;
  w.wetLip = 1;
  return w;
}

/** The sphere list the bone-exposure consumers read (they know only craters): a crater is itself; a cut is a chain of
 *  stations along its slot, one per `max(depth, 2 kerf)`, covering the flesh cutCarve removes there. At station t the slot
 *  is `r = dEff x (1 - t^2)` deep (floored at one kerf, as depthT is) BELOW THE SKIN: cutCarve's depth coordinate is
 *  `s = max(-dIn, plane - sag)`, so the carve never goes more than depthT below the nearest skin, and also stops at the
 *  plane `sag + depthT`. The skin itself lies `skin(x)` below the anchor's tangent plane: the circle through the anchor and
 *  the chord's ends (the chord sits `sag` below the anchor), R = (h^2 + sag^2) / (2 sag), skin(x) = R - sqrt(R^2 - x^2),
 *  which is 0 on a straight limb (sag 0) and `sag` at the chord's ends. A station is a sphere of radius max(2 kerf,
 *  r/2 + kerf) centred `skin + r/2` along the inward axis: it spans skin to floor and stays tight sideways. At sag 0 this
 *  is the original lens; a thin limb's silhouette cut (sag ~ the limb's radius) curves the chain down to the chord. */
export function cutExposureSpheres(prims: Primitive[], w: Wound, bodyYaw: number): { pos: Vec3; radius: number }[] {
  const c = woundWorldPos(prims, w, bodyYaw);
  if (w.shape !== 'cut' || !w.cutDir) return [{ pos: c, radius: w.radius }];
  const along = unit(woundDirToWorld(prims, w, w.cutDir, bodyYaw));
  const inward = w.carveN ? unit(woundDirToWorld(prims, w, w.carveN, bodyYaw)) : null;
  const depth = w.carveDepth ?? 0.03, kerf = w.kerf ?? CUT.defaultKerf;
  const h = w.radius, sag = Math.max(0, w.sag ?? 0);
  const dEff = Math.min(depth, CUT_SHADE.maxDepthPerHalfLen * h);
  const R = sag > 1e-6 ? (h * h + sag * sag) / (2 * sag) : Infinity;
  const n = Math.max(2, Math.ceil((2 * h) / Math.max(depth, 2 * kerf)));
  const out: { pos: Vec3; radius: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const r = Math.max(dEff * (1 - t * t), kerf);
    const x = t * h;
    const skin = Number.isFinite(R) ? R - Math.sqrt(Math.max(R * R - x * x, 0)) : 0;
    const radius = Math.max(2 * kerf, r / 2 + kerf);
    let pos = add(c, scale(along, x));
    if (inward) pos = add(pos, scale(inward, skin + r / 2));
    out.push({ pos, radius });
  }
  return out;
}
