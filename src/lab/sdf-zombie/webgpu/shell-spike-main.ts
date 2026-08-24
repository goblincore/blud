// src/lab/sdf-zombie/webgpu/shell-spike-main.ts
//
// Shell-march spike: rasterise a slightly-inflated hull of the character and
// sphere-trace the SAME SDF field only within [entry, exit] of that hull.
//
// This answers whether step-count optimisation is even needed for hero bodies.
// Cost ≈ pixels x steps x primitives, and a full march walks dozens of steps
// through empty space in front of the body before it hits the surface. If we
// can (a) rasterise a hull that sits ~HULL_ISO outside the real surface and
// (b) start the march at that hull's screen depth, then the interval to trace
// is a few cm thick and the budget can drop from ~96 to ~16 WITHOUT changing
// the field, the blends (smin), or the gradient normals.
//
// Everything renderer-independent is shared from the same modules the lab
// uses: buildBody / sdBody build the CPU field, blob-compile parses the .blob,
// packBody creates the data texture, and — crucially — the WGSL field
// (mapBody/calcNormal) is IMPORTED from march.wgsl.ts's HELPERS chain, so the
// definition cannot drift between here and the shipping march. This file only
// rebuilds the rendering TAIL (hull + bounded trace) and is a standalone page.

import * as THREE from 'three/webgpu';
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture, texture3D,
  screenUV, cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add, length,
} from 'three/tsl';

// The field, imported so it cannot drift. HELPERS is the dependency-ordered
// list (mapBody/calcNormal and everything they call); we build our own entry
// that includes that whole chain.
import { HELPERS, ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT,
  ROW_REST_A, ROW_REST_B, ROW_PRIM_SHAPE, ROW_PRIM_BEND, ROW_PRIM_COLOR,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_GROUP_BOUNDS, ROW_GROUP_RANGE, ROW_CLUSTER_GROUPS,
  ROW_WOUND, ROW_WOUND_META } from './march.wgsl';
import { SHELL_TRACE } from './shell-spike.wgsl';

import { createDataTexture } from './zombie-gpu';
import { createFallbackHandVolumeTexture } from './hand-volume';
import { packBody } from '../pack';
import { MAX_PRIMS, sdBody } from '../validate';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { buildHullMesh } from './shell-hull';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { DEFAULT_FACE } from '../face';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import type { Vec3 } from '../types';

/** Inflation iso of the hull (metres) — the hull sits this far OUTSIDE the
 *  real surface, so the entry point is always outside the flesh. */
const HULL_ISO = 0.03;
/** Marching-tetra grid resolution along the largest axis. */
const HULL_RES = 72;
/** Step budget for the bounded shell, and the fixed baseline for the full march. */
const SHELL_STEPS = 16;
const FULL_STEPS = 96;

type Swizzled = { xyz: unknown; w: unknown };

