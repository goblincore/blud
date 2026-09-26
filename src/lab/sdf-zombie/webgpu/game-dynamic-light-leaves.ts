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
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, normalWorld, positionLocal, positionWorld, uniform, vec3, vec4, wgslFn } from 'three/tsl';
import { lampSwing } from './train-motion';
import { STORM_HASH, STORM_NOISE } from './train-window.wgsl';
import { TUBE_BEAM_WGSL } from './tube-beam.wgsl';
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

/** A fluorescent tube's overhead cone (owner, 2026-09-26): a hard downward spot that swings with
 *  the train and casts the zombies' shadows, and a dusty beam mesh under it. */
interface Tube {
  spot: THREE.SpotLight;
  mesh: THREE.Mesh | null;
  beam: THREE.Mesh;
  beamLit: { value: THREE.Vector4 };
  /** The tube's rest position (the spot sits just under it). */
  pos: THREE.Vector3;
  drop: number;
}

interface Lamp {
  light: THREE.PointLight;
  tube: Tube | null;
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
    /** The screen grade's afterglow: the bolt's envelope with a slow release. */
    grade: number;
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
  /** Steps since boot, for the tube shadows' half-rate update. */
  shadowTick: number;
  /** The carriage whose window light re-rendered its shadow this step, or null. */
  shadowRoom: number | null;
}

