// src/lab/sdf-zombie/webgpu/sector-doors.ts
//
// SECTOR DOORS (owner design 2026-10-28): sci-fi doors whose two leaves split sideways into the jambs,
// opening by themselves for the player and for enemies, closing again `wait` seconds after the
// doorway is clear, and never closing on someone standing in it. The file's `doors` (sector-def.ts
// SectorDoorDef) say where each doorway is; this module is everything a door does, as plain data:
//
//   - the state machine: closed -> opening -> open -> closing (-> opening again when wanted);
//   - the trigger: a body within DOOR_TRIGGER_M of the doorway moving toward it, or a body whose
//     travel (a nav step or route leg) crosses a leaf (doorTravel's `request`);
//   - the leaves: a door at `open` (0 shut .. 1 fully open) leaves each leaf covering (1 - open) / 2
//     of the width, from its jamb. A leaf is what blocks — a body (blockingNear returns the leaf
//     pieces on the face lines, so a body squeezes through a gap only when it fits), a ray (sight,
//     shots, pellets, projectiles, debris: sector-ray.ts asks coversLine where it crosses a face),
//     and a body's travel (doorTravel). Fully open, nothing blocks;
//   - the occupant rule: a body whose disc overlaps the doorway box keeps the door opening / open.
//
// DoorField is the live part every consumer reads (sector-ground.ts owns one per ground): per door
// its open fraction, per line the door it is a face of. The game (game-doors.ts) writes `open`.
//
// Navigation ignores doors (the grid is built once, doors shut): enemies route through doorways and
// are held at the leaves by doorTravel until the door opens for them.
//
// Pure: no three.js, no DOM.

import type { Vec3 } from '../types';
import type { WallSeg } from './level-ground';
import type { SectorDoorDef, SectorMap } from './sector-def';

/** A body this close to a doorway's centre line, moving toward it, opens the door. */
export const DOOR_TRIGGER_M = 1.5;
/** Slower than this (m/s) is standing, not approaching. */
export const DOOR_TRIGGER_SPEED = 0.2;
/** cos of the widest angle between a body's motion and the direction to the doorway that still counts as toward. */
export const DOOR_TOWARD_COS = 0.25;
/** Defaults for a file door that leaves them out. */
export const DOOR_SPEED_M_S = 3;
export const DOOR_WAIT_S = 4;

export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing';
export interface DoorState {
  phase: DoorPhase;
  /** 0 shut .. 1 fully open. */
  open: number;
  /** Seconds left before an open door starts closing. */
  hold: number;
}

export const closedDoor = (): DoorState => ({ phase: 'closed', open: 0, hold: 0 });

/** The share of the width each leaf still covers, from its jamb: 0.5 shut, 0 fully open. */
export function leafCover(open: number): number {
  return open >= 1 ? 0 : (1 - Math.max(0, open)) / 2;
}

/** The share of the doorway that is blocked (both leaves): 1 shut, 0 open. */
export function blockedFraction(open: number): number {
  return 2 * leafCover(open);
}

/** Whether u (0..1 jamb a to jamb b) is behind a leaf; `pad` (a share of the width) widens each leaf. */
export function coveredAt(open: number, u: number, pad = 0): boolean {
  const c = leafCover(open);
  if (c <= 0) return false;
  return u <= c + pad || u >= 1 - c - pad;   // shut (c 0.5): everywhere, the meeting line included
}

/** One tick of a door. `want`: a body asks for it (the trigger or a blocked travel); `occupied`: a body
 *  stands in the doorway. Mutates `st`; true when its phase changed. */
export function stepDoor(def: SectorDoorDef, st: DoorState, dt: number, want: boolean, occupied: boolean): boolean {
  const before = st.phase;
  const rate = def.width > 0 ? def.speed / (def.width / 2) : Infinity;   // open fraction per second
  const keep = want || occupied;
  switch (st.phase) {
    case 'closed':
      if (keep) st.phase = 'opening';
      break;
    case 'opening':
      st.open = Math.min(1, st.open + rate * dt);
      if (st.open >= 1) { st.phase = 'open'; st.hold = def.wait; }
      break;
    case 'open':
      if (keep) st.hold = def.wait;
      else st.hold -= dt;
      if (st.hold <= 0) st.phase = 'closing';
      break;
    case 'closing':
      if (keep) { st.phase = 'opening'; break; }
      st.open = Math.max(0, st.open - rate * dt);
      if (st.open <= 0) st.phase = 'closed';
      break;
  }
  return st.phase !== before;
}

