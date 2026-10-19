// src/lab/sdf-zombie/webgpu/emergence-placement.ts
//
// Where the screen frame (origin at the glass centre, +x right, +y up, +z out of the screen toward the room, metres: emergence-field.ts)
// sits in the Flat. Pure. The Flat's kotatsu is `scripts/levels/flat_layout.py`'s KX, KY (Blender x, y), KTOP and FLOOR; game coordinates
// are (x, z-up -> y, -y -> z), so the kotatsu's centre is game (KX, -KY) and the screen, facing south (Blender -y), faces game +z.
import type { Vec3 } from './emergence-field';

/** The screen frame in the game: world = origin + rotateY(yaw) * screen. */
export interface Placement { origin: Vec3; yaw: number }

/** The Flat's kotatsu: its centre (game x, game z), the board top (game y), and the tatami top (game y of the floor he sits on).
 *  flat_layout.py: KX 0.12, KY 2.36, KTOP 0.44, FLOOR 0.055 (KTOP - FLOOR = KOTATSU.top, 0.385, the lab table's height). */
export const FLAT_KOTATSU = { x: 0.12, z: -2.36, top: 0.44, floor: 0.055 } as const;

export function placementFor(k: { x: number; z: number; top: number; floor: number }, tableCentreInScreen: Vec3, deskY: number): Placement {
  // world = origin + rotate(screen); the table's centre (screen frame) lands on the kotatsu's centre at the board's top.
  return { origin: [k.x - tableCentreInScreen[0], k.top - deskY, k.z - tableCentreInScreen[2]], yaw: 0 };
}

export function toWorld(p: Placement, v: Vec3): Vec3 {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [p.origin[0] + c * v[0] + s * v[2], p.origin[1] + v[1], p.origin[2] - s * v[0] + c * v[2]];
}

export function fromWorld(p: Placement, w: Vec3): Vec3 {
  const x = w[0] - p.origin[0], z = w[2] - p.origin[2], c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [c * x - s * z, w[1] - p.origin[1], s * x + c * z];
}