export function createDynamicLight(ctx: GameContext): DynamicLightRuntime {
  const def = ctx.world.level.def;
  const dark = !!def?.pickups.some(p => p.item === 'flashlight') && !new URLSearchParams(location.search).has('torch');
  const tubeGroup = new THREE.Group();
  tubeGroup.name = 'train.tube-spots';
  const lamps: Lamp[] = ctx.lighting.flickerLights.map(f => ({
    light: f.light, bowl: f.bowl ?? null, base: f.base, mood: f.mood ?? 'steady', room: f.room ?? -1,
    seed: f.phase, script: null, level: 1,
    tube: f.fixture === 'tube' && new URLSearchParams(location.search).get('tubes') !== '0' ? makeTube(ctx, f.light, f.bowlMesh ?? null, f.room ?? -1, tubeGroup) : null,
  }));
  if (tubeGroup.children.length > 0) ctx.boot.handle.scene.add(tubeGroup);
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
    shadowTick: 0,
  };
  // A level that starts dark idles the flashlight's two shadow maps until it is switched on.
  if (dark) {
    ctx.lighting.flashlight.spot.shadow.autoUpdate = false;
    ctx.lighting.flashlight.levelShadow.shadow.autoUpdate = false;
  }

  const train = ctx.world.train;
  if (train?.storm) {
    const seed = 1;
    rt.storm = { seed, schedule: stormSchedule(seed, STORM_HOURS * 3600), flash: 0, bolt: null, intensity: 0, hold: null, fitted: null, ambient: null, ambientBase: 0, grade: 0,
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

/** Tube cone tuning. The spot is the tube's main light; the omni stays as ceiling spill. */
const TUBE = {
  /** Half-angle (rad): ~3.3 m across at the floor under a 2.4 m drop, a pool per tube. */
  angle: 0.6, penumbra: 0.25, decay: 1.2,
  /** Spot intensity per unit of the lamp's power; the omni's share of it as spill. */
  spotGain: 7, spill: 0.2,
  /** Swing: the train's lamp swing, amplified for a tube on chains. */
  swing: 2.2,
  /** Hard, low-res shadows (owner): the zombies' hulls and the art. */
  shadowSize: 512,
  /** The dusty beam's strength. */
  beam: 0.035,
} as const;

let beamFn: ReturnType<typeof wgslFn> | null = null;

function makeTube(ctx: GameContext, light: THREE.PointLight, mesh: THREE.Mesh | null, room: number, group: THREE.Group): Tube {
  const pos = light.position.clone();
  const roomDef = ctx.world.level.rooms.find(r => r.id === room);
  const drop = Math.max(1.5, (roomDef ? roomDef.height : 2.8) - 0.4 + 0.2);
  const spot = new THREE.SpotLight(light.color.clone(), 0, drop * 2.2, TUBE.angle, TUBE.penumbra, TUBE.decay);
  spot.name = `train.tube-spot:${room}`;
  spot.position.set(pos.x, pos.y - 0.06, pos.z);
  spot.target.position.set(pos.x, pos.y - 3, pos.z);
  spot.castShadow = true;                         // decided at boot, never toggled
  spot.shadow.mapSize.set(TUBE.shadowSize, TUBE.shadowSize);
  spot.shadow.bias = -0.001;
  spot.shadow.radius = 1;
  spot.shadow.autoUpdate = false;
  spot.shadow.needsUpdate = true;                 // one render at boot
  spot.shadow.camera.near = 0.15;
  spot.shadow.camera.far = drop * 2.2;
  spot.shadow.camera.layers.enable(SHADOW_HULL_LAYER);
  spot.userData.onlyRooms = new Set([room]);
  group.add(spot, spot.target);
  // The beam: an open cone, apex at the tube, pointing down; drawn after the bodies.
  const r = Math.tan(TUBE.angle) * drop;
  const geo = new THREE.ConeGeometry(r, drop, 24, 1, true).translate(0, -drop / 2, 0);
  const lit = uniform(new THREE.Vector4(1, drop, TUBE.beam, 0));
  const col = uniform(new THREE.Color(light.color));
  if (!beamFn) {
    type Include = NonNullable<Parameters<typeof wgslFn>[1]>[number];
    const hashFn = wgslFn(STORM_HASH) as unknown as Include;
    beamFn = wgslFn(TUBE_BEAM_WGSL, [hashFn, wgslFn(STORM_NOISE, [hashFn]) as unknown as Include]);
  }
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = vec4(beamFn({ local: positionLocal, wpos: positionWorld, n: normalWorld, eye: cameraPosition, t: rtTime, cfg: lit, color: col }) as unknown as ReturnType<typeof vec3>, 1);
  mat.transparent = true; mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.fog = false;
  mat.name = 'train.tube-beam';
  const beam = new THREE.Mesh(geo, mat);
  beam.name = `train.tube-beam:${room}`;
  beam.position.copy(pos);
  beam.frustumCulled = true;   // its bounds cover the small swing; off-screen carriages skip it
  beam.userData.skipLevelLights = true;
  ctx.boot.handle.scene.add(beam);                // moved to the late-effects scene by adoptLightFx
  return { spot, mesh, beam, beamLit: lit as unknown as { value: THREE.Vector4 }, pos, drop };
}

/** Shared clock for the beams' drifting dust (sim seconds). */
const rtTime = uniform(0);

/** Once the SDF layer exists: the beams draw after the bodies (sdf-layer lateScene). */
export function adoptLightFx(ctx: GameContext): void {
  const late = ctx.render.sdfLayer?.lateScene;
  if (!late) return;
  for (const l of ctx.world.light?.lamps ?? []) if (l.tube) late.add(l.tube.beam);
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
    if (!out.some(g => g.mat === mat)) {
      out.push({ room, mat, base: mat.emissiveIntensity, kind });
      // The glass glows the colour of its room's lamps (the cold tubes on Night Train).
      const lamp = kind === 'lamp' ? ctx.world.light?.lamps.find(l => l.room === room && l.mood !== 'fire') : null;
      if (lamp && mat.emissive) mat.emissive.copy(lamp.light.color);
    }
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
  (rtTime as unknown as { value: number }).value = t;
  rt.shadowTick++;
  // The viewmodel (hands, gun, dynamite, flare) casts no shadow: under a tube it threw a big dark
  // hands-and-gun shape on the floor in front of the player (owner, 2026-09-26). Re-applied each
  // step because weapons load and swap; a small tree.
  if (rt.lamps.some(l => l.tube)) {
    for (const g of [ctx.weapon.aimRig, ctx.weapon.gunRig, ctx.weapon.gunGroup]) g?.traverse(o => { o.castShadow = false; });
  }
  const [ppx, , ppz] = ctx.player.player.pos;
  const here = roomIdAt(ctx, ppx, ppz);
  const speed = ctx.world.train?.speed ?? 0;
  for (const l of rt.lamps) {
    l.level = lampLevel(l.mood, l.script, t, l.seed);
    l.light.intensity = l.base * l.level * (l.tube ? TUBE.spill : 1);
    if (l.tube) {
      const tb = l.tube;
      tb.spot.intensity = l.base * TUBE.spotGain * l.level;
      tb.beamLit.value.x = l.level;
      // Swing along the train (x-axis rotation), the tube, its cone and its beam together.
      const a = lampSwing(t, speed, l.seed) * TUBE.swing;
      tb.spot.target.position.set(tb.pos.x, tb.pos.y - 3 * Math.cos(a), tb.pos.z + 3 * Math.sin(a));
      tb.spot.target.updateMatrixWorld();
      tb.beam.rotation.x = a;
      if (tb.mesh) tb.mesh.rotation.x = a;
      // Hard shadows, live only in the player's carriage (the zombies move, the tube swings).
      // Every other step (half-rate: the zombies move slowly enough; the cost is ~2 shadow passes).
      if (l.room === here && l.level > 0 && (rt.shadowTick & 1) === 0) tb.spot.shadow.needsUpdate = true;
    }
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
    storm.grade = Math.max(w.flash, storm.grade * Math.exp(-dt / STORM.grade.releaseS));
    if (storm.grade < 1e-3) storm.grade = 0;
    ctx.render.postAa?.setFlashGrade(w.flash, storm.grade, STORM.grade.punch, STORM.grade.crush);
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
const BODY_WINDOW_GAIN = 0.035;
/** A lamp's key on a body per unit of its power × level / d² (the lamps model the zombies). */
const BODY_LAMP_GAIN = 1.5;
/** The flat fill's colour on a storm level when no lamp or flash keys the body. */
const COLD_FILL: [number, number, number] = [0.62, 0.74, 1.0];
/** And the rim a lamp adds, per unit of that key. */
const BODY_LAMP_RIM = 0.35;
const lampTmp = { dir: new THREE.Vector3(), color: new THREE.Color(), k: 0, back: 0 };

/** THE LAMPS PRESENT THE ZOMBIES (owner, 2026-09-26: "more of screenshot 2" — a body lit from the
 *  front-side reads as modeled, a body straight under a tube lit only on its crown reads dark).
 *  Strength is the room's live lamp level (the light reaches past the visible cone), colour the
 *  lamp's; direction is a three-quarter key from above and from the viewer's side, blended with the
 *  real direction to the brightest lamp so bodies still differ. Flicker, blackouts and strobes ride
 *  the room level. */
const PRESENT = { gain: 1.3, viewBias: 0.3, floor: 0.18, edge: 1.25, distFall: 0.06, backKey: 0.35, backRim: 2.5 } as const;
const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3();
function presentingLamp(ctx: GameContext, at: readonly [number, number, number]): typeof lampTmp | null {
  const rt = ctx.world.light;
  if (!rt) return null;
  const room = roomIdAt(ctx, at[0], at[2]);
  // THE CONE DECIDES (owner, 2026-09-26: "it should be within the light cone ... the falloff should
  // happen quicker ... more directional and respect the position of the light"). The tube whose cone
  // best covers the body's chest keys it: full inside the cone, a quick fall past its edge and with
  // distance, down to a small floor while the lamp is lit (never pitch black).
  const chestY = at[1] + 1.2;
  let best: Lamp | null = null, bestK = 0;
  for (const l of rt.lamps) {
    if (l.room !== room || l.level <= 0 || l.mood === 'fire') continue;
    const p = l.light.position;
    const dx = at[0] - p.x, dy = chestY - p.y, dz = at[2] - p.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    let cover = 1;
    if (l.tube) {
      // Coverage is judged at the FEET, where the player sees the pool: at the chest the cone is
      // only ~1 m across, so a body walking through the visible pool was mostly "outside" it.
      const fy = at[1] + 0.2 - p.y, fd = Math.hypot(dx, fy, dz) || 1;
      const cosA = -fy / fd;   // the cone points straight down
      const inner = Math.cos(TUBE.angle * (1 - TUBE.penumbra)), outer = Math.cos(TUBE.angle * PRESENT.edge);
      const t = Math.min(1, Math.max(0, (cosA - outer) / Math.max(1e-4, inner - outer)));
      cover = t * t * (3 - 2 * t);
    }
    const k = l.level * (PRESENT.floor + (1 - PRESENT.floor) * cover) / (1 + PRESENT.distFall * d * d);
    if (k > bestK) { bestK = k; best = l; }
  }
  if (!best) return null;
  const cam = ctx.boot.handle.camera;
  const bp = best.light.position;
  const toLamp = new THREE.Vector3(bp.x - at[0], bp.y - chestY, bp.z - at[2]).normalize();
  // Mostly the tube's real direction; a little of the viewer's side so a chest facing the player
  // is not left black when the tube is overhead.
  const toView = new THREE.Vector3(cam.position.x - at[0], 0, cam.position.z - at[2]).normalize();
  const dir = toLamp.clone().lerp(toView.add(new THREE.Vector3(0, 0.5, 0)).normalize(), PRESENT.viewBias).normalize();
  lampTmp.dir.copy(dir);
  lampTmp.color.copy(best.light.color);
  // FALLOFF BY FACING: a tube behind the body (away from the viewer) drops the front key and lets the
  // back-light rim carry the edge.
  const tl = Math.hypot(toLamp.x, toLamp.z) || 1;
  const facing = ((toLamp.x * toView.x + toLamp.z * toView.z) / tl + 1) / 2;
  const back = 1 - facing;
  lampTmp.k = bestK * PRESENT.gain * (1 - back * (1 - PRESENT.backKey));
  lampTmp.back = back;
  return lampTmp;
}

/** The brightest lamp on a point in its room (power × level / d², d at least 1 m): its direction
 *  from the point and colour. Fires count too (the firebox models the Stoker). */
function strongestLamp(ctx: GameContext, at: readonly [number, number, number]): typeof lampTmp | null {
  const rt = ctx.world.light;
  if (!rt) return null;
  const room = roomIdAt(ctx, at[0], at[2]);
  let best: Lamp | null = null, bestK = 0;
  for (const l of rt.lamps) {
    if (l.room !== room || l.level <= 0) continue;
    const p = l.light.position;
    const d2 = Math.max(1, (p.x - at[0]) ** 2 + (p.y - at[1] - 1.2) ** 2 + (p.z - at[2]) ** 2);
    // A fire keys a body only up close (the firebox and the Stoker); across a carriage the cold
    // tubes model the zombies, not a stove's orange.
    if (l.mood === 'fire' && d2 > 9) continue;
    const k = l.base * l.level / d2;
    if (k > bestK) { bestK = k; best = l; }
  }
  if (!best) return null;
  const p = best.light.position;
  lampTmp.dir.set(p.x - at[0], p.y - at[1] - 1.2, p.z - at[2]).normalize();
  lampTmp.color.copy(best.light.color);
  lampTmp.k = bestK;
  return lampTmp;
}
/** The lightning side rim's strength per unit of window-light intensity (compose.wgsl.ts). */
const BODY_RIM_GAIN = 0.4;
const bodyBase = new WeakMap<object, { dir: THREE.Vector3; color: THREE.Color }>();

type KeyUniforms = { lightDir?: { value: THREE.Vector3 }; keyColor?: { value: THREE.Color }; spotCfg2: { value: THREE.Vector4 } };

/** The SDF bodies shade in the march and never see the window light: during a flash or a
 *  sweep, turn their key toward it and raise its floor; restore the preset key after. Call
 *  after spotCfg2 is written for the frame. */
export function applyWindowKey(ctx: GameContext, u: KeyUniforms, at?: readonly [number, number, number]): void {
  const s = ctx.world.light?.storm;
  if (!u.lightDir || !u.keyColor) return;
  const kw = s ? s.intensity * BODY_WINDOW_GAIN : 0;
  const lamp = at ? presentingLamp(ctx, at) : null;
  const kl = lamp ? lamp.k * BODY_LAMP_GAIN : 0;
  let base = bodyBase.get(u);
  if (s || kw + kl > 0) {
    if (!base) { base = { dir: u.lightDir.value.clone(), color: u.keyColor.value.clone() }; bodyBase.set(u, base); }
    // The stronger source sets the direction (a flash beats a lamp; a lamp models the body
    // between flashes, so it never reads as a flat silhouette — owner, 2026-09-26).
    if (s && kw >= kl) {
      u.lightDir.value.set(s.dir[0], s.dir[1], s.dir[2]);
      u.keyColor.value.setRGB(s.color[0], s.color[1], s.color[2]);
    } else if (lamp) {
      u.lightDir.value.copy(lamp.dir);
      u.keyColor.value.copy(lamp.color);
    } else {
      // Nothing lit nearby on a storm level: the fill that keeps the body readable is cold (the
      // preset's key colour is a warm practical, which turned every zombie orange in the dark).
      u.keyColor.value.setRGB(COLD_FILL[0], COLD_FILL[1], COLD_FILL[2]);
    }
    u.spotCfg2.value.z += kw + kl;
    u.spotCfg2.value.w = (s ? s.intensity * BODY_RIM_GAIN : 0) + kl * BODY_LAMP_RIM * (1 + (lamp?.back ?? 0) * PRESENT.backRim);
  } else if (base) {
    u.lightDir.value.copy(base.dir);
    u.keyColor.value.copy(base.color);
    bodyBase.delete(u);
  }
}

/** At spawn on a storm level: the body's base key colour is the cold fill. */
export function applyStormBodyKey(ctx: GameContext, u: { keyColor: { value: THREE.Color } }): void {
  if (!ctx.world.light?.storm) return;
  u.keyColor.value.setRGB(COLD_FILL[0], COLD_FILL[1], COLD_FILL[2]);
}

/** How much of a body's baked fill survives when its room's lamps are all out (Doom 3 dark). */
const BODY_DARK_FLOOR = 0.25;
/** On a storm level the room probes (baked with the stoves and fires) weigh this much against the
 *  cold flat fill, so the dark reads cold, not orange. */
const STORM_PROBE_WEIGHT = 0.35;
const fillBase = new WeakMap<object, { fill: number; gain: number; wroteFill: number; wroteGain: number }>();

type FillUniforms = { lightCfg?: { value: { y: number } }; probeCfg?: { value: { x: number; y: number } } };

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
  if (rt.storm) pc.x = Math.min(pc.x, STORM_PROBE_WEIGHT);
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
        lamps: rt.lamps.map(l => ({ room: l.room, mood: l.mood, level: l.level, script: l.script?.mode ?? null, scriptAt: l.script?.at ?? null, intensity: l.light.intensity })),
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
