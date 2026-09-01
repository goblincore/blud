// src/lab/sdf-zombie/webgpu/game-level.ts
//
// The grey-box ring for sdf-game.html: four rooms in quadrants, connected
// 1 -> 2 -> 3 -> 4 -> 1 by short tunnels through the dividing bands, with NO
// diagonal shortcut (the centre block is solid). Pure data + pure functions —
// no three.js, no DOM — so the layout is unit-testable and the headless gates
// can ask the same questions the renderer answers.
//
// TWO REPRESENTATIONS FROM ONE LAYOUT:
//   - colliders: AABBs for the capsule-vs-AABB player and the wander clamps.
//   - surfaces: inward-facing coloured planes per room/tunnel. Planes, not
//     boxes, because a dividing band has R1's colour on one face and R2's on
//     the other — the wall's DISPLAY colour and its bounce ALBEDO uniform
//     must agree (the lab's enclosure learned that the hard way), so each
//     room skins its own interior boundary.
//
// COORDINATES. Metres, y up, floor at y=0. Rooms are 8x8 with 3.0 ceilings.
// The dividing band is 1.6 thick (BAND_HALF 0.8): that thickness IS the
// tunnel length, which is what makes a doorway a passage rather than a hole.

import type { Box, EnclosureWalls, Vec3 } from '../ambient';

export const ROOM_HALF = 4;          // room interior half-size
export const BAND_HALF = 0.8;        // divider half-thickness = tunnel half-length
export const WALL_H = 3.0;           // room ceiling height
export const TUNNEL_H = 2.2;         // tunnel lintel underside
export const TUNNEL_HALF_W = 0.8;    // tunnel corridor half-width
export const OUTER = BAND_HALF + 2 * ROOM_HALF;   // 8.8 — outer interior edge
export const WALL_T = 0.3;           // outer wall thickness

/** Tunnel corridors cross the band this far off-centre. */
export const TUNNEL_OFF = BAND_HALF + ROOM_HALF;  // 4.8 — room centre, too

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** A coloured accent light. Pure data: the renderer turns each entry into a
 *  THREE.PointLight (the MESH side sees it directly), and
 *  `litWallAlbedo` folds them into the bounce albedos so the SDF bodies see
 *  them too — the two halves of the page cannot otherwise agree.
 *
 *  `power` feeds PointLight.intensity directly. The ALBEDO tint uses the
 *  same colour with a plain inverse-square-style falloff and no power term:
 *  ambientAt renormalises its accumulation to unit LUMINANCE, so only the
 *  HUE of the effective wall colour matters to the bounce — a simple
 *  "paint times what falls on it" is all the agreement that is needed.
 *  No radiosity solver.
 */
export interface AccentLight {
  pos: Vec3;
  color: Vec3;
  power: number;
}

/** Distance at which an accent's albedo contribution has fallen to half. */
export const ACCENT_ALBEDO_REF_DIST = 2.2;

/**
 * A wall's EFFECTIVE LIT COLOUR: paint times the accent light falling on it.
 * This is what gets handed to the bounce (`ambientAt`) as the wall albedo —
 * NOT the raw paint. A white wall washed by a red accent must reach the
 * character shading reddish, or the walls and the zombies disagree about
 * what room they are in and the whole feature stays invisible.
 */
