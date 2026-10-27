// src/lab/sdf-zombie/webgpu/floater-move.ts
//
// FLOATERS ON SECTOR LEVELS (the teratoma; owner 2026-10-27: "replicate the logic from Doom for their
// wandering"). Modelled on Doom's MF_FLOAT monsters (p_map.c P_TryMove, p_enemy.c P_Move / P_NewChaseDir,
// p_mobj.c P_ZMovement):
//
// - PATHING IGNORES FLOOR HEIGHTS. A floater moves in x/z and is stopped only by a wall it does not fit
//   through: a one-sided line, or a two-sided one whose opening (lower ceiling - higher floor) is shorter
//   than the body. Steps, drops, pits and the nukage under it do not matter (`flyOpening`, `canFly`).
// - IT FLOATS TO FIT. If the body's height at the next spot is outside that spot's opening, the move is
//   refused and the floater rises or sinks toward the fit first (Doom's `floatok`: "must adjust height"),
//   so it climbs over a ledge or ducks under a soffit and then goes on (`fitsAt`, `stepAltitude`).
// - HEIGHT BY STATE (owner playtest 2026-10-27: "they usually start up higher, and when they see you they
//   head over and get closer and lower"). IDLE: cruise high, at FLOAT_TUNING.cruiseFrac of the opening
//   under it (capped at cruiseMaxM over the floor for sky and very tall sectors), with a slow bob. CHASING:
//   glide down toward the player's eye height (+ eyeAboveM) as the distance closes from engageM to closeM.
//   Sight lost for lostSightS: back up to cruise. Rate-limited (Doom's FLOATSPEED, slower here) and always
//   clamped between the floor + clearance and the ceiling - the body (`heightTarget`, `stepAltitude`).
// - IDLE WANDER is Doom's P_NewChaseDir over 8 directions: the direct one to a goal, then its two axis
//   components (the larger first), then the old direction, then a sweep from a random end, then turning
//   round (`newChaseDir`). The actor walks each leg for a few seconds; a refused move ends the leg.
//
// Heights here are the RIG FLOOR (MotionState.floorY): the body's authored geometry sits on it (the
// teratoma's ball centre 1.45 m above it), so a FloaterBody gives its extent relative to that floor.
//
// Pure: no three.js, no DOM.

import type { Vec3 } from '../types';
import type { EncounterNavigation } from './grid-navigation';
import { createGridNavigation } from './grid-navigation';
import type { Aabb } from './game-level';
import type { WanderBounds } from '../wander';
import { segDist2, type SectorGround } from './sector-ground';
import { SKY_MATERIAL, zoneName, type SectorMap } from './sector-def';

/** A floater's extent relative to its rig floor (MotionState.floorY), metres. */
export interface FloaterBody {
  /** Its x/z radius (walls, openings). */
  radius: number;
  /** Its lowest point over the rig floor. */
  bottom: number;
  /** Its highest point over the rig floor. */
  top: number;
  /** The point that should ride at the target height (the eye / the ball's centre). */
  centre: number;
}

/** The teratoma (characters/teratoma.blob, motion-profile.ts TERATOMA_PROFILE): a ~1.2 m ball centred
 *  1.45 m over its rig floor, the eye stalk and little arms hanging below it to ~0.75 m. */
export const TERATOMA_FLOAT_BODY: FloaterBody = { radius: 0.6, bottom: 0.75, top: 2.1, centre: 1.45 };

/** The floaters by registry character name (game-spawn.ts): a character listed here floats on sector levels. */
export const FLOATER_BODIES: Readonly<Record<string, FloaterBody>> = { teratoma: TERATOMA_FLOAT_BODY };

export const FLOAT_TUNING = {
  /** Idle: the centre cruises at this fraction of the opening (floor..ceiling) under it. */
  cruiseFrac: 0.7,
  /** ...but at most this far over the floor (sky and very tall sectors). */
  cruiseMaxM: 4.5,
  /** Idle bob of the cruise height: amplitude (m) and frequency (Hz). The gait's own heave rides on top. */
  bobAmpM: 0.25,
  bobHz: 0.1,
  /** Chasing: the centre starts descending from cruise at this distance from the player... */
  engageM: 16,
  /** ...and is at the player's eye + eyeAboveM from this distance in. */
  closeM: 5,
  eyeAboveM: 0.35,
  /** The player's eye over the floor it stands on. */
  playerEyeM: 1.6,
  /** Seconds without sight before a chaser gives up and drifts back to cruise. */
  lostSightS: 4,
  /** Vertical speeds (m/s). Doom's FLOATSPEED is 4 units a tic (4.4 m/s at 32 units/m); slower here so
   *  a heavy ball glides. */
  riseMps: 1.1,
  descendMps: 0.7,
  /** Kept clear between the body and the floor / the ceiling (m). */
  floorClearM: 0.25,
  ceilClearM: 0.1,
  /** Idle wander: each leg lasts lo..hi seconds; it stays within leashM of where it spawned. */
  legSec: [1.5, 4] as [number, number],
  leashM: 7,
  /** How far ahead a chase-dir candidate is probed (m). */
  probeM: 1.2,
};
export type FloatTuning = typeof FLOAT_TUNING;

