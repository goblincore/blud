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
  /** rev/s when the level gives a beacon no `spin` (level-json fills it in). */
  spin: 0.7,
} as const;

export type Vec3 = [number, number, number];

export function beaconAxis(t: number, spin: number, phase: number): Vec3 {
  return beaconAxisInto([0, 0, 0], t, spin, phase);
}

/** beaconAxis into `out` (the per-step path: no allocation). Returns `out`. */
export function beaconAxisInto(out: Vec3, t: number, spin: number, phase: number): Vec3 {
  const a = phase + t * spin * Math.PI * 2;
  const c = Math.cos(BEACON.tilt);
  out[0] = Math.cos(a) * c; out[1] = -Math.sin(BEACON.tilt); out[2] = Math.sin(a) * c;
  return out;
}

/** Does a beacon re-render its (rotating) shadow this step? While it is lit and its room is near
 *  the player: the player's room or one a tunnel joins to it (nearRoomMask), so a Boiler Room
 *  floor seen through the door from the vestibule never shows a shadow frozen at an old angle.
 *  `nearMask` 0 = unknown: refresh (a wrong shadow is worse than a pass). */
export function beaconShadowLive(level: number, room: number, nearMask: number): boolean {
  if (!(level > 0)) return false;
  if (nearMask === 0) return true;
  return room >= 0 && room < 31 && (nearMask & (1 << room)) !== 0;
}

/** A beacon's sweep start angle (rad): a room's beacons spread evenly round the turn, so two start
 *  opposite (0 and π). Deterministic by their order in the room, not a hash (a hashed phase once
 *  landed the Boiler Room's two ~13° apart, one beam on top of the other). */
export function beaconPhase(indexInRoom: number, countInRoom: number): number {
  return countInRoom > 1 ? (indexInRoom / countInRoom) * Math.PI * 2 : 0;
}


/** Arming: the room's `strobe` gives a beacon the `emergency` script (dark through the strobe,
 *  then on for good); before that every command applies to it as to any lamp. Once armed
 *  (`current` is `emergency`) an emergency light stays on: every later command returns null,
 *  keep the script as it is (a blackout or die would otherwise expire into the beacon's `dead`
 *  mood and kill it for good; a second strobe would restart its dark spell). */
export function scriptFor(mode: LightMode, isBeacon: boolean, current: LampScript['mode'] | null = null): LampScript['mode'] | null {
  if (isBeacon && current === 'emergency') return null;
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