/** (x, z) in the door's frame: u along a -> b (0..1), w across it (metres, + on the left of a -> b). */
export function doorLocal(def: SectorDoorDef, x: number, z: number): [number, number] {
  const tx = (def.b[0] - def.a[0]) / def.width, tz = (def.b[1] - def.a[1]) / def.width;
  const px = x - def.a[0], pz = z - def.a[1];
  return [(px * tx + pz * tz) / def.width, px * -tz + pz * tx];
}

/** Squared distance from (x, z) to the doorway's centre line a -> b. */
export function doorDist2(def: SectorDoorDef, x: number, z: number): number {
  const [u, w] = doorLocal(def, x, z);
  const along = u < 0 ? -u * def.width : u > 1 ? (u - 1) * def.width : 0;
  return along * along + w * w;
}

/** A body at (x, z) moving at (vx, vz) m/s asks for the door: within DOOR_TRIGGER_M, moving toward it. */
export function wantsDoor(def: SectorDoorDef, x: number, z: number, vx: number, vz: number): boolean {
  const d2 = doorDist2(def, x, z);
  if (d2 > DOOR_TRIGGER_M * DOOR_TRIGGER_M) return false;
  const speed = Math.hypot(vx, vz);
  if (speed < DOOR_TRIGGER_SPEED) return false;
  const [u, w] = doorLocal(def, x, z);
  const uc = Math.min(1, Math.max(0, u));
  // The nearest point of the centre line, in world x/z.
  const qx = def.a[0] + (def.b[0] - def.a[0]) * uc, qz = def.a[1] + (def.b[1] - def.a[1]) * uc;
  const dx = qx - x, dz = qz - z, d = Math.hypot(dx, dz);
  if (d < 1e-6 || Math.abs(w) < 1e-6 && u >= 0 && u <= 1) return true;   // on the line itself
  return (vx * dx + vz * dz) / (speed * d) >= DOOR_TOWARD_COS;
}

/** A body disc of radius r at (x, z) overlaps the doorway box (the whole opening, leaves or not). */
export function occupiesDoor(def: SectorDoorDef, x: number, z: number, r: number): boolean {
  const [u, w] = doorLocal(def, x, z);
  const pad = r / def.width;
  return u > -pad && u < 1 + pad && Math.abs(w) < def.depth / 2 + r;
}

/** A body disc of radius r at (x, z) overlaps a leaf of a door at `open`. */
export function touchesLeaf(def: SectorDoorDef, open: number, x: number, z: number, r: number): boolean {
  const [u, w] = doorLocal(def, x, z);
  const pad = r / def.width;
  return u > -pad && u < 1 + pad && Math.abs(w) < def.depth / 2 + r && coveredAt(open, u, pad);
}

/** Does a body of radius r travelling a -> b meet a leaf of a door at `open`? It does when the path
 *  crosses the doorway's centre line where a leaf (widened by r) stands, or when it ENDS touching a
 *  leaf it did not touch at the start (so a body caught by a leaf can always step away). */
export function travelBlocked(def: SectorDoorDef, open: number, ax: number, az: number, bx: number, bz: number, r: number): boolean {
  if (open >= 1) return false;
  const [ua, wa] = doorLocal(def, ax, az), [ub, wb] = doorLocal(def, bx, bz);
  const pad = r / def.width;
  if ((wa < 0 && wb > 0) || (wa > 0 && wb < 0)) {
    const u = ua + (ub - ua) * (wa / (wa - wb));
    if (u > -pad && u < 1 + pad && coveredAt(open, u, pad)) return true;
  }
  return touchesLeaf(def, open, bx, bz, r) && !touchesLeaf(def, open, ax, az, r);
}

export interface DoorField {
  readonly defs: readonly SectorDoorDef[];
  /** Per door, 0 shut .. 1 fully open (the game writes it; a new field starts every door shut). */
  readonly open: Float32Array;
  /** Per map line, the door it is a face of, or -1. */
  readonly lineDoor: Int32Array;
  /** The leaf pieces standing on face line i, pushed onto `out` (nothing for an open door or a non-face line). */
  leafSegs(i: number, out: WallSeg[]): void;
  /** Whether a segment crossing line i at s (0..1 along its v[0] -> v[1]) meets a leaf. */
  coversLine(i: number, s: number): boolean;
}

const NO_DOORS: readonly SectorDoorDef[] = [];

