// src/lab/sdf-zombie/webgpu/disco-stars.ts
//
// THE BOILER ROOM DISCO BALL (spec 2026-09-27-disco-ball-design.md). Pure, no three: the ball's
// fixed reflection directions, where each lands on the room's box as the ball turns, how a star
// fades, and the light on the ball through the beat (owner choice A: party white, the strobe's
// flash, then the emergency beacons' red as their beams pass over the ball).
//
// One deviation from spec §3's "cone coverage of the ball": the beacons point 35° down and hang
// level with the ball, so their true cones never contain it (they miss it by ~30°). The coverage
// is taken on the beam's HEADING instead (the horizontal angle between the beam and the ball), with
// the cone's own half-angles: the ball catches the beam's edge each time the sweep passes it, which
// is the pulse the owner asked for.

import { hash01 } from './lamp-moods';

export type Vec3 = [number, number, number];
export interface Box { min: readonly [number, number, number]; max: readonly [number, number, number] }

export const DISCO = {
  /** Reflection directions (stars). */
  count: 96,
  seed: 1977,
  /** The party lamps' white on the ball, slightly warm. */
  party: [1.0, 0.95, 0.85] as Vec3,
  /** A star's radius at the ball (m), and its growth per metre travelled. */
  starRadius: 0.09,
  starGrow: 0.015,
  /** Stars fade to nothing by this distance (m). */
  fadeDist: 9,
  /** Scale on the stars' colour (look tuning). */
  rgbScale: 1.6,
  /** The strobe's surge (2.2) is clamped here, so the flash reads as a flash, not a blow-out. */
  cap: 1.5,
} as const;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Fibonacci-sphere directions with seeded jitter, unit length, computed once. n*3 floats. */
export function discoDirections(n: number = DISCO.count, seed: number = DISCO.seed): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y0 = 1 - (2 * (i + 0.5)) / n;
    // Jitter: a fraction of the spacing, so neighbours never land on a regular spiral.
    const y = Math.max(-1, Math.min(1, y0 + (hash01(seed, i * 2) - 0.5) * (1.2 / n)));
    const phi = i * GOLDEN + (hash01(seed, i * 2 + 1) - 0.5) * 0.5;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const x = Math.cos(phi) * r, z = Math.sin(phi) * r;
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  return out;
}

/** Rotate the directions about Y by `angle` (three.js's sense: a quaternion about +Y), cast each
 *  from `c` against the inside of `box`. Per star, 7 floats into `out`: hit.xyz, the face's inward
 *  normal.xyz, the distance. Returns the stars written (0 when `c` is outside the box). */
export function discoHits(dirs: Float32Array, angle: number, c: readonly [number, number, number], box: Box, out: Float32Array): number {
  for (let k = 0; k < 3; k++) if (!(c[k]! > box.min[k]! && c[k]! < box.max[k]!)) return 0;
  const n = Math.floor(dirs.length / 3);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let i = 0; i < n; i++) {
    const dx0 = dirs[i * 3]!, dy = dirs[i * 3 + 1]!, dz0 = dirs[i * 3 + 2]!;
    const dx = dx0 * ca + dz0 * sa, dz = -dx0 * sa + dz0 * ca;
    // The nearest wall plane along the ray (from the inside, the exit face).
    let t = Infinity, axis = 0;
    const tx = dx > 0 ? (box.max[0]! - c[0]) / dx : dx < 0 ? (box.min[0]! - c[0]) / dx : Infinity;
    const ty = dy > 0 ? (box.max[1]! - c[1]) / dy : dy < 0 ? (box.min[1]! - c[1]) / dy : Infinity;
    const tz = dz > 0 ? (box.max[2]! - c[2]) / dz : dz < 0 ? (box.min[2]! - c[2]) / dz : Infinity;
    if (tx < t) { t = tx; axis = 0; }
    if (ty < t) { t = ty; axis = 1; }
    if (tz < t) { t = tz; axis = 2; }
    const o = i * 7;
    out[o] = c[0] + dx * t; out[o + 1] = c[1] + dy * t; out[o + 2] = c[2] + dz * t;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    out[o + 3] = axis === 0 ? -Math.sign(d) : 0;
    out[o + 4] = axis === 1 ? -Math.sign(d) : 0;
    out[o + 5] = axis === 2 ? -Math.sign(d) : 0;
    out[o + 6] = t;
  }
  return n;
}

/** A star's strength: 1 near and head-on, fading with distance (to 0 at fadeDist) and at grazing
 *  angles. `cosIn` = |cos| between the ray and the face's normal. */
export function discoFade(dist: number, cosIn: number): number {
  const d = Math.max(0, 1 - dist / DISCO.fadeDist);
  const g = Math.min(1, Math.max(0, (Math.abs(cosIn) - 0.08) / 0.5));
  return d * d * (3 - 2 * d) * g;
}

export interface BeaconView { pos: Vec3; axis: Vec3; cosOuter: number; cosInner: number; level: number; color: Vec3 }

function smooth(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return k * k * (3 - 2 * k);
}

/** The light on the ball. The party lamps' level (their strobe flash included, capped at
 *  DISCO.cap) in party white; the beacons each give their colour at their level × how squarely the
 *  beam's heading faces the ball (module note). The two add: rgb is their weighted colour,
 *  intensity their sum (capped). */
export function discoLight(lampLevel: number, beacons: readonly BeaconView[], ball: readonly [number, number, number], out: { rgb: Vec3; intensity: number }): void {
  const L = Math.min(DISCO.cap, Math.max(0, lampLevel));
  let r = DISCO.party[0] * L, g = DISCO.party[1] * L, b = DISCO.party[2] * L, sum = L;
  for (const bc of beacons) {
    if (!(bc.level > 0)) continue;
    let tx = ball[0] - bc.pos[0], tz = ball[2] - bc.pos[2];
    let ax = bc.axis[0], az = bc.axis[2];
    const tl = Math.hypot(tx, tz), al = Math.hypot(ax, az);
    let cos: number;
    if (tl < 1e-4 || al < 1e-4) {
      // Straight above or below: the full 3D angle.
      const ty = ball[1] - bc.pos[1], l = Math.hypot(tx, ty, tz) || 1;
      cos = (bc.axis[0] * tx + bc.axis[1] * ty + bc.axis[2] * tz) / l;
    } else {
      tx /= tl; tz /= tl; ax /= al; az /= al;
      cos = ax * tx + az * tz;
    }
    const k = smooth(bc.cosOuter, bc.cosInner, cos) * bc.level;
    if (k <= 0) continue;
    r += bc.color[0] * k; g += bc.color[1] * k; b += bc.color[2] * k; sum += k;
  }
  if (sum <= 1e-6) {
    out.rgb[0] = DISCO.party[0]; out.rgb[1] = DISCO.party[1]; out.rgb[2] = DISCO.party[2];
    out.intensity = 0;
    return;
  }
  out.rgb[0] = r / sum; out.rgb[1] = g / sum; out.rgb[2] = b / sum;
  out.intensity = Math.min(DISCO.cap, sum);
}
