// src/lab/sdf-zombie/webgpu/deferred-shadows-main.ts
//
// M2 task 4 GPU smoke page: the explicit flashlight shadow maps
// (deferred-shadows.ts) driving the deferred layer's receiver-aware sampling.
// One deferred frame contains:
//
//   - a stone room (floor + 3 walls, MeshStandardMaterial adapted by the
//     task-3 router, receiver 'full') — the floor is the proxy-shadow screen
//   - a ceiling-hung stone SLAB between the flashlight and the zombie — the
//     level-occlusion-of-flesh screen (its shadow crosses the body's front)
//   - the SDF zombie surface view (level-only, class 18)
//   - the occluder hull's INFLATED shadow twin (SHADOW_HULL_LAYER, casts
//     into the full map) AND its shrunken occlusion twin (castShadow false —
//     must never be collected)
//   - an alpha-cutout mapped plane as a caster, hung high so its own shadow
//     lands on the back wall (exercises the cutout depth material on device
//     without polluting the floor-mask counts)
//   - the flashlight (slot 0) + three practicals through the task-3 light list
//
// The driver (scripts/deferred-shadow-check.mjs) captures lit-target hashes,
// on/off masks with coordinates, counters and screenshots. CPU classification
// (slab AABB + inflated hull spheres against the reconstructed world
// positions) makes the assertions statistical and independent of any single
// pixel.
//
// GEOMETRY IS ANALYTIC, not eyeballed (continuation review: the original
// pillar covered the WHOLE body in camera projection and the resolved
// G-buffer held zero flesh pixels). With C = CAM_START, L the flashlight
// pose (rig offset [0.25,-0.15,+0.1] view-space => L ~= (3.175, 2.449, 1.903)),
// target plane the torso front z=0.17, slab z in [0.8565, 0.8965], slab x in
// [1.35, 1.53]:
//
//   s(z)  = (Cz - 0.17) / (Cz - z)  (camera magnification to the torso plane)
//   sL(z) = (Lz - 0.17) / (Lz - z)  (light magnification)
//
//   CAMERA projection (all four x/z corners, s at both slab z faces):
//   the slab covers camera-ray crossings x in [1.25, 1.44]; body points
//   (|x| <= 0.363) cross at x <= 1.16 => the WHOLE body stays visible from
//   the camera (the slab only covers floor/wall behind-right of it).
//   LIGHT projection: x_shadow(x_edge) = Lx + sL*(x_edge - Lx), sL(0.8965)
//   ~= 1.655, sL(0.8565) ~= 1.721 => shadow band x in [0.05, 0.42] on the
//   torso plane => crosses the spine front (r 0.15) and the right arm
//   (0.147..0.337): fat 'shadowed AND visible' evidence.
//   Slab y [1.6, 3.0] (ceiling-hung): its FLOOR shadow only starts where the
//   ray through its bottom edge (y=1.6) lands, ~3.6m down-beam (z ~= -1.1),
//   so the NEAR half of the hull-proxy streak on the floor stays pillar-free
//   and the driver's proxy-vs-other floor fraction holds (~0.9 in simulation).
//   A floor-standing slab was REJECTED: its shadow tongue runs co-linear with
//   the proxy streak and starves the proxy-explained count.

import * as THREE from 'three/webgpu';
import { createLabRenderer, type LabRendererHandle } from './lab-renderer';
import { createDeferredLayer, type DeferredLayer, type DeferredFlashlightShadowBinding } from './deferred-layer';
import { createDeferredFlashlightShadows, FLASHLIGHT_SHADOW_BIAS, type DeferredFlashlightShadowFactory } from './deferred-shadows';
import { createZombieGpuView, type ZombieGpuView } from './zombie-gpu';
import { createGameDeferredScene, type GameDeferredScene } from './game-deferred-scene';
import { buildGameDeferredLights, type GameLightCandidate } from './game-deferred-lights';
import { createFlashlight, DUNGEON_RIG } from './dungeon-lighting';
import { createOccluderHull, buildHullInstances, SHADOW_HULL_INFLATE, type OccluderHull } from './occluder-hull';
import { OCCLUDER_LAYER, SHADOW_HULL_LAYER } from './sdf-layer';
import type { SurfaceAttachmentName } from './deferred-surface';
import { stoneTextures } from '../../../game/level/stone-textures';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import { FLESH_PRESETS } from '../material';
import type { Vec3 } from '../types';
import zombieBlobSrc from '../characters/zombie.blob?raw';

const FIXED_W = 800;
const FIXED_H = 600;
const STEP_DT = 1 / 60;
const ROOM_HALF = 3.6;
const ROOM_HEIGHT = 3.0;

/** Camera/light layout. The flashlight rides the rig offset [0.25,-0.15,+0.1]
 *  (view space) off the camera, so the slab casts ACROSS the body while the
 *  body stays fully visible from the camera (see the analytic projection note
 *  above). The camera is raised to y 2.55 so the light is steep enough for the
 *  inflated hull's proxy shadow to land on the VISIBLE floor near the body
 *  instead of flying to the far wall. Moving the camera to the -x side moves
 *  the proxy shadow to the +x side of the body (the motion check, asserted in
 *  WORLD space). */
