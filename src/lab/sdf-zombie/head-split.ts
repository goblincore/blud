// src/lab/sdf-zombie/head-split.ts
//
// THE HEAD SPLIT (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §5; plan
// docs/superpowers/plans/2026-10-04-head-split-part-b.md). Pure. An axe chop opens the head on a hinge; this module
// holds the presets, the preset choice from the chop's blade plane, the angle spring, the world-space split
// description (SplitWarp), THE SPLIT FIELD, the maps between the open head and the closed one (unwarpPoint,
// warpPoint) and the cut faces' segments.
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
import { add, cross, dot, len, normalize, qRotate, scale, sub, type Quat } from './vec';

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

/** The region sphere's radius is `rho + REGION_MARGIN`, where `rho` (= |centre - h| + holdFrac x HeadFrame.radius)
 *  holds all the moved material. Also the floor of the region shell bound C, which caps the field in open air near
 *  the region sphere, so it must be at least the AO probe distance: occlusion.wgsl.ts reads
 *  clamp(mapBody(p + n * 0.06) / 0.06, 0.35, 1), and at 0.03 the cap darkened 14-20% of surface samples by up to 0.48
 *  (0% at 0.06). */
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
  /** A hit on an open head is on the OUTER skin when the closed head's field there is within this of zero; deeper, it
   *  is on a cut face (or the hinge-plane face), which un-warps to the inside of the closed head. */
  skinEps: 0.015,
  /** The cut faces (splitFaceSegs): each segment sits `inset` into its own half off the plane and runs `lenFrac` x the
   *  frame radius either way along the hinge axis; `faceCalibre` is the cut stamped along it (cut-wound.ts
   *  CutCalibre). */
  faceCut: { inset: 0.006, lenFrac: 1.1 },
  faceCalibre: { depth: 0.12, kerf: 0.012, lip: 1 },
  /** The angle spring (head-deform.ts BURST_DEFORM's shape). `kick` scales the target into the initial rate. */
  hz: 7, zeta: 0.35, kick: 6, restA: 1e-4, restV: 1e-2,
} as const;

/** THE CUT FACES' SHADING (the march after the hit: webgpu/march/body/blocks/post/split-hit.wgsl.ts). A piece cap is
 *  the surface where it holds the split field above the piece's own field; that gap, (the split field) - (the piece's
 *  field before its caps), is exactly 0 on skin and the depth inside the closed body on a cut face. The hit shades as
 *  skin up to `cutLo` of it and as wound interior from `cutHi` (the tissue ramp by that depth, wet, no skin detail, no
 *  face sheet), blending between. `cutHi` is the zombie's fat stop (fatDepth, 4 mm): the gate is fully open where the
 *  tissue ramp reaches its pale fat band, and the ramp's first stop (skin to fat) lies under the blend.
 *  The walk's shell noise fades out over the same range. */
export const SPLIT_SHADE = { cutLo: 0.0015, cutHi: 0.004 } as const;

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
 *  any sign), `impactLocal` the hit in head-local metres, `radius` the head's HALF-WIDTH (the skull's x semi-axis,
 *  flame-anchors.ts headShape axes.x): the offsets are shares of it. Not HeadFrame.radius, which is the larger hold
 *  radius. */
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

/** The preset's full opening angle for this state: both halves vs one side (0 when closed). */
export function splitMaxAngle(st: Pick<SplitState, 'preset' | 'sides'>): number {
  if (st.preset === null) return 0;
  const p = HEAD_SPLIT.presets[st.preset];
  return st.sides === 0 ? p.maxBoth : p.maxOne;
}

/** The chop that opens a head: its preset (choosePreset), sprung from closed toward `frac` of the preset's max. */
export function openSplit(bladeNormalLocal: Vec3, impactLocal: Vec3, halfWidth: number, frac: number): SplitState {
  const st = { ...makeSplitState(), ...choosePreset(bladeNormalLocal, impactLocal, halfWidth) };
  return kickSplit(st, frac * splitMaxAngle(st));
}

/** A later chop: spring on to `frac` of the preset's max. The preset, side and offset stay; the target never drops. */
export function widenSplit(st: SplitState, frac: number): SplitState {
  if (st.preset === null) return st;
  return kickSplit(st, Math.max(st.target, frac * splitMaxAngle(st)));
}

/** A split set by hand (the tuning / gate seam): at `angleFrac` of the max at once, at rest. `offset` is head-local
 *  metres along n and is not clamped, nor is `angleFrac` above 1; `angleFrac` <= 0 is the closed state. The seam is
 *  called from a console, so what is not a split is refused (null): an unknown preset, a side that is not -1 / 0 / 1,
 *  a non-finite offset or angle. */