export function litWallAlbedo(paint: Vec3, point: Vec3, accents: AccentLight[]): Vec3 {
  const add: [number, number, number] = [0, 0, 0];
  for (const a of accents) {
    const dx = a.pos[0] - point[0];
    const dy = a.pos[1] - point[1];
    const dz = a.pos[2] - point[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const t = d / ACCENT_ALBEDO_REF_DIST;
    const f = 1 / (1 + t * t);
    add[0] += a.color[0] * f;
    add[1] += a.color[1] * f;
    add[2] += a.color[2] * f;
  }
  return [paint[0] * (1 + add[0]), paint[1] * (1 + add[1]), paint[2] * (1 + add[2])];
}

/** Representative sample point for one of the six walls of a box: its centre. */
function wallCentre(box: Box, axis: 0 | 1 | 2, side: -1 | 1): Vec3 {
  const c: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  c[axis] = side < 0 ? box.min[axis] : box.max[axis];
  return c;
}

export interface RoomDef {
  /** 1..4 around the ring: NW, NE, SE, SW. */
  id: number;
  name: string;
  /** Interior ground rect. */
  minX: number; maxX: number; minZ: number; maxZ: number;
  height: number;
  /** Paint (display matches). Gallery-white; the ACCENTS tell rooms apart. */
  wallColor: Vec3;
  floorColor: Vec3;
  ceilColor: Vec3;
  /** Coloured accent lights (one or two per room). Mesh-side PointLights
   *  AND bounce-albedo inputs — see AccentLight/litWallAlbedo. */
  accents: AccentLight[];
  zombies: number;
}

export interface TunnelDef {
  name: string;
  /** Rooms it joins (ring neighbours only). */
  a: number; b: number;
  /** Corridor ground rect + lintel height. */
  minX: number; maxX: number; minZ: number; maxZ: number;
  height: number;
  color: Vec3;
  /** Which axis the corridor runs along. */
  axis: 'x' | 'z';
}

const R = ROOM_HALF, B = BAND_HALF, O = OUTER, T = TUNNEL_OFF, W = TUNNEL_HALF_W;

// DUNGEON STONE. Cold gray, deliberately not the reference video's sepia:
// warm light on warm stone gives soft golden highlights that fight the
// specular this pivot exists to deliver. Ceilings sit BELOW walls now —
// the gallery lifted them so they read as a top surface under flat ambient;
// here the flashlight does that job and a lifted ceiling only kills the dark.
const GALLERY_WALL: Vec3 = [0.21, 0.215, 0.225];
const GALLERY_FLOOR: Vec3 = [0.135, 0.138, 0.142];
const GALLERY_CEIL: Vec3 = [0.175, 0.18, 0.19];

export const ROOMS: RoomDef[] = [
  { id: 1, name: 'room1', minX: -O, maxX: -B, minZ: -O, maxZ: -B, height: WALL_H,
    wallColor: GALLERY_WALL, floorColor: GALLERY_FLOOR, ceilColor: GALLERY_CEIL,
    // RED wash on the west wall, over the low furniture.
    accents: [{ pos: [-7.5, 2.5, -2.8], color: [1.0, 0.10, 0.06], power: 14 }],
    zombies: 1 },
  { id: 2, name: 'room2', minX: B, maxX: O, minZ: -O, maxZ: -B, height: WALL_H,
    wallColor: GALLERY_WALL, floorColor: GALLERY_FLOOR, ceilColor: GALLERY_CEIL,
    // TEAL wash on the east wall by the tall crate.
    accents: [{ pos: [7.6, 2.6, -6.3], color: [0.05, 0.85, 0.60], power: 14 }],
    zombies: 2 },
  { id: 3, name: 'room3', minX: B, maxX: O, minZ: B, maxZ: O, height: WALL_H,
    wallColor: GALLERY_WALL, floorColor: GALLERY_FLOOR, ceilColor: GALLERY_CEIL,
    // AMBER pool near the (3,3) spawn — the accent-pair capture stands a
    // zombie beside it. VIOLET in the far corner for depth.
    accents: [
      { pos: [2.0, 2.4, 2.2], color: [1.0, 0.55, 0.12], power: 14 },
      { pos: [7.8, 2.6, 7.8], color: [0.30, 0.20, 1.00], power: 12 },
    ],
    zombies: 3 },
  { id: 4, name: 'room4', minX: -O, maxX: -B, minZ: B, maxZ: O, height: WALL_H,
    wallColor: GALLERY_WALL, floorColor: GALLERY_FLOOR, ceilColor: GALLERY_CEIL,
    // MAGENTA wash along the north wall.
    accents: [{ pos: [-3.5, 2.6, 7.9], color: [0.95, 0.15, 0.75], power: 14 }],
    zombies: 4 },
];

// Darker than either room: the passage is a throat between chambers.
const TUNNEL_COLOR: Vec3 = [0.10, 0.104, 0.112];
export const TUNNELS: TunnelDef[] = [
  { name: 'tunnel-1-2', a: 1, b: 2, minX: -B, maxX: B, minZ: -T - W, maxZ: -T + W,
    height: TUNNEL_H, color: TUNNEL_COLOR, axis: 'x' },
  { name: 'tunnel-2-3', a: 2, b: 3, minX: T - W, maxX: T + W, minZ: -B, maxZ: B,
    height: TUNNEL_H, color: TUNNEL_COLOR, axis: 'z' },
  { name: 'tunnel-3-4', a: 3, b: 4, minX: -B, maxX: B, minZ: T - W, maxZ: T + W,
    height: TUNNEL_H, color: TUNNEL_COLOR, axis: 'x' },
  { name: 'tunnel-4-1', a: 4, b: 1, minX: -T - W, maxX: -T + W, minZ: -B, maxZ: B,
    height: TUNNEL_H, color: TUNNEL_COLOR, axis: 'z' },
];

// Arch steps at each tunnel mouth: two stepped header boxes per end, sitting
// INSIDE the band depth so they read through the opening as a stepped arch.
// Heights keep the 1.75 m player capsule clear (lowest step underside 1.95).
const ARCH_STEP1_Y: [number, number] = [2.05, TUNNEL_H];  // mid-width step
const ARCH_STEP2_Y: [number, number] = [1.95, 2.05];      // narrow crown step
const ARCH_STEP_DEPTH = 0.3; // how far the step boxes reach in from the mouth

/** Every solid box the player and the wander clamps collide with. */
export function levelColliders(): Aabb[] {
  const out: Aabb[] = [];
  const box = (minX: number, maxX: number, minZ: number, maxZ: number,
    minY = 0, maxY = WALL_H) =>
    out.push({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });

  // Outer boundary.
  box(-O - WALL_T, -O, -O - WALL_T, O + WALL_T);
  box(O, O + WALL_T, -O - WALL_T, O + WALL_T);
  box(-O - WALL_T, O + WALL_T, -O - WALL_T, -O);
  box(-O - WALL_T, O + WALL_T, O, O + WALL_T);

  // Vertical band (x in [-B, B]) minus the two corridors through it.
  box(-B, B, -O, -T - W);
  box(-B, B, -T + W, T - W);   // includes the solid centre block
  box(-B, B, T + W, O);
  // Horizontal band (z in [-B, B]) minus its two corridors.
  box(-O, -T - W, -B, B);
  box(-T + W, T - W, -B, B);
  box(T + W, O, -B, B);

  // Tunnel lintels (corridor ceilings) + stepped arch headers.
  for (const t of TUNNELS) {
    box(t.minX, t.maxX, t.minZ, t.maxZ, TUNNEL_H, WALL_H);
    // Arch steps at both mouths. The steps narrow toward the crown.
    for (const end of [-1, 1] as const) {
      const along: [number, number] = t.axis === 'x'
        ? (end < 0 ? [t.minX, t.minX + ARCH_STEP_DEPTH] : [t.maxX - ARCH_STEP_DEPTH, t.maxX])
        : (end < 0 ? [t.minZ, t.minZ + ARCH_STEP_DEPTH] : [t.maxZ - ARCH_STEP_DEPTH, t.maxZ]);
      const across: [number, number] = t.axis === 'x' ? [t.minZ, t.maxZ] : [t.minX, t.maxX];
      const mid = (across[0] + across[1]) / 2;
      const halfW = (across[1] - across[0]) / 2;
      // Each step is a pair of SIDE strips: the opening narrows toward the
      // crown (full width to 1.95, 70% to 2.05, 40% to the 2.2 lintel).
      const put = (y: [number, number], halfOpen: number) => {
        for (const span of [[across[0], mid - halfOpen], [mid + halfOpen, across[1]]] as const) {
          if (span[1] - span[0] < 1e-3) continue;
          if (t.axis === 'x') box(along[0], along[1], span[0], span[1], y[0], y[1]);
          else box(span[0], span[1], along[0], along[1], y[0], y[1]);
        }
      };
      put(ARCH_STEP1_Y, halfW * 0.7);
      put(ARCH_STEP2_Y, halfW * 0.4);
    }
  }

  // Furniture — crude boxes, same collision path as walls.
  for (const f of FURNITURE) box(f.minX, f.maxX, f.minZ, f.maxZ, 0, f.height);
  return out;
}

/** Crude furniture. Fixed, deterministic — the gates depend on it. Sizes and
 *  spots vary per room; all clear of tunnel mouths. */
export interface FurnitureDef {
  room: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  height: number;
}
export const FURNITURE: FurnitureDef[] = [
  // room 1
  { room: 1, minX: -6.8, maxX: -5.6, minZ: -3.4, maxZ: -2.2, height: 1.1 },
  { room: 1, minX: -3.6, maxX: -2.0, minZ: -7.6, maxZ: -6.8, height: 0.55 },
  // room 2
  { room: 2, minX: 5.8, maxX: 7.0, minZ: -6.9, maxZ: -5.7, height: 0.9 },
  { room: 2, minX: 1.4, maxX: 2.2, minZ: -2.6, maxZ: -1.8, height: 1.35 },
  { room: 2, minX: 6.4, maxX: 8.2, minZ: -2.6, maxZ: -1.8, height: 0.45 },
  // room 3
  { room: 3, minX: 5.6, maxX: 7.2, minZ: 5.6, maxZ: 6.8, height: 1.2 },
  { room: 3, minX: 6.2, maxX: 7.4, minZ: 2.6, maxZ: 3.8, height: 0.7 },
  // room 4
  { room: 4, minX: -7.6, maxX: -6.4, minZ: 6.8, maxZ: 8.0, height: 1.0 },
  { room: 4, minX: -4.4, maxX: -3.2, minZ: 2.6, maxZ: 3.4, height: 0.5 },
  { room: 4, minX: -2.6, maxX: -1.4, minZ: 6.4, maxZ: 7.6, height: 0.85 },
];

/** The enclosure a point belongs to: its room, or a tunnel corridor. */
export function enclosureKeyAt(x: number, z: number): string {
  for (const t of TUNNELS) {
    if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.name;
  }
  for (const r of ROOMS) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.name;
  }
  return 'void';
}

