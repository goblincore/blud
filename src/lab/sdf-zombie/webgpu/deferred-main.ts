// src/lab/sdf-zombie/webgpu/deferred-main.ts
//
// The hybrid deferred M1 comparison scene (spec:
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md, plan task 3).
// ONE wounded SDF zombie and a mapped stone room render through TWO pipelines
// from identical body data and parameters:
//
//   legacy   — the shipped path: polygonal pass + createSdfLayer march/composite.
//              Mesh lighting = THREE point lights mirroring the shared list; the
//              SDF march sees its static key light plus ONE moving light (orb 0
//              mirrored into the flashlight uniforms) — the legacy SDF cannot do
//              16 independent lights, which is precisely the feature gap this
//              milestone measures. Labelled as such in diagnostics().
//   deferred — mesh + SDF MRT producers -> depth resolve -> ONE shared light
//              pass (createDeferredLayer). Unshadowed (M1), constant ambient
//              floor, no legacy gamma compensation.
//
// Determinism: ?paused=1 stops the loop for automation; normal launches play
// immediately. Automated frames go through __deferredLab.step(), which uses
// a fixed dt and fences the GPU before returning. Light animation is a pure
// function of lightTime, so setLightTime(t) is an exact freeze and resuming
// continues from t without a jump.
//
// Fixed 800x600 internal buffer (createLabRenderer 'fixed' cap): window resize
// is presentation-only; setResolution() is the explicit target-reallocation
// seam the gate exercises (800x600 -> 640x480 -> 800x600).

import * as THREE from 'three/webgpu';
import { createLabRenderer, setRenderCap, type LabRendererHandle } from './lab-renderer';
import { createSdfLayer, SDF_LAYER, type SdfLayer } from './sdf-layer';
import { createZombieGpuView, type ZombieGpuView } from './zombie-gpu';
import {
  createDeferredLayer, type DeferredDebugView, type DeferredLayer,
} from './deferred-layer';
import { createDeferredMeshMaterial } from './deferred-mesh';
import {
  MAX_DEFERRED_LIGHTS, type DeferredLight,
} from './deferred-lighting';
import {
  SURFACE_ATTACHMENT_NAMES, decodeSurfaceClass,
} from './deferred-surface';
import {
  DEFERRED_ENVIRONMENT_DEFAULTS, type DeferredEnvironment,
} from './deferred-layer';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import { stoneTextures } from '../../../game/level/stone-textures';
import type { Vec3 } from '../types';
import zombieBlobSrc from '../characters/zombie.blob?raw';

/** The fixed internal buffer — the current game's default render cap. */
const FIXED_W = 800;
const FIXED_H = 600;
/** Fixed dt for stepped frames (determinism). */
const STEP_DT = 1 / 60;

/** The zombie-flat sheet registry entry, mirrored from lab-main/bench-main
 *  (zombie.blob declares no sheet block — this IS its face pipeline). */
const ZOMBIE_FLAT = {
  url: '/assets/lab/zombie-face.png',
  rect: [0, 0, 64, 64, 64, 64] as const,
  mean: 0.406,
};
const FACE_PROJ: [number, number, number, number] = [0.45, 0.58, 0.5, 0.56];

/** A stable torso wound pair — a blast crater plus a pellet nick above it,
 *  deep enough to expose wound depth/tissue in the close-up pose. World
 *  space; the zombie stands at the origin facing +z. */
const WOUND = {
  positions: [[0.06, 1.26, 0.16], [-0.07, 1.38, 0.13]] as Vec3[],
  radii: [0.15, 0.08],
  /** 1 = blast, 0 = pellet (lab-main TYPE_ID). */
  types: [1, 0],
  ages: [0.4, 0.8],
};

type CameraPoseName = 'overview' | 'mesh-front' | 'sdf-front' | 'wound';

/** Fixed camera poses. mesh-front puts the pillar between camera and zombie
 *  (mesh occludes flesh); sdf-front puts the zombie between camera and pillar
 *  (flesh occludes mesh); wound is the chest-crater close-up. */
const CAMERA_POSES: Record<CameraPoseName, { pos: Vec3; look: Vec3 }> = {
  // overview must see the WHOLE zombie: the original (1.9, 1.95, 3.7) put the
  // pillar dead on the camera->zombie line (x=0.539 at the pillar's z, pillar
  // spans 0.35..0.75) and hid the body behind it. This side keeps the pillar
  // and crate in frame but off the sightline.
  overview: { pos: [-2.2, 2.0, 3.3], look: [0.1, 1.0, 0] },
  // mesh-front must genuinely interpose the pillar WITHOUT swallowing the
  // whole body: from (1.5, 2.1) the pillar subtends ~16° centred 7° off the
  // zombie axis, covering the body's right ~60% (mesh occludes flesh) while
  // the left ~40% stays visible (flesh beats the far wall) in the SAME frame.
  // The original (-0.5, 3.0) missed the pillar entirely (x=0.007 at its
  // depth); (1.6, 2.9) hid all but 19 px of flesh.
  'mesh-front': { pos: [1.5, 1.5, 2.1], look: [0, 1.15, 0] },
  'sdf-front': { pos: [0.42, 1.5, -2.9], look: [0.5, 1.15, 0.6] },
  wound: { pos: [0.16, 1.44, 1.02], look: [0.04, 1.24, 0.1] },
};

/** The room the orbs fly in. Bounds the orb paths must stay inside. */
const ROOM = { half: 3.6, height: 3.0 };
/** The pillar — the mesh occluder for the occlusion poses. */
const PILLAR = { x: 0.55, z: 1.05, r: 0.2 };

/** Orb palette: amber, cyan, magenta, repeating with a slight per-index tint. */
const ORB_COLORS: Vec3[] = [
  [1.0, 0.55, 0.14],
  [0.2, 0.8, 1.0],
  [1.0, 0.25, 0.65],
];

/**
 * Deterministic closed orb paths, contained in the room. Orbs 0-2 are
 * authored: 0 circles the wounded torso closely, 1 sweeps the floor wide, 2
 * bobs up and down past the pillar. 3..15 generalize the same lissajous with
 * per-index phases/frequencies, so the 8/16-light comparisons are also fully
 * deterministic. One source of state drives BOTH the marker mesh and the
 * shared light buffer entry (plan step 2b).
 */
export function orbPosition(index: number, t: number): Vec3 {
  if (index === 0) {
    const a = 0.9 * t;
    return [
      1.05 * Math.sin(a),
      1.3 + 0.42 * Math.sin(1.7 * t + 1.1),
      1.05 * Math.cos(a),
    ];
  }
  if (index === 1) {
    const a = 0.62 * t + 2.1;
    return [
      2.9 * Math.sin(a),
      0.55 + 0.3 * Math.sin(1.9 * t),
      2.9 * Math.cos(a),
    ];
  }
  if (index === 2) {
    const a = 0.5 * t + 4.2;
    return [
      PILLAR.x + 0.6 * Math.sin(a),
      1.55 + 1.05 * Math.sin(1.15 * t + 0.6),
      PILLAR.z + 0.6 * Math.cos(a),
    ];
  }
  const i = index - 3;
  const w = 0.45 + 0.11 * (i % 5);
  const p = i * 1.7 + 0.4;
  const r = 1.2 + 0.55 * (i % 4);
  return [
    r * Math.sin(w * t + p),
    1.5 + (0.5 + 0.22 * (i % 3)) * Math.sin((0.9 + 0.17 * (i % 4)) * t + p * 1.3),
    r * Math.cos(w * t + p * 0.7),
  ];
}

