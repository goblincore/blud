// src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts
//
// DYNAMIC LIGHT in the game (docs/superpowers/specs/2026-09-26-night-train-dynamic-light-design.md):
// every level lamp follows its mood and scripted events (lamp-moods.ts), the flashlight is
// switched on by its pickup, and on a train the storm (storm.ts) lights each carriage through
// its windows with one shadowed directional "window light". Decisions are pure; this leaf
// holds the runtime on ctx.world.light and applies it each sim step.
//
// Rules: lights are never hidden, only their intensity moves (a hidden light re-keys the
// LightsNode and rebuilds pipelines); castShadow is set here at boot and never toggled; the
// window lights live under a group, not at the scene root (applyRig zeroes root directional
// lights); all of it exists before the per-room light lists are built.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { roomIdAt } from './game-level-leaves';
import { lampLevel, type LampMood, type LampScript } from './lamp-moods';
import type { LightMode } from './level-events';
import { moonShadowFrame } from './outdoor-light';
import { SHADOW_HULL_LAYER } from './sdf-layer';
import { STORM, stormSchedule, windowLightAt, type Bolt, type StormSchedule } from './storm';

/** Window-light shadow map size (one per windowed carriage; only the player's re-renders). */
const WINDOW_SHADOW_SIZE = 1024;
/** Hours of storm scheduled at boot (the schedule is cheap; no runtime extension needed). */
const STORM_HOURS = 4;
/** The lightning's default direction (toward the light), for each carriage's first map. */
const IDLE_DIR: [number, number, number] = [...STORM.boltDir];
/** The rig's ambient floor on a storm level (the lamps and the lightning carry the light). */
const STORM_AMBIENT = 0.3;
/** Switching the flashlight on: a ramp with two stutters, seconds. */
const TORCH_ON_S = 0.25;
/** The accent bowl's emissive at level 1 (game-main's accent loop). */
const BOWL_EMISSIVE = 2.2;

interface Lamp {
  light: THREE.PointLight;
  bowl: THREE.MeshStandardMaterial | null;
  base: number;
  mood: LampMood;
  room: number;
  seed: number;
  script: LampScript | null;
  level: number;
}

interface Glass { room: number; mat: THREE.MeshStandardMaterial; base: number; kind: 'lamp' | 'fire' }

export interface DynamicLightRuntime {
  /** The light clock: sim seconds (stops while the gate freezes the light clock). */
  time: number;
  lamps: Lamp[];
  flashlight: { base: number; level: number; target: number; since: number };
  storm: {
    seed: number; schedule: StormSchedule; flash: number; bolt: Bolt | null; intensity: number;
    /** Look tuning: a constant window light (intensity, side), or null for the storm. */
    hold: { intensity: number; side: 1 | -1 } | null;
    /** The event the other carriages' lights were last fitted to (they re-render once per event). */
    fitted: number | null;
    ambient: THREE.AmbientLight | null;
    ambientBase: number;
    /** This step's window light, for the SDF bodies' key (applyWindowKey). */
    dir: [number, number, number];
    color: [number, number, number];
  } | null;
  windowLights: Map<number, THREE.DirectionalLight>;
  /** The art's lamp and firebox glass, per room (found on the first step, after the light-list pass). */
  glass: Glass[] | null;
  shadowFrames: number;
  /** Each room's live light, 0..~1: its lamps' and fires' levels weighted by power. */
  roomLight: Map<number, number>;
  /** The carriage whose window light re-rendered its shadow this step, or null. */
  shadowRoom: number | null;
}

