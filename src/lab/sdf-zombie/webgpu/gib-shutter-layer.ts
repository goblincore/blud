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

/**
 * The render-object pass id the layer draw uses (see capture step 1).
 *
 * WHY IT EXISTS (blur-engage hitch, 2026-09-26). three r186 keys a render
 * object by (object, material, render CONTEXT, scene lights node) inside a
 * per-pass-id map, and the render context is keyed only by the target's
 * attachment signature — so the half-float+depth layer target and the base
 * pass' half-float+depth capture target share ONE context, hence ONE render
 * object per mesh. The layer draw sees no scene lights (the camera is on
 * GIB_BLUR_LAYER), the base pass sees all of them, and the lights are part of
 * the render object's cache key: every time a mesh moved between the passes
 * three disposed its render object and rebuilt it — node build, shader
 * modules and a SYNCHRONOUS pipeline — on the engage frame AND the release
 * frame of every censer swing (~50 + 35 ms CPU, measured). A distinct pass id
 * gives the layer draw its own render objects, each with a stable key.
 */
export const GIB_SHUTTER_PASS_ID = 'gib-shutter';

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
 *  where it renders when it is NOT selected. A piece drawn by SEVERAL meshes
 *  (the censer's head, haft + hand) passes one subject per mesh sharing ONE
 *  `state` object: the piece cap counts distinct states and the seed plans each
 *  state's stamps once (from the FIRST such subject), so a many-mesh piece
 *  costs one piece, not N. Subjects sharing a state MUST therefore share `id`
 *  and `ageSeconds` too — the later ones' values are never read. Conversely
 *  several states may share one mesh (the chain's rod samples); select() never
 *  demotes a mesh an earlier subject lifted in the same call. */
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
  /**
   * The selected pieces' depth from the most recent layer draw, or null when
   * no layer target exists. The blood resolve uses it as a second occluder so
   * blood behind a blurred gib is dropped rather than painted over it.
   */
  readonly occluderDepth: THREE.DepthTexture | null;
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
  /**
   * Compile `object`'s material in THIS layer's selected-piece context (the
   * half-float layer target, camera on GIB_BLUR_LAYER) through the ASYNC
   * pipeline API. The gib march material is a ~240 KB shader; first drawn here
   * by `capture` it was built SYNCHRONOUSLY mid-game, a 45 s GPU-process stall
   * on a cold Metal cache (measured 2026-09-18). Bounded by `timeoutMs`; the
   * object's layer mask is restored. Resolves false when nothing was compiled.
   */
  precompileSubject(
    object: THREE.Object3D, capture: THREE.RenderTarget, scene: THREE.Scene,
    camera: THREE.PerspectiveCamera, timeoutMs: number,
  ): Promise<boolean>;
  /**
   * `precompileSubject` for a call made WHILE THE LIVE LOOP IS RUNNING
   * (defer-compile task, 2026-09-19). `precompileSubject` sets the SHARED
   * camera's layer mask to GIB_BLUR_LAYER for its whole await and holds the
   * layer's private target; a live frame in between reads that mask in
   * `sdf-layer.render` and would draw an empty polygonal pass. This compiles
   * through a camera CLONE and restores the renderer's target immediately
   * after `compileAsync`'s synchronous prologue (three captures the render
   * context before its first await; the camera is never part of the pipeline
   * cache key). Returns false on a throw or an unsettled bounded wait.
   */
  precompileSubjectInBackground(
    object: THREE.Object3D, capture: THREE.RenderTarget, scene: THREE.Scene,
    camera: THREE.PerspectiveCamera, timeoutMs: number,
  ): Promise<boolean>;
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
  /** Distinct `state` objects among `selected` — the piece count the cap bounds. */
  const selectedStates = new Set<Chunk>();
  const plannedStates = new Set<Chunk>();
  const stamps: SweepStamp[] = [];
  const viewProj = new THREE.Matrix4();
  const clearColor = new THREE.Color();
  const warmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  warmCam.position.z = 1;
  /** The layer draw's render-object function: the default one, re-namespaced
   *  onto GIB_SHUTTER_PASS_ID (a pass three already names, e.g. 'backSide',
   *  keeps its meaning inside the namespace). */
  type ObjectFn = NonNullable<Parameters<THREE.WebGPURenderer['setRenderObjectFunction']>[0]>;
  const drawInLayerPass: ObjectFn = (object, scn, cam, geometry, material, group, lightsNode, clippingContext, passId) => {
    renderer.renderObject(
      object, scn, cam, geometry, material, group, lightsNode, clippingContext,
      passId ? `${GIB_SHUTTER_PASS_ID}:${passId}` : GIB_SHUTTER_PASS_ID,
    );
  };

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
    selectedStates.clear();
    selectedPieces = 0;
  }

  function disposeTargets(): void {
    resolve?.dispose();
    layerTarget?.depthTexture?.dispose();
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
    // SAMPLEABLE DEPTH (task 4). The blood pass runs after this one and needs
    // the blurred gibs' depth to occlude blood behind them; a plain depth
    // renderbuffer is not readable, so attach a DepthTexture. The layer's
    // background is cleared to the far plane, so this is exactly the selected
    // pieces' depth plus "nothing".
    layerTarget.depthTexture = new THREE.DepthTexture(cw, ch);
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
    plannedStates.clear();
    const proj = buildProjection(camera);
    for (const s of selected) {
      if (plannedStates.has(s.state)) continue;   // another mesh of the same piece
      plannedStates.add(s.state);
      const planned = planGibMotionStamps(s.state, s.id, proj, exposureSeconds, {
        maxStreakPx,
        ageSeconds: s.ageSeconds,
      });
      for (const p of planned) stamps.push(p);
    }
    lastStamps = stamps.length;
    return stamps.length;
  }

  /** Meshes lifted onto the blur layer by the CURRENT select() call. */
  const liftedMeshes = new Set<THREE.Object3D>();

  function select(subjects: readonly GibBlurSubject[]): number {
    restoreLayers();
    liftedMeshes.clear();
    const active = enabled && exposureSeconds > 0;
    if (!active) return 0;
    // A rejected subject puts its mesh back on its base layer ONLY if no
    // earlier subject of this call lifted that mesh: several subjects may
    // share one mesh (the censer chain's rod samples on one InstancedMesh), and
    // demoting it would leave a selected piece that is not on the layer.
    const reject = (s: GibBlurSubject): void => {
      if (!liftedMeshes.has(s.mesh) && s.mesh.layers.mask !== 1 << s.baseLayer) s.mesh.layers.set(s.baseLayer);
    };
    for (const s of subjects) {
      if (!selectedStates.has(s.state) && selectedStates.size >= GIB_BLUR_MAX_PIECES) { reject(s); continue; }
      if (!isGibSelectedForBlur(s.state)) { reject(s); continue; }
      s.mesh.layers.set(GIB_BLUR_LAYER);
      liftedMeshes.add(s.mesh);
      selected.push(s);
      selectedStates.add(s.state);
    }
    selectedPieces = selectedStates.size;
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
      // OWN RENDER OBJECTS (GIB_SHUTTER_PASS_ID): without them a mesh lifted
      // here re-keys, and three rebuilds, the render object it shares with the
      // base pass on every engage and every release.
      const prevObjectFn = renderer.getRenderObjectFunction();
      renderer.setRenderObjectFunction(drawInLayerPass);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderObjectFunction(prevObjectFn);
        camera.layers.mask = prevMask;
        renderer.autoClear = prevAutoClear;
      }

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
    get occluderDepth() { return (enabled ? layerTarget?.depthTexture : null) ?? null; },
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
    async precompileSubject(object, cap, scene, camera, timeoutMs) {
      if (!supported) return false;
      const prevTarget = renderer.getRenderTarget();
      const prevCamMask = camera.layers.mask;
      const prevObjMask = object.layers.mask;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        ensureTargets(cap);
        if (!layerTarget) return false;
        object.layers.set(GIB_BLUR_LAYER);
        camera.layers.set(GIB_BLUR_LAYER);
        renderer.setRenderTarget(layerTarget);
        const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), timeoutMs); });
        const outcome = await Promise.race([renderer.compileAsync(object, camera, scene).then(() => 'ok' as const), timeout]);
        if (outcome === 'timeout') {
          // eslint-disable-next-line no-console
          console.warn(`[gib-shutter] subject precompile did not settle in ${timeoutMs} ms — skipped`);
          return false;
        }
        return true;
      } catch (err) {
        // Best-effort, like every warm step: NOT routed through fail(), which
        // would disable the layer over a warm-up that merely did not help.
        // eslint-disable-next-line no-console
        console.warn('[gib-shutter] subject precompile failed', err);
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        renderer.setRenderTarget(prevTarget);
        camera.layers.mask = prevCamMask;
        object.layers.mask = prevObjMask;
      }
    },
    async precompileSubjectInBackground(object, cap, scene, camera, timeoutMs) {
      if (!supported) return false;
      const prevTarget = renderer.getRenderTarget();
      const prevObjMask = object.layers.mask;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        ensureTargets(cap);
        if (!layerTarget) return false;
        // A CLONE: the live camera's mask must not become GIB_BLUR_LAYER for the
        // whole compile (see the interface note). The object is the temporary
        // warm view, so mutating ITS layers is harmless.
        const bgCamera = camera.clone();
        bgCamera.layers.set(GIB_BLUR_LAYER);
        object.layers.set(GIB_BLUR_LAYER);
        renderer.setRenderTarget(layerTarget);
        const compile = renderer.compileAsync(object, bgCamera, scene);
        renderer.setRenderTarget(prevTarget);
        object.layers.mask = prevObjMask;
        const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), timeoutMs); });
        const outcome = await Promise.race([compile.then(() => 'ok' as const), timeout]);
        if (timer !== undefined) clearTimeout(timer);
        if (outcome === 'timeout') {
          // eslint-disable-next-line no-console
          console.warn(`[gib-shutter] subject background precompile did not settle in ${timeoutMs} ms — degrading`);
          return false;
        }
        return true;
      } catch (err) {
        // Best-effort like every warm step: NOT routed through fail().
        // eslint-disable-next-line no-console
        console.warn('[gib-shutter] subject background precompile failed', err);
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        renderer.setRenderTarget(prevTarget);
        object.layers.mask = prevObjMask;
      }
    },
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
