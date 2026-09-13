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
import type { FrameTiming } from './game-telemetry';

export interface LabRendererHandle {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  setRenderCallback(cb: (dtSec: number) => void): void;
  setDrawFn(fn: () => void): void;
  /** Observe natural frames only; CPU submission timing is NOT GPU duration. */
  setFrameObserver(observer: ((frame: FrameTiming) => void) | null): void;
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
  /**
   * Present at most `fps` frames per second, 0 to uncap. OFF by default: the
   * bench measures wall-clock deltas in its own render callback, and pacing
   * would flatten every benchmark reading to the cap. Pages opt in.
   */
  setFrameCap(fps: number): void;
  /** The active cap in fps, 0 when uncapped. */
  readonly frameCap: number;
  /** Draw ONE frame without the tick callback. The task-6 game gate's
   *  still-render seam: hashSurface/readSurfaceAt re-render through this so
   *  two consecutive readbacks of a locked scene are two SEPARATE renders,
   *  not the same target read twice. Pure re-present — no simulation. */
  drawOnce(): void;
  /** The measured display refresh in ms. Measured, never assumed. */
  readonly refreshMs: number;
  step(dtSec: number): void;
  /** step(), returning the synchronous CPU ms of the tick callback and of
   *  the draw (encode + submit) separately. */
  stepTimed(dtSec: number): { tickMs: number; drawMs: number };
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

/** Matches src/engine/renderer.ts, so the lab looks the same on both paths
 *  (these are the 'fit' cap). */
const MAX_RENDER_W = 960;
const MAX_RENDER_H = 540;

/**
 * The render buffer cap.
 *
 * 'fit'   — the lab's original behaviour: keep the WINDOW's aspect, clamp
 *           into maxW x maxH.
 * 'fixed' — a FIXED buffer of an art-directed aspect (the game page's 4:3
 *           retro rungs: 800x600 / 640x480). The internal buffer is EXACTLY
 *           this size whatever the window looks like; the canvas CSS-scales
 *           to the largest matching rectangle and the rest of the window is
 *           letterbox/pillarbox. One clean pixel grid, upscaled once.
 */
export type RenderCap =
  | { mode: 'fit'; maxW: number; maxH: number }
  | { mode: 'fixed'; width: number; height: number };

/** Module state because post-aa's refit() calls computeRenderSize without
 * knowing which page it serves, and there is one renderer per page.
 * createLabRenderer(mount, cap) sets it; default is the legacy lab look. */
let activeCap: RenderCap = { mode: 'fit', maxW: MAX_RENDER_W, maxH: MAX_RENDER_H };

export function setRenderCap(cap: RenderCap): void {
  activeCap = cap;
}

export function getRenderCap(): RenderCap {
  return activeCap;
}

/**
 * The internal render size for a window of winW x winH under the active cap.
 * Exported for post-aa.ts: its content targets (and, via lab-main, the SDF
 * layer) follow THIS size even when the sharp-upscale toggle grows the canvas
 * backing to the full window, so the chunky low-res grid is what gets upscaled
 * either way — by CSS when sharp is off, by the blit pass when it is on.
 */
export function computeRenderSize(
  winW: number, winH: number,
): { width: number; height: number } {
  if (activeCap.mode === 'fixed') {
    return { width: activeCap.width, height: activeCap.height };
  }
  const maxW = activeCap.maxW;
  const maxH = activeCap.maxH;
  const winAspect = winW / winH;
  let renderW: number;
  let renderH: number;
  if (winAspect > maxW / maxH) {
    renderH = Math.min(winH, maxH);
    renderW = Math.round(renderH * winAspect);
    if (renderW > maxW) { renderW = maxW; renderH = Math.round(renderW / winAspect); }
  } else {
    renderW = Math.min(winW, maxW);
    renderH = Math.round(renderW / winAspect);
    if (renderH > maxH) { renderH = maxH; renderW = Math.round(renderH * winAspect); }
  }
  return { width: renderW, height: renderH };
}

/**
 * The CSS size/position for the canvas under the active cap: the whole
 * window for 'fit' (the lab's stretch-to-fill behaviour), or the largest
 * rectangle of the buffer's aspect centred in the window for 'fixed' —
 * the letterbox/pillarbox bars. Exported because post-aa's refit() mirrors
 * this sizing on its own resize path.
 */
export function canvasCssSize(
  winW: number, winH: number,
): { width: number; height: number; left: number; top: number } {
  const content = computeRenderSize(winW, winH);
  const aspect = content.width / content.height;
  const winAspect = winW / winH;
  let w: number;
  let h: number;
  if (winAspect > aspect) { h = winH; w = Math.round(h * aspect); }
  else { w = winW; h = Math.round(w / aspect); }
  return { width: w, height: h, left: Math.round((winW - w) / 2), top: Math.round((winH - h) / 2) };
}

/** `cap` opts this page out of the legacy 960x540 fit-aspect look (see
 *  RenderCap). Omitted = unchanged lab behaviour. */
// ---------------------------------------------------------------------------
// FRAME PACING
// ---------------------------------------------------------------------------
//
// rAF presents on the display's schedule, so "30 fps" reached by letting work
// take ~33 ms is really an alternation between vsync slots -- 33, 50, 33, 50 --
// whose MEAN reads a healthy 38 ms while the hand feels a stagger. Pacing takes
// the deadline back: present on a cadence we chose, so a missed slot is a thing
// we can name rather than infer.
//
// THE SLACK IS HALF A REFRESH, NEVER A CONSTANT. The question each tick asks is
// "has the next slot arrived", and a slot is one refresh interval wide. An
// 8.3 ms constant is right only at 60 Hz; at 120 Hz it fires a tick early and
// paces to 40 fps. That is the same shape of bug as the spike detector's fixed
// 1.8x budget, which went blind the moment the budget stopped being 16.7 ms --
// so this one is expressed relative to a MEASURED refresh from the start.

/** Sane bounds for a display refresh, ms: 240 Hz down to 20 Hz. */
export const REFRESH_MS_RANGE: readonly [number, number] = [1000 / 240, 1000 / 20];

/** What we assume when there is nothing to measure. */
const REFRESH_FALLBACK_MS = 1000 / 60;

function sanitizeRefreshMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return REFRESH_FALLBACK_MS;
  const [lo, hi] = REFRESH_MS_RANGE;
  return Math.min(hi, Math.max(lo, ms));
}

