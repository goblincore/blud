// src/lab/sdf-zombie/webgpu/axe-strike.ts
//
// THE AXE'S STRIKE (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §3). Pure. Who a chop hits and
// where is flail-strike.ts resolveStrike (the forgiving strike window, the eye-ray skin placement, the head magnet);
// this module turns each hit into the CUT the chop leaves: the chop's blade line (axe-swing.ts AXE_BLADE_DIR, view
// space) mapped to world, made perpendicular to the line of sight, centred on the hit, 2 x AXE_CUT.halfLen long.
// cut-wound.ts stampCut then lays it on the skin (anchor from the viewer's side, slot normal to the skin).
import type { Vec3 } from '../types';
import type { CutCalibre, CutSeg } from '../cut-wound';
import { AXE_BLADE_DIR, type AxeSide } from './axe-swing';
import { viewToWorld } from './flail-strike';

/** The axe's blade: deeper, wider and lippier than the rod (cut-wound.ts ROD_CALIBRE 0.06 / 0.015 / 1). Tunable;
 *  depth stays within CUT.maxDepth and lip within CUT_SHADE.maxLipScale (axe-strike.test.ts). */
export const AXE_CALIBRE: CutCalibre = { depth: 0.1, kerf: 0.022, lip: 1.1 };

export const AXE_CUT = {
  /** Half the chop's cut length along the blade line, metres (an axe bit is ~0.15 m; the gash runs a little longer). */
  halfLen: 0.09,
  /** The strike window's half-angle about the aim's bearing, degrees (the flail's narrow swings use 50). */
  arcDeg: 45,
} as const;

/** Per chop: collapse credit (COLLAPSE_TUNING threshold 0.8 -> ~7 overheads or ~9 diagonals on the body) and the
 *  shove (ZombieActor.blast unit-normalises it; its direction anchors the reaction). Head chops kill by count
 *  (axe-head.ts), not by this meter. */
export const AXE_HIT: Readonly<Record<AxeSide, { meterCredit: number; shove: number }>> = {
  H: { meterCredit: 0.12, shove: 7 },
  R: { meterCredit: 0.09, shove: 5 },
  L: { meterCredit: 0.09, shove: 5 },
};

/** The cut a chop leaves at `point` (world, on the skin), seen along `view` (unit, eye -> point). `yaw`/`pitch` are
 *  the aim's (forward = (sin yaw cos pitch, sin pitch, -cos yaw cos pitch)). The blade line keeps only its component
 *  across the line of sight (a cut is drawn ON the skin as the viewer sees it; stampCut finds the skin). */
export function axeCutSeg(eye: Vec3, yaw: number, pitch: number, side: AxeSide, point: Vec3, view: Vec3): CutSeg {
  const o = viewToWorld(eye, yaw, pitch, [0, 0, 0]);
  const w = viewToWorld(eye, yaw, pitch, AXE_BLADE_DIR[side]);
  let d: Vec3 = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
  const along = d[0] * view[0] + d[1] * view[1] + d[2] * view[2];
  d = [d[0] - along * view[0], d[1] - along * view[1], d[2] - along * view[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const h = AXE_CUT.halfLen / l;
  return {
    a: [point[0] - d[0] * h, point[1] - d[1] * h, point[2] - d[2] * h],
    b: [point[0] + d[0] * h, point[1] + d[1] * h, point[2] + d[2] * h],
    view: [view[0], view[1], view[2]],
  };
}
