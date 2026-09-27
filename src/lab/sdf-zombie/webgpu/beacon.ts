// src/lab/sdf-zombie/webgpu/beacon.ts
//
// BOILER ROOM EMERGENCY BEACONS (spec 2026-09-27-boiler-room-beacons-design.md). Pure: the beam's
// direction at a time on the sim clock. A beacon hangs from the ceiling, its spot tilted BEACON.tilt
// below horizontal, turning `spin` revolutions a second about the vertical (sign = direction).

export const BEACON = {
  /** Below horizontal, rad (~35 deg). */
  tilt: 0.61,
  /** Spot half-angle (rad), penumbra, decay, reach (m). */
  angle: 0.32, penumbra: 0.35, decay: 1.2, reach: 9,
  /** Emergency red. */
  color: [1.0, 0.08, 0.05] as [number, number, number],
  /** Spot intensity per unit of the lamp's power (like TUBE_SPOT_GAIN). */
  spotGain: 7,
  /** Hard, low-res shadows (owner: quality can be sacrificed). */
  shadowSize: 512,
  /** The beam's strength (the tube beam's is 0.035). */
  beam: 0.05,
} as const;

export type Vec3 = [number, number, number];

export function beaconAxis(t: number, spin: number, phase: number): Vec3 {
  const a = phase + t * spin * Math.PI * 2;
  const c = Math.cos(BEACON.tilt);
  return [Math.cos(a) * c, -Math.sin(BEACON.tilt), Math.sin(a) * c];
}
