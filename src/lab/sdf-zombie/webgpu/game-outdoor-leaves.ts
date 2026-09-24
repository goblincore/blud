// src/lab/sdf-zombie/webgpu/game-outdoor-leaves.ts
//
// OUTDOOR v1 in the game (spec docs/superpowers/specs/2026-09-23-outdoor-v1-design.md
// §6, §7): the moon DirectionalLight and its room-fitted shadow, the sky dome
// (hand-written WGSL in sky.wgsl.ts), the skyline bands, and the fog blend across
// doorways. The decisions are pure (outdoor-light.ts, outdoor-presets.ts); this
// leaf only writes three objects. A level with no open-sky room (the ring) gets
// null and nothing is added to the scene.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, normalize, positionWorld, smoothstep, texture, uniform, uv, vec2, vec3, vec4, wgslFn } from 'three/tsl';
import { edgeTexture, groundTexture, skylineTexture } from '../../../game/level/outdoor-textures';
import { DUNGEON_RIG, GALLERY_RIG } from './dungeon-lighting';
import type { GameContext } from './game-context';
import type { LevelRoom } from './level-def';
import { blendFog, moonRoomIds, moonShadowFrame, outdoorRoomAt, type Fog } from './outdoor-light';
import {
  EDGE_PRESETS, GROUND_PRESETS, SKYLINE_PRESETS, SKY_PRESETS, skylineLayerColor,
  type EdgeStyle, type GroundName, type SkyPreset,
} from './outdoor-presets';
import { SKY_COLOR } from './sky.wgsl';

/** How far outside an open room's rectangle still counts as "outdoors" (a doorway). */
const OUTDOOR_REACH_M = 3;
/** Fog crossfade time across a doorway, seconds. */
const FOG_BLEND_S = 1.0;
const MOON_SHADOW_SIZE = 2048;
const DEG = Math.PI / 180;

export interface OutdoorRuntime {
  /** A live copy of the level's sky preset; the tuning seams write it. */
  preset: SkyPreset;
  moon: THREE.DirectionalLight;
  dome: THREE.Mesh;
  skyline: THREE.Group;
  uniforms: {
    zenith: { value: THREE.Vector3 }; horizon: { value: THREE.Vector3 }; band: { value: THREE.Vector3 };
    moonDir: { value: THREE.Vector3 }; moonColor: { value: THREE.Vector3 }; moonCfg: { value: THREE.Vector4 };
    cloudColor: { value: THREE.Vector3 }; cloudUnder: { value: THREE.Vector3 }; cloudCfg: { value: THREE.Vector4 };
  };
  /** 0 = indoor fog, 1 = the sky's fog. */
  fogT: number;
  /** The open room the moon's shadow is fitted to, or null (map idle). */
  activeRoom: number | null;
  /** Frames the moon shadow map has rendered; the gate reads it. */
  shadowFrames: number;
  /** True when the map was asked to render this frame. */
  shadowLive: boolean;
}

const skyRooms = (ctx: GameContext) => (ctx.world.level.rooms as readonly Partial<LevelRoom>[]).filter(r => r.sky) as LevelRoom[];

/** The sky preset the level uses: the first open room's (v1 levels use one). */
function levelSky(ctx: GameContext): SkyPreset | null {
  const r = skyRooms(ctx)[0];
  return r?.sky ? SKY_PRESETS[r.sky] : null;
}

function writeUniforms(rt: OutdoorRuntime): void {
  const s = rt.preset, u = rt.uniforms;
  u.zenith.value.set(...s.zenith); u.horizon.value.set(...s.horizon); u.band.value.set(...s.band);
  u.moonDir.value.set(...s.moon.dir); u.moonColor.value.set(...s.moon.color);
  u.moonCfg.value.set(Math.cos(s.moon.discDeg * DEG), Math.cos(s.moon.discDeg * 0.85 * DEG), s.moon.intensity,
    1 / Math.max(1e-4, 1 - Math.cos(s.moon.haloDeg * DEG)));
  u.cloudColor.value.set(...s.cloud.color); u.cloudUnder.value.set(...s.cloud.underlit);
  u.cloudCfg.value.set(s.cloud.cover, s.stars, 0, 0);
  rt.moon.color.setRGB(...s.moon.color);
  rt.moon.intensity = s.moon.intensity;
}

