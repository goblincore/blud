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
  halfToFloat,
  r32fRowStride,
  readR32FTexel,
  readRgba16FTexel,
  rgba16fRowStride,
} from './surface-readback';
import {
  buildGameDeferredLights,
  type GameDeferredFlashKey,
  type GameDeferredLightSet,
  type GameLightCandidate,
} from './game-deferred-lights';
import { createGameDeferredScene, type GameDeferredScene } from './game-deferred-scene';
import { type SurfaceAttachmentName } from './deferred-surface';

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
  /** True while the canvas present writes the resolved scene depth (post-aa
   *  fully off) — the composition review fix's game-owned depth seam. */
  canvasDepthWrites: boolean;
}

/** One raw RESOLVED G-buffer texel (see readSurfaceAt). Vectors are plain
 *  number tuples so the value crosses the CDP boundary untouched.
 *  normal is WORLD-space (deferred-mesh stores normalWorld; the march the
 *  same world frame — lights are world-space). */
export interface GameSurfaceSample {
  /** Layer pixel the NDC point mapped to. */
  pixel: [number, number];
  size: { width: number; height: number };
  albedo: [number, number, number];
  roughness: number;
  normal: [number, number, number];
  metalness: number;
  cls: number;
  depth: number;
}

/** Whole-G-buffer digest for the task-6 regression gate (surface-hash
 *  invariance + class-coverage evidence). Computed IN PAGE: the raw
 *  attachments never cross CDP — only these bounded numbers do. */
export interface GameSurfaceHash {
  width: number;
  height: number;
  /** FNV-1a (32-bit) over each attachment's LOGICAL bytes — row padding
   *  excluded, so the digest is a pure function of the texels. */
  hashes: {
    albedoRoughness: number;
    normalMetalness: number;
    emissionClass: number;
    surfaceDepth: number;
  };
  /** Occupied pixels (packed class != EMPTY). */
  nonEmpty: number;
  /** Occupied-pixel count per packed class (base class + receiver bit),
   *  keyed by integer string; EMPTY omitted. Bounded by construction. */
  classCounts: Record<string, number>;
  /** Depth extent over the whole target (empty pixels are exactly 1). */
  minDepth: number;
  maxDepth: number;
  /** The deepest pixel in layer coordinates — the far-probe anchor. */
  deepestPixel: [number, number];
  /** Pixels at the far sentinel (depth >= 0.9999) with an EMPTY class —
   *  the empty-region census the far probe needs. Depth alone does not make
   *  a pixel empty: an occupied pixel with a degenerate depth is a defect,
   *  not a sentinel. Occupied pixels that still read >= 0.9999 are counted
   *  separately in deepOccupied. */
  sentinelPixels: number;
  /** Pixels at depth >= 0.9999 that carry a NON-empty class. A healthy
   *  render has zero; nonzero is honest evidence of a depth/class defect. */
  deepOccupied: number;
  /** Centroid of the TRUE sentinel pixels (layer coords), when any exist. */
  sentinelCentroid: [number, number] | null;
}

export interface GameDeferredRenderer {
  /** The scene router. game-main registers objects/routes as it spawns them. */
  readonly router: GameDeferredScene;
  /** RAW G-buffer sample at one NDC point of the RESOLVED surface target
   *  (composition review fix evidence seam): roughness is albedoRoughness.w,
   *  metalness is normalMetalness.w, plus albedo RGB, the view-space normal,
   *  the packed surface class and the resolved depth. Bounded: one full-
   *  attachment read per attachment, only when a gate asks. Null on a
   *  legacy boot (game-main guards). */
  readSurfaceAt(ndcX: number, ndcY: number): Promise<GameSurfaceSample>;
  /** BOUNDED MULTI-POINT surface sample (task-6 lattice scans): the same
   *  four full-attachment reads as ONE readSurfaceAt, decoded at up to 512
   *  NDC points — a whole-frame lattice scan costs a single readback set,
   *  not one per pixel. Same contract as readSurfaceAt otherwise. */
  sampleSurfacePoints(points: ReadonlyArray<{ x: number; y: number }>): Promise<GameSurfaceSample[]>;
  /** WHOLE-G-buffer digest (task-6 evidence seam): per-attachment FNV-1a
   *  over the logical texels plus the class histogram and depth extent.
   *  Four full-attachment readbacks per call, only when a gate asks; the
   *  result is plain data so it crosses CDP untouched. */
  hashSurface(): Promise<GameSurfaceHash>;
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
      // Composition review fix: a null target means post-aa is FULLY off and
      // the forward pass will draw straight onto the canvas — so the canvas
      // present must carry the resolved scene depth (the layer's opt-in
      // third present config) for that pass to depth-test against. A real
      // target already receives depth from the target-present pass. This is
      // the game-owned depth composition: opaque + resolved hardware depth +
      // forward in ONE depth-coherent surface, presented once — no post
      // effect forced on, no depth test disabled.
      layer.setCanvasDepthWrites(target === null);
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

