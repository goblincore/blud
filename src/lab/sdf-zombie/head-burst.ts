// src/lab/sdf-zombie/head-burst.ts
//
// WHAT A GUN ROUND DOES TO A ZOMBIE'S HEAD — the pure half. Three things can happen besides an ordinary wound, and
// headShotRule decides which from the round, where the player was aiming, the head's state and the live tuning:
//   the SPLIT    a PRECISE slug from close to medium range on a closed head opens it like the axe does (the head
//                split, head-split.ts);
//   the POP      a slug that takes the head off, or a slug from that range on a head already split wide, swells the
//                head and bursts it (head-pop.ts) in place of the flying head (decapitationRule);
//   the OPENING  the slug head burst of 2026-10-02 (spec docs/superpowers/specs/2026-10-02-slug-head-burst-design.md
//                §4): entry and exit craters, a jelly stretch, a dent, shards. NOT THE SHIPPED BEHAVIOUR: it is
//                kept behind burstTuning.opening, off.
// Everything else is an ordinary wound: every pellet, an imprecise slug, a slug from too far, any round with the
// rules switched off.
// A slug is PRECISE by where the player AIMED, not by where the slug went: the crosshair's ray recorded at firing
// (damage.ts ShotAim) passes within splitFrac head radii of the head's centre (aimOffsetOf). The slug itself leaves
// from the muzzle, beside and under the eye, and lands about 10 cm under the crosshair: its own line (classifyBurst's
// offset) says little about the aim. That older measure is still there, behind splitAim 'slug'.
// Everything here is plain data in, plain data out: the leaves (webgpu/game-head-shot.ts, webgpu/game-head-damage.ts)
// turn the verdicts into wounds, deform and gore.
import { rotate } from './head-deform';
import type { HeadFrame, Quat } from './head-deform';
import { sdPrimitive } from './validate';
import type { Primitive, Vec3 } from './types';
import type { ShotAim } from './damage';

export const BURST = {
  /** Offset (fraction of head radius) under which a slug SPLITS the head (the full opening); wider is a weak glancing graze.
   *  1.25 = every slug that hits the head splits, for now: the slug leaves the muzzle ~10 cm low and right of the crosshair,
   *  so an aimed shot's line passes ~0.9-1.0 head radii from the centre and a 0.35 zone was never reached in play (owner
   *  playtest 2026-10-03: "not able to trigger it"). Lower it with burstTune({ centreFrac }) to bring glancing back. */
  centreFrac: 1.25,
  /** A hit point farther than this from the head centre in hs units (the head ellipsoid is 1) is a neck / shoulder hit. */
  maxHs: 1.35,
  /** Crater radii, m. Glancing scales by (0.7 + 0.3 · severity). */
  entryR: { lethal: 0.12, glancing: 0.09 },
  exitR: 0.14,
  /** Shards thrown (inclusive ranges, scaled by 0.5 + 0.5·severity and burstTuning.shardScale). */
  shards: { lethal: [14, 18], glancing: [6, 9] } as { lethal: readonly [number, number]; glancing: readonly [number, number] },
  /** Hinged scalp flaps (hard cap flapMax). */
  /** OFF by default: the capsule flaps read as wiggling orange tubes on the zombie (owner, 2026-10-03). The code stays
   *  for a future monster; `burstTune({ flapCount })` forces any count up to flapMax. */
  flaps: { lethal: 0, glancing: 0 },
  flapMax: 4,
  /** Brain lumps thrown (the lethal burst also launches the whole brain). */
  lumps: { lethal: 3, glancing: 2 },
  /** The blow's shove on the body, m/s along the shot. */
  shove: 2.5,
} as const;

