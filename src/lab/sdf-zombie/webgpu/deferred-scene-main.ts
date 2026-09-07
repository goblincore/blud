// src/lab/sdf-zombie/webgpu/deferred-scene-main.ts
//
// M2 task 3 GPU smoke page: the game scene router (game-deferred-scene.ts)
// driving BOTH producer passes of the deferred layer through the task-1
// draw hooks, with the shared light list (game-deferred-lights.ts) feeding
// setLights. On screen in ONE deferred frame:
//
//   - a stone room (raw MeshStandardMaterials — the ROUTER adapts them),
//     registered 'mesh' / receiver 'full'
//   - an alpha-cutout mapped plane registered 'mesh' (half opaque, half
//     transparent cells, alphaTest 0.5) against empty background — the hole
//     must stay the empty sentinel on device, proving the adapter kept
//     alphaTest through the G-buffer pass
//   - a registered-forward sphere and an unsupported custom node-material
//     mesh, plus an UNREGISTERED helper sphere — all three must be kept out
//     of the producer passes (class 0 at their anchors)
//   - a 'level-only' kit group whose CHILD is added late (the async kit-load
//     pattern): sync() must discover it and its adapter must carry the
//     receiver bits (class 17 on device)
//   - the SDF zombie surface view (level-only, 18) on a second router over
//     the SDF scene
//
// The check driver is scripts/deferred-scene-check.mjs.

import * as THREE from 'three/webgpu';
import { createLabRenderer, type LabRendererHandle } from './lab-renderer';
import { createDeferredLayer, type DeferredLayer } from './deferred-layer';
import { createZombieGpuView, type ZombieGpuView } from './zombie-gpu';
import {
  createGameDeferredScene, type GameDeferredScene, type GameDeferredSceneDiagnostics,
} from './game-deferred-scene';
import {
  buildGameDeferredLights, type GameLightCandidate,
} from './game-deferred-lights';
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

const CAMERA_POSE = { pos: [0.1, 2.6, 7.2] as Vec3, look: [0.1, 1.0, 0] as Vec3 };

/** World anchors the driver probes.
 *
 *  Probe-placement rules learned the hard way (2026-09-07 fixture review):
 *  - 'body' is the TRANSLATE/SPAWN root at the floor — probing it is a
 *    floor/feet ambiguity. The flesh probe is the chest (task-2's
 *    PROBE.body convention), never the root.
 *  - An exclusion anchor (want class 0) is only meaningful against EMPTY
 *    background. At ±2.8, y=0.8 the anchor ray continued past the excluded
 *    object into the side wall at x=±3.6, so the wall's class-1 coverage
 *    sat behind the probe and the sentinel could never be observed. At
 *    ±2.0, y=2.0 the ray then clipped the cutout plane's opaque half
 *    (x∈[1.2,2.4], y up to 2.1 at z=0.5). The final home is ±1.6, y=2.2,
 *    z=−1.0: the anchor ray crosses the cutout plane 0.17 world units
 *    ABOVE its top edge, exits past the walls' z extent (|z|>3.6) and the
 *    floor's far edge into genuine background.
 */
const LAYOUT = {
  body: [0, 0, 0] as Vec3,
  bodyChest: [0, 1.25, 0.12] as Vec3,
  floor: [0, 0, 0.6] as Vec3,
  sideWall: [3.55, 1.4, 0] as Vec3,
  cutoutSolid: [1.5, 1.5, 0.5] as Vec3,
  cutoutHole: [2.1, 1.5, 0.5] as Vec3,
  forwardSphere: [-1.8, 1.4, 0.5] as Vec3,
  unsupportedMesh: [1.6, 2.2, -1.0] as Vec3,
  helperSphere: [-1.6, 2.2, -1.0] as Vec3,
  kitChild: [-1.0, 1.0, -0.5] as Vec3,
};

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

/** Readback is BY ATTACHMENT NAME and typed to SURFACE_ATTACHMENT_NAMES so a
 *  rename or reorder breaks here at compile time, not silently on device.
 *  (The 2026-09-07 trap: index-destructuring all four attachments as
 *  [emission, depth] actually bound albedoRoughness → 'emission' and
 *  normalMetalness.x → 'depth', misreading roughness as the class.) */
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

