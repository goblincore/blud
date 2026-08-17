// src/lab/sdf-zombie/webgpu/lab-main.ts
//
// The SDF zombie lab, on WebGPU. Feature-parity twin of ../lab-main.ts.
//
// Everything renderer-independent is SHARED, not copied: build-body, body,
// face, material, damage, sever, rig, rig-bind, gib-chunks, validate, panel.
// Only the rendering tail (createLabRenderer + zombie-gpu) differs, which is
// the whole point of the migration being lab-scoped — the field maths cannot
// drift between the two paths because there is only one copy of it.
//
// Two differences from the WebGL lab, both deliberate:
//
//   1. NO POST-FX. pmndrs `postprocessing` is WebGL-only and its EffectComposer
//      cannot drive a WebGPURenderer. The WebGPU spec dropped it on purpose:
//      post-fx defaults OFF in the WebGL lab anyway, because the flesh presets
//      were tuned against a missing gamma encode and read far too bright
//      through the correct chain. Rebuilding Bayer dither and the BLOOD.PAL
//      snap as a TSL PostProcessing pipeline is its own follow-up, and it
//      should not gate parity.
//   2. An N-BODY SPAWNER ([ and ]) and a frame-time readout, carried over from
//      the spike. Extra bodies are static crowd fill — the rig, wounds,
//      severing and gibs all drive body zero. That is what makes the count
//      honest for a cost measurement: crowd cost, not feature cost.

// From 'three/webgpu', never 'three'. Two copies of three means the node
// system cannot see the lights and every standard material renders black.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER } from './sdf-layer';
import { createZombieGpuView, createChunkGpuView, type ChunkGpuView } from './zombie-gpu';
import { createOccluderHull } from './occluder-hull';
import { translateBody } from '../translate';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { makeZombie } from '../body';
import {
  DEFAULT_FACE, FACE_PRESETS, pickFace, type FaceParams,
} from '../face';
import {
  FLESH_PRESETS, LIGHT_PRESETS,
  type FleshMaterial, type FleshPresetName, type LightPresetName,
} from '../material';
import {
  MAX_WOUNDS, pushWound, woundWorldPos, worldHitToWound, WOUND_PROFILES,
  type Wound, type WoundType,
} from '../damage';
import { sdBody } from '../validate';
import { severLimb, severDistal, gibAll, gibAllPieces } from '../sever';
import { makeGobs } from '../gobs';
import { createBloodSim, burst, emitTrails, stepBlood, addScraps } from '../blood-sim';
import { createBloodView } from './blood-view-gpu';
import { createGooLayer } from './goo-layer';
import { cutChains, cutLimbs } from '../connectivity';
import { bindRig, applyRig, impulseAt, headQuatOf } from '../rig-bind';
import { stepRig } from '../rig';
import { relaxRopeConstraints, type MissingLimbs } from '../collapse';
import {
  applyFloorContact, makeMotionJoints, makeMotionState, MOTION_TUNING,
  planSubSteps, STANDING_RIG, stepMotion,
  type MotionJoints, type MotionSignals,
} from '../motion';
import { makeRng, type WanderBounds } from '../wander';
import { add } from '../vec';
import { makeChunk, stepChunk, type Chunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { simplifyBody } from '../simplify';
import { buildHandPrims } from '../hands';
import {
  EMPTY_FPV_INPUT, enterFpvMode, exitFpvMode, forceThrow, handPrimsToWorld,
  makeFpvMode, posedHandPrims, stepFpvMode,
  type FpvGorePort, type FpvModeState,
} from '../fpv-mode';
import { cookCharge } from '../fpv';
import { createBurstLayer, createHandsGpuView, createStickProp } from './fpv-view';
import {
  initialAdaptiveState, scaleForRung, stepAdaptive,
} from '../adaptive-scale';
import {
  LOD_LEVELS, LOD_LEVERS, pickLodSticky, screenHeightPx,
  type LodLevel, type LodLever,
} from '../lod';
import type { LimbId, Vec3 } from '../types';
import {
  addButton, addSection, addSelect, addSlider, clearOverride,
  loadOverride, saveOverride, serializeOverride, MATERIAL_SLIDERS, FACE_SLIDERS,
} from '../panel';

// ---------------------------------------------------------------------------
// Face texture sheets. Same three sources as the WebGL lab, same crop rects.
//
// - `zombie-flat` is ORIGINAL art and the shipping candidate: a luminance MASK
//   on neutral mid-grey rather than a picture, so mid-grey divided by the mean
//   comes out at 1.0 and only the features act.
// - `smiley` is a DIAGNOSTIC — flat yellow, a red border on the projected
//   rect, a blue mark top-left. No baked lighting, no alpha, no crop ambiguity,
//   so a misregistration shows you exactly HOW it is wrong.
// - `blood-zombie` is extracted Blood art. DEV PLACEHOLDER, never ships.
//
// `rect` is in TOP-LEFT pixel coordinates: [x, y, w, h, sheetW, sheetH].
// `mean` is MEASURED off the file — it sets the level the multiplier divides
// out, so a stale value shifts the whole head's brightness.
// ---------------------------------------------------------------------------
type FaceTexName = 'zombie-flat' | 'smiley' | 'blood-zombie';

const FACE_TEXTURES: Record<
  FaceTexName,
  { url: string; rect: [number, number, number, number, number, number]; mean: number }
> = {
  'zombie-flat': { url: '/assets/lab/zombie-face.png', rect: [0, 0, 64, 64, 64, 64], mean: 0.406 },
  smiley: { url: '/assets/lab/smiley.png', rect: [0, 0, 64, 64, 64, 64], mean: 0.66 },
  'blood-zombie': {
    url: '/assets/blood-tiles/1200.png',
    rect: [32, 0, 18, 16, 77, 116],
    mean: 0.33,
  },
};

const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };

/** Chunks are disposed oldest-first past this, so a long session can't leak.
 *  A per-prim gib is ~15 pieces, so 40 lets two full gibs coexist. */
const MAX_CHUNKS = 40;

