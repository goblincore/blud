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

/** The axe's blade: deeper and lippier than the rod (cut-wound.ts ROD_CALIBRE 0.06 / 0.015 / 1), the rod's kerf. The
 *  kerf is capped by cut-wound.test.ts's measured envelopes: 0.022 broke the Lipschitz bound (2.63 > 2.2 at the clamp
 *  lip scale) and the thin-limb silhouette closure; 0.02 and 0.018 too; 0.015 passes. Tunable, but re-measure there.
 *  depth stays within CUT.maxDepth and lip within CUT_SHADE.maxLipScale (axe-strike.test.ts). */
export const AXE_CALIBRE: CutCalibre = { depth: 0.1, kerf: 0.015, lip: 1.1 };

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
  /** The aim-space direction `v` (view space) as a world vector, projected off the line of sight; null when it lies along it. */
  const across = (v: Vec3): Vec3 | null => {
    const w = viewToWorld(eye, yaw, pitch, v);
    const e: Vec3 = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
    const al = e[0] * view[0] + e[1] * view[1] + e[2] * view[2];
    const p: Vec3 = [e[0] - al * view[0], e[1] - al * view[1], e[2] - al * view[2]];
    const l = Math.hypot(p[0], p[1], p[2]);
    return l < 1e-6 ? null : [p[0] / l, p[1] / l, p[2] / l];
  };
  // The blade line; when the line of sight lies along it (looking straight down an overhead chop) the aim's right
  // vector, then its up vector, so the cut keeps its full length across the view instead of collapsing to a point.
  const d = across(AXE_BLADE_DIR[side]) ?? across([1, 0, 0]) ?? across([0, 1, 0]) ?? [1, 0, 0];
  const h = AXE_CUT.halfLen;
  return {
    a: [point[0] - d[0] * h, point[1] - d[1] * h, point[2] - d[2] * h],
    b: [point[0] + d[0] * h, point[1] + d[1] * h, point[2] + d[2] * h],
    view: [view[0], view[1], view[2]],
  };
}
