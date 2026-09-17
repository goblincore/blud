// src/lab/sdf-zombie/webgpu/gib-shutter-layer.ts
//
// FLYING-GIB SHUTTER BLUR — GAME INTEGRATION (2026-09-17, shutter task 3).
//
// This is the gib twin of `shutter-game-layer.ts`. It reuses the SAME
// owner-accepted exposure contract and the SAME one-fullscreen-resolve
// candidate, but the content pass and the occlusion story are different.
//
// WHY GIBs NEED A DIFFERENT LAYER. Blood is translucent goo that already lives
// in its own offscreen layers, so the blood pass could just filter it out of
// the goo layer. A gib is an OPAQUE BODY in the main scene: its pixels are the
// final image. To smear one you must (a) take it OUT of the base beauty/color
// pass so a CLEAN background is rendered behind it, (b) draw it alone into a
// layer, and (c) composite the exposure average back over that background with
// a real depth test. Reusing the blood gather without (a) would just move the
// finished opaque image and could never reveal the background behind the trail.
//
// HOW THE SEPARATION IS DONE. Selected moving pieces are moved to a dedicated
// `GIB_BLUR_LAYER` for the frame. The ordinary pass' camera sees only layer 0
// (plus the sdf-layer's own bits), so those pieces are absent from the clean
// capture — no depth they write, no color. The capture stage then points the
// camera at `GIB_BLUR_LAYER` and draws the SAME scene, which renders exactly
// those pieces into the layer. Nothing else is re-rendered, no shadow pass is
// repeated (`shadowMap.autoUpdate` is pinned off for the layer draw), and the
// pieces keep their real materials, faces, cuts and wet detail because they are
// drawn with their own material — never a proxy.
//
// The motion seed is built by `gib-motion-blur.ts` (rotation-aware per-surface
// probes) and resolved by the SAME `createShutterResolve` shader the blood
// layer uses. Ownership is single-valued per texel, so gib and blood seeds stay
// separate and a rotating piece never collapses to a centre-only streak.
//
// The pure half lives in `gib-motion-blur.ts`; only the factory touches
// three/WebGPU.

import * as THREE from 'three/webgpu';
import type { Chunk } from '../gib-chunks';
import { setPassLabel } from './gpu-pass-timing';
import {
  createShutterResolve, rasterizeSweepSeed, seedDimsForOutput, EMPTY_SEED_STATS,
  type ShutterProjection, type ShutterResolveHandle, type SweepSeedStats, type SweepStamp,
} from './shutter-blur';
import {
  resolveDepthBiasM, resolveExposureMs, resolveMaxStreakPx, resolveSeedScale,
  secondsToShutterMs, shutterExposureLabel, SHUTTER_GAME_DEFAULTS,
} from './shutter-game-layer';
import {
  GIB_BLUR_LAYER, GIB_BLUR_MAX_PIECES, isGibSelectedForBlur, planGibMotionStamps,
  readGibShutterEnabled,
} from './gib-motion-blur';

export interface GibShutterSettings {
  enabled: boolean;
  exposureSeconds: number;
  maxStreakPx: number;
  seedScale: number;
  depthBiasM: number;
}

/** Gibs share the blood exposure/streak/seed/bias and add only their switch. */
export function readGibShutterSettings(search: string): GibShutterSettings {
  return {
    enabled: readGibShutterEnabled(search),
    exposureSeconds: SHUTTER_GAME_DEFAULTS.exposureSeconds,
    maxStreakPx: SHUTTER_GAME_DEFAULTS.maxStreakPx,
    seedScale: SHUTTER_GAME_DEFAULTS.seedScale,
    depthBiasM: SHUTTER_GAME_DEFAULTS.depthBiasM,
  };
}

/** A piece the layer may blur. `mesh` is the real drawn node; `baseLayer` is
 *  where it renders when it is NOT selected. */
export interface GibBlurSubject {
  id: number;
  state: Chunk;
  mesh: THREE.Mesh;
  baseLayer: number;
  /** Age in seconds; clamps the exposure so a newborn never streaks backwards
   *  into its own emitter. */
  ageSeconds: number;
}