/** Build the moon, dome and skyline for a level with open-sky rooms; null otherwise.
 *  Call once at boot, BEFORE the level's per-room light lists are built, so the moon
 *  is in them (restricted to open rooms by `userData.onlyRooms`). */
export function createOutdoor(ctx: GameContext): OutdoorRuntime | null {
  const sky = levelSky(ctx);
  if (!sky) return null;
  const scene = ctx.boot.handle.scene;
  const preset: SkyPreset = JSON.parse(JSON.stringify(sky));

  // The moon. castShadow is decided HERE and never toggled (three r185/r186: a live
  // toggle resets the ShadowNode and updateBefore then reads a null shadowMap).
  // The map idles via autoUpdate=false; stepOutdoor asks for a render while outdoors.
  const moon = new THREE.DirectionalLight(0xffffff, 1);
  moon.name = 'outdoor.moon';
  moon.castShadow = true;
  moon.shadow.mapSize.set(MOON_SHADOW_SIZE, MOON_SHADOW_SIZE);
  moon.shadow.autoUpdate = false;
  moon.shadow.needsUpdate = false;
  moon.shadow.bias = -0.0005;
  moon.userData.onlyRooms = moonRoomIds(skyRooms(ctx));
  scene.add(moon, moon.target);

  const u = {
    zenith: uniform(new THREE.Vector3()), horizon: uniform(new THREE.Vector3()), band: uniform(new THREE.Vector3()),
    moonDir: uniform(new THREE.Vector3()), moonColor: uniform(new THREE.Vector3()), moonCfg: uniform(new THREE.Vector4()),
    cloudColor: uniform(new THREE.Vector3()), cloudUnder: uniform(new THREE.Vector3()), cloudCfg: uniform(new THREE.Vector4()),
  };
  const skyFn = wgslFn(SKY_COLOR);
  const domeMat = new MeshBasicNodeMaterial();
  // wgslFn's result is an untyped Node; SKY_COLOR returns vec3<f32>.
  domeMat.colorNode = vec4(skyFn({
    dir: normalize(positionWorld.sub(cameraPosition)),
    zenith: u.zenith, horizon: u.horizon, band: u.band,
    moonDir: u.moonDir, moonColor: u.moonColor, moonCfg: u.moonCfg,
    cloudColor: u.cloudColor, cloudUnder: u.cloudUnder, cloudCfg: u.cloudCfg,
  }) as unknown as ReturnType<typeof vec3>, 1.0);
  domeMat.side = THREE.BackSide;
  domeMat.depthWrite = false;
  domeMat.fog = false;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), domeMat);
  dome.name = 'outdoor.sky';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  // Skyline: silhouette bands on open cylinders around the level, nearest first.
  const skyline = new THREE.Group();
  skyline.name = 'outdoor.skyline';
  const sl = ctx.world.level.surfaces.skyline;
  if (sl) {
    const cx = (sl.min[0] + sl.max[0]) / 2, cz = (sl.min[1] + sl.max[1]) / 2;
    const half = Math.hypot(sl.max[0] - sl.min[0], sl.max[1] - sl.min[1]) / 2;
    const layers = SKYLINE_PRESETS[sl.preset].layers;
    layers.forEach((layer, i) => {
      const tex = skylineTexture(SKYLINE_PRESETS[sl.preset].shape, layer.roughness, layer.seed);
      tex.repeat.set(4, 1);
      const col = skylineLayerColor(preset, i, layers.length);
      const mat = new MeshBasicNodeMaterial();
      const a = texture(tex, uv().mul(vec2(tex.repeat.x, tex.repeat.y))).a;
      mat.colorNode = vec4(col[0], col[1], col[2], a);
      mat.transparent = true;
      mat.depthWrite = false;
      mat.side = THREE.BackSide;
      mat.fog = false;
      const r = half + layer.distance;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, layer.height, 96, 1, true), mat);
      band.position.set(cx, layer.height / 2 - 0.5, cz);
      band.renderOrder = -900 + i;
      band.frustumCulled = false;
      skyline.add(band);
    });
  }
  scene.add(skyline);

  const rt: OutdoorRuntime = {
    preset, moon, dome, skyline, uniforms: u as unknown as OutdoorRuntime['uniforms'],
    fogT: 0, activeRoom: null, shadowFrames: 0, shadowLive: false,
  };
  writeUniforms(rt);
  return rt;
}