/** The bounce uniforms for one enclosure: box bounds + six wall albedos.
 *
 *  For rooms these are EFFECTIVE LIT colours (paint x nearby accents via
 *  litWallAlbedo) sampled at each wall's centre — the rule that keeps the
 *  SDF characters agreeing with the lit walls they stand among. Tunnels
 *  carry no accents, so their albedos are the bare paint. */
export function enclosureOf(key: string): { box: Box; walls: EnclosureWalls } | null {
  const room = ROOMS.find(r => r.name === key);
  if (room) {
    const box: Box = { min: [room.minX, 0, room.minZ], max: [room.maxX, room.height, room.maxZ] };
    const lit = (axis: 0 | 1 | 2, side: -1 | 1, paint: Vec3): Vec3 =>
      litWallAlbedo(paint, wallCentre(box, axis, side), room.accents);
    return {
      box,
      walls: {
        negX: lit(0, -1, room.wallColor), posX: lit(0, 1, room.wallColor),
        negY: lit(1, -1, room.floorColor), posY: lit(1, 1, room.ceilColor),
        negZ: lit(2, -1, room.wallColor), posZ: lit(2, 1, room.wallColor),
      },
    };
  }
  const t = TUNNELS.find(t => t.name === key);
  if (t) {
    return {
      box: { min: [t.minX, 0, t.minZ], max: [t.maxX, t.height, t.maxZ] },
      walls: {
        negX: t.color, posX: t.color, negY: t.color,
        posY: t.color, negZ: t.color, posZ: t.color,
      },
    };
  }
  return null;
}

