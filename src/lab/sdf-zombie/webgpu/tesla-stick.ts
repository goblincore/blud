// src/lab/sdf-zombie/webgpu/tesla-stick.ts
//
// THE TESLA'S TARGET STICK (spec 2026-11-17-tesla-arc-design.md), numbers only. Once the arc is on a
// body it stays on while the aim is within a small angle of the body's centre, so an aim wobble does
// not drop it. The line-of-sight half of the rule is the caller's (it needs the level).
import type { Vec3 } from '../types';

export const TESLA = Object.freeze({
  /** The arc's reach (m). */
  rangeM: 12,
  /** The arc holds its target inside this angle of the body's centre (degrees). */
  stickDeg: 8,
});

/** Does an arc from `eye` along the unit `aim` still hold a body centred at `centre`? */
export function arcSticks(eye: Vec3, aim: Vec3, centre: Vec3): boolean {
  const d: Vec3 = [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l > TESLA.rangeM) return false;
  if (l < 1e-3) return true;
  const cos = (d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2]) / l;
  return cos >= Math.cos(TESLA.stickDeg * Math.PI / 180);
}
