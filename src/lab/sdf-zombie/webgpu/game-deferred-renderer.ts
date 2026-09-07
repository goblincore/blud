// src/lab/sdf-zombie/webgpu/game-deferred-renderer.ts
//
// THE GAME'S DEFERRED FRAME COORDINATOR (hybrid deferred M2 task 5, spec
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m2-design.md). Owns the
// composition of ONE deferred game frame and nothing else:
//
//   shadows -> shared light list -> environment -> opaque G-buffer (mesh then
//   SDF producer passes, routed through the task-3 GameDeferredScene) ->
//   lighting/present into the post-aa output target -> registered forward
//   content composited against the presented depth.
//
// It does NOT own simulation. Actor poses, muzzle ages, flicker and chunk
// steps stay in game-main's tick; this module reads whatever is live at draw
// time through the callbacks it is handed (`lights()`, `environment()`), so
// boot never has to read a game variable that does not exist yet.
//
// WHY THE ROUTER DRAWS BOTH PRODUCER PASSES FROM ONE SCENE. The M1 fixture
// uses two THREE.Scenes; the game has ONE scene with everything in it. The
// task-3 router's scoped draw is the mechanism that makes one scene work:
// draw('mesh') hides every renderable that is not mesh-routed, draw('sdf')
// hides everything that is not an SDF producer, and unregistered renderables
// are hidden from both G-buffer passes by default. The camera's default layer
// mask (layer 0 only) is the SECOND belt: the cone/occluder/shell/shadow hull
// helpers ride their own layers and could never rasterise in the forward pass
// even before the router's `exclude` registrations are consulted.
//
// FORWARD PASS. After the layer's present (which writes the RESOLVED depth
// into the output target — task 1's depth-writing present), the router's
// forward draw composites the first-person viewmodel, blood sprites, pellets
// and flash billboards over the frame with autoClear off and hardware depth
// testing on. This is also what fixes the 2026-08-28 trap by construction in
// deferred mode: a forward-drawn flash can never be painted over by an SDF
// composite, because the composite has already happened.
//
// SHADOWS. The task-4 factory renders the two 1024² flashlight maps each
// frame BEFORE the layer render (current-frame light motion). The full map
// sees layer 0 plus the inflated SHADOW_HULL_LAYER proxies; the level-only
// map sees layer 0 alone — exactly the legacy rig's caster split, expressed
// as layer sets. `?spotshadow=0` (or setSpotShadow(false)) skips generation
// entirely; setSpotShadowSampling(false) keeps the maps rendering but tells
// the layer not to darken (the diagnostic sampling-only toggle — the two
// counters stay distinct: renderedMaps vs the sampling flag).

import * as THREE from 'three/webgpu';
import {
  createDeferredLayer,
  type DeferredDebugView,
  type DeferredEnvironment,
  type DeferredLayer,
} from './deferred-layer';
import { SHADOW_HULL_LAYER, SDF_LAYER } from './sdf-layer';
import {
  createDeferredFlashlightShadows,
  type DeferredFlashlightShadowFactory,
} from './deferred-shadows';
import {
  buildGameDeferredLights,
  type GameDeferredFlashKey,
  type GameDeferredLightSet,
  type GameLightCandidate,
} from './game-deferred-lights';
import { createGameDeferredScene, type GameDeferredScene } from './game-deferred-scene';

// ---------------------------------------------------------------------------
// Boot-mode resolution (pure — unit-tested without a renderer)
// ---------------------------------------------------------------------------

export type GameRenderMode = 'legacy' | 'deferred';

export interface GameBootMode {
  mode: GameRenderMode;
  /**
   * Non-null when an EXPLICIT `?renderer=deferred` request cannot be
   * honoured (no WebGPU backend). The caller must surface this on the page
   * and STOP — silently booting legacy would benchmark the wrong renderer
   * while claiming deferred. Absent/legacy requests never produce a fatal.
   */
  fatal: string | null;
  /** Non-null for a recognised-but-unknown value: we boot legacy and say so. */
  warning: string | null;
}