/** Per-room wander bounds: interior inset so the body's radius and the arch
 *  mouths stay outside. Furniture rejection happens in the actor wiring. */
export function wanderBounds(room: RoomDef, inset = 0.7) {
  return {
    minX: room.minX + inset, maxX: room.maxX - inset,
    minZ: room.minZ + inset, maxZ: room.maxZ - inset,
  };
}

/** Deterministic zombie spawn points per room, hand-placed clear of
 *  furniture and tunnel mouths (the spawn test pins the furniture margin). */
const SPAWN_TABLE: Record<number, Vec3[]> = {
  1: [[-4.8, 0, -4.8]],
  2: [[4.8, 0, -4.8], [2.8, 0, -4.0]],
  3: [[4.8, 0, 4.8], [2.6, 0, 6.2], [3.0, 0, 3.0]],
  4: [[-4.8, 0, 4.8], [-6.8, 0, 6.0], [-2.4, 0, 4.4], [-6.0, 0, 3.2]],
};
export function spawnPoints(room: RoomDef): Vec3[] {
  return (SPAWN_TABLE[room.id] ?? []).slice(0, room.zombies).map(p => [...p] as Vec3);
}

/** The player's start: room 1, back corner, facing the room. */
export const PLAYER_START = { x: -7.4, z: -7.4, yaw: Math.PI * 0.75, pitch: 0 };