/**
 * The refresh interval, in ms, from raw rAF deltas.
 *
 * MINIMUM, not mean or median: rAF fires every refresh, so a delta is one
 * refresh or a multiple of one (a skipped tick, a hitch, a throttled tab). It
 * can never be LESS. That makes the floor of the samples the estimate, and it
 * is why this works while pacing -- most deltas are 2x refresh on a 30 fps cap
 * and the skipped ticks supply the 1x samples for free.
 */
export function estimateRefreshMs(deltasMs: readonly number[]): number {
  let min = Infinity;
  for (const d of deltasMs) if (Number.isFinite(d) && d > 0 && d < min) min = d;
  if (!Number.isFinite(min)) return REFRESH_FALLBACK_MS;
  return sanitizeRefreshMs(min);
}

/**
 * Draw this tick? `capMs` of 0 (or less) is uncapped -- every tick draws, which
 * is the pre-pacing behaviour exactly.
 *
 * No drift correction on purpose. `elapsedMs` is measured from the last frame
 * PRESENTED, so a frame that overran simply resumes the cadence from where it
 * landed rather than trying to catch up -- catching up means presenting two
 * frames back to back, which is the judder this exists to remove.
 */
export function shouldPresent(elapsedMs: number, capMs: number, refreshMs: number): boolean {
  if (!(capMs > 0)) return true;
  return elapsedMs >= capMs - sanitizeRefreshMs(refreshMs) / 2;
}

