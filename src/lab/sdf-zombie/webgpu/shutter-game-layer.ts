// src/lab/sdf-zombie/webgpu/shutter-game-layer.ts
//
// SELECTIVE SHUTTER BLUR — GAME INTEGRATION (2026-09-17).
//
// This is the production-capable half of the efficient shutter candidate that
// tasks 1–3 built and the owner accepted in the lab. It is deliberately NOT a
// copy of blood-compare-main: there is no timeline, no replay, no recorded
// fixtures and no second scene. It consumes the LIVE BloodSim and the final
// current camera once per presented frame.
//
// What it does per frame:
//
//   1. The goo layer is synced twice. The first sync (driven by game-main's
//      render callback, via `poseSharp()`) poses only the SHARP remainder —
//      floor pools, gut nodes, leftover drops, no connection blobs. The normal
//      goo render composites that into the clean scene.
//   2. `capture()` (installed as post-aa's PRE-POST CAPTURE STAGE) syncs the
//      SELECTED airborne drops/scraps into the goo layer, shades them ONCE
//      into a premultiplied working-linear layer target, builds the CPU motion
//      seed from the live droplet velocities, and runs ONE bounded fullscreen
//      resolve over the captured scene + its own depth.
//   3. post-aa continues with SSCS → FXAA → VHS → lens/blast-distortion on the
//      resolved target, so the blur is never applied after display encoding and
//      the capture's depth is preserved for SSCS.
//
// Owner-accepted defaults (screenshot 2026-09-17 01:21:58):
//   320° at reference 20 fps -> 320/360/20 = 0.044444… s (44.44 ms effective),
//   candidate seed 200x150 (density resolution), 24 taps, depth bias 0.020 m.
// Exposure is a FIXED shutter interval, never a function of measured FPS.
//
// The pure half (defaults, presets, selection, seed dims, query parsing) has no
// GPU dependency and is unit-tested; only the factory touches three/WebGPU.

import * as THREE from 'three/webgpu';
import type { BloodSim, Droplet } from '../blood-sim';
import { GOO_TUNING, type GooLayer, type GooSelection } from './goo-layer';
import { setPassLabel } from './gpu-pass-timing';
import {
  createShutterResolve, planSweepStamp, rasterizeSweepSeed, seedDimsForOutput,
  SHUTTER_CANDIDATE_TAPS, DEFAULT_DEPTH_BIAS_M, EMPTY_SEED_STATS,
  type ShutterProjection, type ShutterResolveHandle, type SweepSeedStats, type SweepStamp,
} from './shutter-blur';

// ---------------------------------------------------------------------------
// Owner-accepted defaults / bounds. Every value here is either the accepted
// screenshot's or an explicit finite cap, so the resolve can never grow work
// without bound on a hitch.
// ---------------------------------------------------------------------------

export const SHUTTER_GAME_ANGLE_DEG = 320;
export const SHUTTER_GAME_REFERENCE_FPS = 20;
/** 320/360/20 s = 44.444… ms. The accepted default; NOT the measured FPS. */
export const SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS =
  SHUTTER_GAME_ANGLE_DEG / 360 / SHUTTER_GAME_REFERENCE_FPS;
/** Accepted initial cap on the drawn streak, content pixels. */
export const SHUTTER_GAME_DEFAULT_MAX_STREAK_PX = 120;
export const SHUTTER_GAME_MAX_STREAK_PX = 400;
export const SHUTTER_GAME_DEFAULT_SEED_SCALE = 1;
export const SHUTTER_GAME_MIN_SEED_SCALE = 0.25;
export const SHUTTER_GAME_MAX_SEED_SCALE = 2;
export const SHUTTER_GAME_DEFAULT_DEPTH_BIAS_M = DEFAULT_DEPTH_BIAS_M;
/** Explicit finite exposure ceiling (200 ms). The resolve's tap count is fixed
 *  and the streak cap bounds the seed, so this only bounds the drawn length. */
export const SHUTTER_GAME_MAX_EXPOSURE_SECONDS = 0.2;

export interface ShutterExposurePreset {
  id: string;
  label: string;
  seconds: number;
}

