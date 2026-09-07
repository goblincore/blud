// src/lab/sdf-zombie/webgpu/deferred-producers-main.ts
//
// M2 task 2 GPU smoke page: every surface producer in ONE deferred frame —
// an SDF body (surface, level-only receiver), the instanced bone-tube mesh
// (surface, level-only), two detached chunks sharing ONE surface material
// with distinct per-draw data (level-only), and a baked chunk (surface,
// full receiver). Rendered through the deferred layer at 800x600; the check
// driver (scripts/deferred-producer-check.mjs) reads the resolved G-buffer
// through __deferredProducers and asserts coverage, classes, depth, unit
// normals, light invariance and the one-trace shader structure.

import * as THREE from 'three/webgpu';
import { createLabRenderer, type LabRendererHandle } from './lab-renderer';
import { createDeferredLayer, type DeferredLayer } from './deferred-layer';
import {
  createSharedChunkGpuMaterial, createChunkGpuView, createZombieGpuView,
  type ZombieGpuView, type ChunkGpuView, type SharedChunkGpuMaterial,
} from './zombie-gpu';
import { createBoneInstancer, type BoneInstancer } from './bone-instancer';
import { createBakedChunkMaterial, bakeChunkGeometry } from './baked-chunks';
import { SURFACE_ATTACHMENT_NAMES } from './deferred-surface';
import type { DeferredLight } from './deferred-lighting';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import { FLESH_PRESETS } from '../material';
import { makeChunk } from '../gib-chunks';
import type { Primitive, Vec3 } from '../types';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { boneInstanceOf } from './bone-tube-geom';

const FIXED_W = 800;
const FIXED_H = 600;
const STEP_DT = 1 / 60;

/** Where each producer stands, in world space. The camera pose below frames
 *  all five; the check projects these anchors to probe pixels. */
const LAYOUT = {
  body: [0, 0, 0] as Vec3,
  bones: [-1.5, 0, 0.3] as Vec3,
  chunkA: [1.5, 1.0, 0] as Vec3,
  chunkB: [2.4, 0.9, 0.2] as Vec3,
  baked: [-2.5, 0.45, 0] as Vec3,
};
/** Where the check PROBES each producer: a point ON/near its surface (the
 *  body anchor is the chest, not the root). Windows: bones/baked are thin or
 *  small on screen, so they search wider — still nowhere near another
 *  producer's pixels. */
const PROBE = {
  body: [0, 1.25, 0.12] as Vec3,
  bones: [-1.5, 1.25, 0.3] as Vec3,
  chunkA: [1.5, 1.0, 0] as Vec3,
  chunkB: [2.4, 0.9, 0.2] as Vec3,
  baked: [-2.5, 0.5, 0] as Vec3,
};
const PROBE_WINDOW = { body: 24, bones: 60, chunkA: 24, chunkB: 24, baked: 40 };
const CAMERA_POSE = { pos: [0.1, 2.3, 6.6] as Vec3, look: [0.1, 0.85, 0] as Vec3 };

const errors: string[] = [];

/** Two deterministic light states for the invariance check: B moves the
 *  lights, recolors them, and changes the COUNT. Surface buffers must not
 *  notice any of it. */
function lightState(which: 'a' | 'b'): DeferredLight[] {
  if (which === 'a') {
    return [
      { kind: 'spot', position: [0.4, 2.6, 2.2], direction: [-0.15, -0.8, -0.6], color: [1.0, 0.92, 0.8], intensity: 3.2, range: 14, cosInner: 0.94, cosOuter: 0.8 },
      { kind: 'point', position: [-2.2, 1.4, 1.6], direction: [0, -1, 0], color: [0.35, 0.5, 1.0], intensity: 2.0, range: 9, cosInner: 1, cosOuter: 0.8 },
    ];
  }
  return [
    { kind: 'spot', position: [-1.8, 2.9, 2.6], direction: [0.3, -0.7, -0.5], color: [0.7, 0.4, 1.0], intensity: 5.5, range: 20, cosInner: 0.9, cosOuter: 0.7 },
    { kind: 'point', position: [2.4, 0.7, 2.8], direction: [0, -1, 0], color: [1.0, 0.2, 0.1], intensity: 4.0, range: 12, cosInner: 1, cosOuter: 0.8 },
    { kind: 'point', position: [0.2, 2.8, -2.0], direction: [0, -1, 0], color: [0.2, 1.0, 0.4], intensity: 2.5, range: 8, cosInner: 1, cosOuter: 0.8 },
  ];
}