export async function createLabRenderer(mount: HTMLElement, cap?: RenderCap): Promise<LabRendererHandle> {
  if (cap) setRenderCap(cap);
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
  // COLOUR ATTACHMENT BUDGET (run 4, 2026-09-12): the march can carry three rgba32f attachments
  // (output + normal + anchor) = 48 bytes/sample, over WebGPU's default cap of 32. Ask the device for
  // the adapter's real cap (Apple silicon reports 128) — only when the adapter offers more than the
  // default, so a device that cannot simply keeps the default and the extra attachments stay off.
  let requiredLimits: Record<string, number> | undefined;
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ limits: { maxColorAttachmentBytesPerSample?: number } } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    const cap = adapter?.limits.maxColorAttachmentBytesPerSample ?? 32;
    if (cap > 32) requiredLimits = { maxColorAttachmentBytesPerSample: Math.min(cap, 64) };
  } catch { /* leave the default */ }
  const renderer = new WebGPURenderer({
    antialias: false, trackTimestamp: true, alpha: false,
    ...(requiredLimits ? { requiredLimits } : {}),
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
    const { width: renderW, height: renderH } = computeRenderSize(winW, winH);
    renderer.setSize(renderW, renderH, false);
    // Aspect follows the BUFFER, not the window: identical under 'fit' (the
    // buffer matches the window aspect), correct under 'fixed' (4:3 stays 4:3).
    camera.aspect = renderW / renderH;
    camera.updateProjectionMatrix();

    const el = renderer.domElement;
    const css = canvasCssSize(winW, winH);
    el.style.position = 'absolute';
    el.style.left = css.left + 'px';
    el.style.top = css.top + 'px';
    el.style.width = css.width + 'px';
    el.style.height = css.height + 'px';
    el.style.imageRendering = 'pixelated';
  }
  resize();
  window.addEventListener('resize', resize);

  let lastTime = performance.now();
  // Pacing. `lastPresent` tracks DRAWN frames; `rafDeltas` is a small ring of
  // raw tick gaps, which is where the refresh estimate comes from -- the loop
  // still wakes on every vsync when capped, so the skipped ticks measure the
  // display for free.
  let frameCapMs = 0;
  // The REQUESTED fps is stored rather than re-derived from frameCapMs: the
  // ms round-trip reports 30 as 29.999999999999996, and a tuning seam that
  // echoes back something other than what you typed reads as a bug.
  let frameCapFps = 0;
  let lastPresent = 0;
  let lastRaf = 0;
  const rafDeltas: number[] = [];
  let refreshMs = 1000 / 60;
  let cb: (dtSec: number) => void = () => {};
  let drawFn: () => void = () => { void renderer.render(scene, camera); };
  let frameObserver: ((frame: FrameTiming) => void) | null = null;

  // The query pool has a fixed capacity and warns loudly once it fills, so the
  // resolve has to keep up with the frames. One in-flight resolve at a time is
  // enough: it is async, and a reading every few frames is plenty for tuning.
  let resolving = false;

  const loop = () => {
    const now = performance.now();

    // Measure the display before deciding anything: this runs on EVERY tick,
    // including the ones we skip, which is precisely what makes the estimate
    // available under a cap.
    if (lastRaf > 0) {
      rafDeltas.push(now - lastRaf);
      if (rafDeltas.length > 120) rafDeltas.shift();
      refreshMs = estimateRefreshMs(rafDeltas);
    }
    lastRaf = now;

    if (!shouldPresent(now - lastPresent, frameCapMs, refreshMs)) return;
    lastPresent = now;

    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (frameObserver) {
      const start = performance.now();
      cb(dt);
      const afterTick = performance.now();
      drawFn();
      const end = performance.now();
      frameObserver({ startMs: now, endMs: end, intervalMs: dt * 1000,
        tickCpuMs: afterTick - start, drawCpuMs: end - afterTick });
    } else {
      cb(dt);
      drawFn();
    }

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
    setFrameCap(fps) {
      const ok = Number.isFinite(fps) && fps > 0;
      frameCapFps = ok ? fps : 0;
      frameCapMs = ok ? 1000 / fps : 0;
      // Present the very next tick rather than waiting out a stale interval.
      lastPresent = 0;
    },
    get frameCap() { return frameCapFps; },
    get refreshMs() { return refreshMs; },
    setRenderCallback(fn) { cb = fn; },
    setDrawFn(fn) { drawFn = fn; },
    setFrameObserver(observer) { frameObserver = observer; },
    backend: backendName,
    step(dtSec) { cb(dtSec); drawFn(); },
    drawOnce() { drawFn(); },
    stepTimed(dtSec) {
      const t0 = performance.now();
      cb(dtSec);
      const t1 = performance.now();
      drawFn();
      return { tickMs: t1 - t0, drawMs: performance.now() - t1 };
    },
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