    async readSurfaceAt(ndcX, ndcY) {
      const target = layer.targets.resolved;
      const w = target.width, h = target.height;
      const px = Math.min(w - 1, Math.max(0, Math.round(((ndcX + 1) / 2) * w)));
      const py = Math.min(h - 1, Math.max(0, Math.round(((1 - ndcY) / 2) * h)));
      // One full-attachment read per attachment (the fixture-proven pattern —
      // partial-rect readbacks hit the 256-byte row-padding hazard for free).
      // Decoding goes through the SHARED surface-readback decoder: the r32f
      // depth stride is paddedRowBytes(w,4)/4 floats per row (832 at width
      // 800, NOT 800 — three's WebGPU backend returns the padded buffer), and
      // the rgba16float attachments decode as uint16 bit patterns including
      // subnormals. Both bugs previously lived inline here.
      const read = async (name: SurfaceAttachmentName): Promise<Float32Array> => {
        const textureIndex = target.textures.findIndex((t) => t.name === name);
        if (textureIndex < 0) throw new Error(`resolved target is missing attachment '${name}'`);
        const tex = target.textures[textureIndex]!;
        const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, textureIndex);
        const out = new Float32Array(4);
        if (tex.format === THREE.RedFormat) {
          const f32 = raw instanceof Float32Array
            ? raw
            : new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
          out[0] = readR32FTexel(f32, w, px, py);
        } else {
          const u16 = raw instanceof Uint16Array
            ? raw
            : new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
          readRgba16FTexel(u16, w, px, py, out);
        }
        return out;
      };
      const [albedo, nm, ec, dep] = await Promise.all([
        read('albedoRoughness'), read('normalMetalness'), read('emissionClass'), read('surfaceDepth'),
      ]);
      return {
        pixel: [px, py], size: { width: w, height: h },
        albedo: [albedo[0]!, albedo[1]!, albedo[2]!],
        roughness: albedo[3]!,
        normal: [nm[0]!, nm[1]!, nm[2]!],
        metalness: nm[3]!,
        cls: ec[3]!,
        depth: dep[0]!,
      };
    },

    async hashSurface() {
      const target = layer.targets.resolved;
      const w = target.width, h = target.height;
      // One full-attachment read per attachment, decoded row by row with the
      // 256-byte WebGPU row stride (the same hazard readSurfaceAt dodges).
      // Returns ONLY bounded numbers: four FNV-1a digests over the logical
      // bytes, the class histogram, and the depth extent — the raw buffers
      // never leave the page.
      const FNV_OFFSET = 0x811c9dc5;
      const hashRows = (bytes: Uint8Array, rowBytes: number, padded: number): number => {
        let h32 = FNV_OFFSET;
        for (let y = 0; y < h; y++) {
          const row = y * padded;
          for (let i = 0; i < rowBytes; i++) {
            h32 ^= bytes[row + i]!;
            h32 = Math.imul(h32, 0x01000193) >>> 0;
          }
        }
        return h32 >>> 0;
      };
      // Half decoding via the shared exact decoder (subnormals included —
      // classes at the bottom of the representable range decode as numbers,
      // never NaN).
      const readRaw = async (name: SurfaceAttachmentName): Promise<{ bytes: Uint8Array }> => {
        const textureIndex = target.textures.findIndex((t) => t.name === name);
        if (textureIndex < 0) throw new Error(`resolved target is missing attachment '${name}'`);
        const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, textureIndex);
        return { bytes: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) };
      };
      const [albedo, nm, ec, dep] = await Promise.all([
        readRaw('albedoRoughness'), readRaw('normalMetalness'), readRaw('emissionClass'), readRaw('surfaceDepth'),
      ]);
      const albedoRow = w * 4 * 2, nmRow = w * 4 * 2, ecRow = w * 4 * 2, depRow = w * 4;
      const albedoPadded = Math.ceil(albedoRow / 256) * 256;
      const nmPadded = Math.ceil(nmRow / 256) * 256;
      const ecPadded = Math.ceil(ecRow / 256) * 256;
      const depPadded = Math.ceil(depRow / 256) * 256;
      // Class histogram + depth extent, decoded per pixel from emissionClass
      // and surfaceDepth. One pass over the frame, in page.
      const classCounts: Record<string, number> = {};
      let nonEmpty = 0;
      let minDepth = Number.POSITIVE_INFINITY;
      let maxDepth = 0;
      let deepest: [number, number] = [0, 0];
      let sentinelPixels = 0;
      let deepOccupied = 0;
      let sx = 0, sy = 0;
      const ecU16 = new Uint16Array(ec.bytes.buffer, ec.bytes.byteOffset, ec.bytes.byteLength / 2);
      const depF32 = new Float32Array(dep.bytes.buffer, dep.bytes.byteOffset, dep.bytes.byteLength / 4);
      const ecStride = ecPadded / 2, depStride = depPadded / 4;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cls = halfToFloat(ecU16[y * ecStride + x * 4 + 3]!);
          const d = depF32[y * depStride + x]!;
          if (cls > 0.5) {
            nonEmpty++;
            const key = String(Math.round(cls));
            classCounts[key] = (classCounts[key] ?? 0) + 1;
          }
          if (Number.isFinite(d)) {
            if (d < minDepth) minDepth = d;
            if (d > maxDepth) { maxDepth = d; deepest = [x, y]; }
            if (d >= 0.9999) {
              // SENTINEL = far depth AND empty class. An occupied pixel at
              // the far depth is a depth/class defect, counted honestly.
              if (cls > 0.5) deepOccupied++;
              else { sentinelPixels++; sx += x; sy += y; }
            }
          }
        }
      }
      return {
        width: w, height: h,
        hashes: {
          albedoRoughness: hashRows(albedo.bytes, albedoRow, albedoPadded),
          normalMetalness: hashRows(nm.bytes, nmRow, nmPadded),
          emissionClass: hashRows(ec.bytes, ecRow, ecPadded),
          surfaceDepth: hashRows(dep.bytes, depRow, depPadded),
        },
        nonEmpty,
        classCounts,
        minDepth: Number.isFinite(minDepth) ? minDepth : 1,
        maxDepth,
        deepestPixel: deepest,
        sentinelPixels,
        deepOccupied,
        sentinelCentroid: sentinelPixels > 0 ? [Math.round(sx / sentinelPixels), Math.round(sy / sentinelPixels)] : null,
      };
    },

    async sampleSurfacePoints(points) {
      // ONE parallel readback set for the WHOLE lattice — 512 points cost
      // the same as one point. Decoding goes through the shared surface-
      // readback decoder, format-aware per attachment: the albedo/normal/
      // class attachments are rgba16float (uint16 bit patterns, padded
      // rows), depth is r32float (padded rows). The previous version read
      // the HALF albedo as float32 with a dense stride — two defects at
      // once, every value garbage.
      const target = layer.targets.resolved;
      const w = target.width, h = target.height;
      const readRaw = async (name: SurfaceAttachmentName): Promise<{ bytes: Uint8Array }> => {
        const textureIndex = target.textures.findIndex((t) => t.name === name);
        if (textureIndex < 0) throw new Error(`resolved target is missing attachment '${name}'`);
        const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, textureIndex);
        return { bytes: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) };
      };
      const [albedo, nm, ec, dep] = await Promise.all([
        readRaw('albedoRoughness'), readRaw('normalMetalness'), readRaw('emissionClass'), readRaw('surfaceDepth'),
      ]);
      const albedoRow = rgba16fRowStride(w), nmRow = rgba16fRowStride(w), ecRow = rgba16fRowStride(w);
      const depRow = r32fRowStride(w);
      const albedoU16 = new Uint16Array(albedo.bytes.buffer, albedo.bytes.byteOffset, albedo.bytes.byteLength / 2);
      const nmU16 = new Uint16Array(nm.bytes.buffer, nm.bytes.byteOffset, nm.bytes.byteLength / 2);
      const ecU16 = new Uint16Array(ec.bytes.buffer, ec.bytes.byteOffset, ec.bytes.byteLength / 2);
      const depF32 = new Float32Array(dep.bytes.buffer, dep.bytes.byteOffset, dep.bytes.byteLength / 4);
      const out: GameSurfaceSample[] = [];
      for (const p of points.slice(0, 512)) {
        const px = Math.min(w - 1, Math.max(0, Math.round(((p.x + 1) / 2) * w)));
        const py = Math.min(h - 1, Math.max(0, Math.round(((1 - p.y) / 2) * h)));
        const aO = py * albedoRow + px * 4;
        const nmO = py * nmRow + px * 4;
        out.push({
          pixel: [px, py], size: { width: w, height: h },
          albedo: [halfToFloat(albedoU16[aO]!), halfToFloat(albedoU16[aO + 1]!), halfToFloat(albedoU16[aO + 2]!)],
          roughness: halfToFloat(albedoU16[aO + 3]!),
          normal: [halfToFloat(nmU16[nmO]!), halfToFloat(nmU16[nmO + 1]!), halfToFloat(nmU16[nmO + 2]!)],
          metalness: halfToFloat(nmU16[nmO + 3]!),
          cls: halfToFloat(ecU16[py * ecRow + px * 4 + 3]!),
          depth: depF32[py * depRow + px]!,
        });
      }
      return out;
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
        /** The composition mode seam for the gates: true while the canvas
         *  present writes depth (post-aa fully off). */
        canvasDepthWrites: layerDiag.canvasDepthWrites,
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