async function main() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');
  const statusEl = document.getElementById('status');
  const say = (msg: string, bad = false) => {
    if (!statusEl) return;
    const line = document.createElement('div');
    line.textContent = msg;
    if (bad) line.style.color = '#ff6464';
    statusEl.appendChild(line);
  };

  const renderer = new WebGPURenderer({ antialias: false, alpha: false, trackTimestamp: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(new THREE.Color(0x1a1116));
  mount.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'webgl';
  say(`backend: ${backend}`, backend !== 'webgpu');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1116, 10, 60);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.set(0, 1.7, 6);

  const sun = new THREE.DirectionalLight(0xffeccd, 1.1);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x4a3a40, 0.6));

  // Polygonal reference geometry so depth interleaving is visible by eye.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const refCube = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
  );
  refCube.position.set(0.6, 0.2, 0.3);
  scene.add(refCube);

  // ————— Build the zombie body (the field) ——————————————————————————————
  const doc = parseBlob(zombieBlobSrc);
  const face = { ...DEFAULT_FACE, ...compileFace(doc) };
  const body = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
  say(`body: ${body.prims.length} prims, ${body.clusters.length} clusters, iso ${HULL_ISO}`);
  if (body.errors.length) say(body.errors.join(' | '), true);

  // ————— Pack the field into the data texture the WGSL marches ———————————
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const packed = packBody(body);
  writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
  writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
  writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
  writeRow(ROW_PRIM_QUAT, packed.primQuat, MAX_PRIMS);
  writeRow(ROW_REST_A, packed.restA, MAX_PRIMS);
  writeRow(ROW_REST_B, packed.restB, MAX_PRIMS);
  writeRow(ROW_PRIM_SHAPE, packed.primShape, MAX_PRIMS);
  writeRow(ROW_PRIM_BEND, packed.primBend, MAX_PRIMS);
  writeRow(ROW_PRIM_COLOR, packed.primColor, MAX_PRIMS);
  writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, packed.clusterCount);
  writeRow(ROW_CLUSTER_RANGE, packed.clusterRange, packed.clusterCount);
  writeRow(ROW_GROUP_BOUNDS, packed.groupBounds, MAX_PRIMS);
  writeRow(ROW_GROUP_RANGE, packed.groupRange, MAX_PRIMS);
  writeRow(ROW_CLUSTER_GROUPS, packed.clusterGroups, packed.clusterCount);
  dataTex.needsUpdate = true;

  // ————— Hull AABB (from cluster spheres + blend margin) ——————————————————
  function hullBounds(): { min: Vec3; max: Vec3 } {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const c of body.clusters) {
      if (!c.alive) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, c.center[i]! - c.radius);
        max[i] = Math.max(max[i]!, c.center[i]! + c.radius);
      }
    }
    const pad = packed.maxBlendK * 4 + HULL_ISO * 2 + 0.05;
    return {
      min: [min[0]! - pad, min[1]! - pad, min[2]! - pad],
      max: [max[0]! + pad, max[1]! + pad, max[2]! + pad],
    };
  }

  // ————— Build the hull mesh on the CPU ————————————————————————————————
  const isoField = (p: [number, number, number]) => sdBody(p as Vec3, body) - HULL_ISO;
  const hb = hullBounds();
  const tHull0 = performance.now();
  const hull = buildHullMesh(isoField, hb.min, hb.max, HULL_RES);
  const hullBuildMs = performance.now() - tHull0;
  say(`hull: ${hull.triCount} tris (${hull.vertCount} verts) in ${hullBuildMs.toFixed(1)} ms`);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(hull.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(hull.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(hull.indices, 1));
  const centre = new THREE.Vector3(
    (hb.min[0]! + hb.max[0]!) / 2,
    (hb.min[1]! + hb.max[1]!) / 2,
    (hb.min[2]! + hb.max[2]!) / 2,
  );
  const size = new THREE.Vector3(
    hb.max[0]! - hb.min[0]!,
    hb.max[1]! - hb.min[1]!,
    hb.max[2]! - hb.min[2]!,
  );

  // ————— Entry / exit depth capture ———————————————————————————————————————
  // Two Float targets at the render resolution. Front-face pass = entry (first
  // surface along the ray); back-face pass = exit (last). R channel = distance
  // from camera along the ray (the march's t). 0 = "no hull here".
  const targetOpts = {
    depthBuffer: true,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  } as const;
  const entryTarget = new THREE.RenderTarget(1, 1, targetOpts);
  const exitTarget = new THREE.RenderTarget(1, 1, targetOpts);
  const stepsTarget = new THREE.RenderTarget(1, 1, targetOpts);

  const rayDist = length(sub(positionWorld, cameraPosition));
  const worldClip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(positionWorld, 1.0)));
  const worldDepth = worldClip.z.div(worldClip.w);

  const entryMat = new MeshBasicNodeMaterial();
  entryMat.side = THREE.FrontSide;
  entryMat.outputNode = vec4(rayDist, 0, 0, 1);
  entryMat.depthNode = worldDepth;
  entryMat.depthWrite = true;
  entryMat.depthTest = true;

  const exitMat = new MeshBasicNodeMaterial();
  exitMat.side = THREE.BackSide;
  exitMat.depthFunc = THREE.GreaterDepth; // farthest back face wins = exit
  exitMat.outputNode = vec4(rayDist, 0, 0, 1);
  exitMat.depthNode = worldDepth;
  exitMat.depthWrite = true;
  exitMat.depthTest = true;

  // The hull geometry is built in ABSOLUTE world coordinates (buildHullMesh
  // samples the field at world points), so these two meshes sit at the origin.
  // Only the proxy boxes below are positioned at `centre`.
  const entryMesh = new THREE.Mesh(geo, entryMat);
  entryMesh.frustumCulled = false;
  const exitMesh = new THREE.Mesh(geo, exitMat);
  exitMesh.frustumCulled = false;
  const entryScene = new THREE.Scene();
  entryScene.add(entryMesh);
  const exitScene = new THREE.Scene();
  exitScene.add(exitMesh);

  // ————— The shell SPHERE-TRACE material ——————————————————————————————————
  const flesh = FLESH_PRESETS['henenlotter-latex'];
  const light = LIGHT_PRESETS['practical-hard-key'];

  const uCounts = uniform(new THREE.Vector4(packed.primCount, packed.clusterCount, packed.carveCount, packed.maxBlendK));
  const uMarchCfg = uniform(new THREE.Vector4(SHELL_STEPS, 1.0, 1, 0)); // x maxSteps, y stepMul, z bounded, w spare
  const uWoundCfg = uniform(new THREE.Vector4(0, 0.015, 0.55, 1.15));
  const uWoundCfg2 = uniform(new THREE.Vector4(0.42, 1.0, 0, 0));
  const uLightCfg = uniform(new THREE.Vector2(light.keyIntensity, light.fillIntensity));
  // x = fallback shell width (m) when exit is degenerate, y = surface noise amp
  const uSurfCfg = uniform(new THREE.Vector2(0.09, flesh.surfaceNoiseAmp));
  const uOutMode = uniform(0);

  const uBaseColor = uniform(new THREE.Color(...flesh.baseColor));
  const uDeepColor = uniform(new THREE.Color(...flesh.deepColor));
  const uCharColor = uniform(new THREE.Color(...flesh.charColor));
  const uLightDir = uniform(new THREE.Vector3(...light.keyDir));
  const uKeyColor = uniform(new THREE.Color(...light.keyColor));

  const uVolumePose0 = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uVolumePose1 = uniform(new THREE.Vector4(0, 0, 0, 1));
  const uVolumeMin = uniform(new THREE.Vector3(0, 0, 0));
  const uVolumeInvExtent = uniform(new THREE.Vector3(0, 0, 0));
  const uVolumeWarp = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uVolumeClip = uniform(new THREE.Vector4(0, 0, 0, 1));
  const volumeTex = createFallbackHandVolumeTexture();

  const helpers = HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  const shellEntry = wgslFn(SHELL_TRACE, helpers.slice(-1));

  const args = {
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    volumeTex: texture3D(volumeTex),
    entryTex: texture(entryTarget.texture),
    exitTex: texture(exitTarget.texture),
    screenUV,
    volumePose0: uVolumePose0,
    volumePose1: uVolumePose1,
    volumeMin: uVolumeMin,
    volumeInvExtent: uVolumeInvExtent,
    volumeWarp: uVolumeWarp,
    volumeClip: uVolumeClip,
    counts: uCounts,
    marchCfg: uMarchCfg,
    woundCfg: uWoundCfg,
    woundCfg2: uWoundCfg2,
    baseColor: uBaseColor,
    deepColor: uDeepColor,
    charColor: uCharColor,
    lightDir: uLightDir,
    keyColor: uKeyColor,
    lightCfg: uLightCfg,
    surfCfg: uSurfCfg,
    outMode: uOutMode,
  };

  // Visual material: colour + hit depth on a BackSide proxy box (the medium
  // that yields per-pixel worldPos rays, exactly like the full march). The
  // entry DISCARDS on a miss, so the floor shows where there is no hull.
  const traced = shellEntry(args) as unknown as Swizzled;
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hitPos = add(cameraPosition, mul(rayDir, traced.w as never));
  const hitClip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos as never, 1.0)));
  const shellDepth = hitClip.z.div(hitClip.w);

  const shellMat = new MeshBasicNodeMaterial();
  shellMat.side = THREE.BackSide;
  shellMat.colorNode = vec4(traced.xyz as never, 1.0);
  shellMat.depthNode = shellDepth;
  shellMat.depthWrite = true;
  shellMat.depthTest = true;

  // Steps material (readback): same entry, R channel = step count, A = hit marker.
  // Uses outputNode, not colorNode, because three forces an opaque material's
  // diffuse alpha to 1.0 and would erase the marker.
  const tracedSteps = shellEntry(args) as unknown as { x: unknown; w: unknown };
  const stepsMat = new MeshBasicNodeMaterial();
  stepsMat.side = THREE.BackSide;
  stepsMat.outputNode = vec4(tracedSteps.x as never, 0, 0, tracedSteps.w as never);
  stepsMat.depthWrite = false;
  stepsMat.depthTest = false;
  const stepsScene = new THREE.Scene();
  const stepsMesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), stepsMat);
  stepsMesh.position.copy(centre);
  stepsMesh.frustumCulled = false;
  stepsScene.add(stepsMesh);

  const shellMesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), shellMat);
  shellMesh.position.copy(centre);
  shellMesh.frustumCulled = false;
  scene.add(shellMesh);
  scene.add(refCube);

  // ————— Sizing ———————————————————————————————————————————————————————————
  function setTargets(w: number, h: number) {
    entryTarget.setSize(w, h);
    exitTarget.setSize(w, h);
    stepsTarget.setSize(w, h);
  }
  function resize() {
    const winW = window.innerWidth, winH = window.innerHeight;
    renderer.setSize(winW, winH, false);
    camera.aspect = winW / winH;
    camera.updateProjectionMatrix();
    const el = renderer.domElement;
    el.style.width = winW + 'px';
    el.style.height = winH + 'px';
    el.style.imageRendering = 'pixelated';
    setTargets(winW, winH);
  }
  resize();
  window.addEventListener('resize', resize);
  function setRenderSize(w: number, h: number) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setTargets(w, h);
  }

  // ————— Camera orbit ————————————————————————————————————————————————————
  let camYaw = 0.35, camPitch = 0.12, camDist = 2.4;
  const camTarget = new THREE.Vector3(0, 0.95, 0);
  function applyCamera() {
    const cp = Math.cos(camPitch);
    camera.position.set(
      camTarget.x + Math.sin(camYaw) * cp * camDist,
      camTarget.y + Math.sin(camPitch) * camDist,
      camTarget.z + Math.cos(camYaw) * cp * camDist,
    );
    camera.lookAt(camTarget);
  }
  applyCamera();

  // ————— Frame work ———————————————————————————————————————————————————————
  const scratchColor = new THREE.Color();
  function renderHullDepths() {
    const prevClear = renderer.getClearColor(scratchColor).getHex();
    const prevDepth = renderer.getClearDepth();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000);

    // Entry: nearest front face. Clear depth to far (1), default LessEqual.
    renderer.setClearDepth(1);
    renderer.setRenderTarget(entryTarget);
    renderer.render(entryScene, camera);

    // Exit: farthest back face. Clear depth to near (0), use GreaterDepth.
    renderer.setClearDepth(0);
    renderer.setRenderTarget(exitTarget);
    renderer.render(exitScene, camera);

    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear);
    renderer.setClearDepth(prevDepth);
    renderer.autoClear = prevAutoClear;
  }

  function frame() {
    applyCamera();
    renderHullDepths();
    uOutMode.value = 0;
    renderer.render(scene, camera);
  }

  function loop() {
    frame();
    renderer.resolveTimestampsAsync().catch(() => {});
  }
  renderer.setAnimationLoop(loop);

  // Drag / wheel controls.
  const canvas = renderer.domElement;
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * 0.008;
    camPitch = Math.max(-0.4, Math.min(1.2, camPitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    camDist = Math.max(0.9, Math.min(8, camDist + Math.sign(e.deltaY) * 0.2));
  }, { passive: true });

  // ————— Measurement —————————————————————————————————————————————————————
  async function resolveGpu() {
    try { await renderer.resolveTimestampsAsync(); } catch { /* noop fence */ }
  }

  /** Renders `frames` wall-clocked frames at [w,h]; returns avg ms/frame. */
  async function measureFrameTime(w: number, h: number, frames = 90, bounded = true, maxSteps = SHELL_STEPS) {
    renderer.setAnimationLoop(null);
    setRenderSize(w, h);
    uMarchCfg.value.set(maxSteps, 1.0, bounded ? 1 : 0, 0);
    for (let i = 0; i < 25; i++) { frame(); await resolveGpu(); } // warmup
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) { frame(); }
    await resolveGpu();
    const t1 = performance.now();
    renderer.setAnimationLoop(loop);
    return (t1 - t0) / frames;
  }

  /** Renders the shell into the steps target and reads back per-pixel steps.
   *  Reads the R (.x = steps) and A (.w = hit marker) channels of an RGBA32F
   *  target, honouring the row stride three's byte-align-256 copy introduces.
   *  Returns averages over HIT pixels only (the honest surface cost) as well as
   *  over every pixel that stepped at all (the frame cost, which includes
   *  box-interior miss rays for the full march).
   */
  async function measureSteps(w: number, h: number, bounded: boolean, maxSteps: number) {
    renderer.setAnimationLoop(null);
    setRenderSize(w, h);
    uMarchCfg.value.set(maxSteps, 1.0, bounded ? 1 : 0, 0);
    uOutMode.value = 1;
    applyCamera();
    renderHullDepths();
    const prevClear = renderer.getClearColor(scratchColor).getHex();
    renderer.setClearColor(0x000000);
    renderer.setRenderTarget(stepsTarget);
    renderer.render(stepsScene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear);

    const raw = new Float32Array(
      await renderer.readRenderTargetPixelsAsync(stepsTarget, 0, 0, w, h),
    );
    renderer.setAnimationLoop(loop);

    // bytesPerRow = align(w * 16, 256); RGBA32F channels are c*4.
    const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
    let hitSum = 0, hitCount = 0, allSum = 0, allCount = 0, max = 0;
    for (let r = 0; r < h; r++) {
      const base = r * floatsPerRow;
      for (let c = 0; c < w; c++) {
        const o = base + c * 4;
        const s = raw[o]!;
        const marker = raw[o + 3]!;
        if (s > 0) {
          allSum += s; allCount++;
          if (marker > 0.5) { hitSum += s; hitCount++; }
          if (s > max) max = s;
        }
      }
    }
    return {
      hitAvg: hitCount ? hitSum / hitCount : 0,
      hitCount,
      allAvg: allCount ? allSum / allCount : 0,
      allCount,
      max,
      total: w * h,
    };
  }

  const statsEl = document.getElementById('stats');
  (window as unknown as { __shellSpike: unknown }).__shellSpike = {
    backend,
    setCam(yaw: number, pitch: number, dist: number, targetY?: number) {
      camYaw = yaw; camPitch = pitch; camDist = dist;
      if (targetY !== undefined) camTarget.y = targetY;
    },
    hull: { tris: hull.triCount, verts: hull.vertCount, buildMs: hullBuildMs },
    measureFrameTime,
    measureSteps,
    async measure(w: number = 1100, h: number = 700) {
      const shell = await measureSteps(w, h, true, SHELL_STEPS);
      const full = await measureSteps(w, h, false, FULL_STEPS);
      const frameShell = await measureFrameTime(w, h, 90, true, SHELL_STEPS);
      const frameFull = await measureFrameTime(w, h, 90, false, FULL_STEPS);
      const out = { w, h, shell, full, frameShellMs: frameShell, frameFullMs: frameFull };
      if (statsEl) statsEl.textContent = JSON.stringify(out);
      return out;
    },
  };
  say('running — drag to orbit, wheel to zoom');
}

main().catch((err) => {
  const el = document.getElementById('status');
  if (el) {
    const line = document.createElement('div');
    line.style.color = '#ff6464';
    line.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
    el.appendChild(line);
  }
  console.error('[shell-spike] bootstrap failed', err);
});