/** Per frame: fit the moon's shadow to the open room the player is in (or at the door
 *  of), idle it otherwise; follow the camera with the dome; blend the fog. */
export function stepOutdoor(ctx: GameContext, dt: number): void {
  const rt = ctx.lighting.outdoor;
  if (!rt) return;
  const [px, , pz] = ctx.player.player.pos;
  const room = outdoorRoomAt(skyRooms(ctx), px, pz, OUTDOOR_REACH_M);
  rt.shadowLive = false;
  if (room) {
    const f = moonShadowFrame(rt.preset.moon.dir, room, 2);
    rt.moon.position.set(...f.position);
    rt.moon.target.position.set(...f.target);
    rt.moon.target.updateMatrixWorld();
    const cam = rt.moon.shadow.camera as THREE.OrthographicCamera;
    const e = Math.max(f.halfWidth, f.halfHeight);
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
    cam.near = f.near; cam.far = f.far;
    cam.updateProjectionMatrix();
    rt.moon.shadow.needsUpdate = true;
    rt.activeRoom = room.id;
    rt.shadowLive = true;
    rt.shadowFrames++;
  } else {
    rt.activeRoom = null;
  }

  const cam = ctx.boot.handle.camera;
  rt.dome.position.copy(cam.position);

  const inside = roomIsOpenAt(ctx, px, pz);
  rt.fogT = Math.min(1, Math.max(0, rt.fogT + (inside ? dt : -dt) / FOG_BLEND_S));
  const rig = ctx.lighting.dungeonOn ? DUNGEON_RIG : GALLERY_RIG;
  const indoor: Fog = { color: rig.fogColor, near: rig.fogNear, far: rig.fogFar };
  const outdoor: Fog = { color: rt.preset.fog.color, near: rt.preset.fog.near, far: rt.preset.fog.far };
  const fog = blendFog(indoor, outdoor, rt.fogT);
  const sceneFog = ctx.boot.handle.scene.fog as THREE.Fog | null;
  if (sceneFog) {
    sceneFog.color.setRGB(...fog.color);
    sceneFog.near = fog.near;
    sceneFog.far = fog.far;
  }
}

