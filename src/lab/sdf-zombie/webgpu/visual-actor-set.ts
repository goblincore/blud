import type { Vec3 } from '../types';

// Pure, renderer-free selector for which actors need PER-ACTOR VISUAL upkeep
// this tick: skeleton segment meshes, both occluder hulls, the wound exclusion
// spheres, the view-time / head-shape loop. Simulation is never gated on this —
// a body outside the set still steps, thinks and collides; it just is not
// drawn-to or posed-for-view while nothing can see it.
//
// SAFETY BIAS (same as the march cull in game-world-leaves2.ts): a wrongly
// culled visible body is a visible bug; a wrongly kept one is only a cost.
// Everything here points at keeping too much, never too little:
//  - the cone is the DIAGONAL field of view (wider than the vertical one the
//    camera is configured with), plus a fat margin in degrees;
//  - every body counts as its bounding radius, so a body whose centre is off
//    screen but whose shoulder reaches into frame is still kept;
//  - close bodies are ALWAYS kept whatever their angle (one behind the player
//    can be turned to in a single fast flick, and still throws a flashlight
//    shadow on the wall in front);
//  - the caller unions in last frame's visible actors, so a body that was on
//    screen one frame ago keeps its visual state while the view swings.

export interface VisualViewer {
  eye: Vec3;
  yaw: number;
  pitch: number;
  fovYDeg: number;
  aspect: number;
}

export interface VisualBody {
  id: number;
  center: Vec3;
}

export interface VisualCullOptions {
  /** Degrees added to the half-angle of the view cone. Covers a fast mouse
   *  flick between the tick that builds the set and the frame that draws it. */
  marginDeg: number;
  /** Bounding radius of a posed body around `center`, metres. */
  bodyRadiusM: number;
  /** Always keep a body this close, whatever its angle (it can be behind the
   *  player and still throw a flashlight shadow / be turned to in one frame). */
  alwaysWithinM: number;
}

export const VISUAL_CULL_DEFAULTS: VisualCullOptions = { marginDeg: 35, bodyRadiusM: 1.3, alwaysWithinM: 3 };

const DEG2RAD = Math.PI / 180;

/** The game's forward vector for a yaw/pitch, identical to `aimDir` in
 *  game-weapon-leaves.ts (the ray the player shoots down MUST be the axis this
 *  cull is symmetric about). Exported for tests and for the Task 2 wiring. */
export function visualForward(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Half the DIAGONAL field of view, radians — the widest half-angle any ray
 *  through the frustum can make with the forward axis. A vertical-FOV cone
 *  would cull bodies visible in the screen corners. */
export function diagonalHalfAngleRad(fovYDeg: number, aspect: number): number {
  const tanV = Math.tan(fovYDeg * DEG2RAD / 2);
  return Math.atan(tanV * Math.sqrt(1 + aspect * aspect));
}

/** Ids of the bodies that need visual upkeep this tick: the padded view cone
 *  from `viewer`, unioned with `alsoKeep` (last frame's visible actors) and
 *  with everything within `alwaysWithinM`. A body at distance 0 (centre on the
 *  eye) is always kept. Plain data in, plain data out. */
export function selectVisualActors(
  viewer: VisualViewer,
  bodies: readonly VisualBody[],
  alsoKeep: ReadonlySet<number>,
  opts: VisualCullOptions = VISUAL_CULL_DEFAULTS,
): Set<number> {
  const kept = new Set<number>();
  const halfAngle = diagonalHalfAngleRad(viewer.fovYDeg, viewer.aspect) + opts.marginDeg * DEG2RAD;
  const fwd = visualForward(viewer.yaw, viewer.pitch);
  const [fx, fy, fz] = fwd;
  const [ex, ey, ez] = viewer.eye;
  for (const body of bodies) {
    if (alsoKeep.has(body.id)) {
      kept.add(body.id);
      continue;
    }
    const vx = body.center[0] - ex;
    const vy = body.center[1] - ey;
    const vz = body.center[2] - ez;
    const distSq = vx * vx + vy * vy + vz * vz;
    if (distSq === 0) {
      kept.add(body.id); // Distance 0 is kept.
      continue;
    }
    const dist = Math.sqrt(distSq);
    if (dist <= opts.alwaysWithinM) {
      kept.add(body.id);
      continue;
    }
    const cos = (fx * vx + fy * vy + fz * vz) / dist;
    const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
    // The body occupies an angular disc of `reach` around its centre direction,
    // so subtract it: a big close body is kept even when its centre sits
    // outside the cone, as long as the disc touches the cone.
    const reach = Math.asin(Math.min(1, opts.bodyRadiusM / dist));
    if (angle - reach <= halfAngle) kept.add(body.id);
  }
  return kept;
}
