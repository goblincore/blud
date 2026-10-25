// src/lab/sdf-zombie/webgpu/sector-json.ts
//
// SECTOR LEVELS — parse and validate (spec 2026-10-24-doom-sector-levels-design.md §4).
// Written by scripts/levels/doom_map.py (and by hand for fixtures). The sector block is checked
// here; everything a sector level shares with Level Format v1 (start, lights, solids, spawns,
// pickups, triggers, cues) is checked by parseLevelJson, which gets one art-shelled room per
// zone so its "inside a room" rules hold. Collects every problem and throws once.

import type { BarrelDef, Capability, LevelDef } from './level-def';
import { parseLevelJson, type ParseOptions } from './level-json';
import { buildSectorGround } from './sector-ground';
import { edgesArea, sectorEdgeIndices, sectorEdges } from './sector-edges';
import {
  GLOW_KINDS, SECTOR_SPECIALS, zoneName,
  type GlowKind, type SectorDef, type SectorLine, type SideWalls, type SectorMap, type SectorSpecial, type XZ,
} from './sector-def';

type Json = Record<string, unknown>;

const TOP = ['version', 'id', 'name', 'ammo', 'loadout', 'completeOn', 'arena', 'palette', 'geometry',
  'vertices', 'sectors', 'lines', 'solids', 'lights', 'start', 'spawns', 'pickups', 'triggers', 'cues', 'barrels'];
/** Handed on to parseLevelJson unchanged. */
const SHARED = ['version', 'id', 'name', 'ammo', 'loadout', 'completeOn', 'arena', 'palette',
  'solids', 'lights', 'start', 'spawns', 'pickups', 'triggers', 'cues'];
const SECTOR_KEYS = ['floor', 'ceil', 'light', 'special', 'hurtPerSec', 'glow', 'materials', 'zone'];
const LINE_KEYS = ['v', 'front', 'back', 'door', 'exit', 'walls'];
const WALL_SIDES = ['front', 'back'];
const WALL_PARTS = ['upper', 'mid', 'lower'];
const DOOR_KEYS = ['sector', 'speed', 'wait'];
const MATERIAL_KEYS = ['floor', 'ceil', 'wall'];
const BARREL_KEYS = ['id', 'pos'];
/** How far a barrel's y may sit off the floor under it (float noise from the converter's unit scale). */
const BARREL_FLOOR_TOLERANCE_M = 0.01;

const backSideOnOneSided = (back: number, walls: NonNullable<SectorLine['walls']>) => back < 0 && walls.back !== undefined;

/** A sector file (`"geometry": "sectors"`) or a Level Format v1 room file. */
export function parseLevel(raw: unknown, opts: ParseOptions = {}): LevelDef {
  const j = (raw ?? {}) as Json;
  return j.geometry === 'sectors' ? parseSectorLevel(raw, opts) : parseLevelJson(raw, opts);
}

/** parseLevelJson puts each light in the FIRST room whose box holds it, and zone boxes overlap on
 *  sector levels, so a light can land in the wrong zone (E1M1: the sector-53 pool light went to
 *  zone 9, not 10) and be gated out of its own zone's light lists. The sector under the light
 *  decides its zone, as it does for keyAt and spawnList. A light over no sector stays put. */
function rehomeAccents(def: LevelDef, map: SectorMap): void {
  const ground = buildSectorGround(map);
  const byName = new Map(def.rooms.map(r => [r.name, r]));
  const placed = def.rooms.flatMap(r => r.accents.map(a => {
    const s = ground.sectorAt(a.pos[0], a.pos[2]);
    return { a, to: (s < 0 ? undefined : byName.get(zoneName(map.sectors[s]!.zone))) ?? r };
  }));
  for (const r of def.rooms) r.accents.length = 0;
  for (const { a, to } of placed) to.accents.push(a);
}