const CAM_START = { pos: [2.9, 2.55, 2.0] as Vec3, look: [0, 1.0, -0.4] as Vec3 };
const CAM_FLIPPED = { pos: [-2.8, 2.55, 1.6] as Vec3, look: [0, 1.0, -0.4] as Vec3 };
/** Ceiling-hung stone slab: the LEVEL occluder. x [1.35,1.53] (on the light->
 *  torso beam), y [1.6,3.0] (hung: bottom edge high enough that its floor
 *  shadow starts BEYOND the proxy streak's near half), z [0.8565,0.8965]. */
const SLAB = { centre: [1.44, 2.3, 0.8765] as Vec3, half: [0.09, 0.7, 0.02] as Vec3 };
const DARKENED_RATIO = 0.85; // lit < off * 0.85 counts as darkened
/** Floor classification is GEOMETRIC, never the G-buffer normal: floorCobble
 *  carries a normalMap, so the resolved normal is a SHADING normal — the old
 *  normal.y>.9 gate poked holes in the floor mask before the coherence flood
 *  fill (saved evidence: 330 proxy px fragmented into 56-px components).
 *  The floor is the y≈0 plane bounded by the room extent, on the mesh class. */
const FLOOR_Y_TOL = 0.005;
const isFloorPoint = (w: Vec3): boolean =>
  Math.abs(w[1]!) <= FLOOR_Y_TOL
  && Math.abs(w[0]!) <= ROOM_HALF + FLOOR_Y_TOL
  && Math.abs(w[2]!) <= ROOM_HALF + FLOOR_Y_TOL;

const errors: string[] = [];

// ---- three's 256-byte-row-padded readback (the r32f row-stride trap) ------
function decodeHalf(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? Number.NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

interface ReadBuffer { width: number; height: number; channels: number; data: Float32Array }

async function readAttachment(handle: LabRendererHandle, target: THREE.RenderTarget, name: SurfaceAttachmentName): Promise<ReadBuffer> {
  const textureIndex = target.textures.findIndex((t) => t.name === name);
  if (textureIndex < 0) throw new Error(`target is missing attachment '${name}'`);
  const tex = target.textures[textureIndex]!;
  const w = target.width;
  const h = target.height;
  const channels = tex.format === THREE.RedFormat ? 1 : 4;
  const half = tex.type === THREE.HalfFloatType;
  const bytesPerTexel = channels * (half ? 2 : 4);
  const rowBytes = w * bytesPerTexel;
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const raw = await handle.renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, textureIndex);
  const data = new Float32Array(w * h * channels);
  const srcBytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let y = 0; y < h; y++) {
    if (half) {
      const row = new Uint16Array(srcBytes.buffer, srcBytes.byteOffset + y * paddedRowBytes, w * channels);
      for (let i = 0; i < row.length; i++) data[y * w * channels + i] = decodeHalf(row[i]!);
    } else {
      const row = new Float32Array(srcBytes.buffer, srcBytes.byteOffset + y * paddedRowBytes, w * channels);
      data.set(row, y * w * channels);
    }
  }
  return { width: w, height: h, channels, data };
}

function cutoutTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#e8e4da';
  g.fillRect(0, 0, 32, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ---- CPU occlusion classifiers -------------------------------------------
function rayHitsAABB(origin: Vec3, target: Vec3, centre: Vec3, half: Vec3): boolean {
  const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  let t0 = 0, t1 = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-9) {
      if (Math.abs(origin[a]! - centre[a]!) > half[a]!) return false;
      continue;
    }
    const inv = 1 / d[a]!;
    let tn = (centre[a]! - half[a]! - origin[a]!) * inv;
    let tf = (centre[a]! + half[a]! - origin[a]!) * inv;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    t0 = Math.max(t0, tn);
    t1 = Math.min(t1, tf);
    if (t0 > t1) return false;
  }
  return true;
}

function rayHitsSphere(origin: Vec3, target: Vec3, centre: Vec3, radius: number): boolean {
  const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const o = [origin[0] - centre[0], origin[1] - centre[1], origin[2] - centre[2]];
  const A = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
  const B = 2 * (o[0]! * d[0]! + o[1]! * d[1]! + o[2]! * d[2]!);
  const C = o[0]! * o[0]! + o[1]! * o[1]! + o[2]! * o[2]! - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return false;
  const sq = Math.sqrt(disc);
  const t0 = (-B - sq) / (2 * A), t1 = (-B + sq) / (2 * A);
  return (t0 > 0.002 && t0 < 1) || (t1 > 0.002 && t1 < 1);
}

interface MaskEvidence {
  fleshOccluded: { count: number; meanOn: number; meanOff: number; sampleCoord: [number, number] | null };
  fleshClear: { count: number; meanOn: number; meanOff: number; sampleCoord: [number, number] | null };
  floor: {
    darkenedProxy: number; darkenedOther: number; clearProxy: number;
    /** RECALL: darkened proxy-explained px / all proxy-crossing px. */
    proxyDarkenedFraction: number;
    /** PRECISION: darkened proxy-explained px / all darkened floor px. */
    proxyPrecision: number;
    largestComponent: number;
    /** Top 5 darkened-mask 4-connected component sizes (coherence evidence). */
    componentSizes: number[];
    centroid: [number, number] | null;
    /** Mean WORLD x of the proxy-explained darkened floor pixels — the
     *  world-space handle the motion check flips (light +x -> shadow -x). */
    proxyShadowMeanWorldX: number | null;
    sampleCoords: [number, number][];
  };
  lightPos: [number, number, number];
}