export function createDynamicLight(ctx: GameContext): DynamicLightRuntime {
  const def = ctx.world.level.def;
  const dark = !!def?.pickups.some(p => p.item === 'flashlight') && !new URLSearchParams(location.search).has('torch');
  const lamps: Lamp[] = ctx.lighting.flickerLights.map(f => ({
    light: f.light, bowl: f.bowl ?? null, base: f.base, mood: f.mood ?? 'steady', room: f.room ?? -1,
    seed: f.phase, script: null, level: 1,
  }));
  const rt: DynamicLightRuntime = {
    time: 0,
    lamps,
    flashlight: { base: ctx.lighting.flashlight.spot.intensity, level: dark ? 0 : 1, target: dark ? 0 : 1, since: -1 },
    storm: null,
    windowLights: new Map(),
    glass: null,
    shadowFrames: 0,
    shadowRoom: null,
    roomLight: new Map(),
  };
  // A level that starts dark idles the flashlight's two shadow maps until it is switched on.
  if (dark) {
    ctx.lighting.flashlight.spot.shadow.autoUpdate = false;
    ctx.lighting.flashlight.levelShadow.shadow.autoUpdate = false;
  }

  const train = ctx.world.train;
  if (train?.storm) {
    const seed = 1;
    rt.storm = { seed, schedule: stormSchedule(seed, STORM_HOURS * 3600), flash: 0, bolt: null, intensity: 0, hold: null, fitted: null, ambient: null, ambientBase: 0,
      dir: [...STORM.boltDir], color: [...STORM.boltColor] };
    const amb = ctx.boot.handle.scene.children.find(o => o instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined;
    // Doom 3 dark (owner, 2026-09-26): on a storm level the ambient floor is a third of the rig's.
    if (amb) { rt.storm.ambient = amb; rt.storm.ambientBase = amb.intensity * STORM_AMBIENT; }
    const group = new THREE.Group();
    group.name = 'train.window-lights';
    const rooms = new Set<number>();
    for (const w of train.windows) if (typeof w.userData.room === 'number') rooms.add(w.userData.room as number);
    for (const id of rooms) {
      const room = ctx.world.level.rooms.find(r => r.id === id);
      if (!room) continue;
      const l = new THREE.DirectionalLight(0xffffff, 0);
      l.name = `train.window-light:${id}`;
      l.castShadow = true;
      l.shadow.mapSize.set(WINDOW_SHADOW_SIZE, WINDOW_SHADOW_SIZE);
      l.shadow.bias = -0.0005;
      l.shadow.autoUpdate = false;
      l.userData.onlyRooms = new Set([id]);
      // The bodies' inflated shadow hulls, as the flashlight sees them: zombies throw shadows in a flash.
      l.shadow.camera.layers.enable(SHADOW_HULL_LAYER);
      fitWindowLight(l, room, IDLE_DIR);
      l.shadow.needsUpdate = true;   // one render at boot, so a stale map is never empty
      group.add(l, l.target);
      rt.windowLights.set(id, l);
    }
    ctx.boot.handle.scene.add(group);
  }
  ctx.world.light = rt;
  return rt;
}

type RoomBox = { id: number; minX: number; maxX: number; minZ: number; maxZ: number; height: number };

function fitWindowLight(l: THREE.DirectionalLight, room: RoomBox, dir: readonly [number, number, number]): void {
  const f = moonShadowFrame([dir[0], dir[1], dir[2]], room, 1);
  l.position.set(...f.position);
  l.target.position.set(...f.target);
  l.updateMatrixWorld();
  l.target.updateMatrixWorld();
  const cam = l.shadow.camera as THREE.OrthographicCamera;
  const e = Math.max(f.halfWidth, f.halfHeight);
  cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
  cam.near = f.near; cam.far = f.far;
  cam.updateProjectionMatrix();
}

/** The flashlight's brightness, 0..1 (1 on levels without a flashlight pickup). */
export function flashlightGate(ctx: GameContext): number {
  return ctx.world.light?.flashlight.level ?? 1;
}

/** The flashlight pickup: switch it on (a short stuttering ramp). */
export function switchOnFlashlight(ctx: GameContext): void {
  const rt = ctx.world.light;
  if (!rt || rt.flashlight.target === 1) return;
  rt.flashlight.target = 1;
  rt.flashlight.since = rt.time;
  ctx.lighting.flashlight.spot.shadow.autoUpdate = true;
  ctx.lighting.flashlight.levelShadow.shadow.autoUpdate = true;
}

/** A scripted lamp event for every lamp in a room (fires are left burning). */
export function runLightCommand(ctx: GameContext, mode: LightMode, room: number): void {
  const rt = ctx.world.light;
  if (!rt) return;
  for (const l of rt.lamps) if (l.room === room && l.mood !== 'fire') l.script = { mode, at: rt.time };
  ctx.telemetry.telemetry.event('light-command', { mode, room });
}

function torchLevel(rt: DynamicLightRuntime): number {
  const f = rt.flashlight;
  if (f.target === 0) return 0;
  if (f.since < 0) return 1;
  const a = rt.time - f.since;
  if (a >= TORCH_ON_S) return 1;
  // Two stutters on the way up: the bulb catching.
  if ((a > 0.06 && a < 0.1) || (a > 0.16 && a < 0.19)) return 0.15;
  return Math.min(1, a / TORCH_ON_S);
}

/** The art's lamp and firebox glass, cloned per room so each room's glass follows its own lamps. */
function findGlass(ctx: GameContext): Glass[] {
  const out: Glass[] = [];
  const owner = new Map<THREE.Material, number>();
  for (const o of (ctx.world.art?.objects ?? []) as THREE.Mesh[]) {
    const room = o.userData.room;
    let mat = o.material as THREE.MeshStandardMaterial;
    if (typeof room !== 'number' || Array.isArray(o.material) || !mat) continue;
    const kind = mat.name === 'train.lamp' ? 'lamp' : mat.name === 'train.firebox' ? 'fire' : null;
    if (!kind) continue;
    const seen = owner.get(mat);
    if (seen !== undefined && seen !== room) {
      mat = mat.clone();
      o.material = mat;
    }
    owner.set(mat, room);
    if (!out.some(g => g.mat === mat)) out.push({ room, mat, base: mat.emissiveIntensity, kind });
  }
  return out;
}

/** Per sim step: lamp levels, the flashlight's switch, the storm's window lights. */
export function stepDynamicLight(ctx: GameContext, dt: number): void {
  const rt = ctx.world.light;
  if (!rt) return;
  if (!ctx.lighting.clockFrozen) rt.time += dt;
  const t = rt.time;

  const sum = new Map<string, { n: number; v: number }>();
  for (const l of rt.lamps) {
    l.level = lampLevel(l.mood, l.script, t, l.seed);
    l.light.intensity = l.base * l.level;
    if (l.bowl) l.bowl.emissiveIntensity = BOWL_EMISSIVE * l.level;
    const key = `${l.room}:${l.mood === 'fire' ? 'fire' : 'lamp'}`;
    const s = sum.get(key) ?? { n: 0, v: 0 };
    s.n++; s.v += l.level;
    sum.set(key, s);
  }
  const acc = new Map<number, { w: number; v: number }>();
  for (const l of rt.lamps) {
    const a = acc.get(l.room) ?? { w: 0, v: 0 };
    a.w += l.base; a.v += l.base * Math.min(1, l.level);
    acc.set(l.room, a);
  }
  for (const [room, a] of acc) rt.roomLight.set(room, a.w > 0 ? a.v / a.w : 1);
  rt.glass ??= findGlass(ctx);
  for (const g of rt.glass) {
    const s = sum.get(`${g.room}:${g.kind}`);
    g.mat.emissiveIntensity = g.base * (s ? Math.min(1, s.v / s.n) : 1);
  }

  rt.flashlight.level = torchLevel(rt);

  rt.shadowRoom = null;
  const storm = rt.storm;
  const train = ctx.world.train;
  if (storm) {
    const w = storm.hold
      ? { intensity: storm.hold.intensity, color: [...STORM.boltColor] as [number, number, number], dir: [storm.hold.side * STORM.boltDir[0], STORM.boltDir[1], STORM.boltDir[2]] as [number, number, number], bolt: null, flash: 0, event: -1 }
      : windowLightAt(storm.schedule, t);
    storm.flash = w.flash;
    storm.bolt = w.bolt;
    storm.intensity = w.intensity;
    storm.dir = [...w.dir];
    storm.color = [...w.color];
    for (const l of rt.windowLights.values()) {
      l.color.setRGB(w.color[0], w.color[1], w.color[2]);
      l.intensity = w.intensity;
    }
    if (storm.ambient) storm.ambient.intensity = storm.ambientBase + STORM.bounce * w.intensity;
    if (w.intensity > 0.02) {
      const [px, , pz] = ctx.player.player.pos;
      const id = roomIdAt(ctx, px, pz);
      // The player's carriage follows the light every step (a sweep swings); the others are
      // fitted once per event, so every carriage is lit from the right side.
      const refitAll = w.event !== storm.fitted;
      storm.fitted = w.event;
      for (const [rid, l] of rt.windowLights) {
        if (rid !== id && !refitAll) continue;
        const room = ctx.world.level.rooms.find(r => r.id === rid);
        if (!room) continue;
        fitWindowLight(l, room, w.dir);
        l.shadow.needsUpdate = true;
        rt.shadowFrames++;
        if (rid === id) rt.shadowRoom = id;
      }
    }
    if (train?.storm) {
      train.storm.flash.value = w.flash;
      const b = w.bolt;
      if (b) train.storm.bolt.value.set(b.side, b.z, b.seed, t - b.t);
      else train.storm.bolt.value.set(0, 0, 0, 0);
    }
  }
}

/** How hard the window light drives an SDF body's key, per unit of window-light intensity
 *  (the key is lightCfg.x × spotCfg2.z in the dungeon; the beam's own gain is 4). */
const BODY_WINDOW_GAIN = 0.1;
const bodyBase = new WeakMap<object, { dir: THREE.Vector3; color: THREE.Color }>();

type KeyUniforms = { lightDir?: { value: THREE.Vector3 }; keyColor?: { value: THREE.Color }; spotCfg2: { value: THREE.Vector4 } };

/** The SDF bodies shade in the march and never see the window light: during a flash or a
 *  sweep, turn their key toward it and raise its floor; restore the preset key after. Call
 *  after spotCfg2 is written for the frame. */
export function applyWindowKey(ctx: GameContext, u: KeyUniforms): void {
  const s = ctx.world.light?.storm;
  if (!u.lightDir || !u.keyColor) return;
  const k = s ? s.intensity * BODY_WINDOW_GAIN : 0;
  let base = bodyBase.get(u);
  if (k > 0 && s) {
    if (!base) { base = { dir: u.lightDir.value.clone(), color: u.keyColor.value.clone() }; bodyBase.set(u, base); }
    u.lightDir.value.set(s.dir[0], s.dir[1], s.dir[2]);
    u.keyColor.value.setRGB(s.color[0], s.color[1], s.color[2]);
    u.spotCfg2.value.z += k;
  } else if (base) {
    u.lightDir.value.copy(base.dir);
    u.keyColor.value.copy(base.color);
    bodyBase.delete(u);
  }
}

/** How much of a body's baked fill survives when its room's lamps are all out (Doom 3 dark). */
const BODY_DARK_FLOOR = 0.06;
const fillBase = new WeakMap<object, { fill: number; gain: number; wroteFill: number; wroteGain: number }>();

type FillUniforms = { lightCfg?: { value: { y: number } }; probeCfg?: { value: { y: number } } };

/** A body's fill (the flat fill and the room-probe gain, both baked with every lamp at full
 *  power) follows its room's live lamps: dark when they die, flickering when they flicker.
 *  Re-bases whenever something else rewrites the uniforms (a room change re-binds probes). */
export function applyRoomFill(ctx: GameContext, u: FillUniforms, x: number, z: number): void {
  const rt = ctx.world.light;
  if (!rt || !u.lightCfg || !u.probeCfg) return;
  const room = roomIdAt(ctx, x, z);
  const lit = rt.roomLight.get(room) ?? 1;
  const f = BODY_DARK_FLOOR + (1 - BODY_DARK_FLOOR) * lit;
  let b = fillBase.get(u);
  const lc = u.lightCfg.value, pc = u.probeCfg.value;
  if (!b || lc.y !== b.wroteFill) { b = { fill: lc.y, gain: b?.gain ?? pc.y, wroteFill: lc.y, wroteGain: b?.wroteGain ?? pc.y }; fillBase.set(u, b); }
  if (pc.y !== b.wroteGain) { b.gain = pc.y; }
  lc.y = b.fill * f;
  pc.y = b.gain * f;
  b.wroteFill = lc.y;
  b.wroteGain = pc.y;
}

/** Seams: `__sdfGame.lights()`, `setFlashlight(on)`, `forceBolt(side)`, `forceSweep(side)`, `lightCommand(mode, room)`. */
export function createDynamicLightSeams(ctx: GameContext) {
  const insert = <T extends { t: number }>(list: T[], item: T) => {
    list.push(item);
    list.sort((a, b) => a.t - b.t);
  };
  return {
    lights: () => {
      const rt = ctx.world.light;
      if (!rt) return null;
      const next = (list: readonly { t: number }[]) => list.find(e => e.t > rt.time)?.t ?? null;
      return {
        time: rt.time,
        flashlight: rt.flashlight.level,
        spotIntensity: ctx.lighting.flashlight.spot.intensity,
        lamps: rt.lamps.map(l => ({ room: l.room, mood: l.mood, level: l.level, script: l.script?.mode ?? null, intensity: l.light.intensity })),
        windowLights: [...rt.windowLights.keys()],
        windowIntensity: rt.storm?.intensity ?? 0,
        flash: rt.storm?.flash ?? 0,
        shadowFrames: rt.shadowFrames,
        shadowRoom: rt.shadowRoom,
        roomLight: Object.fromEntries(rt.roomLight),
        glass: rt.glass?.length ?? null,
        nextBolt: rt.storm ? next(rt.storm.schedule.bolts) : null,
        nextSweep: rt.storm ? next(rt.storm.schedule.sweeps) : null,
      };
    },
    setFlashlight: (on: boolean) => {
      const rt = ctx.world.light;
      if (!rt) return null;
      if (on) switchOnFlashlight(ctx);
      else { rt.flashlight.target = 0; rt.flashlight.level = 0; }
      return rt.flashlight.target;
    },
    forceBolt: (side: 1 | -1 = 1, z = 0) => {
      const rt = ctx.world.light;
      if (!rt?.storm) return null;
      insert(rt.storm.schedule.bolts, { t: rt.time + 1e-3, side, z, seed: 4242 });
      return rt.time;
    },
    forceSweep: (side: 1 | -1 = 1) => {
      const rt = ctx.world.light;
      if (!rt?.storm) return null;
      insert(rt.storm.schedule.sweeps, { t: rt.time + 1e-3, side });
      return rt.time;
    },
    lightCommand: (mode: LightMode, room: number) => { runLightCommand(ctx, mode, room); },
    /** Look tuning: hold the window light at an intensity from one side (null: back to the storm). */
    holdWindowLight: (intensity: number | null, side: 1 | -1 = 1, shadow = 1) => {
      const rt = ctx.world.light;
      if (!rt?.storm) return null;
      for (const l of rt.windowLights.values()) l.shadow.intensity = shadow;
      rt.storm.hold = intensity === null ? null : { intensity, side };
      return rt.storm.hold;
    },
    windowLightInfo: () => {
      const rt = ctx.world.light;
      if (!rt) return null;
      return [...rt.windowLights.entries()].map(([room, l]) => ({
        room, intensity: l.intensity, pos: l.position.toArray().map(v => +v.toFixed(2)),
        target: l.target.position.toArray().map(v => +v.toFixed(2)), map: !!l.shadow.map,
        lists: [...ctx.world.levelLightLists.entries()].filter(([, n]) => (n as unknown as { getLights?: () => THREE.Light[] }).getLights?.().includes(l)).map(([r]) => r),
      }));
    },
  };
}
