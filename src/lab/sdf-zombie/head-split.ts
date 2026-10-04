// src/lab/sdf-zombie/head-split.ts
//
// THE HEAD SPLIT (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §5; plan
// docs/superpowers/plans/2026-10-04-head-split-part-b.md). Pure. An axe chop opens the head on a hinge; this module
// holds the presets, the preset choice from the chop's blade plane, the angle spring, the world-space split
// description (SplitWarp) and THE SPLIT FIELD.
//
// What moves: body material ABOVE the hinge plane AND within rho = r - REGION_MARGIN of the hinge point h (the head;
// rho is sized to hold it). The + side of the old plane turns open by thetaP, the - side by thetaM. Everything else
// (below the hinge plane, or farther than rho from h: the neck, a raised hand) stays put. With u = n x a,
// s(q) = n.q - d0, up(q) = u.(q - h), dh = |p - h| (rotation about h keeps dh), q+- = h + R(a, -theta+-)(p - h):
//
//   P0 = max(f(p),  min(up(p), rho - dh))                 the unmoved rest of the body
//   P+ = max(f(q+), -s(q+), -up(q+), dh - rho)            the + half, turned open by thetaP, capped to its piece
//   P- = max(f(q-),  s(q-), -up(q-), dh - rho)            the - half (thetaM <= 0), likewise
//   C  = REGION_MARGIN + |dh - r|                          the region shell bound (see below)
//
//   inside the region (dh <= r):  min(P0, P+, P-, C)
//   outside (dh > r):             min(P0, C)              (= min(P0, dh - rho); P+- are never evaluated)
//
// Outside the region P0 is f(p) except deep inside material, where f(p) < min(up(p), rho - dh) <= rho - dh < 0: only
// interior probes notice (the march, shadows and AO sample the sign and the outside). A side that does not move
// (theta 0) shares f(p) with P0, so a one-sided split costs two f evaluations inside the region.
//
// Each piece is a rigid motion of f intersected with half-spaces and a ball, so it is a sound, 1-Lipschitz distance
// bound, and so is their min. Outside the region P+- >= dh - rho = C, so dropping them for C under-estimates (sound)
// and never makes a false surface (C >= REGION_MARGIN > 0). C also caps the field inside the region: at dh = r both
// branches equal min(P0, REGION_MARGIN) (P+- >= dh - rho = REGION_MARGIN there), so the field is CONTINUOUS across
// the region sphere and 1-Lipschitz everywhere. Without that cap (the plan's first draft, min(f, dh - r + skin)
// outside and min of pieces inside) the field jumped by up to ~0.2 m at the sphere. Inside the region the cap only
// bites in empty space near the shell, where it limits a march step to (r - dh) + REGION_MARGIN: one step crosses out.
//
// The GPU (map-body.wgsl.ts) evaluates the same pieces; this is its CPU mirror and the reference for its tests.
import type { Vec3 } from './types';
import { add, cross, dot, len, normalize, qRotate, sub, type Quat } from './vec';

export type SplitPresetId = 'middle' | 'face';

export interface SplitPreset {
  /** Head-local plane normal (unit; the + side is the side that moves first). */
  n: Vec3;
  /** Head-local hinge point at plane offset 0, for both halves opening (`hingeBoth`) and one side (`hingeOne`). The
   *  hinge AXIS is up x n, so the point's component along that axis only places the region sphere's centre. */
  hingeBoth: Vec3; hingeOne: Vec3;
  /** Head-local "up" from the hinge into the head, in the plane. */
  up: Vec3;
  /** Opening angle (rad) at full open, each half: both halves vs one side. */
  maxBoth: number; maxOne: number;
}

/** The region sphere's radius is `rho + REGION_MARGIN`, where `rho` (= |centre - h| + 1.25 R) holds all the moved
 *  material. Also the floor of the region shell bound C, which caps the field in open air near the region sphere, so
 *  it must be at least the AO probe distance: occlusion.wgsl.ts reads clamp(mapBody(p + n * 0.06) / 0.06, 0.35, 1),
 *  and at 0.03 the cap darkened 14-20% of surface samples by up to 0.48 (0% at 0.06). */
export const REGION_MARGIN = 0.06;