// Everything lives inside an async bootstrap rather than using top-level await.
// WebGPURenderer needs `await renderer.init()`, and the project's build target
// predates top-level await.
async function main() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');

  const handle = await createLabRenderer(mount);
  const { scene, camera } = handle;

  // Ground plane and a reference cube, so the raymarched blobs have polygonal
  // geometry to composite against and depth interleaving is obvious by eye.
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

  let override = loadOverride();
  const face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
  const body = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);

  const errorsEl = document.getElementById('errors');
  function showErrors(b: BuildResult) {
    if (errorsEl) errorsEl.textContent = b.errors.join('\n');
  }
  showErrors(body);

  // Panel readouts are built FIRST, before setRenderCallback: the animation
  // loop is already running by the time createLabRenderer resolves, so a frame
  // can fire the moment the callback is installed and would hit these in their
  // temporal dead zone if they were declared alongside the rest of the panel.
  const panelEl = document.getElementById('panel')!;
  const statusBox = addSection(panelEl, 'renderer');
  // Backend first, and loud. WebGPURenderer falls back to a WebGL2 backend
  // silently, and "it worked" on the fallback is not evidence the WebGPU path
  // works — the single most important thing to know when reading this page.
  const backendEl = document.createElement('div');
  backendEl.textContent = `backend: ${handle.backend}`;
  backendEl.style.color = handle.backend === 'webgpu' ? '#9c9' : '#ff6464';
  backendEl.style.fontSize = '11px';
  statusBox.appendChild(backendEl);
  const countEl = document.createElement('div');
  countEl.style.fontSize = '11px';
  countEl.textContent = 'bodies: 1';
  statusBox.appendChild(countEl);
  const fpsEl = document.createElement('div');
  fpsEl.style.fontSize = '11px';
  statusBox.appendChild(fpsEl);
  const resEl = document.createElement('div');
  resEl.style.fontSize = '11px';
  statusBox.appendChild(resEl);
  // Result line for the keypress-driven benchmark — see runBench.
  const benchEl = document.createElement('div');
  benchEl.style.fontSize = '11px';
  benchEl.style.color = '#fc9';
  statusBox.appendChild(benchEl);
  // Motion status line (filled by the motion panel section further down;
  // declared here so the frame callback can always reach it).
  let motionReadEl: HTMLDivElement | null = null;
  // FPV readout line — same declaration-before-callback pattern.
  let fpvReadEl: HTMLDivElement | null = null;

  // The raymarched bodies render into their own target at their own scale and
  // composite back over the polygonal scene. Cost is close to linear in
  // pixels, so this is the biggest lever available without compute.
  const sdfLayer = createSdfLayer(handle.renderer);
  function sizeSdfLayer() {
    const s = handle.renderer.getDrawingBufferSize(new THREE.Vector2());
    sdfLayer.setSize(s.x, s.y);
    const t = sdfLayer.targetSize;
    resEl.textContent = `sdf ${t.width}x${t.height} (${sdfLayer.scale.toFixed(2)}x)`;
    // Cone footprint radius per unit distance: a tile spans CONE_TILE pixels
    // of the SDF pass, and the frame spans 2*tan(fov/2) of world per unit
    // distance over its full height.
    // The cone footprint constants both levels use, derived from the layer's
    // resolution and the lens. Owned here rather than per view: every body's
    // cone material reads the same uniforms.
    sdfLayer.setConeGeometry(camera.fov, t.height);
  }
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);
  // The frame's draw: goo density first, then the whole sdf flow in the
  // middle, then the goo surface composited on top (with fake depth, so it
  // interleaves with flesh and floor). gooLayer is declared further down —
  // safe in a closure because everything between here and the end of main()
  // is synchronous, so no frame can fire before it initialises.
  handle.setDrawFn(() => gooLayer.render(camera, () => sdfLayer.render(scene, camera)));

  // The occluder hull. Its own layer, rendered before the march, so every ray
  // can stop at the distance something solid already covers — the early-Z that
  // frag_depth and discard rule out.
  //
  // ON BY DEFAULT, and the cone stays off, because the full on/off matrix was
  // measured (10 bodies, 960x540, cooled, interleaved, all runs valid):
  //
  //                 cone only   cone+occ   occ only   neither
  //   stacked        18.32       17.93      16.29      21.30
  //   spread         11.24       10.92      10.86        —
  //
  // Occluder-only wins BOTH scenes. The two accelerators cut the same ray
  // interval — cone from the front, occluder from the back — and once the
  // occluder exists, the cone's two extra render passes cost more than its
  // start distances save. The cone toggle stays for measurement, not for use.
  const occluderHull = createOccluderHull();
  occluderHull.object.layers.set(OCCLUDER_LAYER);
  scene.add(occluderHull.object);
  sdfLayer.setOccluderEnabled(true);

  let flesh: FleshMaterial = { ...FLESH_PRESETS['henenlotter-latex'] };
  let light: LightPresetName = 'practical-hard-key';

  const view = createZombieGpuView(body, { cone: sdfLayer.cone, occluder: sdfLayer.occluder });
  view.applyMaterial(flesh, LIGHT_PRESETS[light]);
  // Everything raymarched lives on SDF_LAYER, so the two render passes are a
  // camera layer mask apart rather than an object list to keep in sync.
  view.object.layers.set(SDF_LAYER);
  view.coneObject.layers.set(CONE_LAYER);
  scene.add(view.object);
  scene.add(view.coneObject);
  const u = view.uniforms;

  // The metaball blood layer (gobs-and-goo task 5). It shares the march's
  // light uniform NODES — not copies — so any panel re-tune of lightDir /
  // keyColor / intensities moves the goo and the flesh together. Created
  // here rather than beside sdfLayer because it needs those nodes, which
  // only exist once the body view does.
  const gooLayer = createGooLayer(handle.renderer, {
    lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
  });
  {
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
  }
  // Density follows the SDF layer's resolution at a fixed fraction; this
  // listener is registered AFTER sizeSdfLayer's own, so it reads the
  // already-updated targetSize. A separate listener rather than a line in
  // sizeSdfLayer because that runs once before gooLayer exists (temporal
  // dead zone — see the panel note on frames firing mid-bootstrap).
  window.addEventListener('resize', () => {
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
  });

  /**
   * Crowd fill. Declared here, ahead of everything that touches it, because a
   * face-sheet swap has to reach these too — see loadFaceTexture. Populated by
   * setCrowdCount further down.
   */
  const crowd: ReturnType<typeof createZombieGpuView>[] = [];

  // -------------------------------------------------------------------------
  // LOD
  //
  // Every lever except AO is expressed by driving a uniform that already
  // existed to zero, which the shader branches on. That keeps the LOD system
  // from becoming a second source of truth about what the shader does.
  //
  // `full` is the reference: the quality the lab had before LOD existed. It is
  // what `lod: off` restores, and what each per-lever override is measured
  // against, so a measurement never compares against a moving baseline.
  // -------------------------------------------------------------------------
  const FULL_QUALITY: LodLevel = {
    name: 'full',
    minScreenPx: 0,
    steps: 96,
    simplify: false,
    silhouetteNoise: true,
    surfaceNoise: true,
    scatter: true,
    ao: true,
    face: true,
    wounds: true,
  };

  // OFF by default since the X1.10 re-measure: at LOD's own benchmark scene
  // (10 bodies spread, occluder on) the whole quality-lever system is worth
  // 0.2% — within noise. Normal warping made its top lever (silhouette noise
  // in the march) free, and the occluder absorbed the rest. The machinery
  // stays for measurement, but paying its popping/hysteresis complexity by
  // default bought nothing the last time it was measured.
  let lodEnabled = false;
  /**
   * Per-lever overrides, for measuring one thing at a time. `null` means "let
   * LOD decide"; true/false force it on every body regardless of distance.
   */
  const lodOverride: Partial<Record<LodLever, boolean | null>> = {};
  /** Forces the march step count on every body. null = let LOD decide. */
  let stepsOverride: number | null = null;
  /**
   * Forces the coarse-body swap. Separate from `lodOverride` because every
   * entry there is a quality flag where true means "better", and `simplify` is
   * the one lever where true means "cheaper" — folding it in would break the
   * monotonicity the LOD table is checked against.
   */
  let simplifyOverride: boolean | null = null;
  /** Last level chosen per body, so pickLodSticky has something to stick to. */
  const lastLevel = new WeakMap<object, number>();
  /** Last set of uniform values applied, so unchanged frames write nothing. */
  const lastSig = new WeakMap<object, string>();

  /** The world-space centre of a body's proxy, which is what distance means here. */
  const bodyCentre = new THREE.Vector3();
  const drawSize = new THREE.Vector2();

  /** World height of a view's proxy box, which is the body's own height. */
  function boxHeight(o: THREE.Object3D): number {
    const geo = (o as THREE.Mesh).geometry as THREE.BoxGeometry | undefined;
    const h = geo?.parameters?.height ?? 1.8;
    return h * o.scale.y;
  }

  /** The panel's face-texture switch. LOD may turn the face off, never on. */
  let faceEnabled = true;

  /**
   * What each view currently has UPLOADED — detailed or coarse — plus the
   * source bodies to swap between.
   *
   * Swapping is a re-pack and a texture upload, so it must happen on the frame
   * the level CHANGES and not on every frame at that level. Keyed by object
   * rather than held on the view so LOD stays a lab concern.
   */
  const bodySource = new WeakMap<
    object, { detailed: BuildResult; coarse: BuildResult; usingCoarse: boolean }
  >();

  /** Registers a view's bodies, and builds its coarse stand-in once. */
  function trackBody(v: ReturnType<typeof createZombieGpuView>, b: BuildResult) {
    bodySource.set(v.object, {
      detailed: b, coarse: simplifyBody(b), usingCoarse: false,
    });
  }

  function applyLod(v: ReturnType<typeof createZombieGpuView>) {
    const vu = v.uniforms;
    let level: LodLevel;
    if (lodEnabled) {
      v.object.getWorldPosition(bodyCentre);
      const dist = bodyCentre.distanceTo(camera.position);
      // The proxy box's height IS the body's world height, and it shrinks when
      // limbs come off — so a torso-only body correctly counts as smaller.
      // Viewport height in DEVICE pixels, not CSS: the lab renders at 540 and
      // stretches, so CSS height would over-report detail by ~2x.
      const worldH = boxHeight(v.object);
      const px = screenHeightPx(worldH, dist, camera.fov, handle.renderer.getDrawingBufferSize(drawSize).y);
      const idx = pickLodSticky(px, lastLevel.get(v.object) ?? -1);
      lastLevel.set(v.object, idx);
      level = LOD_LEVELS[idx]!;
    } else {
      level = FULL_QUALITY;
    }

    const on = (k: LodLever) => {
      const o = lodOverride[k];
      return o === undefined || o === null ? (level[k] as boolean) : o;
    };

    // Wound suppression has to run every frame regardless: uploadWounds writes
    // the live count earlier in the same frame, so a cached skip would let a
    // suppressed level's wounds reappear.
    if (!on('wounds')) vu.woundCfg.value.x = 0;

    // Everything else is applied ONLY when the decision changes. Writing these
    // uniforms every frame for every body measurably COST time — the close-
    // packed 15-body case came out ~6% slower with LOD on than off, despite
    // LOD choosing full quality for every body, because each write dirties a
    // uniform buffer that then has to be re-uploaded.
    const sig = `${level.name}|${stepsOverride}|${simplifyOverride}|${faceEnabled}|` +
      LOD_LEVERS.map(k => (on(k) ? 1 : 0)).join('') +
      `|${flesh.silhouetteNoiseAmp},${flesh.surfaceNoiseAmp},${flesh.translucency}`;
    if (lastSig.get(v.object) === sig) return;
    lastSig.set(v.object, sig);

    vu.marchCfg.value.x = stepsOverride ?? level.steps;
    // Zero amplitude is what the shader branches on — see the LOD note on
    // MARCH_BODY. These read their "on" value back from the live material so
    // the panel sliders keep working while LOD is running.
    vu.marchCfg.value.z = on('silhouetteNoise') ? flesh.silhouetteNoiseAmp : 0;
    vu.surfCfg2.value.y = on('surfaceNoise') ? flesh.surfaceNoiseAmp : 0;
    vu.surfCfg.value.w = on('scatter') ? flesh.translucency : 0;
    vu.lodCfg.value.x = on('ao') ? 1 : 0;
    vu.faceCfg.value.x = on('face') && faceEnabled ? 1 : 0;
    // Body swap, only on the frame the decision CHANGES: it re-packs and
    // re-uploads the data texture, which is far too much to do every frame at
    // a steady level. The hero is exempt — it is rig-driven and re-uploaded
    // every frame anyway, and it is the body being looked at.
    const src = bodySource.get(v.object);
    const wantCoarse = v !== view
      && (simplifyOverride === null ? level.simplify : simplifyOverride);
    if (src && wantCoarse !== src.usingCoarse) {
      src.usingCoarse = wantCoarse;
      v.update(wantCoarse ? src.coarse : src.detailed);
    }
  }

  // -------------------------------------------------------------------------
  // Face texture
  // -------------------------------------------------------------------------
  /**
   * The one live face sheet, shared by the body and every crowd body. Kept
   * here rather than inside a view because the views do not own it: swapping
   * the sheet has to reach all of them, and only one of them may dispose it.
   */
  let faceSheet: { tex: THREE.Texture; atlas: THREE.Vector4; mean: number } | null = null;

  function loadFaceTexture(name: FaceTexName) {
    const def = FACE_TEXTURES[name];
    const tex = new THREE.TextureLoader().load(def.url);
    tex.magFilter = THREE.NearestFilter;   // chunky texels, not a blurry smear
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    // Keep three's default flipY (true) so the top-left pixel rects above
    // convert with no arithmetic. three's WebGPU backend honours flipY at
    // upload just as the WebGL one does, and the WGSL side reads the sheet with
    // textureLoad, which indexes the same stored rows a GLSL sampler would —
    // so orientation matches the WebGL lab with no per-path fudge.
    tex.flipY = true;
    const [x, y, w, h, sheetW, sheetH] = def.rect;
    faceSheet?.tex.dispose();
    faceSheet = {
      tex,
      atlas: new THREE.Vector4(w / sheetW, h / sheetH, x / sheetW, y / sheetH),
      mean: def.mean,
    };
    for (const v of [view, ...crowd]) v.setFaceTexture(tex, faceSheet.atlas, def.mean);
  }

  let faceTexName: FaceTexName = 'zombie-flat';
  loadFaceTexture(faceTexName);
  u.faceCfg.value.x = 1;      // face on
  u.faceCfg.value.y = 1.0;    // strength
  // Baked projection: uv = hs * scale + centre, hs normalised PER AXIS by the
  // skull's semi-axes so these numbers survive a reproportioned head.
  u.faceProj.value.set(0.45, 0.58, 0.5, 0.56);

  /**
   * The skull's centre and its three SEMI-AXES: the fattest additive primitive
   * in the head cluster, measured per axis.
   *
   * Not the head cluster's bounding sphere — that also encloses the neck
   * capsule, so normalising by it spills the texture over the shoulders. And
   * per-axis rather than one radius, because the head is an ellipsoid: with a
   * single radius whichever axis was largest landed on the head mask's cutoff
   * and the whole face vanished.
   */
  function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
    const head = b.clusters.find(c => c.limb === 'head');
    if (!head) return null;
    let best: Vec3 | null = null;
    let bestAxes: Vec3 | null = null;
    let bestR = -Infinity;
    for (const p of b.prims.slice(head.start, head.start + head.count)) {
      if (p.op === 'sub') continue;
      const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
      if (r > bestR) {
        bestR = r;
        best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
        bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
      }
    }
    return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
  }

  // -------------------------------------------------------------------------
  // Live state
  // -------------------------------------------------------------------------
  /** The live body — replaced on sever and on any override edit. */
  let current = body;
  let bound = bindRig(current);
  /** The hero's latest POSED body (world space) — what's on screen, and what
   *  shots raycast against. Authored rest-space raycasting stopped being
   *  valid the moment the body could wander or fall. */
  let lastPosed = current;

  // Motion (X1.22): the orchestrator drives the hero's rest-pose targets;
  // the crowd stays static — it is a perf fixture, body zero is the actor.
  const WANDER_BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };
  const MOTION_SEED = 1337; // fixed: reproducible shambling for A/B checks
  const motionRng = makeRng(MOTION_SEED);
  let motionJoints: MotionJoints | null = makeMotionJoints(current, bound.rig.restPose);
  let motionState = makeMotionState(MOTION_SEED, [0, 0, 0]);
  let motionEnabled = true;
  let wanderOn = true;
  let forcedCollapse = false;
  let lastRootShift: Vec3 = [0, 0, 0];
  // bindRig pins the lowest joint as a static anchor; walking releases it —
  // the rest pull + plants carry the body instead (and collapse wants the
  // pin gone anyway, so it lives in one place).
  function unpinnedRigPoints() {
    return bound.rig.points.map(p => ({ ...p, pinned: false }));
  }
  if (motionJoints) {
    bound = { ...bound, rig: { ...bound.rig, points: unpinnedRigPoints() } };
  }
  // Per-frame signal accumulators: events (shots/severs) land between frames,
  // the motion step consumes and clears them inside the frame callback.
  let pendingShot: MotionSignals['shot'] = null;
  const pendingWounds: Wound[] = [];
  const pendingSevered: LimbId[] = [];

  /**
   * Re-binds the prims after a body edit. While motion is on, the rig POINTS
   * are carried across (bones are unchanged by severing — only alive flags
   * move — so the points map 1:1); without this, every shot that severed a
   * limb would teleport the walking body back to the origin.
   */
  function rebind() {
    const keep = motionEnabled && motionJoints ? bound.rig.points : null;
    bound = bindRig(current);
    if (keep && keep.length === bound.rig.points.length) {
      bound = {
        ...bound,
        rig: { ...bound.rig, points: keep.map(p => ({ ...p, pinned: false })) },
      };
    }
  }

  /** Hard motion reset: fresh bind at the origin, fresh clocks. Body edits
   *  (rebuild/respawn/gib) spawn a new shambler rather than springing an old
   *  pose across the arena. */
  function resetMotion() {
    bound = bindRig(current);
    motionJoints = makeMotionJoints(current, bound.rig.restPose);
    if (motionJoints) {
      bound = { ...bound, rig: { ...bound.rig, points: unpinnedRigPoints() } };
    }
    motionState = makeMotionState(MOTION_SEED, [0, 0, 0]);
    lastRootShift = [0, 0, 0];
    pendingShot = null;
    pendingWounds.length = 0;
    pendingSevered.length = 0;
    forcedCollapse = false;
  }

  /** Full-limb severance map from cluster alive flags (mid-limb distal cuts
   *  leave the cluster alive and do NOT count — hop/collapse see full legs). */
  function missingLimbs(): MissingLimbs {
    const gone = (l: LimbId) => !(current.clusters.find(c => c.limb === l)?.alive ?? false);
    return { legL: gone('legL'), legR: gone('legR'), armL: gone('armL'), armR: gone('armR') };
  }

  /** Present-but-hurt limbs for the gait limp skew — a limb carrying at
   *  least one live wound on a still-alive cluster. */
  function woundedLimbs() {
    const alive = (l: LimbId) => current.clusters.find(c => c.limb === l)?.alive ?? false;
    const w = { armL: false, armR: false, legL: false, legR: false };
    for (const wound of wounds) {
      const prim = current.prims[wound.primIdx];
      if (!prim || !alive(prim.limb)) continue;
      if (prim.limb === 'armL' || prim.limb === 'armR'
        || prim.limb === 'legL' || prim.limb === 'legR') w[prim.limb] = true;
    }
    return w;
  }

  let wounds: Wound[] = [];
  const chunks: { id: number; state: Chunk; view: ChunkGpuView }[] = [];
  // Blood: the deterministic droplet/splat sim, plus its instanced renderer.
  const bloodSim = createBloodSim();
  const bloodView = createBloodView();
  for (const o of bloodView.objects) scene.add(o);
  /** Trail-source ids for emitTrails — every flying chunk is an emitter. */
  let nextChunkId = 1;

  /** Marches the CPU-side field along a ray to find where a shot lands. */
  function raycastBody(origin: Vec3, dir: Vec3, field: BuildResult = current): Vec3 | null {
    let t = 0;
    for (let i = 0; i < 128 && t < 20; i++) {
      const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      const d = sdBody(p, field);
      if (d < 0.002) return p;
      t += Math.max(d, 0.002);
    }
    return null;
  }

  function uploadWounds(prims: BuildResult['prims']) {
    view.setWounds(
      wounds.map(w => woundWorldPos(prims, w)),
      wounds.map(w => w.radius),
      wounds.map(w => TYPE_ID[w.type]),
      wounds.map(w => w.ageSec),
      wounds.map(w => WOUND_PROFILES[w.type].rimSplayScale),
      wounds.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
    );
  }
  function refreshWounds() { uploadWounds(current.prims); }

  /**
   * The hero's wounds as world-space removal spheres, from the SAME posed
   * primitives the wound upload uses — so the hull's exclusion zone tracks
   * the jiggle exactly as the rendered craters do.
   */
  function woundSpheres(prims: BuildResult['prims']) {
    return wounds.map(w => ({ centre: woundWorldPos(prims, w), radius: w.radius }));
  }

  // -------------------------------------------------------------------------
  // Crowd fill, for the LOD work that comes next. Extra bodies are STATIC —
  // no rig, no wounds — but they DO carry the face, because the face block is
  // real per-pixel cost and a crowd that skipped it would quietly under-report
  // what a real crowd costs. Body zero is the one the lab interacts with.
  //
  // Translate the FIELD, not the mesh: the shader marches in world space and
  // the packed primitives ARE the field, so object.position would move only the
  // proxy box and clip the body into slices.
  // -------------------------------------------------------------------------
  /**
   * How far apart crowd bodies stand, as a multiplier on the base grid.
   *
   * 1 is the shoulder-to-shoulder pack the renderer bench used: every body
   * large on screen and heavily overlapped, which is the LOD worst case
   * because nothing is small enough to demote. Larger values stretch the grid
   * back into something closer to a real encounter, where most of the crowd is
   * at a distance — which is the case LOD is actually for. Both numbers belong
   * in any perf claim; quoting only one of them would be picking a winner.
   */
  let crowdSpread = 1;
  /**
   * Whether crowd bodies get a shader specialised to their structure.
   * Applied at spawn, so changing it re-spawns the crowd.
   */
  let specialiseShaders = false;

  /**
   * Shell-displacement silhouette noise (gobs-and-goo task 4): inside a thin
   * shell of the smooth surface, the march steps the fbm-displaced REAL field
   * conservatively instead of warping only the normal. The amplitude matches
   * marchCfg.z's silhouette value (0.016), so the displaced skin and the
   * warped normals — same fbm, same scale — never disagree.
   */
  const SHELL_AMP = 0.016;
  /** One source of truth for the default: defaultUniforms' woundCfg2.z. */
  let shellSilhouette = u.woundCfg2.value.z > 0;

  function setCrowdCount(n: number) {
    while (crowd.length > n) {
      const v = crowd.pop();
      if (!v) break;
      scene.remove(v.object);
      scene.remove(v.coneObject);
      v.dispose();
    }
    while (crowd.length < n) {
      const i = crowd.length + 1; // body zero is the interactive one
      const col = i % 5;
      const row = Math.floor(i / 5);
      // Each crowd body gets its OWN head, built from a random preset, so a
      // crowd is not fifteen copies of one skull. Silhouette is the only thing
      // that can vary — every zombie shares one face sheet — so it is the only
      // place variety can come from. Built once at spawn, not per frame.
      const crowdFace = pickFace(Math.random());
      const crowdBody = buildBody(makeZombie(crowdFace), DEFAULT_BUILD_OPTS, override);
      const placed = translateBody(crowdBody,
        [(col - 2) * 0.62 * crowdSpread, 0, -row * 0.85 * crowdSpread]);
      const v = createZombieGpuView(placed,
        { specialise: specialiseShaders, cone: sdfLayer.cone, occluder: sdfLayer.occluder });
      trackBody(v, placed);
      v.applyMaterial(flesh, LIGHT_PRESETS[light]);
      if (faceSheet) {
        v.setFaceTexture(faceSheet.tex, faceSheet.atlas, faceSheet.mean);
        v.uniforms.faceCfg.value.copy(u.faceCfg.value);
        v.uniforms.faceCfg2.value.copy(u.faceCfg2.value);
        v.uniforms.faceProj.value.copy(u.faceProj.value);
        // Static, so the skull's sphere is set once rather than re-derived from
        // a posed body every frame.
        const skull = headShape(placed);
        if (skull) v.setHeadShape(skull.centre, skull.axes);
      }
      v.object.layers.set(SDF_LAYER);
      v.coneObject.layers.set(CONE_LAYER);
      scene.add(v.object);
      scene.add(v.coneObject);
      crowd.push(v);
    }
    countEl.textContent = `bodies: ${crowd.length + 1}`;
  }

  // -------------------------------------------------------------------------
  // Orbit camera. EITHER button drags to orbit; a left press that does not
  // travel far enough to count as a drag fires a shot instead.
  // -------------------------------------------------------------------------
  let camYaw = 0.35;
  let camPitch = 0.12;
  let camDist = 2.4;
  const camTarget = new THREE.Vector3(0, 1.05, 0);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  /** Cursor travel since pointerdown, in px. Under the threshold it was a click. */
  let dragTravel = 0;
  const DRAG_SLOP = 5;
  let autoSpin = true;

  const canvas = handle.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (fpvMode.mode === 'fpv') {
      // FPV owns the left button: press = cook. No orbiting in first person.
      if (e.button === 0) fpvPress = true;
      return;
    }
    autoSpin = false;
    if (e.button !== 0 && e.button !== 2) return;
    dragging = true;
    dragTravel = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    dragTravel += Math.hypot(dx, dy);
    if (dragTravel < DRAG_SLOP) return;
    camYaw -= dx * 0.008;
    camPitch = Math.max(-0.5, Math.min(1.3, camPitch + dy * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener(
    'wheel',
    (e) => { camDist = Math.max(0.8, Math.min(8, camDist + Math.sign(e.deltaY) * 0.2)); },
    { passive: true },
  );

  // Shooting — left button only. Shift = blast, Alt = burn. Fires on pointerUP
  // because the same button also orbits: a press that travelled further than
  // DRAG_SLOP was a camera drag and must not also put a hole in the zombie.
  canvas.addEventListener('pointerup', (ev: PointerEvent) => {
    if (fpvMode.mode === 'fpv') {
      // Release = throw. The god-cam click-shoot pipeline stays god-only.
      if (ev.button === 0) fpvRelease = true;
      return;
    }
    if (dragging) {
      dragging = false;
      canvas.releasePointerCapture(ev.pointerId);
    }
    if (ev.button !== 0 || dragTravel >= DRAG_SLOP) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;

    // Raycast the POSED body (world space): wander/collapse broke the
    // rest-space assumption, and wounds are prim-LOCAL, so a hit mapped
    // through the posed prims rides the authored body cleanly (applyRig
    // keeps prim indices 1:1).
    const hit = raycastBody([o.x, o.y, o.z], [d.x, d.y, d.z], lastPosed);
    if (!hit) return;

    const type: WoundType = ev.shiftKey ? 'blast' : ev.altKey ? 'burn' : 'pellet';
    const wound = worldHitToWound(lastPosed.prims, hit, WOUND_PROFILES[type].radius, type);
    wounds = pushWound(wounds, wound, MAX_WOUNDS);
    pendingWounds.push(wound);
    // The shot feeds stagger (profile + direction) and, for torso blasts,
    // the wound clutch — both consumed by the next motion step.
    pendingShot = {
      type,
      dirWorld: [d.x, d.y, d.z],
      woundWorld: hit,
      torso: lastPosed.prims[wound.primIdx]?.limb === 'torso',
    };
    // A hit shoves the nearest joint along the shot direction — the rest-pose
    // pull springs it back, so the limb visibly recoils and lags.
    const push = type === 'blast' ? 0.10 : 0.04;
    bound = impulseAt(bound, hit, [d.x * push, d.y * push, d.z * push]);
    refreshWounds();

    // Wound-driven detachment: a carve that disconnects a limb severs it for
    // real — same path as the keyboard sever.
    const fullCuts = cutLimbs(current, wounds, torsoCentre());
    for (const limb of fullCuts) {
      const { body: next, chunk, stumpWound } = severLimb(current, limb);
      if (chunk.prims.length === 0) continue;
      current = next;
      if (stumpWound) {
        wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
        pendingWounds.push(stumpWound);
      }
      pendingSevered.push(limb);
      spawnChunk(limb, chunk.origin, chunk.prims, undefined,
        [attachPoint(chunk.prims, torsoCentre())]);
      view.update(current);
      refreshWounds();
      rebind();
    }

    // Mid-limb cuts: a carve that severs a CHAIN joint (knee, elbow…) drops
    // everything distal to it as its own chunk — before this the distal piece
    // stayed in the field and floated. Full-limb cuts above take precedence.
    for (const cut of cutChains(current, wounds)) {
      if (fullCuts.includes(cut.limb)) continue;
      const { body: next, chunk, stumpWound } = severDistal(current, cut);
      if (chunk.prims.length === 0) continue;
      current = next;
      if (stumpWound) {
        wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
        pendingWounds.push(stumpWound);
      }
      pendingSevered.push(cut.limb);
      spawnChunk(cut.limb, chunk.origin, chunk.prims, undefined, chunk.tornAt);
      view.update(current);
      refreshWounds();
      rebind();
    }
  });

  // -------------------------------------------------------------------------
  // Severing and gibs
  // -------------------------------------------------------------------------
  // 2 is deliberately absent — the torso must never sever.
  const SEVER_KEYS: Record<string, LimbId> = {
    '1': 'head', '3': 'armL', '4': 'armR', '5': 'legL', '6': 'legR',
  };

  /** The endpoint of `prims` nearest `toward` — i.e. where the limb tore away. */
  function attachPoint(prims: typeof current.prims, toward: Vec3): Vec3 {
    let best: Vec3 = prims[0]!.a;
    let bestD = Infinity;
    for (const p of prims)
      for (const e of [p.a, p.b]) {
        const dx = e[0] - toward[0], dy = e[1] - toward[1], dz = e[2] - toward[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = e; }
      }
    return best;
  }

  /** The piece's long axis from its prims — the topple aligns this flat. */
  function primsLongAxis(prims: typeof current.prims, origin: Vec3): Vec3 {
    // Longest chord among endpoints, in chunk-local space.
    let best: Vec3 = [0, 1, 0]; let bestLen = 0;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(...d);
      if (l > bestLen) { bestLen = l; best = d; }
    }
    return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
  }

  function torsoCentre(b: BuildResult = current): Vec3 {
    return b.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0];
  }

  function spawnChunk(
    limb: LimbId, origin: Vec3, prims: typeof current.prims,
    vel?: Vec3, tornAt?: Vec3[],
  ) {
    if (prims.length === 0) return;
    // The sever results are authored rest-space; chunks live in world space.
    // With the hero wandering (or lying somewhere), spawn the piece where the
    // body actually is — chunk.pos is the recentring origin for the piece's
    // prims AND its physics seed, so both must shift together.
    origin = add(origin, lastRootShift);
    if (tornAt) tornAt = tornAt.map(t => add(t, lastRootShift));
    const v: Vec3 = vel ?? [
      (Math.random() - 0.5) * 4.5,
      2.5 + Math.random() * 2.5,
      (Math.random() - 0.5) * 4.5,
    ];
    // Collision radius = the limb's real visual extent; chunk.radius's 0.14 is
    // smaller than any limb and would bury it half-way into the floor.
    const state = makeChunk(limb, origin, v, chunkExtent(prims, origin), primsLongAxis(prims, origin));
    const chunkView = createChunkGpuView(state, prims, u, tornAt);
    chunkView.object.layers.set(SDF_LAYER);
    scene.add(chunkView.object);
    chunks.push({ id: nextChunkId++, state, view: chunkView });
    // Goo at the tear: a droplet burst where the piece ripped away.
    burst(bloodSim, origin, Math.random);

    while (chunks.length > MAX_CHUNKS) {
      const oldest = chunks.shift();
      if (!oldest) break;
      scene.remove(oldest.view.object);
      oldest.view.dispose();
    }
  }

  /** Blows the whole body apart — every live cluster becomes a chunk. */
  function gibEverything() {
    const centre = torsoCentre();
    // gibAllPieces does the alive-flag bookkeeping; the PIECES come from
    // makeGobs instead — amorphous hunks + scraps, not anatomy prims
    // (gobs-and-goo spec §1). Severs still detach real anatomy.
    const { body: next } = gibAllPieces(current, centre);
    const { gobs, scraps } = makeGobs(current, centre, Math.random);
    addScraps(bloodSim, scraps, centre, Math.random);
    for (const g of gobs) {
      // Radial launch from the body centre, so the pile spreads instead of
      // every piece going the same way.
      const dx = g.origin[0] - centre[0];
      const dy = g.origin[1] - centre[1];
      const dz = g.origin[2] - centre[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      // Game-hot burst, matched to the game ChunkSystem's hand-tuned spawn
      // (chunks.ts spawnOne): pieces go flying out far, not a soft slump.
      const speed = 5.0 + Math.random() * 4.0;
      const vel: Vec3 = [
        (dx / l) * speed + (Math.random() - 0.5) * 1.2,
        (0.8 + Math.random() * 0.8) * speed * 0.8,
        (dz / l) * speed + (Math.random() - 0.5) * 1.2,
      ];
      spawnChunk(g.limb, g.origin, g.prims, vel, g.tornAt);
    }
    current = next;
    wounds = [];
    view.update(current);
    refreshWounds();
    resetMotion(); // a gibbed body is done shambling — fresh state for whatever spawns next
  }

  // -------------------------------------------------------------------------
  // FPV mode (X1.23): Tab toggles the god-cam ↔ first-person walk; the
  // orchestration lives in ../fpv-mode.ts (pure, unit-tested) and this block
  // owns everything browser-shaped — pointer lock, the input latch, the
  // hands/stick/burst views, the charge-bar HUD, and the gore port that
  // routes each detonation into the EXISTING stack above (pushWound,
  // impulseAt, severLimb/severDistal, gibEverything, chunk velocities, the
  // motion shot signal). Nothing below re-implements gore; it calls it.
  // -------------------------------------------------------------------------
  let fpvMode: FpvModeState = makeFpvMode('god');
  /** The lab floor is 20×20 — the walk bounds are the floor, not the game's
   *  full BALLISTIC arena the bundle still flies (and bounces) inside. */
  const FPV_FLOOR_BOUNDS = { minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 };
  const HAND_REST = buildHandPrims();
  /** The hands' own wound ring — splash stamps from the resolver. */
  let handWounds: Wound[] = [];
  /** Last frame's world-space hand prims — the splash trace target. */
  let lastHandWorld: ReturnType<typeof handPrimsToWorld> = [];
  const handsView = createHandsGpuView(u);
  handsView.object.layers.set(SDF_LAYER);
  handsView.setVisible(false);
  scene.add(handsView.object);
  const stick = createStickProp();
  scene.add(stick.object);
  const burstLayer = createBurstLayer(scene);
  /** Hands A/B toggle — the spec's perf gate is measured both ways. */
  let handsEnabled = true;

  /** The lazy scene reads the resolver evaluates at detonation time. */
  const fpvWorld = {
    heroPosed: () => lastPosed,
    chunks: () => chunks.map(c => ({ id: c.id, pos: c.state.pos })),
    handPrimsWorld: () => lastHandWorld,
  };

  /** One detonation → the existing gore stack, in the click-shoot order. */
  const gorePort: FpvGorePort = {
    stampWounds(ws) {
      for (const w of ws) wounds = pushWound(wounds, w, MAX_WOUNDS);
      refreshWounds();
    },
    // DIRECT meter credit (fpv-mode's contract): freshWounds would weight by
    // PROFILE radius and collapse the zombie from an edge-of-radius graze.
    creditMeter(credit) {
      motionState = {
        ...motionState,
        collapse: {
          ...motionState.collapse,
          meter: Math.min(1, motionState.collapse.meter + credit),
        },
      };
    },
    impulseRig(at, vel) {
      // One frame's displacement from the concussion velocity — the Verlet
      // prev-pos turns it into the launch velocity, and the rest-pose pull
      // (or the collapse ramp) decides how much of it sticks.
      const k = 1 / 30;
      bound = impulseAt(bound, at, [vel[0] * k, vel[1] * k, vel[2] * k]);
    },
    severFullLimbs(limbs) {
      for (const limb of limbs) {
        const { body: next, chunk, stumpWound } = severLimb(current, limb);
        if (chunk.prims.length === 0) continue;
        current = next;
        if (stumpWound) {
          wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
          pendingWounds.push(stumpWound); // stump meter fuel, as click-shoot
        }
        pendingSevered.push(limb);
        spawnChunk(limb, chunk.origin, chunk.prims, undefined,
          [attachPoint(chunk.prims, torsoCentre())]);
        view.update(current);
        refreshWounds();
        rebind();
      }
    },
    applyChainCuts(cuts) {
      for (const cut of cuts) {
        const { body: next, chunk, stumpWound } = severDistal(current, cut);
        if (chunk.prims.length === 0) continue;
        current = next;
        if (stumpWound) {
          wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
          pendingWounds.push(stumpWound);
        }
        pendingSevered.push(cut.limb);
        spawnChunk(cut.limb, chunk.origin, chunk.prims, undefined, chunk.tornAt);
        view.update(current);
        refreshWounds();
        rebind();
      }
    },
    gibBody() { gibEverything(); },
    impulseChunks(list) {
      for (const ci of list) {
        const c = chunks.find(x => x.id === ci.chunkId);
        if (!c) continue;
        c.state = { ...c.state, vel: add(c.state.vel, ci.vel) };
      }
    },
    spawnBurst(v) { burstLayer.spawn(v); },
    stampHandWounds(ws) {
      for (const w of ws) handWounds = pushWound(handWounds, w, MAX_WOUNDS);
    },
    pushShot(shot) { pendingShot = shot; },
  };

  // — Input latch: accumulated between frames, consumed once per frame. —
  let fpvMouseDx = 0;
  let fpvMouseDy = 0;
  const fpvKeys = { forward: false, back: false, left: false, right: false };
  let fpvPress = false;
  let fpvRelease = false;

  /** Charge-bar HUD — a minimal DOM overlay (spec §1: no crosshair needed,
   *  the hands ARE the sight). */
  const chargeWrap = document.createElement('div');
  chargeWrap.style.cssText =
    'position:fixed;left:50%;bottom:11%;transform:translateX(-50%);width:220px;' +
    'height:10px;border:1px solid #f4c98a;background:rgba(0,0,0,0.55);' +
    'display:none;pointer-events:none;z-index:5;';
  const chargeFill = document.createElement('div');
  chargeFill.style.cssText = 'height:100%;width:0%;background:#e8a33d;';
  chargeWrap.appendChild(chargeFill);
  mount.appendChild(chargeWrap);

  function enterFpv() {
    fpvMode = enterFpvMode(fpvMode);
    fpvMouseDx = 0; fpvMouseDy = 0; fpvPress = false; fpvRelease = false;
    handsView.setVisible(handsEnabled);
    fpvBtn.textContent = 'fpv: exit';
    try {
      const p = canvas.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => { /* lock denied — camera still works */ });
      }
    } catch { /* older signature — nothing to await */ }
  }
  function exitFpv() {
    fpvMode = exitFpvMode(fpvMode);
    handsView.setVisible(false);
    chargeWrap.style.display = 'none';
    fpvBtn.textContent = 'fpv: enter';
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  // Losing the lock (Esc, tab switch) exits to the god-cam — the FPV camera
  // without the mouse is a trap, and the god tooling must stay reachable.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && fpvMode.mode === 'fpv') exitFpv();
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && fpvMode.mode === 'fpv') {
      fpvMouseDx += e.movementX;
      fpvMouseDy += e.movementY;
    }
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (fpvMode.mode === 'fpv') exitFpv(); else enterFpv();
      return;
    }
    if (fpvMode.mode !== 'fpv') return;
    if (ev.code === 'KeyW') fpvKeys.forward = true;
    else if (ev.code === 'KeyS') fpvKeys.back = true;
    else if (ev.code === 'KeyA') fpvKeys.left = true;
    else if (ev.code === 'KeyD') fpvKeys.right = true;
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'KeyW') fpvKeys.forward = false;
    else if (ev.code === 'KeyS') fpvKeys.back = false;
    else if (ev.code === 'KeyA') fpvKeys.left = false;
    else if (ev.code === 'KeyD') fpvKeys.right = false;
  });

  // — Charge-bar + readout helpers (frame-side) —
  function updateChargeHud(mode: string, charge: number) {
    const show = mode === 'fpv' && charge > 0.001;
    chargeWrap.style.display = show ? 'block' : 'none';
    if (show) {
      chargeFill.style.width = `${Math.round(charge * 100)}%`;
      // Near the fuse limit the bar goes hot — the overcook warning.
      chargeFill.style.background = charge > 0.85 ? '#e04c2c' : '#e8a33d';
    }
  }

  // Benchmark. Press B.
  // ---------------------------------------------------------------------------
  //
  // Everything about the shape of this is a reaction to how badly the previous
  // measurement setup lied. Three separate faults, all of which produced
  // confident numbers:
  //
  //   1. `renderer.setAnimationLoop` is requestAnimationFrame, which stops dead
  //      when the page is not composited. Automated runs drive the lab from a
  //      browser pane that hides between tool calls, so a fifteen-second sample
  //      window collected under twenty frames.
  //   2. The animation loop's timestamp resolve is fire-and-forget, and with
  //      the cone pre-pass on, ONE frame is three `renderer.render` calls. Which
  //      pass a reading described depended on when the resolve happened to land,
  //      so the same configuration could read like the full march or like the
  //      composite blit alone.
  //   3. A hidden document has no swapchain texture, so the passes do nothing
  //      and resolve to ~0.065 ms. That reads as a 70x speedup.
  //
  // So: hand-driven frames at a fixed timestep, one awaited resolve each, and a
  // hard count of any frame stepped while hidden. A keypress starts it because
  // a keypress is the one trigger that leaves the pane visible.
  let benchRunning = false;

  async function benchGpu({ chunks = 12, chunkFrames = 20, warmup = 40, dt = 1 / 60 } = {}) {
    handle.setLoopRunning(false);
    // Dynamic resolution would move the pixel count mid-run, and pixel count
    // IS the thing being measured. Suspended for the duration rather than
    // merely discouraged.
    const hadAdaptive = adaptiveEnabled;
    adaptiveEnabled = false;
    try {
      let hiddenSteps = 0;
      const step = () => {
        if (document.hidden) hiddenSteps++;
        handle.step(dt);
      };
      for (let i = 0; i < warmup; i++) step();
      await handle.resolveGpu();

      // Wall-clock per frame with the submission queue kept full, NOT the
      // per-pass timestamp.
      //
      // The timestamp route was tried first and swung 13 / 36 / 21 ms across
      // three back-to-back runs of an identical configuration. The cause is
      // the await: resolving after every frame drains the queue, so the GPU
      // goes idle between frames and clocks down, and how far it drops depends
      // on whatever else is compositing at the time. Measuring while
      // deliberately starving the GPU cannot produce a stable number.
      //
      // Submitting a chunk before awaiting keeps the queue full for all but
      // the last frame of each chunk. The resolve at the chunk boundary is
      // what makes the timing honest rather than a measurement of how fast
      // frames can be QUEUED: it does not return until the GPU has finished
      // the work, so the elapsed time covers execution rather than submission.
      const perFrame: number[] = [];
      for (let c = 0; c < chunks; c++) {
        const t0 = performance.now();
        for (let i = 0; i < chunkFrames; i++) step();
        await handle.resolveGpu();
        perFrame.push((performance.now() - t0) / chunkFrames);
      }

      const s = perFrame.sort((a, b) => a - b);
      const at = (q: number) => +s[Math.min(s.length - 1, Math.floor(s.length * q))]!.toFixed(2);
      return {
        bodies: crowd.length + 1,
        n: s.length * chunkFrames,
        median: at(0.5),
        p05: at(0.0),
        p95: at(0.95),
        sdfScale: sdfLayer.scale,
        cone: sdfLayer.coneEnabled,
        lod: lodEnabled,
        hiddenSteps,
        adaptive: hadAdaptive ? 'suspended' : 'off',
      };
    } finally {
      adaptiveEnabled = hadAdaptive;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      handle.setLoopRunning(true);
    }
  }

  /**
   * Runs the benchmark and leaves the result BOTH on screen and on
   * `window.__benchResult`, so it can be read back later from a console call
   * that would itself have hidden the page.
   */
  async function runBench(label = ''): Promise<void> {
    if (benchRunning) return;
    benchRunning = true;
    benchEl.textContent = 'bench: running…';
    try {
      const r = await benchGpu();
      const stamped = r === null ? null : { ...r, label };
      (window as unknown as { __benchResult: unknown }).__benchResult = stamped;
      if (r === null) {
        benchEl.textContent = 'bench: no timestamps';
      } else if (r.hiddenSteps > 0) {
        // Loud, because this is the failure that looks like success.
        benchEl.textContent = `bench: INVALID — ${r.hiddenSteps} hidden frames`;
      } else {
        benchEl.textContent =
          `bench ${r.median} ms (p05 ${r.p05} / p95 ${r.p95}) · ${r.bodies}b · n=${r.n}`;
      }
    } finally {
      benchRunning = false;
    }
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'b' || ev.key === 'B') { void runBench(); return; }
    if (ev.key === ']') { setCrowdCount(crowd.length + 1); return; }
    if (ev.key === '[') { setCrowdCount(Math.max(0, crowd.length - 1)); return; }
    if (ev.key === 'g' || ev.key === 'G') { gibEverything(); return; }
    if (ev.key === 'k' || ev.key === 'K') { forcedCollapse = true; return; }
    const limb = SEVER_KEYS[ev.key];
    if (!limb) return;
    const { body: next, chunk, stumpWound } = severLimb(current, limb);
    if (chunk.prims.length === 0) return;
    current = next;
    if (stumpWound) {
      wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
      pendingWounds.push(stumpWound);
    }
    pendingSevered.push(limb);
    spawnChunk(limb, chunk.origin, chunk.prims, undefined,
      [attachPoint(chunk.prims, torsoCentre())]);
    view.update(current);
    refreshWounds();
    rebind();
  });

  // -------------------------------------------------------------------------
  // Frame loop. setRenderCallback REPLACES rather than appends, so everything
  // per-frame has to live in this one function.
  // -------------------------------------------------------------------------
  const frames: number[] = [];
  let lastStamp = performance.now();

  /** Median of a sample window. The stat to quote — one hitch cannot swing it. */
  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.5)]!;
  }

  /** Every crowd body's current field, as fed to the occluder hull. */
  function crowdBodies() {
    return crowd
      .map(v => bodySource.get(v.object)?.detailed)
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
  }

  // Dynamic resolution. Off by default so every benchmark on this branch stays
  // reproducible — a controller that moves the pixel count mid-run would make
  // the numbers meaningless, which is the exact failure this session spent its
  // first half undoing.
  let adaptiveEnabled = false;
  let adaptiveBudgetMs = 1000 / 60;
  let adaptiveState = initialAdaptiveState(performance.now());
  /**
   * Shorter than the 120-frame display window on purpose. The controller has
   * to notice a camera move into a crowd within a few frames, where the
   * readout wants a stable number to print.
   */
  const ADAPTIVE_WINDOW = 30;

  function tickAdaptive(nowMs: number): void {
    if (!adaptiveEnabled || frames.length < ADAPTIVE_WINDOW) return;
    const next = stepAdaptive(adaptiveState, {
      nowMs,
      medianFrameMs: median(frames.slice(-ADAPTIVE_WINDOW)),
      budgetMs: adaptiveBudgetMs,
    });
    if (next.rung !== adaptiveState.rung) {
      sdfLayer.setScale(scaleForRung(next.rung));
      sizeSdfLayer();
      // The window still holds frames rendered at the OLD scale, and feeding
      // those to the controller again would have it react twice to one event —
      // straight into the oscillation this ladder exists to avoid.
      frames.length = 0;
    }
    adaptiveState = next;
  }

  handle.setRenderCallback((dt) => {
    const now = performance.now();
    frames.push(now - lastStamp);
    lastStamp = now;
    if (frames.length > 120) frames.shift();
    if (frames.length > 20) {
      const s = [...frames].sort((a, b) => a - b);
      const med = s[Math.floor(s.length * 0.5)]!;
      const p95 = s[Math.floor(s.length * 0.95)]!;
      fpsEl.textContent =
        `cpu+gpu ${med.toFixed(1)} / ${p95.toFixed(1)} ms  (${(1000 / med).toFixed(0)} fps)`;
    }

    tickAdaptive(now);

    // — FPV step (X1.23): controller + flight + detonation + hands, FIRST so
    //    a detonation's wounds/severs/impulses flow through the motion, rig
    //    and pose code below exactly like any other hit this frame. The
    //    gore port routes the bundle into the existing stack; nothing here
    //    re-implements it. —
    const fpvInput = fpvMode.mode === 'fpv'
      ? {
          dx: fpvMouseDx, dy: fpvMouseDy,
          forward: fpvKeys.forward, back: fpvKeys.back,
          left: fpvKeys.left, right: fpvKeys.right,
          press: fpvPress, release: fpvRelease,
        }
      : EMPTY_FPV_INPUT;
    fpvMouseDx = 0; fpvMouseDy = 0; fpvPress = false; fpvRelease = false;
    const fpvNow = now / 1000;
    const fpvStep = stepFpvMode(
      fpvMode, fpvInput, dt, fpvNow, fpvWorld, gorePort, FPV_FLOOR_BOUNDS);
    fpvMode = fpvStep.state;
    const ff = fpvStep.frame;

    // Hands: the pure pose + jiggle landed in fpvMode; march the world-space
    // prims (also the splash target for the next detonation).
    let posedLocalHands: ReturnType<typeof posedHandPrims> | null = null;
    if (ff.mode === 'fpv') {
      posedLocalHands = posedHandPrims(HAND_REST, ff.handPose, fpvMode.jiggle);
      lastHandWorld = handPrimsToWorld(posedLocalHands, ff.eye, ff.yaw, ff.pitch);
      if (handsEnabled) {
        handsView.update(lastHandWorld, handWounds);
        handsView.setVisible(true);
      } else {
        handsView.setVisible(false);
      }
    } else {
      handsView.setVisible(false);
    }
    updateChargeHud(ff.mode, ff.charge);
    if (fpvReadEl) {
      fpvReadEl.textContent = ff.mode === 'fpv'
        ? `charge ${(ff.charge * 100).toFixed(0)}% · ${ff.flight ? 'bundle away' : 'hands full'} · hand wounds ${handWounds.length}`
        : `god · ${ff.flight ? 'bundle away' : 'idle'} · bursts ${burstLayer.usingAtlas ? 'seq' : 'proc'}`;
    }

    // Gib physics: step every chunk, then re-pack its world-space field.
    // dt clamped like the rig's: a hidden tab pausing rAF must not integrate
    // the whole gap in one ballistic step and teleport every chunk.
    for (const c of chunks) {
      c.state = stepChunk(c.state, Math.min(dt, 1 / 30));
      c.view.update(c.state);
    }

    // Blood: every flying chunk trails droplets, the sim settles them into
    // splats, and the instanced view re-poses from sim state. Same dt clamp —
    // a hidden tab must not integrate the whole gap in one ballistic step.
    const bdt = Math.min(dt, 1 / 30);
    emitTrails(
      bloodSim,
      chunks.map(c => ({ id: c.id, pos: c.state.pos, vel: c.state.vel })),
      bdt, Math.random);
    stepBlood(bloodSim, bdt, Math.random);
    bloodView.sync(bloodSim, camera);
    // The goo density quads pose from the same sim state, in the callback
    // (before the drawFn) — same contract as bloodView.sync.
    gooLayer.sync(bloodSim, camera);

    // Drive the flesh. With motion on, the orchestrator composes wander +
    // gait + stagger into per-point rest targets, IK locks the stance feet /
    // aims the head / presses the wound, then stepRig integrates toward them
    // exactly as before — the rig stays the single motion authority. A
    // collapse ramps the rest pull off, swaps in full gravity, adds the
    // one-sided rope limits and chunk-stepper floor contact, and the corpse
    // keeps rendering through the same posed-prims path (still shootable,
    // severable, gibbable — it is just horizontal now).
    const rdt = Math.min(dt, 1 / 30);
    if (motionEnabled && motionJoints) {
      // Sub-stepped integration (X1.22.1): consume the frame's real elapsed
      // time in ≤1/30-sized steps instead of the old flat 33 ms clamp, so a
      // stalled or hidden frame cannot stretch the fall into a death spiral.
      // See planSubSteps for the catch-up bound.
      let f: ReturnType<typeof stepMotion>['frame'] | null = null;
      let first = true;
      for (const sdt of planSubSteps(dt)) {
        const step = stepMotion(
          motionState, motionJoints, { enabled: true, wander: wanderOn },
          {
            dt: sdt,
            shot: pendingShot,
            wounded: woundedLimbs(),
            severed: pendingSevered,
            missing: missingLimbs(),
            headAlive: current.clusters.find(c => c.limb === 'head')?.alive ?? false,
            forcedCollapse,
            freshWounds: pendingWounds,
          },
          bound.rig.points, WANDER_BOUNDS, motionRng,
        );
        motionState = step.state;
        f = step.frame;
        // Signals drain after the FIRST sub-step: they describe events that
        // landed before this frame, not per-sub-step re-triggers.
        if (first) {
          first = false;
          pendingShot = null;
          pendingWounds.length = 0;
          pendingSevered.length = 0;
          forcedCollapse = false;
        }
        lastRootShift = f.rootShift;
        // Noise anchor (motion-polish): the march's fbm rides the body's root
        // translation so the skin texture does not swim while walking.
        view.setRootShift(f.rootShift[0], f.rootShift[2]);

        let points = stepRig(
          { ...bound.rig, restPose: f.restPose }, sdt,
          {
            gravity: f.gravity,
            damping: 0.06,
            iterations: 4,
            restStiffness: STANDING_RIG.restStiffness * f.restPull,
          },
        ).points;
        if (f.ropes.length) points = relaxRopeConstraints(points, f.ropes);
        if (f.collapsed) {
          points = applyFloorContact(points, motionJoints.groundY - MOTION_TUNING.floorPad);
        }
        bound = {
          ...bound,
          rig: { points, constraints: bound.rig.constraints, restPose: f.restPose },
        };
      }
      if (f) {
        if (motionReadEl) {
          motionReadEl.textContent =
            `meter ${f.meter.toFixed(2)} · ${f.phase}${f.hop ? ' · hop' : ''}` +
            (f.staggerKind ? ` · ${f.staggerKind}` : '') +
            (f.clutchArm ? ` · clutch ${f.clutchArm}` : '');
        }
        // Keep the shambler framed: the orbit target drifts after the body
        // (fast enough to follow a walk, slow enough to leave the orbit feel).
        if (!f.collapsed) {
          const k = Math.min(1, dt * 2.2);
          camTarget.x += (f.rootShift[0] - camTarget.x) * k;
          camTarget.z += (f.rootShift[2] - camTarget.z) * k;
        }
      }
    } else {
      // Statue mode — the pre-motion behaviour, verbatim. Pending signals
      // still drain so a re-enable can't fire a stale shot.
      pendingShot = null;
      pendingWounds.length = 0;
      pendingSevered.length = 0;
      forcedCollapse = false;
      bound = {
        ...bound,
        rig: stepRig(bound.rig, rdt, {
          gravity: [0, -2.2, 0],
          damping: 0.06,
          iterations: 4,
          restStiffness: 0.18,
        }),
      };
      view.setRootShift(0, 0); // statue: world-anchored noise, as before
    }
    const posed = applyRig(current, bound);
    lastPosed = posed;
    view.update(posed);
    if (sdfLayer.occluderEnabled) occluderHull.update([posed, ...crowdBodies()], woundSpheres(posed.prims));
    view.setTime(performance.now() / 1000);
    // Re-derive the skull's sphere from the POSED primitives so the face
    // projection tracks the head through the jiggle — and hand it the rigid
    // head rotation so the PAINTED face rotates with the skull masses
    // instead of staying camera-front (owner playtest: eyes/brow sliding,
    // nose mass out the ear).
    const skull = headShape(posed);
    if (skull) view.setHeadShape(skull.centre, skull.axes);
    view.setHeadRotation(headQuatOf(bound) ?? [0, 0, 0, 1]);
    uploadWounds(posed.prims);

    if (ff.mode === 'fpv') {
      // First-person camera: eye from the controller, aim from yaw/pitch,
      // plus the detonation kick as a roll/pitch deflection.
      camera.position.set(ff.eye[0], ff.eye[1], ff.eye[2]);
      const p = ff.pitch + ff.kick.pitch;
      const cp = Math.cos(p);
      camera.lookAt(
        ff.eye[0] + Math.sin(ff.yaw) * cp,
        ff.eye[1] + Math.sin(p),
        ff.eye[2] - Math.cos(ff.yaw) * cp,
      );
      camera.rotateZ(ff.kick.roll);
    } else {
      if (autoSpin) camYaw += dt * 0.35;
      const cp = Math.cos(camPitch);
      camera.position.set(
        camTarget.x + Math.sin(camYaw) * cp * camDist,
        camTarget.y + Math.sin(camPitch) * camDist,
        camTarget.z + Math.cos(camYaw) * cp * camDist,
      );
      camera.lookAt(camTarget);
    }

    // Stick prop: ballistic once thrown (visible in god mode too — a
    // spectator watches the arc), held in the lead hand between throws.
    if (ff.flight) {
      stick.pose({ mode: 'flight', pos: ff.flight.pos, spin: ff.flight.spin, fuseBurning: true });
      stick.flicker(fpvNow, false);
    } else if (ff.mode === 'fpv' && handsEnabled && posedLocalHands
      && (ff.handPhase.phase === 'idle'
        || ff.handPhase.phase === 'light' || ff.handPhase.phase === 'cook')) {
      const m = posedLocalHands.right[3]!; // lead mitten grips the bundle
      stick.pose({
        mode: 'hand',
        localPos: [
          (m.a[0] + m.b[0]) / 2,
          (m.a[1] + m.b[1]) / 2 + 0.05,
          (m.a[2] + m.b[2]) / 2,
        ],
        camQuat: camera.quaternion,
        cooking: ff.handPhase.phase === 'cook',
      });
      stick.flicker(fpvNow, ff.handPhase.phase === 'cook');
    } else {
      stick.pose({ mode: 'gone' });
    }
    burstLayer.update(dt, camera);

    // LOD last: the camera has just moved, and every lever it drives is a
    // uniform the steps above may have written. Running it earlier would pick
    // levels against the previous frame's camera and then get overwritten.
    applyLod(view);
    for (const v of crowd) applyLod(v);
  });

  // -------------------------------------------------------------------------
  // Tuning panel
  // -------------------------------------------------------------------------
  function reapply() {
    view.applyMaterial(flesh, LIGHT_PRESETS[light]);
    for (const v of crowd) v.applyMaterial(flesh, LIGHT_PRESETS[light]);
  }

  function rebuildBody() {
    override = { ...override, faceParams: face };
    saveOverride(override);
    current = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
    showErrors(current);
    view.update(current);
    refreshWounds();
    rebind();
    resetMotion(); // a rebuilt body is a new shambler, not a pose transfer
  }

  const presetBox = addSection(panelEl, 'presets');
  addSelect(presetBox, 'flesh', Object.keys(FLESH_PRESETS), 'henenlotter-latex', (v) => {
    flesh = { ...FLESH_PRESETS[v as FleshPresetName] };
    reapply();
    rebuildMaterialSliders();
  });
  addSelect(presetBox, 'light', Object.keys(LIGHT_PRESETS), light, (v) => {
    light = v as LightPresetName;
    reapply();
  });

  const matBox = addSection(panelEl, 'material');
  function rebuildMaterialSliders() {
    matBox.textContent = '';
    for (const s of MATERIAL_SLIDERS)
      addSlider(matBox, {
        label: s.key, min: s.min, max: s.max, step: 0.005,
        get: () => flesh[s.key] as number,
        set: (v) => { (flesh[s.key] as number) = v; reapply(); },
      });
  }
  rebuildMaterialSliders();

  const bodyBox = addSection(panelEl, 'body');
  addSlider(bodyBox, {
    label: 'global blendK', min: 0.004, max: 0.05, step: 0.001,
    get: () => current.prims[0]?.blendK ?? 0.012,
    set: (v) => {
      override = { ...override, primBlendK: Object.fromEntries(current.prims.map((_, i) => [i, v])) };
      rebuildBody();
    },
  });
  addSlider(bodyBox, {
    // Forces the count on every body, LOD included — otherwise applyLod would
    // overwrite the slider on the very next frame.
    label: 'march steps (0 = lod)', min: 0, max: 192, step: 1,
    get: () => stepsOverride ?? 0,
    set: (v) => { stepsOverride = v > 0 ? v : null; },
  });

  // Face. Sliders regenerate the face primitives and rebuild the body, so a
  // param change alters which primitives exist rather than just their values.
  const faceBox = addSection(panelEl, 'face');
  // The shape sliders live in their own box so switching preset can rebuild
  // them in place — otherwise they keep showing the previous head's numbers.
  const faceSliderBox = document.createElement('div');
  faceBox.appendChild(faceSliderBox);
  function rebuildFaceSliders() {
    faceSliderBox.textContent = '';
    for (const s of FACE_SLIDERS)
      addSlider(faceSliderBox, {
        label: s.key, min: s.min, max: s.max, step: 0.001,
        get: () => face[s.key],
        set: (v) => { (face[s.key] as number) = v; rebuildBody(); },
      });
  }
  rebuildFaceSliders();

  // Head SHAPE, as distinct from the face sheet below. The sheet is shared by
  // every zombie; the skull is the only thing that can differ between them.
  addSelect(faceBox, 'head shape', Object.keys(FACE_PRESETS), 'gaunt', (v) => {
    Object.assign(face, FACE_PRESETS[v]!);
    rebuildBody();
    rebuildFaceSliders();
  });
  addSelect(faceBox, 'texture', Object.keys(FACE_TEXTURES), faceTexName, (v) => {
    faceTexName = v as FaceTexName;
    loadFaceTexture(faceTexName);
  });
  const texBtn = addButton(faceBox, 'face tex: on', () => {
    // Goes through faceEnabled rather than the uniform, because applyLod
    // rewrites faceCfg.x every frame and would undo a direct poke.
    faceEnabled = !faceEnabled;
    texBtn.textContent = `face tex: ${faceEnabled ? 'on' : 'off'}`;
  });

  // Alignment. The projection is planar in head space, so these four numbers
  // are how the texture gets registered onto the skull.
  addSlider(faceBox, {
    label: 'eyeGlow', min: 0, max: 6, step: 0.05,
    get: () => u.faceCfg2.value.w, set: (v) => { u.faceCfg2.value.w = v; },
  });
  addSlider(faceBox, {
    // Which pixels count as eyes. Lower catches more of the sheet, so teeth and
    // highlights start glowing too.
    label: 'eyeGlowCut', min: 0.3, max: 1, step: 0.01,
    get: () => u.faceCfg2.value.z, set: (v) => { u.faceCfg2.value.z = v; },
  });
  addSlider(faceBox, {
    label: 'texRelief', min: 0, max: 5, step: 0.05,
    get: () => u.faceCfg.value.w, set: (v) => { u.faceCfg.value.w = v; },
  });
  addSlider(faceBox, {
    label: 'texStrength', min: 0, max: 1, step: 0.01,
    get: () => u.faceCfg.value.y, set: (v) => { u.faceCfg.value.y = v; },
  });
  addSlider(faceBox, {
    label: 'texScaleX', min: 0.4, max: 2.5, step: 0.01,
    get: () => u.faceProj.value.x, set: (v) => { u.faceProj.value.x = v; },
  });
  addSlider(faceBox, {
    label: 'texScaleY', min: 0.4, max: 2.5, step: 0.01,
    get: () => u.faceProj.value.y, set: (v) => { u.faceProj.value.y = v; },
  });
  addSlider(faceBox, {
    label: 'texCentreY', min: 0.2, max: 0.9, step: 0.01,
    get: () => u.faceProj.value.w, set: (v) => { u.faceProj.value.w = v; },
  });
  // Spherical spreads longitude evenly round the skull, so it needs a wider
  // scale than planar to put the face in the same place — swap the scales with
  // the mode rather than making you retune by hand.
  const projBtn = addButton(faceBox, 'proj: planar', () => {
    const spherical = u.faceCfg2.value.x < 0.5;
    u.faceCfg2.value.x = spherical ? 1 : 0;
    u.faceProj.value.set(spherical ? 1.35 : 0.45, spherical ? 1.05 : 0.58, 0.5, spherical ? 0.5 : 0.56);
    projBtn.textContent = `proj: ${spherical ? 'spherical' : 'planar'}`;
  });
  addButton(faceBox, 'flip facing', () => { u.faceCfg.value.z = -u.faceCfg.value.z; });

  /** Locked three-quarter close-up on the skull, so face work needs no orbiting. */
  function focusHead() {
    // POSED centre: with wander the authored skull position is behind the
    // camera, not in front of it.
    const c = lastPosed.clusters.find(cl => cl.limb === 'head')?.center;
    autoSpin = false;
    camTarget.set(c?.[0] ?? 0, c?.[1] ?? 1.55, c?.[2] ?? 0);
    camYaw = 0.62;
    camPitch = 0.06;
    camDist = 0.52;
  }
  function focusBody() {
    const c = torsoCentre(lastPosed);
    autoSpin = false;
    camTarget.set(c[0], 1.05, c[2]);
    camYaw = 0.35;
    camPitch = 0.12;
    camDist = 2.4;
  }
  addButton(faceBox, 'focus head', focusHead);
  addButton(faceBox, 'focus body', focusBody);

  // Crater shape. Kept out of FleshMaterial because these describe damage
  // GEOMETRY, not the surface — they change the field, not the shading.
  const dmgBox = addSection(panelEl, 'damage');
  for (const [get, set, label, min, max] of [
    [() => u.woundCfg.value.y, (v: number) => { u.woundCfg.value.y = v; }, 'wound blendK', 0.002, 0.06],
    [() => u.woundCfg.value.z, (v: number) => { u.woundCfg.value.z = v; }, 'rim splay', 0, 1.5],
    [() => u.woundCfg.value.w, (v: number) => { u.woundCfg.value.w = v; }, 'rim offset', 0.8, 2.0],
    [() => u.woundCfg2.value.x, (v: number) => { u.woundCfg2.value.x = v; }, 'rim width', 0.15, 1.2],
  ] as [() => number, (v: number) => void, string, number, number][])
    addSlider(dmgBox, { label, min, max, step: 0.005, get, set });

  // LOD. The overrides exist so each lever can be measured ALONE against the
  // same full-quality baseline — a lever measured while another is already off
  // reports the wrong number, and these are close enough in cost to matter.
  const lodBox = addSection(panelEl, 'lod');
  addSlider(lodBox, {
    // The single biggest lever measured: cost is close to linear in pixels, so
    // 0.5 here is ~4x on the raymarch. Level geometry stays full resolution.
    label: 'sdf resolution', min: 0.25, max: 1, step: 0.05,
    get: () => sdfLayer.scale,
    set: (v) => { sdfLayer.setScale(v); sizeSdfLayer(); },
  });
  // Dynamic resolution. Drives the slider above from the measured frame time
  // rather than by hand — the answer to "why does zooming IN get slower when
  // there is LESS on screen", which is that cost is per covered pixel.
  const adaptBtn = addButton(lodBox, 'adaptive res: off', () => {
    adaptiveEnabled = !adaptiveEnabled;
    adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
    adaptBtn.textContent = `adaptive res: ${adaptiveEnabled ? 'on' : 'off'}`;
  });
  addSlider(lodBox, {
    label: 'adaptive budget ms', min: 8, max: 40, step: 0.1,
    get: () => adaptiveBudgetMs,
    set: (v) => { adaptiveBudgetMs = v; },
  });
  const lodBtn = addButton(lodBox, 'lod: off', () => {
    lodEnabled = !lodEnabled;
    lodBtn.textContent = `lod: ${lodEnabled ? 'on' : 'off'}`;
  });
  for (const k of LOD_LEVERS) {
    const btn = addButton(lodBox, `${k}: auto`, () => {
      // auto -> forced off -> forced on -> auto
      const cur = lodOverride[k];
      lodOverride[k] = cur === undefined || cur === null ? false : cur === false ? true : null;
      const label = lodOverride[k] === null || lodOverride[k] === undefined
        ? 'auto' : lodOverride[k] ? 'ON' : 'OFF';
      btn.textContent = `${k}: ${label}`;
    });
  }

  const simpBtn = addButton(lodBox, 'simplify: auto', () => {
    simplifyOverride = simplifyOverride === null ? true : simplifyOverride ? false : null;
    simpBtn.textContent =
      `simplify: ${simplifyOverride === null ? 'auto' : simplifyOverride ? 'ON' : 'OFF'}`;
  });

  const shellBtn = addButton(
    lodBox, `shell silhouette: ${shellSilhouette ? 'on' : 'off'}`,
    () => setShellDisplace(!shellSilhouette));

  // Legacy gamma (lodCfg.y): flesh presets were tuned against the WebGL lab's
  // missing output encode; ON cancels this path's sRGB encode so they read as
  // tuned. OFF shows the honest chain — the X1.3 retune target. Same
  // hero+crowd fan-out as setShellDisplace; chunks copy lodCfg at spawn.
  let legacyGamma = true;
  const gammaBtn = addButton(
    lodBox, 'legacy gamma: on',
    () => setLegacyGamma(!legacyGamma));
  function setLegacyGamma(on: boolean) {
    legacyGamma = on;
    for (const x of [view, ...crowd]) x.uniforms.lodCfg.value.y = on ? 1 : 0;
    gooLayer.setLegacyGamma(on);
    gammaBtn.textContent = `legacy gamma: ${on ? 'on' : 'off'}`;
  }
  /**
   * Wires shell displacement (woundCfg2.z) through the hero AND the crowd:
   * crowd views own their uniform set, and the bench gate is a 10-body
   * measurement, so a hero-only toggle is no measurement — same shape as
   * setSilhouetteNoise. Chunk views copy woundCfg2 from the hero template at
   * spawn, so chunks cut after this inherit the setting for free;
   * pre-existing chunks keep their spawn-time value (ChunkGpuView exposes no
   * uniforms), which is fine — they are airborne for seconds at most.
   */
  function setShellDisplace(on: boolean) {
    shellSilhouette = on;
    for (const x of [view, ...crowd]) x.uniforms.woundCfg2.value.z = on ? SHELL_AMP : 0;
    shellBtn.textContent = `shell silhouette: ${on ? 'on' : 'off'}`;
  }

  // Metaball blood (gobs-and-goo task 5 + the X1.21.1 blur). The three
  // knobs that shape the surface: where the density field becomes goo, how
  // wide the soft band between bare and full-blood is (as a multiple of the
  // threshold), and how far the separable Gaussian blurs the density field
  // before the surface extracts it (0 = bypass — beaded pearls return).
  const gooBox = addSection(panelEl, 'goo');
  addSlider(gooBox, {
    label: 'goo threshold', min: 0.1, max: 0.95, step: 0.01,
    get: () => gooLayer.threshold,
    set: (v) => { gooLayer.setThreshold(v); },
  });
  addSlider(gooBox, {
    label: 'goo edge', min: 1.05, max: 3, step: 0.05,
    get: () => gooLayer.edge,
    set: (v) => { gooLayer.setEdge(v); },
  });
  addSlider(gooBox, {
    label: 'goo blur px', min: 0, max: 5, step: 0.5,
    get: () => gooLayer.blurPx,
    set: (v) => { gooLayer.setBlurPx(v); },
  });

  // Motion (X1.22): master + wander toggles, the forced-collapse hook for
  // the K key's panel twin, and the live damage-meter readout.
  const motionBox = addSection(panelEl, 'motion');
  const motionBtn = addButton(motionBox, `motion: ${motionEnabled ? 'on' : 'off'}`, () => {
    setMotionEnabled(!motionEnabled);
  });
  const wanderBtn = addButton(motionBox, `wander: ${wanderOn ? 'on' : 'off'}`, () => {
    setWander(!wanderOn);
  });
  addButton(motionBox, 'force collapse', () => { forcedCollapse = true; });
  motionReadEl = document.createElement('div');
  motionReadEl.style.cssText = 'font:11px monospace;color:#9c9;';
  motionBox.appendChild(motionReadEl);

  // FPV (X1.23): enter/exit (Tab is the keyboard twin), the hands A/B
  // toggle the spec's perf gate needs, and a live readout.
  const fpvBox = addSection(panelEl, 'fpv');
  const fpvBtn = addButton(fpvBox, 'fpv: enter', () => {
    if (fpvMode.mode === 'fpv') exitFpv(); else enterFpv();
  });
  const handsBtn = addButton(fpvBox, `hands: ${handsEnabled ? 'on' : 'off'}`, () => {
    setFpvHands(!handsEnabled);
  });
  function setFpvHands(on: boolean) {
    handsEnabled = on;
    if (fpvMode.mode === 'fpv') handsView.setVisible(on);
    handsBtn.textContent = `hands: ${on ? 'on' : 'off'}`;
  }
  fpvReadEl = document.createElement('div');
  fpvReadEl.style.cssText = 'font:11px monospace;color:#9c9;';
  fpvBox.appendChild(fpvReadEl);

  /** Motion master. Off = the pre-X1.22 statue loop, verbatim. On = a fresh
   *  shambler from the origin. */
  function setMotionEnabled(on: boolean) {
    motionEnabled = on;
    if (on) {
      resetMotion();
    } else if (motionJoints) {
      // Statue at wherever the body ended up, in its authored pose — not
      // frozen mid-stride, and not snapped back to the origin either.
      bound = {
        ...bound,
        rig: {
          ...bound.rig,
          restPose: motionJoints.base.map(
            v => [v[0] + lastRootShift[0], v[1], v[2] + lastRootShift[2]] as Vec3),
        },
      };
      camTarget.x = lastRootShift[0];
      camTarget.z = lastRootShift[2];
    }
    motionBtn.textContent = `motion: ${on ? 'on' : 'off'}`;
  }
  /** Wander toggle — locomotion only; hit reactions stay live either way. */
  function setWander(on: boolean) {
    wanderOn = on;
    wanderBtn.textContent = `wander: ${on ? 'on' : 'off'}`;
  }

  const actionBox = addSection(panelEl, 'actions');
  addButton(actionBox, 'respawn', () => {
    wounds = [];
    override = loadOverride();
    rebuildBody();
  });
  addButton(actionBox, 'copy override JSON', () => {
    void navigator.clipboard.writeText(serializeOverride(override));
  });
  addButton(actionBox, 'reset overrides', () => {
    clearOverride();
    override = {};
    rebuildBody();
  });

  reapply();

  // Dev handle for inspecting lab state from the console, and for driving the
  // camera during automated visual checks. Lab-only; nothing in the game reads it.
  (window as unknown as { __sdfLab: unknown }).__sdfLab = {
    backend: handle.backend,
    /**
     * The renderer, scene and camera — enough to call
     * `renderer.debug.getShaderAsync(scene, camera, mesh)` and read the WGSL
     * three actually generated. That is the only way to see what the node
     * pipeline wrapped around the march, output colour-space encode included.
     */
    renderer: handle.renderer,
    scene,
    camera,
    body: view.object,
    get wounds() { return wounds; },
    get current() { return current; },
    get chunkCount() { return chunks.length; },
    get bodyCount() { return crowd.length + 1; },
    /** The march uniforms — lets any of them be tuned live from the console. */
    uniforms: u,
    /** The SDF layer — occluder/cone toggles for A/B experiments. */
    sdfLayer,
    /**
     * The metaball blood layer — threshold/edge/blur setters for console
     * tuning, mirroring the panel's goo section (which reaches only the
     * same three).
     */
    gooLayer: {
      setThreshold: (v: number) => gooLayer.setThreshold(v),
      setEdge: (v: number) => gooLayer.setEdge(v),
      setBlurPx: (v: number) => gooLayer.setBlurPx(v),
      get threshold() { return gooLayer.threshold; },
      get edge() { return gooLayer.edge; },
      get blurPx() { return gooLayer.blurPx; },
    },
    /**
     * Stamps n blast wounds on the front of the torso by raycasting
     * straight-on — a deterministic heavy-damage state for automated visual
     * checks, with no pointer events or camera dependence involved.
     */
    stampWounds(n: number) {
      const c = torsoCentre(lastPosed);
      for (let i = 0; i < n; i++) {
        const ox = ((i % 3) - 1) * 0.06;
        const oy = Math.floor(i / 3) * 0.07 - 0.05;
        const hit = raycastBody([c[0] + ox, c[1] + oy, c[2] + 3], [0, 0, -1], lastPosed);
        if (!hit) continue;
        const w = worldHitToWound(
          lastPosed.prims, hit, WOUND_PROFILES.blast.radius, 'blast');
        wounds = pushWound(wounds, w, MAX_WOUNDS);
        pendingWounds.push(w); // stamped blasts feed the damage meter too
      }
      refreshWounds();
    },
    setCrowdCount,
    gibEverything,
    /** The respawn button's console twin — a fresh body AND a fresh shambler.
     *  resetMotion alone re-binds the rig of whatever body is current, which
     *  for a gibbed corpse is a body-shaped nothing. */
    respawn() {
      wounds = [];
      override = loadOverride();
      rebuildBody();
    },
    focusHead,
    focusBody,
    /**
     * Median/p95 wall-clock frame time and median GPU pass time, in ms.
     *
     * Quote `gpu` for anything perf-related: wall clock pins to vsync as soon
     * as there is headroom, so below ~16 ms it stops measuring the renderer.
     */
    stats() {
      const s = [...frames].sort((a, b) => a - b);
      return s.length < 20 ? null : {
        median: +s[Math.floor(s.length * 0.5)]!.toFixed(2),
        p95: +s[Math.floor(s.length * 0.95)]!.toFixed(2),
        bodies: crowd.length + 1,
      };
    },
    /** Drops the sample window, so a reading cannot include the old setting. */
    resetStats() { frames.length = 0; },
    /**
     * The measurement to quote. Takes the frame clock away from
     * requestAnimationFrame and drives `frameCount` frames by hand, awaiting
     * the timestamp resolve after each one.
     *
     * Two reasons this exists rather than reading `stats()`:
     *
     * 1. **rAF stops when the page is not composited.** Automated runs live in
     *    a browser pane that hides between tool calls, so a rAF sample window
     *    collects single-digit frames over fifteen seconds — `stats()` returns
     *    null and the on-screen median is whatever the last burst happened to
     *    hit. Every absolute measured that way is noise.
     * 2. **Awaiting each resolve serialises the frames.** In the animation loop
     *    the resolve is fire-and-forget and frames overlap, so a reading may
     *    belong to a frame two behind the current settings. Here each pass is
     *    measured in isolation, which is what makes A/B comparisons stable.
     *
     * The timestep is FIXED rather than measured, so the rig integrates
     * identically on every run and the pose sequence is reproducible.
     *
     * MUST BE RUN ON A VISIBLE PAGE — press B rather than calling this from a
     * console that hides the pane. A hidden document has no swapchain texture
     * to draw into, so every pass resolves to ~0.065 ms of nothing and the
     * median looks like a spectacular win. `hiddenSteps` records how many
     * frames were stepped while hidden precisely so that failure cannot be
     * quoted as a result; a run with any is discarded by the caller.
     */
    benchGpu,
    /** Same run the B key starts; result also lands on `window.__benchResult`. */
    runBench,
    setLodEnabled(on: boolean) { lodEnabled = on; },
    /** X1.22 rig motion — the whole pipeline's state peek. */
    get motion() {
      return {
        enabled: motionEnabled,
        wander: wanderOn,
        phase: motionState.collapse.phase,
        meter: motionState.collapse.meter,
        hop: motionState.collapse.phase === 'standing'
          && (missingLimbs().legL !== missingLimbs().legR),
        stagger: motionState.stagger.kind,
        clutch: motionState.clutch.arm,
        heading: motionState.wander.heading,
        pos: motionState.wander.pos as unknown as number[],
        speed: motionState.wander.speed,
        blend: motionState.blend,
        rootShift: lastRootShift as unknown as number[],
      };
    },
    /** Locomotion toggle — gait/stagger/IK stay live regardless. */
    setWander,
    /** Motion master toggle — off is the pre-X1.22 statue. */
    setMotionEnabled,
    // — X1.23 FPV + dynamite ——————————————————————
    /** The panel button's console twin: god-cam ↔ first-person. */
    enterFpv,
    exitFpv,
    /** Automation throw: releases a bundle at `charge` (0..1) from the
     *  stored FPV aim without the hold loop. Works in god mode too. */
    throwDynamite(charge = 1) {
      fpvMode = forceThrow(
        fpvMode, Math.max(0, Math.min(1, charge)), performance.now() / 1000);
    },
    /** Hard-sets the FPV aim/position (metres, radians) — deterministic
     *  throws for automated checks; the pointer-lock mouse can drift between
     *  scripted steps and this pins the launch state. */
    setFpvAim(opts: { yaw?: number; pitch?: number; pos?: number[] } = {}) {
      fpvMode = {
        ...fpvMode,
        fpv: {
          ...fpvMode.fpv,
          yaw: opts.yaw ?? fpvMode.fpv.yaw,
          pitch: opts.pitch ?? fpvMode.fpv.pitch,
          pos: opts.pos ? [opts.pos[0] ?? 0, 0, opts.pos[2] ?? 0] : fpvMode.fpv.pos,
        },
      };
    },
    /** Hands A/B — the spec's perf gate is benchGpu with hands on vs off. */
    setFpvHands,
    get fpv() {
      return {
        mode: fpvMode.mode,
        pos: fpvMode.fpv.pos as unknown as number[],
        yaw: fpvMode.fpv.yaw,
        pitch: fpvMode.fpv.pitch,
        cookPhase: fpvMode.fpv.cook.phase,
        charge: cookCharge(fpvMode.fpv, performance.now() / 1000),
        flightPos: (fpvMode.flight?.pos ?? null) as number[] | null,
        handWounds: handWounds.length,
        handsEnabled,
        burstsUseAtlas: burstLayer.usingAtlas,
      };
    },
    /** The K key's console twin: forces the collapse next frame. */
    forceCollapse() { forcedCollapse = true; },
    /** Shell-displacement silhouettes on every live body view. */
    setShellDisplace,
    setLegacyGamma,
    get shellDisplace() { return shellSilhouette; },
    /** null = let LOD decide; true/false force the lever on every body. */
    setOverride(k: LodLever, v: boolean | null) { lodOverride[k] = v; },
    setStepsOverride(v: number | null) { stepsOverride = v; },
    /** Sphere-trace step multiplier on every body. Default 0.6. */
    setStepMul(v: number) { for (const x of [view, ...crowd]) x.uniforms.marchCfg.value.y = v; },
    /**
     * Silhouette noise amplitude on every body, crowd included. The panel
     * slider reaches only the hero, which is no use for a crowd measurement.
     */
    setSilhouetteNoise(v: number) { for (const x of [view, ...crowd]) x.uniforms.marchCfg.value.z = v; },
    /** Over-relaxation factor; <= 1 disables the relaxed tracer. */
    setRelax(v: number) { for (const x of [view, ...crowd]) x.uniforms.woundCfg2.value.y = v; },
    /** 1 = full resolution for the raymarched layer, 0.5 = quarter the pixels. */
    setSdfScale(v: number) { sdfLayer.setScale(v); sizeSdfLayer(); },
    /** Dynamic resolution: drives the SDF scale to hold the frame budget. */
    setAdaptive(on: boolean) {
      adaptiveEnabled = on;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      adaptBtn.textContent = `adaptive res: ${on ? 'on' : 'off'}`;
    },
    setAdaptiveBudget(ms: number) { adaptiveBudgetMs = ms; },
    get adaptive() {
      return {
        enabled: adaptiveEnabled,
        budgetMs: adaptiveBudgetMs,
        rung: adaptiveState.rung,
        scale: scaleForRung(adaptiveState.rung),
        probeIntervalMs: adaptiveState.probeIntervalMs,
      };
    },
    get sdfScale() { return sdfLayer.scale; },
    setSdfFlipY(on: boolean) { sdfLayer.setFlipY(on); },
    setConeEnabled(on: boolean) { sdfLayer.setConeEnabled(on); },
    /**
     * Occluder inner-hull pre-pass. Lets every ray stop where something solid
     * already covers it — see occluder-hull.ts for why that is safe.
     */
    setOccluder(on: boolean) {
      sdfLayer.setOccluderEnabled(on);
      // Populate immediately rather than waiting a frame: a benchmark started
      // in the same tick would otherwise measure an EMPTY hull and read as a
      // free win.
      if (on) {
        const posed = applyRig(current, bound);
        occluderHull.update([posed, ...crowdBodies()], woundSpheres(posed.prims));
      }
    },
    get occluder() {
      return { enabled: sdfLayer.occluderEnabled, instances: occluderHull.instanceCount };
    },
    setConeFineTile(px: number) { sdfLayer.setConeFineTile(px); },
    get coneFineTile() { return sdfLayer.coneFineTile; },
    get coneEnabled() { return sdfLayer.coneEnabled; },
    get sdfFlipY() { return sdfLayer.flipY; },
    setSimplifyOverride(v: boolean | null) { simplifyOverride = v; },
    /** Re-spawns the crowd at a new spacing. 1 = shoulder to shoulder. */
    /** Re-spawns the crowd with or without per-body specialised shaders. */
    setSpecialise(on: boolean) {
      const n = crowd.length;
      setCrowdCount(0);
      specialiseShaders = on;
      setCrowdCount(n);
    },
    get specialise() { return specialiseShaders; },
    setCrowdSpread(v: number) {
      const n = crowd.length;
      setCrowdCount(0);
      crowdSpread = v;
      setCrowdCount(n);
    },
    clearOverrides() { for (const k of Object.keys(lodOverride)) delete lodOverride[k as LodLever]; },
    get lodLevels() {
      return [view, ...crowd].map(v => lastLevel.get(v.object) ?? -1);
    },
    setCam(yaw: number, pitch: number, dist: number) {
      autoSpin = false;
      camYaw = yaw;
      camPitch = pitch;
      camDist = dist;
    },
  };
}

// A rejected bootstrap would otherwise be an unhandled promise and the page
// would just sit blank — the failure mode this project has lost the most time to.
main().catch((err) => {
  const el = document.getElementById('errors');
  const msg = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  if (el) el.textContent = msg;
  console.error('[sdf-lab-webgpu] bootstrap failed', err);
});
