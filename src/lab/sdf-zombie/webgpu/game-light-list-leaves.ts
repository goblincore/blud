// src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts
//
// THE SHARED LIGHT LIST, GAME SIDE (Shared Light List plan 1, Task 6). Three parts:
//  1. collectLightSources: PURE. Plain source data in (lamps, tubes, the storm's window light,
//     the flashlight, the direct flashes), typed LightSource[] out (light-list.ts).
//  2. readSourceInput: the three.js reader that fills that plain data from ctx each frame.
//  3. createLightListGpu / writeLightList: the list's one storage buffer (profiles + lights,
//     LIST_VEC4S vec4), owned by the dynamic-light runtime (ctx.world.light.list) and written
//     once a frame. Nothing reads it yet (Task 9 binds it into the march).
//
// The 32 cap is relevance-first (Task 6 review): writeLightList hands buildLightList the
// player's position and the mask of the player's room plus the rooms the level's tunnels join
// to it (nearRoomMask), so a far carriage's bright lamps never evict the dim ones around the
// player.

import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import type { GameContext } from './game-context';
import { roomIdAt } from './game-level-leaves';
import type { LampMood } from './lamp-moods';
import { buildLightList, LIST_VEC4S, packLightList, ROOM_MASK_BITS, type LightSource, type ListLight, type ListRelevance, type Vec3 } from './light-list';
import { PROFILE_ID, type ProfileName } from './light-profiles';
import { pickLights, unpackPick, type Pick, type PickBody } from './light-pick';

type RVec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------------------------
// 1. Pure: plain source data -> LightSource[]
// ---------------------------------------------------------------------------------------------

/** A tube's spot intensity per unit of its lamp's base power (game-dynamic-light-leaves TUBE
 *  reads it from here, so the tube's reference intensity below cannot drift from the spot). */
export const TUBE_SPOT_GAIN = 7;

export interface LampInput {
  pos: Vec3; color: Vec3; intensity: number; range: number; room: number;
  /** The lamp's full-level intensity (its base power; a tube's base x TUBE_SPOT_GAIN): the body
   *  key reads intensity / ref, the lamp's live level (Task 10 calibration). */
  ref?: number;
  /** The tube's cone (the lamp's main light is then the spot), or null for a point lamp. */
  tube: { axis: Vec3; cosOuter: number; cosInner: number } | null;
  gain?: number; tint?: RVec3;
  mood: LampMood;
}
/** The storm's one window light. `rooms`: every carriage that has a window light (lightning
 *  enters each of them, seen through a door or not); empty = any room. */
export interface WindowInput { dir: Vec3; color: Vec3; intensity: number; rooms: number[] }
export interface FlashlightInput { pos: Vec3; axis: Vec3; color: Vec3; intensity: number; range: number; cosOuter: number; cosInner: number; ref?: number }
export interface FlashInput { pos: RVec3; intensity: number; fire?: boolean }

export interface SourceInput {
  lamps: LampInput[];
  window: WindowInput | null;
  flashlight: FlashlightInput | null;
  flashes: FlashInput[];
}

/** Fire keys a body only within 3 m (strongestLamp's rule; settled after Task 4). */
export const FIRE_RANGE = 3;
/** A muzzle flash's reach, metres. */
const FLASH_RANGE = 8;
/** The gather's muzzle colour (game-main's player flash). */
const MUZZLE_COLOR: Vec3 = [1.0, 0.81, 0.58];
/** The burning bodies' gather colour (game-burning pushGatherLights). */
const FIRE_COLOR: Vec3 = [1.0, 0.5, 0.18];

/** Plain data in, LightSource[] out, in source order: lamps, window, flashlight, flashes.
 *  Zero-intensity sources are kept; buildLightList drops them. */