// ---------------------------------------------------------------------------
// Display surfaces. Inward-facing planes per room/tunnel so each side of a
// shared wall carries its OWN room's colour — display and bounce albedo
// cannot disagree. The renderer turns these into three.js meshes; the spec
// stays pure.
// ---------------------------------------------------------------------------

export interface PlaneSpec {
  /** Rectangle corners on the wall plane + the inward normal axis/sign. */
  min: Vec3;
  max: Vec3;
  /** Which axis the plane faces along; the plane sits at min[axis]==max[axis]. */
  axis: 0 | 1 | 2;
  /** +1 faces +axis, -1 faces -axis. */
  facing: 1 | -1;
  color: Vec3;
}

export interface BoxSpec { min: Vec3; max: Vec3; color: Vec3 }

function plane(min: Vec3, max: Vec3, axis: 0 | 1 | 2, facing: 1 | -1, color: Vec3): PlaneSpec {
  return { min, max, axis, facing, color };
}

/** Wall mouths: intervals along the wall's span where a tunnel opens, with
 *  the opening height. */
function mouthsFor(room: RoomDef, side: 'n' | 's' | 'e' | 'w'): { lo: number; hi: number }[] {
  const out: { lo: number; hi: number }[] = [];
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  for (const t of TUNNELS) {
    if (t.a !== room.id && t.b !== room.id) continue;
    if (t.axis === 'x') {
      // The corridor runs along x: its mouth is on the room's east wall if
      // the room sits west of the tunnel, and vice versa.
      const roomIsWest = cx < (t.minX + t.maxX) / 2;
      if ((roomIsWest && side === 'e') || (!roomIsWest && side === 'w')) {
        out.push({ lo: t.minZ, hi: t.maxZ });
      }
    } else {
      const roomIsNorth = cz < (t.minZ + t.maxZ) / 2;
      if ((roomIsNorth && side === 's') || (!roomIsNorth && side === 'n')) {
        out.push({ lo: t.minX, hi: t.maxX });
      }
    }
  }
  return out;
}

/**
 * One room wall as plane segments. `span` is the wall's extent along its
 * axis at fixed coordinate `at` (the room boundary), facing `facing`.
 * Mouths split the wall into left / right / header pieces; the arch steps
 * below the header are separate boxes (tunnel-coloured).
 */
function wallPlanes(
  at: number, span: [number, number], axis: 0 | 2, facing: 1 | -1,
  height: number, mouths: { lo: number; hi: number }[], color: Vec3,
): PlaneSpec[] {
  const out: PlaneSpec[] = [];
  const fixed: [number, number] = [at, at];
  // Which component carries the wall's SPAN. Axis 0 (E/W walls) spans z;
  // axis 2 (N/S walls) spans x. Writing the span into this slot is what
  // gives the rectangle its width — get it wrong and every plane on that
  // axis collapses to a zero-width line at the room corner: invisible from
  // inside its own room, so the level reads as a dollhouse cutaway.
  const spanAxis = axis === 0 ? 2 : 0;
  const mk = (lo: number, hi: number, y0: number, y1: number) => {
    if (hi - lo < 1e-3 || y1 - y0 < 1e-3) return;
    const min: [number, number, number] = [0, y0, 0];
    const max: [number, number, number] = [0, y1, 0];
    min[axis] = fixed[0];
    max[axis] = fixed[1];
    min[spanAxis] = lo;
    max[spanAxis] = hi;
    out.push(plane(min, max, axis, facing, color));
  };
  let cursor = span[0];
  for (const m of [...mouths].sort((a, b) => a.lo - b.lo)) {
    mk(cursor, m.lo, 0, height);
    mk(m.lo, m.hi, TUNNEL_H, height); // header above the arch
    cursor = m.hi;
  }
  mk(cursor, span[1], 0, height);
  return out;
}