/** Generic first-attachment reader for the census seams: handles both the
 *  lit target (RGBA16F) and the shadow maps' R32F, with the padded-row math
 *  shared. */
async function readTargetChannel(handle: LabRendererHandle, target: THREE.RenderTarget): Promise<ReadBuffer> {
  const tex = target.textures[0]!;
  const w = target.width, h = target.height;
  const channels = tex.format === THREE.RedFormat ? 1 : 4;
  const half = tex.type === THREE.HalfFloatType;
  const bytesPerTexel = channels * (half ? 2 : 4);
  const rowBytes = w * bytesPerTexel;
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
  const raw = await handle.renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, 0);
  const data = new Float32Array(w * h * channels);
  const srcBytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let y = 0; y < h; y++) {
    if (half) {
      const row = new Uint16Array(srcBytes.buffer, srcBytes.byteOffset + y * paddedRowBytes, w * channels);
      for (let i = 0; i < row.length; i++) data[y * w * channels + i] = decodeHalf(row[i]!);
    } else {
      const row = new Float32Array(srcBytes.buffer, srcBytes.byteOffset + y * paddedRowBytes, w * channels);
      data.set(row, y * w * channels);
    }
  }
  return { width: w, height: h, channels, data };
}

async function main() {
  const mount = document.getElementById('app')!;
  const handle = await createLabRenderer(mount, { mode: 'fixed', width: FIXED_W, height: FIXED_H });
  handle.setLoopRunning(false);
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  interface MinimalDevice {
    addEventListener?: (type: string, cb: (e: { error: { message: string } }) => void) => void;
  }
  const device = (handle.renderer.backend as unknown as { device?: MinimalDevice }).device;
  device?.addEventListener?.('uncapturederror', (e) => errors.push(`webgpu: ${e.error.message}`));

  // ---- the room: RAW standard materials; the router adapts them -----------
  const disposables: { dispose(): void }[] = [];
  const wallTex = stoneTextures('wallBrick', 11);
  const floorTex = stoneTextures('floorCobble', 23);
  const mkMat = (tex: ReturnType<typeof stoneTextures>, repeat: number) => {
    for (const t of [tex.map, tex.normalMap, tex.roughnessMap]) t.repeat.set(repeat, repeat);
    const std = new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap,
      roughness: 0.95, metalness: 0.0,
    });
    disposables.push(std);
    return std;
  };
  const room = new THREE.Group();
  room.name = 'room';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), mkMat(floorTex, 3));
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const wallGeo = new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HEIGHT);
  for (const [x, z, ry] of [[-ROOM_HALF, 0, Math.PI / 2], [ROOM_HALF, 0, -Math.PI / 2], [0, -ROOM_HALF, 0]] as const) {
    const wall = new THREE.Mesh(wallGeo, mkMat(wallTex, 2));
    wall.position.set(x, ROOM_HEIGHT / 2, z);
    wall.rotation.y = ry;
    room.add(wall);
  }

  // The hanging slab: the LEVEL occluder between flashlight (+x) and zombie.
  // Geometry derivation in the header comment. Hung from the ceiling (no
  // chain mesh — the SDF/analytics only need the slab's own shadow).
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(SLAB.half[0]! * 2, SLAB.half[1]! * 2, SLAB.half[2]! * 2),
    mkMat(wallTex, 1),
  );
  slab.name = 'slab';
  slab.position.set(...SLAB.centre);

  // The alpha-cutout caster (grate stand-in): reproduces the cutout depth
  // material path on device. Hung HIGH so its own shadow lands on the back
  // wall (z = -3.6), not on the floor — the floor masks must stay
  // proxy/slab-explained only.
  const cutout = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: cutoutTexture(), alphaTest: 0.5, transparent: false, side: THREE.DoubleSide }),
  );
  cutout.name = 'cutout-caster';
  cutout.position.set(0.9, 2.2, -1.2);
  cutout.rotation.y = Math.PI / 3;

  const meshScene = new THREE.Scene();
  meshScene.add(room, slab, cutout);
  // game-main's eligibility pass: every mesh casts and receives.
  meshScene.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  // ---- the SDF zombie (surface, level-only) -------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const compiled = compileBlob(doc, face);
  const built: BuildResult = buildBody(compiled, DEFAULT_BUILD_OPTS, {});
  for (const err of built.errors) errors.push(`body: ${err}`);
  const body = translateBody(built, [0, 0, 0]);
  const surfaceView = createZombieGpuView(body, { output: 'surface', shadowReceiver: 'level-only' });
  surfaceView.applyMaterial({ ...FLESH_PRESETS['henenlotter-latex'] }, { keyDir: [0.4, 0.8, 0.3], keyColor: [1, 0.95, 0.88], keyIntensity: 2.2, fillIntensity: 0.08, probeWeight: 0.5, ambientGain: 0.5, chromaGain: 0.2 });
  const sdfScene = new THREE.Scene();
  sdfScene.add(surfaceView.object);

  // ---- the inflated shadow proxy + its shrunken twin -----------------------
  const occluderHull: OccluderHull = createOccluderHull();
  occluderHull.update([body]);
  // The shadow twin rides SHADOW_HULL_LAYER and casts (factory default).
  meshScene.add(occluderHull.shadowObject);
  // The SHRUNKEN occlusion hull: castShadow stays false — must never be
  // collected (the inflated-vs-shrunken distinction, on device).
  occluderHull.object.castShadow = false;
  meshScene.add(occluderHull.object);
  const hullSpheres = buildHullInstances([body], SHADOW_HULL_INFLATE, [], 0, true);

  // ---- routers ------------------------------------------------------------
  const meshRouter: GameDeferredScene = createGameDeferredScene(meshScene);
  const sdfRouter = createGameDeferredScene(sdfScene);
  meshRouter.register(room, 'mesh', 'full');
  meshRouter.register(slab, 'mesh', 'full');
  meshRouter.register(cutout, 'mesh', 'full');
  sdfRouter.register(surfaceView.object, 'sdf', 'level-only');
  meshRouter.sync();
  sdfRouter.sync();

  // ---- the flashlight + practicals ----------------------------------------
  const flashlight = createFlashlight(DUNGEON_RIG);
  meshScene.add(flashlight.spot, flashlight.spot.target);
  const practicals: GameLightCandidate[] = [];
  for (const [i, p] of [[-2.5, 2.75, -2.0], [2.5, 2.75, -2.0], [0, 2.8, 2.2]].entries()) {
    const pl = new THREE.PointLight(new THREE.Color(1.0, 0.46, 0.13), 2.2, 9, 2);
    pl.position.set(p[0]!, p[1]!, p[2]!);
    meshScene.add(pl);
    practicals.push({ id: `fire-${i}`, role: 'practical', light: pl });
  }

  // ---- the deferred layer + the shadow factory -----------------------------
  const deferredLayer: DeferredLayer = createDeferredLayer(handle.renderer, {
    width: FIXED_W, height: FIXED_H, sdfScale: 1,
  });
  const shadows: DeferredFlashlightShadowFactory = createDeferredFlashlightShadows(handle.renderer, { size: 1024 });
  const shadowTargets = shadows.targets;

  const camera = handle.camera;
  camera.position.set(...CAM_START.pos);
  camera.lookAt(...CAM_START.look);
  camera.updateMatrixWorld();

  // customBinding (review fix, 2026-09-06): when set it REPLACES the factory
  // binding for the binding-identity check — deliberately different constant-
  // depth maps bound per slot after the null-first compile. The drawFn spreads
  // it per frame and resolves the flashlight index exactly like the factory
  // path; `enabled` on the object is the sampling toggle for that binding.
  const state = {
    mapsEnabled: true,
    bound: false,
    samplingEnabled: false,
    customBinding: null as DeferredFlashlightShadowBinding | null,
  };
  const lightCandidates = (): GameLightCandidate[] => [
    { id: 'flashlight', role: 'flashlight', light: flashlight.spot },
    ...practicals,
  ];

  handle.setDrawFn(() => {
    flashlight.update(camera);
    shadows.update(meshScene, flashlight.spot, {
      enabled: state.mapsEnabled,
      fullCasterLayers: [0, OCCLUDER_LAYER, SHADOW_HULL_LAYER],
      levelCasterLayers: [0],
    });
    const set = buildGameDeferredLights(lightCandidates(), camera.position);
    deferredLayer.setLights(set.lights);
    let binding: DeferredFlashlightShadowBinding | null = null;
    if (state.customBinding) {
      binding = { ...state.customBinding, lightIndex: set.flashlightIndex >= 0 ? set.flashlightIndex : 0 };
    } else if (state.bound) {
      binding = shadows.binding(set.flashlightIndex >= 0 ? set.flashlightIndex : 0, state.samplingEnabled);
    }
    deferredLayer.setFlashlightShadow(binding);
    deferredLayer.render(meshScene, sdfScene, camera, {
      drawMesh: () => meshRouter.draw('mesh', handle.renderer, camera),
      drawSdf: () => sdfRouter.draw('sdf', handle.renderer, camera),
    });
  });

