// src/lab/sdf-zombie/webgpu/outdoor-light.ts
//
// OUTDOOR v1 lighting decisions (spec §6, §7), as pure functions: which rooms the moon
// lights, which open room the player is "outdoors in", the moon's orthographic shadow
// frame for that room, and the fog blend across a doorway. Pure: no three.js.

import type { Vec3 } from '../types';

export interface SkyRoomLike { id: number; minX: number; maxX: number; minZ: number; maxZ: number; height: number; sky?: string | null }
export interface Fog { color: Vec3; near: number; far: number }

/** Room ids the moon lights: every open-sky room (tunnels map to their nearest room). */
export function moonRoomIds(rooms: readonly SkyRoomLike[]): Set<number> {
  return new Set(rooms.filter(r => r.sky).map(r => r.id));
}

/** The open room containing (x, z), else the nearest open room whose rectangle is within
 *  `reach` metres (a doorway), else null. */
export function outdoorRoomAt(rooms: readonly SkyRoomLike[], x: number, z: number, reach: number): SkyRoomLike | null {
  let best: SkyRoomLike | null = null, bestD = Infinity;
  for (const r of rooms) {
    if (!r.sky) continue;
    const dx = Math.max(r.minX - x, 0, x - r.maxX), dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    const d = Math.hypot(dx, dz);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best !== null && bestD <= reach ? best : null;
}

export interface MoonShadowFrame {
  /** Where the light looks (the room box centre) and where it sits (target + dir * distance). */
  target: Vec3;
  position: Vec3;
  distance: number;
  /** Orthographic half extents and depth range, in the light's view. */
  halfWidth: number;
  halfHeight: number;
  near: number;
  far: number;
  /** The light's view basis (world space): right, up, and forward (= -moonDir). */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

/** A tight orthographic frame around the room's box (floor to height), grown by `margin`
 *  on x/z, seen from the moon. Deterministic; the renderer copies it onto the
 *  DirectionalLight's shadow camera. */
export function moonShadowFrame(moonDir: Vec3, room: SkyRoomLike, margin: number): MoonShadowFrame {
  const forward = norm([-moonDir[0], -moonDir[1], -moonDir[2]]);
  const worldUp: Vec3 = Math.abs(forward[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const right = norm(cross(forward, worldUp));
  const up = cross(right, forward);
  const x0 = room.minX - margin, x1 = room.maxX + margin, z0 = room.minZ - margin, z1 = room.maxZ + margin;
  const target: Vec3 = [(x0 + x1) / 2, room.height / 2, (z0 + z1) / 2];
  let hw = 0, hh = 0, dmin = Infinity, dmax = -Infinity;
  for (const x of [x0, x1]) for (const y of [0, room.height]) for (const z of [z0, z1]) {
    const d: Vec3 = [x - target[0], y - target[1], z - target[2]];
    hw = Math.max(hw, Math.abs(dot(d, right)));
    hh = Math.max(hh, Math.abs(dot(d, up)));
    const along = dot(d, forward);
    dmin = Math.min(dmin, along); dmax = Math.max(dmax, along);
  }
  const distance = Math.max(hw, hh) + 20;
  const position: Vec3 = [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance];
  return {
    target, position, distance, halfWidth: hw, halfHeight: hh,
    near: Math.max(0.1, distance + dmin - 1), far: distance + dmax + 1,
    right, up, forward,
  };
}

/** Fog between two states; `t` clamped to [0, 1]. */
export function blendFog(a: Fog, b: Fog, t: number): Fog {
  const k = Math.min(1, Math.max(0, t));
  const m = (x: number, y: number) => x + (y - x) * k;
  return { color: [m(a.color[0], b.color[0]), m(a.color[1], b.color[1]), m(a.color[2], b.color[2])], near: m(a.near, b.near), far: m(a.far, b.far) };
}