export const HEAD_SPLIT = {
  presets: {
    // Sagittal: left and right halves. Centred: both halves, hinged low at the back of the skull. Off-centre: the
    // smaller side peels outward, hinged low by the jaw on that side (the owner's reference, 2026-10-04).
    middle: { n: [1, 0, 0], hingeBoth: [0, -0.06, -0.07], hingeOne: [0, -0.09, 0.01], up: [0, 1, 0], maxBoth: 0.55, maxOne: 0.9 },
    // Coronal: the face half folds forward and down, hinged low at the jaw front. Rare (a chop from the side).
    face: { n: [0, 0, 1], hingeBoth: [0, -0.1, 0.02], hingeOne: [0, -0.1, 0.02], up: [0, 1, 0], maxBoth: 0.8, maxOne: 0.8 },
  } satisfies Record<SplitPresetId, SplitPreset>,
  /** Off-centre impacts move the plane by up to this share of the head radius; inside `bothFrac` both halves open. */
  maxOffsetFrac: 0.4, bothFrac: 0.15,
  /** The face plane's offset range, as shares of the head radius (back, front). */
  faceOffsetFrac: [-0.3, 0.5],
  /** `rho` = |centre - h| + `holdFrac` * radius: the ball about the hinge that holds the moved head. */
  holdFrac: 1.25,
  /** The angle spring (head-deform.ts BURST_DEFORM's shape). `kick` scales the target into the initial rate. */
  hz: 7, zeta: 0.35, kick: 6, restA: 1e-4, restV: 1e-2,
} as const;

export interface SplitState {
  preset: SplitPresetId | null;
  /** +1 the + side moves, -1 the - side, 0 both. */
  sides: -1 | 0 | 1;
  /** Head-local plane offset along n (m). */
  offset: number;
  /** Current opening angle (rad, >= 0) and its rate; `target` is where the spring settles. */
  angle: number; vel: number; target: number;
}

export function makeSplitState(): SplitState {
  return { preset: null, sides: 0, offset: 0, angle: 0, vel: 0, target: 0 };
}

/** The preset for a chop: `bladeNormalLocal` is the blade plane's normal in head-local space (cross(blade dir, view),
 *  any sign), `impactLocal` the hit in head-local metres, `radius` the head's (headShape axes.x). */
export function choosePreset(bladeNormalLocal: Vec3, impactLocal: Vec3, radius: number): Pick<SplitState, 'preset' | 'sides' | 'offset'> {
  const ax = Math.abs(bladeNormalLocal[0]), az = Math.abs(bladeNormalLocal[2]);
  if (az > ax) {
    const [lo, hi] = HEAD_SPLIT.faceOffsetFrac;
    return { preset: 'face', sides: 1, offset: Math.max(lo * radius, Math.min(hi * radius, impactLocal[2])) };
  }
  const max = HEAD_SPLIT.maxOffsetFrac * radius;
  const off = Math.max(-max, Math.min(max, impactLocal[0]));
  const sides = Math.abs(off) < HEAD_SPLIT.bothFrac * radius ? 0 : off > 0 ? 1 : -1;
  return { preset: 'middle', sides, offset: sides === 0 ? 0 : off };
}

/** Spring the angle toward `target` (keeps the preset). */
export function kickSplit(st: SplitState, target: number): SplitState {
  return { ...st, target, vel: st.vel + (target - st.angle) * HEAD_SPLIT.kick };
}

/** Advance the spring (semi-implicit Euler, 1/240 s sub-steps); snaps onto the target when settled. */
export function stepSplit(st: SplitState, dt: number): SplitState {
  if (st.preset === null) return st;
  const w = 2 * Math.PI * HEAD_SPLIT.hz, z = HEAD_SPLIT.zeta;
  let a = st.angle, v = st.vel;
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) { v += (-w * w * (a - st.target) - 2 * z * w * v) * h; a += v * h; }
  if (Math.abs(a - st.target) < HEAD_SPLIT.restA && Math.abs(v) < HEAD_SPLIT.restV) { a = st.target; v = 0; }
  return { ...st, angle: Math.max(0, a), vel: v };
}

/** The head's frame: skull centre, world rotation (rig-bind.ts headQuatOf), radius (headShape axes.x). */
export interface HeadFrame { centre: Vec3; quat: Quat; radius: number }

/** The split in WORLD space for this frame (null when closed). The GPU record carries exactly these fields. */
export interface SplitWarp {
  /** Plane normal (unit) and offset: s(q) = n.q - d0. */
  n: Vec3; d0: number;
  /** Hinge point and unit axis a = normalize(up x n); u = n x a points up into the head, a x u = +n. */
  h: Vec3; a: Vec3;
  /** + side and - side angles (rad): thetaP >= 0, thetaM <= 0. Turning by +theta about a moves the + side to +n. */
  thetaP: number; thetaM: number;
  /** The region sphere: centred on h, radius r. The moved material lies within r - REGION_MARGIN of h. */
  r: number;
}