/**
 * Exposure presets, ms shown alongside. The owner's accepted default sits in
 * the middle; the two stronger values are the "more pronounced the better"
 * presets the task asks for.
 */
export const SHUTTER_GAME_PRESETS: readonly ShutterExposurePreset[] = Object.freeze([
  { id: 'off', label: 'Off', seconds: 0 },
  { id: '1/120', label: '8.33 ms (1/120 s)', seconds: 1 / 120 },
  { id: '1/60', label: '16.67 ms (1/60 s)', seconds: 1 / 60 },
  { id: '1/30', label: '33.33 ms (1/30 s)', seconds: 1 / 30 },
  {
    id: 'default',
    label: '44.44 ms (320° @ 20 fps, default)',
    seconds: SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS,
  },
  { id: '66.67', label: '66.67 ms (stronger)', seconds: 0.06666666666666667 },
  { id: '100', label: '100.00 ms (strongest preset)', seconds: 0.1 },
]);

export function secondsToShutterMs(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : 0;
}

/** Clamp a requested exposure (ms) into [0, cap]. Invalid input -> default. */
export function resolveExposureMs(ms: number | null | undefined): number {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return secondsToShutterMs(SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS);
  }
  const clamped = Math.max(0, Math.min(SHUTTER_GAME_MAX_EXPOSURE_SECONDS * 1000, ms));
  return clamped;
}

export function resolveMaxStreakPx(px: number | null | undefined): number {
  if (px === null || px === undefined || !Number.isFinite(px)) {
    return SHUTTER_GAME_DEFAULT_MAX_STREAK_PX;
  }
  return Math.max(1, Math.min(SHUTTER_GAME_MAX_STREAK_PX, Math.round(px)));
}

export function resolveSeedScale(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return SHUTTER_GAME_DEFAULT_SEED_SCALE;
  }
  return Math.max(SHUTTER_GAME_MIN_SEED_SCALE, Math.min(SHUTTER_GAME_MAX_SEED_SCALE, v));
}

export function resolveDepthBiasM(m: number | null | undefined): number {
  if (m === null || m === undefined || !Number.isFinite(m)) {
    return SHUTTER_GAME_DEFAULT_DEPTH_BIAS_M;
  }
  return Math.max(0, Math.min(50, m));
}

/** A human label for an effective exposure. The angle/preset wording never
 *  replaces the millisecond value the resolve actually integrates. */
export function shutterExposureLabel(seconds: number): string {
  if (!(seconds > 0)) return 'off';
  return `${secondsToShutterMs(seconds).toFixed(2)} ms`;
}

// ---------------------------------------------------------------------------
// Selection: which droplets feed the BLURRED layer. This must match goo-layer's
// own density cutoff exactly, or a particle would either be drawn twice or
// vanish: airborne drops/scraps that the goo pass actually poses.
// `isSelectedForShutter` (shutter-reference) is the category rule; the size
// guard mirrors goo-layer's `d.kind !== 'scrap' && d.size < mistMaxSize` skip.
// ---------------------------------------------------------------------------

export function isSelectedGooDroplet(
  d: Droplet, mistMaxSize: number = GOO_TUNING.mistMaxSize,
): boolean {
  if (d.kind !== 'drop' && d.kind !== 'scrap') return false;
  if (d.kind !== 'scrap' && d.size < mistMaxSize) return false;
  return true;
}

/** goo-layer selection objects, stable across frames (no per-frame allocs). */
export const SHUTTER_SHARP_SELECTION: GooSelection = Object.freeze({
  droplet: (d: Droplet) => !isSelectedGooDroplet(d),
  splats: true,
  extras: false,
});
export const SHUTTER_SELECTED_SELECTION: GooSelection = Object.freeze({
  droplet: (d: Droplet) => isSelectedGooDroplet(d),
  splats: false,
  extras: true,
});

/** Seed grid for the game's density dimensions (aspect-preserving clamp). */
export function shutterSeedDims(
  densityWidth: number, densityHeight: number, scale: number,
): { width: number; height: number } {
  return seedDimsForOutput(densityWidth, densityHeight, resolveSeedScale(scale));
}

// ---------------------------------------------------------------------------
// Query flags / live settings. Ordinary player flow gets on-off, exposure and
// max trail length; seed scale and depth bias remain explicit debug seams.
// ---------------------------------------------------------------------------

