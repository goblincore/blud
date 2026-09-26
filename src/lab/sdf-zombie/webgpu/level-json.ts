// src/lab/sdf-zombie/webgpu/level-json.ts
//
// LEVEL FORMAT v1 — parse, validate, filter to one state, derive capabilities.
// Spec: docs/superpowers/specs/2026-09-23-level-format-design.md §4, §5, §7, §8.
// Written by scripts/levels/export_level.py. Collects EVERY problem and throws
// once, so an author fixing a .blend sees the whole list.

import type { Vec3 } from '../types';
import type { Aabb, FurnitureDef } from './game-level';
import {
  DEFAULT_PALETTE, LEVEL_TOL, PICKUP_ITEMS, type BellDef, type Capability, type PortalDef, type GateDef,
  type EdgeDef, type GraveDef, type LevelDef, type LevelPalette, type LevelRoom, type LevelTunnel,
  type PathDef, type PickupDef, type PickupItem, type SpawnDef, type StairDef, type TriggerDef,
  type WallSide, type WindowDef, type CueDef,
} from './level-def';
import { LAMP_MOODS, type LampMood } from './lamp-moods';
import {
  EDGE_STYLES, GROUND_NAMES, SKYLINE_NAMES, SKY_NAMES,
  type EdgeStyle, type GroundName, type SkyName, type SkylineName,
} from './outdoor-presets';

type Json = Record<string, unknown>;

const MIN_TUNNEL_WIDTH = 1.4;
const MAX_STAIR_RISE = 3;

/** Allowed keys per element (spec §4). `states` is allowed on every element. */
const KEYS: Record<string, readonly string[]> = {
  top: ['version', 'id', 'name', 'ammo', 'loadout', 'completeOn', 'palette', 'states', 'skyline', 'rooms', 'tunnels',
    'stairs', 'furniture', 'solids', 'gates', 'triggers', 'windows', 'lights', 'start', 'spawns', 'graves',
    'pickups', 'bells', 'portals', 'art', 'cues'],
  palette: ['wall', 'floor', 'ceil', 'tunnel', 'solid'],
  room: ['id', 'name', 'min', 'max', 'floor', 'height', 'sky', 'ground', 'paths', 'edge', 'void', 'shell', 'states'],
  path: ['ground', 'min', 'max'],
  edge: ['style', 'height'],
  tunnel: ['a', 'b', 'min', 'max', 'height', 'states'],
  stair: ['id', 'up', 'min', 'max', 'states'],
  box: ['min', 'max', 'states'],
  gate: ['id', 'opensOn', 'min', 'max', 'states'],
  trigger: ['id', 'event', 'once', 'min', 'max', 'states'],
  window: ['id', 'view', 'min', 'max', 'states'],
  light: ['pos', 'color', 'power', 'mood', 'fixture', 'states'],
  cue: ['on', 'emit'],
  start: ['pos', 'yaw'],
  spawn: ['id', 'kind', 'pos', 'yaw', 'states'],
  grave: ['id', 'wave', 'pos', 'yaw', 'states'],
  pickup: ['id', 'item', 'pos', 'states'],
  bell: ['id', 'pos', 'radius', 'states'],
  portal: ['id', 'pos', 'yaw', 'width', 'height', 'target', 'states'],
};

export interface ParseOptions {
  /** State to filter to (spec §7). Default: the file's first state. */
  state?: string;
}