/** Left half opaque, right half transparent — no vertical ambiguity in the
 *  anchor cells. */
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

async function main() {
  const mount = document.getElementById('app')!;
  const handle = await createLabRenderer(mount, { mode: 'fixed', width: FIXED_W, height: FIXED_H });
  handle.setLoopRunning(false);
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  interface MinimalDevice {
    queue?: { onSubmittedWorkDone(): Promise<void> };
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
  const floorMaterial = mkMat(floorTex, 3); // held for the live-tuning seam
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  for (const x of [-ROOM_HALF, ROOM_HALF]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HEIGHT), mkMat(wallTex, 2));
    wall.position.set(x, ROOM_HEIGHT / 2, 0);
    wall.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    room.add(wall);
  }

  // The alpha-cutout mapped plane, against EMPTY background.
  const cutout = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshStandardMaterial({
      map: cutoutTexture(), alphaTest: 0.5, transparent: false, side: THREE.DoubleSide,
    }),
  );
  cutout.name = 'cutout-plane';
  cutout.position.set(1.8, 1.5, 0.5);

  // Registered-forward sphere (the blood/particle stand-in).
  const forwardSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xa01515, roughness: 0.25 }),
  );
  forwardSphere.name = 'forward-sphere';
  forwardSphere.position.set(...LAYOUT.forwardSphere);

  // Unsupported custom node material routed 'mesh' — reported, kept out.
  // (Half-extent must exceed the driver's probe search window so a leak
  // into the pass is caught at the anchor, not escaped past it.)
  const unsupportedMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshBasicNodeMaterial(),
  );
  unsupportedMesh.name = 'unsupported-mesh';
  unsupportedMesh.position.set(...LAYOUT.unsupportedMesh);

  // Nobody registers this one: the unregistered-helper exclusion case.
  const helperSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x30c030 }),
  );
  helperSphere.name = 'helper-sphere';
  helperSphere.position.set(...LAYOUT.helperSphere);

  // The kit group: registered NOW with its receiver; the child lands LATE.
  const kitGroup = new THREE.Group();
  kitGroup.name = 'kit-group';
  kitGroup.position.set(-1.0, 0, -0.5);

  const meshScene = new THREE.Scene();
  meshScene.add(room, cutout, forwardSphere, unsupportedMesh, helperSphere, kitGroup);

  // ---- the SDF body (surface, level-only) on its own scene + router -------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const compiled = compileBlob(doc, face);
  const built: BuildResult = buildBody(compiled, DEFAULT_BUILD_OPTS, {});
  for (const err of built.errors) errors.push(`body: ${err}`);
  const body = translateBody(built, LAYOUT.body);
  const surfaceView = createZombieGpuView(body, { output: 'surface', shadowReceiver: 'level-only' });
  surfaceView.applyMaterial({ ...FLESH_PRESETS['henenlotter-latex'] }, { keyDir: [0.4, 0.8, 0.3], keyColor: [1, 0.95, 0.88], keyIntensity: 2.2, fillIntensity: 0.08, probeWeight: 0.5, ambientGain: 0.5, chromaGain: 0.2 });
  surfaceView.setWounds([[0.06, 1.26, 0.16], [-0.07, 1.38, 0.13]], [0.15, 0.08], [1, 0], [0.4, 0.8]);
  const sdfScene = new THREE.Scene();
  sdfScene.add(surfaceView.object);

  // ---- routers ---------------------------------------------------------
  const meshRouter = createGameDeferredScene(meshScene);
  const sdfRouter = createGameDeferredScene(sdfScene);
  meshRouter.register(room, 'mesh', 'full');
  meshRouter.register(cutout, 'mesh', 'full');
  meshRouter.register(forwardSphere, 'forward');
  meshRouter.register(unsupportedMesh, 'mesh');
  meshRouter.register(kitGroup, 'mesh', 'level-only');
  sdfRouter.register(surfaceView.object, 'sdf', 'level-only');
  meshRouter.sync();
  sdfRouter.sync();

  // ---- the shared game light list -----------------------------------------
  const flashSpot = new THREE.SpotLight(0xf0f4ff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
  flashSpot.position.set(0.35, 1.45, 1.1);
  flashSpot.target.position.set(0.35, 1.0, -5);
  const muzzleRig = new THREE.Group();
  muzzleRig.position.set(0.2, 1.35, 0.9);
  const muzzleLight = new THREE.PointLight(0xffcf95, 0, 16, 1.7);
  muzzleLight.position.set(0.1, 0, -0.35);
  muzzleRig.add(muzzleLight);
  const practicals: GameLightCandidate[] = [];
  for (let i = 0; i < 20; i++) {
    const pl = new THREE.PointLight(new THREE.Color(1.0, 0.46, 0.13), 2 + (i % 3), 9, 2);
    pl.position.set(-6 + i * 0.6, 2.7, -1 + (i % 4));
    practicals.push({ id: `fire-${String(i).padStart(2, '0')}`, role: 'practical', light: pl });
  }
  const lightCandidates = (): GameLightCandidate[] => [
    { id: 'flashlight', role: 'flashlight', light: flashSpot },
    { id: 'muzzle', role: 'muzzle', light: muzzleLight },
    ...practicals,
  ];
  meshScene.add(flashSpot, flashSpot.target, muzzleRig);

  // ---- the deferred layer + the task-1 draw hooks --------------------------
  const deferredLayer: DeferredLayer = createDeferredLayer(handle.renderer, {
    width: FIXED_W, height: FIXED_H, sdfScale: 1,
  });
  const camera = handle.camera;
  camera.position.set(...CAMERA_POSE.pos);
  camera.lookAt(...CAMERA_POSE.look);
  camera.updateMatrixWorld();

  let lastLights = { ids: [] as string[], dropped: [] as string[], flashlightIndex: -2, count: 0, flash: [0, 0, 0, 0, 0] as number[] };
  handle.setDrawFn(() => {
    // The per-frame game wiring, exactly as game integration will do it:
    // build the deterministic shared list, upload, draw through the routers.
    const set = buildGameDeferredLights(lightCandidates(), camera.position);
    deferredLayer.setLights(set.lights);
    lastLights = {
      ids: [...set.ids],
      dropped: [...set.dropped],
      flashlightIndex: set.flashlightIndex,
      count: set.lights.length,
      flash: [
        set.flashlightIndex >= 0 ? set.lights[set.flashlightIndex]!.position[0] : NaN,
        set.flashlightIndex >= 0 ? set.lights[set.flashlightIndex]!.position[1] : NaN,
        set.flashlightIndex >= 0 ? set.lights[set.flashlightIndex]!.position[2] : NaN,
        set.flashlightIndex >= 0 ? set.lights[set.flashlightIndex]!.cosInner : NaN,
        set.flashlightIndex >= 0 ? set.lights[set.flashlightIndex]!.cosOuter : NaN,
      ],
    };
    deferredLayer.render(meshScene, sdfScene, camera, {
      drawMesh: () => meshRouter.draw('mesh', handle.renderer, camera),
      drawSdf: () => sdfRouter.draw('sdf', handle.renderer, camera),
    });
  });

  // ---- driver seam ----------------------------------------------------------
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) handle.step(STEP_DT);
  };
  const project = (p: Vec3) => {
    camera.updateMatrixWorld();
    const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const v = new THREE.Vector4(p[0], p[1], p[2], 1).applyMatrix4(proj);
    return {
      pixel: [Math.round(((v.x / v.w + 1) / 2) * FIXED_W), Math.round((1 - v.y / v.w) / 2 * FIXED_H)] as [number, number],
      clipDepth: v.z / v.w,
    };
  };
  const findClass = (
    emission: ReadBuffer, depth: ReadBuffer, x: number, y: number, want: number, k = 14,
  ) => {
    for (let r = 0; r <= k; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= emission.width || py >= emission.height) continue;
          const o = (py * emission.width + px) * 4;
          if (Math.round(emission.data[o + 3]!) === want) {
            return { pixel: [px, py] as [number, number], depth: depth.data[py * depth.width + px]!, cls: want };
          }
        }
      }
    }
    return null;
  };

  /** The EXACT anchor pixel's class and depth — no search window. Empty-
   *  sentinel probes (want 0) must use this: a spiral search would happily
   *  walk off a leaked object and match true background, hiding exactly the
   *  leak it exists to catch. Returns the actual observed class either way
   *  so a failure names what was found instead of the wanted value. */
  const classAt = (emission: ReadBuffer, depth: ReadBuffer, x: number, y: number) => {
    const o = (y * emission.width + x) * 4;
    return { cls: Math.round(emission.data[o + 3]!), depth: depth.data[y * depth.width + x]! };
  };

  let kitAdded = false;
  const api = {
    errors,
    ready: false,
    /** Dev/debug seams for one-off probes. */
    renderer: handle.renderer,
    layer: deferredLayer,
    cameraObj: camera,
    meshScene,
    sdfScene,
    meshRouter,
    sdfRouter,
    surfaceView,
    step,
    addKitChild() {
      if (kitAdded) return 'already';
      // The async kit-load pattern: the mesh arrives under an already
      // registered parent; sync() must discover it.
      const kitChild = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x3a5fa8, roughness: 0.4, metalness: 0.6 }),
      );
      kitChild.position.set(0, 1.0, 0); // kitGroup local == LAYOUT.kitChild
      kitChild.name = 'kit-child';
      kitGroup.add(kitChild);
      meshRouter.sync();
      kitAdded = true;
      return meshRouter.routeOf(kitChild);
    },
    fire(on: boolean) { muzzleLight.intensity = on ? 4 : 0; },
    moveMuzzle() { muzzleRig.position.set(4, 0.5, -2); },
    /** LIVE-TUNING SEAM (M2 review fix): mutate a SOURCE Standard material
     *  exactly the way game-main's setGunTuning does — scalars first, then
     *  needsUpdate = true (three's setter bumps the version counter) — and
     *  report what the source now carries. The G-buffer must follow on the
     *  next draw through the router's cached adapter. */
    tuneFloorMaterial(t: { roughness?: number; metalness?: number }) {
      if (t.roughness !== undefined) floorMaterial.roughness = t.roughness;
      if (t.metalness !== undefined) floorMaterial.metalness = t.metalness;
      floorMaterial.needsUpdate = true;
      return { roughness: floorMaterial.roughness, metalness: floorMaterial.metalness };
    },
    /** RAW surface channels at the floor anchor pixel: roughness is
     *  albedoRoughness.w and metalness is normalMetalness.w (both vec4s are
     *  <vec3 term, scalar> — the scalar is the FOURTH channel, the +3 read
     *  index; index 2 of normalMetalness is the normal's z). Read from the
     *  RESOLVED target — the resolve pass copies producer attachment data
     *  through by nearest depth (the light pass writes to the lit target,
     *  never into resolved), so these are the unlit material terms. */
    async readFloorSurface() {
      const resolved = deferredLayer.targets.resolved;
      const albedoRoughness = await readAttachment(handle, resolved, 'albedoRoughness');
      const normalMetalness = await readAttachment(handle, resolved, 'normalMetalness');
      const { pixel } = project(LAYOUT.floor);
      const o = (pixel[1] * albedoRoughness.width + pixel[0]) * 4;
      return {
        pixel,
        roughness: albedoRoughness.data[o + 3]!,
        metalness: normalMetalness.data[o + 3]!,
      };
    },
    lights() { return lastLights; },
    /** Flashlight entry must be identical before/after moving only the muzzle. */
    muzzleInvariance() {
      const before = buildGameDeferredLights(lightCandidates(), camera.position);
      const flashBefore = before.lights[before.flashlightIndex]!;
      muzzleRig.position.set(9, -7, 3);
      const after = buildGameDeferredLights(lightCandidates(), camera.position);
      const flashAfter = after.lights[after.flashlightIndex]!;
      muzzleRig.position.set(0.2, 1.35, 0.9);
      return JSON.stringify(flashBefore) === JSON.stringify(flashAfter);
    },
    diagnostics(): { mesh: GameDeferredSceneDiagnostics; sdf: GameDeferredSceneDiagnostics } {
      return { mesh: meshRouter.diagnostics(), sdf: sdfRouter.diagnostics() };
    },
    /** Class/depth census of one raw producer target (debug evidence).
     *  Reads the two relevant attachments BY NAME: the class lives in the
     *  emissionClass alpha and the depth in the r32f surfaceDepth. */
    async readTarget(which: 'mesh' | 'sdf' | 'resolved') {
      const target = which === 'mesh' ? deferredLayer.targets.mesh
        : which === 'sdf' ? deferredLayer.targets.sdf : deferredLayer.targets.resolved;
      const emission = await readAttachment(handle, target, 'emissionClass');
      const depth = await readAttachment(handle, target, 'surfaceDepth');
      const counts: Record<string, number> = {};
      for (let i = 3; i < emission.data.length; i += 4) {
        const cls = Math.round(emission.data[i]!);
        counts[String(cls)] = (counts[String(cls)] ?? 0) + 1;
      }
      let dMin = 2, dMax = -1;
      for (let i = 0; i < depth.data.length; i++) {
        const d = depth.data[i]!;
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
      }
      return { counts, dMin, dMax };
    },
    async readSurfaces() {
      const resolved = deferredLayer.targets.resolved;
      // BY NAME (see readAttachment): class from emissionClass alpha, depth
      // from the r32f surfaceDepth — never an index destructure.
      const emission = await readAttachment(handle, resolved, 'emissionClass');
      const depth = await readAttachment(handle, resolved, 'surfaceDepth');
      const classCounts: Record<string, number> = {};
      for (let i = 3; i < emission.data.length; i += 4) {
        const cls = Math.round(emission.data[i]!);
        classCounts[String(cls)] = (classCounts[String(cls)] ?? 0) + 1;
      }
      const want: Record<string, number> = {
        bodyChest: 18, floor: 1, sideWall: 1, cutoutSolid: 1, cutoutHole: 0,
        forwardSphere: 0, unsupportedMesh: 0, helperSphere: 0,
        kitChild: kitAdded ? 17 : 0,
      };
      // 'body' is the spawn root — floor/feet ambiguous, never probed.
      const anchors = Object.entries(LAYOUT).filter(([name]) => name !== 'body').map(([name, p]) => {
        const { pixel, clipDepth } = project(p);
        const inBounds = pixel[0] >= 0 && pixel[0] < emission.width && pixel[1] >= 0 && pixel[1] < emission.height;
        const probe = want[name]!;
        // want 0 → judge the exact anchor pixel (see classAt); anything else
        // may search a small window for its class (projection rounding, the
        // SDF shell sitting a hair in front of the anchor point).
        const hit = !inBounds ? null
          : probe === 0
            ? (() => {
                const at = classAt(emission, depth, pixel[0], pixel[1]);
                return { pixel: [pixel[0], pixel[1]] as [number, number], depth: at.depth, cls: at.cls };
              })()
            : findClass(emission, depth, pixel[0], pixel[1], probe, name === 'bodyChest' ? 24 : 16);
        return { name, world: p, pixel, clipDepth, want: probe, hit };
      });
      return {
        width: resolved.width, height: resolved.height,
        kitAdded, classCounts, anchors,
      };
    },
    dispose() {
      meshRouter.dispose();
      sdfRouter.dispose();
      deferredLayer.dispose();
      surfaceView.dispose();
      for (const d of disposables) d.dispose();
    },
  };
  (window as unknown as { __deferredScene: typeof api }).__deferredScene = api;

  step(2);
  api.ready = true;
}

main().catch((e) => {
  errors.push(String(e?.stack ?? e));
  const el = document.getElementById('errors');
  if (el) el.textContent = String(e?.stack ?? e);
});