/** What a floater sees under its disc: the highest floor and the lowest ceiling it touches, whether the
 *  ceiling over its centre is sky. null when a one-sided wall is within its radius or it is off the map. */
export interface FlyOpening { floor: number; ceil: number; sky: boolean }

export function flyOpening(map: SectorMap, ground: SectorGround, x: number, z: number, radius: number): FlyOpening | null {
  const s = ground.sectorAt(x, z);
  if (s < 0) return null;
  const S = map.sectors, V = map.vertices, Ls = map.lines;
  let floor = S[s]!.floor, ceil = S[s]!.ceil;
  const r2 = radius * radius;
  for (const i of ground.linesNear(x - radius, z - radius, x + radius, z + radius)) {
    const l = Ls[i]!;
    if (l.front === l.back) continue;
    const [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
    if (segDist2(x, z, ax, az, bx, bz) >= r2) continue;
    if (l.back < 0) return null;
    floor = Math.max(floor, S[l.front]!.floor, S[l.back]!.floor);
    ceil = Math.min(ceil, S[l.front]!.ceil, S[l.back]!.ceil);
  }
  return { floor, ceil, sky: S[s]!.materials.ceil === SKY_MATERIAL };
}

/** The rig-floor band a body fits in under an opening: [lo, hi] (hi < lo: it does not fit at all). */
export function fitBand(o: FlyOpening, body: FloaterBody, t: FloatTuning = FLOAT_TUNING): [number, number] {
  return [o.floor + t.floorClearM - body.bottom, o.ceil - t.ceilClearM - body.top];
}

/** Whether the opening is tall enough for the body at any height (Doom: ceilingz - floorz >= height). */
export function opens(o: FlyOpening | null, body: FloaterBody, t: FloatTuning = FLOAT_TUNING): o is FlyOpening {
  if (!o) return false;
  const [lo, hi] = fitBand(o, body, t);
  return hi >= lo;
}

/** Whether a body with its rig floor at y fits at (x, z) (a small tolerance for the float's last step). */
export function fitsAt(o: FlyOpening | null, y: number, body: FloaterBody, t: FloatTuning = FLOAT_TUNING): boolean {
  if (!opens(o, body, t)) return false;
  const [lo, hi] = fitBand(o, body, t);
  return y >= lo - 0.05 && y <= hi + 0.05;
}

export type FloatMode = 'idle' | 'chase';

/** The rig-floor height the floater wants right now. `distToPlayer` and `playerFeetY` are read only
 *  when chasing; `time` (s) and `phase` (rad) drive the idle bob. */
export function heightTarget(mode: FloatMode, o: FlyOpening, body: FloaterBody,
  ctx: { time: number; phase?: number; distToPlayer?: number; playerFeetY?: number }, t: FloatTuning = FLOAT_TUNING): number {
  const opening = o.ceil - o.floor;
  const cruise = o.floor + Math.min(t.cruiseFrac * opening, t.cruiseMaxM);
  let centre: number;
  if (mode === 'chase' && ctx.distToPlayer !== undefined && ctx.playerFeetY !== undefined && Number.isFinite(ctx.playerFeetY)) {
    const k = Math.min(1, Math.max(0, (t.engageM - ctx.distToPlayer) / Math.max(1e-6, t.engageM - t.closeM)));
    const low = ctx.playerFeetY + t.playerEyeM + t.eyeAboveM;
    centre = cruise + (low - cruise) * k;
  } else {
    centre = cruise + t.bobAmpM * Math.sin(2 * Math.PI * t.bobHz * ctx.time + (ctx.phase ?? 0));
  }
  const [lo, hi] = fitBand(o, body, t);
  return clampBand(centre - body.centre, lo, hi);
}

const clampBand = (y: number, lo: number, hi: number): number => (hi < lo ? lo : Math.min(hi, Math.max(lo, y)));

/** One rate-limited float step from y toward `want`, then kept inside the band (the band only
 *  tightens when the ceiling or floor under it moves, which the move refusal makes gradual). */
export function stepAltitude(y: number, want: number, dt: number, band: [number, number] | null, t: FloatTuning = FLOAT_TUNING): number {
  const d = want - y;
  const max = (d > 0 ? t.riseMps : t.descendMps) * dt;
  let next = Math.abs(d) <= max ? want : y + Math.sign(d) * max;
  if (band) {
    // Out of the band (a lower ceiling arrived): float back in at the float speed, never snap.
    const [lo, hi] = band;
    if (hi >= lo) {
      if (next < lo) next = Math.min(lo, y + t.riseMps * dt);
      else if (next > hi) next = Math.max(hi, y - t.descendMps * dt);
    }
  }
  return next;
}

/** The floater's mode from sight: chase while it saw the player within lostSightS. */
export function floatMode(sinceSeenS: number, t: FloatTuning = FLOAT_TUNING): FloatMode {
  return sinceSeenS < t.lostSightS ? 'chase' : 'idle';
}

/** Doom's 8 directions (p_enemy.c dirtype_t): 0 east, 1 north-east, ... 7 south-east, in OUR x/z
 *  (Doom north = our -z). -1 = none. */
export const DIRS: readonly [number, number][] = [
  [1, 0], [Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [-Math.SQRT1_2, -Math.SQRT1_2],
  [-1, 0], [-Math.SQRT1_2, Math.SQRT1_2], [0, 1], [Math.SQRT1_2, Math.SQRT1_2],
];
const opposite = (d: number): number => (d < 0 ? -1 : (d + 4) % 8);
const DEAD_ZONE_M = 0.3;   // Doom: 10 units

/** P_NewChaseDir. `canGo(dir)` probes a step that way; `rand()` is 0..1. `goal` null: no preferred
 *  direction (keep going, else any). Returns the new direction or -1 when boxed in. */
export function newChaseDir(from: [number, number], goal: [number, number] | null, oldDir: number,
  canGo: (dir: number) => boolean, rand: () => number): number {
  const turnaround = opposite(oldDir);
  const d: [number, number] = [-1, -1];
  if (goal) {
    const dx = goal[0] - from[0], dz = goal[1] - from[1];
    d[0] = dx > DEAD_ZONE_M ? 0 : dx < -DEAD_ZONE_M ? 4 : -1;
    d[1] = dz < -DEAD_ZONE_M ? 2 : dz > DEAD_ZONE_M ? 6 : -1;
    // Both: the diagonal between them first.
    if (d[0] !== -1 && d[1] !== -1) {
      const diag = d[0] === 0 ? (d[1] === 2 ? 1 : 7) : (d[1] === 2 ? 3 : 5);
      if (diag !== turnaround && canGo(diag)) return diag;
    }
    // The axis components, the larger first (and sometimes swapped, Doom's P_Random() > 200).
    if (rand() > 0.78 || Math.abs(dz) > Math.abs(dx)) { const k = d[0]; d[0] = d[1]; d[1] = k; }
    if (d[0] === turnaround) d[0] = -1;
    if (d[1] === turnaround) d[1] = -1;
    if (d[0] !== -1 && canGo(d[0])) return d[0];
    if (d[1] !== -1 && canGo(d[1])) return d[1];
  }
  if (oldDir !== -1 && canGo(oldDir)) return oldDir;
  // A sweep through every direction from a random end, the turnaround last.
  if (rand() < 0.5) {
    for (let k = 0; k < 8; k++) if (k !== turnaround && canGo(k)) return k;
  } else {
    for (let k = 7; k >= 0; k--) if (k !== turnaround && canGo(k)) return k;
  }
  if (turnaround !== -1 && canGo(turnaround)) return turnaround;
  return -1;
}

export interface FloaterSpace {
  readonly body: FloaterBody;
  opening(x: number, z: number): FlyOpening | null;
  /** The x/z segment a -> b is flyable: every sample's opening fits the body at SOME height. */
  canFly(a: Vec3, b: Vec3): boolean;
  /** Grid routing over the flyable cells (no step rule, both ways). */
  navigation: EncounterNavigation;
}

const SAMPLE_M = 0.15;
const GRID_STEP = 0.5;

export function createFloaterSpace(map: SectorMap, ground: SectorGround, rooms: readonly { id: number; name: string }[],
  boxes: readonly Aabb[], body: FloaterBody = TERATOMA_FLOAT_BODY, t: FloatTuning = FLOAT_TUNING): FloaterSpace {
  const opening = (x: number, z: number) => flyOpening(map, ground, x, z, body.radius);
  // A box blocks a floater only where it rises into the band the floater could fly in there (crates on the
  // floor of a tall room are flown over); conservative: a box over the opening's floor + clearance blocks.
  const boxed = (x: number, z: number, o: FlyOpening): boolean => boxes.some(b =>
    x > b.min[0] - body.radius && x < b.max[0] + body.radius && z > b.min[2] - body.radius && z < b.max[2] + body.radius
    && b.max[1] > o.ceil - (body.top - body.bottom) - t.ceilClearM - t.floorClearM);
  const canStand = (p: Vec3): boolean => {
    const o = opening(p[0], p[2]);
    return opens(o, body, t) && !boxed(p[0], p[2], o);
  };
  const canFly = (a: Vec3, b: Vec3): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / SAMPLE_M));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      if (!canStand([a[0] + (b[0] - a[0]) * k, 0, a[2] + (b[2] - a[2]) * k])) return false;
    }
    return true;
  };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of map.vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const bounds: WanderBounds = { minX, maxX, minZ, maxZ };
  const roomIds = new Map(rooms.map(r => [r.name, r.id]));
  const navigation = createGridNavigation({
    bounds, step: GRID_STEP, canStand, canTravel: canFly,
    roomAt: p => { const s = ground.sectorAt(p[0], p[2]); return s < 0 ? 0 : roomIds.get(zoneName(map.sectors[s]!.zone)) ?? 0; },
    floorAt: p => ground.floorAt(p[0], p[2]),
  });
  return { body, opening, canFly, navigation };
}