export function createDoorField(map: SectorMap): DoorField {
  const defs = map.doors ?? NO_DOORS;
  const open = new Float32Array(defs.length);
  const lineDoor = new Int32Array(map.lines.length).fill(-1);
  // Per face line: the door u of its v[0] and v[1] (a face runs jamb to jamb, either way round).
  const lineU = new Float64Array(map.lines.length * 2);
  defs.forEach((def, d) => {
    for (const i of def.faces) {
      const l = map.lines[i];
      if (!l) continue;
      lineDoor[i] = d;
      const p = map.vertices[l.v[0]]!, q = map.vertices[l.v[1]]!;
      lineU[2 * i] = doorLocal(def, p[0], p[1])[0];
      lineU[2 * i + 1] = doorLocal(def, q[0], q[1])[0];
    }
  });
  const V = map.vertices, L = map.lines;
  return {
    defs, open, lineDoor,
    leafSegs(i, out) {
      const d = lineDoor[i]!;
      if (d < 0) return;
      const c = leafCover(open[d]!);
      if (c <= 0) return;
      const u0 = lineU[2 * i]!, u1 = lineU[2 * i + 1]!, du = u1 - u0;
      if (Math.abs(du) < 1e-9) return;
      const l = L[i]!, [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
      // Each leaf's door-u range, mapped to the line's own 0..1 and clamped to it.
      for (const [lo, hi] of [[-1, c], [1 - c, 2]] as const) {
        let s0 = (lo - u0) / du, s1 = (hi - u0) / du;
        if (s0 > s1) { const t = s0; s0 = s1; s1 = t; }
        s0 = Math.max(0, s0); s1 = Math.min(1, s1);
        if (s1 - s0 < 1e-6) continue;
        out.push({ ax: ax + (bx - ax) * s0, az: az + (bz - az) * s0, bx: ax + (bx - ax) * s1, bz: az + (bz - az) * s1 });
      }
    },
    coversLine(i, s) {
      const d = lineDoor[i]!;
      if (d < 0) return false;
      const u = lineU[2 * i]! + (lineU[2 * i + 1]! - lineU[2 * i]!) * s;
      return coveredAt(open[d]!, u);
    },
  };
}

/** A body the doors see: its ground position, its motion (m/s) and its disc radius. */
export interface DoorBody { x: number; z: number; vx: number; vz: number; r: number }
export interface DoorEvent { door: number; phase: DoorPhase }

/** One tick of every door: each is wanted when a body triggers it or `requests[d]` is set (a blocked
 *  travel this tick; cleared here), occupied when a body stands in its doorway. Writes `field.open`.
 *  Returns the phase changes (a sound hook), in door order. */
export function stepDoors(field: DoorField, states: DoorState[], dt: number, bodies: readonly DoorBody[],
  requests: Uint8Array): DoorEvent[] {
  const events: DoorEvent[] = [];
  field.defs.forEach((def, d) => {
    let want = requests[d] === 1, occupied = false;
    for (const b of bodies) {
      if (!want && wantsDoor(def, b.x, b.z, b.vx, b.vz)) want = true;
      if (!occupied && occupiesDoor(def, b.x, b.z, b.r)) occupied = true;
      if (want && occupied) break;
    }
    requests[d] = 0;
    const st = states[d]!;
    if (stepDoor(def, st, dt, want, occupied)) events.push({ door: d, phase: st.phase });
    field.open[d] = st.open;
  });
  return events;
}

/** Wrap a travel test so the doors' leaves hold bodies of `radius` back. A travel a leaf refuses that
 *  starts within DOOR_TRIGGER_M of the doorway is a body pushing through: `request(d)` asks for that
 *  door (a far query that happens to cross a doorway asks nothing). */
export function doorTravel(field: DoorField, base: (a: Vec3, b: Vec3) => boolean, radius: number,
  request?: (door: number) => void): (a: Vec3, b: Vec3) => boolean {
  const defs = field.defs;
  if (defs.length === 0) return base;
  return (a, b) => {
    if (!base(a, b)) return false;
    for (let d = 0; d < defs.length; d++) {
      const def = defs[d]!;
      if (!travelBlocked(def, field.open[d]!, a[0], a[2], b[0], b[2], radius)) continue;
      if (request && doorDist2(def, a[0], a[2]) <= DOOR_TRIGGER_M * DOOR_TRIGGER_M) request(d);
      return false;
    }
    return true;
  };
}