export function collectLightSources(input: SourceInput): LightSource[] {
  const out: LightSource[] = [];
  for (const l of input.lamps) {
    const fire = l.mood === 'fire';
    const profile: ProfileName = fire ? 'fire' : l.tube ? 'tube' : 'lamp';
    const s: LightSource = {
      kind: l.tube ? 'spot' : 'point', profile,
      pos: l.pos, color: l.color, intensity: l.intensity, range: fire ? FIRE_RANGE : l.range,
    };
    if (l.room >= 0) s.rooms = [l.room];
    if (l.tube) { s.axis = l.tube.axis; s.cosOuter = l.tube.cosOuter; s.cosInner = l.tube.cosInner; }
    if (l.gain !== undefined) s.levelGain = l.gain;
    if (l.ref !== undefined) s.refIntensity = l.ref;
    if (l.tint) s.levelTint = [l.tint[0], l.tint[1], l.tint[2]];
    out.push(s);
  }
  const w = input.window;
  if (w) out.push({ kind: 'directional', profile: 'window', pos: w.dir, color: w.color, intensity: w.intensity, range: 0, rooms: w.rooms });
  const f = input.flashlight;
  if (f) {
    out.push({ kind: 'spot', profile: 'flashlight', pos: f.pos, color: f.color, intensity: f.intensity, range: f.range,
      axis: f.axis, cosOuter: f.cosOuter, cosInner: f.cosInner, ...(f.ref !== undefined ? { refIntensity: f.ref } : {}) });
  }
  for (const fl of input.flashes) {
    out.push({ kind: 'point', profile: fl.fire ? 'fire' : 'muzzle', pos: [fl.pos[0], fl.pos[1], fl.pos[2]],
      color: fl.fire ? FIRE_COLOR : MUZZLE_COLOR, intensity: fl.intensity,
      range: fl.fire ? FIRE_RANGE : FLASH_RANGE });
  }
  return out;
}

/** The rect and rooms of a tunnel (TunnelDef's fields the relevance needs). */
export interface TunnelLink { a: number; b: number; minX: number; maxX: number; minZ: number; maxZ: number }

/** The player's surroundings as a room mask (light-list roomMaskOf): the player's room plus
 *  every room a tunnel joins to it; in a tunnel (room -1), the rooms of the tunnels the point
 *  stands in. 0 = unknown (no tier; the cap then ranks by distance alone), also when a room id
 *  does not fit the mask. Pure, allocation-free. */