export function parseSectorLevel(raw: unknown, opts: ParseOptions = {}): LevelDef {
  const errors: string[] = [];
  const j = (raw ?? {}) as Json;
  const id = typeof j.id === 'string' ? j.id : 'unknown';
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isInt = (v: unknown): v is number => Number.isInteger(v);
  const unknownKeys = (o: Json, known: readonly string[], where: string) => {
    for (const k of Object.keys(o)) if (!known.includes(k)) errors.push(`${where}: unknown key ${k}`);
  };
  const objects = (v: unknown, where: string): Json[] => {
    if (Array.isArray(v) && v.every(x => typeof x === 'object' && x !== null && !Array.isArray(x))) return v as Json[];
    errors.push(`${where}: expected an array of objects`);
    return [];
  };

  unknownKeys(j, TOP, 'level');
  if (j.geometry !== 'sectors') errors.push('geometry: expected "sectors"');

  // --- vertices ------------------------------------------------------------------
  const vertices: XZ[] = [];
  if (!Array.isArray(j.vertices)) errors.push('vertices: expected an array of [x, z]');
  else j.vertices.forEach((v, i) => {
    if (Array.isArray(v) && v.length === 2 && v.every(isNum)) vertices.push([v[0] as number, v[1] as number]);
    else { errors.push(`vertices[${i}]: expected [x, z]`); vertices.push([0, 0]); }
  });

  // --- sectors -------------------------------------------------------------------
  const sectors: SectorDef[] = objects(j.sectors, 'sectors').map((o, i) => {
    const where = `sectors[${i}]`;
    unknownKeys(o, SECTOR_KEYS, where);
    const floor = isNum(o.floor) ? o.floor : (errors.push(`${where}.floor: expected a number`), 0);
    const ceil = isNum(o.ceil) ? o.ceil : (errors.push(`${where}.ceil: expected a number`), floor + 1);
    const light = o.light === undefined ? 0.5 : isNum(o.light) && o.light >= 0 && o.light <= 1 ? o.light
      : (errors.push(`${where}.light: a number in 0..1`), 0.5);
    let special: SectorSpecial = 'none';
    if (o.special !== undefined) {
      if (SECTOR_SPECIALS.includes(o.special as SectorSpecial)) special = o.special as SectorSpecial;
      else errors.push(`${where}.special: one of ${SECTOR_SPECIALS.join(', ')}`);
    }
    const hurtPerSec = o.hurtPerSec === undefined ? 0 : isNum(o.hurtPerSec) && o.hurtPerSec >= 0 ? o.hurtPerSec
      : (errors.push(`${where}.hurtPerSec: a number >= 0`), 0);
    if (special === 'hurt' && !(hurtPerSec > 0)) errors.push(`${where}.hurtPerSec: a hurt sector needs hurtPerSec > 0`);
    let glow: GlowKind | null = null;
    if (o.glow !== undefined && o.glow !== null) {
      if (GLOW_KINDS.includes(o.glow as GlowKind)) glow = o.glow as GlowKind;
      else errors.push(`${where}.glow: one of ${GLOW_KINDS.join(', ')}`);
    }
    let mj: Json = {};
    if (o.materials !== undefined) {
      if (typeof o.materials === 'object' && o.materials !== null && !Array.isArray(o.materials)) mj = o.materials as Json;
      else errors.push(`${where}.materials: expected an object`);
    }
    unknownKeys(mj, MATERIAL_KEYS, `${where}.materials`);
    const mat = (k: string) => {
      if (mj[k] === undefined) return 'default';
      if (typeof mj[k] === 'string' && mj[k]) return mj[k] as string;
      errors.push(`${where}.materials.${k}: expected a name`);
      return 'default';
    };
    const zone = isInt(o.zone) && o.zone >= 0 ? o.zone : (errors.push(`${where}.zone: an integer >= 0`), 0);
    return { floor, ceil, light, special, hurtPerSec, glow,
      materials: { floor: mat('floor'), ceil: mat('ceil'), wall: mat('wall') }, zone };
  });
  if (sectors.length === 0) errors.push('sectors: a sector level needs at least one sector');

  // --- lines ---------------------------------------------------------------------
  const sectorIndex = (v: unknown) => isInt(v) && v >= 0 && v < sectors.length;
  const lines: SectorLine[] = objects(j.lines, 'lines').map((o, i) => {
    const where = `lines[${i}]`;
    unknownKeys(o, LINE_KEYS, where);
    const ok = Array.isArray(o.v) && o.v.length === 2 && o.v.every(x => isInt(x) && x >= 0 && x < vertices.length)
      && o.v[0] !== o.v[1];
    if (!ok) errors.push(`${where}.v: two different vertex indices`);
    const v = (ok ? o.v : [0, 0]) as [number, number];
    if (ok) {
      const a = vertices[v[0]]!, b = vertices[v[1]]!;
      if (a[0] === b[0] && a[1] === b[1]) errors.push(`${where}.v: zero-length line`);
    }
    const front = sectorIndex(o.front) ? o.front as number : (errors.push(`${where}.front: a sector index`), 0);
    const back = o.back === undefined || o.back === null || o.back === -1 ? -1
      : sectorIndex(o.back) ? o.back as number : (errors.push(`${where}.back: a sector index or -1`), -1);
    let door: SectorLine['door'] = null;
    if (o.door !== undefined && o.door !== null) {
      if (typeof o.door !== 'object' || Array.isArray(o.door)) errors.push(`${where}.door: expected an object`);
      const d = (typeof o.door === 'object' && !Array.isArray(o.door) ? o.door : {}) as Json;
      unknownKeys(d, DOOR_KEYS, `${where}.door`);
      if (!sectorIndex(d.sector)) errors.push(`${where}.door.sector: a sector index`);
      const speed = d.speed === undefined ? 2 : isNum(d.speed) && d.speed > 0 ? d.speed : (errors.push(`${where}.door.speed: > 0`), 2);
      const wait = d.wait === undefined ? 4 : isNum(d.wait) && d.wait >= 0 ? d.wait : (errors.push(`${where}.door.wait: >= 0`), 4);
      door = { sector: sectorIndex(d.sector) ? d.sector as number : 0, speed, wait };
    }
    if (o.exit !== undefined && typeof o.exit !== 'boolean') errors.push(`${where}.exit: true or false`);
    const rec: SectorLine = { v, front, back, door, exit: o.exit === true };
    if (o.walls !== undefined) {
      const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
      if (!isObj(o.walls)) errors.push(`${where}.walls: expected an object`);
      else {
        unknownKeys(o.walls, WALL_SIDES, `${where}.walls`);
        const walls: NonNullable<SectorLine['walls']> = {};
        for (const side of WALL_SIDES as ('front' | 'back')[]) {
          const sj = o.walls[side];
          if (sj === undefined) continue;
          if (!isObj(sj)) { errors.push(`${where}.walls.${side}: expected an object`); continue; }
          unknownKeys(sj, WALL_PARTS, `${where}.walls.${side}`);
          const parts: SideWalls = {};
          for (const part of WALL_PARTS as (keyof SideWalls)[]) {
            if (sj[part] === undefined) continue;
            if (typeof sj[part] === 'string' && sj[part]) parts[part] = sj[part] as string;
            else errors.push(`${where}.walls.${side}.${part}: expected a name`);
          }
          walls[side] = parts;
        }
        if (backSideOnOneSided(back, walls)) errors.push(`${where}.walls.back: a one-sided line has no back side`);
        rec.walls = walls;
      }
    }
    return rec;
  });

  // --- barrels (plan 3b): sector levels only; the room parser never sees them ------
  const barrels: BarrelDef[] = [];
  if (j.barrels !== undefined) {
    const seen = new Set<string>();
    objects(j.barrels, 'barrels').forEach((o, i) => {
      const where = `barrels[${i}]`;
      unknownKeys(o, BARREL_KEYS, where);
      const okId = typeof o.id === 'string' && o.id !== '';
      if (!okId) errors.push(`${where}.id: expected a name`);
      const okPos = Array.isArray(o.pos) && o.pos.length === 3 && o.pos.every(isNum);
      if (!okPos) errors.push(`${where}.pos: expected [x, y, z]`);
      if (okId && seen.has(o.id as string)) errors.push(`barrel ${o.id as string}: duplicate id`);
      if (okId) seen.add(o.id as string);
      if (okId && okPos) {
        const p = o.pos as number[];
        barrels.push({ id: o.id as string, pos: [p[0]!, p[1]!, p[2]!] });
      }
    });
  }

  // --- closure and winding: each sector's directed lines form closed loops, sector on the left ---
  const map: SectorMap = { vertices, sectors, lines };
  if (errors.length === 0) sectors.forEach((_, s) => {
    const idx = sectorEdgeIndices(map, s);
    const bal = new Map<number, number>();
    for (const [a, b] of idx) {
      bal.set(a, (bal.get(a) ?? 0) + 1);
      bal.set(b, (bal.get(b) ?? 0) - 1);
    }
    if (idx.length === 0) { errors.push(`sector ${s}: no lines`); return; }
    for (const [vi, n] of bal) if (n !== 0) { errors.push(`sector ${s}: not closed (vertex ${vi} unbalanced)`); return; }
    if (!(edgesArea(sectorEdges(map, s)) > 0)) errors.push(`sector ${s}: lines must keep the sector on their left (spec §4)`);
  });

  // --- heights: a door may close to its floor, nothing may invert -------------------
  const doorSectors = new Set(lines.flatMap(l => (l.door ? [l.door.sector] : [])));
  sectors.forEach((s, i) => {
    if (doorSectors.has(i)) { if (s.ceil < s.floor) errors.push(`sectors[${i}]: ceil must not be below floor`); }
    else if (!(s.ceil > s.floor)) errors.push(`sectors[${i}]: ceil must be above floor`);
  });

  // --- one art-shelled room per zone, boxed round its sectors' vertices -------------
  const zones = [...new Set(sectors.map(s => s.zone))].sort((a, b) => a - b);
  const rooms = zones.map(zone => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, lo = Infinity, hi = -Infinity;
    sectors.forEach((s, si) => {
      if (s.zone !== zone) return;
      lo = Math.min(lo, s.floor); hi = Math.max(hi, s.ceil);
      for (const l of lines) {
        if (l.front !== si && l.back !== si) continue;
        for (const vi of l.v) {
          const p = vertices[vi];
          if (!p) continue;
          const [x, z] = p;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
    });
    if (!Number.isFinite(minX)) { minX = maxX = minZ = maxZ = 0; }
    return { id: zone + 1, name: zoneName(zone), min: [minX, minZ], max: [maxX, maxZ], floor: lo,
      height: Math.max(hi - lo, 0.1), shell: 'art' };
  });

  // --- markers must stand in a sector (the room boxes alone let one land in a hole) ------
  if (errors.length === 0) {
    const ground = buildSectorGround(map);
    const inVoid = (pos: unknown): boolean => Array.isArray(pos) && pos.length === 3 && pos.every(isNum)
      && Number.isNaN(ground.floorAt(pos[0] as number, pos[2] as number));
    const posOf = (o: unknown): unknown => (typeof o === 'object' && o !== null ? (o as Json).pos : undefined);
    if (inVoid(posOf(j.start))) errors.push('start: must stand in a sector');
    const listed = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    const label = (kind: string, o: unknown, i: number) => {
      const id = typeof o === 'object' && o !== null ? (o as Json).id : undefined;
      return typeof id === 'string' || typeof id === 'number' ? String(id) : `${kind}${i}`;
    };
    listed(j.spawns).forEach((o, i) => { if (inVoid(posOf(o))) errors.push(`spawn ${label('spawn', o, i)}: must stand in a sector`); });
    listed(j.pickups).forEach((o, i) => { if (inVoid(posOf(o))) errors.push(`pickup ${label('pickup', o, i)}: must stand in a sector`); });
    listed(j.barrels).forEach((o, i) => {
      const pos = posOf(o);
      if (inVoid(pos)) { errors.push(`barrel ${label('barrel', o, i)}: must stand in a sector`); return; }
      // A barrel is scenery on its floor: its y must be the floor under it (the converter writes exactly that).
      if (Array.isArray(pos) && pos.length === 3 && pos.every(isNum)) {
        const [x, y, z] = pos as number[];
        if (Math.abs(y! - ground.floorAt(x!, z!)) > BARREL_FLOOR_TOLERANCE_M) errors.push(`barrel ${label('barrel', o, i)}: must stand on its floor`);
      }
    });
  }

  const shared: Json = {};
  for (const k of SHARED) if (j[k] !== undefined) shared[k] = j[k];
  let base: LevelDef | null = null;
  try { base = parseLevelJson({ ...shared, rooms }, opts); }
  catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(`level ${id}: `, '');
    errors.push(...msg.split('; '));
  }
  if (errors.length > 0 || !base) throw new Error(`level ${id}: ${errors.join('; ')}`);
  rehomeAccents(base, map);
  const requires: Capability[] = [...base.requires.filter(c => c !== 'multi-floor'), 'sectors'];
  return { ...base, requires, sectors: map, ...(barrels.length ? { barrels } : {}) };
}
