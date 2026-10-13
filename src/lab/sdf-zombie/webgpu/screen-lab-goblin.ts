// src/lab/sdf-zombie/webgpu/screen-lab-goblin.ts
//
// THE SCREEN LAB's goblin, pure half (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md section 6, plan Task 5;
// look round 1, docs/superpowers/plans/2026-10-12-screen-emergence-look-round-1.md Task C): which pose clip plays at the sequence time
// `t`, how far back along the floor he has slid (`goblinRootAt`), the seat, keyboard and knee numbers MEASURED off the posed body, and the
// floor-level set laid out from them (`floorLayout`: the page builds the kotatsu, the cushion and the CRT's place from it, not from
// guesses). No renderer: the page (screen-lab-main.ts) feeds the clip to the pose layer and the posed prims back in here.
//
// The goblin is the 1.70 m body (goblin.blob `scale` 1.3077): thigh 0.379 m, shin 0.353 m, upper arm and forearm 0.307 m each.
import type { PoseClip } from '../pose';
import type { Primitive, Vec3 } from '../types';
import type { BoundRig } from '../rig-bind';
import { BRACE_BACK, CRAWL_IN, CRAWL_REACH, FLOOR_TYPE, LEAN_BACK } from '../characters/goblin-poses';
import { DESK_Y, KEYBOARD, KEYBOARD_Z, KOTATSU, TABLE_FRONT_Z } from './emergence-field';

export interface GoblinCut { clip: PoseClip; start: number }

/** The clip cuts, in order (look round 1, Task C step 3): `floor-type` (cross-legged at the kotatsu, typing) until the glass starts to
 *  give; `lean-back` from 2.3 (0.9 s: he leans away onto his hands as the glass swells, while goblinRootAt slides him back); `brace-back`
 *  held through the push, the tear and the egg coming out; `crawl-in` from 10.4 (1.8 s: up onto his hands and knees and forward; the egg
 *  lands at about 11.1 s and settles by 11.5); `crawl-reach` held from 12.2 (the right hand resting on the settled egg). Every clip starts
 *  on the pose the one before it ends on, so the cuts never pop (the test pins it). No clip raises his arms: round one's `jolt` / `recoil`
 *  (the owner: "the raise-the-arm thing looks weird") stay registered but are not played. */
export const GOBLIN_CUTS: readonly GoblinCut[] = [
  { clip: FLOOR_TYPE, start: 0 },
  { clip: LEAN_BACK, start: 2.3 },
  { clip: BRACE_BACK, start: 3.2 },
  { clip: CRAWL_IN, start: 10.4 },
  { clip: CRAWL_REACH, start: 12.2 },
];

/** The clip playing at sequence time `t` and the time inside it (`local`, seconds from the clip's start, never negative). Before 0 it is
 *  `floor-type` at 0; after the end `crawl-reach` holds. */
export function goblinClipAt(t: number): { clip: PoseClip; local: number } {
  let cut = GOBLIN_CUTS[0]!;
  for (const c of GOBLIN_CUTS) if (t >= c.start) cut = c;
  return { clip: cut.clip, local: Math.max(0, t - cut.start) };
}

/** THE SCOOT: his offset along the floor (his own z, + toward the table), metres. He slides back `back` (0.55 m: the sac reaches 0.65 m
 *  into the room and he ends 0.4 m clear of it) over `scoot` as he leans away, holds there through the push, the tear and the egg coming
 *  out, and comes `reach - back` (0.15 m) forward over `crawl` while crawl-in carries his hips a further 0.33 m forward onto his knees:
 *  0.48 m in all, his right hand landing on the egg. Eased both ways. THE CUSHION GOES WITH HIM (the page moves it by this offset): he
 *  shoves himself back on it over the tatami and kneels up on its front edge, so it is under him all the way. */
export const GOBLIN_ROOT = { back: -0.55, reach: -0.4, scoot: [2.3, 3.45] as const, crawl: [10.4, 12.2] as const } as const;

const smooth01 = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

/** The scoot at sequence time `t` (GOBLIN_ROOT). Pure and continuous; 0 while he types, never past `back`. */
export function goblinRootAt(t: number): number {
  const R = GOBLIN_ROOT;
  if (t <= R.scoot[0]) return 0;
  if (t < R.crawl[0]) return R.back * smooth01((t - R.scoot[0]) / (R.scoot[1] - R.scoot[0]));
  return R.back + (R.reach - R.back) * smooth01((t - R.crawl[0]) / (R.crawl[1] - R.crawl[0]));
}

/** What the set is built from, measured on the goblin posed in `floor-type` (world metres, the body's own frame: the floor at y 0, the
 *  body facing +z, the hips over the origin). */
export interface SeatMeasure {
  /** The lowest flesh under the hands (the palms): the keyboard's top goes here. */
  palmY: number;
  /** The hands' centre, across (x, mean of the two) and forward (z): the keyboard is centred under it. */
  handZ: number;
  handHalfSpan: number;
  /** The lowest flesh of the pelvis and thighs: the cushion's top goes here. */
  seatY: number;
  /** The rearmost flesh of the pelvis and the knees' front. */
  seatBackZ: number;
  kneeFrontZ: number;
  /** The highest flesh of the knees: if it is above the board's skirt, the knees cannot go under the table. */
  kneeTopY: number;
}

/** A prim's lowest, highest, rearmost and frontmost flesh, from its two end spheres and its scale (a sphere/capsule bound: the scale's
 *  largest axis is taken for x and z so the bound stays conservative, y uses the prim's own y scale). */
