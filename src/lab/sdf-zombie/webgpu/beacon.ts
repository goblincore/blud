// src/lab/sdf-zombie/webgpu/beacon.ts
//
// BOILER ROOM EMERGENCY BEACONS (spec 2026-09-27-boiler-room-beacons-design.md). Pure: the beam's
// direction at a time on the sim clock. A beacon hangs from the ceiling, its spot tilted BEACON.tilt
// below horizontal, turning `spin` revolutions a second about the vertical (sign = direction).

import type { LampMood, LampScript } from './lamp-moods';
import type { LightMode } from './level-events';

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

/** A beacon's sweep start angle (rad): a room's beacons spread evenly round the turn, so two start
 *  opposite (0 and π). Deterministic by their order in the room, not a hash (a hashed phase once
 *  landed the Boiler Room's two ~13° apart, one beam on top of the other). */
export function beaconPhase(indexInRoom: number, countInRoom: number): number {
  return countInRoom > 1 ? (indexInRoom / countInRoom) * Math.PI * 2 : 0;
}


/** Arming: the room's `strobe` gives a beacon the `emergency` script (dark through the strobe,
 *  then on for good); every other command applies to it as to any lamp. */
export function scriptFor(mode: LightMode, isBeacon: boolean): LampScript['mode'] {
  return isBeacon && mode === 'strobe' ? 'emergency' : mode;
}

/** What a lamp is to its room: a lamp (its glass colour and glow, the room's fill), a fire (the
 *  firebox glass; the fill too), or a beacon (neither: it lights bodies through the shared list,
 *  so after the strobe the Boiler Room's fill still falls to its dark floor). */
export type LampKind = 'lamp' | 'fire' | 'beacon';
export function lampKind(l: { mood: LampMood; beacon?: unknown }): LampKind {
  return l.beacon ? 'beacon' : l.mood === 'fire' ? 'fire' : 'lamp';
}
/** The room's lamp glass follows this lamp (not a fire, not a beacon). */
export function countsAsRoomLamp(l: { mood: LampMood; beacon?: unknown }): boolean {
  return lampKind(l) === 'lamp';
}
/** The room fill (rt.roomLight) weighs this lamp: its lamps and fires, never a beacon. */
export function countsForRoomFill(l: { mood: LampMood; beacon?: unknown }): boolean {
  return lampKind(l) !== 'beacon';
}

/** A beacon's spot intensity: the lamp's power × BEACON.spotGain × its level (the omni stays 0). */
export function beaconSpotIntensity(base: number, level: number): number {
  return base * BEACON.spotGain * level;
}
