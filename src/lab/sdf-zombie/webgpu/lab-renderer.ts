// src/lab/sdf-zombie/webgpu/lab-renderer.ts
//
// A WebGPU renderer for the SDF lab ONLY. The game keeps `src/engine/renderer.ts`
// and its WebGLRenderer; the two coexist deliberately.
//
// Why this file exists rather than a flag on the shared factory: the lab is
// firewalled from src/sim and src/game by construction, so it can carry a
// second renderer without the game noticing. Adding a mode switch to the shared
// createRenderer would put a large, uncertain change directly in the shipped
// path, which is exactly what the WebGPU spec scopes against.
//
// Mirrors the shared handle shape (setRenderCallback / setDrawFn / same 960x540
// cap) so lab code can move across with minimal edits. The one unavoidable
// difference is that WebGPURenderer needs `await renderer.init()`, so this
// factory is ASYNC where the WebGL one is not.

// EVERYTHING comes from 'three/webgpu', which re-exports the whole library
// alongside the WebGPU additions. Importing THREE from 'three' and the
// renderer from 'three/webgpu' loads TWO COPIES of three — the console says
// "Multiple instances of Three.js being imported", and then the node system
// does not recognise lights constructed by the other copy:
//   LightsNode.setupNodeLights: Light node not found for DirectionalLight
// which renders every standard material black. Do not split these imports.
import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';

export interface LabRendererHandle {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  setRenderCallback(cb: (dtSec: number) => void): void;
  setDrawFn(fn: () => void): void;
  /** 'webgpu' or 'webgl' — WebGPURenderer silently falls back, so ASK. */
  readonly backend: string;
}

/** Matches src/engine/renderer.ts, so the lab looks the same on both paths. */
const MAX_RENDER_W = 960;
const MAX_RENDER_H = 540;

export async function createLabRenderer(mount: HTMLElement): Promise<LabRendererHandle> {
  const renderer = new WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1); // explicit: we drive internal size ourselves
  // WebGPURenderer's signature takes a Color, where WebGLRenderer accepts a
  // hex number — first of the small API differences between the two paths.
  renderer.setClearColor(new THREE.Color(0x1a1116));
  mount.appendChild(renderer.domElement);

  // WebGPURenderer is not usable until init() resolves — it has to request an
  // adapter and device. Skipping this is the classic first WebGPU bug: the
  // first frame silently does nothing.
  await renderer.init();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1116, 10, 60);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.set(0, 1.7, 6);

  const sun = new THREE.DirectionalLight(0xffeccd, 1.1);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x4a3a40, 0.6));

  function resize() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const winAspect = winW / winH;
    let renderW: number;
    let renderH: number;
    if (winAspect > MAX_RENDER_W / MAX_RENDER_H) {
      renderH = Math.min(winH, MAX_RENDER_H);
      renderW = Math.round(renderH * winAspect);
      if (renderW > MAX_RENDER_W) { renderW = MAX_RENDER_W; renderH = Math.round(renderW / winAspect); }
    } else {
      renderW = Math.min(winW, MAX_RENDER_W);
      renderH = Math.round(renderW / winAspect);
      if (renderH > MAX_RENDER_H) { renderH = MAX_RENDER_H; renderW = Math.round(renderH * winAspect); }
    }
    renderer.setSize(renderW, renderH, false);
    camera.aspect = winAspect;
    camera.updateProjectionMatrix();

    const el = renderer.domElement;
    el.style.width = winW + 'px';
    el.style.height = winH + 'px';
    el.style.imageRendering = 'pixelated';
  }
  resize();
  window.addEventListener('resize', resize);

  let lastTime = performance.now();
  let cb: (dtSec: number) => void = () => {};
  let drawFn: () => void = () => { void renderer.render(scene, camera); };
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    cb(dt);
    drawFn();
  });

  // `backend.isWebGPUBackend` is how three distinguishes them. Surfacing this
  // matters: WebGPURenderer transparently falls back to a WebGL2 backend, and
  // "it worked" on the fallback is NOT evidence the WebGPU path works.
  const backendName =
    (renderer.backend as unknown as { isWebGPUBackend?: boolean })?.isWebGPUBackend
      ? 'webgpu' : 'webgl';

  return {
    renderer,
    scene,
    camera,
    canvas: renderer.domElement as HTMLCanvasElement,
    setRenderCallback(fn) { cb = fn; },
    setDrawFn(fn) { drawFn = fn; },
    backend: backendName,
  };
}