export function forcedSplit(
  preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, angleFrac: number,
): SplitState | null {
  if (!Object.hasOwn(HEAD_SPLIT.presets, preset) || !(sides === -1 || sides === 0 || sides === 1)
    || !Number.isFinite(offset) || !Number.isFinite(angleFrac)) return null;
  if (!(angleFrac > 0)) return makeSplitState();
  const angle = angleFrac * splitMaxAngle({ preset, sides });
  return { preset, sides, offset, angle, vel: 0, target: angle };
}

/** The head's frame: skull centre, world rotation (rig-bind.ts headQuatOf) and the hold radius (headFrameOf). */
export interface HeadFrame { centre: Vec3; quat: Quat; radius: number }

/** The frame of a skull (flame-anchors.ts headShape: its centre and semi-axes) turned by `quat`. The radius is the
 *  skull's LARGEST semi-axis, because rho = |centre - h| + holdFrac x radius must hold all the head flesh above the
 *  hinge plane, for every preset, hinge and offset: whatever lies within holdFrac x radius of the centre is within rho
 *  of any hinge. Measured on the zombie (semi-axes 0.090, 0.137, 0.105): that flesh reaches 0.152 m from the centre
 *  (the jaw, under the face preset's low hinge) against 1.25 x 0.137 = 0.171. With the half-width (0.090) the crown
 *  (0.137 up) lay outside rho, stayed behind and tore. */
export function headFrameOf(skull: { centre: Vec3; axes: Vec3 }, quat: Quat): HeadFrame {
  return { centre: skull.centre, quat, radius: Math.max(skull.axes[0], skull.axes[1], skull.axes[2]) };
}

const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** A world point / direction in head-local space (x right, y up, z face-forward; metres from the skull centre). */
export function headLocalPoint(f: HeadFrame, p: Vec3): Vec3 { return qRotate(conj(f.quat), sub(p, f.centre)); }
export function headLocalDir(f: HeadFrame, v: Vec3): Vec3 { return qRotate(conj(f.quat), v); }

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

/** A preset's axes in WORLD space for the head frame `f`: the plane normal n, the in-plane up, and the hinge axis
 *  a = normalize(up x n). */
function presetBasis(p: SplitPreset, f: HeadFrame): { n: Vec3; up: Vec3; a: Vec3 } {
  const n = normalize(qRotate(f.quat, p.n));
  const up = normalize(qRotate(f.quat, p.up));
  return { n, up, a: normalize(cross(up, n)) };
}

