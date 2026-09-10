// src/lab/sdf-zombie/tracer-lights.ts
//
// TRACERS AS GATHERED LIGHTS (lighting P4, small).
//
// A live projectile is a tiny hot point — the player's pellets/slugs and the
// soldiers' pellets. This turns the ones in the gather's room into the point
// lights the dynamic probe layer already accepts (`DynLightInput`), so a round
// throws a faint travelling glow on the walls, floor and bodies it passes.
//
// Pure on purpose: game-main.ts owns the per-frame list and the cap, and this
// file is where the room gate, the nearest-first cut and the pellet/slug
// intensity rule can be unit-tested without a renderer. The gather's own
// 8-light allocation is the cap: tracers go LAST and only fill the slots the
// flashes and the flashlight beam left, so the nearest-to-the-eye ones win.

import type { Projectile } from './webgpu/game-weapon';
import type { DynLightInput, Vec3 } from './probe-dynamic';

/** A tracer pellet's warm hue — the ember sprite's, so the glow on a wall
 *  matches the streak the round is drawn with. */
export const TRACER_LIGHT_COLOR: Vec3 = [1.0, 0.78, 0.45];

export interface TracerGatherOpts {
  /** The player's eye — the distance tracers are ranked by. */
  eye: Vec3;
  /** The gather's room, the enclosure the light is gathered against. */
  room: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Ground-rect margin, metres — `nearRoom`'s rule (a tracer in a doorway
   *  or just past the wall still reads this room's probes). */
  margin: number;
  /** Raw intensity per pellet, in the same units as the flash entries. */
  gain: number;
  /** A projectile at/above this radius is a slug and gets double intensity. */
  slugRadius: number;
  /** Maximum lights to return — the slots left in the gather's 8. */
  cap: number;
}

/**
 * The tracers in `projectiles` that belong in `room`, nearest first, each as a
 * warm point light. Outside the room + `margin` is dropped (x/z only: the
 * gather serves one enclosure, and a round in the next room would be gathered
 * against the wrong one). `cap <= 0` or `gain <= 0` returns `[]` with no
 * allocation, which is the `?tracerlight=0` path.
 *
 * `pos` is a fresh copy — the caller mutates projectile positions every frame,
 * and a light packed into the frame's buffer must not follow.
 */
export function tracerGatherLights(
  projectiles: readonly Projectile[],
  opts: TracerGatherOpts,
): DynLightInput[] {
  const { eye, room, margin, gain, slugRadius, cap } = opts;
  if (cap <= 0 || gain <= 0) return [];

  const inRoom: Projectile[] = [];
  for (const p of projectiles) {
    if (p.pos[0] < room.minX - margin || p.pos[0] > room.maxX + margin) continue;
    if (p.pos[2] < room.minZ - margin || p.pos[2] > room.maxZ + margin) continue;
    inRoom.push(p);
  }

  const d2 = (p: Projectile): number => {
    const dx = p.pos[0] - eye[0];
    const dy = p.pos[1] - eye[1];
    const dz = p.pos[2] - eye[2];
    return dx * dx + dy * dy + dz * dz;
  };
  inRoom.sort((a, b) => d2(a) - d2(b));

  const out: DynLightInput[] = [];
  const n = Math.min(cap, inRoom.length);
  for (let i = 0; i < n; i++) {
    const p = inRoom[i]!;
    out.push({
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      color: TRACER_LIGHT_COLOR,
      intensity: gain * (p.radius >= slugRadius ? 2 : 1),
    });
  }
  return out;
}