export interface GibShutterDiagnostics {
  enabled: boolean;
  /** False when the host route cannot isolate gibs (the deferred G-buffer). */
  supported: boolean;
  ready: boolean;
  warmed: boolean;
  exposureSeconds: number;
  exposureMs: number;
  exposureLabel: string;
  maxStreakPx: number;
  seedScale: number;
  depthBiasM: number;
  seed: { width: number; height: number };
  layer: { width: number; height: number };
  selectedPieces: number;
  stamps: number;
  last: SweepSeedStats & { buildMs: number };
  passes: { layerDraws: number; fullscreen: number };
  error: string | null;
}

export interface GibShutterLayer {
  readonly enabled: boolean;
  readonly exposureSeconds: number;
  readonly exposureMs: number;
  readonly maxStreakPx: number;
  readonly seedScale: number;
  readonly depthBiasM: number;
  setEnabled(on: boolean): boolean;
  setExposureMs(ms: number): number;
  setMaxStreakPx(px: number): number;
  setSeedScale(v: number): number;
  setDepthBiasM(m: number): number;
  /**
   * Assign this frame's moving pieces to the blur layer (and put everything
   * else back). MUST run BEFORE the base scene is rendered — that is what
   * removes them from the clean capture. Returns the selected count.
   */
  select(subjects: readonly GibBlurSubject[]): number;
  /**
   * Render the selected pieces into the layer, build the rotation-aware motion
   * seed and resolve it over `capture`. Returns the staged target, or null when
   * there is nothing to do (off, zero exposure, no selected piece) or a hard
   * failure. `capture`'s own depth is the occlusion source.
   */
  capture(
    capture: THREE.RenderTarget, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  ): THREE.RenderTarget | null;
  /** Allocate targets against the real capture size and compile the resolve. */
  prewarm(capture: THREE.RenderTarget): boolean;
  diagnostics(): GibShutterDiagnostics;
  /** Put every subject back on its base layer (dispose / hard failure). */
  restoreLayers(): void;
  dispose(): void;
}

export interface GibShutterLayerOptions {
  renderer: THREE.WebGPURenderer;
  settings?: GibShutterSettings;
  /**
   * Whether the host route can isolate gibs at all. The legacy forward route
   * can (camera-layer isolation); the deferred G-buffer route cannot, so the
   * switch is hard-off there — `setEnabled(true)` returns false and gibs render
   * sharp through their normal route rather than being excluded-but-undrawn.
   */
  supported?: boolean;
  onError?: (message: string) => void;
}