export function splitWarpOf(st: SplitState, f: HeadFrame): SplitWarp | null {
  if (st.preset === null || !(st.angle > 0)) return null;
  const p = HEAD_SPLIT.presets[st.preset];
  const hL0 = st.sides === 0 ? p.hingeBoth : p.hingeOne;
  const hL: Vec3 = [hL0[0] + p.n[0] * st.offset, hL0[1] + p.n[1] * st.offset, hL0[2] + p.n[2] * st.offset];
  const { n, a } = presetBasis(p, f);
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

/** The forward map, unwarpPoint's inverse on the closed head's material: where the closed-head point `q` is on the
 *  open head, and the piece that carries it. `q` is on the + half (piece 1) when it is above the hinge plane, within
 *  rho of h and on the + side of the plane (s(q) >= 0), on the - half (piece 2) likewise on the - side, else on the
 *  unmoved rest (piece 0); a half's points turn by its angle about the hinge. What rides the head but is stored on the
 *  closed prims (a wound's blood emitter) goes through here. */
export function warpPoint(w: SplitWarp | null | undefined, q: Vec3): { p: Vec3; piece: 0 | 1 | 2 } {
  if (!w) return { p: q, piece: 0 };
  const rel = sub(q, w.h);
  if (dot(cross(w.n, w.a), rel) < 0 || len(rel) > w.r - REGION_MARGIN) return { p: q, piece: 0 };
  const piece = dot(w.n, q) - w.d0 >= 0 ? 1 : 2;
  const theta = piece === 1 ? w.thetaP : w.thetaM;
  return { p: theta === 0 ? q : add(w.h, rotAxis(rel, w.a, theta)), piece };
}

/** A direction on the closed head (a wound's outward normal) turned with its piece: unwarpDir's inverse. */
export function warpDir(w: SplitWarp | null | undefined, piece: 0 | 1 | 2, v: Vec3): Vec3 {
  if (!w || piece === 0) return v;
  return rotAxis(v, w.a, piece === 1 ? w.thetaP : w.thetaM);
}

/** THE HOLD BALL: centre h, radius rho = r - REGION_MARGIN. Every SURFACE a split adds is inside it: an opened half is
 *  capped at dh <= rho (P+-), and outside the ball the body is where its prims are (P0 = f). So a bound on where the
 *  body's surface can be (a proxy box, a cull sphere, a screen tile, a hull) needs this ball and not the region sphere:
 *  between rho and r there is only the shell bound C, which is at least REGION_MARGIN and so never a surface. */
export function splitHoldBall(w: SplitWarp): { centre: Vec3; radius: number } {
  return { centre: w.h, radius: w.r - REGION_MARGIN };
}

/** A split made ready for sphere tests (once per split, not per sphere): `u` = n x a, up from the hinge into the
 *  head, and the hold ball's radius. With it, for a point c: up(c) = u.(c - h), s(c) = n.c - d0, dh = |c - h|. */
export interface SplitFrame { w: SplitWarp; u: Vec3; rho: number }

export function splitFrame(w: SplitWarp | null | undefined): SplitFrame | null {
  return w ? { w, u: cross(w.n, w.a), rho: w.r - REGION_MARGIN } : null;
}

/** WHICH TURNING HALVES A SPHERE OF THE CLOSED BODY CAN HOLD FLESH OF: bit 1 the + half, bit 2 the - half, 0 none.
 *  The one gate of every bound below. A half's flesh is above the hinge plane (up >= 0), inside the hold ball
 *  (dh <= rho) and on its side of the old plane (s >= 0 for +, s <= 0 for -), and it moves only if its half turns
 *  (theta != 0). A sphere that cannot reach all of that holds nothing that moves: what it bounds is where the
 *  closed prims put it. */
export function splitHolds(f: SplitFrame, centre: Vec3, radius: number): number {
  const rel = sub(centre, f.w.h);
  if (dot(f.u, rel) + radius < 0 || len(rel) - radius > f.rho) return 0;
  const s = dot(f.w.n, centre) - f.w.d0;
  return (f.w.thetaP !== 0 && s + radius >= 0 ? 1 : 0) | (f.w.thetaM !== 0 && s - radius <= 0 ? 2 : 0);
}

/** THE RULE FOR A BOUND THAT IS ONE SPHERE. `centre` / `radius` bounds some of the CLOSED body's material (a cluster,
 *  a prim group), and `reach` is how far past it that material still shapes the field (its blend). If the sphere
 *  holds flesh of a turning half (splitHolds, with the reach), that flesh may be anywhere in the hold ball, and the
 *  sphere grows to the smallest one holding itself and the ball; otherwise it stays. For a reader that tests a
 *  WORLD ray or a screen position (the depth pre-pass's miss cull, the screen tiles). The grown sphere still holds
 *  the closed one, so mapBody's own culls, which test a piece's UN-WARPED point, may read it too: they cull less. */
export function splitBound(
  f: SplitFrame | null, centre: Vec3, radius: number, reach = 0,
): { centre: Vec3; radius: number } {
  if (!f || splitHolds(f, centre, radius + reach) === 0) return { centre, radius };
  const off = sub(f.w.h, centre), d = len(off);
  if (d + f.rho <= radius) return { centre, radius };
  if (d + radius <= f.rho) return { centre: f.w.h, radius: f.rho };
  const grown = (d + radius + f.rho) / 2;
  return { centre: add(centre, scale(off, (grown - radius) / d)), radius: grown };
}

/** The same rule for a bound made of MANY spheres (the outer hull's chains), which can follow the halves instead of
 *  covering the whole ball: the centres of the sphere's turned copies. Whatever material of the closed body the
 *  sphere holds is, on the open head, in the sphere itself (what does not move) or in the same-size sphere at one of
 *  these centres, one per half it holds flesh of (splitHolds): a half is a rigid turn about the hinge. None for a
 *  closed head. */
export function splitSphereImages(f: SplitFrame | null, centre: Vec3, radius: number): Vec3[] {
  const holds = f ? splitHolds(f, centre, radius) : 0, out: Vec3[] = [];
  if (!f || holds === 0) return out;
  const rel = sub(centre, f.w.h);
  if (holds & 1) out.push(add(f.w.h, rotAxis(rel, f.w.a, f.w.thetaP)));
  if (holds & 2) out.push(add(f.w.h, rotAxis(rel, f.w.a, f.w.thetaM)));
  return out;
}

/** THE REGION SHELL AT RANGE. The shell bound C is a bound, never a surface, only while the march cannot accept it: C
 *  is at least REGION_MARGIN, and the march takes a sample for a hit when the field is under its hit epsilon
 *  (t x coneK x strength: the pixel footprint at ray distance t, step-config.wgsl.ts / trace.wgsl.ts) or when the
 *  last-step secant's root is under `secant` epsilons (trace.wgsl.ts; on a field that never goes under REGION_MARGIN
 *  the root is over REGION_MARGIN too). So the shell is safe while that ACCEPT REACH, t x coneK x strength x
 *  max(1, secant), is at most REGION_MARGIN, and past the distance where it gets there the region sphere would be
 *  drawn as a ball round the head. The view draws the split only while the reach at the far side of the region
 *  sphere is within this share of REGION_MARGIN, and writes a closed record beyond (webgpu/zombie-gpu.ts): the head
 *  is a few pixels there. The CPU's split (the pose) is not touched. */
export const SHELL_ACCEPT_FRAC = 0.8;

/** The eye-to-hinge distance the split is drawn to (see SHELL_ACCEPT_FRAC). `coneK` is the pixel footprint radius per
 *  metre (aaCfg.x), `strength` the far accept strength (aaCfg.y; 0 = no footprint accept, the epsilon is its 1.2 mm
 *  floor and the split is drawn at any distance) and `secant` the last-step factor (perfCfg.w; 0 = off). The near
 *  accept boost (aaCfg.z, fading out by aaCfg.w metres) is not in it: this is the far law (splitNearReach is the
 *  near one). */
export function splitDrawDistance(w: SplitWarp, accept: { coneK: number; strength: number; secant: number }): number {
  const perMetre = accept.coneK * accept.strength * Math.max(1, accept.secant);
  return perMetre > 0 ? SHELL_ACCEPT_FRAC * REGION_MARGIN / perMetre - w.r : Infinity;
}

/** A split closed for range opens again only inside this share of its draw distance, so an eye that hovers at the
 *  distance does not flip it every frame. */
export const SPLIT_REOPEN_FRAC = 0.9;

/** THE ACCEPT REACH UP CLOSE (metres): the largest t x aaKt(t) x max(1, secant) over the near accept's range, with
 *  trace.wgsl.ts's aaKt = coneK x mix(near, strength, smoothstep(fadeM / 2, fadeM, t)) (`near` aaCfg.z, `fadeM`
 *  aaCfg.w; near 0 = no boost, and the reach is the far law's at fadeM). The draw distance cannot help here: the
 *  boost is strongest at arm's length. While this stays at or under REGION_MARGIN the shell is safe up close; over
 *  it (a coarse SDF pass, a large ?laststep) the region sphere can be drawn as a ball round an open head near 1.8 m.
 *  Nothing closes the split for it: the view warns (zombie-gpu.ts). */
export function splitNearReach(
  accept: { coneK: number; strength: number; near: number; fadeM: number; secant: number },
): number {
  const { coneK, strength, near, fadeM } = accept, k = coneK * Math.max(1, accept.secant);
  if (!(near > 0) || !(fadeM > 0)) return Math.max(0, fadeM) * strength * k;
  // The product rises with t up to fadeM / 2 (strength `near`) and from fadeM on (strength `strength`, the far law).
  let peak = 0;
  for (let i = 0; i <= 64; i++) {
    const x = i / 64, t = fadeM * (0.5 + 0.5 * x), ss = x * x * (3 - 2 * x);
    peak = Math.max(peak, t * (near + (strength - near) * ss));
  }
  return peak * k;
}

/** THE CUT FACES: one cut segment (cut-wound.ts CutSeg, world space, on the CLOSED head) per half that opens. Each
 *  runs along the hinge axis over the top of the head, HEAD_SPLIT.faceCut.inset into its own half off the plane (so
 *  the cut belongs to that half and turns with it), seen from above along -up: stampCut finds the scalp under its
 *  midpoint and cuts down from there, so the face of the half reads as cut flesh from the scalp inward. */
export function splitFaceSegs(st: SplitState, f: HeadFrame): { side: 1 | -1; a: Vec3; b: Vec3; view: Vec3 }[] {
  if (st.preset === null) return [];
  const c = HEAD_SPLIT.faceCut;
  const { n, up, a } = presetBasis(HEAD_SPLIT.presets[st.preset], f);
  const half = scale(a, c.lenFrac * f.radius);
  const sides: (1 | -1)[] = st.sides === 0 ? [1, -1] : [st.sides];
  return sides.map(side => {
    const mid = add(f.centre, add(scale(n, st.offset + side * c.inset), scale(up, f.radius)));
    return { side, a: sub(mid, half), b: add(mid, half), view: scale(up, -1) };
  });
}
