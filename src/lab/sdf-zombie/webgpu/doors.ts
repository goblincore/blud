// src/lab/sdf-zombie/webgpu/doors.ts
//
// DOORS. Pure. A door is a closed slab (level-def DoorDef) that slides sideways
// along its long horizontal axis, into the wall beside it. It opens when the
// player comes within reach (holding its key, if it has one) and shuts again
// once its doorway has been empty for a moment. Enemies never open a door, and a
// door never shuts on anyone standing in it. The closed part collides and blocks
// sight (game-doors.ts puts it in the collider list the encounter director reads).

import type { Vec3 } from '../types';
import type { Aabb } from './game-level';
import type { DoorDef, KeyColor } from './level-def';

export const DOOR = {
  /** The player opens a door from this far away (metres, horizontal, to the slab). */
  reach: 1.6,
  /** Open fraction per second (a door takes 1 / speed s to slide fully). */
  speed: 2.2,
  /** An empty doorway stays open this long before the door shuts. */
  holdS: 1.5,
  /** Anyone within this distance of the slab's thin faces is "in the doorway". */
  doorway: 0.6,
  /** Below this remaining width the slab no longer collides. */
  minWidth: 0.05,
} as const;

export interface DoorState {
  /** 0 closed .. 1 fully open. */
  open: number;
  /** Seconds the doorway has been empty while open. */
  idle: number;
  /** Its key has been used (stays unlocked). */
  unlocked: boolean;
}

export function makeDoorStates(defs: readonly DoorDef[]): DoorState[] {
  return defs.map(d => ({ open: 0, idle: 0, unlocked: d.key === null }));
}

/** The slab's sliding axis (0 = x, 2 = z): its longer horizontal side. */
export function slideAxis(box: Aabb): 0 | 2 {
  return box.max[0] - box.min[0] >= box.max[2] - box.min[2] ? 0 : 2;
}

/** Horizontal distance from a point to the box (0 inside it). */
function reachTo(box: Aabb, p: Vec3): number {
  const dx = Math.max(box.min[0] - p[0], 0, p[0] - box.max[0]);
  const dz = Math.max(box.min[2] - p[2], 0, p[2] - box.max[2]);
  return Math.hypot(dx, dz);
}

function inDoorway(box: Aabb, p: Vec3): boolean {
  const a = slideAxis(box), thin = a === 0 ? 2 : 0;
  return p[a] >= box.min[a] && p[a] <= box.max[a]
    && p[thin] >= box.min[thin] - DOOR.doorway && p[thin] <= box.max[thin] + DOOR.doorway;
}

export interface DoorStep {
  states: DoorState[];
  /** Doors the player is at but can't open (no key): their ids. */
  locked: string[];
  /** Events: `door.unlock.<id>` when a key is first used, `door.open.<id>` each time one starts opening. */
  events: string[];
  /** Any door moved (its collider changed). */
  moved: boolean;
}

export function stepDoors(
  defs: readonly DoorDef[],
  states: readonly DoorState[],
  player: Vec3 | null,
  keys: readonly KeyColor[],
  occupants: readonly Vec3[],
  dt: number,
): DoorStep {
  const out: DoorState[] = [];
  const locked: string[] = [];
  const events: string[] = [];
  let moved = false;
  defs.forEach((d, i) => {
    const s = { ...states[i]! };
    const near = player !== null && reachTo(d.box, player) <= DOOR.reach;
    if (near && !s.unlocked && d.key !== null && keys.includes(d.key)) {
      s.unlocked = true;
      events.push(`door.unlock.${d.id}`);
    }
    if (near && !s.unlocked) locked.push(d.id);
    const occupied = (player !== null && inDoorway(d.box, player)) || occupants.some(p => inDoorway(d.box, p));
    let target = s.open > 0 ? 1 : 0;
    if (near && s.unlocked) {
      if (s.open === 0) events.push(`door.open.${d.id}`);
      target = 1;
      s.idle = 0;
    } else if (occupied) {
      s.idle = 0;
    } else if (s.open > 0) {
      s.idle += dt;
      if (s.idle >= DOOR.holdS) target = 0;
    }
    const next = target > s.open ? Math.min(1, s.open + DOOR.speed * dt) : target < s.open ? Math.max(0, s.open - DOOR.speed * dt) : s.open;
    if (next !== s.open) moved = true;
    s.open = next;
    if (s.open === 0) s.idle = 0;
    out.push(s);
  });
  return { states: out, locked, events, moved };
}

/** The slab where it is now: the closed box slid `open` of its width along its axis. */
export function doorSlab(d: DoorDef, s: DoorState): Aabb {
  const a = slideAxis(d.box);
  const shift = (d.box.max[a] - d.box.min[a]) * s.open;
  const min: [number, number, number] = [...d.box.min], max: [number, number, number] = [...d.box.max];
  min[a] += shift;
  max[a] += shift;
  return { min, max };
}

/** What still blocks the doorway (the slab clipped to the closed box), or null when it's clear. */
export function doorCollider(d: DoorDef, s: DoorState): Aabb | null {
  const a = slideAxis(d.box);
  const width = (d.box.max[a] - d.box.min[a]) * (1 - s.open);
  if (width < DOOR.minWidth) return null;
  const min: [number, number, number] = [...d.box.min];
  min[a] = d.box.max[a] - width;
  return { min, max: [...d.box.max] as Vec3 };
}