/**
 * Resolves the boot render mode from the raw `?renderer=` query value and the
 * lab renderer's backend string, ONCE at boot. Absent and 'legacy' select the
 * legacy path; 'deferred' selects the deferred path only when the backend is
 * really 'webgpu' (WebGPURenderer silently falls back to WebGL — the backend
 * string is the only honest signal, see lab-renderer.ts).
 */
export function resolveGameBootMode(rendererParam: string | null, backend: string): GameBootMode {
  const value = rendererParam === null ? null : rendererParam.trim().toLowerCase();
  if (value === null || value === '' || value === 'legacy') {
    return { mode: 'legacy', fatal: null, warning: null };
  }
  if (value === 'deferred') {
    if (backend === 'webgpu') return { mode: 'deferred', fatal: null, warning: null };
    return {
      mode: 'deferred',
      fatal: '?renderer=deferred requires the WebGPU backend, but this page booted '
        + `'${backend || 'unknown'}'. Refusing to fall back to the legacy renderer silently.`,
      warning: null,
    };
  }
  return {
    mode: 'legacy',
    fatal: null,
    warning: `unknown ?renderer='${rendererParam}' — booting the legacy renderer (did you mean 'deferred'?)`,
  };
}

// ---------------------------------------------------------------------------
// The environment adapter (pure — unit-tested without a renderer)
// ---------------------------------------------------------------------------

/** The inputs the environment adapter needs, as plain data. Structurally the
 *  AmbientRig the dungeon code already ships, restated locally so the adapter
 *  stays decoupled from dungeon-lighting's import graph in tests. */
export interface DeferredRigInputs {
  ambientColor: readonly [number, number, number];
  ambientIntensity: number;
  hemiSky: readonly [number, number, number];
  hemiIntensity: number;
  fogColor: readonly [number, number, number];
  fogNear: number;
  fogFar: number;
}

/**
 * Converts the game's ambient rig into the deferred layer's environment.
 *
 * The game lights its standard materials with an AmbientLight AND a
 * HemisphereLight; the deferred lit stage takes ONE constant ambient. The
 * hemisphere's sky term is normal-dependent in three and constant here, so it
 * folds in at half weight — close enough that the dungeon's near-black floor
 * ambient stays near-black and the gallery stays bright, with the residual
 * calibrated through captures (task 7 owns the look comparison). Fog maps
 * 1:1: both rigs ship real fog values and the game never disables scene fog.
 */