export interface ShutterGameSettings {
  enabled: boolean;
  exposureSeconds: number;
  maxStreakPx: number;
  seedScale: number;
  depthBiasM: number;
}

export const SHUTTER_GAME_DEFAULTS: Readonly<ShutterGameSettings> = Object.freeze({
  enabled: true,
  exposureSeconds: SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS,
  maxStreakPx: SHUTTER_GAME_DEFAULT_MAX_STREAK_PX,
  seedScale: SHUTTER_GAME_DEFAULT_SEED_SCALE,
  depthBiasM: SHUTTER_GAME_DEFAULT_DEPTH_BIAS_M,
});

function readBoolParam(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'on' || v === 'true' || v === 'yes') return true;
  return fallback;
}

function readNumberParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the shutter query flags. All are reversible and documented:
 *   ?bloodblur=0|off   disable (default ON)
 *   ?blurms=<ms>       exposure in ms, clamped [0, 200]
 *   ?blurmax=<px>      max trail length in CONTENT pixels, clamped [1, 400]
 *   ?blurseed=<scale>  debug: seed scale vs the density grid, [0.25, 2]
 *   ?blurbias=<m>      debug: destination depth bias, [0, 50]
 */
export function readShutterGameSettings(search: string): ShutterGameSettings {
  const q = new URLSearchParams(search);
  const exposureMs = resolveExposureMs(readNumberParam(q.get('blurms')));
  return {
    enabled: readBoolParam(q.get('bloodblur'), SHUTTER_GAME_DEFAULTS.enabled),
    exposureSeconds: exposureMs / 1000,
    maxStreakPx: resolveMaxStreakPx(readNumberParam(q.get('blurmax'))),
    seedScale: resolveSeedScale(readNumberParam(q.get('blurseed'))),
    depthBiasM: resolveDepthBiasM(readNumberParam(q.get('blurbias'))),
  };
}

// ---------------------------------------------------------------------------
// GPU layer
// ---------------------------------------------------------------------------

export interface ShutterGameDiagnostics {
  enabled: boolean;
  ready: boolean;
  warmed: boolean;
  route: 'capture-stage';
  exposureSeconds: number;
  exposureMs: number;
  exposureLabel: string;
  maxStreakPx: number;
  seedScale: number;
  depthBiasM: number;
  taps: number;
  seed: { width: number; height: number };
  layer: { width: number; height: number };
  selectedDroplets: number;
  last: SweepSeedStats & { buildMs: number };
  passes: { sceneRenders: number; gooChains: number; fullscreen: number };
  error: string | null;
}

export interface ShutterGameLayer {
  readonly enabled: boolean;
  readonly exposureSeconds: number;
  readonly exposureMs: number;
  readonly maxStreakPx: number;
  readonly seedScale: number;
  readonly depthBiasM: number;
  setEnabled(on: boolean): boolean;
  /** Longer ms = longer trails. Clamped to the explicit finite ceiling. */
  setExposureMs(ms: number): number;
  setMaxStreakPx(px: number): number;
  /** Debug seam: seed grid scale vs the goo density dimensions. */
  setSeedScale(v: number): number;
  /** Debug seam: metric depth bias for the destination resolve. */
  setDepthBiasM(m: number): number;
  /**
   * Install the SHARP-remainder selection on the goo layer. Call it in the
   * render callback BEFORE the frame's `gooLayer.sync()`; when blur is off it
   * clears the selection so the goo frame is bit-identical to the shipped one.
   */
  poseSharp(): void;
  /**
   * The PRE-POST CAPTURE STAGE. Renders the selected layer + seed + resolve
   * over `capture` and returns the target post-aa should read next, or null to
   * leave the capture (blur off, no selected blood, or a surfaced error).
   */
  capture(
    capture: THREE.RenderTarget, sim: BloodSim, camera: THREE.PerspectiveCamera,
  ): THREE.RenderTarget | null;
  /** Warm the resolve + reference-layer pipelines. Safe to call once at boot. */
  precompile(): Promise<void>;
  diagnostics(): ShutterGameDiagnostics;
  dispose(): void;
}