/** All display geometry: room skins, tunnel skins, arch/lintel boxes, furniture. */
export function levelSurfaces(): { planes: PlaneSpec[]; boxes: BoxSpec[] } {
  const planes: PlaneSpec[] = [];
  const boxes: BoxSpec[] = [];

  for (const r of ROOMS) {
    planes.push(plane([r.minX, 0, r.minZ], [r.maxX, 0, r.maxZ], 1, 1, r.floorColor));
    planes.push(plane([r.minX, r.height, r.minZ], [r.maxX, r.height, r.maxZ], 1, -1, r.ceilColor));
    // West wall (x = minX, facing +x), span z.
    planes.push(...wallPlanes(r.minX, [r.minZ, r.maxZ], 0, 1, r.height, mouthsFor(r, 'w'), r.wallColor));
    // East wall.
    planes.push(...wallPlanes(r.maxX, [r.minZ, r.maxZ], 0, -1, r.height, mouthsFor(r, 'e'), r.wallColor));
    // North wall (z = minZ, facing +z), span x.
    planes.push(...wallPlanes(r.minZ, [r.minX, r.maxX], 2, 1, r.height, mouthsFor(r, 'n'), r.wallColor));
    // South wall.
    planes.push(...wallPlanes(r.maxZ, [r.minX, r.maxX], 2, -1, r.height, mouthsFor(r, 's'), r.wallColor));
  }

  for (const t of TUNNELS) {
    // Corridor floor + the lintel underside (tunnel ceiling at TUNNEL_H).
    planes.push(plane([t.minX, 0, t.minZ], [t.maxX, 0, t.maxZ], 1, 1, t.color));
    // Corridor side walls up to the lintel; the lintel box covers the rest.
    if (t.axis === 'x') {
      planes.push(plane([t.minX, 0, t.minZ], [t.maxX, TUNNEL_H, t.minZ], 2, 1, t.color));
      planes.push(plane([t.minX, 0, t.maxZ], [t.maxX, TUNNEL_H, t.maxZ], 2, -1, t.color));
    } else {
      planes.push(plane([t.minX, 0, t.minZ], [t.minX, TUNNEL_H, t.maxZ], 0, 1, t.color));
      planes.push(plane([t.maxX, 0, t.minZ], [t.maxX, TUNNEL_H, t.maxZ], 0, -1, t.color));
    }
    // Lintel + arch steps as boxes (their undersides form the arch).
    boxes.push({ min: [t.minX, TUNNEL_H, t.minZ], max: [t.maxX, WALL_H, t.maxZ], color: t.color });
    for (const end of [-1, 1] as const) {
      const along: [number, number] = t.axis === 'x'
        ? (end < 0 ? [t.minX, t.minX + ARCH_STEP_DEPTH] : [t.maxX - ARCH_STEP_DEPTH, t.maxX])
        : (end < 0 ? [t.minZ, t.minZ + ARCH_STEP_DEPTH] : [t.maxZ - ARCH_STEP_DEPTH, t.maxZ]);
      const across: [number, number] = t.axis === 'x' ? [t.minZ, t.maxZ] : [t.minX, t.maxX];
      const mid = (across[0] + across[1]) / 2;
      const halfW = (across[1] - across[0]) / 2;
      const put = (y: [number, number], halfOpen: number) => {
        for (const span of [[across[0], mid - halfOpen], [mid + halfOpen, across[1]]] as const) {
          if (span[1] - span[0] < 1e-3) continue;
          const min: [number, number, number] = [0, y[0], 0];
          const max: [number, number, number] = [0, y[1], 0];
          if (t.axis === 'x') { min[0] = along[0]; max[0] = along[1]; min[2] = span[0]; max[2] = span[1]; }
          else { min[2] = along[0]; max[2] = along[1]; min[0] = span[0]; max[0] = span[1]; }
          boxes.push({ min, max, color: t.color });
        }
      };
      put(ARCH_STEP1_Y, halfW * 0.7);
      put(ARCH_STEP2_Y, halfW * 0.4);
    }
  }

  // Furniture: grey boxes, deliberately blunt.
  for (const f of FURNITURE) {
    boxes.push({ min: [f.minX, 0, f.minZ], max: [f.maxX, f.height, f.maxZ], color: [0.34, 0.33, 0.32] });
  }
  return { planes, boxes };
}