/** Is (x, z) inside an open-sky room's rectangle (not just near one)? */
function roomIsOpenAt(ctx: GameContext, x: number, z: number): boolean {
  return skyRooms(ctx).some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

/** A body spawned in an open room takes the moon as its key light (spec §7). */
export function applyMoonKey(
  ctx: GameContext,
  uniforms: { lightDir: { value: THREE.Vector3 }; keyColor: { value: THREE.Color }; lightCfg: { value: THREE.Vector2 | THREE.Vector4 } },
): void {
  const rt = ctx.lighting.outdoor;
  if (!rt) return;
  const m = rt.preset.moon;
  uniforms.lightDir.value.set(...m.dir);
  uniforms.keyColor.value.setRGB(...m.color);
  uniforms.lightCfg.value.x = m.intensity;
}

/** Tuning seams (`__sdfGame.sky()` / `setSky(path, value)`), plain data. */
export function createOutdoorSeams(ctx: GameContext) {
  return {
    sky: () => {
      const rt = ctx.lighting.outdoor;
      if (!rt) return null;
      return {
        preset: JSON.parse(JSON.stringify(rt.preset)) as SkyPreset,
        activeRoom: rt.activeRoom,
        moonShadowLive: rt.shadowLive,
        moonShadowFrames: rt.shadowFrames,
        fogT: rt.fogT,
      };
    },
    /** `setSky('moon.intensity', 2)`, `setSky('zenith', [0, 0, 0.1])`. Returns the new preset. */
    setSky: (path: string, value: unknown) => {
      const rt = ctx.lighting.outdoor;
      if (!rt) return null;
      const keys = path.split('.');
      let o = rt.preset as unknown as Record<string, unknown>;
      for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
      o[keys[keys.length - 1]!] = value;
      if (path === 'moon.dir') {
        const d = rt.preset.moon.dir, l = Math.hypot(d[0], d[1], d[2]);
        rt.preset.moon.dir = [d[0] / l, d[1] / l, d[2] / l];
      }
      writeUniforms(rt);
      return JSON.parse(JSON.stringify(rt.preset)) as SkyPreset;
    },
  };
}

// ---- Outdoor surface materials (spec §8) -------------------------------------

const texCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) { t = make(); texCache.set(key, t); }
  return t;
}
/** A per-plane view of a cached texture with its own repeat (shares the image). */
function repeated(base: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = base.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}
/** Soft edge alpha over a plane's uv: 1 inside, falling to 0 over `edgeM` metres. */
function softEdge(w: number, h: number, edgeM: number) {
  const ex = float(Math.min(0.5, edgeM / Math.max(w, 1e-3))), ey = float(Math.min(0.5, edgeM / Math.max(h, 1e-3)));
  const u = uv();
  return smoothstep(float(0), ex, u.x).mul(smoothstep(float(0), ex, float(1).sub(u.x)))
    .mul(smoothstep(float(0), ey, u.y)).mul(smoothstep(float(0), ey, float(1).sub(u.y)));
}

/** The material for a tagged level plane of size w x h metres, or null to keep the
 *  stone path (untagged ring planes, walls, ceilings, tunnels, and `ground:stone`). */
export function outdoorSurfaceMaterial(tag: string | undefined, w: number, h: number): THREE.Material | null {
  if (!tag) return null;
  const [kind, name] = tag.split(':') as [string, string | undefined];
  if ((kind === 'ground' || kind === 'path') && name) {
    if (kind === 'ground' && name === 'stone') return null;
    const g = GROUND_PRESETS[name as GroundName];
    const base = cachedTex(`ground:${name}`, () => groundTexture(g.texture, 11));
    if (kind === 'ground') {
      return new THREE.MeshStandardMaterial({
        map: repeated(base, w / g.repeatM, h / g.repeatM),
        color: new THREE.Color(...g.albedo), roughness: g.roughness, metalness: 0,
      });
    }
    const m = new MeshStandardNodeMaterial();
    const tex = repeated(base, w / g.repeatM, h / g.repeatM);
    m.colorNode = vec4(texture(tex, uv().mul(vec2(tex.repeat.x, tex.repeat.y))).rgb.mul(vec3(...g.albedo)), softEdge(w, h, 0.3));
    m.roughness = g.roughness;
    m.transparent = true;
    m.depthWrite = false;
    return m;
  }
  if (kind === 'edge' && name) {
    const e = EDGE_PRESETS[name as EdgeStyle];
    const base = cachedTex(`edge:${name}`, () => edgeTexture(e.texture, 5));
    const tex = repeated(base, e.texture === 'railing' ? w / 1.2 : w / 2, e.texture === 'railing' ? 1 : h / 2);
    if (e.cutout) {
      const m = new MeshStandardNodeMaterial();
      const s = texture(tex, uv().mul(vec2(tex.repeat.x, tex.repeat.y)));
      m.colorNode = vec4(s.rgb.mul(vec3(...e.albedo)), s.a);
      m.transparent = true;
      m.side = THREE.DoubleSide;
      return m;
    }
    return new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color(...e.albedo), roughness: 0.95, metalness: 0 });
  }
  return null;
}