/** The lit target's RGBA16F readback for hashes/masks. */
const readLit = async (): Promise<ReadBuffer> => readTargetChannel(handle, deferredLayer.targets.lit);

  const hashBuffer = (buf: ReadBuffer): string => {
    const bytes = new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };

  /** World position of a resolved pixel (inverse view-projection + clip depth). */
  const worldOf = (px: number, py: number, depthBuf: ReadBuffer, invVp: THREE.Matrix4): Vec3 => {
    const d = depthBuf.data[py * depthBuf.width + px]!;
    // Pixel CENTERS, not integer corners (a 0.5-texel bias skews every
    // classifier and the anchor round-trip by ~5mm at body distance).
    const ndcX = ((px + 0.5) / FIXED_W) * 2 - 1;
    const ndcY = 1 - ((py + 0.5) / FIXED_H) * 2;
    const v = new THREE.Vector4(ndcX, ndcY, d, 1).applyMatrix4(invVp);
    return [v.x / v.w, v.y / v.w, v.z / v.w];
  };

  const computeMasks = async (on: ReadBuffer, off: ReadBuffer): Promise<MaskEvidence> => {
    const resolved = deferredLayer.targets.resolved;
    const emission = await readAttachment(handle, resolved, 'emissionClass');
    const depth = await readAttachment(handle, resolved, 'surfaceDepth');
    // NOTE: the normal attachment is deliberately NOT read here — floor
    // classification must stay independent of the cobble normalMap (see
    // isFloorPoint above).
    camera.updateMatrixWorld();
    const invVp = new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    const lightPos = flashlight.spot.getWorldPosition(new THREE.Vector3()).toArray() as Vec3;
    const slabCentre = SLAB.centre, slabHalf = SLAB.half;

    let foCount = 0, foOn = 0, foOff = 0; let foCoord: [number, number] | null = null;
    let fcCount = 0, fcOn = 0, fcOff = 0; let fcCoord: [number, number] | null = null;
    let darkProxy = 0, darkOther = 0, clearProxy = 0;
    const darkCoords: [number, number][] = [];
    const darkMask = new Uint8Array(FIXED_W * FIXED_H);
    let sumX = 0, sumY = 0, darkTotal = 0;
    let proxyWorldX = 0, proxyWorldN = 0;

    for (let y = 0; y < FIXED_H; y++) {
      for (let x = 0; x < FIXED_W; x++) {
        const o4 = (y * FIXED_W + x) * 4;
        const clsRaw = emission.data[o4 + 3]!;
        const baseCls = clsRaw - Math.floor(clsRaw / 16) * 16;
        const d = depth.data[y * FIXED_W + x]!;
        if (baseCls < 0.5 || d >= 1) continue;
        const litOn = on.data[o4]!, litOff = off.data[o4]!;
        const world = worldOf(x, y, depth, invVp);
        const pillarHit = rayHitsAABB(lightPos, world, slabCentre, slabHalf);
        if (baseCls > 1.5 && baseCls < 2.5) {
          if (pillarHit) { foCount++; foOn += litOn; foOff += litOff; if (!foCoord) foCoord = [x, y]; }
          else { fcCount++; fcOn += litOn; fcOff += litOff; if (!fcCoord) fcCoord = [x, y]; }
        } else if (baseCls < 1.5 && isFloorPoint(world)) {
          // The slab's pillarHit was already tested above; the floor pixels
          // it darkens are slab-explained (darkenedOther), never proxy.
          let proxyHit = false;
          if (!pillarHit) {
            for (const s of hullSpheres) {
              if (rayHitsSphere(lightPos, world, s.centre as Vec3, s.radius)) { proxyHit = true; break; }
            }
          }
          const dark = litOn < litOff * DARKENED_RATIO;
          if (dark) {
            darkMask[y * FIXED_W + x] = 1;
            darkTotal++; sumX += x; sumY += y;
            if (darkCoords.length < 24) darkCoords.push([x, y]);
            if (proxyHit) {
              darkProxy++;
              proxyWorldX += world[0]!; proxyWorldN++;
            } else darkOther++;
          } else if (proxyHit) clearProxy++;
        }
      }
    }
    // Largest 4-connected component of the darkened floor mask (coherence).
    const seen = new Uint8Array(FIXED_W * FIXED_H);
    let largest = 0;
    const componentSizes: number[] = [];
    const stack: number[] = [];
    for (let i = 0; i < darkMask.length; i++) {
      if (!darkMask[i] || seen[i]) continue;
      let size = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        size++;
        const cx = cur % FIXED_W, cy = (cur / FIXED_W) | 0;
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= FIXED_W || ny >= FIXED_H) continue;
          const ni = ny * FIXED_W + nx;
          if (darkMask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      componentSizes.push(size);
      largest = Math.max(largest, size);
    }
    return {
      fleshOccluded: { count: foCount, meanOn: foCount ? foOn / foCount : 0, meanOff: foCount ? foOff / foCount : 0, sampleCoord: foCoord },
      fleshClear: { count: fcCount, meanOn: fcCount ? fcOn / fcCount : 0, meanOff: fcCount ? fcOff / fcCount : 0, sampleCoord: fcCoord },
      floor: {
        darkenedProxy: darkProxy, darkenedOther: darkOther, clearProxy,
        proxyDarkenedFraction: darkProxy + clearProxy ? darkProxy / (darkProxy + clearProxy) : 0,
        proxyPrecision: darkProxy + darkOther ? darkProxy / (darkProxy + darkOther) : 0,
        largestComponent: largest,
        componentSizes: componentSizes.sort((a, b) => b - a).slice(0, 5),
        centroid: darkTotal ? [sumX / darkTotal, sumY / darkTotal] : null,
        proxyShadowMeanWorldX: proxyWorldN ? proxyWorldX / proxyWorldN : null,
        sampleCoords: darkCoords,
      },
      lightPos: [lightPos[0]!, lightPos[1]!, lightPos[2]!] as [number, number, number],
    };
  };

  // ---- binding identity (review fix, 2026-09-06) ---------------------------
  // The decisive discriminator for the two shadow slots. The light pipeline
  // compiled NULL-FIRST (boot rendered with no binding stored), so on the
  // pre-fix code both TextureNodes hashed to the SAME uniform (one shared
  // fallback texture) and no later .value write could split them. This check
  // binds deliberately different CONSTANT-depth R32F maps per slot —
  // full=0 / level-only=1, then swapped — under a matrix that puts every
  // room receiver strictly in-frustum at clip depth [0.25, 0.75], far from
  // the comparison bias. With full=0 every in-frustum FULL receiver must
  // lose its ENTIRE designated-flashlight contribution (delta = the whole
  // contribution, unambiguous) while level-only receivers are untouched to
  // readback precision; the swap must reverse both. Raw linear lit-target
  // readback only; practicals/ambient/emission cancel in the per-pixel
  // deltas. NOTE: intentionally declared with an explicit type wide enough
  // to compile against BOTH the pre-fix and post-fix layer (the fix adds
  // diagnostics().shadowSlots; pre-fix the field is absent and slot evidence
  // records as null — the GPU assertions still carry the reproduction).
  const CONST_MAP = 8; // constant-depth map edge, texels; mapSize matches
  interface SlotSnapshot { fullUuid: string; levelUuid: string; fullIsOwnedFallback: boolean; levelIsOwnedFallback: boolean }
  const slotSnapshot = (): SlotSnapshot | null => {
    const d = deferredLayer.diagnostics() as unknown as Record<string, unknown>;
    const s = d.shadowSlots as SlotSnapshot | undefined;
    return s ? { ...s } : null;
  };
  async function bindingIdentityCheck() {
    const constTex = (v: number): THREE.DataTexture => {
      const t = new THREE.DataTexture(
        new Float32Array(CONST_MAP * CONST_MAP).fill(v), CONST_MAP, CONST_MAP,
        THREE.RedFormat, THREE.FloatType,
      );
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    const owned: THREE.DataTexture[] = [];
    const prevBound = state.bound;
    const prevSampling = state.samplingEnabled;
    try {
      const slotsPre = slotSnapshot();
      // Baseline at the CURRENT pose: factory path, sampling off.
      state.customBinding = null;
      api.setSampling(false);
      step(2);
      const offLit = await readLit();
      const offHash = hashBuffer(offLit);
      const resolved = deferredLayer.targets.resolved;
      const emission = await readAttachment(handle, resolved, 'emissionClass');
      const depth = await readAttachment(handle, resolved, 'surfaceDepth');
      camera.updateMatrixWorld();
      const invVp = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
      // world -> clip with w = 1: xy compressed to a tenth (the whole room is
      // in-frustum), z affine onto [0.25, 0.75] across world z in [-3.6, 3].
      // Receivers land orders of magnitude away from the comparison bias.
      const M = new THREE.Matrix4().set(
        0.1, 0, 0, 0,
        0, 0.1, 0, 0,
        0, 0, 1 / 6, 0.25,
        0, 0, 0, 1,
      );
      const customBinding = (full: THREE.DataTexture, level: THREE.DataTexture, enabled: boolean): DeferredFlashlightShadowBinding => ({
        fullDepth: full,
        levelDepth: level,
        viewProjection: M,
        lightIndex: 0, // drawFn resolves the real flashlight index per frame
        bias: FLASHLIGHT_SHADOW_BIAS,
        mapSize: new THREE.Vector2(CONST_MAP, CONST_MAP),
        enabled,
      });
      // Phase 0: custom maps bound but sampling OFF — must be output-neutral.
      // Phase A: full=0 (every in-frustum full receiver occluded), level=1
      // (every in-frustum level-only receiver lit). Same slot textures, the
      // enabled flag is the only difference between the two binding objects.
      const full0 = constTex(0), level1 = constTex(1);
      owned.push(full0, level1);
      state.customBinding = customBinding(full0, level1, false);
      step(2);
      const boundOffHash = hashBuffer(await readLit());
      state.customBinding = customBinding(full0, level1, true);
      step(2);
      const litA = await readLit();
      const slotsBound = slotSnapshot();
      // Phase B: SWAPPED constants — full=1, level-only=0. Both slots must
      // respond independently.
      const full1 = constTex(1), level0 = constTex(0);
      owned.push(full1, level0);
      state.customBinding = customBinding(full1, level0, true);
      step(2);
      const litB = await readLit();
      // Restore the factory path BEFORE disposing the const textures, so no
      // render ever sees a disposed texture.
      state.customBinding = null;
      api.setSampling(false);
      step(2);
      const restoredHash = hashBuffer(await readLit());
      const slotsRestored = slotSnapshot();
      // Per-receiver aggregation over the resolved G-buffer.
      const LIGHT_FLOOR = 0.05;   // ignore pixels the flashlight barely reaches
      const DARK_REL = 0.05;      // >5% of the pixel's light lost = darkened
      const SAME_REL = 0.001;     // 0.1%: readback-identical arithmetic
      let inFrustumPx = 0;
      let fullLitPx = 0, fullDarkPx = 0, fleshLitPx = 0, fleshDarkPx = 0;
      let fullOffSum = 0, fullDarkDeltaSum = 0, fleshOffSum = 0, fleshDarkDeltaSum = 0;
      let fullMaxRelDiffB = 0, fleshMaxRelDiffA = 0, maxOff = 0;
      let fullSampleCoord: [number, number] | null = null;
      let fleshSampleCoord: [number, number] | null = null;
      const cp = new THREE.Vector4();
      for (let y = 0; y < FIXED_H; y++) {
        for (let x = 0; x < FIXED_W; x++) {
          const o4 = (y * FIXED_W + x) * 4;
          const clsRaw = emission.data[o4 + 3]!;
          const d = depth.data[y * FIXED_W + x]!;
          const baseCls = clsRaw - Math.floor(clsRaw / 16) * 16;
          if (baseCls < 0.5 || d >= 1) continue;
          const levelOnly = clsRaw >= 15.5;
          const world = worldOf(x, y, depth, invVp);
          cp.set(world[0]!, world[1]!, world[2]!, 1).applyMatrix4(M);
          const w = cp.w;
          const sx = cp.x / w, sy = cp.y / w, sz = cp.z / w;
          if (w <= 0 || sx < -1 || sx > 1 || sy < -1 || sy > 1 || sz <= 0 || sz >= 1) continue;
          inFrustumPx++;
          const off = offLit.data[o4]!;
          const a = litA.data[o4]!;
          const b = litB.data[o4]!;
          if (off > maxOff) maxOff = off;
          const relDiff = (v: number, ref: number) => Math.abs(v - ref) / Math.max(ref, 1e-3);
          if (levelOnly) {
            // Phase A must leave level-only receivers untouched.
            const relA = relDiff(a, off);
            if (relA > fleshMaxRelDiffA) fleshMaxRelDiffA = relA;
            if (off > LIGHT_FLOOR) {
              fleshLitPx++;
              fleshOffSum += off;
              const delta = off - b; // phase B must darken them
              if (delta > DARK_REL * off) {
                fleshDarkPx++;
                fleshDarkDeltaSum += delta;
                if (!fleshSampleCoord) fleshSampleCoord = [x, y];
              }
            }
          } else {
            // Phase B must leave full receivers untouched.
            const relB = relDiff(b, off);
            if (relB > fullMaxRelDiffB) fullMaxRelDiffB = relB;
            if (off > LIGHT_FLOOR) {
              fullLitPx++;
              fullOffSum += off;
              const delta = off - a; // phase A must darken them
              if (delta > DARK_REL * off) {
                fullDarkPx++;
                fullDarkDeltaSum += delta;
                if (!fullSampleCoord) fullSampleCoord = [x, y];
              }
            }
          }
        }
      }
      return {
        mapSize: [CONST_MAP, CONST_MAP] as [number, number],
        bias: FLASHLIGHT_SHADOW_BIAS,
        matrix: [...M.elements],
        baseline: { offHash, boundOffHash },
        counts: { inFrustumPx, fullLitPx, fullDarkPx, fleshLitPx, fleshDarkPx },
        litRange: { maxOff },
        full: {
          darkenedFraction: fullLitPx ? fullDarkPx / fullLitPx : 0,
          meanDarkening: fullDarkPx ? fullDarkDeltaSum / fullDarkPx : 0,
          meanOff: fullLitPx ? fullOffSum / fullLitPx : 0,
          maxRelDiffSwapped: fullMaxRelDiffB,
          sampleCoord: fullSampleCoord,
        },
        level: {
          darkenedFractionSwapped: fleshLitPx ? fleshDarkPx / fleshLitPx : 0,
          meanDarkeningSwapped: fleshDarkPx ? fleshDarkDeltaSum / fleshDarkPx : 0,
          meanOffSwapped: fleshLitPx ? fleshOffSum / fleshLitPx : 0,
          maxRelDiffA: fleshMaxRelDiffA,
          sampleCoord: fleshSampleCoord,
        },
        slots: { pre: slotsPre, bound: slotsBound, restored: slotsRestored },
        restoredLitHash: restoredHash,
      };
    } finally {
      state.customBinding = null;
      state.bound = prevBound;
      state.samplingEnabled = prevSampling;
      for (const t of owned) t.dispose();
    }
  }

  // ---- driver seam ----------------------------------------------------------
  const step = (n = 1) => { for (let i = 0; i < n; i++) handle.step(STEP_DT); };

  const api = {
    errors,
    ready: false,
    step,
    setMaps(on: boolean) { state.mapsEnabled = on; },
    setSampling(on: boolean) { state.bound = true; state.samplingEnabled = on; },
    clearBinding() { state.bound = false; state.samplingEnabled = false; },
    moveLight() {
      camera.position.set(...CAM_FLIPPED.pos);
      camera.lookAt(...CAM_FLIPPED.look);
      camera.updateMatrixWorld();
    },
    bindingMatrixSnapshot(): number[] {
      return [...shadows.binding(0).viewProjection.elements];
    },
    lightPos(): [number, number, number] {
      const p = flashlight.spot.getWorldPosition(new THREE.Vector3());
      return [p.x, p.y, p.z];
    },
    diagnostics() {
      return {
        shadows: shadows.diagnostics(),
        layer: {
          bound: deferredLayer.diagnostics().flashlightShadowBound,
          sampling: deferredLayer.diagnostics().flashlightShadowEnabled,
        },
        hullSpheres: hullSpheres.length,
      };
    },
    async litHash(): Promise<string> {
      step(1);
      return hashBuffer(await readLit());
    },
    bindingIdentityCheck,
    /** Census + anchor round-trip: project known world points to pixels,
     *  report the class AT those pixels, and reconstruct their world
     *  positions through the same invVp the masks use. The two anchors are
     *  analytically placed: clearA on the left chest (visible AND unshadowed
     *  — the slab's shadow band starts at x ~ +0.05), shadowA on the torso
     *  front inside the slab's shadow band ([0.05, 0.42]). */
    async classProbe(which: 'resolved' | 'sdf' = 'resolved') {
      step(1);
      const resolved = which === 'resolved' ? deferredLayer.targets.resolved : deferredLayer.targets.sdf;
      const emission = await readAttachment(handle, resolved, 'emissionClass');
      const depth = await readAttachment(handle, resolved, 'surfaceDepth');
      const counts: Record<string, number> = {};
      for (let i = 3; i < emission.data.length; i += 4) {
        const cls = Math.round(emission.data[i]!);
        counts[String(cls)] = (counts[String(cls)] ?? 0) + 1;
      }
      camera.updateMatrixWorld();
      const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const anchors: { clearA: Vec3; shadowA: Vec3 } = {
        clearA: [-0.15, 1.3, 0.15],
        shadowA: [0.22, 1.3, 0.15],
      };
      const v = new THREE.Vector4(anchors.clearA[0], anchors.clearA[1], anchors.clearA[2], 1).applyMatrix4(proj);
      const px = Math.round(((v.x / v.w + 1) / 2) * FIXED_W);
      const py = Math.round((1 - v.y / v.w) / 2 * FIXED_H);
      const at = (x: number, y: number) => {
        const o = (y * FIXED_W + x) * 4;
        return { cls: Math.round(emission.data[o + 3]!), depth: depth.data[y * FIXED_W + x]! };
      };
      const anchorAt = at(px, py);
      const invVp = proj.clone().invert();
      const recon = worldOf(px, py, depth, invVp);
      const projected: Record<string, { pixel: [number, number]; at: { cls: number; depth: number }; reconstructed: Vec3 }> = {};
      for (const [name, a] of Object.entries(anchors)) {
        const av = new THREE.Vector4(a[0], a[1], a[2], 1).applyMatrix4(proj);
        const ax = Math.round(((av.x / av.w + 1) / 2) * FIXED_W);
        const ay = Math.round((1 - av.y / av.w) / 2 * FIXED_H);
        projected[name] = { pixel: [ax, ay], at: at(ax, ay), reconstructed: worldOf(ax, ay, depth, invVp) };
      }
      return { counts, anchorPixel: [px, py], anchorAt, reconstructed: recon, anchors: projected };
    },
    /** Shadow-map contents census: min/max/far-texel-count per map. An all-far
     *  map means the raster pass produced nothing; content means the maps are
     *  alive and any on/off hash equality lives in the SAMPLING side. */
    async readMaps() {
      step(1);
      const census = async (target: THREE.RenderTarget) => {
        const buf = await readTargetChannel(handle, target);
        let min = 2, max = -1, far = 0;
        for (let i = 0; i < buf.data.length; i++) {
          const v = buf.data[i]!;
          if (v < min) min = v;
          if (v > max) max = v;
          if (v >= 0.999) far++;
        }
        return { min, max, far, total: buf.data.length };
      };
      return { full: await census(shadowTargets.full), level: await census(shadowTargets.level) };
    },
    async capturePair(): Promise<{ on: string; off: string; masks: MaskEvidence; onHash: string; offHash: string }> {
      // Sampling ON frame(s), then sampling OFF frame(s); compare.
      api.setSampling(true);
      step(2);
      const onLit = await readLit();
      const onHash = hashBuffer(onLit);
      api.setSampling(false);
      step(2);
      const offLit = await readLit();
      const offHash = hashBuffer(offLit);
      const masks = await computeMasks(onLit, offLit);
      // RESTORE sampling ON before returning: screenshots taken after a
      // capture are labelled 'on' and must actually show the shadow (the
      // previous version left the scene in the OFF state, so
      // task4-shadow-on.png captured a shadowless frame).
      api.setSampling(true);
      step(2);
      return { on: 'on', off: 'off', masks, onHash, offHash };
    },
    dispose() {
      shadows.dispose();
      meshRouter.dispose();
      sdfRouter.dispose();
      deferredLayer.dispose();
      surfaceView.dispose();
      occluderHull.dispose();
      for (const d of disposables) d.dispose();
    },
  };
  (window as unknown as { __deferredShadows: typeof api }).__deferredShadows = api;

  step(2);
  api.ready = true;
}

main().catch((e) => {
  errors.push(String(e?.stack ?? e));
  const el = document.getElementById('errors');
  if (el) el.textContent = String(e?.stack ?? e);
});
