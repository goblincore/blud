import { impactSplashPresets } from './impact-splash-profiles';
// src/lab/sdf-zombie/webgpu/blood-compare-main.ts
//
// THE HONEST SYNCHRONIZED COMPARISON PAGE (blood-surface comparison task,
// 2026-09-13).
//
// One canvas, one BloodSim, one blood state per frame. Variants are re-renders
// of the SAME simulation frame under different renderer settings, so a
// difference on screen cannot come from the two sides having simulated
// different droplets:
//
//   original              the shipped floored-nearest goo surface
//   original-connections  shipped surface + derived strands (sheets opt-in)
//   smooth                continuous reconstruction + AA silhouette coverage
//   smooth-connections    both candidates together
//
// TWO ORTHOGONAL AXES (2026-09-13, reference-directed slug splash):
//
//   shape    'current' = the shipped droplet sim, rendered through a
//                       reconstruction variant below (the accepted Smooth path
//                       and the original both live here).
//            'splash'  = the NEW procedural impact crown (impact-splash.ts):
//                       curved fan/sheet lobes, ragged material-space holes,
//                       detached droplets. It is a different SHAPE, not a
//                       filter, and it renders alone so the two can never be
//                       confused. It opens FROZEN at a representative crown
//                       moment, loops when played, and has its own reset.
//   filter   Original / Smooth / connections — applies to shape 'current'
//            only; switching shape does not change the camera, seed or time
//            controls, so the comparison is not confounded by framing.
//
// Single view shows one variant full-frame. WIPE view renders two variants
// into two full-size offscreen targets and wipes B over A with a scissor at a
// chosen fraction — both sides keep full output resolution and equal aspect
// pixel sizes (an earlier scissored side-by-side squashed each 800x600 frame
// into half the canvas). The sim never advances between the two.
//
// It reuses the PRODUCTION functions — createGooLayer, createBloodSim, burst,
// spawnWoundDroplets, spawnImpactGout, stepBlood, connectionBlobsForSim,
// createBloodView — and applies the GAME defaults via goo-presets (which a
// source test keeps in sync with game-main). The blood VIEW is the game's own
// configuration: mist sprites and floor splats visible, beads/ribbons hidden
// while the goo carries the body. Only the scene is a fixture (grey-box floor,
// body proxy, obstacle), because booting the real dungeon here would add a
// second scene to keep in sync for no comparison value.
//
// RESOLUTION IS SPLIT, not conflated: the output canvas is a fixed 800x600,
// but the goo density grid is sized from a SEPARATE source grid (default
// 400x300, the game's march size) at the game's 0.5 density scale, so the
// reconstructed grid matches the game rather than the canvas.
//
// STARTS PAUSED: the animation loop is stopped after one present, and no GPU
// work happens again until Play or Step. WebGPU compile, visual parity and
// performance are NOT verified by this page's existence — it has to be looked
// at by a human on a GPU that is not busy training.

import * as THREE from 'three/webgpu';
import { uniform, texture, vec4, mul, oneMinus, add, uv, vec2 } from 'three/tsl';
import { createLabRenderer, type LabRendererHandle } from './lab-renderer';
import {
  createGooLayer, type GooLayer, type GooDensityBlob, type GooReconstruction,
} from './goo-layer';
import { applyGameGooDefaults } from './goo-presets';
import {
  createBloodSim, burst, spawnWoundDroplets, spawnImpactGout, stepBlood, emitTrails,
  type BloodSim,
} from '../blood-sim';
import { connectionBlobsForSim } from './blood-connections';
import { createBloodView, type BloodView } from './blood-view-gpu';
import {
  createImpactSplashLayer, IMPACT_SPLASH_TUNING,
  type ImpactSplashEvent, type ImpactSplashLayer,
} from './impact-splash';
import {
  SHUTTER_PRESETS, DEFAULT_REFERENCE_FPS, exposureMs, shutterPreset,
  resolveExposureSeconds, clampSampleCount,
  type ShutterPresetId, type ShutterMode,
} from './shutter-timing';
import {
  recordTimeline, type ShutterTimeline,
} from './shutter-timeline';
import {
  SHUTTER_REFERENCES, DEFAULT_SHUTTER_SAMPLES, DEFAULT_MAX_STREAK_PX,
  planShutterSamples, splitSimForShutter, movingSimAt, referenceBudget,
  type ShutterReferenceId,
} from './shutter-reference';
import type { Vec3 } from '../types';

// -------------------------------------------------------------------------
// Variants
// -------------------------------------------------------------------------

export type VariantId = 'original' | 'original-connections' | 'smooth' | 'smooth-connections';

export interface Variant {
  id: VariantId;
  label: string;
  reconstruction: GooReconstruction;
  connections: boolean;
}

export const VARIANTS: Variant[] = [
  { id: 'original', label: 'Original', reconstruction: 'original', connections: false },
  { id: 'original-connections', label: 'Original + connections', reconstruction: 'original', connections: true },
  { id: 'smooth', label: 'Smooth', reconstruction: 'smooth', connections: false },
  { id: 'smooth-connections', label: 'Smooth + connections', reconstruction: 'smooth', connections: true },
];

function variantById(id: VariantId): Variant {
  return VARIANTS.find(v => v.id === id) ?? VARIANTS[0]!;
}

// -------------------------------------------------------------------------
// SHAPE AXIS (Current slug vs Impact splash) — deliberately SEPARATE from the
// reconstruction/filter variants above. The two are orthogonal questions:
//   shape 'current'  = the shipped droplet sim, rendered through one of the
//                      Original/Smooth/etc. reconstruction variants.
//   shape 'splash'   = the procedural crown module, which is a different
//                      SHAPE (crown/fan/sheets), not a different filter.
// Both use the SAME camera, seed and elapsed-time controls, so a reviewer can
// flip shape without the comparison being confounded by a moved camera.
// -------------------------------------------------------------------------

export type ShapeId = 'current' | 'splash';

export const SHAPES: { id: ShapeId; label: string }[] = [
  { id: 'current', label: 'Current slug (sim + reconstruction)' },
  { id: 'splash', label: 'Impact splash (layered sprites)' },
];

/** The splash event's origin: the SAME front-of-proxy wound the current slug
 *  burst uses ([0, 1.35, 0.55]), so the two shapes are the same event seen
 *  two ways. `+Z` is OUTWARD (toward the default camera), which is the wound
 *  normal pointing off the front of the body proxy — not world-up. */
export const SPLASH_ORIGIN: Vec3 = [0, 1.35, 0.55];
export const SPLASH_DIRECTION: Vec3 = [0, 0, 1];
/** The representative crown moment the preview freezes on by default: the
 *  crown has expanded and begun to tear, before dissolve eats the sheets. */
export const SPLASH_CROWN_SEC = 0.30;

// -------------------------------------------------------------------------
// Sizes and the per-variant render order (both exported for CPU tests)
// -------------------------------------------------------------------------

/** The fixed output canvas. The goo surface composites here at full res. */
export const COMPARE_OUTPUT = { width: 800, height: 600 } as const;

export interface SourcePreset { id: string; label: string; width: number; height: number }

/**
 * The MARCH/SOURCE grid the goo density target is derived from. The game
 * marches at 400x300 and the density scale is 0.5, i.e. a 200x150 density
 * field; sizing this from the 800x600 canvas instead doubles the field and
 * makes every silhouette twice as fine as the game's. Exposed as a control so
 * the mismatch is visible rather than hidden.
 */
export const COMPARE_SOURCE_PRESETS: SourcePreset[] = [
  { id: '400x300', label: '400x300 (game march)', width: 400, height: 300 },
  { id: '200x150', label: '200x150 (half march)', width: 200, height: 150 },
  { id: '800x600', label: '800x600 (output size, NOT the game)', width: 800, height: 600 },
];

export interface VariantFrameDeps {
  gooLayer: GooLayer;
  sim: BloodSim;
  camera: THREE.PerspectiveCamera;
  /** Renders the fixture scene into `target` (null = canvas). Invoked from
   *  inside gooLayer.render()'s `between` hook, i.e. after density/blur and
   *  before the surface composite. */
  renderScene: (target: THREE.RenderTarget | null) => void;
}

/**
 * Apply one variant and render it. THE ORDER IS THE FIX for the empty-field
 * blocker: the variant's reconstruction and extra blobs are set FIRST, then
 * the camera's world matrices are refreshed, then the density instancer is
 * synced from the SAME sim + camera (no simulation step), and only then does
 * the goo layer render. Without the sync the instance matrices stay zeroed,
 * the density field is empty, and NO blood is drawn — for every variant.
 *
 * Exported so a mock test can pin the call order and object identity without
 * a GPU; the page calls this for every variant, single and wipe.
 */
export function renderVariantFrame(
  deps: VariantFrameDeps, v: Variant, extras: readonly GooDensityBlob[],
  target: THREE.RenderTarget | null,
): void {
  const { gooLayer, sim, camera, renderScene } = deps;
  gooLayer.setReconstruction(v.reconstruction);
  gooLayer.setExtraBlobs(extras);
  gooLayer.setOutputTarget(target);
  camera.updateMatrixWorld();
  gooLayer.sync(sim, camera);
  gooLayer.render(camera, () => { renderScene(target); });
}