function orbColor(index: number): Vec3 {
  const c = ORB_COLORS[index % ORB_COLORS.length]!;
  const tint = 1 - 0.08 * Math.floor(index / ORB_COLORS.length);
  return [c[0] * tint, c[1] * tint, c[2] * tint];
}

/** Orb index -> shared point light, matching the legacy mesh lights. */
function orbLight(index: number, t: number): DeferredLight {
  const position = orbPosition(index, t);
  return {
    kind: 'point',
    position,
    direction: [0, -1, 0],
    color: orbColor(index),
    intensity: 2,
    range: 7,
    cosInner: 0.92,
    cosOuter: 0.75,
  };
}

/** The skull's centre and semi-axes (lab-main's headShape, mirrored verbatim
 *  via bench-main: it normalises the face projection). */
function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find((c) => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  for (const p of b.prims.slice(head.start, head.start + head.count)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
    }
  }
  return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
}

/** Half-float decode (the G-buffer's rgba16f attachments read back as u16). */
function decodeHalf(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? Number.NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** FNV-1a over the bit patterns of a float buffer — the exact-equality hash
 *  the light-invariance check uses. */
function fnv1a(data: Float32Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.byteLength; i++) {
    h ^= view.getUint8(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

interface ReadBuffer { width: number; height: number; channels: number; data: Float32Array }

/**
 * Reads one attachment of a render target to a Float32Array, unpacking
 * three's 256-byte-row-padded copy (the task-2 trap: at 800px an r32f row is
 * 3200 B but the padded stride is 3328 B — tight indexing misreads every row
 * after the first). Row 0 is the TOP of the frame (verified against CPU
 * projection in the task-1/2 smokes).
 */
async function readAttachment(
  handle: LabRendererHandle,
  target: THREE.RenderTarget,
  name: string,
): Promise<ReadBuffer> {
  const textureIndex = target.textures.findIndex((t) => t.name === name);
  if (textureIndex < 0) throw new Error(`target is missing attachment '${name}'`);
  return readTextureIndex(handle, target, textureIndex);
}

async function readTextureIndex(
  handle: LabRendererHandle,
  target: THREE.RenderTarget,
  textureIndex: number,
): Promise<ReadBuffer> {
  const tex = target.textures[textureIndex] ?? target.texture;
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

function buildRoomMeshes(deferred: boolean): { group: THREE.Group; disposables: { dispose(): void }[] } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const wallTex = stoneTextures('wallBrick', 11);
  const floorTex = stoneTextures('floorCobble', 23);
  const ceilTex = stoneTextures('ceilingVault', 37);
  const mkMat = (tex: ReturnType<typeof stoneTextures>, repeat: number, extra: Partial<{
    color: number; roughness: number; metalness: number;
    emissive: number; emissiveIntensity: number;
  }> = {}) => {
    for (const t of [tex.map, tex.normalMap, tex.roughnessMap]) {
      t.repeat.set(repeat, repeat);
    }
    const std = new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap,
      color: extra.color ?? 0xffffff,
      roughness: extra.roughness ?? 1.0,
      metalness: extra.metalness ?? 0.0,
      emissive: extra.emissive ?? 0x000000,
      emissiveIntensity: extra.emissiveIntensity ?? 1,
    });
    disposables.push(std);
    return deferred ? createDeferredMeshMaterial(std) : std;
  };
  const add = (mesh: THREE.Mesh) => { group.add(mesh); disposables.push(mesh.geometry); };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.half * 2, ROOM.half * 2),
    mkMat(floorTex, 3, { roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  add(floor);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.half * 2, ROOM.half * 2),
    mkMat(ceilTex, 2, { roughness: 1 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.height;
  add(ceil);

  const wallGeo = () => new THREE.PlaneGeometry(ROOM.half * 2, ROOM.height);
  const walls: [Vec3, number][] = [
    [[0, ROOM.height / 2, -ROOM.half], 0],
    [[0, ROOM.height / 2, ROOM.half], Math.PI],
    [[-ROOM.half, ROOM.height / 2, 0], Math.PI / 2],
    [[ROOM.half, ROOM.height / 2, 0], -Math.PI / 2],
  ];
  for (const [pos, yaw] of walls) {
    const wall = new THREE.Mesh(wallGeo(), mkMat(wallTex, 2, { roughness: 0.95 }));
    wall.position.set(...pos);
    wall.rotation.y = yaw;
    add(wall);
  }

  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(PILLAR.r, PILLAR.r * 1.15, ROOM.height, 20),
    mkMat(wallTex, 1, { color: 0xb8c0c8, roughness: 0.85 }),
  );
  pillar.position.set(PILLAR.x, ROOM.height / 2, PILLAR.z);
  add(pillar);

  // A low crate, so 'overview' has a second mesh/flesh depth interaction.
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.55, 0.55),
    mkMat(floorTex, 1, { color: 0xc8b89a, roughness: 0.8 }),
  );
  crate.position.set(-1.35, 0.275, 0.7);
  crate.rotation.y = 0.4;
  add(crate);

  return { group, disposables };
}