function primBounds(p: Primitive): { minY: number; maxY: number; minZ: number; maxZ: number } {
  const ry = Math.max(p.radius, p.radiusB ?? p.radius) * p.scale[1];
  const rz = Math.max(p.radius, p.radiusB ?? p.radius) * Math.max(p.scale[0], p.scale[2]);
  return {
    minY: Math.min(p.a[1], p.b[1]) - ry, maxY: Math.max(p.a[1], p.b[1]) + ry,
    minZ: Math.min(p.a[2], p.b[2]) - rz, maxZ: Math.max(p.a[2], p.b[2]) + rz,
  };
}

/** Measures the seat off posed prims (pass the typing pose's), the flesh only (cloth shells are skipped). Throws if the body has no hand, thigh or pelvis prims: the set cannot be
 *  placed without them, and a silent default is the guess this exists to replace. */
export function measureSeat(prims: readonly Primitive[]): SeatMeasure {
  // FLESH only: a `shell` (the home goblin's shorts, goblin-home.blob) bears no weight, and its bound here would be its UNCLIPPED base
  // capsule, whose round end hangs centimetres past the cloth's hem (the pelvis shell's base reaches 5.5 cm under the flesh), so the
  // seat would land under thin air.
  const of = (re: RegExp) => prims.filter(p => p.bone !== undefined && !p.shell && re.test(p.bone));
  const hands = of(/^hand\.[lr]$/), thighs = of(/^thigh\.[lr]$/), pelvis = of(/^pelvis$/);
  if (!hands.length || !thighs.length || !pelvis.length) throw new Error('measureSeat: the posed body has no hand, thigh or pelvis prims');
  const hb = hands.map(primBounds), tb = thighs.map(primBounds), pb = pelvis.map(primBounds);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    palmY: Math.min(...hb.map(b => b.minY)),
    handZ: mean(hands.map(p => (p.a[2] + p.b[2]) / 2)),
    handHalfSpan: Math.max(...hands.map(p => Math.abs((p.a[0] + p.b[0]) / 2))),
    seatY: Math.min(...tb.map(b => b.minY), ...pb.map(b => b.minY)),
    seatBackZ: Math.min(...pb.map(b => b.minZ)),
    kneeFrontZ: Math.max(...tb.map(b => b.maxZ)),
    kneeTopY: Math.max(...thighs.map(p => p.b[1] + (p.radiusB ?? p.radius) * p.scale[1])),
  };
}

/** The floor-level set, laid out from the measured typing pose. In the goblin's world (the floor at y 0, his hips over the origin before
 *  any scoot, facing +z): where the glass centre is. In the screen's frame (emergence-field's): the kotatsu board's front and back edges
 *  and half width, and the floor. Heights: the board's top measured, and what it should be (the Flat's). */
export interface FloorLayout {
  glassY: number;
  glassZ: number;
  /** The board's top (world y, measured: the palms less the keyboard) and the cushion's (the measured seat). */
  tableTopY: number;
  seatTopY: number;
  /** The board's edges in the screen frame (z: + toward him) and its half width. */
  tableFrontZ: number;
  tableBackZ: number;
  tableHalfW: number;
  /** The floor's y in the screen frame. */
  floorY: number;
  /** The room between the knees' top and the bottom of the board's skirt. */
  kneeClearance: number;
  handHalfSpan: number;
}

/** The set from the measured typing pose: the keyboard's top under the palms, the board a keyboard below it (so the glass centre is
 *  -DESK_Y above the board), the keyboard's centre under the hands (so the glass is KEYBOARD_Z beyond them), the board's front edge at
 *  TABLE_FRONT_Z (past the egg's slick; his forearms rest on it) and its back KOTATSU.d behind that, the cushion under the seat. The board's
 *  measured top is the Flat's KOTATSU.top when the typing pose is right (the test pins it; the page reports it). */
export function floorLayout(m: SeatMeasure): FloorLayout {
  const tableTopY = m.palmY - KEYBOARD.t - KEYBOARD.keys;
  const glassY = tableTopY - DESK_Y;
  return {
    glassY, glassZ: m.handZ + KEYBOARD_Z, tableTopY, seatTopY: m.seatY,
    tableFrontZ: TABLE_FRONT_Z, tableBackZ: TABLE_FRONT_Z - KOTATSU.d, tableHalfW: KOTATSU.w / 2,
    floorY: -glassY,
    kneeClearance: tableTopY - KOTATSU.t - KOTATSU.skirt - m.kneeTopY,
    handHalfSpan: m.handHalfSpan,
  };
}

/** THE POSE IS EXACT: every rig point put back on the pose's joint (pos and prev), the rest of the bound rig untouched. The page calls it
 *  after stepActorMotion, because two gait-era passes run after the pose's pinned rig step: pinTips re-hangs the hand tips and toes at
 *  their REST offsets (the hands drop straight off the wrists and the feet point forward whatever the pose's hand and foot bones say) and
 *  constrainRigBends' knee stop folds the crossed shins (it moved an ankle 0.26 m, through the floor). The floor poses are authored and
 *  checked on exactly these joints. */
export function pinToPose(bound: BoundRig, joints: readonly Vec3[]): BoundRig {
  const pts = bound.rig.points.map((p, i) => (i < joints.length ? { ...p, pos: joints[i]!, prev: joints[i]! } : p));
  return { ...bound, rig: { ...bound.rig, points: pts } };
}