/** The shipped tuning (burstTuning starts as a copy; burstTune({ ...BURST_TUNING_DEFAULTS }) resets it).
 *  THE BEHAVIOUR BEFORE 2026-10-07 (every gun hit on the head made the opening) is
 *  burstTune({ opening: true, anyWeapon: true, alwaysSplit: true, slugSplit: false, slugPop: false, popOnSplit: false, headLip: 1 }).
 *  THE SLUG'S SPLIT AS IT WAS UNTIL 2026-10-08 (nearly every slug on a head split it, from any range, one half) is
 *  burstTune({ splitAim: 'slug', splitFrac: 1.25, splitRangeM: 0, popPrecise: true }). */
export const BURST_TUNING_DEFAULTS = {
  /** false: every round on a head is an ordinary wound and a decapitation an ordinary one (no split, pop or opening). */
  on: true,

  // ---- An ordinary gun crater on a head.
  /** THE LIP OF A HEAD CRATER, as a share of the stock everted lip (Wound.rimScale; game-actor.ts headLip). The stock
   *  lip stands 2.4 cm proud of the skin round a pellet crater and 4 cm round a slug's, and the skull's face lies 1 to
   *  2 cm UNDER the skin: seen from the side the bone sat 3 to 6 cm behind a wall of lip, and the shot face read flat.
   *  0.3 leaves a 7 mm lip on a pellet crater and 12 mm on a slug's. 1 is the stock lip (the look before 2026-10-07).
   *  The zombie-class bodies only, as the wet lip is (the soldier and the cloth-robed keep their own). */
  headLip: 0.3,

  // ---- The slug split: a precise slug from close to medium range opens the head as the axe does.
  /** false: no slug splits a head. */
  slugSplit: true,
  /** WHAT PRECISION IS MEASURED ON. 'crosshair': the aim recorded at firing, i.e. how far the crosshair's ray passes
   *  from the head's centre (a slug that carries no aim is never precise). 'slug': the slug's own line, the measure
   *  before 2026-10-08 (then with splitFrac 1.25, because an aimed slug's line runs 0.89 to 1.03 radii under the
   *  crosshair: nearly every slug on a head split it). */
  splitAim: 'crosshair' as 'crosshair' | 'slug',
  /** A slug is precise when that measure is under this many head radii. 0.3 of the zombie's 10.9 cm head radius is
   *  3.3 cm: the crosshair on the bridge of the nose, between the eyes. On screen the zone is 0.3 of the head's own
   *  radius at every range: a disc 23 pixels in radius at 1 m, 12 at 2 m, 6 at 4 m and 5 at 5 m, in the game's
   *  800 x 600 picture (docs/dev-notes/2026-10-07-sculpt-skull-2/NOTES.md has the table). */
  splitFrac: 0.3,
  /** CLOSE TO MEDIUM RANGE: the head no farther than this from the eye at firing, metres, for the split and for the
   *  pop of a split head. Past it a slug on a head is an ordinary slug wound, however well aimed. 0 or less: no
   *  limit (and a slug that carries no aim, so no range, is then in range). */
  splitRangeM: 5,
  /** How far the slug opens the head, as a share of the split preset's full angle (the axe's second chop is 1). */
  splitOpen: 1,

  // ---- The pop: the head swells and bursts in place of flying off.
  /** false: a slug that takes the head off sends it flying, as a pellet's decapitation does. */
  slugPop: true,
  /** The swell before the burst, seconds. 0 bursts on the frame of the hit. The cultist's pop swells 0.12 to 0.2 s
   *  (head-pop.ts SWELL_SEC); 0.12 s is seven frames at 60 fps and three or four at 30. */
  popSwellS: 0.12,
  /** A slug on a head that is already split WIDE pops it. false: an ordinary wound on the open head. */
  popOnSplit: true,
  /** How wide: the split's opening as a share of its preset's full angle, at or past which the slug pops the head.
   *  The slug's own split opens to 1 and the axe's first chop to 0.8; a head only cracked (under this) takes the
   *  slug as an ordinary wound on its un-warped flesh. */
  popSplitMin: 0.5,
  /** false: any slug that lands on the open head from within splitRangeM pops it (a head split wide is a wide-open
   *  target). true: the slug must also be precise, as the split's is (splitFrac, by splitAim). */
  popPrecise: false,

  // ---- The opening (the slug head burst of 2026-10-02). Not the shipped behaviour: everything below acts only
  // ---- while `opening` is on, and then the opening takes the round before the split is asked.
  /** true: a slug on a closed head makes the burst opening (entry and exit craters, the jelly, the dent, shards). */
  opening: false,
  /** With the opening on: any player gun hit on the head opens it, pellets too, once per shot. false: slugs only. */
  anyWeapon: false,
  /** With the opening on: every head hit takes the full opening, however far off centre its line runs. false: the
   *  centreFrac test decides between the full opening and the glancing one. */
  alwaysSplit: false,
  centreFrac: BURST.centreFrac as number,
  /** Swell peak of the jelly rupture (head-deform BURST_DEFORM.swell). */
  swell: 0.4,
  /** false: a centred slug opens the head but the zombie LIVES. true: a centred slug kills. */
  lethal: false,
  /** How much a repeat slug on an already-cracked region adds to its skull crack (kills at 1 from glanceSkull 0.8:
   *  0.04 = the fifth repeat kills). */
  repeatStep: 0.04,
  /** Multiplies the entry and exit crater radii. */
  craterScale: 1,
  /** Lasting widening of the head across the shot after a split (head-deform BurstSpring.splay). */
  splay: 0.1,
  shardScale: 1,
  /** -1: the plan's default count; otherwise forced (clamped to flapMax). */
  flapCount: -1,
};
/** Live tuning (debug seams): mutable on purpose. */
export const burstTuning: { -readonly [K in keyof typeof BURST_TUNING_DEFAULTS]: (typeof BURST_TUNING_DEFAULTS)[K] } = { ...BURST_TUNING_DEFAULTS };
export function setBurstTuning(p: Partial<typeof burstTuning>): typeof burstTuning {
  Object.assign(burstTuning, p);
  return { ...burstTuning };
}

