// src/lab/sdf-zombie/webgpu/screen-lab-goblin.ts
//
// THE SCREEN LAB's goblin, pure half (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md section 6, plan Task 5):
// which pose clip plays at the sequence time `t`, and the seat, keyboard and knee numbers MEASURED off the posed body (so the page sets the
// chair and the desk from the goblin, not from guesses). No renderer: the page (screen-lab-main.ts) feeds the clip to the pose layer and the
// posed prims back in here.
//
// The goblin is the 1.70 m body (goblin.blob `scale` 1.3077): thigh 0.379 m, shin 0.353 m, upper arm and forearm 0.307 m each.
import type { PoseClip } from '../pose';
import type { Primitive } from '../types';
import { SIT, TYPE, JOLT, RECOIL, TOUCH, REACH } from '../characters/goblin-poses';

export interface GoblinCut { clip: PoseClip; start: number }

/** The clip cuts, in order (plan Task 5 step 3): `sit` plays 0 to 0.8 s and `type` holds until 3 s; `jolt` from 3.0 (the push);
 *  `recoil` from 6.6 (the sac's tear begins at 6.5); `touch` from 9.4; `reach` held from 11.6, the end of `touch`'s 2.2 s (Task 8: the
 *  hands land once the egg has settled on the desk). Every clip
 *  starts on the pose the one before it ends on, so the cuts never pop (the test pins it). */
export const GOBLIN_CUTS: readonly GoblinCut[] = [
  { clip: SIT, start: 0 },
  { clip: TYPE, start: 0.8 },
  { clip: JOLT, start: 3.0 },
  { clip: RECOIL, start: 6.6 },
  { clip: TOUCH, start: 9.4 },
  { clip: REACH, start: 11.6 },
];

/** The clip playing at sequence time `t` and the time inside it (`local`, seconds from the clip's start, never negative). Before 0 it is
 *  `sit` at 0; after the end `reach` holds. */
export function goblinClipAt(t: number): { clip: PoseClip; local: number } {
  let cut = GOBLIN_CUTS[0]!;
  for (const c of GOBLIN_CUTS) if (t >= c.start) cut = c;
  return { clip: cut.clip, local: Math.max(0, t - cut.start) };
}

/** What the set is built from, measured on the goblin posed in `type` (world metres, the body's own frame: the floor at y 0, the body
 *  facing +z, the hips over the origin). */
export interface SeatMeasure {
  /** The lowest flesh under the hands (the palms): the keyboard's top goes here. */
  palmY: number;
  /** The hands' centre, across (x, mean of the two) and forward (z): the keyboard is centred under it. */
  handZ: number;
  handHalfSpan: number;
  /** The lowest flesh of the pelvis and thighs: the chair seat's top goes here. */
  seatY: number;
  /** The rearmost flesh of the pelvis (the seat's back edge) and the knees' front (the desk's front edge must clear it). */
  seatBackZ: number;
  kneeFrontZ: number;
  /** The highest flesh of the knees: if it is above the desk's underside, the knees cannot go under the desk. */
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

/** Measures the seat off posed prims (pass the `type` pose's), the flesh only (cloth shells are skipped). Throws if the body has no hand, thigh or pelvis prims: the set cannot be
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