async function main() {
  const mount = document.getElementById('app');
  const statusEl = document.getElementById('status');
  const errorsEl = document.getElementById('errors');
  if (!mount) throw new Error('missing #app mount');
  const errors: string[] = [];
  const recordError = (msg: string) => {
    errors.push(msg);
    if (errorsEl) errorsEl.textContent = errors.slice(-12).join('\n');
  };
  window.addEventListener('error', (e) => recordError(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => recordError(String(e.reason)));

  const params = new URLSearchParams(location.search);
  let mode: 'legacy' | 'deferred' = params.get('mode') === 'legacy' ? 'legacy' : 'deferred';

  const handle = await createLabRenderer(mount, { mode: 'fixed', width: FIXED_W, height: FIXED_H });
  // Keep warmup deterministic; normal launches start animation once ready.
  handle.setLoopRunning(false);

  // Surface GPU validation errors that never touch the console as JS errors.
  // (Structural types: this tsconfig has no WebGPU DOM lib.)
  interface MinimalDevice {
    features?: { has(f: string): boolean };
    queue?: { onSubmittedWorkDone(): Promise<void> };
    addEventListener?: (type: string, cb: (e: { error: { message: string } }) => void) => void;
  }
  const device = (handle.renderer.backend as unknown as { device?: MinimalDevice }).device;
  device?.addEventListener?.('uncapturederror', (e) => {
    recordError(`webgpu: ${e.error.message}`);
  });

  const completeGpu = async () => {
    if (!device?.queue) throw new Error('WebGPU queue completion unavailable');
    await device.queue.onSubmittedWorkDone();
    await handle.resolveGpu(); // drain optional timestamp queries as well
  };

  // ---- body: the authored lab zombie, ONE BuildResult, TWO views ----------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const compiled = compileBlob(doc, face);
  const built = buildBody(compiled, DEFAULT_BUILD_OPTS, {});
  for (const err of built.errors) recordError(`body: ${err}`);
  const body = translateBody(built, [0, 0, 0]);
  const flesh = { ...FLESH_PRESETS['henenlotter-latex'] };
  const lightPreset = LIGHT_PRESETS['practical-hard-key'];

  const faceTex = await new Promise<THREE.Texture>((res) => {
    const t = new THREE.TextureLoader().load(ZOMBIE_FLAT.url, () => res(t), undefined, () => res(t));
  });
  faceTex.magFilter = THREE.NearestFilter;
  faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  faceTex.flipY = true;
  const [fx, fy, fw, fh, fsw, fsh] = ZOMBIE_FLAT.rect;
  const faceAtlas = new THREE.Vector4(fw / fsw, fh / fsh, fx / fsw, fy / fsh);
  const skull = headShape(body);

  const dressView = (v: ZombieGpuView) => {
    v.applyMaterial(flesh, lightPreset);
    v.setFaceTexture(faceTex, faceAtlas, ZOMBIE_FLAT.mean);
    v.uniforms.faceCfg.value.x = 1; // multiplier sheet
    v.uniforms.faceCfg.value.y = 1.0;
    v.uniforms.faceProj.value.set(...FACE_PROJ);
    if (skull) v.setHeadShape(skull.centre, skull.axes);
  };

  // Legacy lit view (rendered through createSdfLayer) and the surface-mode
  // view (the deferred SDF producer). Identical body data and parameters.
  const legacyView = createZombieGpuView(body, {});
  dressView(legacyView);
  legacyView.object.layers.set(SDF_LAYER);
  const surfaceView = createZombieGpuView(body, { output: 'surface' });
  dressView(surfaceView);

  let wounded = true;
  const applyWounds = () => {
    for (const v of [legacyView, surfaceView]) {
      if (wounded) v.setWounds(WOUND.positions, WOUND.radii, WOUND.types, WOUND.ages);
      else v.setWounds([], [], [], []);
    }
  };
  applyWounds();

  // ---- scenes ---------------------------------------------------------------
  // Deferred: mesh producer scene (room + orb markers, adapted materials, NO
  // lights — the producer is unlit by construction) and the SDF producer scene
  // (the surface view alone). Legacy: one scene with the room/orb meshes, the
  // lit view on SDF_LAYER, and real THREE lights mirroring the shared list.
  const meshScene = new THREE.Scene();
  // Deliberate Color background: exercises the coordinator fix-3 suppression
  // on the REAL backend — if backgrounds leaked into the producer pass, every
  // empty pixel would read as a near-surface mesh hit and the gate's coverage
  // and resolve checks would fail loudly.
  meshScene.background = new THREE.Color(0x1a1116);
  const sdfScene = new THREE.Scene();
  sdfScene.add(surfaceView.object);
  const legacyScene = new THREE.Scene();
  legacyScene.background = new THREE.Color(0x1a1116);
  legacyScene.add(legacyView.object);
  legacyScene.add(new THREE.AmbientLight(0xffffff, 0.05));

  const roomDef = buildRoomMeshes(true);
  meshScene.add(roomDef.group);
  const roomLeg = buildRoomMeshes(false);
  legacyScene.add(roomLeg.group);

  // ---- orbs: marker meshes + shared light state, ONE source -----------------
  const orbGeo = new THREE.SphereGeometry(0.05, 16, 12);
  interface OrbSlot {
    defMesh: THREE.Mesh;
    legMesh: THREE.Mesh;
    legLight: THREE.PointLight;
  }
  const orbSlots: OrbSlot[] = [];
  for (let i = 0; i < MAX_DEFERRED_LIGHTS; i++) {
    const color = orbColor(i);
    const std = new THREE.MeshStandardMaterial({
      color: 0x000000, roughness: 0.4, metalness: 0,
      emissive: new THREE.Color(...color), emissiveIntensity: 1.5,
    });
    const legMesh = new THREE.Mesh(orbGeo, std);
    legacyScene.add(legMesh);
    const defMesh = new THREE.Mesh(orbGeo, createDeferredMeshMaterial(std));
    meshScene.add(defMesh);
    const legLight = new THREE.PointLight(new THREE.Color(...color), 2, 7, 2);
    legacyScene.add(legLight);
    orbSlots.push({ defMesh, legMesh, legLight });
  }

  // ---- layers ---------------------------------------------------------------
  let sdfScale = 1;
  const deferredLayer = createDeferredLayer(handle.renderer, {
    width: FIXED_W, height: FIXED_H, sdfScale,
  });
  const sdfLayer: SdfLayer = createSdfLayer(handle.renderer);
  sdfLayer.setSize(FIXED_W, FIXED_H);
  sdfLayer.setScale(sdfScale);
  // The fixture's views bind no pre-passes; keep every accelerator off so the
  // legacy march is the plain production march at the chosen scale.
  sdfLayer.setConeEnabled(false);
  sdfLayer.setOccluderEnabled(false);
  sdfLayer.setShellEnabled(false);
  sdfLayer.setDepthPreEnabled(false);
  sdfLayer.setHalfRate(false);

  // ---- camera ---------------------------------------------------------------
  const camera = handle.camera;

  // ---- M2 task 1: output-target composition fixtures ------------------------
  // Owned by the page (never the layer): the offscreen present target the
  // composition smoke presents into, an EMPTY mesh scene for frame B, and the
  // three forward quads drawn INTO the presented frame. All disposed with the
  // page (see the unload teardown).
  const FORWARD_QUAD_SIZE = 0.06;
  const compTarget = new THREE.RenderTarget(FIXED_W, FIXED_H, {
    depthBuffer: true,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  compTarget.texture.colorSpace = THREE.NoColorSpace; // linear, like the game scene target
  compTarget.texture.generateMipmaps = false;
  const emptyMeshScene = new THREE.Scene();
  const forwardScene = new THREE.Scene();
  const forwardMat = new THREE.MeshBasicNodeMaterial();
  forwardMat.color.setRGB(4, 4, 4); // unlit HDR white — reads over any lit surface
  forwardMat.depthTest = true; // THE point: compose against the presented depth
  forwardMat.depthWrite = true;
  const forwardQuadGeom = new THREE.PlaneGeometry(FORWARD_QUAD_SIZE, FORWARD_QUAD_SIZE);
  const mkForwardQuad = (name: string) => {
    const mesh = new THREE.Mesh(forwardQuadGeom, forwardMat);
    mesh.name = name;
    mesh.visible = false;
    mesh.frustumCulled = false;
    forwardScene.add(mesh);
    return mesh;
  };
  const forwardFront = mkForwardQuad('forward-front');
  const forwardBehind = mkForwardQuad('forward-behind');
  const forwardFar = mkForwardQuad('forward-far');
  let pose: CameraPoseName = 'overview';
  const applyPose = (name: CameraPoseName) => {
    pose = name;
    const p = CAMERA_POSES[name];
    camera.position.set(...p.pos);
    camera.lookAt(...p.look);
    camera.updateMatrixWorld();
  };
  applyPose('overview');

  // ---- lights ---------------------------------------------------------------
  let lightCount = 3;
  let lightTime = 0;
  let lightsAnimated = true;
  let orbsVisible = true;
  // Verification seam: a caller-supplied light list replaces the orb-driven
  // one (null = back to orbs). Needed so the gate can isolate ONE tight spot
  // for the world-reconstruction centroid check. Marker meshes keep following
  // orbPosition regardless; only the light buffer is swapped.
  let customLights: DeferredLight[] | null = null;

  const updateLights = () => {
    const lights: DeferredLight[] = customLights
      ? customLights
      : Array.from({ length: lightCount }, (_, i) => orbLight(i, lightTime));
    deferredLayer.setLights(lights);
    for (let i = 0; i < MAX_DEFERRED_LIGHTS; i++) {
      const slot = orbSlots[i]!;
      const active = i < lightCount;
      const pos = orbPosition(i, lightTime);
      slot.defMesh.position.set(...pos);
      slot.legMesh.position.set(...pos);
      slot.defMesh.visible = active && orbsVisible;
      slot.legMesh.visible = active && orbsVisible;
      slot.legLight.visible = active;
      slot.legLight.position.set(...pos);
      const c = orbColor(i);
      slot.legLight.color.setRGB(c[0], c[1], c[2]);
    }
    // Legacy SDF: ONE moving light — orb 0 mirrored into the march's
    // flashlight uniforms (the legacy march has no multi-light slot; this is
    // the labelled feature gap, not a parity attempt).
    const l0 = orbLight(0, lightTime);
    legacyView.uniforms.spotPos.value.set(...l0.position);
    const chest = new THREE.Vector3(0, 1.2, 0);
    legacyView.uniforms.spotAxis.value
      .copy(chest).sub(new THREE.Vector3(...l0.position)).normalize();
    legacyView.uniforms.spotCfg.value.set(
      lightCount > 0 ? l0.intensity : 0, l0.cosInner, l0.cosOuter, l0.range,
    );
    legacyView.uniforms.spotColor.value.setRGB(...l0.color);
    // Keep the marched key light gentle so the moving light reads on flesh.
    legacyView.uniforms.lightCfg.value.set(1.1, 0.06);
  };
  updateLights();

  // ---- frame ----------------------------------------------------------------
  const draw = () => {
    if (mode === 'deferred') {
      deferredLayer.render(meshScene, sdfScene, camera);
    } else {
      sdfLayer.render(legacyScene, camera);
    }
  };
  handle.setRenderCallback((dt) => {
    if (lightsAnimated) {
      lightTime += dt;
      updateLights();
    }
  });
  handle.setDrawFn(draw);

  // ---- readback helpers -------------------------------------------------------
  const sampleAt = (buf: ReadBuffer, x: number, y: number): number[] => {
    const c = buf.channels;
    const o = (y * buf.width + x) * c;
    return Array.from(buf.data.slice(o, o + c));
  };

  interface SurfaceReport {
    width: number; height: number; mode: string; sdfScale: number;
    coverage: Record<string, number>;
    hashes: Record<string, string>;
    litMean: Record<string, number>;
    probes: { x: number; y: number; cls: number; depth: number; albedo: number[]; normal: number[]; emission: number[]; lit: number[] }[];
    resolveCheck?: { pixels: number; mismatches: number; overlapMeshWins: number; overlapSdfWins: number; examples: unknown[] };
  }

  const readSurfaces = async (opts: { probes?: [number, number][]; resolveCheck?: boolean } = {}): Promise<SurfaceReport> => {
    if (mode !== 'deferred') throw new Error('readSurfaces reads the deferred G-buffer — setMode("deferred") first');
    const resolved = deferredLayer.targets.resolved;
    const w = resolved.width;
    const h = resolved.height;
    const [albedo, normal, emission, depth] = (await Promise.all(
      SURFACE_ATTACHMENT_NAMES.map((n) => readAttachment(handle, resolved, n)),
    )) as [ReadBuffer, ReadBuffer, ReadBuffer, ReadBuffer];
    const lit = await readTextureIndex(handle, deferredLayer.targets.lit, 0);

    const coverage: Record<string, number> = { empty: 0, mesh: 0, flesh: 0, flat: 0, other: 0 };
    const litSum: Record<string, number> = { mesh: 0, flesh: 0 };
    const litN: Record<string, number> = { mesh: 0, flesh: 0 };
    for (let i = 0; i < w * h; i++) {
      // M2 task 1: report the DECODED base class (producers may pack a shadow
      // receiver into bit 4; default M1 classes decode to themselves).
      const cls = decodeSurfaceClass(Math.round(emission.data[i * 4 + 3]!)).baseClass;
      const key = cls === 0 ? 'empty' : cls === 1 ? 'mesh' : cls === 2 ? 'flesh' : cls === 3 ? 'flat' : 'other';
      coverage[key]!++;
      if (cls === 1 || cls === 2) {
        const k = cls === 1 ? 'mesh' : 'flesh';
        litSum[k]! += 0.2126 * lit.data[i * 4]! + 0.7152 * lit.data[i * 4 + 1]! + 0.0722 * lit.data[i * 4 + 2]!;
        litN[k]!++;
      }
    }
    const report: SurfaceReport = {
      width: w, height: h, mode, sdfScale,
      coverage,
      hashes: {
        albedo: fnv1a(albedo.data), normal: fnv1a(normal.data),
        emission: fnv1a(emission.data), depth: fnv1a(depth.data),
        lit: fnv1a(lit.data),
      },
      litMean: {
        mesh: litN.mesh ? litSum.mesh! / litN.mesh! : 0,
        flesh: litN.flesh ? litSum.flesh! / litN.flesh! : 0,
      },
      probes: (opts.probes ?? []).map(([x, y]) => ({
        x, y,
        cls: decodeSurfaceClass(Math.round(emission.data[(y * w + x) * 4 + 3]!)).baseClass,
        depth: depth.data[y * w + x]!,
        albedo: sampleAt(albedo, x, y),
        normal: sampleAt(normal, x, y),
        emission: sampleAt(emission, x, y),
        lit: sampleAt(lit, x, y),
      })),
    };

    if (opts.resolveCheck) {
      // CPU re-resolve from the PRODUCER targets: for every pixel, the
      // resolved class/depth must equal selectSurface(meshDepth, sdfDepth)
      // with the shader's exact nearest low-res mapping
      // (floor((px+0.5) * sdfW/w) — px carries the pixel center).
      const meshT = deferredLayer.targets.mesh;
      const sdfT = deferredLayer.targets.sdf;
      const [mDepth, mEmission, sDepth, sEmission] = (await Promise.all([
        readAttachment(handle, meshT, 'surfaceDepth'),
        readAttachment(handle, meshT, 'emissionClass'),
        readAttachment(handle, sdfT, 'surfaceDepth'),
        readAttachment(handle, sdfT, 'emissionClass'),
      ])) as [ReadBuffer, ReadBuffer, ReadBuffer, ReadBuffer];
      const sw = sdfT.width;
      const sh = sdfT.height;
      let mismatches = 0;
      let overlapMeshWins = 0;
      let overlapSdfWins = 0;
      const examples: unknown[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / w));
          const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / h));
          const md = mDepth.data[y * w + x]!;
          const sd = sDepth.data[sy * sw + sx]!;
          const expectCls = md < 1 && md <= sd
            ? Math.round(mEmission.data[(y * w + x) * 4 + 3]!)
            : sd < 1 ? Math.round(sEmission.data[(sy * sw + sx) * 4 + 3]!) : 0;
          const expectDepth = md < 1 && md <= sd ? md : sd < 1 ? sd : 1;
          const gotCls = Math.round(emission.data[(y * w + x) * 4 + 3]!);
          const gotDepth = depth.data[y * w + x]!;
          if (md < 1 && sd < 1) {
            if (md <= sd) overlapMeshWins++;
            else overlapSdfWins++;
          }
          if (gotCls !== expectCls || Math.abs(gotDepth - expectDepth) > 1e-6) {
            mismatches++;
            if (examples.length < 8) {
              examples.push({ x, y, md, sd, expectCls, gotCls, expectDepth, gotDepth });
            }
          }
        }
      }
      report.resolveCheck = { pixels: w * h, mismatches, overlapMeshWins, overlapSdfWins, examples };
    }
    return report;
  };

  /** Legacy SDF hit depths from the march target's alpha channel (clip depth;
   *  1 = miss), strided-sampled for the legacy/deferred depth comparison. */
  const readLegacySdf = async () => {
    if (mode !== 'legacy') throw new Error('readLegacySdf reads the legacy march target — setMode("legacy") first');
    const buf = await readTextureIndex(handle, sdfLayer.marchTarget, 0);
    const { width: w, height: h, data } = buf;
    let hits = 0;
    const samples: [number, number, number][] = [];
    const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 2048)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = data[(y * w + x) * 4 + 3]!;
        if (d < 1) {
          hits++;
          if (x % stride === 0 && y % stride === 0) samples.push([x, y, d]);
        }
      }
    }
    return { width: w, height: h, hits, samples: samples.slice(0, 2048) };
  };

  // ---- the debugging seam -----------------------------------------------------
  let ready = false;
  let running = false;
  let debugView: DeferredDebugView = 'lit';
  let syncControls = () => {};
  const refresh = () => { syncControls(); if (ready && !running) draw(); };
  const api = {
    get ready() { return ready; },
    setMode(next: 'legacy' | 'deferred') {
      if (next !== 'legacy' && next !== 'deferred') throw new RangeError(`unknown mode '${next}'`);
      mode = next;
      refresh();
    },
    setSdfScale(scale: number) {
      if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw new RangeError(`bad sdf scale ${scale}`);
      sdfScale = scale;
      deferredLayer.resize(handle.canvas.width, handle.canvas.height, sdfScale);
      sdfLayer.setScale(sdfScale);
      refresh();
    },
    setResolution(width: number, height: number) {
      setRenderCap({ mode: 'fixed', width, height });
      window.dispatchEvent(new Event('resize'));
      deferredLayer.resize(width, height, sdfScale);
      sdfLayer.setSize(width, height);
      refresh();
    },
    setDebugView(view: DeferredDebugView) { debugView = view; deferredLayer.setDebugView(view); refresh(); },
    setLoopRunning(enabled: boolean) { running = enabled; handle.setLoopRunning(enabled); refresh(); },
    setLightCount(count: number) {
      if (!Number.isInteger(count) || count < 1 || count > MAX_DEFERRED_LIGHTS) {
        throw new RangeError(`light count must be 1..${MAX_DEFERRED_LIGHTS}, got ${count}`);
      }
      lightCount = count;
      customLights = null;
      updateLights();
      refresh();
    },
    setLightTime(seconds: number) {
      if (!Number.isFinite(seconds)) throw new RangeError(`bad light time ${seconds}`);
      lightTime = seconds;
      lightsAnimated = false; // an exact freeze: resume continues from here
      customLights = null;
      updateLights();
      refresh();
    },
    setLightsAnimated(enabled: boolean) {
      lightsAnimated = enabled; // resumes from lightTime — no jump
      refresh();
    },
    setOrbsVisible(visible: boolean) {
      orbsVisible = visible; // marker meshes only — the light buffer is untouched
      updateLights();
      refresh();
    },
    setWounded(enabled: boolean) {
      wounded = enabled;
      applyWounds();
      refresh();
    },
    setCameraPose(next: CameraPoseName) {
      if (!(next in CAMERA_POSES)) throw new RangeError(`unknown pose '${next}'`);
      applyPose(next);
      refresh();
    },
    async step(frames: number) {
      for (let i = 0; i < frames; i++) handle.step(STEP_DT);
      await completeGpu();
    },
    diagnostics() {
      return {
        ready, mode, pose, sdfScale, lightCount, lightsAnimated, lightTime, orbsVisible, wounded, running,
        backend: handle.backend,
        canvas: { width: handle.canvas.width, height: handle.canvas.height },
        layer: deferredLayer.diagnostics(),
        timestampQuery: device?.features?.has('timestamp-query') ?? false,
        features: {
          deferredShadows: false,
          deferredAmbient: 'constant 0.05 floor (no probes/bounce in M1)',
          transparency: false,
          legacySdfMovingLights: 1, // orb 0 via the flashlight uniforms
          legacySdfStaticKey: true,
          legacyMeshLights: 'THREE PointLights mirroring the shared list (different falloff law)',
          legacyPostChain: 'none (no post-aa/FXAA in this fixture)',
        },
        errors,
      };
    },
    readSurfaces,
    readLegacySdf,
    /** Generated fragment WGSL of the surface-mode march material, for the
     *  one-trace-per-fragment structural check. */
    async surfaceShader() {
      const dbg = handle.renderer.debug as unknown as {
        getShaderAsync: (scene: THREE.Scene, cam: THREE.Camera, obj: THREE.Object3D) => Promise<{ fragmentShader?: string }>;
      };
      // getShaderAsync builds its render context from the renderer's CURRENT
      // target. Against the canvas (null target) the material's mrtNode is
      // compiled out and the readback fns never appear — the shader then
      // looks like a single-output march, which is NOT what the producer
      // pass runs. Point the renderer at the real 4-attachment SDF target so
      // the returned WGSL is the actual MRT pipeline, then restore.
      const prev = handle.renderer.getRenderTarget();
      handle.renderer.setRenderTarget(deferredLayer.targets.sdf);
      try {
        const out = await dbg.getShaderAsync(sdfScene, camera, surfaceView.object);
        return out.fragmentShader ?? '';
      } finally {
        handle.renderer.setRenderTarget(prev);
      }
    },
    /** World positions and projected pixels of the orb markers, for the
     *  marker/light alignment and occlusion checks. */
    orbState() {
      camera.updateMatrixWorld();
      const w = handle.canvas.width;
      const h = handle.canvas.height;
      const v = new THREE.Vector4();
      const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      return {
        time: lightTime,
        orbs: Array.from({ length: lightCount }, (_, i) => {
          const position = orbPosition(i, lightTime);
          v.set(position[0], position[1], position[2], 1).applyMatrix4(proj);
          const ndcZ = v.z / v.w;
          const px = (v.x / v.w + 1) / 2 * w;
          const py = (1 - v.y / v.w) / 2 * h;
          return {
            index: i, position, color: orbColor(i),
            pixel: [px, py] as [number, number],
            clipDepth: ndcZ,
            onScreen: px >= 0 && px < w && py >= 0 && py < h && ndcZ >= 0 && ndcZ <= 1,
          };
        }),
      };
    },
    /** World -> pixel through the page camera (three's own matrix math — the
     *  independent reference for the GPU world-reconstruction centroid check).
     *  Pixel coords are top-left origin, .5 = pixel center. */
    projectWorld(p: Vec3) {
      camera.updateMatrixWorld();
      const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const v = new THREE.Vector4(p[0], p[1], p[2], 1).applyMatrix4(proj);
      const w = handle.canvas.width;
      const h = handle.canvas.height;
      const px = (v.x / v.w + 1) / 2 * w;
      const py = (1 - v.y / v.w) / 2 * h;
      return {
        pixel: [px, py] as [number, number],
        clipDepth: v.z / v.w,
        onScreen: px >= 0 && px < w && py >= 0 && py < h,
      };
    },
    /** Caller-supplied light list replacing the orb-driven one (null restores
     *  orb drive). Pauses light animation. For the isolated-spot world
     *  reconstruction check. */
    setCustomLights(lights: DeferredLight[] | null) {
      customLights = lights;
      if (lights) lightsAnimated = false;
      updateLights();
      refresh();
    },

    // ---- M2 task 1 seams --------------------------------------------------
    /** Lit-stage environment (ambient + distance fog). null restores the M1
     *  defaults exactly. Arrays are [r, g, b] linear. */
    setLayerEnvironment(env: {
      ambient: [number, number, number];
      fogColor: [number, number, number];
      fogNear: number;
      fogFar: number;
      fogEnabled: boolean;
    } | null) {
      const toColor = (a: [number, number, number]) => new THREE.Color(a[0], a[1], a[2]);
      const value: DeferredEnvironment = env
        ? {
            ambient: toColor(env.ambient),
            fogColor: toColor(env.fogColor),
            fogNear: env.fogNear,
            fogFar: env.fogFar,
            fogEnabled: env.fogEnabled,
          }
        : {
            ambient: DEFERRED_ENVIRONMENT_DEFAULTS.ambient.clone(),
            fogColor: DEFERRED_ENVIRONMENT_DEFAULTS.fogColor.clone(),
            fogNear: DEFERRED_ENVIRONMENT_DEFAULTS.fogNear,
            fogFar: DEFERRED_ENVIRONMENT_DEFAULTS.fogFar,
            fogEnabled: DEFERRED_ENVIRONMENT_DEFAULTS.fogEnabled,
          };
      deferredLayer.setEnvironment(value);
      refresh();
    },
    /** RESERVED flashlight shadow binding (M2 task 4). Stored by the layer;
     *  nothing samples it — the GPU gate pins that binding changes no output.
     *  Plain JSON-able input: the page builds the THREE objects (textures are
     *  dummies until task 4 owns real shadow maps). */
    setSpotShadowBinding(binding: {
      lightIndex: number;
      bias: number;
      mapSize: [number, number];
      enabled: boolean;
    } | null) {
      deferredLayer.setFlashlightShadow(binding === null ? null : {
        fullDepth: new THREE.Texture(),
        levelDepth: new THREE.Texture(),
        viewProjection: new THREE.Matrix4(),
        lightIndex: binding.lightIndex,
        bias: binding.bias,
        mapSize: new THREE.Vector2(binding.mapSize[0], binding.mapSize[1]),
        enabled: binding.enabled,
      });
      refresh();
    },
    /**
     * The task-1 output-target composition smoke, entirely in-page and
     * deterministic (caller freezes lights and picks a pose first — the gate
     * uses 'wound' with orbs hidden):
     *
     * Frame A — the layer presents into an OWNED color+depth target, then a
     *   known forward white quad is drawn INTO that target with depth tests,
     *   in front of the chest (must win) and behind it (must be occluded by
     *   the presented body depth — the behind quad sits on a separate,
     *   in-page-computed pixel so the front quad cannot mask it).
     * Frame B — the same with an EMPTY mesh scene, so the body silhouette
     *   leaves truly empty pixels (depth 1): a forward quad there must be
     *   visible, proving empty pixels wrote far depth.
     *
     * Returns per-pixel color before/after plus resolved class/depth. Canvas
     * presentation, quad visibility and renderer state are restored on every
     * exit path (finally), including probe-positioning throws.
     */
    async presentComposition() {
      if (mode !== 'deferred') throw new Error('presentComposition requires deferred mode');
      // Forward quads compose WITH depth tests against the presented depth —
      // the constructed material default, re-pinned here so a future edit
      // cannot silently weaken the semantics under test.
      forwardMat.depthTest = true;
      const w = deferredLayer.targets.resolved.width;
      const h = deferredLayer.targets.resolved.height;
      // Keep the owned target matched to the layer even after setResolution.
      if (compTarget.width !== w || compTarget.height !== h) compTarget.setSize(w, h);
      const readTarget = () => readTextureIndex(handle, compTarget, 0);
      const sample = (buf: { width: number; data: Float32Array }, x: number, y: number) => {
        const o = (y * buf.width + x) * 4;
        return [buf.data[o]!, buf.data[o + 1]!, buf.data[o + 2]!];
      };
      const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

      // Deterministic forward composition inputs.
      const CHEST: Vec3 = [0, 1.2, 0];
      camera.updateMatrixWorld();
      const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      const toChest = new THREE.Vector3(...CHEST).sub(camPos);
      const distChest = toChest.length();
      const dir = toChest.clone().normalize();
      const project = (p: THREE.Vector3) => {
        const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(proj);
        return [(v.x / v.w + 1) / 2 * w, (1 - v.y / v.w) / 2 * h] as [number, number];
      };
      const placeQuad = (mesh: THREE.Mesh, at: THREE.Vector3) => {
        mesh.position.copy(at);
        mesh.lookAt(camPos);
        mesh.updateMatrixWorld();
      };

      // Everything below mutates renderer/layer/scene state. The finally at
      // the end restores canvas presentation, quad visibility and renderer
      // target/autoClear even when a probe-positioning throw aborts the
      // composition mid-frame.
      const prevTarget = handle.renderer.getRenderTarget();
      const prevAutoClear = handle.renderer.autoClear;
      // Idempotent restoration. The happy path calls it BEFORE the report is
      // built — `return` evaluates its expression before finally runs, so
      // restoring only in finally would report the still-active target.
      // finally re-invokes it (a no-op then) purely for the throw path.
      let restored = false;
      const restore = async () => {
        if (restored) return;
        restored = true;
        deferredLayer.setOutputTarget(null);
        forwardFront.visible = false;
        forwardBehind.visible = false;
        forwardFar.visible = false;
        handle.renderer.setRenderTarget(prevTarget);
        handle.renderer.autoClear = prevAutoClear;
        draw();
        await completeGpu();
      };
      try {
      // Frame A: full scenes into the owned target.
      deferredLayer.setOutputTarget(compTarget);
      deferredLayer.render(meshScene, sdfScene, camera);
      await completeGpu();
      const resolvedA = await Promise.all([
        readAttachment(handle, deferredLayer.targets.resolved, 'emissionClass'),
        readAttachment(handle, deferredLayer.targets.resolved, 'surfaceDepth'),
      ]);
      const resolvedClassAt = (bufs: typeof resolvedA, x: number, y: number) => ({
        // emissionClass is RGBA: the class channel is +3 (readSurfaces rule).
        cls: decodeSurfaceClass(Math.round(bufs[0]!.data[(y * w + x) * 4 + 3]!)).baseClass,
        depth: bufs[1]!.data[y * w + x]!, // surfaceDepth is R: 1 channel
      });

      const chestPx = project(new THREE.Vector3(...CHEST));
      const cx = Math.round(chestPx[0]);
      const cy = Math.round(chestPx[1]);
      if (cx < 40 || cx >= w - 260 || cy < 20 || cy >= h - 20) {
        throw new Error(`chest projection off the usable frame: ${JSON.stringify(chestPx)}`);
      }
      const chestSurface = resolvedClassAt(resolvedA, cx, cy);

      // Screen-space radius of a quad of WORLD half-size s at distance d.
      const pixelRadius = (p: THREE.Vector3, s: number) => {
        const right = new THREE.Vector3().crossVectors(camera.up, dir).normalize();
        return Math.abs(project(p.clone().add(right.multiplyScalar(s)))[0] - project(p)[0]);
      };
      const frontDist = distChest * 0.45;
      const frontPos = camPos.clone().add(dir.clone().multiplyScalar(frontDist));
      const frontHalfPx = pixelRadius(frontPos, FORWARD_QUAD_SIZE / 2);
      const behindDist = distChest * 1.6;
      const behindPos = camPos.clone().add(dir.clone().multiplyScalar(behindDist));
      const behindHalfPx = pixelRadius(behindPos, FORWARD_QUAD_SIZE / 2);
      // The behind quad's pixel: beside the front quad, still on the body —
      // walk +x until the resolved surface there is flesh (bounded scan).
      let bx = Math.round(chestPx[0] + frontHalfPx + behindHalfPx + 12);
      while (bx < w - 4) {
        const s = resolvedClassAt(resolvedA, bx, cy);
        if (s.cls === 2 && s.depth < 1) break;
        bx += 4;
      }
      if (bx >= w - 4) throw new Error('no flesh pixel beside the front quad for the behind quad');
      placeQuad(forwardFront, frontPos);
      // Behind quad: on the camera ray through pixel (bx, cy), at behindDist
      // — guaranteed beside the front quad AND on the body's presented depth
      // column.
      {
        const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
        const ndc = new THREE.Vector3(bx / w * 2 - 1, 1 - cy / h * 2, chestSurface.depth);
        const world = ndc.applyMatrix4(proj);
        const rayDir = world.sub(camPos).normalize();
        placeQuad(forwardBehind, camPos.clone().add(rayDir.multiplyScalar(behindDist)));
      }

      forwardFront.visible = true;
      forwardBehind.visible = true;
      forwardFar.visible = false;
      const beforeA = await readTarget();
      handle.renderer.setRenderTarget(compTarget);
      handle.renderer.autoClear = false; // compose INTO the presented frame
      handle.renderer.render(forwardScene, camera);
      handle.renderer.setRenderTarget(prevTarget);
      handle.renderer.autoClear = prevAutoClear;
      await completeGpu();
      const afterA = await readTarget();
      const changedPixels = (a: { data: Float32Array }, b: { data: Float32Array }) => {
        let n = 0;
        for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i]! - b.data[i]!) > 0.01) n++;
        return n;
      };

      // Frame B: EMPTY mesh scene — the body silhouette leaves empty pixels.
      deferredLayer.render(emptyMeshScene, sdfScene, camera);
      await completeGpu();
      const resolvedB = await Promise.all([
        readAttachment(handle, deferredLayer.targets.resolved, 'emissionClass'),
        readAttachment(handle, deferredLayer.targets.resolved, 'surfaceDepth'),
      ]);
      // First truly empty pixel to the right of the chest (class 0, far).
      let ex = Math.round(chestPx[0] + 60);
      while (ex < w - 40) {
        const s = resolvedClassAt(resolvedB, ex, cy);
        if (s.cls === 0 && s.depth >= 1) break;
        ex += 2;
      }
      if (ex >= w - 40) throw new Error('no empty pixel found beside the body for the far-quad probe');
      {
        const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
        const ndc = new THREE.Vector3(ex / w * 2 - 1, 1 - cy / h * 2, 0.5);
        const world = ndc.applyMatrix4(proj);
        const rayDir = world.sub(camPos).normalize();
        placeQuad(forwardFar, camPos.clone().add(rayDir.multiplyScalar(0.7)));
      }
      forwardFront.visible = false;
      forwardBehind.visible = false;
      forwardFar.visible = true;
      const beforeB = await readTarget();
      handle.renderer.setRenderTarget(compTarget);
      handle.renderer.autoClear = false;
      handle.renderer.render(forwardScene, camera);
      handle.renderer.setRenderTarget(prevTarget);
      handle.renderer.autoClear = prevAutoClear;
      await completeGpu();
      const afterB = await readTarget();

      await restore();
      return {
        size: [w, h],
        changedPixelsA: changedPixels(beforeA, afterA),
        changedPixelsB: changedPixels(beforeB, afterB),
        chest: { px: [cx, cy], ...chestSurface },
        front: {
          px: [cx, cy], before: sample(beforeA, cx, cy), after: sample(afterA, cx, cy),
          beforeLum: Math.round(lum(sample(beforeA, cx, cy)) * 1000) / 1000,
          afterLum: Math.round(lum(sample(afterA, cx, cy)) * 1000) / 1000,
        },
        behind: {
          px: [bx, cy],
          ...resolvedClassAt(resolvedA, bx, cy),
          before: sample(beforeA, bx, cy), after: sample(afterA, bx, cy),
          beforeLum: Math.round(lum(sample(beforeA, bx, cy)) * 1000) / 1000,
          afterLum: Math.round(lum(sample(afterA, bx, cy)) * 1000) / 1000,
        },
        empty: {
          px: [ex, cy],
          ...resolvedClassAt(resolvedB, ex, cy),
          before: sample(beforeB, ex, cy), after: sample(afterB, ex, cy),
          beforeLum: Math.round(lum(sample(beforeB, ex, cy)) * 1000) / 1000,
          afterLum: Math.round(lum(sample(afterB, ex, cy)) * 1000) / 1000,
        },
        outputRestored: deferredLayer.diagnostics().outputTargetActive === false,
      };
      } finally {
        await restore();
      }
    },
    /** Luminance-weighted centroid of the lit target inside a square window
     *  around (cx, cy), above the window's own baseline. The GPU-side world
     *  reconstruction shifts where a cone of light lands; this measures where
     *  it ACTUALLY landed, sub-pixel. */
    async litCentroid(cx: number, cy: number, radius: number) {
      const lit = await readTextureIndex(handle, deferredLayer.targets.lit, 0);
      const { width: w, height: h, data } = lit;
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(w - 1, Math.ceil(cx + radius));
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(h - 1, Math.ceil(cy + radius));
      const lum: number[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const o = (y * w + x) * 4;
          lum.push(0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!);
        }
      }
      const sorted = [...lum].sort((a, b) => a - b);
      const baseline = sorted[Math.floor(sorted.length * 0.5)]!;
      let max = 0;
      for (const l of lum) if (l > max) max = l;
      // Isolate the pool CORE: a plain above-median weight lets half the
      // window's ambient-lit floor texture contribute, and the centroid then
      // measures the window, not the light pool (measured: a 1-degree cone
      // reported 3336 contributing px in an 80x80 window). Keep only pixels
      // at least a quarter of the way from baseline to peak.
      const threshold = baseline + 0.25 * (max - baseline);
      let sum = 0, sx = 0, sy = 0, count = 0;
      let i = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++, i++) {
          const wgt = lum[i]! > threshold ? lum[i]! - threshold : 0;
          if (wgt > 0) { count++; }
          sum += wgt; sx += wgt * x; sy += wgt * y;
        }
      }
      return {
        centroid: sum > 0 ? [sx / sum, sy / sum] as [number, number] : null,
        count, max, baseline,
      };
    },
    async sampleTiming(frames: number) {
      if (running) throw new Error('Stop the animation loop before measuring');
      if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames must be a positive integer');
      const times: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        handle.step(STEP_DT);
        await completeGpu();
        times.push(performance.now() - t0);
      }
      const sorted = [...times].sort((a, b) => a - b);
      const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      return {
        // Completed-frame wall time: submit + GPU fence per frame. NOT a GPU
        // timestamp — three's per-frame timestamp attribution is unreliable
        // with this many passes per frame (lab-renderer.ts resolveGpu note).
        method: 'wall-clock submit+fence per stepped frame (rAF loop stopped)',
        frames,
        p50: pick(0.5),
        p95: pick(0.95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        samples: times.map((t) => Math.round(t * 1000) / 1000),
      };
    },
  };
  (window as unknown as { __deferredLab: typeof api }).__deferredLab = api;

  // ---- controls (visible; the API above is the automation seam) -------------
  buildControls();

  function buildControls() {
    const panel = document.getElementById('panel');
    if (!panel) return;
    const mk = (label: string, el: HTMLElement) => {
      const row = document.createElement('label');
      row.textContent = label + ' ';
      row.appendChild(el);
      panel.appendChild(row);
    };
    const select = (options: string[], value: string, on: (v: string) => void) => {
      const s = document.createElement('select');
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        s.appendChild(opt);
      }
      s.value = value;
      s.onchange = () => on(s.value);
      return s;
    };
    mk('mode', select(['deferred', 'legacy'], mode, (v) => api.setMode(v as 'legacy' | 'deferred')));
    mk('sdf scale', select(['1', '0.5', '0.25'], String(sdfScale), (v) => api.setSdfScale(Number(v))));
    mk('debug view', select(['lit', 'albedo', 'normal', 'depth', 'material'], 'lit', (v) => api.setDebugView(v as DeferredDebugView)));
    mk('camera', select(Object.keys(CAMERA_POSES), pose, (v) => api.setCameraPose(v as CameraPoseName)));
    mk('lights', select(['1', '3', '8', '16'], '3', (v) => api.setLightCount(Number(v))));
    const playBtn = document.createElement('button');
    playBtn.textContent = 'pause lights';
    playBtn.onclick = () => {
      api.setLightsAnimated(!lightsAnimated);
      playBtn.textContent = lightsAnimated ? 'pause lights' : 'play lights';
    };
    mk('lights', playBtn);
    const orbsChk = document.createElement('input');
    orbsChk.type = 'checkbox'; orbsChk.checked = orbsVisible;
    orbsChk.onchange = () => api.setOrbsVisible(orbsChk.checked);
    mk('orbs visible', orbsChk);
    const woundChk = document.createElement('input');
    woundChk.type = 'checkbox'; woundChk.checked = wounded;
    woundChk.onchange = () => api.setWounded(woundChk.checked);
    mk('wounded', woundChk);
    const runBtn = document.createElement('button');
    runBtn.textContent = 'run';
    runBtn.onclick = () => api.setLoopRunning(!running);
    mk('loop', runBtn);
    syncControls = () => {
      const selects = panel.querySelectorAll('select');
      [mode, String(sdfScale), debugView, pose, String(lightCount)].forEach((value, i) => {
        selects[i]!.value = value;
      });
      playBtn.textContent = lightsAnimated ? 'pause lights' : 'play lights';
      orbsChk.checked = orbsVisible;
      woundChk.checked = wounded;
      runBtn.textContent = running ? 'freeze' : 'run';
      if (ready && statusEl) statusEl.textContent = `ready — ${handle.backend} ${handle.canvas.width}x${handle.canvas.height} — mode ${mode}`;
    };
  }

  // ---- readiness: BOTH modes must compile before ready flips -----------------
  // setMode mutates `mode`; the warmup below would otherwise leave the page
  // stuck in legacy regardless of the requested/default mode.
  const requestedMode = mode;
  try {
    api.setMode('deferred');
    await api.step(2);
    api.setMode('legacy');
    await api.step(2);
    api.setMode(requestedMode);
    await api.step(1);
    await new Promise((r) => setTimeout(r, 250)); // let async shader errors land
    if (errors.length > 0) throw new Error(`compile errors: ${errors.join('; ')}`);
    ready = true;
    api.setLoopRunning(params.get('paused') !== '1');
    if (statusEl) {
      statusEl.textContent = `ready — ${handle.backend} ${FIXED_W}x${FIXED_H} — mode ${requestedMode}`;
    }
  } catch (e) {
    recordError(`init: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }

  window.addEventListener('pagehide', () => {
    deferredLayer.dispose();
    sdfLayer.dispose();
    legacyView.dispose();
    surfaceView.dispose();
    orbGeo.dispose();
    for (const d of [...roomDef.disposables, ...roomLeg.disposables]) d.dispose();
    // M2 task 1 composition fixtures (page-owned, layer never touches them).
    compTarget.dispose();
    forwardMat.dispose();
    forwardQuadGeom.dispose();
    handle.renderer.dispose();
  });
}

main().catch((e) => {
  const el = document.getElementById('errors');
  if (el) el.textContent = String(e instanceof Error ? e.stack ?? e.message : e);
  console.error(e);
});