/** One floater's float state: its rig-floor altitude, its mode and its idle wander leg. The actor
 *  calls `step` each sub-step BEFORE motion (the altitude it returns is the motion floor) and `refused`
 *  when a move did not fit. */
export interface Floater {
  readonly altitude: number;
  readonly mode: FloatMode;
  readonly dir: number;
  step(dt: number, input: { pos: Vec3; seen: boolean; player: { x: number; z: number; feetY: number } | null }): number;
  /** The x/z move pos -> next is allowed at the current altitude; if not, the altitude target is the fit
   *  there (Doom's floatok) and the caller reverts the move. */
  tryMove(pos: Vec3, next: Vec3): boolean;
  /** Idle wander: the point this leg flies toward (null: hold). */
  legTarget(pos: Vec3, dt: number): Vec3 | null;
}

export function createFloater(space: FloaterSpace, start: Vec3, seed: number, t: FloatTuning = FLOAT_TUNING): Floater {
  let s = (seed >>> 0) || 1;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const body = space.body;
  const phase = rand() * Math.PI * 2;
  const home: [number, number] = [start[0], start[2]];
  const o0 = space.opening(start[0], start[2]);
  // It STARTS at cruise height (owner: "they usually start up higher").
  let altitude = o0 && opens(o0, body, t) ? heightTarget('idle', o0, body, { time: 0, phase }, t) : start[1];
  let time = 0, sinceSeen = Infinity, mode: FloatMode = 'idle';
  let fitWant: number | null = null;
  let dir = -1, legLeft = 0;
  const probe = (pos: Vec3, d: number): boolean => {
    const [dx, dz] = DIRS[d]!;
    return space.canFly(pos, [pos[0] + dx * t.probeM, pos[1], pos[2] + dz * t.probeM]);
  };
  return {
    get altitude() { return altitude; },
    get mode() { return mode; },
    get dir() { return dir; },
    step(dt, { pos, seen, player }) {
      time += dt;
      sinceSeen = seen ? 0 : sinceSeen + dt;
      mode = floatMode(sinceSeen, t);
      const o = space.opening(pos[0], pos[2]);
      if (!o || !opens(o, body, t)) return altitude;
      let want = heightTarget(mode, o, body, {
        time, phase,
        ...(player ? { distToPlayer: Math.hypot(player.x - pos[0], player.z - pos[2]), playerFeetY: player.feetY } : {}),
      }, t);
      if (fitWant !== null) want = fitWant;
      altitude = stepAltitude(altitude, want, dt, fitBand(o, body, t), t);
      if (fitWant !== null && Math.abs(altitude - fitWant) < 0.02) fitWant = null;
      return altitude;
    },
    tryMove(pos, next) {
      if (pos[0] === next[0] && pos[2] === next[2]) return true;
      if (!space.canFly(pos, next)) return false;
      const o = space.opening(next[0], next[2]);
      if (fitsAt(o, altitude, body, t)) { fitWant = null; return true; }
      const [lo, hi] = fitBand(o!, body, t);
      fitWant = clampBand(altitude, lo, hi);
      return false;
    },
    legTarget(pos, dt) {
      legLeft -= dt;
      if (legLeft <= 0 || dir < 0 || !probe(pos, dir)) {
        const away = Math.hypot(pos[0] - home[0], pos[2] - home[1]) > t.leashM;
        const goal: [number, number] | null = away ? home
          : rand() < 0.5 ? [home[0] + (rand() * 2 - 1) * t.leashM, home[1] + (rand() * 2 - 1) * t.leashM] : null;
        dir = newChaseDir([pos[0], pos[2]], goal, dir, d => probe(pos, d), rand);
        legLeft = t.legSec[0] + rand() * (t.legSec[1] - t.legSec[0]);
      }
      if (dir < 0) return null;
      const [dx, dz] = DIRS[dir]!;
      return [pos[0] + dx * 2, pos[1], pos[2] + dz * 2];
    },
  };
}