// ---- three's 256-byte-row-padded readback (the r32f row-stride trap) ------
function decodeHalf(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? Number.NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

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

async function readAttachment(handle: LabRendererHandle, target: THREE.RenderTarget, name: string): Promise<ReadBuffer> {
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

async function main() {
  const mount = document.getElementById('app')!;
  const handle = await createLabRenderer(mount, { mode: 'fixed', width: FIXED_W, height: FIXED_H });
  handle.setLoopRunning(false);
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  // ---- body -----------------------------------------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const compiled = compileBlob(doc, face);
  const built: BuildResult = buildBody(compiled, DEFAULT_BUILD_OPTS, {});
  for (const err of built.errors) errors.push(`body: ${err}`);
  const body = translateBody(built, LAYOUT.body);
  const flesh = { ...FLESH_PRESETS['henenlotter-latex'] };

  // The SDF producer: level-only receiver, as the deferred game will ask.
  const surfaceView = createZombieGpuView(body, { output: 'surface', shadowReceiver: 'level-only' });
  surfaceView.applyMaterial(flesh, { keyDir: [0.4, 0.8, 0.3], keyColor: [1, 0.95, 0.88], keyIntensity: 2.2, fillIntensity: 0.08, probeWeight: 0.5, ambientGain: 0.5, chromaGain: 0.2 });
  surfaceView.setWounds([[0.06, 1.26, 0.16], [-0.07, 1.38, 0.13]], [0.15, 0.08], [1, 0], [0.4, 0.8]);

  // ---- bones: the body's REAL packed bones, translated beside it -----------
  // (BuildResult carries bones in bonePrims, NOT prims — build-body moves
  // every op-'bone' authored prim there. The instancer draws instances in
  // world space; shifting the prims puts the skeleton where the check can
  // see tubes directly instead of only in cavities. Same pack path, same
  // vertex program.)
  const BONE_OFFSET = ((): Vec3 => {
    const a = LAYOUT.bones;
    const b = LAYOUT.body;
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  })();
  const bonePrims: Primitive[] = (body.bonePrims ?? []).map((p) => {
    const s = boneInstanceOf(p);
    return {
      ...p,
      a: [s.a[0] + BONE_OFFSET[0], s.a[1] + BONE_OFFSET[1], s.a[2] + BONE_OFFSET[2]] as Vec3,
      b: [s.b[0] + BONE_OFFSET[0], s.b[1] + BONE_OFFSET[1], s.b[2] + BONE_OFFSET[2]] as Vec3,
    };
  });
  if (bonePrims.length === 0) errors.push('bones: body.bonePrims is empty');
  const bones: BoneInstancer = createBoneInstancer(1024, { output: 'surface', shadowReceiver: 'level-only' });
  const alive = body.clusters.map((c) => c.alive);
  bones.update([{ prims: bonePrims, alive }]);
  if (bones.count <= 0) errors.push('bones: no instances packed');
  bones.setWounds([{ pos: [LAYOUT.bones[0] + 0.05, 1.1 + BONE_OFFSET[1], LAYOUT.bones[2]], radius: 0.3 }]);

  // ---- two detached chunks under ONE shared surface material ---------------
  // Chunks march in WORLD space: the view recentres the prims around the
  // chunk pos and re-applies it per frame, so the prims must be MOVED to the
  // chunk's own position first (the game severs them already in place; this
  // fixture lays them out deliberately).
  const movePrims = (prims: Primitive[], to: Vec3): Primitive[] => {
    if (prims.length === 0) return prims;
    const p0 = prims[0]!;
    const c: Vec3 = [(p0.a[0] + p0.b[0]) / 2, (p0.a[1] + p0.b[1]) / 2, (p0.a[2] + p0.b[2]) / 2];
    const d: Vec3 = [to[0] - c[0], to[1] - c[1], to[2] - c[2]];
    return prims.map((p) => ({
      ...p,
      a: [p.a[0] + d[0], p.a[1] + d[1], p.a[2] + d[2]] as Vec3,
      b: [p.b[0] + d[0], p.b[1] + d[1], p.b[2] + d[2]] as Vec3,
      bend: p.bend === undefined ? undefined : ([p.bend[0] + d[0], p.bend[1] + d[1], p.bend[2] + d[2]] as Vec3),
    }));
  };
  const chunkMaterial: SharedChunkGpuMaterial = createSharedChunkGpuMaterial(undefined, {
    output: 'surface', shadowReceiver: 'level-only',
  });
  const armL = movePrims(body.prims.filter((p) => p.limb === 'armL').slice(0, 3), LAYOUT.chunkA);
  const armR = movePrims(body.prims.filter((p) => p.limb === 'armR').slice(0, 3), LAYOUT.chunkB);
  if (armL.length === 0 || armR.length === 0) errors.push('chunks: no limb prims');
  const chunkAState = makeChunk('armL', LAYOUT.chunkA, [0, 0, 0], 0.1, [0, 0, 1], () => 0.5);
  const chunkBState = makeChunk('armR', LAYOUT.chunkB, [0, 0, 0], 0.1, [0, 1, 0], () => 0.5);
  const chunkA: ChunkGpuView = createChunkGpuView(
    chunkAState, armL, surfaceView.uniforms, [armL[0]!.b], undefined, chunkMaterial, undefined,
    { output: 'surface' },
  );
  const chunkB: ChunkGpuView = createChunkGpuView(
    chunkBState, armR, surfaceView.uniforms, [armR[0]!.b], undefined, chunkMaterial, undefined,
    { output: 'surface' },
  );

  // ---- baked chunk: march a small piece once, extract, swap to mesh -------
  const legBaked = movePrims(body.prims.filter((p) => p.limb === 'legL').slice(0, 3), LAYOUT.baked);
  const bakedState = makeChunk('legL', LAYOUT.baked, [0, 0, 0], 0.1, [0, 1, 0], () => 0.5);
  const bakedView: ChunkGpuView = createChunkGpuView(
    bakedState, legBaked, surfaceView.uniforms,
    undefined, undefined, undefined, undefined, { output: 'surface', shadowReceiver: 'level-only' },
  );
  const bakedBake = bakeChunkGeometry(bakedView.bakeData());
  if (bakedBake.verts <= 0) errors.push(`bake: empty geometry (legPrims ${body.prims.filter((p) => p.limb === 'legL').length}, tris ${bakedBake.tris}, overflow ${bakedBake.overflow})`);
  const bakedMat = createBakedChunkMaterial({ output: 'surface' });
  const bakedMesh = new THREE.Mesh(bakedBake.geometry, bakedMat.material);
  bakedMesh.frustumCulled = true;

  // ---- scenes + layer -------------------------------------------------------
  const meshScene = new THREE.Scene();
  meshScene.add(bones.object);
  meshScene.add(chunkA.object);
  meshScene.add(chunkB.object);
  meshScene.add(bakedMesh);
  bakedView.object.visible = false; // the bake replaces the marched proxy
  const sdfScene = new THREE.Scene();
  sdfScene.add(surfaceView.object);

  const deferredLayer: DeferredLayer = createDeferredLayer(handle.renderer, {
    width: FIXED_W, height: FIXED_H, sdfScale: 1,
  });

  const camera = handle.camera;
  camera.position.set(...CAMERA_POSE.pos);
  camera.lookAt(...CAMERA_POSE.look);
  camera.updateMatrixWorld();

  handle.setDrawFn(() => {
    deferredLayer.render(meshScene, sdfScene, camera);
  });

  // ---- API ------------------------------------------------------------------
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) handle.step(STEP_DT);
  };

  const project = (p: Vec3) => {
    camera.updateMatrixWorld();
    const proj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const v = new THREE.Vector4(p[0], p[1], p[2], 1).applyMatrix4(proj);
    const w = FIXED_W;
    const h = FIXED_H;
    return {
      pixel: [Math.round(((v.x / v.w + 1) / 2) * w), Math.round(((1 - v.y / v.w) / 2) * h)] as [number, number],
      clipDepth: v.z / v.w,
    };
  };

  /** In a k×k window around (x,y): the first pixel whose class matches
   *  `want`, with its attachment data; null when none matches. */
  const findClass = (
    emission: ReadBuffer, normal: ReadBuffer, depth: ReadBuffer,
    x: number, y: number, want: number, k = 14,
  ) => {
    for (let r = 0; r <= k; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= emission.width || py >= emission.height) continue;
          const o = (py * emission.width + px) * 4;
          const cls = Math.round(emission.data[o + 3]!);
          if (cls === want) {
            const no = (py * normal.width + px) * 4;
            const n = [normal.data[no]!, normal.data[no + 1]!, normal.data[no + 2]!, normal.data[no + 3]!];
            const d = depth.data[py * depth.width + px]!;
            return {
              pixel: [px, py], cls,
              emission: Array.from(emission.data.slice(o, o + 4)),
              normal: [...n],
              metalness: n[3],
              normalLen: Math.hypot(n[0]!, n[1]!, n[2]!),
              depth: d,
            };
          }
        }
      }
    }
    return null;
  };

  let lightWhich: 'a' | 'b' = 'a';
  const api = {
    errors,
    ready: false,
    surfaceKind: {
      body: ((surfaceView.object as THREE.Mesh).material as unknown as { surfaceKind?: number }).surfaceKind,
      bones: bones.surfaceKind,
      chunks: (chunkMaterial.material as unknown as { surfaceKind?: number }).surfaceKind,
      chunkA: (chunkA.object as THREE.Mesh).material === chunkMaterial.material,
      baked: bakedMat.surfaceKind,
    },
    setLights(which: 'a' | 'b') {
      lightWhich = which;
      deferredLayer.setLights(lightState(which));
    },
    step,
    project,
    async readSurfaces() {
      const resolved = deferredLayer.targets.resolved;
      const [albedo, normal, emission, depth] = (await Promise.all(
        SURFACE_ATTACHMENT_NAMES.map((n) => readAttachment(handle, resolved, n)),
      )) as [ReadBuffer, ReadBuffer, ReadBuffer, ReadBuffer];
      const classCounts: Record<string, number> = {};
      for (let i = 3; i < emission.data.length; i += 4) {
        const cls = Math.round(emission.data[i]!);
        classCounts[String(cls)] = (classCounts[String(cls)] ?? 0) + 1;
      }
      const anchors = Object.entries(PROBE).map(([name, p]) => {
        const { pixel, clipDepth } = project(p);
        // body AND the marched chunks are flesh: level-only class 18; bones
        // are tissue tubes: mesh class, level-only (17); the baked chunk is
        // a mesh: full receiver (1).
        const want = name === 'bones' ? 17 : name === 'baked' ? 1 : 18;
        const hit = findClass(emission, normal, depth, pixel[0], pixel[1], want, PROBE_WINDOW[name as keyof typeof PROBE] ?? 24);
        return { name, world: p, pixel, clipDepth, want, hit };
      });
      return {
        width: resolved.width,
        height: resolved.height,
        lightWhich,
        classCounts,
        hashes: {
          albedoRoughness: fnv1a(albedo.data),
          normalMetalness: fnv1a(normal.data),
          emissionClass: fnv1a(emission.data),
          surfaceDepth: fnv1a(depth.data),
        },
        anchors,
      };
    },
    async surfaceShader() {
      const dbg = handle.renderer.debug as unknown as {
        getShaderAsync: (scene: THREE.Scene, cam: THREE.Camera, obj: THREE.Object3D) => Promise<{ fragmentShader?: string }>;
      };
      const prev = handle.renderer.getRenderTarget();
      handle.renderer.setRenderTarget(deferredLayer.targets.sdf);
      try {
        const out = await dbg.getShaderAsync(sdfScene, camera, surfaceView.object);
        return out.fragmentShader ?? '';
      } finally {
        handle.renderer.setRenderTarget(prev);
      }
    },
    dispose() {
      deferredLayer.dispose();
      surfaceView.dispose();
      bones.dispose();
      chunkA.dispose();
      chunkB.dispose();
      bakedView.dispose();
      chunkMaterial.dispose();
      bakedMat.dispose();
      bakedBake.geometry.dispose();
    },
  };
  (window as unknown as { __deferredProducers: typeof api }).__deferredProducers = api;

  deferredLayer.setLights(lightState('a'));
  step(2);
  api.ready = true;
}

main().catch((e) => {
  errors.push(String(e?.stack ?? e));
  const el = document.getElementById('errors');
  if (el) el.textContent = String(e?.stack ?? e);
});