export function deferredEnvironmentFromRig(rig: DeferredRigInputs): DeferredEnvironment {
  const mix = (a: number, b: number) => a * rig.ambientIntensity + b * rig.hemiIntensity * 0.5;
  return {
    ambient: new THREE.Color(
      mix(rig.ambientColor[0], rig.hemiSky[0]),
      mix(rig.ambientColor[1], rig.hemiSky[1]),
      mix(rig.ambientColor[2], rig.hemiSky[2]),
    ),
    fogColor: new THREE.Color(rig.fogColor[0], rig.fogColor[1], rig.fogColor[2]),
    fogNear: rig.fogNear,
    fogFar: rig.fogFar,
    fogEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// The coordinator
// ---------------------------------------------------------------------------

export interface GameDeferredRendererDeps {
  renderer: THREE.WebGPURenderer;
  /** The ONE game scene. Routed, never reparented — see the module header. */
  scene: THREE.Scene;
  /**
   * LIVE candidate lights, re-read every frame. The game returns the
   * flashlight spot, the muzzle PointLight (null until the gun GLB resolves —
   * return no candidate for it) and the accent practicals. Nothing here may
   * read a variable that is not initialised before the first frame can fire.
   */
  lights: () => readonly GameLightCandidate[];
  /** LIVE environment, re-read every frame (the rig can flip at runtime). */
  environment: () => DeferredEnvironment;
  /** LIVE march-key response for the flashlight slot, re-read every frame
   *  (M2 task 5): the legacy march's beam gain and highlight-shoulder knee
   *  for flesh receivers. Undefined/absent = the slot keeps pure
   *  packed-intensity behaviour (the task-3/fixture shape). Reading game-
   *  main's beamTuning through a getter keeps setBeamTuning and the deferred
   *  path on one source of truth. */
  flashKey?: () => GameDeferredFlashKey | undefined;
  /** The flashlight spot the shadow maps follow. */
  flashlight: THREE.SpotLight;
  /** Shadow-map edge length. Default 1024 — the spec's number, also the
   *  legacy rig's own mapSize. */
  shadowSize?: number;
  /** Initial deferred-layer size. The game feeds post-aa's content size and
   *  keeps it current through setSize. */
  width?: number;
  height?: number;
  /** Initial SDF producer scale (1 = full res). setScale moves it later. */
  sdfScale?: number;
}

export interface GameDeferredRendererDiagnostics {
  mode: 'deferred';
  /** Frames this coordinator has rendered. */
  frames: number;
  /** Route catalog: object counts per route + unsupported material names. */
  router: ReturnType<GameDeferredScene['diagnostics']>;
  /** The last frame's shared light selection. `flashKey` records the
   *  flashlight's stamped march-key fields (or null when the slot carries
   *  none) so a gate can pin that the conversion actually landed. */
  lights: {
    ids: string[];
    dropped: string[];
    flashlightIndex: number;
    flashKey: { fleshKeyIntensity: number; fleshShoulderKnee: number } | null;
  };
  /** Shadow generation (maps) vs sampling (the lit stage's use of them).
   *  Deliberately separate toggles with separate evidence — the spec's
   *  "sampling-only toggle with distinct counters". */
  shadow: {
    generationRequested: boolean;
    sampling: boolean;
    renderedMaps: number;
    fullCasters: number;
    levelCasters: number;
    size: number;
    unsupported: string[];
  };
  /** Deferred-layer + output sizes, for the gates. */
  sizes: {
    width: number;
    height: number;
    sdfScale: number;
    sdfTargetSize: { width: number; height: number };
    outputTarget: { width: number; height: number } | null;
  };
  lightGain: number;
  /** Bounded page-side error record (the coordinator survives a throwing
   *  frame so a gate can read WHY the frame died from diagnostics). */
  errors: string[];
}

export interface GameDeferredRenderer {
  /** The scene router. game-main registers objects/routes as it spawns them. */
  readonly router: GameDeferredScene;
  /** PostAaSink. The post chain hands us the capture target when any effect
   *  is active, null for the canvas; the layer AND the forward pass present
   *  into whatever this holds. */
  setOutputTarget(target: THREE.RenderTarget | null): void;
  /** Track post-aa's content size (the capped buffer everything runs at). */
  setSize(width: number, height: number): void;
  /** Track the SDF producer scale (adaptive resolution / rungs). */
  setScale(scale: number): void;
  /** The one exposure knob — scales every deferred light's intensity without
   *  touching the source THREE lights. Default 1. */
  setLightGain(gain: number): void;
  /** Shadow map GENERATION. false skips both raster passes (the boot
   *  ?spotshadow=0 ablation). */
  setShadowGeneration(on: boolean): void;
  /** Shadow SAMPLING. false keeps the maps rendering but the lit stage
   *  ignores them — the diagnostic sampling-only toggle. */
  setShadowSampling(on: boolean): void;
  setDebugView(view: DeferredDebugView): void;
  /** The one deferred frame. Called from game-main's post-aa chain (possibly
   *  nested inside goo's between() callback). */
  render(camera: THREE.PerspectiveCamera): void;
  diagnostics(): GameDeferredRendererDiagnostics;
  dispose(): void;
}

const MAX_RECORDED_ERRORS = 8;

/** The game adapter's default exposure (M2 task 5 calibration, 2026-09-07).
 *  The flashKey march-key conversion fixes the falloff FAMILY; this scalar
 *  fixes the magnitude against matched captures (docs/dev-notes/
 *  2026-09-06-hybrid-deferred-m2/task-5.md): at the faced wounded-zombie
 *  pose, gain 0.5 puts the beam-lit torso at clip 1.1% (legacy 0.7%) and
 *  mean 167 vs legacy 171, with the lit wall at 0.9x legacy and the dark
 *  wall at parity. Gain 1.0 clips 32-40% of the torso/face (the wound-
 *  deleting blowout this calibration exists to prevent). The knob stays
 *  live: __sdfGame.setDeferredLightGain(v) for tasks 6-7 fine-tuning. */
export const GAME_DEFERRED_LIGHT_GAIN = 0.5;

export function createGameDeferredRenderer(deps: GameDeferredRendererDeps): GameDeferredRenderer {
  const { renderer, scene, flashlight } = deps;

  const layer: DeferredLayer = createDeferredLayer(renderer, {
    width: deps.width ?? 800,
    height: deps.height ?? 600,
    sdfScale: deps.sdfScale ?? 1,
  });
  const shadows: DeferredFlashlightShadowFactory = createDeferredFlashlightShadows(renderer, {
    size: deps.shadowSize ?? 1024,
  });
  const router: GameDeferredScene = createGameDeferredScene(scene);

  // Live coordinator state. Defaults are the spec's: shadows on, sampling
  // on, and the CALIBRATED exposure (GAME_DEFERRED_LIGHT_GAIN — was identity
  // before the task-5 matched-capture calibration).
  let outputTarget: THREE.RenderTarget | null = null;
  let width = deps.width ?? 800;
  let height = deps.height ?? 600;
  let sdfScale = deps.sdfScale ?? 1;
  let lightGain = GAME_DEFERRED_LIGHT_GAIN;
  let shadowGeneration = true;
  let shadowSampling = true;
  let frames = 0;
  const errors: string[] = [];
  let lastLights: GameDeferredLightSet = { lights: [], ids: [], dropped: [], flashlightIndex: -1 };
  let lastDebugView: DeferredDebugView = 'lit';

  function recordError(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    if (errors.length < MAX_RECORDED_ERRORS) errors.push(msg);
    // Always loud on the console — a swallowed render error that only a
    // diagnostics poll can see is the "silently benchmarking legacy" class
    // of lie this task exists to kill.
    console.error('[game-deferred-renderer]', e);
  }

  const drawMesh = (camera: THREE.PerspectiveCamera) => {
    // The G-buffer mesh pass is layer 0 (level, kits, baked chunks, bone
    // tubes). Setting the mask also keeps any future helper on a private
    // layer out of the pass even if its registration is forgotten.
    camera.layers.set(0);
    router.draw('mesh', renderer, camera);
  };
  const drawSdf = (camera: THREE.PerspectiveCamera) => {
    // The SDF producer pass sees ONLY the SDF layer — the body/chunk proxy
    // boxes ride it, and the mask is what makes the pass O(producer) even
    // before the router's visibility scoping applies. The layer's render()
    // restores the camera's mask in its own finally.
    camera.layers.set(SDF_LAYER);
    router.draw('sdf', renderer, camera);
  };

  return {
    router,
    setOutputTarget(target) {
      // BOTH sides must know: the layer presents into this target, and the
      // coordinator's forward pass composites into the same one afterwards.
      // Forwarding only the local field (the first wiring) left the layer
      // presenting to the CANVAS while post-aa blitted a target that only
      // ever received the forward pass — an opaque world erased by the blit
      // (found by the task-5 GPU boot check, 2026-09-07).
      outputTarget = target;
      layer.setOutputTarget(target);
    },
    setSize(w, h) {
      width = w;
      height = h;
      layer.resize(w, h, sdfScale);
    },
    setScale(scale) {
      sdfScale = scale;
      layer.resize(width, height, sdfScale);
    },
    setLightGain(gain) {
      if (!Number.isFinite(gain) || gain < 0) throw new RangeError(`lightGain must be finite >= 0, got ${gain}`);
      lightGain = gain;
    },
    setShadowGeneration(on) { shadowGeneration = on; },
    setShadowSampling(on) { shadowSampling = on; },
    setDebugView(view) {
      layer.setDebugView(view);
      lastDebugView = view;
    },

    render(camera) {
      frames++;
      try {
        // 0. Lifecycle: late kit/prop descendants, disposed/rebuilt actors.
        router.sync();

        // 1. Shadow maps, BEFORE anything samples them (current-frame light
        //    motion). Generation is gated on the spot being active at all —
        //    the gallery rig hides it, and two 1024² passes for an invisible
        //    light are pure waste.
        const generation = shadowGeneration && flashlight.visible;
        shadows.update(scene, flashlight, {
          enabled: generation,
          fullCasterLayers: [0, SHADOW_HULL_LAYER],
          levelCasterLayers: [0],
        });

        // 2. The shared light list from LIVE candidates.
        camera.updateMatrixWorld();
        lastLights = buildGameDeferredLights(deps.lights(), camera.position, {
          intensityScale: lightGain,
          flashKey: deps.flashKey?.(),
        });
        layer.setLights(lastLights.lights);

        // 3. Environment (ambient + fog) from the live rig.
        layer.setEnvironment(deps.environment());

        // 4. The shadow binding. No generation (or no active flashlight)
        //    means NULL — the M1 unshadowed default, bit-identical output.
        const flashIndex = lastLights.flashlightIndex >= 0 ? lastLights.flashlightIndex : 0;
        layer.setFlashlightShadow(generation && lastLights.flashlightIndex >= 0
          ? shadows.binding(flashIndex, shadowSampling)
          : null);

        // 5. Opaque: mesh G-buffer -> SDF G-buffer -> resolve -> light ->
        //    present (into outputTarget, or the canvas when post-aa is
        //    fully off). The hooks route the ONE scene through the router.
        layer.render(scene, scene, camera, {
          drawMesh: () => drawMesh(camera),
          drawSdf: () => drawSdf(camera),
        });

        // 6. Forward content over the presented frame: autoClear off, real
        //    depth tests against the present's resolved depth.
        const previousTarget = renderer.getRenderTarget();
        const previousAutoClear = renderer.autoClear;
        const previousMask = camera.layers.mask;
        try {
          renderer.setRenderTarget(outputTarget);
          renderer.autoClear = false;
          camera.layers.set(0);
          router.draw('forward', renderer, camera);
        } finally {
          camera.layers.mask = previousMask;
          renderer.autoClear = previousAutoClear;
          renderer.setRenderTarget(previousTarget);
        }
      } catch (e) {
        recordError(e);
      }
    },

    diagnostics() {
      const layerDiag = layer.diagnostics();
      const shadowDiag = shadows.diagnostics();
      return {
        mode: 'deferred',
        frames,
        router: router.diagnostics(),
        lights: {
          ids: [...lastLights.ids],
          dropped: [...lastLights.dropped],
          flashlightIndex: lastLights.flashlightIndex,
          flashKey: (() => {
            const rec = lastLights.flashlightIndex >= 0 ? lastLights.lights[lastLights.flashlightIndex] : undefined;
            return rec?.fleshKeyIntensity !== undefined && rec?.fleshShoulderKnee !== undefined
              ? { fleshKeyIntensity: rec.fleshKeyIntensity, fleshShoulderKnee: rec.fleshShoulderKnee }
              : null;
          })(),
        },
        shadow: {
          generationRequested: shadowGeneration,
          sampling: shadowSampling,
          renderedMaps: shadowDiag.renderedMaps,
          fullCasters: shadowDiag.fullCasters,
          levelCasters: shadowDiag.levelCasters,
          size: shadowDiag.size,
          unsupported: [...shadowDiag.unsupported],
        },
        sizes: {
          width,
          height,
          sdfScale,
          sdfTargetSize: layerDiag.sdfTargetSize,
          outputTarget: outputTarget ? { width: outputTarget.width, height: outputTarget.height } : null,
        },
        lightGain,
        errors: [...errors],
      };
    },

    dispose() {
      router.dispose();
      shadows.dispose();
      layer.dispose();
    },
  };
}