type ScenarioId = 'burst' | 'jet' | 'overlap' | 'landing' | 'bleed' | 'trail' | 'crossing';
const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'burst', label: 'burst (slug impact)' },
  { id: 'jet', label: 'jet (sustained wound)' },
  { id: 'overlap', label: 'overlap (two close gouts)' },
  { id: 'landing', label: 'landing (floor pools)' },
  // Shutter fixtures (task 1): the three motion classes the plan names.
  { id: 'bleed', label: 'bleed (slow wound dribble)' },
  { id: 'trail', label: 'trail (fast gib-like 6 m/s)' },
  { id: 'crossing', label: 'crossing (opposed streams)' },
];

/** Local seeded RNG — the sim's own draw source on this page, so a seed
 *  reproduces the whole scenario. Not a rendering function; kept explicit
 *  rather than importing a heavy module for four lines. */
function makeSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// -------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  const mount = document.getElementById('app');
  const errEl = document.getElementById('errors');
  const diagEl = document.getElementById('diag')!;
  const controlsEl = document.getElementById('controls')!;
  const pausedEl = document.getElementById('paused');
  const statusEl = document.getElementById('status');
  if (!mount || !controlsEl || !diagEl) throw new Error('comparison page DOM is incomplete');

  const fail = (err: unknown): void => {
    const msg = errorMessage(err);
    console.error('[blood-compare] bootstrap failed', err);
    if (errEl) errEl.textContent = `FAILED: ${msg}`;
  };

  let handle: LabRendererHandle;
  try {
    handle = await createLabRenderer(mount, {
      mode: 'fixed', width: COMPARE_OUTPUT.width, height: COMPARE_OUTPUT.height,
    });
  } catch (err) {
    fail(err);
    return;
  }
  if (handle.backend !== 'webgpu') {
    fail(new Error(`backend is '${handle.backend}' — this page is WebGPU-only (a fallback frame is not evidence)`));
    return;
  }

  const { renderer, scene, camera } = handle;
  scene.fog = null;
  const bgDark = new THREE.Color(0x1a1116);
  const bgNeutral = new THREE.Color(0x8a8a8a);
  let background = bgDark;
  renderer.setClearColor(background);

  // --- fixture scene -----------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x37262c, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const bodyProxy = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.9, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x6a5a55, roughness: 0.9, metalness: 0 }),
  );
  bodyProxy.position.set(0, 1.35, 0);
  scene.add(bodyProxy);

  const obstacle = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.2, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 1, metalness: 0 }),
  );
  obstacle.position.set(0.75, 1.0, -0.35);
  scene.add(obstacle);

  // --- goo layer with the GAME defaults ----------------------------------
  // The rig is the page's own light, matching the handle's sun; the goo and
  // the fixture are lit by the same direction and key colour.
  const rig = {
    lightDir: uniform(new THREE.Vector3(4, 10, 6).normalize()),
    keyColor: uniform(new THREE.Color(0xffeccd)),
    lightCfg: uniform(new THREE.Vector2(1.1, 0.45)),
  };
  const gooLayer: GooLayer = createGooLayer(renderer, rig);
  applyGameGooDefaults(gooLayer);
  // Mode 'depth' is the game default (goo-presets) — depth-tested against the
  // fixture so the obstacle fixture actually occludes.

  // --- production blood view, GAME visibility ----------------------------
  // Identical options to game-main's createBloodView: depth-writing cutout
  // droplets, game droplet scale, volume-conserving filament stretch, mist
  // and ribbons enabled. Visibility is the game's too: the goo surface
  // replaces the hard-edged beads/ribbons, MIST STAYS (the sparse-case floor),
  // and floor splats stay (the goo does not draw decals). Blanking mist would
  // flatter the candidate by deleting real blood the game shows.
  const bloodView: BloodView = createBloodView({
    dropletDepthWrite: true,
    dropletViewScale: 0.5,
    stretch: { k: 0.5, max: 3.5, thin: true },
    mist: true,
    ribbons: true,
  });
  for (const o of bloodView.objects) scene.add(o);
  bloodView.setBeadsVisible(false);
  bloodView.setMistVisible(true);

  // --- impact splash layer (shape axis) ----------------------------------
  // Shares the goo rig's light uniform NODES, so the crown and the goo are lit
  // by one key. It lives in the fixture scene and is hidden in 'current' mode,
  // so the shipped slug render is untouched. The event is emitted on demand by
  // the shape control; the layer is CPU-only to build (no GPU work until the
  // page renders one frame).
  const splashLayer: ImpactSplashLayer = createImpactSplashLayer({ rig });
  scene.add(splashLayer.object);

  // --- render targets for the wipe view ----------------------------------
  const targetOpts = { depthBuffer: true, type: THREE.HalfFloatType } as const;
  let contentW = renderer.domElement.width;
  let contentH = renderer.domElement.height;
  const rtA = new THREE.RenderTarget(contentW, contentH, targetOpts);
  const rtB = new THREE.RenderTarget(contentW, contentH, targetOpts);
  // Same first-initialisation discipline the goo layer and sdf-layer use: a
  // lazily-created target texture sampled inside the encoder that first
  // samples it gets the whole submit rejected, so the targets are explicitly
  // rendered once (cleared) after every allocation.
  let rtTargetsNeedInit = true;

  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  blitCam.position.z = 1;
  function makeBlit(tex: THREE.Texture): THREE.Mesh {
    const m = new THREE.MeshBasicNodeMaterial();
    const t = texture(tex);
    m.colorNode = vec4(t.r, t.g, t.b, 1.0) as never;
    m.depthTest = false;
    m.depthWrite = false;
    m.fog = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.frustumCulled = false;
    return mesh;
  }
  const blitA = makeBlit(rtA.texture);
  const blitB = makeBlit(rtB.texture);
  const blitSceneA = new THREE.Scene(); blitSceneA.add(blitA);
  const blitSceneB = new THREE.Scene(); blitSceneB.add(blitB);

  // --- shutter sampled-reference targets (task 1) ------------------------
  // refScene: the sharp half — fixture + static pools/guts (no selected
  //   moving blood). refAccum: half-float accumulation of the selected moving
  //   blood, shaded SEPARATELY at each exposure sample as working-linear
  //   premultiplied colour+coverage (One/One into the target) and divided once
  //   by the sample count in the composite. refAccum carries the frozen scene
  //   DEPTH so the layer depth-tests against the fixture.
  const refAccum = new THREE.RenderTarget(contentW, contentH, targetOpts);
  const refScene = new THREE.RenderTarget(contentW, contentH, targetOpts);
  let refTargetsNeedInit = true;
  // colourWrites off: the frozen fixture writes refAccum's depth only.
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const refScale = uniform(0);
  const compMat = new THREE.MeshBasicNodeMaterial();
  {
    // The goo surface composite (and the scene render it wraps) lands in an
    // offscreen target with the opposite vertical orientation to the canvas
    // blit path (measured: the wipe showed the sampled half vertically
    // mirrored against the sharp half). Sampling with Y inverted puts the
    // reference back in the scene's orientation; the blit then treats refScene
    // and refAccum exactly like rtA/rtB.
    const sampleUv = vec2(uv().x, oneMinus(uv().y));
    const sceneTex = texture(refScene.texture, sampleUv);
    const accumTex = texture(refAccum.texture, sampleUv);
    // out = scene*(1 - avgCoverage) + avgPremultipliedColour, all in the
    // scene's working-linear space. Dividing coverage by the SAME sample count
    // is what keeps the background contribution normalized: an uncovered pixel
    // (a = 0) keeps its full background, a fully covered one loses it once.
    const cov = mul(accumTex.a as never, refScale as never);
    compMat.colorNode = vec4(
      add(mul(sceneTex.rgb as never, oneMinus(cov) as never) as never,
        mul(accumTex.rgb as never, refScale as never) as never) as never,
      1.0,
    ) as never;
    compMat.depthTest = false;
    compMat.depthWrite = false;
    compMat.fog = false;
  }
  const compMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat);
  compMesh.frustumCulled = false;
  const compScene = new THREE.Scene(); compScene.add(compMesh);


  // SOURCE grid (march grid), separate from the fixed output canvas.
  let sourceW = COMPARE_SOURCE_PRESETS[0]!.width;
  let sourceH = COMPARE_SOURCE_PRESETS[0]!.height;

  function applySizes(): void {
    contentW = renderer.domElement.width;
    contentH = renderer.domElement.height;
    rtA.setSize(contentW, contentH);
    rtB.setSize(contentW, contentH);
    rtTargetsNeedInit = true;
    refAccum.setSize(contentW, contentH);
    refScene.setSize(contentW, contentH);
    refTargetsNeedInit = true;
    // Density target = sourceGrid * densityScale (game 0.5), NOT the output
    // size. The surface composite still runs at the output resolution.
    gooLayer.setSize(sourceW, sourceH);
  }
  applySizes();
  window.addEventListener('resize', applySizes);

  /** Explicit one-time clear of the wipe targets after (re)allocation. */
  function initRenderTargets(): void {
    if (!rtTargetsNeedInit) return;
    rtTargetsNeedInit = false;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(rtA); renderer.clear(true, true, true);
    renderer.setRenderTarget(rtB); renderer.clear(true, true, true);
    renderer.setRenderTarget(null);
    renderer.autoClear = prevAutoClear;
  }

  /** Same first-clear discipline for the two shutter reference targets. */
  function initRefTargets(): void {
    if (!refTargetsNeedInit) return;
    refTargetsNeedInit = false;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(refAccum); renderer.clear(true, true, true);
    renderer.setRenderTarget(refScene); renderer.clear(true, true, true);
    renderer.setRenderTarget(null);
    renderer.autoClear = prevAutoClear;
  }

  // --- simulation --------------------------------------------------------
  const sim: BloodSim = createBloodSim();
  let seed = 12345;
  let rng = makeSeededRng(seed);
  // The shape comparison prefers the one-shot slug burst: it is the same
  // event as the procedural crown (one wound, one origin), so both shapes can
  // be frozen at the SAME elapsed event time. A sustained 'jet' has no single
  // event time to match.
  let scenario: ScenarioId = 'burst';
  let frame = 0;
  let emitterAge = 0;
  let emitterAcc = 0;
  let emitterAccB = 0;
  let eventTimer = 0;
  let speed = 1;
  let playing = false;
  // SHARED ELAPSED EVENT TIME (seconds since the impact). BOTH shapes are
  // reconstructed from this one clock, so `current` at t and `splash` at t
  // are the same moment of the same event — never jet-frame-30 vs an
  // unrelated 0.3 s crown.
  let eventTime = SPLASH_CROWN_SEC;
  /** One-shot clock length for both shapes while playing. */
  const LOOP_SEC = IMPACT_SPLASH_TUNING.lifetimeSec;
  // STABLE EMITTER STREAMS: every emission site gets a real id, never a
  // proximity guess. Each burst/gout is its own stream; a sustained wound
  // keeps one stream for its whole life. The connection builder refuses
  // untagged droplets, so a bug here shows up as missing connections rather
  // than a false bridge between two wounds.
  let streamSeq = 1;
  let scenarioStream = 1;
  // Second stream for the opposed crossing fixture: ONE EMITTER IS NOT ONE
  // STREAM for two independent wounds.
  let scenarioStreamB = 2;

  /** The trail fixture's fast source crosses the frame in this long. */
  const TRAIL_CROSS_SEC = 0.6;
  const TRAIL_SPEED = 6;

  function clearSim(): void {
    sim.droplets.length = 0;
    sim.splats.length = 0;
    for (const key of Object.keys(sim.clocks)) delete sim.clocks[Number(key)];
  }

  /**
   * ONE scenario state shape, used by BOTH the live sim and the shutter
   * reference's scratch sim. The live path keeps its page-level variables and
   * marshals them through this object, so the recorded timeline is stepped by
   * the exact same code as the visible simulation and cannot drift from it.
   */
  interface ScenarioState {
    sim: BloodSim;
    rng: () => number;
    frame: number;
    emitterAge: number;
    emitterAcc: number;
    emitterAccB: number;
    eventTimer: number;
    streamA: number;
    streamB: number;
  }

  function liveState(): ScenarioState {
    return {
      sim, rng, frame, emitterAge, emitterAcc, emitterAccB, eventTimer,
      streamA: scenarioStream, streamB: scenarioStreamB,
    };
  }
  function storeState(st: ScenarioState): void {
    rng = st.rng; frame = st.frame; emitterAge = st.emitterAge;
    emitterAcc = st.emitterAcc; emitterAccB = st.emitterAccB; eventTimer = st.eventTimer;
  }
  function freshState(target: BloodSim, seedValue: number): ScenarioState {
    return {
      sim: target, rng: makeSeededRng(seedValue), frame: 0, emitterAge: 0,
      emitterAcc: 0, emitterAccB: 0, eventTimer: 0, streamA: 1, streamB: 2,
    };
  }

  function fireBurstInto(st: ScenarioState, stream: number): void {
    // Use the game wound-impact emitter, outside the proxy and aimed
    // outward. The generic gib burst is too sparse for this comparison.
    spawnImpactGout(st.sim, 'slug', [0, 1.35, 0.55], [0, 0, -1], st.rng, stream);
  }

  function fireGoutInto(st: ScenarioState, x: number, y: number, z: number, stream: number): void {
    // dirN is the incoming shot direction; the gout sprays back along -dirN
    // (toward the camera at +z).
    spawnImpactGout(st.sim, 'slug', [x, y, z], [0, 0, -1], st.rng, stream);
  }

  /** Prime one emission stream at t=0 for the current scenario. */
  function primeScenarioInto(st: ScenarioState): void {
    streamSeq = 1;
    st.streamA = streamSeq++;
    st.streamB = streamSeq++;
    scenarioStream = st.streamA;
    scenarioStreamB = st.streamB;
    if (scenario === 'burst') fireBurstInto(st, st.streamA);
    if (scenario === 'overlap') {
      fireGoutInto(st, -0.28, 1.25, 0.36, st.streamA);
      fireGoutInto(st, 0.28, 1.35, 0.36, st.streamB);
    }
  }
  function primeScenario(): void { primeScenarioInto(liveState()); }

  /**
   * Advance the raw simulation by an ALREADY speed-scaled dt. Pure in
   * (seed, scenario, dt sequence), so replaying from 0 always reproduces the
   * same frame at the same event time — for the live sim AND for the scratch
   * sim the shutter timeline records.
   */
  function advanceScenarioState(st: ScenarioState, sdt: number): void {
    st.frame++;
    switch (scenario) {
      case 'burst':
        st.eventTimer += sdt;
        if (st.eventTimer >= 1.6) { st.eventTimer = 0; fireBurstInto(st, streamSeq++); }
        break;
      case 'jet':
        st.emitterAcc = spawnWoundDroplets(
          st.sim, 'slug', st.emitterAge, [0, 1.35, 0.36], [0, 0.5, 1], sdt, st.emitterAcc, st.rng, st.streamA,
        );
        st.emitterAge += sdt;
        break;
      case 'overlap':
        st.eventTimer += sdt;
        if (st.eventTimer >= 1.2) {
          st.eventTimer = 0;
          fireGoutInto(st, -0.28, 1.25, 0.36, streamSeq++);
          fireGoutInto(st, 0.28, 1.35, 0.36, streamSeq++);
        }
        break;
      case 'landing':
        st.emitterAcc = spawnWoundDroplets(
          st.sim, 'pellet', st.emitterAge, [0, 0.6, 0.36], [0, 0.5, 1], sdt, st.emitterAcc, st.rng, st.streamA,
        );
        st.emitterAge += sdt;
        break;
      case 'bleed':
        // Slow wound dribble: the pellet profile's low speed band arcs a
        // short cohesive stream rather than a spray.
        st.emitterAcc = spawnWoundDroplets(
          st.sim, 'pellet', st.emitterAge, [0, 1.15, 0.32], [0, 0.15, 1], sdt, st.emitterAcc, st.rng, st.streamA,
        );
        st.emitterAge += sdt;
        break;
      case 'trail': {
        // Fast gib-like trail: a point crossing the frame at 6 m/s emits the
        // production 20 Hz trail droplets (emitTrails), so the exposure
        // streaks are the production trail's own motion.
        st.eventTimer += sdt;
        if (st.eventTimer >= TRAIL_CROSS_SEC) st.eventTimer -= TRAIL_CROSS_SEC;
        const px = -1.4 + st.eventTimer * TRAIL_SPEED;
        emitTrails(st.sim, [{
          id: 1, pos: [px, 1.35, 0.32], vel: [TRAIL_SPEED, 0, 0], stream: st.streamA,
        }], sdt, st.rng);
        break;
      }
      case 'crossing':
        // Opposed streams: two stump wounds face each other, so overlapping
        // density carries genuinely opposite motion — the case a single
        // averaged motion vector cancels.
        st.emitterAcc = spawnWoundDroplets(
          st.sim, 'stump', st.emitterAge, [-0.35, 1.35, 0.34], [1, 0, 0], sdt, st.emitterAcc, st.rng, st.streamA,
        );
        st.emitterAccB = spawnWoundDroplets(
          st.sim, 'stump', st.emitterAge, [0.35, 1.35, 0.34], [-1, 0, 0], sdt, st.emitterAccB, st.rng, st.streamB,
        );
        st.emitterAge += sdt;
        break;
    }
    stepBlood(st.sim, sdt, st.rng);
  }

  function advanceRaw(sdt: number): void {
    const st = liveState();
    advanceScenarioState(st, sdt);
    storeState(st);
  }

  /**
   * Deterministically rebuild the Current slug state AT `seconds` since the
   * event began: clear, prime the scenario at t=0, then step at a fixed
   * 1/60 s. Re-simulating (rather than drifting a live clock) is what makes
   * the event time EXACT and reproducible beside the procedural crown.
   */
  function simulateCurrentTo(seconds: number): void {
    clearSim();
    rng = makeSeededRng(seed);
    frame = 0;
    emitterAge = 0;
    emitterAcc = 0;
    emitterAccB = 0;
    eventTimer = 0;
    primeScenario();
    const steps = Math.max(0, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) advanceRaw(1 / 60);
  }

  // --- deterministic shutter timeline (on-demand, bounded) ----------------
  // The reference validates the RECORDED simulation, so it cannot re-step the
  // live sim while it renders alternatives. It records this instead: a
  // timestamped, identity-preserving timeline from a SCRATCH sim stepped with
  // the same scenario code and the same 1/60 s integration the live sim uses.
  // The live sim, its RNG and the stream counters are never mutated.
  //
  // The scratch uses a literal sim (not the createBloodSim factory) so the
  // page keeps a single factory call site — the fixture's one-sim invariant.
  const TIMELINE_DT = 1 / 60;
  const timelineCache = new Map<string, ShutterTimeline>();
  let timelineBuilds = 0;

  function timelineForCurrentEvent(): ShutterTimeline {
    const key = `${scenario}|${seed}|${eventTime.toFixed(5)}`;
    const cached = timelineCache.get(key);
    if (cached) return cached;
    const scratch: BloodSim = { droplets: [], splats: [], clocks: {} };
    const st = freshState(scratch, seed);
    const savedSeq = streamSeq;
    const savedStream = scenarioStream;
    const savedStreamB = scenarioStreamB;
    let timeline: ShutterTimeline;
    try {
      primeScenarioInto(st);
      timeline = recordTimeline({
        dt: TIMELINE_DT,
        duration: Math.max(TIMELINE_DT, eventTime),
        sim: scratch,
        step: (dt) => advanceScenarioState(st, dt),
      });
    } finally {
      streamSeq = savedSeq;
      scenarioStream = savedStream;
      scenarioStreamB = savedStreamB;
    }
    timelineBuilds++;
    // Bounded cache: one event state at a time is all the reference needs.
    timelineCache.clear();
    timelineCache.set(key, timeline);
    return timeline;
  }

  // --- render ------------------------------------------------------------
  let variant: VariantId = 'original';
  let wipe = false;
  let wipeA: VariantId = 'original';
  let wipeB: VariantId = 'smooth';
  let wipePos = 0.5;
  let enableStrands = true;
  // Sheets are EXPERIMENTAL and off by default; the toggle is attribution.
  let enableSheets = false;
  // Per-layer attribution toggles. Beads/ribbons stay hidden exactly as the
  // game hides them while goo is on; goo and mist are independently visible.
  let gooVisible = true;
  let mistVisible = true;

  function extrasFor(connections: boolean): readonly GooDensityBlob[] {
    return connections
      ? connectionBlobsForSim(sim.droplets, { enableStrands, enableSheets })
      : [];
  }

  function applyLayerToggles(): void {
    gooLayer.setPassGate({ density: gooVisible, blur: gooVisible, surface: gooVisible });
    bloodView.setMistVisible(mistVisible);
  }
  applyLayerToggles();

  // --- shape axis + splash preview state ---------------------------------
  // 'current' keeps the shipped sim path exactly as before. 'splash' renders
  // only the procedural crown in the fixture scene (the sim is cleared so no
  // stale beads/splats leak into the comparison). Camera, seed and the SHARED
  // event-time control are common, so the two shapes are never framed or
  // timed differently. The page DEFAULTS to the new Impact splash frozen at
  // its representative crown moment (the review default); Current is one
  // select away.
  let shape: ShapeId = 'splash';
  let splashPreset: keyof typeof impactSplashPresets = 'spurt';
  let splashFrozen = true;
  let splashEvent: ImpactSplashEvent | null = null;

  /** (Re)build the splash event and pose it at the shared event time. */
  function syncSplashTo(seconds: number): void {
    splashLayer.clear();
    splashEvent = splashLayer.emit(SPLASH_ORIGIN, SPLASH_DIRECTION, seed, { profile: impactSplashPresets[splashPreset] });
    // Freeze on the representative crown moment by default; when the reviewer
    // unfreezes, the shared event clock loops the bounded lifetime.
    splashEvent.time = Math.max(0, Math.min(splashEvent.lifetime, seconds));
  }

  function resetSplash(): void {
    syncSplashTo(eventTime);
  }

  /** One shared clock step for both shapes (see the render callback). */
  function advanceEvent(dt: number): void {
    const sdt = Math.min(dt, 1 / 30) * speed;
    eventTime += sdt;
    if (eventTime >= LOOP_SEC) eventTime = eventTime % LOOP_SEC;
    if (shape === 'splash') {
      if (splashEvent) splashEvent.time = Math.min(splashEvent.lifetime, eventTime);
    } else {
      // Re-simulate from 0 to the exact event time: no drift, no stale state.
      simulateCurrentTo(eventTime);
    }
  }

  function setShape(next: ShapeId): void {
    shape = next;
    if (shape === 'splash') {
      // The splash is its own event, not a re-render of the sim: clear the
      // sim so the current slug's droplets, mist and floor splats cannot be
      // mistaken for the crown in the same frame.
      clearSim();
      syncSplashTo(eventTime);
    } else {
      // SHAPE COMPARISON PREFERS THE BURST: it is the one-shot event the
      // crown models, so both shapes can sit at the same elapsed time.
      if (scenario !== 'burst') {
        scenario = 'burst';
        if (scenarioSelect) scenarioSelect.value = 'burst';
      }
      simulateCurrentTo(eventTime);
    }
    if (filterSelect) {
      // `as ShapeId` defeats the literal narrowing of the initializer: shape
      // is reassigned through this closure, which TS's control-flow analysis
      // does not track across the boot-time `setShape('splash')` call.
      const current = (shape as ShapeId) === 'current';
      filterSelect.disabled = !current;
      filterSelect.title = current
        ? 'reconstruction filter for the Current slug'
        : 'inactive: the Impact splash is a procedural shape, not a filter';
    }
  }

  function renderVariant(v: Variant, target: THREE.RenderTarget | null): void {
    renderVariantFrame({
      gooLayer,
      sim,
      camera,
      renderScene: (t) => { renderer.setRenderTarget(t); renderer.render(scene, camera); },
    }, v, extrasFor(v.connections), target);
  }

  // -----------------------------------------------------------------------
  // SHUTTER MODE (selective shutter blur, task 1)
  //
  // A second comparison axis on the SAME page and the SAME sim: 'surface'
  // keeps the existing shape/filter comparison; 'shutter' compares the sharp
  // instantaneous frame with a SAMPLED exposure reference. The efficient
  // candidate is listed but explicitly unavailable until task 2 — it is never
  // aliased to the sharp or sampled path.
  // -----------------------------------------------------------------------
  type CompareMode = 'surface' | 'shutter';
  let compareMode: CompareMode = 'surface';
  let shutterRef: ShutterReferenceId = 'sampled';
  let shutterPresetId: ShutterPresetId = '1-60';
  let shutterSampleCount = DEFAULT_SHUTTER_SAMPLES;
  let shutterMaxStreakPx = DEFAULT_MAX_STREAK_PX;
  let exposureMode: ShutterMode = 'seconds';
  let shutterAngleDeg = 180;
  let shutterReferenceFps = DEFAULT_REFERENCE_FPS;
  let lastRefStats: {
    samples: number; particles: number; streakPx: number; ms: number; builds: number;
    timelineParticles: number;
    livePos: number[] | null; samplePos: number[] | null;
    firstSampleT: number; lastSampleT: number;
  } = {
    samples: 0, particles: 0, streakPx: 0, ms: 0, builds: 0, timelineParticles: 0,
    livePos: null, samplePos: null, firstSampleT: 0, lastSampleT: 0,
  };

  function currentExposureSeconds(): number {
    return resolveExposureSeconds({
      mode: exposureMode,
      seconds: shutterPreset(shutterPresetId).seconds,
      angleDeg: shutterAngleDeg,
      referenceFps: shutterReferenceFps,
    });
  }

  /** The sharp side of the shutter comparison: the accepted smooth surface. */
  function renderSharpReference(target: THREE.RenderTarget | null): void {
    renderVariant(variantById('smooth'), target);
  }

  /**
   * The slow quality oracle. For each sample time it reconstructs the
   * SELECTED moving blood from the recorded timeline, shades it through the
   * production smooth goo surface, depth-tests it against the frozen fixture
   * and SUMS working-linear premultiplied colour+coverage; one composite then
   * divides by the sample count. Density is never combined across samples.
   *
   * On-demand and bounded: the timeline is one 1/60 s record per event state,
   * cached until the event time or seed changes.
   */
  function renderSampledReference(target: THREE.RenderTarget | null): void {
    const exposure = currentExposureSeconds();
    const plan = planShutterSamples(eventTime, exposure, shutterSampleCount);
    initRefTargets();
    const { staticSim } = splitSimForShutter(sim);

    // 1. SHARP half: fixture + static pools/guts, no selected moving blood.
    //    bloodView was already synced to the LIVE sim in draw(), so mist and
    //    ribbons stay sharp and unblurred (the plan's "unselected effects").
    gooLayer.setReconstruction('smooth');
    gooLayer.setExtraBlobs([]);
    gooLayer.setOutputTarget(refScene);
    camera.updateMatrixWorld();
    gooLayer.sync(staticSim, camera);
    gooLayer.render(camera, () => { renderer.setRenderTarget(refScene); renderer.render(scene, camera); });

    // 2. ACCUMULATE the selected moving blood, one shaded sample at a time.
    const timeline = timelineForCurrentEvent();
    const movingScratch: BloodSim = { droplets: [], splats: [], clocks: {} };
    const clearColor = new THREE.Color();
    const prevClear = renderer.getClearColor(clearColor).getHex();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(refAccum);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    // Frozen fixture depth into refAccum with colour writes off. The layer
    // depth-tests against this and never writes depth.
    scene.overrideMaterial = depthOnly;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    for (const t of plan.sampleTimes) {
      movingSimAt(timeline, t, movingScratch);
      gooLayer.sync(movingScratch, camera);
      gooLayer.renderLayer(camera, refAccum);
    }
    renderer.setClearColor(prevClear, prevClearAlpha);
    renderer.autoClear = true;

    // 3. COMPOSITE scene*(1-a/N) + rgb/N in working-linear space.
    refScale.value = plan.sampleCount > 0 ? 1 / plan.sampleCount : 0;
    const outW = target ? target.width : renderer.domElement.width;
    const outH = target ? target.height : renderer.domElement.height;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, outW, outH);
    renderer.render(compScene, blitCam);
    renderer.autoClear = prevAutoClear;

    const budget = referenceBudget(plan, movingScratch.droplets.length, 600);
    const liveFirst = sim.droplets[0];
    const sampleFirst = movingScratch.droplets[0];
    lastRefStats = {
      samples: plan.sampleCount,
      particles: movingScratch.droplets.length,
      streakPx: budget.streakPx,
      ms: exposureMs(exposure),
      builds: timelineBuilds,
      timelineParticles: timeline.particleCount,
      livePos: liveFirst ? [...liveFirst.pos] : null,
      samplePos: sampleFirst ? [...sampleFirst.pos] : null,
      firstSampleT: plan.sampleTimes[0] ?? 0,
      lastSampleT: plan.sampleTimes[plan.sampleTimes.length - 1] ?? 0,
    };
  }

  /** B wipes over A from the left at `wipePos`. Both are FULL-SIZE frames. */
  function blitWipe(): void {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const cut = Math.max(1, Math.min(w - 1, Math.round(w * wipePos)));
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.setClearColor(background);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, w, h);
    renderer.render(blitSceneA, blitCam);
    renderer.setScissor(0, 0, cut, h);
    renderer.render(blitSceneB, blitCam);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
  }

  function draw(): void {
    // The blood view is variant-independent: pose it once per presented frame
    // from the SAME sim, after the camera's world matrices are current. In
    // splash mode the sim is empty, so this zeroes every instance and the
    // crown is the only blood on screen.
    camera.updateMatrixWorld();
    bloodView.sync(sim, camera);
    if (compareMode === 'shutter') {
      splashLayer.setVisible(false);
      renderer.setClearColor(background);
      // ZERO EXPOSURE IS THE SHARP FRAME, EXACTLY. The sampled oracle splits
      // moving blood from static pools to average per-sample coverage; at zero
      // samples that split would draw NO moving blood at all, so the off case
      // is routed to the fused sharp render instead of through the split.
      const sampled = shutterRef === 'sampled' && currentExposureSeconds() > 0;
      if (!wipe) {
        if (sampled) renderSampledReference(null);
        else renderSharpReference(null);
      } else {
        // Sharp vs Sampled, both full-size: A (right) sharp, B (left) sampled.
        initRenderTargets();
        renderSharpReference(rtA);
        if (sampled) renderSampledReference(rtB);
        else renderSharpReference(rtB);
        blitWipe();
      }
      updateDiag();
      return;
    }
    splashLayer.setVisible(shape === 'splash');
    if (shape === 'splash') {
      splashLayer.sync(camera);
      renderer.setClearColor(background);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      updateDiag();
      return;
    }
    renderer.setClearColor(background);
    if (!wipe) {
      renderVariant(variantById(variant), null);
    } else {
      initRenderTargets();
      renderVariant(variantById(wipeA), rtA);
      renderVariant(variantById(wipeB), rtB);
      blitWipe();
    }
    updateDiag();
  }

  // --- camera orbit ------------------------------------------------------
  // Close framing on the shared wound origin (SPLASH_ORIGIN is also the
  // current slug burst's origin), so both shapes fill the frame the same way.
  const orbit = { yaw: 0, pitch: 0.14, distance: 1.35, tx: 0, ty: 1.30, tz: 0.42 };
  function applyCamera(): void {
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      orbit.tx + Math.sin(orbit.yaw) * cp * orbit.distance,
      orbit.ty + Math.sin(orbit.pitch) * orbit.distance,
      orbit.tz + Math.cos(orbit.yaw) * cp * orbit.distance,
    );
    camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
    camera.updateMatrixWorld();
  }
  function attachOrbit(canvas: HTMLCanvasElement): void {
    let dragging = false; let lastX = 0; let lastY = 0;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', e => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      if (!playing) handle.drawOnce();
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX; const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = Math.max(-0.4, Math.min(1.2, orbit.pitch + dy * 0.006));
      applyCamera();
      if (!playing) handle.drawOnce();
    });
    canvas.addEventListener('wheel', (e) => {
      orbit.distance = Math.max(1.2, Math.min(9, orbit.distance + Math.sign(e.deltaY) * 0.25));
      applyCamera();
      if (!playing) handle.drawOnce();
    }, { passive: true });
  }

  // --- diagnostics + capture API ----------------------------------------
  function splashState(): Record<string, unknown> {
    const ev = splashEvent;
    const progress = ev && ev.lifetime > 0 ? Math.min(1, ev.time / ev.lifetime) : 0;
    return {
      shape,
      frozen: splashFrozen,
      eventTime,
      origin: SPLASH_ORIGIN,
      direction: SPLASH_DIRECTION,
      time: ev ? ev.time : 0,
      lifetime: ev ? ev.lifetime : IMPACT_SPLASH_TUNING.lifetimeSec,
      progress,
      crownMoment: SPLASH_CROWN_SEC,
      events: splashLayer.eventCount,
      vertices: splashLayer.vertexCount,
      droplets: splashLayer.dropletCount,
    };
  }

  /**
   * The shutter axis's full state, including the EXPLICIT statement that the
   * efficient candidate is unavailable until task 2. A reviewer can read this
   * beside a capture and know exactly which reference produced it.
   */
  function shutterState(): Record<string, unknown> {
    const exposure = currentExposureSeconds();
    const plan = planShutterSamples(eventTime, exposure, shutterSampleCount);
    return {
      mode: compareMode,
      reference: shutterRef,
      references: SHUTTER_REFERENCES.map(r => ({ id: r.id, implemented: r.implemented })),
      candidateAvailable: false,
      preset: shutterPresetId,
      exposureSeconds: exposure,
      exposureMs: exposureMs(exposure),
      exposureMode,
      angleDeg: shutterAngleDeg,
      referenceFps: shutterReferenceFps,
      samples: plan.sampleCount,
      sampleTimes: plan.sampleTimes,
      interval: { from: plan.from, to: plan.to },
      maxStreakPx: shutterMaxStreakPx,
      last: lastRefStats,
    };
  }

  function candidateState(): Record<string, unknown> {
    return {
      seed, frame, scenario, playing, speed, splashPreset,
      shape, eventTime, splash: splashState(),
      compare: compareMode,
      shutter: shutterState(),
      variant, wipe, wipeA, wipeB, wipePos,
      filter: variant,
      filterApplies: shape === 'current',
      strands: enableStrands, sheets: enableSheets,
      goo: gooVisible, mist: mistVisible,
      reconstruction: gooLayer.reconstruction,
      connections: variantById(variant).connections,
      extraBlobs: gooLayer.extraBlobCount,
      droplets: sim.droplets.length,
      splats: sim.splats.length,
      density: gooLayer.densityDiagnostics,
      source: { width: sourceW, height: sourceH },
      output: { width: renderer.domElement.width, height: renderer.domElement.height },
      camera: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance },
      backend: handle.backend,
    };
  }

  function updateDiag(): void {
    const d = gooLayer.densityDiagnostics;
    const v = variantById(variant);
    const filterState = shape === 'current'
      ? `filter ${v.id} (recon=${v.reconstruction} conns=${v.connections ? 'on' : 'off'}) ACTIVE`
      : `filter ${v.id} INACTIVE (applies to Current only)`;
    if (compareMode === 'shutter') {
      const exposure = currentExposureSeconds();
      const plan = planShutterSamples(eventTime, exposure, shutterSampleCount);
      const shutterLines = [
        `SHUTTER mode ${compareMode}  reference ${shutterRef}  scenario ${scenario}  seed ${seed}`,
        `event t ${eventTime.toFixed(3)}s  exposure ${exposureMs(exposure).toFixed(2)} ms  preset ${shutterPresetId} (${exposureMode}${exposureMode === 'angle' ? `: ${shutterAngleDeg}deg / ${shutterReferenceFps} fps explicit` : ''})`,
        `trailing box [${plan.from.toFixed(3)}, ${plan.to.toFixed(3)}] s  samples ${plan.sampleCount}  weight 1/${plan.sampleCount || 1}`,
        shutterRef === 'efficient'
          ? 'EFFICIENT CANDIDATE: unavailable until task 2 — NOT aliased to sharp or sampled'
          : shutterRef === 'sampled'
            ? `sampled oracle: ${lastRefStats.particles} particles/sample x ${lastRefStats.samples} samples = ${lastRefStats.particles * lastRefStats.samples} shaded particle draws`
            : 'sharp: instantaneous frame — exposure is IGNORED on this side',
        `streak @600 px/s = ${(plan.exposureSeconds * 600).toFixed(2)} px (cap ${shutterMaxStreakPx} px)  timeline particles ${lastRefStats.timelineParticles} (builds ${lastRefStats.builds})`,
        `sim droplets ${sim.droplets.length}  splats ${sim.splats.length}  goo ${gooVisible ? 'on' : 'off'}  mist ${mistVisible ? 'on' : 'off'}`,
        `source ${sourceW}x${sourceH}  output ${contentW}x${contentH}  backend ${handle.backend}`,
      ];
      diagEl.textContent = shutterLines.join('\n');
      if (pausedEl) pausedEl.style.display = playing ? 'none' : '';
      if (statusEl) {
        statusEl.textContent = `SHUTTER ${shutterRef}  exposure ${exposureMs(exposure).toFixed(2)} ms  samples ${plan.sampleCount}  event t ${eventTime.toFixed(2)}s  ${playing ? 'playing' : 'paused'}`;
      }
      return;
    }
    const lines = shape === 'splash'
      ? [
        `seed ${seed}  shape ${shape}  scenario ${scenario} (unused by splash)`,
        splashLegend(),
        `EVENT TIME t ${eventTime.toFixed(2)}s shared by both shapes; Current is re-simulated to this exact t`,
        `splash origin [${SPLASH_ORIGIN.join(', ')}]  dir [${SPLASH_DIRECTION.join(', ')}] (outward, not world-up)`,
        `splash frozen ${splashFrozen ? 'YES at crown' : 'no (looping)'}  reset to ${SPLASH_CROWN_SEC.toFixed(2)}s`,
        `crown verts ${splashLayer.vertexCount}  droplets ${splashLayer.dropletCount}  events ${splashLayer.eventCount}`,
        filterState,
        `output ${contentW}x${contentH}  camera yaw ${orbit.yaw.toFixed(2)} pitch ${orbit.pitch.toFixed(2)} dist ${orbit.distance.toFixed(2)}`,
        `backend ${handle.backend}`,
      ]
      : [
        `seed ${seed}  frame ${frame}  scenario ${scenario}  event t ${eventTime.toFixed(2)}s`,
        `shape ${shape} (current slug)  playing ${playing}  speed ${speed.toFixed(2)}`,
        wipe
          ? `wipe at ${wipePos.toFixed(2)}: left=B(${wipeB}) right=A(${wipeA})`
          : filterState,
        `strands ${enableStrands ? 'on' : 'off'}  sheets ${enableSheets ? 'on' : 'off'} (experimental)  extras ${gooLayer.extraBlobCount}`,
        `goo ${gooVisible ? 'on' : 'off'}  mist ${mistVisible ? 'on' : 'off'} (beads/ribbons hidden as in game)`,
        `source ${sourceW}x${sourceH}  output ${contentW}x${contentH}`,
        `density ${d.densityWidth}x${d.densityHeight}  densityScale ${d.densityScale.toFixed(2)} of source`,
        `density texels/source px ${d.texelsPerSourcePixelX.toFixed(2)},${d.texelsPerSourcePixelY.toFixed(2)}  /output px ${d.texelsPerOutputPixelX.toFixed(2)},${d.texelsPerOutputPixelY.toFixed(2)}`,
        `sim droplets ${sim.droplets.length}  splats ${sim.splats.length}  backend ${handle.backend}`,
      ];
    diagEl.textContent = lines.join('\n');
    if (pausedEl) pausedEl.style.display = playing ? 'none' : '';
    if (statusEl) {
      const ev = splashEvent;
      statusEl.textContent = shape === 'splash'
        ? `IMPACT SPLASH  t ${(ev ? ev.time : 0).toFixed(2)}/${(ev ? ev.lifetime : IMPACT_SPLASH_TUNING.lifetimeSec).toFixed(2)}s  ${splashFrozen ? 'FROZEN (crown)' : 'looping'}  filter ${variant} (inactive)`
        : `CURRENT SLUG  event t ${eventTime.toFixed(2)}s  scenario ${scenario}  filter ${variant}  ${playing ? 'playing' : 'paused'}`;
    }
  }

  /** One concise status legend shared by the diag panel and the on-canvas
   *  indicator: phase name + the elapsed/lifetime window it belongs to. */
  function splashLegend(): string {
    const ev = splashEvent;
    const t = ev ? ev.time : 0;
    const phase = t < IMPACT_SPLASH_TUNING.expandSec ? 'EXPAND (crown rising)'
      : t < IMPACT_SPLASH_TUNING.tearEndSec ? 'TEAR/DROP (fingers + droplets)'
        : 'DISSOLVE (sheets break up)';
    return `t ${t.toFixed(2)}/${(ev ? ev.lifetime : IMPACT_SPLASH_TUNING.lifetimeSec).toFixed(2)}s  phase ${phase}`;
  }


  // --- controls ----------------------------------------------------------
  function row(label: string, el: HTMLElement): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = label;
    div.appendChild(lab); div.appendChild(el);
    controlsEl.appendChild(div);
    return div;
  }
  function select<T extends string>(values: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLSelectElement {
    const s = document.createElement('select');
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v.id; o.textContent = v.label;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value as T));
    return s;
  }
  function checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
    const l = document.createElement('label');
    l.style.flex = '0 0 auto'; l.style.color = '#e8e8e8';
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = value;
    c.addEventListener('change', () => onChange(c.checked));
    l.appendChild(c); l.appendChild(document.createTextNode(' ' + label));
    return l;
  }

  let wipeASelect: HTMLSelectElement | null = null;
  let wipeBSelect: HTMLSelectElement | null = null;
  let filterSelect: HTMLSelectElement | null = null;
  let scenarioSelect: HTMLSelectElement | null = null;

  // --- comparison MODE: surface/shape (existing) vs shutter (task 1) ------
  let shutterRefSelect: HTMLSelectElement | null = null;
  let shutterMsLabel: HTMLDivElement | null = null;
  let angleRow: HTMLDivElement | null = null;
  let fpsRow: HTMLDivElement | null = null;

  function refreshShutterLabels(): void {
    if (shutterMsLabel) {
      const exposure = currentExposureSeconds();
      const plan = planShutterSamples(eventTime, exposure, shutterSampleCount);
      shutterMsLabel.textContent = `effective exposure ${exposureMs(exposure).toFixed(2)} ms  ·  ${plan.sampleCount} sample${plan.sampleCount === 1 ? '' : 's'}${exposureMode === 'angle' ? `  ·  ${shutterAngleDeg}deg @ ${shutterReferenceFps} fps (explicit)` : ''}`;
    }
    if (angleRow) angleRow.style.display = exposureMode === 'angle' ? '' : 'none';
    if (fpsRow) fpsRow.style.display = exposureMode === 'angle' ? '' : 'none';
  }

  row('mode', select(
    [{ id: 'surface', label: 'Surface / shape (existing)' }, { id: 'shutter', label: 'Shutter (exposure)' }],
    compareMode,
    (m) => {
      compareMode = m as CompareMode;
      // The shutter reference resolves the CURRENT sim; the splash is a
      // separate shape, so entering shutter mode selects Current.
      if (compareMode === 'shutter' && shape === 'splash') setShape('current');
      refreshShutterLabels();
      updateDiag();
      if (!playing) handle.drawOnce();
    },
  ));

  // SHUTTER AXIS — independent of surface/shape/filter. The efficient
  // candidate is present but DISABLED: an explicit "not yet", never an alias.
  const refSelect = select(
    SHUTTER_REFERENCES.map(r => ({ id: r.id, label: r.label })),
    shutterRef,
    (v) => {
      if (v === 'efficient') {
        if (shutterRefSelect) shutterRefSelect.value = shutterRef;
        return;
      }
      shutterRef = v as ShutterReferenceId;
      updateDiag();
      if (!playing) handle.drawOnce();
    },
  );
  for (const o of Array.from(refSelect.options)) if (o.value === 'efficient') o.disabled = true;
  refSelect.title = 'the efficient candidate is unavailable until task 2';
  shutterRefSelect = refSelect;
  row('reference', refSelect);

  row('exposure', select(
    SHUTTER_PRESETS.map(p => ({
      id: p.id,
      label: p.seconds > 0 ? `${p.label} = ${exposureMs(p.seconds).toFixed(2)} ms` : p.label,
    })),
    shutterPresetId,
    (v) => {
      shutterPresetId = v as ShutterPresetId;
      refreshShutterLabels(); updateDiag();
      if (!playing) handle.drawOnce();
    },
  ));

  row('exposure mode', select(
    [{ id: 'seconds', label: 'seconds (preset)' }, { id: 'angle', label: 'angle / explicit ref fps' }],
    exposureMode,
    (m) => {
      exposureMode = m as ShutterMode;
      refreshShutterLabels(); updateDiag();
      if (!playing) handle.drawOnce();
    },
  ));

  const angleInput = document.createElement('input');
  angleInput.type = 'range'; angleInput.min = '0'; angleInput.max = '360'; angleInput.step = '1';
  angleInput.value = String(shutterAngleDeg);
  angleInput.addEventListener('input', () => {
    shutterAngleDeg = Number(angleInput.value);
    refreshShutterLabels(); updateDiag();
    if (!playing) handle.drawOnce();
  });
  angleRow = row('shutter angle', angleInput);

  const refFpsInput = document.createElement('input');
  refFpsInput.type = 'number'; refFpsInput.value = String(shutterReferenceFps); refFpsInput.style.width = '70px';
  refFpsInput.addEventListener('change', () => {
    const n = Number(refFpsInput.value);
    if (Number.isFinite(n) && n > 0) shutterReferenceFps = n;
    refreshShutterLabels(); updateDiag();
    if (!playing) handle.drawOnce();
  });
  fpsRow = row('reference fps', refFpsInput);

  const samplesInput = document.createElement('input');
  samplesInput.type = 'range'; samplesInput.min = '1'; samplesInput.max = '64'; samplesInput.step = '1';
  samplesInput.value = String(shutterSampleCount);
  samplesInput.addEventListener('input', () => {
    shutterSampleCount = clampSampleCount(Number(samplesInput.value));
    samplesInput.value = String(shutterSampleCount);
    refreshShutterLabels(); updateDiag();
    if (!playing) handle.drawOnce();
  });
  row('samples (oracle)', samplesInput);

  const maxStreakInput = document.createElement('input');
  maxStreakInput.type = 'range'; maxStreakInput.min = '4'; maxStreakInput.max = '200'; maxStreakInput.step = '4';
  maxStreakInput.value = String(shutterMaxStreakPx);
  maxStreakInput.addEventListener('input', () => {
    shutterMaxStreakPx = Number(maxStreakInput.value); updateDiag();
    if (!playing) handle.drawOnce();
  });
  row('max streak px', maxStreakInput);

  shutterMsLabel = document.createElement('div');
  shutterMsLabel.id = 'hint';
  controlsEl.appendChild(shutterMsLabel);
  refreshShutterLabels();

  // SHAPE first: Current slug vs the procedural Impact splash. This is a shape
  // choice, not a filter choice, and it is independent of the reconstruction
  // variants below it.
  row('shape', select(SHAPES, shape, (s) => {
    setShape(s); if (!playing) handle.drawOnce();
  }));
  // The reconstruction/filter variants apply to the Current slug render only.
  // The label and the disabled state make that explicit rather than leaving a
  // control that silently does nothing in splash mode.
  filterSelect = select(VARIANTS.map(v => ({ id: v.id, label: v.label })), variant, (v) => {
    variant = v; if (!playing) handle.drawOnce();
  });
  filterSelect.disabled = (shape as ShapeId) !== 'current';
  row('filter (Current only)', filterSelect);

  // Shared EVENT-TIME controls: a freeze toggle, an elapsed-time scrubber that
  // drives BOTH shapes, and a reset to the representative crown moment.
  const splashFreezeToggle = checkbox('freeze at crown', splashFrozen, (on) => {
    splashFrozen = on;
    if (shape === 'splash') { resetSplash(); if (!playing) handle.drawOnce(); }
  });
  row('splash freeze', splashFreezeToggle);
  const eventTimeInput = document.createElement('input');
  eventTimeInput.type = 'range'; eventTimeInput.min = '0'; eventTimeInput.max = String(IMPACT_SPLASH_TUNING.lifetimeSec); eventTimeInput.step = '0.01';
  eventTimeInput.value = String(eventTime);
  eventTimeInput.addEventListener('input', () => {
    eventTime = Number(eventTimeInput.value);
    if (shape === 'splash') {
      splashFrozen = true; splashFreezeToggle.querySelector('input')!.checked = true;
      if (splashEvent) splashEvent.time = eventTime;
    } else {
      simulateCurrentTo(eventTime);
    }
    if (!playing) handle.drawOnce();
  });
  row('event t (both shapes)', eventTimeInput);
  const splashResetBtn = document.createElement('button');
  splashResetBtn.textContent = 'Reset to crown t';
  splashResetBtn.addEventListener('click', () => {
    eventTime = SPLASH_CROWN_SEC;
    eventTimeInput.value = String(eventTime);
    if (shape === 'splash') {
      splashFrozen = true; splashFreezeToggle.querySelector('input')!.checked = true;
      resetSplash();
    } else {
      simulateCurrentTo(eventTime);
    }
    if (!playing) handle.drawOnce();
  });
  row('', splashResetBtn);

  const wipeToggle = checkbox('wipe A/B', wipe, (on) => {
    wipe = on;
    if (wipeASelect) wipeASelect.style.display = on ? '' : 'none';
    if (wipeBSelect) wipeBSelect.style.display = on ? '' : 'none';
    if (!playing) handle.drawOnce();
  });
  row('view', wipeToggle);
  wipeASelect = select(VARIANTS.map(v => ({ id: v.id, label: v.label })), wipeA, (v) => {
    wipeA = v; if (!playing) handle.drawOnce();
  });
  wipeASelect.style.display = wipe ? '' : 'none';
  row('wipe A (right)', wipeASelect);
  wipeBSelect = select(VARIANTS.map(v => ({ id: v.id, label: v.label })), wipeB, (v) => {
    wipeB = v; if (!playing) handle.drawOnce();
  });
  wipeBSelect.style.display = wipe ? '' : 'none';
  row('wipe B (left)', wipeBSelect);

  const wipePosInput = document.createElement('input');
  wipePosInput.type = 'range'; wipePosInput.min = '0.05'; wipePosInput.max = '0.95'; wipePosInput.step = '0.01';
  wipePosInput.value = String(wipePos);
  wipePosInput.addEventListener('input', () => { wipePos = Number(wipePosInput.value); if (!playing) handle.drawOnce(); });
  row('wipe pos', wipePosInput);

  scenarioSelect = select(SCENARIOS, scenario, (s) => {
    scenario = s;
    // Keep the event-time contract: the Current side is rebuilt at the shared
    // time, and in splash mode the sim stays empty.
    if (shape === 'current') simulateCurrentTo(eventTime); else clearSim();
    if (!playing) handle.drawOnce();
  });
  row('scenario', scenarioSelect);

  const seedInput = document.createElement('input');
  seedInput.type = 'number'; seedInput.value = String(seed); seedInput.style.width = '90px';
  seedInput.addEventListener('change', () => {
    const n = Number(seedInput.value);
    if (Number.isFinite(n)) {
      seed = Math.floor(n);
      if (shape === 'splash') resetSplash(); else simulateCurrentTo(eventTime);
      if (!playing) handle.drawOnce();
    }
  });
  row('seed', seedInput);
  row('impact preset', select([{id:'spurt',label:'Wound spurt'},{id:'explosion',label:'Blood explosion (saved)'}], splashPreset, (v) => {
    splashPreset=v;
    resetSplash();
    if (!playing) handle.drawOnce();
  }));
  const variationBtn=document.createElement('button');
  variationBtn.textContent='New variation';
  variationBtn.addEventListener('click', () => {
    seed=crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff;
    seedInput.value=String(seed);
    if (shape === 'splash') resetSplash(); else simulateCurrentTo(eventTime);
    if (!playing) handle.drawOnce();
  });
  row('',variationBtn);

  const replayBtn = document.createElement('button');
  replayBtn.textContent = 'Replay';
  replayBtn.addEventListener('click', () => {
    if (shape === 'splash') resetSplash(); else simulateCurrentTo(eventTime);
    if (!playing) handle.drawOnce();
  });
  row('', replayBtn);

  const playBtn = document.createElement('button');
  const pauseBtn = document.createElement('button');
  const stepBtn = document.createElement('button');
  playBtn.textContent = 'Play'; pauseBtn.textContent = 'Pause'; stepBtn.textContent = 'Step';
  playBtn.addEventListener('click', () => {
    playing = true; handle.setLoopRunning(true);
    if (shape === 'splash') { splashFrozen = false; splashFreezeToggle.querySelector('input')!.checked = false; }
    updateDiag();
  });
  pauseBtn.addEventListener('click', () => {
    playing = false; handle.setLoopRunning(false); handle.drawOnce(); updateDiag();
  });
  stepBtn.addEventListener('click', () => {
    playing = false; handle.setLoopRunning(false); handle.step(1 / 60); updateDiag();
  });
  const transport = document.createElement('div');
  transport.style.display = 'flex'; transport.style.gap = '4px';
  transport.appendChild(playBtn); transport.appendChild(pauseBtn); transport.appendChild(stepBtn);
  row('', transport);

  const speedInput = document.createElement('input');
  speedInput.type = 'range'; speedInput.min = '0.1'; speedInput.max = '2'; speedInput.step = '0.05';
  speedInput.value = String(speed);
  speedInput.addEventListener('input', () => { speed = Number(speedInput.value); if (!playing) handle.drawOnce(); });
  row('speed', speedInput);

  const strandsToggle = checkbox('strands', enableStrands, (v) => { enableStrands = v; if (!playing) handle.drawOnce(); });
  row('connections', strandsToggle);
  const sheetsToggle = checkbox('sheets (exp.)', enableSheets, (v) => { enableSheets = v; if (!playing) handle.drawOnce(); });
  row('', sheetsToggle);

  const gooToggle = checkbox('goo', gooVisible, (v) => { gooVisible = v; applyLayerToggles(); if (!playing) handle.drawOnce(); });
  row('layers', gooToggle);
  const mistToggle = checkbox('mist', mistVisible, (v) => { mistVisible = v; applyLayerToggles(); if (!playing) handle.drawOnce(); });
  row('', mistToggle);

  const obstacleToggle = checkbox('obstacle', obstacle.visible, (v) => {
    obstacle.visible = v; if (!playing) handle.drawOnce();
  });
  row('occlusion', obstacleToggle);

  const bgToggle = checkbox('neutral bg', false, (v) => {
    background = v ? bgNeutral : bgDark;
    scene.background = background;
    if (!playing) handle.drawOnce();
  });
  row('background', bgToggle);

  const sourceSelect = select(
    COMPARE_SOURCE_PRESETS.map(p => ({ id: p.id, label: p.label })),
    COMPARE_SOURCE_PRESETS[0]!.id,
    (id) => {
      const p = COMPARE_SOURCE_PRESETS.find(q => q.id === id) ?? COMPARE_SOURCE_PRESETS[0]!;
      sourceW = p.width; sourceH = p.height;
      gooLayer.setSize(sourceW, sourceH);
      if (!playing) handle.drawOnce();
    },
  );
  row('source grid', sourceSelect);

  const densityInput = document.createElement('input');
  densityInput.type = 'range'; densityInput.min = '0.25'; densityInput.max = '1'; densityInput.step = '0.05';
  densityInput.value = String(gooLayer.densityScale);
  densityInput.addEventListener('input', () => {
    gooLayer.setDensityScale(Number(densityInput.value));
    if (!playing) handle.drawOnce();
  });
  row('density scale', densityInput);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = [
    'drag orbit · wheel zoom',
    'mode: Surface/shape (existing) vs Shutter (exposure) — independent axes',
    'shape: Current slug (sim + filter) vs Impact splash (layered sprites)',
    'splash opens FROZEN at the crown moment; Play loops it, Reset splash re-freezes',
    'filter (Original/Smooth) is independent of shape and applies to Current only',
    'SHUTTER: reference Sharp vs Sampled; presets 1/240…1/30 show ms;',
    'angle needs an EXPLICIT reference fps (never the measured frame rate);',
    'the sampled oracle rebuilds on demand while paused; efficient candidate is disabled until task 2.',
    'capture: pick mode/shape (+filter/wipe), Play/Pause or freeze, screenshot the canvas;',
    '__bloodCompare.state() records seed/scenario/exposure + source/output/density.',
  ].join('\n');
  controlsEl.appendChild(hint);

  // --- global API --------------------------------------------------------
  const api = {
    state: candidateState,
    play: () => {
      playing = true; handle.setLoopRunning(true);
      if (shape === 'splash') { splashFrozen = false; splashFreezeToggle.querySelector('input')!.checked = false; }
    },
    pause: () => { playing = false; handle.setLoopRunning(false); handle.drawOnce(); },
    step: () => { playing = false; handle.setLoopRunning(false); handle.step(1 / 60); },
    replay: (nextSeed?: number) => {
      if (nextSeed !== undefined && Number.isFinite(nextSeed)) { seed = Math.floor(nextSeed); seedInput.value = String(seed); }
      if (shape === 'splash') resetSplash(); else simulateCurrentTo(eventTime);
      if (!playing) handle.drawOnce();
    },
    setShape: (s: ShapeId) => { setShape(s); if (!playing) handle.drawOnce(); },
    setSplashTime: (t: number) => {
      if (!Number.isFinite(t)) return;
      eventTime = Math.max(0, Math.min(IMPACT_SPLASH_TUNING.lifetimeSec, t));
      eventTimeInput.value = String(eventTime);
      if (shape === 'splash') {
        if (!splashEvent) resetSplash();
        else splashEvent.time = eventTime;
        splashFrozen = true;
        splashFreezeToggle.querySelector('input')!.checked = true;
      } else {
        simulateCurrentTo(eventTime);
      }
      if (!playing) handle.drawOnce();
    },
    setSplashFrozen: (on: boolean) => {
      splashFrozen = on;
      splashFreezeToggle.querySelector('input')!.checked = on;
      if (shape === 'splash' && !playing) handle.drawOnce();
    },
    resetSplash: () => {
      eventTime = SPLASH_CROWN_SEC;
      eventTimeInput.value = String(eventTime);
      resetSplash(); if (!playing) handle.drawOnce();
    },
    splashState,
    setVariant: (v: VariantId) => { variant = v; if (!playing) handle.drawOnce(); },
    setWipe: (on: boolean, a?: VariantId, b?: VariantId, pos?: number) => {
      wipe = on; if (a) wipeA = a; if (b) wipeB = b;
      if (pos !== undefined && Number.isFinite(pos)) wipePos = Math.max(0.05, Math.min(0.95, pos));
      if (!playing) handle.drawOnce();
    },
    setScenario: (s: ScenarioId) => {
      scenario = s;
      if (scenarioSelect) scenarioSelect.value = s;
      if (shape === 'current') simulateCurrentTo(eventTime); else clearSim();
      if (!playing) handle.drawOnce();
    },
    setDensityScale: (v: number) => { gooLayer.setDensityScale(v); if (!playing) handle.drawOnce(); },
    setSource: (w: number, h: number) => {
      sourceW = Math.max(16, Math.round(w)); sourceH = Math.max(16, Math.round(h));
      gooLayer.setSize(sourceW, sourceH);
      if (!playing) handle.drawOnce();
    },
    setLayers: (o: { goo?: boolean; mist?: boolean }) => {
      if (o.goo !== undefined) gooVisible = o.goo;
      if (o.mist !== undefined) mistVisible = o.mist;
      applyLayerToggles();
      if (!playing) handle.drawOnce();
    },
    /** Switch the comparison axis. 'shutter' resolves the Current sim. */
    setMode: (m: CompareMode) => {
      compareMode = m;
      if (compareMode === 'shutter' && shape === 'splash') setShape('current');
      refreshShutterLabels(); updateDiag();
      if (!playing) handle.drawOnce();
    },
    /**
     * Set any subset of the shutter axis. `reference: 'efficient'` is
     * REJECTED: the candidate does not exist until task 2, so the API cannot
     * be used to pass it off as implemented.
     */
    setShutter: (o: {
      reference?: ShutterReferenceId; preset?: ShutterPresetId;
      samples?: number; exposureMode?: ShutterMode;
      angleDeg?: number; referenceFps?: number; maxStreakPx?: number;
    }) => {
      if (o.reference && o.reference !== 'efficient') shutterRef = o.reference;
      if (o.preset) shutterPresetId = o.preset;
      if (o.samples !== undefined) shutterSampleCount = clampSampleCount(o.samples);
      if (o.exposureMode) exposureMode = o.exposureMode;
      if (o.angleDeg !== undefined && Number.isFinite(o.angleDeg)) shutterAngleDeg = o.angleDeg;
      if (o.referenceFps !== undefined && Number.isFinite(o.referenceFps) && o.referenceFps > 0) shutterReferenceFps = o.referenceFps;
      if (o.maxStreakPx !== undefined && Number.isFinite(o.maxStreakPx)) shutterMaxStreakPx = o.maxStreakPx;
      if (shutterRefSelect) shutterRefSelect.value = shutterRef;
      refreshShutterLabels(); updateDiag();
      if (!playing) handle.drawOnce();
    },
    shutterState,
    captureInstructions: () => [
      '1. npm run dev and open /sdf-blood-compare.html (WebGPU required).',
      '2. Default is shape=Impact splash, FROZEN at the representative crown moment (event t).',
      '3. Switch shape=Current slug: the scenario is forced to burst and re-simulated to the SAME event t.',
      '4. filter applies to Current only and is disabled (labelled) in Impact splash; record state().',
      '5. Press Play/Pause (or leave frozen), then record __bloodCompare.state() beside the image.',
      '6. Screenshot the canvas; compare only shots at the same seed, event t, source grid and output size.',
      '7. SHUTTER: mode=Shutter, pick a scenario (bleed/trail/crossing/burst), reference=Sharp vs Sampled,',
      '   exposure preset or angle with an explicit reference fps; the reference rebuilds on demand while paused.',
      '8. The efficient candidate is UNAVAILABLE until task 2 and is disabled in the UI; never compare it.',
      'Visual acceptance is PENDING: not verified during the training window.',
    ],
  };
  (globalThis as unknown as { __bloodCompare?: typeof api }).__bloodCompare = api;

  // --- wiring ------------------------------------------------------------
  // ONE clock for both shapes. Playing steps the shared event time and either
  // poses the crown or re-simulates the Current slug to the exact same t, so
  // the two sides never drift apart.
  handle.setRenderCallback((dt) => { advanceEvent(dt); });
  handle.setDrawFn(() => { draw(); });
  attachOrbit(handle.canvas);
  applyCamera();
  scene.background = background;
  // Review default: the new Impact splash, frozen at the crown moment.
  setShape('splash');
  handle.setLoopRunning(false);
  handle.drawOnce();

  window.addEventListener('pagehide', () => {
    bloodView.dispose();
    gooLayer.dispose();
    splashLayer.dispose();
    rtA.dispose(); rtB.dispose();
    refAccum.dispose(); refScene.dispose();
    depthOnly.dispose();
    compMesh.geometry.dispose();
    (compMesh.material as THREE.Material).dispose();
    blitA.geometry.dispose(); blitB.geometry.dispose();
    (blitA.material as THREE.Material).dispose();
    (blitB.material as THREE.Material).dispose();
  }, { once: true });
}

bootstrap().catch((err) => {
  const errEl = document.getElementById('errors');
  if (errEl) errEl.textContent = `FAILED: ${errorMessage(err)}`;
  console.error('[blood-compare] unhandled', err);
});