export interface ShutterGameLayerOptions {
  renderer: THREE.WebGPURenderer;
  gooLayer: GooLayer;
  settings?: ShutterGameSettings;
  /** Surface a hard failure (never silently swallow the default). */
  onError?: (message: string) => void;
}

export function createShutterGameLayer(opts: ShutterGameLayerOptions): ShutterGameLayer {
  const { renderer, gooLayer } = opts;
  const initial = opts.settings ?? readShutterGameSettings('');
  let enabled = initial.enabled;
  let exposureSeconds = initial.exposureSeconds;
  let maxStreakPx = initial.maxStreakPx;
  let seedScale = initial.seedScale;
  let depthBiasM = initial.depthBiasM;

  let layerTarget: THREE.RenderTarget | null = null;
  let stageTarget: THREE.RenderTarget | null = null;
  let seedTex: THREE.DataTexture | null = null;
  let seedData: Float32Array | null = null;
  let resolve: ShutterResolveHandle | null = null;
  let capsW = 0, capsH = 0;
  let seedW = 0, seedH = 0;
  let layerW = 0, layerH = 0;
  let warmed = false;
  let lastError: string | null = null;

  let lastStats: SweepSeedStats & { buildMs: number } = { ...EMPTY_SEED_STATS, buildMs: 0 };
  let selectedDroplets = 0;

  const stamps: SweepStamp[] = [];
  const viewProj = new THREE.Matrix4();
  const clearColor = new THREE.Color();
  const warmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  warmCam.position.z = 1;

  function fail(message: string, err?: unknown): void {
    lastError = err ? `${message}: ${String((err as Error)?.message ?? err)}` : message;
    if (opts.onError) opts.onError(lastError);
    // eslint-disable-next-line no-console
    console.error('[shutter-game]', lastError, err ?? '');
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

  function ensureTargets(capture: THREE.RenderTarget, densityW: number, densityH: number): void {
    const dims = shutterSeedDims(densityW, densityH, seedScale);
    const cw = Math.max(1, capture.width);
    const ch = Math.max(1, capture.height);
    if (
      layerTarget && stageTarget && seedTex && seedData && resolve
      && capsW === cw && capsH === ch && seedW === dims.width && seedH === dims.height
    ) return;
    // NB: the resolve binds the CAPTURE textures at build time; post-aa keeps
    // one sceneTarget object across resizes (it resizes in place), so a bound
    // texture stays valid — but we rebuild on any size change anyway so the
    // new layer/seed dimensions and the target shape always agree.
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
    // No explicit init clear here: this method runs INSIDE post-aa's render
    // callback, and issuing a setRenderTarget/clear there wedged the headless
    // GPU. It is unnecessary anyway — every capture clears layerTarget
    // (colour + depth) before renderLayer, and the resolve writes all of
    // stageTarget's pixels, so neither is ever sampled uninitialised.
    // Warm the pipelines in this exact target configuration, once. Await-and-
    // forget: the first real frame still works if the compile loses the race.
    warmOnce();
  }

  function warmOnce(): void {
    if (warmed || !resolve) return;
    warmed = true;
    void renderer.compileAsync(resolve.scene, warmCam).catch(() => {});
    void gooLayer.precompileLayer();
  }

  function planSelectedStamps(sim: BloodSim, camera: THREE.PerspectiveCamera): number {
    stamps.length = 0;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const proj: ShutterProjection = {
      viewProj: viewProj.elements,
      viewMatrix: camera.matrixWorldInverse.elements,
      width: layerW,
      height: layerH,
      near: camera.near,
      far: camera.far,
      tanHalfFovY: Math.tan((camera.fov * Math.PI) / 360),
    };
    const stampOpts = {
      maxStreakPx,
      sizeScale: gooLayer.sizeScale,
      quadScale: GOO_TUNING.quadScale,
      mistMaxSize: GOO_TUNING.mistMaxSize,
      // No pre-birth streaks: a bead is only exposed for its own age.
      clampToAge: true,
    } as const;
    let selected = 0;
    for (const d of sim.droplets) {
      if (!isSelectedGooDroplet(d)) continue;
      selected++;
      const s = planSweepStamp(d, proj, exposureSeconds, stampOpts);
      if (s) stamps.push(s);
    }
    selectedDroplets = selected;
    return selected;
  }

  function capture(
    cap: THREE.RenderTarget, sim: BloodSim, camera: THREE.PerspectiveCamera,
  ): THREE.RenderTarget | null {
    if (!enabled || !(exposureSeconds > 0)) return null;
    try {
      const diag = gooLayer.densityDiagnostics;
      ensureTargets(cap, diag.densityWidth, diag.densityHeight);
      if (!layerTarget || !stageTarget || !seedTex || !seedData || !resolve) return null;

      if (planSelectedStamps(sim, camera) === 0) {
        // EMPTY WORK FAST PATH: the sharp-remainder pass already drew the whole
        // fused frame (nothing was selected), so the captured frame is exactly
        // the shipped one. Skip the layer and the resolve entirely.
        lastStats = { ...EMPTY_SEED_STATS, buildMs: 0 };
        return null;
      }

      // 1. SELECTED airborne blood, shaded ONCE as premultiplied colour+coverage.
      gooLayer.setSelection(SHUTTER_SELECTED_SELECTION);
      gooLayer.sync(sim, camera);
      const prevClear = renderer.getClearColor(clearColor).getHex();
      const prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(layerTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = true;
      setPassLabel('shutter:selected-goo');
      gooLayer.renderLayer(camera, layerTarget);

      // 2. CPU MOTION SEED. The stamps were planned against the live sim; an
      //    empty stamp list CLEARS the seed rather than re-uploading a stale
      //    sweep, so a selected droplet with unusable motion still composites
      //    its sharp current shape through the layer's base and is never lost.
      const buildStart = performance.now();
      const stats = stamps.length > 0
        ? rasterizeSweepSeed(stamps, layerW, layerH, seedW, seedH, seedData)
        : { ...EMPTY_SEED_STATS };
      if (stamps.length === 0) seedData.fill(0);
      seedTex.needsUpdate = true;
      const buildMs = performance.now() - buildStart;

      // 3. ONE bounded fullscreen resolve over the captured scene + its depth.
      resolve.setNearFar(camera.near, camera.far);
      resolve.setDepthBias(depthBiasM);
      resolve.setExposure(exposureSeconds);
      resolve.setSeedDims(seedW, seedH);
      setPassLabel('shutter:resolve');
      resolve.render(renderer, stageTarget);

      lastStats = { ...stats, buildMs };
      lastError = null;
      return stageTarget;
    } catch (err) {
      fail('capture failed', err);
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
      enabled = !!on;
      // Turning blur off must restore the fused goo on the very next frame:
      // the caller's next poseSharp() clears the goo selection.
      return enabled;
    },
    setExposureMs(ms) {
      const clamped = resolveExposureMs(ms);
      exposureSeconds = clamped / 1000;
      return clamped;
    },
    setMaxStreakPx(px) { maxStreakPx = resolveMaxStreakPx(px); return maxStreakPx; },
    setSeedScale(v) { seedScale = resolveSeedScale(v); return seedScale; },
    setDepthBiasM(m) { depthBiasM = resolveDepthBiasM(m); return depthBiasM; },
    poseSharp() {
      gooLayer.setSelection(enabled && exposureSeconds > 0 ? SHUTTER_SHARP_SELECTION : null);
    },
    capture,
    async precompile() {
      warmOnce();
    },
    diagnostics(): ShutterGameDiagnostics {
      return {
        enabled,
        ready: resolve !== null,
        warmed,
        route: 'capture-stage',
        exposureSeconds,
        exposureMs: secondsToShutterMs(exposureSeconds),
        exposureLabel: shutterExposureLabel(exposureSeconds),
        maxStreakPx,
        seedScale,
        depthBiasM,
        taps: SHUTTER_CANDIDATE_TAPS,
        seed: { width: seedW, height: seedH },
        layer: { width: layerW, height: layerH },
        selectedDroplets,
        last: { ...lastStats },
        passes: { sceneRenders: 0, gooChains: 1, fullscreen: 1 },
        error: lastError,
      };
    },
    dispose() {
      disposeTargets();
    },
  };
}