export function nearRoomMask(tunnels: readonly TunnelLink[], room: number, x: number, z: number): number {
  let m = 0;
  const add = (r: number): boolean => {
    if (r < 0 || r >= ROOM_MASK_BITS) return false;
    m |= 1 << r;
    return true;
  };
  if (room >= 0) {
    if (!add(room)) return 0;
    for (const t of tunnels) {
      if (t.a === room && !add(t.b)) return 0;
      if (t.b === room && !add(t.a)) return 0;
    }
    return m;
  }
  for (const t of tunnels) {
    if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
    if (!add(t.a) || !add(t.b)) return 0;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// 2. The three.js reader
// ---------------------------------------------------------------------------------------------

/** A point light's distance of 0 means "no cutoff"; the list needs a finite range. */
const DEFAULT_RANGE = 12;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const v3 = (v: THREE.Vector3, out: Vec3): Vec3 => { out[0] = v.x; out[1] = v.y; out[2] = v.z; return out; };
const c3 = (c: THREE.Color, out: Vec3): Vec3 => { out[0] = c.r; out[1] = c.g; out[2] = c.b; return out; };

/** Reused across frames (the reader rewrites these records in place). */
function makeInput(): SourceInput { return { lamps: [], window: null, flashlight: null, flashes: [] }; }
const scratchWindow: WindowInput = { dir: [0, 1, 0], color: [1, 1, 1], intensity: 0, rooms: [] };
const scratchTorch: FlashlightInput = { pos: [0, 0, 0], axis: [0, 0, -1], color: [1, 1, 1], intensity: 0, range: 0, cosOuter: 1, cosInner: 1 };

/** Fill the plain source data from the live lights. `into` is rewritten in place. */
export function readSourceInput(
  ctx: GameContext, directFlashes: readonly FlashInput[], into: SourceInput = makeInput(),
): SourceInput {
  const rt = ctx.world.light;
  const lamps = rt?.lamps ?? [];
  into.lamps.length = lamps.length;
  for (let i = 0; i < lamps.length; i++) {
    const l = lamps[i]!;
    const rec = (into.lamps[i] ??= { pos: [0, 0, 0], color: [1, 1, 1], intensity: 0, range: DEFAULT_RANGE, room: -1, tube: null, mood: 'steady' });
    rec.room = l.room; rec.mood = l.mood;
    rec.gain = l.gain; rec.tint = l.tint;
    rec.ref = l.base * (l.tube?.spot ? TUBE_SPOT_GAIN : 1);
    const spot = l.tube?.spot;
    if (spot) {
      // A tube lamp's main light is its spot (the omni is a 0.2 spill, left out of the list).
      spot.getWorldPosition(_a);
      spot.target.getWorldPosition(_b);
      v3(_a, rec.pos); c3(spot.color, rec.color);
      rec.intensity = spot.intensity;
      rec.range = spot.distance > 0 ? spot.distance : DEFAULT_RANGE;
      const t = (rec.tube ??= { axis: [0, -1, 0], cosOuter: 1, cosInner: 1 });
      v3(_b.sub(_a).normalize(), t.axis);
      t.cosOuter = Math.cos(spot.angle);
      t.cosInner = Math.cos(spot.angle * (1 - spot.penumbra));
    } else {
      l.light.getWorldPosition(_a);
      v3(_a, rec.pos); c3(l.light.color, rec.color);
      rec.intensity = l.light.intensity;
      rec.range = l.light.distance > 0 ? l.light.distance : DEFAULT_RANGE;
      rec.tube = null;
    }
  }

  // The storm's window light: one per level, entering EVERY carriage that has a window light
  // (a body seen through a door into the next carriage still takes the lightning; the
  // windowless tender does not). A level with a storm but no window lights: any room.
  into.window = null;
  const storm = rt?.storm;
  if (storm) {
    scratchWindow.dir[0] = storm.dir[0]; scratchWindow.dir[1] = storm.dir[1]; scratchWindow.dir[2] = storm.dir[2];
    scratchWindow.color[0] = storm.color[0]; scratchWindow.color[1] = storm.color[1]; scratchWindow.color[2] = storm.color[2];
    scratchWindow.intensity = storm.intensity;
    scratchWindow.rooms.length = 0;
    for (const id of rt.windowLights.keys()) scratchWindow.rooms.push(id);
    into.window = scratchWindow;
  }

  // The flashlight: only while the dungeon rig is on and its switch has it lit.
  into.flashlight = null;
  const fl = ctx.lighting.flashlight;
  if (ctx.lighting.dungeonOn && fl && fl.spot.intensity > 0) {
    const s = fl.spot;
    s.getWorldPosition(_a);
    s.target.getWorldPosition(_b);
    v3(_a, scratchTorch.pos); v3(_b.sub(_a).normalize(), scratchTorch.axis); c3(s.color, scratchTorch.color);
    scratchTorch.intensity = s.intensity;
    scratchTorch.range = s.distance > 0 ? s.distance : DEFAULT_RANGE;
    scratchTorch.cosOuter = Math.cos(s.angle);
    scratchTorch.cosInner = Math.cos(s.angle * (1 - s.penumbra));
    scratchTorch.ref = rt?.flashlight.base;
    into.flashlight = scratchTorch;
  }

  into.flashes.length = 0;
  for (const f of directFlashes) into.flashes.push(f);
  return into;
}

// ---------------------------------------------------------------------------------------------
// 3. The GPU buffer and its single writer
// ---------------------------------------------------------------------------------------------

const makeListNode = (attr: THREE.StorageBufferAttribute) => storage(attr, 'vec4', LIST_VEC4S).toReadOnly();

export interface LightListGpu {
  floats: Float32Array<ArrayBuffer>;
  attr: THREE.StorageBufferAttribute;
  /** Read-only storage node, LIST_VEC4S vec4 (profiles, header, lights). Bound by Task 9. */
  node: ReturnType<typeof makeListNode>;
  /** This frame's list (plain data; the lightList() seam reads it). */
  list: ListLight[];
  /** The reader's reused plain input. */
  input: SourceInput;
  /** The reused relevance context (the player's position and surroundings). */
  rel: ListRelevance;
}

export function createLightListGpu(): LightListGpu {
  const floats = new Float32Array(LIST_VEC4S * 4);
  packLightList([], floats);   // the profile table is valid from the first frame
  const attr = new THREE.StorageBufferAttribute(floats, 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  const node = makeListNode(attr);
  return { floats, attr, node, list: [], input: makeInput(), rel: { pos: [0, 0, 0], nearMask: 0 } };
}

/** Once a frame, after the direct flashes are complete: rebuild the list and upload it, the
 *  cap preferring the player's room and the rooms joined to it. Per-frame allocation is bounded
 *  by the source count: collectLightSources' records and buildLightList's map/filter/sort
 *  chain (the reader and the relevance context are reused). */
export function writeLightList(ctx: GameContext, directFlashes: readonly FlashInput[]): void {
  const g = ctx.world.light?.list;
  if (!g) return;
  const [px, py, pz] = ctx.player.player.pos;
  g.rel.pos[0] = px; g.rel.pos[1] = py; g.rel.pos[2] = pz;
  g.rel.nearMask = nearRoomMask(ctx.world.level.tunnels, roomIdAt(ctx, px, pz), px, pz);
  g.list = buildLightList(collectLightSources(readSourceInput(ctx, directFlashes, g.input)), g.rel);
  packLightList(g.list, g.floats);
  g.attr.needsUpdate = true;
}

const PROFILE_NAME = Object.fromEntries(Object.entries(PROFILE_ID).map(([k, v]) => [v, k])) as Record<number, ProfileName>;

/** The mask's room ids, ascending ([] = any room). */
export function maskRooms(mask: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < ROOM_MASK_BITS; r++) if (mask & (1 << r)) out.push(r);
  return out;
}

/** The seam's plain view of the list (`rooms: []` = any room). */
export function lightListView(g: LightListGpu | undefined | null) {
  return (g?.list ?? []).map(l => ({ kind: l.kind, profile: PROFILE_NAME[l.profile] ?? l.profile, pos: [...l.pos], intensity: l.intensity, rooms: maskRooms(l.roomMask) }));
}

// ---------------------------------------------------------------------------------------------
// 4. Each body's 4 lights (Task 10: the game turns the list on for bodies and crowds)
// ---------------------------------------------------------------------------------------------

/** `?lightlist=0` keeps the old key path (applyWindowKey / presentingLamp); anything else, or no
 *  param, lights every SDF body and crowd member by its own 4 picks from the shared list. */
export const LIGHT_LIST_ON = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('lightlist') !== '0';
/** The live switch, booted from LIGHT_LIST_ON. `__sdfGame.setLightList(on)` flips it for the cost
 *  A/B (interleaved rounds in one boot); look A/Bs use fresh `?lightlist=0|1` boots. */
let listOn = LIGHT_LIST_ON;
export const lightListOn = (): boolean => listOn;
export function setLightListOn(on: boolean): void { listOn = on; }

/** The pick body of an actor rooted at `root` (feet), as presentingLamp judged it: distance and
 *  direction at the chest (root + 1.2), spot coverage at the feet (root + 0.2), and the FRONT is
 *  the unit xz direction toward the VIEWER (the light that presents the body to the camera wins;
 *  a light behind it, as the player sees it, takes the backKey falloff). A camera straight
 *  overhead falls back to [0, 1]. Pure. */
export function pickBodyFor(root: RVec3, room: number, camPos: RVec3): PickBody {
  const fx = camPos[0] - root[0], fz = camPos[2] - root[2];
  const h = Math.hypot(fx, fz);
  return {
    pos: [root[0], root[1] + 1.2, root[2]],
    feetY: root[1] + 0.2,
    room,
    facing: h < 1e-4 ? [0, 1] : [fx / h, fz / h],
  };
}

type Vec4U = { value: THREE.Vector4 };
const scratchPick: Pick = { idx: [-1, -1, -1, -1], weight: [0, 0, 0, 0], packed: [-1, -1, -1, -1] };

/** Pick the body's 4 lights from this frame's list and write them to its view (`bodyLights`,
 *  copied into the record by syncRecord) with the list switched on (`lightListCfg.x = 1`). Call
 *  after writeLightList and before the view's syncRecord. */
export function applyBodyLights(ctx: GameContext, u: { bodyLights: Vec4U; lightListCfg: Vec4U }, body: PickBody): void {
  const p = pickLights(ctx.world.light?.list?.list ?? [], body, scratchPick).packed;
  u.bodyLights.value.set(p[0], p[1], p[2], p[3]);
  u.lightListCfg.value.x = 1;
}

/** The seam's plain view of each actor's picks: `{ id, room, crowd, picks: [{ index, weight }] x 4 }`
 *  (index -1 = empty; crowd = drawn by a crowd type), read back from the views' `bodyLights`. */
export function bodyPicksView(actors: readonly { id: number; room: number; crowd?: unknown; view: { uniforms: { bodyLights: Vec4U } } }[]) {
  return actors.map(a => ({ id: a.id, room: a.room, crowd: !!a.crowd, picks: unpackPick(a.view.uniforms.bodyLights.value.toArray()) }));
}