/** What a gun round on a head does (the header). */
export type HeadShotRule = 'ordinary' | 'split' | 'pop' | 'opening';

/** A gun round that landed on a live zombie head. */
export interface HeadShot {
  kind: 'pellet' | 'slug';
  /** classifyBurst's offset of the round's own line: head radii from the head's centre. */
  offset: number;
  /** aimOffsetOf: how far the crosshair's ray, recorded at firing, passes from the head's centre, in head radii.
   *  Null: the round carries no aim (a pellet; a slug no crosshair fired). */
  aimOffset: number | null;
  /** aimRangeOf: metres from the eye at firing to the head's centre. Null with no aim. */
  rangeM: number | null;
  /** The head is split open (game-head-split.ts isOpen), and how far: its target angle as a share of its preset's
   *  full angle (0 on a closed head). */
  splitOpen: boolean;
  splitShare: number;
  /** The split would refuse this head: the head damage leaf holds state for it (the flail's ladder, an opening). */
  splitRefused: boolean;
}

/** THE SLUG IS PRECISE: the tuning's measure (splitAim) is under splitFrac. Under 'crosshair' a slug with no
 *  recorded aim is not. */
export function preciseSlug(shot: HeadShot, t: Readonly<typeof BURST_TUNING_DEFAULTS> = burstTuning): boolean {
  if (shot.kind !== 'slug') return false;
  const measure = t.splitAim === 'slug' ? shot.offset : shot.aimOffset;
  return measure !== null && measure < t.splitFrac;
}

/** THE HEAD IS IN RANGE of the split and of the split head's pop: within splitRangeM of the eye at firing. A round
 *  with no recorded range is out of range, unless the limit is off (splitRangeM 0 or less). */
export function inSplitRange(shot: HeadShot, t: Readonly<typeof BURST_TUNING_DEFAULTS> = burstTuning): boolean {
  return t.splitRangeM <= 0 || (shot.rangeM !== null && shot.rangeM <= t.splitRangeM);
}