export function parseLevelJson(raw: unknown, opts: ParseOptions = {}): LevelDef {
  const errors: string[] = [];
  const j = (raw ?? {}) as Json;

  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const keys = (o: Json, kind: keyof typeof KEYS, where: string) => {
    for (const k of Object.keys(o)) if (!KEYS[kind]!.includes(k)) errors.push(`${where}: unknown key ${k}`);
  };
  const num = (v: unknown, where: string, fallback = 0): number => {
    if (isNum(v)) return v;
    errors.push(`${where}: expected a number`);
    return fallback;
  };
  const str = (v: unknown, where: string, fallback = ''): string => {
    if (typeof v === 'string' && v.length > 0) return v;
    errors.push(`${where}: expected a non-empty string`);
    return fallback;
  };
  const vec = (v: unknown, n: 2 | 3, where: string): number[] => {
    if (Array.isArray(v) && v.length === n && v.every(isNum)) return v as number[];
    errors.push(`${where}: expected [${n} numbers]`);
    return new Array(n).fill(0);
  };
  const list = (v: unknown, where: string): Json[] => {
    if (v === undefined) return [];
    if (Array.isArray(v) && v.every(x => typeof x === 'object' && x !== null && !Array.isArray(x))) return v as Json[];
    errors.push(`${where}: expected an array of objects`);
    return [];
  };
  const aabb = (o: Json, where: string): Aabb => {
    const min = vec(o.min, 3, `${where}.min`) as unknown as Vec3;
    const max = vec(o.max, 3, `${where}.max`) as unknown as Vec3;
    if (!(max[0] > min[0] && max[1] > min[1] && max[2] > min[2])) errors.push(`${where}: max must exceed min on every axis`);
    return { min, max };
  };

  keys(j, 'top', 'level');
  if (j.version !== 1) errors.push(`version: expected 1, got ${String(j.version)}`);
  const id = str(j.id, 'id', 'unknown');
  if (!/^[a-z0-9-]+$/.test(id)) errors.push(`id: must match [a-z0-9-]+`);
  const name = typeof j.name === 'string' && j.name ? j.name : id;
  const ammo = j.ammo === 'infinite' ? 'infinite' : 'finite';
  if (j.ammo !== undefined && j.ammo !== 'infinite' && j.ammo !== 'finite') errors.push('ammo: finite or infinite');
  const loadout = j.loadout === undefined ? [] : (Array.isArray(j.loadout) ? j.loadout : []).map((w, i) => str(w, `loadout[${i}]`));
  const completeOn = typeof j.completeOn === 'string' && j.completeOn ? j.completeOn : 'pickup.cd';

  const oneOf = <T extends string>(v: string, known: readonly T[], what: string, where: string): v is T => {
    if ((known as readonly string[]).includes(v)) return true;
    errors.push(`${where}: unknown ${what} ${v} (known: ${known.join(', ')})`);
    return false;
  };
  const art = j.art === undefined ? null : str(j.art, 'art');
  if (art !== null && !/^[a-z0-9-]+\.art\.glb$/.test(art)) errors.push('art: must match <id>.art.glb');
  let skyline: SkylineName | null = null;
  if (j.skyline !== undefined) {
    const s = str(j.skyline, 'skyline');
    if (oneOf(s, SKYLINE_NAMES, 'skyline', 'skyline')) skyline = s;
  }

  const pj = (j.palette ?? {}) as Json;
  keys(pj, 'palette', 'palette');
  const colour = (k: keyof LevelPalette): Vec3 =>
    pj[k] === undefined ? DEFAULT_PALETTE[k] : (vec(pj[k], 3, `palette.${k}`) as unknown as Vec3);
  const palette: LevelPalette = { wall: colour('wall'), floor: colour('floor'), ceil: colour('ceil'),
    tunnel: colour('tunnel'), solid: colour('solid') };

  // --- states (spec §7) --------------------------------------------------------
  const states = j.states === undefined ? ['default']
    : (Array.isArray(j.states) && j.states.length > 0 ? j.states.map((s, i) => str(s, `states[${i}]`)) : (errors.push('states: a non-empty array'), ['default']));
  const state = opts.state ?? states[0]!;
  if (!states.includes(state)) errors.push(`state ${state}: not declared in states`);
  /** Is this element present in the chosen state? Validates its `states` too. */
  const present = (o: Json, where: string): boolean => {
    if (o.states === undefined) return true;
    if (!Array.isArray(o.states)) { errors.push(`${where}.states: expected an array`); return true; }
    for (const s of o.states) if (!states.includes(s as string)) errors.push(`${where}: state ${String(s)} not declared`);
    return (o.states as string[]).includes(state);
  };

  // --- rooms -------------------------------------------------------------------
  const rooms: LevelRoom[] = [];
  list(j.rooms, 'rooms').forEach((o, i) => {
    const where = `rooms[${i}]`;
    keys(o, 'room', where);
    const keep = present(o, where);
    const rid = num(o.id, `${where}.id`);
    if (!Number.isInteger(rid) || rid < 1) errors.push(`${where}.id: expected an integer >= 1`);
    const rname = str(o.name, `${where}.name`, `room${rid}`);
    const [minX, minZ] = vec(o.min, 2, `${where}.min`);
    const [maxX, maxZ] = vec(o.max, 2, `${where}.max`);
    const floor = o.floor === undefined ? 0 : num(o.floor, `${where}.floor`);
    const height = num(o.height, `${where}.height`, 3);
    if (!(maxX! > minX! && maxZ! > minZ! && height > 0)) errors.push(`${where}: empty room`);
    let sky: SkyName | null = null;
    if (o.sky !== undefined) {
      const s = str(o.sky, `${where}.sky`);
      if (oneOf(s, SKY_NAMES, 'sky', `${where}.sky`)) sky = s;
    }
    let ground: GroundName = 'stone';
    if (o.ground !== undefined) {
      const g = str(o.ground, `${where}.ground`);
      if (oneOf(g, GROUND_NAMES, 'ground', `${where}.ground`)) ground = g;
    }
    const paths: PathDef[] = [];
    list(o.paths, `${where}.paths`).forEach((p, k) => {
      const pw = `${where}.paths[${k}]`;
      keys(p, 'path', pw);
      const g = str(p.ground, `${pw}.ground`, 'stone');
      const [px0, pz0] = vec(p.min, 2, `${pw}.min`);
      const [px1, pz1] = vec(p.max, 2, `${pw}.max`);
      if (!(px1! > px0! && pz1! > pz0!)) { errors.push(`${pw}: empty path`); return; }
      if (px0! < minX! - LEVEL_TOL || px1! > maxX! + LEVEL_TOL || pz0! < minZ! - LEVEL_TOL || pz1! > maxZ! + LEVEL_TOL) {
        errors.push(`${pw}: must lie inside its room`);
      }
      if (oneOf(g, GROUND_NAMES, 'ground', `${pw}.ground`)) paths.push({ ground: g, minX: px0!, maxX: px1!, minZ: pz0!, maxZ: pz1! });
    });
    let edge: EdgeDef | null = null;
    if (o.edge !== undefined) {
      const ej = (typeof o.edge === 'object' && o.edge !== null ? o.edge : {}) as Json;
      keys(ej, 'edge', `${where}.edge`);
      const style = str(ej.style, `${where}.edge.style`, 'wall');
      const eh = num(ej.height, `${where}.edge.height`, 2);
      if (sky === null && o.sky === undefined) errors.push(`${where}.edge: only open-sky rooms have an edge`);
      if (eh < 0.3 || eh > height + LEVEL_TOL) errors.push(`${where}.edge.height: between 0.3 and the room height`);
      if (oneOf(style, EDGE_STYLES, 'edge style', `${where}.edge.style`)) edge = { style: style as EdgeStyle, height: eh };
    }
    const isVoid = o.void === undefined ? false : o.void === true ? true : (errors.push(`${where}.void: expected true or false`), false);
    if (isVoid && (o.sky !== undefined || o.edge !== undefined || o.paths !== undefined)) errors.push(`${where}: void rooms have no sky, edge or paths`);
    const shell: 'generated' | 'art' = o.shell === undefined ? 'generated'
      : o.shell === 'generated' || o.shell === 'art' ? o.shell : (errors.push(`${where}.shell: generated or art`), 'generated');
    if (shell === 'art' && (isVoid || o.paths !== undefined)) errors.push(`${where}: art-shelled rooms are not void and have no paths`);
    if (!keep) return;
    if (rooms.some(r => r.id === rid)) errors.push(`${where}.id: duplicate room id ${rid}`);
    if (rooms.some(r => r.name === rname)) errors.push(`${where}.name: duplicate room name ${rname}`);
    rooms.push({
      id: rid, name: rname, minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ!, floor, height, sky, ground, paths, edge, void: isVoid, shell,
      wallColor: palette.wall, floorColor: palette.floor, ceilColor: palette.ceil,
      accents: [], zombies: 0, soldiers: 0,
    });
  });
  if (rooms.length === 0) errors.push('rooms: a level needs at least one room');

  const inRoom = (x: number, z: number) =>
    rooms.find(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) ?? null;

  // --- tunnels -----------------------------------------------------------------
  const tunnels: LevelTunnel[] = [];
  list(j.tunnels, 'tunnels').forEach((o, i) => {
    keys(o, 'tunnel', `tunnels[${i}]`);
    const a = num(o.a, `tunnels[${i}].a`);
    const b = num(o.b, `tunnels[${i}].b`);
    const tname = `tunnel-${a}-${b}`;
    const keep = present(o, tname);
    const [minX, minZ] = vec(o.min, 2, `${tname}.min`);
    const [maxX, maxZ] = vec(o.max, 2, `${tname}.max`);
    const height = num(o.height, `${tname}.height`, 2.2);
    if (!keep) return;
    const ra = rooms.find(r => r.id === a);
    const rb = rooms.find(r => r.id === b);
    const t = { minX: minX!, maxX: maxX!, minZ: minZ!, maxZ: maxZ! };
    let axis: 'x' | 'z' = 'x';
    let floor = 0;
    if (!ra || !rb || a === b) {
      errors.push(`${tname}: must join two different existing rooms`);
    } else {
      floor = ra.floor;
      if (Math.abs(ra.floor - rb.floor) > LEVEL_TOL) errors.push(`${tname}: rooms ${a} and ${b} are on different floors (use stairs inside a room)`);
      const touchesX = (r: LevelRoom) =>
        (Math.abs(t.maxX - r.minX) <= LEVEL_TOL || Math.abs(t.minX - r.maxX) <= LEVEL_TOL)
        && t.minZ >= r.minZ - LEVEL_TOL && t.maxZ <= r.maxZ + LEVEL_TOL;
      const touchesZ = (r: LevelRoom) =>
        (Math.abs(t.maxZ - r.minZ) <= LEVEL_TOL || Math.abs(t.minZ - r.maxZ) <= LEVEL_TOL)
        && t.minX >= r.minX - LEVEL_TOL && t.maxX <= r.maxX + LEVEL_TOL;
      if (touchesX(ra) && touchesX(rb)) axis = 'x';
      else if (touchesZ(ra) && touchesZ(rb)) axis = 'z';
      else errors.push(`${tname}: its ends must sit flush against a wall of room ${a} and a wall of room ${b}`);
      const width = axis === 'x' ? t.maxZ - t.minZ : t.maxX - t.minX;
      if (width < MIN_TUNNEL_WIDTH - LEVEL_TOL) errors.push(`${tname}: ${width.toFixed(2)} m wide, narrower than 1.4 m`);
    }
    tunnels.push({ name: tname, a, b, ...t, height, color: palette.tunnel, axis, floor });
  });

  const onFloor = (x: number, z: number) =>
    !!inRoom(x, z) || tunnels.some(t => x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ);

  // --- stairs, boxes -----------------------------------------------------------
  const ids = new Set<string>();
  const claim = (markerId: string) => {
    if (ids.has(markerId)) errors.push(`duplicate id ${markerId}`);
    ids.add(markerId);
  };

  const stairs: StairDef[] = [];
  list(j.stairs, 'stairs').forEach((o, i) => {
    const sid = str(o.id, `stairs[${i}].id`, `stair${i}`);
    keys(o, 'stair', `stair ${sid}`);
    const keep = present(o, `stair ${sid}`);
    claim(sid);
    const up = o.up;
    if (up !== '+x' && up !== '-x' && up !== '+z' && up !== '-z') errors.push(`stair ${sid}: up must be +x, -x, +z or -z`);
    const box = aabb(o, `stair ${sid}`);
    if (box.max[1] - box.min[1] > MAX_STAIR_RISE) errors.push(`stair ${sid}: rises more than 3 m`);
    if (!onFloor((box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2)) errors.push(`stair ${sid}: outside every room and corridor`);
    if (keep) stairs.push({ id: sid, up: (up as StairDef['up']) ?? '+z', box });
  });

  const furniture: FurnitureDef[] = [];
  list(j.furniture, 'furniture').forEach((o, i) => {
    const where = `furniture[${i}]`;
    keys(o, 'box', where);
    const keep = present(o, where);
    const box = aabb(o, where);
    const room = inRoom((box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2);
    if (!room) errors.push(`${where}: furniture centre is outside every room`);
    else if (Math.abs(box.min[1] - room.floor) > LEVEL_TOL) errors.push(`${where}: furniture must sit on its room's floor (use solids for raised boxes)`);
    if (keep) furniture.push({ room: room?.id ?? 0, minX: box.min[0], maxX: box.max[0], minZ: box.min[2],
      maxZ: box.max[2], height: box.max[1] - box.min[1] });
  });
  const solids: Aabb[] = [];
  list(j.solids, 'solids').forEach((o, i) => {
    keys(o, 'box', `solids[${i}]`);
    const keep = present(o, `solids[${i}]`);
    const box = aabb(o, `solids[${i}]`);
    if (keep) solids.push(box);
  });

  const gates: GateDef[] = [];
  list(j.gates, 'gates').forEach((o, i) => {
    const gid = str(o.id, `gates[${i}].id`, `gate${i}`);
    keys(o, 'gate', `gate ${gid}`);
    const keep = present(o, `gate ${gid}`);
    claim(gid);
    const g = { id: gid, opensOn: str(o.opensOn, `gate ${gid}.opensOn`), box: aabb(o, `gate ${gid}`) };
    if (keep) gates.push(g);
  });
  const triggers: TriggerDef[] = [];
  list(j.triggers, 'triggers').forEach((o, i) => {
    const tid = str(o.id, `triggers[${i}].id`, `trigger${i}`);
    keys(o, 'trigger', `trigger ${tid}`);
    const keep = present(o, `trigger ${tid}`);
    claim(tid);
    const t = { id: tid, event: str(o.event, `trigger ${tid}.event`), once: o.once !== false, box: aabb(o, `trigger ${tid}`) };
    if (keep) triggers.push(t);
  });

  // --- windows: find the one wall each lies on ---------------------------------
  const windows: WindowDef[] = [];
  list(j.windows, 'windows').forEach((o, i) => {
    const wid = str(o.id, `windows[${i}].id`, `window${i}`);
    keys(o, 'window', `window ${wid}`);
    const keep = present(o, `window ${wid}`);
    claim(wid);
    const view = str(o.view, `window ${wid}.view`, 'none');
    const box = aabb(o, `window ${wid}`);
    let found: { room: number; side: WallSide } | null = null;
    for (const r of rooms) {
      const inY = box.min[1] >= r.floor - LEVEL_TOL && box.max[1] <= r.floor + r.height + LEVEL_TOL;
      const inX = box.min[0] >= r.minX - LEVEL_TOL && box.max[0] <= r.maxX + LEVEL_TOL;
      const inZ = box.min[2] >= r.minZ - LEVEL_TOL && box.max[2] <= r.maxZ + LEVEL_TOL;
      const straddles = (lo: number, hi: number, at: number) => lo <= at + LEVEL_TOL && hi >= at - LEVEL_TOL;
      if (!inY) continue;
      if (inZ && straddles(box.min[0], box.max[0], r.minX)) found = { room: r.id, side: 'w' };
      else if (inZ && straddles(box.min[0], box.max[0], r.maxX)) found = { room: r.id, side: 'e' };
      else if (inX && straddles(box.min[2], box.max[2], r.minZ)) found = { room: r.id, side: 'n' };
      else if (inX && straddles(box.min[2], box.max[2], r.maxZ)) found = { room: r.id, side: 's' };
      if (found) break;
    }
    if (!found) errors.push(`window ${wid}: must lie on one room wall, inside its span and height`);
    else if (keep) windows.push({ id: wid, view, ...found, box });
  });

  // --- lights -> room accents --------------------------------------------------
  list(j.lights, 'lights').forEach((o, i) => {
    keys(o, 'light', `lights[${i}]`);
    const keep = present(o, `lights[${i}]`);
    const pos = vec(o.pos, 3, `lights[${i}].pos`) as unknown as Vec3;
    const color = vec(o.color, 3, `lights[${i}].color`) as unknown as Vec3;
    const power = num(o.power, `lights[${i}].power`, 9);
    let mood: LampMood | undefined;
    if (o.mood !== undefined) {
      mood = LAMP_MOODS.find(m => m === o.mood);
      if (!mood) errors.push(`lights[${i}].mood: must be one of ${LAMP_MOODS.join(', ')}`);
    }
    let fixture: 'bulb' | 'tube' | undefined;
    if (o.fixture !== undefined) {
      if (o.fixture === 'bulb' || o.fixture === 'tube') fixture = o.fixture;
      else errors.push(`lights[${i}].fixture: must be bulb or tube`);
    }
    const room = inRoom(pos[0], pos[2]);
    if (!room) errors.push(`lights[${i}]: outside every room`);
    else if (keep) room.accents.push({ pos, color, power, ...(mood ? { mood } : {}), ...(fixture ? { fixture } : {}) });
  });

  // --- cues (dynamic light §3) --------------------------------------------------
  const cues: CueDef[] = [];
  list(j.cues, 'cues').forEach((o, i) => {
    keys(o, 'cue', `cues[${i}]`);
    const on = typeof o.on === 'string' && o.on ? o.on : null;
    if (!on) errors.push(`cues[${i}].on: must be an event name`);
    const emit = Array.isArray(o.emit) && o.emit.length > 0 && o.emit.every(e => typeof e === 'string' && e) ? o.emit as string[] : null;
    if (!emit) errors.push(`cues[${i}].emit: must be a non-empty list of event names`);
    if (on && emit) cues.push({ on, emit: [...emit] });
  });

  // --- markers -----------------------------------------------------------------
  const st = (j.start ?? {}) as Json;
  keys(st, 'start', 'start');
  const startPos = vec(st.pos, 3, 'start.pos');
  const playerStart = { x: startPos[0]!, y: startPos[1]!, z: startPos[2]!, yaw: num(st.yaw, 'start.yaw'), pitch: 0 };
  if (!onFloor(playerStart.x, playerStart.z)) errors.push('start: outside every room and corridor');

  const spawns: SpawnDef[] = [];
  list(j.spawns, 'spawns').forEach((o, i) => {
    const sid = str(o.id, `spawns[${i}].id`, `spawn${i}`);
    keys(o, 'spawn', `spawn ${sid}`);
    const keep = present(o, `spawn ${sid}`);
    claim(sid);
    const kind = o.kind === 'soldier' || o.kind === 'zombie' || o.kind === 'cultist' ? o.kind : null;
    if (!kind) errors.push(`spawn ${sid}: kind must be zombie, soldier or cultist`);
    const pos = vec(o.pos, 3, `spawn ${sid}.pos`) as unknown as Vec3;
    const room = inRoom(pos[0], pos[2]);
    if (!room) errors.push(`spawn ${sid}: must be inside a room (not a corridor)`);
    if (!keep) return;
    if (room) {
      room.zombies += 1;
      if (kind === 'soldier') room.soldiers = (room.soldiers ?? 0) + 1;
    }
    spawns.push({ id: sid, kind: kind ?? 'zombie', pos, yaw: isNum(o.yaw) ? o.yaw : 0 });
  });

  const graves: GraveDef[] = [];
  list(j.graves, 'graves').forEach((o, i) => {
    const gid = str(o.id, `graves[${i}].id`, `grave${i}`);
    keys(o, 'grave', `grave ${gid}`);
    const keep = present(o, `grave ${gid}`);
    claim(gid);
    const wave = num(o.wave, `grave ${gid}.wave`);
    if (!Number.isInteger(wave) || wave < 0) errors.push(`grave ${gid}: wave must be an integer >= 0`);
    const pos = vec(o.pos, 3, `grave ${gid}.pos`) as unknown as Vec3;
    if (!inRoom(pos[0], pos[2])) errors.push(`grave ${gid}: must be inside a room`);
    if (keep) graves.push({ id: gid, wave, pos, yaw: isNum(o.yaw) ? o.yaw : 0 });
  });

  const pickups: PickupDef[] = [];
  list(j.pickups, 'pickups').forEach((o, i) => {
    const pid = str(o.id, `pickups[${i}].id`, `pickup${i}`);
    keys(o, 'pickup', `pickup ${pid}`);
    const keep = present(o, `pickup ${pid}`);
    claim(pid);
    const item = PICKUP_ITEMS.find(p => p === o.item);
    if (!item) errors.push(`pickup ${pid}: item must be one of ${PICKUP_ITEMS.join(', ')}`);
    const pos = vec(o.pos, 3, `pickup ${pid}.pos`) as unknown as Vec3;
    if (!onFloor(pos[0], pos[2])) errors.push(`pickup ${pid}: outside every room and corridor`);
    if (keep) pickups.push({ id: pid, item: (item ?? 'shells') as PickupItem, pos });
  });

  const bells: BellDef[] = [];
  list(j.bells, 'bells').forEach((o, i) => {
    const bid = str(o.id, `bells[${i}].id`, `bell${i}`);
    keys(o, 'bell', `bell ${bid}`);
    const keep = present(o, `bell ${bid}`);
    claim(bid);
    const pos = vec(o.pos, 3, `bell ${bid}.pos`) as unknown as Vec3;
    const radius = o.radius === undefined ? 0.8 : num(o.radius, `bell ${bid}.radius`, 0.8);
    if (radius <= 0) errors.push(`bell ${bid}: radius must be > 0`);
    if (!inRoom(pos[0], pos[2])) errors.push(`bell ${bid}: must be inside a room`);
    if (keep) bells.push({ id: bid, pos, radius });
  });

  const portals: PortalDef[] = [];
  list(j.portals, 'portals').forEach((o, i) => {
    const pid = str(o.id, `portals[${i}].id`, `portal${i}`);
    keys(o, 'portal', `portal ${pid}`);
    const keep = present(o, `portal ${pid}`);
    claim(pid);
    const pos = vec(o.pos, 3, `portal ${pid}.pos`) as unknown as Vec3;
    const width = num(o.width, `portal ${pid}.width`, 2.2), height = num(o.height, `portal ${pid}.height`, 3.4);
    if (!(width > 0 && height > 0)) errors.push(`portal ${pid}: width and height must be > 0`);
    const target = str(o.target, `portal ${pid}.target`);
    if (!/^[a-z0-9-]+$/.test(target)) errors.push(`portal ${pid}: target must match [a-z0-9-]+`);
    if (!inRoom(pos[0], pos[2])) errors.push(`portal ${pid}: outside every room`);
    if (keep) portals.push({ id: pid, pos, yaw: isNum(o.yaw) ? o.yaw : 0, width, height, target });
  });

  if (errors.length > 0) throw new Error(`level ${id}: ${errors.join('; ')}`);

  // --- capabilities (spec §8), in a fixed order ---------------------------------
  const requires: Capability[] = [];
  if (rooms.some(r => Math.abs(r.floor) > LEVEL_TOL) || stairs.length > 0) requires.push('multi-floor');
  if (windows.length > 0) requires.push('windows');
  if (rooms.some(r => r.sky !== null)) requires.push('open-sky');
  if (rooms.some(r => r.void)) requires.push('void');
  if (portals.length > 0) requires.push('portals');
  if (art !== null || rooms.some(r => r.shell === 'art')) requires.push('art');

  return {
    id, name, ammo, palette, loadout, completeOn, state, states, requires, skyline,
    rooms, tunnels, stairs, furniture, solids, gates, triggers, cues, windows,
    playerStart, spawns, graves, pickups, bells, portals, art,
  };
}