export function createGibShutterLayer(opts: GibShutterLayerOptions): GibShutterLayer {
  const { renderer } = opts;
  const supported = opts.supported !== false;
  const initial = opts.settings ?? readGibShutterSettings('');
  let enabled = supported && initial.enabled;
  let exposureSeconds = initial.exposureSeconds;
  let maxStreakPx = initial.maxStreakPx;
  let seedScale = initial.seedScale;
  let depthBiasM = initial.depthBiasM;

  let layerTarget: THREE.RenderTarget | null = null;
  let stageTarget: THREE.RenderTarget | null = null;
  let seedTex: THREE.DataTexture | null = null;
  let seedData: Float32Array | null = null;
  let resolve: ShutterResolveHandle | null = null;
  let capsW = 0, capsH = 0, seedW = 0, seedH = 0, layerW = 0, layerH = 0;
  let warmed = false;
  let lastError: string | null = null;
  let selectedPieces = 0;
  let lastStamps = 0;
  let lastStats: SweepSeedStats & { buildMs: number } = { ...EMPTY_SEED_STATS, buildMs: 0 };

  const selected: GibBlurSubject[] = [];
  const stamps: SweepStamp[] = [];
  const viewProj = new THREE.Matrix4();
  const clearColor = new THREE.Color();
  const warmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  warmCam.position.z = 1;

  function fail(message: string, err?: unknown): void {
    lastError = err ? `${message}: ${String((err as Error)?.message ?? err)}` : message;
    if (opts.onError) opts.onError(lastError);
    // eslint-disable-next-line no-console
    console.error('[gib-shutter]', lastError, err ?? '');
  }

  function restoreLayers(): void {
    for (const s of selected) {
      if (s.mesh.layers.mask !== 1 << s.baseLayer) s.mesh.layers.set(s.baseLayer);
    }
    selected.length = 0;
    selectedPieces = 0;
  }

  function disposeTargets(): void {
    resolve?.dispose();
    layerTarget?.dispose();
    stageTarget?.dispose();
    seedTex?.dispose();
    resolve = null;
    layerTarget = null;
    stageTarget = null;
    seedTex = null;
    seedData = null;
    capsW = capsH = seedW = seedH = layerW = layerH = 0;
  }

  function ensureTargets(capture: THREE.RenderTarget): void {
    const cw = Math.max(1, capture.width);
    const ch = Math.max(1, capture.height);
    // Gib seed grid: capture/2 at scale 1 — the same texel density the blood
    // seed has at the game's density scale 1, so the shared debug seedScale
    // reads the same on both layers.
    const dims = seedDimsForOutput(cw, ch, 0.5 * seedScale);
    if (
      layerTarget && stageTarget && seedTex && seedData && resolve
      && capsW === cw && capsH === ch && seedW === dims.width && seedH === dims.height
    ) return;
    disposeTargets();
    capsW = cw; capsH = ch; seedW = dims.width; seedH = dims.height;
    layerW = cw; layerH = ch;
    layerTarget = new THREE.RenderTarget(cw, ch, {
      depthBuffer: true, type: THREE.HalfFloatType,
    });
    stageTarget = new THREE.RenderTarget(cw, ch, {
      depthBuffer: false, type: THREE.HalfFloatType,
    });
    seedData = new Float32Array(seedW * seedH * 4);
    seedTex = new THREE.DataTexture(seedData, seedW, seedH, THREE.RGBAFormat, THREE.FloatType);
    seedTex.minFilter = THREE.NearestFilter;
    seedTex.magFilter = THREE.NearestFilter;
    seedTex.needsUpdate = true;
    resolve = createShutterResolve(
      {
        layerTex: layerTarget.texture,
        sceneTex: capture.texture,
        depthTex: capture.depthTexture!,
        seedTex,
      },
      { depthBias: depthBiasM },
    );
    warmOnce();
  }

  function warmOnce(): void {
    if (warmed || !resolve) return;
    warmed = true;
    void renderer.compileAsync(resolve.scene, warmCam).catch(() => {});
  }

  function buildProjection(camera: THREE.PerspectiveCamera): ShutterProjection {
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return {
      viewProj: viewProj.elements,
      viewMatrix: camera.matrixWorldInverse.elements,
      width: layerW,
      height: layerH,
      near: camera.near,
      far: camera.far,
      tanHalfFovY: Math.tan((camera.fov * Math.PI) / 360),
    };
  }

  function planSelectedStamps(camera: THREE.PerspectiveCamera): number {
    stamps.length = 0;
    const proj = buildProjection(camera);
    for (const s of selected) {
      const planned = planGibMotionStamps(s.state, s.id, proj, exposureSeconds, {
        maxStreakPx,
        ageSeconds: s.ageSeconds,
      });
      for (const p of planned) stamps.push(p);
    }
    lastStamps = stamps.length;
    return stamps.length;
  }

  function select(subjects: readonly GibBlurSubject[]): number {
    restoreLayers();
    const active = enabled && exposureSeconds > 0;
    if (!active) return 0;
    for (const s of subjects) {
      if (selected.length >= GIB_BLUR_MAX_PIECES) {
        if (s.mesh.layers.mask !== 1 << s.baseLayer) s.mesh.layers.set(s.baseLayer);
        continue;
      }
      if (!isGibSelectedForBlur(s.state)) {
        if (s.mesh.layers.mask !== 1 << s.baseLayer) s.mesh.layers.set(s.baseLayer);
        continue;
      }
      s.mesh.layers.set(GIB_BLUR_LAYER);
      selected.push(s);
    }
    selectedPieces = selected.length;
    return selectedPieces;
  }

  function capture(
    cap: THREE.RenderTarget, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  ): THREE.RenderTarget | null {
    if (!enabled || !(exposureSeconds > 0) || selected.length === 0) return null;
    try {
      ensureTargets(cap);
      if (!layerTarget || !stageTarget || !seedTex || !seedData || !resolve) return null;

      // 1. SELECTED pieces, once, alone, with their real materials. The camera
      //    is pointed at the dedicated layer so nothing else in the scene is
      //    drawn. The scene's lights live on layer 0, so restricting the camera
      //    to GIB_BLUR_LAYER also excludes them: no shadow pass is repeated, and
      //    no light is needed — the gib materials carry explicit light uniforms
      //    (see baked-chunks.ts) and cast no shadows (only levelGroup does).
      const prevMask = camera.layers.mask;
      const prevAutoClear = renderer.autoClear;
      const prevClear = renderer.getClearColor(clearColor).getHex();
      const prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(layerTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      renderer.setClearColor(prevClear, prevAlpha);
      // autoClear MUST be off for the draw: render() would otherwise clear the
      // just-cleared target a second time with the restored (opaque) colour,
      // making the layer an opaque card that the resolve composites over the
      // whole frame instead of a transparent gib layer.
      renderer.autoClear = false;
      camera.layers.set(GIB_BLUR_LAYER);
      setPassLabel('gib:selected');
      renderer.render(scene, camera);
      camera.layers.mask = prevMask;
      renderer.autoClear = prevAutoClear;

      // 2. CPU motion seed — per-surface, rotation-aware (see gib-motion-blur).
      const buildStart = performance.now();
      planSelectedStamps(camera);
      const stats = stamps.length > 0
        ? rasterizeSweepSeed(stamps, layerW, layerH, seedW, seedH, seedData)
        : { ...EMPTY_SEED_STATS };
      if (stamps.length === 0) seedData.fill(0);
      seedTex.needsUpdate = true;
      const buildMs = performance.now() - buildStart;

      // 3. ONE bounded fullscreen resolve over the CLEAN captured scene + its
      //    depth. The resolve samples the layer along each texel's own stored
      //    motion and composites the exposure average back over the clean
      //    background (which is exactly why the selected pieces were removed
      //    from that background first).
      resolve.setNearFar(camera.near, camera.far);
      resolve.setDepthBias(depthBiasM);
      resolve.setExposure(exposureSeconds);
      resolve.setSeedDims(seedW, seedH);
      setPassLabel('gib:resolve');
      resolve.render(renderer, stageTarget);

      lastStats = { ...stats, buildMs };
      lastError = null;
      return stageTarget;
    } catch (err) {
      fail('capture failed', err);
      restoreLayers();
      return null;
    }
  }

  return {
    get enabled() { return enabled; },
    get exposureSeconds() { return exposureSeconds; },
    get exposureMs() { return secondsToShutterMs(exposureSeconds); },
    get maxStreakPx() { return maxStreakPx; },
    get seedScale() { return seedScale; },
    get depthBiasM() { return depthBiasM; },
    setEnabled(on) {
      // The route gate is authoritative: an unsupported host cannot be talked
      // into the blur by the API or the panel.
      enabled = supported && !!on;
      if (!enabled) restoreLayers();
      return enabled;
    },
    setExposureMs(ms) { exposureSeconds = resolveExposureMs(ms) / 1000; return secondsToShutterMs(exposureSeconds); },
    setMaxStreakPx(px) { maxStreakPx = resolveMaxStreakPx(px); return maxStreakPx; },
    setSeedScale(v) { seedScale = resolveSeedScale(v); return seedScale; },
    setDepthBiasM(m) { depthBiasM = resolveDepthBiasM(m); return depthBiasM; },
    select,
    capture,
    prewarm(capture) {
      if (!supported) return false;
      try {
        ensureTargets(capture);
        return resolve !== null;
      } catch (err) {
        fail('prewarm failed', err);
        return false;
      }
    },
    diagnostics(): GibShutterDiagnostics {
      return {
        enabled,
        supported,
        ready: resolve !== null,
        warmed,
        exposureSeconds,
        exposureMs: secondsToShutterMs(exposureSeconds),
        exposureLabel: shutterExposureLabel(exposureSeconds),
        maxStreakPx,
        seedScale,
        depthBiasM,
        seed: { width: seedW, height: seedH },
        layer: { width: layerW, height: layerH },
        selectedPieces,
        stamps: lastStamps,
        last: { ...lastStats },
        passes: { layerDraws: 1, fullscreen: 1 },
        error: lastError,
      };
    },
    restoreLayers,
    dispose() {
      restoreLayers();
      disposeTargets();
    },
  };
}