/** THE RULE for one round on a head, in this order:
 *    switched off (`on`)                         ordinary;
 *    the head is split open                      a slug from within range pops it when it is split wide (popOnSplit,
 *                                                at or past popSplitMin of its angle; precise as well, if
 *                                                popPrecise asks); anything else is ordinary (the opening never
 *                                                touches an open head);
 *    the opening is on                           it takes every slug, and every pellet with anyWeapon;
 *    a precise slug from within range, the split on and not refused   the split;
 *    anything else                               ordinary: a pellet, an imprecise slug, a slug from too far.
 *  An ordinary slug wound may still take the head off: that is decapitationRule's. */
export function headShotRule(shot: HeadShot, t: Readonly<typeof BURST_TUNING_DEFAULTS> = burstTuning): HeadShotRule {
  if (!t.on) return 'ordinary';
  const slug = shot.kind === 'slug', near = inSplitRange(shot, t);
  if (shot.splitOpen) {
    return slug && near && t.popOnSplit && shot.splitShare >= t.popSplitMin && (!t.popPrecise || preciseSlug(shot, t)) ? 'pop' : 'ordinary';
  }
  if (t.opening && (slug || t.anyWeapon)) return 'opening';
  if (preciseSlug(shot, t) && near && t.slugSplit && !shot.splitRefused) return 'split';
  return 'ordinary';
}

/** A HEAD IS COMING OFF (the wounds have cut through the neck): the seconds of swell before it pops, or null for the
 *  ordinary flying head. Only the slug's decapitation pops; a pellet volley's, a blast's and a blade's are ordinary. */
export function decapitationRule(weapon: 'slug' | 'pellet' | 'other', t: Readonly<typeof BURST_TUNING_DEFAULTS> = burstTuning): number | null {
  return t.on && t.slugPop && weapon === 'slug' ? Math.max(0, t.popSwellS) : null;
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

/** THE AIM'S OFFSET: the distance from the head's centre to the crosshair's ray (the nearest point of the ray, which
 *  starts at the eye: a head behind the eye is measured to the eye), as a fraction of the head's radius. classifyBurst
 *  measures the same thing on the round's own line. */
export function aimOffsetOf(aim: ShotAim, frame: HeadFrame): number {
  return len(sub(aimPointOf(aim, frame), frame.centre)) / headRadius(frame.axes);
}

/** The point of the crosshair's ray nearest the head's centre (world). */
export function aimPointOf(aim: ShotAim, frame: HeadFrame): Vec3 {
  const dir = unit(aim.dir);
  return add(aim.eye, scale(dir, Math.max(0, dot(sub(frame.centre, aim.eye), dir))));
}

/** THE SHOT'S RANGE: metres from the eye at firing to the head's centre. */
export function aimRangeOf(aim: ShotAim, frame: HeadFrame): number {
  return len(sub(frame.centre, aim.eye));
}

/** WHERE THE SLUG'S SPLIT IS LAID (world): the point the head split takes as the blow's impact, from which it picks
 *  how the head opens (head-split.ts choosePreset: for a blow from the front, both halves when the point is within
 *  15% of the head's half-width of its middle line, one half through the point when it is farther to a side).
 *  Judged on the crosshair, a precise slug is on the middle line by its aim (the crosshair is within splitFrac of
 *  the centre), wherever the slug itself landed: the point is the impact moved onto the head's middle plane (its
 *  head-local x made 0), so a precise slug from the front always parts the head left and right, both halves. Its
 *  height and depth stay the impact's: a slug from the side takes the face off where it landed, as before.
 *  Judged on the slug's own line (`mode` 'slug'), the point is the impact, as it was. */
export function slugSplitPoint(mode: 'crosshair' | 'slug', impact: Vec3, frame: HeadFrame): Vec3 {
  if (mode === 'slug') return [impact[0], impact[1], impact[2]];
  const l = rotate(conj(frame.quat), sub(impact, frame.centre));
  return add(frame.centre, rotate(frame.quat, [0, l[1], l[2]]));
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
