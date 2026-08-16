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

  /**
   * Drives exactly one frame by hand — the same callback and draw the
   * animation loop runs, with the timestep supplied rather than measured.
   *
   * This exists because `setAnimationLoop` is requestAnimationFrame, and rAF
   * is throttled to a stop whenever the page is not being composited. Every
   * automated measurement runs in a browser pane that hides between tool
   * calls, so a rAF-driven sample window collects a handful of frames over
   * fifteen seconds and the median means nothing. Stepping by hand takes the
   * compositor out of the loop entirely.
   */
  step(dtSec: number): void;
  /**
   * Awaits the GPU timestamp resolve. The VALUE is discarded on purpose: with
   * several render calls per frame and a fire-and-forget resolve in the loop,
   * three's per-frame attribution is unreliable — it once reported 73 ms of
   * "GPU" against a 33 ms frame interval, which is impossible. What the await
   * DOES reliably provide is a completion fence: it does not return until the
   * submitted work has executed, which is what benchGpu's wall-clock chunks
   * are timed against. Trust the fence, never the number.
   */
  resolveGpu(): Promise<void>;
  /**
   * Stops or restarts the animation loop. A benchmark must own the frame
   * clock outright: leaving rAF running alongside hand-driven steps means the
   * two interleave and the timestamps belong to whichever submitted last.
   */
  setLoopRunning(on: boolean): void;
}

/** Matches src/engine/renderer.ts, so the lab looks the same on both paths. */
const MAX_RENDER_W = 960;
const MAX_RENDER_H = 540;

export async function createLabRenderer(mount: HTMLElement): Promise<LabRendererHandle> {
  // trackTimestamp turns on the WebGPU timestamp-query pool. It is the whole
  // reason the perf work can be honest: wall-clock frame time pins to vsync
  // whenever there is headroom, so it cannot distinguish "twice as fast" from
  // "still 60fps". Costs nothing when the feature is absent — the backend
  // ANDs it with hasFeature('timestamp-query') during init.
  // alpha: false — the canvas context is configured alphaMode 'opaque'
  // instead of three's default 'premultiplied'. The scene is fully opaque
  // (the clear colour fills the frame; nothing reads canvas alpha), so this
  // changes nothing visually — but it changes which compositing path Chrome
  // takes for the canvas on macOS. A premultiplied WebGPU canvas cannot be
  // promoted to a direct overlay, and the readback path it lands on instead
  // has a known frame-pacing pathology there: severely degraded pacing for
  // per-frame-updated WebGPU canvases on high-refresh displays (chromium
  // issue 502668704 — the collapse-stall investigation, X1.22.1; see
  // docs/dev-notes/2026-08-16-collapse-stall/notes.md). 'opaque' keeps the
  // present on the overlay-capable path and stops tripping it.
  const renderer = new WebGPURenderer({
    antialias: false, trackTimestamp: true, alpha: false,
  });
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

  // The query pool has a fixed capacity and warns loudly once it fills, so the
  // resolve has to keep up with the frames. One in-flight resolve at a time is
  // enough: it is async, and a reading every few frames is plenty for tuning.
  let resolving = false;

  const loop = () => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    cb(dt);
    drawFn();

    // Drain the timestamp query pool. It has a fixed capacity and warns loudly
    // once it fills, so the resolve has to keep up with the frames even though
    // nothing reads its value any more (the per-frame number was unreliable
    // with multiple passes per frame — see resolveGpu's note).
    if (!resolving) {
      resolving = true;
      renderer.resolveTimestampsAsync()
        .catch(() => {})
        .finally(() => { resolving = false; });
    }
  };
  renderer.setAnimationLoop(loop);

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
    step(dtSec) { cb(dtSec); drawFn(); },
    async resolveGpu() {
      try {
        await renderer.resolveTimestampsAsync();
      } catch {
        // The fence failing means no timestamp feature; nothing to do.
      }
    },
    setLoopRunning(on) {
      renderer.setAnimationLoop(on ? loop : null);
      // Otherwise the first frame back sees the whole benchmark as its dt and
      // the rig integrates a several-second step in one go.
      if (on) lastTime = performance.now();
    },
  };
}