/** Rodrigues: v rotated by t (right-handed) about unit axis k. */
export function rotAxis(v: Vec3, k: Vec3, t: number): Vec3 {
  const c = Math.cos(t), s = Math.sin(t), d = dot(k, v), x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

export function splitWarpOf(st: SplitState, f: HeadFrame): SplitWarp | null {
  if (st.preset === null || !(st.angle > 0)) return null;
  const p = HEAD_SPLIT.presets[st.preset];
  const hL0 = st.sides === 0 ? p.hingeBoth : p.hingeOne;
  const hL: Vec3 = [hL0[0] + p.n[0] * st.offset, hL0[1] + p.n[1] * st.offset, hL0[2] + p.n[2] * st.offset];
  const n = normalize(qRotate(f.quat, p.n));
  const up = normalize(qRotate(f.quat, p.up));
  const a = normalize(cross(up, n));
  const h = add(f.centre, qRotate(f.quat, hL));
  const d0 = dot(n, f.centre) + st.offset;
  return {
    n, d0, h, a,
    thetaP: st.sides >= 0 ? st.angle : 0,
    thetaM: st.sides <= 0 ? -st.angle : 0,
    r: len(sub(f.centre, h)) + f.radius * HEAD_SPLIT.holdFrac + REGION_MARGIN,
  };
}

/** p taken back by -theta about the hinge (theta 0 returns p itself). The GPU's splitMoveBack. */
const moveBack = (w: SplitWarp, p: Vec3, theta: number): Vec3 =>
  theta === 0 ? p : add(w.h, rotAxis(sub(p, w.h), w.a, -theta));

/** P0's cap, min(up(p), rho - dh): the rest stays where it is below the hinge plane or at least rho from h. One
 *  place for both branches of splitField. */
const restCap = (w: SplitWarp, p: Vec3, dh: number): number =>
  Math.min(dot(cross(w.n, w.a), sub(p, w.h)), w.r - REGION_MARGIN - dh);

/** The three pieces at p (index 0 = the unmoved rest, 1 = the + half, 2 = the - half): their un-warped points and
 *  capped fields. `dh` = |p - h|. A side that does not move (theta 0, the larger side of a one-sided split) is at p
 *  itself, so it reuses f(p): min(max(f, c0), max(f, c1)) = max(f, min(c0, c1)), exactly. A one-sided split costs
 *  two f evaluations, a two-sided one three. */
function pieces(w: SplitWarp, f: (q: Vec3) => number, p: Vec3, dh: number): { q: Vec3; d: number }[] {
  const u = cross(w.n, w.a), rho = w.r - REGION_MARGIN;
  const s = (q: Vec3) => dot(w.n, q) - w.d0;
  const up = (q: Vec3) => dot(u, sub(q, w.h));
  const fp = f(p);
  const qp = moveBack(w, p, w.thetaP), qm = moveBack(w, p, w.thetaM);
  const fqp = w.thetaP === 0 ? fp : f(qp), fqm = w.thetaM === 0 ? fp : f(qm);
  return [
    { q: p, d: Math.max(fp, restCap(w, p, dh)) },
    { q: qp, d: Math.max(fqp, -s(qp), -up(qp), dh - rho) },
    { q: qm, d: Math.max(fqm, s(qm), -up(qm), dh - rho) },
  ];
}

/** The split field (see the header). `f` is the un-split body field. */
export function splitField(w: SplitWarp | null | undefined, f: (q: Vec3) => number, p: Vec3): number {
  if (!w) return f(p);
  const dh = len(sub(p, w.h));
  const shell = REGION_MARGIN + Math.abs(dh - w.r);
  if (dh > w.r) return Math.min(Math.max(f(p), restCap(w, p, dh)), shell);
  let best = shell;
  for (const pc of pieces(w, f, p, dh)) best = Math.min(best, pc.d);
  return best;
}

/** Where a point on the split head lives in the UN-WARPED head (wounds are stamped there; the GPU reads them there):
 *  the winning piece's un-warped point. `piece` 0 = the unmoved rest, 1 = the + half, 2 = the - half. */
export function unwarpPoint(w: SplitWarp | null | undefined, p: Vec3, f: (q: Vec3) => number): { q: Vec3; piece: 0 | 1 | 2 } {
  if (!w) return { q: p, piece: 0 };
  const dh = len(sub(p, w.h));
  if (dh > w.r) return { q: p, piece: 0 };
  const ps = pieces(w, f, p, dh);
  let k = 0;
  for (let i = 1; i < 3; i++) if (ps[i]!.d < ps[k]!.d) k = i;
  return { q: ps[k]!.q, piece: k as 0 | 1 | 2 };
}

/** A direction (e.g. a view or a normal) into the winning piece's un-warped frame. */
export function unwarpDir(w: SplitWarp | null | undefined, piece: 0 | 1 | 2, v: Vec3): Vec3 {
  if (!w || piece === 0) return v;
  return rotAxis(v, w.a, piece === 1 ? -w.thetaP : -w.thetaM);
}
